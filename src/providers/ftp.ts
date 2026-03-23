import { posix } from 'node:path';
import { Client as FtpClient } from 'basic-ftp';
import type { BackupProvider, FtpProviderConfig, RemoteEntry } from './provider.js';

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

    constructor(private readonly config: FtpProviderConfig) {
        this.targetDir = config.targetDir;
    }

    async initialize(): Promise<void> {
        this.client = new FtpClient();

        // Connect and authenticate
        await this.client.access({
            host: this.config.host,
            port: this.config.port,
            user: this.config.username,
            password: this.config.password,
            secure: this.config.tls,
        });

        // Ensure target directory exists
        await this.client.ensureDir(this.targetDir);
        // ensureDir changes the working directory — go back to root
        await this.client.cd('/');
    }

    async upload(localPath: string, remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        await client.uploadFrom(localPath, fullPath);
    }

    async list(remotePath: string): Promise<RemoteEntry[]> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        try {
            const entries = await client.list(fullPath);
            return entries
                .filter((entry) => entry.name !== '.' && entry.name !== '..')
                .map((entry) => ({
                    name: entry.name,
                    isDirectory: entry.isDirectory,
                }));
        } catch (err: unknown) {
            // If directory doesn't exist, return empty list
            if (isFtpNotFound(err)) {
                return [];
            }
            throw err;
        }
    }

    async delete(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        try {
            // Try to remove as directory first (recursive)
            await client.removeDir(fullPath);
        } catch {
            // If removeDir fails, try as a file
            try {
                await client.remove(fullPath);
            } catch (err: unknown) {
                // Ignore "not found" — delete is idempotent
                if (isFtpNotFound(err)) {
                    return;
                }
                throw err;
            }
        }
    }

    async mkdir(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        await client.ensureDir(fullPath);
        // ensureDir changes the working directory — go back to root
        await client.cd('/');
    }

    async dispose(): Promise<void> {
        if (this.client) {
            this.client.close();
            this.client = null;
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
