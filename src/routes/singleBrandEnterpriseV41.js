const router = require('express').Router();
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

router.use(optionalAuth);
async function x(sql, params = []) { const [r] = await pool.execute(sql, params); return r; }
async function q(sql, params = []) { try { const [r] = await pool.execute(sql, params); return r; } catch (e) { console.error('[singleBrandV41]', e.message); return []; } }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
function n(v, d = 0) { const z = Number(v); return Number.isFinite(z) ? z : d; }
function b(v, d = true) { if (v === undefined || v === null) return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; return ['1','true','yes','open','active','available'].includes(String(v).toLowerCase()); }
function today() { return new Date().toISOString().slice(0,10); }
function ym() { return new Date().toISOString().slice(0,7); }
function km(aLat,aLng,bLat,bLng){ const R=6371, rad=(v)=>v*Math.PI/180; const dLat=rad(bLat-aLat), dLng=rad(bLng-aLng); const A=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A)); }
function slug(v='') { return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'mr-breado-outlet'; }
function rupees(row){ return n(row.grand_total ?? row.total ?? row.total_amount ?? row.payable_amount ?? row.amount,0); }
function pickName(row){ return row.name || row.title || row.product_name || row.food_name || `Food #${row.id || row.product_id || ''}`; }

async function ensureV41Schema(){
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
    is_open BIT(1) NOT NULL DEFAULT b'1', is_active BIT(1) NOT NULL DEFAULT b'1',
    takeaway_enabled BIT(1) NOT NULL DEFAULT b'1', delivery_enabled BIT(1) NOT NULL DEFAULT b'1',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_v41_outlet_geo (latitude, longitude), INDEX idx_v41_outlet_city (city,pincode)
  )`);
  const alters = [
    ['contact_phone','ALTER TABLE outlets ADD COLUMN contact_phone VARCHAR(40) NULL'],
    ['contact_email','ALTER TABLE outlets ADD COLUMN contact_email VARCHAR(255) NULL'],
    ['whatsapp_number','ALTER TABLE outlets ADD COLUMN whatsapp_number VARCHAR(40) NULL'],
    ['google_map_link','ALTER TABLE outlets ADD COLUMN google_map_link VARCHAR(700) NULL'],
    ['opening_time','ALTER TABLE outlets ADD COLUMN opening_time VARCHAR(20) NULL'],
    ['closing_time','ALTER TABLE outlets ADD COLUMN closing_time VARCHAR(20) NULL'],
    ['seating_available','ALTER TABLE outlets ADD COLUMN seating_available BIT(1) NOT NULL DEFAULT b\'0\''],
    ['booking_enabled','ALTER TABLE outlets ADD COLUMN booking_enabled BIT(1) NOT NULL DEFAULT b\'1\''],
  ];
  for (const [col, sql] of alters) { const exists = await one(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='outlets' AND COLUMN_NAME=?`,[col]); if(!exists) { try { await x(sql); } catch(e) { console.error('[singleBrandV41 alter outlets]', col, e.message); } } }
  await x(`CREATE TABLE IF NOT EXISTS outlet_manager_accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL, phone VARCHAR(40), email VARCHAR(255), username VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, role VARCHAR(40) NOT NULL DEFAULT 'OUTLET_MANAGER',
    is_active BIT(1) NOT NULL DEFAULT b'1', last_login_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_v41_oma_outlet (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
    opening_stock INT NOT NULL DEFAULT 0, stock_quantity INT NOT NULL DEFAULT 0, sold_quantity INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 5, is_available BIT(1) NOT NULL DEFAULT b'1', preparation_minutes INT DEFAULT 15,
    last_stock_audit_at DATETIME(6) NULL, last_stock_audit_by VARCHAR(120) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_v41_outlet_product_stock (outlet_id, product_id), INDEX idx_v41_ops_product (product_id), INDEX idx_v41_ops_stock (outlet_id, stock_quantity)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_stock_movements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
    movement_type VARCHAR(40) NOT NULL, quantity INT NOT NULL DEFAULT 0,
    before_stock INT NOT NULL DEFAULT 0, after_stock INT NOT NULL DEFAULT 0,
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0, total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    reference_type VARCHAR(60), reference_id BIGINT NULL, note VARCHAR(700), created_by VARCHAR(120),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_v41_osm_outlet_date (outlet_id, created_at), INDEX idx_v41_osm_product (product_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_daily_closings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, closing_date DATE NOT NULL,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0, offline_sales DECIMAL(12,2) NOT NULL DEFAULT 0, cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_sales DECIMAL(12,2) NOT NULL DEFAULT 0, order_count INT NOT NULL DEFAULT 0, offline_order_count INT NOT NULL DEFAULT 0,
    cash_in_hand DECIMAL(12,2) NOT NULL DEFAULT 0, expenses DECIMAL(12,2) NOT NULL DEFAULT 0, net_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
    closing_note VARCHAR(1000), closed_by VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'SUBMITTED',
    submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), approved_at DATETIME(6) NULL,
    UNIQUE KEY uq_v41_outlet_daily_closing (outlet_id, closing_date), INDEX idx_v41_odc_date (closing_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_daily_stats (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL, report_date DATE NOT NULL,
    sold_quantity INT NOT NULL DEFAULT 0, gross_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    cancelled_quantity INT NOT NULL DEFAULT 0, last_sold_at DATETIME(6) NULL,
    UNIQUE KEY uq_v41_opds (outlet_id, product_id, report_date), INDEX idx_v41_opds_outlet_date (outlet_id, report_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_business_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, event_date DATE NOT NULL,
    event_type VARCHAR(80) NOT NULL, title VARCHAR(255) NOT NULL, description VARCHAR(1200), amount DECIMAL(12,2) DEFAULT 0,
    created_by VARCHAR(120), created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_v41_obe_outlet_date (outlet_id,event_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_bookings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, customer_id BIGINT NULL,
    customer_name VARCHAR(255), phone VARCHAR(40), email VARCHAR(255), booking_type VARCHAR(80) DEFAULT 'GENERAL',
    booking_date DATE, booking_time VARCHAR(40), people_count INT DEFAULT 1, note VARCHAR(1200), status VARCHAR(40) DEFAULT 'PENDING',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_v41_booking_outlet_date (outlet_id, booking_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_delivery_boys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, outlet_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), is_active BIT(1) NOT NULL DEFAULT b'1',
    UNIQUE KEY uq_v41_outlet_delivery_boy (outlet_id, user_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL UNIQUE, outlet_id BIGINT NOT NULL,
    assigned_by VARCHAR(80) NOT NULL DEFAULT 'USER_SELECTED_OR_NEAREST', distance_km DECIMAL(8,2) DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_v41_ooa_outlet (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS accounting_export_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT, export_type VARCHAR(80) NOT NULL, date_from DATE NULL, date_to DATE NULL,
    outlet_id BIGINT NULL, generated_by VARCHAR(120), row_count INT DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
}

async function outletsList(){
  await ensureV41Schema();
  let rows = await q('SELECT * FROM outlets WHERE is_active=1 ORDER BY id DESC');
  if (!rows.length) {
    rows = await q(`SELECT id legacy_restaurant_id, CONCAT('OUT-',id) outlet_code, COALESCE(name,'Mr Breado') name, address, city, state, pincode, latitude, longitude, 5 service_radius_km, COALESCE(phone,mobile) contact_phone, email contact_email, COALESCE(open,is_open,1) is_open, 1 is_active, created_at, updated_at FROM restaurants WHERE LOWER(COALESCE(name,'')) LIKE '%mr breado%' ORDER BY id DESC LIMIT 50`);
  }
  return rows.map(o=>({
    ...o,id:n(o.id||o.legacy_restaurant_id),outletId:n(o.id||o.legacy_restaurant_id),legacyRestaurantId:o.legacy_restaurant_id,outletCode:o.outlet_code||`OUT-${o.id}`,
    name:o.name||o.outlet_name||'Mr Breado Outlet',outletName:o.name||o.outlet_name||'Mr Breado Outlet',
    serviceRadiusKm:n(o.service_radius_km,5),latitude:o.latitude==null?null:n(o.latitude),longitude:o.longitude==null?null:n(o.longitude),
    contactPhone:o.contact_phone||o.manager_phone||'',contactEmail:o.contact_email||o.manager_email||'',whatsappNumber:o.whatsapp_number||'',
    googleMapLink:o.google_map_link||'',openingTime:o.opening_time||'',closingTime:o.closing_time||'',
    isOpen:b(o.is_open),isActive:b(o.is_active),takeawayEnabled:b(o.takeaway_enabled),deliveryEnabled:b(o.delivery_enabled),bookingEnabled:b(o.booking_enabled),seatingAvailable:b(o.seating_available,false)
  }));
}
async function outletById(id){ return (await outletsList()).find(o=>String(o.id)===String(id)||String(o.outletId)===String(id)) || null; }
async function nearestOutlet(lat,lng){ const list=await outletsList(); let best=null; for(const o of list){ if(o.latitude==null||o.longitude==null) continue; const d=km(n(lat),n(lng),n(o.latitude),n(o.longitude)); const cur={...o,distanceKm:Number(d.toFixed(2)),isServiceable:d<=n(o.serviceRadiusKm,5)&&o.isOpen}; if(!best||cur.distanceKm<best.distanceKm) best=cur; } return best || list[0] || null; }
async function ordersForOutlet(outletId, from='1970-01-01', to='2999-12-31'){
  return q(`SELECT o.* FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE COALESCE(ooa.outlet_id,o.outlet_id,o.restaurant_id,0)=? AND DATE(COALESCE(o.created_at,NOW())) BETWEEN ? AND ? ORDER BY o.created_at DESC LIMIT 5000`,[outletId,from,to]);
}
async function itemsForOutlet(outletId, from='1970-01-01', to='2999-12-31'){
  return q(`SELECT oi.product_id productId, COALESCE(p.name,p.title,p.product_name,CONCAT('Food #',oi.product_id)) productName, SUM(COALESCE(oi.quantity,1)) soldQuantity, SUM(COALESCE(oi.total_price,oi.price*oi.quantity,oi.price,0)) grossSales, MAX(o.created_at) lastSoldAt FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id WHERE COALESCE(ooa.outlet_id,o.outlet_id,o.restaurant_id,0)=? AND DATE(COALESCE(o.created_at,NOW())) BETWEEN ? AND ? GROUP BY oi.product_id, productName ORDER BY soldQuantity DESC`,[outletId,from,to]);
}
async function stockForOutlet(outletId){
  const rows = await q(`SELECT ops.*, p.id productId, COALESCE(p.name,p.title,p.product_name,CONCAT('Food #',p.id)) productName, COALESCE(p.price,p.base_price,p.discounted_price,0) price, COALESCE(p.image_url,p.image,p.thumbnail_url) imageUrl FROM outlet_product_stock ops LEFT JOIN products p ON p.id=ops.product_id WHERE ops.outlet_id=? ORDER BY ops.stock_quantity ASC, productName ASC`,[outletId]);
  if(rows.length) return rows.map(r=>({...r,stockQuantity:n(r.stock_quantity),lowStockAlert:n(r.low_stock_alert,5),isAvailable:b(r.is_available),price:n(r.price)}));
  const products = await q(`SELECT id productId, COALESCE(name,title,product_name,CONCAT('Food #',id)) productName, COALESCE(price,base_price,discounted_price,0) price, COALESCE(image_url,image,thumbnail_url) imageUrl, 999 stock_quantity, 5 low_stock_alert, 1 is_available FROM products ORDER BY id DESC LIMIT 500`);
  return products.map(r=>({...r,stockQuantity:n(r.stock_quantity,999),lowStockAlert:5,isAvailable:true,price:n(r.price)}));
}
async function menuForOutlet(outletId){
  const rows = await stockForOutlet(outletId);
  return rows.filter(r=>b(r.is_available,true) && n(r.stockQuantity,999)>0).map(r=>({
    id:n(r.productId||r.product_id),productId:n(r.productId||r.product_id),name:r.productName||pickName(r),title:r.productName||pickName(r),price:n(r.price),imageUrl:r.imageUrl||r.image_url||r.image,
    stockQuantity:n(r.stockQuantity ?? r.stock_quantity,999),outletId:n(outletId),preparationMinutes:n(r.preparation_minutes,15),isAvailable:true
  }));
}
async function outletDashboard(id, from='1970-01-01', to='2999-12-31'){
  await ensureV41Schema();
  const outlet = await outletById(id); if(!outlet) return null;
  const orders = await ordersForOutlet(id,from,to);
  const closingRows = await q('SELECT * FROM outlet_daily_closings WHERE outlet_id=? AND closing_date BETWEEN ? AND ? ORDER BY closing_date DESC',[id,from,to]);
  const productStats = await itemsForOutlet(id,from,to);
  const stock = await stockForOutlet(id);
  const movements = await q('SELECT osm.*, COALESCE(p.name,p.title,p.product_name,CONCAT("Food #",osm.product_id)) productName FROM outlet_stock_movements osm LEFT JOIN products p ON p.id=osm.product_id WHERE outlet_id=? AND DATE(osm.created_at) BETWEEN ? AND ? ORDER BY osm.created_at DESC LIMIT 200',[id,from,to]);
  const bookings = await q('SELECT * FROM outlet_bookings WHERE outlet_id=? ORDER BY created_at DESC LIMIT 100',[id]);
  const events = await q('SELECT * FROM outlet_business_events WHERE outlet_id=? AND event_date BETWEEN ? AND ? ORDER BY event_date DESC, id DESC LIMIT 200',[id,from,to]);
  const onlineSales = orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('ONLINE') || String(r.payment_status||'').toUpperCase().includes('PAID')).reduce((a,r)=>a+rupees(r),0);
  const codSales = orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('COD')).reduce((a,r)=>a+rupees(r),0);
  const closingOffline = closingRows.reduce((a,r)=>a+n(r.offline_sales),0);
  const totalSales = orders.reduce((a,r)=>a+rupees(r),0) + closingOffline;
  const monthMap = {};
  for(const o of orders){ const key=String(o.created_at||'').slice(0,7)||ym(); monthMap[key]=(monthMap[key]||0)+rupees(o); }
  for(const c of closingRows){ const key=String(c.closing_date||'').slice(0,7)||ym(); monthMap[key]=(monthMap[key]||0)+n(c.offline_sales); }
  const lowStock = stock.filter(s=>n(s.stockQuantity ?? s.stock_quantity)<=n(s.lowStockAlert ?? s.low_stock_alert,5));
  return {outlet, outletId:n(id), from, to, summary:{totalSales,onlineSales,codSales,offlineSales:closingOffline,orders:orders.length,bookings:bookings.length,stockItems:stock.length,lowStock:lowStock.length,averageOrderValue:orders.length?Number((orders.reduce((a,r)=>a+rupees(r),0)/orders.length).toFixed(2)):0}, orders:orders.slice(0,100), stock, lowStock, bestFoods:productStats.slice(0,10), slowFoods:productStats.slice().reverse().slice(0,10), closingCalendar:closingRows, stockMovements:movements, bookings, events, monthlySales:Object.entries(monthMap).map(([month,total])=>({month,totalSales:total}))};
}

router.get('/single-brand/v41/version', (req,res)=>ok(res,{version:'single-brand-enterprise-v41',model:'Mr Breado single-brand outlet ERP',features:['outlet drilldown dashboard','location-managed outlet selection','stock ledger','day close sales','best/slow food analytics','customer booking/contact','rider outlet assignment'],razorpay:'v22/v26 create-order unchanged'},'Single-brand enterprise v41 active'));
router.post(['/admin/outlets/ensure-enterprise-v41-schema','/admin/outlets/ensure-enterprise-schema','/admin/outlets/ensure-schema'], ah(async(req,res)=>{ await ensureV41Schema(); ok(res,{schema:'v41',tables:['outlets','outlet_product_stock','outlet_stock_movements','outlet_daily_closings','outlet_product_daily_stats','outlet_business_events','outlet_bookings','outlet_delivery_boys','outlet_order_assignments']},'Enterprise outlet schema ready'); }));
router.get(['/admin/business/dashboard','/admin/outlet-dashboard'], ah(async(req,res)=>{ await ensureV41Schema(); const from=req.query.from||today(), to=req.query.to||today(); const outs=await outletsList(); const enriched=[]; for(const o of outs){ const d=await outletDashboard(o.outletId,from,to); enriched.push({...o,totalSales:n(d?.summary?.totalSales),onlineSales:n(d?.summary?.onlineSales),codSales:n(d?.summary?.codSales),offlineSales:n(d?.summary?.offlineSales),orderCount:n(d?.summary?.orders),lowStockCount:n(d?.summary?.lowStock),productCount:n(d?.summary?.stockItems),topFoods:d?.bestFoods||[],slowFoods:d?.slowFoods||[]}); } ok(res,{from,to,totalOutlets:outs.length,totalSales:enriched.reduce((a,o)=>a+n(o.totalSales),0),onlineSales:enriched.reduce((a,o)=>a+n(o.onlineSales),0),codSales:enriched.reduce((a,o)=>a+n(o.codSales),0),offlineSales:enriched.reduce((a,o)=>a+n(o.offlineSales),0),totalOrders:enriched.reduce((a,o)=>a+n(o.orderCount),0),lowStockOutlets:enriched.filter(o=>n(o.lowStockCount)>0).length,outlets:enriched,topOutlet:[...enriched].sort((a,b)=>n(b.totalSales)-n(a.totalSales))[0]||null},'Head office business dashboard loaded'); }));
router.get(['/admin/outlets','/outlets'], ah(async(req,res)=>ok(res,await outletsList(),'Outlets loaded')));
router.post('/admin/outlets', ah(async(req,res)=>{ await ensureV41Schema(); const body=req.body||{}; const name=body.name||body.outletName||'Mr Breado Outlet'; const code=body.outletCode||body.outlet_code||slug(name)+'-'+Date.now().toString().slice(-4); await x(`INSERT INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,contact_phone,contact_email,whatsapp_number,google_map_link,manager_name,manager_phone,manager_email,opening_time,closing_time,is_open,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,[code,name,body.address||'',body.city||'',body.state||'',body.pincode||'',body.latitude||null,body.longitude||null,n(body.serviceRadiusKm||body.service_radius_km,5),body.contactPhone||body.phone||'',body.contactEmail||body.email||'',body.whatsappNumber||'',body.googleMapLink||'',body.managerName||'',body.managerPhone||'',body.managerEmail||'',body.openingTime||'',body.closingTime||'',body.isOpen===false?0:1]); const id=(await one('SELECT LAST_INSERT_ID() id')).id; ok(res,await outletById(id),'Outlet created',201); }));
router.put('/admin/outlets/:id', ah(async(req,res)=>{ await ensureV41Schema(); const bdy=req.body||{}; await x(`UPDATE outlets SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), pincode=COALESCE(?,pincode), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude), service_radius_km=COALESCE(?,service_radius_km), contact_phone=COALESCE(?,contact_phone), contact_email=COALESCE(?,contact_email), whatsapp_number=COALESCE(?,whatsapp_number), google_map_link=COALESCE(?,google_map_link), manager_name=COALESCE(?,manager_name), manager_phone=COALESCE(?,manager_phone), manager_email=COALESCE(?,manager_email), opening_time=COALESCE(?,opening_time), closing_time=COALESCE(?,closing_time), is_open=COALESCE(?,is_open) WHERE id=?`,[bdy.name||bdy.outletName||null,bdy.address||null,bdy.city||null,bdy.state||null,bdy.pincode||null,bdy.latitude??null,bdy.longitude??null,bdy.serviceRadiusKm??bdy.service_radius_km??null,bdy.contactPhone||bdy.phone||null,bdy.contactEmail||bdy.email||null,bdy.whatsappNumber||null,bdy.googleMapLink||null,bdy.managerName||null,bdy.managerPhone||null,bdy.managerEmail||null,bdy.openingTime||null,bdy.closingTime||null,bdy.isOpen===undefined?null:(bdy.isOpen?1:0),req.params.id]); ok(res,await outletById(req.params.id),'Outlet updated'); }));
router.post(['/admin/outlets/:id/location','/admin/outlets/:id/set-location'], ah(async(req,res)=>{ const body=req.body||{}; if(body.latitude==null||body.longitude==null) return fail(res,'latitude and longitude required',400); await ensureV41Schema(); await x('UPDATE outlets SET latitude=?, longitude=?, service_radius_km=COALESCE(?, service_radius_km), address=COALESCE(?, address), google_map_link=COALESCE(?, google_map_link) WHERE id=?',[body.latitude,body.longitude,body.serviceRadiusKm??body.service_radius_km??null,body.address||null,body.googleMapLink||null,req.params.id]); ok(res,await outletById(req.params.id),'Outlet location updated'); }));
router.get(['/admin/outlets/:id/full-dashboard','/admin/outlets/:id/business-dashboard','/admin/outlets/:id/performance'], ah(async(req,res)=>{ const data=await outletDashboard(req.params.id,req.query.from||'1970-01-01',req.query.to||'2999-12-31'); if(!data) return fail(res,'Outlet not found',404); ok(res,data,'Outlet full business dashboard loaded'); }));
router.get(['/admin/outlets/:id/calendar','/admin/outlets/:id/daily-ledger','/admin/outlets/:id/sales-calendar'], ah(async(req,res)=>{ const data=await outletDashboard(req.params.id,req.query.from||'1970-01-01',req.query.to||'2999-12-31'); ok(res,{outletId:req.params.id,calendar:data?.closingCalendar||[],events:data?.events||[],monthlySales:data?.monthlySales||[],bestFoods:data?.bestFoods||[],slowFoods:data?.slowFoods||[]},'Outlet calendar loaded'); }));
router.get('/admin/outlets/:id/stock-ledger', ah(async(req,res)=>{ await ensureV41Schema(); const stock=await stockForOutlet(req.params.id); const movements=await q('SELECT osm.*, COALESCE(p.name,p.title,p.product_name,CONCAT("Food #",osm.product_id)) productName FROM outlet_stock_movements osm LEFT JOIN products p ON p.id=osm.product_id WHERE outlet_id=? ORDER BY osm.created_at DESC LIMIT 500',[req.params.id]); ok(res,{outletId:req.params.id,stock,lowStock:stock.filter(s=>n(s.stockQuantity)<=n(s.lowStockAlert,5)),movements},'Outlet stock ledger loaded'); }));
router.post(['/admin/outlets/:id/stock','/outlet-manager/stock'], ah(async(req,res)=>{ await ensureV41Schema(); const outletId=n(req.params.id||req.body?.outletId||req.user?.outletId); if(!outletId) return fail(res,'outletId required',400); const items=Array.isArray(req.body?.items)?req.body.items:[req.body]; const out=[]; for(const item of items){ const productId=n(item.productId||item.product_id); if(!productId) continue; const existing=await one('SELECT * FROM outlet_product_stock WHERE outlet_id=? AND product_id=?',[outletId,productId]); const before=n(existing?.stock_quantity); const newStock=item.stockQuantity ?? item.stock_quantity ?? (before+n(item.quantity,0)); const stock=n(newStock); await x(`INSERT INTO outlet_product_stock (outlet_id,product_id,opening_stock,stock_quantity,low_stock_alert,is_available,preparation_minutes,last_stock_audit_at,last_stock_audit_by) VALUES (?,?,?,?,?,?,?,NOW(6),?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity), low_stock_alert=VALUES(low_stock_alert), is_available=VALUES(is_available), preparation_minutes=VALUES(preparation_minutes), last_stock_audit_at=NOW(6), last_stock_audit_by=VALUES(last_stock_audit_by)`,[outletId,productId,before,stock,n(item.lowStockAlert||item.low_stock_alert,5),item.isAvailable===false?0:1,n(item.preparationMinutes||item.preparation_minutes,15),req.user?.username||req.body?.updatedBy||'admin']); await x('INSERT INTO outlet_stock_movements (outlet_id,product_id,movement_type,quantity,before_stock,after_stock,unit_cost,total_cost,note,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[outletId,productId,item.movementType||'MANUAL_UPDATE',stock-before,before,stock,n(item.unitCost),n(item.unitCost)*(stock-before),item.note||'',req.user?.username||'admin']); out.push({productId,beforeStock:before,afterStock:stock}); } ok(res,{outletId,updated:out},'Outlet stock updated'); }));
router.post(['/outlet-manager/day-close','/outlet-manager/outlet/close-day','/admin/outlets/:id/close-day'], ah(async(req,res)=>{ await ensureV41Schema(); const outletId=n(req.params.id||req.body?.outletId||req.user?.outletId); if(!outletId) return fail(res,'outletId required',400); const date=req.body?.date||today(); const orders=await ordersForOutlet(outletId,date,date); const online=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('ONLINE')||String(r.payment_status||'').toUpperCase().includes('PAID')).reduce((a,r)=>a+rupees(r),0); const cod=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('COD')).reduce((a,r)=>a+rupees(r),0); const offline=n(req.body?.offlineSales||req.body?.offline_sales,0); const offlineOrders=n(req.body?.offlineOrderCount||req.body?.offline_order_count,0); const expenses=n(req.body?.expenses,0); const total=online+cod+offline; await x(`INSERT INTO outlet_daily_closings (outlet_id,closing_date,online_sales,offline_sales,cod_sales,total_sales,order_count,offline_order_count,cash_in_hand,expenses,net_cash,closing_note,closed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE online_sales=VALUES(online_sales),offline_sales=VALUES(offline_sales),cod_sales=VALUES(cod_sales),total_sales=VALUES(total_sales),order_count=VALUES(order_count),offline_order_count=VALUES(offline_order_count),cash_in_hand=VALUES(cash_in_hand),expenses=VALUES(expenses),net_cash=VALUES(net_cash),closing_note=VALUES(closing_note),closed_by=VALUES(closed_by),submitted_at=NOW(6)`,[outletId,date,online,offline,cod,total,orders.length,offlineOrders,cod+offline,expenses,cod+offline-expenses,req.body?.note||req.body?.closingNote||'',req.user?.username||'outlet-manager']); await x('UPDATE outlets SET is_open=0 WHERE id=?',[outletId]); ok(res,{outletId,date,onlineSales:online,codSales:cod,offlineSales:offline,totalSales:total,expenses,netCash:cod+offline-expenses,orderCount:orders.length},'Day closed'); }));
router.get(['/outlets/nearest','/user/outlets/nearest'], ah(async(req,res)=>{ const {lat,lng,latitude,longitude}=req.query; const o=await nearestOutlet(lat??latitude,lng??longitude); if(!o) return fail(res,'No Mr Breado outlet found',404); ok(res,o,o.isServiceable?'Nearest outlet found':'Nearest outlet found but not serviceable'); }));
router.get(['/menu/nearest','/user/menu/nearest'], ah(async(req,res)=>{ const o=await nearestOutlet(req.query.lat??req.query.latitude,req.query.lng??req.query.longitude); if(!o) return fail(res,'No Mr Breado outlet found',404); const menu=await menuForOutlet(o.outletId); ok(res,{outlet:o,menu,foods:menu,products:menu},'Nearest outlet menu loaded'); }));
router.get(['/outlets/:id/menu','/user/outlets/:id/menu'], ah(async(req,res)=>{ const outlet=await outletById(req.params.id); if(!outlet) return fail(res,'Outlet not found',404); const menu=await menuForOutlet(req.params.id); ok(res,{outlet,menu,foods:menu,products:menu},'Outlet menu loaded'); }));
router.get(['/outlets/:id/contact','/user/outlets/:id/contact'], ah(async(req,res)=>{ const outlet=await outletById(req.params.id); if(!outlet) return fail(res,'Outlet not found',404); ok(res,{outletId:outlet.outletId,name:outlet.name,address:outlet.address,phone:outlet.contactPhone||outlet.managerPhone,email:outlet.contactEmail||outlet.managerEmail,whatsapp:outlet.whatsappNumber,googleMapLink:outlet.googleMapLink,openingTime:outlet.openingTime,closingTime:outlet.closingTime,bookingEnabled:outlet.bookingEnabled},'Outlet contact loaded'); }));
router.post(['/outlets/:id/bookings','/user/outlets/:id/bookings'], ah(async(req,res)=>{ await ensureV41Schema(); const body=req.body||{}; await x('INSERT INTO outlet_bookings (outlet_id,customer_id,customer_name,phone,email,booking_type,booking_date,booking_time,people_count,note,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[req.params.id,req.user?.id||body.customerId||null,body.customerName||body.name||'',body.phone||'',body.email||'',body.bookingType||'GENERAL',body.bookingDate||body.date||today(),body.bookingTime||body.time||'',n(body.peopleCount||body.people_count,1),body.note||body.message||'', 'PENDING']); ok(res,{outletId:req.params.id},'Booking request submitted',201); }));
router.get(['/rider/outlet-assignment','/delivery-boy/outlet'], ah(async(req,res)=>{ await ensureV41Schema(); const userId=req.user?.id||req.query.userId; if(!userId) return ok(res,{assigned:false},'No rider user id'); const row=await one('SELECT odb.*, o.name outletName, o.address, o.latitude, o.longitude FROM outlet_delivery_boys odb JOIN outlets o ON o.id=odb.outlet_id WHERE odb.user_id=? AND odb.is_active=1 ORDER BY odb.id DESC LIMIT 1',[userId]); ok(res,row?{assigned:true,...row}:{assigned:false},'Rider outlet assignment loaded'); }));
router.post(['/admin/outlets/:outletId/delivery-boys/:userId'], ah(async(req,res)=>{ await ensureV41Schema(); await x(`INSERT INTO outlet_delivery_boys (outlet_id,user_id,is_active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), is_active=1`,[req.params.outletId,req.params.userId]); ok(res,{outletId:req.params.outletId,userId:req.params.userId},'Delivery boy assigned to outlet'); }));
router.get('/admin/reports/outlet-accounting.csv', ah(async(req,res)=>{ await ensureV41Schema(); const from=req.query.from||'1970-01-01', to=req.query.to||'2999-12-31', outletId=req.query.outletId||null; const params=outletId?[outletId,from,to]:[from,to]; const where=outletId?'WHERE odc.outlet_id=? AND closing_date BETWEEN ? AND ?':'WHERE closing_date BETWEEN ? AND ?'; const rows=await q(`SELECT o.name outletName, odc.* FROM outlet_daily_closings odc JOIN outlets o ON o.id=odc.outlet_id ${where} ORDER BY closing_date DESC`,params); await x('INSERT INTO accounting_export_logs (export_type,date_from,date_to,outlet_id,generated_by,row_count) VALUES (?,?,?,?,?,?)',['OUTLET_ACCOUNTING_V41',from,to,outletId,req.user?.role||'admin',rows.length]); const csv=['Outlet,Date,Online Sales,COD Sales,Offline Sales,Total Sales,Orders,Offline Orders,Cash In Hand,Expenses,Net Cash,Note',...rows.map(r=>`"${String(r.outletName||'').replace(/"/g,'""')}",${String(r.closing_date).slice(0,10)},${r.online_sales},${r.cod_sales},${r.offline_sales},${r.total_sales},${r.order_count},${r.offline_order_count},${r.cash_in_hand},${r.expenses},${r.net_cash},"${String(r.closing_note||'').replace(/"/g,'""')}"`)].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="mr_breado_outlet_accounting_v41.csv"'); res.send(csv); }));

module.exports = router;
