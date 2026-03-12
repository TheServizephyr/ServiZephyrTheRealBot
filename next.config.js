
/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

// Load environment variables from .env.local for local development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: './.env.local' });
}

const buildContentSecurityPolicy = () => {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    'https://www.googletagmanager.com',
    'https://www.google-analytics.com',
    'https://www.gstatic.com',
    'https://www.gstatic.cn',
    'https://www.google.com',
    'https://apis.google.com',
    'https://maps.googleapis.com',
    'https://maps.gstatic.com',
    'https://checkout.razorpay.com',
    'https://va.vercel-scripts.com',
  ];
  if (process.env.NODE_ENV !== 'production') {
    scriptSrc.splice(2, 0, "'unsafe-eval'");
  }
  const directives = {
    "default-src": ["'self'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'self'"],
    "img-src": ["'self'", 'data:', 'blob:', 'https:'],
    "font-src": ["'self'", 'data:', 'https://fonts.gstatic.com'],
    "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    "script-src": scriptSrc,
    "connect-src": [
      "'self'",
      'https://www.google-analytics.com',
      'https://region1.google-analytics.com',
      'https://analytics.google.com',
      'https://www.googletagmanager.com',
      'https://apis.google.com',
      'https://accounts.google.com',
      'https://*.googleapis.com',
      'https://securetoken.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://auth.servizephyr.com',
      'https://firestore.googleapis.com',
      'https://firebaseinstallations.googleapis.com',
      'https://firebasestorage.googleapis.com',
      'https://*.firebaseio.com',
      'wss://*.firebaseio.com',
      'https://*.gstatic.com',
      'https://maps.googleapis.com',
      'https://maps.gstatic.com',
      'https://checkout.razorpay.com',
      'https://api.razorpay.com',
      'https://lumberjack.razorpay.com',
      'https://vitals.vercel-insights.com',
      'https://*.vercel-insights.com',
      'https://va.vercel-scripts.com',
    ],
    "frame-src": [
      "'self'",
      'https://www.google.com',
      'https://accounts.google.com',
      'https://checkout.razorpay.com',
      'https://api.razorpay.com',
      'https://auth.servizephyr.com',
    ],
    "worker-src": ["'self'", 'blob:'],
    "media-src": ["'self'", 'blob:', 'data:', 'https:'],
    "manifest-src": ["'self'"],
    "form-action": ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
  };

  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
};

const nextConfig = {
  async headers() {
    const baseHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Origin-Agent-Cluster', value: '?1' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
      // Required for Firebase/Google popup auth flows to avoid window.close/window.closed COOP warnings.
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    ];

    if (process.env.NODE_ENV === 'production') {
      baseHeaders.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains; preload',
      });
    }

    return [
      {
        source: '/:path*',
        headers: baseHeaders,
      },
    ];
  },
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

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },
  org: process.env.SENTRY_ORG || undefined,
  project: process.env.SENTRY_PROJECT || undefined,
})
