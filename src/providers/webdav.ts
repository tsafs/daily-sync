import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createClient, type WebDAVClient, type FileStat } from 'webdav';
import type { BackupProvider, WebDavProviderConfig, RemoteEntry } from './provider.js';
import { type Logger, createSilentLogger } from '../services/logger.js';

/**
 * Backup provider for WebDAV targets.
 * Uses the `webdav` npm package (pure JS). Replaces sync_webdav.sh + rclone.
 *
 * Uploads files using streams to avoid loading entire archives into memory.
 */
export class WebDavProvider implements BackupProvider {
    readonly name = 'webdav';

    private client: WebDAVClient | null = null;
    private targetDir: string;
    private readonly log: Logger;

    constructor(private readonly config: WebDavProviderConfig, logger?: Logger) {
        this.targetDir = config.targetDir;
        this.log = (logger ?? createSilentLogger()).child({ provider: 'webdav' });
    }

    async initialize(): Promise<void> {
        this.log.info({ url: this.config.url, targetDir: this.targetDir }, 'Initializing WebDAV provider');

        this.client = createClient(this.config.url, {
            username: this.config.username,
            password: this.config.password,
        });

        // Ensure the target directory exists on the remote
        await this.mkdir(this.targetDir);
        this.log.info('WebDAV provider initialized');
    }

    async upload(localPath: string, remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        // Stream the file to avoid memory issues with large archives
        const fileStream = createReadStream(localPath);
        const fileStat = await stat(localPath);

        this.log.info({ remotePath, size: fileStat.size }, 'Uploading file');

        await client.putFileContents(fullPath, fileStream, {
            overwrite: true,
            contentLength: fileStat.size,
        });

        this.log.debug({ remotePath, size: fileStat.size }, 'Upload complete');
    }

    async list(remotePath: string): Promise<RemoteEntry[]> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Listing directory');

        try {
            const contents = (await client.getDirectoryContents(fullPath)) as FileStat[];
            const result = contents.map((item) => ({
                name: item.basename,
                isDirectory: item.type === 'directory',
            }));
            this.log.debug({ remotePath, count: result.length }, 'Directory listed');
            return result;
        } catch (err: unknown) {
            // If directory doesn't exist (404), return empty list
            if (isWebDavNotFound(err)) {
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
            await client.deleteFile(fullPath);
            this.log.debug({ remotePath }, 'Delete complete');
        } catch (err: unknown) {
            // Ignore "not found" — delete is idempotent
            if (isWebDavNotFound(err)) {
                this.log.debug({ remotePath }, 'Path not found — nothing to delete');
                return;
            }
            throw err;
        }
    }

    async mkdir(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Creating directory');

        // Create each segment of the path, since WebDAV doesn't support
        // recursive directory creation natively
        const segments = fullPath.split('/').filter(Boolean);
        let currentPath = '/';

        for (const segment of segments) {
            currentPath = posix.join(currentPath, segment);
            try {
                await client.createDirectory(currentPath);
            } catch (err: unknown) {
                // 405 Method Not Allowed = directory already exists on most WebDAV servers
                if (isWebDavAlreadyExists(err)) {
                    continue;
                }
                throw err;
            }
        }
    }

    async download(remotePath: string): Promise<Buffer> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Downloading file for integrity check');
        const content = await client.getFileContents(fullPath, { format: 'binary' });
        const buffer = Buffer.from(content as ArrayBuffer);
        this.log.debug({ remotePath, bytes: buffer.byteLength }, 'Download complete');
        return buffer;
    }

    async dispose(): Promise<void> {
        this.log.debug('Disposing WebDAV provider');
        // The webdav client is stateless (HTTP) — no connection to close
        this.client = null;
    }

    /**
     * Get the initialized client or throw if not initialized.
     */
    private getClient(): WebDAVClient {
        if (!this.client) {
            throw new Error('WebDavProvider not initialized. Call initialize() first.');
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
        // Strip leading slash to avoid path.join ignoring the base
        const relative = remotePath.startsWith('/') ? remotePath.slice(1) : remotePath;
        return posix.join(this.targetDir, relative);
    }
}

/**
 * Check if a WebDAV error is a 404 Not Found.
 */
function isWebDavNotFound(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        return (err as { status: number }).status === 404;
    }
    // Some WebDAV servers return status in the response property
    if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response: { status?: number } }).response;
        return response?.status === 404;
    }
    return false;
}

/**
 * Check if a WebDAV error indicates a resource already exists (405 or 409).
 * 405 = Method Not Allowed (directory exists on most servers)
 * 409 = Conflict — can mean "parent doesn't exist" on some servers, but safe to
 *       treat as "already exists" here because mkdir() creates segments top-down,
 *       so parents are always created before children.
 */
function isWebDavAlreadyExists(err: unknown): boolean {
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status: number }).status;
        return status === 405 || status === 409;
    }
    if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response: { status?: number } }).response;
        return response?.status === 405 || response?.status === 409;
    }
    return false;
}
