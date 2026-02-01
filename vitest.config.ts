import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { webcrypto } from 'node:crypto';

// Polyfill Web Crypto API for Node.js environment
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto as Crypto;
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts'],
    },
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
