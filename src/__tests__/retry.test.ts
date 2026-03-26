import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../services/retry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Zero-delay retry options — avoids real waits in unit tests. */
const noDelay = { delays: [0, 0, 0] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withRetry', () => {
    // -- Success paths ------------------------------------------------------

    it('returns the value when fn succeeds on the first attempt', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn, noDelay);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns the value when fn succeeds on the second attempt', async () => {
        let calls = 0;
        const fn = vi.fn().mockImplementation(async () => {
            calls++;
            if (calls < 2) throw new Error('transient');
            return 'recovered';
        });

        const result = await withRetry(fn, noDelay);
        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('returns the value when fn succeeds on the last allowed attempt', async () => {
        let calls = 0;
        const fn = vi.fn().mockImplementation(async () => {
            calls++;
            if (calls < 3) throw new Error('transient');
            return 'final-attempt-success';
        });

        const result = await withRetry(fn, { ...noDelay, maxAttempts: 3 });
        expect(result).toBe('final-attempt-success');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    // -- Failure paths ------------------------------------------------------

    it('throws the last error after exhausting all attempts', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('always fails'));

        await expect(withRetry(fn, noDelay)).rejects.toThrow('always fails');
        // Default maxAttempts = 3
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws the last error (not the first) when each attempt throws differently', async () => {
        let calls = 0;
        const fn = vi.fn().mockImplementation(async () => {
            calls++;
            throw new Error(`error ${calls}`);
        });

        await expect(withRetry(fn, { ...noDelay, maxAttempts: 3 })).rejects.toThrow('error 3');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    // -- maxAttempts override -----------------------------------------------

    it('respects a custom maxAttempts of 1 (no retries)', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetry(fn, { maxAttempts: 1, delays: [] })).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('respects a custom maxAttempts of 5', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('persistent'));

        await expect(withRetry(fn, { maxAttempts: 5, delays: [0, 0, 0, 0] }))
            .rejects.toThrow('persistent');
        expect(fn).toHaveBeenCalledTimes(5);
    });

    // -- Delay fallback behaviour -------------------------------------------

    it('uses the last delay when delays array is shorter than maxAttempts - 1', async () => {
        // maxAttempts=4 needs 3 delays; provide only 1 — last should be reused
        const delays = [0]; // only one delay specified
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        // Should complete without hanging (all delays are 0, just verifying no
        // index-out-of-bounds issues)
        await expect(withRetry(fn, { maxAttempts: 4, delays })).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it('handles an empty delays array without throwing', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetry(fn, { maxAttempts: 3, delays: [] })).rejects.toThrow('fail');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    // -- onRetry callback ---------------------------------------------------

    it('calls onRetry before each retry attempt with correct attempt number and error', async () => {
        const retryEvents: { attempt: number; error: unknown }[] = [];
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(
            withRetry(fn, {
                ...noDelay,
                maxAttempts: 3,
                onRetry: (attempt, error) => retryEvents.push({ attempt, error }),
            }),
        ).rejects.toThrow('fail');

        // onRetry should be called twice: before attempt 2 and before attempt 3
        expect(retryEvents).toHaveLength(2);
        expect(retryEvents[0]!.attempt).toBe(2);
        expect(retryEvents[0]!.error).toBeInstanceOf(Error);
        expect((retryEvents[0]!.error as Error).message).toBe('fail');
        expect(retryEvents[1]!.attempt).toBe(3);
    });

    it('does not call onRetry on first-attempt success', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn().mockResolvedValue('ok');

        await withRetry(fn, { ...noDelay, onRetry });
        expect(onRetry).not.toHaveBeenCalled();
    });

    it('does not call onRetry on the final failed attempt (no more retries)', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        // maxAttempts=2: one retry (onRetry called once before attempt 2),
        // then failure — no onRetry call after the final attempt
        await expect(withRetry(fn, { maxAttempts: 2, delays: [0], onRetry })).rejects.toThrow('fail');
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error));
    });

    // -- Return type propagation -------------------------------------------

    it('correctly propagates the resolved type', async () => {
        const payload = { id: 42, name: 'result' };
        const fn = vi.fn<() => Promise<typeof payload>>().mockResolvedValue(payload);
        const result = await withRetry(fn, noDelay);
        expect(result.id).toBe(42);
        expect(result.name).toBe('result');
    });
});
