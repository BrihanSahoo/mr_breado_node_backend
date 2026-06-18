# Changelog

## v62 production hardening pass

- Added authenticated, server-priced Razorpay flow.
- Added payment ownership checks and safer idempotent verification behavior.
- Added namespace RBAC and request IDs.
- Secured admin bootstrap.
- Added migrations, migration runner, auto-cancel worker command, and tests.
- Disabled unsafe startup schema mutation and multi-instance in-process auto-cancel by default.
- Resolved known npm audit finding.

## Canonical hardening
- Added order transition state machine and order-event idempotency.
- Added seller/outlet assignment authorization foundation.
- Added production encryption-key enforcement and query-token hardening.
- Added migration 002 and focused tests.

## 2026-06-18 — Category and outlet inventory correction
- Added canonical authenticated category CRUD before historical route versions.
- Added multipart category image handling and LONGTEXT migration for category images.
- Added canonical outlet inventory list/update endpoints with transaction-safe stock updates.
- Added canonical outlet full-dashboard response containing all assigned foods and current stock.
