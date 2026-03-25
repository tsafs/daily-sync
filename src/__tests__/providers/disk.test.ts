import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiskProvider } from '../../providers/disk.js';
import type { DiskProviderConfig } from '../../providers/provider.js';

describe('DiskProvider', () => {
    let targetDir: string;
    let provider: DiskProvider;

    beforeEach(async () => {
        targetDir = await mkdtemp(join(tmpdir(), 'disk-provider-test-'));
        const config: DiskProviderConfig = { name: 'disk', targetDir };
        provider = new DiskProvider(config);
        await provider.initialize();
    });

    afterEach(async () => {
        await provider.dispose();
        await rm(targetDir, { recursive: true, force: true });
    });

    describe('initialize()', () => {
        it('should create target directory if it does not exist', async () => {
            const newDir = join(targetDir, 'nested', 'backup', 'dir');
            const newProvider = new DiskProvider({ name: 'disk', targetDir: newDir });
            await newProvider.initialize();

            const stats = await stat(newDir);
            expect(stats.isDirectory()).toBe(true);
        });
    });

    describe('upload()', () => {
        it('should copy a file to the target directory', async () => {
            // Create a source file
            const sourceDir = await mkdtemp(join(tmpdir(), 'disk-src-'));
            const sourceFile = join(sourceDir, 'test.txt');
            await writeFile(sourceFile, 'hello backup');

            await provider.upload(sourceFile, 'backups/test.txt');

            const content = await readFile(join(targetDir, 'backups', 'test.txt'), 'utf-8');
            expect(content).toBe('hello backup');

            await rm(sourceDir, { recursive: true, force: true });
        });

        it('should create parent directories automatically', async () => {
            const sourceDir = await mkdtemp(join(tmpdir(), 'disk-src-'));
            const sourceFile = join(sourceDir, 'archive.7z');
            await writeFile(sourceFile, 'archive-content');

            await provider.upload(sourceFile, 'deep/nested/dir/archive.7z');

            const content = await readFile(
                join(targetDir, 'deep', 'nested', 'dir', 'archive.7z'),
                'utf-8',
            );
            expect(content).toBe('archive-content');

            await rm(sourceDir, { recursive: true, force: true });
        });

        it('should overwrite an existing file', async () => {
            const sourceDir = await mkdtemp(join(tmpdir(), 'disk-src-'));
            const sourceFile = join(sourceDir, 'data.txt');

            await writeFile(sourceFile, 'version 1');
            await provider.upload(sourceFile, 'data.txt');

            await writeFile(sourceFile, 'version 2');
            await provider.upload(sourceFile, 'data.txt');

            const content = await readFile(join(targetDir, 'data.txt'), 'utf-8');
            expect(content).toBe('version 2');

            await rm(sourceDir, { recursive: true, force: true });
        });
    });

    describe('list()', () => {
        it('should list files and directories', async () => {
            await mkdir(join(targetDir, 'backup_20260101_020000'));
            await writeFile(join(targetDir, 'somefile.txt'), 'content');

            const entries = await provider.list('/');

            expect(entries).toContainEqual({ name: 'backup_20260101_020000', isDirectory: true });
            expect(entries).toContainEqual({ name: 'somefile.txt', isDirectory: false });
        });

        it('should return empty array for non-existent directory', async () => {
            const entries = await provider.list('does/not/exist');
            expect(entries).toEqual([]);
        });

        it('should list entries in a subdirectory', async () => {
            const subdir = join(targetDir, 'backup_20260301_020000');
            await mkdir(subdir);
            await writeFile(join(subdir, 'archive.7z.001'), 'part1');
            await writeFile(join(subdir, 'archive.7z.002'), 'part2');

            const entries = await provider.list('backup_20260301_020000');

            expect(entries).toHaveLength(2);
            expect(entries.map((e) => e.name).sort()).toEqual(['archive.7z.001', 'archive.7z.002']);
            expect(entries.every((e) => !e.isDirectory)).toBe(true);
        });
    });

    describe('delete()', () => {
        it('should delete a file', async () => {
            await writeFile(join(targetDir, 'to-delete.txt'), 'bye');

            await provider.delete('to-delete.txt');

            const entries = await provider.list('/');
            expect(entries.find((e) => e.name === 'to-delete.txt')).toBeUndefined();
        });

        it('should recursively delete a directory', async () => {
            const dir = join(targetDir, 'old-backup');
            await mkdir(dir);
            await writeFile(join(dir, 'file1.7z'), 'data');
            await writeFile(join(dir, 'file2.7z'), 'data');

            await provider.delete('old-backup');

            const entries = await provider.list('/');
            expect(entries.find((e) => e.name === 'old-backup')).toBeUndefined();
        });

        it('should not throw when deleting a non-existent path', async () => {
            await expect(provider.delete('ghost')).resolves.toBeUndefined();
        });

        it('should not delete the target directory itself', async () => {
            const dir = join(targetDir, 'old-backup');
            await mkdir(dir);
            await writeFile(join(dir, 'file.7z'), 'data');

            await provider.delete('old-backup');

            // Target directory must still exist
            const stats = await stat(targetDir);
            expect(stats.isDirectory()).toBe(true);
        });

        it('should only delete the specified entry, not siblings', async () => {
            await mkdir(join(targetDir, 'backup_old'));
            await writeFile(join(targetDir, 'backup_old', 'archive.7z'), 'old');
            await mkdir(join(targetDir, 'backup_new'));
            await writeFile(join(targetDir, 'backup_new', 'archive.7z'), 'new');

            await provider.delete('backup_old');

            // Target dir and sibling backup must still exist
            const entries = await provider.list('/');
            expect(entries.find((e) => e.name === 'backup_old')).toBeUndefined();
            expect(entries).toContainEqual({ name: 'backup_new', isDirectory: true });

            const content = await readFile(join(targetDir, 'backup_new', 'archive.7z'), 'utf-8');
            expect(content).toBe('new');
        });
    });

    describe('mkdir()', () => {
        it('should create a directory', async () => {
            await provider.mkdir('backup_20260323_020000');

            const stats = await stat(join(targetDir, 'backup_20260323_020000'));
            expect(stats.isDirectory()).toBe(true);
        });

        it('should create nested directories', async () => {
            await provider.mkdir('a/b/c');

            const stats = await stat(join(targetDir, 'a', 'b', 'c'));
            expect(stats.isDirectory()).toBe(true);
        });

        it('should not throw if directory already exists', async () => {
            await provider.mkdir('existing');
            await expect(provider.mkdir('existing')).resolves.toBeUndefined();
        });
    });

    describe('download()', () => {
        it('should return file content as a Buffer', async () => {
            await writeFile(join(targetDir, 'archive.zip'), 'archive-bytes');

            const buffer = await provider.download('archive.zip');

            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.toString('utf-8')).toBe('archive-bytes');
        });

        it('should resolve relative paths inside targetDir', async () => {
            await mkdir(join(targetDir, 'sub'));
            await writeFile(join(targetDir, 'sub', 'data.zip'), 'nested-data');

            const buffer = await provider.download('sub/data.zip');

            expect(buffer.toString('utf-8')).toBe('nested-data');
        });

        it('should handle binary content correctly', async () => {
            const binary = Buffer.from([0x00, 0x01, 0xff, 0xfe]);
            await writeFile(join(targetDir, 'binary.bin'), binary);

            const result = await provider.download('binary.bin');

            expect(result).toEqual(binary);
        });

        it('should throw for non-existent files', async () => {
            await expect(provider.download('missing.zip')).rejects.toThrow();
        });
    });

    describe('resolvePath()', () => {
        it('should handle paths with leading slash', async () => {
            await writeFile(join(targetDir, 'root-file.txt'), 'content');
            const entries = await provider.list('/');
            expect(entries).toContainEqual({ name: 'root-file.txt', isDirectory: false });
        });

        it('should handle paths without leading slash', async () => {
            await mkdir(join(targetDir, 'sub'));
            await writeFile(join(targetDir, 'sub', 'file.txt'), 'content');
            const entries = await provider.list('sub');
            expect(entries).toContainEqual({ name: 'file.txt', isDirectory: false });
        });
    });
});
