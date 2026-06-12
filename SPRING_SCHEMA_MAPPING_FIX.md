# Spring schema mapping fix v3

This version was rebuilt against the uploaded Aiven/Spring schema dump.

Important fixes:

- `/api/home` now reads Spring tables safely:
  - `food_categories` instead of guessing only `categories`
  - `products.title` with compatibility alias `name`
  - `products.image` / `products.image_url`
  - `restaurants.open` / `restaurants.is_open`
  - `banners.image`
  - `offers.action_type`, `action_value`, `coupon_code`, `min_order_amount`
- Auth now uses Spring `users.password` instead of only `password_hash`.
- User status maps from `enabled`, `blocked`, and `deleted`.
- Address APIs now use Spring address columns: `address`, `landmark`, `zipcode`, `default_address`, `mobile`.
- Order creation now writes to Spring order columns: `items_total`, `grand_total`, `order_number`, delivery snapshot fields.
- Order items now use Spring columns: `title`, `total_price`, `unit_price`.
- Payment transaction now uses `provider_response` instead of `raw_payload`.
- Seller/rider/admin reads now use Spring table columns and safe fallbacks.
- `/api/health` is no longer blocked by the seller/rider operations router.

Run:

```bash
rm -rf node_modules package-lock.json
npm install
npm run db:init
npm run dev
```

Then test:

```http
GET http://localhost:8080/
GET http://localhost:8080/api/health
GET http://localhost:8080/api/home
GET http://localhost:8080/api/products
GET http://localhost:8080/api/restaurants
```
