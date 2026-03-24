import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, readdir, chmod } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Options for creating an archive.
 */
export interface ArchiveOptions {
    /** Absolute path to the source data directory (e.g. /data) */
    sourceDir: string;
    /** Whether to encrypt the archive */
    encrypt: boolean;
    /** Password for encryption (required if encrypt is true) */
    password?: string;
    /** Multi-volume split size in MB (0 = no splitting) */
    chunkSizeMb: number;
}

/**
 * Result of an archive creation.
 */
export interface ArchiveResult {
    /** List of absolute paths to the created archive files */
    files: string[];
    /** The base name used for the archive (without extension or volume suffix) */
    baseName: string;
    /** Temporary directory that must be cleaned up by the caller */
    tempDir: string;
}

/**
 * Wraps 7z via child_process.execFile (not exec — avoids shell injection).
 *
 * Copies the source data to a temp directory, creates encrypted or unencrypted
 * archives, supports multi-volume splitting, and returns the list of created
 * archive file paths. The caller is responsible for cleaning up the tempDir
 * after upload.
 */
export class ArchiverService {
    /**
     * Create an archive from the source directory.
     *
     * @returns ArchiveResult with file paths and temp directory info
     * @throws Error if 7z fails or no archive files are produced
     */
    async createArchive(options: ArchiveOptions): Promise<ArchiveResult> {
        if (options.encrypt && !options.password) {
            throw new Error('Encryption password is required when encrypt is true');
        }

        // Create a temp working directory
        const tempDir = await mkdtemp(join(tmpdir(), 'daily-sync-'));

        try {
            // Copy source data to temp directory
            const dataDir = join(tempDir, 'data');
            await cp(options.sourceDir, dataDir, { recursive: true });

            // Ensure readable permissions on the copied data
            await chmod(dataDir, 0o755).catch(() => {
                // chmod may fail on some filesystems, continue anyway
            });

            // Build the archive base name
            const timestamp = this.generateTimestamp();
            const prefix = options.encrypt ? 'encrypted_data' : 'data';
            const baseName = `${prefix}_${timestamp}`;
            const archivePath = join(tempDir, `${baseName}.zip`);

            // Build 7z command args
            const args = this.build7zArgs(archivePath, dataDir, options);

            // Execute 7z
            await execFileAsync('7z', args);

            // Find the created archive files
            const files = await this.findArchiveFiles(tempDir, baseName);

            if (files.length === 0) {
                throw new Error(
                    '7z produced no archive files. Check if the source directory contains data.',
                );
            }

            return {
                files,
                baseName,
                tempDir,
            };
        } catch (err) {
            // Clean up temp dir on failure
            await rm(tempDir, { recursive: true, force: true }).catch(() => { });
            throw err;
        }
    }

    /**
     * Clean up the temporary directory created during archive creation.
     * Safe to call multiple times.
     */
    async cleanup(tempDir: string): Promise<void> {
        await rm(tempDir, { recursive: true, force: true });
    }

    /**
     * Build the argument array for the 7z command.
     * Uses execFile (not exec) so arguments are never shell-interpreted.
     */
    private build7zArgs(
        archivePath: string,
        dataDir: string,
        options: ArchiveOptions,
    ): string[] {
        const args = ['a'];

        // Encryption
        if (options.encrypt && options.password) {
            args.push(`-p${options.password}`);
        }

        // Multi-volume splitting
        if (options.chunkSizeMb > 0) {
            // Subtract 10MB for safety margin (matching bash script behavior)
            const volumeSizeMb = Math.max(1, options.chunkSizeMb - 10);
            args.push(`-v${volumeSizeMb}m`);
        }

        // Output path and source
        args.push(archivePath, dataDir);

        return args;
    }

    /**
     * Find all archive files created by 7z in the temp directory.
     *
     * 7z creates either:
     * - Single file: baseName.zip (when no volume splitting)
     * - Volume files: baseName.zip.001, baseName.zip.002, ... (when splitting)
     */
    private async findArchiveFiles(tempDir: string, baseName: string): Promise<string[]> {
        const entries = await readdir(tempDir);
        const archiveFiles = entries
            .filter((name) => {
                // Match baseName.zip or baseName.zip.NNN
                return name === `${baseName}.zip` || name.startsWith(`${baseName}.zip.`);
            })
            .sort() // Ensure volume order
            .map((name) => join(tempDir, name));

        return archiveFiles;
    }

    /**
     * Generate a timestamp string in YYYYMMDD_HHMMSS format.
     */
    private generateTimestamp(): string {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        return (
            `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
            `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
        );
    }
}
