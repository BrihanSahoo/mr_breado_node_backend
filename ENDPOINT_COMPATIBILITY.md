# Endpoint Compatibility Summary

Base URL: `http://host:8080/api`

The generated backend keeps the current route contract used by the uploaded Spring Boot backend and Flutter/Admin apps.

## Covered modules

- Auth: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/update-profile`, `/auth/update-password`, `/auth/forgot-password`
- Discovery: `/home`, `/settings`, `/categories`, `/categories/sub-categories`, `/brands`, `/banners`, `/products`, `/products/:slug`, `/restaurants`, `/restaurants/nearby`, `/restaurants/:slug`, `/stores/:slug`, `/stores/:slug/menu`
- Delivery validation: `/delivery/distance`, `/delivery/validate`, `/orders/validate-delivery`, `/restaurants/:id/delivery-check`
- Cart: `/cart`, `/cart/items`, `/cart/items/:id`, `/cart/clear`
- Addresses: `/user/addresses`, `/user/addresses/:id`, `/user/addresses/:id/default`
- Checkout/orders: `/checkout/summary`, `/user/orders`, `/user/orders/:slug`, `/user/orders/:slug/cancel`, `/user/orders/:slug/invoice.pdf`, `/user/orders/:slug/invoice`, `/user/orders/:id/reorder`
- Payments: `/payment/options`, `/payment/settings`, `/payments/settings`, `/payments/create-order`, `/payments/verify`, `/user/payments`
- Offers/coupons: `/offers`, `/offers/verify`, `/coupons/validate`, `/admin/offers`, `/admin/coupons`
- Wallet: `/wallet`, `/wallet/transactions`
- Notifications: `/notifications`, `/notifications/:id/read`, `/notifications/read-all`, `/notifications/settings`, `/admin/notifications/send*`
- Reviews/favorites/search/support/reports: current app paths are included.
- Seller: `/seller/restaurant`, `/seller/products`, `/seller/orders`, `/seller/reviews`, `/seller/verification/*`, `/seller/payout-account`
- Rider: `/delivery/dashboard`, `/delivery/profile`, `/delivery/location`, `/delivery/offers/active`, `/delivery/orders/available`, `/delivery/orders/current`, `/delivery/orders/history`, `/delivery/orders/:id/*`, `/delivery/cash/*`, `/rider/verification/*`
- Tracking: `/delivery/orders/:id/location`, `/user/orders/:id/tracking`
- Admin: dashboard, users, restaurants, products, categories, brands, banners, offers, coupons, payments, settings, verification, support, Mr Breado store, roles, reports.

## Compatibility improvements over Spring project

- Added `/auth/me` alias because apps call it but Spring zip mainly exposed `/user/profile`.
- Added `/auth/update-profile` and `/auth/update-password` aliases.
- Added `/delivery/orders/:id/location` alongside Spring's `/delivery/orders/{orderId}/location` expectation from rider app.
- Added `/delivery/orders/available`, `/delivery/orders`, `/delivery/orders/:id`, `/delivery/orders/:id/accept` aliases used in older app constants.
- Added `/restaurants/:slug` for client `restaurantDetails` constant.
- Added `/user/orders/:slug/invoice` alias along with `.pdf`.
- Added `/notifications/settings` route.
- Added `/platform/admin/settings` alias noted in seller app constants.

## Razorpay behavior

- `/payments/create-order` creates a real Razorpay order only when `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are present.
- `/payments/verify` validates `razorpay_order_id|razorpay_payment_id` using HMAC SHA256 and the Razorpay key secret.
- Missing verification fields produce a clean 400 response instead of a server crash.
