import { describe, it, expect, afterEach } from 'vitest';
import { rm, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { IntegrityService, IntegrityError } from '../services/integrity.js';
import type { BackupProvider, RemoteEntry } from '../providers/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the expected SHA-256 hex digest of a string value. */
function sha256(content: string | Buffer): string {
    return createHash('sha256')
        .update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
        .digest('hex');
}

/**
 * Mock provider with a download() implementation that returns a Readable stream
 * of the given buffer regardless of the requested path.
 */
function createDownloadableProvider(returnBuffer: Buffer): BackupProvider {
    return {
        name: 'disk',
        initialize: async () => { },
        upload: async () => { },
        list: async (): Promise<RemoteEntry[]> => [],
        delete: async () => { },
        mkdir: async () => { },
        dispose: async () => { },
        download: async (_remotePath: string) => Readable.from(returnBuffer),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrityService', () => {
    const service = new IntegrityService();
    const tempDirs: string[] = [];

    afterEach(async () => {
        for (const dir of tempDirs) {
            await rm(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    /** Create a temp file with known content and return its path. */
    async function createTempFile(content: string): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'integrity-test-'));
        tempDirs.push(dir);
        const filePath = join(dir, 'test.zip');
        await writeFile(filePath, content, 'utf8');
        return filePath;
    }

    // -----------------------------------------------------------------------
    // Checksum computation
    // -----------------------------------------------------------------------

    it('computes the correct SHA-256 checksum for a known file', async () => {
        const content = 'hello integrity world';
        const filePath = await createTempFile(content);
        const expected = sha256(content);

        const provider = createDownloadableProvider(Buffer.from(content, 'utf8'));
        const result = await service.verify(provider, filePath, '/remote/test.zip');

        expect(result.localChecksum).toBe(expected);
    });

    // -----------------------------------------------------------------------
    // Matching checksums (happy path)
    // -----------------------------------------------------------------------

    it('returns verified:true when local and remote checksums match', async () => {
        const content = 'matching content';
        const filePath = await createTempFile(content);
        const provider = createDownloadableProvider(Buffer.from(content, 'utf8'));

        const result = await service.verify(provider, filePath, '/remote/good.zip');

        expect(result.verified).toBe(true);
        expect(result.localChecksum).toBe(result.remoteChecksum);
        expect(result.localChecksum).toMatch(/^[a-f0-9]{64}$/);
    });

    it('populates localFile and remoteFile on success', async () => {
        const content = 'abc';
        const filePath = await createTempFile(content);
        const provider = createDownloadableProvider(Buffer.from(content, 'utf8'));

        const result = await service.verify(provider, filePath, '/remote/abc.zip');

        expect(result.localFile).toBe(filePath);
        expect(result.remoteFile).toBe('/remote/abc.zip');
    });

    // -----------------------------------------------------------------------
    // Mismatched checksums
    // -----------------------------------------------------------------------

    it('throws IntegrityError when checksums do not match', async () => {
        const filePath = await createTempFile('original content');
        const tamperedBuffer = Buffer.from('tampered content', 'utf8');
        const provider = createDownloadableProvider(tamperedBuffer);

        await expect(
            service.verify(provider, filePath, '/remote/tampered.zip'),
        ).rejects.toThrow(IntegrityError);
    });

    it('IntegrityError message includes the remote path', async () => {
        const filePath = await createTempFile('original');
        const provider = createDownloadableProvider(Buffer.from('different', 'utf8'));

        let error: IntegrityError | undefined;
        try {
            await service.verify(provider, filePath, '/remote/named.zip');
        } catch (err) {
            error = err as IntegrityError;
        }

        expect(error).toBeInstanceOf(IntegrityError);
        expect(error!.message).toContain('/remote/named.zip');
    });

    it('IntegrityError exposes both checksum values', async () => {
        const content = 'local data';
        const filePath = await createTempFile(content);
        const remoteContent = 'remote data differs';
        const provider = createDownloadableProvider(Buffer.from(remoteContent, 'utf8'));

        let error: IntegrityError | undefined;
        try {
            await service.verify(provider, filePath, '/remote/checksums.zip');
        } catch (err) {
            error = err as IntegrityError;
        }

        expect(error).toBeInstanceOf(IntegrityError);
        expect(error!.localChecksum).toBe(sha256(content));
        expect(error!.remoteChecksum).toBe(sha256(remoteContent));
    });

    it('IntegrityError message includes both checksum hex values', async () => {
        const filePath = await createTempFile('local');
        const provider = createDownloadableProvider(Buffer.from('remote', 'utf8'));

        let error: IntegrityError | undefined;
        try {
            await service.verify(provider, filePath, '/remote/both-checksums.zip');
        } catch (err) {
            error = err as IntegrityError;
        }

        expect(error!.message).toContain(error!.localChecksum);
        expect(error!.message).toContain(error!.remoteChecksum);
    });

    // -----------------------------------------------------------------------
    // Binary content
    // -----------------------------------------------------------------------

    it('correctly handles binary archive content (null bytes, arbitrary bytes)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'integrity-binary-'));
        tempDirs.push(dir);
        // Write 256 bytes: 0x00 … 0xFF
        const binaryContent = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        const filePath = join(dir, 'binary.zip');
        await writeFile(filePath, binaryContent);
        const provider = createDownloadableProvider(binaryContent);

        const result = await service.verify(provider, filePath, '/remote/binary.zip');

        expect(result.verified).toBe(true);
        expect(result.localChecksum).toBe(result.remoteChecksum);
    });
});
