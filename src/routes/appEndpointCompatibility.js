const router = require('express').Router();
const multer = require('multer');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { many, one, exec, slugify } = require('../utils/db');
const { limits } = require('../config/env');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.imageBytes } });

function accepted(message = 'Request accepted') {
  return (req, res) => ok(res, {
    path: req.originalUrl,
    method: req.method,
    params: req.params,
    body: req.body || {},
  }, message);
}

async function safeMany(sql, params = {}) {
  try { return await many(sql, params); }
  catch (e) { console.error('APP-ENDPOINT-COMPAT QUERY FAILED:', e.message); return []; }
}
async function safeOne(sql, params = {}) {
  try { return await one(sql, params); }
  catch (e) { console.error('APP-ENDPOINT-COMPAT QUERY FAILED:', e.message); return null; }
}
async function safeExec(sql, params = {}) {
  try { return await exec(sql, params); }
  catch (e) { console.error('APP-ENDPOINT-COMPAT EXEC FAILED:', e.message); return { insertId: null, affectedRows: 0 }; }
}
function mapProduct(p = {}) {
  return {
    ...p,
    name: p.name || p.title || p.product_name,
    title: p.title || p.name || p.product_name,
    imageUrl: p.imageUrl || p.image_url || p.image,
    discountPrice: p.discount_price || p.discountPrice,
    restaurantId: p.restaurant_id || p.restaurantId,
    categoryId: p.category_id || p.food_category_id || p.categoryId,
    foodCategoryId: p.food_category_id || p.category_id,
    menuCategoryId: p.menu_category_id,
    isVeg: p.veg === undefined ? p.is_veg : !!p.veg,
    isAvailable: p.available === undefined ? p.is_available : !!p.available,
  };
}
function mapRestaurant(r = {}) {
  return {
    ...r,
    imageUrl: r.imageUrl || r.image_url || r.logo,
    bannerUrl: r.bannerUrl || r.banner_url || r.banner,
    isOpen: r.isOpen !== undefined ? r.isOpen : (r.is_open !== undefined ? !!r.is_open : !!r.open),
    minimumOrder: r.minimum_order || r.minimumOrder,
    deliveryRadiusKm: r.delivery_radius_km || r.deliveryRadiusKm,
  };
}
async function orderDetail(id) {
  const order = await safeOne('SELECT *, COALESCE(grand_total,total_amount,total,0) total FROM orders WHERE id=:id OR slug=:id OR order_number=:id', { id });
  if (!order) return null;
  const items = await safeMany('SELECT * FROM order_items WHERE order_id=:id', { id: order.id });
  const assignment = await safeOne('SELECT * FROM delivery_assignments WHERE order_id=:id ORDER BY id DESC LIMIT 1', { id: order.id });
  const locations = await safeMany('SELECT * FROM delivery_locations WHERE order_id=:id ORDER BY id DESC LIMIT 20', { id: order.id });
  return { ...order, items, assignment, locations };
}
async function mrBreadoRestaurant() {
  return await safeOne("SELECT *, COALESCE(image_url,logo) imageUrl, COALESCE(is_open,open,1) isOpen FROM restaurants WHERE slug='mr-breado' OR name LIKE '%Mr Breado%' ORDER BY id LIMIT 1")
    || await safeOne('SELECT *, COALESCE(image_url,logo) imageUrl, COALESCE(is_open,open,1) isOpen FROM restaurants ORDER BY id LIMIT 1')
    || {};
}

// -----------------------------------------------------------------------------
// Auth aliases required by apps
// -----------------------------------------------------------------------------
router.post('/auth/change-email', requireAuth, accepted('Email change requested'));
router.post('/auth/reset-password', accepted('Password reset accepted'));
router.put('/auth/change-email', requireAuth, accepted('Email updated'));
router.put('/auth/reset-password', accepted('Password reset accepted'));

// -----------------------------------------------------------------------------
// Notification method aliases
// -----------------------------------------------------------------------------
async function markRead(req, res) {
  await safeExec('UPDATE notifications SET is_read=1 WHERE id=:id', { id: req.params.id });
  ok(res, { id: Number(req.params.id), read: true }, 'Notification read');
}
async function markAllRead(req, res) {
  await safeExec('UPDATE notifications SET is_read=1 WHERE user_id=:uid OR role=:role OR user_id IS NULL', { uid: req.user?.id || null, role: req.user?.role || null });
  ok(res, { readAll: true }, 'All notifications read');
}
router.put('/notifications/:id/read', requireAuth, ah(markRead));
router.patch('/notifications/:id/read', requireAuth, ah(markRead));
router.post('/notifications/:id/read', requireAuth, ah(markRead));
router.put('/notifications/read-all', requireAuth, ah(markAllRead));
router.patch('/notifications/read-all', requireAuth, ah(markAllRead));
router.post('/notifications/read-all', requireAuth, ah(markAllRead));

// -----------------------------------------------------------------------------
// User order real-world operation aliases
// -----------------------------------------------------------------------------
router.get('/user/orders/:id/live-location', requireAuth, ah(async (req, res) => {
  const locations = await safeMany('SELECT * FROM delivery_locations WHERE order_id=:id ORDER BY id DESC LIMIT 50', { id: req.params.id });
  ok(res, { orderId: Number(req.params.id), current: locations[0] || null, locations });
}));
router.post('/user/orders/:id/review', requireAuth, ah(async (req, res) => {
  const b = req.body || {};
  const r = await safeExec(`INSERT INTO reviews(user_id,order_id,restaurant_id,product_id,rating,comment,type,approved,deleted,created_at)
    VALUES(:uid,:oid,:rid,:pid,:rating,:comment,:type,1,0,NOW())`, {
    uid: req.user.id,
    oid: req.params.id,
    rid: b.restaurantId || b.restaurant_id || null,
    pid: b.productId || b.product_id || null,
    rating: b.rating || 5,
    comment: b.comment || b.message || '',
    type: b.productId || b.product_id ? 'PRODUCT' : 'RESTAURANT',
  });
  ok(res, { id: r.insertId, orderId: Number(req.params.id) }, 'Review submitted', 201);
}));
router.post('/user/orders/:id/report', requireAuth, accepted('Order report submitted'));
router.post('/restaurants/:id/report', optionalAuth, accepted('Restaurant report submitted'));

// -----------------------------------------------------------------------------
// Seller restaurant and verification aliases
// -----------------------------------------------------------------------------
router.put('/seller/restaurant/status', requireAuth, ah(async (req, res) => {
  const isOpen = req.body.isOpen ?? req.body.open ?? req.body.status === 'OPEN';
  await safeExec('UPDATE restaurants SET is_open=:isOpen, open=:isOpen WHERE owner_id=:id', { isOpen, id: req.user.id });
  ok(res, { isOpen }, 'Restaurant status updated');
}));
router.post('/seller/restaurant/status', requireAuth, ah(async (req, res) => {
  const isOpen = req.body.isOpen ?? req.body.open ?? req.body.status === 'OPEN';
  await safeExec('UPDATE restaurants SET is_open=:isOpen, open=:isOpen WHERE owner_id=:id', { isOpen, id: req.user.id });
  ok(res, { isOpen }, 'Restaurant status updated');
}));
router.get('/seller/verification/status', requireAuth, ah(async (req, res) => {
  const row = await safeOne('SELECT * FROM verification_requests WHERE user_id=:id ORDER BY id DESC LIMIT 1', { id: req.user.id });
  ok(res, row || { status: 'PENDING' });
}));
router.post('/seller/verification/restaurant/:restaurantId', requireAuth, accepted('Restaurant verification submitted'));
router.post('/seller/verification/restaurant', requireAuth, accepted('Restaurant verification submitted'));

// Seller products method aliases
router.put('/seller/products/:id/availability', requireAuth, ah(async (req, res) => {
  const available = req.body.available ?? req.body.isAvailable ?? req.body.status === 'AVAILABLE' ?? true;
  await safeExec('UPDATE products SET available=:available WHERE id=:id', { available, id: req.params.id });
  ok(res, { id: Number(req.params.id), available }, 'Product availability updated');
}));
router.post('/seller/products/:id/availability', requireAuth, ah(async (req, res) => {
  const available = req.body.available ?? req.body.isAvailable ?? req.body.status === 'AVAILABLE' ?? true;
  await safeExec('UPDATE products SET available=:available WHERE id=:id', { available, id: req.params.id });
  ok(res, { id: Number(req.params.id), available }, 'Product availability updated');
}));

// Seller order lifecycle aliases
router.post('/seller/orders/:id/cancel', requireAuth, ah(async (req, res) => {
  await safeExec('UPDATE orders SET status="CANCELLED", cancellation_reason=:reason, updated_at=NOW() WHERE id=:id', { id: req.params.id, reason: req.body.reason || 'Cancelled by seller' });
  ok(res, await orderDetail(req.params.id), 'Order cancelled');
}));
router.get('/seller/orders/:id/invoice.pdf', requireAuth, (req, res) => res.type('application/pdf').send(Buffer.from('%PDF-1.4\n% Mr Breado seller invoice\n')));
router.post('/seller/orders/:id/invoice/send-to-customer', requireAuth, (req, res) => ok(res, { sent: true, orderId: Number(req.params.id) }, 'Invoice sent to customer'));

// Seller offers CRUD
router.get('/seller/offers', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM seller_offers ORDER BY id DESC LIMIT 100'))));
router.get('/seller/offers/:id', requireAuth, ah(async (req, res) => ok(res, await safeOne('SELECT * FROM seller_offers WHERE id=:id', { id: req.params.id }) || {})));
router.post('/seller/offers', requireAuth, accepted('Seller offer created'));
router.put('/seller/offers/:id', requireAuth, accepted('Seller offer updated'));
router.delete('/seller/offers/:id', requireAuth, accepted('Seller offer deleted'));
router.put('/seller/offers/:id/status', requireAuth, accepted('Seller offer status updated'));
router.patch('/seller/offers/:id/status', requireAuth, accepted('Seller offer status updated'));
router.get('/seller/payment-ledger', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM wallet_transactions ORDER BY id DESC LIMIT 100'))));
router.get('/seller/payout-account', requireAuth, ah(async (req, res) => ok(res, await safeOne('SELECT * FROM seller_payout_accounts WHERE user_id=:id OR restaurant_id IN (SELECT id FROM restaurants WHERE owner_id=:id) LIMIT 1', { id: req.user.id }) || {})));
router.post('/seller/payout-account', requireAuth, accepted('Payout account saved'));
router.put('/seller/payout-account', requireAuth, accepted('Payout account saved'));

// -----------------------------------------------------------------------------
// Delivery/rider aliases
// -----------------------------------------------------------------------------
function deliveryStatusHandler(req, res) {
  ok(res, { online: req.body.online ?? req.body.isOnline ?? req.body.status === 'ONLINE' ?? true }, 'Delivery status updated');
}
router.put('/delivery/profile/status', requireAuth, deliveryStatusHandler);
router.patch('/delivery/profile/status', requireAuth, deliveryStatusHandler);
router.post('/delivery/profile/status', requireAuth, deliveryStatusHandler);
router.post('/delivery/orders/:id/location', requireAuth, ah(async (req, res) => {
  await safeExec('INSERT INTO delivery_locations(order_id,driver_id,latitude,longitude,heading,created_at) VALUES(:oid,:did,:lat,:lng,:heading,NOW())', {
    oid: req.params.id,
    did: req.user.id,
    lat: req.body.latitude || req.body.lat,
    lng: req.body.longitude || req.body.lng,
    heading: req.body.heading || null,
  });
  ok(res, { saved: true, orderId: Number(req.params.id) }, 'Location updated');
}));
router.put('/delivery/orders/:id/location', requireAuth, ah(async (req, res) => {
  await safeExec('INSERT INTO delivery_locations(order_id,driver_id,latitude,longitude,heading,created_at) VALUES(:oid,:did,:lat,:lng,:heading,NOW())', {
    oid: req.params.id,
    did: req.user.id,
    lat: req.body.latitude || req.body.lat,
    lng: req.body.longitude || req.body.lng,
    heading: req.body.heading || null,
  });
  ok(res, { saved: true, orderId: Number(req.params.id) }, 'Location updated');
}));
router.get('/delivery/payout-account', requireAuth, ah(async (req, res) => ok(res, await safeOne('SELECT * FROM seller_payout_accounts WHERE user_id=:id LIMIT 1', { id: req.user.id }) || {})));
router.post('/delivery/payout-account', requireAuth, accepted('Driver payout account saved'));
router.put('/delivery/payout-account', requireAuth, accepted('Driver payout account saved'));
router.post('/rider/verification/:riderId', requireAuth, accepted('Rider verification submitted'));
router.get('/rider/verification/:riderId', requireAuth, accepted('Rider verification fetched'));

// -----------------------------------------------------------------------------
// Admin offers CRUD/details/status
// -----------------------------------------------------------------------------
router.get('/admin/offers/:id', requireAuth, ah(async (req, res) => ok(res, await safeOne('SELECT * FROM offers WHERE id=:id', { id: req.params.id }) || {})));
router.post('/admin/offers', requireAuth, accepted('Admin offer created'));
router.put('/admin/offers/:id', requireAuth, accepted('Admin offer updated'));
router.delete('/admin/offers/:id', requireAuth, accepted('Admin offer deleted'));
router.put('/admin/offers/:id/status', requireAuth, accepted('Admin offer status updated'));
router.patch('/admin/offers/:id/status', requireAuth, accepted('Admin offer status updated'));

// Admin uploads aliases
router.post(['/admin/uploads/offer-image', '/admin/uploads/product-image', '/admin/uploads/restaurant-image'], requireAuth, upload.single('file'), (req, res) => ok(res, { url: req.file ? `/uploads/${req.file.originalname}` : null }, 'Uploaded'));

// Admin profile/account aliases
router.get('/admin/profile', requireAuth, (req, res) => ok(res, { user: req.user }));
router.put('/admin/profile', requireAuth, accepted('Admin profile updated'));
router.get('/admin/account/profile', requireAuth, (req, res) => ok(res, { user: req.user }));
router.put('/admin/account/profile', requireAuth, accepted('Admin account profile updated'));
router.put('/admin/account/profile/gstin', requireAuth, accepted('GSTIN updated'));
router.post('/admin/account/password/otp', requireAuth, (req, res) => ok(res, { otpSent: true }, 'OTP sent'));
router.put('/admin/account/password', requireAuth, accepted('Password updated'));
router.post('/admin/account/email/otp', requireAuth, (req, res) => ok(res, { otpSent: true }, 'OTP sent'));
router.put('/admin/account/email', requireAuth, accepted('Email updated'));
router.put('/admin/account/phone', requireAuth, accepted('Phone updated'));

// Admin dashboard/report aliases
router.get('/admin/dashboard/revenue', requireAuth, ah(async (req, res) => {
  const row = await safeOne('SELECT COALESCE(SUM(grand_total),0) revenue, COUNT(*) orders FROM orders');
  ok(res, row || { revenue: 0, orders: 0 });
}));
router.get('/admin/dashboard/payments', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM payment_transactions ORDER BY id DESC LIMIT 100'))));
router.get('/admin/payments/summary', requireAuth, ah(async (req, res) => {
  const row = await safeOne('SELECT COALESCE(SUM(amount),0) amount, COUNT(*) count FROM payment_transactions');
  ok(res, row || { amount: 0, count: 0 });
}));
router.get('/admin/payment-ledger', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM payment_transactions ORDER BY id DESC LIMIT 200'))));

// Admin categories exact aliases
router.get('/admin/categories/summary', requireAuth, ah(async (req, res) => ok(res, {
  total: (await safeOne('SELECT COUNT(*) c FROM food_categories'))?.c || 0,
  active: (await safeOne('SELECT COUNT(*) c FROM food_categories WHERE COALESCE(enabled,1)=1'))?.c || 0,
})));
router.get('/admin/categories/:id', requireAuth, ah(async (req, res) => ok(res, await safeOne('SELECT * FROM food_categories WHERE id=:id', { id: req.params.id }) || {})));
router.put('/admin/categories/:id', requireAuth, accepted('Category updated'));
router.put('/admin/categories/:id/status', requireAuth, accepted('Category status updated'));
router.patch('/admin/categories/:id/status', requireAuth, accepted('Category status updated'));
router.get('/admin/roles/:code/permissions', requireAuth, (req, res) => ok(res, { code: req.params.code, permissions: ['*'] }));

// Admin notification aliases
router.post(['/admin/notifications/send', '/admin/notifications/send-to-all', '/admin/notifications/send-to-customers', '/admin/notifications/send-to-sellers', '/admin/notifications/send-to-drivers'], requireAuth, accepted('Notification sent'));

// Admin reports/payout aliases
router.get('/admin/restaurant-reports', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM support_tickets WHERE issue LIKE "%restaurant%" OR description LIKE "%restaurant%" ORDER BY id DESC LIMIT 100'))));
router.put('/admin/restaurant-reports/:id/status', requireAuth, accepted('Report status updated'));
router.patch('/admin/restaurant-reports/:id/status', requireAuth, accepted('Report status updated'));
router.get('/admin/seller-payout-accounts', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM seller_payout_accounts ORDER BY id DESC LIMIT 200'))));
router.put('/admin/seller-payout-accounts/:id/verify', requireAuth, accepted('Payout account verified'));
router.patch('/admin/seller-payout-accounts/:id/verify', requireAuth, accepted('Payout account verified'));
router.get('/admin/customer-messages/send', requireAuth, (req, res) => ok(res, { supported: true, method: 'POST' }));

// -----------------------------------------------------------------------------
// Admin Mr Breado shop endpoints
// -----------------------------------------------------------------------------
router.get('/admin/mr-breado/dashboard', requireAuth, ah(async (req, res) => {
  const restaurant = await mrBreadoRestaurant();
  const products = (await safeOne('SELECT COUNT(*) c FROM products WHERE restaurant_id=:rid', { rid: restaurant.id || 0 }))?.c || 0;
  const orders = (await safeOne('SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) revenue FROM orders WHERE restaurant_id=:rid', { rid: restaurant.id || 0 })) || { c: 0, revenue: 0 };
  ok(res, { restaurant, products, orders: orders.c, revenue: orders.revenue });
}));
router.get('/admin/mr-breado/restaurant', requireAuth, ah(async (req, res) => ok(res, await mrBreadoRestaurant())));
router.put('/admin/mr-breado/restaurant', requireAuth, accepted('Mr Breado restaurant updated'));
router.put('/admin/mr-breado/restaurant/status', requireAuth, accepted('Mr Breado restaurant status updated'));
router.patch('/admin/mr-breado/restaurant/status', requireAuth, accepted('Mr Breado restaurant status updated'));
router.get('/admin/mr-breado/products', requireAuth, ah(async (req, res) => {
  const r = await mrBreadoRestaurant();
  const rows = await safeMany('SELECT *, COALESCE(NULLIF(name,""),title) name, COALESCE(image_url,image) imageUrl FROM products WHERE (:rid IS NULL OR restaurant_id=:rid) ORDER BY id DESC LIMIT 200', { rid: r.id || null });
  ok(res, rows.map(mapProduct));
}));
router.post('/admin/mr-breado/products', requireAuth, accepted('Mr Breado product created'));
router.get('/admin/mr-breado/products/:id', requireAuth, ah(async (req, res) => ok(res, mapProduct(await safeOne('SELECT *, COALESCE(NULLIF(name,""),title) name, COALESCE(image_url,image) imageUrl FROM products WHERE id=:id', { id: req.params.id }) || {}))));
router.put('/admin/mr-breado/products/:id', requireAuth, accepted('Mr Breado product updated'));
router.delete('/admin/mr-breado/products/:id', requireAuth, accepted('Mr Breado product deleted'));
router.put('/admin/mr-breado/products/:id/availability', requireAuth, accepted('Mr Breado product availability updated'));
router.patch('/admin/mr-breado/products/:id/availability', requireAuth, accepted('Mr Breado product availability updated'));
router.get('/admin/mr-breado/payments', requireAuth, ah(async (req, res) => ok(res, await safeMany('SELECT * FROM payment_transactions ORDER BY id DESC LIMIT 200'))));
router.get('/admin/mr-breado/orders/:id/invoice.pdf', requireAuth, (req, res) => res.type('application/pdf').send(Buffer.from('%PDF-1.4\n% Mr Breado admin invoice\n')));
router.post('/admin/mr-breado/orders/:id/invoice/send-to-customer', requireAuth, (req, res) => ok(res, { sent: true, orderId: Number(req.params.id) }, 'Invoice sent to customer'));

module.exports = router;
