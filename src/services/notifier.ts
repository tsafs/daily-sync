/**
 * Notification service — email alerts for backup lifecycle events.
 *
 * Provides a `NotificationService` interface so future channels
 * (ntfy, Gotify, webhooks) can implement the same contract without
 * touching the orchestrator.
 *
 * `EmailNotifier` sends via SMTP using nodemailer.  Transport errors are
 * always swallowed (logged as warnings) so a misconfigured SMTP server
 * can never kill the backup process.
 *
 * Use `createNotifier()` to obtain an instance — it returns a no-op
 * implementation when the config is `null`, so the orchestrator never
 * has to guard against a missing notifier.
 *
 * @module
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { NotificationConfig } from '../config.js';
import type { Logger } from './logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Context supplied when a backup run finishes successfully.
 */
export interface BackupSuccessEvent {
    type: 'success';
    /** Provider name (disk | webdav | ftp) */
    providerName: string;
    /** Backup directory name, e.g. backup_20260326_020000 */
    backupId: string;
    /** Sum of all archive volume sizes in megabytes (rounded to 2 dp) */
    archiveSizeMb: number;
    /** Number of archive volumes uploaded */
    volumeCount: number;
    /** Wall-clock duration of the entire backup run in milliseconds */
    durationMs: number;
}

/**
 * Context supplied when a backup run fails.
 */
export interface BackupFailureEvent {
    type: 'failure';
    /** Provider name (disk | webdav | ftp) */
    providerName: string;
    /** Backup directory name, e.g. backup_20260326_020000 */
    backupId: string;
    /** The error that caused the backup to fail */
    error: Error;
}

/** Discriminated union of all backup lifecycle events. */
export type BackupEvent = BackupSuccessEvent | BackupFailureEvent;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Notification channel contract.
 *
 * Implementations must be non-throwing: internal errors should be
 * handled internally and never propagated to the caller.
 */
export interface NotificationService {
    notify(event: BackupEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// No-op implementation (used when notifications are disabled)
// ---------------------------------------------------------------------------

class NoopNotifier implements NotificationService {
    async notify(_event: BackupEvent): Promise<void> {
        // Intentional no-op
    }
}

// ---------------------------------------------------------------------------
// Email implementation
// ---------------------------------------------------------------------------

/**
 * Formats a human-readable email subject line.
 * e.g. "[daily-sync] Backup FAILED — webdav"
 */
function formatSubject(event: BackupEvent): string {
    const status = event.type === 'success' ? 'OK' : 'FAILED';
    return `[daily-sync] Backup ${status} \u2014 ${event.providerName}`;
}

/**
 * Formats the plain-text email body for a backup event.
 */
function formatBody(event: BackupEvent): string {
    const ts = new Date().toISOString();

    if (event.type === 'failure') {
        return [
            `daily-sync backup FAILED`,
            ``,
            `Provider   : ${event.providerName}`,
            `Backup ID  : ${event.backupId}`,
            `Timestamp  : ${ts}`,
            ``,
            `Error:`,
            event.error.message,
            ...(event.error.stack ? ['', 'Stack trace:', event.error.stack] : []),
        ].join('\n');
    }

    const durationSec = (event.durationMs / 1000).toFixed(1);
    return [
        `daily-sync backup completed successfully`,
        ``,
        `Provider   : ${event.providerName}`,
        `Backup ID  : ${event.backupId}`,
        `Timestamp  : ${ts}`,
        `Volumes    : ${event.volumeCount}`,
        `Total size : ${event.archiveSizeMb.toFixed(2)} MB`,
        `Duration   : ${durationSec} s`,
    ].join('\n');
}

/**
 * Sends backup event notifications via SMTP using nodemailer.
 *
 * Subject format:
 *   "[daily-sync] Backup FAILED — webdav"
 *   "[daily-sync] Backup OK — disk"
 *
 * Transport errors are caught, logged as warnings, and never re-thrown.
 */
export class EmailNotifier implements NotificationService {
    private readonly config: NotificationConfig;
    private readonly log: Logger;
    private readonly transporter: Transporter;

    constructor(config: NotificationConfig, log: Logger) {
        this.config = config;
        this.log = log;
        this.transporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.port === 465, // standard: 465 = implicit TLS, 587 = STARTTLS
            auth: {
                user: config.smtp.user,
                pass: config.smtp.password,
            },
        });
    }

    async notify(event: BackupEvent): Promise<void> {
        // Check whether this event type is enabled
        if (event.type === 'failure' && !this.config.onFailure) return;
        if (event.type === 'success' && !this.config.onSuccess) return;

        const subject = formatSubject(event);
        const text = formatBody(event);

        try {
            await this.transporter.sendMail({
                from: this.config.smtp.from,
                to: this.config.smtp.to.join(', '),
                subject,
                text,
            });
            this.log.info(
                { event: event.type, provider: event.providerName, to: this.config.smtp.to },
                'Notification email sent',
            );
        } catch (err) {
            // Never let a notification error kill the process or surface to the caller
            this.log.warn(
                { err, event: event.type, provider: event.providerName },
                'Failed to send notification email — continuing',
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the appropriate notifier for the given configuration.
 *
 * Returns a {@link NoopNotifier} when `config` is `null` (notifications
 * disabled) so callers never have to null-guard.
 *
 * @param config - Notification config from {@link loadConfig}, or `null`
 * @param log    - Logger for the email notifier
 */
export function createNotifier(
    config: NotificationConfig | null,
    log: Logger,
): NotificationService {
    if (config === null) return new NoopNotifier();
    return new EmailNotifier(config, log);
}
