import { posix } from 'node:path';
import { Writable } from 'node:stream';
import { Client as FtpClient } from 'basic-ftp';
import type { BackupProvider, FtpProviderConfig, RemoteEntry } from './provider.js';
import { type Logger, createSilentLogger } from '../services/logger.js';

/**
 * Backup provider for FTP targets.
 * Uses the `basic-ftp` npm package (pure JS, supports TLS). Replaces sync_ftp.sh + lftp.
 *
 * Maintains a single persistent connection with proper cleanup.
 * Eliminates the memory leak risk from spawning lftp subprocesses.
 */
export class FtpProvider implements BackupProvider {
    readonly name = 'ftp';

    private client: FtpClient | null = null;
    private targetDir: string;
    private readonly log: Logger;

    constructor(private readonly config: FtpProviderConfig, logger?: Logger) {
        this.targetDir = config.targetDir;
        this.log = (logger ?? createSilentLogger()).child({ provider: 'ftp' });
    }

    async initialize(): Promise<void> {
        this.log.info(
            { host: this.config.host, port: this.config.port, tls: this.config.tls, targetDir: this.targetDir },
            'Initializing FTP provider',
        );

        this.client = new FtpClient();

        // Connect and authenticate
        await this.client.access({
            host: this.config.host,
            port: this.config.port,
            user: this.config.username,
            password: this.config.password,
            secure: this.config.tls,
        });

        this.log.debug('FTP connection established');

        // Ensure target directory exists
        await this.client.ensureDir(this.targetDir);
        // ensureDir changes the working directory — go back to root
        await this.client.cd('/');

        this.log.info('FTP provider initialized');
    }

    async upload(localPath: string, remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.info({ remotePath }, 'Uploading file');

        await client.uploadFrom(localPath, fullPath);
        this.log.debug({ remotePath }, 'Upload complete');
    }

    async list(remotePath: string): Promise<RemoteEntry[]> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Listing directory');

        try {
            const entries = await client.list(fullPath);
            const result = entries
                .filter((entry) => entry.name !== '.' && entry.name !== '..')
                .map((entry) => ({
                    name: entry.name,
                    isDirectory: entry.isDirectory,
                }));
            this.log.debug({ remotePath, count: result.length }, 'Directory listed');
            return result;
        } catch (err: unknown) {
            // If directory doesn't exist, return empty list
            if (isFtpNotFound(err)) {
                this.log.debug({ remotePath }, 'Directory not found — returning empty list');
                return [];
            }
            throw err;
        }
    }

    async delete(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.info({ remotePath }, 'Deleting path');

        try {
            // Try to remove as directory first (recursive)
            await client.removeDir(fullPath);
            this.log.debug({ remotePath }, 'Directory deleted');
        } catch {
            // If removeDir fails, try as a file
            try {
                await client.remove(fullPath);
                this.log.debug({ remotePath }, 'File deleted');
            } catch (err: unknown) {
                // Ignore "not found" — delete is idempotent
                if (isFtpNotFound(err)) {
                    this.log.debug({ remotePath }, 'Path not found — nothing to delete');
                    return;
                }
                throw err;
            }
        }
    }

    async mkdir(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Creating directory');

        await client.ensureDir(fullPath);
        // ensureDir changes the working directory — go back to root
        await client.cd('/');
    }

    async download(remotePath: string): Promise<Buffer> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Downloading file for integrity check');

        const chunks: Buffer[] = [];
        const writable = new Writable({
            write(chunk, _encoding, callback) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
                callback();
            },
        });

        await client.downloadTo(writable, fullPath);
        const buffer = Buffer.concat(chunks);
        this.log.debug({ remotePath, bytes: buffer.byteLength }, 'Download complete');
        return buffer;
    }

    async dispose(): Promise<void> {
        this.log.debug('Disposing FTP provider');
        if (this.client) {
            this.client.close();
            this.client = null;
            this.log.info('FTP connection closed');
        }
    }

    /**
     * Get the initialized client or throw if not initialized.
     */
    private getClient(): FtpClient {
        if (!this.client) {
            throw new Error('FtpProvider not initialized. Call initialize() first.');
        }
        return this.client;
    }

    /**
     * Resolve a remote path relative to the target directory.
     */
    private resolvePath(remotePath: string): string {
        if (remotePath.startsWith(this.targetDir)) {
            return remotePath;
        }
        const relative = remotePath.startsWith('/') ? remotePath.slice(1) : remotePath;
        return posix.join(this.targetDir, relative);
    }
}

/**
 * Check if an FTP error indicates "not found" (550 is the typical code).
 */
function isFtpNotFound(err: unknown): boolean {
    if (err instanceof Error) {
        const message = err.message.toLowerCase();
        // FTP 550 = "Requested action not taken. File unavailable"
        return message.includes('550') || message.includes('no such file') || message.includes('not found');
    }
    return false;
}
