import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    build: {
        lib: {
            entry: resolve(__dirname, 'index.ts'),
            name: 'BusNDB',
            fileName: (format) => `index.${format === 'es' ? 'js' : format}`,
            formats: ['es'],
        },
        rollupOptions: {
            external: [
                'zod',
                'better-sqlite3',
                '@libsql/client',
                '@types/better-sqlite3',
                'module',
                'path',
                'fs',
                'url',
            ],
            output: {
                preserveModules: true,
                preserveModulesRoot: '.',
                entryFileNames: '[name].js',
            },
        },
        sourcemap: true,
        target: 'node18',
        outDir: 'dist',
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 3,
                drop_console: true,
                drop_debugger: true,
                ecma: 2020,
                module: true,
            },
            mangle: {
                properties: {
                    regex: /^_/, // mangle properties starting with _
                },
                toplevel: true,
            },
            format: {
                comments: false,
            },
        },
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
