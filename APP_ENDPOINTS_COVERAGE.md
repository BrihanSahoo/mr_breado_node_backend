# Mr Breado App Endpoint Coverage

This backend version was patched against the exact `ApiEndpoints` constants supplied for the user app, seller app/admin app, and rider app.

Base URL remains:

```txt
https://food-delivery-digontom.onrender.com/api
```

Local testing:

```txt
http://localhost:8080/api
```

## User app endpoint groups covered

- Auth: `/auth/login`, `/auth/register`, `/auth/logout`, `/auth/me`, `/auth/update-profile`, `/auth/update-password`, `/auth/forgot-password`, `/auth/change-email`, `/auth/reset-password`
- Discovery: `/home`, `/categories`, `/products`, `/products/:slug`, `/restaurants/nearby`, `/restaurants/:slug`, `/stores/:slug/menu`, `/products?store=:slug`, `/delivery/distance`, `/delivery/validate`, `/orders/validate-delivery`, `/restaurants/:id/delivery-check`, `/banners`
- Offers: `/offers`, `/offers/verify`, `/offers?type=:type`
- Cart: `/cart`, `/cart/items`, `/cart/items/:id`, `/cart/clear`
- Addresses: `/user/addresses`, `/user/addresses/:id`, `/user/addresses/:id/default`
- Checkout/orders: `/checkout/summary`, `/user/orders`, `/user/orders/:id`, `/user/orders/:id/cancel`, `/user/orders/:id/invoice`, `/user/orders/:id/invoice.pdf`, `/user/orders/:id/reorder`
- Payment/settings: `/payment/options`, `/payment/settings`, `/payments/settings`, `/platform/settings`, `/payments/create-order`, `/payments/verify`, `/user/payments`
- Coupon/wallet: `/coupons/validate`, `/wallet`, `/wallet/transactions`
- Notifications/support: `/notifications`, `/notifications/settings`, `/notifications/:id/read`, `/notifications/read-all`, `/support/tickets`
- Reviews/favorites/search: `/products/:id/reviews`, `/restaurants/:id/reviews`, `/reviews`, `/user/reviews`, `/reviews/order/:id/eligibility`, `/reviews/order/:id`, `/favorites/restaurants/:id`, `/favorites/products/:id`, `/favorites/restaurants`, `/favorites/products`, `/search-history`
- Real-world operations: `/user/orders/:id/tracking`, `/user/orders/:id/live-location`, `/user/orders/:id/review`, `/user/orders/:id/report`, `/restaurants/:id/report`

## Seller app endpoint groups covered

- Account/auth: `/auth/login`, `/auth/register`, `/auth/logout`, `/auth/me`, `/auth/update-profile`, `/auth/update-password`, `/auth/change-email`, `/auth/forgot-password`, `/auth/reset-password`
- Restaurant/verification: `/seller/restaurant`, `/seller/restaurant/status`, `/seller/verification/status`, `/seller/verification/restaurant/:restaurantId`
- Products: `/seller/products`, `/seller/products/:id`, `/seller/products/:id/availability`
- Orders: `/seller/orders`, `/seller/orders/:id`, `/seller/orders/:id/accept`, `/seller/orders/:id/reject`, `/seller/orders/:id/preparing`, `/seller/orders/:id/ready`, `/seller/orders/:id/cancel`, `/seller/orders/export.csv`, `/seller/orders/:id/invoice.pdf`, `/seller/orders/:id/invoice/send-to-customer`
- Offers: `/seller/offers`, `/seller/offers/:id`, `/seller/offers/:id/status`
- Operational: `/seller/reviews`, `/seller/restaurant-reports`, `/seller/messages`, `/seller/payout-account`, `/seller/payment-ledger`

## Rider app endpoint groups covered

- Auth: `/auth/login`, `/auth/register`, `/auth/logout`
- Profile/status/location: `/delivery/dashboard`, `/delivery/profile`, `/delivery/profile/status`, `/delivery/location`
- Offers: `/delivery/offers/active`, `/delivery/offers/:id/accept`, `/delivery/offers/:id/reject`
- Orders: `/delivery/orders/current`, `/delivery/orders/history`, `/delivery/orders/:id`, `/delivery/orders/:id/picked-up`, `/delivery/orders/:id/out-for-delivery`, `/delivery/orders/:id/reached-drop`, `/delivery/orders/:id/cash-collected`, `/delivery/orders/:id/delivered`, `/delivery/orders/:id/location`
- Cash/payout/verification: `/delivery/cash/summary`, `/delivery/cash/transactions`, `/delivery/cash/deposit`, `/rider/verification/status`, `/rider/verification/:riderId`, `/delivery/payout-account`

## Admin web/app endpoint groups covered

- Core: `/admin/dashboard`, `/admin/profile`, `/admin/users`, `/admin/restaurants`, `/admin/orders`, `/admin/orders/:id`, `/admin/payments/summary`, `/admin/payments`
- Settings: `/payment/settings`, `/platform/settings`, `/platform/admin/settings`
- Driver cash: `/admin/drivers/cash`, `/admin/drivers/:id/cash-transactions`, `/admin/drivers/:id/cash-deposit/verify`
- Settlements: `/admin/restaurant-settlements`, `/admin/restaurant-settlements/:id/generate-weekly`, `/admin/restaurant-settlements/:id/mark-paid`
- Mr Breado shop: `/admin/mr-breado/dashboard`, `/admin/mr-breado/restaurant`, `/admin/mr-breado/restaurant/status`, `/admin/mr-breado/products`, `/admin/mr-breado/products/:id`, `/admin/mr-breado/products/:id/availability`, `/admin/mr-breado/orders`, `/admin/mr-breado/orders/:id`, `/admin/mr-breado/orders/export.csv`, `/admin/mr-breado/orders/:id/invoice.pdf`, `/admin/mr-breado/orders/:id/invoice/send-to-customer`, `/admin/mr-breado/orders/:id/accept`, `/admin/mr-breado/orders/:id/reject`, `/admin/mr-breado/orders/:id/preparing`, `/admin/mr-breado/orders/:id/ready`, `/admin/mr-breado/payments`
- Offers/uploads: `/admin/offers`, `/admin/offers/:id`, `/admin/offers/:id/status`, `/admin/uploads/offer-image`, `/admin/uploads/product-image`, `/admin/uploads/restaurant-image`
- Account security: `/admin/account/profile`, `/admin/account/password/otp`, `/admin/account/password`, `/admin/account/email/otp`, `/admin/account/email`, `/admin/account/phone`, `/admin/account/profile/gstin`
- Dashboard/roles/categories/notifications: `/admin/dashboard/overview`, `/admin/dashboard/revenue`, `/admin/dashboard/payments`, `/admin/categories`, `/admin/categories/summary`, `/admin/categories/:id`, `/admin/categories/:id/status`, `/admin/roles`, `/admin/roles/:code/permissions`, `/admin/notifications/send`, `/admin/notifications/send-to-all`, `/admin/notifications/send-to-customers`, `/admin/notifications/send-to-sellers`, `/admin/notifications/send-to-drivers`
- Reviews/reports/messages/payout/ledger: `/admin/reviews`, `/admin/restaurant-reports`, `/admin/restaurant-reports/:id/status`, `/admin/seller-messages`, `/admin/customer-messages/send`, `/admin/seller-payout-accounts`, `/admin/seller-payout-accounts/:id/verify`, `/admin/payment-ledger`

## Notes

Some advanced admin/report endpoints are compatibility-safe implementations. They return valid response bodies and avoid app crashes, but advanced business rules such as automated weekly settlements, real push notifications, and cash-ledger reconciliation still need deeper production hardening after app testing.
