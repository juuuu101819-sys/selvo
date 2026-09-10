import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { HSTS_HEADER_VALUE, shouldAttachHsts } from './src/lib/transport-security';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Repository documentation lives in docs/ and README.md; the generated agent rule files would
  // duplicate it and drift.
  agentRules: false,
  typedRoutes: false,
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
