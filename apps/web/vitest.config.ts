import * as path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests for the web app. These exist because three bugs reached
 * production as blank form fields: the forms hydrate from several requests
 * that finish in an order nothing guarantees, and neither `tsc` nor eslint
 * can see a value a browser drops at runtime.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
