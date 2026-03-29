/**
 * E2E test for the WebDAV backup flow using a real WebDAV server in Docker.
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
 * Requires: Docker, 7z on the host.
 *
 * Image: bytemark/webdav
 *   AUTH_TYPE=Basic, USERNAME=test, PASSWORD=test, port 80
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { WebDavProvider } from '../../providers/webdav.js';
import { ArchiverService } from '../../services/archiver.js';
import { RetentionService } from '../../services/retention.js';
import { IntegrityService } from '../../services/integrity.js';
import { createSilentLogger } from '../../services/logger.js';
import { runBackup, type BackupRunStats } from '../../index.js';
import type { AppConfig } from '../../config.js';
import { generateTestData } from './generate-data.js';
import { ensureE2eTmpDir, E2E_TMP } from './e2e-paths.js';

const execFileAsync = promisify(execFile);

const SKIP = process.env['SKIP_WEBDAV_E2E'] === '1';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('WebDAV backup — E2E (runBackup, ≥2 GiB)', () => {
    let container: StartedTestContainer;
    let provider: WebDavProvider;
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
        sourceDir = await mkdtemp(join(tmpBase, 'webdav-e2e-src-'));
        await generateTestData(sourceDir, 2560); // 2.5 GiB

        // 2. Start WebDAV container
        container = await new GenericContainer('bytemark/webdav')
            .withEnvironment({
                AUTH_TYPE: 'Basic',
                USERNAME: 'test',
                PASSWORD: 'test',
            })
            .withExposedPorts(80)
            .start();

        const host = container.getHost();
        const port = container.getMappedPort(80);

        // bytemark/webdav serves WebDAV at LOCATION=/ (the default).
        const url = `http://${host}:${port}`;

        provider = new WebDavProvider({
            name: 'webdav',
            url,
            username: 'test',
            password: 'test',
            targetDir: '/backups',
        });

        await provider.initialize();
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
            syncMode: 'webdav',
            provider: {
                name: 'webdav',
                url: '', // not used by runBackup — provider is already initialized
                username: '',
                password: '',
                targetDir: '/backups',
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
        const remoteEntries = await provider.list('/backups');
        const backupDirs = remoteEntries.filter(
            (e) => e.isDirectory && e.name === stats.backupId,
        );
        expect(backupDirs).toHaveLength(1);

        // 3. Archive file(s) exist inside the backup directory
        const archiveEntries = await provider.list(`/backups/${stats.backupId}`);
        expect(archiveEntries.length).toBeGreaterThanOrEqual(1);
        expect(archiveEntries.some((e) => e.name.endsWith('.zip'))).toBe(true);
    }, 580_000);
});
