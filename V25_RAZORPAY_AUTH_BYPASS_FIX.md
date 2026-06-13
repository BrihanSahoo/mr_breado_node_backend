# V25 Razorpay Auth Bypass Fix

This patch restores the previously working v22 Razorpay behavior and prevents any legacy auth middleware from blocking Razorpay create-order/verify routes.

Changed only:
- `src/middleware/auth.js`: bypasses auth for Razorpay create-order/verify aliases.
- `src/app.js`: version marker updated.

Razorpay service logic, key logic, signature verification logic, DB settings logic, order logic, admin/seller flow are not changed.

Test after deploy:

```bash
curl -X POST "https://mr-breado-node-backend.onrender.com/api/payments/create-order" \
  -H "Content-Type: application/json" \
  -d '{"amount":95,"currency":"INR","restaurantId":8,"sellerId":1}'
```

Expected: `success:true` and a `razorpayOrderId`.
