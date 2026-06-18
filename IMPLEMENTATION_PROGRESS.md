# Implementation Progress

## Completed in this hardening pass

- Protected every direct Razorpay create/verify alias with JWT authentication.
- Replaced client-supplied payment amounts with server-derived order/cart totals.
- Enforced payment transaction ownership during verification.
- Removed runtime `ALTER TABLE payment_transactions` calls from payment requests.
- Prevented verification of unknown provider orders and removed payment-row creation from untrusted callback data.
- Added centralized path-level RBAC for admin, seller/outlet-manager, rider, and delivery namespaces.
- Added role compatibility mappings for legacy seller/rider role names.
- Disabled unsafe automatic admin creation by default; bootstrap now requires explicit environment enablement, a bootstrap token, and a 12-character password.
- Added request IDs.
- Disabled import-time legacy schema mutation by default.
- Disabled in-process auto-cancellation by default and added a single-run worker command for an external scheduler.
- Added an additive production-consistency migration and migration runner.
- Added focused security/static regression tests.
- Updated vulnerable transitive dependency; `npm audit` reports zero known vulnerabilities.

## Verification performed

- `npm install --ignore-scripts`: passed.
- `npm run check:syntax`: passed for source, scripts, and tests.
- `npm test`: 7/7 passed.
- `npm audit fix --ignore-scripts`: completed; zero vulnerabilities reported.
- Server startup and `/api/health`: passed without a database connection.

## External verification still required

- Execute migrations on a staging clone of the real MySQL database.
- Test existing Spring-compatible schemas and old client response contracts.
- Razorpay test-mode create, verify, webhook, and refund tests.
- Concurrency tests against real inventory rows.
- Full cancellation/refund/outlet-routing integration tests.
- External scheduler/distributed lock configuration.

## Remaining architectural work

Historical v34-v62 routes still contain request-time compatibility schema helpers and overlapping endpoint implementations. They were not deleted to avoid breaking clients. Consolidation must be completed incrementally after API contract tests are available.

## Canonical hardening update
- Added canonical order lifecycle validation and immutable event insertion.
- Added explicit seller/outlet authorization middleware and assignment migration.
- Added security-sensitive compatibility router before historical routers.
- Disabled query-string JWTs by default.
- Required independent settings encryption key in production.
- Added lifecycle and auth hardening tests.
