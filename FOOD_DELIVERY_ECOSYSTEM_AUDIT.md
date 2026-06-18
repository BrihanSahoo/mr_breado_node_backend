# Mr Breado Food Delivery Ecosystem — Verification Audit

Audit date: 2026-06-18

## Scope received

- Node/Express backend
- React/TanStack admin dashboard
- Outlet manager Flutter source tree
- Rider Flutter source tree
- Customer Flutter source tree

## Verification completed

### Backend

- Every JavaScript file under `src/` passes `node --check`.
- Existing v62 route contains outlet-specific order routing, distance validation, order-event records, invoice timestamps, seller/rider timeout fields, and an automatic cancellation scheduler.
- Existing schema layers already include outlet inventory uniqueness `(outlet_id, product_id)`, outlet stock movements, outlet daily closing, rider earning records, delivery settings, and outlet-specific dashboards.

### Admin dashboard

- Dependencies install successfully.
- Vite client compilation completes successfully.
- The production build reaches SSR compilation; the supplied environment did not finish SSR packaging within the execution window. No TypeScript/client compilation failure was observed.

### Flutter applications

- Source files were inspected for API alignment and outlet/order models.
- Full Flutter compilation was not possible because all three supplied Flutter archives omit `pubspec.yaml`, platform folders, asset declarations, and lockfiles.

## Critical findings

1. **Database evolution is fragmented.** The backend mounts many historical route versions (`v39` through `v62`) and each version may execute runtime `CREATE TABLE`/`ALTER TABLE` statements. This can cause startup contention, schema drift, and unpredictable behavior under multiple instances.
2. **Base schema lacks production referential integrity.** Core tables in `src/db/schema.sql` do not declare most foreign keys, check constraints, or idempotency keys.
3. **Payment creation endpoints are mounted before authentication.** The direct Razorpay create/verify aliases in `src/app.js` are publicly callable. Production should require an authenticated checkout/order context and server-computed amount.
4. **Payment amount trust boundary is unsafe.** The create-order handler accepts amount values directly from the request body. The payable amount must be recalculated from persisted cart/order data.
5. **Repeated route aliases risk conflicting handlers.** Newer and older routers expose overlapping endpoints. Express resolves the first matching handler that sends a response, making behavior dependent on mount order.
6. **Runtime schema alteration errors are swallowed.** Several compatibility helpers catch SQL errors and continue. This prevents startup failure but can leave partially upgraded databases.
7. **Automatic cancellation runs in every Node process.** The in-process interval can execute concurrently on horizontally scaled instances. A distributed lock or queue worker is required.
8. **Inventory mutation needs a single transaction boundary.** Order creation, payment confirmation, stock reservation/release, cancellation, delivery, and refund creation must use row locks and one database transaction.
9. **Stock lifecycle is not fully normalized.** Existing versions mix `stock`, `stock_qty`, and `stock_quantity`; this creates mismatch risk.
10. **Order outlet fields are duplicated.** Existing code may use `restaurant_id`, `outlet_id`, and `selected_outlet_id`. A canonical `outlet_id` must be established and legacy fields treated as read-only compatibility aliases.
11. **Refund state is represented partly through payment/order status.** A dedicated immutable refund ledger with provider refund ID, amount, reason, attempts, and acknowledgement is required.
12. **Secrets/settings storage needs encryption.** Razorpay Secret and Maps keys must not be returned by APIs or stored as unprotected JSON.
13. **RBAC is not uniformly enforced.** Several admin/seller routes lack explicit role middleware in the route declaration.
14. **Dashboard aggregation has multiple sources.** Some routes aggregate orders while others use daily closing records. This can create count/revenue mismatch.
15. **No automated test suite is supplied.** There are no integration tests covering duplicate requests, concurrent stock updates, timeout cancellation, payment callbacks, refunds, or outlet isolation.

## Required production architecture

### Canonical entities

- `outlets`
- `products` as master catalog only
- `outlet_products` for enabled flag, price override, stock, low-stock threshold, availability, preparation time
- `orders` with one immutable `outlet_id`
- `order_items` with immutable product-name and price snapshots
- `inventory_movements` as the stock source of truth
- `payments` with unique provider order/payment IDs
- `refunds` with explicit status and acknowledgement
- `order_events` for lifecycle audit
- `rider_earnings` immutable per delivered order
- `offline_sales` and `offline_sale_items`
- `feature_settings` and encrypted `secret_settings`

### Mandatory unique constraints

- `outlet_products(outlet_id, product_id)`
- `orders(client_request_id)`
- `payments(provider, provider_order_id)`
- `payments(provider, provider_payment_id)`
- `refunds(order_id, payment_id)`
- `rider_earnings(order_id)`
- `invoice(order_id)`

### Mandatory transaction rules

- Use `SELECT ... FOR UPDATE` on outlet inventory rows.
- Reserve stock exactly once when an order is accepted/confirmed according to the chosen policy.
- Release reserved stock exactly once on cancellation/payment failure.
- Consume stock exactly once on delivered/offline sale.
- Use idempotency keys for checkout, payment verification, cancellation, refund, and delivery completion.

## Build and deployment gates

The ecosystem must not be declared production-ready until all of the following pass:

1. Full database migration on a staging clone.
2. Backend startup with migration failure treated as fatal.
3. API contract tests for every app endpoint.
4. Concurrent checkout test against the final stock unit.
5. Duplicate Razorpay webhook/payment verification test.
6. Seller timeout and rider timeout cancellation tests.
7. Prepaid cancellation and refund queue test.
8. Cross-outlet access tests for seller and rider roles.
9. Invoice PDF visual and tax-total validation.
10. Flutter `analyze`, unit tests, and Android/iOS builds for all apps.
11. Admin `npm run build` and authenticated smoke tests.
12. Load test for order placement, tracking, and dashboard aggregation.

## Current disposition

The supplied v62 ecosystem contains substantial outlet-order consistency work, but it is **not yet safe to certify as production-ready** because the database and payment/inventory flows cannot be executed end-to-end from the supplied artifacts, and the Flutter packages are incomplete. The most important next engineering task is consolidating historical runtime schema/route versions into one migration-controlled backend and one canonical order/inventory/payment lifecycle.
