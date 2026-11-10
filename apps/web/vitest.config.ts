import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true, include: ['**/*.test.{ts,tsx}'], exclude: ['node_modules/**', '.next*/**'] },
});
