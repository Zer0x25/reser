import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { formatLocalDate, localDateTimeToEpoch } from "./domain.mjs";

async function freePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startDemoApi(t) {
  const directory = await mkdtemp(join(tmpdir(), "bowling-reoptimization-"));
  const databasePath = join(directory, "test.sqlite");
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    globalThis.process.execPath,
    [new URL("./index.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        NODE_ENV: "development",
        MVP_MODE: "demo",
        DATABASE_PATH: databasePath,
        PORT: `${port}`,
        TOKEN_SECRET: "reoptimization-tests-secret-with-at-least-32-bytes",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let errorOutput = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    errorOutput += chunk;
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), sleep(1500)]);
    await rm(directory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* wait for listener */
    }
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  assert.equal(ready, true, `API did not start: ${errorOutput}`);
  return { base, databasePath };
}

async function login(base, email) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "BowlingDemo2026!" }),
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function createBooking({ base, cookie, date, time, key, name }) {
  const response = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: base,
    },
    body: JSON.stringify({
      idempotencyKey: key,
      channel: "counter_future",
      customerName: name,
      email: `${key}@example.test`,
      players: 4,
      startAt: `${date}T${time}`,
      durationMinutes: 60,
    }),
  });
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  return result.booking;
}

async function boardBookings(base, cookie, date) {
  const response = await fetch(`${base}/api/staff/board?date=${date}`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return (await response.json()).reservations;
}

test("reoptimization moves only flexible reservations, audits changes, and rolls back a blocked run", async (t) => {
  const { base, databasePath } = await startDemoApi(t);
  const receptionCookie = await login(base, "recepcion@demo.local");
  const adminCookie = await login(base, "admin@demo.local");
  const date = formatLocalDate(Date.now() + 3 * 86_400_000);

  const flexibleBookings = await Promise.all(
    ["flex-one", "flex-two"].map((key) =>
      createBooking({ base, cookie: receptionCookie, date, time: "18:00", key, name: key }),
    ),
  );
  const lockedBooking = await createBooking({
    base,
    cookie: receptionCookie,
    date,
    time: "18:00",
    key: "fixed-booking",
    name: "Reserva fijada",
  });

  const fixtureDb = new DatabaseSync(databasePath);
  fixtureDb.exec("PRAGMA busy_timeout = 5000");
  const assignLane = fixtureDb.prepare(
    "UPDATE allocations SET lane_id=? WHERE reservation_id=? AND active=1",
  );
  assignLane.run(11, flexibleBookings[0].id);
  assignLane.run(12, flexibleBookings[1].id);
  assignLane.run(10, lockedBooking.id);
  fixtureDb.prepare("UPDATE reservations SET manual_lane_lock=1 WHERE id=?").run(lockedBooking.id);
  fixtureDb.close();

  const optimized = await fetch(`${base}/api/staff/reoptimize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: receptionCookie,
      origin: base,
    },
    body: JSON.stringify({ date }),
  });
  const optimizedResult = await optimized.json();
  assert.equal(optimized.status, 200, JSON.stringify(optimizedResult));
  assert.equal(optimizedResult.examined, 2);
  assert.equal(optimizedResult.changed.length, 2);
  assert.ok(optimizedResult.changed.every((change) => change.from.length === 1));

  const firstBoard = await boardBookings(base, receptionCookie, date);
  for (const booking of flexibleBookings) {
    const current = firstBoard.find((item) => item.id === booking.id);
    assert.ok(current);
    assert.notDeepEqual(current.lanes, [11]);
    assert.notDeepEqual(current.lanes, [12]);
  }
  assert.deepEqual(firstBoard.find((item) => item.id === lockedBooking.id).lanes, [10]);

  const laterBooking = await createBooking({
    base,
    cookie: receptionCookie,
    date,
    time: "20:00",
    key: "rollback-booking",
    name: "Reserva para rollback",
  });
  const beforeRollback = await boardBookings(base, receptionCookie, date);
  const originalAssignments = new Map(beforeRollback.map((booking) => [booking.id, booking.lanes]));

  const rollbackDb = new DatabaseSync(databasePath);
  rollbackDb.exec("PRAGMA busy_timeout = 5000");
  rollbackDb
    .prepare(
      "INSERT INTO maintenance_blocks(id,lane_id,start_ms,end_ms,reason,status,created_at,created_by) VALUES(?,NULL,?,?,?,'active',?,'test-fixture')",
    )
    .run(
      randomUUID(),
      localDateTimeToEpoch(`${date}T20:00`),
      localDateTimeToEpoch(`${date}T21:10`),
      "Conflicto de prueba para verificar rollback",
      Date.now(),
    );
  rollbackDb.close();

  const rejected = await fetch(`${base}/api/staff/reoptimize`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: receptionCookie,
      origin: base,
    },
    body: JSON.stringify({ date }),
  });
  assert.equal(rejected.status, 409);
  assert.match((await rejected.json()).error, /reorganización se revirtió/i);

  const afterRollback = await boardBookings(base, receptionCookie, date);
  for (const booking of afterRollback) {
    assert.deepEqual(booking.lanes, originalAssignments.get(booking.id));
  }
  assert.ok(afterRollback.some((booking) => booking.id === laterBooking.id));

  const auditResponse = await fetch(`${base}/api/staff/audit`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(auditResponse.status, 200);
  const events = (await auditResponse.json()).events;
  const successfulRun = events.find(
    (event) => event.action === "localized_reoptimization_completed",
  );
  assert.ok(successfulRun);
  assert.deepEqual(successfulRun.details, { examined: 2, changed: 2, fixed: 1 });
  assert.equal(
    events.filter((event) => event.action === "lane_assignment_reorganized").length,
    2,
    "failed reoptimization must not leave assignment audit entries",
  );
});
