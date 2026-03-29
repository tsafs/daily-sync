import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import type { BackupProvider } from '../providers/provider.js';
import { type Logger, createSilentLogger } from './logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a single file integrity check.
 */
export interface IntegrityResult {
    /** Absolute path to the local file that was checked */
    localFile: string;
    /** Remote path that was checked */
    remoteFile: string;
    /** SHA-256 hex digest of the local file */
    localChecksum: string;
    /** SHA-256 hex digest of the remote file */
    remoteChecksum: string;
    /** Always `true` — mismatches throw `IntegrityError` rather than return */
    verified: true;
}

// ---------------------------------------------------------------------------
// IntegrityError
// ---------------------------------------------------------------------------

/**
 * Thrown by {@link IntegrityService.verify} when the local and remote
 * SHA-256 checksums do not match after upload.
 *
 * Callers may test `err instanceof IntegrityError` to distinguish this
 * from generic I/O errors.
 */
export class IntegrityError extends Error {
    constructor(
        public readonly remotePath: string,
        public readonly localChecksum: string,
        public readonly remoteChecksum: string,
    ) {
        super(
            `Integrity check failed for "${remotePath}": ` +
            `local=${localChecksum}, remote=${remoteChecksum}`,
        );
        this.name = 'IntegrityError';
    }
}

// ---------------------------------------------------------------------------
// IntegrityService
// ---------------------------------------------------------------------------

/**
 * Post-upload checksum verification service.
 *
 * After each archive volume is uploaded to a provider, call
 * {@link verify} to confirm that the remote copy is bit-for-bit
 * identical to the local file.
 *
 * All providers must implement `download()` — SHA-256 round-trip
 * verification is performed for every backup volume regardless of provider.
 *
 * A mismatch throws {@link IntegrityError} so the calling backup
 * run treats it as a fatal failure and cleans up the incomplete
 * remote directory.
 */
export class IntegrityService {
    private readonly log: Logger;

    constructor(logger?: Logger) {
        this.log = (logger ?? createSilentLogger()).child({ service: 'integrity' });
    }

    /**
     * Verify that a remote file's SHA-256 checksum matches the local source.
     *
     * @param provider   - The provider used for the upload.
     * @param localPath  - Absolute path to the local file that was uploaded.
     * @param remotePath - Remote path where the file was uploaded.
     * @returns {@link IntegrityResult}
     * @throws {@link IntegrityError} if checksums do not match.
     */
    async verify(
        provider: BackupProvider,
        localPath: string,
        remotePath: string,
    ): Promise<IntegrityResult> {
        const localChecksum = await this.computeStreamChecksum(createReadStream(localPath));

        this.log.debug({ provider: provider.name, remotePath }, 'Verifying upload integrity');
        const remoteStream = await provider.download(remotePath);
        const remoteChecksum = await this.computeStreamChecksum(remoteStream);

        if (localChecksum !== remoteChecksum) {
            this.log.error(
                { provider: provider.name, remotePath, localChecksum, remoteChecksum },
                'Integrity check FAILED — checksum mismatch',
            );
            throw new IntegrityError(remotePath, localChecksum, remoteChecksum);
        }

        this.log.debug(
            { provider: provider.name, remotePath, checksum: localChecksum },
            'Integrity check passed',
        );
        return {
            localFile: localPath,
            remoteFile: remotePath,
            localChecksum,
            remoteChecksum,
            verified: true,
        };
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Compute the SHA-256 hex digest of a Readable stream.
     * Streams the data in chunks so arbitrarily large archives do not
     * exhaust memory and the Node.js 2 GiB Buffer limit is never hit.
     */
    private computeStreamChecksum(stream: Readable): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const hash = createHash('sha256');
            stream.on('data', (chunk) => hash.update(chunk as Buffer));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }
}
