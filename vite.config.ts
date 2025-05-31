import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'index.ts'),
      name: 'BusNDB',
      fileName: (format) => `index.${format === 'es' ? 'js' : format}`,
      formats: ['es']
    },
    rollupOptions: {
      external: [
        'zod',
        'better-sqlite3',
        '@libsql/client',
        '@types/better-sqlite3',
        '@types/react',
        'ink',
        'ink-select-input', 
        'ink-text-input',
        'react',
        'module',
        'path',
        'fs',
        'url'
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: '.',
        entryFileNames: '[name].js'
      }
    },
    sourcemap: true,
    target: 'node18',
    outDir: 'dist'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  define: {
    global: 'globalThis'
  }
});