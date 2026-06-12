const crypto = require('crypto');
const Razorpay = require('razorpay');
const { one, exec } = require('../utils/db');
const paymentSettings = require('./paymentSettingsService');

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  try {
    const ab = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  } catch (_) {
    return false;
  }
}

function normalizeAmount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

async function configured() {
  const settings = await paymentSettings.activeSettings();
  return settings.configured && settings.onlineEnabled;
}

async function clientFromSettings() {
  const settings = await paymentSettings.activeSettings();
  if (!settings.configured) return { client: null, settings };
  return {
    settings,
    client: new Razorpay({ key_id: settings.keyId, key_secret: settings.secret }),
  };
}

async function createOrder({ amount, amountInPaise, orderId, userId, currency = 'INR', restaurantId = null, sellerId = null }) {
  const amountRupees = normalizeAmount(amount || (amountInPaise ? Number(amountInPaise) / 100 : 0));
  if (amountRupees <= 0) throw Object.assign(new Error('Amount must be greater than zero'), { status: 400 });

  const { client, settings } = await clientFromSettings();
  if (!settings.onlineEnabled || !client) {
    throw Object.assign(new Error('Online payment is currently unavailable. Ask admin to enable Razorpay and save valid keys.'), { status: 503 });
  }

  const paise = Math.round(amountRupees * 100);
  const receipt = `mbr_${orderId || Date.now()}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);

  try {
    const o = await client.orders.create({
      amount: paise,
      currency,
      receipt,
      payment_capture: 1,
      notes: {
        orderId: String(orderId || ''),
        userId: String(userId || ''),
        restaurantId: String(restaurantId || ''),
        sellerId: String(sellerId || ''),
        app: 'mr_breado',
      },
    });

    const providerOrderId = o.id;
    const internalOrderId = orderId && /^\d+$/.test(String(orderId)) ? Number(orderId) : null;
    const r = await exec(
      `INSERT INTO payment_transactions
       (order_id,user_id,provider,provider_order_id,amount,currency,status,provider_response,created_at,updated_at)
       VALUES (:orderId,:userId,'RAZORPAY',:providerOrderId,:amount,:currency,'CREATED',:raw,NOW(6),NOW(6))`,
      { orderId: internalOrderId, userId: userId || null, providerOrderId, amount: amountRupees, currency, raw: JSON.stringify(o) }
    );

    await paymentSettings.audit('RAZORPAY_ORDER_CREATED', {
      userId,
      orderId: internalOrderId,
      restaurantId,
      sellerId,
      paymentTransactionId: r.insertId,
      providerOrderId,
      amount: amountRupees,
      status: 'CREATED',
      raw: o,
    });

    return {
      id: r.insertId,
      paymentTransactionId: r.insertId,
      provider: 'RAZORPAY',
      keyId: settings.keyId,
      key: settings.keyId,
      razorpayKeyId: settings.keyId,
      razorpay_key_id: settings.keyId,
      razorpayOrderId: providerOrderId,
      razorpay_order_id: providerOrderId,
      providerOrderId,
      provider_order_id: providerOrderId,
      orderId: providerOrderId,
      internalOrderId,
      amount: amountRupees,
      amountRupees,
      amountPaise: paise,
      amountInPaise: paise,
      amount_in_paise: paise,
      currency,
      mode: settings.mode,
      raw: o,
    };
  } catch (error) {
    await paymentSettings.audit('RAZORPAY_ORDER_CREATE_FAILED', {
      userId,
      orderId,
      restaurantId,
      sellerId,
      amount: amountRupees,
      status: 'FAILED',
      message: error.message,
      raw: error?.error || error,
    });
    throw Object.assign(new Error(error?.error?.description || error.message || 'Unable to create Razorpay order.'), { status: 502 });
  }
}

async function verify(body, authUser = {}) {
  const providerOrderId = body.razorpay_order_id || body.razorpayOrderId || body.providerOrderId || body.provider_order_id || body.orderId;
  const paymentId = body.razorpay_payment_id || body.razorpayPaymentId || body.providerPaymentId || body.provider_payment_id || body.paymentId;
  const signature = body.razorpay_signature || body.razorpaySignature || body.providerSignature || body.provider_signature || body.signature;
  if (!providerOrderId || !paymentId || !signature) throw Object.assign(new Error('Payment verification fields are required'), { status: 400 });

  const txBefore = await one('SELECT * FROM payment_transactions WHERE provider_order_id=:providerOrderId', { providerOrderId });
  const { settings } = await clientFromSettings();
  if (!settings.configured) throw Object.assign(new Error('Razorpay is not configured by admin.'), { status: 503 });

  const expected = crypto.createHmac('sha256', settings.secret).update(`${providerOrderId}|${paymentId}`).digest('hex');
  if (!safeEqualHex(expected, signature)) {
    await exec(
      `UPDATE payment_transactions SET provider_payment_id=:paymentId, provider_signature=:signature,
       status='FAILED', failure_reason='Invalid Razorpay signature', failed_at=NOW(6), provider_response=:raw, updated_at=NOW(6)
       WHERE provider_order_id=:providerOrderId`,
      { paymentId, signature, raw: JSON.stringify(body), providerOrderId }
    );
    await paymentSettings.audit('RAZORPAY_SIGNATURE_INVALID', {
      userId: authUser.id || body.userId || txBefore?.user_id,
      orderId: txBefore?.order_id || body.internalOrderId || body.appOrderId,
      paymentTransactionId: txBefore?.id,
      providerOrderId,
      providerPaymentId: paymentId,
      amount: txBefore?.amount || body.amount,
      status: 'FAILED',
      message: 'Invalid Razorpay signature',
      raw: body,
    });
    throw Object.assign(new Error('Payment verification failed. Invalid Razorpay signature.'), { status: 400 });
  }

  await exec(
    `UPDATE payment_transactions SET provider_payment_id=:paymentId, provider_signature=:signature,
     status='SUCCESS', paid_at=NOW(6), provider_response=:raw, updated_at=NOW(6)
     WHERE provider_order_id=:providerOrderId`,
    { paymentId, signature, raw: JSON.stringify(body), providerOrderId }
  );

  let tx = await one('SELECT * FROM payment_transactions WHERE provider_order_id=:providerOrderId', { providerOrderId });
  if (!tx) {
    const amount = Number(body.amount || body.amountRupees || 0);
    const r = await exec(
      `INSERT INTO payment_transactions
       (user_id,provider,provider_order_id,provider_payment_id,provider_signature,amount,currency,status,paid_at,provider_response,created_at,updated_at)
       VALUES(:userId,'RAZORPAY',:providerOrderId,:paymentId,:signature,:amount,:currency,'SUCCESS',NOW(6),:raw,NOW(6),NOW(6))`,
      { userId: authUser.id || body.userId || null, providerOrderId, paymentId, signature, amount, currency: body.currency || 'INR', raw: JSON.stringify(body) }
    );
    tx = await one('SELECT * FROM payment_transactions WHERE id=:id', { id: r.insertId });
  }

  const internalOrderId = tx?.order_id || body.internalOrderId || body.appOrderId || (/^\d+$/.test(String(body.appOrderId || '')) ? Number(body.appOrderId) : null);
  if (internalOrderId) {
    await exec(
      `UPDATE orders SET payment_status='PAID', status=CASE WHEN status='PENDING' THEN 'PLACED' ELSE status END,
       razorpay_order_id=COALESCE(razorpay_order_id,:providerOrderId), razorpay_payment_id=COALESCE(razorpay_payment_id,:paymentId),
       razorpay_signature=COALESCE(razorpay_signature,:signature), updated_at=NOW(6) WHERE id=:id`,
      { id: internalOrderId, providerOrderId, paymentId, signature }
    );
  }

  await paymentSettings.audit('RAZORPAY_PAYMENT_VERIFIED', {
    userId: authUser.id || body.userId || tx?.user_id,
    orderId: internalOrderId || tx?.order_id,
    paymentTransactionId: tx?.id,
    providerOrderId,
    providerPaymentId: paymentId,
    amount: tx?.amount || body.amount,
    status: 'SUCCESS',
    raw: body,
  });

  return {
    verified: true,
    status: 'SUCCESS',
    transactionId: tx?.id || null,
    paymentTransactionId: tx?.id || null,
    orderId: internalOrderId || tx?.order_id || null,
    razorpayOrderId: providerOrderId,
    razorpay_order_id: providerOrderId,
    razorpayPaymentId: paymentId,
    razorpay_payment_id: paymentId,
  };
}

module.exports = { createOrder, verify, configured };
