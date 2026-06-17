const express = require('express');
const router = express.Router();
const axios = require('axios');
const ah = require('../utils/asyncHandler');
const { ok, fail } = require('../utils/respond');
const { one, many, exec, pool } = require('../utils/db');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const s = (v, d = '') => String(v ?? d).trim();
const upper = (v) => s(v).toUpperCase();
const nowIso = () => new Date().toISOString();
const TERMINAL = new Set(['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'REFUNDED']);

async function q1(sql, p = {}) { try { return await one(sql, p); } catch (e) { console.error('[v62 one]', e.message); return null; } }
async function qa(sql, p = {}) { try { return await many(sql, p); } catch (e) { console.error('[v62 many]', e.message); return []; } }
async function ex(sql, p = {}) { try { return await exec(sql, p); } catch (e) { console.error('[v62 exec]', e.message); return null; } }

const colCache = new Map();
async function cols(table) {
  if (colCache.has(table)) return colCache.get(table);
  try {
    const [rows] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``);
    const set = new Set(rows.map(r => r.Field));
    colCache.set(table, set);
    return set;
  } catch {
    const set = new Set();
    colCache.set(table, set);
    return set;
  }
}
async function tableExists(table) { return (await cols(table)).size > 0; }

async function ensureSchema() {
  const alters = [
    'ADD COLUMN selected_outlet_id BIGINT NULL',
    'ADD COLUMN auto_cancel_at DATETIME NULL',
    'ADD COLUMN auto_cancel_reason VARCHAR(500) NULL',
    'ADD COLUMN cancelled_at DATETIME NULL',
    'ADD COLUMN outlet_accepted_at DATETIME NULL',
    'ADD COLUMN rider_assigned_at DATETIME NULL',
    'ADD COLUMN rider_picked_at DATETIME NULL',
    'ADD COLUMN invoice_generated_at DATETIME NULL',
    'ADD COLUMN invoice_sent_at DATETIME NULL',
  ];
  for (const a of alters) await ex(`ALTER TABLE orders ${a}`);
  await ex(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    rider_id BIGINT NULL,
    assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at DATETIME NULL,
    picked_up_at DATETIME NULL,
    delivered_at DATETIME NULL,
    UNIQUE KEY uq_v62_outlet_order(order_id),
    KEY idx_v62_outlet(outlet_id), KEY idx_v62_rider(rider_id)
  )`);
  await ex(`CREATE TABLE IF NOT EXISTS outlet_order_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    event_note VARCHAR(700) NULL,
    actor_role VARCHAR(40) NULL,
    actor_id BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_v62_event_outlet(outlet_id), KEY idx_v62_event_order(order_id)
  )`);
  await ex(`CREATE TABLE IF NOT EXISTS invoice_delivery_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL,
    user_id BIGINT NULL,
    outlet_id BIGINT NULL,
    delivery_channel VARCHAR(30) NOT NULL DEFAULT 'APP',
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    invoice_path VARCHAR(500) NULL,
    message VARCHAR(700) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v62_invoice_order_channel(order_id,delivery_channel)
  )`);
  await ex(`CREATE TABLE IF NOT EXISTS business_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    role VARCHAR(40) NOT NULL DEFAULT 'USER',
    title VARCHAR(180) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(60) NOT NULL DEFAULT 'ORDER',
    target_type VARCHAR(50) NULL,
    target_value VARCHAR(255) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_v62_bnotif_user(user_id), KEY idx_v62_bnotif_read(is_read)
  )`);
}

function normalizeCoord(lat, lng) {
  let a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const x = Math.sin(dLat/2) ** 2 + Math.cos(aLat*Math.PI/180) * Math.cos(bLat*Math.PI/180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
async function businessSettings() {
  const row = await q1('SELECT * FROM platform_business_settings WHERE id=1 LIMIT 1') || {};
  return {
    key: s(row.google_maps_api_key),
    provider: upper(row.distance_provider || 'HAVERSINE'),
    baseDeliveryCharge: n(row.base_delivery_charge, 20),
    deliveryChargePerKm: n(row.delivery_charge_per_km, 8),
    riderBasePay: n(row.rider_base_pay, 25),
    riderPayPerKm: n(row.rider_pay_per_km, 7),
  };
}
async function googleDistanceKm(key, from, to) {
  if (!key) return null;
  try {
    const r = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      timeout: 8000,
      params: { origins: `${from.lat},${from.lng}`, destinations: `${to.lat},${to.lng}`, key, mode: 'driving' }
    });
    const el = r.data?.rows?.[0]?.elements?.[0];
    if (el?.status === 'OK' && Number.isFinite(Number(el.distance?.value))) return Number(el.distance.value) / 1000;
  } catch (e) { console.error('[v62 google distance]', e.message); }
  return null;
}
async function exactDistance(user, outlet) {
  const to = normalizeCoord(outlet.latitude, outlet.longitude);
  if (!user || !to) return null;
  const cfg = await businessSettings();
  let km = null;
  if (cfg.provider === 'GOOGLE') km = await googleDistanceKm(cfg.key, user, to);
  if (km == null) km = haversineKm(user.lat, user.lng, to.lat, to.lng);
  return Number(km.toFixed(2));
}
function requestBase(req) { return `${req.protocol}://${req.get('host')}`; }
function imageValue(req, ...values) {
  const raw = values.map(v => s(v)).find(Boolean) || '';
  if (!raw) return '';
  if (/^(https?:|data:|file:)/i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${requestBase(req)}${raw}`;
  return raw;
}
function mapOutlet(req, row, distanceKm = null) {
  if (!row) return null;
  const rating = n(row.rating || row.average_rating || row.star_rating, 4.8);
  return {
    ...row,
    id: n(row.id), outletId: n(row.id), restaurantId: n(row.id),
    name: row.name || row.outlet_name || 'Mr Breado Outlet',
    outletName: row.name || row.outlet_name || 'Mr Breado Outlet',
    outletCode: row.outlet_code || row.code || '',
    bannerImage: imageValue(req, row.banner_image, row.banner_url, row.banner, row.cover_image),
    banner_image: imageValue(req, row.banner_image, row.banner_url, row.banner, row.cover_image),
    logoImage: imageValue(req, row.logo_image, row.profile_image, row.logo_url, row.image),
    profileImage: imageValue(req, row.profile_image, row.logo_image, row.logo_url, row.image),
    rating, starRating: rating,
    distanceKm, exactDistanceKm: distanceKm,
    serviceRadiusKm: n(row.service_radius_km, 5),
    isServiceable: distanceKm == null ? false : distanceKm <= n(row.service_radius_km, 5),
    isOpen: row.is_open == null ? true : !!Number(row.is_open),
    phone: row.contact_phone || row.manager_phone || '',
    email: row.contact_email || row.manager_email || '',
    gstin: row.gstin || '',
  };
}

async function currentOutletId(req) {
  const direct = n(req.user?.outletId || req.user?.outlet_id);
  if (direct) return direct;
  const row = await q1('SELECT outlet_id outletId FROM outlet_manager_accounts WHERE id=:id LIMIT 1', { id: n(req.user?.id) });
  return n(row?.outletId);
}
async function notifyUser(userId, title, message, type = 'ORDER', targetType = null, targetValue = null) {
  if (!userId) return;
  await ensureSchema();
  await ex(`INSERT INTO business_notifications(user_id,role,title,message,type,target_type,target_value)
    VALUES(:userId,'USER',:title,:message,:type,:targetType,:targetValue)`, { userId, title, message, type, targetType, targetValue });
  if (await tableExists('notifications')) {
    await ex(`INSERT INTO notifications(user_id,role,title,message,type,is_read,created_at)
      VALUES(:userId,'USER',:title,:message,:type,0,NOW())`, { userId, title, message, type });
  }
  if (await tableExists('app_notifications')) {
    await ex(`INSERT INTO app_notifications(created_at,deleted,message,read_status,target_type,target_value,title,type,user_id,updated_at)
      VALUES(NOW(6),b'0',:message,b'0',:targetType,:targetValue,:title,:appType,:userId,NOW(6))`, {
      message, targetType, targetValue, title, appType: type === 'INVOICE' ? 'INVOICE' : 'ORDER', userId
    });
  }
}

async function orderItems(orderId) {
  return qa(`SELECT oi.*,COALESCE(NULLIF(oi.title,''),NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',oi.product_id)) productName,
    COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=:id ORDER BY oi.id`, { id: orderId });
}
async function detailedOrder(where, params) {
  const rows = await qa(`SELECT o.*,COALESCE(o.selected_outlet_id,o.restaurant_id) outletId,o.grand_total total,
    u.name customerName,u.email customerEmail,COALESCE(u.mobile,u.phone) customerMobile,
    ot.name outletName,ot.outlet_code outletCode,ot.address outletAddress,ot.gstin outletGstin,
    ot.invoice_legal_name invoiceLegalName,ot.invoice_address invoiceAddress,
    oa.rider_id riderId,ru.name riderName,COALESCE(ru.mobile,ru.phone) riderPhone
    FROM orders o
    LEFT JOIN users u ON u.id=o.user_id
    LEFT JOIN outlets ot ON ot.id=COALESCE(o.selected_outlet_id,o.restaurant_id)
    LEFT JOIN outlet_order_assignments oa ON oa.order_id=o.id
    LEFT JOIN delivery_partner_profiles dp ON dp.id=oa.rider_id OR dp.user_id=oa.rider_id
    LEFT JOIN users ru ON ru.id=dp.user_id
    WHERE ${where} ORDER BY o.id DESC LIMIT 1000`, params);
  for (const r of rows) r.items = await orderItems(r.id);
  return rows;
}

function pdfBuffer(lines, title = 'Mr Breado Tax Invoice') {
  const safe = [title, ...lines].map(x => String(x ?? '').replace(/[()\\]/g, ''));
  const text = safe.slice(0, 38).map((line, i) => `BT /F1 ${i===0?18:10} Tf 45 ${790-i*19} Td (${line}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offsets = [0];
  objs.forEach((o,i) => { offsets.push(Buffer.byteLength(out)); out += `${i+1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out); out += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`;
  for (let i=1;i<offsets.length;i++) out += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  out += `trailer << /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
async function invoiceOrder(id, userId = null) {
  const where = userId ? `(o.id=:id OR o.order_number=:id OR o.slug=:id) AND o.user_id=:userId` : `(o.id=:id OR o.order_number=:id OR o.slug=:id)`;
  return (await detailedOrder(where, { id, userId }))[0] || null;
}
function invoiceLines(o) {
  return [
    `Invoice / Order: ${o.order_number || o.slug || o.id}`,
    `Date: ${o.created_at || ''}`,
    `Outlet: ${o.invoiceLegalName || o.outletName || 'Mr Breado'}`,
    `GSTIN: ${o.outletGstin || 'Not provided'}`,
    `Outlet address: ${o.invoiceAddress || o.outletAddress || '-'}`,
    `Customer: ${o.customerName || '-'} | ${o.customerMobile || '-'}`,
    `Customer email: ${o.customerEmail || '-'}`,
    `Delivery address: ${o.delivery_address || '-'}, ${o.delivery_city || ''} ${o.delivery_zipcode || ''}`,
    `Payment: ${o.payment_type || '-'} / ${o.payment_status || '-'}`,
    `Status: ${o.status || '-'}`,
    'Items:',
    ...(o.items || []).slice(0, 20).map(i => `${n(i.quantity,1)} x ${i.productName || i.title || 'Food'} @ INR ${n(i.unit_price).toFixed(2)} = INR ${n(i.total_price || n(i.quantity,1)*n(i.unit_price)).toFixed(2)}`),
    `Items total: INR ${n(o.items_total).toFixed(2)}`,
    `Delivery fee: INR ${n(o.delivery_fee).toFixed(2)}`,
    `Platform fee: INR ${n(o.platform_fee).toFixed(2)}`,
    `Discount: INR ${n(o.discount).toFixed(2)}`,
    `Grand total: INR ${n(o.grand_total).toFixed(2)}`,
    'Thank you for ordering from Mr Breado.'
  ];
}
async function queueInvoice(o) {
  const url = `/api/user/orders/${encodeURIComponent(o.order_number || o.id)}/invoice.pdf`;
  await ex(`INSERT INTO invoice_delivery_log(order_id,user_id,outlet_id,delivery_channel,status,invoice_path,message)
    VALUES(:orderId,:userId,:outletId,'APP','SENT',:url,:message)
    ON DUPLICATE KEY UPDATE status='SENT',invoice_path=VALUES(invoice_path),message=VALUES(message),created_at=NOW()`, {
    orderId: o.id, userId: o.user_id, outletId: n(o.outletId || o.restaurant_id), url,
    message: `Your invoice for order ${o.order_number || o.id} is ready.`
  });
  await notifyUser(o.user_id, 'Invoice ready', `Your order ${o.order_number || o.id} has been delivered. Tap to download the GST invoice.`, 'INVOICE', 'ORDER_INVOICE', String(o.order_number || o.id));
  await ex('UPDATE orders SET invoice_generated_at=COALESCE(invoice_generated_at,NOW()),invoice_sent_at=NOW() WHERE id=:id', { id: o.id });
}


async function restoreOutletStock(orderId, outletId) {
  const items = await orderItems(orderId);
  for (const item of items) {
    const qty = Math.max(0, n(item.quantity));
    if (!qty || !item.product_id) continue;
    await ex(`UPDATE outlet_product_stock SET stock_qty=COALESCE(stock_qty,0)+:qty,stock_quantity=COALESCE(stock_quantity,0)+:qty,updated_at=NOW() WHERE outlet_id=:outletId AND product_id=:productId`, {
      qty, outletId, productId: item.product_id
    });
    await ex(`INSERT INTO outlet_stock_movements(outlet_id,product_id,movement_type,quantity,before_stock,after_stock,note,created_by)
      SELECT :outletId,:productId,'ORDER_CANCEL_RESTORE',:qty,GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0))-:qty,GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0)),'Stock restored after order cancellation','SYSTEM'
      FROM outlet_product_stock WHERE outlet_id=:outletId AND product_id=:productId`, { qty, outletId, productId: item.product_id });
  }
}

async function cancelExpiredOrders() {
  await ensureSchema();
  const rows = await qa(`SELECT o.id,o.user_id,o.order_number,o.status,COALESCE(o.selected_outlet_id,o.restaurant_id) outletId,o.created_at,
      oa.rider_id,oa.accepted_at,oa.picked_up_at
    FROM orders o LEFT JOIN outlet_order_assignments oa ON oa.order_id=o.id
    WHERE o.created_at <= DATE_SUB(NOW(),INTERVAL 1 HOUR)
      AND UPPER(COALESCE(o.status,'')) IN ('PLACED','PENDING','ACCEPTED','PREPARING','READY_FOR_PICKUP')
      AND (oa.picked_up_at IS NULL)
    LIMIT 200`);
  for (const o of rows) {
    const reason = o.rider_id ? 'Rider did not pick up the order within 1 hour.' : 'Outlet/rider did not accept the order within 1 hour.';
    await ex(`UPDATE orders SET status='CANCELLED',payment_status=CASE WHEN UPPER(payment_type) IN ('ONLINE','RAZORPAY') THEN 'REFUND_PENDING' ELSE payment_status END,auto_cancel_reason=:reason,cancelled_at=NOW() WHERE id=:id AND UPPER(status) IN ('PLACED','PENDING','ACCEPTED','PREPARING','READY_FOR_PICKUP')`, { id: o.id, reason });
    await restoreOutletStock(o.id, n(o.outletId));
    const items = await orderItems(o.id);
    const itemText = items.slice(0, 5).map(i => `${n(i.quantity,1)}× ${i.productName || i.title || 'Food'}`).join(', ');
    await notifyUser(o.user_id, `Order ${o.order_number || o.id} cancelled`, `${reason}${itemText ? ` Items: ${itemText}.` : ''}`, 'ORDER', 'ORDER', String(o.order_number || o.id));
    await ex(`INSERT INTO outlet_order_events(outlet_id,order_id,event_type,event_note,actor_role) VALUES(:outletId,:orderId,'AUTO_CANCELLED',:reason,'SYSTEM')`, { outletId: n(o.outletId), orderId: o.id, reason });
  }
}
if (!global.__mrBreadoV62AutoCancelStarted) {
  global.__mrBreadoV62AutoCancelStarted = true;
  setTimeout(() => cancelExpiredOrders().catch(e => console.error('[v62 autocancel first]', e.message)), 15000);
  setInterval(() => cancelExpiredOrders().catch(e => console.error('[v62 autocancel]', e.message)), 60000).unref();
}

router.get('/single-brand/v62/version', (req,res) => ok(res, { version:'single-brand-enterprise-v62', focus:'outlet-order-routing-distance-invoice-autocancel', razorpay:'v22/v26 unchanged' }, 'v62 active'));
router.post('/admin/outlets/ensure-enterprise-v62-schema', ah(async(req,res)=>{ await ensureSchema(); ok(res,{ready:true},'v62 schema ready'); }));

router.get(['/outlets','/user/outlets'], optionalAuth, ah(async(req,res)=>{
  await ensureSchema();
  const user = normalizeCoord(req.query.lat ?? req.query.latitude, req.query.lng ?? req.query.longitude);
  const rows = await qa('SELECT * FROM outlets WHERE COALESCE(is_active,1)=1 ORDER BY id');
  const mapped = [];
  for (const r of rows) mapped.push(mapOutlet(req, r, await exactDistance(user, r)));
  mapped.sort((a,b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  ok(res,{items:mapped,outlets:mapped,total:mapped.length},'Outlets loaded');
}));
router.get(['/outlets/nearest','/user/outlets/nearest'], optionalAuth, ah(async(req,res)=>{
  await ensureSchema();
  const user = normalizeCoord(req.query.lat ?? req.query.latitude, req.query.lng ?? req.query.longitude);
  if (!user) return fail(res,'Valid user latitude and longitude are required',400);
  const rows = await qa('SELECT * FROM outlets WHERE COALESCE(is_active,1)=1 AND COALESCE(is_open,1)=1');
  const mapped=[]; for(const r of rows) mapped.push(mapOutlet(req,r,await exactDistance(user,r)));
  mapped.sort((a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9));
  const nearest=mapped[0]; if(!nearest) return fail(res,'No active Mr Breado outlet found',404);
  ok(res,nearest,nearest.isServiceable?'Nearest serviceable outlet found':'Nearest outlet is outside its delivery radius');
}));
router.get(['/outlets/:id/menu','/user/outlets/:id/menu'], optionalAuth, ah(async(req,res)=>{
  const outlet = await q1('SELECT * FROM outlets WHERE id=:id AND COALESCE(is_active,1)=1',{id:req.params.id});
  if(!outlet) return fail(res,'Outlet not found',404);
  const rows = await qa(`SELECT p.id,p.id productId,COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) name,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) title,
    COALESCE(NULLIF(p.description,''),NULLIF(p.subtitle,''),'') description,
    COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl,
    COALESCE(c.name,'Uncategorized') categoryName,COALESCE(p.is_veg,1) isVeg,
    GREATEST(COALESCE(s.stock_qty,0),COALESCE(s.stock_quantity,0)) stockQuantity,
    GREATEST(COALESCE(s.prep_time_minutes,0),COALESCE(s.preparation_minutes,0),15) preparationMinutes,
    COALESCE(NULLIF(s.selling_price,0),NULLIF(p.discount_price,0),p.price,0) price,
    COALESCE(s.is_available,1) isAvailable
    FROM outlet_product_stock s JOIN products p ON p.id=s.product_id
    LEFT JOIN categories c ON c.id=COALESCE(p.category_id,p.food_category_id,p.menu_category_id)
    WHERE s.outlet_id=:id AND COALESCE(s.is_available,1)=1 AND GREATEST(COALESCE(s.stock_qty,0),COALESCE(s.stock_quantity,0))>0
    ORDER BY categoryName,title`,{id:req.params.id});
  ok(res,{outlet:mapOutlet(req,outlet,null),items:rows,menu:rows,foods:rows,products:rows,total:rows.length},'Outlet menu loaded');
}));

// Strict outlet-routed order creation with service-radius enforcement.
router.post('/user/orders', requireAuth, ah(async(req,res,next)=>{
  await ensureSchema();
  const d=req.body||{};
  const outletId=n(d.outletId||d.outlet_id||d.restaurantId||d.restaurant_id);
  if(!outletId) return next();
  const outlet=await q1('SELECT * FROM outlets WHERE id=:id AND COALESCE(is_active,1)=1 AND COALESCE(is_open,1)=1 AND COALESCE(can_receive_orders,1)=1',{id:outletId});
  if(!outlet) return fail(res,'Selected outlet is closed or unavailable',409);
  const addr=d.address||d.deliveryAddress||d.delivery_address||{};
  const userCoord=normalizeCoord(addr.latitude??d.userLatitude??d.user_latitude??d.latitude,addr.longitude??d.userLongitude??d.user_longitude??d.longitude);
  if(!userCoord) return fail(res,'A valid delivery location is required before placing the order',400);
  const km=await exactDistance(userCoord,outlet);
  if(km==null) return fail(res,'Outlet distance could not be calculated. Please update your location or contact support.',409);
  const radius=n(outlet.service_radius_km,5);
  if(km>radius) return fail(res,`This outlet delivers within ${radius.toFixed(1)} km. Your location is ${km.toFixed(2)} km away.`,409);

  const cart=await q1('SELECT * FROM carts WHERE user_id=:uid LIMIT 1',{uid:req.user.id});
  let items=Array.isArray(d.items)?d.items:[];
  if(!items.length&&cart) items=await qa(`SELECT ci.product_id productId,ci.quantity,COALESCE(ci.unit_price,p.discount_price,p.price,0) unitPrice,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) name FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=:cid`,{cid:cart.id});
  if(!items.length) return fail(res,'Cart is empty',400);
  let subtotal=0;
  for(const it of items){
    const pid=n(it.productId||it.product_id||it.id), qty=Math.max(1,n(it.quantity,1));
    const st=await q1(`SELECT GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0)) stockQuantity,
      COALESCE(NULLIF(selling_price,0),0) sellingPrice,COALESCE(is_available,1) isAvailable
      FROM outlet_product_stock WHERE outlet_id=:outletId AND product_id=:pid LIMIT 1`,{outletId,pid});
    if(!st||!Number(st.isAvailable)) return fail(res,`Food item ${pid} is unavailable at this outlet`,409);
    if(n(st.stockQuantity)<qty) return fail(res,`Only ${n(st.stockQuantity)} unit(s) remain for ${it.name||it.title||`food ${pid}`}`,409);
    const price=n(st.sellingPrice||it.unitPrice||it.unit_price||it.price); it.__pid=pid; it.__qty=qty; it.__price=price; subtotal+=price*qty;
  }
  const cfg=await businessSettings();
  const deliveryFee=n(d.deliveryFee??d.delivery_fee, Math.max(0,cfg.baseDeliveryCharge+cfg.deliveryChargePerKm*km));
  const platformFee=n(d.platformFee??d.platform_fee,0), discount=n(d.discount??d.discountAmount,0);
  const total=Math.max(0,n(d.total||d.grandTotal||d.grand_total,subtotal+deliveryFee+platformFee-discount));
  const paymentType=upper(d.paymentType||d.payment_type||d.paymentMethod||'COD');
  const paymentStatus=['ONLINE','RAZORPAY'].includes(paymentType)?'PAID':'PENDING';
  const orderNumber=`MBR-${Date.now()}-${Math.floor(Math.random()*9000+1000)}`;
  const created=await exec(`INSERT INTO orders(user_id,restaurant_id,selected_outlet_id,slug,order_number,status,payment_type,payment_status,items_total,delivery_fee,platform_fee,discount,grand_total,
    delivery_address,delivery_city,delivery_state,delivery_country,delivery_zipcode,delivery_mobile,delivery_name,delivery_latitude,delivery_longitude,order_note,razorpay_order_id,razorpay_payment_id,razorpay_signature,auto_cancel_at,created_at)
    VALUES(:uid,:outletId,:outletId,:slug,:orderNumber,'PLACED',:paymentType,:paymentStatus,:subtotal,:deliveryFee,:platformFee,:discount,:total,
    :address,:city,:state,:country,:zipcode,:mobile,:name,:lat,:lng,:note,:rzOrder,:rzPayment,:rzSig,DATE_ADD(NOW(),INTERVAL 1 HOUR),NOW())`,{
    uid:req.user.id,outletId,slug:orderNumber.toLowerCase(),orderNumber,paymentType,paymentStatus,subtotal,deliveryFee,platformFee,discount,total,
    address:s(addr.address||addr.addressLine1||d.addressLine),city:s(addr.city||d.city),state:s(addr.state||d.state),country:s(addr.country||'India'),zipcode:s(addr.pincode||addr.zipcode||d.pincode),mobile:s(addr.mobile||addr.phone||d.mobile),name:s(addr.name||req.user.name),lat:userCoord.lat,lng:userCoord.lng,note:s(d.deliveryInstruction||d.orderNote),rzOrder:d.razorpayOrderId||d.razorpay_order_id||null,rzPayment:d.razorpayPaymentId||d.razorpay_payment_id||null,rzSig:d.razorpaySignature||d.razorpay_signature||null
  });
  const orderId=created.insertId;
  for(const it of items){
    await exec(`INSERT INTO order_items(order_id,product_id,title,quantity,unit_price,total_price,customization_total,created_at)
      VALUES(:orderId,:pid,:title,:qty,:price,:lineTotal,0,NOW())`,{orderId,pid:it.__pid,title:it.name||it.title||`Food #${it.__pid}`,qty:it.__qty,price:it.__price,lineTotal:it.__price*it.__qty});
    await exec(`UPDATE outlet_product_stock SET stock_qty=GREATEST(0,COALESCE(stock_qty,stock_quantity,0)-:qty),stock_quantity=GREATEST(0,COALESCE(stock_quantity,stock_qty,0)-:qty),updated_at=NOW() WHERE outlet_id=:outletId AND product_id=:pid`,{qty:it.__qty,outletId,pid:it.__pid});
  }
  await exec(`INSERT INTO outlet_order_assignments(outlet_id,order_id,assigned_at) VALUES(:outletId,:orderId,NOW()) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id),assigned_at=NOW()`,{outletId,orderId});
  await ex(`INSERT INTO outlet_order_events(outlet_id,order_id,event_type,event_note,actor_role,actor_id) VALUES(:outletId,:orderId,'ORDER_PLACED',:note,'USER',:uid)`,{outletId,orderId,note:`Order placed for ${outlet.name}; distance ${km.toFixed(2)} km`,uid:req.user.id});
  if(cart){await ex('DELETE FROM cart_item_customizations WHERE cart_item_id IN (SELECT id FROM cart_items WHERE cart_id=:cid)',{cid:cart.id});await ex('DELETE FROM cart_items WHERE cart_id=:cid',{cid:cart.id});}
  ok(res,{...(await q1('SELECT *,grand_total total FROM orders WHERE id=:id',{id:orderId})),outletId,outletName:outlet.name,distanceKm:km,isServiceable:true},'Order placed and routed to selected outlet',201);
}));

router.get(['/seller/orders','/seller/live-orders','/outlet-manager/orders'],requireAuth,ah(async(req,res)=>{
  await ensureSchema(); const outletId=await currentOutletId(req); if(!outletId)return fail(res,'No outlet assigned to this account',404);
  const rows=await detailedOrder('(COALESCE(o.selected_outlet_id,o.restaurant_id)=:outletId OR oa.outlet_id=:outletId)',{outletId});
  ok(res,{items:rows,content:rows,orders:rows,total:rows.length,outletId},'Outlet orders loaded');
}));
router.get(['/seller/orders/:id','/outlet-manager/orders/:id'],requireAuth,ah(async(req,res)=>{
  const outletId=await currentOutletId(req); const rows=await detailedOrder('(COALESCE(o.selected_outlet_id,o.restaurant_id)=:outletId OR oa.outlet_id=:outletId) AND (o.id=:id OR o.order_number=:id OR o.slug=:id)',{outletId,id:req.params.id});
  if(!rows[0])return fail(res,'Order not found for this outlet',404); ok(res,rows[0],'Outlet order details loaded');
}));
router.get(['/admin/outlets/:id/orders','/admin/business/outlets/:id/orders'],ah(async(req,res)=>{
  const rows=await detailedOrder('(COALESCE(o.selected_outlet_id,o.restaurant_id)=:outletId OR oa.outlet_id=:outletId)',{outletId:req.params.id});
  ok(res,{items:rows,orders:rows,total:rows.length,totalSales:rows.filter(r=>!TERMINAL.has(upper(r.status))||['DELIVERED','COMPLETED'].includes(upper(r.status))).reduce((a,r)=>a+n(r.total),0)},'Outlet order history loaded');
}));

async function outletOwnedOrder(req,id){const outletId=await currentOutletId(req);return (await detailedOrder('(COALESCE(o.selected_outlet_id,o.restaurant_id)=:outletId OR oa.outlet_id=:outletId) AND (o.id=:id OR o.order_number=:id OR o.slug=:id)',{outletId,id}))[0]||null;}
async function setOutletStatus(req,res,status,message){
  const o=await outletOwnedOrder(req,req.params.id); if(!o)return fail(res,'Order not found for this outlet',404);
  await ex('UPDATE orders SET status=:status,outlet_accepted_at=CASE WHEN :status=\'ACCEPTED\' THEN NOW() ELSE outlet_accepted_at END WHERE id=:id',{status,id:o.id});
  if(status==='ACCEPTED') await ex('UPDATE outlet_order_assignments SET accepted_at=NOW() WHERE order_id=:id',{id:o.id});
  await ex(`INSERT INTO outlet_order_events(outlet_id,order_id,event_type,event_note,actor_role,actor_id) VALUES(:outletId,:orderId,:event,:note,'OUTLET_MANAGER',:actor)`,{outletId:n(o.outletId),orderId:o.id,event:status,note:message,actor:req.user?.id||null});
  await notifyUser(o.user_id,`Order ${o.order_number||o.id} update`,message,'ORDER','ORDER',String(o.order_number||o.id));
  ok(res,{id:o.id,status},message);
}
router.post(['/seller/orders/:id/accept','/outlet-manager/orders/:id/accept'],requireAuth,ah((req,res)=>setOutletStatus(req,res,'ACCEPTED','Your outlet accepted the order.')));
router.post(['/seller/orders/:id/preparing','/outlet-manager/orders/:id/preparing'],requireAuth,ah((req,res)=>setOutletStatus(req,res,'PREPARING','Your order is being prepared.')));
router.post(['/seller/orders/:id/ready','/outlet-manager/orders/:id/ready'],requireAuth,ah((req,res)=>setOutletStatus(req,res,'READY_FOR_PICKUP','Your order is ready for rider pickup.')));
router.post(['/seller/orders/:id/reject','/seller/orders/:id/cancel','/outlet-manager/orders/:id/reject'],requireAuth,ah(async(req,res)=>{
  const o=await outletOwnedOrder(req,req.params.id); if(!o)return fail(res,'Order not found for this outlet',404);
  const reason=s(req.body?.reason,'Order rejected by outlet'); await ex(`UPDATE orders SET status='CANCELLED',payment_status=CASE WHEN UPPER(payment_type) IN ('ONLINE','RAZORPAY') THEN 'REFUND_PENDING' ELSE payment_status END,auto_cancel_reason=:reason,cancelled_at=NOW() WHERE id=:id`,{id:o.id,reason}); await restoreOutletStock(o.id,n(o.outletId));
  await notifyUser(o.user_id,`Order ${o.order_number||o.id} cancelled`,`${reason}. Items: ${(o.items||[]).map(i=>`${n(i.quantity,1)}× ${i.productName}`).join(', ')}`,'ORDER','ORDER',String(o.order_number||o.id));
  ok(res,{id:o.id,status:'CANCELLED'},'Order cancelled');
}));

router.post(['/rider/orders/:id/accept','/delivery/orders/:id/accept','/delivery/offers/:id/accept'],requireAuth,ah(async(req,res)=>{
  await ensureSchema(); const o=await invoiceOrder(req.params.id); if(!o)return fail(res,'Order not found',404);
  const riderId=n(req.user?.id); await ex(`INSERT INTO outlet_order_assignments(outlet_id,order_id,rider_id,assigned_at,accepted_at) VALUES(:outletId,:orderId,:riderId,NOW(),NOW()) ON DUPLICATE KEY UPDATE rider_id=:riderId,accepted_at=NOW()`,{outletId:n(o.outletId),orderId:o.id,riderId});
  await ex('UPDATE orders SET rider_assigned_at=NOW() WHERE id=:id',{id:o.id}); ok(res,{orderId:o.id,riderId},'Delivery accepted');
}));
router.post(['/rider/orders/:id/picked-up','/rider/orders/:id/pickup','/delivery/orders/:id/picked-up','/delivery/orders/:id/out-for-delivery'],requireAuth,ah(async(req,res)=>{
  const o=await invoiceOrder(req.params.id); if(!o)return fail(res,'Order not found',404); await ex(`UPDATE outlet_order_assignments SET picked_up_at=NOW() WHERE order_id=:id`,{id:o.id}); await ex(`UPDATE orders SET status='OUT_FOR_DELIVERY',rider_picked_at=NOW() WHERE id=:id`,{id:o.id}); ok(res,{orderId:o.id,status:'OUT_FOR_DELIVERY'},'Order picked up');
}));
router.post(['/rider/orders/:id/delivered','/rider/orders/:id/complete','/delivery/orders/:id/delivered','/admin/orders/:id/delivered'],requireAuth,ah(async(req,res)=>{
  const o=await invoiceOrder(req.params.id); if(!o)return fail(res,'Order not found',404); await ex(`UPDATE orders SET status='DELIVERED',payment_status=CASE WHEN payment_type='COD' THEN 'PAID' ELSE payment_status END WHERE id=:id`,{id:o.id}); await ex(`UPDATE outlet_order_assignments SET delivered_at=NOW() WHERE order_id=:id`,{id:o.id}); const fresh=await invoiceOrder(o.id); await queueInvoice(fresh); ok(res,{orderId:o.id,status:'DELIVERED',invoiceReady:true},'Order delivered and invoice sent to customer');
}));

async function sendInvoice(req,res,userScoped=false){await ensureSchema();const o=await invoiceOrder(req.params.id,userScoped?n(req.user?.id):null);if(!o)return fail(res,'Order not found',404);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${s(o.order_number||o.id).replace(/[^a-z0-9_-]/gi,'_')}_invoice.pdf"`);res.send(pdfBuffer(invoiceLines(o)));}
router.get(['/admin/orders/:id/invoice.pdf','/admin/mr-breado/orders/:id/invoice.pdf','/seller/orders/:id/invoice.pdf'],requireAuth,ah((req,res)=>sendInvoice(req,res,false)));
router.get(['/user/orders/:id/invoice.pdf','/orders/:id/invoice.pdf'],requireAuth,ah((req,res)=>sendInvoice(req,res,true)));
router.post(['/admin/orders/:id/invoice/send-to-customer','/admin/mr-breado/orders/:id/invoice/send-to-customer','/seller/orders/:id/invoice/send-to-customer'],requireAuth,ah(async(req,res)=>{const o=await invoiceOrder(req.params.id);if(!o)return fail(res,'Order not found',404);await queueInvoice(o);ok(res,{sent:true,orderId:o.id},'Invoice sent to customer notifications');}));

router.get('/notifications',requireAuth,ah(async(req,res)=>{
  await ensureSchema();
  const business=await qa(`SELECT id,user_id,role,title,message,type,target_type,target_value,is_read,created_at FROM business_notifications WHERE user_id=:uid ORDER BY id DESC LIMIT 200`,{uid:req.user.id});
  const legacy=await qa(`SELECT id,user_id,role,title,message,type,is_read,created_at FROM notifications WHERE user_id=:uid ORDER BY id DESC LIMIT 200`,{uid:req.user.id});
  const seen=new Set();const rows=[...business,...legacy].filter(x=>{const k=`${x.title}|${x.message}|${x.created_at}`;if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  ok(res,{items:rows,notifications:rows,total:rows.length},'Notifications loaded');
}));
router.patch('/notifications/:id/read',requireAuth,ah(async(req,res)=>{await ex('UPDATE business_notifications SET is_read=1 WHERE id=:id AND user_id=:uid',{id:req.params.id,uid:req.user.id});await ex('UPDATE notifications SET is_read=1 WHERE id=:id AND user_id=:uid',{id:req.params.id,uid:req.user.id});ok(res,{id:req.params.id},'Notification read');}));
router.patch('/notifications/read-all',requireAuth,ah(async(req,res)=>{await ex('UPDATE business_notifications SET is_read=1 WHERE user_id=:uid',{uid:req.user.id});await ex('UPDATE notifications SET is_read=1 WHERE user_id=:uid',{uid:req.user.id});ok(res,{updated:true},'All notifications read');}));

router.use(require('./singleBrandEnterpriseV61'));
module.exports = router;
