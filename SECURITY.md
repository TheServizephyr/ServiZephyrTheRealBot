# Security Policy

## Supported Deployments

Security fixes are applied to the active production deployment on `main` and to the latest maintained testing/staging deployments used before release.

## Reporting a Vulnerability

If you believe you have found a security issue, please report it privately to:

- `support@servizephyr.com`
- `contact@servizephyr.com`

Please include:

- a short description of the issue
- steps to reproduce
- impacted URL, endpoint, or feature
- screenshots, logs, or request samples if available

## Response Expectations

- Initial acknowledgement target: within 3 business days
- Triage target: within 7 business days
- Critical issues are prioritized immediately

## Scope Guidance

In scope:

- authentication and authorization bypass
- sensitive data exposure
- privilege escalation
- payment/session/token abuse
- API abuse and rate-limit bypass
- storage or Firestore rule bypass

Out of scope:

- social engineering
- spam or SEO reports
- attacks requiring leaked user credentials not caused by ServiZephyr
- automated scanning without a clear reproducible finding

## Safe Harbor

We support good-faith security research conducted responsibly, privately, and without intentionally harming user data, availability, or payment flows.
