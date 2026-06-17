# V62 order-routing consistency fix

- User checkout now sends selected outlet id.
- Backend validates user coordinates against outlet coordinates and service radius before creating the order.
- Order stores both `restaurant_id` and `selected_outlet_id` as the outlet id.
- Outlet manager order APIs filter by the authenticated outlet account.
- Outlet manager credentials continue to use `/api/outlet/auth/login`.
- Admin order list exposes outlet and rider identity.
- GST invoice PDF endpoints are implemented before legacy placeholder routes.
- Delivered orders queue an in-app invoice notification.
- Orders not accepted/picked within one hour are automatically cancelled, stock restored, and user notified.
- Razorpay v22/v26 direct create-order and verify routes are unchanged.
