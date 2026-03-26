/**
 * Retry service — exponential-backoff wrapper for async operations.
 *
 * `withRetry` retries a failing async function up to `maxAttempts` times,
 * sleeping between each attempt using the provided `delays` array.
 *
 * In the backup orchestrator it is used to wrap `provider.upload()` for
 * each archive volume. `integrity.verify()` is intentionally NOT wrapped —
 * a checksum mismatch after successful upload retries is a hard failure
 * that should propagate immediately so the incomplete remote directory can
 * be cleaned up.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for {@link withRetry}.
 */
export interface RetryOptions {
    /**
     * Maximum number of total attempts (including the first try).
     * @default 3
     */
    maxAttempts?: number;

    /**
     * Delays (in milliseconds) between consecutive attempts.
     *
     * `delays[0]` is the wait before the 2nd attempt, `delays[1]` before
     * the 3rd, and so on.  If the array is shorter than `maxAttempts - 1`,
     * the last element is reused for any remaining gaps.
     *
     * @default [5000, 15000, 45000]
     */
    delays?: readonly number[];

    /**
     * Optional callback invoked **before** each retry attempt (not before
     * the first attempt).
     *
     * Receives the 1-based attempt number that is *about to run* (so the
     * first retry = `attempt: 2`) and the error that caused the previous
     * attempt to fail.
     */
    onRetry?: (attempt: number, error: unknown) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default total attempts. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Default inter-attempt delays (ms): 5 s, 15 s, 45 s. */
const DEFAULT_DELAYS: readonly number[] = [5_000, 15_000, 45_000];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Pause for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn()` and retry up to `maxAttempts - 1` additional times on
 * failure, sleeping between attempts according to `delays`.
 *
 * Returns the resolved value of `fn()` on success.
 * Re-throws the **last** error if all attempts are exhausted.
 *
 * @example
 * // Wrap a single upload call:
 * await withRetry(() => provider.upload(localFile, remotePath));
 *
 * @example
 * // Zero-delay variant for tests:
 * await withRetry(() => provider.upload(f, r), { delays: [0, 0] });
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions,
): Promise<T> {
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const delays = options?.delays ?? DEFAULT_DELAYS;
    const onRetry = options?.onRetry;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt >= maxAttempts) {
                // All attempts exhausted — propagate the last error.
                break;
            }

            // Determine the delay before the next attempt.
            const delayIndex = attempt - 1; // 0-based
            const delayMs = delayIndex < delays.length
                ? delays[delayIndex]!
                : delays[delays.length - 1] ?? 0;

            onRetry?.(attempt + 1, err);

            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }
    }

    throw lastError;
}
