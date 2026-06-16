const express = require('express');
const router = express.Router();
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const { one, many, exec } = require('../utils/db');
const paymentSettings = require('../services/paymentSettingsService');

async function tryExec(sql, params = {}) { try { return await exec(sql, params); } catch (e) { return null; } }
async function tryMany(sql, params = {}) { try { return await many(sql, params); } catch (e) { return []; } }
async function tryOne(sql, params = {}) { try { return await one(sql, params); } catch (e) { return null; } }
function n(v, d = 0) { const x = Number(v); return Number.isFinite(x) ? x : d; }
function s(v, d = '') { return v === undefined || v === null ? d : String(v); }
function b(v, d = true) { if (v === undefined || v === null || v === '') return d; if (Buffer.isBuffer(v)) return v[0] === 1; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; return !['0','false','no','inactive','closed','disabled'].includes(String(v).toLowerCase()); }
function haversineKm(lat1,lng1,lat2,lng2){ const R=6371, toRad=x=>Number(x)*Math.PI/180; const dLat=toRad(lat2)-toRad(lat1), dLng=toRad(lng2)-toRad(lng1); const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(a)); }
function money(v){ return Number(n(v,0).toFixed(2)); }

async function ensureV54Schema(){
  await tryExec(`CREATE TABLE IF NOT EXISTS platform_business_settings (
    id TINYINT PRIMARY KEY DEFAULT 1,
    google_maps_api_key TEXT NULL,
    distance_provider VARCHAR(20) NOT NULL DEFAULT 'HAVERSINE',
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
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    paid_at DATETIME NULL,
    admin_note TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY rider_month_unique(rider_id,settlement_month)
  )`);
  for (const col of [
    'rating DECIMAL(3,2) NOT NULL DEFAULT 4.8','total_reviews INT NOT NULL DEFAULT 0','banner_image LONGTEXT NULL','profile_image LONGTEXT NULL','logo_image LONGTEXT NULL','phone VARCHAR(30)','email VARCHAR(180)','latitude DECIMAL(12,8) NULL','longitude DECIMAL(12,8) NULL','service_radius_km DECIMAL(10,2) NOT NULL DEFAULT 5.00','pincode VARCHAR(20)','manager_name VARCHAR(180)','manager_phone VARCHAR(30)','manager_email VARCHAR(180)'
  ]) await tryExec(`ALTER TABLE outlets ADD COLUMN ${col}`);
}
async function config(){ await ensureV54Schema(); const r = await tryOne(`SELECT * FROM platform_business_settings WHERE id=1`) || {}; return {
  googleMapsApiKey: s(r.google_maps_api_key),
  googleMapKey: s(r.google_maps_api_key),
  distanceProvider: s(r.distance_provider,'HAVERSINE').toUpperCase()==='GOOGLE'?'GOOGLE':'HAVERSINE',
  provider: s(r.distance_provider,'HAVERSINE').toUpperCase()==='GOOGLE'?'GOOGLE':'OSM',
  baseDeliveryCharge: n(r.base_delivery_charge,20),
  deliveryChargePerKm: n(r.delivery_charge_per_km,8),
  riderBasePay: n(r.rider_base_pay,25),
  riderPayPerKm: n(r.rider_pay_per_km,7),
  monthlySettlementDay: n(r.monthly_settlement_day,1),
  googleMapsApiKeyConfigured: !!s(r.google_maps_api_key),
}; }
async function saveConfig(body){ await ensureV54Schema(); const current = await config(); const key = body.googleMapsApiKey ?? body.googleMapKey ?? body.google_maps_api_key ?? current.googleMapsApiKey ?? ''; const providerRaw = s(body.distanceProvider ?? body.provider ?? body.distance_provider ?? current.distanceProvider).toUpperCase(); const provider = providerRaw === 'GOOGLE' ? 'GOOGLE' : 'HAVERSINE'; await exec(`UPDATE platform_business_settings SET google_maps_api_key=:key,distance_provider=:provider,base_delivery_charge=:base,delivery_charge_per_km=:chargeKm,rider_base_pay=:riderBase,rider_pay_per_km=:riderKm,monthly_settlement_day=:day WHERE id=1`, { key, provider, base:n(body.baseDeliveryCharge ?? body.base_delivery_charge, current.baseDeliveryCharge), chargeKm:n(body.deliveryChargePerKm ?? body.delivery_charge_per_km, current.deliveryChargePerKm), riderBase:n(body.riderBasePay ?? body.rider_base_pay, current.riderBasePay), riderKm:n(body.riderPayPerKm ?? body.rider_pay_per_km, current.riderPayPerKm), day:n(body.monthlySettlementDay ?? body.monthly_settlement_day, current.monthlySettlementDay) }); return await config(); }
async function googleDistanceKm(key, originLat, originLng, destLat, destLng){ if(!key || !global.fetch) return null; try { const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=metric&origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${encodeURIComponent(key)}`; const r = await fetch(url); const j = await r.json(); const el = j?.rows?.[0]?.elements?.[0]; const meters = el?.distance?.value; if(Number.isFinite(Number(meters))) return money(Number(meters)/1000); } catch(e){} return null; }
async function distanceKm(userLat,userLng,outlet,cfg){ const lat = outlet.latitude==null?null:Number(outlet.latitude); const lng = outlet.longitude==null?null:Number(outlet.longitude); if(userLat==null||userLng==null||lat==null||lng==null||!Number.isFinite(lat)||!Number.isFinite(lng)) return null; let d = null; if(cfg.distanceProvider === 'GOOGLE') d = await googleDistanceKm(cfg.googleMapsApiKey,userLat,userLng,lat,lng); if(d == null) d = money(haversineKm(userLat,userLng,lat,lng)); return d; }
function chargesFor(distance, cfg){ const d = n(distance, 0); return { distanceKm: money(d), deliveryCharge: money(cfg.baseDeliveryCharge + d * cfg.deliveryChargePerKm), riderEarning: money(cfg.riderBasePay + d * cfg.riderPayPerKm), deliveryChargePerKm: cfg.deliveryChargePerKm, riderPayPerKm: cfg.riderPayPerKm, baseDeliveryCharge: cfg.baseDeliveryCharge, riderBasePay: cfg.riderBasePay }; }
function mapOutlet(o, distance, cfg){ const radius = n(o.service_radius_km, 5); const ch = distance == null ? {} : chargesFor(distance, cfg); return { id:o.id, outletId:o.id, outletCode:s(o.outlet_code || o.id), name:s(o.name || 'Mr Breado Outlet'), outletName:s(o.name || 'Mr Breado Outlet'), address:s(o.address || ''), city:s(o.city || ''), state:s(o.state || ''), pincode:s(o.pincode || ''), latitude:o.latitude==null?null:Number(o.latitude), longitude:o.longitude==null?null:Number(o.longitude), serviceRadiusKm:radius, distanceKm:distance, exactDistanceKm:distance, isServiceable:distance==null?true:distance<=radius, isOpen:b(o.is_open,true), isActive:b(o.is_active,true), rating:n(o.rating,4.8), totalReviews:n(o.total_reviews,0), phone:s(o.phone || o.manager_phone), email:s(o.email || o.manager_email), managerName:s(o.manager_name), managerPhone:s(o.manager_phone), managerEmail:s(o.manager_email), bannerImage:s(o.banner_image), profileImage:s(o.profile_image || o.logo_image), logoImage:s(o.logo_image || o.profile_image), ...ch }; }
async function outletRows(){ await ensureV54Schema(); let rows = await tryMany(`SELECT * FROM outlets WHERE COALESCE(is_active,1)=1 ORDER BY id DESC`); if(!rows.length){ rows = await tryMany(`SELECT id, COALESCE(name,'Mr Breado') name, address, city, state, pincode, latitude, longitude, is_open, is_active FROM restaurants WHERE LOWER(COALESCE(name,'')) LIKE '%breado%' ORDER BY id DESC`); }
 return rows; }
async function mappedOutlets(q){ const cfg = await config(); const lat = q.lat ? Number(q.lat) : null; const lng = q.lng ? Number(q.lng) : null; const pin = s(q.pincode).trim(); let rows = await outletRows(); if(pin) { const zoneRows = await tryMany(`SELECT DISTINCT outlet_id FROM outlet_service_zones WHERE is_active=1 AND pincode=:pincode`, { pincode: pin }); const zoneIds = new Set(zoneRows.map(x=>String(x.outlet_id))); rows = rows.filter(o => s(o.pincode).trim() === pin || zoneIds.has(String(o.id)) || !s(o.pincode).trim()); }
 const mapped=[]; for(const o of rows) mapped.push(mapOutlet(o, await distanceKm(lat,lng,o,cfg), cfg)); mapped.sort((a,b)=>(a.distanceKm??999999)-(b.distanceKm??999999)); return mapped; }
async function outletMenu(outletId){ await ensureV54Schema(); const cfg = await config(); const outlet = await tryOne(`SELECT * FROM outlets WHERE id=:id`, { id: outletId }) || { id: outletId, name: 'Mr Breado Outlet' }; const rows = await tryMany(`SELECT s.outlet_id outletId, s.product_id productId, s.stock_qty stockQuantity, s.min_stock_qty lowStockAlert, s.prep_time_minutes preparationMinutes, s.is_available isAvailable, COALESCE(NULLIF(s.selling_price,0),p.price,p.discounted_price,0) price, COALESCE(NULLIF(p.name,''),p.title,p.product_name,CONCAT('Food #',p.id)) name, COALESCE(p.image_url,p.image,p.photo_url) imageUrl, p.description, p.slug FROM outlet_product_stock s LEFT JOIN products p ON p.id=s.product_id WHERE s.outlet_id=:outletId AND COALESCE(s.is_available,1)=1 AND COALESCE(s.stock_qty,0)>0 ORDER BY name`, { outletId }); return { outlet: mapOutlet(outlet, null, cfg), items: rows, menu: rows, foods: rows, products: rows }; }

router.get('/single-brand/v54/version', (req,res)=>ok(res,{version:'single-brand-enterprise-v54',focus:'business-api-keys-nearest-outlet-rider-payout-tracking',razorpay:'v22/v26 locked unchanged'},'v54 active'));
router.post('/admin/outlets/ensure-enterprise-v54-schema', ah(async(req,res)=>{ await ensureV54Schema(); ok(res,{ready:true},'v54 schema ready'); }));
router.get(['/admin/api-keys','/admin/settings/api-keys','/admin/settings/map','/admin/business/settings'], ah(async(req,res)=>ok(res, await config(), 'API settings fetched')));
router.put(['/admin/api-keys','/admin/settings/api-keys','/admin/settings/map','/admin/business/settings'], ah(async(req,res)=>ok(res, await saveConfig(req.body || {}), 'API settings saved')));
router.get(['/admin/payment-controls','/admin/payment-settings-page'], ah(async(req,res)=>ok(res, await paymentSettings.getAdminSettings(), 'Payment controls fetched')));
router.put(['/admin/payment-controls','/admin/payment-settings-page'], ah(async(req,res)=>ok(res, await paymentSettings.saveAdminSettings(req.body || {}, req.user?.id), 'Payment controls saved')));
router.get(['/outlets','/user/outlets'], ah(async(req,res)=>{ const items = await mappedOutlets(req.query || {}); ok(res,{items,outlets:items,total:items.length},'Outlets fetched'); }));
router.get('/outlets/nearest', ah(async(req,res)=>{ const items = await mappedOutlets(req.query || {}); const serviceable = items.find(x=>x.isServiceable) || items[0] || null; if(!serviceable) return res.status(404).json({success:false,message:'No Mr Breado outlet found'}); ok(res,{...serviceable,nearestOutlet:serviceable},'Nearest outlet fetched'); }));
router.get('/menu/nearest', ah(async(req,res)=>{ const items = await mappedOutlets(req.query || {}); const outlet = items.find(x=>x.isServiceable) || items[0]; if(!outlet) return res.status(404).json({success:false,message:'No serviceable outlet found'}); const menu = await outletMenu(outlet.id); menu.outlet = outlet; ok(res, menu, 'Nearest outlet menu fetched'); }));
router.get('/outlets/:id/menu', ah(async(req,res)=>ok(res, await outletMenu(req.params.id), 'Outlet menu fetched')));
router.get('/outlets/:id/contact', ah(async(req,res)=>{ const cfg = await config(); const o = await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id:req.params.id}); if(!o) return res.status(404).json({success:false,message:'Outlet not found'}); ok(res, mapOutlet(o,null,cfg), 'Outlet contact fetched'); }));
router.get('/delivery/quote', ah(async(req,res)=>{ const cfg = await config(); let distance = req.query.distanceKm ? Number(req.query.distanceKm) : null; if(distance == null && req.query.userLat && req.query.userLng && req.query.outletId){ const o = await tryOne(`SELECT * FROM outlets WHERE id=:id`,{id:req.query.outletId}); if(o) distance = await distanceKm(Number(req.query.userLat),Number(req.query.userLng),o,cfg); } ok(res, chargesFor(distance || 0, cfg), 'Delivery quote calculated'); }));
router.get('/rider/orders/:orderId/earning-preview', ah(async(req,res)=>{ const cfg = await config(); const distance = n(req.query.distanceKm || req.query.distance_km, 0); ok(res, { orderId:req.params.orderId, ...chargesFor(distance,cfg) }, 'Rider earning preview'); }));
router.get('/admin/riders/:id/dashboard', ah(async(req,res)=>{ await ensureV54Schema(); const riderId=req.params.id; const profile = await tryOne(`SELECT u.id, u.name, u.full_name, u.email, u.phone, u.mobile, d.vehicle_number, d.license_number, d.driving_license_number FROM users u LEFT JOIN delivery_partner_profiles d ON d.user_id=u.id WHERE u.id=:id`,{id:riderId}) || { id:riderId }; const history = await tryMany(`SELECT e.*, o.order_number, o.status orderStatus, o.total_amount orderAmount, o.created_at orderDate FROM rider_order_earnings e LEFT JOIN orders o ON o.id=e.order_id WHERE e.rider_id=:id ORDER BY e.created_at DESC LIMIT 300`,{id:riderId}); const summary = history.reduce((a,x)=>{a.orders+=1;a.distanceKm+=n(x.distance_km);a.earned+=n(x.total_earning);a.cashCollected+=n(x.cash_collected);return a;},{orders:0,distanceKm:0,earned:0,cashCollected:0}); ok(res,{rider:profile,summary:{...summary,netPayable:money(summary.earned-summary.cashCollected)},deliveryHistory:history,items:history},'Rider dashboard fetched'); }));
router.post('/admin/riders/:id/settlements/:month/pay', ah(async(req,res)=>{ await ensureV54Schema(); const riderId=req.params.id, month=req.params.month; const amount=n(req.body?.amount,0); await tryExec(`INSERT INTO rider_monthly_settlements(rider_id,settlement_month,paid_amount,status,paid_at,admin_note) VALUES(:riderId,:month,:amount,'PAID',NOW(),:note) ON DUPLICATE KEY UPDATE paid_amount=:amount,status='PAID',paid_at=NOW(),admin_note=:note`,{riderId,month,amount,note:s(req.body?.note)}); await tryExec(`UPDATE rider_order_earnings SET status='SETTLED' WHERE rider_id=:riderId AND DATE_FORMAT(COALESCE(delivered_at,created_at),'%Y-%m')=:month`,{riderId,month}); ok(res,{riderId,month,paidAmount:amount,status:'PAID'},'Rider monthly payout marked paid'); }));
router.delete('/admin/riders/:id', ah(async(req,res)=>{ await tryExec(`UPDATE users SET deleted=1, enabled=0, blocked=1 WHERE id=:id`,{id:req.params.id}); ok(res,{id:req.params.id},'Rider disabled/deleted'); }));

router.use(require('./singleBrandEnterpriseV53'));
module.exports = router;
