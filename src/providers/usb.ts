/**
 * USB backup provider stub.
 *
 * ## Status: NOT IMPLEMENTED
 *
 * This file is a documented skeleton that reserves the extension point and
 * describes exactly how a real USB provider would be built. It was created
 * as part of step 18 (architecture extensibility preparation). No runtime
 * code in the application currently references it.
 *
 * ## Design
 *
 * A `UsbProvider` follows the same `BackupProvider` interface as the three
 * production providers (Disk, WebDAV, FTP). The implementation strategy:
 *
 * 1. **Detect** — on `initialize()`, wait for a USB block device to appear
 *    (poll `/dev/disk/by-id/` or listen to udev events via `node-usb`).
 * 2. **Mount** — `child_process.execFile('mount', [...])` to attach the
 *    device to a temp path created with `fs.mkdtemp()`.
 * 3. **Delegate** — construct a `DiskProvider` with `targetDir` = the mount
 *    point (plus optional sub-directory). All `upload`, `list`, `delete`,
 *    `mkdir`, and `download` calls are forwarded to that `DiskProvider`
 *    instance, so deduplication, checksums, and retention logic in the
 *    orchestrator are inherited for free.
 * 4. **Dispose** — unmount the device (`umount`), then clean up the temp
 *    mount directory.
 *
 * Because all file operations delegate to `DiskProvider`, no changes are
 * needed in the archiver, retention service, integrity service, scheduler,
 * or orchestrator to support USB targets. Only three future changes would be
 * required:
 * - Add `UsbProviderConfig` to the `AnyProviderConfig` union in `provider.ts`
 * - Add a `case 'usb'` branch to `createProvider()` in `index.ts`
 * - Parse `SYNC_MODE=usb` and its env vars in `config.ts`
 *
 * ## Suggested implementation dependencies
 *
 * - `node-usb` (npm) — udev event listener for hot-plug detection
 * - Alternatively: poll `/dev/disk/by-id/` with `fs.readdir()` at a
 *   configurable interval (no native binding, works in Docker if
 *   `/dev` is bind-mounted)
 * - `child_process.execFile` for `mount` / `umount` (already used by
 *   the archiver service — no new pattern needed)
 *
 * @module
 */

import type { BackupProvider, RemoteEntry } from './provider.js';
import type { Logger } from '../services/logger.js';

// ---------------------------------------------------------------------------
// Config type (intentionally NOT added to AnyProviderConfig yet)
// ---------------------------------------------------------------------------

/**
 * Configuration for the UsbProvider.
 *
 * When USB support is production-ready, add this type to the
 * `AnyProviderConfig` union in `provider.ts` and parse its env vars
 * in `config.ts`.
 */
export interface UsbProviderConfig {
    name: 'usb';
    /**
     * Optional udev device identifier to target a specific USB drive.
     * Corresponds to a symlink under `/dev/disk/by-id/`.
     * When omitted, the first USB storage device that appears is used.
     *
     * @example 'usb-Samsung_T7_SSD_S123ABC-0:0'
     */
    deviceId?: string;
    /**
     * How long to wait for the USB device to appear before giving up
     * (in milliseconds). Defaults to 30 000 (30 s).
     */
    detectionTimeoutMs?: number;
    /**
     * Sub-directory path inside the mount point to use as the backup
     * root. Allows sharing a USB drive with other data without
     * polluting the root.
     *
     * @example 'daily-sync'
     * @default ''  (use the mount root)
     */
    targetSubDir?: string;
}

// ---------------------------------------------------------------------------
// Provider stub
// ---------------------------------------------------------------------------

/**
 * Stub USB backup provider.
 *
 * Implements the full `BackupProvider` interface so the TypeScript compiler
 * verifies conformance. Every method throws "not implemented" at runtime.
 *
 * Replace each method body with the approach documented in the JSDoc when
 * implementing for real.
 */
export class UsbProvider implements BackupProvider {
    readonly name = 'usb' as const;

    /**
     * @param config - USB-specific configuration
     * @param logger - Optional structured logger; if omitted the provider
     *   is silent (same pattern as DiskProvider / WebDavProvider)
     */
    constructor(
        private readonly config: UsbProviderConfig,
        private readonly logger?: Logger,
    ) { }

    /**
     * Detect the USB device and mount it to a temp directory.
     *
     * Real implementation outline:
     * ```
     * 1. const mountPoint = await fs.mkdtemp(join(tmpdir(), 'usb-backup-'))
     * 2. const device = await detectUsbDevice(config.deviceId, config.detectionTimeoutMs)
     *    // polls /dev/disk/by-id/ until the device symlink appears, or times out
     * 3. await execFile('mount', ['-o', 'ro', device, mountPoint])
     *    // mount read-write for the first time, read-only for verify pass
     * 4. const targetDir = config.targetSubDir
     *       ? join(mountPoint, config.targetSubDir)
     *       : mountPoint
     * 5. this.delegate = new DiskProvider({ name: 'disk', targetDir }, logger)
     * 6. await this.delegate.initialize()
     * 7. this.mountPoint = mountPoint  // saved for dispose()
     * ```
     */
    async initialize(): Promise<void> {
        throw new Error(
            'UsbProvider.initialize() is not implemented. ' +
            'See the module-level JSDoc in src/providers/usb.ts for the implementation guide.',
        );
    }

    /**
     * Upload a local file to the USB drive.
     *
     * Real implementation: delegates directly to `this.delegate.upload(localPath, remotePath)`.
     * The `DiskProvider` handles parent-directory creation and ownership matching.
     */
    async upload(_localPath: string, _remotePath: string): Promise<void> {
        throw new Error(
            'UsbProvider.upload() is not implemented. ' +
            'Delegate to the internal DiskProvider after initialize() mounts the device.',
        );
    }

    /**
     * List entries in a directory on the USB drive.
     *
     * Real implementation: delegates to `this.delegate.list(remotePath)`.
     */
    async list(_remotePath: string): Promise<RemoteEntry[]> {
        throw new Error(
            'UsbProvider.list() is not implemented. ' +
            'Delegate to the internal DiskProvider after initialize() mounts the device.',
        );
    }

    /**
     * Delete a file or directory on the USB drive.
     *
     * Real implementation: delegates to `this.delegate.delete(remotePath)`.
     */
    async delete(_remotePath: string): Promise<void> {
        throw new Error(
            'UsbProvider.delete() is not implemented. ' +
            'Delegate to the internal DiskProvider after initialize() mounts the device.',
        );
    }

    /**
     * Create a directory on the USB drive.
     *
     * Real implementation: delegates to `this.delegate.mkdir(remotePath)`.
     */
    async mkdir(_remotePath: string): Promise<void> {
        throw new Error(
            'UsbProvider.mkdir() is not implemented. ' +
            'Delegate to the internal DiskProvider after initialize() mounts the device.',
        );
    }

    /**
     * Download a file from the USB drive for integrity verification.
     *
     * Real implementation: delegates to `this.delegate.download(remotePath)`.
     * SHA-256 verification works identically to the DiskProvider path.
     */
    async download(_remotePath: string): Promise<Buffer> {
        throw new Error(
            'UsbProvider.download() is not implemented. ' +
            'Delegate to the internal DiskProvider after initialize() mounts the device.',
        );
    }

    /**
     * Unmount the USB device and clean up the temp mount directory.
     *
     * Real implementation outline:
     * ```
     * 1. await this.delegate?.dispose()           // flush any pending I/O
     * 2. await sync()                              // execFile('sync') — flush kernel buffers
     * 3. await execFile('umount', [this.mountPoint])
     * 4. await fs.rmdir(this.mountPoint)           // remove temp dir
     * 5. this.mountPoint = undefined
     * 6. this.delegate = undefined
     * ```
     *
     * Safe to call multiple times (idempotent).
     */
    async dispose(): Promise<void> {
        throw new Error(
            'UsbProvider.dispose() is not implemented. ' +
            'Unmount the device and clean up the temp mount directory.',
        );
    }
}
