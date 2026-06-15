# V49 Single Brand Enterprise Upgrade

Business features added:
- Outlet ERP schema for service radius, pincode zones, outlet contact, manager fields, stock ledger, daily closings.
- Admin-set delivery pricing: delivery charge/km and rider pay/km.
- Accurate nearest outlet by latitude/longitude, with pincode fallback and service zones.
- Admin category CRUD now supports image values coming from uploaded data URLs, slug, name and status.
- Customer-facing categories are the exact active backend/admin categories.
- User-facing outlets and outlet menus are loaded from outlet APIs only.
- Rider detail analytics with vehicle, license, phone, cash, delivery count, distance and earnings.
- Monthly rider settlement confirmation resets current cash in hand.
- Customer analytics sorted by orders/spend.
- Coupon validation including FREE_DELIVERY coupon that returns deliveryFee=0 and expires automatically after end date.

Razorpay v22/v26 create-order route is unchanged and still mounted before routers.
