# Endpoint Compatibility Matrix

| Existing paths | Canonical handling | Access | Compatibility |
|---|---|---|---|
| `/api/payments/create-order`, `/api/payment/create-order`, `/api/razorpay/create-order`, checkout aliases | `paymentService.createOrder` | Authenticated customer | Paths preserved; request amount fields are ignored and amount is derived from owned order/cart. |
| `/api/payments/verify`, `/api/payment/verify`, `/api/razorpay/verify`, checkout aliases | `paymentService.verify` | Authenticated customer | Paths preserved; provider order must already exist and belong to caller. |
| `/api/admin/login`, `/api/admin/auth/login` | `authService.login` | Public login only | Preserved before admin namespace guard. |
| `/api/admin/**` | Existing versioned routers | ADMIN | Central namespace protection added. |
| `/api/seller/outlet-login`, `/api/outlet-manager/login`, `/api/outlet/auth/login` | Existing outlet login handlers | Public login only | Preserved. |
| `/api/seller/**`, `/api/outlet-manager/**` | Existing versioned routers | ADMIN, SELLER, OUTLET_MANAGER | Central namespace protection added. |
| `/api/rider/**`, `/api/delivery/**` | Existing rider routers | ADMIN, RIDER and legacy rider aliases | Central namespace protection added. |

Legacy routers remain mounted in existing priority order. No endpoint was intentionally removed.
