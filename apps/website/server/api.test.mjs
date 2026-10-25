import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { localDateTimeToEpoch, formatLocalDate } from "./domain.mjs";

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
function addLocalDays(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

test("HTTP API authenticates staff and serializes competing claims on the final inventory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bowling-api-"));
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
        DATABASE_PATH: join(directory, "test.sqlite"),
        PORT: `${port}`,
        TOKEN_SECRET: "api-tests-stable-secret-with-at-least-32-bytes",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let errorOutput = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
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

  const unauthorized = await fetch(`${base}/api/staff/board`);
  assert.equal(unauthorized.status, 401);
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "recepcion@demo.local", password: "BowlingDemo2026!" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const tomorrowBoard = await fetch(
    `${base}/api/staff/board?date=${addLocalDays(formatLocalDate(Date.now()), 1)}`,
    { headers: { cookie } },
  );
  assert.equal(tomorrowBoard.status, 200);
  const tomorrowData = await tomorrowBoard.json();
  assert.ok(
    tomorrowData.reservations.some((booking) => booking.customerName === "Valentina Soto · demo"),
  );
  assert.equal(tomorrowData.operatingHours.isOpen, true);
  assert.ok(tomorrowData.operatingHours.startMs < tomorrowData.operatingHours.endMs);
  const seededRequests = await fetch(`${base}/api/staff/requests`, { headers: { cookie } });
  assert.deepEqual(
    (await seededRequests.json()).requests.map((request) => request.name),
    ["Grupo de cumpleaños · demo"],
  );
  const fixtureDay = await fetch(
    `${base}/api/staff/board?date=${addLocalDays(formatLocalDate(Date.now()), 2)}`,
    { headers: { cookie } },
  );
  const fixtures = await fixtureDay.json();
  assert.ok(
    fixtures.reservations.some((booking) =>
      booking.payments.some((payment) => payment.status === "reported"),
    ),
  );
  assert.ok(fixtures.blocks.some((block) => block.reason.includes("demo")));
  const blockedAdmin = await fetch(`${base}/api/staff/settings`, { headers: { cookie } });
  assert.equal(blockedAdmin.status, 403);
  const fallBackBoard = await fetch(`${base}/api/staff/board?date=2026-04-04`, {
    headers: { cookie },
  });
  assert.equal(fallBackBoard.status, 200);
  const fallBackDay = await fallBackBoard.json();
  assert.equal(fallBackDay.axisStartMs, localDateTimeToEpoch("2026-04-04T12:00"));
  assert.equal(fallBackDay.axisEndMs, localDateTimeToEpoch("2026-04-05T01:00"));
  assert.deepEqual(fallBackDay.operatingHours, {
    isOpen: true,
    startMs: fallBackDay.axisStartMs,
    endMs: fallBackDay.axisEndMs,
  });
  const deniedOutbox = await fetch(`${base}/api/staff/emails`, { headers: { cookie } });
  assert.equal(deniedOutbox.status, 403);
  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.local", password: "BowlingDemo2026!" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await fetch(`${base}/api/staff/emails`, { headers: { cookie: adminCookie } })).status,
    200,
  );

  const originalSettingsResponse = await fetch(`${base}/api/staff/settings`, {
    headers: { cookie: adminCookie },
  });
  const originalSettings = await originalSettingsResponse.json();
  const selectedDate = addLocalDays(formatLocalDate(Date.now()), 2);
  const previousDate = addLocalDays(selectedDate, -1);
  const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
  const overnightHours = {
    ...originalSettings.weeklyHours,
    [weekdayOf(previousDate)]: { open: "15:00", close: "01:00" },
    [weekdayOf(selectedDate)]: { closed: true },
  };
  const overnightConfiguration = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: {
      cookie: adminCookie,
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify({ weeklyHours: overnightHours, closingMarginMinutes: 0 }),
  });
  assert.equal(overnightConfiguration.status, 200);
  try {
    const afterMidnight = await fetch(
      `${base}/api/availability?date=${selectedDate}&time=00%3A00&players=4&duration=60`,
    );
    assert.equal(afterMidnight.status, 200);
    const { alternatives } = await afterMidnight.json();
    assert.ok(
      alternatives.some(
        (alternative) => alternative.startMs === localDateTimeToEpoch(`${selectedDate}T00:00`),
      ),
      "a booking at the start of this date should use the prior day's overnight rule",
    );
  } finally {
    const restoreHours = await fetch(`${base}/api/staff/settings`, {
      method: "PUT",
      headers: {
        cookie: adminCookie,
        origin: base,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        weeklyHours: originalSettings.weeklyHours,
        closingMarginMinutes: originalSettings.closingMarginMinutes,
      }),
    });
    assert.equal(restoreHours.status, 200);
  }

  const emails = ["one@example.test", "two@example.test"];
  const proofs = [];
  for (const email of emails) {
    const marker = output.length;
    const started = await fetch(`${base}/api/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    assert.equal(started.status, 200);
    let code;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const sent = output.slice(marker);
      const match = new RegExp(
        `Para: ${email.replaceAll(".", "\\.")}\\nAsunto:[^\\n]*\\nTu código de verificación es (\\d{6})`,
      ).exec(sent);
      if (match) {
        code = match[1];
        break;
      }
      await sleep(25);
    }
    assert.ok(code, `development email was not emitted for ${email}`);
    const verified = await fetch(`${base}/api/email/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    assert.equal(verified.status, 200);
    proofs.push((await verified.json()).emailProof);
  }

  const date = formatLocalDate(Date.now() + 3 * 86_400_000);
  const startAt = `${date}T18:00`;
  const create = (index) =>
    fetch(`${base}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `concurrent-request-${index}`,
        emailProof: proofs[index],
        customerName: `Equipo ${index + 1}`,
        email: emails[index],
        startAt,
        players: 72,
        durationMinutes: 60,
        laneCount: 12,
        acceptSeparated: false,
        acceptTerms: true,
      }),
    });
  const competing = await Promise.all([create(0), create(1)]);
  assert.deepEqual(
    competing.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );
  const winningIndex = competing.findIndex((response) => response.status === 201);
  const winner = competing[winningIndex];
  const first = await winner.json();
  assert.equal(first.status, "pending_approval");

  const idempotent = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: `concurrent-request-${winningIndex}`,
      emailProof: "consumed",
      customerName: "Equipo repetido",
      email: "ignored@example.test",
      startAt,
      players: 72,
      durationMinutes: 60,
      laneCount: 12,
      acceptTerms: true,
    }),
  });
  // The winning idempotency key is tied to its exact request and never creates a second reservation.
  assert.equal(idempotent.status, 200);
  assert.equal((await idempotent.json()).reused, true);
  const board = await fetch(`${base}/api/staff/board?date=${date}`, { headers: { cookie } });
  assert.equal(board.status, 200);
  const scheduled = (await board.json()).reservations;
  assert.equal(
    scheduled.filter(
      (booking) => booking.start === localDateTimeToEpoch(startAt) && booking.laneCount === 12,
    ).length,
    1,
  );

  const manualDate = formatLocalDate(Date.now() + 4 * 86_400_000);
  const manualStart = `${manualDate}T18:00`;
  const manualBody = {
    idempotencyKey: "manual-booking-once",
    channel: "phone",
    customerName: "Reserva telefónica",
    phone: "+56912345678",
    email: "walkin@example.test",
    players: 4,
    startAt: manualStart,
    durationMinutes: 60,
  };
  const missingPhone = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ ...manualBody, idempotencyKey: "manual-missing-phone", phone: "" }),
  });
  assert.equal(missingPhone.status, 400);
  const manualResponse = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(manualBody),
  });
  assert.equal(manualResponse.status, 201);
  const manual = await manualResponse.json();
  const repeatedManual = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(manualBody),
  });
  assert.equal(repeatedManual.status, 200);
  assert.equal((await repeatedManual.json()).reused, true);

  const blockDate = formatLocalDate(Date.now() + 30 * 86_400_000);
  const blockStart = localDateTimeToEpoch(`${blockDate}T17:00`);
  const blockBookingResponse = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      idempotencyKey: "block-sized-booking",
      channel: "phone",
      customerName: "Reserva en bloques",
      phone: "+56912345678",
      players: 72,
      laneCount: 12,
      startAt: `${blockDate}T17:00`,
      durationMinutes: 60,
    }),
  });
  assert.equal(blockBookingResponse.status, 201);
  const blockBooking = (await blockBookingResponse.json()).booking;
  assert.equal(blockBooking.end - blockBooking.start, 60 * 60_000);
  const misalignedMaintenance = await fetch(`${base}/api/staff/blocks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: base },
    body: JSON.stringify({
      laneId: 1,
      startMs: localDateTimeToEpoch(`${blockDate}T22:05`),
      endMs: localDateTimeToEpoch(`${blockDate}T22:15`),
      reason: "Bloque fuera de la cuadrícula configurada",
    }),
  });
  assert.equal(misalignedMaintenance.status, 400);
  const invalidBlockDuration = await fetch(`${base}/api/staff/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      idempotencyKey: "invalid-hour-booking-duration",
      channel: "phone",
      customerName: "Duración no alineada",
      phone: "+56912345678",
      players: 4,
      startAt: `${blockDate}T20:00`,
      durationMinutes: 70,
    }),
  });
  assert.equal(invalidBlockDuration.status, 400);

  const lockedBookingResponse = await fetch(`${base}/api/staff/bookings/${blockBooking.id}/lock`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ locked: true }),
  });
  assert.equal(lockedBookingResponse.status, 200);
  assert.equal((await lockedBookingResponse.json()).booking.manualLaneLock, true);
  const movedStart = localDateTimeToEpoch(`${blockDate}T19:00`);
  const changedTariff = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: {
      cookie: adminCookie,
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      rateBands: [
        {
          weekday: weekdayOf(blockDate),
          start: "18:00",
          end: "20:00",
          rateClpPerLaneHour: 20_000,
        },
      ],
    }),
  });
  assert.equal(changedTariff.status, 200);
  const movedPayload = {
    idempotencyKey: "move-block-sized-booking",
    expectedStartMs: blockStart,
    startMs: movedStart,
    preferredLaneId: 1,
  };
  const pricePreviewResponse = await fetch(
    `${base}/api/staff/bookings/${blockBooking.id}/reschedule`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(movedPayload),
    },
  );
  assert.equal(pricePreviewResponse.status, 409);
  const pricePreview = await pricePreviewResponse.json();
  assert.equal(pricePreview.requiresPriceConfirmation, true);
  assert.ok(pricePreview.quoteClp > pricePreview.oldQuoteClp);
  const movedBookingResponse = await fetch(
    `${base}/api/staff/bookings/${blockBooking.id}/reschedule`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ...movedPayload, acceptedQuoteClp: pricePreview.quoteClp }),
    },
  );
  assert.equal(movedBookingResponse.status, 200);
  const movedBooking = (await movedBookingResponse.json()).booking;
  assert.equal(movedBooking.start, movedStart);
  assert.equal(movedBooking.end - movedBooking.start, blockBooking.end - blockBooking.start);
  assert.equal(movedBooking.manualLaneLock, true);
  const movedBoardResponse = await fetch(`${base}/api/staff/board?date=${blockDate}`, {
    headers: { cookie },
  });
  assert.equal(movedBoardResponse.status, 200);
  const movedBoardBooking = (await movedBoardResponse.json()).reservations.find(
    (booking) => booking.id === blockBooking.id,
  );
  assert.ok(movedBoardBooking.lanes.includes(1));
  const restoreRates = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: {
      cookie: adminCookie,
      origin: base,
      "content-type": "application/json",
    },
    body: JSON.stringify({ rateBands: originalSettings.rateBands }),
  });
  assert.equal(restoreRates.status, 200);

  const verificationMarker = output.length;
  const emailStarted = await fetch(`${base}/api/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: manualBody.email }),
  });
  assert.equal(emailStarted.status, 200);
  let renewalCode;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const match = new RegExp(
      `Para: ${manualBody.email}\\nAsunto:[^\\n]*\\nTu código de verificación es (\\d{6})`,
    ).exec(output.slice(verificationMarker));
    if (match) {
      renewalCode = match[1];
      break;
    }
    await sleep(25);
  }
  assert.ok(renewalCode, "development email was not emitted for management-link renewal");
  const verifiedRenewal = await fetch(`${base}/api/email/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: manualBody.email, code: renewalCode }),
  });
  assert.equal(verifiedRenewal.status, 200);
  const renewedLink = await fetch(`${base}/api/manage/renew`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: manualBody.email,
      code: manual.booking.code,
      emailProof: (await verifiedRenewal.json()).emailProof,
    }),
  });
  assert.equal(renewedLink.status, 200);
  const renewed = await renewedLink.json();
  assert.equal(renewed.renewed, true);
  const managedBooking = await fetch(`${base}/api/manage`, {
    headers: { authorization: `Bearer ${new URL(renewed.manageLink).searchParams.get("token")}` },
  });
  assert.equal(managedBooking.status, 200);
  assert.equal((await managedBooking.json()).booking.code, manual.booking.code);

  const paymentBody = {
    idempotencyKey: "manual-payment-once",
    amountClp: 3000,
    method: "transfer",
    status: "reported",
    reference: "TRX-1",
  };
  const payment = await fetch(`${base}/api/staff/bookings/${manual.booking.id}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(paymentBody),
  });
  assert.equal(payment.status, 201);
  const paymentResult = await payment.json();
  assert.equal(paymentResult.financialStatus, "pending_verification");
  const repeatedPayment = await fetch(`${base}/api/staff/bookings/${manual.booking.id}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(paymentBody),
  });
  assert.equal(repeatedPayment.status, 200);
  assert.equal((await repeatedPayment.json()).reused, true);
  const verifiedPayment = await fetch(
    `${base}/api/staff/payments/${paymentResult.paymentId}/verify`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ reference: "TRX-1 confirmed" }),
    },
  );
  assert.equal(verifiedPayment.status, 200);
  assert.equal((await verifiedPayment.json()).financialStatus, "partially_paid");
  const forbiddenRefund = await fetch(`${base}/api/staff/bookings/${manual.booking.id}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      idempotencyKey: "refund-reception-denied",
      amountClp: 1000,
      method: "refund",
      status: "refund_recorded",
    }),
  });
  assert.equal(forbiddenRefund.status, 403);
  const refund = await fetch(`${base}/api/staff/bookings/${manual.booking.id}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      idempotencyKey: "manual-refund-once",
      amountClp: 1000,
      method: "refund",
      status: "refund_recorded",
      reference: "Transferencia de devolución externa",
    }),
  });
  assert.equal(refund.status, 201);
  assert.equal((await refund.json()).booking.balanceClp, 10000);

  const createStaff = await fetch(`${base}/api/staff/users`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({
      name: "Operador de prueba",
      email: "operator@example.test",
      password: "OperatorTestPass2026!",
      role: "reception",
    }),
  });
  assert.equal(createStaff.status, 201);
  const staffAccount = await createStaff.json();
  const operatorLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "operator@example.test", password: "OperatorTestPass2026!" }),
  });
  assert.equal(operatorLogin.status, 200);
  const operatorCookie = operatorLogin.headers.get("set-cookie").split(";")[0];
  const deactivated = await fetch(`${base}/api/staff/users/${staffAccount.id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(deactivated.status, 200);
  assert.equal(
    (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: operatorCookie } })).json())
      .user,
    null,
  );
  const reactivated = await fetch(`${base}/api/staff/users/${staffAccount.id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ active: true }),
  });
  assert.equal(reactivated.status, 200);
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "operator@example.test", password: "OperatorTestPass2026!" }),
      })
    ).status,
    200,
  );

  const blockedMaintenance = await fetch(`${base}/api/staff/blocks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      laneId: null,
      startMs: localDateTimeToEpoch(manualStart),
      endMs: localDateTimeToEpoch(`${manualDate}T19:00`),
      reason: "Corte general",
    }),
  });
  assert.equal(blockedMaintenance.status, 409);
  const laneBlock = await fetch(`${base}/api/staff/blocks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      laneId: 2,
      startMs: localDateTimeToEpoch(manualStart),
      endMs: localDateTimeToEpoch(`${manualDate}T19:00`),
      reason: "Inspección",
    }),
  });
  assert.equal(laneBlock.status, 201);
  const block = await laneBlock.json();
  const releaseBlock = await fetch(`${base}/api/staff/blocks/${block.id}`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(releaseBlock.status, 200);
});

test("production starts closed and refuses email verification without a provider", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bowling-production-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    globalThis.process.execPath,
    [new URL("./index.mjs", import.meta.url).pathname],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        MVP_MODE: "production",
        DATABASE_PATH: join(directory, "production.sqlite"),
        PORT: `${port}`,
        TOKEN_SECRET: "production-tests-stable-secret-with-at-least-32-bytes",
        ADMIN_EMAIL: "admin@example.test",
        ADMIN_PASSWORD: "ProductionAdminPass2026!",
        MAIL_DELIVERY_URL: "",
        MAIL_DELIVERY_TOKEN: "",
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
  assert.equal(ready, true, `production API did not start: ${errorOutput}`);
  const config = await (await fetch(`${base}/api/public-config`)).json();
  assert.equal(config.demoMode, false);
  assert.equal(config.rateConfigured, false);
  assert.deepEqual(
    Object.values(config.weeklyHours).map((rule) => rule.closed),
    Array(7).fill(true),
  );
  const productionLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.test", password: "ProductionAdminPass2026!" }),
  });
  assert.equal(productionLogin.status, 200);
  const productionCookie = productionLogin.headers.get("set-cookie").split(";")[0];
  const closedBoard = await fetch(`${base}/api/staff/board?date=2026-04-04`, {
    headers: { cookie: productionCookie },
  });
  assert.equal((await closedBoard.json()).operatingHours.isOpen, false);
  const demoLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "recepcion@demo.local", password: "BowlingDemo2026!" }),
  });
  assert.equal(demoLogin.status, 401);
  const email = await fetch(`${base}/api/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "customer@example.test" }),
  });
  assert.equal(email.status, 503);
});

test("dynamic pricing requires explicit configuration and honors the locked quote", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bowling-dynamic-"));
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
        DATABASE_PATH: join(directory, "test.sqlite"),
        PORT: `${port}`,
        TOKEN_SECRET: "dynamic-tests-stable-secret-with-at-least-32-bytes",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let errorOutput = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    output += chunk;
  });
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

  const adminLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@demo.local", password: "BowlingDemo2026!" }),
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.headers.get("set-cookie").split(";")[0];

  const incomplete = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ dynamicPricing: { mode: "active" } }),
  });
  assert.equal(incomplete.status, 400);

  const dynamicPricing = {
    mode: "active",
    floorClpPerLaneHour: 8000,
    maxDiscountPercent: 30,
    maxDiscountClpPerLaneHour: 3000,
    advanceWindowHours: 48,
    lowOccupancyThresholdPercent: 50,
    mediumOccupancyThresholdPercent: 70,
    riskTiers: [{ minPoints: 3, discountPercent: 20 }],
    protectedWeekdays: [],
    protectedBands: [],
    protectedDates: [],
    dailyDiscountBudgetClp: 1000000,
    quoteTtlMinutes: 20,
    channels: ["web"],
    pilot: { weekdays: [], bands: [] },
  };
  const configured = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ dynamicPricing }),
  });
  assert.equal(configured.status, 200);
  const configuredSettings = await configured.json();
  assert.equal(configuredSettings.settings.dynamicPricing.mode, "active");
  assert.equal(configuredSettings.settings.dynamicPricing.configVersion, 2);
  assert.deepEqual(configuredSettings.settings.dynamicPricing.riskTiers, [
    { minPoints: 3, discountPercent: 20 },
  ]);

  const date = addLocalDays(formatLocalDate(Date.now()), 1);
  const time = "20:00";
  const preview = await fetch(`${base}/api/staff/pricing/preview`, {
    method: "POST",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({
      startAt: `${date}T${time}`,
      players: 4,
      durationMinutes: 60,
      laneCount: 1,
      channel: "web",
    }),
  });
  assert.equal(preview.status, 200);
  const previewData = await preview.json();
  assert.equal(previewData.available, true);
  assert.equal(previewData.preview.eligible, true);
  assert.equal(previewData.preview.potentialDiscountClp, 2400);
  assert.equal(previewData.preview.riskPoints, 3);

  const budgetPreview = await fetch(`${base}/api/staff/pricing/preview`, {
    method: "POST",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({
      startAt: `${date}T${time}`,
      players: 4,
      durationMinutes: 60,
      laneCount: 1,
      channel: "web",
      dynamicPricing: { ...dynamicPricing, dailyDiscountBudgetClp: 1000 },
    }),
  });
  assert.equal(budgetPreview.status, 200);
  const budgetPreviewData = await budgetPreview.json();
  assert.equal(budgetPreviewData.preview.potentialDiscountClp, 1000);

  const availability = await fetch(
    `${base}/api/availability?date=${date}&time=${encodeURIComponent(time)}&players=4&duration=60`,
  );
  assert.equal(availability.status, 200);
  const alternatives = (await availability.json()).alternatives;
  const option = alternatives.find((candidate) => candidate.startTime === time);
  assert.ok(option, "the preferred time should be available");
  assert.equal(option.quote.dynamic.applied, true);
  assert.equal(option.quote.baseClp, 12000);
  assert.equal(option.quote.dynamic.potentialDiscountClp, 2400);
  assert.equal(option.quote.totalClp, 9600);
  assert.equal(option.priceOpportunity, true);
  assert.ok(option.quoteToken);
  assert.ok(option.quoteExpiresAt > Date.now());

  const email = "dynamic-price@example.test";
  const marker = output.length;
  const started = await fetch(`${base}/api/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  assert.equal(started.status, 200);
  let code;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const sent = output.slice(marker);
    const match = new RegExp(
      `Para: ${email.replaceAll(".", "\\.")}\\nAsunto:[^\\n]*\\nTu código de verificación es (\\d{6})`,
    ).exec(sent);
    if (match) {
      code = match[1];
      break;
    }
    await sleep(25);
  }
  assert.ok(code, "development email was not emitted");
  const verified = await fetch(`${base}/api/email/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  assert.equal(verified.status, 200);
  const emailProof = (await verified.json()).emailProof;

  const rateChange = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ generalRateClpPerLaneHour: 20000 }),
  });
  assert.equal(rateChange.status, 200);

  const requestBody = {
    idempotencyKey: "dynamic-locked-quote-request",
    emailProof,
    customerName: "Prueba precio dinámico",
    email,
    startAt: option.startAt,
    startMs: option.startMs,
    players: 4,
    durationMinutes: 60,
    laneCount: option.laneCount,
    acceptSeparated: !option.grouped,
    acceptTerms: true,
    quoteToken: option.quoteToken,
  };
  const created = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(created.status, 201);
  const createdData = await created.json();
  assert.equal(createdData.quote.baseClp, 12000);
  assert.equal(createdData.quote.dynamic.discountClp, 2400);
  assert.equal(createdData.quote.totalClp, 9600);
  assert.equal(createdData.quote.pricingSource, "dynamic");

  const promotion = {
    name: "Promoción de prueba",
    enabled: true,
    kind: "percent",
    value: 25,
    startsAt: Date.now() - 60_000,
    endsAt: Date.now() + 48 * 60 * 60_000,
    channel: "web",
  };
  const promotionConfigured = await fetch(`${base}/api/staff/settings`, {
    method: "PUT",
    headers: { cookie: adminCookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify({ promotions: [promotion] }),
  });
  assert.equal(promotionConfigured.status, 200);
  const promotionalAvailability = await fetch(
    `${base}/api/availability?date=${date}&time=${encodeURIComponent(time)}&players=4&duration=60`,
  );
  assert.equal(promotionalAvailability.status, 200);
  const promotionalOption = (await promotionalAvailability.json()).alternatives.find(
    (candidate) => candidate.startTime === time,
  );
  assert.ok(promotionalOption, "the preferred time should remain available on another lane");
  assert.equal(promotionalOption.quote.pricingSource, "promotion");
  assert.equal(promotionalOption.quote.discountClp, 5000);
  assert.equal(promotionalOption.quote.totalClp, 15000);
  assert.deepEqual(promotionalOption.quote.dynamic, {
    applied: false,
    discountClp: 0,
    potentialDiscountClp: 3000,
    totalAfterDiscountClp: 17000,
  });
  assert.equal("signals" in promotionalOption.quote.dynamic, false);
  assert.equal("riskPoints" in promotionalOption.quote.dynamic, false);

  const tamperedToken = `${option.quoteToken.slice(0, -1)}${option.quoteToken.endsWith("a") ? "b" : "a"}`;
  const tampered = await fetch(`${base}/api/requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...requestBody,
      idempotencyKey: "dynamic-tampered-quote-request",
      quoteToken: tamperedToken,
    }),
  });
  assert.equal(tampered.status, 400);
});
