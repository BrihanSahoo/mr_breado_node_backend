# Mr Breado Single-Brand Multi-Outlet System v39

This package converts the platform direction from marketplace restaurants/sellers to a dedicated Mr Breado multi-outlet operating system.

## Locked rule
Razorpay create-order/verify remains the working v22/v26 direct public route in app.js. Do not move it below routers.

## Business model
- Only Mr Breado brand.
- Multiple outlets/branches.
- User app selects nearest serviceable outlet from location.
- Outlet menu is master product + outlet stock/availability/prep time.
- Seller app should be used as Outlet Manager app, not open marketplace seller app.
- Rider app becomes in-house delivery boy app assigned to outlets.
- Restaurant payout/franchise/seller marketplace workflow is disabled by business logic.

## New tables
- outlets
- outlet_product_stock
- outlet_delivery_boys
- outlet_order_assignments
- outlet_sales_daily
- accounting_export_logs
- admin_action_logs

## Main endpoints
- GET /api/single-brand/v39/version
- POST /api/admin/outlets/ensure-schema
- GET/POST/PUT /api/admin/outlets
- GET /api/outlets/nearest?lat=&lng=
- GET /api/menu/nearest?lat=&lng=
- GET /api/outlets/:id/menu
- POST /api/admin/outlets/:id/stock
- GET /api/admin/head-office/dashboard
- GET /api/admin/reports/outlet-sales
- GET /api/admin/reports/outlet-sales.csv
- GET /api/admin/delivery-boys
- POST /api/admin/outlets/:outletId/delivery-boys/:userId
- GET /api/outlet-manager/me
- GET /api/outlet-manager/orders

## Deployment test
```bash
curl https://mr-breado-node-backend.onrender.com/api/single-brand/v39/version
curl -X POST https://mr-breado-node-backend.onrender.com/api/admin/outlets/ensure-schema
curl "https://mr-breado-node-backend.onrender.com/api/outlets/nearest?lat=22.5726&lng=88.3639"
curl -X POST https://mr-breado-node-backend.onrender.com/api/payments/create-order -H "Content-Type: application/json" -d '{"amount":95,"currency":"INR","restaurantId":8,"sellerId":1}'
```
