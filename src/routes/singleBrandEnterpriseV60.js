const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok, fail } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');
const { requireAuth } = require('../middleware/auth');
const { jwtSecret } = require('../config/env');

const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const s = (v) => String(v ?? '').trim();
const bit = (v) => Buffer.isBuffer(v) ? v[0] === 1 : (v === true || v === 1 || String(v).toLowerCase() === 'true');
const today = () => new Date().toISOString().slice(0, 10);
async function q1(sql, p = {}) { try { return await one(sql, p); } catch (e) { console.error('[v60 one]', e.message); return null; } }
async function qa(sql, p = {}) { try { return await many(sql, p); } catch (e) { console.error('[v60 many]', e.message); return []; } }
async function ex(sql, p = {}) { try { return await exec(sql, p); } catch (e) { console.error('[v60 exec]', e.message); return null; } }

async function ensureSchema() {
  await ex(`CREATE TABLE IF NOT EXISTS outlet_manager_accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    name VARCHAR(150) NOT NULL,
    phone VARCHAR(40) NULL,
    email VARCHAR(190) NULL,
    username VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v60_outlet_manager_outlet(outlet_id),
    UNIQUE KEY uq_v60_outlet_manager_username(username),
    KEY idx_v60_outlet_manager_email(email),
    KEY idx_v60_outlet_manager_phone(phone)
  )`);
  await ex(`CREATE TABLE IF NOT EXISTS outlet_daily_closing_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    closing_date DATE NOT NULL,
    product_id BIGINT NOT NULL,
    opening_stock INT NOT NULL DEFAULT 0,
    closing_stock INT NOT NULL DEFAULT 0,
    offline_sold_qty INT NOT NULL DEFAULT 0,
    wastage_qty INT NOT NULL DEFAULT 0,
    note VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_v60_close_item(outlet_id,closing_date,product_id),
    KEY idx_v60_close_item_product(product_id)
  )`);
  for (const sql of [
    'ALTER TABLE outlet_product_stock ADD COLUMN stock_qty INT NOT NULL DEFAULT 0',
    'ALTER TABLE outlet_product_stock ADD COLUMN stock_quantity INT NOT NULL DEFAULT 0',
    'ALTER TABLE outlet_product_stock ADD COLUMN min_stock_qty INT NOT NULL DEFAULT 5',
    'ALTER TABLE outlet_product_stock ADD COLUMN low_stock_alert INT NOT NULL DEFAULT 5',
    'ALTER TABLE outlet_product_stock ADD COLUMN prep_time_minutes INT NOT NULL DEFAULT 15',
    'ALTER TABLE outlet_product_stock ADD COLUMN preparation_minutes INT NOT NULL DEFAULT 15',
    'ALTER TABLE outlet_product_stock ADD COLUMN selling_price DECIMAL(12,2) NOT NULL DEFAULT 0',
    'ALTER TABLE outlet_product_stock ADD COLUMN unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0',
    'ALTER TABLE outlet_product_stock ADD COLUMN is_available TINYINT(1) NOT NULL DEFAULT 1',
    'ALTER TABLE outlet_product_stock ADD COLUMN updated_at DATETIME NULL'
  ]) await ex(sql);
}

async function outletId(req) {
  const direct = n(req.user?.outletId || req.user?.outlet_id);
  if (direct) return direct;
  const account = await q1('SELECT outlet_id outletId FROM outlet_manager_accounts WHERE id=:id LIMIT 1', { id: req.user?.id || 0 });
  return n(account?.outletId);
}

async function stockRows(id) {
  return qa(`SELECT s.*, p.id productId,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) productName,
    COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),NULLIF(p.thumbnail_url,''),'') imageUrl,
    COALESCE(c.name,'Uncategorized') categoryName,
    COALESCE(p.is_veg,1) isVeg,
    GREATEST(COALESCE(s.stock_qty,0),COALESCE(s.stock_quantity,0)) stockQuantity,
    GREATEST(COALESCE(s.min_stock_qty,0),COALESCE(s.low_stock_alert,0),5) lowStockAlert,
    GREATEST(COALESCE(s.prep_time_minutes,0),COALESCE(s.preparation_minutes,0),15) preparationMinutes,
    COALESCE(NULLIF(s.selling_price,0),NULLIF(p.discount_price,0),p.price,0) sellingPrice
    FROM outlet_product_stock s
    JOIN products p ON p.id=s.product_id
    LEFT JOIN categories c ON c.id=COALESCE(p.category_id,p.food_category_id,p.menu_category_id)
    WHERE s.outlet_id=:id ORDER BY productName`, { id });
}

async function ordersFor(id, from = '1970-01-01', to = '2999-12-31') {
  const rows = await qa(`SELECT o.*, o.grand_total total,
    u.name customerName,u.email customerEmail,COALESCE(u.mobile,u.phone) customerPhone,
    ot.name outletName,ot.outlet_code outletCode,
    ru.name riderName,COALESCE(ru.mobile,ru.phone) riderPhone
    FROM orders o
    LEFT JOIN users u ON u.id=o.user_id
    LEFT JOIN outlets ot ON ot.id=o.restaurant_id
    LEFT JOIN outlet_order_assignments oa ON oa.order_id=o.id
    LEFT JOIN delivery_partner_profiles dp ON dp.id=oa.rider_id OR dp.user_id=oa.rider_id
    LEFT JOIN users ru ON ru.id=dp.user_id
    WHERE o.restaurant_id=:id AND DATE(o.created_at) BETWEEN :from AND :to
    ORDER BY o.id DESC LIMIT 1000`, { id, from, to });
  for (const row of rows) row.items = await qa(`SELECT oi.*,COALESCE(NULLIF(oi.title,''),NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',oi.product_id)) productName FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=:oid ORDER BY oi.id`, { oid: row.id });
  return rows;
}

router.get('/single-brand/v60/version', (req, res) => ok(res, { version: 'single-brand-enterprise-v60', focus: 'credential-order-stock-day-close-consistency', razorpay: 'v22/v26 unchanged' }, 'v60 active'));
router.post('/admin/outlets/ensure-enterprise-v60-schema', ah(async (req, res) => { await ensureSchema(); ok(res, { ready: true }, 'v60 schema ready'); }));

router.post(['/admin/outlets/:id/credentials','/admin/outlet-manager-accounts'], ah(async (req,res)=>{
  await ensureSchema(); const d=req.body||{}; const id=n(req.params.id||d.outletId||d.outlet_id); if(!id) return fail(res,'Outlet is required',400);
  const username=s(d.username||d.email||d.phone).toLowerCase(); const password=s(d.password||d.tempPassword);
  if(!username) return fail(res,'Username, email or phone is required',400); if(!password) return fail(res,'Password is required',400);
  const hash=await bcrypt.hash(password,12); const existing=await q1('SELECT id FROM outlet_manager_accounts WHERE outlet_id=:id LIMIT 1',{id});
  const payload={id,name:s(d.name||d.managerName)||'Outlet Manager',phone:s(d.phone||d.managerPhone),email:s(d.email||d.managerEmail).toLowerCase(),username,passwordHash:hash};
  if(existing) await exec(`UPDATE outlet_manager_accounts SET name=:name,phone=:phone,email=:email,username=:username,password_hash=:passwordHash,is_active=1,updated_at=NOW() WHERE id=:accountId`,{...payload,accountId:existing.id});
  else await exec(`INSERT INTO outlet_manager_accounts(outlet_id,name,phone,email,username,password_hash,is_active) VALUES(:id,:name,:phone,:email,:username,:passwordHash,1)`,payload);
  await ex('UPDATE outlets SET manager_name=:name,manager_phone=:phone,manager_email=:email WHERE id=:id',payload);
  ok(res,{outletId:id,username,email:payload.email,phone:payload.phone,role:'OUTLET_MANAGER'},'Outlet login credentials saved');
}));

router.post(['/outlet/auth/login','/outlet-manager/login','/seller/outlet-login'], ah(async(req,res)=>{
  await ensureSchema(); const d=req.body||{}; const identifier=s(d.username||d.email||d.phone||d.identifier).toLowerCase();
  if(!identifier||!s(d.password)) return fail(res,'Username/email/phone and password are required',400);
  const row=await q1(`SELECT oma.*,o.name outletName,o.outlet_code outletCode,o.is_open outletOpen FROM outlet_manager_accounts oma JOIN outlets o ON o.id=oma.outlet_id WHERE oma.is_active=1 AND (LOWER(oma.username)=:identifier OR LOWER(COALESCE(oma.email,''))=:identifier OR REPLACE(COALESCE(oma.phone,''),' ','')=REPLACE(:identifier,' ','')) LIMIT 1`,{identifier});
  if(!row) return fail(res,'Invalid outlet credentials',401); if(!(await bcrypt.compare(s(d.password),row.password_hash))) return fail(res,'Invalid outlet credentials',401);
  await ex('UPDATE outlet_manager_accounts SET last_login_at=NOW() WHERE id=:id',{id:row.id});
  const token=jwt.sign({id:row.id,userId:row.id,role:'OUTLET_MANAGER',outletId:row.outlet_id,username:row.username},jwtSecret,{expiresIn:'30d'});
  ok(res,{token,accessToken:token,role:'OUTLET_MANAGER',outletId:row.outlet_id,user:{id:row.id,name:row.name,email:row.email||'',phone:row.phone||'',role:'OUTLET_MANAGER',outletId:row.outlet_id,outletName:row.outletName,outletCode:row.outletCode},outlet:{id:row.outlet_id,outletId:row.outlet_id,name:row.outletName,outletCode:row.outletCode,isOpen:bit(row.outletOpen)}},'Outlet login successful');
}));


router.post(['/admin/outlets/:id/stock','/outlet-manager/stock'],requireAuth,ah(async(req,res)=>{
  await ensureSchema(); const id=n(req.params.id)||await outletId(req)||n(req.body?.outletId||req.body?.outlet_id); if(!id)return fail(res,'Outlet is required',400);
  const items=Array.isArray(req.body?.items)?req.body.items:[req.body]; const updated=[];
  for(const it of items){const pid=n(it.productId||it.product_id||it.id);if(!pid)continue;const beforeRow=await q1('SELECT GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0)) qty FROM outlet_product_stock WHERE outlet_id=:id AND product_id=:pid',{id,pid});const before=n(beforeRow?.qty);const qty=Math.max(0,n(it.stockQuantity??it.stock_quantity??it.stock??before));const low=Math.max(0,n(it.lowStockAlert??it.low_stock_alert??it.minStockQty??5));const prep=Math.max(1,n(it.preparationMinutes??it.preparation_minutes??it.prepTimeMinutes??15));const available=it.isAvailable===false||it.available===false?0:1;const selling=n(it.sellingPrice??it.selling_price??it.price);const cost=n(it.unitCost??it.unit_cost);
    await exec(`INSERT INTO outlet_product_stock(outlet_id,product_id,stock_qty,stock_quantity,min_stock_qty,low_stock_alert,prep_time_minutes,preparation_minutes,is_available,selling_price,unit_cost,updated_at) VALUES(:id,:pid,:qty,:qty,:low,:low,:prep,:prep,:available,:selling,:cost,NOW()) ON DUPLICATE KEY UPDATE stock_qty=VALUES(stock_qty),stock_quantity=VALUES(stock_quantity),min_stock_qty=VALUES(min_stock_qty),low_stock_alert=VALUES(low_stock_alert),prep_time_minutes=VALUES(prep_time_minutes),preparation_minutes=VALUES(preparation_minutes),is_available=VALUES(is_available),selling_price=VALUES(selling_price),unit_cost=VALUES(unit_cost),updated_at=NOW()`,{id,pid,qty,low,prep,available,selling,cost});
    await ex(`INSERT INTO outlet_stock_movements(outlet_id,product_id,movement_type,quantity,before_stock,after_stock,unit_cost,total_cost,note,created_by) VALUES(:id,:pid,'MANUAL_UPDATE',:delta,:before,:qty,:cost,:total,:note,:by)`,{id,pid,delta:qty-before,before,qty,cost,total:(qty-before)*cost,note:s(it.note)||'Stock updated',by:req.user?.username||req.user?.role||'admin'});updated.push({productId:pid,beforeStock:before,stockQuantity:qty});}
  ok(res,{outletId:id,updated},'Outlet inventory saved successfully');
}));

router.get(['/outlet-manager/dashboard','/seller/outlet/dashboard'],requireAuth,ah(async(req,res)=>{
  await ensureSchema(); const id=await outletId(req); if(!id) return fail(res,'No outlet assigned',404); const from=s(req.query.from)||today(),to=s(req.query.to)||today();
  const [outlet,stock,orders,closings]=await Promise.all([q1('SELECT * FROM outlets WHERE id=:id',{id}),stockRows(id),ordersFor(id,from,to),qa('SELECT * FROM outlet_daily_closings WHERE outlet_id=:id AND closing_date BETWEEN :from AND :to ORDER BY closing_date DESC',{id,from,to})]);
  ok(res,{outletId:id,outlet,stock,orders,closings,totalSales:orders.reduce((a,o)=>a+n(o.total),0),orderCount:orders.length,availableProducts:stock.filter(x=>bit(x.is_available)&&n(x.stockQuantity)>0).length,lowStock:stock.filter(x=>n(x.stockQuantity)<=n(x.lowStockAlert)).length},'Outlet manager dashboard loaded');
}));

router.post(['/outlet-manager/end-of-day','/outlet-manager/day-close','/outlet-manager/close-day'],requireAuth,ah(async(req,res)=>{
  await ensureSchema(); const id=await outletId(req); if(!id) return fail(res,'No outlet assigned',404); const d=req.body||{},date=s(d.date)||today();
  const items=Array.isArray(d.items)?d.items:[]; for(const it of items){const productId=n(it.productId||it.product_id); if(!productId) continue; const current=await q1('SELECT GREATEST(COALESCE(stock_qty,0),COALESCE(stock_quantity,0)) qty FROM outlet_product_stock WHERE outlet_id=:id AND product_id=:pid',{id,pid:productId}); const closing=Math.max(0,n(it.closingStock??it.stockQuantity??it.stock_quantity,current?.qty)); await exec(`UPDATE outlet_product_stock SET stock_qty=:closing,stock_quantity=:closing,updated_at=NOW() WHERE outlet_id=:id AND product_id=:pid`,{closing,id,pid:productId}); await exec(`INSERT INTO outlet_daily_closing_items(outlet_id,closing_date,product_id,opening_stock,closing_stock,offline_sold_qty,wastage_qty,note) VALUES(:id,:date,:pid,:opening,:closing,:offline,:wastage,:note) ON DUPLICATE KEY UPDATE opening_stock=VALUES(opening_stock),closing_stock=VALUES(closing_stock),offline_sold_qty=VALUES(offline_sold_qty),wastage_qty=VALUES(wastage_qty),note=VALUES(note)`,{id,date,pid:productId,opening:n(current?.qty),closing,offline:n(it.offlineSoldQty||it.offline_sold_qty),wastage:n(it.wastageQty||it.wastage_qty),note:s(it.note)}); }
  const orders=await ordersFor(id,date,date); const online=orders.filter(o=>String(o.payment_type).toUpperCase().includes('ONLINE')||String(o.payment_status).toUpperCase()==='PAID').reduce((a,o)=>a+n(o.total),0); const cod=orders.filter(o=>String(o.payment_type).toUpperCase().includes('COD')).reduce((a,o)=>a+n(o.total),0); const offline=n(d.offlineSales||d.offline_sales),expenses=n(d.expenses),total=online+cod+offline;
  await exec(`INSERT INTO outlet_daily_closings(outlet_id,closing_date,online_sales,offline_sales,cod_sales,total_sales,order_count,offline_order_count,cash_in_hand,expenses,net_cash,closing_note,closed_by) VALUES(:id,:date,:online,:offline,:cod,:total,:orderCount,:offlineOrders,:cash,:expenses,:net,:note,:closedBy) ON DUPLICATE KEY UPDATE online_sales=VALUES(online_sales),offline_sales=VALUES(offline_sales),cod_sales=VALUES(cod_sales),total_sales=VALUES(total_sales),order_count=VALUES(order_count),offline_order_count=VALUES(offline_order_count),cash_in_hand=VALUES(cash_in_hand),expenses=VALUES(expenses),net_cash=VALUES(net_cash),closing_note=VALUES(closing_note),closed_by=VALUES(closed_by),submitted_at=NOW()`,{id,date,online,offline,cod,total,orderCount:orders.length,offlineOrders:n(d.offlineOrderCount||d.offline_order_count),cash:cod+offline,expenses,net:cod+offline-expenses,note:s(d.note),closedBy:req.user.username||'outlet-manager'});
  await ex('UPDATE outlets SET is_open=0 WHERE id=:id',{id}); ok(res,{outletId:id,date,onlineSales:online,codSales:cod,offlineSales:offline,totalSales:total,stockItemsUpdated:items.length},'End-of-day closing submitted');
}));

router.get('/admin/outlets/:id/full-dashboard',ah(async(req,res)=>{
  await ensureSchema(); const id=n(req.params.id),from=s(req.query.from)||'1970-01-01',to=s(req.query.to)||'2999-12-31';
  const [outlet,stock,orders,closings,closingItems]=await Promise.all([q1('SELECT * FROM outlets WHERE id=:id',{id}),stockRows(id),ordersFor(id,from,to),qa('SELECT * FROM outlet_daily_closings WHERE outlet_id=:id AND closing_date BETWEEN :from AND :to ORDER BY closing_date DESC',{id,from,to}),qa(`SELECT ci.*,COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) productName FROM outlet_daily_closing_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.outlet_id=:id AND ci.closing_date BETWEEN :from AND :to ORDER BY ci.closing_date DESC,productName`,{id,from,to})]);
  const valid=orders.filter(o=>!['CANCELLED','REJECTED','REFUNDED'].includes(String(o.status).toUpperCase())); const totalSales=valid.reduce((a,o)=>a+n(o.total),0); const onlineSales=valid.filter(o=>String(o.payment_type).toUpperCase().includes('ONLINE')||String(o.payment_status).toUpperCase()==='PAID').reduce((a,o)=>a+n(o.total),0); const codSales=valid.filter(o=>String(o.payment_type).toUpperCase().includes('COD')).reduce((a,o)=>a+n(o.total),0);
  const counts={}; for(const o of orders) for(const i of o.items||[]) counts[i.productName]=(counts[i.productName]||0)+n(i.quantity); const ranked=Object.entries(counts).map(([productName,quantity])=>({productName,quantity})).sort((a,b)=>b.quantity-a.quantity);
  const offlineSales=closings.reduce((a,c)=>a+n(c.offline_sales),0); const stockItems=stock.length; const lowStock=stock.filter(x=>n(x.stockQuantity)<=n(x.lowStockAlert)).length; const availableProducts=stock.filter(x=>bit(x.is_available)&&n(x.stockQuantity)>0).length; const outOfStock=stock.filter(x=>n(x.stockQuantity)<=0).length; const stockValue=stock.reduce((a,x)=>a+n(x.stockQuantity)*n(x.unit_cost),0); const summary={totalSales,onlineSales,codSales,offlineSales,orders:orders.length,averageOrderValue:orders.length?totalSales/orders.length:0,stockItems,lowStock,availableProducts,outOfStock,stockValue,bookings:0,todaySales:totalSales,weekSales:totalSales,monthSales:totalSales,yearSales:totalSales}; const byDay={}; for(const o of valid){const day=String(o.created_at||'').slice(0,10);byDay[day]=(byDay[day]||0)+n(o.total);} const salesByDay=Object.entries(byDay).map(([date,totalSales])=>({date,totalSales})); ok(res,{outlet,summary,metrics:summary,stock,orders,orderHistory:orders,closings,closingCalendar:closings,salesByDay,closingItems,bestFoods:ranked.slice(0,10),slowFoods:ranked.slice().reverse().slice(0,10),stockMovements:await qa('SELECT * FROM outlet_stock_movements WHERE outlet_id=:id ORDER BY id DESC LIMIT 200',{id}),serviceRadiusKm:n(outlet?.service_radius_km||outlet?.serviceRadiusKm)},'Outlet business dashboard loaded');
}));

router.get('/admin/outlets/:id/available-products',ah(async(req,res)=>{await ensureSchema();const assigned=await stockRows(req.params.id);const all=await qa(`SELECT p.id productId,COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) productName,COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl,COALESCE(p.price,0) basePrice,COALESCE(c.name,'Uncategorized') categoryName,COALESCE(p.is_veg,1) isVeg FROM products p LEFT JOIN categories c ON c.id=COALESCE(p.category_id,p.food_category_id,p.menu_category_id) ORDER BY productName`);const ids=new Set(assigned.map(x=>n(x.productId)));ok(res,{assigned,all,unassigned:all.filter(x=>!ids.has(n(x.productId)))},'Outlet inventory loaded');}));
router.get('/outlets/:id/menu',ah(async(req,res)=>{await ensureSchema();const outlet=await q1('SELECT * FROM outlets WHERE id=:id',{id:req.params.id});if(!outlet)return fail(res,'Outlet not found',404);const stock=await stockRows(req.params.id);ok(res,{outlet,items:stock.filter(x=>bit(x.is_available)&&n(x.stockQuantity)>0),foods:stock.filter(x=>bit(x.is_available)&&n(x.stockQuantity)>0)},'Outlet menu loaded');}));

router.use(require('./singleBrandEnterpriseV59'));
module.exports=router;
