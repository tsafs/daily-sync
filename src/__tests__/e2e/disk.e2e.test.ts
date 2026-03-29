/**
 * E2E test for the DISK backup mode using the real project Docker image.
 *
 * Generates ≥ 2 GiB of random source data, builds the project Dockerfile,
 * mounts the generated data as /data and a fresh temp directory as /target,
 * runs the container in DEBUG mode (one-shot), and verifies:
 *   - The container exits successfully (no ERR_FS_FILE_TOO_LARGE crash)
 *   - At least one backup_* directory with archive file(s) exists in /target
 *   - The success log message is present
 *
 * This directly reproduces the production failure described in the logs:
 * archiving ≥ 2 GiB of data produces an archive larger than the old Node.js
 * 2 GiB readFile() Buffer limit, triggering ERR_FS_FILE_TOO_LARGE during
 * integrity verification.  The streaming fix makes this pass.
 *
 * USE_ENCRYPTION=true so 7z stores without compressing (encrypted output is
 * random-looking and incompressible), guaranteeing the archive stays ≥ 2 GiB.
 *
 * Requires Docker on Linux.  Set SKIP_DISK_E2E=1 to skip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { generateTestData } from './generate-data.js';
import { ensureE2eTmpDir } from './e2e-paths.js';

const SKIP = process.env['SKIP_DISK_E2E'] === '1';

const __filename = fileURLToPath(import.meta.url);
// src/__tests__/e2e/ → project root (3 levels up)
const PROJECT_ROOT = join(__filename, '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)('Disk backup — E2E (full Docker image, generated >2 GiB data)', () => {
    let builtImage: GenericContainer;
    let targetDir: string;
    let dataDir: string;

    beforeAll(async () => {
        // 1. Generate ≥ 2 GiB of random source data
        const tmpBase = await ensureE2eTmpDir();
        dataDir = await mkdtemp(join(tmpBase, 'daily-sync-e2e-data-'));
        await generateTestData(dataDir, 2560); // 2.5 GiB

        // 2. Build the project image from the Dockerfile.
        // .dockerignore excludes test_data/, node_modules/ etc. so the build
        // context is just the source tree.
        builtImage = await GenericContainer
            .fromDockerfile(PROJECT_ROOT)
            .build();

        targetDir = await mkdtemp(join(tmpBase, 'daily-sync-e2e-disk-'));
    }, 600_000);

    afterAll(async () => {
        if (targetDir) await rm(targetDir, { recursive: true, force: true });
        if (dataDir) await rm(dataDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------

    it('completes a full backup of ≥2 GiB data without ERR_FS_FILE_TOO_LARGE', async () => {
        let container: StartedTestContainer | undefined;
        let collectedLogs = '';

        try {
            container = await builtImage
                .withBindMounts([
                    { source: dataDir, target: '/data', mode: 'ro' },
                    { source: targetDir, target: '/target', mode: 'rw' },
                ])
                .withEnvironment({
                    SYNC_MODE: 'disk',
                    DEBUG: 'true',
                    USE_ENCRYPTION: 'true',
                    ENCRYPTION_PASSWORD: 'e2e-test-password',
                })
                // Wait until the orchestrator logs the post-backup success message.
                // The container exits on its own after this in DEBUG mode.
                .withWaitStrategy(Wait.forLogMessage('Backup run completed successfully'))
                .withStartupTimeout(540_000) // 9 min — 7z + integrity of ≥2 GiB
                .start();

            // Collect stdout/stderr for assertions
            const logStream = await container.logs();
            await new Promise<void>((resolve) => {
                logStream.on('data', (chunk: Buffer) => { collectedLogs += chunk.toString(); });
                logStream.on('end', resolve);
                // The container has already printed the success message; the stream
                // will end once Docker reports no more output.
                setTimeout(resolve, 3_000);
            });

        } finally {
            // Container may have already exited; stop() is safe to call either way.
            await container?.stop({ timeout: 10 }).catch(() => { /* already stopped */ });
        }

        // ── Assertions ──────────────────────────────────────────────────────

        // 1. No 2 GiB buffer crash
        expect(collectedLogs).not.toContain('ERR_FS_FILE_TOO_LARGE');

        // 2. Success message present
        expect(collectedLogs).toContain('Backup run completed successfully');

        // 3. At least one backup directory exists in the target
        const entries = await readdir(targetDir);
        const backupDirs = entries.filter((e) => e.startsWith('backup_'));
        expect(backupDirs.length).toBeGreaterThanOrEqual(1);

        // 4. That backup directory contains at least one archive file
        const firstBackupDir = join(targetDir, backupDirs[0]!);
        const archiveFiles = await readdir(firstBackupDir);
        expect(archiveFiles.length).toBeGreaterThanOrEqual(1);
    }, 580_000);
});
