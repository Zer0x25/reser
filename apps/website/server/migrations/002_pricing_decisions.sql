CREATE TABLE IF NOT EXISTS pricing_decisions (
  id TEXT PRIMARY KEY,
  quote_hash TEXT NOT NULL,
  reservation_id TEXT REFERENCES reservations(id),
  channel TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  lane_count INTEGER NOT NULL,
  base_clp INTEGER NOT NULL,
  catalog_price_clp INTEGER NOT NULL,
  promotion_discount_clp INTEGER NOT NULL,
  dynamic_discount_clp INTEGER NOT NULL,
  dynamic_potential_clp INTEGER NOT NULL,
  total_clp INTEGER NOT NULL,
  risk_points INTEGER,
  signals_json TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  config_snapshot_json TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  offered_at INTEGER NOT NULL,
  expires_at INTEGER,
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS pricing_decisions_start_idx
  ON pricing_decisions(start_ms, channel, config_version);
CREATE INDEX IF NOT EXISTS pricing_decisions_reservation_idx
  ON pricing_decisions(reservation_id);
