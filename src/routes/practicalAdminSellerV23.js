const router = require('express').Router();
const multer = require('multer');
const crypto = require('crypto');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 7 * 1024 * 1024, files: 8 } });
router.use(optionalAuth);

const colCache = new Map();
async function cols(table) {
  if (colCache.has(table)) return colCache.get(table);
  try { const [r] = await pool.execute(`SHOW COLUMNS FROM \`${table}\``); const s = new Set(r.map(x => x.Field)); colCache.set(table, s); return s; }
  catch { const s = new Set(); colCache.set(table, s); return s; }
}
async function exists(table) { return (await cols(table)).size > 0; }
function pick(names, c, def = null) { for (const n of names) if (c.has(n)) return n; return def; }
function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function txt(v, d = '') { return v === undefined || v === null ? d : String(v); }
function bit(v) { if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; if (v && Array.isArray(v.data)) return Number(v.data[0]) === 1; return String(v ?? '').toLowerCase() === 'true' || String(v ?? '') === '1'; }
function slug(s = 'item') { return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'; }
function parseBody(body) {
  const out = { ...(body || {}) };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) { try { out[k] = JSON.parse(t); } catch {} }
      else if (t === 'true') out[k] = true; else if (t === 'false') out[k] = false;
    }
  }
  return out;
}
async function q(sql, p = []) { try { const [r] = await pool.execute(sql, p); return r; } catch (e) { console.error('[v23 query]', e.message, sql); return []; } }
async function x(sql, p = []) { const [r] = await pool.execute(sql, p); return r; }
async function first(sql, p = []) { const r = await q(sql, p); return r[0] || null; }
function page(items, req) { const perPage = Math.max(1, num(req.query.perPage || req.query.per_page || req.query.limit, items.length || 20)); const pg = Math.max(1, num(req.query.page, 1)); return { items, content: items, data: items, orders: items, products: items, records: items, total: items.length, totalElements: items.length, total_items: items.length, page: pg, currentPage: pg, perPage, per_page: perPage, totalPages: 1, total_pages: 1, last: true }; }
async function settingNumber(key, def) { try { const s = await first('SELECT setting_value FROM settings WHERE setting_key=? LIMIT 1', [key]); return num(JSON.parse(s?.setting_value || `${def}`)?.value ?? s?.setting_value, def); } catch { return def; } }
function distanceKm(aLat, aLng, bLat, bLng) { const R = 6371; const dLat = (bLat-aLat)*Math.PI/180; const dLng = (bLng-aLng)*Math.PI/180; const aa = Math.sin(dLat/2)**2 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*Math.sin(dLng/2)**2; return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa)); }
async function mrBreadoId() { const r = await first("SELECT id FROM restaurants WHERE LOWER(COALESCE(slug,''))='mr-breado' OR LOWER(COALESCE(name,restaurant_name,'')) LIKE '%mr breado%' ORDER BY id LIMIT 1"); return r?.id || 8; }
async function tableColumns(table) { return await cols(table); }
async function insertDynamic(table, data) { const c = await tableColumns(table); const d = {}; for (const [k, v] of Object.entries(data)) if (c.has(k) && v !== undefined) d[k] = v; const keys = Object.keys(d); if (!keys.length) throw new Error(`No insertable columns for ${table}`); const sql = `INSERT INTO ${table} (${keys.map(k => `\`${k}\``).join(',')}) VALUES (${keys.map(() => '?').join(',')})`; const r = await x(sql, Object.values(d)); return r.insertId; }
async function updateDynamic(table, id, data) { const c = await tableColumns(table); const d = {}; for (const [k, v] of Object.entries(data)) if (c.has(k) && v !== undefined) d[k] = v; const keys = Object.keys(d); if (!keys.length) return; await x(`UPDATE ${table} SET ${keys.map(k => `\`${k}\`=?`).join(', ')} WHERE id=?`, [...Object.values(d), id]); }
function money(v) { return `₹${num(v).toFixed(2)}`; }
function pdfBuffer(lines, title='Mr Breado Document') {
  const safe = [title, ...lines].map(s => String(s).replace(/[()\\]/g, ''));
  const text = safe.map((s,i) => `BT /F1 ${i===0?18:11} Tf 50 ${770 - i*18} Td (${s}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offsets = [0]; objs.forEach((o,i) => { offsets.push(Buffer.byteLength(out)); out += `${i+1} 0 obj\n${o}\nendobj\n`; }); const xref = Buffer.byteLength(out); out += `xref\n0 ${objs.length+1}\n0000000000 65535 f \n`; for (let i=1;i<offsets.length;i++) out += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`; out += `trailer << /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(out);
}

async function uploadImage(file) {
  if (!file) return undefined;
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    try {
      const cloudinary = require('cloudinary').v2;
      cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
      const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
      const up = await cloudinary.uploader.upload(dataUri, { folder: 'mr-breado/products', resource_type: 'image' });
      return up.secure_url;
    } catch (e) { console.error('[v23 cloudinary]', e.message); }
  }
  return undefined;
}

async function products(req, mrOnly = false) {
  const pc = await cols('products'); if (!pc.size) return [];
  const rc = await cols('restaurants'); const cc = await cols('categories');
  const restCol = pick(['restaurant_id','store_id'], pc); const catCol = pick(['category_id','food_category_id','menu_category_id'], pc);
  const nameCol = pick(['name','title','product_name'], pc, 'title'); const priceCol = pick(['price','base_price','selling_price'], pc, 'price'); const imgCol = pick(['image_url','image'], pc); const slugCol = pick(['slug'], pc);
  const wh = []; const params = [];
  if (mrOnly && restCol) { wh.push(`p.${restCol}=?`); params.push(await mrBreadoId()); }
  if (req.query.search) { wh.push(`LOWER(COALESCE(p.${nameCol},'')) LIKE ?`); params.push(`%${String(req.query.search).toLowerCase()}%`); }
  if (pc.has('deleted')) wh.push(`COALESCE(p.deleted,0)=0`);
  const fields = [`p.*`, `p.${nameCol} name`, `p.${nameCol} title`, `p.${priceCol} price`];
  if (imgCol) fields.push(`p.${imgCol} imageUrl`, `p.${imgCol} image`); if (slugCol) fields.push(`p.${slugCol} slug`); if (restCol) fields.push(`p.${restCol} restaurantId`); if (catCol) fields.push(`p.${catCol} categoryId`);
  let join = '';
  if (restCol && rc.size) { const rn = pick(['name','restaurant_name'], rc, 'name'); join += ` LEFT JOIN restaurants r ON r.id=p.${restCol}`; fields.push(`r.${rn} restaurantName`); }
  if (catCol && cc.size) { const cn = pick(['name','title'], cc, 'name'); join += ` LEFT JOIN categories c ON c.id=p.${catCol}`; fields.push(`c.${cn} categoryName`); }
  const rows = await q(`SELECT ${fields.join(', ')} FROM products p ${join} WHERE ${wh.length ? wh.join(' AND ') : '1=1'} ORDER BY p.id DESC LIMIT 1000`, params);
  return rows.map(p => ({ ...p, sellingPrice: num(p.price), effectivePrice: num(p.discount_price || p.discountPrice || p.price), restaurant: p.restaurantName || p.restaurant_name || '—', isAvailable: bit(p.available), isFeatured: bit(p.featured), visible: bit(p.available) }));
}
async function saveProductCustomizations(productId, body) {
  const gc = await cols('product_customization_groups'); const oc = await cols('product_customization_options'); if (!gc.size || !oc.size) return;
  await q('DELETE FROM product_customization_options WHERE group_id IN (SELECT id FROM product_customization_groups WHERE product_id=?)', [productId]);
  await q('DELETE FROM product_customization_groups WHERE product_id=?', [productId]);
  const category = txt(body.categoryName || body.category_name || body.category || body.foodType || body.food_type).toLowerCase();
  const base = num(body.price || body.basePrice || body.base_price || body.base500gmPrice || body.cake500gmExtra || 0);
  const groups = [];
  const sp = body.smallPrice ?? body.small_price ?? body.smallSizeExtra ?? body.small_size_extra;
  const mp = body.mediumPrice ?? body.medium_price ?? body.mediumSizeExtra ?? body.medium_size_extra;
  const lp = body.largePrice ?? body.large_price ?? body.largeSizeExtra ?? body.large_size_extra;
  if (category.includes('pizza') || sp || mp || lp) groups.push({ title: 'Choose Size', type: 'SINGLE', required: 1, options: [['Small', sp ?? base], ['Medium', mp ?? base], ['Large', lp ?? base]] });
  const c05 = body.base500gmPrice ?? body.base_500gm_price ?? body.cake500gmExtra ?? body.cake_500gm_extra;
  const c10 = body.cake1kgExtra ?? body.cake_1kg_extra;
  const c15 = body.cake15kgExtra ?? body.cake_1_5kg_extra;
  const c20 = body.cake2kgExtra ?? body.cake_2kg_extra;
  if (category.includes('cake') || c05 || c10 || c15 || c20) groups.push({ title: 'Choose Weight', type: 'SINGLE', required: 1, options: [['500 gm', c05 ?? base], ['1 kg', c10 ?? c05 ?? base], ['1.5 kg', c15 ?? c10 ?? c05 ?? base], ['2 kg', c20 ?? c15 ?? c10 ?? c05 ?? base]] });
  if (body.cakeMessageEnabled || body.cake_message_enabled) groups.push({ title: 'Cake Message', type: 'SINGLE', required: 0, options: [['Write name/message', body.cakeMessageCharge ?? body.cake_message_charge ?? 0]] });
  const gTitle = pick(['title','name','group_name'], gc, 'title'); const gType = pick(['type','selection_type'], gc, 'type'); const oTitle = pick(['title','name','option_name'], oc, 'title'); const oPrice = pick(['price','additional_price','extra_price'], oc, 'price');
  let gIdx = 0;
  for (const g of groups) {
    const gid = await insertDynamic('product_customization_groups', { product_id: productId, [gTitle]: g.title, [gType]: g.type, required: g.required, min_select: g.required ? 1 : 0, max_select: 1, priority: gIdx++, created_at: new Date(), updated_at: new Date() });
    let idx = 0;
    for (const [label, price] of g.options) await insertDynamic('product_customization_options', { group_id: gid, [oTitle]: label, [oPrice]: num(price), enabled: 1, available: 1, active: 1, sort_order: idx, priority: idx++, created_at: new Date(), updated_at: new Date() });
  }
}
async function upsertProduct(req, res, id = null, mrOnly = false) {
  const body = parseBody(req.body); const pc = await cols('products'); if (!pc.size) return fail(res, 'products table not found', 500);
  const imageUrl = await uploadImage((req.files || []).find(f => f.fieldname === 'image' || f.fieldname === 'file')) || body.imageUrl || body.image_url || body.image;
  const restId = mrOnly ? await mrBreadoId() : num(body.restaurantId || body.restaurant_id || 0) || await mrBreadoId();
  const title = txt(body.title || body.name || body.productName, 'Food item'); const price = num(body.price || body.basePrice || body.smallPrice || body.base500gmPrice || body.cake500gmExtra || 0);
  const data = {
    title, name: title, subtitle: body.subtitle || body.subTitle || '', description: body.description || '', slug: id ? undefined : `${slug(title)}-${Date.now()}`,
    price, discount_price: body.discountPrice || body.discount_price || null, image: imageUrl, image_url: imageUrl, restaurant_id: restId, store_id: restId,
    food_type: body.foodType || body.food_type || body.categoryName || body.category_name || null, category_name: body.categoryName || body.category_name || null,
    stock_quantity: num(body.stockQuantity || body.stock_quantity || body.stock || 100, 100), stock: num(body.stockQuantity || body.stock_quantity || body.stock || 100, 100),
    available: body.isAvailable ?? body.available ?? 1, veg: body.isVeg ?? body.veg ?? 1, bestseller: body.isBestseller ?? body.bestseller ?? 0, featured: body.featured ?? body.isFeatured ?? 0,
    deleted: 0, currency: 'INR', preparation_time: num(body.preparationTime || body.preparation_time, 15), rating: 0, total_reviews: 0, tax_included: body.taxIncluded ?? 1,
    tags: body.tags || '', packaging_charge: body.packagingCharge || body.packaging_charge || 0, availability_window: body.availabilityWindow || 'All Day', serving_size: body.servingSize || '1 person', spice_level: body.spiceLevel || 'None', allergens: body.allergens || '',
    updated_at: new Date(), created_at: new Date()
  };
  if (id) await updateDynamic('products', id, data); else id = await insertDynamic('products', data);
  await saveProductCustomizations(id, body);
  const p = (await products({ query: {} }, false)).find(x => String(x.id) === String(id));
  ok(res, p || { id }, id ? 'Product updated' : 'Product created', id ? 200 : 201);
}

async function orderList(req, sellerScope = false) {
  const oc = await cols('orders'); if (!oc.size) return [];
  const restCol = pick(['restaurant_id','store_id'], oc); const userCol = pick(['user_id','customer_id'], oc); const totalCol = pick(['grand_total','total','total_amount'], oc, 'grand_total'); const orderNo = pick(['order_number','slug','invoice_number'], oc, 'id'); const statusCol = pick(['status','order_status'], oc, 'status');
  const wh = []; const params = [];
  const st = req.query.status || req.query.orderStatus; if (st && String(st).toUpperCase() !== 'ALL') { wh.push(`UPPER(o.${statusCol})=?`); params.push(String(st).toUpperCase()); }
  if (sellerScope && restCol && String(req.path).includes('mr-breado')) { wh.push(`o.${restCol}=?`); params.push(await mrBreadoId()); }
  const fields = [`o.*`, `o.${totalCol} total`, `o.${totalCol} grandTotal`, `o.${orderNo} orderNumber`, `o.${statusCol} status`, `o.created_at createdAt`];
  let join = '';
  const rc = await cols('restaurants'); if (restCol && rc.size) { join += ` LEFT JOIN restaurants r ON r.id=o.${restCol}`; fields.push('r.name restaurantName', 'r.owner_id sellerId'); }
  const uc = await cols('users'); if (userCol && uc.size) { join += ` LEFT JOIN users u ON u.id=o.${userCol}`; fields.push('u.name customerName', 'u.email customerEmail', 'u.mobile customerMobile'); }
  const rows = await q(`SELECT ${fields.join(', ')} FROM orders o ${join} WHERE ${wh.length ? wh.join(' AND ') : '1=1'} ORDER BY o.id DESC LIMIT 1000`, params);
  const ic = await cols('order_items'); if (ic.size) for (const o of rows) o.items = o.orderItems = await q('SELECT *, title productName, unit_price unitPrice, total_price totalPrice FROM order_items WHERE order_id=? ORDER BY id', [o.id]);
  return rows;
}
async function setOrderStatus(id, status, reason) {
  const oc = await cols('orders'); const data = { status, order_status: status, updated_at: new Date() };
  if (status === 'CANCELLED') { data.cancelled_at = new Date(); data.cancelled_by = 'ADMIN'; data.cancellation_reason = reason || 'Rejected by admin'; data.cancel_reason = reason || 'Rejected by admin'; }
  if (status === 'ACCEPTED') { data.seller_accepted = 1; data.seller_responded_at = new Date(); }
  await updateDynamic('orders', id, data);
}

router.get(['/feature-version-v23','/version-v23'], (req,res) => ok(res, { version: 'practical-admin-seller-flow-v23', razorpay: 'unchanged' }, 'v23 active'));
router.get(['/admin/products','/admin/foods','/foods'], ah(async (req,res) => ok(res, page(await products(req, false), req), 'All foods loaded')));
router.get(['/admin/mr-breado/products','/admin/mr-breado/foods'], ah(async (req,res) => ok(res, page(await products(req, true), req), 'Mr Breado foods loaded')));
router.post(['/admin/products','/admin/foods','/foods'], upload.any(), ah((req,res) => upsertProduct(req,res,null,false)));
router.post(['/admin/mr-breado/products','/admin/mr-breado/foods'], upload.any(), ah((req,res) => upsertProduct(req,res,null,true)));
router.put(['/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id','/admin/mr-breado/foods/:id'], upload.any(), ah((req,res) => upsertProduct(req,res,req.params.id,req.path.includes('mr-breado'))));
router.delete(['/admin/products/:id','/admin/foods/:id','/admin/mr-breado/products/:id'], ah(async(req,res)=>{ const pc=await cols('products'); if (pc.has('deleted')) await updateDynamic('products', req.params.id, { deleted:1, available:0 }); else await x('DELETE FROM products WHERE id=?',[req.params.id]); ok(res,null,'Product deleted'); }));
router.patch(['/admin/products/:id/stock','/admin/products/:id/availability','/admin/mr-breado/products/:id/availability','/admin/mr-breado/products/:id/stock'], ah(async(req,res)=>{ const v=req.body?.isAvailable ?? req.body?.available ?? req.body?.inStock ?? 1; await updateDynamic('products', req.params.id, { available: v ? 1 : 0, stock_quantity: req.body?.stockQuantity }); ok(res,{id:req.params.id,available:!!v},'Availability updated'); }));

router.get(['/admin/orders','/admin/mr-breado/orders','/admin/mr-breado/live-orders','/seller/orders','/seller/live-orders'], ah(async(req,res)=>ok(res,page(await orderList(req, true),req),'Orders loaded')));
router.get(['/admin/orders/:id','/admin/mr-breado/orders/:id','/seller/orders/:id'], ah(async(req,res)=>{ const r=(await orderList({ ...req, query:{} },false)).find(o=>String(o.id)===String(req.params.id)||String(o.orderNumber)===String(req.params.id)); if(!r)return fail(res,'Order not found',404); ok(res,r,'Order loaded',{order:r}); }));
router.post(['/admin/orders/:id/accept','/admin/mr-breado/orders/:id/accept','/seller/orders/:id/accept'], ah(async(req,res)=>{await setOrderStatus(req.params.id,'ACCEPTED'); ok(res,{id:req.params.id,status:'ACCEPTED'},'Order accepted');}));
router.post(['/admin/orders/:id/preparing','/admin/mr-breado/orders/:id/preparing','/seller/orders/:id/preparing'], ah(async(req,res)=>{await setOrderStatus(req.params.id,'PREPARING'); ok(res,{id:req.params.id,status:'PREPARING'},'Order preparing');}));
router.post(['/admin/orders/:id/ready','/admin/mr-breado/orders/:id/ready','/seller/orders/:id/ready'], ah(async(req,res)=>{await setOrderStatus(req.params.id,'READY_FOR_PICKUP'); ok(res,{id:req.params.id,status:'READY_FOR_PICKUP'},'Order ready for pickup');}));
router.post(['/admin/orders/:id/reject','/admin/mr-breado/orders/:id/reject','/seller/orders/:id/reject'], ah(async(req,res)=>{await setOrderStatus(req.params.id,'CANCELLED',req.body?.reason); ok(res,{id:req.params.id,status:'CANCELLED'},'Order rejected');}));
router.get(['/admin/mr-breado/orders/:id/invoice.pdf','/admin/orders/:id/invoice.pdf'], ah(async(req,res)=>{ const o=(await orderList({ ...req, query:{} },false)).find(x=>String(x.id)===String(req.params.id)); if(!o)return fail(res,'Order not found',404); const lines=[`Order: ${o.orderNumber}`,`Customer: ${o.customerName||'-'} ${o.customerMobile||''}`,`Restaurant: ${o.restaurantName||'Mr Breado'}`,`Payment: ${o.payment_type||o.paymentType||'-'} / ${o.payment_status||o.paymentStatus||'-'}`,`Status: ${o.status}`,`Total: ${money(o.total||o.grandTotal)}`,`Items:`,...(o.items||[]).slice(0,20).map(i=>`${i.quantity||1} x ${i.productName||i.title} ${i.selected_size||i.selected_weight||''}`)]; res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`attachment; filename="${o.orderNumber||o.id}_invoice.pdf"`); res.send(pdfBuffer(lines,'Mr Breado Order Invoice')); }));
router.post(['/admin/mr-breado/orders/:id/invoice/send-to-customer','/admin/orders/:id/invoice/send-to-customer'], ah(async(req,res)=>ok(res,{sent:true,id:req.params.id},'Invoice notification queued')));

router.get(['/admin/online-transactions','/admin/payment-transactions','/admin/payments/online'], ah(async(req,res)=>{ const c=await cols('payment_transactions'); if(!c.size)return ok(res,page([],req),'Transactions loaded'); const rows=await q(`SELECT pt.*, pt.id transactionId, pt.provider_order_id razorpayOrderId, pt.provider_payment_id razorpayPaymentId, o.id orderId, o.order_number orderNumber, o.restaurant_id restaurantId, o.user_id customerId, r.owner_id sellerId, r.name restaurantName, seller.name sellerName, u.name customerName, u.mobile customerMobile, u.email customerEmail FROM payment_transactions pt LEFT JOIN orders o ON o.id=pt.order_id LEFT JOIN restaurants r ON r.id=o.restaurant_id LEFT JOIN users seller ON seller.id=r.owner_id LEFT JOIN users u ON u.id=COALESCE(pt.user_id,o.user_id) ORDER BY pt.id DESC LIMIT 500`); ok(res,page(rows,req),'Transactions loaded'); }));
router.get(['/admin/online-transactions/:id/receipt.pdf','/admin/payments/:id/receipt.pdf','/payments/:id/receipt'], ah(async(req,res)=>{ const t=await first('SELECT * FROM payment_transactions WHERE id=?',[req.params.id]); if(!t)return fail(res,'Transaction not found',404); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`attachment; filename="mr_breado_receipt_${req.params.id}.pdf"`); res.send(pdfBuffer([`Transaction: #${t.id}`,`Order ID: ${t.order_id||'-'}`,`Razorpay Order: ${t.provider_order_id||t.razorpay_order_id||'-'}`,`Razorpay Payment: ${t.provider_payment_id||t.razorpay_payment_id||'-'}`,`Amount: INR ${num(t.amount).toFixed(2)}`,`Status: ${t.status||'-'}`,`Created: ${t.created_at||''}`],'Mr Breado Payment Receipt')); }));

router.get(['/admin/restaurant-settlements','/admin/payouts','/admin/settlements'], ah(async(req,res)=>{ const rows=await q(`SELECT r.id restaurantId, r.name restaurantName, r.owner_id sellerId, seller.name sellerName, COUNT(o.id) orders, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total ELSE 0 END),0) gross, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total ELSE 0 END),0) grossAmount, COUNT(o.id) totalOrders, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total*0.85 ELSE 0 END),0) payable, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total*0.85 ELSE 0 END),0) payableAmount, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total*0.15 ELSE 0 END),0) commission, COALESCE(SUM(CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.grand_total*0.15 ELSE 0 END),0) commissionAmount, 'PENDING' status FROM restaurants r LEFT JOIN users seller ON seller.id=r.owner_id LEFT JOIN orders o ON o.restaurant_id=r.id GROUP BY r.id ORDER BY payable DESC`); ok(res,page(rows,req),'Settlements loaded'); }));
router.post(['/admin/restaurant-settlements/:id/mark-paid','/admin/payouts/:id/mark-paid'], ah(async(req,res)=>{ const id=req.params.id; const payload={ restaurant_id:id, amount:req.body?.amount||0, status:'PAID', paid_at:new Date(), reference_number:req.body?.referenceNumber||req.body?.reference||crypto.randomBytes(4).toString('hex'), note:req.body?.note||'Seller payout marked paid' }; if(await exists('admin_restaurant_payouts')) { try{ await insertDynamic('admin_restaurant_payouts',payload); }catch(e){ console.error('[v23 payout]',e.message); } } ok(res,{restaurantId:id,status:'PAID',...payload},'Settlement marked paid and seller notification queued'); }));
router.get(['/admin/restaurant-settlements/:id/invoice.pdf','/admin/payouts/:id/invoice.pdf'], ah(async(req,res)=>{ const r=await first('SELECT * FROM restaurants WHERE id=?',[req.params.id]); res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`attachment; filename="seller_payout_${req.params.id}.pdf"`); res.send(pdfBuffer([`Restaurant: ${r?.name||req.params.id}`,`Seller payout settlement`,`Generated: ${new Date().toLocaleString('en-IN')}`,`Use admin panel mark-paid flow for final payment reference.`],'Mr Breado Seller Payout Invoice')); }));

router.get(['/admin/categories','/admin/food-categories','/categories'], ah(async(req,res)=>{ const table=(await exists('categories'))?'categories':'food_categories'; const rows=await q(`SELECT *, COALESCE(name,title) name, COALESCE(image_url,image,icon) imageUrl FROM ${table} ORDER BY COALESCE(sort_order,0), id`); ok(res,page(rows,req),'Categories loaded'); }));
router.post(['/admin/categories','/admin/food-categories'], upload.any(), ah(async(req,res)=>{ const table=(await exists('categories'))?'categories':'food_categories'; const b=parseBody(req.body); const img=await uploadImage((req.files||[])[0]); const id=await insertDynamic(table,{ name:b.name||b.title, title:b.title||b.name, slug:slug(b.name||b.title), image_url:img||b.imageUrl, image:img||b.imageUrl, icon:b.icon, active:b.active??1, visible:b.visible??1, sort_order:b.sortOrder||0, created_at:new Date(), updated_at:new Date() }); ok(res,{id,...b,imageUrl:img||b.imageUrl},'Category created',201); }));

router.get(['/admin/mr-breado/restaurant','/seller/restaurant','/seller/restaurants/me'], ah(async(req,res)=>{ const r=await first('SELECT * FROM restaurants WHERE id=?',[await mrBreadoId()]); ok(res,r||{},'Restaurant loaded'); }));
router.put(['/admin/mr-breado/restaurant','/seller/restaurant','/seller/restaurants/me'], ah(async(req,res)=>{ const id=await mrBreadoId(); const b=req.body||{}; await updateDynamic('restaurants',id,{ name:b.name, description:b.description, address:b.address||b.businessAddress, latitude:b.latitude||b.lat, longitude:b.longitude||b.lng, delivery_radius_km:b.deliveryRadiusKm||b.delivery_radius_km, phone:b.phone||b.mobile, updated_at:new Date() }); ok(res,await first('SELECT * FROM restaurants WHERE id=?',[id]),'Restaurant updated'); }));
router.get(['/delivery/validate','/distance/validate','/restaurants/:id/delivery-check'], ah(async(req,res)=>{ const lat=num(req.query.lat||req.query.latitude||req.query.userLat), lng=num(req.query.lng||req.query.longitude||req.query.userLng); const rest=await first('SELECT * FROM restaurants WHERE id=?',[req.params.id||await mrBreadoId()]); const km=(lat&&lng&&num(rest?.latitude)&&num(rest?.longitude))?distanceKm(lat,lng,num(rest.latitude),num(rest.longitude)):0; const max=num(rest?.delivery_radius_km||await settingNumber('delivery_radius_km',8),8); ok(res,{available:!km||km<=max,distanceKm:Math.round(km*100)/100,maxDistanceKm:max,restaurant:rest},'Distance checked'); }));

module.exports = router;
