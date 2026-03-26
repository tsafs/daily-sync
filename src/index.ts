/**
 * Orchestrator — main entry point for daily-sync.
 *
 * Wires together: config loading, provider instantiation, archiving,
 * retention, scheduling, and process lifecycle management.
 *
 * @module
 */

import { basename } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger, type Logger } from './services/logger.js';
import { ArchiverService, type ArchiveResult } from './services/archiver.js';
import { RetentionService } from './services/retention.js';
import { SchedulerService } from './services/scheduler.js';
import { IntegrityService } from './services/integrity.js';
import { withRetry } from './services/retry.js';
import { DiskProvider } from './providers/disk.js';
import { WebDavProvider } from './providers/webdav.js';
import { FtpProvider } from './providers/ftp.js';
import type { BackupProvider, AnyProviderConfig } from './providers/provider.js';

// ---------------------------------------------------------------------------
// Exported helpers (testable)
// ---------------------------------------------------------------------------

/**
 * Create the appropriate backup provider based on configuration.
 */
export function createProvider(config: AnyProviderConfig, logger: Logger): BackupProvider {
    switch (config.name) {
        case 'disk':
            return new DiskProvider(config, logger);
        case 'webdav':
            return new WebDavProvider(config, logger);
        case 'ftp':
            return new FtpProvider(config, logger);
    }
}

/**
 * Generate a backup directory name from a timestamp.
 * Format: backup_YYYYMMDD_HHMMSS
 */
export function generateBackupDirName(now: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts =
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `backup_${ts}`;
}

/**
 * Resolve the remote target directory from the provider configuration.
 */
export function getTargetDir(config: AnyProviderConfig): string {
    return config.targetDir;
}

/**
 * Execute a single backup run.
 *
 * 1. Create archive from source data
 * 2. Create remote backup directory (`backup_YYYYMMDD_HHMMSS/`)
 * 3. Upload all archive volumes
 * 4. Verify upload integrity (SHA-256 round-trip where provider supports it)
 * 5. Run GFS retention cleanup
 * 6. Clean up local temp files (always, via finally)
 *
 * On failure the incomplete remote directory is removed (best-effort)
 * and the error is re-thrown so callers can log / notify.
 *
 * Retention errors are non-fatal: the backup itself succeeded if all
 * volumes were uploaded, so the remote directory is kept even if
 * retention cleanup fails.
 *
 * @param retry - Injectable retry wrapper for uploads. Defaults to
 *   {@link withRetry} with exponential backoff (3 attempts, 5 s/15 s/45 s).
 *   Pass `async fn => fn()` in unit tests to skip delays.
 */
export async function runBackup(
    provider: BackupProvider,
    archiver: ArchiverService,
    retention: RetentionService,
    integrity: IntegrityService,
    config: AppConfig,
    log: Logger,
    retry: <T>(fn: () => Promise<T>) => Promise<T> = withRetry,
): Promise<void> {
    const backupDirName = generateBackupDirName();
    const targetDir = getTargetDir(config.provider);
    const remotePath = targetDir.endsWith('/')
        ? `${targetDir}${backupDirName}`
        : `${targetDir}/${backupDirName}`;

    const backupLog = log.child({ backupId: backupDirName, provider: provider.name });
    backupLog.info('Starting backup run');

    let archiveResult: ArchiveResult | null = null;
    let remoteCreated = false;

    try {
        // Step 1 — Create archive
        backupLog.info('Creating archive');
        archiveResult = await archiver.createArchive(config.archive);
        backupLog.info(
            { fileCount: archiveResult.files.length, baseName: archiveResult.baseName },
            'Archive created',
        );

        // Step 2 — Create remote backup directory
        backupLog.info({ remotePath }, 'Creating remote backup directory');
        await provider.mkdir(remotePath);
        remoteCreated = true;

        // Step 3 — Upload all archive volumes
        for (let i = 0; i < archiveResult.files.length; i++) {
            const file = archiveResult.files[i];
            const fileName = basename(file);
            const remoteFilePath = `${remotePath}/${fileName}`;
            backupLog.info(
                { file: fileName, part: i + 1, total: archiveResult.files.length },
                'Uploading archive volume',
            );
            await retry(() => provider.upload(file, remoteFilePath));
        }
        backupLog.info('All archive volumes uploaded');

        // Step 4 — Verify upload integrity (non-blocking for unsupported providers)
        backupLog.info('Verifying upload integrity');
        for (const file of archiveResult.files) {
            const fileName = basename(file);
            const remoteFilePath = `${remotePath}/${fileName}`;
            await integrity.verify(provider, file, remoteFilePath);
        }
        backupLog.info('Integrity verification complete');

        // Step 5 — GFS retention cleanup (non-fatal: backup is already complete)
        backupLog.info('Running retention cleanup');
        try {
            const retentionResult = await retention.apply(provider, targetDir);
            backupLog.info(
                { keeping: retentionResult.keep.length, deleted: retentionResult.delete.length },
                'Retention cleanup complete',
            );
        } catch (retentionErr) {
            backupLog.error(
                { err: retentionErr },
                'Retention cleanup failed — backup is still valid',
            );
        }

        backupLog.info('Backup run completed successfully');
    } catch (err) {
        // Best-effort: remove incomplete remote backup directory
        if (remoteCreated) {
            backupLog.warn({ remotePath }, 'Cleaning up incomplete remote backup directory');
            try {
                await provider.delete(remotePath);
                backupLog.info({ remotePath }, 'Incomplete remote directory removed');
            } catch (cleanupErr) {
                backupLog.error(
                    { err: cleanupErr },
                    'Failed to clean up incomplete remote directory',
                );
            }
        }
        throw err;
    } finally {
        // Step 6 — Always clean up local temp files
        if (archiveResult) {
            backupLog.debug('Cleaning up local temp files');
            await archiver.cleanup(archiveResult.tempDir);
        }
    }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Application entry point.
 *
 * Loads configuration, initialises the provider, and either runs the
 * backup immediately (debug mode) or registers a cron schedule.
 *
 * Process lifecycle (plan step 11a):
 * - SIGTERM / SIGINT  → graceful shutdown with backup-completion wait
 * - unhandledRejection → log, continue (don't kill the scheduler)
 * - uncaughtException  → log, exit 1 (let Docker restart)
 */
export async function main(): Promise<void> {
    // Pre-config logger for startup errors (before config is loaded)
    let log = createLogger({ level: process.env.LOG_LEVEL ?? 'info' });
    log.info('daily-sync starting');

    // ── 1. Load & validate config ─────────────────────────────────────
    let config: AppConfig;
    try {
        config = loadConfig(process.env, log);
        // Re-create logger with validated log level
        log = createLogger({ level: config.logLevel });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err }, `Configuration error: ${message}`);
        process.exit(1);
    }

    // ── 2. Instantiate & initialise provider ──────────────────────────
    const provider = createProvider(config.provider, log);
    try {
        await provider.initialize();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err }, `Failed to initialize ${provider.name} provider: ${message}`);
        process.exit(1);
    }

    // ── Services ──────────────────────────────────────────────────────
    const archiver = new ArchiverService(log);
    const retention = new RetentionService(config.retention, log);
    const scheduler = new SchedulerService(log);
    const integrity = new IntegrityService(log);

    // ── Backup lifecycle tracking ─────────────────────────────────────
    let backupInProgress = false;
    let shutdownRequested = false;
    let lastBackupFailed = false;
    let backupFinishedResolve: (() => void) | null = null;

    const doBackup = async (): Promise<void> => {
        if (shutdownRequested) {
            log.warn('Shutdown requested — skipping backup');
            return;
        }
        backupInProgress = true;
        try {
            await runBackup(provider, archiver, retention, integrity, config, log);
            lastBackupFailed = false;
        } catch (err) {
            lastBackupFailed = true;
            const message = err instanceof Error ? err.message : String(err);
            log.error({ err }, `Backup failed: ${message}`);
            // TODO: Send failure notification (step 14 — notifier service)
        } finally {
            backupInProgress = false;
            if (backupFinishedResolve) {
                backupFinishedResolve();
                backupFinishedResolve = null;
            }
        }
    };

    // ── 3/4. Schedule or run immediately ──────────────────────────────
    const handle = await scheduler.schedule(
        {
            cron: config.cron,
            debug: config.debug,
            timezone: config.timezone,
            onError: (error) => {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                log.error({ err: error }, `Scheduled backup error: ${message}`);
            },
        },
        doBackup,
    );

    if (handle.immediate) {
        // Debug mode: backup already ran, clean up and exit
        await provider.dispose();
        if (lastBackupFailed) {
            log.error('Debug mode backup failed — exiting with error');
            process.exit(1);
        }
        log.info('Debug mode complete — exiting');
        return;
    }

    // ── Process lifecycle safeguards (plan step 11a) ──────────────────

    // Graceful shutdown: wait for in-progress backup, then exit
    const gracefulShutdown = async (signal: string): Promise<void> => {
        log.info({ signal }, 'Received shutdown signal');
        shutdownRequested = true;
        handle.stop();

        if (backupInProgress) {
            log.info('Waiting for in-progress backup to complete...');
            const timeoutMs = config.shutdownTimeoutSecs * 1000;
            const backupDone = new Promise<void>((resolve) => {
                backupFinishedResolve = resolve;
            });
            const timeout = new Promise<'timeout'>((resolve) =>
                setTimeout(() => resolve('timeout'), timeoutMs),
            );
            const result = await Promise.race([backupDone, timeout]);
            if (result === 'timeout') {
                log.warn('Backup did not complete within shutdown timeout — forcing exit');
            }
        }

        await provider.dispose();
        log.info('Shutdown complete');
        process.exit(0);
    };

    process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

    // Unhandled rejection: log but do NOT crash
    // (a forgotten await in a backup run shouldn't kill the scheduler)
    process.on('unhandledRejection', (reason) => {
        log.error({ err: reason }, 'Unhandled promise rejection — process continues');
    });

    // Uncaught exception: log and EXIT — process is in an unknown state
    process.on('uncaughtException', (err) => {
        log.error({ err }, 'Uncaught exception — exiting (let Docker restart)');
        process.exit(1);
    });

    log.info('daily-sync is running — waiting for scheduled backups');
}

// ---------------------------------------------------------------------------
// Auto-start when executed directly (not imported for testing)
// ---------------------------------------------------------------------------

/* c8 ignore start */
if (argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error('Fatal error during startup:', err);
        process.exit(1);
    });
}
/* c8 ignore stop */
