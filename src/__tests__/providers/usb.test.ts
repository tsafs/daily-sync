/**
 * Tests for the UsbProvider stub.
 *
 * ## What these tests cover
 *
 * 1. **Type conformance** — `UsbProvider` satisfies the `BackupProvider`
 *    interface at compile time. This is the primary value of the stub: it
 *    prevents the provider from drifting off-interface as the rest of the
 *    codebase evolves.
 *
 * 2. **Stub contract** — every method throws a descriptive "not implemented"
 *    error at runtime. This ensures a half-wired USB provider fails loudly
 *    rather than silently producing corrupt backups.
 *
 * ## Integration tests (future, when fully implemented)
 *
 * Replace the stub tests below with real integration tests once the provider
 * is implemented. Suggested test structure:
 *
 * ```
 * describe('UsbProvider (integration)', () => {
 *   // Requires: a real or loop-device USB mount visible in the test environment
 *   // Setup: create an ext4 loop device with mktemp + dd + mkfs.ext4
 *
 *   it('initialize() mounts the device to a temp directory')
 *   it('upload() writes a file to the mount point via DiskProvider')
 *   it('list() returns files on the mounted device via DiskProvider')
 *   it('delete() removes a path on the mounted device via DiskProvider')
 *   it('mkdir() creates a directory on the mounted device via DiskProvider')
 *   it('download() reads back a file for integrity verification')
 *   it('dispose() unmounts the device and removes the temp mount directory')
 *   it('dispose() is idempotent — safe to call more than once')
 *   it('initialize() times out if no USB device appears within detectionTimeoutMs')
 * })
 * ```
 */

import { describe, it, expect } from 'vitest';
import { UsbProvider, type UsbProviderConfig } from '../../providers/usb.js';
import type { BackupProvider } from '../../providers/provider.js';

// ---------------------------------------------------------------------------
// Compile-time type check
//
// Assigning UsbProvider to BackupProvider verifies the class satisfies the
// interface without any type assertions. If the BackupProvider interface gains
// a new required method, this line produces a compile error that forces the
// stub to be updated before the tests can run.
// ---------------------------------------------------------------------------

/**
 * Type-level assertion: UsbProvider satisfies BackupProvider.
 * This is intentionally unused at runtime — its value is entirely at
 * compile time via the explicit annotation.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _typeCheck: new (config: UsbProviderConfig) => BackupProvider = UsbProvider;

// ---------------------------------------------------------------------------
// Runtime stub contract tests
// ---------------------------------------------------------------------------

describe('UsbProvider (stub)', () => {
    const config: UsbProviderConfig = { name: 'usb' };

    it('has the correct provider name', () => {
        const provider = new UsbProvider(config);
        expect(provider.name).toBe('usb');
    });

    it('initialize() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.initialize()).rejects.toThrow(/not implemented/i);
    });

    it('upload() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.upload('/tmp/file.7z', '/backup/file.7z')).rejects.toThrow(
            /not implemented/i,
        );
    });

    it('list() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.list('/backup')).rejects.toThrow(/not implemented/i);
    });

    it('delete() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.delete('/backup/old')).rejects.toThrow(/not implemented/i);
    });

    it('mkdir() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.mkdir('/backup/new')).rejects.toThrow(/not implemented/i);
    });

    it('download() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.download('/backup/file.7z')).rejects.toThrow(/not implemented/i);
    });

    it('dispose() throws a not-implemented error', async () => {
        const provider = new UsbProvider(config);
        await expect(provider.dispose()).rejects.toThrow(/not implemented/i);
    });

    it('accepts an optional deviceId in config', () => {
        const configWithDevice: UsbProviderConfig = {
            name: 'usb',
            deviceId: 'usb-Samsung_T7_SSD_S123ABC-0:0',
            detectionTimeoutMs: 60_000,
            targetSubDir: 'daily-sync',
        };
        // Config shape compiles cleanly and is stored on the instance
        const provider = new UsbProvider(configWithDevice);
        expect(provider.name).toBe('usb');
    });
});
