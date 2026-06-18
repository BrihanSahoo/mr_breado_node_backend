-- Canonical lifecycle and authorization additions. Apply after 001.
CREATE TABLE IF NOT EXISTS outlet_seller_assignments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  outlet_id BIGINT NOT NULL,
  seller_id BIGINT NOT NULL,
  is_active BIT(1) NOT NULL DEFAULT b'1',
  assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  revoked_at DATETIME(6) NULL,
  UNIQUE KEY uq_outlet_seller(outlet_id,seller_id),
  KEY idx_seller_active(seller_id,is_active)
);

ALTER TABLE orders ADD COLUMN fulfilment_type VARCHAR(30) NULL;
ALTER TABLE orders ADD COLUMN order_type VARCHAR(30) NULL;
ALTER TABLE orders ADD COLUMN updated_at DATETIME(6) NULL;
CREATE INDEX idx_orders_driver_status ON orders(driver_id,status);

ALTER TABLE payment_transactions ADD COLUMN outlet_id BIGINT NULL;
ALTER TABLE payment_transactions ADD COLUMN tax DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payment_transactions ADD COLUMN delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0;
CREATE INDEX idx_payment_outlet_status_created ON payment_transactions(outlet_id,status,created_at);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  lock_name VARCHAR(120) PRIMARY KEY,
  owner_id VARCHAR(120) NOT NULL,
  locked_until DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
