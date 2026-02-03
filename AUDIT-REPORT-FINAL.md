# ServiZephyr – Final System Audit Report

**Date:** 2025-01-29  
**Scope:** Backend (APIs, security, Firestore), Frontend (buttons, flows, UX), PWA, config.

---

## Executive Summary

| Category              | Critical | High | Medium | Low |
|-----------------------|----------|------|--------|-----|
| Security / Backend     | 4        | 3    | 4      | 2   |
| Frontend / UX          | 2        | 3    | 5      | 4   |
| Architecture / Ops    | 1        | 2    | 3      | -   |

**Immediate actions:** Enforce order status with token, add Firestore rules (if missing in prod), add rate limit + server-side price check on order create, and use webhook idempotency for Razorpay.

---

## Part 1: Security & Backend

### 1.1 CRITICAL

#### 1. Order status API does not require or validate token

- **File:** `src/app/api/order/status/[orderId]/route.js`
- **Finding:** `GET` uses only `params.orderId`. No `request.nextUrl.searchParams` or `token` query param is read. No validation against `orderData.trackingToken`.
- **Impact:** Anyone who knows or guesses an order ID can read full order details (customer name, phone, address, items, status) by calling `/api/order/status/{orderId}`.
- **Fix:**
  - Require `token` query param: `const token = request.nextUrl?.searchParams?.get('token');`
  - If missing → `401` or `403` with clear message.
  - After loading order, compare `token === (orderData.trackingToken || orderData.dineInToken)` (or whatever field holds the tracking secret). Mismatch → `403`.
  - Optional: For tab-based flows (`orderId` starting with `tab_`), define explicit rules (e.g. token or tab token required).

#### 2. Firestore rules not in repo / may be missing in production

- **Finding:** `.gitignore` lists `firestore.rules`; no `firestore.rules` file exists in the repo. Only `storage.rules` and `firestore.indexes.json` are present.
- **Impact:** If Firestore rules are not deployed or are permissive, clients can read/write Firestore directly (bypassing your API), leading to data exposure and abuse.
- **Fix:**
  - Add a `firestore.rules` file to the repo (or a dedicated `firebase/` config folder) with rules for: `orders`, `users`, `restaurants`, `shops`, `street_vendors`, `dine_in_tabs`, `auth_tokens`, `processed_webhooks`, `rate_limits`, etc.
  - Principle: reads/writes only where `request.auth` or validated token/context allows; no broad `allow read, write: if true` for sensitive collections.
  - Deploy via Firebase CLI and verify in Firebase Console.
  - If rules are maintained elsewhere, document and ensure they are strict and versioned.

#### 3. Order create API: no rate limiting, client totals trusted

- **File:** `src/api/order/create/route.js`
- **Findings:**
  - No call to `checkRateLimit(restaurantId)` or any IP/phone-based rate limit. Owner/menu/employees/coupons/refund routes use rate limiters; order create does not.
  - `grandTotal`, `subtotal`, `cgst`, `sgst`, `deliveryCharge` come from `body` and are written to Firestore and used for Razorpay amount (`Math.round(grandTotal * 100)`). There is no server-side recalculation from `items`.
- **Impact:** Spam/DoS via unlimited order creation; risk of price manipulation (e.g. lower grandTotal) and payment/fulfilment abuse.
- **Fix:**
  - Add rate limiting: e.g. use existing `checkRateLimit(restaurantId)` and/or a per-IP or per-phone limiter for anonymous orders.
  - Recompute totals server-side from `items` (quantity, unit price, tax rules, delivery charges). Reject request if client `grandTotal` (and optionally subtotal) does not match server calculation within a small tolerance.

#### 4. Razorpay webhook: signature verified but idempotency not used

- **Files:** `src/api/webhooks/razorpay/route.js`, `src/services/webhook/webhookIdempotency.js`
- **Finding:** Signature is verified (HMAC); on invalid signature the handler returns 403. However, `ensureWebhookIdempotent()` is never called. Duplicate Razorpay deliveries (retries) can be processed more than once.
- **Impact:** Double credit, double order status updates, or duplicate side effects (e.g. notifications, analytics).
- **Fix:** After signature verification and parsing `eventData`, call `ensureWebhookIdempotent(eventData.event_id or paymentEntity.id, 'razorpay', orderId, eventData.event)`. If `isDuplicate: true`, return `200` with `{ status: 'ok', message: 'already_processed' }` and skip all processing.

---

### 1.2 HIGH

#### 5. Dine-in create-tab API has no auth or rate limiting

- **File:** `src/app/api/dine-in/create-tab/route.js`
- **Finding:** POST accepts `restaurantId`, `tableId`, `capacity`, `groupSize`, `customerName` from body. No authentication, no rate limit.
- **Impact:** Anyone can create or rejoin tabs; possible table chaos and abuse.
- **Fix:** Add per-IP or per-`restaurantId`+`tableId` rate limiting; consider requiring a restaurant-scoped token or staff auth for create-tab.

#### 6. CORS for Storage is wide open

- **File:** `cors.json` (root)
- **Finding:** `"origin": ["*"]` allows any origin for the configured methods/headers.
- **Note:** This file is typically used for Firebase Storage (GCS) CORS. Next.js API routes are not configured in `next.config.js` for CORS; Vercel/Next may apply defaults.
- **Fix:** Restrict Storage CORS to your app origins (e.g. `https://servizephyr.com`, `https://www.servizephyr.com`, `http://localhost:3000`). If you have separate API CORS (e.g. via middleware or Vercel), ensure that is also restricted.

#### 7. Order create add-on flow trusts client totals

- **File:** `src/api/order/create/route.js` (add-on block using `existingOrderId`)
- **Finding:** `newGrandTotal = orderData.totalAmount + grandTotal`; `grandTotal` and `subtotal` come from client. No server-side check that added items match the claimed totals.
- **Impact:** Financial and consistency risk if client sends manipulated totals.
- **Fix:** Recompute added amount from `items` server-side and derive new totals; reject if client totals do not match.

---

### 1.3 MEDIUM

- **Inconsistent auth on APIs:** Some routes use `verifyAndGetUid()` / owner RBAC; order create, order status, dine-in create-tab do not. Introduce a small middleware or wrapper for “public but protected” routes (e.g. require token for status, rate limit for create).
- **Input validation:** Order create validates presence and phone format but not full structure of `items` (e.g. price ranges, max length). Consider Zod/Joi schemas and max payload size.
- **Error response shape:** Mix of `{ message }` and `{ error }`. Standardise (e.g. `{ error: { code, message } }`) for easier frontend handling.
- **Unbounded queries:** Some Firestore queries (e.g. order status aggregation, dine-in tabs) use `.where()` without `.limit()`. Add a sensible limit and pagination where appropriate.

---

### 1.4 LOW

- **Logging:** Heavy use of `console.log`/`console.error`. Prefer structured logging (e.g. Pino/Winston) and correlation IDs for production.
- **firestore.indexes.json:** Some composite indexes defined; ensure all queries used in production have corresponding indexes to avoid runtime failures.

---

## Part 2: Frontend / UX & Buttons

### 2.1 CRITICAL

#### 1. Order status is not protected by token on the server

- **Already covered in 1.1.** Frontend (e.g. pre-order track page) may check token client-side, but the API returns full order data without token. Direct API calls bypass UI; fix must be server-side (see 1.1).

#### 2. Use of `alert()` and `confirm()` across the app

- **Files (examples):**
  - `src/app/track/dine-in/[orderId]/page.js`: `alert('Failed to update payment status...')`, `alert('Thank you! The staff has been notified...')`, `alert(err.message)`.
  - `src/app/owner-dashboard/dine-in/page.js`: `confirm('Reject all ... pending orders?')`.
  - `src/app/owner-dashboard/delivery/page.js`, `employees/page.js`, `menu/page.js`, `coupons/page.js`, `settings/page.js`, street-vendor dashboards, `split-pay/[splitId]/page.js`, `useImpersonationSession.js`, etc.
- **Impact:** Inconsistent UX; poor accessibility; no consistent retry or secondary actions; native dialogs look out of place.
- **Fix:** Replace with:
  - Toast (e.g. existing `useToast`) for success/error messages.
  - A shared `ConfirmationDialog` (or Dialog) for destructive or important confirmations (cancel order, reject all, delete coupon/item, remove driver, etc.).

---

### 2.2 HIGH

#### 3. Button component has no built-in loading or double-click guard

- **File:** `src/components/ui/button.js`
- **Finding:** No `isLoading` prop; no automatic disable or spinner. Haptic is triggered on every click.
- **Impact:** Pages that forget to set local loading/disabled state can allow double submissions (e.g. duplicate orders/payments). Inconsistent loading UX.
- **Fix:** Add `isLoading` (and optional `loadingText`) to `Button`; when `isLoading`, set `disabled` and show spinner; optionally guard `onClick` when disabled/loading.

#### 4. Cart “Proceed to Checkout” / post-paid flow

- **File:** `src/app/cart/page.js`
- **Finding:** `handlePostPaidCheckout` sets `orderState` to `CREATING_ORDER` at start and the main button is disabled when `orderState === CREATING_ORDER`. So double-click is largely guarded. Error path uses `InfoDialog` and sets `ORDER_STATE.ERROR`; no explicit “Retry” button in the dialog.
- **Improvement:** Ensure button stays disabled until success or terminal error; add an explicit “Retry” in the error dialog and optionally use toast for “Order placed” success.

#### 5. Checkout payment buttons

- **File:** `src/app/checkout/page.js`
- **Finding:** `isProcessingPayment` and `ORDER_STATE` are used; Place Order and payment method areas are disabled during processing and show `Loader2`. So loading state exists.
- **Improvement:** Use the shared `Button` with `isLoading` once added; ensure all payment paths set `isProcessingPayment` correctly so no path is left clickable during processing.

---

### 2.3 MEDIUM

- **Track dine-in:** `handlePayAtCounter` and `handleMarkDone` use `setIsMarkingDone(true/false)` and show loading; errors use `alert()`. Replace with toast + optional retry.
- **Owner / street-vendor dashboards:** Many destructive actions use `window.confirm()`. Replace with shared confirmation dialog and consistent success/error toasts.
- **Form validation:** Add-address and checkout validate on submit (required fields, phone format). Add onBlur or real-time validation and field-level error messages for better UX.
- **Offline:** No in-app use of `navigator.onLine` or a hook to disable primary actions when offline. Consider `useOnlineStatus` and a small banner + disabling critical buttons when offline.
- **Error boundaries:** No React error boundaries found. Add at least at layout level to avoid full white-screen on component errors.

---

### 2.4 LOW

- **Service worker cache version:** `public/service-worker.js` uses hardcoded `CACHE_VERSION = '2025-12-12-16-20'`. Prefer build-time value (e.g. from env or build id) so each deploy gets a new cache.
- **Visual consistency:** Mix of shared `Button` and custom `motion.button` / inline classes. Gradually standardise on `Button` + variants for consistency and loading behaviour.

---

## Part 3: Architecture & Operations

- **Firestore rules:** Must exist and be strict in production (see 1.1). Document where they live if not in repo.
- **Rate limiting:** Centralise strategy: which routes need per-IP, per-phone, or per-tenant limits; use existing `rateLimiter`/Firestore `rate_limits` where applicable.
- **Webhook idempotency:** Apply to all payment webhooks (Razorpay done in codebase; PhonePe to be confirmed).
- **Load-test scripts:** Root-level scripts (e.g. `servizephyr-dinein-load-test.js`, `cancel-loadtest-orders.js`) could be moved to `scripts/load-testing/` and guarded with env checks to avoid running against production by mistake.
- **Structured logging and monitoring:** Add request IDs and structured logs for order create, payment, and webhooks to simplify debugging and alerts.

---

## Part 4: Recommended Next Steps (Priority Order)

1. **Order status API:** Require and validate `token` query param; return 403 when missing or wrong. Update all track pages to pass `token` in URL when calling this API.
2. **Firestore rules:** Add and deploy strict rules for all sensitive collections; verify in Firebase Console.
3. **Order create:** Add rate limiting and server-side total recalculation; reject on mismatch.
4. **Razorpay webhook:** Integrate `ensureWebhookIdempotent()` and skip processing when duplicate.
5. **Dine-in create-tab:** Add rate limiting and optionally auth/token.
6. **CORS:** Tighten `cors.json` (Storage) and any API CORS to your domains.
7. **Button component:** Add `isLoading` and use it on cart, checkout, and track pages.
8. **Replace `alert()`/`confirm()`:** Use toast + shared confirmation dialog across track, owner, and street-vendor flows.
9. **Validation and errors:** Add Zod (or similar) for order/create and other critical bodies; standardise API error format.
10. **PWA and resilience:** Dynamic SW cache version; optional offline banner and error boundaries.

---

## File Reference Summary

| Area              | File(s) |
|-------------------|---------|
| Order status API   | `src/app/api/order/status/[orderId]/route.js` |
| Order create API   | `src/api/order/create/route.js` |
| Dine-in create-tab | `src/app/api/dine-in/create-tab/route.js` |
| Razorpay webhook   | `src/api/webhooks/razorpay/route.js` |
| Webhook idempotency| `src/services/webhook/webhookIdempotency.js` |
| Rate limiter       | `src/lib/rateLimiter.js` |
| Firestore rules    | Missing in repo; `.gitignore` has `firestore.rules` |
| CORS               | `cors.json` |
| Button UI          | `src/components/ui/button.js` |
| Cart flow          | `src/app/cart/page.js` |
| Checkout flow      | `src/app/checkout/page.js` |
| Track (dine-in)    | `src/app/track/dine-in/[orderId]/page.js` |
| Track (pre-order)  | `src/app/track/pre-order/[orderId]/page.js` |
| Track (pending)    | `src/app/track/pending/[orderId]/page.js` |
| Service worker     | `public/service-worker.js` |

— End of audit report —
