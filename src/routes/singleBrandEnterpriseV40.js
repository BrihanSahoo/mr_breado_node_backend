const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ok, fail } = require('../utils/respond');
const ah = require('../utils/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');
const { jwtSecret } = require('../config/env');

router.use(optionalAuth);

async function x(sql, params = []) { const [r] = await pool.execute(sql, params); return r; }
async function q(sql, params = []) { try { const [r] = await pool.execute(sql, params); return r; } catch (e) { console.error('[singleBrandV40]', e.message); return []; } }
async function one(sql, params = []) { const rows = await q(sql, params); return rows[0] || null; }
function n(v, d = 0) { const z = Number(v); return Number.isFinite(z) ? z : d; }
function b(v, d = true) { if (v === undefined || v === null) return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v === 1; return ['1','true','yes','open','active','available'].includes(String(v).toLowerCase()); }
function slug(v='') { return String(v).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'mr-breado-outlet'; }
function today() { return new Date().toISOString().slice(0,10); }
function km(aLat,aLng,bLat,bLng){ const R=6371, rad=(v)=>v*Math.PI/180; const dLat=rad(bLat-aLat), dLng=rad(bLng-aLng); const A=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2; return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A)); }
function page(items, req) { const p=Math.max(1,n(req.query.page,1)); const limit=Math.max(1,n(req.query.limit,items.length||20)); return {items,content:items,data:items,total:items.length,totalElements:items.length,page:p,currentPage:p,perPage:limit,totalPages:1,last:true}; }

async function ensureEnterpriseSchema() {
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
  await x(`CREATE TABLE IF NOT EXISTS outlet_manager_accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(40), email VARCHAR(255), username VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(40) NOT NULL DEFAULT 'OUTLET_MANAGER',
    is_active BIT(1) NOT NULL DEFAULT b'1', last_login_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    INDEX idx_oma_outlet (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
    opening_stock INT NOT NULL DEFAULT 0, stock_quantity INT NOT NULL DEFAULT 0, sold_quantity INT NOT NULL DEFAULT 0,
    low_stock_alert INT NOT NULL DEFAULT 5, is_available BIT(1) NOT NULL DEFAULT b'1', preparation_minutes INT DEFAULT 15,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    UNIQUE KEY uq_outlet_product_stock_v40 (outlet_id, product_id), INDEX idx_ops_product_v40 (product_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_stock_movements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
    movement_type VARCHAR(40) NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    before_stock INT NOT NULL DEFAULT 0, after_stock INT NOT NULL DEFAULT 0,
    reference_type VARCHAR(60), reference_id BIGINT NULL, note VARCHAR(700), created_by VARCHAR(120),
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_osm_outlet_date (outlet_id, created_at), INDEX idx_osm_product (product_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_daily_closings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, closing_date DATE NOT NULL,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0, offline_sales DECIMAL(12,2) NOT NULL DEFAULT 0, cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    order_count INT NOT NULL DEFAULT 0, offline_order_count INT NOT NULL DEFAULT 0,
    closing_note VARCHAR(1000), closed_by VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'SUBMITTED',
    submitted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), approved_at DATETIME(6) NULL,
    UNIQUE KEY uq_outlet_daily_closing (outlet_id, closing_date), INDEX idx_odc_date (closing_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_product_daily_stats (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, product_id BIGINT NOT NULL, report_date DATE NOT NULL,
    sold_quantity INT NOT NULL DEFAULT 0, gross_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    cancelled_quantity INT NOT NULL DEFAULT 0, last_sold_at DATETIME(6) NULL,
    UNIQUE KEY uq_opds (outlet_id, product_id, report_date), INDEX idx_opds_outlet_date (outlet_id, report_date)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_delivery_boys (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, user_id BIGINT NOT NULL,
    assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), is_active BIT(1) NOT NULL DEFAULT b'1',
    UNIQUE KEY uq_outlet_delivery_boy_v40 (outlet_id, user_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS outlet_order_assignments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_id BIGINT NOT NULL UNIQUE, outlet_id BIGINT NOT NULL,
    assigned_by VARCHAR(80) NOT NULL DEFAULT 'USER_SELECTED_OR_NEAREST', distance_km DECIMAL(8,2) DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX idx_ooa_outlet_v40 (outlet_id)
  )`);
  await x(`CREATE TABLE IF NOT EXISTS accounting_export_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    export_type VARCHAR(80) NOT NULL, date_from DATE NULL, date_to DATE NULL,
    outlet_id BIGINT NULL, generated_by VARCHAR(120), row_count INT DEFAULT 0,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  )`);
}
async function outlets() { await ensureEnterpriseSchema(); const rows = await q('SELECT * FROM outlets WHERE is_active=1 ORDER BY id DESC'); return rows.map(o => ({...o,outletId:o.id,outletCode:o.outlet_code,name:o.name,outletName:o.name,isOpen:b(o.is_open),isActive:b(o.is_active),serviceRadiusKm:n(o.service_radius_km,5),latitude:o.latitude==null?null:n(o.latitude),longitude:o.longitude==null?null:n(o.longitude)})); }
async function nearestOutlet(lat,lng){ const list=await outlets(); let best=null; for(const o of list){ if(o.latitude==null||o.longitude==null) continue; const d=km(n(lat),n(lng),n(o.latitude),n(o.longitude)); const cur={...o,distanceKm:Number(d.toFixed(2)),isServiceable:d<=n(o.serviceRadiusKm,5)&&o.isOpen}; if(!best||cur.distanceKm<best.distanceKm) best=cur; } return best || list[0] || null; }
async function productsForOutlet(outletId){ await ensureEnterpriseSchema(); const rows = await q(`SELECT p.*, ops.stock_quantity, ops.opening_stock, ops.sold_quantity, ops.is_available outlet_available, ops.preparation_minutes outlet_preparation_minutes FROM products p LEFT JOIN outlet_product_stock ops ON ops.product_id=p.id AND ops.outlet_id=? WHERE COALESCE(ops.is_available, b'1')=b'1' ORDER BY p.id DESC LIMIT 1000`, [outletId]); return rows.map(p=>({ ...p, productId:p.id, name:p.name||p.title||p.product_name||`Food #${p.id}`, title:p.name||p.title||p.product_name||`Food #${p.id}`, price:n(p.price||p.base_price||p.discounted_price), stockQuantity:n(p.stock_quantity,999), preparationMinutes:n(p.outlet_preparation_minutes||p.preparation_time||p.preparation_minutes,15), outletId:n(outletId)})); }
async function outletOrderRows(outletId, from='1970-01-01', to='2999-12-31') { return q(`SELECT o.* FROM orders o LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id WHERE COALESCE(ooa.outlet_id,o.restaurant_id,0)=? AND DATE(o.created_at) BETWEEN ? AND ? ORDER BY o.created_at DESC LIMIT 2000`, [outletId, from, to]); }
async function productStats(outletId, from='1970-01-01', to='2999-12-31') {
  return q(`SELECT oi.product_id productId, COALESCE(p.name,p.title,CONCAT('Food #',oi.product_id)) productName, SUM(COALESCE(oi.quantity,1)) soldQuantity, SUM(COALESCE(oi.total_price,oi.price*oi.quantity,oi.price,0)) grossSales FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN outlet_order_assignments ooa ON ooa.order_id=o.id LEFT JOIN products p ON p.id=oi.product_id WHERE COALESCE(ooa.outlet_id,o.restaurant_id,0)=? AND DATE(o.created_at) BETWEEN ? AND ? GROUP BY oi.product_id, productName ORDER BY soldQuantity DESC`, [outletId, from, to]);
}

router.get('/single-brand/v40/version', (req,res)=>ok(res,{version:'single-brand-enterprise-v40',model:'Mr Breado only: head office + outlets + outlet managers + in-house riders',marketplaceDisabled:true,razorpay:'v22/v26 create-order kept unchanged'},'Single-brand enterprise v40 active'));
router.post(['/admin/outlets/ensure-enterprise-schema','/admin/outlets/ensure-schema'], ah(async (req,res)=>{ await ensureEnterpriseSchema(); ok(res,{tables:['outlets','outlet_manager_accounts','outlet_product_stock','outlet_stock_movements','outlet_daily_closings','outlet_product_daily_stats','outlet_delivery_boys','outlet_order_assignments','accounting_export_logs']},'Enterprise outlet schema ready'); }));

router.get(['/admin/business/dashboard','/admin/head-office/business-dashboard'], ah(async(req,res)=>{ const os=await outlets(); const from=req.query.from||today(); const to=req.query.to||today(); const data=[]; for(const o of os){ const orders=await outletOrderRows(o.id,from,to); const online=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('ONLINE')).reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0); const cod=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('COD')).reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0); const total=orders.reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0); const ps=await productStats(o.id,from,to); const inventory=await q('SELECT COUNT(*) productCount, SUM(CASE WHEN stock_quantity<=low_stock_alert THEN 1 ELSE 0 END) lowStockCount FROM outlet_product_stock WHERE outlet_id=?',[o.id]); data.push({...o,orderCount:orders.length,totalSales:total,onlineSales:online,codSales:cod,topFoods:ps.slice(0,5),slowFoods:ps.slice().reverse().slice(0,5),lowStockCount:n(inventory[0]?.lowStockCount),productCount:n(inventory[0]?.productCount)}); } ok(res,{brand:'Mr Breado',model:'SINGLE_BRAND_MULTI_OUTLET_ENTERPRISE',from,to,totalOutlets:data.length,totalOrders:data.reduce((a,b)=>a+b.orderCount,0),totalSales:data.reduce((a,b)=>a+b.totalSales,0),onlineSales:data.reduce((a,b)=>a+b.onlineSales,0),codSales:data.reduce((a,b)=>a+b.codSales,0),outlets:data,topOutlet:data.slice().sort((a,b)=>b.totalSales-a.totalSales)[0]||null},'Business dashboard loaded'); }));
router.get(['/admin/outlets','/admin/branches','/outlets'], ah(async(req,res)=>ok(res,page(await outlets(),req),'Outlets loaded')));
router.post('/admin/outlets', ah(async(req,res)=>{ await ensureEnterpriseSchema(); const d=req.body||{}; const code=d.outletCode||d.outlet_code||slug(d.name||d.outletName)+'-'+Date.now().toString().slice(-5); const r=await x('INSERT INTO outlets (outlet_code,name,address,city,state,pincode,latitude,longitude,service_radius_km,manager_name,manager_phone,manager_email,is_open,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[code,d.name||d.outletName||'Mr Breado Outlet',d.address||'',d.city||'',d.state||'',d.pincode||'',d.latitude||d.lat||null,d.longitude||d.lng||null,n(d.serviceRadiusKm||d.service_radius_km,5),d.managerName||'',d.managerPhone||'',d.managerEmail||'',b(d.isOpen??d.open,true)?1:0,b(d.isActive??d.active,true)?1:0]); ok(res,{id:r.insertId,outletId:r.insertId,outletCode:code},'Outlet created',201); }));
router.put('/admin/outlets/:id', ah(async(req,res)=>{ await ensureEnterpriseSchema(); const d=req.body||{}; await x('UPDATE outlets SET name=COALESCE(?,name), address=COALESCE(?,address), city=COALESCE(?,city), state=COALESCE(?,state), pincode=COALESCE(?,pincode), latitude=COALESCE(?,latitude), longitude=COALESCE(?,longitude), service_radius_km=COALESCE(?,service_radius_km), manager_name=COALESCE(?,manager_name), manager_phone=COALESCE(?,manager_phone), manager_email=COALESCE(?,manager_email), is_open=?, is_active=? WHERE id=?',[d.name||d.outletName||null,d.address||null,d.city||null,d.state||null,d.pincode||null,d.latitude||d.lat||null,d.longitude||d.lng||null,d.serviceRadiusKm||d.service_radius_km||null,d.managerName||null,d.managerPhone||null,d.managerEmail||null,b(d.isOpen??d.open,true)?1:0,b(d.isActive??d.active,true)?1:0,req.params.id]); ok(res,{id:req.params.id},'Outlet updated'); }));

router.post(['/admin/outlets/:id/credentials','/admin/outlet-manager-accounts'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const d=req.body||{}; const outletId=req.params.id||d.outletId||d.outlet_id; if(!outletId) return fail(res,'outletId required',400); const username=d.username||d.email||d.phone; const password=d.password||d.tempPassword; if(!username||!password) return fail(res,'username and password required',400); const hash=await bcrypt.hash(password,10); await x(`INSERT INTO outlet_manager_accounts (outlet_id,name,phone,email,username,password_hash,is_active) VALUES (?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), name=VALUES(name), phone=VALUES(phone), email=VALUES(email), password_hash=VALUES(password_hash), is_active=1`,[outletId,d.name||d.managerName||'Outlet Manager',d.phone||d.managerPhone||'',d.email||d.managerEmail||'',username,hash]); ok(res,{outletId,username,role:'OUTLET_MANAGER'},'Outlet login credentials saved'); }));
router.post(['/outlet/auth/login','/outlet-manager/login','/seller/outlet-login'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const d=req.body||{}; const username=d.username||d.email||d.phone; const row=await one('SELECT oma.*, o.name outletName, o.outlet_code outletCode FROM outlet_manager_accounts oma JOIN outlets o ON o.id=oma.outlet_id WHERE oma.username=? AND oma.is_active=1 LIMIT 1',[username]); if(!row) return fail(res,'Invalid outlet credentials',401); const pass=await bcrypt.compare(String(d.password||''),row.password_hash); if(!pass) return fail(res,'Invalid outlet credentials',401); await x('UPDATE outlet_manager_accounts SET last_login_at=NOW(6) WHERE id=?',[row.id]); const payload={id:row.id,userId:row.id,role:'OUTLET_MANAGER',outletId:row.outlet_id,username:row.username}; const token=jwt.sign(payload,jwtSecret,{expiresIn:'30d'}); ok(res,{token,role:'OUTLET_MANAGER',user:{id:row.id,name:row.name,email:row.email,phone:row.phone,role:'OUTLET_MANAGER',outletId:row.outlet_id,outletName:row.outletName,outletCode:row.outletCode},outlet:{id:row.outlet_id,outletId:row.outlet_id,name:row.outletName,outletCode:row.outletCode}},'Outlet login successful'); }));

router.get(['/outlets/nearest','/branches/nearest'], ah(async(req,res)=>{ const lat=req.query.lat||req.query.latitude, lng=req.query.lng||req.query.longitude; if(!lat||!lng) return fail(res,'lat and lng are required',400); const outlet=await nearestOutlet(lat,lng); if(!outlet) return fail(res,'No Mr Breado outlet configured',404); ok(res,outlet,outlet.isServiceable?'Nearest outlet found':'Nearest outlet is outside service range'); }));
router.get(['/outlets/:id/menu','/branches/:id/menu'], ah(async(req,res)=>ok(res,{outletId:req.params.id,products:await productsForOutlet(req.params.id)},'Outlet menu loaded')));
router.get(['/menu/nearest','/home/nearest-menu'], ah(async(req,res)=>{ const lat=req.query.lat||req.query.latitude, lng=req.query.lng||req.query.longitude; if(!lat||!lng) return fail(res,'lat and lng are required',400); const outlet=await nearestOutlet(lat,lng); if(!outlet) return fail(res,'No Mr Breado outlet configured',404); ok(res,{outlet,products:await productsForOutlet(outlet.id)},'Nearest outlet menu loaded'); }));

router.get(['/outlet-manager/me','/seller/outlet/me'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const outletId=req.user?.outletId||req.query.outletId; let outlet=outletId?await one('SELECT * FROM outlets WHERE id=?',[outletId]):null; if(!outlet) outlet=(await outlets())[0]||null; ok(res,outlet,'Outlet manager outlet loaded'); }));
router.get(['/outlet-manager/dashboard','/seller/outlet/dashboard'], ah(async(req,res)=>{ const outletId=req.user?.outletId||req.query.outletId; if(!outletId) return fail(res,'outletId required',400); const from=req.query.from||today(), to=req.query.to||today(); const orders=await outletOrderRows(outletId,from,to); const closings=await q('SELECT * FROM outlet_daily_closings WHERE outlet_id=? AND closing_date BETWEEN ? AND ? ORDER BY closing_date DESC',[outletId,from,to]); const ps=await productStats(outletId,from,to); const stock=await q('SELECT ops.*, COALESCE(p.name,p.title,CONCAT("Food #",ops.product_id)) productName FROM outlet_product_stock ops LEFT JOIN products p ON p.id=ops.product_id WHERE outlet_id=? ORDER BY productName',[outletId]); ok(res,{outletId,from,to,orders:orders.length,totalSales:orders.reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0),closings,topFoods:ps.slice(0,10),slowFoods:ps.slice().reverse().slice(0,10),stock},'Outlet manager dashboard loaded'); }));
router.post(['/outlet-manager/stock','/seller/outlet/stock','/admin/outlets/:id/stock'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const outletId=req.params.id||req.user?.outletId||req.body?.outletId||req.body?.outlet_id; if(!outletId) return fail(res,'outletId required',400); const items=Array.isArray(req.body?.items)?req.body.items:[req.body]; for(const it of items){ const productId=it.productId||it.product_id; if(!productId) continue; const old=await one('SELECT stock_quantity FROM outlet_product_stock WHERE outlet_id=? AND product_id=?',[outletId,productId]); const before=n(old?.stock_quantity); const qty=n(it.stockQuantity??it.stock_quantity??it.stock,before); await x(`INSERT INTO outlet_product_stock (outlet_id,product_id,opening_stock,stock_quantity,low_stock_alert,is_available,preparation_minutes) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity), low_stock_alert=VALUES(low_stock_alert), is_available=VALUES(is_available), preparation_minutes=VALUES(preparation_minutes)`,[outletId,productId,qty,qty,n(it.lowStockAlert||it.low_stock_alert,5),b(it.isAvailable??it.available,true)?1:0,n(it.preparationMinutes||it.preparation_minutes,15)]); await x('INSERT INTO outlet_stock_movements (outlet_id,product_id,movement_type,quantity,before_stock,after_stock,note,created_by) VALUES (?,?,?,?,?,?,?,?)',[outletId,productId,'MANUAL_ADJUSTMENT',qty-before,before,qty,it.note||'Stock updated',req.user?.username||req.user?.role||'system']); } ok(res,{outletId,count:items.length},'Stock updated'); }));
router.post(['/outlet-manager/close-day','/seller/outlet/close-day'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const outletId=req.user?.outletId||req.body?.outletId||req.body?.outlet_id; if(!outletId) return fail(res,'outletId required',400); const date=req.body?.date||today(); const orders=await outletOrderRows(outletId,date,date); const online=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('ONLINE')).reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0); const cod=orders.filter(r=>String(r.payment_type||r.payment_method||'').toUpperCase().includes('COD')).reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0); const offline=n(req.body?.offlineSales||req.body?.offline_sales,0); const offlineOrders=n(req.body?.offlineOrderCount||req.body?.offline_order_count,0); await x(`INSERT INTO outlet_daily_closings (outlet_id,closing_date,online_sales,offline_sales,cod_sales,total_sales,order_count,offline_order_count,closing_note,closed_by) VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE online_sales=VALUES(online_sales),offline_sales=VALUES(offline_sales),cod_sales=VALUES(cod_sales),total_sales=VALUES(total_sales),order_count=VALUES(order_count),offline_order_count=VALUES(offline_order_count),closing_note=VALUES(closing_note),closed_by=VALUES(closed_by),submitted_at=NOW(6)`,[outletId,date,online,offline,cod,online+cod+offline,orders.length,offlineOrders,req.body?.note||req.body?.closingNote||'',req.user?.username||'outlet-manager']); await x('UPDATE outlets SET is_open=0 WHERE id=?',[outletId]); ok(res,{outletId,date,onlineSales:online,codSales:cod,offlineSales:offline,totalSales:online+cod+offline,orderCount:orders.length},'Day closed and outlet marked closed'); }));
router.get(['/admin/outlets/:id/calendar','/admin/outlets/:id/daily-ledger'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); const from=req.query.from||'1970-01-01', to=req.query.to||'2999-12-31'; const closings=await q('SELECT * FROM outlet_daily_closings WHERE outlet_id=? AND closing_date BETWEEN ? AND ? ORDER BY closing_date DESC',[req.params.id,from,to]); const stocks=await q('SELECT DATE(created_at) movementDate, COUNT(*) movements, SUM(quantity) netQuantity FROM outlet_stock_movements WHERE outlet_id=? AND DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY movementDate DESC',[req.params.id,from,to]); const products=await productStats(req.params.id,from,to); ok(res,{outletId:req.params.id,from,to,calendar:closings,stockMovementsByDay:stocks,bestFoods:products.slice(0,10),slowFoods:products.slice().reverse().slice(0,10)},'Outlet calendar ledger loaded'); }));
router.get(['/admin/outlets/:id/performance','/admin/outlets/:id/analytics'], ah(async(req,res)=>{ const from=req.query.from||'1970-01-01', to=req.query.to||'2999-12-31'; const orders=await outletOrderRows(req.params.id,from,to); const products=await productStats(req.params.id,from,to); const stock=await q('SELECT ops.*, COALESCE(p.name,p.title,CONCAT("Food #",ops.product_id)) productName FROM outlet_product_stock ops LEFT JOIN products p ON p.id=ops.product_id WHERE outlet_id=? ORDER BY stock_quantity ASC',[req.params.id]); ok(res,{outletId:req.params.id,from,to,orders:orders.length,totalSales:orders.reduce((a,r)=>a+n(r.grand_total||r.total||r.total_amount),0),bestFoods:products.slice(0,10),notSellingWell:products.slice().reverse().slice(0,10),lowStock:stock.filter(s=>n(s.stock_quantity)<=n(s.low_stock_alert,5)),stock},'Outlet performance loaded'); }));
router.post(['/admin/outlets/:outletId/delivery-boys/:userId'], ah(async(req,res)=>{ await ensureEnterpriseSchema(); await x(`INSERT INTO outlet_delivery_boys (outlet_id,user_id,is_active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE outlet_id=VALUES(outlet_id), is_active=1`,[req.params.outletId,req.params.userId]); ok(res,{outletId:req.params.outletId,userId:req.params.userId},'Delivery boy assigned to outlet'); }));
router.get(['/admin/reports/accounting-export.csv'], ah(async(req,res)=>{ const from=req.query.from||'1970-01-01', to=req.query.to||'2999-12-31'; const rows=await q('SELECT o.name outletName, odc.* FROM outlet_daily_closings odc JOIN outlets o ON o.id=odc.outlet_id WHERE closing_date BETWEEN ? AND ? ORDER BY closing_date DESC',[from,to]); await x('INSERT INTO accounting_export_logs (export_type,date_from,date_to,generated_by,row_count) VALUES (?,?,?,?,?)',['OUTLET_DAILY_CLOSING',from,to,req.user?.role||'admin',rows.length]); const csv=['Outlet,Date,Online Sales,COD Sales,Offline Sales,Total Sales,Orders,Offline Orders,Note',...rows.map(r=>`"${String(r.outletName||'').replace(/"/g,'""')}",${r.closing_date},${r.online_sales},${r.cod_sales},${r.offline_sales},${r.total_sales},${r.order_count},${r.offline_order_count},"${String(r.closing_note||'').replace(/"/g,'""')}"`)].join('\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="mr_breado_outlet_accounting_export.csv"'); res.send(csv); }));
router.all(['/seller/register','/restaurants','/admin/restaurants','/admin/restaurant-payouts','/admin/seller-payout-accounts','/admin/franchise-requests'], (req,res)=>ok(res,{disabled:true,replacement:'Use /admin/outlets and outlet-manager login. Mr Breado is now single-brand multi-outlet, not marketplace.'},'Marketplace workflow disabled'));

module.exports = router;
