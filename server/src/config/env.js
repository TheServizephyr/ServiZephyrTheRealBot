const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config();

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  FRONTEND_ORIGINS: z.string().default('http://localhost:3000'),
  CORS_ALLOW_CREDENTIALS: z.string().optional().default('true'),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  FIREBASE_SERVICE_ACCOUNT_BASE64: z.string().optional().default(''),
  KV_REST_API_URL: z.string().optional().default(''),
  KV_REST_API_TOKEN: z.string().optional().default(''),
  LEGACY_API_BASE_URL: z.string().optional().default(''),
  NEXT_PUBLIC_BASE_URL: z.string().optional().default(''),
  NEXT_PUBLIC_APP_URL: z.string().optional().default(''),
  ENABLE_LEGACY_PROXY: z.string().optional().default('true'),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  CACHE_PUBLIC_BOOTSTRAP_TTL_SEC: z.coerce.number().int().positive().default(60),
  CACHE_ORDER_STATUS_LITE_TTL_SEC: z.coerce.number().int().positive().default(3),
  CACHE_ORDER_STATUS_FULL_TTL_SEC: z.coerce.number().int().positive().default(30),
  ENABLE_WEBSOCKETS: z.string().optional().default('true'),
  WEBSOCKET_PATH: z.string().optional().default('/ws'),
  ENABLE_NATIVE_RAZORPAY_WEBHOOK: z.string().optional().default('false'),
  GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional().default(''),
  ENABLE_OPS_TELEMETRY: z.string().optional().default('true'),
  OPS_TELEMETRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
});

const parsed = rawEnvSchema.parse(process.env);

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const frontendOrigins = parsed.FRONTEND_ORIGINS
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const legacyBaseUrl = String(
  parsed.LEGACY_API_BASE_URL || parsed.NEXT_PUBLIC_BASE_URL || parsed.NEXT_PUBLIC_APP_URL || ''
)
  .trim()
  .replace(/\/+$/, '');

const config = {
  nodeEnv: parsed.NODE_ENV,
  isProd: parsed.NODE_ENV === 'production',
  port: parsed.PORT,
  logLevel: parsed.LOG_LEVEL,
  cors: {
    origins: frontendOrigins,
    allowCredentials: toBool(parsed.CORS_ALLOW_CREDENTIALS, true),
  },
  firebase: {
    serviceAccountJson: parsed.FIREBASE_SERVICE_ACCOUNT_JSON,
    serviceAccountBase64: parsed.FIREBASE_SERVICE_ACCOUNT_BASE64,
  },
  upstash: {
    url: String(parsed.KV_REST_API_URL || '').trim(),
    token: String(parsed.KV_REST_API_TOKEN || '').trim(),
  },
  legacy: {
    baseUrl: legacyBaseUrl,
    enableProxy: toBool(parsed.ENABLE_LEGACY_PROXY, true),
  },
  publicBaseUrl: String(parsed.NEXT_PUBLIC_BASE_URL || parsed.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, ''),
  requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
  cache: {
    publicBootstrapTtlSec: parsed.CACHE_PUBLIC_BOOTSTRAP_TTL_SEC,
    orderStatusLiteTtlSec: parsed.CACHE_ORDER_STATUS_LITE_TTL_SEC,
    orderStatusFullTtlSec: parsed.CACHE_ORDER_STATUS_FULL_TTL_SEC,
  },
  websocket: {
    enabled: toBool(parsed.ENABLE_WEBSOCKETS, true),
    path: String(parsed.WEBSOCKET_PATH || '/ws').trim() || '/ws',
  },
  payments: {
    nativeRazorpayWebhook: toBool(parsed.ENABLE_NATIVE_RAZORPAY_WEBHOOK, false),
  },
  googleMapsApiKey: String(parsed.GOOGLE_MAPS_API_KEY || parsed.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '').trim(),
  telemetry: {
    enabled: toBool(parsed.ENABLE_OPS_TELEMETRY, true),
    sampleRate: Number.isFinite(parsed.OPS_TELEMETRY_SAMPLE_RATE)
      ? Math.max(0, Math.min(1, parsed.OPS_TELEMETRY_SAMPLE_RATE))
      : 1,
  },
};

if (config.legacy.enableProxy && !config.legacy.baseUrl) {
  // Proxy remains optional in development, but warn loudly.
  // Missing base URL means only locally implemented routes will work.
  process.emitWarning(
    'ENABLE_LEGACY_PROXY=true but LEGACY_API_BASE_URL is empty. Non-migrated routes will fail.',
    { code: 'LEGACY_PROXY_BASE_MISSING' }
  );
}

module.exports = { config };
