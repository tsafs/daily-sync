import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createClient, type WebDAVClient, type FileStat } from 'webdav';
import type { BackupProvider, WebDavProviderConfig, RemoteEntry } from './provider.js';

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

    constructor(private readonly config: WebDavProviderConfig) {
        this.targetDir = config.targetDir;
    }

    async initialize(): Promise<void> {
        this.client = createClient(this.config.url, {
            username: this.config.username,
            password: this.config.password,
        });

        // Ensure the target directory exists on the remote
        await this.mkdir(this.targetDir);
    }

    async upload(localPath: string, remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        // Stream the file to avoid memory issues with large archives
        const fileStream = createReadStream(localPath);
        const fileStat = await stat(localPath);

        await client.putFileContents(fullPath, fileStream, {
            overwrite: true,
            contentLength: fileStat.size,
        });
    }

    async list(remotePath: string): Promise<RemoteEntry[]> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        try {
            const contents = (await client.getDirectoryContents(fullPath)) as FileStat[];
            return contents.map((item) => ({
                name: item.basename,
                isDirectory: item.type === 'directory',
            }));
        } catch (err: unknown) {
            // If directory doesn't exist (404), return empty list
            if (isWebDavNotFound(err)) {
                return [];
            }
            throw err;
        }
    }

    async delete(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

        try {
            await client.deleteFile(fullPath);
        } catch (err: unknown) {
            // Ignore "not found" — delete is idempotent
            if (isWebDavNotFound(err)) {
                return;
            }
            throw err;
        }
    }

    async mkdir(remotePath: string): Promise<void> {
        const client = this.getClient();
        const fullPath = this.resolvePath(remotePath);

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

    async dispose(): Promise<void> {
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
