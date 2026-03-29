import { createReadStream } from 'node:fs';
import { copyFile, readdir, mkdir, rm, stat, chown } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { BackupProvider, DiskProviderConfig, RemoteEntry } from './provider.js';
import { type Logger, createSilentLogger } from '../services/logger.js';

/**
 * Backup provider for local/NAS directory targets.
 * Uses fs/promises for all operations. Replaces sync_directory.sh.
 *
 * Handles ownership matching: after copying a file, the new file's
 * uid/gid is set to match the target directory's owner.
 */
export class DiskProvider implements BackupProvider {
    readonly name = 'disk';

    private targetDir: string;
    private ownerUid: number | undefined;
    private ownerGid: number | undefined;
    private readonly log: Logger;

    constructor(private readonly config: DiskProviderConfig, logger?: Logger) {
        this.targetDir = config.targetDir;
        this.log = (logger ?? createSilentLogger()).child({ provider: 'disk' });
    }

    async initialize(): Promise<void> {
        this.log.info({ targetDir: this.targetDir }, 'Initializing disk provider');

        // Ensure target directory exists
        await mkdir(this.targetDir, { recursive: true });

        // Read ownership from the target directory for later chown
        try {
            const stats = await stat(this.targetDir);
            this.ownerUid = stats.uid;
            this.ownerGid = stats.gid;
            this.log.debug({ uid: stats.uid, gid: stats.gid }, 'Target directory ownership detected');
        } catch {
            // If we can't stat (shouldn't happen after mkdir), skip ownership matching
            this.ownerUid = undefined;
            this.ownerGid = undefined;
            this.log.warn('Could not detect target directory ownership — skipping chown');
        }

        this.log.info('Disk provider initialized');
    }

    async upload(localPath: string, remotePath: string): Promise<void> {
        const fullPath = this.resolvePath(remotePath);
        this.log.info({ remotePath }, 'Uploading file');

        // Ensure parent directory exists
        await mkdir(dirname(fullPath), { recursive: true });

        // Copy file to target
        await copyFile(localPath, fullPath);

        // Match ownership to target directory
        await this.matchOwnership(fullPath);
        this.log.debug({ remotePath }, 'Upload complete');
    }

    async list(remotePath: string): Promise<RemoteEntry[]> {
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Listing directory');

        try {
            const entries = await readdir(fullPath, { withFileTypes: true });
            const result = entries.map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
            }));
            this.log.debug({ remotePath, count: result.length }, 'Directory listed');
            return result;
        } catch (err: unknown) {
            // If directory doesn't exist, return empty list
            if (isNodeError(err) && err.code === 'ENOENT') {
                this.log.debug({ remotePath }, 'Directory does not exist — returning empty list');
                return [];
            }
            throw err;
        }
    }

    async delete(remotePath: string): Promise<void> {
        const fullPath = this.resolvePath(remotePath);
        this.log.info({ remotePath }, 'Deleting path');

        try {
            await rm(fullPath, { recursive: true, force: true });
            this.log.debug({ remotePath }, 'Delete complete');
        } catch (err: unknown) {
            // Ignore "not found" — delete is idempotent
            if (isNodeError(err) && err.code === 'ENOENT') {
                this.log.debug({ remotePath }, 'Path not found — nothing to delete');
                return;
            }
            throw err;
        }
    }

    async mkdir(remotePath: string): Promise<void> {
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Creating directory');
        await mkdir(fullPath, { recursive: true });
        await this.matchOwnership(fullPath);
    }

    async download(remotePath: string): Promise<import('node:stream').Readable> {
        const fullPath = this.resolvePath(remotePath);
        this.log.debug({ remotePath }, 'Downloading file for integrity check');
        // Use a read stream so files larger than the Node.js 2 GiB Buffer limit work.
        const stream = createReadStream(fullPath);
        stream.once('close', () => this.log.debug({ remotePath }, 'Download complete'));
        return stream;
    }

    async dispose(): Promise<void> {
        this.log.debug('Disposing disk provider');
        // No resources to release for local filesystem
    }

    /**
     * Resolve a remote path relative to the target directory.
     * If the path is already absolute and starts with targetDir, use as-is.
     * Otherwise, join with targetDir.
     */
    private resolvePath(remotePath: string): string {
        if (remotePath.startsWith(this.targetDir)) {
            return remotePath;
        }
        // Strip leading slash to avoid path.join ignoring the base
        const relative = remotePath.startsWith('/') ? remotePath.slice(1) : remotePath;
        return join(this.targetDir, relative);
    }

    /**
     * Set file/directory ownership to match the target directory.
     * Silently skips if ownership info isn't available or if
     * the process lacks permission (e.g. not running as root).
     */
    private async matchOwnership(path: string): Promise<void> {
        if (this.ownerUid === undefined || this.ownerGid === undefined) {
            return;
        }
        try {
            await chown(path, this.ownerUid, this.ownerGid);
        } catch {
            // chown requires root — silently skip if not permitted
        }
    }
}

/**
 * Type guard for Node.js system errors (which have a `code` property).
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
    return err instanceof Error && 'code' in err;
}
