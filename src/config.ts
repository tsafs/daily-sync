import Joi from 'joi';
import cron from 'node-cron';
import type {
    AnyProviderConfig,
    DiskProviderConfig,
    WebDavProviderConfig,
    FtpProviderConfig,
} from './providers/provider.js';
import type { GfsConfig } from './services/retention.js';
import type { Logger } from './services/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Valid sync modes. */
export type SyncMode = 'disk' | 'webdav' | 'ftp';

/**
 * Archive-related configuration.
 * Maps directly to {@link import('./services/archiver.js').ArchiveOptions}.
 */
export interface ArchiveConfig {
    /** Absolute path to the source data directory (always /data) */
    sourceDir: string;
    /** Whether to encrypt archives with AES-256 */
    encrypt: boolean;
    /** Archive encryption password (required when encrypt is true) */
    password?: string;
    /** Multi-volume chunk size in MB (0 = no splitting) */
    chunkSizeMb: number;
}

/**
 * SMTP configuration for email notifications.
 */
export interface SmtpConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
    /** Recipient email addresses */
    to: string[];
}

/**
 * Notification configuration.
 */
export interface NotificationConfig {
    /** Send email on backup failure */
    onFailure: boolean;
    /** Send email on backup success */
    onSuccess: boolean;
    /** SMTP connection settings */
    smtp: SmtpConfig;
}

/**
 * Complete application configuration loaded from environment variables.
 *
 * Consumed by the orchestrator (index.ts), which passes sub-configs
 * to individual services:
 * - `provider`      → BackupProvider constructor
 * - `archive`       → ArchiverService.createArchive()
 * - `retention`     → RetentionService constructor
 * - `cron`, `timezone`, `debug` → SchedulerService.schedule()
 * - `notification`  → NotifierService (step 14)
 */
export interface AppConfig {
    /** Resolved sync mode */
    syncMode: SyncMode;
    /** Provider-specific configuration (discriminated by `name`) */
    provider: AnyProviderConfig;
    /** Archive creation settings */
    archive: ArchiveConfig;
    /** GFS retention policy */
    retention: GfsConfig;
    /** 5-field cron expression */
    cron: string;
    /** IANA timezone for cron evaluation (e.g. "Europe/Berlin") */
    timezone?: string;
    /** Debug mode: run backup immediately and exit */
    debug: boolean;
    /** Email notification settings (null if not configured) */
    notification: NotificationConfig | null;
}

// ---------------------------------------------------------------------------
// Joi helpers
// ---------------------------------------------------------------------------

/** Boolean field that accepts 1/0/yes/no in addition to true/false. */
const boolField = () =>
    Joi.boolean().truthy('1', 'yes').falsy('0', 'no');

/** Port number between 1–65535. */
const portField = () =>
    Joi.number().integer().min(1).max(65535);

/** IANA timezone names known to this runtime. */
const validTimezones = new Set(Intl.supportedValuesOf('timeZone'));

// ---------------------------------------------------------------------------
// Joi schema
// ---------------------------------------------------------------------------

/**
 * Schema for all environment variables consumed by daily-sync.
 *
 * Conditional requirements use `.when()` so mode-specific vars are only
 * required for their respective mode, and ENCRYPTION_PASSWORD is only
 * required when USE_ENCRYPTION is true.
 */
const envSchema = Joi.object({
    // --- Core ---
    SYNC_MODE: Joi.string()
        .valid('disk', 'webdav', 'ftp')
        .insensitive()
        .default('webdav'),

    // --- WebDAV ---
    WEBDAV_URL: Joi.string().when('SYNC_MODE', {
        is: 'webdav',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    WEBDAV_USERNAME: Joi.string().when('SYNC_MODE', {
        is: 'webdav',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    WEBDAV_PASSWORD: Joi.string().when('SYNC_MODE', {
        is: 'webdav',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    WEBDAV_TARGET_DIR: Joi.string().default('/data'),

    // --- FTP ---
    FTP_HOST: Joi.string().when('SYNC_MODE', {
        is: 'ftp',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    FTP_USER: Joi.string().when('SYNC_MODE', {
        is: 'ftp',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    FTP_PASSWORD: Joi.string().when('SYNC_MODE', {
        is: 'ftp',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    FTP_TARGET_DIR: Joi.string().default('/'),
    FTP_TLS: boolField().default(true),
    FTP_PORT: portField().default(21),

    // --- Archive ---
    USE_ENCRYPTION: boolField().default(true),
    ENCRYPTION_PASSWORD: Joi.string().when('USE_ENCRYPTION', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    CHUNK_SIZE_MB: Joi.number().integer().min(0).default(0),

    // --- Retention (GFS) ---
    RETAIN_DAILY: Joi.number().integer().min(1).default(7),
    RETAIN_WEEKLY: Joi.number().integer().min(0).default(4),
    RETAIN_MONTHLY: Joi.number().integer().min(0).default(6),

    // --- Scheduling ---
    CRON_SCHEDULE: Joi.string().default('0 2 * * *').custom((value, helpers) => {
        if (!cron.validate(value)) {
            return helpers.error('any.invalid');
        }
        return value;
    }, 'cron expression'),
    DEBUG: boolField().default(false),
    TIMEZONE: Joi.string().optional().custom((value, helpers) => {
        if (!validTimezones.has(value)) {
            return helpers.error('any.invalid');
        }
        return value;
    }, 'IANA timezone'),

    // --- Notifications ---
    NOTIFY_ON_FAILURE: boolField().default(true),
    NOTIFY_ON_SUCCESS: boolField().default(false),
    SMTP_HOST: Joi.string().optional(),
    SMTP_PORT: portField().default(587),
    SMTP_USER: Joi.string().optional(),
    SMTP_PASSWORD: Joi.string().optional(),
    SMTP_FROM: Joi.string().optional(),
    SMTP_TO: Joi.string().optional(),
})
    .and('SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_TO')
    .options({ allowUnknown: true, abortEarly: false });

// ---------------------------------------------------------------------------
// Validated env → domain types
// ---------------------------------------------------------------------------

/** Shape of the validated (coerced) environment object coming out of Joi. */
interface ValidatedEnv {
    SYNC_MODE: SyncMode;
    WEBDAV_URL?: string;
    WEBDAV_USERNAME?: string;
    WEBDAV_PASSWORD?: string;
    WEBDAV_TARGET_DIR: string;
    FTP_HOST?: string;
    FTP_USER?: string;
    FTP_PASSWORD?: string;
    FTP_TARGET_DIR: string;
    FTP_TLS: boolean;
    FTP_PORT: number;
    USE_ENCRYPTION: boolean;
    ENCRYPTION_PASSWORD?: string;
    CHUNK_SIZE_MB: number;
    RETAIN_DAILY: number;
    RETAIN_WEEKLY: number;
    RETAIN_MONTHLY: number;
    CRON_SCHEDULE: string;
    DEBUG: boolean;
    TIMEZONE?: string;
    NOTIFY_ON_FAILURE: boolean;
    NOTIFY_ON_SUCCESS: boolean;
    SMTP_HOST?: string;
    SMTP_PORT: number;
    SMTP_USER?: string;
    SMTP_PASSWORD?: string;
    SMTP_FROM?: string;
    SMTP_TO?: string;
}

function buildProviderConfig(v: ValidatedEnv): AnyProviderConfig {
    switch (v.SYNC_MODE) {
        case 'disk':
            return {
                name: 'disk',
                targetDir: '/target',
            } satisfies DiskProviderConfig;
        case 'webdav':
            return {
                name: 'webdav',
                url: v.WEBDAV_URL!,
                username: v.WEBDAV_USERNAME!,
                password: v.WEBDAV_PASSWORD!,
                targetDir: v.WEBDAV_TARGET_DIR,
            } satisfies WebDavProviderConfig;
        case 'ftp':
            return {
                name: 'ftp',
                host: v.FTP_HOST!,
                port: v.FTP_PORT,
                username: v.FTP_USER!,
                password: v.FTP_PASSWORD!,
                targetDir: v.FTP_TARGET_DIR,
                tls: v.FTP_TLS,
            } satisfies FtpProviderConfig;
    }
}

function buildNotificationConfig(v: ValidatedEnv): NotificationConfig | null {
    // If neither trigger is enabled, skip
    if (!v.NOTIFY_ON_FAILURE && !v.NOTIFY_ON_SUCCESS) return null;

    // If no SMTP is configured, silently disable notifications
    if (!v.SMTP_HOST) return null;

    // `.and()` on the schema guarantees all SMTP fields are present
    const to = v.SMTP_TO!
        .split(',')
        .map((addr) => addr.trim())
        .filter((addr) => addr.length > 0);

    return {
        onFailure: v.NOTIFY_ON_FAILURE,
        onSuccess: v.NOTIFY_ON_SUCCESS,
        smtp: {
            host: v.SMTP_HOST,
            port: v.SMTP_PORT,
            user: v.SMTP_USER!,
            password: v.SMTP_PASSWORD!,
            from: v.SMTP_FROM!,
            to,
        },
    };
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Strip empty strings from env values so Joi treats them as absent.
 * Environment variables that are set to "" should behave as if unset.
 */
function cleanEnv(
    env: Record<string, string | undefined>,
): Record<string, string | undefined> {
    const cleaned: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
        cleaned[key] = value === '' ? undefined : value;
    }
    return cleaned;
}

/**
 * Format Joi validation errors into a readable multi-line string.
 */
function formatErrors(error: Joi.ValidationError): string {
    const details = error.details.map((d) => `  - ${d.message}`);
    const header = `Configuration error${details.length > 1 ? 's' : ''}:`;
    return `${header}\n${details.join('\n')}`;
}

/**
 * Load and validate the application configuration from environment variables.
 *
 * All validation errors are collected and reported in a single throw
 * (`abortEarly: false`), so the user can fix every issue in one pass.
 *
 * @param env - Environment variable source (defaults to `process.env`).
 *              Accepts an explicit record for testability.
 * @returns Fully validated `AppConfig`
 * @throws Error with all validation issues listed
 */
export function loadConfig(
    env: Record<string, string | undefined> = process.env,
    logger?: Logger,
): AppConfig {
    const { error, value } = envSchema.validate(cleanEnv(env));

    if (error) {
        throw new Error(formatErrors(error));
    }

    const v = value as ValidatedEnv;

    const config: AppConfig = {
        syncMode: v.SYNC_MODE,
        provider: buildProviderConfig(v),
        archive: {
            sourceDir: '/data',
            encrypt: v.USE_ENCRYPTION,
            password: v.ENCRYPTION_PASSWORD,
            chunkSizeMb: v.CHUNK_SIZE_MB,
        },
        retention: {
            daily: v.RETAIN_DAILY,
            weekly: v.RETAIN_WEEKLY,
            monthly: v.RETAIN_MONTHLY,
        },
        cron: v.CRON_SCHEDULE,
        timezone: v.TIMEZONE,
        debug: v.DEBUG,
        notification: buildNotificationConfig(v),
    };

    if (logger) {
        logger.info(
            {
                syncMode: config.syncMode,
                cron: config.cron,
                timezone: config.timezone ?? 'system',
                debug: config.debug,
                encryption: config.archive.encrypt,
                chunkSizeMb: config.archive.chunkSizeMb,
                retention: config.retention,
                notifications: config.notification
                    ? { onFailure: config.notification.onFailure, onSuccess: config.notification.onSuccess }
                    : 'disabled',
            },
            'Configuration loaded',
        );
    }

    return config;
}
