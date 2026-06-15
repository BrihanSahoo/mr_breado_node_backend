const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

router.use(optionalAuth);

const colCache = new Map();
async function cols(table) {
  if (colCache.has(table)) return colCache.get(table);
  try {
    const [rows] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``);
    const set = new Set(rows.map((r) => r.Field));
    colCache.set(table, set);
    return set;
  } catch (_) {
    const set = new Set();
    colCache.set(table, set);
    return set;
  }
}
async function hasTable(table) { return (await cols(table)).size > 0; }
async function q(sql, params = []) { try { const [r] = await pool.execute(sql, params); return r; } catch (e) { console.error('[singleBrandV39]', e.message, sql); return []; } }
async function x(sql, params = []) { const [r] = await pool.execute(sql, params); return r; }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
function n(v, d = 0) { const z = Number(v); return Number.isFinite(z) ? z : d; }
function text(v, d = '') { return v === undefined || v === null ? d : String(v); }
function bit(v, d = false) { if (v === undefined || v === null) return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (v && Array.isArray(v.data)) return Number(v.data[0]) === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; return ['1', 'true', 'yes', 'active', 'open', 'verified'].includes(String(v).toLowerCase()); }
function slugify(v = '') { return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'mr-breado'; }
function km(aLat, aLng, bLat, bLng) { const R = 6371, rad = (v) => v * Math.PI / 180; const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng); const A = Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1 - A)); }
function page(items, req) { const p = Math.max(1, n(req.query.page || req.query.currentPage, 1)); const pp = Math.max(1, n(req.query.limit || req.query.perPage || req.query.per_page, items.length || 20)); return { items, content: items, data: items, total: items.length, totalElements: items.length, total_items: items.length, page: p, currentPage: p, perPage: pp, per_page: pp, totalPages: 1, total_pages: 1, last: true }; }
function col(set, names, fallback = null) { for (const name of names) if (set.has(name)) return name; return fallback; }

async function ensureSchema() {
  await x(`CREATE TABLE IF NOT EXISTS outlets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    legacy_restaurant_id BIGINT NULL,
    outlet_code VARCHAR(80) UNIQUE,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(700), city VARCHAR(120), state VARCHAR(120), pincode VARCHAR(20),
    latitude DECIMAL(12,8), longitude DECIMAL(12,8), service_radius_km DECIMAL(8,2) DEFAULT 5,
    manager_user_id BIGINT NULL, manager_name VARCHAR(255), manager_phone VARCHAR(40), manager_email VARCHAR(255),
    is_open BIT(1) NOT NULL DEFAULT b'1', is_active BIT(1) NOT NULL DEFAULT b'1',
    takeaway_enabled BIT(1) NOT NULL DEFAULT b'1', delivery_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_outlet_geo (latitude, longitude), INDEX idx_outlet_manager (manager_user_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 5,
    is_available BIT(1) NOT NULL DEFAULT b'1',
    preparation_minutes INT DEFAULT 15,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_product_stock (outlet_id, product_id), INDEX idx_ops_product (product_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_delivery_boys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), is_active BIT(1) NOT NULL DEFAULT b'1',
    UNIQUE KEY uq_outlet_delivery_boy (outlet_id, user_id), INDEX idx_odb_user (user_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL UNIQUE,
    outlet_id BIGINT NOT NULL,
    assigned_by VARCHAR(80) NOT NULL DEFAULT 'NEAREST_LOCATION',
    distance_km DECIMAL(8,2) DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_ooa_outlet (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_sales_daily (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, report_date DATE NOT NULL,
    order_count INT NOT NULL DEFAULT 0, gross_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0, cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0, cancelled_count INT NOT NULL DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_day (outlet_id, report_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS accounting_export_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    export_type VARCHAR(80) NOT NULL, outlet_id BIGINT NULL, from_date DATE NULL, to_date DATE NULL,
    file_url VARCHAR(1000) NULL, created_by BIGINT NULL, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS admin_action_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, actor_id BIGINT NULL, action VARCHAR(120) NOT NULL,
    target_type VARCHAR(80), target_id BIGINT, note VARCHAR(1000), created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  await seedFromRestaurants();
}

async function seedFromRestaurants() {
  if (!(await hasTable('restaurants'))) return;
  const rc = await cols('restaurants');
  const id = 'id', name = col(rc, ['name', 'restaurant_name'], 'name');
  const addr = col(rc, ['address', 'full_address']); const city = col(rc, ['city']); const state = col(rc, ['state']); const pin = col(rc, ['pincode', 'pin_code']);
  const lat = col(rc, ['latitude', 'lat']); const lng = col(rc, ['longitude', 'lng']); const open = col(rc, ['is_open', 'open']); const active = col(rc, ['is_active', 'active']);
  const rows = await q(`SELECT * FROM restaurants WHERE LOWER(${name}) LIKE '%mr breado%' OR LOWER(${name}) LIKE '%mr.breado%' OR LOWER(${name}) LIKE '%breado%' ORDER BY id LIMIT 200`);
  for (const r of rows) {
    await q(`INSERT INTO outlets (legacy_restaurant_id,outlet_code,name,address,city,state,pincode,latitude,longitude,is_open,is_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE name=VALUES(name), address=VALUES(address), city=VALUES(city), state=VALUES(state), pincode=VALUES(pincode), latitude=VALUES(latitude), longitude=VALUES(longitude), is_open=VALUES(is_open), is_active=VALUES(is_active)`,
      [r[id], `OUTLET-${r[id]}`, r[name] || `Mr Breado Outlet ${r[id]}`, addr ? r[addr] : null, city ? r[city] : null, state ? r[state] : null, pin ? r[pin] : null, lat ? r[lat] : null, lng ? r[lng] : null, open ? Number(bit(r[open], true)) : 1, active ? Number(bit(r[active], true)) : 1]
    );
  }
}

async function outlets() {
  await ensureSchema();
  const native = await q('SELECT * FROM outlets ORDER BY id DESC LIMIT 1000');
  return native.map((r) => ({
    id: r.id, outletId: r.id, legacyRestaurantId: r.legacy_restaurant_id, outletCode: r.outlet_code,
    name: r.name, address: r.address || '', city: r.city || '', state: r.state || '', pincode: r.pincode || '',
    latitude: n(r.latitude, null), longitude: n(r.longitude, null), serviceRadiusKm: n(r.service_radius_km, 5),
    managerUserId: r.manager_user_id, managerName: r.manager_name || '', managerPhone: r.manager_phone || '', managerEmail: r.manager_email || '',
    isOpen: bit(r.is_open, true), isActive: bit(r.is_active, true), takeawayEnabled: bit(r.takeaway_enabled, true), deliveryEnabled: bit(r.delivery_enabled, true),
    outletType: 'MR_BREADO_OUTLET', brand: 'Mr Breado'
  }));
}
async function nearest(lat, lng) {
  const items = (await outlets()).filter((o) => o.isActive && o.latitude && o.longitude);
  let best = null;
  for (const o of items) {
    const distanceKm = Math.round(km(n(lat), n(lng), n(o.latitude), n(o.longitude)) * 100) / 100;
    const row = { ...o, distanceKm, isServiceable: distanceKm <= n(o.serviceRadiusKm, 5) && o.isOpen };
    if (!best || row.distanceKm < best.distanceKm) best = row;
  }
  return best;
}
async function productRows(outletId = null) {
  await ensureSchema();
  const pc = await cols('products'); if (!pc.size) return [];
  const name = col(pc, ['name', 'title', 'product_name'], 'name'); const price = col(pc, ['price', 'base_price', 'selling_price', 'regular_price'], 'price');
  const img = col(pc, ['image_url', 'image', 'thumbnail_url', 'primary_image_url']); const slug = col(pc, ['slug']); const rest = col(pc, ['restaurant_id', 'store_id']); const cat = col(pc, ['category_id', 'food_category_id', 'menu_category_id']);
  const cc = await cols('categories');
  let join = ''; const fields = [`p.*`, `p.${name} AS productName`, `p.${price} AS displayPrice`];
  if (slug) fields.push(`p.${slug} AS productSlug`); if (img) fields.push(`p.${img} AS imageUrl`); if (cat) fields.push(`p.${cat} AS categoryId`);
  if (cc.size && cat) { const cn = col(cc, ['name', 'title'], 'name'); join += ` LEFT JOIN categories c ON c.id=p.${cat}`; fields.push(`c.${cn} AS categoryName`); }
  if (outletId) { join += ` LEFT JOIN outlet_product_stock ops ON ops.product_id=p.id AND ops.outlet_id=?`; fields.push('ops.stock_quantity AS outletStock','ops.is_available AS outletAvailable','ops.preparation_minutes AS outletPreparationMinutes'); }
  const where = [];
  if (pc.has('deleted')) where.push('COALESCE(p.deleted,0)=0');
  if (pc.has('available')) where.push('COALESCE(p.available,1)=1');
  if (pc.has('visibility_status')) where.push("UPPER(COALESCE(p.visibility_status,'VISIBLE')) <> 'HIDDEN'");
  const params = outletId ? [outletId] : [];
  const rows = await q(`SELECT ${fields.join(', ')} FROM products p ${join} WHERE ${where.length ? where.join(' AND ') : '1=1'} ORDER BY p.id DESC LIMIT 1000`, params);
  return rows.map((r) => ({
    ...r, id: r.id, productId: r.id, title: r.productName, name: r.productName, slug: r.productSlug || r.slug,
    price: n(r.displayPrice, 0), sellingPrice: n(r.displayPrice, 0), categoryName: r.categoryName || r.category || '',
    imageUrl: r.imageUrl || r.image_url || r.image || r.thumbnail_url || r.primary_image_url || '',
    stockQuantity: n(r.outletStock ?? r.stock_quantity ?? r.stock, 999), preparationMinutes: n(r.outletPreparationMinutes ?? r.preparation_time ?? r.preparation_minutes, 15),
    available: bit(r.outletAvailable, true) && n(r.outletStock ?? r.stock_quantity ?? r.stock, 1) !== 0,
    outletId: outletId || r.restaurant_id || null
  }));
}
async function ordersByOutlet(outletId = null, status = null) {
  const oc = await cols('orders'); if (!oc.size) return [];
  const items = await q(`SELECT o.*, COALESCE(ooa.outlet_id,o.restaurant_id) AS outletId FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE (? IS NULL OR COALESCE(ooa.outlet_id,o.restaurant_id)=?) AND (? IS NULL OR UPPER(o.status)=UPPER(?)) ORDER BY o.id DESC LIMIT 1000`, [outletId, outletId, status, status]);
  return items.map((o) => ({ ...o, outletId: o.outletId, orderNumber: o.order_number || o.orderNumber || o.slug || `#${o.id}`, grandTotal: n(o.grand_total ?? o.total ?? o.total_amount, 0), paymentType: o.payment_type || o.payment_method, paymentStatus: o.payment_status, createdAt: o.created_at }));
}

router.get('/single-brand/v39/version', (req, res) => ok(res, { version: 'single-brand-outlet-v39-complete', model: 'Dedicated Mr Breado multi-outlet system', marketplace: 'disabled by business logic', razorpay: 'v22/v26 locked create-order unchanged' }, 'Single brand v39 active'));
router.post('/admin/outlets/ensure-schema', ah(async (req, res) => { await ensureSchema(); ok(res, { tables: ['outlets','outlet_product_stock','outlet_delivery_boys','outlet_order_assignments','outlet_sales_daily','accounting_export_logs'] }, 'Single-brand outlet schema ready'); }));

router.get(['/outlets','/branches','/admin/outlets','/admin/branches'], ah(async (req, res) => ok(res, page(await outlets(), req), 'Mr Breado outlets loaded')));
router.post(['/admin/outlets','/admin/branches'], ah(async (req, res) => {
  await ensureSchema(); const b = req.body || {}; const code = text(b.outletCode || b.outlet_code || `OUTLET-${Date.now()}`).toUpperCase();
  const result = await x(`INSERT INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,manager_user_id,manager_name,manager_phone,manager_email,is_open,is_active,takeaway_enabled,delivery_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [code, text(b.name || b.outletName, 'Mr Breado Outlet'), text(b.address), text(b.city), text(b.state), text(b.pincode), b.latitude || b.lat || null, b.longitude || b.lng || null, n(b.serviceRadiusKm || b.service_radius_km, 5), b.managerUserId || b.manager_user_id || null, text(b.managerName), text(b.managerPhone), text(b.managerEmail), bit(b.isOpen, true) ? 1 : 0, bit(b.isActive, true) ? 1 : 0, bit(b.takeawayEnabled, true) ? 1 : 0, bit(b.deliveryEnabled, true) ? 1 : 0]);
  ok(res, { id: result.insertId, outletCode: code }, 'Outlet created', 201);
}));
router.put(['/admin/outlets/:id','/admin/branches/:id'], ah(async (req, res) => {
  await ensureSchema(); const b = req.body || {};
  await x(`UPDATE outlets SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), pincode=COALESCE(?,pincode), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude), service_radius_km=COALESCE(?,service_radius_km), manager_user_id=COALESCE(?,manager_user_id), manager_name=COALESCE(?,manager_name), manager_phone=COALESCE(?,manager_phone), manager_email=COALESCE(?,manager_email), is_open=?, is_active=?, takeaway_enabled=?, delivery_enabled=? WHERE id=?`, [b.name || b.outletName || null, b.address || null, b.city || null, b.state || null, b.pincode || null, b.latitude || b.lat || null, b.longitude || b.lng || null, b.serviceRadiusKm || b.service_radius_km || null, b.managerUserId || b.manager_user_id || null, b.managerName || null, b.managerPhone || null, b.managerEmail || null, bit(b.isOpen ?? b.open, true) ? 1 : 0, bit(b.isActive ?? b.active, true) ? 1 : 0, bit(b.takeawayEnabled ?? b.takeaway, true) ? 1 : 0, bit(b.deliveryEnabled ?? b.delivery, true) ? 1 : 0, req.params.id]);
  ok(res, { id: req.params.id }, 'Outlet updated');
}));
router.patch(['/admin/outlets/:id/open','/admin/outlets/:id/status'], ah(async (req, res) => { await ensureSchema(); await x('UPDATE outlets SET is_open=? WHERE id=?', [bit(req.body?.isOpen ?? req.body?.open, true) ? 1 : 0, req.params.id]); ok(res, { id: req.params.id }, 'Outlet status updated'); }));

router.get(['/outlets/nearest','/branches/nearest','/location/nearest-outlet'], ah(async (req, res) => { const lat = req.query.lat || req.query.latitude; const lng = req.query.lng || req.query.longitude; if (!lat || !lng) return fail(res, 'lat and lng are required', 400); const o = await nearest(lat, lng); if (!o) return fail(res, 'No Mr Breado outlet configured yet', 404); ok(res, o, o.isServiceable ? 'Nearest Mr Breado outlet found' : 'Nearest outlet is outside service range'); }));
router.get(['/menu/nearest','/products/nearest','/home/nearest-menu'], ah(async (req, res) => { const lat = req.query.lat || req.query.latitude; const lng = req.query.lng || req.query.longitude; if (!lat || !lng) return fail(res, 'lat and lng are required', 400); const o = await nearest(lat, lng); if (!o) return fail(res, 'No Mr Breado outlet configured yet', 404); if (!o.isServiceable) return fail(res, 'Sorry, Mr Breado is not delivering to your location yet.', 400, { outlet: o }); const products = await productRows(o.id); ok(res, { outlet: o, products, items: products, categories: [] }, 'Nearest outlet menu loaded'); }));
router.get(['/outlets/:id/menu','/branches/:id/menu','/admin/outlets/:id/menu'], ah(async (req, res) => { const products = await productRows(req.params.id); ok(res, { outletId: req.params.id, products, items: products }, 'Outlet menu loaded'); }));
router.post(['/admin/outlets/:id/stock','/outlet-manager/stock','/seller/outlet/stock'], ah(async (req, res) => { await ensureSchema(); const outletId = req.params.id || req.body?.outletId || req.body?.outlet_id; if (!outletId) return fail(res, 'outletId required', 400); const rows = Array.isArray(req.body?.items) ? req.body.items : [req.body]; for (const it of rows) await x(`INSERT INTO outlet_product_stock (outlet_id,product_id,stock_quantity,low_stock_alert,is_available,preparation_minutes) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity), low_stock_alert=VALUES(low_stock_alert), is_available=VALUES(is_available), preparation_minutes=VALUES(preparation_minutes)`, [outletId, it.productId || it.product_id, n(it.stockQuantity || it.stock_quantity || it.stock, 0), n(it.lowStockAlert || it.low_stock_alert, 5), bit(it.isAvailable ?? it.available, true) ? 1 : 0, n(it.preparationMinutes || it.preparation_minutes, 15)]); ok(res, { outletId, count: rows.length }, 'Outlet stock updated'); }));

router.get(['/admin/head-office/dashboard','/admin/outlet-dashboard','/admin/dashboard/outlets'], ah(async (req, res) => { const os = await outlets(); const stats = await Promise.all(os.map(async (o) => { const orders = await ordersByOutlet(o.id); const today = new Date().toISOString().slice(0,10); const todayOrders = orders.filter((x) => String(x.createdAt || '').slice(0,10) === today); return { ...o, orderCount: orders.length, totalSales: orders.reduce((a,b)=>a+n(b.grandTotal),0), todayOrders: todayOrders.length, todaySales: todayOrders.reduce((a,b)=>a+n(b.grandTotal),0) }; })); ok(res, { brand: 'Mr Breado', model: 'SINGLE_BRAND_MULTI_OUTLET', totalOutlets: stats.length, totalOrders: stats.reduce((a,b)=>a+b.orderCount,0), totalRevenue: stats.reduce((a,b)=>a+b.totalSales,0), todayRevenue: stats.reduce((a,b)=>a+b.todaySales,0), outlets: stats, topOutlet: stats.slice().sort((a,b)=>b.totalSales-a.totalSales)[0] || null }, 'Head office dashboard loaded'); }));
router.get(['/admin/reports/outlet-sales','/admin/reports/sales'], ah(async (req, res) => { const from = req.query.from || '1970-01-01'; const to = req.query.to || '2999-12-31'; const rows = await q(`SELECT COALESCE(ooa.outlet_id,o.restaurant_id,0) outletId, DATE(o.created_at) reportDate, COUNT(*) orderCount, COALESCE(SUM(COALESCE(o.grand_total,o.total,o.total_amount,0)),0) grossSales, SUM(CASE WHEN UPPER(COALESCE(o.payment_type,o.payment_method,''))='ONLINE' THEN COALESCE(o.grand_total,o.total,o.total_amount,0) ELSE 0 END) onlineSales, SUM(CASE WHEN UPPER(COALESCE(o.payment_type,o.payment_method,''))='COD' THEN COALESCE(o.grand_total,o.total,o.total_amount,0) ELSE 0 END) codSales, SUM(CASE WHEN UPPER(COALESCE(o.status,''))='CANCELLED' THEN 1 ELSE 0 END) cancelledCount FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY COALESCE(ooa.outlet_id,o.restaurant_id,0), DATE(o.created_at) ORDER BY reportDate DESC`, [from, to]); ok(res, page(rows, req), 'Outlet sales report loaded'); }));
router.get(['/admin/reports/outlet-sales.csv','/admin/reports/sales.csv'], ah(async (req, res) => { const from = req.query.from || '1970-01-01'; const to = req.query.to || '2999-12-31'; const rows = await q(`SELECT COALESCE(ooa.outlet_id,o.restaurant_id,0) outletId, DATE(o.created_at) reportDate, COUNT(*) orderCount, COALESCE(SUM(COALESCE(o.grand_total,o.total,o.total_amount,0)),0) grossSales FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE DATE(o.created_at) BETWEEN ? AND ? GROUP BY COALESCE(ooa.outlet_id,o.restaurant_id,0), DATE(o.created_at) ORDER BY reportDate DESC`, [from, to]); const csv = ['Outlet ID,Date,Orders,Gross Sales', ...rows.map(r => `${r.outletId},${r.reportDate},${r.orderCount},${r.grossSales}`)].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="mr_breado_outlet_sales.csv"'); res.send(csv); }));

router.get(['/admin/delivery-boys','/admin/riders','/delivery-boys'], ah(async (req, res) => { await ensureSchema(); const uc = await cols('users'); if (!uc.size) return ok(res, page([], req), 'Delivery boys loaded'); const name = col(uc, ['name','full_name'], 'name'), phone = col(uc, ['mobile','phone','phone_number']), email = col(uc, ['email']), role = col(uc, ['role'], 'role'); const riders = await q(`SELECT u.*, u.${name} AS riderName ${phone ? `,u.${phone} AS riderMobile` : ''} ${email ? `,u.${email} AS riderEmail` : ''} FROM users u WHERE UPPER(u.${role}) IN ('RIDER','DRIVER','DELIVERY_PARTNER') ORDER BY u.id DESC LIMIT 1000`); const assigned = await q('SELECT * FROM outlet_delivery_boys WHERE is_active=1'); const aMap = new Map(assigned.map(a => [String(a.user_id), a.outlet_id])); const os = await outlets(); const oMap = new Map(os.map(o => [String(o.id), o])); const rows = riders.map(r => ({ ...r, riderId: r.id, name: r.riderName || r.name, mobile: r.riderMobile || r.mobile || r.phone, email: r.riderEmail || r.email, assignedOutletId: aMap.get(String(r.id)) || null, assignedOutlet: oMap.get(String(aMap.get(String(r.id)))) || null })); ok(res, page(rows, req), 'Delivery boys loaded'); }));
router.post(['/admin/outlets/:outletId/delivery-boys/:userId','/admin/branches/:outletId/delivery-boys/:userId'], ah(async (req, res) => { await ensureSchema(); await x(`INSERT INTO outlet_delivery_boys (outlet_id,user_id,is_active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), is_active=1`, [req.params.outletId, req.params.userId]); ok(res, { outletId: req.params.outletId, userId: req.params.userId }, 'Delivery boy assigned to outlet'); }));

router.get(['/outlet-manager/me','/seller/outlet/me','/seller/restaurant'], ah(async (req, res) => { await ensureSchema(); const userId = req.user?.id || req.query.userId || req.query.user_id; let outlet = null; if (userId) outlet = await one('SELECT * FROM outlets WHERE manager_user_id=? LIMIT 1', [userId]); if (!outlet) outlet = await one('SELECT o.* FROM outlets o JOIN outlet_delivery_boys odb ON odb.outlet_id=o.id WHERE odb.user_id=? LIMIT 1', [userId]); if (!outlet) outlet = (await outlets())[0] || null; ok(res, outlet ? { ...outlet, outletId: outlet.id, outletMode: true, marketplaceSeller: false } : null, outlet ? 'Outlet loaded' : 'No outlet assigned yet'); }));
router.get(['/outlet-manager/orders','/seller/orders','/seller/live-orders'], ah(async (req, res) => { const outletId = req.query.outletId || req.query.outlet_id; const rows = await ordersByOutlet(outletId || null, req.query.status || null); ok(res, page(rows, req), 'Outlet orders loaded'); }));

router.all(['/seller/register','/restaurants/register','/restaurant/verification','/seller/franchise/requests','/admin/franchise-requests','/admin/seller-payout-accounts','/admin/restaurant-payouts'], (req, res) => {
  return ok(res, { disabled: true, replacement: 'single-brand-outlets', message: 'Marketplace seller/franchise/payout workflow is disabled. Use Mr Breado outlet management.' }, 'Marketplace workflow disabled for single-brand Mr Breado system');
});

module.exports = router;
