
// Applying user's changes.
/** @type {import('next').NextConfig} */

// Load environment variables from .env.local for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env.local' });
}

const nextConfig = {
  env: {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  },
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
    ],
    // Suppress legacy Image warnings in development
    dangerouslyAllowSVG: true,
    unoptimized: process.env.NODE_ENV === 'development',
  },
  // Suppress console warnings in development
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Suppress Next.js Image legacy prop warnings
      config.infrastructureLogging = {
        level: 'error',
      };
    }
    return config;
  },
  // Disable x-powered-by header
  poweredByHeader: false,
  // Suppress React DevTools suggestion
  reactStrictMode: true,
  // 🟢 FORCE BUILD SUCCESS: Ignore ESLint and TS errors during build
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

module.exports = nextConfig
