import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    validateCronExpression,
    SchedulerService,
    type SchedulerConfig,
} from '../services/scheduler.js';
import type { Logger } from '../services/logger.js';

/** Silent logger for tests — captures nothing, prevents console noise. */
function createTestLogger(): Logger & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
    const logger: any = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(() => logger),
    };
    return logger;
}

// ---------------------------------------------------------------------------
// validateCronExpression
// ---------------------------------------------------------------------------

describe('validateCronExpression', () => {
    it('accepts "0 2 * * *" (daily at 2:00 AM)', () => {
        expect(() => validateCronExpression('0 2 * * *')).not.toThrow();
    });

    it('accepts "30 14 * * 1-5" (weekdays at 2:30 PM)', () => {
        expect(() => validateCronExpression('30 14 * * 1-5')).not.toThrow();
    });

    it('accepts "* * * * *" (every minute)', () => {
        expect(() => validateCronExpression('* * * * *')).not.toThrow();
    });

    it('accepts "0 0 1 * *" (1st of every month at midnight)', () => {
        expect(() => validateCronExpression('0 0 1 * *')).not.toThrow();
    });

    it('accepts "0 3 * * 1,3,5" (Mon/Wed/Fri at 3 AM)', () => {
        expect(() => validateCronExpression('0 3 * * 1,3,5')).not.toThrow();
    });

    it('accepts "*/15 * * * *" (every 15 minutes)', () => {
        expect(() => validateCronExpression('*/15 * * * *')).not.toThrow();
    });

    it('accepts "0 2,14 * * *" (twice daily)', () => {
        expect(() => validateCronExpression('0 2,14 * * *')).not.toThrow();
    });

    it('accepts expression with leading/trailing whitespace', () => {
        expect(() => validateCronExpression('  0 2 * * *  ')).not.toThrow();
    });

    it('rejects empty string', () => {
        expect(() => validateCronExpression('')).toThrow('must not be empty');
    });

    it('rejects whitespace-only string', () => {
        expect(() => validateCronExpression('   ')).toThrow('must not be empty');
    });

    it('rejects random text', () => {
        expect(() => validateCronExpression('not a cron')).toThrow('Invalid cron expression');
    });

    it('rejects too few fields', () => {
        expect(() => validateCronExpression('0 2')).toThrow('Invalid cron expression');
    });

    it('accepts 6-field expression (with seconds)', () => {
        // node-cron supports an optional seconds field
        expect(() => validateCronExpression('0 0 2 * * *')).not.toThrow();
    });

    it('rejects invalid minute value', () => {
        expect(() => validateCronExpression('60 2 * * *')).toThrow('Invalid cron expression');
    });

    it('rejects invalid hour value', () => {
        expect(() => validateCronExpression('0 25 * * *')).toThrow('Invalid cron expression');
    });

    it('rejects invalid day-of-week value', () => {
        expect(() => validateCronExpression('0 2 * * 8')).toThrow('Invalid cron expression');
    });
});

// ---------------------------------------------------------------------------
// SchedulerService
// ---------------------------------------------------------------------------

describe('SchedulerService', () => {
    let scheduler: SchedulerService;
    let logger: ReturnType<typeof createTestLogger>;

    beforeEach(() => {
        logger = createTestLogger();
        scheduler = new SchedulerService(logger);
    });

    describe('debug mode (immediate execution)', () => {
        it('runs the task immediately and returns immediate=true', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: true,
            };

            const handle = await scheduler.schedule(config, task);

            expect(handle.immediate).toBe(true);
            expect(task).toHaveBeenCalledOnce();
        });

        it('propagates task errors in debug mode', async () => {
            const error = new Error('backup failed');
            const task = vi.fn().mockRejectedValue(error);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: true,
            };

            await expect(scheduler.schedule(config, task)).rejects.toThrow('backup failed');
        });

        it('stop() is a safe no-op in debug mode', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: true,
            };

            const handle = await scheduler.schedule(config, task);
            expect(() => handle.stop()).not.toThrow();
        });
    });

    describe('scheduled mode', () => {
        it('schedules a task and returns immediate=false', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(handle.immediate).toBe(false);
                // Task should NOT have been called yet
                expect(task).not.toHaveBeenCalled();
            } finally {
                handle.stop();
            }
        });

        it('stop() prevents future executions', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);
            handle.stop();

            // After stop, the task should never fire
            expect(task).not.toHaveBeenCalled();
        });

        it('accepts timezone configuration', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: false,
                timezone: 'Europe/Berlin',
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(handle.immediate).toBe(false);
            } finally {
                handle.stop();
            }
        });

        it('throws on invalid cron expression', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: 'not valid',
                debug: false,
            };

            await expect(scheduler.schedule(config, task)).rejects.toThrow('Invalid cron expression');
        });

        it('supports step syntax like */5', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '*/5 * * * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(handle.immediate).toBe(false);
            } finally {
                handle.stop();
            }
        });

        it('supports day-of-month scheduling', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 0 1,15 * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(handle.immediate).toBe(false);
            } finally {
                handle.stop();
            }
        });

        it('logs the schedule registration', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(logger.info).toHaveBeenCalledWith(
                    expect.stringContaining('Task scheduled'),
                );
            } finally {
                handle.stop();
            }
        });

        it('logs the schedule registration with timezone', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: false,
                timezone: 'Europe/Berlin',
            };

            const handle = await scheduler.schedule(config, task);

            try {
                expect(logger.info).toHaveBeenCalledWith(
                    expect.stringContaining('Europe/Berlin'),
                );
            } finally {
                handle.stop();
            }
        });
    });

    describe('error handling', () => {
        it('calls onError callback when the scheduled task throws', async () => {
            const error = new Error('backup failed');
            const task = vi.fn().mockRejectedValue(error);
            const onError = vi.fn();
            const config: SchedulerConfig = {
                cron: '* * * * * *', // every second (6-field with seconds)
                debug: false,
                onError,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                // Wait for the cron tick to fire
                await vi.waitFor(() => {
                    expect(onError).toHaveBeenCalledWith(error);
                }, { timeout: 3000 });

                expect(logger.error).toHaveBeenCalledWith(
                    expect.stringContaining('backup failed'),
                );
            } finally {
                handle.stop();
            }
        });

        it('does not crash when onError is not provided', async () => {
            const task = vi.fn().mockRejectedValue(new Error('boom'));
            const config: SchedulerConfig = {
                cron: '* * * * * *',
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                await vi.waitFor(() => {
                    expect(logger.error).toHaveBeenCalledWith(
                        expect.stringContaining('boom'),
                    );
                }, { timeout: 3000 });
            } finally {
                handle.stop();
            }
        });
    });

    describe('logging', () => {
        it('logs immediately in debug mode', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '0 2 * * *',
                debug: true,
            };

            await scheduler.schedule(config, task);

            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('Debug mode'),
            );
        });

        it('logs a heartbeat on each cron tick', async () => {
            const task = vi.fn().mockResolvedValue(undefined);
            const config: SchedulerConfig = {
                cron: '* * * * * *', // every second
                debug: false,
            };

            const handle = await scheduler.schedule(config, task);

            try {
                await vi.waitFor(() => {
                    expect(logger.info).toHaveBeenCalledWith(
                        expect.stringContaining('Scheduler tick'),
                    );
                }, { timeout: 3000 });
            } finally {
                handle.stop();
            }
        });
    });
});
