ALTER TABLE pricing_quote_funnel ADD COLUMN reservation_id TEXT REFERENCES reservations(id) ON DELETE SET NULL;
ALTER TABLE pricing_quote_funnel ADD COLUMN confirmed_at INTEGER;

CREATE INDEX IF NOT EXISTS pricing_quote_funnel_reservation_idx
  ON pricing_quote_funnel(reservation_id);

CREATE INDEX IF NOT EXISTS payments_reservation_idx
  ON payments(reservation_id);
