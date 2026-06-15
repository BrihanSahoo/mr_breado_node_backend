const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec, slugify } = require('../utils/db');

async function tryExec(sql, params={}) { try { return await exec(sql, params); } catch (e) { return null; } }
async function tryMany(sql, params={}) { try { return await many(sql, params); } catch (e) { return []; } }
async function tryOne(sql, params={}) { try { return await one(sql, params); } catch (e) { return null; } }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v,d=''){ return v === undefined || v === null ? d : String(v); }
function activeExpr(alias='') { const p=alias?`${alias}.`:''; return `COALESCE(${p}deleted,0)=0 AND COALESCE(${p}enabled,${p}active,1)=1`; }
function bit(v){ if (Buffer.isBuffer(v)) return v[0] === 1; if (v && Array.isArray(v.data)) return v.data[0] === 1; return !!v; }
function startOfPeriod(period){ const d=new Date(); if(period==='month') return new Date(d.getFullYear(),d.getMonth(),1); if(period==='year') return new Date(d.getFullYear(),0,1); if(period==='week'){ const day=d.getDay()||7; const x=new Date(d); x.setDate(d.getDate()-day+1); x.setHours(0,0,0,0); return x;} const x=new Date(); x.setHours(0,0,0,0); return x; }
function isoDate(d){ return new Date(d).toISOString().slice(0,10); }
function haversineKm(a,b,c,d){ const R=6371, toRad=x=>x*Math.PI/180; const dLat=toRad(c-a), dLng=toRad(d-b); const x=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }

async function ensureV49Schema(){
  await tryExec(`CREATE TABLE IF NOT EXISTS outlets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_code VARCHAR(80) UNIQUE,
    name VARCHAR(180) NOT NULL DEFAULT 'Mr Breado',
    slug VARCHAR(220),
    address TEXT, city VARCHAR(120), state VARCHAR(120), pincode VARCHAR(20),
    latitude DECIMAL(12,8) NULL, longitude DECIMAL(12,8) NULL,
    service_radius_km DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    phone VARCHAR(30), email VARCHAR(180), manager_name VARCHAR(180), manager_phone VARCHAR(30), manager_email VARCHAR(180),
    is_open TINYINT(1) NOT NULL DEFAULT 1, is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  const outletCols = ['phone VARCHAR(30)','email VARCHAR(180)','manager_name VARCHAR(180)','manager_phone VARCHAR(30)','manager_email VARCHAR(180)','service_radius_km DECIMAL(10,2) NOT NULL DEFAULT 5.00','latitude DECIMAL(12,8) NULL','longitude DECIMAL(12,8) NULL','pincode VARCHAR(20)','city VARCHAR(120)','state VARCHAR(120)','is_open TINYINT(1) NOT NULL DEFAULT 1','is_active TINYINT(1) NOT NULL DEFAULT 1'];
  for (const col of outletCols) await tryExec(`ALTER TABLE outlets ADD COLUMN ${col}`);

  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_product_stock (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    stock_qty INT NOT NULL DEFAULT 0,
    min_stock_qty INT NOT NULL DEFAULT 5,
    prep_time_minutes INT NOT NULL DEFAULT 20,
    is_available TINYINT(1) NOT NULL DEFAULT 1,
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY outlet_product_unique(outlet_id, product_id)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_stock_movements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL, product_id BIGINT NULL,
    movement_type ENUM('ADMIN_REFILL','OUTLET_UPDATE','ORDER_DEDUCT','WASTE','ADJUSTMENT') NOT NULL DEFAULT 'ADJUSTMENT',
    quantity INT NOT NULL DEFAULT 0,
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    note TEXT, created_by BIGINT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_daily_closings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    closing_date DATE NOT NULL,
    online_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    cod_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    offline_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
    expenses DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
    note TEXT, closed_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY outlet_day_unique(outlet_id, closing_date)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_service_zones (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    pincode VARCHAR(20) NOT NULL,
    area_name VARCHAR(180),
    delivery_charge DECIMAL(12,2) DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY outlet_pincode_unique(outlet_id,pincode)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS platform_delivery_settings (
    id TINYINT PRIMARY KEY DEFAULT 1,
    base_delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 25,
    delivery_charge_per_km DECIMAL(12,2) NOT NULL DEFAULT 8,
    free_delivery_after DECIMAL(12,2) NOT NULL DEFAULT 0,
    rider_base_pay DECIMAL(12,2) NOT NULL DEFAULT 25,
    rider_pay_per_km DECIMAL(12,2) NOT NULL DEFAULT 10,
    rider_monthly_settlement_day INT NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await tryExec(`INSERT IGNORE INTO platform_delivery_settings(id) VALUES(1)`);
  await tryExec(`CREATE TABLE IF NOT EXISTS rider_order_earnings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id BIGINT NOT NULL, order_id BIGINT NOT NULL, outlet_id BIGINT NULL,
    distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
    base_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    distance_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    incentive DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_earning DECIMAL(12,2) NOT NULL DEFAULT 0,
    order_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY rider_order_unique(rider_id,order_id)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS rider_monthly_settlements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id BIGINT NOT NULL,
    settlement_month VARCHAR(7) NOT NULL,
    total_cash DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_earning DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_due_from_rider DECIMAL(12,2) NOT NULL DEFAULT 0,
    status ENUM('PENDING','CONFIRMED','IGNORED') NOT NULL DEFAULT 'PENDING',
    confirmed_by BIGINT NULL, confirmed_at DATETIME NULL,
    note TEXT,
    UNIQUE KEY rider_month_unique(rider_id,settlement_month)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS coupon_rules (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(80) UNIQUE NOT NULL,
    title VARCHAR(180), description TEXT,
    coupon_type ENUM('FLAT','PERCENT','FREE_DELIVERY') NOT NULL DEFAULT 'FLAT',
    discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
    min_order_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    max_discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    start_date DATE NULL, end_date DATE NULL,
    usage_limit INT DEFAULT NULL, per_user_limit INT DEFAULT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS app_uploaded_assets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    module VARCHAR(80) NOT NULL,
    file_name VARCHAR(220), mime_type VARCHAR(120), data_url LONGTEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
async function ensureSeedOutlets(){
  await ensureV49Schema();
  const count = (await tryOne(`SELECT COUNT(*) c FROM outlets`))?.c || 0;
  if (count > 0) return;
  const restaurants = await tryMany(`SELECT id,name,address,city,state,pincode,latitude,longitude,open AS is_open FROM restaurants WHERE LOWER(COALESCE(name,'')) LIKE '%breado%' LIMIT 20`);
  for (const r of restaurants) {
    await tryExec(`INSERT IGNORE INTO outlets(outlet_code,name,slug,address,city,state,pincode,latitude,longitude,is_open,is_active,service_radius_km) VALUES(:code,:name,:slug,:address,:city,:state,:pincode,:lat,:lng,:open,1,5)`, {
      code:`MRB-${r.id}`, name:r.name||'Mr Breado', slug:slugify(`${r.name||'mr-breado'}-${r.id}`), address:r.address||'', city:r.city||'', state:r.state||'', pincode:r.pincode||'', lat:r.latitude||null, lng:r.longitude||null, open: bit(r.is_open)?1:1
    });
  }
}
async function outletRows(){ await ensureSeedOutlets(); return await tryMany(`SELECT * FROM outlets WHERE COALESCE(is_active,1)=1 ORDER BY id DESC`); }
function mapOutlet(o, userLat=null, userLng=null){
  const lat=o.latitude===null?null:Number(o.latitude), lng=o.longitude===null?null:Number(o.longitude);
  const dist = (userLat!==null && userLng!==null && lat!==null && lng!==null) ? Number(haversineKm(Number(userLat),Number(userLng),lat,lng).toFixed(2)) : null;
  const radius = n(o.service_radius_km,5);
  return { id:o.id, outletId:o.id, name:o.name || 'Mr Breado', outletName:o.name || 'Mr Breado', code:o.outlet_code, slug:o.slug, address:o.address || '', city:o.city||'', state:o.state||'', pincode:o.pincode||'', latitude:lat, longitude:lng, serviceRadiusKm:radius, distanceKm:dist, isServiceable:dist===null?true:dist<=radius, isOpen:!!n(o.is_open,1), phone:o.phone||o.manager_phone||'', email:o.email||o.manager_email||'', managerName:o.manager_name||'', managerPhone:o.manager_phone||'', managerEmail:o.manager_email||'' };
}

router.get('/single-brand/v49/version',(req,res)=>ok(res,{version:'single-brand-enterprise-v49',model:'Mr Breado outlet ERP',razorpay:'v22/v26 untouched'}));
router.post(['/admin/outlets/ensure-enterprise-v49-schema','/admin/outlets/ensure-enterprise-schema','/admin/outlets/ensure-schema'],ah(async(req,res)=>{ await ensureV49Schema(); await ensureSeedOutlets(); ok(res,{ready:true,version:'v49'},'Enterprise schema ready'); }));

router.get(['/outlets','/user/outlets','/admin/outlets'],ah(async(req,res)=>{ const rows=await outletRows(); ok(res,rows.map(o=>mapOutlet(o)), 'Outlets fetched'); }));
router.post('/admin/outlets', ah(async(req,res)=>{ await ensureV49Schema(); const b=req.body||{}; const name=s(b.name||b.outletName,'Mr Breado'); const result=await exec(`INSERT INTO outlets(outlet_code,name,slug,address,city,state,pincode,latitude,longitude,service_radius_km,phone,email,manager_name,manager_phone,manager_email,is_open,is_active) VALUES(:code,:name,:slug,:address,:city,:state,:pincode,:lat,:lng,:radius,:phone,:email,:mn,:mp,:me,1,1)`, { code:b.code||b.outletCode||`MRB-${Date.now()}`, name, slug:slugify(b.slug||name+'-'+Date.now()), address:b.address||'', city:b.city||'', state:b.state||'', pincode:b.pincode||'', lat:b.latitude||null, lng:b.longitude||null, radius:b.serviceRadiusKm||b.service_radius_km||5, phone:b.phone||'', email:b.email||'', mn:b.managerName||'', mp:b.managerPhone||'', me:b.managerEmail||'' }); ok(res,{id:result.insertId},'Outlet created',201); }));
router.put('/admin/outlets/:id/location', ah(async(req,res)=>{ await ensureV49Schema(); const b=req.body||{}; await exec(`UPDATE outlets SET latitude=:lat, longitude=:lng, service_radius_km=:radius, pincode=COALESCE(:pincode,pincode), address=COALESCE(:address,address), city=COALESCE(:city,city), state=COALESCE(:state,state) WHERE id=:id`,{id:req.params.id,lat:b.latitude,lng:b.longitude,radius:b.serviceRadiusKm||b.service_radius_km||5,pincode:b.pincode||null,address:b.address||null,city:b.city||null,state:b.state||null}); ok(res,{id:req.params.id},'Outlet location updated'); }));
router.get('/outlets/nearest', ah(async(req,res)=>{ const lat=req.query.lat??req.query.latitude, lng=req.query.lng??req.query.longitude, pincode=req.query.pincode; const rows=await outletRows(); let mapped=rows.map(o=>mapOutlet(o, lat??null, lng??null)); if(pincode){ const zone=await tryOne(`SELECT outlet_id FROM outlet_service_zones WHERE pincode=:p AND is_active=1 LIMIT 1`,{p:pincode}); if(zone){ const found=mapped.find(x=>String(x.id)===String(zone.outlet_id)); if(found) return ok(res,found,'Nearest outlet by pincode'); } const pinMatched=mapped.filter(x=>String(x.pincode||'')===String(pincode)); if(pinMatched.length) return ok(res,pinMatched[0],'Nearest outlet by pincode'); }
  mapped=mapped.filter(x=>x.isOpen).sort((a,b)=>(a.distanceKm??999999)-(b.distanceKm??999999)); ok(res,mapped[0]||null, mapped[0]?'Nearest outlet fetched':'No outlet found'); }));

async function outletMenu(outletId){ await ensureV49Schema(); const rows=await tryMany(`SELECT p.id, COALESCE(NULLIF(p.name,''),p.title) name, p.title, p.slug, p.description, COALESCE(p.image_url,p.image) imageUrl, p.price, p.discount_price, p.category_id, p.food_category_id, fc.title categoryName, COALESCE(s.stock_qty,p.stock,p.stock_quantity,0) stock, COALESCE(s.prep_time_minutes,p.prep_time,20) prepTimeMinutes, COALESCE(s.is_available,p.available,1) available FROM products p LEFT JOIN food_categories fc ON fc.id=COALESCE(p.food_category_id,p.category_id) LEFT JOIN outlet_product_stock s ON s.product_id=p.id AND s.outlet_id=:outletId WHERE COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 AND COALESCE(s.is_available,1)=1 ORDER BY fc.sort_order,p.id`,{outletId}); return rows.map(x=>({...x,stock:Number(x.stock||0),isAvailable:Number(x.stock||0)>0 || Number(x.available||1)===1})); }
router.get(['/outlets/:id/menu','/user/outlets/:id/menu'],ah(async(req,res)=>{ ok(res,{outlet:mapOutlet(await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id:req.params.id})||{}), products:await outletMenu(req.params.id)},'Outlet menu fetched'); }));
router.get('/menu/nearest', ah(async(req,res)=>{ const rows=await outletRows(); const mapped=rows.map(o=>mapOutlet(o, req.query.lat??null, req.query.lng??null)).filter(x=>x.isOpen).sort((a,b)=>(a.distanceKm??999999)-(b.distanceKm??999999)); const outlet=mapped[0]; ok(res,{outlet,products:outlet?await outletMenu(outlet.id):[]},'Nearest menu fetched'); }));
router.get('/outlets/:id/contact',ah(async(req,res)=>{ const row=await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id:req.params.id}); ok(res,mapOutlet(row||{}),'Outlet contact fetched'); }));

router.get('/admin/outlets/:id/full-dashboard',ah(async(req,res)=>{ await ensureV49Schema(); const id=req.params.id; const outlet=mapOutlet(await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id})||{}); const sales = await tryOne(`SELECT COALESCE(SUM(online_sales+cod_sales+offline_sales),0) totalSales, COALESCE(SUM(online_sales),0) onlineSales, COALESCE(SUM(cod_sales),0) codSales, COALESCE(SUM(offline_sales),0) offlineSales, COALESCE(SUM(expenses),0) expenses FROM outlet_daily_closings WHERE outlet_id=:id`,{id}) || {}; const today=await tryOne(`SELECT * FROM outlet_daily_closings WHERE outlet_id=:id AND closing_date=CURDATE()`,{id})||{}; const stock=await tryMany(`SELECT s.*, COALESCE(NULLIF(p.name,''),p.title) productName, COALESCE(p.image_url,p.image) imageUrl, p.price FROM outlet_product_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.outlet_id=:id ORDER BY s.stock_qty ASC LIMIT 200`,{id}); const movements=await tryMany(`SELECT m.*, COALESCE(NULLIF(p.name,''),p.title) productName FROM outlet_stock_movements m LEFT JOIN products p ON p.id=m.product_id WHERE m.outlet_id=:id ORDER BY m.created_at DESC LIMIT 100`,{id}); const best=await tryMany(`SELECT oi.product_id, COALESCE(NULLIF(p.name,''),p.title) productName, SUM(oi.quantity) qty, SUM(oi.total_price) sales FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN orders o ON o.id=oi.order_id WHERE COALESCE(o.restaurant_id,o.outlet_id)=:id GROUP BY oi.product_id,productName ORDER BY qty DESC LIMIT 10`,{id}); const slow=[...stock].sort((a,b)=>Number(a.stock_qty)-Number(b.stock_qty)).slice(0,10); ok(res,{outlet, summary:{...sales,todaySales:n(today.online_sales)+n(today.cod_sales)+n(today.offline_sales), lowStockCount:stock.filter(x=>n(x.stock_qty)<=n(x.min_stock_qty,5)).length, availableProductCount:stock.filter(x=>n(x.is_available,1)===1).length, stockValue:stock.reduce((sum,x)=>sum+n(x.stock_qty)*n(x.unit_cost||x.price),0)}, stock, movements, bestSelling:best, slowSelling:slow, dailyClosing:today},'Outlet dashboard fetched'); }));

router.get(['/categories','/user/categories','/admin/categories'],ah(async(req,res)=>{ await ensureV49Schema(); const rows=await tryMany(`SELECT id, COALESCE(NULLIF(name,''),title) name, title, slug, COALESCE(image_url,image,icon) image, COALESCE(image_url,image,icon) imageUrl, COALESCE(enabled,active,1) enabled, CASE WHEN COALESCE(enabled,active,1)=1 THEN 'ACTIVE' ELSE 'INACTIVE' END status FROM food_categories WHERE COALESCE(deleted,0)=0 ORDER BY sort_order,id`); ok(res,rows,'Categories fetched'); }));
router.post('/admin/categories',ah(async(req,res)=>{ const b=req.body||{}; const name=s(b.name||b.title).trim(); const slug=slugify(b.slug||name); const image=b.image||b.imageUrl||b.icon||b.dataUrl||''; const result=await exec(`INSERT INTO food_categories(name,title,slug,image,image_url,icon,enabled,active,show_on_home) VALUES(:name,:name,:slug,:image,:image,:image,:enabled,:enabled,1)`,{name,slug,image,enabled:b.status==='INACTIVE'?0:1}); ok(res,{id:result.insertId,name,slug,image},'Category created',201); }));
router.put('/admin/categories/:id',ah(async(req,res)=>{ const b=req.body||{}; const name=s(b.name||b.title).trim(); const slug=slugify(b.slug||name); const image=b.image||b.imageUrl||b.icon||b.dataUrl||''; await exec(`UPDATE food_categories SET name=:name,title=:name,slug=:slug,image=:image,image_url=:image,icon=:image,enabled=:enabled,active=:enabled WHERE id=:id`,{id:req.params.id,name,slug,image,enabled:b.status==='INACTIVE'?0:1}); ok(res,{id:req.params.id,name,slug,image},'Category updated'); }));
router.patch('/admin/categories/:id/status',ah(async(req,res)=>{ const enabled=(req.body?.status==='INACTIVE'||req.body?.enabled===false||req.body?.active===false)?0:1; await exec(`UPDATE food_categories SET enabled=:enabled, active=:enabled WHERE id=:id`,{id:req.params.id,enabled}); ok(res,{id:req.params.id,enabled},'Category status updated'); }));

router.get('/admin/delivery-settings',ah(async(req,res)=>{ await ensureV49Schema(); ok(res,await tryOne(`SELECT * FROM platform_delivery_settings WHERE id=1`)||{},'Delivery settings fetched'); }));
router.put('/admin/delivery-settings',ah(async(req,res)=>{ await ensureV49Schema(); const b=req.body||{}; await exec(`UPDATE platform_delivery_settings SET base_delivery_charge=:base, delivery_charge_per_km=:dpk, free_delivery_after=:free, rider_base_pay=:rb, rider_pay_per_km=:rpk, rider_monthly_settlement_day=:day WHERE id=1`,{base:b.baseDeliveryCharge??b.base_delivery_charge??25,dpk:b.deliveryChargePerKm??b.delivery_charge_per_km??8,free:b.freeDeliveryAfter??b.free_delivery_after??0,rb:b.riderBasePay??b.rider_base_pay??25,rpk:b.riderPayPerKm??b.rider_pay_per_km??10,day:b.riderMonthlySettlementDay??b.rider_monthly_settlement_day??1}); ok(res,await tryOne(`SELECT * FROM platform_delivery_settings WHERE id=1`),'Delivery settings saved'); }));

router.get('/admin/riders/details',ah(async(req,res)=>{ await ensureV49Schema(); const rows=await tryMany(`SELECT u.id riderId, u.name, u.email, u.phone, d.vehicle_number vehicleNumber, d.license_number licenseNumber, d.aadhaar_number aadhaarNumber, d.current_cash_in_hand cashInHand, COUNT(e.order_id) deliveredOrders, COALESCE(SUM(e.distance_km),0) distanceKm, COALESCE(SUM(e.total_earning),0) earnedMoney, COALESCE(SUM(e.cash_collected),0) cashCollected FROM users u LEFT JOIN delivery_partner_profiles d ON d.user_id=u.id LEFT JOIN rider_order_earnings e ON e.rider_id=u.id WHERE u.role IN ('DELIVERY_PARTNER','RIDER') AND COALESCE(u.deleted,0)=0 GROUP BY u.id,u.name,u.email,u.phone,d.vehicle_number,d.license_number,d.aadhaar_number,d.current_cash_in_hand ORDER BY u.id DESC`); ok(res,rows,'Riders fetched'); }));
router.delete('/admin/riders/:id',ah(async(req,res)=>{ await tryExec(`UPDATE users SET deleted=1 WHERE id=:id`,{id:req.params.id}); await tryExec(`DELETE FROM outlet_delivery_boys WHERE user_id=:id OR rider_id=:id`,{id:req.params.id}); ok(res,{id:req.params.id},'Rider deleted'); }));
router.post('/admin/riders/:id/monthly-settlement',ah(async(req,res)=>{ await ensureV49Schema(); const month=req.body?.month||new Date().toISOString().slice(0,7); const stats=await tryOne(`SELECT COALESCE(SUM(cash_collected),0) cash, COALESCE(SUM(total_earning),0) earning FROM rider_order_earnings WHERE rider_id=:id AND DATE_FORMAT(order_date,'%Y-%m')=:month`,{id:req.params.id,month})||{}; const due=n(stats.cash)-n(stats.earning); await exec(`INSERT INTO rider_monthly_settlements(rider_id,settlement_month,total_cash,total_earning,net_due_from_rider,status,confirmed_at,note) VALUES(:id,:month,:cash,:earning,:due,'CONFIRMED',NOW(),:note) ON DUPLICATE KEY UPDATE total_cash=:cash,total_earning=:earning,net_due_from_rider=:due,status='CONFIRMED',confirmed_at=NOW(),note=:note`,{id:req.params.id,month,cash:n(stats.cash),earning:n(stats.earning),due,note:req.body?.note||''}); await tryExec(`UPDATE delivery_partner_profiles SET current_cash_in_hand=0 WHERE user_id=:id`,{id:req.params.id}); ok(res,{riderId:req.params.id,month,totalCash:n(stats.cash),totalEarning:n(stats.earning),netDueFromRider:due,status:'CONFIRMED'},'Monthly rider settlement confirmed'); }));
router.get('/admin/customers/analytics',ah(async(req,res)=>{ const rows=await tryMany(`SELECT u.id,u.name,u.email,u.phone,COUNT(o.id) totalOrders,COALESCE(SUM(o.total_amount),0) totalSpent,MAX(o.created_at) lastOrderAt FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role IN ('CUSTOMER','USER') AND COALESCE(u.deleted,0)=0 GROUP BY u.id,u.name,u.email,u.phone ORDER BY totalSpent DESC,totalOrders DESC LIMIT 200`); ok(res,rows,'Customers analytics fetched'); }));

router.get(['/admin/coupons','/coupons'],ah(async(req,res)=>{ await ensureV49Schema(); await tryExec(`UPDATE coupon_rules SET is_active=0 WHERE end_date IS NOT NULL AND end_date<CURDATE()`); ok(res,await tryMany(`SELECT *, CASE WHEN coupon_type='FREE_DELIVERY' THEN 1 ELSE 0 END freeDelivery FROM coupon_rules ORDER BY id DESC`),'Coupons fetched'); }));
router.post('/admin/coupons',ah(async(req,res)=>{ await ensureV49Schema(); const b=req.body||{}; await exec(`INSERT INTO coupon_rules(code,title,description,coupon_type,discount_value,min_order_amount,max_discount,start_date,end_date,usage_limit,per_user_limit,is_active) VALUES(:code,:title,:description,:type,:value,:min,:max,:start,:end,:usage,:per,:active)`,{code:s(b.code).toUpperCase(),title:b.title||'',description:b.description||'',type:b.type||b.couponType||'FLAT',value:b.discountValue||b.discount_value||0,min:b.minOrderAmount||b.min_order_amount||0,max:b.maxDiscount||b.max_discount||0,start:b.startDate||b.start_date||null,end:b.endDate||b.end_date||null,usage:b.usageLimit||null,per:b.perUserLimit||null,active:b.isActive===false?0:1}); ok(res,{code:s(b.code).toUpperCase()},'Coupon created',201); }));
router.post(['/coupons/validate','/checkout/coupons/validate'],ah(async(req,res)=>{ await ensureV49Schema(); const code=s(req.body?.code).toUpperCase(); const amount=n(req.body?.amount||req.body?.cartTotal); const coupon=await tryOne(`SELECT * FROM coupon_rules WHERE code=:code AND is_active=1 AND (start_date IS NULL OR start_date<=CURDATE()) AND (end_date IS NULL OR end_date>=CURDATE())`,{code}); if(!coupon) return res.status(400).json({success:false,message:'Coupon is invalid or expired'}); if(amount<n(coupon.min_order_amount)) return res.status(400).json({success:false,message:`Minimum order amount ₹${coupon.min_order_amount} required`}); let discount=0, freeDelivery=false; if(coupon.coupon_type==='FREE_DELIVERY'){ freeDelivery=true; } else if(coupon.coupon_type==='PERCENT'){ discount=amount*n(coupon.discount_value)/100; if(n(coupon.max_discount)>0) discount=Math.min(discount,n(coupon.max_discount)); } else discount=n(coupon.discount_value); ok(res,{coupon,discount:Number(discount.toFixed(2)),freeDelivery,deliveryFee:freeDelivery?0:null},'Coupon applied'); }));

module.exports = router;
