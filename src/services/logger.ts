import pino from 'pino';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal logger interface used across the entire application.
 *
 * Mirrors a subset of pino's API so any component can accept this
 * interface without depending on pino directly. Also compatible
 * with the existing {@link SchedulerLogger} interface.
 */
export interface Logger {
    info(msg: string): void;
    info(obj: Record<string, unknown>, msg: string): void;
    warn(msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
    error(msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
    debug(msg: string): void;
    debug(obj: Record<string, unknown>, msg: string): void;
    /** Create a child logger with additional bound context fields. */
    child(bindings: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Paths to redact in structured log output.
 * These cover both top-level fields and nested objects that may
 * contain secrets (e.g. provider configs, SMTP settings).
 *
 * Pino's redaction uses fast-redact under the hood — the paths are
 * compiled into a getter/setter pair at logger creation time,
 * so there is zero per-log overhead.
 */
const REDACT_PATHS: string[] = [
    // Provider credentials
    'password',
    'config.password',
    'provider.password',
    'providerConfig.password',

    // Encryption
    'encryptionPassword',
    'config.encryptionPassword',
    'archive.password',
    'archivePassword',

    // SMTP
    'smtp.password',
    'smtp.user',
    'notification.smtp.password',
    'notification.smtp.user',

    // WebDAV
    'WEBDAV_PASSWORD',
    'WEBDAV_USERNAME',

    // FTP
    'FTP_PASSWORD',
    'FTP_USER',

    // SMTP env vars
    'SMTP_PASSWORD',
    'SMTP_USER',

    // Generic credential field names
    'ENCRYPTION_PASSWORD',
    'secret',
    'token',
    'apiKey',
    'api_key',
    'authorization',
];

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateLoggerOptions {
    /** Log level (default: 'info') */
    level?: string;
    /** Human-readable output instead of JSON (for local dev, default: false) */
    pretty?: boolean;
}

/**
 * Create the root application logger.
 *
 * Outputs structured JSON to stdout (Docker-friendly).
 * All sensitive fields listed in {@link REDACT_PATHS} are replaced
 * with `[REDACTED]` before serialisation — passwords and API keys
 * never appear in log output.
 *
 * @example
 * ```ts
 * const log = createLogger({ level: 'debug' });
 * const childLog = log.child({ provider: 'webdav', backupId: '20260315_020000' });
 * childLog.info('Upload complete');
 * // → {"level":30,"time":...,"provider":"webdav","backupId":"20260315_020000","msg":"Upload complete"}
 * ```
 */
export function createLogger(opts: CreateLoggerOptions = {}): Logger {
    const transport = opts.pretty
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined;

    const logger = pino({
        name: 'daily-sync',
        level: opts.level ?? 'info',
        redact: {
            paths: REDACT_PATHS,
            censor: '[REDACTED]',
        },
        ...(transport ? { transport } : {}),
    });

    return logger as unknown as Logger;
}

/**
 * Create a silent logger (for tests).
 * Implements the {@link Logger} interface with no-ops.
 */
export function createSilentLogger(): Logger {
    const noop = () => { };
    const silent: Logger = {
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        child: () => silent,
    };
    return silent;
}
