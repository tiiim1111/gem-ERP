import type { NextConfig } from 'next';
import { z } from 'zod';

// Fail fast at process start (dev server / build / prod server) if the
// browser-exposed API URL is malformed. The default matches local development
// (apps/api listens on 3001); the client normalizes the /api/v1 suffix.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const parsed = z.string().url().safeParse(apiUrl);
if (!parsed.success) {
  throw new Error(
    `Invalid NEXT_PUBLIC_API_URL: ${JSON.stringify(apiUrl)} — must be an absolute URL such as http://localhost:3001`,
  );
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @gemerp/shared ships compiled CJS; transpiling keeps it bundler-friendly
  // for both server and client output without extra configuration.
  transpilePackages: ['@gemerp/shared'],
  eslint: {
    // Linting runs as its own turbo task (`pnpm lint`) with the monorepo's
    // flat config; next build should not run a second, differently-configured
    // ESLint pass.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
