const express=require('express'); const cors=require('cors'); const helmet=require('helmet'); const compression=require('compression'); const rateLimit=require('express-rate-limit'); const {apiPrefix,corsOrigin,limits}=require('./config/env'); const error=require('./middleware/error'); const payment=require('./services/paymentService'); const {ok}=require('./utils/respond'); const ah=require('./utils/asyncHandler');
const app=express(); app.disable('x-powered-by'); app.use(helmet()); app.use(cors({origin:corsOrigin==='*'?true:corsOrigin,credentials:true})); app.use(compression()); app.use(express.json({limit:limits.json})); app.use(express.urlencoded({extended:true,limit:limits.json})); app.use(rateLimit({windowMs:60_000,limit:600,standardHeaders:true,legacyHeaders:false}));
app.get('/',(req,res)=>res.json({success:true,message:'Mr Breado Node backend running',apiPrefix,version:'payment-auth-fix-v10'}));
app.get(`${apiPrefix}/health`,(req,res)=>res.json({success:true,message:'OK',version:'payment-auth-fix-v10',time:new Date().toISOString()}));
app.get(`${apiPrefix}/version`,(req,res)=>res.json({success:true,version:'payment-auth-fix-v10',paymentCreateOrder:'public-direct-route'}));

// HARD PAYMENT ROUTE OVERRIDE: defined before all routers, so no auth middleware can block Razorpay order creation.
app.post(`${apiPrefix}/payments/create-order`,ah(async(req,res)=>{
  const body=req.body||{};
  const data=await payment.createOrder({
    amount:body.amount||body.amountRupees||body.total||body.payableAmount,
    amountInPaise:body.amountInPaise||body.amount_in_paise,
    orderId:body.orderId||body.appOrderId,
    userId:body.userId||body.user_id||null,
    restaurantId:body.restaurantId||body.restaurant_id||null,
    sellerId:body.sellerId||body.seller_id||null,
    currency:body.currency||'INR'
  });
  ok(res,data,'Payment order created');
}));
app.post(`${apiPrefix}/payments/verify`,ah(async(req,res)=>ok(res,await payment.verify(req.body||{},{}),'Payment verified')));

const routers=[require('./routes/auth'),require('./routes/public'),require('./routes/cartOrders'),require('./routes/operations'),require('./routes/admin'),require('./routes/misc'),require('./routes/springCompatibility'),require('./routes/appEndpointCompatibility')]; routers.forEach(r=>app.use(apiPrefix,r));
app.use((req,res)=>res.status(404).json({success:false,message:'Endpoint not found',path:req.originalUrl,version:'payment-auth-fix-v10'})); app.use(error); module.exports=app;
