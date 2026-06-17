const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok, fail } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');
const { requireAuth } = require('../middleware/auth');

const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const s = (v) => String(v ?? '').trim();
async function ex(sql, p = {}) { try { return await exec(sql, p); } catch (e) { console.error('[v61 exec]', e.message); return null; } }
async function q1(sql, p = {}) { try { return await one(sql, p); } catch (e) { console.error('[v61 one]', e.message); return null; } }
async function qa(sql, p = {}) { try { return await many(sql, p); } catch (e) { console.error('[v61 many]', e.message); return []; } }

async function ensureV61Schema() {
  await ex('ALTER TABLE outlets ADD COLUMN gstin VARCHAR(30) NULL');
  await ex('ALTER TABLE outlets ADD COLUMN invoice_legal_name VARCHAR(190) NULL');
  await ex('ALTER TABLE outlets ADD COLUMN invoice_address TEXT NULL');
  await ex('ALTER TABLE outlets ADD COLUMN verification_status VARCHAR(30) NOT NULL DEFAULT "APPROVED"');
  await ex('ALTER TABLE outlets ADD COLUMN can_receive_orders TINYINT(1) NOT NULL DEFAULT 1');
  await ex(`CREATE TABLE IF NOT EXISTS outlet_stock_submissions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    submission_date DATE NOT NULL,
    submitted_by VARCHAR(190) NULL,
    total_items INT NOT NULL DEFAULT 0,
    note VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v61_outlet_stock_submission(outlet_id, submission_date),
    KEY idx_v61_outlet_stock_submission_date(submission_date)
  )`);
}

async function currentOutletId(req) {
  const direct = n(req.user?.outletId || req.user?.outlet_id);
  if (direct) return direct;
  const account = await q1('SELECT outlet_id outletId FROM outlet_manager_accounts WHERE id=:id LIMIT 1', { id: req.user?.id || 0 });
  return n(account?.outletId);
}

function mapOutlet(row) {
  if (!row) return null;
  return {
    ...row,
    outletId: row.id,
    outletCode: row.outlet_code,
    serviceRadiusKm: n(row.service_radius_km, 5),
    managerName: row.manager_name || '',
    managerPhone: row.manager_phone || '',
    managerEmail: row.manager_email || '',
    verificationStatus: 'APPROVED',
    verified: true,
    isVerified: true,
    canReceiveOrders: row.can_receive_orders == null ? true : !!Number(row.can_receive_orders),
    gstin: row.gstin || '',
    gstinRequired: !s(row.gstin),
    invoiceLegalName: row.invoice_legal_name || row.name || 'Mr Breado',
    invoiceAddress: row.invoice_address || row.address || '',
  };
}

router.get('/single-brand/v61/version', (req, res) => ok(res, {
  version: 'single-brand-enterprise-v61',
  focus: 'outlet-verification-bypass-gstin-stock-submission-order-consistency',
  razorpay: 'v22/v26 unchanged'
}, 'v61 active'));

router.post('/admin/outlets/ensure-enterprise-v61-schema', ah(async (req, res) => {
  await ensureV61Schema();
  ok(res, { ready: true }, 'v61 schema ready');
}));

// Create outlets with GSTIN and invoice identity in one transaction-like flow.
router.post('/admin/outlets', ah(async (req, res) => {
  await ensureV61Schema();
  const d = req.body || {};
  const name = s(d.name || d.outletName) || 'Mr Breado Outlet';
  const code = s(d.outletCode || d.outlet_code) || `mr-breado-${Date.now().toString().slice(-6)}`;
  const result = await exec(`INSERT INTO outlets (
    outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,
    manager_name,manager_phone,manager_email,is_open,is_active,gstin,invoice_legal_name,
    invoice_address,verification_status,can_receive_orders
  ) VALUES (
    :code,:name,:address,:city,:state,:pincode,:latitude,:longitude,:radius,
    :managerName,:managerPhone,:managerEmail,:isOpen,1,:gstin,:invoiceLegalName,
    :invoiceAddress,'APPROVED',1
  )`, {
    code,
    name,
    address: s(d.address),
    city: s(d.city),
    state: s(d.state),
    pincode: s(d.pincode),
    latitude: d.latitude || d.lat || null,
    longitude: d.longitude || d.lng || null,
    radius: n(d.serviceRadiusKm || d.service_radius_km, 5),
    managerName: s(d.managerName),
    managerPhone: s(d.managerPhone),
    managerEmail: s(d.managerEmail).toLowerCase(),
    isOpen: d.isOpen === false ? 0 : 1,
    gstin: s(d.gstin || d.gstinNumber).toUpperCase(),
    invoiceLegalName: s(d.invoiceLegalName) || name,
    invoiceAddress: s(d.invoiceAddress) || s(d.address),
  });
  const row = await q1('SELECT * FROM outlets WHERE id=:id', { id: result.insertId });
  ok(res, mapOutlet(row), 'Outlet created', 201);
}));

router.put(['/admin/outlets/:id', '/admin/outlets/:id/business-details'], ah(async (req, res) => {
  await ensureV61Schema();
  const d = req.body || {};
  await exec(`UPDATE outlets SET
    name=COALESCE(NULLIF(:name,''),name),
    address=COALESCE(NULLIF(:address,''),address),
    city=COALESCE(NULLIF(:city,''),city),
    state=COALESCE(NULLIF(:state,''),state),
    pincode=COALESCE(NULLIF(:pincode,''),pincode),
    manager_name=COALESCE(NULLIF(:managerName,''),manager_name),
    manager_phone=COALESCE(NULLIF(:managerPhone,''),manager_phone),
    manager_email=COALESCE(NULLIF(:managerEmail,''),manager_email),
    gstin=:gstin,
    invoice_legal_name=COALESCE(NULLIF(:invoiceLegalName,''),name),
    invoice_address=COALESCE(NULLIF(:invoiceAddress,''),address),
    verification_status='APPROVED',can_receive_orders=1
    WHERE id=:id`, {
    id: req.params.id,
    name: s(d.name || d.outletName), address: s(d.address), city: s(d.city), state: s(d.state), pincode: s(d.pincode),
    managerName: s(d.managerName), managerPhone: s(d.managerPhone), managerEmail: s(d.managerEmail).toLowerCase(),
    gstin: s(d.gstin || d.gstinNumber).toUpperCase(), invoiceLegalName: s(d.invoiceLegalName), invoiceAddress: s(d.invoiceAddress)
  });
  const row = await q1('SELECT * FROM outlets WHERE id=:id', { id: req.params.id });
  ok(res, mapOutlet(row), 'Outlet business details updated');
}));

router.get('/admin/outlets/:id/gstin', ah(async (req, res) => {
  await ensureV61Schema();
  const row = await q1('SELECT id,name,gstin,invoice_legal_name,invoice_address FROM outlets WHERE id=:id', { id: req.params.id });
  if (!row) return fail(res, 'Outlet not found', 404);
  ok(res, { outletId: row.id, outletName: row.name, gstin: row.gstin || '', gstinRequired: !s(row.gstin), invoiceLegalName: row.invoice_legal_name || row.name, invoiceAddress: row.invoice_address || '' });
}));

router.put(['/admin/outlets/:id/gstin', '/admin/outlets/:id/invoice-details'], ah(async (req, res) => {
  await ensureV61Schema();
  const d = req.body || {};
  const gstin = s(d.gstin || d.gstinNumber).toUpperCase();
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) return fail(res, 'GSTIN must contain exactly 15 letters/numbers', 400);
  await exec(`UPDATE outlets SET gstin=:gstin,
    invoice_legal_name=COALESCE(NULLIF(:legalName,''),name),
    invoice_address=COALESCE(NULLIF(:invoiceAddress,''),address)
    WHERE id=:id`, { id: req.params.id, gstin, legalName: s(d.invoiceLegalName), invoiceAddress: s(d.invoiceAddress) });
  const row = await q1('SELECT * FROM outlets WHERE id=:id', { id: req.params.id });
  ok(res, mapOutlet(row), 'Outlet GSTIN and invoice details saved');
}));

// Outlet managers are internal staff. They never require restaurant verification.
router.get('/seller/verification/status', requireAuth, ah(async (req, res) => {
  const id = await currentOutletId(req);
  ok(res, { status: 'APPROVED', verificationStatus: 'APPROVED', verified: true, isVerified: true, outletId: id, message: 'Internal Mr Breado outlet account is approved.' });
}));

router.get(['/seller/restaurant', '/seller/restaurants/me', '/outlet-manager/outlet'], requireAuth, ah(async (req, res) => {
  await ensureV61Schema();
  const id = await currentOutletId(req);
  if (!id) return fail(res, 'No outlet assigned to this account', 404);
  const row = await q1('SELECT * FROM outlets WHERE id=:id', { id });
  if (!row) return fail(res, 'Outlet not found', 404);
  ok(res, mapOutlet(row), 'Assigned outlet loaded');
}));

// Read-only outlet inventory. Outlet managers cannot create products.
router.get(['/seller/products', '/outlet-manager/products', '/outlet-manager/menu'], requireAuth, ah(async (req, res) => {
  await ensureV61Schema();
  const id = await currentOutletId(req);
  if (!id) return fail(res, 'No outlet assigned to this account', 404);
  const rows = await qa(`SELECT s.product_id id,s.product_id productId,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) name,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) title,
    COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl,
    COALESCE(c.name,'Uncategorized') categoryName,
    COALESCE(p.is_veg,1) isVeg,
    GREATEST(COALESCE(s.stock_qty,0),COALESCE(s.stock_quantity,0)) stockQuantity,
    GREATEST(COALESCE(s.prep_time_minutes,0),COALESCE(s.preparation_minutes,0),15) preparationMinutes,
    COALESCE(NULLIF(s.selling_price,0),NULLIF(p.discount_price,0),p.price,0) price,
    COALESCE(s.is_available,1) isAvailable
    FROM outlet_product_stock s
    JOIN products p ON p.id=s.product_id
    LEFT JOIN categories c ON c.id=COALESCE(p.category_id,p.food_category_id,p.menu_category_id)
    WHERE s.outlet_id=:id ORDER BY title`, { id });
  ok(res, { items: rows, products: rows, total: rows.length, readOnlyCatalog: true }, 'Outlet menu loaded');
}));

router.post(['/seller/products', '/outlet-manager/products'], requireAuth, (req, res) => fail(res, 'Outlet managers cannot create foods. Foods are created centrally by admin.', 403));
router.delete(['/seller/products/:id', '/outlet-manager/products/:id'], requireAuth, (req, res) => fail(res, 'Outlet managers cannot delete foods. Contact head office.', 403));

// Daily stock submission used for head-office audit.
router.post(['/outlet-manager/daily-stock', '/outlet-manager/stock-submission'], requireAuth, ah(async (req, res) => {
  await ensureV61Schema();
  const id = await currentOutletId(req);
  if (!id) return fail(res, 'No outlet assigned to this account', 404);
  const d = req.body || {};
  const date = s(d.date) || new Date().toISOString().slice(0, 10);
  const items = Array.isArray(d.items) ? d.items : [];
  if (!items.length) return fail(res, 'At least one stock item is required', 400);
  let updated = 0;
  for (const item of items) {
    const productId = n(item.productId || item.product_id || item.id);
    if (!productId) continue;
    const qty = Math.max(0, n(item.stockQuantity ?? item.closingStock ?? item.stock_quantity));
    const existing = await q1('SELECT GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0)) qty FROM outlet_product_stock WHERE outlet_id=:id AND product_id=:pid', { id, pid: productId });
    if (!existing) continue;
    const before = n(existing.qty);
    await exec('UPDATE outlet_product_stock SET stock_qty=:qty,stock_quantity=:qty,updated_at=NOW() WHERE outlet_id=:id AND product_id=:pid', { qty, id, pid: productId });
    await ex(`INSERT INTO outlet_stock_movements(outlet_id,product_id,movement_type,quantity,before_stock,after_stock,note,created_by)
      VALUES(:id,:pid,'DAILY_STOCK_SUBMISSION',:delta,:before,:qty,:note,:by)`, {
      id, pid: productId, delta: qty - before, before, qty, note: s(item.note) || `Daily stock ${date}`, by: req.user?.username || 'outlet-manager'
    });
    updated++;
  }
  await exec(`INSERT INTO outlet_stock_submissions(outlet_id,submission_date,submitted_by,total_items,note)
    VALUES(:id,:date,:by,:count,:note)
    ON DUPLICATE KEY UPDATE submitted_by=VALUES(submitted_by),total_items=VALUES(total_items),note=VALUES(note),created_at=NOW()`, {
    id, date, by: req.user?.username || 'outlet-manager', count: updated, note: s(d.note)
  });
  ok(res, { outletId: id, date, updatedItems: updated }, 'Daily stock submitted to head office');
}));

router.get('/admin/outlets/:id/stock-submissions', ah(async (req, res) => {
  await ensureV61Schema();
  const rows = await qa('SELECT * FROM outlet_stock_submissions WHERE outlet_id=:id ORDER BY submission_date DESC LIMIT 400', { id: req.params.id });
  ok(res, { items: rows, submissions: rows, total: rows.length });
}));

// Extend outlet dashboard with GSTIN and daily stock audit metadata.
router.get('/admin/outlets/:id/business-audit', ah(async (req, res) => {
  await ensureV61Schema();
  const outlet = await q1('SELECT * FROM outlets WHERE id=:id', { id: req.params.id });
  if (!outlet) return fail(res, 'Outlet not found', 404);
  const [orders, submissions] = await Promise.all([
    qa(`SELECT o.id,o.order_number,o.status,o.payment_type,o.payment_status,o.grand_total,o.created_at,
      u.name customerName,u.email customerEmail,COALESCE(u.mobile,u.phone) customerPhone
      FROM orders o LEFT JOIN users u ON u.id=o.user_id WHERE o.restaurant_id=:id ORDER BY o.id DESC LIMIT 500`, { id: req.params.id }),
    qa('SELECT * FROM outlet_stock_submissions WHERE outlet_id=:id ORDER BY submission_date DESC LIMIT 400', { id: req.params.id })
  ]);
  for (const order of orders) {
    order.items = await qa(`SELECT oi.*,COALESCE(NULLIF(oi.title,''),NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',oi.product_id)) productName
      FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=:id ORDER BY oi.id`, { id: order.id });
  }
  ok(res, { outlet: mapOutlet(outlet), orders, stockSubmissions: submissions, gstinRequired: !s(outlet.gstin) }, 'Outlet business audit loaded');
}));

router.use(require('./singleBrandEnterpriseV60'));
module.exports = router;
