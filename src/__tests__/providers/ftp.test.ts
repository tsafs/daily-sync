import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FtpProvider } from '../../providers/ftp.js';
import type { FtpProviderConfig } from '../../providers/provider.js';

// Mock basic-ftp module
vi.mock('basic-ftp', () => {
    const mockClient = {
        access: vi.fn().mockResolvedValue(undefined),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        cd: vi.fn().mockResolvedValue(undefined),
        uploadFrom: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        removeDir: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        downloadTo: vi.fn().mockResolvedValue({ code: 226, message: 'Transfer complete' }),
        close: vi.fn(),
    };
    return {
        Client: vi.fn(() => mockClient),
        __mockClient: mockClient,
    };
});

describe('FtpProvider', () => {
    let provider: FtpProvider;
    let mockClient: any;
    let sourceDir: string;

    const config: FtpProviderConfig = {
        name: 'ftp',
        host: 'ftp.example.com',
        port: 21,
        username: 'testuser',
        password: 'testpass',
        targetDir: '/backups',
        tls: true,
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        mockClient = (await import('basic-ftp') as any).__mockClient;
        // Reset mock implementations
        mockClient.access.mockResolvedValue(undefined);
        mockClient.ensureDir.mockResolvedValue(undefined);
        mockClient.cd.mockResolvedValue(undefined);
        mockClient.uploadFrom.mockResolvedValue(undefined);
        mockClient.list.mockResolvedValue([]);
        mockClient.removeDir.mockResolvedValue(undefined);
        mockClient.remove.mockResolvedValue(undefined);
        mockClient.downloadTo.mockResolvedValue({ code: 226, message: 'Transfer complete' });
        mockClient.close.mockReturnValue(undefined);

        provider = new FtpProvider(config);
        await provider.initialize();

        sourceDir = await mkdtemp(join(tmpdir(), 'ftp-src-'));
    });

    afterEach(async () => {
        await provider.dispose();
        await rm(sourceDir, { recursive: true, force: true });
    });

    describe('initialize()', () => {
        it('should connect with correct credentials and TLS', () => {
            expect(mockClient.access).toHaveBeenCalledWith({
                host: 'ftp.example.com',
                port: 21,
                user: 'testuser',
                password: 'testpass',
                secure: true,
            });
        });

        it('should ensure target directory exists', () => {
            expect(mockClient.ensureDir).toHaveBeenCalledWith('/backups');
        });

        it('should return to root directory after ensureDir', () => {
            expect(mockClient.cd).toHaveBeenCalledWith('/');
        });
    });

    describe('upload()', () => {
        it('should call uploadFrom with correct local and remote paths', async () => {
            const sourceFile = join(sourceDir, 'archive.7z');
            await writeFile(sourceFile, 'test-archive-data');

            await provider.upload(sourceFile, 'backup_20260323/archive.7z');

            expect(mockClient.uploadFrom).toHaveBeenCalledWith(
                sourceFile,
                '/backups/backup_20260323/archive.7z',
            );
        });

        it('should resolve paths relative to targetDir', async () => {
            const sourceFile = join(sourceDir, 'data.7z');
            await writeFile(sourceFile, 'data');

            await provider.upload(sourceFile, '/backups/some/file.7z');

            // Should not double the targetDir prefix
            expect(mockClient.uploadFrom).toHaveBeenCalledWith(
                sourceFile,
                '/backups/some/file.7z',
            );
        });
    });

    describe('list()', () => {
        it('should return mapped RemoteEntry array from FTP listing', async () => {
            mockClient.list.mockResolvedValue([
                { name: 'backup_20260301_020000', isDirectory: true, isFile: false },
                { name: 'archive.7z', isDirectory: false, isFile: true },
            ]);

            const entries = await provider.list('/');

            expect(entries).toEqual([
                { name: 'backup_20260301_020000', isDirectory: true },
                { name: 'archive.7z', isDirectory: false },
            ]);
        });

        it('should filter out . and .. entries', async () => {
            mockClient.list.mockResolvedValue([
                { name: '.', isDirectory: true },
                { name: '..', isDirectory: true },
                { name: 'backup', isDirectory: true },
            ]);

            const entries = await provider.list('/');
            expect(entries).toEqual([{ name: 'backup', isDirectory: true }]);
        });

        it('should return empty array when directory does not exist', async () => {
            mockClient.list.mockRejectedValue(new Error('550 No such file or directory'));

            const entries = await provider.list('nonexistent');
            expect(entries).toEqual([]);
        });

        it('should rethrow non-550 errors', async () => {
            const error = new Error('421 Service not available');
            mockClient.list.mockRejectedValue(error);

            await expect(provider.list('/')).rejects.toThrow('421 Service not available');
        });
    });

    describe('delete()', () => {
        it('should try removeDir first for directory deletion', async () => {
            await provider.delete('backup_20260101_020000');

            expect(mockClient.removeDir).toHaveBeenCalledWith('/backups/backup_20260101_020000');
        });

        it('should fall back to remove if removeDir fails (for files)', async () => {
            mockClient.removeDir.mockRejectedValue(new Error('550 Not a directory'));

            await provider.delete('somefile.7z');

            expect(mockClient.removeDir).toHaveBeenCalledWith('/backups/somefile.7z');
            expect(mockClient.remove).toHaveBeenCalledWith('/backups/somefile.7z');
        });

        it('should not throw when path does not exist', async () => {
            mockClient.removeDir.mockRejectedValue(new Error('550 Not a directory'));
            mockClient.remove.mockRejectedValue(new Error('550 No such file'));

            await expect(provider.delete('ghost')).resolves.toBeUndefined();
        });

        it('should only delete the specified path, not the target directory', async () => {
            await provider.delete('backup_20260101_020000');

            expect(mockClient.removeDir).toHaveBeenCalledTimes(1);
            expect(mockClient.removeDir).toHaveBeenCalledWith('/backups/backup_20260101_020000');
            expect(mockClient.removeDir).not.toHaveBeenCalledWith('/backups');
        });

        it('should rethrow unexpected errors', async () => {
            mockClient.removeDir.mockRejectedValue(new Error('not a dir'));
            mockClient.remove.mockRejectedValue(new Error('421 Connection closed'));

            await expect(provider.delete('fail')).rejects.toThrow('421 Connection closed');
        });
    });

    describe('mkdir()', () => {
        it('should call ensureDir with resolved path', async () => {
            vi.clearAllMocks();
            await provider.mkdir('backup_20260323_020000');

            expect(mockClient.ensureDir).toHaveBeenCalledWith('/backups/backup_20260323_020000');
        });

        it('should return to root after creating directory', async () => {
            vi.clearAllMocks();
            await provider.mkdir('a/b/c');

            expect(mockClient.cd).toHaveBeenCalledWith('/');
        });
    });

    describe('download()', () => {
        it('should call downloadTo with the resolved remote path', async () => {
            await provider.download('backup/archive.zip');

            expect(mockClient.downloadTo).toHaveBeenCalledWith(
                expect.any(Object),
                '/backups/backup/archive.zip',
            );
        });

        it('should return content written by downloadTo as a Buffer', async () => {
            mockClient.downloadTo.mockImplementation(async (writable: any) => {
                writable.write(Buffer.from('downloaded-content'));
                writable.end();
                return { code: 226, message: 'Transfer complete' };
            });

            const buffer = await provider.download('archive.zip');

            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.toString('utf-8')).toBe('downloaded-content');
        });

        it('should correctly concatenate multiple chunks', async () => {
            mockClient.downloadTo.mockImplementation(async (writable: any) => {
                writable.write(Buffer.from('chunk1-'));
                writable.write(Buffer.from('chunk2'));
                writable.end();
                return { code: 226, message: 'Transfer complete' };
            });

            const buffer = await provider.download('multi.zip');

            expect(buffer.toString('utf-8')).toBe('chunk1-chunk2');
        });

        it('should return an empty Buffer when no data is written', async () => {
            mockClient.downloadTo.mockImplementation(async (writable: any) => {
                writable.end();
                return { code: 226, message: 'Transfer complete' };
            });

            const buffer = await provider.download('empty.zip');

            expect(buffer.byteLength).toBe(0);
        });

        it('should propagate errors from downloadTo', async () => {
            mockClient.downloadTo.mockRejectedValue(new Error('connection reset'));

            await expect(provider.download('error.zip')).rejects.toThrow('connection reset');
        });
    });

    describe('dispose()', () => {
        it('should close the FTP connection', async () => {
            await provider.dispose();

            expect(mockClient.close).toHaveBeenCalled();
        });

        it('should prevent further operations after dispose', async () => {
            await provider.dispose();

            await expect(provider.list('/')).rejects.toThrow('not initialized');
        });

        it('should be safe to call multiple times', async () => {
            await provider.dispose();
            await expect(provider.dispose()).resolves.toBeUndefined();
        });
    });
});
