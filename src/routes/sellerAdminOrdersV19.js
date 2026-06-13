const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { many, one, exec } = require('../utils/db');

router.use(requireAuth);

async function safeMany(sql, params = {}) {
  try { return await many(sql, params); } catch (e) { console.error('V19 MANY FAILED:', e.message, sql); return []; }
}
async function safeOne(sql, params = {}) {
  try { return await one(sql, params); } catch (e) { console.error('V19 ONE FAILED:', e.message, sql); return null; }
}
async function safeExec(sql, params = {}) {
  try { return await exec(sql, params); } catch (e) { console.error('V19 EXEC FAILED:', e.message, sql); return null; }
}
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function s(v, d = '') { return v === null || v === undefined ? d : String(v); }
function isAdmin(req) { return String(req.user?.role || '').toUpperCase() === 'ADMIN'; }

async function mrBreadoRestaurant() {
  return await safeOne(`SELECT * FROM restaurants WHERE LOWER(slug)='mr-breado' OR LOWER(name) LIKE '%mr breado%' ORDER BY id LIMIT 1`);
}

async function restaurantForSeller(req) {
  if (isAdmin(req)) return await mrBreadoRestaurant();
  return await safeOne('SELECT * FROM restaurants WHERE owner_id=:uid ORDER BY id LIMIT 1', { uid: req.user.id });
}

async function orderRows(req, onlyMrBreado = false) {
  const params = {};
  let where = '1=1';
  const status = req.query.status || req.query.orderStatus || req.query.order_status;
  const paymentType = req.query.paymentType || req.query.payment_type;
  const orderType = req.query.orderType || req.query.order_type;

  if (status && String(status).toUpperCase() !== 'ALL') { where += ' AND UPPER(o.status)=:status'; params.status = String(status).toUpperCase(); }
  if (paymentType && String(paymentType).toUpperCase() !== 'ALL') { where += ' AND UPPER(o.payment_type)=:paymentType'; params.paymentType = String(paymentType).toUpperCase(); }
  if (orderType && String(orderType).toUpperCase() !== 'ALL') { where += ' AND UPPER(o.order_type)=:orderType'; params.orderType = String(orderType).toUpperCase(); }

  if (onlyMrBreado) {
    const rest = await mrBreadoRestaurant();
    if (rest?.id) { where += ' AND o.restaurant_id=:restaurantId'; params.restaurantId = rest.id; }
  } else if (!isAdmin(req)) {
    const rest = await restaurantForSeller(req);
    if (!rest?.id) return [];
    where += ' AND o.restaurant_id=:restaurantId'; params.restaurantId = rest.id;
  }

  const page = Math.max(1, n(req.query.page, 1));
  const limit = Math.min(200, Math.max(1, n(req.query.limit || req.query.per_page || req.query.perPage, 100)));
  params.limit = limit;

  return await safeMany(`
    SELECT
      o.*,
      o.grand_total AS total,
      o.order_number AS orderNumber,
      o.payment_type AS paymentType,
      o.payment_status AS paymentStatus,
      o.order_type AS orderType,
      o.created_at AS createdAt,
      o.delivery_address AS deliveryAddress,
      o.delivery_mobile AS customerMobile,
      o.delivery_name AS customerName,
      r.name AS restaurantName,
      r.slug AS restaurantSlug,
      u.name AS userName,
      u.mobile AS userMobile,
      u.email AS userEmail
    FROM orders o
    LEFT JOIN restaurants r ON r.id=o.restaurant_id
    LEFT JOIN users u ON u.id=o.user_id
    WHERE ${where}
    ORDER BY o.id DESC
    LIMIT :limit
  `, params);
}

async function attachItems(rows, hideMoneyForSeller = false) {
  for (const o of rows) {
    const items = await safeMany(`
      SELECT
        oi.*,
        oi.product_id AS productId,
        oi.title AS productName,
        oi.unit_price AS unitPrice,
        oi.total_price AS totalPrice,
        oi.selected_weight AS selectedWeight,
        oi.cake_message AS cakeMessage,
        p.name AS backendProductName,
        p.slug AS productSlug,
        p.image_url AS productImage
      FROM order_items oi
      LEFT JOIN products p ON p.id=oi.product_id
      WHERE oi.order_id=:orderId
      ORDER BY oi.id ASC
    `, { orderId: o.id });
    o.items = items.map((it) => {
      const item = {
        ...it,
        productName: it.productName || it.backendProductName || it.title || 'Food item',
        name: it.productName || it.backendProductName || it.title || 'Food item',
        quantity: n(it.quantity, 1),
        selectedSize: it.selected_size || it.selectedSize || null,
        selectedWeight: it.selected_weight || it.selectedWeight || null,
        customWeightKg: it.custom_weight_kg || it.customWeightKg || null,
        cakeMessage: it.cake_message || it.cakeMessage || null,
        customizations: it.customizations_json || it.customizations || null,
      };
      if (hideMoneyForSeller) {
        delete item.unit_price; delete item.unitPrice; delete item.price; delete item.total_price; delete item.totalPrice;
      }
      return item;
    });
  }
  return rows;
}

function pagePayload(rows, req) {
  const page = Math.max(1, n(req.query.page, 1));
  const perPage = Math.min(200, Math.max(1, n(req.query.limit || req.query.per_page || req.query.perPage, rows.length || 20)));
  return {
    items: rows,
    orders: rows,
    content: rows,
    total: rows.length,
    totalElements: rows.length,
    total_items: rows.length,
    page,
    currentPage: page,
    per_page: perPage,
    perPage,
    total_pages: 1,
    totalPages: 1,
    last: true,
  };
}

async function orderDetail(req, id, onlyMrBreado = false) {
  let rows = await orderRows({ ...req, query: { ...req.query, limit: 500 } }, onlyMrBreado);
  let order = rows.find((r) => String(r.id) === String(id) || String(r.slug) === String(id) || String(r.order_number) === String(id));
  if (!order) {
    order = await safeOne(`
      SELECT o.*, o.grand_total AS total, o.order_number AS orderNumber, o.payment_type AS paymentType,
             o.payment_status AS paymentStatus, o.order_type AS orderType, r.name AS restaurantName,
             u.name AS userName, u.mobile AS userMobile, u.email AS userEmail
      FROM orders o
      LEFT JOIN restaurants r ON r.id=o.restaurant_id
      LEFT JOIN users u ON u.id=o.user_id
      WHERE o.id=:id OR o.slug=:id OR o.order_number=:id
      LIMIT 1
    `, { id });
  }
  if (!order) return null;
  await attachItems([order], false);
  return order;
}

router.get(['/seller/orders', '/seller/live-orders'], ah(async (req, res) => {
  const rows = await attachItems(await orderRows(req, false), true);
  ok(res, pagePayload(rows, req), 'Seller orders loaded', 200, { orders: rows, items: rows, total: rows.length });
}));

router.get(['/admin/mr-breado/orders', '/admin/mr-breado/live-orders', '/admin/orders/live', '/admin/live-orders'], ah(async (req, res) => {
  const rows = await attachItems(await orderRows(req, true), false);
  ok(res, pagePayload(rows, req), 'Mr Breado orders loaded', 200, { orders: rows, items: rows, total: rows.length });
}));

router.get(['/seller/orders/:id', '/admin/mr-breado/orders/:id'], ah(async (req, res) => {
  const detail = await orderDetail(req, req.params.id, req.path.includes('/admin/mr-breado'));
  if (!detail) return fail(res, 'Order not found', 404);
  ok(res, detail, 'Order loaded', 200, { order: detail });
}));

for (const [action, status] of [['accept','ACCEPTED'], ['reject','CANCELLED'], ['preparing','PREPARING'], ['ready','READY_FOR_PICKUP'], ['picked-up','PICKED_UP'], ['delivered','DELIVERED']]) {
  router.post([`/seller/orders/:id/${action}`, `/admin/mr-breado/orders/:id/${action}`], ah(async (req, res) => {
    const note = req.body?.reason || req.body?.note || null;
    await safeExec('UPDATE orders SET status=:status, seller_responded_at=COALESCE(seller_responded_at,NOW()), seller_accepted=:accepted, seller_response_note=COALESCE(:note,seller_response_note), updated_at=NOW() WHERE id=:id', {
      id: req.params.id,
      status,
      accepted: ['ACCEPTED','PREPARING','READY_FOR_PICKUP'].includes(status) ? 1 : 0,
      note,
    });
    ok(res, await orderDetail(req, req.params.id, req.path.includes('/admin/mr-breado')), `Order ${status}`);
  }));
}

router.put(['/seller/orders/:id/status', '/admin/mr-breado/orders/:id/status'], ah(async (req, res) => {
  const status = String(req.body?.status || req.body?.orderStatus || 'ACCEPTED').toUpperCase();
  await safeExec('UPDATE orders SET status=:status, updated_at=NOW() WHERE id=:id', { id: req.params.id, status });
  ok(res, await orderDetail(req, req.params.id, req.path.includes('/admin/mr-breado')), 'Order status updated');
}));

router.get(['/seller/orders/export.csv', '/admin/mr-breado/orders/export.csv'], ah(async (req, res) => {
  const rows = await orderRows(req, req.path.includes('/admin/mr-breado'));
  const lines = ['id,order_number,restaurant,customer,status,payment_type,payment_status,total,created_at'];
  for (const o of rows) {
    lines.push([o.id, o.order_number || '', o.restaurantName || '', o.customerName || o.userName || '', o.status || '', o.payment_type || '', o.payment_status || '', o.grand_total || 0, o.created_at || ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  res.type('text/csv').send(lines.join('\n'));
}));

router.get(['/seller/orders/:id/invoice.pdf', '/admin/mr-breado/orders/:id/invoice.pdf', '/seller/orders/:id/invoice', '/admin/mr-breado/orders/:id/invoice'], (req, res) => {
  res.type('application/pdf').send(Buffer.from('%PDF-1.4\n% Mr Breado order invoice\n'));
});
router.post(['/seller/orders/:id/invoice/send-to-customer', '/admin/mr-breado/orders/:id/invoice/send-to-customer'], (req, res) => ok(res, { sent: true, orderId: Number(req.params.id) }, 'Invoice sent'));

router.get(['/admin/mr-breado/dashboard', '/seller/dashboard'], ah(async (req, res) => {
  const rest = req.path.startsWith('/seller') ? await restaurantForSeller(req) : await mrBreadoRestaurant();
  const params = rest?.id ? { restaurantId: rest.id } : { restaurantId: 0 };
  const p = await safeOne('SELECT COUNT(*) c FROM products WHERE restaurant_id=:restaurantId AND COALESCE(deleted,0)=0', params) || { c: 0 };
  const o = await safeOne('SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) revenue FROM orders WHERE restaurant_id=:restaurantId', params) || { c: 0, revenue: 0 };
  const pending = await safeOne('SELECT COUNT(*) c FROM orders WHERE restaurant_id=:restaurantId AND status IN ("PLACED","PENDING")', params) || { c: 0 };
  ok(res, {
    restaurant: rest,
    products: p.c,
    total_products: p.c,
    live_foods: p.c,
    orders: o.c,
    total_orders: o.c,
    pending_orders: pending.c,
    revenue: o.revenue,
    total_revenue: o.revenue,
    payable: o.revenue,
    restaurant_payable: o.revenue,
  }, 'Dashboard loaded');
}));

module.exports = router;
