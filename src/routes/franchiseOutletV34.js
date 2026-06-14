const router = require('express').Router();
const ah = require('../utils/asyncHandler');
const { ok, fail } = require('../utils/respond');
const { optionalAuth } = require('../middleware/auth');
const { pool } = require('../utils/db');

const cache = new Map();
async function cols(t){ if(cache.has(t)) return cache.get(t); try{ const [r]=await pool.execute(`SHOW COLUMNS FROM \`${t}\``); const s=new Set(r.map(x=>x.Field)); cache.set(t,s); return s; }catch{ const s=new Set(); cache.set(t,s); return s; } }
async function exists(t){ return (await cols(t)).size>0; }
async function q(sql,p=[]){ try{ const [r]=await pool.execute(sql,p); return r; }catch(e){ console.error('[franchise-v34]', e.message, sql); return []; } }
async function one(sql,p=[]){ const r=await q(sql,p); return r[0]||null; }
async function run(sql,p=[]){ try{ const [r]=await pool.execute(sql,p); return r; }catch(e){ console.error('[franchise-v34-exec]', e.message, sql); return {affectedRows:0,insertId:null}; } }
function n(v,d=0){ const x=Number(v); return Number.isFinite(x)?x:d; }
function t(v,d=''){ return String(v??d).trim(); }
function first(...a){ for(const v of a){ if(v!==undefined&&v!==null&&String(v).trim()!=='') return v; } return undefined; }
function bool(v,d=false){ if(v==null)return d; if(Buffer.isBuffer(v))return v[0]===1; if(typeof v==='object'&&Array.isArray(v.data))return Number(v.data[0])===1; if(typeof v==='boolean')return v; if(typeof v==='number')return v===1; return ['1','true','yes','on','active','available','approved','verified'].includes(String(v).toLowerCase()); }
function page(items, req){ const per=Math.max(1,n(req.query.limit||req.query.perPage||req.query.per_page,items.length||20)); const p=Math.max(1,n(req.query.page,1)); return {items,data:items,records:items,requests:items,outlets:items,total:items.length,totalItems:items.length,page:p,perPage:per,per_page:per,totalPages:Math.max(1,Math.ceil(items.length/per)),total_pages:Math.max(1,Math.ceil(items.length/per)),last:true}; }
function slug(s){ return String(s||'mr-breado-outlet').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,90) || `outlet-${Date.now()}`; }

async function init(){
 await run(`CREATE TABLE IF NOT EXISTS franchise_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NULL,
  business_name VARCHAR(255) NULL,
  address TEXT NULL, city VARCHAR(120) NULL, state VARCHAR(120) NULL, pincode VARCHAR(20) NULL,
  latitude DECIMAL(10,7) NULL, longitude DECIMAL(10,7) NULL,
  query TEXT NULL, investment_budget DECIMAL(12,2) NULL,
  preferred_contact_method VARCHAR(40) NULL DEFAULT 'PHONE',
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  admin_note TEXT NULL, contacted_at DATETIME(6) NULL, approved_restaurant_id BIGINT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
 )`);
 await run(`CREATE TABLE IF NOT EXISTS franchise_outlet_inventory (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
  stock_quantity INT NOT NULL DEFAULT 0, low_stock_alert INT NOT NULL DEFAULT 5,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_franchise_inventory (restaurant_id, product_id)
 )`);
 await run(`CREATE TABLE IF NOT EXISTS franchise_refill_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  restaurant_id BIGINT NOT NULL, seller_id BIGINT NULL,
  items_json JSON NOT NULL, note TEXT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  approved_cost DECIMAL(12,2) NULL, admin_note TEXT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
 )`);
 await run(`CREATE TABLE IF NOT EXISTS franchise_stock_transfers (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  refill_request_id BIGINT NULL, restaurant_id BIGINT NOT NULL, admin_id BIGINT NULL,
  items_json JSON NOT NULL, total_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'SENT', note TEXT NULL,
  sent_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), received_at DATETIME(6) NULL
 )`);
 // Safe optional restaurant columns. They only help filtering/highlighting; existing app keeps working if ALTER fails.
 const rc=await cols('restaurants');
 if(rc.size){
  const adds=[];
  if(!rc.has('outlet_type')) adds.push('ADD COLUMN outlet_type VARCHAR(60) NULL');
  if(!rc.has('parent_brand')) adds.push('ADD COLUMN parent_brand VARCHAR(255) NULL');
  if(!rc.has('franchise_request_id')) adds.push('ADD COLUMN franchise_request_id BIGINT NULL');
  if(adds.length){ await run(`ALTER TABLE restaurants ${adds.join(', ')}`); cache.delete('restaurants'); }
 }
}
init().catch(e=>console.error('[franchise-v34-init]',e.message));

async function products(){
 const pc=await cols('products'); if(!pc.size) return [];
 return q(`SELECT p.*, r.name restaurant_name FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id WHERE (LOWER(COALESCE(r.name,'')) LIKE '%mr breado%' OR LOWER(COALESCE(p.tags,'')) LIKE '%mr-breado%' OR COALESCE(p.restaurant_id,0) IN (SELECT id FROM restaurants WHERE LOWER(COALESCE(name,'')) LIKE '%mr breado%')) ORDER BY p.id DESC LIMIT 500`);
}
function mapProduct(p){ return { id:p.id, productId:p.id, title:first(p.title,p.name,p.product_name,'Food'), name:first(p.title,p.name,p.product_name,'Food'), subtitle:first(p.subtitle,p.description,''), image:first(p.image,p.image_url,p.thumbnail_url,p.photo_url,''), price:n(first(p.price,p.base_price,p.selling_price),0), stockQuantity:n(first(p.stock_quantity,p.stock,0),0), available:bool(first(p.available,p.is_available,p.active),true), category:first(p.category,p.category_name,p.food_category_name,''), restaurantName:first(p.restaurant_name,'Mr Breado') }; }
async function outlets(req){
 const rc=await cols('restaurants'); if(!rc.size) return [];
 const rows=await q(`SELECT r.*, u.name owner_name, COALESCE(u.mobile,u.phone_number) owner_mobile, u.email owner_email,
  (SELECT COUNT(*) FROM franchise_outlet_inventory i WHERE i.restaurant_id=r.id) inventory_count,
  (SELECT COALESCE(SUM(stock_quantity),0) FROM franchise_outlet_inventory i WHERE i.restaurant_id=r.id) total_stock,
  (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id=r.id) order_count,
  (SELECT COALESCE(SUM(o.grand_total),0) FROM orders o WHERE o.restaurant_id=r.id) gross_sales
  FROM restaurants r LEFT JOIN users u ON u.id=r.owner_id
  WHERE LOWER(COALESCE(r.name,'')) LIKE '%mr breado%' OR LOWER(COALESCE(r.parent_brand,'')) LIKE '%mr breado%' OR LOWER(COALESCE(r.outlet_type,'')) IN ('franchise','outlet','mr_breado_franchise')
  ORDER BY r.id DESC LIMIT 500`);
 return rows.map(r=>({ id:r.id, restaurantId:r.id, name:first(r.name,'Mr Breado Outlet'), outletName:first(r.name,'Mr Breado Outlet'), outletType:first(r.outlet_type,'OUTLET'), parentBrand:first(r.parent_brand,'Mr Breado'), ownerId:r.owner_id, ownerName:first(r.owner_name,''), phone:first(r.phone,r.mobile,r.owner_mobile,''), email:first(r.email,r.owner_email,''), address:first(r.address,''), city:first(r.city,''), pincode:first(r.pincode,''), latitude:r.latitude, longitude:r.longitude, open:bool(first(r.open,r.is_open),false), verificationStatus:first(r.verification_status,r.verificationStatus,'UNVERIFIED'), inventoryCount:n(r.inventory_count), totalStock:n(r.total_stock), totalOrders:n(r.order_count), grossSales:n(r.gross_sales), highlighted:true, isFranchiseOutlet:true }));
}
function normReq(r){ return { id:r.id, ownerName:r.owner_name, phone:r.phone, email:r.email, businessName:r.business_name, address:r.address, city:r.city, state:r.state, pincode:r.pincode, latitude:r.latitude, longitude:r.longitude, query:r.query, investmentBudget:n(r.investment_budget), preferredContactMethod:r.preferred_contact_method, status:r.status, adminNote:r.admin_note, contactedAt:r.contacted_at, approvedRestaurantId:r.approved_restaurant_id, createdAt:r.created_at, updatedAt:r.updated_at, highlighted:String(r.status).toUpperCase()==='PENDING' }; }
function parseItems(v){ if(Array.isArray(v)) return v; try{ const x=JSON.parse(String(v||'[]')); return Array.isArray(x)?x:[]; }catch{return [];} }

router.use(optionalAuth);

router.post(['/franchise/requests','/seller/franchise/requests','/auth/franchise-request'], ah(async(req,res)=>{
 const b=req.body||{}; const owner=t(first(b.ownerName,b.owner_name,b.name)); const phone=t(first(b.phone,b.mobile,b.phoneNumber));
 if(!owner||!phone) return fail(res,'Owner name and phone are required',400);
 const r=await run(`INSERT INTO franchise_requests(owner_name,phone,email,business_name,address,city,state,pincode,latitude,longitude,query,investment_budget,preferred_contact_method,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`,[owner,phone,t(b.email),t(first(b.businessName,b.business_name,b.restaurantName)),t(b.address),t(b.city),t(b.state),t(b.pincode),first(b.latitude,b.lat,null),first(b.longitude,b.lng,null),t(first(b.query,b.message,b.note)),first(b.investmentBudget,b.investment_budget,null),t(first(b.preferredContactMethod,b.preferred_contact_method,'PHONE'))]);
 await run(`INSERT INTO notifications(title,message,type,created_at) VALUES(?,?,?,NOW(6))`,['New Mr Breado franchise request',`Franchise query submitted by ${owner}`,'FRANCHISE_REQUEST']);
 ok(res,{id:r.insertId,status:'PENDING'},'Franchise request submitted',201);
}));
router.get(['/admin/franchise-requests','/admin/outlets/franchise-requests'], ah(async(req,res)=>{ const rows=await q('SELECT * FROM franchise_requests ORDER BY FIELD(status,\'PENDING\',\'CONTACTED\',\'APPROVED\',\'REJECTED\'), id DESC LIMIT 500'); ok(res,page(rows.map(normReq),req),'Franchise requests loaded'); }));
router.patch('/admin/franchise-requests/:id/status', ah(async(req,res)=>{ const id=n(req.params.id); const status=t(first(req.body?.status,req.query.status,'CONTACTED')).toUpperCase(); const note=t(first(req.body?.note,req.body?.adminNote,'')); await run('UPDATE franchise_requests SET status=?, admin_note=?, contacted_at=CASE WHEN ?=\'CONTACTED\' THEN NOW(6) ELSE contacted_at END WHERE id=?',[status,note,status,id]); ok(res,{id,status},'Franchise request updated'); }));
router.post('/admin/franchise-requests/:id/contact', ah(async(req,res)=>{ const id=n(req.params.id); const note=t(first(req.body?.note,'Contacted from admin panel')); await run('UPDATE franchise_requests SET status=\'CONTACTED\', admin_note=?, contacted_at=NOW(6) WHERE id=?',[note,id]); ok(res,{id,status:'CONTACTED'},'Contact marked'); }));

router.get(['/admin/outlets','/admin/franchise-outlets','/admin/mr-breado/outlets'], ah(async(req,res)=>ok(res,page(await outlets(req),req),'Franchise outlets loaded')));
router.get('/admin/outlets/:id/inventory', ah(async(req,res)=>{ const id=n(req.params.id); let rows=await q('SELECT i.*, p.title, p.name, p.image, p.image_url, p.price FROM franchise_outlet_inventory i LEFT JOIN products p ON p.id=i.product_id WHERE i.restaurant_id=? ORDER BY p.title,p.name',[id]); if(!rows.length){ rows=(await products()).map(p=>({restaurant_id:id,product_id:p.id,stock_quantity:0,low_stock_alert:5,...p})); } ok(res,rows.map(x=>({...mapProduct(x), productId:x.product_id||x.id, stockQuantity:n(x.stock_quantity), lowStockAlert:n(x.low_stock_alert,5)})),'Outlet inventory loaded'); }));
router.post('/admin/outlets/:id/transfers', ah(async(req,res)=>{ const id=n(req.params.id); const items=parseItems(req.body?.items||req.body?.itemsJson); const total=n(req.body?.totalCost||req.body?.total_cost, items.reduce((s,it)=>s+n(it.quantity)*n(it.unitCost||it.price),0)); const r=await run('INSERT INTO franchise_stock_transfers(restaurant_id,items_json,total_cost,status,note) VALUES(?,?,?,\'SENT\',?)',[id,JSON.stringify(items),total,t(req.body?.note)]); for(const it of items){ const pid=n(it.productId||it.product_id||it.id); const qty=n(it.quantity||it.qty); if(pid&&qty) await run('INSERT INTO franchise_outlet_inventory(restaurant_id,product_id,stock_quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stock_quantity=stock_quantity+VALUES(stock_quantity), updated_at=NOW(6)',[id,pid,qty]); } ok(res,{id:r.insertId,totalCost:total},'Stock transfer recorded'); }));

router.get(['/seller/franchise/products','/franchise/outlet/products'], ah(async(req,res)=>{ const rid=n(first(req.query.restaurantId, req.user?.restaurantId, req.user?.restaurant_id, req.query.outletId), 0); const base=(await products()).map(mapProduct); if(!rid) return ok(res,page(base,req),'Franchise products loaded'); const inv=await q('SELECT * FROM franchise_outlet_inventory WHERE restaurant_id=?',[rid]); const map=new Map(inv.map(i=>[String(i.product_id),i])); ok(res,page(base.map(p=>({...p,stockQuantity:n(map.get(String(p.id))?.stock_quantity,0),lowStockAlert:n(map.get(String(p.id))?.low_stock_alert,5)})),req),'Franchise products loaded'); }));
router.patch('/seller/franchise/products/:id/stock', ah(async(req,res)=>{ const productId=n(req.params.id); const rid=n(first(req.body?.restaurantId,req.query.restaurantId,req.user?.restaurantId,req.user?.restaurant_id),0); if(!rid||!productId) return fail(res,'Restaurant id and product id are required',400); const qty=n(first(req.body?.stockQuantity,req.body?.stock,req.body?.quantity),0); await run('INSERT INTO franchise_outlet_inventory(restaurant_id,product_id,stock_quantity) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stock_quantity=VALUES(stock_quantity), updated_at=NOW(6)',[rid,productId,qty]); ok(res,{restaurantId:rid,productId,stockQuantity:qty},'Stock updated'); }));
router.post(['/seller/franchise/refill-requests','/franchise/outlet/refill-requests'], ah(async(req,res)=>{ const b=req.body||{}; const rid=n(first(b.restaurantId,b.restaurant_id,req.user?.restaurantId,req.user?.restaurant_id)); const items=parseItems(first(b.items,b.itemsJson,[])); if(!rid||!items.length) return fail(res,'Restaurant id and refill items are required',400); const cost=items.reduce((s,it)=>s+n(it.quantity||it.qty)*n(it.unitCost||it.price),0); const r=await run('INSERT INTO franchise_refill_requests(restaurant_id,seller_id,items_json,note,estimated_cost,status) VALUES(?,?,?,?,?,\'PENDING\')',[rid,first(b.sellerId,b.seller_id,req.user?.id,null),JSON.stringify(items),t(b.note),cost]); ok(res,{id:r.insertId,status:'PENDING',estimatedCost:cost},'Refill request sent',201); }));
router.get(['/admin/franchise-refill-requests','/admin/outlets/refill-requests','/seller/franchise/refill-requests'], ah(async(req,res)=>{ const rows=await q('SELECT f.*, r.name restaurant_name FROM franchise_refill_requests f LEFT JOIN restaurants r ON r.id=f.restaurant_id ORDER BY f.id DESC LIMIT 500'); ok(res,page(rows.map(x=>({...x,items:parseItems(x.items_json),restaurantName:x.restaurant_name,estimatedCost:n(x.estimated_cost),approvedCost:n(x.approved_cost),createdAt:x.created_at})),req),'Refill requests loaded'); }));
router.patch('/admin/franchise-refill-requests/:id/status', ah(async(req,res)=>{ const id=n(req.params.id); const status=t(first(req.body?.status,req.query.status,'APPROVED')).toUpperCase(); await run('UPDATE franchise_refill_requests SET status=?, approved_cost=?, admin_note=? WHERE id=?',[status,first(req.body?.approvedCost,req.body?.approved_cost,null),t(req.body?.note),id]); ok(res,{id,status},'Refill request updated'); }));

module.exports = router;
