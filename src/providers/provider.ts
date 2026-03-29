import type { Readable } from 'node:stream';

/**
 * Base configuration shared by all providers.
 */
export interface ProviderConfig {
    /** Human-readable provider name for logging */
    name: string;
}

/**
 * Configuration for the DiskProvider (local/NAS directory).
 */
export interface DiskProviderConfig extends ProviderConfig {
    name: 'disk';
    /** Absolute path to the target backup directory */
    targetDir: string;
}

/**
 * Configuration for the WebDavProvider.
 */
export interface WebDavProviderConfig extends ProviderConfig {
    name: 'webdav';
    /** WebDAV server URL (e.g. https://cloud.example.com/remote.php/dav/files/user) */
    url: string;
    username: string;
    password: string;
    /** Remote directory path on the WebDAV server */
    targetDir: string;
}

/**
 * Configuration for the FtpProvider.
 */
export interface FtpProviderConfig extends ProviderConfig {
    name: 'ftp';
    /** FTP server hostname */
    host: string;
    /** FTP server port (default: 21) */
    port: number;
    username: string;
    password: string;
    /** Remote directory path on the FTP server */
    targetDir: string;
    /** Whether to use TLS (default: true) */
    tls: boolean;
}

/**
 * Discriminated union of all provider configs.
 * The `name` field acts as the discriminant.
 */
export type AnyProviderConfig =
    | DiskProviderConfig
    | WebDavProviderConfig
    | FtpProviderConfig;

/**
 * Metadata about a remote file entry returned by `list()`.
 */
export interface RemoteEntry {
    /** File or directory name (not full path) */
    name: string;
    /** Whether this entry is a directory */
    isDirectory: boolean;
}

/**
 * The plugin contract every backup target must implement.
 *
 * Providers are intentionally minimal — they handle only transport.
 * Archiving, retention, scheduling, and integrity are handled by
 * services that compose over providers.
 */
export interface BackupProvider {
    /** Human-readable provider name (e.g. 'disk', 'webdav', 'ftp') */
    readonly name: string;

    /**
     * Initialize the provider (connect, authenticate, validate target path).
     * Must be called before any other method.
     */
    initialize(): Promise<void>;

    /**
     * Upload a local file to a remote path.
     * @param localPath - Absolute path to the local file
     * @param remotePath - Full remote path including filename
     */
    upload(localPath: string, remotePath: string): Promise<void>;

    /**
     * List entries in a remote directory.
     * @param remotePath - Full remote directory path
     * @returns Array of entries (files and directories) in the directory
     */
    list(remotePath: string): Promise<RemoteEntry[]>;

    /**
     * Delete a remote file or directory (recursive for directories).
     * @param remotePath - Full remote path to delete
     */
    delete(remotePath: string): Promise<void>;

    /**
     * Create a remote directory (and parent directories if needed).
     * @param remotePath - Full remote directory path to create
     */
    mkdir(remotePath: string): Promise<void>;

    /**
     * Download a remote file and return its content as a Readable stream.
     *
     * Required by all providers to support post-upload integrity
     * verification. After each archive volume is uploaded, the
     * {@link IntegrityService} streams it and compares its SHA-256
     * checksum against the local file. Streaming avoids the Node.js
     * 2 GiB Buffer limit for large archives.
     *
     * @param remotePath - Full remote path to the file
     * @returns File content as a Node.js Readable stream
     */
    download(remotePath: string): Promise<Readable>;

    /**
     * Clean up resources (close connections, release handles).
     * Safe to call multiple times.
     */
    dispose(): Promise<void>;
}
