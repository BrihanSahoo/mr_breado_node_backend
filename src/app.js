const express=require('express'); const cors=require('cors'); const helmet=require('helmet'); const compression=require('compression'); const rateLimit=require('express-rate-limit'); const {apiPrefix,corsOrigin,limits}=require('./config/env'); const error=require('./middleware/error'); const payment=require('./services/paymentService'); const {ok}=require('./utils/respond'); const ah=require('./utils/asyncHandler');
const app=express(); app.disable('x-powered-by'); app.use(helmet()); app.use(cors({origin:corsOrigin==='*'?true:corsOrigin,credentials:true})); app.use(compression()); app.use(express.json({limit:limits.json})); app.use(express.urlencoded({extended:true,limit:limits.json})); app.use(rateLimit({windowMs:60_000,limit:600,standardHeaders:true,legacyHeaders:false}));
app.get('/',(req,res)=>res.json({success:true,message:'Mr Breado Node backend running',apiPrefix,version:'v22-razorpay-locked-v26'}));
app.get(`${apiPrefix}/health`,(req,res)=>res.json({success:true,message:'OK',version:'v22-razorpay-locked-v26',time:new Date().toISOString()}));
app.get(`${apiPrefix}/version`,(req,res)=>res.json({success:true,version:'v32-verification-riders-native-spring-fix',paymentCreateOrder:'public-direct-route-null-safe',featureUpgrade:'v32',realData:'enabled',commerce:'verification-riders-native-spring-fixed',razorpay:'v22-locked-unchanged'}));



// V26 RAZORPAY LOCK: exact v22 create-order behavior, intercepted before every router/middleware.
// This prevents any old admin/seller/auth route from returning "Authentication failed" for Razorpay.
const razorpayCreatePaths = new Set([
  `${apiPrefix}/payments/create-order`,
  `${apiPrefix}/payment/create-order`,
  `${apiPrefix}/razorpay/create-order`,
  `${apiPrefix}/payments/razorpay/create-order`,
  `${apiPrefix}/checkout/razorpay/create-order`,
  `${apiPrefix}/checkout/payment/create-order`,
]);
const razorpayVerifyPaths = new Set([
  `${apiPrefix}/payments/verify`,
  `${apiPrefix}/payment/verify`,
  `${apiPrefix}/razorpay/verify`,
  `${apiPrefix}/payments/razorpay/verify`,
  `${apiPrefix}/checkout/razorpay/verify`,
  `${apiPrefix}/checkout/payment/verify`,
]);
app.post(Array.from(razorpayCreatePaths), ah(async (req, res) => {
  const body = req.body || {};
  const data = await payment.createOrder({
    amount: body.amount || body.amountRupees || body.total || body.payableAmount,
    amountInPaise: body.amountInPaise || body.amount_in_paise,
    orderId: body.orderId || body.appOrderId,
    userId: body.userId || body.user_id || null,
    restaurantId: body.restaurantId || body.restaurant_id || null,
    sellerId: body.sellerId || body.seller_id || null,
    currency: body.currency || 'INR',
  });
  ok(res, data, 'Payment order created');
}));
app.post(Array.from(razorpayVerifyPaths), ah(async (req, res) => ok(res, await payment.verify(req.body || {}, {}), 'Payment verified')));

// DIRECT PUBLIC AUTH OVERRIDE: must stay before all routers and before any middleware that could require auth.
// This guarantees seller/admin Flutter app can always login through /api/auth/login or /api/admin/login.
const authService = require('./services/authService');
app.post([`${apiPrefix}/auth/login`, `${apiPrefix}/login`, `${apiPrefix}/admin/login`, `${apiPrefix}/admin/auth/login`], ah(async (req, res) => {
  const result = await authService.login(req.body || {});
  ok(res, result, 'Login successful');
}));
app.post([`${apiPrefix}/auth/register`, `${apiPrefix}/register`], ah(async (req, res) => {
  const result = await authService.register(req.body || {});
  ok(res, result, 'Registered successfully', 201);
}));

const routers=[require('./routes/premiumReceiptsInvoicesV30'),require('./routes/orderReviewV30'),require('./routes/verificationRidersV32'),require('./routes/verificationAdminV31'),require('./routes/practicalAdminSellerV23'),require('./routes/realSpringFlowV22'),require('./routes/sellerAdminOrdersV19'),require('./routes/commerceV18'),require('./routes/commerceV17'),require('./routes/realDataV16'),require('./routes/featureUpgrade'),require('./routes/auth'),require('./routes/public'),require('./routes/cartOrders'),require('./routes/operations'),require('./routes/admin'),require('./routes/misc'),require('./routes/springCompatibility'),require('./routes/appEndpointCompatibility')]; routers.forEach(r=>app.use(apiPrefix,r));
app.use((req,res)=>res.status(404).json({success:false,message:'Endpoint not found',path:req.originalUrl,version:'v22-razorpay-locked-v26'})); app.use(error); module.exports=app;
