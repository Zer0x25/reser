CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS lanes (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 12),
  pair_id INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('reception','admin')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_proofs (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_requests (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  reservation_id TEXT,
  original_quote_clp INTEGER NOT NULL,
  current_quote_clp INTEGER,
  offer_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  idempotency_key TEXT UNIQUE,
  request_id TEXT UNIQUE REFERENCES booking_requests(id),
  customer_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  channel TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  players INTEGER NOT NULL CHECK(players BETWEEN 1 AND 72),
  lane_count INTEGER NOT NULL CHECK(lane_count BETWEEN 1 AND 12),
  group_mode TEXT NOT NULL CHECK(group_mode IN ('together','separated_accepted')),
  commercial_status TEXT NOT NULL,
  inventory_status TEXT NOT NULL,
  financial_status TEXT NOT NULL DEFAULT 'unpaid',
  quote_clp INTEGER NOT NULL DEFAULT 0,
  quote_json TEXT NOT NULL,
  terms_accepted_at INTEGER,
  manage_token_hash TEXT,
  manage_expires_at INTEGER,
  checked_in_at INTEGER,
  effective_start_ms INTEGER,
  effective_end_ms INTEGER,
  manual_lane_lock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS reservations_start_idx ON reservations(start_ms, end_ms, commercial_status);
CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  reservation_id TEXT REFERENCES reservations(id),
  lane_id INTEGER NOT NULL REFERENCES lanes(id),
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK(end_ms > start_ms)
);
CREATE INDEX IF NOT EXISTS allocations_lane_time_idx ON allocations(lane_id, start_ms, end_ms, active);
CREATE TRIGGER IF NOT EXISTS allocations_no_overlap
BEFORE INSERT ON allocations WHEN NEW.active = 1
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM allocations a WHERE a.lane_id = NEW.lane_id AND a.active = 1
      AND NEW.start_ms < a.end_ms AND NEW.end_ms > a.start_ms
  ) THEN RAISE(ABORT, 'lane allocation conflict') END;
END;
CREATE TABLE IF NOT EXISTS maintenance_blocks (
  id TEXT PRIMARY KEY,
  lane_id INTEGER REFERENCES lanes(id),
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  amount_clp INTEGER NOT NULL CHECK(amount_clp > 0),
  method TEXT NOT NULL CHECK(method IN ('cash','transfer','external_terminal','refund')),
  status TEXT NOT NULL CHECK(status IN ('reported','verified','refund_recorded','voided')),
  reference TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reservation_actions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  action TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  payload_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
