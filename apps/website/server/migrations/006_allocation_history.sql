ALTER TABLE allocations ADD COLUMN changed_at INTEGER NOT NULL DEFAULT 0;
UPDATE allocations SET changed_at=created_at WHERE changed_at=0;

CREATE TABLE IF NOT EXISTS allocation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  allocation_id TEXT NOT NULL REFERENCES allocations(id),
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  lane_id INTEGER NOT NULL REFERENCES lanes(id),
  reservation_start_ms INTEGER NOT NULL,
  reservation_end_ms INTEGER NOT NULL,
  effective_end_ms INTEGER,
  allocation_start_ms INTEGER NOT NULL,
  allocation_end_ms INTEGER NOT NULL,
  active_from INTEGER NOT NULL,
  active_to INTEGER,
  recorded_at INTEGER NOT NULL,
  is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  CHECK(active_to IS NULL OR active_to>=active_from)
);
CREATE INDEX IF NOT EXISTS allocation_history_reservation_time_idx
  ON allocation_history(reservation_start_ms,reservation_end_ms,lane_id);
CREATE INDEX IF NOT EXISTS allocation_history_assignment_time_idx
  ON allocation_history(active_from,active_to,allocation_id);

INSERT INTO allocation_history(
  allocation_id,reservation_id,lane_id,reservation_start_ms,reservation_end_ms,effective_end_ms,
  allocation_start_ms,allocation_end_ms,active_from,active_to,recorded_at,is_baseline
)
SELECT a.id,a.reservation_id,a.lane_id,r.start_ms,r.end_ms,r.effective_end_ms,
       a.start_ms,a.end_ms,0,NULL,a.created_at,1
FROM allocations a JOIN reservations r ON r.id=a.reservation_id
WHERE a.active=1;

CREATE TRIGGER IF NOT EXISTS allocations_history_insert
AFTER INSERT ON allocations WHEN NEW.active=1
BEGIN
  INSERT INTO allocation_history(
    allocation_id,reservation_id,lane_id,reservation_start_ms,reservation_end_ms,effective_end_ms,
    allocation_start_ms,allocation_end_ms,active_from,active_to,recorded_at,is_baseline
  )
  SELECT NEW.id,NEW.reservation_id,NEW.lane_id,r.start_ms,r.end_ms,r.effective_end_ms,
         NEW.start_ms,NEW.end_ms,COALESCE(NULLIF(NEW.changed_at,0),NEW.created_at),NULL,
         COALESCE(NULLIF(NEW.changed_at,0),NEW.created_at),0
  FROM reservations r WHERE r.id=NEW.reservation_id;
END;

CREATE TRIGGER IF NOT EXISTS allocations_history_update
AFTER UPDATE OF active,start_ms,end_ms,lane_id,changed_at ON allocations
WHEN OLD.active<>NEW.active OR OLD.start_ms<>NEW.start_ms OR OLD.end_ms<>NEW.end_ms
  OR OLD.lane_id<>NEW.lane_id OR OLD.changed_at<>NEW.changed_at
BEGIN
  UPDATE allocation_history
  SET active_to=MAX(NEW.changed_at,active_from)
  WHERE allocation_id=OLD.id AND active_to IS NULL;
  INSERT INTO allocation_history(
    allocation_id,reservation_id,lane_id,reservation_start_ms,reservation_end_ms,effective_end_ms,
    allocation_start_ms,allocation_end_ms,active_from,active_to,recorded_at,is_baseline
  )
  SELECT NEW.id,NEW.reservation_id,NEW.lane_id,r.start_ms,r.end_ms,r.effective_end_ms,
         NEW.start_ms,NEW.end_ms,NEW.changed_at,NULL,NEW.changed_at,0
  FROM reservations r WHERE r.id=NEW.reservation_id AND NEW.active=1;
END;
