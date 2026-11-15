import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { 
    mdxRs: true,
  },
  serverExternalPackages: ['mongoose'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
      },
      {
        protocol: 'http',
        hostname: '*',
      }
    ]
  },
};

export default nextConfig;
