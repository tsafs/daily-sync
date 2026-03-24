import cron from 'node-cron';
import { type Logger, createSilentLogger } from './logger.js';

// ---------------------------------------------------------------------------
// Backward-compatible alias
// ---------------------------------------------------------------------------

/**
 * @deprecated Use {@link Logger} from './logger.js' directly.
 * Kept for backward compatibility with existing consumers.
 */
export type SchedulerLogger = Logger;

/**
 * Scheduler configuration.
 */
export interface SchedulerConfig {
    /**
     * Standard 5-field cron expression: "MIN HOUR DOM MON DOW"
     *
     * Examples:
     * - "0 2 * * *"     → daily at 2:00 AM
     * - "30 14 * * 1-5" → weekdays at 2:30 PM
     * - "0 3 * * 1,3,5" → Mon/Wed/Fri at 3:00 AM
     * - "0 0 1 * *"     → 1st of every month at midnight
     *
     * @default "0 2 * * *"
     */
    cron: string;

    /**
     * When true, run the task immediately and do not schedule.
     * The caller is responsible for exiting after the task completes.
     * @default false
     */
    debug: boolean;

    /**
     * IANA timezone for cron evaluation (e.g. "Europe/Berlin").
     * If undefined, uses the system/container timezone.
     */
    timezone?: string;

    /**
     * Optional callback invoked when the scheduled task throws.
     * The error is always logged; this callback allows the caller
     * to react (e.g. send a notification) without crashing the process.
     */
    onError?: (error: unknown) => void;
}

/**
 * Result of scheduling — either immediate execution or a scheduled task.
 */
export interface ScheduleHandle {
    /**
     * Whether the task was run immediately (debug mode) vs. scheduled.
     */
    immediate: boolean;

    /**
     * Stop the scheduled cron job. No-op if immediate mode.
     */
    stop(): void;
}

/**
 * Validate a 5-field cron expression using node-cron's built-in validator.
 *
 * @param expression - A standard 5-field cron expression
 * @throws Error if the expression is invalid
 */
export function validateCronExpression(expression: string): void {
    const trimmed = expression.trim();

    if (!trimmed) {
        throw new Error('Cron expression must not be empty.');
    }

    if (!cron.validate(trimmed)) {
        throw new Error(
            `Invalid cron expression: "${expression}". Expected a 5-field cron expression (e.g. "0 2 * * *").`,
        );
    }
}

/**
 * Scheduler service that wraps node-cron.
 *
 * Accepts a standard 5-field cron expression and schedules a task.
 * In debug mode, the task is executed immediately without scheduling.
 */
export class SchedulerService {
    private readonly logger: Logger;

    constructor(logger?: Logger) {
        this.logger = (logger ?? createSilentLogger()).child({ service: 'scheduler' });
    }

    /**
     * Schedule a task to run on the configured cron schedule, or run it
     * immediately if debug mode is enabled.
     *
     * @param config - Scheduler configuration
     * @param task - Async function to execute on each tick
     * @returns A handle to stop the scheduled task
     */
    async schedule(
        config: SchedulerConfig,
        task: () => Promise<void>,
    ): Promise<ScheduleHandle> {
        if (config.debug) {
            // Debug mode: run immediately, no scheduling
            this.logger.info('Debug mode: running task immediately');
            await task();
            return {
                immediate: true,
                stop() {
                    // no-op
                },
            };
        }

        const expression = config.cron.trim();
        validateCronExpression(expression);

        const options: cron.ScheduleOptions = {
            scheduled: true,
        };

        if (config.timezone) {
            options.timezone = config.timezone;
        }

        // Track whether a task is currently running to prevent overlap
        let running = false;

        const scheduledTask = cron.schedule(
            expression,
            async () => {
                // Heartbeat: log on every tick so operators can confirm the process is alive
                this.logger.info(`Scheduler tick — cron "${expression}"`);

                if (running) {
                    this.logger.warn('Skipping scheduled tick — previous task still running');
                    return;
                }
                running = true;
                try {
                    await task();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger.error(`Scheduled task failed: ${message}`);
                    config.onError?.(error);
                } finally {
                    running = false;
                }
            },
            options,
        );

        this.logger.info(`Task scheduled — cron "${expression}"${config.timezone ? ` (${config.timezone})` : ''}`);

        return {
            immediate: false,
            stop() {
                scheduledTask.stop();
            },
        };
    }
}
