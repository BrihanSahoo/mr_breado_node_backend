# Security Audit Result

## Fixed

- Public Razorpay create/verify aliases.
- Client-controlled payment amounts.
- Payment verification without transaction ownership.
- Unknown payment callback insertion.
- Automatic first-admin creation with arbitrary short password.
- Missing namespace-level role enforcement.
- Query-string JWT is retained only for legacy compatibility and should be removed after clients migrate.
- Runtime payment-table alteration.
- Import-time schema bootstrapping now disabled by default.

## Still requiring staged work

- Remove query-string token compatibility.
- Consolidate duplicate historical routers.
- Replace all request-time schema helpers with migrations.
- Add webhook endpoint with raw-body signature verification if not already provided by deployment-specific code.
- Add database-backed idempotency to every order/inventory mutation.
- Validate all upload MIME types and upgrade Multer to v2 after compatibility testing.
