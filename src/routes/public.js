const router=require('express').Router();
const {ok}=require('../utils/respond');
const ah=require('../utils/asyncHandler');
const {many,one,page}=require('../utils/db');

async function safeMany(sql, params={}){try{return await many(sql,params);}catch(e){console.error('PUBLIC QUERY FAILED:', e.message);return [];}}
async function safeOne(sql, params={}){try{return await one(sql,params);}catch(e){console.error('PUBLIC QUERY FAILED:', e.message);return null;}}
function bitBool(value, defaultValue=false){
  if(value===undefined || value===null) return defaultValue;
  if(Buffer.isBuffer(value)) return value.length>0 && value[0]===1;
  if(typeof value==='boolean') return value;
  if(typeof value==='number') return value===1;
  if(typeof value==='string'){const v=value.trim().toLowerCase(); return ['1','true','yes','active','enabled','visible','open'].includes(v);}
  if(typeof value==='object' && Array.isArray(value.data)) return value.data.length>0 && Number(value.data[0])===1;
  return Boolean(value);
}
function bitNum(value, defaultValue=0){ return bitBool(value, !!defaultValue) ? 1 : 0; }
function mapProduct(p={}){
  const name=p.name||p.title||p.product_name||'Food Item';
  const restaurant={id:p.restaurant_id||p.restaurantId, name:p.restaurantName||p.restaurant_name, slug:p.restaurantSlug||p.restaurant_slug};
  const brand={id:p.brand_id||p.brandId, name:p.brandName||p.brand_name, slug:p.brandSlug||p.brand_slug};
  return {...p,name,title:name,imageUrl:p.imageUrl||p.image_url||p.image,discountPrice:p.discount_price,restaurantId:p.restaurant_id||p.restaurantId,restaurantName:p.restaurantName||p.restaurant_name,restaurantSlug:p.restaurantSlug||p.restaurant_slug,brandId:p.brand_id||p.brandId,brandName:p.brandName||p.brand_name,brandSlug:p.brandSlug||p.brand_slug,categoryId:p.category_id||p.food_category_id,foodCategoryId:p.food_category_id,menuCategoryId:p.menu_category_id,categoryName:p.category_name||p.foodCategoryName||p.menuCategoryName||'All',foodCategoryName:p.foodCategoryName,menuCategoryName:p.menuCategoryName,isVeg:bitBool(p.veg||p.is_veg,false),veg:bitBool(p.veg||p.is_veg,false),isAvailable:bitBool(p.available||p.is_available,true),available:bitBool(p.available||p.is_available,true),featured:bitBool(p.featured,false),bestseller:bitBool(p.bestseller,false),restaurant,brand};
}
function mapRestaurant(r={}){return {...r,imageUrl:r.imageUrl||r.image_url||r.logo||r.image,bannerUrl:r.banner||r.banner_url||r.imageUrl||r.image_url||r.logo,isOpen: bitBool(r.is_open!==undefined?r.is_open:r.open,true),minimumOrder:r.minimum_order,deliveryRadiusKm:r.delivery_radius_km,minDeliveryTime:r.min_delivery_time,maxDeliveryTime:r.max_delivery_time};}
function mapCategory(c={}){return {...c,name:c.name||c.title,title:c.title||c.name,imageUrl:c.imageUrl||c.image_url||c.image||c.icon,active:bitBool(c.active!==undefined?c.active:c.enabled,true),enabled:bitBool(c.enabled!==undefined?c.enabled:c.active,true)};}
function mapBrand(b={}){return {...b,name:b.name||b.title,title:b.title||b.name,imageUrl:b.imageUrl||b.image_url||b.logo,active:bitBool(b.active!==undefined?b.active:b.enabled,true),enabled:bitBool(b.enabled!==undefined?b.enabled:b.active,true)};}

const categorySql=`SELECT id, COALESCE(NULLIF(name,''), title) name, title, slug, COALESCE(image_url,image,icon) imageUrl, COALESCE(active,enabled,show_on_home,1) active, sort_order FROM food_categories WHERE COALESCE(deleted,0)=0 AND COALESCE(enabled,1)=1 ORDER BY sort_order,id LIMIT 50`;
const menuCategorySql=`SELECT id,title name,title,slug,sort_order,restaurant_id FROM menu_categories WHERE COALESCE(deleted,0)=0 AND COALESCE(enabled,1)=1 ORDER BY sort_order,id LIMIT 100`;
const brandSql=`SELECT id, COALESCE(NULLIF(name,''), title) name, title, slug, COALESCE(image_url,logo) imageUrl, COALESCE(active,enabled,1) active, description, total_products FROM brands WHERE COALESCE(enabled,active,1)=1 ORDER BY id DESC LIMIT 50`;
const restaurantSql=`SELECT id,name,slug,description,address,city,state,country,zipcode,latitude,longitude,rating,total_reviews,COALESCE(image_url,logo) imageUrl,banner,COALESCE(is_open,open,1) isOpen,verification_status,visibility_status,minimum_order,delivery_radius_km,min_delivery_time,max_delivery_time,price_for_two,owner_id FROM restaurants WHERE COALESCE(deleted,0)=0 AND COALESCE(visibility_status,'VISIBLE')='VISIBLE' ORDER BY featured DESC, rating DESC, id DESC`;
const productSelect=`SELECT p.id, COALESCE(NULLIF(p.name,''),p.title) name, p.title, p.subtitle, p.slug, p.description, COALESCE(p.image_url,p.image) imageUrl, p.image, p.price, p.discount_price, p.currency, p.veg, p.available, p.rating, p.total_reviews, p.restaurant_id, p.category_id, p.food_category_id, p.menu_category_id, p.brand_id, p.stock, p.stock_quantity, p.featured, p.bestseller, p.category_name, r.name restaurantName, r.slug restaurantSlug, b.title brandName, b.slug brandSlug, fc.title foodCategoryName, mc.title menuCategoryName FROM products p LEFT JOIN restaurants r ON r.id=p.restaurant_id LEFT JOIN brands b ON b.id=p.brand_id LEFT JOIN food_categories fc ON fc.id=p.food_category_id LEFT JOIN menu_categories mc ON mc.id=p.menu_category_id`;

router.get('/home',ah(async(req,res)=>{const [categories,menuCategories,brands,restaurants,products,banners,offers]=await Promise.all([
 safeMany(categorySql), safeMany(menuCategorySql), safeMany(brandSql), safeMany(restaurantSql+' LIMIT 20'), safeMany(productSelect+` WHERE COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 ORDER BY p.featured DESC,p.rating DESC,p.id DESC LIMIT 30`), safeMany(`SELECT id,title,subtitle,description,image imageUrl,action_type actionType,action_value actionValue,position,priority FROM banners WHERE COALESCE(enabled,1)=1 ORDER BY priority DESC,id DESC LIMIT 10`), safeMany(`SELECT id,title,subtitle,description,image_url imageUrl,offer_type offerType,action_type actionType,action_value actionValue,coupon_code couponCode,discount_type discountType,discount_value discountValue,min_order_amount minOrderAmount,max_discount_amount maxDiscountAmount,active FROM offers WHERE COALESCE(active,1)=1 ORDER BY sort_order,id DESC LIMIT 20`)
]); ok(res,{banners,offers,categories:categories.map(mapCategory),subCategories:categories.map(mapCategory),menuCategories,brands:brands.map(mapBrand),restaurants:restaurants.map(mapRestaurant),topRestaurants:restaurants.map(mapRestaurant),products:products.map(mapProduct),popularProducts:products.map(mapProduct),settings:{currency:'INR',deliveryEnabled:true}});}));
router.get('/settings',(req,res)=>ok(res,{currency:'INR',deliveryEnabled:true}));
router.get('/categories',ah(async(req,res)=>ok(res,(await safeMany(categorySql)).map(mapCategory))));
router.get('/food-categories',ah(async(req,res)=>ok(res,(await safeMany(categorySql)).map(mapCategory))));
router.get('/categories/sub-categories',ah(async(req,res)=>ok(res,(await safeMany(categorySql)).map(mapCategory))));
router.get('/menu-categories',ah(async(req,res)=>ok(res,await safeMany(menuCategorySql))));
router.get('/brands',ah(async(req,res)=>ok(res,(await safeMany(brandSql)).map(mapBrand))));
router.get('/banners',ah(async(req,res)=>ok(res,await safeMany(`SELECT id,title,subtitle,description,image imageUrl,action_type actionType,action_value actionValue,position,priority FROM banners WHERE COALESCE(enabled,1)=1 ORDER BY priority DESC,id DESC LIMIT 20`))));
router.get('/products',ah(async(req,res)=>{
  const {limit,offset}=page(req);
  const q=String(req.query.search||req.query.q||'').trim();
  const store=String(req.query.store||req.query.restaurantSlug||req.query.restaurant||'').trim();
  const brand=String(req.query.brand||req.query.brandSlug||req.query.brand_slug||'').trim();
  const brandId=req.query.brandId||req.query.brand_id||null;
  const restaurantId=req.query.restaurantId||req.query.restaurant_id||null;
  const sql=productSelect+` WHERE COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1
    AND (:q='' OR p.title LIKE CONCAT('%',:q,'%') OR p.name LIKE CONCAT('%',:q,'%') OR p.subtitle LIKE CONCAT('%',:q,'%'))
    AND (:store='' OR r.slug=:store OR r.id=:store)
    AND (:restaurantId IS NULL OR p.restaurant_id=:restaurantId)
    AND (:brand='' OR b.slug=:brand OR b.title=:brand OR b.name=:brand)
    AND (:brandId IS NULL OR p.brand_id=:brandId)
    ORDER BY p.id DESC LIMIT :limit OFFSET :offset`;
  const rows=await safeMany(sql,{q,store,brand,brandId,restaurantId,limit,offset});
  ok(res,rows.map(mapProduct));
}));
router.get('/products/:slug',ah(async(req,res)=>{const p=await safeOne(productSelect+` WHERE p.slug=:slug OR p.id=:slug`,{slug:req.params.slug}); ok(res,mapProduct(p||{}));}));
router.get('/restaurants',ah(async(req,res)=>ok(res,(await safeMany(restaurantSql+' LIMIT 50')).map(mapRestaurant))));
router.get('/restaurants/nearby',ah(async(req,res)=>ok(res,(await safeMany(restaurantSql+' LIMIT 50')).map(mapRestaurant))));
router.get('/restaurants/:id/delivery-check',(req,res)=>ok(res,{available:true,deliveryFee:30,distanceKm:2.5,message:'Delivery available'}));
router.get('/restaurants/:slug',ah(async(req,res)=>ok(res,mapRestaurant(await safeOne('SELECT *, COALESCE(image_url,logo) imageUrl, COALESCE(is_open,open,1) isOpen FROM restaurants WHERE slug=:slug OR id=:slug',{slug:req.params.slug})||{}))));
router.get('/stores/:slug',ah(async(req,res)=>ok(res,mapRestaurant(await safeOne('SELECT *, COALESCE(image_url,logo) imageUrl, COALESCE(is_open,open,1) isOpen FROM restaurants WHERE slug=:slug OR id=:slug',{slug:req.params.slug})||{}))));
router.post('/stores/map',(req,res)=>ok(res,{mapped:true}));
router.get(['/stores/:slug/menu','/restaurants/:slug/menu'],ah(async(req,res)=>{const r=await safeOne('SELECT * FROM restaurants WHERE slug=:slug OR id=:slug',{slug:req.params.slug}); const rid=r?.id||null; const products=await safeMany(productSelect+` WHERE (:rid IS NULL OR p.restaurant_id=:rid) AND COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 ORDER BY p.menu_category_id,p.id`,{rid}); const menuCategories=await safeMany(`SELECT DISTINCT mc.id, mc.title name, mc.title, mc.slug, mc.sort_order, mc.restaurant_id FROM menu_categories mc JOIN products p ON p.menu_category_id=mc.id WHERE (:rid IS NULL OR p.restaurant_id=:rid) AND COALESCE(mc.deleted,0)=0 AND COALESCE(mc.enabled,1)=1 AND COALESCE(p.deleted,0)=0 AND COALESCE(p.available,1)=1 ORDER BY mc.sort_order,mc.id`,{rid}); ok(res,{restaurant:mapRestaurant(r||{}),categories:[{id:0,title:'All',name:'All',slug:'all'},...menuCategories],menuCategories:[{id:0,title:'All',name:'All',slug:'all'},...menuCategories],products:products.map(mapProduct),menu:products.map(mapProduct)});}));
router.get('/delivery/distance',(req,res)=>ok(res,{distanceKm:2.5,deliveryFee:30,available:true}));
router.post('/delivery/validate',(req,res)=>ok(res,{available:true,deliveryFee:30,message:'Delivery available'}));
router.post('/orders/validate-delivery',(req,res)=>ok(res,{available:true,deliveryFee:30,message:'Delivery available'}));
router.get('/offers',ah(async(req,res)=>ok(res,await safeMany(`SELECT * FROM offers WHERE COALESCE(active,1)=1 ORDER BY sort_order,id DESC`))));
router.post('/offers/verify',ah(async(req,res)=>{const code=(req.body.code||req.body.couponCode||'').toUpperCase(); const c=await safeOne('SELECT * FROM coupons WHERE code=:code AND COALESCE(enabled,active,1)=1',{code}); ok(res,{valid:!!c,coupon:c,discount:c?Number(c.value||c.discount_value||0):0},c?'Coupon applied':'Invalid coupon');}));
router.post('/coupons/validate',ah(async(req,res)=>{const code=(req.body.code||'').toUpperCase(); const c=await safeOne('SELECT * FROM coupons WHERE code=:code AND COALESCE(enabled,active,1)=1',{code}); ok(res,{valid:!!c,coupon:c,discount:c?Number(c.value||c.discount_value||0):0});}));
router.get('/payment/options',ah(async(req,res)=>{const s=await safeOne('SELECT * FROM platform_settings ORDER BY id DESC LIMIT 1'); ok(res,{cod:true,codEnabled:s?bitBool(s.cod_enabled,true):true,online:true,onlinePaymentEnabled:s?bitBool(s.online_payment_enabled,false):true,providers:['RAZORPAY'],currency:'INR',razorpayKeyId:s?.razorpay_key_id||process.env.RAZORPAY_KEY_ID||''});}));
router.get(['/payments/settings','/payment/settings'],ah(async(req,res)=>{const s=await safeOne('SELECT * FROM payment_settings ORDER BY id DESC LIMIT 1'); ok(res,{codEnabled:s?bitBool(s.cod_enabled,true):true,onlineEnabled:s?bitBool(s.online_payment_enabled,false):true,onlinePaymentEnabled:s?bitBool(s.online_payment_enabled,false):true,razorpayEnabled:true,razorpayConfigured:!!(s?.razorpay_key_id||process.env.RAZORPAY_KEY_ID),currency:'INR',razorpayKeyId:s?.razorpay_key_id||process.env.RAZORPAY_KEY_ID||'',razorpayMode:s?.razorpay_mode||'TEST'});}));
router.get('/platform/settings',ah(async(req,res)=>{const s=await safeOne('SELECT * FROM platform_settings ORDER BY id DESC LIMIT 1'); if(!s) return ok(res,{platformFee:5,deliveryBaseFee:30,currency:'INR',autoCancelMinutes:60,codEnabled:true,onlinePaymentEnabled:true,razorpayConfigured:!!process.env.RAZORPAY_KEY_ID,razorpayKeyId:process.env.RAZORPAY_KEY_ID||'',mrBreadoTakeawayEnabled:true,takeawayOnlineRequired:false,takeawayBookingFeePercent:20}); ok(res,{...s,codEnabled:bitBool(s.cod_enabled,true),onlinePaymentEnabled:bitBool(s.online_payment_enabled,false),onlineEnabled:bitBool(s.online_payment_enabled,false),razorpayConfigured:!!(s.razorpay_key_id||process.env.RAZORPAY_KEY_ID),razorpayKeyId:s.razorpay_key_id||process.env.RAZORPAY_KEY_ID||'',razorpayMode:s.razorpay_mode||'TEST',mrBreadoTakeawayEnabled:bitBool(s.mr_breado_takeaway_enabled,false),takeawayOnlineRequired:false,takeawayBookingFeePercent:Number(s.takeaway_booking_fee_percent||20),deliveryChargePerKm:Number(s.delivery_charge_per_km||0),minimumDeliveryCharge:Number(s.minimum_delivery_charge||0),maximumDeliveryCharge:Number(s.maximum_delivery_charge||0),currency:'INR',autoCancelMinutes:60});}));
module.exports=router;
