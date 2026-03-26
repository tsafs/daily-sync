import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        pool: 'threads',
        poolOptions: {
            threads: {
                maxThreads: 2,
                minThreads: 1,
            },
        },
    },
});
