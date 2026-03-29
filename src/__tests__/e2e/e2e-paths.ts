/**
 * Shared path constants for E2E tests.
 *
 * All temporary data (generated source files, archive staging, target dirs)
 * lives under <project root>/.e2e-tmp/ instead of /tmp.  This avoids
 * filling up a small /tmp partition during the ≥2 GiB test runs.
 *
 * .e2e-tmp is listed in .gitignore and .dockerignore.
 */
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

/** Absolute path to the project root (3 levels up from src/__tests__/e2e/). */
export const PROJECT_ROOT = join(__filename, '..', '..', '..', '..');

/** Absolute path to the shared E2E temp directory. */
export const E2E_TMP = join(PROJECT_ROOT, '.e2e-tmp');

/** Ensure .e2e-tmp exists (idempotent). */
export async function ensureE2eTmpDir(): Promise<string> {
    await mkdir(E2E_TMP, { recursive: true });
    return E2E_TMP;
}
