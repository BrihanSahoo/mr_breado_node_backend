# Database Migration Plan

1. Clone production into staging and take a backup.
2. Run duplicate/orphan diagnostics before unique constraints.
3. Run `npm run migrate` to apply migrations in lexical order.
4. Backfill `orders.outlet_id` from `selected_outlet_id` then `restaurant_id`.
5. Populate `outlet_seller_assignments` from current seller ownership mappings.
6. Reconcile legacy stock fields into `outlet_food_inventory` before enabling canonical inventory writes.
7. Validate payment, refund, invoice, and inventory uniqueness.
8. Roll back application first; schema additions are intentionally additive and should not be dropped during emergency rollback.
