# Database Migration Guide

1. Create a full backup and staging clone.
2. Configure database environment variables.
3. Run duplicate/orphan reconciliation before adding strict foreign keys.
4. Execute `npm run migrate`.
5. Review compatibility-skip warnings. Only duplicate column/index/FK-name errors are ignored.
6. Run application smoke tests and reconciliation queries.
7. Deploy application code only after migration succeeds.

The first migration is additive. It establishes canonical `orders.outlet_id`, idempotency indexes, order events, outlet inventory, inventory movements, and refunds. Existing legacy fields remain available.

Do not enable `RUN_LEGACY_SCHEMA_BOOTSTRAP` in production. It exists only as a temporary emergency compatibility switch.

Rollback: restore the pre-migration backup. Do not drop newly created consistency tables while application writes are active.
