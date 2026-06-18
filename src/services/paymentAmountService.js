const { one, many } = require('../utils/db');
const paymentSettings = require('./paymentSettingsService');

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function amountFromOwnedOrder(orderId, userId) {
  if (!orderId) return null;
  const order = await one(
    `SELECT id,user_id,restaurant_id,selected_outlet_id,
            COALESCE(grand_total,total,total_amount,0) payable_amount,
            payment_status,status
       FROM orders
      WHERE id=:orderId AND user_id=:userId
      LIMIT 1`,
    { orderId, userId }
  );
  if (!order) {
    const error = new Error('Order not found for the authenticated customer');
    error.status = 404;
    throw error;
  }
  const amount = money(order.payable_amount);
  if (amount <= 0) {
    const error = new Error('Order payable amount is invalid');
    error.status = 409;
    throw error;
  }
  return { amount, orderId: order.id, outletId: order.selected_outlet_id || order.restaurant_id || null, source: 'ORDER' };
}

async function amountFromCart(userId) {
  const cart = await one('SELECT id,restaurant_id FROM carts WHERE user_id=:userId ORDER BY id DESC LIMIT 1', { userId });
  if (!cart) {
    const error = new Error('Cart is empty');
    error.status = 400;
    throw error;
  }
  const items = await many(
    `SELECT ci.quantity,
            COALESCE(NULLIF(p.discount_price,0),p.price,0) current_price
       FROM cart_items ci
       JOIN products p ON p.id=ci.product_id
      WHERE ci.cart_id=:cartId AND COALESCE(p.available,1)=1`,
    { cartId: cart.id }
  );
  if (!items.length) {
    const error = new Error('Cart is empty');
    error.status = 400;
    throw error;
  }
  const subtotal = money(items.reduce((sum, item) => sum + money(item.current_price) * Math.max(1, Number(item.quantity || 1)), 0));
  const settings = await paymentSettings.activeSettings();
  const platform = settings.platform || {};
  const deliveryFee = money(platform.minimum_delivery_charge || 0);
  const platformFee = money(process.env.DEFAULT_PLATFORM_FEE || 5);
  const amount = money(subtotal + deliveryFee + platformFee);
  return { amount, orderId: null, outletId: cart.restaurant_id || null, source: 'CART', subtotal, deliveryFee, platformFee };
}

async function resolveAuthoritativeAmount({ orderId, userId }) {
  if (!userId) {
    const error = new Error('Authentication required');
    error.status = 401;
    throw error;
  }
  return orderId ? amountFromOwnedOrder(orderId, userId) : amountFromCart(userId);
}

module.exports = { resolveAuthoritativeAmount, money };
