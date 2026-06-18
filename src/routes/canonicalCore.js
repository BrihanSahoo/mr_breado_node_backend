const express = require('express');
const { requireAuth, role } = require('../middleware/auth');
const { transitionOrder } = require('../services/orderLifecycleService');
const { one } = require('../utils/db');
const ah = require('../utils/asyncHandler');
const { ok } = require('../utils/respond');
const router = express.Router();

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

router.patch(['/orders/:id/status','/seller/orders/:id/status','/rider/orders/:id/status'], requireAuth, ah(async (req,res) => {
  await assertOrderActor(req, req.params.id);
  const key = req.headers['idempotency-key'] || req.body?.idempotencyKey || null;
  const result = await transitionOrder({ orderId:req.params.id, toStatus:req.body?.status, actor:req.user, reason:req.body?.reason || null, idempotencyKey:key });
  ok(res, result, result.duplicate ? 'Order transition already processed' : 'Order status updated');
}));

router.get('/admin/security/ping', requireAuth, role('ADMIN'), (req,res) => ok(res,{adminId:req.user.id},'Authorized'));
module.exports = router;
