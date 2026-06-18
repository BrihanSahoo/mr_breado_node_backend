const express = require('express');
const multer = require('multer');
const { requireAuth, role } = require('../middleware/auth');
const { transitionOrder } = require('../services/orderLifecycleService');
const { one, many, exec, pool } = require('../utils/db');
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function clean(value) { return String(value ?? '').trim(); }
function slugify(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `category-${Date.now()}`; }
function bool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false','0','inactive','no'].includes(String(value).toLowerCase());
}
function mapCategory(row = {}) {
  const active = bool(row.enabled ?? row.active, true);
  const image = row.image_url || row.image || row.icon || '';
  return { ...row, name: row.name || row.title || '', title: row.title || row.name || '', image, imageUrl: image, icon: image, active, enabled: active, status: active ? 'ACTIVE' : 'INACTIVE', productCount: Number(row.productCount || 0), subCategoryCount: Number(row.subCategoryCount || 0) };
}
async function uniqueCategorySlug(base, ignoreId = null) {
  const root = slugify(base); let candidate = root; let suffix = 1;
  while (await one('SELECT id FROM food_categories WHERE slug=:slug AND (:ignoreId IS NULL OR id<>:ignoreId) LIMIT 1', { slug:candidate, ignoreId })) candidate = `${root}-${++suffix}`;
  return candidate;
}
async function imageValue(req) {
  const body = req.body || {};
  if (req.file) return `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  return clean(body.imageUrl || body.image_url || body.image || body.icon || body.dataUrl || body.data_url);
}
async function outletStockRows(outletId) {
  return many(`SELECT s.id, s.outlet_id outletId, s.product_id productId,
    COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) productName,
    COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl,
    COALESCE(s.stock_quantity,s.stock_qty,0) stockQuantity,
    COALESCE(s.low_stock_alert,s.min_stock_qty,5) lowStockAlert,
    COALESCE(NULLIF(s.selling_price,0),p.discount_price,p.price,0) price,
    COALESCE(s.unit_cost,0) unitCost, COALESCE(s.preparation_minutes,s.prep_time_minutes,15) preparationMinutes,
    COALESCE(s.is_available,1) isAvailable, COALESCE(fc.name,fc.title,'Uncategorised') categoryName
    FROM outlet_product_stock s
    JOIN products p ON p.id=s.product_id
    LEFT JOIN food_categories fc ON fc.id=COALESCE(p.food_category_id,p.category_id,p.menu_category_id)
    WHERE s.outlet_id=:outletId AND COALESCE(p.deleted,0)=0 ORDER BY productName`, { outletId });
}


async function assertOrderActor(req, orderId) {
  const order = await one('SELECT id,user_id,driver_id,outlet_id,selected_outlet_id,restaurant_id FROM orders WHERE id=:id', { id: orderId });
  if (!order) throw Object.assign(new Error('Order not found'), { status:404 });
  const actualRole = String(req.user.role || '').toUpperCase();
  if (actualRole === 'ADMIN') return order;
  if (actualRole === 'USER' && Number(order.user_id) === Number(req.user.id)) return order;
  if (actualRole === 'RIDER' && Number(order.driver_id) === Number(req.user.id)) return order;
  if (actualRole === 'SELLER' || actualRole === 'OUTLET_MANAGER') {
    const outletId = order.outlet_id || order.selected_outlet_id || order.restaurant_id;
    const assigned = await one(`SELECT 1 ok FROM outlet_seller_assignments WHERE outlet_id=:outletId AND seller_id=:sellerId AND COALESCE(is_active,1)=1 LIMIT 1`, { outletId, sellerId:req.user.id });
    if (assigned) return order;
  }
  throw Object.assign(new Error('Order access denied'), { status:403 });
}


// Canonical category CRUD mounted before all historical routers.
router.get('/admin/categories', requireAuth, role('ADMIN'), ah(async (req,res) => {
  const rows = await many(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE COALESCE(p.food_category_id,p.category_id,p.menu_category_id)=c.id AND COALESCE(p.deleted,0)=0) productCount FROM food_categories c WHERE COALESCE(c.deleted,0)=0 ORDER BY COALESCE(c.sort_order,0),c.id`);
  const items = rows.map(mapCategory);
  ok(res,{items,categories:items,total:items.length,totalItems:items.length,page:1,perPage:items.length || 50},'Categories fetched');
}));
router.get('/admin/categories/summary', requireAuth, role('ADMIN'), ah(async (req,res) => {
  const row = await one(`SELECT COUNT(*) totalCategories, SUM(CASE WHEN COALESCE(enabled,active,1)=1 THEN 1 ELSE 0 END) activeCategories, SUM(CASE WHEN COALESCE(enabled,active,1)=0 THEN 1 ELSE 0 END) inactiveCategories FROM food_categories WHERE COALESCE(deleted,0)=0`) || {};
  ok(res,{totalCategories:Number(row.totalCategories||0),activeCategories:Number(row.activeCategories||0),inactiveCategories:Number(row.inactiveCategories||0),totalSubCategories:0},'Category summary fetched');
}));
router.post(['/admin/categories','/admin/food-categories'], requireAuth, role('ADMIN'), upload.single('file'), ah(async (req,res) => {
  const body=req.body||{}; const name=clean(body.name||body.title);
  if(!name) return res.status(400).json({success:false,message:'Category name is required'});
  const slug=await uniqueCategorySlug(body.slug||name); const image=await imageValue(req); const enabled=bool(body.enabled ?? body.active ?? body.status,true)?1:0;
  const result=await exec(`INSERT INTO food_categories(name,title,slug,description,image_url,image,icon,enabled,active,deleted,show_on_home,sort_order,created_at,updated_at) VALUES(:name,:name,:slug,:description,:image,:image,:image,:enabled,:enabled,0,:showOnHome,:sortOrder,NOW(6),NOW(6))`,{name,slug,description:clean(body.description),image,enabled,showOnHome:bool(body.showOnHome ?? body.show_on_home,true)?1:0,sortOrder:Number(body.sortOrder??body.sort_order??0)||0});
  ok(res,mapCategory(await one('SELECT * FROM food_categories WHERE id=:id',{id:result.insertId})),'Category created',201);
}));
router.put(['/admin/categories/:id','/admin/food-categories/:id'], requireAuth, role('ADMIN'), upload.single('file'), ah(async (req,res) => {
  const current=await one('SELECT * FROM food_categories WHERE id=:id',{id:req.params.id}); if(!current) return res.status(404).json({success:false,message:'Category not found'});
  const body=req.body||{}; const name=clean(body.name||body.title||current.name||current.title); const slug=await uniqueCategorySlug(body.slug||current.slug||name,req.params.id); const incoming=await imageValue(req); const image=incoming||current.image_url||current.image||current.icon||''; const enabled=bool(body.enabled ?? body.active ?? body.status,bool(current.enabled??current.active,true))?1:0;
  await exec(`UPDATE food_categories SET name=:name,title=:name,slug=:slug,description=:description,image_url=:image,image=:image,icon=:image,enabled=:enabled,active=:enabled,show_on_home=:showOnHome,sort_order=:sortOrder,updated_at=NOW(6) WHERE id=:id`,{id:req.params.id,name,slug,description:clean(body.description??current.description),image,enabled,showOnHome:bool(body.showOnHome??body.show_on_home,bool(current.show_on_home,true))?1:0,sortOrder:Number(body.sortOrder??body.sort_order??current.sort_order??0)||0});
  ok(res,mapCategory(await one('SELECT * FROM food_categories WHERE id=:id',{id:req.params.id})),'Category updated');
}));
router.patch(['/admin/categories/:id/status','/admin/food-categories/:id/status'], requireAuth, role('ADMIN'), ah(async(req,res)=>{const enabled=bool(req.body?.enabled??req.body?.active??req.body?.status,true)?1:0;await exec('UPDATE food_categories SET enabled=:enabled,active=:enabled,updated_at=NOW(6) WHERE id=:id',{id:req.params.id,enabled});ok(res,mapCategory(await one('SELECT * FROM food_categories WHERE id=:id',{id:req.params.id})),'Category status updated');}));
router.delete(['/admin/categories/:id','/admin/food-categories/:id'], requireAuth, role('ADMIN'), ah(async(req,res)=>{await exec('UPDATE food_categories SET deleted=1,enabled=0,active=0,updated_at=NOW(6) WHERE id=:id',{id:req.params.id});ok(res,{id:req.params.id},'Category deleted');}));

// Canonical outlet inventory/dashboard endpoints.
router.get('/admin/outlets/:id/available-products', requireAuth, role('ADMIN'), ah(async(req,res)=>{
  const assigned=await outletStockRows(req.params.id);
  const all=await many(`SELECT p.id productId,COALESCE(NULLIF(p.name,''),NULLIF(p.title,''),CONCAT('Food #',p.id)) productName,COALESCE(NULLIF(p.image_url,''),NULLIF(p.image,''),'') imageUrl,COALESCE(p.discount_price,p.price,0) price,COALESCE(fc.name,fc.title,'Uncategorised') categoryName,COALESCE(p.veg,p.is_veg,1) isVeg FROM products p LEFT JOIN food_categories fc ON fc.id=COALESCE(p.food_category_id,p.category_id,p.menu_category_id) WHERE COALESCE(p.deleted,0)=0 ORDER BY productName`);
  const ids=new Set(assigned.map(x=>String(x.productId))); ok(res,{assigned,all,items:all,unassigned:all.filter(x=>!ids.has(String(x.productId)))},'Outlet inventory loaded');
}));
router.post('/admin/outlets/:id/stock', requireAuth, role('ADMIN'), ah(async(req,res)=>{
  const items=Array.isArray(req.body?.items)?req.body.items:[]; if(!items.length) return res.status(400).json({success:false,message:'Select at least one food item'});
  const conn=await pool.getConnection(); try{await conn.beginTransaction(); for(const item of items){const productId=Number(item.productId??item.product_id);if(!productId)continue;const qty=Math.max(0,Number(item.stockQuantity??item.stock_quantity??item.stock??0)||0);const low=Math.max(0,Number(item.lowStockAlert??item.low_stock_alert??5)||0);const selling=Math.max(0,Number(item.sellingPrice??item.selling_price??item.price??0)||0);const cost=Math.max(0,Number(item.unitCost??item.unit_cost??0)||0);const prep=Math.max(1,Number(item.preparationMinutes??item.preparation_minutes??15)||15);const available=item.isAvailable===false||item.available===false?0:1;const [beforeRows]=await conn.execute('SELECT COALESCE(stock_quantity,stock_qty,0) qty FROM outlet_product_stock WHERE outlet_id=? AND product_id=? FOR UPDATE',[req.params.id,productId]);const before=Number(beforeRows[0]?.qty||0);await conn.execute(`INSERT INTO outlet_product_stock(outlet_id,product_id,stock_qty,stock_quantity,min_stock_qty,low_stock_alert,prep_time_minutes,preparation_minutes,is_available,selling_price,unit_cost,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NOW()) ON DUPLICATE KEY UPDATE stock_qty=VALUES(stock_qty),stock_quantity=VALUES(stock_quantity),min_stock_qty=VALUES(min_stock_qty),low_stock_alert=VALUES(low_stock_alert),prep_time_minutes=VALUES(prep_time_minutes),preparation_minutes=VALUES(preparation_minutes),is_available=VALUES(is_available),selling_price=VALUES(selling_price),unit_cost=VALUES(unit_cost),updated_at=NOW()`,[req.params.id,productId,qty,qty,low,low,prep,prep,available,selling,cost]);await conn.execute(`INSERT INTO outlet_stock_movements(outlet_id,product_id,movement_type,quantity,before_stock,after_stock,unit_cost,total_cost,note,created_by) VALUES(?,?,'MANUAL_UPDATE',?,?,?,?,?,?,?)`,[req.params.id,productId,qty-before,before,qty,cost,(qty-before)*cost,clean(item.note)||'Admin updated outlet stock',req.user?.id||null]);}await conn.commit();}catch(e){await conn.rollback();throw e;}finally{conn.release();}
  ok(res,{outletId:Number(req.params.id),items:await outletStockRows(req.params.id)},'Outlet inventory saved');
}));
router.get('/admin/outlets/:id/full-dashboard', requireAuth, role('ADMIN'), ah(async(req,res)=>{
  const id=req.params.id; const outlet=await one('SELECT * FROM outlets WHERE id=:id',{id}); if(!outlet) return res.status(404).json({success:false,message:'Outlet not found'}); const stock=await outletStockRows(id);
  const orders=await many(`SELECT * FROM orders WHERE COALESCE(outlet_id,selected_outlet_id,restaurant_id)=:id AND (:from IS NULL OR DATE(created_at)>=:from) AND (:to IS NULL OR DATE(created_at)<=:to) ORDER BY id DESC LIMIT 500`,{id,from:req.query.from||null,to:req.query.to||null});
  const valid=orders.filter(o=>['DELIVERED','COMPLETED'].includes(String(o.status||'').toUpperCase())); const totalSales=valid.reduce((a,o)=>a+Number(o.grand_total??o.total_amount??o.total??0),0); const onlineSales=valid.filter(o=>String(o.payment_type||o.payment_method||'').toUpperCase()!=='COD').reduce((a,o)=>a+Number(o.grand_total??o.total_amount??o.total??0),0); const codSales=valid.filter(o=>String(o.payment_type||o.payment_method||'').toUpperCase()==='COD').reduce((a,o)=>a+Number(o.grand_total??o.total_amount??o.total??0),0);
  const summary={totalSales,onlineSales,codSales,offlineSales:0,orders:orders.length,averageOrderValue:valid.length?totalSales/valid.length:0,stockItems:stock.length,availableProducts:stock.filter(x=>bool(x.isAvailable,true)&&Number(x.stockQuantity)>0).length,lowStock:stock.filter(x=>Number(x.stockQuantity)<=Number(x.lowStockAlert)).length,outOfStock:stock.filter(x=>Number(x.stockQuantity)<=0).length,stockValue:stock.reduce((a,x)=>a+Number(x.stockQuantity)*Number(x.unitCost||x.price||0),0),bookings:0,todaySales:totalSales,weekSales:totalSales,monthSales:totalSales,yearSales:totalSales};
  ok(res,{outlet,summary,metrics:summary,stock,orders,orderHistory:orders,stockMovements:await many(`SELECT m.*,COALESCE(NULLIF(p.name,''),p.title) productName FROM outlet_stock_movements m LEFT JOIN products p ON p.id=m.product_id WHERE m.outlet_id=:id ORDER BY m.id DESC LIMIT 200`,{id}),salesByDay:[],closingCalendar:[],bestFoods:[],slowFoods:stock.slice().sort((a,b)=>Number(b.stockQuantity)-Number(a.stockQuantity)).slice(0,10)},'Outlet business dashboard loaded');
}));

router.patch(['/orders/:id/status','/seller/orders/:id/status','/rider/orders/:id/status'], requireAuth, ah(async (req,res) => {
  await assertOrderActor(req, req.params.id);
  const key = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;
  const result = await transitionOrder({ orderId:req.params.id, toStatus:req.body?.status, actor:req.user, reason:req.body?.reason || null, idempotencyKey:key });
  ok(res, result, result.duplicate ? 'Order transition already processed' : 'Order status updated');
}));

router.get('/admin/security/ping', requireAuth, role('ADMIN'), (req,res) => ok(res,{adminId:req.user.id},'Authorized'));
module.exports = router;
