# V24 Razorpay Auth Restore

This patch restores the exact working public Razorpay create-order behavior after v23.

Changed only payment route exposure and aliases. Razorpay service/signature/settings logic is not changed.

Public no-auth aliases:
- POST /api/payments/create-order
- POST /api/payment/create-order
- POST /api/razorpay/create-order
- POST /api/payments/razorpay/create-order
- POST /api/checkout/razorpay/create-order
- POST /api/checkout/payment/create-order

Verify aliases:
- POST /api/payments/verify
- POST /api/payment/verify
- POST /api/razorpay/verify
- POST /api/payments/razorpay/verify
- POST /api/checkout/razorpay/verify
- POST /api/checkout/payment/verify
