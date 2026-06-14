# V34 Franchise & Outlet System

Razorpay create-order/verify remains locked to the working v22/v26 direct route.

Added backend support for:
- Franchise business enquiry requests from seller app/register screen.
- Admin franchise request tracking, contact marking, approve/reject.
- Admin Mr Breado outlet listing from restaurants table.
- Franchise outlet inventory table.
- Franchise refill request workflow.
- Stock transfer records from admin to outlet.
- Seller outlet products: franchise seller can view admin Mr Breado products and update stock only.

New endpoints:
- POST /api/seller/franchise/requests
- GET /api/admin/franchise-requests
- PATCH /api/admin/franchise-requests/:id/status
- POST /api/admin/franchise-requests/:id/contact
- GET /api/admin/outlets
- GET /api/admin/outlets/:id/inventory
- POST /api/admin/outlets/:id/transfers
- GET /api/seller/franchise/products
- PATCH /api/seller/franchise/products/:id/stock
- POST /api/seller/franchise/refill-requests
- GET /api/admin/franchise-refill-requests
