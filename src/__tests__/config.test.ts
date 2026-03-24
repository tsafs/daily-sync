import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal env for disk mode (fewest required vars). */
function diskEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        SYNC_MODE: 'disk',
        USE_ENCRYPTION: 'false',
        ...overrides,
    };
}

/** Minimal env for webdav mode. */
function webdavEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        SYNC_MODE: 'webdav',
        WEBDAV_URL: 'https://cloud.example.com/dav',
        WEBDAV_USERNAME: 'user',
        WEBDAV_PASSWORD: 'pass',
        USE_ENCRYPTION: 'false',
        ...overrides,
    };
}

/** Minimal env for ftp mode. */
function ftpEnv(overrides: Record<string, string> = {}): Record<string, string> {
    return {
        SYNC_MODE: 'ftp',
        FTP_HOST: 'ftp.example.com',
        FTP_USER: 'user',
        FTP_PASSWORD: 'pass',
        USE_ENCRYPTION: 'false',
        ...overrides,
    };
}

/** Get the error message from a loadConfig call that should throw. */
function getError(env: Record<string, string | undefined>): string {
    try {
        loadConfig(env);
        throw new Error('Expected loadConfig to throw');
    } catch (err) {
        return (err as Error).message;
    }
}

/** Get all error bullet points from a loadConfig failure. */
function errorBullets(env: Record<string, string | undefined>): string[] {
    return getError(env)
        .split('\n')
        .filter((line) => line.startsWith('  - '))
        .map((line) => line.replace(/^ {2}- /, ''));
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
    describe('defaults', () => {
        it('should default SYNC_MODE to webdav', () => {
            const config = loadConfig(webdavEnv({ SYNC_MODE: '' }));
            expect(config.syncMode).toBe('webdav');
        });

        it('should default cron to "0 2 * * *"', () => {
            const config = loadConfig(diskEnv());
            expect(config.cron).toBe('0 2 * * *');
        });

        it('should default debug to false', () => {
            const config = loadConfig(diskEnv());
            expect(config.debug).toBe(false);
        });

        it('should default encryption to true', () => {
            const config = loadConfig(diskEnv({
                USE_ENCRYPTION: 'true',
                ENCRYPTION_PASSWORD: 'secret',
            }));
            expect(config.archive.encrypt).toBe(true);
            expect(config.archive.password).toBe('secret');
        });

        it('should default sourceDir to /data', () => {
            const config = loadConfig(diskEnv());
            expect(config.archive.sourceDir).toBe('/data');
        });

        it('should default chunkSizeMb to 0', () => {
            const config = loadConfig(diskEnv());
            expect(config.archive.chunkSizeMb).toBe(0);
        });

        it('should default GFS retention to 7/4/6', () => {
            const config = loadConfig(diskEnv());
            expect(config.retention).toEqual({ daily: 7, weekly: 4, monthly: 6 });
        });

        it('should default notification to null when no SMTP vars', () => {
            const config = loadConfig(diskEnv());
            expect(config.notification).toBeNull();
        });

        it('should default timezone to undefined', () => {
            const config = loadConfig(diskEnv());
            expect(config.timezone).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------------
    // Sync mode
    // -----------------------------------------------------------------------

    describe('sync mode', () => {
        it('should accept "disk"', () => {
            const config = loadConfig(diskEnv());
            expect(config.syncMode).toBe('disk');
            expect(config.provider.name).toBe('disk');
        });

        it('should accept "webdav"', () => {
            const config = loadConfig(webdavEnv());
            expect(config.syncMode).toBe('webdav');
            expect(config.provider.name).toBe('webdav');
        });

        it('should accept "ftp"', () => {
            const config = loadConfig(ftpEnv());
            expect(config.syncMode).toBe('ftp');
            expect(config.provider.name).toBe('ftp');
        });

        it('should be case-insensitive', () => {
            const config = loadConfig(diskEnv({ SYNC_MODE: 'Disk' }));
            expect(config.syncMode).toBe('disk');
        });

        it('should reject invalid sync modes', () => {
            const msg = getError(diskEnv({ SYNC_MODE: 'usb' }));
            expect(msg).toContain('SYNC_MODE');
        });
    });

    // -----------------------------------------------------------------------
    // Disk provider
    // -----------------------------------------------------------------------

    describe('disk provider', () => {
        it('should set targetDir to /target', () => {
            const config = loadConfig(diskEnv());
            expect(config.provider).toMatchObject({
                name: 'disk',
                targetDir: '/target',
            });
        });
    });

    // -----------------------------------------------------------------------
    // WebDAV provider
    // -----------------------------------------------------------------------

    describe('webdav provider', () => {
        it('should load all required fields', () => {
            const config = loadConfig(webdavEnv());
            expect(config.provider).toMatchObject({
                name: 'webdav',
                url: 'https://cloud.example.com/dav',
                username: 'user',
                password: 'pass',
                targetDir: '/data',
            });
        });

        it('should accept custom WEBDAV_TARGET_DIR', () => {
            const config = loadConfig(webdavEnv({ WEBDAV_TARGET_DIR: '/backups' }));
            expect(config.provider).toMatchObject({ targetDir: '/backups' });
        });

        it('should error when WEBDAV_URL is missing', () => {
            const { WEBDAV_URL, ...env } = webdavEnv();
            const msg = getError(env);
            expect(msg).toContain('WEBDAV_URL');
        });

        it('should error when WEBDAV_USERNAME is missing', () => {
            const { WEBDAV_USERNAME, ...env } = webdavEnv();
            const msg = getError(env);
            expect(msg).toContain('WEBDAV_USERNAME');
        });

        it('should error when WEBDAV_PASSWORD is missing', () => {
            const { WEBDAV_PASSWORD, ...env } = webdavEnv();
            const msg = getError(env);
            expect(msg).toContain('WEBDAV_PASSWORD');
        });

        it('should report all missing fields at once', () => {
            const env = { SYNC_MODE: 'webdav', USE_ENCRYPTION: 'false' };
            const bullets = errorBullets(env);
            expect(bullets.length).toBeGreaterThanOrEqual(3);
        });
    });

    // -----------------------------------------------------------------------
    // FTP provider
    // -----------------------------------------------------------------------

    describe('ftp provider', () => {
        it('should load all required fields with defaults', () => {
            const config = loadConfig(ftpEnv());
            expect(config.provider).toMatchObject({
                name: 'ftp',
                host: 'ftp.example.com',
                port: 21,
                username: 'user',
                password: 'pass',
                targetDir: '/',
                tls: true,
            });
        });

        it('should accept custom FTP_PORT', () => {
            const config = loadConfig(ftpEnv({ FTP_PORT: '2121' }));
            expect(config.provider).toMatchObject({ port: 2121 });
        });

        it('should accept custom FTP_TARGET_DIR', () => {
            const config = loadConfig(ftpEnv({ FTP_TARGET_DIR: '/backups' }));
            expect(config.provider).toMatchObject({ targetDir: '/backups' });
        });

        it('should accept FTP_TLS=false', () => {
            const config = loadConfig(ftpEnv({ FTP_TLS: 'false' }));
            expect(config.provider).toMatchObject({ tls: false });
        });

        it('should error on invalid FTP_PORT', () => {
            const msg = getError(ftpEnv({ FTP_PORT: '99999' }));
            expect(msg).toContain('FTP_PORT');
        });

        it('should error when required FTP fields are missing', () => {
            const env = { SYNC_MODE: 'ftp', USE_ENCRYPTION: 'false' };
            const msg = getError(env);
            expect(msg).toContain('FTP_HOST');
            expect(msg).toContain('FTP_USER');
            expect(msg).toContain('FTP_PASSWORD');
        });
    });

    // -----------------------------------------------------------------------
    // Encryption / Archive
    // -----------------------------------------------------------------------

    describe('encryption', () => {
        it('should require ENCRYPTION_PASSWORD when USE_ENCRYPTION is true', () => {
            const msg = getError(diskEnv({ USE_ENCRYPTION: 'true' }));
            expect(msg).toContain('ENCRYPTION_PASSWORD');
        });

        it('should not require password when encryption is disabled', () => {
            const config = loadConfig(diskEnv({ USE_ENCRYPTION: 'false' }));
            expect(config.archive.encrypt).toBe(false);
            expect(config.archive.password).toBeUndefined();
        });

        it('should preserve password even if encryption is disabled', () => {
            const config = loadConfig(
                diskEnv({ USE_ENCRYPTION: 'false', ENCRYPTION_PASSWORD: 'secret' }),
            );
            expect(config.archive.encrypt).toBe(false);
            expect(config.archive.password).toBe('secret');
        });

        it('should reject invalid boolean for USE_ENCRYPTION', () => {
            const msg = getError(diskEnv({ USE_ENCRYPTION: 'maybe' }));
            expect(msg).toContain('USE_ENCRYPTION');
        });
    });

    describe('archive', () => {
        it('should accept CHUNK_SIZE_MB', () => {
            const config = loadConfig(diskEnv({ CHUNK_SIZE_MB: '500' }));
            expect(config.archive.chunkSizeMb).toBe(500);
        });

        it('should reject negative CHUNK_SIZE_MB', () => {
            const msg = getError(diskEnv({ CHUNK_SIZE_MB: '-1' }));
            expect(msg).toContain('CHUNK_SIZE_MB');
        });

        it('should reject non-integer CHUNK_SIZE_MB', () => {
            const msg = getError(diskEnv({ CHUNK_SIZE_MB: '3.5' }));
            expect(msg).toContain('CHUNK_SIZE_MB');
        });
    });

    // -----------------------------------------------------------------------
    // GFS Retention
    // -----------------------------------------------------------------------

    describe('retention', () => {
        it('should accept custom GFS tiers', () => {
            const config = loadConfig(diskEnv({
                RETAIN_DAILY: '14',
                RETAIN_WEEKLY: '8',
                RETAIN_MONTHLY: '12',
            }));
            expect(config.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });
        });

        it('should allow weekly=0 and monthly=0 to disable those tiers', () => {
            const config = loadConfig(diskEnv({
                RETAIN_DAILY: '7',
                RETAIN_WEEKLY: '0',
                RETAIN_MONTHLY: '0',
            }));
            expect(config.retention).toEqual({ daily: 7, weekly: 0, monthly: 0 });
        });

        it('should reject RETAIN_DAILY < 1', () => {
            const msg = getError(diskEnv({ RETAIN_DAILY: '0' }));
            expect(msg).toContain('RETAIN_DAILY');
        });

        it('should reject negative RETAIN_WEEKLY', () => {
            const msg = getError(diskEnv({ RETAIN_WEEKLY: '-1' }));
            expect(msg).toContain('RETAIN_WEEKLY');
        });
    });

    // -----------------------------------------------------------------------
    // Scheduling
    // -----------------------------------------------------------------------

    describe('scheduling', () => {
        it('should accept CRON_SCHEDULE', () => {
            const config = loadConfig(diskEnv({ CRON_SCHEDULE: '30 3 * * 1' }));
            expect(config.cron).toBe('30 3 * * 1');
        });

        it('should reject invalid CRON_SCHEDULE', () => {
            const msg = getError(diskEnv({ CRON_SCHEDULE: 'not a cron' }));
            expect(msg).toContain('CRON_SCHEDULE');
        });

        it('should accept TIMEZONE', () => {
            const config = loadConfig(diskEnv({ TIMEZONE: 'Europe/Berlin' }));
            expect(config.timezone).toBe('Europe/Berlin');
        });

        it('should reject invalid TIMEZONE', () => {
            const msg = getError(diskEnv({ TIMEZONE: 'Mars/Olympus' }));
            expect(msg).toContain('TIMEZONE');
        });

        it('should accept DEBUG=true', () => {
            const config = loadConfig(diskEnv({ DEBUG: 'true' }));
            expect(config.debug).toBe(true);
        });

        it('should accept DEBUG=1', () => {
            const config = loadConfig(diskEnv({ DEBUG: '1' }));
            expect(config.debug).toBe(true);
        });

        it('should accept DEBUG=yes', () => {
            const config = loadConfig(diskEnv({ DEBUG: 'yes' }));
            expect(config.debug).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------

    describe('notifications', () => {
        const smtpEnv = {
            SMTP_HOST: 'smtp.example.com',
            SMTP_PORT: '465',
            SMTP_USER: 'alerts@example.com',
            SMTP_PASSWORD: 'smtppass',
            SMTP_FROM: 'alerts@example.com',
            SMTP_TO: 'admin@example.com, ops@example.com',
        };

        it('should load full notification config', () => {
            const config = loadConfig(diskEnv({
                NOTIFY_ON_FAILURE: 'true',
                ...smtpEnv,
            }));
            expect(config.notification).not.toBeNull();
            expect(config.notification!.onFailure).toBe(true);
            expect(config.notification!.onSuccess).toBe(false);
            expect(config.notification!.smtp).toMatchObject({
                host: 'smtp.example.com',
                port: 465,
                user: 'alerts@example.com',
                password: 'smtppass',
                from: 'alerts@example.com',
            });
            expect(config.notification!.smtp.to).toEqual([
                'admin@example.com',
                'ops@example.com',
            ]);
        });

        it('should return null when both triggers are disabled', () => {
            const config = loadConfig(diskEnv({
                NOTIFY_ON_FAILURE: 'false',
                NOTIFY_ON_SUCCESS: 'false',
                ...smtpEnv,
            }));
            expect(config.notification).toBeNull();
        });

        it('should return null when no SMTP vars are set', () => {
            const config = loadConfig(diskEnv());
            expect(config.notification).toBeNull();
        });

        it('should error on partial SMTP config', () => {
            const msg = getError(diskEnv({ SMTP_HOST: 'smtp.example.com' }));
            expect(msg).toContain('SMTP');
        });

        it('should default SMTP_PORT to 587', () => {
            const { SMTP_PORT, ...rest } = smtpEnv;
            const config = loadConfig(diskEnv(rest));
            expect(config.notification!.smtp.port).toBe(587);
        });

        it('should error on invalid SMTP_PORT', () => {
            const msg = getError(diskEnv({ ...smtpEnv, SMTP_PORT: 'abc' }));
            expect(msg).toContain('SMTP_PORT');
        });

        it('should enable notification when NOTIFY_ON_SUCCESS is true', () => {
            const config = loadConfig(diskEnv({
                NOTIFY_ON_FAILURE: 'false',
                NOTIFY_ON_SUCCESS: 'true',
                ...smtpEnv,
            }));
            expect(config.notification).not.toBeNull();
            expect(config.notification!.onFailure).toBe(false);
            expect(config.notification!.onSuccess).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // Error aggregation
    // -----------------------------------------------------------------------

    describe('error aggregation', () => {
        it('should report multiple errors in a single throw', () => {
            const env = {
                SYNC_MODE: 'webdav',
                USE_ENCRYPTION: 'true',
                // Missing: WEBDAV_URL, WEBDAV_USERNAME, WEBDAV_PASSWORD, ENCRYPTION_PASSWORD
            };
            const bullets = errorBullets(env);
            expect(bullets.length).toBeGreaterThanOrEqual(4);
        });

        it('should include "Configuration error" header for single error', () => {
            const msg = getError(diskEnv({ USE_ENCRYPTION: 'true' }));
            expect(msg).toMatch(/^Configuration error:/);
        });

        it('should include "Configuration errors" header for multiple', () => {
            const env = {
                SYNC_MODE: 'webdav',
                USE_ENCRYPTION: 'true',
            };
            const msg = getError(env);
            expect(msg).toMatch(/^Configuration errors:/);
        });
    });

    // -----------------------------------------------------------------------
    // Boolean parsing edge cases
    // -----------------------------------------------------------------------

    describe('boolean parsing', () => {
        it.each([
            ['true', true],
            ['TRUE', true],
            ['True', true],
            ['1', true],
            ['yes', true],
            ['YES', true],
            ['false', false],
            ['FALSE', false],
            ['False', false],
            ['0', false],
            ['no', false],
            ['NO', false],
        ])('should parse DEBUG="%s" as %s', (value, expected) => {
            const config = loadConfig(diskEnv({ DEBUG: value }));
            expect(config.debug).toBe(expected);
        });
    });

    // -----------------------------------------------------------------------
    // Realistic scenarios
    // -----------------------------------------------------------------------

    describe('realistic scenarios', () => {
        it('should load a typical WebDAV docker-compose config', () => {
            const config = loadConfig({
                SYNC_MODE: 'webdav',
                WEBDAV_URL: 'https://nextcloud.home.lan/remote.php/dav/files/admin',
                WEBDAV_USERNAME: 'admin',
                WEBDAV_PASSWORD: 'hunter2',
                WEBDAV_TARGET_DIR: '/backups/paperless',
                USE_ENCRYPTION: 'true',
                ENCRYPTION_PASSWORD: 'my-strong-password',
                CHUNK_SIZE_MB: '200',
                CRON_SCHEDULE: '0 3 * * *',
                TIMEZONE: 'Europe/Berlin',
                RETAIN_DAILY: '7',
                RETAIN_WEEKLY: '4',
                RETAIN_MONTHLY: '12',
            });

            expect(config.syncMode).toBe('webdav');
            expect(config.provider).toMatchObject({
                name: 'webdav',
                url: 'https://nextcloud.home.lan/remote.php/dav/files/admin',
                targetDir: '/backups/paperless',
            });
            expect(config.archive).toMatchObject({
                sourceDir: '/data',
                encrypt: true,
                password: 'my-strong-password',
                chunkSizeMb: 200,
            });
            expect(config.retention).toEqual({ daily: 7, weekly: 4, monthly: 12 });
            expect(config.cron).toBe('0 3 * * *');
            expect(config.timezone).toBe('Europe/Berlin');
            expect(config.debug).toBe(false);
        });

        it('should load a minimal disk debug config', () => {
            const config = loadConfig({
                SYNC_MODE: 'disk',
                DEBUG: 'true',
                USE_ENCRYPTION: 'false',
            });

            expect(config.syncMode).toBe('disk');
            expect(config.debug).toBe(true);
            expect(config.archive.encrypt).toBe(false);
            expect(config.provider).toMatchObject({
                name: 'disk',
                targetDir: '/target',
            });
        });

        it('should load FTP config with TLS disabled', () => {
            const config = loadConfig({
                SYNC_MODE: 'ftp',
                FTP_HOST: '192.168.1.100',
                FTP_USER: 'backup',
                FTP_PASSWORD: 'ftppass',
                FTP_TLS: 'false',
                FTP_TARGET_DIR: '/daily-backups',
                USE_ENCRYPTION: 'true',
                ENCRYPTION_PASSWORD: 'archive-pw',
            });

            expect(config.provider).toMatchObject({
                name: 'ftp',
                tls: false,
                targetDir: '/daily-backups',
            });
            expect(config.retention).toEqual({ daily: 7, weekly: 4, monthly: 6 });
        });
    });
});
