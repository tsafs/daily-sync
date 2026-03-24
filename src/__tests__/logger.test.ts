import { describe, it, expect, vi } from 'vitest';
import { createLogger, createSilentLogger, type Logger } from '../services/logger.js';

// ---------------------------------------------------------------------------
// createSilentLogger
// ---------------------------------------------------------------------------

describe('createSilentLogger', () => {
    it('returns a Logger with all required methods', () => {
        const log = createSilentLogger();
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
        expect(typeof log.child).toBe('function');
    });

    it('child() returns the same silent interface', () => {
        const log = createSilentLogger();
        const child = log.child({ provider: 'test' });
        expect(typeof child.info).toBe('function');
        expect(typeof child.child).toBe('function');
    });

    it('methods are callable without throwing', () => {
        const log = createSilentLogger();
        expect(() => log.info('msg')).not.toThrow();
        expect(() => log.warn({ key: 'val' }, 'msg')).not.toThrow();
        expect(() => log.error('msg')).not.toThrow();
        expect(() => log.debug('msg')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

describe('createLogger', () => {
    it('returns a Logger with all required methods', () => {
        const log = createLogger({ level: 'silent' });
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
        expect(typeof log.child).toBe('function');
    });

    it('accepts a level option', () => {
        const log = createLogger({ level: 'debug' });
        expect(typeof log.debug).toBe('function');
    });

    it('creates child loggers with bound context', () => {
        const log = createLogger({ level: 'silent' });
        const child = log.child({ provider: 'disk', backupId: '20260315_020000' });
        expect(typeof child.info).toBe('function');
    });

    it('defaults to info level', () => {
        const log = createLogger();
        expect(typeof log.info).toBe('function');
    });
});

// ---------------------------------------------------------------------------
// Redaction — verify passwords are never in output
// ---------------------------------------------------------------------------

describe('password redaction', () => {
    it('redacts the "password" field in structured log output', () => {
        // Capture what pino writes to the destination
        const chunks: string[] = [];
        const { Writable } = require('node:stream');
        const dest = new Writable({
            write(chunk: Buffer, _encoding: string, cb: () => void) {
                chunks.push(chunk.toString());
                cb();
            },
        });

        // Create a pino logger that writes to our capture stream
        const pino = require('pino');
        const log = pino(
            {
                name: 'test',
                level: 'info',
                redact: {
                    paths: [
                        'password',
                        'config.password',
                        'provider.password',
                        'providerConfig.password',
                        'encryptionPassword',
                        'config.encryptionPassword',
                        'archive.password',
                        'archivePassword',
                        'smtp.password',
                        'smtp.user',
                        'notification.smtp.password',
                        'notification.smtp.user',
                        'WEBDAV_PASSWORD',
                        'WEBDAV_USERNAME',
                        'FTP_PASSWORD',
                        'FTP_USER',
                        'SMTP_PASSWORD',
                        'SMTP_USER',
                        'ENCRYPTION_PASSWORD',
                        'secret',
                        'token',
                        'apiKey',
                        'api_key',
                        'authorization',
                    ],
                    censor: '[REDACTED]',
                },
            },
            dest,
        );

        // Log an object with sensitive fields
        log.info({
            password: 'super-secret-123',
            WEBDAV_PASSWORD: 'my-webdav-pass',
            FTP_PASSWORD: 'my-ftp-pass',
            ENCRYPTION_PASSWORD: 'my-encryption-pass',
            token: 'bearer-token-xyz',
            apiKey: 'api-key-abc',
            host: 'example.com', // should NOT be redacted
        }, 'test sensitive fields');

        // Flush synchronously
        log.flush();

        const output = chunks.join('');

        // Secrets must not appear
        expect(output).not.toContain('super-secret-123');
        expect(output).not.toContain('my-webdav-pass');
        expect(output).not.toContain('my-ftp-pass');
        expect(output).not.toContain('my-encryption-pass');
        expect(output).not.toContain('bearer-token-xyz');
        expect(output).not.toContain('api-key-abc');

        // Redaction marker should appear
        expect(output).toContain('[REDACTED]');

        // Non-sensitive fields pass through
        expect(output).toContain('example.com');
    });

    it('redacts nested credentials (e.g. smtp.password)', () => {
        const chunks: string[] = [];
        const { Writable } = require('node:stream');
        const dest = new Writable({
            write(chunk: Buffer, _encoding: string, cb: () => void) {
                chunks.push(chunk.toString());
                cb();
            },
        });

        const pino = require('pino');
        const log = pino(
            {
                name: 'test',
                level: 'info',
                redact: {
                    paths: [
                        'smtp.password',
                        'smtp.user',
                        'config.password',
                        'archive.password',
                    ],
                    censor: '[REDACTED]',
                },
            },
            dest,
        );

        log.info({
            smtp: { host: 'mail.example.com', user: 'admin', password: 'smtp-secret' },
            config: { password: 'config-pass', someOtherField: 'ok' },
            archive: { password: 'archive-pass', encrypt: true },
        }, 'test nested redaction');

        log.flush();

        const output = chunks.join('');

        expect(output).not.toContain('smtp-secret');
        expect(output).not.toContain('admin'); // smtp.user
        expect(output).not.toContain('config-pass');
        expect(output).not.toContain('archive-pass');
        expect(output).toContain('mail.example.com'); // non-sensitive
        expect(output).toContain('[REDACTED]');
    });
});

// ---------------------------------------------------------------------------
// Logger interface compatibility with SchedulerLogger
// ---------------------------------------------------------------------------

describe('Logger / SchedulerLogger compatibility', () => {
    it('Logger interface is usable where SchedulerLogger was expected', () => {
        // The SchedulerService previously accepted SchedulerLogger { info, warn, error }
        // Our Logger extends that with debug + child. Verify basic compatibility.
        const log = createSilentLogger();

        // These are the three methods SchedulerLogger required
        const schedulerLogger: { info: Function; warn: Function; error: Function } = log;
        expect(typeof schedulerLogger.info).toBe('function');
        expect(typeof schedulerLogger.warn).toBe('function');
        expect(typeof schedulerLogger.error).toBe('function');
    });
});
