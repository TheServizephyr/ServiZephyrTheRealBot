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
        hostname: 'www.mygingergarlickitchen.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'apis.mappls.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.mappls.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

module.exports = nextConfig
