import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BackupProvider } from '../providers/provider.js';
import type { ArchiverService, ArchiveResult } from '../services/archiver.js';
import type { RetentionService, RetentionResult } from '../services/retention.js';
import type { AppConfig } from '../config.js';
import { createSilentLogger } from '../services/logger.js';
import {
    createProvider,
    generateBackupDirName,
    getTargetDir,
    runBackup,
} from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(overrides: Partial<BackupProvider> = {}): BackupProvider {
    return {
        name: 'mock',
        initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        upload: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        list: vi.fn<() => Promise<[]>>().mockResolvedValue([]),
        delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        mkdir: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        ...overrides,
    };
}

function createMockArchiver(result?: Partial<ArchiveResult>): ArchiverService {
    const archiveResult: ArchiveResult = {
        files: ['/tmp/test/data_20260324_020000.zip'],
        baseName: 'data_20260324_020000',
        tempDir: '/tmp/test',
        ...result,
    };
    return {
        createArchive: vi.fn<() => Promise<ArchiveResult>>().mockResolvedValue(archiveResult),
        cleanup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as ArchiverService;
}

function createMockRetention(result?: Partial<RetentionResult>): RetentionService {
    const retentionResult: RetentionResult = {
        keep: [],
        delete: [],
        ...result,
    };
    return {
        apply: vi.fn<() => Promise<RetentionResult>>().mockResolvedValue(retentionResult),
    } as unknown as RetentionService;
}

/** Get all paths passed to provider.delete calls. */
function deletedPaths(provider: BackupProvider): string[] {
    return (provider.delete as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0] as string,
    );
}

/** Assert that every provider.delete call targeted a backup_* subdirectory, never the parent. */
function assertDeletesOnlyBackupDirs(provider: BackupProvider, targetDir: string): void {
    const paths = deletedPaths(provider);
    for (const p of paths) {
        // Must be a child of targetDir, not targetDir itself
        expect(p).not.toBe(targetDir);
        expect(p).toMatch(/\/backup_\d{8}_\d{6}$/);
        expect(p.startsWith(targetDir.replace(/\/$/, ''))).toBe(true);
    }
}

/**
 * Assert that the source data directory is never touched by any
 * provider or archiver operation (no delete, no cleanup targeting it).
 */
function assertSourceDirNeverDeleted(
    provider: BackupProvider,
    archiver: ArchiverService,
    sourceDir: string,
): void {
    // provider.delete must never target sourceDir
    for (const p of deletedPaths(provider)) {
        expect(p).not.toBe(sourceDir);
        expect(p).not.toContain(sourceDir);
    }
    // archiver.cleanup must never target sourceDir
    const cleanupCalls = (archiver.cleanup as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of cleanupCalls) {
        expect(call[0]).not.toBe(sourceDir);
    }
}

/** Minimal valid AppConfig for disk mode. */
function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
        syncMode: 'disk',
        provider: { name: 'disk', targetDir: '/target' },
        archive: {
            sourceDir: '/data',
            encrypt: false,
            chunkSizeMb: 0,
        },
        retention: { daily: 7, weekly: 4, monthly: 6 },
        cron: '0 2 * * *',
        debug: false,
        logLevel: 'info',
        shutdownTimeoutSecs: 300,
        notification: null,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// createProvider
// ---------------------------------------------------------------------------

describe('createProvider', () => {
    const log = createSilentLogger();

    it('creates a DiskProvider for disk config', () => {
        const provider = createProvider({ name: 'disk', targetDir: '/backup' }, log);
        expect(provider.name).toBe('disk');
    });

    it('creates a WebDavProvider for webdav config', () => {
        const provider = createProvider(
            {
                name: 'webdav',
                url: 'https://dav.example.com',
                username: 'user',
                password: 'pass',
                targetDir: '/data',
            },
            log,
        );
        expect(provider.name).toBe('webdav');
    });

    it('creates a FtpProvider for ftp config', () => {
        const provider = createProvider(
            {
                name: 'ftp',
                host: 'ftp.example.com',
                port: 21,
                username: 'user',
                password: 'pass',
                targetDir: '/',
                tls: true,
            },
            log,
        );
        expect(provider.name).toBe('ftp');
    });
});

// ---------------------------------------------------------------------------
// generateBackupDirName
// ---------------------------------------------------------------------------

describe('generateBackupDirName', () => {
    it('formats a date as backup_YYYYMMDD_HHMMSS', () => {
        const date = new Date(2026, 2, 24, 14, 5, 9); // March 24, 2026 14:05:09
        expect(generateBackupDirName(date)).toBe('backup_20260324_140509');
    });

    it('pads single-digit month, day, hour, minute, second', () => {
        const date = new Date(2026, 0, 3, 1, 2, 3); // Jan 3, 2026 01:02:03
        expect(generateBackupDirName(date)).toBe('backup_20260103_010203');
    });

    it('handles midnight', () => {
        const date = new Date(2026, 11, 31, 0, 0, 0); // Dec 31, 2026 00:00:00
        expect(generateBackupDirName(date)).toBe('backup_20261231_000000');
    });

    it('handles end of day', () => {
        const date = new Date(2026, 11, 31, 23, 59, 59);
        expect(generateBackupDirName(date)).toBe('backup_20261231_235959');
    });

    it('uses current time when no argument is given', () => {
        const result = generateBackupDirName();
        expect(result).toMatch(/^backup_\d{8}_\d{6}$/);
    });
});

// ---------------------------------------------------------------------------
// getTargetDir
// ---------------------------------------------------------------------------

describe('getTargetDir', () => {
    it('returns targetDir for disk config', () => {
        expect(getTargetDir({ name: 'disk', targetDir: '/backup' })).toBe('/backup');
    });

    it('returns targetDir for webdav config', () => {
        expect(
            getTargetDir({
                name: 'webdav',
                url: 'https://x.com',
                username: 'u',
                password: 'p',
                targetDir: '/remote/data',
            }),
        ).toBe('/remote/data');
    });

    it('returns targetDir for ftp config', () => {
        expect(
            getTargetDir({
                name: 'ftp',
                host: 'h',
                port: 21,
                username: 'u',
                password: 'p',
                targetDir: '/ftp/backups',
                tls: true,
            }),
        ).toBe('/ftp/backups');
    });
});

// ---------------------------------------------------------------------------
// runBackup
// ---------------------------------------------------------------------------

describe('runBackup', () => {
    const log = createSilentLogger();
    let provider: BackupProvider;
    let archiver: ArchiverService;
    let retention: RetentionService;
    let config: AppConfig;

    beforeEach(() => {
        provider = createMockProvider();
        archiver = createMockArchiver();
        retention = createMockRetention();
        config = createTestConfig();
    });

    // -- Success path -------------------------------------------------------

    it('runs the full backup flow on success', async () => {
        await runBackup(provider, archiver, retention, config, log);

        // Archive was created with the correct options
        expect(archiver.createArchive).toHaveBeenCalledWith(config.archive);

        // Remote directory was created
        expect(provider.mkdir).toHaveBeenCalledOnce();
        const mkdirArg = (provider.mkdir as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        expect(mkdirArg).toMatch(/^\/target\/backup_\d{8}_\d{6}$/);

        // File was uploaded
        expect(provider.upload).toHaveBeenCalledOnce();

        // Retention was applied
        expect(retention.apply).toHaveBeenCalledWith(provider, '/target');

        // No backup directory was deleted on success
        expect(provider.delete).not.toHaveBeenCalled();

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);

        // Temp dir was cleaned up
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    it('uploads multiple volumes in order', async () => {
        archiver = createMockArchiver({
            files: [
                '/tmp/test/data.zip.001',
                '/tmp/test/data.zip.002',
                '/tmp/test/data.zip.003',
            ],
            baseName: 'data',
        });

        await runBackup(provider, archiver, retention, config, log);

        expect(provider.upload).toHaveBeenCalledTimes(3);

        const uploadCalls = (provider.upload as ReturnType<typeof vi.fn>).mock.calls;
        // Verify files are uploaded with correct remote paths
        expect(uploadCalls[0][0]).toBe('/tmp/test/data.zip.001');
        expect((uploadCalls[0][1] as string).endsWith('/data.zip.001')).toBe(true);
        expect(uploadCalls[1][0]).toBe('/tmp/test/data.zip.002');
        expect((uploadCalls[1][1] as string).endsWith('/data.zip.002')).toBe(true);
        expect(uploadCalls[2][0]).toBe('/tmp/test/data.zip.003');
        expect((uploadCalls[2][1] as string).endsWith('/data.zip.003')).toBe(true);

        // No backup directory was deleted on success
        expect(provider.delete).not.toHaveBeenCalled();

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);
    });

    it('constructs remote path with slash handling', async () => {
        config = createTestConfig({
            provider: { name: 'disk', targetDir: '/target/' }, // trailing slash
        });

        await runBackup(provider, archiver, retention, config, log);

        const mkdirArg = (provider.mkdir as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
        // Should not double-slash
        expect(mkdirArg).toMatch(/^\/target\/backup_\d{8}_\d{6}$/);
        expect(mkdirArg).not.toContain('//');
    });

    // -- Archive failure ----------------------------------------------------

    it('re-throws archive creation errors', async () => {
        const archiveError = new Error('7z not found');
        (archiver.createArchive as ReturnType<typeof vi.fn>).mockRejectedValue(archiveError);

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('7z not found');

        // No remote directory was created
        expect(provider.mkdir).not.toHaveBeenCalled();
        expect(provider.upload).not.toHaveBeenCalled();
        expect(provider.delete).not.toHaveBeenCalled();

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);
    });

    it('does not attempt temp cleanup when archive creation fails before producing result', async () => {
        (archiver.createArchive as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('source missing'),
        );

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('source missing');

        // cleanup is NOT called because archiveResult is null
        expect(archiver.cleanup).not.toHaveBeenCalled();
    });

    // -- Upload failure -----------------------------------------------------

    it('cleans up remote directory on upload failure', async () => {
        (provider.upload as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('network timeout'),
        );

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('network timeout');

        // Remote dir was created then cleaned up
        expect(provider.mkdir).toHaveBeenCalledOnce();
        expect(provider.delete).toHaveBeenCalledOnce();
        // Deleted path is the backup subdir, never the parent target dir
        assertDeletesOnlyBackupDirs(provider, '/target');

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);

        // Temp files were cleaned up
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    it('handles remote cleanup failure gracefully during upload error', async () => {
        (provider.upload as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('upload failed'),
        );
        (provider.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('delete also failed'),
        );

        // The original upload error should still be thrown
        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('upload failed');

        // Delete was attempted on the backup subdir, not the parent
        assertDeletesOnlyBackupDirs(provider, '/target');

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);

        // Temp files are still cleaned up
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    it('cleans up on mkdir failure (remoteCreated is false)', async () => {
        (provider.mkdir as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('permission denied'),
        );

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('permission denied');

        // mkdir failed, so remoteCreated is false — no delete attempt
        expect(provider.delete).not.toHaveBeenCalled();

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);

        // Temp files are still cleaned up
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    // -- Partial upload failure ---------------------------------------------

    it('stops uploading after first volume failure', async () => {
        archiver = createMockArchiver({
            files: ['/tmp/test/data.zip.001', '/tmp/test/data.zip.002', '/tmp/test/data.zip.003'],
        });

        let callCount = 0;
        (provider.upload as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            callCount++;
            if (callCount === 2) {
                throw new Error('volume 2 failed');
            }
        });

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('volume 2 failed');

        // Only 2 upload calls (failed on second)
        expect(provider.upload).toHaveBeenCalledTimes(2);

        // Remote directory cleaned up — must be the backup subdir
        expect(provider.delete).toHaveBeenCalledOnce();
        assertDeletesOnlyBackupDirs(provider, '/target');

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);
    });

    // -- Retention failure --------------------------------------------------

    it('succeeds even when retention cleanup fails', async () => {
        (retention.apply as ReturnType<typeof vi.fn>).mockRejectedValue(
            new Error('retention error'),
        );

        // Should NOT throw — retention failure is non-fatal
        await expect(runBackup(provider, archiver, retention, config, log))
            .resolves.toBeUndefined();

        // Archive was created and uploaded
        expect(archiver.createArchive).toHaveBeenCalledOnce();
        expect(provider.upload).toHaveBeenCalledOnce();

        // Remote dir should NOT be deleted (backup is valid)
        expect(provider.delete).not.toHaveBeenCalled();

        // Source data directory is never touched
        assertSourceDirNeverDeleted(provider, archiver, config.archive.sourceDir);

        // Temp files were cleaned up
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    // -- Temp cleanup always runs -------------------------------------------

    it('cleans up temp files on success', async () => {
        await runBackup(provider, archiver, retention, config, log);
        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });

    it('cleans up temp files on upload failure', async () => {
        (provider.upload as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));

        await expect(runBackup(provider, archiver, retention, config, log))
            .rejects.toThrow('fail');

        expect(archiver.cleanup).toHaveBeenCalledWith('/tmp/test');
    });
});
