import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databaseDirectory = mkdtempSync(join(tmpdir(), "bowling-operational-history-"));
process.env.DATABASE_PATH = join(databaseDirectory, "test.sqlite");
process.env.MVP_MODE = "demo";
process.env.NODE_ENV = "test";

const { db, getSettings, saveSettings } = await import("./db.mjs");

test("the database seeds a baseline and records schedule changes as effective versions", () => {
  const history = db
    .prepare("SELECT * FROM operational_config_history ORDER BY effective_at")
    .all();
  assert.equal(history.length, 2);
  assert.equal(history[0].effective_at, 0);
  assert.equal(history[0].is_baseline, 1);
  assert.equal(history[1].is_baseline, 0);
  assert.deepEqual(
    JSON.parse(history[1].active_lane_ids_json),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );

  const settings = getSettings();
  const nextSettings = {
    ...settings,
    weeklyHours: {
      ...settings.weeklyHours,
      1: { open: "17:00", close: "22:00" },
    },
  };
  saveSettings(nextSettings, "history-test");

  const updatedHistory = db
    .prepare("SELECT * FROM operational_config_history ORDER BY effective_at")
    .all();
  assert.equal(updatedHistory.length, 3);
  assert.ok(updatedHistory[2].effective_at > updatedHistory[1].effective_at);
  assert.equal(updatedHistory[2].preparation_minutes, settings.preparationMinutes);
  assert.deepEqual(JSON.parse(updatedHistory[2].weekly_hours_json), nextSettings.weeklyHours);
});

test("allocation edits retain the prior lane and time interval", () => {
  const allocation = db
    .prepare("SELECT * FROM allocations WHERE active=1 ORDER BY created_at LIMIT 1")
    .get();
  assert.ok(allocation);
  const initial = db
    .prepare("SELECT * FROM allocation_history WHERE allocation_id=? ORDER BY id")
    .all(allocation.id);
  assert.equal(initial.length, 1);

  const changedAt = Math.max(Date.now(), initial[0].active_from + 1);
  db.prepare("UPDATE allocations SET end_ms=?,changed_at=? WHERE id=?").run(
    allocation.end_ms + 60_000,
    changedAt,
    allocation.id,
  );
  const edited = db
    .prepare("SELECT * FROM allocation_history WHERE allocation_id=? ORDER BY id")
    .all(allocation.id);
  assert.equal(edited.length, 2);
  assert.equal(edited[0].active_to, changedAt);
  assert.equal(edited[1].active_from, changedAt);
  assert.equal(edited[0].allocation_end_ms, allocation.end_ms);
  assert.equal(edited[1].allocation_end_ms, allocation.end_ms + 60_000);

  db.prepare("UPDATE allocations SET active=0,changed_at=? WHERE id=?").run(
    changedAt + 1,
    allocation.id,
  );
  const released = db
    .prepare("SELECT * FROM allocation_history WHERE allocation_id=? ORDER BY id DESC LIMIT 1")
    .get(allocation.id);
  assert.equal(released.active_to, changedAt + 1);
});

test.after(() => {
  db.close();
  rmSync(databaseDirectory, { recursive: true, force: true });
});
