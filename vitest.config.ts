import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['src/__tests__/**/*.test.ts'],
                    exclude: ['src/__tests__/e2e/**'],
                    pool: 'threads',
                },
            },
            {
                test: {
                    name: 'e2e',
                    include: ['src/__tests__/e2e/**/*.e2e.test.ts'],
                    // forks pool is safer for container teardown (each test file gets its own process)
                    pool: 'forks',
                    testTimeout: 600_000,   // 10 min — image build + real backup can be slow
                    hookTimeout: 600_000,
                },
            },
        ],
    },
});
