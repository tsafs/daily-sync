/**
 * Tests for the main() orchestrator function in src/index.ts.
 *
 * All module-level dependencies are mocked so tests exercise only the
 * lifecycle/wiring logic inside main() without touching real providers,
 * file system, or network.
 *
 * (Unit tests for the individual helpers exported from index.ts —
 * createProvider, generateBackupDirName, getTargetDir, runBackup —
 * live in index.test.ts and do NOT use module mocks.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { AppConfig } from '../config.js';
import type { BackupProvider } from '../providers/provider.js';

// ---------------------------------------------------------------------------
// vi.hoisted — shared mock instances referenced inside vi.mock() factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
    const silentLogger = {
        info: () => { },
        warn: () => { },
        error: () => { },
        debug: () => { },
        child: function () { return this as typeof silentLogger; },
    };

    const mockProviderInstance: BackupProvider = {
        name: 'disk',
        initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        upload: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        list: vi.fn<() => Promise<[]>>().mockResolvedValue([]),
        delete: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        mkdir: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const mockArchiverInstance = {
        createArchive: vi.fn().mockResolvedValue({
            files: ['/tmp/test/data_20260325_020000.zip'],
            baseName: 'data_20260325_020000',
            tempDir: '/tmp/test',
        }),
        cleanup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const mockRetentionInstance = {
        apply: vi.fn().mockResolvedValue({ keep: [], delete: [] }),
    };

    const mockSchedulerInstance = {
        schedule: vi.fn(),
    };

    return {
        silentLogger,
        mockProviderInstance,
        mockArchiverInstance,
        mockRetentionInstance,
        mockSchedulerInstance,
    };
});

// ---------------------------------------------------------------------------
// vi.mock — must appear at top level (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('../config.js', () => ({
    loadConfig: vi.fn(),
}));

vi.mock('../services/logger.js', () => ({
    createLogger: vi.fn(() => mocks.silentLogger),
    createSilentLogger: vi.fn(() => mocks.silentLogger),
}));

vi.mock('../services/archiver.js', () => ({
    ArchiverService: vi.fn(() => mocks.mockArchiverInstance),
}));

vi.mock('../services/retention.js', () => ({
    RetentionService: vi.fn(() => mocks.mockRetentionInstance),
}));

vi.mock('../services/scheduler.js', () => ({
    SchedulerService: vi.fn(() => mocks.mockSchedulerInstance),
    validateCronExpression: vi.fn(),
}));

vi.mock('../providers/disk.js', () => ({
    DiskProvider: vi.fn(() => mocks.mockProviderInstance),
}));

vi.mock('../providers/webdav.js', () => ({
    WebDavProvider: vi.fn(() => mocks.mockProviderInstance),
}));

vi.mock('../providers/ftp.js', () => ({
    FtpProvider: vi.fn(() => mocks.mockProviderInstance),
}));

// ---------------------------------------------------------------------------
// Imports — after vi.mock() so they receive the mocked modules
// ---------------------------------------------------------------------------

import { loadConfig } from '../config.js';
import { main } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sentinel error thrown when we intercept process.exit().
 * Lets tests assert both that exit was called and with which code,
 * without actually terminating the process.
 */
class ProcessExitError extends Error {
    constructor(public readonly code: number) {
        super(`process.exit(${code})`);
        this.name = 'ProcessExitError';
    }
}

/** Minimal valid AppConfig for unit tests. */
function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
    return {
        syncMode: 'disk',
        provider: { name: 'disk', targetDir: '/target' },
        archive: { sourceDir: '/data', encrypt: false, chunkSizeMb: 0 },
        retention: { daily: 7, weekly: 4, monthly: 6 },
        cron: '0 2 * * *',
        debug: false,
        logLevel: 'info',
        shutdownTimeoutSecs: 1, // short shutdown timeout for tests
        notification: null,
        ...overrides,
    };
}

/**
 * Retrieve the registered NodeJS event handler for a given event from a spy
 * on process.on.
 */
function getProcessHandler(
    spy: MockInstance,
    event: string,
): ((...args: unknown[]) => void) | undefined {
    const call = spy.mock.calls.find(([e]) => e === event);
    return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('main()', () => {
    let exitSpy: MockInstance;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset shared mock provider state
        vi.mocked(mocks.mockProviderInstance.initialize).mockResolvedValue(undefined);
        vi.mocked(mocks.mockProviderInstance.dispose).mockResolvedValue(undefined);

        // Default archiver: success
        vi.mocked(mocks.mockArchiverInstance.createArchive).mockResolvedValue({
            files: ['/tmp/test/data_20260325_020000.zip'],
            baseName: 'data_20260325_020000',
            tempDir: '/tmp/test',
        });
        vi.mocked(mocks.mockArchiverInstance.cleanup).mockResolvedValue(undefined);

        // Default retention: success
        vi.mocked(mocks.mockRetentionInstance.apply).mockResolvedValue({
            keep: [],
            delete: [],
        });

        // Default scheduler: scheduled (non-immediate) mode — does not call task
        vi.mocked(mocks.mockSchedulerInstance.schedule).mockResolvedValue({
            immediate: false,
            stop: vi.fn(),
        });

        // Default loadConfig: return a valid disk config
        vi.mocked(loadConfig).mockReturnValue(createTestConfig());

        // process.exit: throw a sentinel so we can assert exit code without
        // actually terminating the process or letting main() continue past the exit call.
        exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?) => {
            throw new ProcessExitError((code as number) ?? 0);
        });
    });

    afterEach(() => {
        // Remove listeners registered by main() to prevent cross-test leakage
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('unhandledRejection');
        process.removeAllListeners('uncaughtException');
        vi.restoreAllMocks();
    });

    // ── Config loading ──────────────────────────────────────────────────────

    describe('startup — config loading', () => {
        it('exits with code 1 and does not proceed when loadConfig throws', async () => {
            vi.mocked(loadConfig).mockImplementation(() => {
                throw new Error('SYNC_MODE is required');
            });

            await expect(main()).rejects.toMatchObject({
                name: 'ProcessExitError',
                code: 1,
            });

            expect(exitSpy).toHaveBeenCalledWith(1);
            // Provider was never initialised
            expect(mocks.mockProviderInstance.initialize).not.toHaveBeenCalled();
        });

        it('exits with code 1 for any config error (non-Error thrown)', async () => {
            vi.mocked(loadConfig).mockImplementation(() => {
                // biome-ignore lint/complexity/noUselessThrow: intentionally testing non-Error throw
                throw 'string error';
            });

            await expect(main()).rejects.toMatchObject({ code: 1 });
            expect(exitSpy).toHaveBeenCalledWith(1);
        });
    });

    // ── Provider initialisation ─────────────────────────────────────────────

    describe('startup — provider initialisation', () => {
        it('exits with code 1 when provider.initialize() rejects', async () => {
            vi.mocked(mocks.mockProviderInstance.initialize).mockRejectedValue(
                new Error('auth failed'),
            );

            await expect(main()).rejects.toMatchObject({ code: 1 });
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        it('exits with code 1 for any provider init rejection (non-Error)', async () => {
            vi.mocked(mocks.mockProviderInstance.initialize).mockRejectedValue(
                'connection refused',
            );

            await expect(main()).rejects.toMatchObject({ code: 1 });
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        it('does not exit when provider.initialize() succeeds', async () => {
            // scheduled mode — main() returns after registering handlers
            await main();
            expect(exitSpy).not.toHaveBeenCalled();
        });
    });

    // ── Debug mode ──────────────────────────────────────────────────────────

    describe('debug mode', () => {
        /**
         * Override the scheduler to immediately invoke the task (matching the
         * real debug-mode behaviour of SchedulerService) and return
         * { immediate: true }.
         */
        function setDebugScheduler() {
            vi.mocked(mocks.mockSchedulerInstance.schedule).mockImplementation(
                async (_config, task: () => Promise<void>) => {
                    await task();
                    return { immediate: true, stop: vi.fn() };
                },
            );
        }

        it('runs backup, disposes provider, and returns without calling process.exit on success', async () => {
            vi.mocked(loadConfig).mockReturnValue(createTestConfig({ debug: true }));
            setDebugScheduler();

            await main(); // must not throw

            expect(exitSpy).not.toHaveBeenCalled();
            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalledOnce();
        });

        it('disposes provider before exiting even on backup failure', async () => {
            vi.mocked(loadConfig).mockReturnValue(createTestConfig({ debug: true }));
            setDebugScheduler();

            vi.mocked(mocks.mockArchiverInstance.createArchive).mockRejectedValue(
                new Error('7z not found'),
            );

            await expect(main()).rejects.toMatchObject({ code: 1 });

            // Provider is always disposed before exit
            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalledOnce();
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        it('exits with code 1 exactly once, not twice, when backup fails', async () => {
            vi.mocked(loadConfig).mockReturnValue(createTestConfig({ debug: true }));
            setDebugScheduler();

            vi.mocked(mocks.mockArchiverInstance.createArchive).mockRejectedValue(
                new Error('7z error'),
            );

            await expect(main()).rejects.toMatchObject({ code: 1 });
            expect(exitSpy).toHaveBeenCalledTimes(1);
            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        it('does not call process.exit(0) in debug mode to allow clean return', async () => {
            vi.mocked(loadConfig).mockReturnValue(createTestConfig({ debug: true }));
            setDebugScheduler();

            await main();

            // Should have returned normally, not via process.exit
            expect(exitSpy).not.toHaveBeenCalled();
        });
    });

    // ── Scheduled mode — handler registration ──────────────────────────────

    describe('scheduled mode — process handler registration', () => {
        it('registers SIGTERM, SIGINT, unhandledRejection, and uncaughtException handlers', async () => {
            const processOnSpy = vi.spyOn(process, 'on');

            await main();

            const registeredEvents = processOnSpy.mock.calls.map(([event]) => event);
            expect(registeredEvents).toContain('SIGTERM');
            expect(registeredEvents).toContain('SIGINT');
            expect(registeredEvents).toContain('unhandledRejection');
            expect(registeredEvents).toContain('uncaughtException');
        });

        it('does not call provider.dispose before shutdown signal', async () => {
            await main();
            expect(mocks.mockProviderInstance.dispose).not.toHaveBeenCalled();
        });
    });

    // ── Graceful shutdown ───────────────────────────────────────────────────

    describe('graceful shutdown', () => {
        it('SIGTERM: stops scheduler, disposes provider, and exits 0 when no backup is in progress', async () => {
            // Use a non-throwing exit mock so the async flow completes
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');
            const stopFn = vi.fn();
            vi.mocked(mocks.mockSchedulerInstance.schedule).mockResolvedValue({
                immediate: false,
                stop: stopFn,
            });

            await main();

            const sigtermHandler = getProcessHandler(processOnSpy, 'SIGTERM');
            expect(sigtermHandler).toBeDefined();

            // Fire SIGTERM and let async work settle
            sigtermHandler!();
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(stopFn).toHaveBeenCalled();
            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalledOnce();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('SIGINT: stops scheduler, disposes provider, and exits 0 when no backup is in progress', async () => {
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');

            await main();

            const sigintHandler = getProcessHandler(processOnSpy, 'SIGINT');
            expect(sigintHandler).toBeDefined();

            sigintHandler!();
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalledOnce();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('waits for in-progress backup to complete before shutting down', async () => {
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');

            // Capture the task callback so we can invoke it manually
            let capturedTask: (() => Promise<void>) | null = null;
            vi.mocked(mocks.mockSchedulerInstance.schedule).mockImplementation(
                async (_config, task: () => Promise<void>) => {
                    capturedTask = task;
                    return { immediate: false, stop: vi.fn() };
                },
            );

            // Make createArchive hold open until we release it — this simulates
            // a backup that is currently in-flight when SIGTERM arrives
            let releaseArchive!: () => void;
            const archiveDone = new Promise<void>((resolve) => {
                releaseArchive = resolve;
            });
            vi.mocked(mocks.mockArchiverInstance.createArchive).mockImplementation(async () => {
                await archiveDone;
                return {
                    files: ['/tmp/test/data.zip'],
                    baseName: 'data',
                    tempDir: '/tmp/test',
                };
            });

            const config = createTestConfig({ shutdownTimeoutSecs: 5 });
            vi.mocked(loadConfig).mockReturnValue(config);

            await main();

            // Start the task (doBackup) without awaiting — this sets backupInProgress = true
            // and then suspends inside archiver.createArchive() awaiting archiveDone
            const taskPromise = capturedTask!();

            // Yield to let doBackup enter runBackup and reach the createArchive await
            await new Promise<void>((r) => setImmediate(r));

            // SIGTERM fires while the backup is in progress
            const sigtermHandler = getProcessHandler(processOnSpy, 'SIGTERM');
            sigtermHandler!();

            // Yield to let gracefulShutdown register its backupFinishedResolve handler
            await new Promise<void>((r) => setImmediate(r));

            // Shutdown must not have exited yet — it is waiting for the backup
            expect(exitSpy).not.toHaveBeenCalled();

            // Release the archive → backup completes → graceful shutdown unblocks
            releaseArchive();
            await taskPromise;
            await new Promise<void>((r) => setTimeout(r, 50));

            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('forces exit after shutdown timeout when backup does not complete', async () => {
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');

            // Capture the task so we can start it manually
            let capturedTask: (() => Promise<void>) | null = null;
            vi.mocked(mocks.mockSchedulerInstance.schedule).mockImplementation(
                async (_config, task: () => Promise<void>) => {
                    capturedTask = task;
                    return { immediate: false, stop: vi.fn() };
                },
            );

            // Make createArchive never resolve — simulates a stuck backup
            vi.mocked(mocks.mockArchiverInstance.createArchive).mockImplementation(
                () => new Promise<never>(() => { /* intentionally never resolves */ }),
            );

            // Very short shutdown timeout: 50ms so the test is fast
            const config = createTestConfig({ shutdownTimeoutSecs: 0.05 });
            vi.mocked(loadConfig).mockReturnValue(config);

            await main();

            // Start backup without awaiting — it will get stuck inside createArchive
            void capturedTask!();

            // Yield so doBackup runs and sets backupInProgress = true
            await new Promise<void>((r) => setImmediate(r));

            // Fire SIGTERM — graceful shutdown starts waiting with a 50ms timeout
            const sigtermHandler = getProcessHandler(processOnSpy, 'SIGTERM');
            sigtermHandler!();

            // Wait for the timeout to fire (50ms) plus a buffer
            await new Promise<void>((r) => setTimeout(r, 200));

            // Even though the backup never finished, the process should dispose
            // the provider and call process.exit(0) after the timeout
            expect(mocks.mockProviderInstance.dispose).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(0);
        });

        it('skips running a backup when shutdown has been requested', async () => {
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');

            let capturedTask: (() => Promise<void>) | null = null;
            const stopFn = vi.fn();

            vi.mocked(mocks.mockSchedulerInstance.schedule).mockImplementation(
                async (_config, task: () => Promise<void>) => {
                    capturedTask = task;
                    return { immediate: false, stop: stopFn };
                },
            );

            await main();

            // Trigger SIGTERM first — this sets shutdownRequested = true
            const sigtermHandler = getProcessHandler(processOnSpy, 'SIGTERM');
            sigtermHandler!();
            await new Promise<void>((r) => setImmediate(r));

            // Now manually invoke the task (like a cron tick would)
            await capturedTask!();

            // Archiver should NOT have been called because shutdown was requested
            expect(mocks.mockArchiverInstance.createArchive).not.toHaveBeenCalled();
        });
    });

    // ── Unhandled promise rejections ────────────────────────────────────────

    describe('unhandledRejection handler', () => {
        it('does not crash the process on unhandled rejection', async () => {
            const processOnSpy = vi.spyOn(process, 'on');
            await main();

            const handler = getProcessHandler(processOnSpy, 'unhandledRejection');
            expect(handler).toBeDefined();

            // Calling the handler must not throw and must not call process.exit
            expect(() => handler!(new Error('forgotten await'))).not.toThrow();
            expect(exitSpy).not.toHaveBeenCalled();
        });

        it('does not crash when unhandled rejection reason is not an Error', async () => {
            const processOnSpy = vi.spyOn(process, 'on');
            await main();

            const handler = getProcessHandler(processOnSpy, 'unhandledRejection');
            expect(() => handler!('string rejection')).not.toThrow();
            expect(exitSpy).not.toHaveBeenCalled();
        });
    });

    // ── Uncaught exceptions ────────────────────────────────────────────────

    describe('uncaughtException handler', () => {
        it('exits with code 1 on uncaught exception', async () => {
            // Use non-throwing exit mock so the handler can complete normally
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');
            await main();

            const handler = getProcessHandler(processOnSpy, 'uncaughtException');
            expect(handler).toBeDefined();

            handler!(new Error('segfault'));

            expect(exitSpy).toHaveBeenCalledWith(1);
        });

        it('exits with code 1 regardless of the exception type', async () => {
            exitSpy.mockImplementation(() => undefined as never);

            const processOnSpy = vi.spyOn(process, 'on');
            await main();

            const handler = getProcessHandler(processOnSpy, 'uncaughtException');
            handler!(new RangeError('stack overflow'));

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(exitSpy).toHaveBeenCalledTimes(1);
        });
    });
});
