CREATE TABLE IF NOT EXISTS pricing_quote_funnel (
  quote_token_hash TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel = 'web'),
  pricing_group TEXT NOT NULL CHECK (pricing_group IN ('dynamic_applied','dynamic_potential','standard')),
  offered_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  selected_at INTEGER,
  reserved_at INTEGER,
  CHECK (reserved_at IS NULL OR selected_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS pricing_quote_funnel_offered_idx
  ON pricing_quote_funnel(offered_at, channel, pricing_group);
