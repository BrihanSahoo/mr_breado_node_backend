const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok, fail } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

async function safeOne(sql, params = {}) { try { return await one(sql, params); } catch (e) { console.error('[v59 one]', e.message); return null; } }
async function safeMany(sql, params = {}) { try { return await many(sql, params); } catch (e) { console.error('[v59 many]', e.message); return []; } }
async function safeExec(sql, params = {}) { try { return await exec(sql, params); } catch (e) { console.error('[v59 exec]', e.message); return null; } }
const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

async function ensureSchema() {
  await safeExec(`CREATE TABLE IF NOT EXISTS outlet_order_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    event_note VARCHAR(500) NULL,
    actor_role VARCHAR(40) NULL,
    actor_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ooe_outlet(outlet_id), KEY idx_ooe_order(order_id)
  )`);
  await safeExec(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    rider_id BIGINT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME NULL,
    delivered_at DATETIME NULL,
    UNIQUE KEY uq_outlet_order(order_id),
    KEY idx_ooa_outlet(outlet_id), KEY idx_ooa_rider(rider_id)
  )`);
}

async function outletIdForUser(req) {
  if (req.user?.outletId) return Number(req.user.outletId);
  if (req.user?.outlet_id) return Number(req.user.outlet_id);
  if (String(req.user?.role || '').toUpperCase() === 'OUTLET_MANAGER') {
    const row = await safeOne('SELECT outlet_id outletId FROM outlet_manager_accounts WHERE id=:id LIMIT 1', { id: req.user.id });
    return Number(row?.outletId || 0);
  }
  return 0;
}

async function detailedOrders(where, params = {}) {
  const rows = await safeMany(`SELECT o.*, o.grand_total total,
      u.name customerName, u.email customerEmail, COALESCE(u.mobile,u.phone) customerMobile,
      ot.name outletName, ot.outlet_code outletCode,
      dp.user_id riderUserId, ru.name riderName, COALESCE(ru.mobile,ru.phone) riderPhone
    FROM orders o
    LEFT JOIN users u ON u.id=o.user_id
    LEFT JOIN outlets ot ON ot.id=o.restaurant_id
    LEFT JOIN outlet_order_assignments oa ON oa.order_id=o.id
    LEFT JOIN delivery_partner_profiles dp ON dp.id=oa.rider_id OR dp.user_id=oa.rider_id
    LEFT JOIN users ru ON ru.id=dp.user_id
    WHERE ${where}
    ORDER BY o.id DESC LIMIT 1000`, params);
  for (const row of rows) {
    row.items = await safeMany(`SELECT oi.*, COALESCE(NULLIF(oi.title,''), NULLIF(p.name,''), NULLIF(p.title,''), CONCAT('Food #',oi.product_id)) productName,
      COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl
      FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=:id ORDER BY oi.id`, { id: row.id });
  }
  return rows;
}

router.get('/single-brand/v59/version', (req, res) => ok(res, {
  version: 'single-brand-enterprise-v59',
  focus: 'nearest-outlet-ui-outlet-order-routing-and-audit',
  razorpay: 'v22/v26 unchanged'
}, 'v59 active'));

router.post('/admin/outlets/ensure-enterprise-v59-schema', ah(async (req, res) => {
  await ensureSchema();
  ok(res, { tables: ['outlet_order_events', 'outlet_order_assignments'] }, 'v59 outlet order schema ready');
}));

// Order creation is intercepted before legacy cartOrders. It only handles orders that explicitly carry an outlet id.
router.post('/user/orders', requireAuth, async (req, res, next) => {
  const body = req.body || {};
  const outletId = Number(body.outletId || body.outlet_id || body.restaurantId || body.restaurant_id || 0);
  if (!outletId) return next();
  try {
    await ensureSchema();
    const outlet = await safeOne('SELECT * FROM outlets WHERE id=:id AND COALESCE(is_active,1)=1 LIMIT 1', { id: outletId });
    if (!outlet) return fail(res, 'Selected outlet is unavailable', 404);

    const cart = await safeOne('SELECT * FROM carts WHERE user_id=:uid LIMIT 1', { uid: req.user.id });
    let items = Array.isArray(body.items) ? body.items : [];
    if (!items.length && cart) {
      items = await safeMany(`SELECT ci.product_id productId, ci.quantity,
        COALESCE(ci.unit_price,p.discount_price,p.price,0) unitPrice,
        COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) name
        FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=:cid`, { cid: cart.id });
    }
    if (!items.length) return fail(res, 'Cart is empty', 400);

    let subtotal = 0;
    for (const item of items) {
      const productId = Number(item.productId || item.product_id || item.id || 0);
      const qty = Math.max(1, Number(item.quantity || 1));
      const stock = await safeOne(`SELECT stock_qty stockQuantity, selling_price sellingPrice, is_available isAvailable
        FROM outlet_product_stock WHERE outlet_id=:outletId AND product_id=:productId LIMIT 1`, { outletId, productId });
      if (!stock || Number(stock.isAvailable) === 0) return fail(res, `Food item ${productId} is not available at this outlet`, 409);
      if (Number(stock.stockQuantity) < qty) return fail(res, `Insufficient stock for food item ${productId}`, 409);
      const price = num(stock.sellingPrice || item.unitPrice || item.unit_price || item.price, 0);
      item.__productId = productId; item.__qty = qty; item.__price = price;
      subtotal += price * qty;
    }

    const deliveryFee = num(body.deliveryFee || body.delivery_fee, 0);
    const platformFee = num(body.platformFee || body.platform_fee, 0);
    const discount = num(body.discount || body.discountAmount, 0);
    const total = Math.max(0, num(body.total || body.grandTotal || body.grand_total, subtotal + deliveryFee + platformFee - discount));
    const paymentType = String(body.paymentType || body.payment_type || body.paymentMethod || 'COD').toUpperCase();
    const paymentStatus = paymentType === 'ONLINE' || paymentType === 'RAZORPAY' ? 'PAID' : 'PENDING';
    const addr = body.address || body.deliveryAddress || body.delivery_address || {};
    const orderNumber = `MBR-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const slug = orderNumber.toLowerCase();

    const created = await exec(`INSERT INTO orders(user_id,restaurant_id,slug,order_number,status,payment_type,payment_status,items_total,delivery_fee,platform_fee,discount,grand_total,delivery_address,delivery_city,delivery_state,delivery_country,delivery_zipcode,delivery_mobile,delivery_name,delivery_latitude,delivery_longitude,order_note,razorpay_order_id,razorpay_payment_id,razorpay_signature,created_at)
      VALUES(:uid,:outletId,:slug,:orderNumber,'PLACED',:paymentType,:paymentStatus,:subtotal,:deliveryFee,:platformFee,:discount,:total,:address,:city,:state,:country,:zipcode,:mobile,:name,:lat,:lng,:note,:razorpayOrderId,:razorpayPaymentId,:razorpaySignature,NOW())`, {
      uid: req.user.id, outletId, slug, orderNumber, paymentType, paymentStatus, subtotal, deliveryFee, platformFee, discount, total,
      address: addr.address || addr.addressLine1 || body.addressLine || '', city: addr.city || body.city || '', state: addr.state || body.state || '', country: addr.country || 'India', zipcode: addr.pincode || addr.zipcode || body.pincode || '', mobile: addr.mobile || addr.phone || body.mobile || '', name: addr.name || req.user.name || '', lat: addr.latitude || body.userLatitude || body.user_latitude || null, lng: addr.longitude || body.userLongitude || body.user_longitude || null,
      note: body.deliveryInstruction || body.orderNote || '', razorpayOrderId: body.razorpayOrderId || body.razorpay_order_id || null, razorpayPaymentId: body.razorpayPaymentId || body.razorpay_payment_id || null, razorpaySignature: body.razorpaySignature || body.razorpay_signature || null
    });
    const orderId = created.insertId;
    for (const item of items) {
      await exec(`INSERT INTO order_items(order_id,product_id,title,quantity,unit_price,total_price,customization_total,created_at)
        VALUES(:orderId,:productId,:title,:qty,:price,:lineTotal,0,NOW())`, { orderId, productId: item.__productId, title: item.name || item.title || `Food #${item.__productId}`, qty: item.__qty, price: item.__price, lineTotal: item.__price * item.__qty });
      await exec(`UPDATE outlet_product_stock SET stock_qty=GREATEST(0,stock_qty-:qty),updated_at=NOW() WHERE outlet_id=:outletId AND product_id=:productId`, { qty: item.__qty, outletId, productId: item.__productId });
    }
    await exec(`INSERT INTO outlet_order_assignments(outlet_id,order_id) VALUES(:outletId,:orderId) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id)`, { outletId, orderId });
    await exec(`INSERT INTO outlet_order_events(outlet_id,order_id,event_type,event_note,actor_role,actor_id) VALUES(:outletId,:orderId,'ORDER_PLACED','Order routed to selected outlet','USER',:uid)`, { outletId, orderId, uid: req.user.id });
    if (cart) {
      await safeExec('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:cid)', { cid: cart.id });
      await safeExec('DELETE FROM cart_items WHERE cart_id=:cid', { cid: cart.id });
    }
    return ok(res, { ...(await safeOne('SELECT *,grand_total total FROM orders WHERE id=:id', { id: orderId })), outletId, outletName: outlet.name }, 'Order placed and routed to outlet', 201);
  } catch (e) { next(e); }
});

router.get(['/seller/restaurant', '/seller/restaurants/me', '/outlet-manager/me'], requireAuth, ah(async (req, res) => {
  const outletId = await outletIdForUser(req);
  if (!outletId) return fail(res, 'No outlet assigned to this account', 404);
  const outlet = await safeOne('SELECT *, id restaurantId, id outletId, name restaurantName FROM outlets WHERE id=:id LIMIT 1', { id: outletId });
  if (!outlet) return fail(res, 'Assigned outlet not found', 404);
  ok(res, outlet, 'Assigned outlet loaded');
}));

router.get(['/seller/orders', '/seller/live-orders', '/outlet-manager/orders'], requireAuth, ah(async (req, res) => {
  const outletId = await outletIdForUser(req);
  if (!outletId) return fail(res, 'No outlet assigned to this account', 404);
  const rows = await detailedOrders('o.restaurant_id=:outletId', { outletId });
  ok(res, { items: rows, content: rows, orders: rows, total: rows.length, outletId }, 'Outlet orders loaded');
}));

router.get(['/seller/orders/:id', '/outlet-manager/orders/:id'], requireAuth, ah(async (req, res) => {
  const outletId = await outletIdForUser(req);
  const rows = await detailedOrders('o.restaurant_id=:outletId AND (o.id=:id OR o.order_number=:id OR o.slug=:id)', { outletId, id: req.params.id });
  if (!rows[0]) return fail(res, 'Order not found for this outlet', 404);
  ok(res, rows[0], 'Outlet order details loaded');
}));

router.get(['/admin/outlets/:id/orders', '/admin/business/outlets/:id/orders'], ah(async (req, res) => {
  const rows = await detailedOrders('o.restaurant_id=:outletId', { outletId: req.params.id });
  const totalSales = rows.filter(x => !['CANCELLED','REJECTED','REFUNDED'].includes(String(x.status).toUpperCase())).reduce((s, x) => s + num(x.total || x.grand_total), 0);
  ok(res, { items: rows, orders: rows, total: rows.length, totalSales }, 'Outlet complete order history loaded');
}));

router.get('/admin/orders/business-view', ah(async (req, res) => {
  const rows = await detailedOrders('1=1');
  ok(res, { items: rows, orders: rows, total: rows.length }, 'All outlet orders loaded');
}));

router.use(require('./singleBrandEnterpriseV58'));
module.exports = router;
