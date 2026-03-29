import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { WebDavProvider } from '../../providers/webdav.js';
import type { WebDavProviderConfig } from '../../providers/provider.js';

// Mock the webdav module
vi.mock('webdav', () => {
    const mockClient = {
        putFileContents: vi.fn().mockResolvedValue(true),
        getDirectoryContents: vi.fn().mockResolvedValue([]),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        createDirectory: vi.fn().mockResolvedValue(undefined),
        createReadStream: vi.fn().mockReturnValue(Readable.from(Buffer.alloc(0))),
    };
    return {
        createClient: vi.fn(() => mockClient),
        __mockClient: mockClient,
    };
});

// Import after mocking
import { createClient } from 'webdav';

describe('WebDavProvider', () => {
    let provider: WebDavProvider;
    let mockClient: any;
    let sourceDir: string;

    const config: WebDavProviderConfig = {
        name: 'webdav',
        url: 'https://cloud.example.com/dav',
        username: 'testuser',
        password: 'testpass',
        targetDir: '/backups',
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        mockClient = (await import('webdav') as any).__mockClient;
        // Reset mock implementations
        mockClient.putFileContents.mockResolvedValue(true);
        mockClient.getDirectoryContents.mockResolvedValue([]);
        mockClient.deleteFile.mockResolvedValue(undefined);
        mockClient.createDirectory.mockResolvedValue(undefined);
        mockClient.createReadStream.mockReturnValue(Readable.from(Buffer.alloc(0)));

        provider = new WebDavProvider(config);
        await provider.initialize();

        sourceDir = await mkdtemp(join(tmpdir(), 'webdav-src-'));
    });

    afterEach(async () => {
        await provider.dispose();
        await rm(sourceDir, { recursive: true, force: true });
    });

    describe('initialize()', () => {
        it('should create webdav client with correct credentials', () => {
            expect(createClient).toHaveBeenCalledWith('https://cloud.example.com/dav', {
                username: 'testuser',
                password: 'testpass',
            });
        });

        it('should create the target directory on initialization', () => {
            // mkdir is called for /backups, which means createDirectory for /backups
            expect(mockClient.createDirectory).toHaveBeenCalledWith('/backups');
        });
    });

    describe('upload()', () => {
        it('should call putFileContents with a stream and correct path', async () => {
            const sourceFile = join(sourceDir, 'archive.7z');
            await writeFile(sourceFile, 'test-archive-data');

            await provider.upload(sourceFile, 'backup_20260323/archive.7z');

            expect(mockClient.putFileContents).toHaveBeenCalledWith(
                '/backups/backup_20260323/archive.7z',
                expect.anything(), // ReadStream
                expect.objectContaining({
                    overwrite: true,
                    contentLength: expect.any(Number),
                }),
            );
        });

        it('should resolve paths relative to targetDir', async () => {
            const sourceFile = join(sourceDir, 'data.7z');
            await writeFile(sourceFile, 'data');

            await provider.upload(sourceFile, '/backups/some/file.7z');

            // Should not double the targetDir prefix
            expect(mockClient.putFileContents).toHaveBeenCalledWith(
                '/backups/some/file.7z',
                expect.anything(),
                expect.anything(),
            );
        });
    });

    describe('list()', () => {
        it('should return mapped RemoteEntry array from directory contents', async () => {
            mockClient.getDirectoryContents.mockResolvedValue([
                { basename: 'backup_20260301_020000', type: 'directory', filename: '/backups/backup_20260301_020000' },
                { basename: 'archive.7z', type: 'file', filename: '/backups/archive.7z' },
            ]);

            const entries = await provider.list('/');

            expect(entries).toEqual([
                { name: 'backup_20260301_020000', isDirectory: true },
                { name: 'archive.7z', isDirectory: false },
            ]);
        });

        it('should return empty array on 404', async () => {
            mockClient.getDirectoryContents.mockRejectedValue({ status: 404 });

            const entries = await provider.list('nonexistent');
            expect(entries).toEqual([]);
        });

        it('should rethrow non-404 errors', async () => {
            mockClient.getDirectoryContents.mockRejectedValue({ status: 500, message: 'server error' });

            await expect(provider.list('/')).rejects.toEqual({ status: 500, message: 'server error' });
        });
    });

    describe('delete()', () => {
        it('should call deleteFile with resolved path', async () => {
            await provider.delete('backup_20260101_020000');

            expect(mockClient.deleteFile).toHaveBeenCalledWith('/backups/backup_20260101_020000');
        });

        it('should not throw on 404', async () => {
            mockClient.deleteFile.mockRejectedValue({ status: 404 });

            await expect(provider.delete('ghost')).resolves.toBeUndefined();
        });

        it('should rethrow non-404 errors', async () => {
            mockClient.deleteFile.mockRejectedValue({ status: 403, message: 'forbidden' });

            await expect(provider.delete('forbidden')).rejects.toEqual({ status: 403, message: 'forbidden' });
        });

        it('should only delete the specified path, not the target directory', async () => {
            await provider.delete('backup_20260101_020000');

            // Should delete the backup subdirectory, not the target root
            expect(mockClient.deleteFile).toHaveBeenCalledTimes(1);
            expect(mockClient.deleteFile).toHaveBeenCalledWith('/backups/backup_20260101_020000');
            expect(mockClient.deleteFile).not.toHaveBeenCalledWith('/backups');
        });
    });

    describe('mkdir()', () => {
        it('should create each path segment individually', async () => {
            vi.clearAllMocks();
            await provider.mkdir('a/b/c');

            // Should create /backups, /backups/a, /backups/a/b, /backups/a/b/c
            expect(mockClient.createDirectory).toHaveBeenCalledWith('/backups');
            expect(mockClient.createDirectory).toHaveBeenCalledWith('/backups/a');
            expect(mockClient.createDirectory).toHaveBeenCalledWith('/backups/a/b');
            expect(mockClient.createDirectory).toHaveBeenCalledWith('/backups/a/b/c');
        });

        it('should ignore 405 (directory already exists)', async () => {
            mockClient.createDirectory.mockRejectedValue({ status: 405 });

            await expect(provider.mkdir('existing')).resolves.toBeUndefined();
        });

        it('should rethrow non-405/409 errors', async () => {
            mockClient.createDirectory.mockRejectedValue({ status: 500, message: 'error' });

            await expect(provider.mkdir('fail')).rejects.toEqual({ status: 500, message: 'error' });
        });
    });

    describe('download()', () => {
        /** Helper to collect a Readable returned by download() into a Buffer. */
        async function collect(remotePath: string): Promise<Buffer> {
            const stream = await provider.download(remotePath);
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk as Buffer);
            return Buffer.concat(chunks);
        }

        it('should call createReadStream with the resolved remote path', async () => {
            await provider.download('backup/archive.zip');

            expect(mockClient.createReadStream).toHaveBeenCalledWith('/backups/backup/archive.zip');
        });

        it('should stream the file content correctly', async () => {
            const data = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // 'hello'
            mockClient.createReadStream.mockReturnValue(Readable.from(data));

            const result = await collect('file.zip');

            expect(result.toString('utf-8')).toBe('hello');
        });

        it('should propagate errors from createReadStream', async () => {
            const errStream = new Readable({
                read() { this.destroy(new Error('not found')); },
            });
            mockClient.createReadStream.mockReturnValue(errStream);

            await expect(collect('missing.zip')).rejects.toThrow('not found');
        });
    });

    describe('dispose()', () => {
        it('should nullify client and prevent further operations', async () => {
            await provider.dispose();

            await expect(provider.list('/')).rejects.toThrow('not initialized');
        });
    });
});
