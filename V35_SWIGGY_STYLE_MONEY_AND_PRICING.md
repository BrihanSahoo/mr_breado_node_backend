# V35 Swiggy/Zomato-style money + food pricing flow

Razorpay create-order/verify interception remains before all routers and is not changed.

Added backend capabilities:

- Pizza smart pricing: Small, Medium, Large prices are stored as product pricing rules and customization options.
- Cake smart pricing: 500gm base price, extra 0.5kg price, min/max kg, cake message charge, custom weight flags.
- Admin/seller product create and update endpoints now accept these pricing fields through multipart or JSON.
- Product detail endpoint exposes `priceRules`, `customizationGroups`, and `customization_groups` so user app can show size/weight selection.
- Restaurant payout ledger table for seller settlement.
- Rider earning ledger table for trip payout and COD cash reconciliation.
- Admin revenue ledger table.
- Order money snapshot table.
- Admin endpoints for restaurant payouts, rider payouts, admin revenue, and rebuilding ledgers from existing orders.

Important endpoints:

POST /api/seller/products
PUT  /api/seller/products/:id
POST /api/admin/products
PUT  /api/admin/products/:id
POST /api/admin/mr-breado/products
PUT  /api/admin/mr-breado/products/:id
GET  /api/products/:id/pricing
GET  /api/admin/money/restaurant-payouts
GET  /api/admin/money/rider-payouts
GET  /api/admin/money/admin-revenue
POST /api/admin/money/rebuild-ledgers
POST /api/orders/:id/rebuild-ledger

Pricing field names accepted:

Pizza:
- smallSizePrice / small_size_price / smallPrice
- mediumSizePrice / medium_size_price / mediumPrice
- largeSizePrice / large_size_price / largePrice

Cake:
- cakeBasePrice / cake500gmPrice / base500gmPrice
- cakeExtraHalfKgPrice / extraHalfKgPrice
- cakeMinWeightKg
- cakeMaxWeightKg
- customWeightEnabled
- cakeMessageEnabled
- cakeMessageCharge
