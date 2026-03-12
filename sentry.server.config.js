const Sentry = require('@sentry/nextjs');

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_ENABLE_DEV === 'true',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
  });
}
