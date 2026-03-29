/**
 * E2E test for the FTP backup flow using a real FTP server in Docker.
 *
 * Exercises the full production `runBackup()` pipeline:
 *   config → ArchiverService (7z) → provider.mkdir → provider.upload
 *   → IntegrityService (SHA-256 round-trip via provider.download)
 *   → RetentionService (provider.list + provider.delete)
 *
 * Source data is ≥ 2 GiB of random bytes so the resulting encrypted archive
 * also exceeds 2 GiB — reproducing the ERR_FS_FILE_TOO_LARGE crash that
 * the streaming fix addresses.
 *
 * Uses host networking to sidestep the FTP PASV address mapping problem:
 * in PASV mode the server advertises its own IP for data connections, which
 * doesn't survive NAT/port-mapping. With `--network=host` the container shares
 * the host network stack so 127.0.0.1 works end-to-end.
 *
 * Requires: Docker on Linux, 7z on the host.
 * Host networking is not available on Docker Desktop for Mac/Windows —
 * for those platforms set SKIP_FTP_E2E=1.
 *
 * Image: delfer/alpine-ftp-server
 *   USERS=test|testpass, ADDRESS=127.0.0.1, PASV ports 21100–21110
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { FtpProvider } from '../../providers/ftp.js';
import { ArchiverService } from '../../services/archiver.js';
import { RetentionService } from '../../services/retention.js';
import { IntegrityService } from '../../services/integrity.js';
import { createSilentLogger } from '../../services/logger.js';
import { runBackup, type BackupRunStats } from '../../index.js';
import type { AppConfig } from '../../config.js';
import { generateTestData } from './generate-data.js';
import { ensureE2eTmpDir, E2E_TMP } from './e2e-paths.js';

const execFileAsync = promisify(execFile);

const SKIP = process.env['SKIP_FTP_E2E'] === '1';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('FTP backup — E2E (runBackup, ≥2 GiB)', () => {
    let container: StartedTestContainer;
    let provider: FtpProvider;
    let sourceDir: string;
    const log = createSilentLogger();

    beforeAll(async () => {
        // 0. Verify 7z is available on the host
        try {
            await execFileAsync('7z', ['--help']);
        } catch {
            throw new Error(
                'E2E test requires 7z to be installed on the host. ' +
                'Install it (e.g. `sudo apt install p7zip-full`) and retry.',
            );
        }

        // 1. Generate ≥ 2 GiB of random source data
        const tmpBase = await ensureE2eTmpDir();
        sourceDir = await mkdtemp(join(tmpBase, 'ftp-e2e-src-'));
        await generateTestData(sourceDir, 2560); // 2.5 GiB

        // 2. Start FTP container with host networking
        container = await new GenericContainer('delfer/alpine-ftp-server')
            .withNetworkMode('host')
            .withEnvironment({
                USERS: 'test|testpass',
                ADDRESS: '127.0.0.1',
                PASV_MIN_PORT: '21100',
                PASV_MAX_PORT: '21110',
            })
            .start();

        // 3. Create provider
        provider = new FtpProvider({
            name: 'ftp',
            host: '127.0.0.1',
            port: 21,
            username: 'test',
            password: 'testpass',
            // delfer/alpine-ftp-server: no chroot, user home is /ftp/test.
            // basic-ftp's ensureDir() calls CWD / for absolute paths,
            // then navigates each segment. /ftp/test is writable by the user.
            targetDir: '/ftp/test',
            tls: false,
        });

        // vsftpd takes a moment to bind port 21 after the container starts.
        // Retry initialize() with backoff until the FTP server accepts connections.
        let lastErr: unknown;
        for (let attempt = 0; attempt < 15; attempt++) {
            try {
                await provider.initialize();
                lastErr = undefined;
                break;
            } catch (err) {
                lastErr = err;
                await new Promise((r) => setTimeout(r, 1_000));
            }
        }
        if (lastErr) throw lastErr;
    }, 600_000);

    afterAll(async () => {
        await provider?.dispose().catch(() => { /* ignore */ });
        await container?.stop().catch(() => { /* ignore */ });
        if (sourceDir) await rm(sourceDir, { recursive: true, force: true });
    }, 120_000);

    // -----------------------------------------------------------------------

    it('completes a full ≥2 GiB backup without ERR_FS_FILE_TOO_LARGE', async () => {
        const archiver = new ArchiverService();
        const retention = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
        const integrity = new IntegrityService();

        const config: AppConfig = {
            syncMode: 'ftp',
            provider: {
                name: 'ftp',
                host: '127.0.0.1',
                port: 21,
                username: 'test',
                password: 'testpass',
                targetDir: '/ftp/test',
                tls: false,
            },
            archive: {
                sourceDir,
                encrypt: true,
                password: 'e2e-test-password',
                chunkSizeMb: 0,
                tempBaseDir: E2E_TMP,
            },
            retention: { daily: 7, weekly: 4, monthly: 6 },
            cron: '0 2 * * *',
            debug: false,
            logLevel: 'info',
            shutdownTimeoutSecs: 300,
            notification: null,
        };

        // Run the full production backup pipeline
        const stats: BackupRunStats = await runBackup(
            provider, archiver, retention, integrity, config, log,
            async (fn) => fn(), // no retry delays in tests
        );

        // ── Assertions ──────────────────────────────────────────────────

        // 1. Backup completed with valid stats
        expect(stats.backupId).toMatch(/^backup_\d{8}_\d{6}$/);
        expect(stats.volumeCount).toBeGreaterThanOrEqual(1);
        expect(stats.archiveSizeMb).toBeGreaterThan(0);
        expect(stats.durationMs).toBeGreaterThan(0);

        // 2. Backup directory exists on the remote
        const remoteEntries = await provider.list('/');
        const backupDirs = remoteEntries.filter(
            (e) => e.isDirectory && e.name === stats.backupId,
        );
        expect(backupDirs).toHaveLength(1);

        // 3. Archive file(s) exist inside the backup directory
        const archiveEntries = await provider.list(stats.backupId);
        expect(archiveEntries.length).toBeGreaterThanOrEqual(1);
        expect(archiveEntries.some((e) => e.name.endsWith('.zip'))).toBe(true);
    }, 580_000);
});
