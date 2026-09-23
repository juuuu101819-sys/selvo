import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { DEFAULT_API_BASE_URL } from './src/lib/api-base-url';
import { HSTS_HEADER_VALUE, shouldAttachHsts } from './src/lib/transport-security';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Expose API_BASE_URL to client bundles (code samples) when NEXT_PUBLIC_* is unset.
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      DEFAULT_API_BASE_URL,
  },
  // Repository documentation lives in docs/ and README.md; the generated agent rule files would
  // duplicate it and drift.
  agentRules: false,
  typedRoutes: false,
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
