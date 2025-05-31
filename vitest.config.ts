import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
    test: {
        // Run tests from the source TypeScript files, not compiled JS
        include: ['test/**/*.test.ts'],
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/test-compiled/**', // Exclude compiled test files
            '**/.{git,cache,output,temp}/**',
            '**/bun-driver-benchmark.test.ts', // Exclude bun-specific tests in Node.js
            '**/benchmark.test.ts', // Exclude benchmark scripts
        ],
        // Use single-threaded mode to avoid issues with SQLite
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        // Set timeout for tests
        testTimeout: 10000,
        // Clean up after each test
        clearMocks: true,
        restoreMocks: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    define: {
        global: 'globalThis',
    },
});
