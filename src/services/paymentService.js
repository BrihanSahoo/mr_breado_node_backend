const crypto = require('crypto');
const Razorpay = require('razorpay');
const { razorpay } = require('../config/env');
const { one, exec } = require('../utils/db');

function configured() {
  return Boolean(razorpay.keyId && razorpay.keySecret && razorpay.keyId.startsWith('rzp_'));
}

function client(){
  if(!configured()) return null;
  return new Razorpay({key_id:razorpay.keyId,key_secret:razorpay.keySecret});
}

function safeEqualHex(a,b){
  if(!a || !b) return false;
  try {
    const ab=Buffer.from(String(a),'hex');
    const bb=Buffer.from(String(b),'hex');
    if(ab.length!==bb.length) return false;
    return crypto.timingSafeEqual(ab,bb);
  } catch (_) { return false; }
}

function normalizeAmount(value){
  const n=Number(value||0);
  if(!Number.isFinite(n) || n<=0) return 0;
  // Flutter sends rupees as amount and amountInPaise only as metadata.
  // If a caller accidentally sends paise in amount, do not double-convert huge values.
  return n;
}

async function createOrder({amount, amountInPaise, orderId, userId, currency='INR'}){
  const amountRupees = normalizeAmount(amount || (amountInPaise ? Number(amountInPaise)/100 : 0));
  if(amountRupees<=0) throw Object.assign(new Error('Amount must be greater than zero'),{status:400});

  const rp=client();
  if(!rp){
    throw Object.assign(new Error('Online payment is currently unavailable. Razorpay keys are not configured on the server.'),{status:503});
  }

  const paise = Math.round(amountRupees*100);
  const receipt = `mbr_${orderId||Date.now()}`.replace(/[^a-zA-Z0-9_]/g,'').slice(0,40);
  const o=await rp.orders.create({
    amount: paise,
    currency,
    receipt,
    payment_capture: 1,
    notes:{ orderId:String(orderId||''), userId:String(userId||''), app:'mr_breado' }
  });

  const providerOrderId=o.id;
  const internalOrderId = orderId && /^\d+$/.test(String(orderId)) ? Number(orderId) : null;
  const r=await exec(
    'INSERT INTO payment_transactions(order_id,user_id,provider_order_id,amount,currency,status,provider_response) VALUES(:orderId,:userId,:providerOrderId,:amount,:currency,:status,CAST(:raw AS JSON))',
    {orderId:internalOrderId,userId:userId||null,providerOrderId,amount:amountRupees,currency,status:'CREATED',raw:JSON.stringify(o)}
  );
  return {
    id:r.insertId,
    provider:'RAZORPAY',
    keyId:razorpay.keyId,
    key:razorpay.keyId,
    razorpayKeyId:razorpay.keyId,
    razorpayOrderId:providerOrderId,
    razorpay_order_id:providerOrderId,
    providerOrderId,
    provider_order_id:providerOrderId,
    orderId:providerOrderId,
    internalOrderId,
    amount:amountRupees,
    amountRupees,
    amountPaise:paise,
    amountInPaise:paise,
    amount_in_paise:paise,
    currency,
    raw:o
  };
}

async function verify(body){
  const providerOrderId=body.razorpay_order_id||body.razorpayOrderId||body.providerOrderId||body.provider_order_id||body.orderId;
  const paymentId=body.razorpay_payment_id||body.razorpayPaymentId||body.providerPaymentId||body.provider_payment_id||body.paymentId;
  const signature=body.razorpay_signature||body.razorpaySignature||body.providerSignature||body.provider_signature||body.signature;
  if(!providerOrderId || !paymentId || !signature) throw Object.assign(new Error('Payment verification fields are required'),{status:400});
  if(!configured()) throw Object.assign(new Error('Online payment is currently unavailable. Razorpay keys are not configured on the server.'),{status:503});

  const expected=crypto.createHmac('sha256',razorpay.keySecret).update(`${providerOrderId}|${paymentId}`).digest('hex');
  if(!safeEqualHex(expected,signature)) throw Object.assign(new Error('Invalid Razorpay signature'),{status:400});

  await exec(
    'UPDATE payment_transactions SET provider_payment_id=:paymentId, provider_signature=:signature, status="CAPTURED", provider_response=CAST(:raw AS JSON) WHERE provider_order_id=:providerOrderId',
    {paymentId,signature,raw:JSON.stringify(body),providerOrderId}
  );
  let tx=await one('SELECT * FROM payment_transactions WHERE provider_order_id=:providerOrderId',{providerOrderId});
  if(!tx){
    const amount = Number(body.amount || body.amountRupees || 0);
    const r = await exec(
      'INSERT INTO payment_transactions(user_id,provider_order_id,provider_payment_id,provider_signature,amount,currency,status,provider_response) VALUES(:userId,:providerOrderId,:paymentId,:signature,:amount,:currency,"CAPTURED",CAST(:raw AS JSON))',
      {userId:body.userId||null,providerOrderId,paymentId,signature,amount,currency:body.currency||'INR',raw:JSON.stringify(body)}
    );
    tx=await one('SELECT * FROM payment_transactions WHERE id=:id',{id:r.insertId});
  }

  const internalOrderId = tx?.order_id || body.internalOrderId || body.appOrderId || (/^\d+$/.test(String(body.appOrderId||'')) ? Number(body.appOrderId) : null);
  if(internalOrderId) await exec('UPDATE orders SET payment_status="PAID", status=CASE WHEN status="PAYMENT_PENDING" THEN "PLACED" ELSE status END, razorpay_order_id=COALESCE(razorpay_order_id,:providerOrderId), razorpay_payment_id=COALESCE(razorpay_payment_id,:paymentId), razorpay_signature=COALESCE(razorpay_signature,:signature) WHERE id=:id',{id:internalOrderId,providerOrderId,paymentId,signature});
  return { verified:true, status:'CAPTURED', transactionId:tx?.id||null, orderId:internalOrderId||tx?.order_id||null, razorpayOrderId:providerOrderId, razorpay_order_id:providerOrderId, razorpayPaymentId:paymentId, razorpay_payment_id:paymentId };
}
module.exports={createOrder,verify,configured};
