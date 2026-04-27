import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // Pure-helper tests don't need a browser-like env. Keep node for speed
    // and to avoid pulling in jsdom unless React component tests get added.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
