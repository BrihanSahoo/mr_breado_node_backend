const crypto = require('crypto');
const Razorpay = require('razorpay');
const { razorpay } = require('../config/env');
const { one, exec } = require('../utils/db');

function client(){
  if(!razorpay.keyId || !razorpay.keySecret) return null;
  return new Razorpay({key_id:razorpay.keyId,key_secret:razorpay.keySecret});
}
function safeEqualHex(a,b){
  if(!a || !b) return false;
  const ab=Buffer.from(String(a),'hex');
  const bb=Buffer.from(String(b),'hex');
  if(ab.length!==bb.length) return false;
  return crypto.timingSafeEqual(ab,bb);
}
async function createOrder({amount, orderId, userId, currency='INR'}){
  amount=Number(amount||0);
  if(amount<=0) throw Object.assign(new Error('Amount must be greater than zero'),{status:400});
  const rp=client();
  let providerOrderId='mock_order_'+Date.now();
  let raw={mock:true};
  if(rp){
    const o=await rp.orders.create({
      amount: Math.round(amount*100),
      currency,
      receipt: `order_${orderId||Date.now()}`.slice(0,40),
      notes:{ orderId:String(orderId||''), userId:String(userId||'') }
    });
    providerOrderId=o.id; raw=o;
  }
  const internalOrderId = orderId && /^\d+$/.test(String(orderId)) ? Number(orderId) : null;
  const r=await exec('INSERT INTO payment_transactions(order_id,user_id,provider_order_id,amount,currency,status,provider_response) VALUES(:orderId,:userId,:providerOrderId,:amount,:currency,:status,CAST(:raw AS JSON))',{orderId:internalOrderId,userId:userId||null,providerOrderId,amount,currency,status:'CREATED',raw:JSON.stringify(raw)});
  return {
    id:r.insertId,
    provider:'RAZORPAY',
    keyId:razorpay.keyId,
    key:razorpay.keyId,
    razorpayOrderId:providerOrderId,
    razorpay_order_id:providerOrderId,
    orderId:providerOrderId,
    internalOrderId:internalOrderId,
    amount,
    amountPaise:Math.round(amount*100),
    currency,
    mock:!rp,
    raw
  };
}
async function verify(body){
  const providerOrderId=body.razorpay_order_id||body.razorpayOrderId||body.providerOrderId;
  const paymentId=body.razorpay_payment_id||body.razorpayPaymentId||body.paymentId;
  const signature=body.razorpay_signature||body.razorpaySignature||body.signature;
  if(!providerOrderId || !paymentId || !signature) throw Object.assign(new Error('Payment verification fields are required'),{status:400});
  if(razorpay.keySecret){
    const expected=crypto.createHmac('sha256',razorpay.keySecret).update(`${providerOrderId}|${paymentId}`).digest('hex');
    if(!safeEqualHex(expected,signature)) throw Object.assign(new Error('Invalid Razorpay signature'),{status:400});
  }
  await exec('UPDATE payment_transactions SET provider_payment_id=:paymentId, provider_signature=:signature, status="CAPTURED", provider_response=CAST(:raw AS JSON) WHERE provider_order_id=:providerOrderId',{paymentId,signature,raw:JSON.stringify(body),providerOrderId});
  const tx=await one('SELECT * FROM payment_transactions WHERE provider_order_id=:providerOrderId',{providerOrderId});
  const internalOrderId = tx?.order_id || body.internalOrderId || body.appOrderId || (/^\d+$/.test(String(body.orderId||'')) ? Number(body.orderId) : null);
  if(internalOrderId) await exec('UPDATE orders SET payment_status="PAID", status=CASE WHEN status="PAYMENT_PENDING" THEN "PLACED" ELSE status END, razorpay_order_id=COALESCE(razorpay_order_id,:providerOrderId), razorpay_payment_id=COALESCE(razorpay_payment_id,:paymentId), razorpay_signature=COALESCE(razorpay_signature,:signature) WHERE id=:id',{id:internalOrderId,providerOrderId,paymentId,signature});
  return { verified:true, status:'CAPTURED', transactionId:tx?.id||null, orderId:internalOrderId||tx?.order_id||null, razorpayOrderId:providerOrderId, razorpay_payment_id:paymentId };
}
module.exports={createOrder,verify};
