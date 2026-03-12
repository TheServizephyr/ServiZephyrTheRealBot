import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || '';

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

if (dsn) {
  Sentry.init({
    dsn,
    enabled: process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_SENTRY_ENABLE_DEV === 'true',
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || 0.1),
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDefaultPii: false,
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE || 0),
    replaysOnErrorSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_ERROR_SAMPLE_RATE || 0.1),
  });
}
