-- Category image compatibility and canonical outlet inventory protections.
ALTER TABLE food_categories MODIFY COLUMN image_url LONGTEXT NULL;
ALTER TABLE food_categories MODIFY COLUMN image LONGTEXT NULL;
ALTER TABLE food_categories MODIFY COLUMN icon LONGTEXT NULL;
CREATE UNIQUE INDEX uq_outlet_product_stock_outlet_product ON outlet_product_stock(outlet_id, product_id);
CREATE INDEX idx_outlet_product_stock_outlet_available ON outlet_product_stock(outlet_id, is_available);
CREATE INDEX idx_outlet_stock_movements_outlet_created ON outlet_stock_movements(outlet_id, created_at);
