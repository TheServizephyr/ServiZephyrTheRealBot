# Shop Onboarding Todo

Status legend:
- `[x]` Done
- `[ ]` Pending
- `[~]` In progress / needs follow-up

## Phase 1: Remove Restaurant-Only Mismatches

- [x] Hide restaurant-only `Bookings` from the shared owner sidebar for store businesses.
- [x] Make employee custom-role page selection business-type aware so store staff cannot be granted `dine-in` or `bookings`.
- [x] Add a clean restaurant-only guard on the shared bookings/waitlist owner page for direct URL access.
- [x] Review shared owner dashboard landing page copy/cards for restaurant-only language like "Top Selling Items", "Live Order Feed", and kitchen phrasing.
- [x] Add explicit store-safe guards or redirects on restaurant-only owner pages if navigated directly.

## Phase 2: Store Navigation And Roles

- [x] Add a dedicated store dashboard page list in all role-management surfaces, not just the employee invite modal.
- [x] Review all role labels and helper text for store language across invite, employee list, and access-control flows.
- [x] Verify custom-role defaults for store teams make sense for cashier, picker, packer, and manager workflows.

## Phase 3: POS / Manual Billing For Shops

- [x] Split shop billing flow from restaurant-style `manual-order` assumptions like `dine-in`, tables, and food portions.
- [x] Introduce a store-first POS mode with barcode/SKU search, quick quantity editing, discount, and payment mode capture.
- [x] Keep `custom-bill` only if it remains generic; otherwise rename or fork it into a store POS experience.

## Phase 4: Inventory And Product Ops

- [x] Create a dedicated inventory dashboard instead of redirecting `/owner-dashboard/inventory` to catalog.
- [x] Surface product ops fields in owner UI: `sku`, `barcode`, `unit`, `packSize`, `reorderLevel`, `reorderQty`, `safetyStock`.
- [x] Add low-stock, out-of-stock, and reorder views for store owners.
- [x] Add stock ledger / adjustment history visibility to complement existing inventory backend support.
- [x] Add bulk stock import/update flow for stores.

## Phase 5: Product Model Hardening

- [~] Replace food-style `portion` assumptions with store-friendly `variant` support where needed.
- [x] Audit receipt, print, manual order, and history screens for `Full/Half/Regular` assumptions.
- [x] Support optional product metadata such as brand, product type, pack size, tax class, and supplier SKU.

## Phase 6: Store Analytics

- [ ] Adjust dashboard widgets and labels for stores: product, category, brand, fulfillment, returns.
- [ ] Add low-stock risk and inventory health metrics.
- [ ] Add store-specific top movers / dead stock / margin-style views where backend data is available.
- [ ] Review dine-in or restaurant-only analytics segments and hide them for stores.

## Phase 7: API And Data Safety Audit

- [ ] Audit owner APIs for hardcoded `restaurants` collection usage and either generalize or explicitly gate them.
- [ ] Review public-facing booking/waitlist endpoints so stores cannot accidentally hit restaurant-only flows.
- [ ] Add regression checks for `businessType=shop/store` across owner settings, employees, menu, analytics, and live orders.

## Nice To Have

- [ ] Add supplier management / purchase entry workflow for stores.
- [ ] Add return / exchange / refund tracking for retail orders.
- [ ] Add barcode scanner shortcuts in store POS.
- [ ] Add onboarding checklist tailored to shop businesses after signup.
