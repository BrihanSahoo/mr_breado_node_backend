const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');

async function tryExec(sql, params={}) { try { return await exec(sql, params); } catch (e) { return null; } }
async function tryMany(sql, params={}) { try { return await many(sql, params); } catch (e) { return []; } }
async function tryOne(sql, params={}) { try { return await one(sql, params); } catch (e) { return null; } }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function s(v,d=''){ return v===undefined||v===null ? d : String(v); }
function bool(v,d=true){ if(v===undefined||v===null||v==='') return d; if(Buffer.isBuffer(v)) return v[0]===1; if(typeof v==='boolean') return v; if(typeof v==='number') return v!==0; return !['0','false','no','inactive','disabled'].includes(String(v).toLowerCase()); }
function today(){ return new Date().toISOString().slice(0,10); }
function monthKey(date=new Date()){ return date.toISOString().slice(0,7); }
function haversineKm(lat1,lng1,lat2,lng2){ const R=6371, toRad=x=>Number(x)*Math.PI/180; const dLat=toRad(lat2)-toRad(lat1), dLng=toRad(lng2)-toRad(lng1); const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(a)); }

async function ensureV52Schema(){
  await tryExec(`CREATE TABLE IF NOT EXISTS platform_business_settings (
    id TINYINT PRIMARY KEY DEFAULT 1,
    google_maps_api_key TEXT NULL,
    distance_provider ENUM('GOOGLE','HAVERSINE') NOT NULL DEFAULT 'HAVERSINE',
    base_delivery_charge DECIMAL(12,2) NOT NULL DEFAULT 20,
    delivery_charge_per_km DECIMAL(12,2) NOT NULL DEFAULT 8,
    rider_base_pay DECIMAL(12,2) NOT NULL DEFAULT 25,
    rider_pay_per_km DECIMAL(12,2) NOT NULL DEFAULT 7,
    monthly_settlement_day INT NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await tryExec(`INSERT IGNORE INTO platform_business_settings(id) VALUES(1)`);
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_service_zones (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    pincode VARCHAR(20), area_name VARCHAR(180), city VARCHAR(120),
    radius_km DECIMAL(10,2) NOT NULL DEFAULT 5,
    delivery_charge_per_km DECIMAL(12,2) NULL,
    rider_pay_per_km DECIMAL(12,2) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS rider_order_earnings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    outlet_id BIGINT NULL,
    distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
    base_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_km_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
    incentive DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_earning DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    delivered_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY rider_order_unique(rider_id,order_id)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS rider_monthly_settlements (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    rider_id BIGINT NOT NULL,
    settlement_month VARCHAR(7) NOT NULL,
    total_orders INT NOT NULL DEFAULT 0,
    total_distance_km DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_earning DECIMAL(12,2) NOT NULL DEFAULT 0,
    cash_collected DECIMAL(12,2) NOT NULL DEFAULT 0,
    net_payable DECIMAL(12,2) NOT NULL DEFAULT 0,
    status ENUM('PENDING','PAID','HELD') NOT NULL DEFAULT 'PENDING',
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid_at DATETIME NULL,
    admin_note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY rider_month_unique(rider_id,settlement_month)
  )`);
  await tryExec(`CREATE TABLE IF NOT EXISTS outlet_bookings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    outlet_id BIGINT NOT NULL,
    user_id BIGINT NULL,
    customer_name VARCHAR(180), phone VARCHAR(30), email VARCHAR(180),
    booking_type VARCHAR(80) DEFAULT 'GENERAL', booking_date DATE NULL, booking_time VARCHAR(30),
    message TEXT, status VARCHAR(40) NOT NULL DEFAULT 'PENDING', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // Add business columns safely when outlets already exists.
  for (const col of [
    'rating DECIMAL(3,2) NOT NULL DEFAULT 4.8','total_reviews INT NOT NULL DEFAULT 0','banner_image LONGTEXT NULL','profile_image LONGTEXT NULL','logo_image LONGTEXT NULL','phone VARCHAR(30)','email VARCHAR(180)','latitude DECIMAL(12,8) NULL','longitude DECIMAL(12,8) NULL','service_radius_km DECIMAL(10,2) NOT NULL DEFAULT 5.00','pincode VARCHAR(20)'
  ]) await tryExec(`ALTER TABLE outlets ADD COLUMN ${col}`);
}
async function settings(){ await ensureV52Schema(); return await tryOne(`SELECT * FROM platform_business_settings WHERE id=1`) || {}; }
function mapSettings(row){ return { googleMapsApiKey:s(row.google_maps_api_key), distanceProvider:s(row.distance_provider,'HAVERSINE'), baseDeliveryCharge:n(row.base_delivery_charge,20), deliveryChargePerKm:n(row.delivery_charge_per_km,8), riderBasePay:n(row.rider_base_pay,25), riderPayPerKm:n(row.rider_pay_per_km,7), monthlySettlementDay:n(row.monthly_settlement_day,1) }; }
async function googleDistanceKm(apiKey, originLat, originLng, destLat, destLng){
  if(!apiKey || !global.fetch) return null;
  try{
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url); const j = await r.json();
    const meters = j?.rows?.[0]?.elements?.[0]?.distance?.value;
    if(Number.isFinite(Number(meters))) return Number((Number(meters)/1000).toFixed(2));
  }catch(e){}
  return null;
}
async function distanceKm(userLat,userLng,outlet, cfg){
  const lat=n(outlet.latitude,null), lng=n(outlet.longitude,null); if(userLat==null||userLng==null||lat==null||lng==null) return null;
  let d = null;
  if(cfg.distanceProvider==='GOOGLE') d = await googleDistanceKm(cfg.googleMapsApiKey,userLat,userLng,lat,lng);
  if(d==null) d = Number(haversineKm(userLat,userLng,lat,lng).toFixed(2));
  return d;
}
function mapOutlet(o, d=null){ const radius=n(o.service_radius_km,5); return { id:o.id, outletId:o.id, outletCode:o.outlet_code||String(o.id), name:o.name||'Mr Breado', outletName:o.name||'Mr Breado', address:o.address||'', city:o.city||'', state:o.state||'', pincode:o.pincode||'', latitude:o.latitude==null?null:Number(o.latitude), longitude:o.longitude==null?null:Number(o.longitude), serviceRadiusKm:radius, distanceKm:d, isServiceable:d==null?true:d<=radius, isOpen:bool(o.is_open,true), isActive:bool(o.is_active,true), rating:n(o.rating,4.8), totalReviews:n(o.total_reviews,0), phone:o.phone||o.manager_phone||'', email:o.email||o.manager_email||'', bannerImage:o.banner_image||'', profileImage:o.profile_image||o.logo_image||'', logoImage:o.logo_image||o.profile_image||'', managerName:o.manager_name||'', managerPhone:o.manager_phone||'' }; }
async function activeOutlets(){ return await tryMany(`SELECT * FROM outlets WHERE COALESCE(is_active,1)=1 ORDER BY id DESC`); }
async function outletMenu(outletId){ return (await tryMany(`SELECT s.outlet_id outletId, s.product_id productId, s.stock_qty stockQuantity, s.min_stock_qty lowStockAlert, s.prep_time_minutes preparationMinutes, s.is_available isAvailable, COALESCE(NULLIF(s.selling_price,0),p.price,p.discounted_price,0) price, COALESCE(NULLIF(p.name,''),p.title,p.product_name,CONCAT('Food #',p.id)) name, COALESCE(p.image_url,p.image,p.photo_url) imageUrl, p.description, p.slug FROM outlet_product_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.outlet_id=:outletId AND COALESCE(s.is_available,1)=1 AND COALESCE(s.stock_qty,0)>0 ORDER BY name`,{outletId})); }

router.get('/single-brand/v52/version',(req,res)=>ok(res,{version:'single-brand-enterprise-v52',focus:'nearest-outlet-rider-payout-business-dashboard',razorpay:'v22/v26 locked unchanged'},'v52 active'));
router.post('/admin/outlets/ensure-enterprise-v52-schema',ah(async(req,res)=>{ await ensureV52Schema(); ok(res,{ready:true},'v52 enterprise schema ready'); }));
router.get('/admin/business/settings',ah(async(req,res)=>ok(res,mapSettings(await settings()),'Business settings fetched')));
router.put('/admin/business/settings',ah(async(req,res)=>{ await ensureV52Schema(); const b=req.body||{}; await exec(`UPDATE platform_business_settings SET google_maps_api_key=:key,distance_provider=:provider,base_delivery_charge=:base,delivery_charge_per_km=:deliveryKm,rider_base_pay=:riderBase,rider_pay_per_km=:riderKm,monthly_settlement_day=:day WHERE id=1`,{key:b.googleMapsApiKey??b.google_maps_api_key??'',provider:b.distanceProvider||b.distance_provider||'HAVERSINE',base:n(b.baseDeliveryCharge??b.base_delivery_charge,20),deliveryKm:n(b.deliveryChargePerKm??b.delivery_charge_per_km,8),riderBase:n(b.riderBasePay??b.rider_base_pay,25),riderKm:n(b.riderPayPerKm??b.rider_pay_per_km,7),day:n(b.monthlySettlementDay??b.monthly_settlement_day,1)}); ok(res,mapSettings(await settings()),'Business settings saved'); }));
router.get(['/outlets','/user/outlets'],ah(async(req,res)=>{ const cfg=mapSettings(await settings()); const lat=req.query.lat?Number(req.query.lat):null, lng=req.query.lng?Number(req.query.lng):null; const pin=s(req.query.pincode); let rows=await activeOutlets(); if(pin) rows=rows.filter(o=>s(o.pincode).trim()===pin.trim() || !s(o.pincode)); const mapped=[]; for(const o of rows) mapped.push(mapOutlet(o, await distanceKm(lat,lng,o,cfg))); mapped.sort((a,b)=>(a.distanceKm??99999)-(b.distanceKm??99999)); ok(res,{items:mapped,outlets:mapped,total:mapped.length},'Mr Breado outlets fetched'); }));
router.get(['/outlets/nearest','/user/outlets/nearest'],ah(async(req,res)=>{ const cfg=mapSettings(await settings()); const lat=req.query.lat?Number(req.query.lat):null, lng=req.query.lng?Number(req.query.lng):null, pin=s(req.query.pincode); let rows=await activeOutlets(); const mapped=[]; for(const o of rows){ let d=await distanceKm(lat,lng,o,cfg); if(d==null && pin && s(o.pincode).trim()===pin.trim()) d=0; mapped.push(mapOutlet(o,d)); } mapped.sort((a,b)=> (b.isServiceable?1:0)-(a.isServiceable?1:0) || (a.distanceKm??99999)-(b.distanceKm??99999)); const outlet=mapped[0]||null; ok(res,{outlet,items:mapped,settings:cfg}, outlet?'Nearest outlet fetched':'No outlet found'); }));
router.get(['/outlets/:id/menu','/user/outlets/:id/menu'],ah(async(req,res)=>{ const outlet=mapOutlet(await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id:req.params.id})||{}); const items=await outletMenu(req.params.id); ok(res,{outlet,items,foods:items,products:items,total:items.length},'Outlet available foods fetched'); }));
router.get('/menu/nearest',ah(async(req,res)=>{ const cfg=mapSettings(await settings()); const lat=req.query.lat?Number(req.query.lat):null, lng=req.query.lng?Number(req.query.lng):null; const rows=await activeOutlets(); const mapped=[]; for(const o of rows) mapped.push(mapOutlet(o, await distanceKm(lat,lng,o,cfg))); mapped.sort((a,b)=>(b.isServiceable?1:0)-(a.isServiceable?1:0)||(a.distanceKm??99999)-(b.distanceKm??99999)); const outlet=mapped[0]; const items=outlet?await outletMenu(outlet.id):[]; ok(res,{outlet,items,foods:items,products:items,settings:cfg},'Nearest outlet menu fetched'); }));
router.post('/outlets/:id/bookings',ah(async(req,res)=>{ await ensureV52Schema(); const b=req.body||{}; const r=await exec(`INSERT INTO outlet_bookings(outlet_id,user_id,customer_name,phone,email,booking_type,booking_date,booking_time,message,status) VALUES(:outletId,:userId,:name,:phone,:email,:type,:date,:time,:message,'PENDING')`,{outletId:req.params.id,userId:b.userId||b.user_id||null,name:b.name||b.customerName||'',phone:b.phone||'',email:b.email||'',type:b.bookingType||b.type||'GENERAL',date:b.bookingDate||b.date||null,time:b.bookingTime||b.time||'',message:b.message||b.query||''}); ok(res,{id:r.insertId},'Booking request submitted',201); }));

async function riderRows(){ return await tryMany(`SELECT u.id,u.name,u.full_name,u.phone,u.mobile,u.email, dpp.vehicle_number,dpp.license_number,dpp.driving_license_number,dpp.cash_in_hand,dpp.verification_status FROM users u LEFT JOIN delivery_partner_profiles dpp ON dpp.user_id=u.id WHERE UPPER(COALESCE(u.role,'')) IN ('RIDER','DELIVERY_PARTNER') OR dpp.id IS NOT NULL ORDER BY u.id DESC`); }
router.get('/admin/riders/details',ah(async(req,res)=>{ await ensureV52Schema(); const rows=await riderRows(); const items=[]; for(const r of rows){ const sums=await tryOne(`SELECT COUNT(*) deliveredOrders, COALESCE(SUM(distance_km),0) totalDistanceKm, COALESCE(SUM(total_earning),0) totalEarning, COALESCE(SUM(cash_collected),0) cashCollected FROM rider_order_earnings WHERE rider_id=:id`,{id:r.id})||{}; items.push({id:r.id,riderId:r.id,name:r.name||r.full_name||`Rider #${r.id}`,phone:r.phone||r.mobile||'',email:r.email||'',vehicleNumber:r.vehicle_number||'',licenseNumber:r.license_number||r.driving_license_number||'',cashInHand:n(r.cash_in_hand),verificationStatus:r.verification_status||'PENDING',...sums}); } ok(res,{items,total:items.length},'Rider business details fetched'); }));
router.get('/admin/riders/:id/dashboard',ah(async(req,res)=>{ await ensureV52Schema(); const rider=(await riderRows()).find(x=>String(x.id)===String(req.params.id))||{}; const history=await tryMany(`SELECT e.*, o.order_number orderNumber, o.status orderStatus, o.created_at orderDate FROM rider_order_earnings e LEFT JOIN orders o ON o.id=e.order_id WHERE e.rider_id=:id ORDER BY COALESCE(e.delivered_at,e.created_at) DESC LIMIT 500`,{id:req.params.id}); const settlement=await tryMany(`SELECT * FROM rider_monthly_settlements WHERE rider_id=:id ORDER BY settlement_month DESC LIMIT 24`,{id:req.params.id}); const summary=history.reduce((a,x)=>{a.orders+=1;a.distanceKm+=n(x.distance_km);a.earning+=n(x.total_earning);a.cashCollected+=n(x.cash_collected);return a;},{orders:0,distanceKm:0,earning:0,cashCollected:0}); ok(res,{rider:{id:rider.id,name:rider.name||rider.full_name,phone:rider.phone||rider.mobile,email:rider.email,vehicleNumber:rider.vehicle_number,licenseNumber:rider.license_number||rider.driving_license_number},summary,history,settlements:settlement},'Rider dashboard fetched'); }));
router.post('/admin/riders/:id/settlements/:month/pay',ah(async(req,res)=>{ await ensureV52Schema(); const id=req.params.id, month=req.params.month; const sums=await tryOne(`SELECT COUNT(*) totalOrders,COALESCE(SUM(distance_km),0) totalDistanceKm,COALESCE(SUM(total_earning),0) totalEarning,COALESCE(SUM(cash_collected),0) cashCollected FROM rider_order_earnings WHERE rider_id=:id AND DATE_FORMAT(COALESCE(delivered_at,created_at),'%Y-%m')=:month`,{id,month})||{}; const payable=n(sums.totalEarning)-n(sums.cashCollected); await exec(`INSERT INTO rider_monthly_settlements(rider_id,settlement_month,total_orders,total_distance_km,total_earning,cash_collected,net_payable,status,paid_amount,paid_at,admin_note) VALUES(:id,:month,:orders,:dist,:earning,:cash,:payable,'PAID',:amount,NOW(),:note) ON DUPLICATE KEY UPDATE total_orders=:orders,total_distance_km=:dist,total_earning=:earning,cash_collected=:cash,net_payable=0,status='PAID',paid_amount=:amount,paid_at=NOW(),admin_note=:note`,{id,month,orders:n(sums.totalOrders),dist:n(sums.totalDistanceKm),earning:n(sums.totalEarning),cash:n(sums.cashCollected),payable,amount:n(req.body?.amount,payable),note:req.body?.note||'Monthly rider payout completed'}); ok(res,{riderId:id,month,paid:true,payableBefore:payable,remainingPayable:0},'Rider monthly payout marked paid'); }));
router.delete('/admin/riders/:id',ah(async(req,res)=>{ await tryExec(`UPDATE users SET deleted=1, enabled=0 WHERE id=:id`,{id:req.params.id}); await tryExec(`DELETE FROM delivery_partner_profiles WHERE user_id=:id`,{id:req.params.id}); ok(res,{id:req.params.id},'Rider deleted/disabled'); }));
router.get('/rider/orders/:id/earning-preview',ah(async(req,res)=>{ const cfg=mapSettings(await settings()); const order=await tryOne(`SELECT o.*, COALESCE(o.outlet_id,o.restaurant_id) outletId FROM orders o WHERE o.id=:id`,{id:req.params.id})||{}; const dist=n(order.delivery_distance_km||order.distance_km||req.query.distanceKm||req.query.distance_km); const total=n(cfg.riderBasePay)+dist*n(cfg.riderPayPerKm); ok(res,{orderId:req.params.id,distanceKm:dist,basePay:cfg.riderBasePay,payPerKm:cfg.riderPayPerKm,totalEarning:Number(total.toFixed(2))},'Rider earning preview fetched'); }));
router.post('/rider/orders/:id/accept',ah(async(req,res)=>{ await ensureV52Schema(); const cfg=mapSettings(await settings()); const b=req.body||{}; const riderId=b.riderId||b.rider_id||req.user?.id||null; const dist=n(b.distanceKm||b.distance_km); const earning=Number((cfg.riderBasePay+dist*cfg.riderPayPerKm).toFixed(2)); if(riderId) await tryExec(`INSERT INTO rider_order_earnings(rider_id,order_id,outlet_id,distance_km,base_pay,per_km_pay,total_earning,status) VALUES(:riderId,:orderId,:outletId,:dist,:base,:km,:earning,'ACCEPTED') ON DUPLICATE KEY UPDATE distance_km=:dist,base_pay=:base,per_km_pay=:km,total_earning=:earning,status='ACCEPTED'`,{riderId,orderId:req.params.id,outletId:b.outletId||null,dist,base:cfg.riderBasePay,km:cfg.riderPayPerKm,earning}); ok(res,{orderId:req.params.id,riderId,distanceKm:dist,totalEarning:earning},'Order accepted with rider earning'); }));

router.use(require('./singleBrandEnterpriseV50'));
module.exports=router;
