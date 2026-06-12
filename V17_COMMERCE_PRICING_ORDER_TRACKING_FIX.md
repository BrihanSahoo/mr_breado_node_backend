# V17 commerce pricing + order + tracking fix

- Keeps Razorpay create-order untouched.
- Adds DB-backed product customization options for pizza sizes and cake weights.
- Product details now returns `customization_groups`/`customizationGroups` for user app.
- Cart stores selected size/weight/custom weight and calculates the correct seller-set price.
- Order placement uses dynamic column-safe inserts to avoid internal server errors across the existing Spring/MySQL schema.
- Seller/admin order detail receives selected options in order item customizations.
- User tracking endpoint returns latest rider live location for map tracking.
