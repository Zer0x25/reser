import { DatabaseSync } from "node:sqlite";
import { randomUUID, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatLocalDate,
  laneSetsFor,
  localDateTimeToEpoch,
  matchesHours,
  parseLocalDay,
} from "./domain.mjs";

export const demoMode =
  process.env.MVP_MODE !== "production" && process.env.NODE_ENV !== "production";
const defaultName = demoMode ? "demo.sqlite" : "production.sqlite";
const databasePath =
  process.env.DATABASE_PATH ?? fileURLToPath(new URL(`../data/${defaultName}`, import.meta.url));
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
const now = Date.now();

const schemaVersion = db.prepare("PRAGMA user_version").get().user_version;
if (schemaVersion < 1) {
  db.exec(readFileSync(new URL("./migrations/001_initial.sql", import.meta.url), "utf8"));
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,?,?)").run(
    "initial schema",
    now,
  );
  db.exec("PRAGMA user_version = 1");
}
if (schemaVersion < 2) {
  db.exec(readFileSync(new URL("./migrations/002_pricing_decisions.sql", import.meta.url), "utf8"));
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(2,?,?)").run(
    "pricing decisions",
    now,
  );
  db.exec("PRAGMA user_version = 2");
}
if (schemaVersion < 3) {
  db.exec(
    readFileSync(new URL("./migrations/003_pricing_quote_funnel.sql", import.meta.url), "utf8"),
  );
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(3,?,?)").run(
    "pricing quote funnel",
    now,
  );
  db.exec("PRAGMA user_version = 3");
}
db.prepare("DELETE FROM pricing_quote_funnel WHERE offered_at < ?").run(
  now - 90 * 24 * 60 * 60_000,
);
db.prepare("UPDATE email_outbox SET status='queued' WHERE status='sending'").run();

const DEMO_HOURS = {
  0: { open: "12:00", close: "22:00" },
  1: { open: "16:00", close: "23:00" },
  2: { open: "16:00", close: "23:00" },
  3: { open: "16:00", close: "23:00" },
  4: { open: "16:00", close: "23:00" },
  5: { open: "16:00", close: "01:00" },
  6: { open: "12:00", close: "01:00" },
};
const defaults = {
  settings: {
    venueName: "Bowling Espacio OX",
    timeZone: "America/Santiago",
    demoMode,
    preparationMinutes: 10,
    closingMarginMinutes: 30,
    startIntervalMinutes: 10,
    minimumAdvanceMinutes: 60,
    maximumAdvanceDays: 60,
    lateArrivalToleranceMinutes: 10,
    operationalLockMinutes: 60,
    calendarHourWidthPx: 60,
    weeklyHours: demoMode
      ? DEMO_HOURS
      : Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { closed: true }])),
    exceptions: {},
    generalRateClpPerLaneHour: demoMode ? 12000 : 0,
    rateBands: [],
    rateExceptions: {},
    promotions: [],
    dynamicPricing: {
      mode: "off",
      configVersion: 1,
      floorClpPerLaneHour: null,
      maxDiscountPercent: 30,
      maxDiscountClpPerLaneHour: null,
      advanceWindowHours: 48,
      lowOccupancyThresholdPercent: 50,
      mediumOccupancyThresholdPercent: 70,
      riskTiers: [],
      protectedWeekdays: [],
      protectedBands: [],
      protectedDates: [],
      dailyDiscountBudgetClp: null,
      quoteTtlMinutes: 20,
      channels: ["web"],
      pilot: { weekdays: [], bands: [] },
    },
    cancellationFreeHours: 24,
    lateCancellationPenaltyClp: null,
    requireManualApprovalFromLanes: 3,
    emailDeliveryConfigured: Boolean(
      process.env.MAIL_DELIVERY_URL && process.env.MAIL_DELIVERY_TOKEN,
    ),
    allowImmediateWeb: false,
  },
};
for (const [key, value] of Object.entries(defaults)) {
  db.prepare("INSERT OR IGNORE INTO settings(key,value_json,updated_at) VALUES(?,?,?)").run(
    key,
    JSON.stringify(value),
    now,
  );
}
const persistedSettings = JSON.parse(
  db.prepare("SELECT value_json FROM settings WHERE key='settings'").get().value_json,
);
const migratedSettings = {
  ...defaults.settings,
  ...persistedSettings,
  venueName:
    persistedSettings.venueName === "Pista Central"
      ? "Bowling Espacio OX"
      : persistedSettings.venueName,
  demoMode,
};
db.prepare("UPDATE settings SET value_json=? WHERE key='settings'").run(
  JSON.stringify(migratedSettings),
);
const insertLane = db.prepare("INSERT OR IGNORE INTO lanes(id,pair_id,x,y) VALUES(?,?,?,?)");
for (let lane = 1; lane <= 12; lane += 1)
  insertLane.run(lane, Math.ceil(lane / 2), Math.floor((lane - 1) / 2), (lane - 1) % 2);

function createUser(email, name, role, password) {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing || !password) return;
  const salt = randomUUID().replaceAll("-", "");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  db.prepare(
    "INSERT INTO users(id,email,name,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(randomUUID(), email.toLowerCase(), name, role, salt, passwordHash, Date.now());
}
if (demoMode) {
  createUser(
    "recepcion@demo.local",
    "Equipo de recepción",
    "reception",
    process.env.DEMO_RECEPTION_PASSWORD ?? "BowlingDemo2026!",
  );
  createUser(
    "admin@demo.local",
    "Administración",
    "admin",
    process.env.DEMO_ADMIN_PASSWORD ?? "BowlingDemo2026!",
  );
} else {
  if (
    !process.env.ADMIN_EMAIL ||
    !process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD.length < 12
  ) {
    throw new Error(
      "Production startup requires ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters for the first administrator.",
    );
  }
  createUser(process.env.ADMIN_EMAIL ?? "", "Administrador", "admin", process.env.ADMIN_PASSWORD);
}

const demoSeed = db.prepare("SELECT value_json FROM settings WHERE key = 'demo_seeded'").get();
if (demoMode && !demoSeed) {
  const [y, m, d] = formatLocalDate(Date.now()).split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const date = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrow.getUTCDate()).padStart(2, "0")}`;
  const insertReservation =
    db.prepare(`INSERT INTO reservations(id,code,customer_name,email,phone,channel,start_ms,end_ms,players,lane_count,group_mode,commercial_status,inventory_status,financial_status,quote_clp,quote_json,terms_accepted_at,created_at,updated_at,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertAllocation = db.prepare(
    "INSERT INTO allocations(id,reservation_id,lane_id,start_ms,end_ms,active,created_at) VALUES(?,?,?,?,?,1,?)",
  );
  for (const sample of [
    { time: "18:00", hours: 2, name: "Grupo de demostración", players: 4, lanes: [1] },
    { time: "19:00", hours: 1, name: "Reserva de demostración", players: 9, lanes: [5, 6] },
  ]) {
    const start = localDateTimeToEpoch(`${date}T${sample.time}`);
    const end = start + sample.hours * 3_600_000;
    const id = randomUUID();
    const total = sample.lanes.length * sample.hours * 12000;
    insertReservation.run(
      id,
      `D-${id.slice(0, 6).toUpperCase()}`,
      sample.name,
      null,
      null,
      "demo",
      start,
      end,
      sample.players,
      sample.lanes.length,
      "together",
      "confirmed",
      "assigned",
      "unpaid",
      total,
      JSON.stringify({
        baseClp: total,
        discountClp: 0,
        totalClp: total,
        promotionName: null,
        demo: true,
      }),
      now,
      now,
      now,
      "system-demo",
    );
    for (const lane of sample.lanes)
      insertAllocation.run(randomUUID(), id, lane, start, end + 10 * 60_000, now);
  }
  db.prepare("INSERT INTO settings(key,value_json,updated_at) VALUES('demo_seeded','true',?)").run(
    now,
  );
}

// Add versioned, synthetic operational examples to existing demo databases without
// changing production data or repeating the fixtures on every restart.
const demoFixtures = db
  .prepare("SELECT value_json FROM settings WHERE key = 'demo_fixtures_v2'")
  .get();
if (demoMode && !demoFixtures) {
  const dateAfter = (days) => {
    const [year, month, day] = formatLocalDate(Date.now()).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
  };
  const rate = Number(migratedSettings.generalRateClpPerLaneHour);
  transaction((conn) => {
    const findLaneSet = (date, time, hours, players, laneCount) => {
      const start = localDateTimeToEpoch(`${date}T${time}`);
      const end = start + hours * 3_600_000;
      const operationalEnd = end + migratedSettings.closingMarginMinutes * 60_000;
      if (
        !matchesHours(
          start,
          operationalEnd,
          migratedSettings.weeklyHours,
          migratedSettings.exceptions,
        )
      )
        return null;
      const busyUntil = end + migratedSettings.preparationMinutes * 60_000;
      const busy = new Set(
        conn
          .prepare(
            "SELECT DISTINCT lane_id FROM allocations WHERE active=1 AND start_ms < ? AND end_ms > ?",
          )
          .all(busyUntil, start)
          .map((row) => row.lane_id),
      );
      const blocks = conn
        .prepare(
          "SELECT lane_id FROM maintenance_blocks WHERE status='active' AND start_ms < ? AND end_ms > ?",
        )
        .all(busyUntil, start);
      for (const block of blocks) {
        if (block.lane_id == null) return null;
        busy.add(block.lane_id);
      }
      return (
        laneSetsFor(players, laneCount).find((lanes) => lanes.every((lane) => !busy.has(lane))) ??
        null
      );
    };
    const findPlacement = ({ fromDay, time, hours, players, laneCount }) => {
      for (let day = fromDay; day <= fromDay + 30; day += 1) {
        const date = dateAfter(day);
        const lanes = findLaneSet(date, time, hours, players, laneCount);
        if (lanes) return { date, time, hours, players, lanes };
      }
      return null;
    };
    const insertReservation = conn.prepare(`INSERT INTO reservations(
      id,code,request_id,customer_name,email,phone,channel,start_ms,end_ms,players,lane_count,
      group_mode,commercial_status,inventory_status,financial_status,quote_clp,quote_json,
      terms_accepted_at,created_at,updated_at,created_by
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertAllocation = conn.prepare(
      "INSERT INTO allocations(id,reservation_id,lane_id,start_ms,end_ms,active,created_at) VALUES(?,?,?,?,?,1,?)",
    );
    const insertBooking = ({
      date,
      time,
      hours = 1,
      name,
      email = null,
      phone = null,
      channel = "phone",
      players,
      lanes,
      requestId = null,
      reservationId = randomUUID(),
    }) => {
      const start = localDateTimeToEpoch(`${date}T${time}`);
      const end = start + hours * 3_600_000;
      const id = reservationId;
      const total = lanes.length * hours * rate;
      const status = requestId ? "pending_approval" : "confirmed";
      insertReservation.run(
        id,
        `D2-${id.slice(0, 6).toUpperCase()}`,
        requestId,
        name,
        email,
        phone,
        channel,
        start,
        end,
        players,
        lanes.length,
        "together",
        status,
        requestId ? "held" : "assigned",
        "unpaid",
        total,
        JSON.stringify({
          baseClp: total,
          discountClp: 0,
          totalClp: total,
          promotionName: null,
          demo: true,
        }),
        now,
        now,
        now,
        "system-demo",
      );
      for (const lane of lanes)
        insertAllocation.run(
          randomUUID(),
          id,
          lane,
          start,
          end + migratedSettings.preparationMinutes * 60_000,
          now,
        );
      return { id, total };
    };

    const phoneBooking = findPlacement({
      fromDay: 1,
      time: "17:00",
      hours: 1,
      players: 4,
      laneCount: 1,
    });
    if (phoneBooking)
      insertBooking({
        date: phoneBooking.date,
        time: phoneBooking.time,
        name: "Valentina Soto · demo",
        phone: "+56900000011",
        channel: "phone",
        players: phoneBooking.players,
        lanes: phoneBooking.lanes,
      });
    const groupBooking = findPlacement({
      fromDay: 1,
      time: "18:00",
      hours: 2,
      players: 10,
      laneCount: 2,
    });
    if (groupBooking)
      insertBooking({
        date: groupBooking.date,
        time: groupBooking.time,
        hours: groupBooking.hours,
        name: "Equipo cumpleaños · demo",
        phone: "+56900000022",
        channel: "counter_future",
        players: groupBooking.players,
        lanes: groupBooking.lanes,
      });

    const requestId = randomUUID();
    const requestEmail = "grupo-demo@example.test";
    const requestName = "Grupo de cumpleaños · demo";
    const requestKey = "demo-fixture-v2-pending-approval";
    const approvalBooking = findPlacement({
      fromDay: 2,
      time: "18:00",
      hours: 2,
      players: 15,
      laneCount: 3,
    });
    if (approvalBooking) {
      const pendingReservationId = randomUUID();
      const pendingTotal = approvalBooking.lanes.length * approvalBooking.hours * rate;
      conn
        .prepare(`INSERT INTO booking_requests(
        id,idempotency_key,email,customer_name,channel,status,reservation_id,
        original_quote_clp,current_quote_clp,created_at,updated_at,created_by
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          requestId,
          requestKey,
          requestEmail,
          requestName,
          "web",
          "pending_approval",
          pendingReservationId,
          pendingTotal,
          pendingTotal,
          now,
          now,
          "system-demo",
        );
      insertBooking({
        date: approvalBooking.date,
        time: approvalBooking.time,
        hours: approvalBooking.hours,
        name: requestName,
        email: requestEmail,
        channel: "web",
        players: approvalBooking.players,
        lanes: approvalBooking.lanes,
        requestId,
        reservationId: pendingReservationId,
      });
    }

    const paidBooking = findPlacement({
      fromDay: 2,
      time: "20:00",
      hours: 1,
      players: 4,
      laneCount: 1,
    });
    const partial = paidBooking
      ? insertBooking({
          date: paidBooking.date,
          time: paidBooking.time,
          name: "Reserva transferencia · demo",
          email: "pago-demo@example.test",
          channel: "counter_future",
          players: paidBooking.players,
          lanes: paidBooking.lanes,
        })
      : null;
    if (partial?.total > 0)
      conn
        .prepare(`INSERT INTO payments(
          id,idempotency_key,reservation_id,amount_clp,method,status,reference,created_at,created_by
        ) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(
          randomUUID(),
          "demo-fixture-v2-reported-payment",
          partial.id,
          Math.max(1, Math.floor(partial.total / 2)),
          "transfer",
          "reported",
          "DEMO-TRANSFERENCIA",
          now,
          "system-demo",
        );
    const maintenance = findPlacement({
      fromDay: 2,
      time: "18:00",
      hours: 1,
      players: 1,
      laneCount: 1,
    });
    if (maintenance)
      conn
        .prepare(
          "INSERT INTO maintenance_blocks(id,lane_id,start_ms,end_ms,reason,status,created_at,created_by) VALUES(?,?,?,?,?,'active',?,?)",
        )
        .run(
          randomUUID(),
          maintenance.lanes[0],
          localDateTimeToEpoch(`${maintenance.date}T${maintenance.time}`),
          localDateTimeToEpoch(`${maintenance.date}T${maintenance.time}`) + 60 * 60_000,
          "Revisión de sensores · demo",
          now,
          "system-demo",
        );
    conn
      .prepare(
        "INSERT INTO settings(key,value_json,updated_at) VALUES('demo_fixtures_v2','true',?)",
      )
      .run(now);
  });
}

export function transaction(callback) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = callback(db);
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getSettings() {
  return JSON.parse(
    db.prepare("SELECT value_json FROM settings WHERE key = 'settings'").get().value_json,
  );
}

export function saveSettings(settings, actorId) {
  db.prepare("UPDATE settings SET value_json=?,updated_at=?,updated_by=? WHERE key='settings'").run(
    JSON.stringify(settings),
    Date.now(),
    actorId,
  );
}

export function audit(actor, action, entityType, entityId, details = {}) {
  db.prepare(
    "INSERT INTO audit_log(id,actor_id,actor_role,action,entity_type,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    actor?.id ?? null,
    actor?.role ?? null,
    action,
    entityType,
    entityId ?? null,
    JSON.stringify(details),
    Date.now(),
  );
}

export function reservationsForRange(startMs, endMs) {
  const rows = db
    .prepare(`SELECT r.*,GROUP_CONCAT(a.lane_id) AS lane_ids FROM reservations r
    LEFT JOIN allocations a ON a.reservation_id=r.id AND a.active=1
    WHERE r.commercial_status NOT IN ('cancelled','rejected') AND r.start_ms < ? AND COALESCE(r.effective_end_ms,r.end_ms) + 3600000 > ?
    GROUP BY r.id`)
    .all(endMs, startMs);
  const prep = getSettings().preparationMinutes;
  return rows.map((row) => ({
    ...row,
    startMs: row.start_ms,
    endMs: row.effective_end_ms ?? row.end_ms,
    preparationMinutes: prep,
    lanes: row.lane_ids ? row.lane_ids.split(",").map(Number) : [],
  }));
}

export function blocksForRange(startMs, endMs) {
  return db
    .prepare(
      "SELECT * FROM maintenance_blocks WHERE status='active' AND start_ms < ? AND end_ms > ?",
    )
    .all(endMs, startMs)
    .map((row) => ({ laneId: row.lane_id, startMs: row.start_ms, endMs: row.end_ms }));
}

export function dynamicDiscountUsedForDate(date) {
  const { start, end } = parseLocalDay(date);
  const rows = db
    .prepare(
      `SELECT quote_json FROM reservations
       WHERE start_ms >= ? AND start_ms < ?
         AND commercial_status NOT IN ('cancelled','rejected')`,
    )
    .all(start, end);
  let usedClp = 0;
  for (const row of rows) {
    try {
      const quote = JSON.parse(row.quote_json);
      if (quote.dynamic?.applied === true && Number.isSafeInteger(quote.dynamic.discountClp))
        usedClp += Math.max(0, quote.dynamic.discountClp);
    } catch {
      // A malformed historical quote must not block new availability or bookings.
    }
  }
  return usedClp;
}

export function getLocalToday() {
  return formatLocalDate(Date.now());
}
export { db };
