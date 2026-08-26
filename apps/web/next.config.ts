import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Repository documentation lives in docs/ and README.md; the generated agent rule files would
  // duplicate it and drift.
  agentRules: false,
  typedRoutes: false,
};

export default nextConfig;
