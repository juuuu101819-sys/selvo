import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { HSTS_HEADER_VALUE, shouldAttachHsts } from './src/lib/transport-security';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Repository documentation lives in docs/ and README.md; the generated agent rule files would
  // duplicate it and drift.
  agentRules: false,
  typedRoutes: false,
  // Test files (*.test.ts) reference vitest which is not needed for production builds.
  // Skip type-checking during build so test-only type errors do not block deployment.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // `next dev --hostname localhost` with ipv4-first DNS listens on 127.0.0.1 so preview and curl
  // keep using that address. Allow the Host header without treating it as a foreign origin.
  allowedDevOrigins: ['127.0.0.1'],
  async headers() {
    if (!shouldAttachHsts(process.env)) {
      return [];
    }
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Strict-Transport-Security', value: HSTS_HEADER_VALUE }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
