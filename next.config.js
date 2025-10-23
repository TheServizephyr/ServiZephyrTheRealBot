
// Cache-busting comment
/** @type {import('next').NextConfig} */

// Load environment variables from .env.local for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env.local' });
}

const nextConfig = {
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
        hostname: 'a.tile.openstreetmap.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'b.tile.openstreetmap.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'c.tile.openstreetmap.org',
        port: '',
        pathname: '/**',
      }
    ],
  },
};

module.exports = nextConfig
