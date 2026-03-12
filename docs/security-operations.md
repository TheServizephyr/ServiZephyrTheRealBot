# Security Operations Checklist

## Logging and Monitoring

Application-side:

- enable `ENABLE_REQUEST_AUDIT_LOGS=true` in production
- keep `security_events` and `security_anomaly_windows` retention cleanup enabled
- keep Sentry DSNs configured for frontend and backend deployments

Review regularly:

- repeated `RATE_LIMIT_TRIGGERED`
- repeated `TOKEN_SCOPE_REJECTED`
- repeated `APP_CHECK_MISSING` or `APP_CHECK_REJECTED`
- repeated `order_status_probe` anomalies

## Firewall and Bot Protection

Vercel:

- Bot Protection: start with logging, then turn on fully if no false positives
- keep the sensitive public API rate-limit rule enabled
- use Attack Challenge Mode only during active incidents
- add exact IP blocks only after observing repeat offenders

## Firebase App Check

Production:

- set `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`
- set `ENFORCE_FIREBASE_APP_CHECK=true` when rollout is confirmed safe

## Backups and Recovery

Operational tasks outside code:

- enable Firestore backup policy
- enable Storage backup policy or bucket retention policy
- create billing alerts and budget alerts
- confirm restore runbook at least quarterly

## Periodic Testing

- weekly: auth abuse and rate-limit smoke tests
- monthly: public tracking and guest-session abuse tests
- quarterly: full security audit and recovery drill

## Deployment Readiness

Before production rollout:

- verify Vercel firewall settings
- verify Sentry DSNs are set
- verify cleanup cron secret is configured
- verify App Check configuration is present
- verify security workflows pass in CI
