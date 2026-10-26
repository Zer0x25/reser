CREATE TABLE IF NOT EXISTS operational_config_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  effective_at INTEGER NOT NULL UNIQUE,
  recorded_at INTEGER NOT NULL,
  weekly_hours_json TEXT NOT NULL,
  exceptions_json TEXT NOT NULL,
  active_lane_ids_json TEXT NOT NULL,
  preparation_minutes INTEGER NOT NULL,
  is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1))
);
CREATE INDEX IF NOT EXISTS operational_config_history_effective_idx
  ON operational_config_history(effective_at);
