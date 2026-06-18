-- Compatibility-safe additive migration. Review on a staging clone before production.
CREATE TABLE IF NOT EXISTS schema_migrations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  migration_name VARCHAR(190) NOT NULL UNIQUE,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

ALTER TABLE payment_transactions ADD COLUMN updated_at DATETIME(6) NULL;
ALTER TABLE payment_transactions ADD COLUMN failure_reason VARCHAR(600) NULL;
ALTER TABLE payment_transactions ADD COLUMN failed_at DATETIME(6) NULL;
ALTER TABLE payment_transactions ADD COLUMN paid_at DATETIME(6) NULL;
ALTER TABLE payment_transactions ADD COLUMN provider_response LONGTEXT NULL;
ALTER TABLE payment_transactions ADD COLUMN idempotency_key VARCHAR(128) NULL;
CREATE UNIQUE INDEX uq_payment_provider_order ON payment_transactions(provider, provider_order_id);
CREATE UNIQUE INDEX uq_payment_provider_payment ON payment_transactions(provider, provider_payment_id);
CREATE UNIQUE INDEX uq_payment_idempotency ON payment_transactions(idempotency_key);
CREATE INDEX idx_payment_user_status_created ON payment_transactions(user_id, status, created_at);

ALTER TABLE orders ADD COLUMN outlet_id BIGINT NULL;
ALTER TABLE orders ADD COLUMN client_request_id VARCHAR(128) NULL;
ALTER TABLE orders ADD COLUMN refund_status VARCHAR(40) NULL;
ALTER TABLE orders ADD COLUMN invoice_number VARCHAR(80) NULL;
ALTER TABLE orders ADD COLUMN invoice_generated_at DATETIME(6) NULL;
UPDATE orders SET outlet_id=COALESCE(outlet_id,selected_outlet_id,restaurant_id) WHERE outlet_id IS NULL;
CREATE UNIQUE INDEX uq_orders_client_request ON orders(client_request_id);
CREATE INDEX idx_orders_outlet_status_created ON orders(outlet_id,status,created_at);
CREATE INDEX idx_orders_user_created ON orders(user_id,created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  outlet_id BIGINT NULL,
  previous_status VARCHAR(50) NULL,
  new_status VARCHAR(50) NOT NULL,
  actor_type VARCHAR(40) NOT NULL,
  actor_id BIGINT NULL,
  reason VARCHAR(700) NULL,
  metadata JSON NULL,
  idempotency_key VARCHAR(128) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_order_event_idempotency(idempotency_key),
  KEY idx_order_events_order_created(order_id,created_at),
  CONSTRAINT fk_order_events_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outlet_food_inventory (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  outlet_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  enabled BIT(1) NOT NULL DEFAULT b'1',
  available BIT(1) NOT NULL DEFAULT b'1',
  stock_quantity INT NOT NULL DEFAULT 0,
  reserved_quantity INT NOT NULL DEFAULT 0,
  low_stock_threshold INT NOT NULL DEFAULT 5,
  price_override DECIMAL(12,2) NULL,
  offer_price_override DECIMAL(12,2) NULL,
  version BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_outlet_food(outlet_id,product_id),
  KEY idx_outlet_food_available(outlet_id,enabled,available),
  CONSTRAINT chk_outlet_food_stock CHECK(stock_quantity >= 0 AND reserved_quantity >= 0 AND reserved_quantity <= stock_quantity)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  outlet_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  movement_type VARCHAR(50) NOT NULL,
  quantity_before INT NOT NULL,
  quantity_change INT NOT NULL,
  quantity_after INT NOT NULL,
  reserved_before INT NOT NULL DEFAULT 0,
  reserved_after INT NOT NULL DEFAULT 0,
  reference_type VARCHAR(50) NULL,
  reference_id VARCHAR(128) NULL,
  reason VARCHAR(700) NULL,
  performed_by BIGINT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_inventory_movement_idempotency(idempotency_key),
  KEY idx_inventory_movement_lookup(outlet_id,product_id,created_at)
);

CREATE TABLE IF NOT EXISTS refunds (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  payment_transaction_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  outlet_id BIGINT NULL,
  amount DECIMAL(12,2) NOT NULL,
  cancellation_reason VARCHAR(700) NULL,
  gateway_refund_id VARCHAR(150) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  admin_acknowledgement VARCHAR(20) NULL,
  admin_note VARCHAR(700) NULL,
  processed_by BIGINT NULL,
  processed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY uq_refund_order_payment(order_id,payment_transaction_id),
  UNIQUE KEY uq_gateway_refund(gateway_refund_id),
  KEY idx_refunds_status_created(status,created_at),
  CONSTRAINT fk_refund_order FOREIGN KEY(order_id) REFERENCES orders(id),
  CONSTRAINT fk_refund_payment FOREIGN KEY(payment_transaction_id) REFERENCES payment_transactions(id)
);
