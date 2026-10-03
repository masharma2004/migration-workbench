import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', 'postgres'],
  poweredByHeader: false,
};

export default nextConfig;
