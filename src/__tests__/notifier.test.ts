/**
 * Unit tests for the notifier service.
 *
 * nodemailer is mocked so no real SMTP connection is made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSilentLogger } from '../services/logger.js';

// ---------------------------------------------------------------------------
// Mock nodemailer before importing the module under test.
// vi.hoisted() ensures these run before the vi.mock factory is invoked.
// ---------------------------------------------------------------------------

const { mockSendMail, mockCreateTransport } = vi.hoisted(() => {
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-123' });
    const mockTransporter = { sendMail: mockSendMail };
    const mockCreateTransport = vi.fn().mockReturnValue(mockTransporter);
    return { mockSendMail, mockCreateTransport };
});

vi.mock('nodemailer', () => ({
    default: { createTransport: mockCreateTransport },
}));

// Import after mocking
import { EmailNotifier, createNotifier } from '../services/notifier.js';
import type { BackupEvent, NotificationService } from '../services/notifier.js';
import type { NotificationConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<NotificationConfig> = {}): NotificationConfig {
    return {
        onFailure: true,
        onSuccess: false,
        smtp: {
            host: 'smtp.example.com',
            port: 587,
            user: 'user@example.com',
            password: 'secret',
            from: 'backup@example.com',
            to: ['admin@example.com'],
        },
        ...overrides,
    };
}

const failureEvent: BackupEvent = {
    type: 'failure',
    providerName: 'webdav',
    backupId: 'backup_20260326_020000',
    error: new Error('7z exited with code 2'),
};

const successEvent: BackupEvent = {
    type: 'success',
    providerName: 'disk',
    backupId: 'backup_20260326_020000',
    archiveSizeMb: 123.45,
    volumeCount: 3,
    durationMs: 8500,
};

// ---------------------------------------------------------------------------
// createNotifier factory
// ---------------------------------------------------------------------------

describe('createNotifier', () => {
    const log = createSilentLogger();

    it('returns a no-op notifier when config is null', async () => {
        const notifier = createNotifier(null, log);
        // Should not throw and should not call sendMail
        await notifier.notify(failureEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('returns an EmailNotifier when config is provided', () => {
        const notifier = createNotifier(makeConfig(), log);
        expect(notifier).toBeInstanceOf(EmailNotifier);
    });
});

// ---------------------------------------------------------------------------
// EmailNotifier — construction
// ---------------------------------------------------------------------------

describe('EmailNotifier construction', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        mockSendMail.mockResolvedValue({ messageId: 'test-123' });
    });

    it('creates transporter with correct SMTP settings', () => {
        const config = makeConfig();
        new EmailNotifier(config, log);

        expect(mockCreateTransport).toHaveBeenCalledWith({
            host: 'smtp.example.com',
            port: 587,
            secure: false, // 587 → STARTTLS, not implicit TLS
            auth: { user: 'user@example.com', pass: 'secret' },
        });
    });

    it('sets secure:true when port is 465', () => {
        const config = makeConfig({ smtp: { ...makeConfig().smtp, port: 465 } });
        new EmailNotifier(config, log);

        const call = mockCreateTransport.mock.calls[0][0];
        expect(call.secure).toBe(true);
    });

    it('sets secure:false for non-465 ports', () => {
        for (const port of [25, 587, 2525]) {
            vi.clearAllMocks();
            const config = makeConfig({ smtp: { ...makeConfig().smtp, port } });
            new EmailNotifier(config, log);
            const call = mockCreateTransport.mock.calls[0][0];
            expect(call.secure).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// EmailNotifier — notify() opt-in / opt-out
// ---------------------------------------------------------------------------

describe('EmailNotifier opt-in / opt-out', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        mockSendMail.mockResolvedValue({ messageId: 'test-123' });
    });

    it('sends email for failure event when onFailure is true', async () => {
        const notifier = new EmailNotifier(makeConfig({ onFailure: true }), log);
        await notifier.notify(failureEvent);
        expect(mockSendMail).toHaveBeenCalledOnce();
    });

    it('does NOT send email for failure event when onFailure is false', async () => {
        const notifier = new EmailNotifier(makeConfig({ onFailure: false }), log);
        await notifier.notify(failureEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('sends email for success event when onSuccess is true', async () => {
        const notifier = new EmailNotifier(makeConfig({ onSuccess: true }), log);
        await notifier.notify(successEvent);
        expect(mockSendMail).toHaveBeenCalledOnce();
    });

    it('does NOT send email for success event when onSuccess is false', async () => {
        const notifier = new EmailNotifier(makeConfig({ onSuccess: false }), log);
        await notifier.notify(successEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('sends email for both events when both flags are true', async () => {
        const notifier = new EmailNotifier(
            makeConfig({ onFailure: true, onSuccess: true }),
            log,
        );
        await notifier.notify(failureEvent);
        await notifier.notify(successEvent);
        expect(mockSendMail).toHaveBeenCalledTimes(2);
    });

    it('sends no email for either event when both flags are false', async () => {
        const notifier = new EmailNotifier(
            makeConfig({ onFailure: false, onSuccess: false }),
            log,
        );
        await notifier.notify(failureEvent);
        await notifier.notify(successEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// EmailNotifier — failure email content
// ---------------------------------------------------------------------------

describe('EmailNotifier failure email content', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        mockSendMail.mockResolvedValue({ messageId: 'test-123' });
    });

    it('sends to all configured recipients', async () => {
        const config = makeConfig({
            smtp: {
                ...makeConfig().smtp,
                to: ['alice@example.com', 'bob@example.com'],
            },
        });
        const notifier = new EmailNotifier(config, log);
        await notifier.notify(failureEvent);

        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.to).toBe('alice@example.com, bob@example.com');
    });

    it('uses correct sender address', async () => {
        const notifier = new EmailNotifier(makeConfig(), log);
        await notifier.notify(failureEvent);
        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.from).toBe('backup@example.com');
    });

    it('subject contains FAILED and provider name', async () => {
        const notifier = new EmailNotifier(makeConfig(), log);
        await notifier.notify(failureEvent);
        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.subject).toContain('FAILED');
        expect(mailOptions.subject).toContain('webdav');
        expect(mailOptions.subject).toContain('[daily-sync]');
    });

    it('body contains provider name, backup ID, and error message', async () => {
        const notifier = new EmailNotifier(makeConfig(), log);
        await notifier.notify(failureEvent);
        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.text).toContain('webdav');
        expect(mailOptions.text).toContain('backup_20260326_020000');
        expect(mailOptions.text).toContain('7z exited with code 2');
    });
});

// ---------------------------------------------------------------------------
// EmailNotifier — success email content
// ---------------------------------------------------------------------------

describe('EmailNotifier success email content', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
        mockSendMail.mockResolvedValue({ messageId: 'test-123' });
    });

    it('subject contains OK and provider name', async () => {
        const notifier = new EmailNotifier(makeConfig({ onSuccess: true }), log);
        await notifier.notify(successEvent);
        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.subject).toContain('OK');
        expect(mailOptions.subject).toContain('disk');
        expect(mailOptions.subject).toContain('[daily-sync]');
    });

    it('body contains provider, backup ID, volume count, size, and duration', async () => {
        const notifier = new EmailNotifier(makeConfig({ onSuccess: true }), log);
        await notifier.notify(successEvent);
        const mailOptions = mockSendMail.mock.calls[0][0];
        expect(mailOptions.text).toContain('disk');
        expect(mailOptions.text).toContain('backup_20260326_020000');
        expect(mailOptions.text).toContain('3'); // volumeCount
        expect(mailOptions.text).toContain('123.45'); // archiveSizeMb
    });
});

// ---------------------------------------------------------------------------
// EmailNotifier — transport error resilience
// ---------------------------------------------------------------------------

describe('EmailNotifier transport error resilience', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('swallows sendMail errors and does not throw', async () => {
        mockSendMail.mockRejectedValue(new Error('SMTP connection refused'));
        const notifier = new EmailNotifier(makeConfig(), log);

        // Must not throw
        await expect(notifier.notify(failureEvent)).resolves.toBeUndefined();
    });

    it('swallows sendMail errors for success events too', async () => {
        mockSendMail.mockRejectedValue(new Error('Authentication failed'));
        const notifier = new EmailNotifier(makeConfig({ onSuccess: true }), log);

        await expect(notifier.notify(successEvent)).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// No-op notifier via createNotifier(null)
// ---------------------------------------------------------------------------

describe('createNotifier(null) — no-op behaviour', () => {
    const log = createSilentLogger();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('notify() resolves without calling sendMail for failure events', async () => {
        const notifier: NotificationService = createNotifier(null, log);
        await notifier.notify(failureEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('notify() resolves without calling sendMail for success events', async () => {
        const notifier: NotificationService = createNotifier(null, log);
        await notifier.notify(successEvent);
        expect(mockSendMail).not.toHaveBeenCalled();
    });
});
