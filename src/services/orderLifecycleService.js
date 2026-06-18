const { pool } = require('../utils/db');

const ALIASES = Object.freeze({
  PLACED: 'RECEIVED', PENDING: 'RECEIVED', CONFIRMED: 'ACCEPTED', COOKING: 'PREPARING',
  PREPARED: 'READY', OUT_FOR_DELIVERY: 'PICKED_UP', COMPLETED: 'DELIVERED',
  DECLINED: 'REJECTED', PAYMENT_PENDING: 'PENDING_PAYMENT', PAYMENT_FAILED: 'PAYMENT_FAILED',
});

const TRANSITIONS = Object.freeze({
  PENDING_PAYMENT: new Set(['RECEIVED','PAYMENT_FAILED','CANCELLED']),
  PAYMENT_FAILED: new Set([]),
  RECEIVED: new Set(['ACCEPTED','REJECTED','CANCELLED']),
  ACCEPTED: new Set(['PREPARING','CANCELLED']),
  PREPARING: new Set(['READY','CANCELLED']),
  READY: new Set(['RIDER_ASSIGNMENT_PENDING','RIDER_ASSIGNED','PICKED_UP','DELIVERED','CANCELLED']),
  RIDER_ASSIGNMENT_PENDING: new Set(['RIDER_ASSIGNED','CANCELLED']),
  RIDER_ASSIGNED: new Set(['PICKED_UP','CANCELLED']),
  PICKED_UP: new Set(['DELIVERED']),
  DELIVERED: new Set([]), REJECTED: new Set([]), CANCELLED: new Set(['REFUND_PENDING']),
  REFUND_PENDING: new Set(['REFUNDED']), REFUNDED: new Set([]),
});

function canonicalStatus(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ALIASES[raw] || raw;
}

function canTransition(from, to, { takeaway = false } = {}) {
  const a = canonicalStatus(from); const b = canonicalStatus(to);
  if (!a || !b || a === b) return false;
  if (takeaway && ['RIDER_ASSIGNMENT_PENDING','RIDER_ASSIGNED','PICKED_UP'].includes(b)) return false;
  return Boolean(TRANSITIONS[a]?.has(b));
}

async function transitionOrder({ orderId, toStatus, actor, reason = null, idempotencyKey = null }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM orders WHERE id=? FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
    const from = canonicalStatus(order.status);
    const to = canonicalStatus(toStatus);
    const takeaway = ['TAKEAWAY','PICKUP'].includes(String(order.fulfilment_type || order.order_type || '').toUpperCase());
    if (!canTransition(from, to, { takeaway })) {
      throw Object.assign(new Error(`Invalid order transition: ${from} -> ${to}`), { status: 409, code: 'INVALID_ORDER_TRANSITION' });
    }
    if (idempotencyKey) {
      const [existing] = await connection.execute('SELECT id FROM order_events WHERE idempotency_key=? LIMIT 1', [idempotencyKey]);
      if (existing.length) { await connection.rollback(); return { order, duplicate: true }; }
    }
    await connection.execute('UPDATE orders SET status=?, updated_at=NOW(6) WHERE id=?', [to, orderId]);
    await connection.execute(`INSERT INTO order_events(order_id,outlet_id,previous_status,new_status,actor_type,actor_id,reason,metadata,idempotency_key,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,NOW(6))`, [orderId, order.outlet_id || order.selected_outlet_id || order.restaurant_id || null, from, to,
      String(actor?.role || 'SYSTEM').toUpperCase(), actor?.id || null, reason, JSON.stringify({ source: 'canonical-lifecycle' }), idempotencyKey]);
    await connection.commit();
    return { ...order, status: to, previousStatus: from, duplicate: false };
  } catch (error) { try { await connection.rollback(); } catch (_) {} throw error; }
  finally { connection.release(); }
}

module.exports = { canonicalStatus, canTransition, transitionOrder, TRANSITIONS };
