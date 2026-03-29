/**
 * Shared helper for E2E tests: generates a directory with random binary files
 * that together exceed the given size threshold.
 *
 * Random data is incompressible, and when combined with `encrypt: true` in 7z,
 * the resulting archive is guaranteed to be ≥ the input size — which is exactly
 * what we need to reproduce the ERR_FS_FILE_TOO_LARGE bug (Node.js 2 GiB
 * Buffer limit in readFile).
 */
import { createWriteStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

/** Size of each chunk written at a time (64 MiB). */
const CHUNK_SIZE = 64 * 1024 * 1024;

/**
 * Generate `fileCount` files of random data inside `dir`, totalling
 * approximately `totalMb` megabytes.
 *
 * Uses streaming writes to avoid allocating a multi-GiB buffer.
 */
export async function generateTestData(
    dir: string,
    totalMb: number,
    fileCount = 3,
): Promise<void> {
    const perFileMb = Math.ceil(totalMb / fileCount);
    const perFileBytes = perFileMb * 1024 * 1024;

    const writes: Promise<void>[] = [];

    for (let i = 0; i < fileCount; i++) {
        const filePath = join(dir, `testdata_${String(i).padStart(2, '0')}.bin`);
        writes.push(writeRandomFile(filePath, perFileBytes));
    }

    await Promise.all(writes);
}

async function writeRandomFile(filePath: string, bytes: number): Promise<void> {
    let remaining = bytes;

    const source = new Readable({
        read() {
            if (remaining <= 0) {
                this.push(null);
                return;
            }
            const size = Math.min(CHUNK_SIZE, remaining);
            const buf = randomBytes(size);
            remaining -= size;
            this.push(buf);
        },
    });

    await pipeline(source, createWriteStream(filePath));
}
