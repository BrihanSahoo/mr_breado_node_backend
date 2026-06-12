# Mr Breado Backend v16

- Keeps existing Razorpay create-order and verify route unchanged.
- Adds real DB-backed admin dashboard/drivers/products/categories/stories/verifications.
- Adds broad rider/seller verification multipart endpoint aliases.
- Deduplicates verification requests by user + request type.
- Stores uploaded verification documents in DB and returns public inline/download document URLs for admin review.
- Includes DELIVERY_PARTNER role in admin delivery boys listing.
