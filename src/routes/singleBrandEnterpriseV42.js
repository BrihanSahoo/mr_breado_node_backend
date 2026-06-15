const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

router.use(optionalAuth);
async function x(sql, params = []) { const [r] = await pool.execute(sql, params); return r; }
async function q(sql, params = []) { try { const [r] = await pool.execute(sql, params); return r; } catch (e) { console.error('[singleBrandV42]', e.message, sql); return []; } }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
function n(v, d = 0) { const z = Number(v); return Number.isFinite(z) ? z : d; }
function bool(v, d = true) { if (v === undefined || v === null) return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; return ['1','true','yes','open','active','available'].includes(String(v).toLowerCase()); }
function today() { return new Date().toISOString().slice(0, 10); }
function rad(v) { return v * Math.PI / 180; }
function km(aLat, aLng, bLat, bLng) { const R = 6371; const dLat = rad(bLat - aLat); const dLng = rad(bLng - aLng); const A = Math.sin(dLat/2)**2 + Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return R * 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A)); }
function slug(v='') { return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'mr-breado-outlet'; }
function money(row) { return n(row?.grand_total ?? row?.total ?? row?.total_amount ?? row?.payable_amount ?? row?.amount ?? row?.final_amount, 0); }
async function hasTable(t) { return !!await one('SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]); }
async function cols(t) { const rows = await q('SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]); return new Set(rows.map(r => r.COLUMN_NAME)); }
function pickCol(set, names, fallback = 'NULL') { for (const name of names) if (set.has(name)) return name; return fallback; }
async function addCol(table, col, sql) { const c = await cols(table); if (!c.has(col)) { try { await x(`ALTER TABLE ${table} ADD COLUMN ${sql}`); } catch (e) { console.error('[singleBrandV42 addCol]', table, col, e.message); } } }

async function ensureSchema() {
  await x(`CREATE TABLE IF NOT EXISTS outlets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    legacy_restaurant_id BIGINT NULL,
    outlet_code VARCHAR(80) UNIQUE,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(700), city VARCHAR(120), state VARCHAR(120), pincode VARCHAR(20),
    latitude DECIMAL(12,8), longitude DECIMAL(12,8), service_radius_km DECIMAL(8,2) DEFAULT 5,
    contact_phone VARCHAR(40), contact_email VARCHAR(255), whatsapp_number VARCHAR(40), google_map_link VARCHAR(700),
    manager_user_id BIGINT NULL, manager_name VARCHAR(255), manager_phone VARCHAR(40), manager_email VARCHAR(255),
    opening_time VARCHAR(20), closing_time VARCHAR(20), seating_available BIT(1) NOT NULL DEFAULT b'0', booking_enabled BIT(1) NOT NULL DEFAULT b'1',
    is_open BIT(1) NOT NULL DEFAULT b'1', is_active BIT(1) NOT NULL DEFAULT b'1', takeaway_enabled BIT(1) NOT NULL DEFAULT b'1', delivery_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_outlets_geo_v42 (latitude, longitude), INDEX idx_outlets_city_v42 (city,pincode)
  )`);
  await addCol('outlets','legacy_restaurant_id','legacy_restaurant_id BIGINT NULL');
  await addCol('outlets','contact_phone','contact_phone VARCHAR(40) NULL');
  await addCol('outlets','contact_email','contact_email VARCHAR(255) NULL');
  await addCol('outlets','whatsapp_number','whatsapp_number VARCHAR(40) NULL');
  await addCol('outlets','google_map_link','google_map_link VARCHAR(700) NULL');
  await addCol('outlets','manager_name','manager_name VARCHAR(255) NULL');
  await addCol('outlets','manager_phone','manager_phone VARCHAR(40) NULL');
  await addCol('outlets','manager_email','manager_email VARCHAR(255) NULL');
  await addCol('outlets','opening_time','opening_time VARCHAR(20) NULL');
  await addCol('outlets','closing_time','closing_time VARCHAR(20) NULL');
  await addCol('outlets','booking_enabled',"booking_enabled BIT(1) NOT NULL DEFAULT b'1'");
  await addCol('outlets','seating_available',"seating_available BIT(1) NOT NULL DEFAULT b'0'");
  await addCol('outlets','takeaway_enabled',"takeaway_enabled BIT(1) NOT NULL DEFAULT b'1'");
  await addCol('outlets','delivery_enabled',"delivery_enabled BIT(1) NOT NULL DEFAULT b'1'");

  await x(`CREATE TABLE IF NOT EXISTS outlet_manager_accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL, phone VARCHAR(40), email VARCHAR(255), username VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, role VARCHAR(40) NOT NULL DEFAULT 'OUTLET_MANAGER',
    is_active BIT(1) NOT NULL DEFAULT b'1', last_login_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_oma_outlet_v42 (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
    opening_stock INT NOT NULL DEFAULT 0, stock_quantity INT NOT NULL DEFAULT 0, reserved_quantity INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 5, is_available BIT(1) NOT NULL DEFAULT b'1', preparation_minutes INT DEFAULT 15,
    unit_cost DECIMAL(12,2) DEFAULT 0, selling_price DECIMAL(12,2) DEFAULT 0,
    last_stock_audit_at DATETIME(6) NULL, last_stock_audit_by VARCHAR(120),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_product_stock_v42 (outlet_id, product_id), INDEX idx_ops_outlet_v42 (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_stock_movements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL, movement_type VARCHAR(40) NOT NULL,
    quantity INT NOT NULL DEFAULT 0, before_stock INT NOT NULL DEFAULT 0, after_stock INT NOT NULL DEFAULT 0,
    unit_cost DECIMAL(12,2) DEFAULT 0, total_cost DECIMAL(12,2) DEFAULT 0, note VARCHAR(700), created_by VARCHAR(120),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_osm_outlet_date_v42 (outlet_id, created_at)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_daily_closings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, closing_date DATE NOT NULL,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0, offline_sales DECIMAL(12,2) NOT NULL DEFAULT 0, cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_sales DECIMAL(12,2) NOT NULL DEFAULT 0, order_count INT NOT NULL DEFAULT 0, offline_order_count INT NOT NULL DEFAULT 0,
    cash_in_hand DECIMAL(12,2) NOT NULL DEFAULT 0, expenses DECIMAL(12,2) NOT NULL DEFAULT 0, net_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
    closing_note VARCHAR(1000), closed_by VARCHAR(120), submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_daily_v42 (outlet_id, closing_date), INDEX idx_odc_date_v42 (closing_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_bookings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, customer_id BIGINT NULL, customer_name VARCHAR(255), phone VARCHAR(40), email VARCHAR(255),
    booking_type VARCHAR(80) DEFAULT 'GENERAL', booking_date DATE NULL, booking_time VARCHAR(40), people_count INT DEFAULT 1, note VARCHAR(1000), status VARCHAR(40) DEFAULT 'PENDING',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_ob_outlet_v42 (outlet_id, created_at)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_delivery_boys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, user_id BIGINT NOT NULL, is_active BIT(1) NOT NULL DEFAULT b'1',
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE KEY uq_odb_user_v42 (user_id), INDEX idx_odb_outlet_v42 (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL, outlet_id BIGINT NOT NULL, assigned_by VARCHAR(120), created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_ooa_order_v42 (order_id), INDEX idx_ooa_outlet_v42 (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS accounting_export_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, export_type VARCHAR(80), date_from DATE, date_to DATE, outlet_id BIGINT NULL, generated_by VARCHAR(120), row_count INT DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
  await seedFromRestaurantsIfEmpty();
}

async function seedFromRestaurantsIfEmpty() {
  const existing = await one('SELECT COUNT(*) c FROM outlets');
  if (n(existing?.c) > 0) return;
  if (!await hasTable('restaurants')) return;
  const c = await cols('restaurants');
  const id = pickCol(c,['id']);
  const name = pickCol(c,['name','restaurant_name','title'], "'Mr Breado'");
  const address = pickCol(c,['address','street','location'], "''");
  const city = pickCol(c,['city'], "''");
  const state = pickCol(c,['state'], "''");
  const pincode = pickCol(c,['pincode','pin_code','zip'], "''");
  const lat = pickCol(c,['latitude','lat'], 'NULL');
  const lng = pickCol(c,['longitude','lng','lon'], 'NULL');
  const phone = pickCol(c,['phone','mobile','contact_phone','owner_phone'], "''");
  const email = pickCol(c,['email','contact_email'], "''");
  const open = pickCol(c,['is_open','open'], '1');
  const where = c.has('name') ? "WHERE LOWER(COALESCE(name,'')) LIKE '%mr breado%' OR LOWER(COALESCE(name,'')) LIKE '%mr. breado%'" : '';
  await q(`INSERT INTO outlets (legacy_restaurant_id,outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,contact_phone,contact_email,is_open,is_active)
           SELECT ${id}, CONCAT('OUT-',${id}), COALESCE(${name},'Mr Breado'), COALESCE(${address},''), COALESCE(${city},''), COALESCE(${state},''), COALESCE(${pincode},''), ${lat}, ${lng}, 5, COALESCE(${phone},''), COALESCE(${email},''), ${open}, 1 FROM restaurants ${where} LIMIT 200`);
}

function mapOutlet(o) {
  return {
    ...o,
    id: n(o.id), outletId: n(o.id), legacyRestaurantId: o.legacy_restaurant_id,
    outletCode: o.outlet_code || `OUT-${o.id}`,
    name: o.name || 'Mr Breado Outlet', outletName: o.name || 'Mr Breado Outlet',
    address: o.address || '', city: o.city || '', state: o.state || '', pincode: o.pincode || '',
    latitude: o.latitude == null ? null : n(o.latitude), longitude: o.longitude == null ? null : n(o.longitude),
    serviceRadiusKm: n(o.service_radius_km, 5),
    contactPhone: o.contact_phone || '', contactEmail: o.contact_email || '', whatsappNumber: o.whatsapp_number || '', googleMapLink: o.google_map_link || '',
    managerName: o.manager_name || '', managerPhone: o.manager_phone || '', managerEmail: o.manager_email || '',
    openingTime: o.opening_time || '', closingTime: o.closing_time || '',
    isOpen: bool(o.is_open), isActive: bool(o.is_active), takeawayEnabled: bool(o.takeaway_enabled), deliveryEnabled: bool(o.delivery_enabled), bookingEnabled: bool(o.booking_enabled), seatingAvailable: bool(o.seating_available, false),
  };
}
async function outletsList(){ await ensureSchema(); return (await q('SELECT * FROM outlets WHERE is_active=1 ORDER BY id DESC')).map(mapOutlet); }
async function outletById(id){ return (await outletsList()).find(o => String(o.id) === String(id) || String(o.outletCode) === String(id)) || null; }
async function nearestOutlet(lat,lng){ const list = await outletsList(); const hasPoint = Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)); let best = null; for (const o of list) { let dist = null; if (hasPoint && o.latitude != null && o.longitude != null) dist = km(n(lat), n(lng), n(o.latitude), n(o.longitude)); const cur = {...o, distanceKm: dist == null ? null : Number(dist.toFixed(2)), isServiceable: dist == null ? o.isOpen : (dist <= n(o.serviceRadiusKm,5) && o.isOpen)}; if (!best || (cur.distanceKm != null && (best.distanceKm == null || cur.distanceKm < best.distanceKm))) best = cur; } return best || null; }
async function ordersForOutlet(outletId, from='1970-01-01', to='2999-12-31') { if (!await hasTable('orders')) return []; const c = await cols('orders'); const date = pickCol(c,['created_at','createdAt','order_date'],'NOW()'); const outletExpr = c.has('outlet_id') ? 'o.outlet_id' : (c.has('restaurant_id') ? 'o.restaurant_id' : '0'); return q(`SELECT o.* FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE COALESCE(ooa.outlet_id,${outletExpr},0)=? AND DATE(COALESCE(${date},NOW())) BETWEEN ? AND ? ORDER BY ${date} DESC LIMIT 5000`,[outletId,from,to]); }
async function itemsForOutlet(outletId, from='1970-01-01', to='2999-12-31') { if (!await hasTable('order_items') || !await hasTable('orders')) return []; return q(`SELECT oi.product_id productId, COALESCE(p.name,p.title,p.product_name,CONCAT('Food #',oi.product_id)) productName, SUM(COALESCE(oi.quantity,1)) soldQuantity, SUM(COALESCE(oi.total_price,oi.price*oi.quantity,oi.price,0)) grossSales, MAX(o.created_at) lastSoldAt FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id WHERE COALESCE(ooa.outlet_id,o.outlet_id,o.restaurant_id,0)=? AND DATE(COALESCE(o.created_at,NOW())) BETWEEN ? AND ? GROUP BY oi.product_id, productName ORDER BY soldQuantity DESC`,[outletId,from,to]); }
async function stockForOutlet(outletId) { await ensureSchema(); let rows = await q(`SELECT ops.*, p.id productId, COALESCE(p.name,p.title,p.product_name,CONCAT('Food #',p.id)) productName, COALESCE(p.price,p.base_price,p.discounted_price,0) price, COALESCE(p.image_url,p.image,p.thumbnail_url) imageUrl FROM outlet_product_stock ops LEFT JOIN products p ON p.id=ops.product_id WHERE ops.outlet_id=? ORDER BY ops.stock_quantity ASC, productName ASC`,[outletId]); if (rows.length) return rows.map(r => ({...r, productId:n(r.productId||r.product_id), stockQuantity:n(r.stock_quantity), lowStockAlert:n(r.low_stock_alert,5), isAvailable:bool(r.is_available), price:n(r.selling_price||r.price)})); if (!await hasTable('products')) return []; rows = await q(`SELECT id productId, COALESCE(name,title,product_name,CONCAT('Food #',id)) productName, COALESCE(price,base_price,discounted_price,0) price, COALESCE(image_url,image,thumbnail_url) imageUrl, 999 stock_quantity, 5 low_stock_alert, 1 is_available FROM products ORDER BY id DESC LIMIT 500`); return rows.map(r => ({...r, stockQuantity:n(r.stock_quantity,999), lowStockAlert:5, isAvailable:true, price:n(r.price)})); }
async function menuForOutlet(outletId) { const rows = await stockForOutlet(outletId); return rows.filter(r => bool(r.isAvailable,true) && n(r.stockQuantity,999) > 0).map(r => ({ id:n(r.productId||r.product_id), productId:n(r.productId||r.product_id), outletId:n(outletId), title:r.productName, name:r.productName, productName:r.productName, price:n(r.price), image:r.imageUrl||r.image_url||'', imageUrl:r.imageUrl||r.image_url||'', stockQuantity:n(r.stockQuantity), preparationMinutes:n(r.preparation_minutes,15), isAvailable:true })); }
async function outletDashboard(id, from='1970-01-01', to='2999-12-31') { const outlet = await outletById(id); if (!outlet) return null; const orders = await ordersForOutlet(outlet.id, from, to); const closingRows = await q('SELECT * FROM outlet_daily_closings WHERE outlet_id=? AND closing_date BETWEEN ? AND ? ORDER BY closing_date DESC',[outlet.id,from,to]); const productStats = await itemsForOutlet(outlet.id, from, to); const stock = await stockForOutlet(outlet.id); const movements = await q('SELECT osm.*, COALESCE(p.name,p.title,p.product_name,CONCAT("Food #",osm.product_id)) productName FROM outlet_stock_movements osm LEFT JOIN products p ON p.id=osm.product_id WHERE outlet_id=? ORDER BY osm.created_at DESC LIMIT 500',[outlet.id]); const bookings = await q('SELECT * FROM outlet_bookings WHERE outlet_id=? ORDER BY created_at DESC LIMIT 100',[outlet.id]); const onlineSales = orders.filter(r => String(r.payment_type||r.payment_method||'').toUpperCase().includes('ONLINE') || String(r.payment_status||'').toUpperCase().includes('PAID')).reduce((a,r)=>a+money(r),0); const codSales = orders.filter(r => String(r.payment_type||r.payment_method||'').toUpperCase().includes('COD')).reduce((a,r)=>a+money(r),0); const offlineSales = closingRows.reduce((a,r)=>a+n(r.offline_sales),0); const totalSales = orders.reduce((a,r)=>a+money(r),0) + offlineSales; const lowStock = stock.filter(s => n(s.stockQuantity)<=n(s.lowStockAlert,5)); return { outlet, outletId:outlet.id, from, to, summary:{ totalSales, onlineSales, codSales, offlineSales, orders:orders.length, bookings:bookings.length, stockItems:stock.length, lowStock:lowStock.length, averageOrderValue:orders.length?Number((orders.reduce((a,r)=>a+money(r),0)/orders.length).toFixed(2)):0 }, orders:orders.slice(0,100), stock, lowStock, bestFoods:productStats.slice(0,10), slowFoods:productStats.slice().reverse().slice(0,10), closingCalendar:closingRows, stockMovements:movements, bookings } }

router.get('/single-brand/v42/version', (req,res)=>ok(res,{version:'single-brand-enterprise-v42', fixes:['admin added outlets now persist and show','user app outlet discovery endpoints','review auto popup should be disabled in app package','robust outlet seed from old restaurants'], razorpay:'v22/v26 create-order unchanged'},'v42 active'));
router.post(['/admin/outlets/ensure-enterprise-v42-schema','/admin/outlets/ensure-enterprise-v41-schema','/admin/outlets/ensure-enterprise-schema','/admin/outlets/ensure-schema'], ah(async(req,res)=>{ await ensureSchema(); ok(res,{schema:'v42',outlets:(await outletsList()).length},'Enterprise outlet schema ready'); }));
router.get(['/admin/business/dashboard','/admin/outlet-dashboard'], ah(async(req,res)=>{ const from=req.query.from||today(), to=req.query.to||today(); const outs=await outletsList(); const enriched=[]; for (const o of outs) { const d=await outletDashboard(o.id,from,to); enriched.push({...o,totalSales:n(d?.summary?.totalSales),onlineSales:n(d?.summary?.onlineSales),codSales:n(d?.summary?.codSales),offlineSales:n(d?.summary?.offlineSales),orderCount:n(d?.summary?.orders),lowStockCount:n(d?.summary?.lowStock),productCount:n(d?.summary?.stockItems),topFoods:d?.bestFoods||[],slowFoods:d?.slowFoods||[]}); } ok(res,{from,to,totalOutlets:outs.length,totalSales:enriched.reduce((a,o)=>a+n(o.totalSales),0),onlineSales:enriched.reduce((a,o)=>a+n(o.onlineSales),0),codSales:enriched.reduce((a,o)=>a+n(o.codSales),0),offlineSales:enriched.reduce((a,o)=>a+n(o.offlineSales),0),totalOrders:enriched.reduce((a,o)=>a+n(o.orderCount),0),lowStockOutlets:enriched.filter(o=>n(o.lowStockCount)>0).length,outlets:enriched,topOutlet:[...enriched].sort((a,b)=>n(b.totalSales)-n(a.totalSales))[0]||null},'Head office business dashboard loaded'); }));
router.get(['/admin/outlets','/outlets','/user/outlets'], ah(async(req,res)=>ok(res,await outletsList(),'Outlets loaded')));
router.post('/admin/outlets', ah(async(req,res)=>{ await ensureSchema(); const body=req.body||{}; const name=body.name||body.outletName||'Mr Breado Outlet'; const code=body.outletCode||body.outlet_code||`${slug(name)}-${Date.now().toString().slice(-5)}`; await x(`INSERT INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,contact_phone,contact_email,whatsapp_number,google_map_link,manager_name,manager_phone,manager_email,opening_time,closing_time,is_open,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,[code,name,body.address||'',body.city||'',body.state||'',body.pincode||'',body.latitude||null,body.longitude||null,n(body.serviceRadiusKm||body.service_radius_km,5),body.contactPhone||body.phone||'',body.contactEmail||body.email||'',body.whatsappNumber||'',body.googleMapLink||'',body.managerName||'',body.managerPhone||'',body.managerEmail||'',body.openingTime||'',body.closingTime||'',body.isOpen===false?0:1]); const row=await one('SELECT * FROM outlets WHERE outlet_code=?',[code]); ok(res,mapOutlet(row),'Outlet created',201); }));
router.put('/admin/outlets/:id', ah(async(req,res)=>{ await ensureSchema(); const b=req.body||{}; await x(`UPDATE outlets SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), pincode=COALESCE(?,pincode), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude), service_radius_km=COALESCE(?,service_radius_km), contact_phone=COALESCE(?,contact_phone), contact_email=COALESCE(?,contact_email), whatsapp_number=COALESCE(?,whatsapp_number), google_map_link=COALESCE(?,google_map_link), manager_name=COALESCE(?,manager_name), manager_phone=COALESCE(?,manager_phone), manager_email=COALESCE(?,manager_email), opening_time=COALESCE(?,opening_time), closing_time=COALESCE(?,closing_time), is_open=COALESCE(?,is_open) WHERE id=?`,[b.name||b.outletName||null,b.address||null,b.city||null,b.state||null,b.pincode||null,b.latitude??null,b.longitude??null,b.serviceRadiusKm??b.service_radius_km??null,b.contactPhone||b.phone||null,b.contactEmail||b.email||null,b.whatsappNumber||null,b.googleMapLink||null,b.managerName||null,b.managerPhone||null,b.managerEmail||null,b.openingTime||null,b.closingTime||null,b.isOpen===undefined?null:(b.isOpen?1:0),req.params.id]); ok(res,await outletById(req.params.id),'Outlet updated'); }));
router.post(['/admin/outlets/:id/location','/admin/outlets/:id/set-location'], ah(async(req,res)=>{ const body=req.body||{}; if (body.latitude == null || body.longitude == null) return fail(res,'latitude and longitude required',400); await ensureSchema(); await x('UPDATE outlets SET latitude=?, longitude=?, service_radius_km=COALESCE(?,service_radius_km), address=COALESCE(?,address), google_map_link=COALESCE(?,google_map_link) WHERE id=?',[body.latitude,body.longitude,body.serviceRadiusKm??body.service_radius_km??null,body.address||null,body.googleMapLink||null,req.params.id]); ok(res,await outletById(req.params.id),'Outlet location updated'); }));
router.get(['/admin/outlets/:id/full-dashboard','/admin/outlets/:id/business-dashboard','/admin/outlets/:id/performance'], ah(async(req,res)=>{ const data=await outletDashboard(req.params.id,req.query.from||'1970-01-01',req.query.to||'2999-12-31'); if(!data) return fail(res,'Outlet not found',404); ok(res,data,'Outlet full business dashboard loaded'); }));
router.get('/admin/outlets/:id/stock-ledger', ah(async(req,res)=>ok(res,{outletId:req.params.id,stock:await stockForOutlet(req.params.id),movements:await q('SELECT * FROM outlet_stock_movements WHERE outlet_id=? ORDER BY created_at DESC LIMIT 500',[req.params.id])},'Outlet stock ledger loaded')));
router.post(['/admin/outlets/:id/stock','/outlet-manager/stock'], ah(async(req,res)=>{ await ensureSchema(); const outletId=n(req.params.id||req.body?.outletId||req.user?.outletId); const items=Array.isArray(req.body?.items)?req.body.items:[req.body]; const out=[]; for(const item of items){ const productId=n(item.productId||item.product_id); if(!productId) continue; const existing=await one('SELECT * FROM outlet_product_stock WHERE outlet_id=? AND product_id=?',[outletId,productId]); const before=n(existing?.stock_quantity); const stock=n(item.stockQuantity ?? item.stock_quantity ?? (before+n(item.quantity,0))); const unitCost=n(item.unitCost||item.unit_cost); await x(`INSERT INTO outlet_product_stock (outlet_id,product_id,opening_stock,stock_quantity,low_stock_alert,is_available,preparation_minutes,unit_cost,selling_price,last_stock_audit_at,last_stock_audit_by) VALUES (?,?,?,?,?,?,?,?,?,NOW(6),?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity),low_stock_alert=VALUES(low_stock_alert),is_available=VALUES(is_available),preparation_minutes=VALUES(preparation_minutes),unit_cost=VALUES(unit_cost),selling_price=VALUES(selling_price),last_stock_audit_at=NOW(6),last_stock_audit_by=VALUES(last_stock_audit_by)`,[outletId,productId,before,stock,n(item.lowStockAlert||item.low_stock_alert,5),item.isAvailable===false?0:1,n(item.preparationMinutes||item.preparation_minutes,15),unitCost,n(item.sellingPrice||item.selling_price),req.user?.username||req.body?.updatedBy||'admin']); await x('INSERT INTO outlet_stock_movements (outlet_id,product_id,movement_type,quantity,before_stock,after_stock,unit_cost,total_cost,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[outletId,productId,item.movementType||'MANUAL_UPDATE',stock-before,before,stock,unitCost,unitCost*(stock-before),item.note||'',req.user?.username||'admin']); out.push({productId,beforeStock:before,afterStock:stock}); } ok(res,{outletId,updated:out},'Outlet stock updated'); }));
router.get(['/outlets/nearest','/user/outlets/nearest'], ah(async(req,res)=>{ const o=await nearestOutlet(req.query.lat??req.query.latitude, req.query.lng??req.query.longitude); if(!o) return fail(res,'No Mr Breado outlet found',404); ok(res,o,o.isServiceable?'Nearest outlet found':'Nearest outlet found but not serviceable'); }));
router.get(['/menu/nearest','/user/menu/nearest'], ah(async(req,res)=>{ const o=await nearestOutlet(req.query.lat??req.query.latitude, req.query.lng??req.query.longitude); if(!o) return fail(res,'No Mr Breado outlet found',404); ok(res,{outlet:o,menu:await menuForOutlet(o.id),foods:await menuForOutlet(o.id),products:await menuForOutlet(o.id)},'Nearest outlet menu loaded'); }));
router.get(['/outlets/:id/menu','/user/outlets/:id/menu'], ah(async(req,res)=>{ const outlet=await outletById(req.params.id); if(!outlet) return fail(res,'Outlet not found',404); const menu=await menuForOutlet(outlet.id); ok(res,{outlet,menu,foods:menu,products:menu},'Outlet menu loaded'); }));
router.get(['/outlets/:id/contact','/user/outlets/:id/contact'], ah(async(req,res)=>{ const outlet=await outletById(req.params.id); if(!outlet) return fail(res,'Outlet not found',404); ok(res,{outletId:outlet.id,name:outlet.name,address:outlet.address,phone:outlet.contactPhone||outlet.managerPhone,email:outlet.contactEmail||outlet.managerEmail,whatsapp:outlet.whatsappNumber,googleMapLink:outlet.googleMapLink,openingTime:outlet.openingTime,closingTime:outlet.closingTime,bookingEnabled:outlet.bookingEnabled},'Outlet contact loaded'); }));
router.post(['/outlets/:id/bookings','/user/outlets/:id/bookings'], ah(async(req,res)=>{ await ensureSchema(); const body=req.body||{}; await x('INSERT INTO outlet_bookings (outlet_id,customer_id,customer_name,phone,email,booking_type,booking_date,booking_time,people_count,note,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[req.params.id,req.user?.id||body.customerId||null,body.customerName||body.name||'',body.phone||'',body.email||'',body.bookingType||'GENERAL',body.bookingDate||body.date||today(),body.bookingTime||body.time||'',n(body.peopleCount||body.people_count,1),body.note||body.message||'','PENDING']); ok(res,{outletId:req.params.id},'Booking request submitted',201); }));
router.get('/admin/reports/outlet-accounting.csv', ah(async(req,res)=>{ await ensureSchema(); const from=req.query.from||'1970-01-01', to=req.query.to||'2999-12-31', outletId=req.query.outletId||null; const params=outletId?[outletId,from,to]:[from,to]; const where=outletId?'WHERE odc.outlet_id=? AND closing_date BETWEEN ? AND ?':'WHERE closing_date BETWEEN ? AND ?'; const rows=await q(`SELECT o.name outletName, odc.* FROM outlet_daily_closings odc JOIN outlets o ON o.id=odc.outlet_id ${where} ORDER BY closing_date DESC`,params); const csv=['Outlet,Date,Online Sales,COD Sales,Offline Sales,Total Sales,Orders,Offline Orders,Cash In Hand,Expenses,Net Cash,Note',...rows.map(r=>`"${String(r.outletName||'').replace(/"/g,'""')}",${String(r.closing_date).slice(0,10)},${r.online_sales},${r.cod_sales},${r.offline_sales},${r.total_sales},${r.order_count},${r.offline_order_count},${r.cash_in_hand},${r.expenses},${r.net_cash},"${String(r.closing_note||'').replace(/"/g,'""')}"`)].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="mr_breado_outlet_accounting_v42.csv"'); res.send(csv); }));

module.exports = router;
