# Mr Breado Backend Feature Upgrade v12

Razorpay order creation code is intentionally kept unchanged from the working v11 flow. This patch adds new modules around it.

## Added

1. Secure multipart verification documents
   - Seller restaurant verification submit with images/PDF.
   - Rider verification submit with images/PDF.
   - Admin verification queue.
   - Admin can view/download each document securely through authenticated endpoints.
   - Admin approve/reject updates verification request and tries to update restaurant/rider status.

2. Admin-controlled categories
   - Admin can create, update, enable/disable, and delete categories.
   - User app `/api/categories`, `/api/food-categories`, `/api/home` continue reading `food_categories`, so users see the exact admin-managed categories.

3. Online transaction ledger and receipts
   - Admin can see online Razorpay transaction list with order/customer/seller/restaurant details.
   - User can download receipt only for successful online payment.
   - Admin and user receipt content is generated from the same transaction data.

4. Bite stories
   - Admin can add/update/delete stories.
   - User app reads exact active stories via `/api/stories`, `/api/bite-stories`, `/api/user/stories`.

## Verification

After deploy:

```bash
curl "https://mr-breado-node-backend.onrender.com/api/version"
curl "https://mr-breado-node-backend.onrender.com/api/feature-version"
```

Expected version: `feature-upgrade-v12`.

## Important

Do not change Razorpay keys during this upgrade. Existing Razorpay create-order behavior is preserved.
