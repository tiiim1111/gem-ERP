import type { NextConfig } from 'next';
import { z } from 'zod';

// By default the browser calls the API through THIS server (same-origin
// /api/v1 → proxied below), so any hostname works — localhost, a LAN IP, a
// future domain — with no rebuild and no cross-site cookie issues. Setting
// NEXT_PUBLIC_API_URL switches back to direct absolute-URL calls.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
if (apiUrl !== '') {
  const parsed = z.string().url().safeParse(apiUrl);
  if (!parsed.success) {
    throw new Error(
      `Invalid NEXT_PUBLIC_API_URL: ${JSON.stringify(apiUrl)} — must be an absolute URL such as http://localhost:3001`,
    );
  }
}

// Where the proxy forwards API calls; server-side only, resolved at build.
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
    ];
  },
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
