import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function violationSummary(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations
    .flatMap((violation) =>
      violation.nodes.map((node) => {
        const contrast = node.any.find((check) => check.id === "color-contrast")?.data as
          | { fgColor?: string; bgColor?: string; contrastRatio?: number }
          | undefined;
        return `${violation.id}: ${node.target.join(", ")}${contrast ? ` (${contrast.fgColor} on ${contrast.bgColor}, ${contrast.contrastRatio}:1)` : ""}`;
      }),
    )
    .join("\n");
}

async function verificationCode(request: APIRequestContext, email: string) {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `http://127.0.0.1:3002/messages?to=${encodeURIComponent(email)}`,
        );
        const messages = (await response.json()) as Array<{ text: string }>;
        code = messages
          .map((message) => /código de verificación es (\d{6})/i.exec(message.text)?.[1])
          .filter(Boolean)
          .at(-1);
        return code ?? null;
      },
      { timeout: 10_000 },
    )
    .not.toBeNull();
  return code!;
}

test("customer verifies email, requests a booking, and sees reception approval", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const dateInput = page.locator('#search [name="date"]');
  const bookingDate = addDays(await dateInput.inputValue(), 10);
  await dateInput.fill(bookingDate);
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("13");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  await expect(page.locator(".option-card").first()).toBeVisible();
  await page.locator(".option-card").first().locator('[data-action="select"]').click();
  await expect(page.locator('#request [name="name"]')).toBeFocused();

  const customerName = `E2E Aprobación ${Date.now()}`;
  const email = `booking-${Date.now()}@example.test`;
  await page.locator('#request [name="name"]').fill(customerName);
  await page.locator('#request [name="email"]').fill(email);
  await page.locator('#request [data-action="send-code"]').click();
  const code = await verificationCode(request, email);
  await page.locator('#request [name="code"]').fill(code);
  await page.locator('#request [data-action="verify"]').click();
  await expect(page.locator("#request .verified")).toContainText(email);
  await page.locator('#request [name="terms"]').check();
  await page.locator("#request button.submit").click();

  const result = page.locator(".result-card");
  await expect(result).toContainText("Pendiente de aprobación de recepción");
  await expect(page.locator(".option-card")).toHaveCount(0);
  await expect(result).toBeFocused();
  const manageLink = await result
    .getByRole("link", { name: /Ver seguimiento seguro/ })
    .getAttribute("href");
  expect(manageLink).toBeTruthy();

  await page.locator('.topbar nav [data-view="staff"]').click();
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await page.locator('[data-action="page"][data-page="requests"]').click();

  const approval = page.locator(".staff-request").filter({ hasText: customerName });
  await expect(approval).toBeVisible();
  await approval.getByRole("button", { name: "Aprobar" }).click();
  await expect(approval).toHaveCount(0);

  await page.goto(manageLink!);
  await expect(page.locator(".manage-card .pill.green")).toHaveText("Reserva confirmada");
  await expect(page.locator(".manage-card")).toContainText("13 personas · 3 pistas");
});

test("customer accepts the revised price after reception rechecks a request", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const dateInput = page.locator('#search [name="date"]');
  const bookingDate = addDays(await dateInput.inputValue(), 14);
  await dateInput.fill(bookingDate);
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("13");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  await expect(page.locator(".option-card").first()).toBeVisible();
  await page.locator(".option-card").first().locator('[data-action="select"]').click();

  const customerName = `E2E Precio ${Date.now()}`;
  const email = `price-${Date.now()}@example.test`;
  await page.locator('#request [name="name"]').fill(customerName);
  await page.locator('#request [name="email"]').fill(email);
  await page.locator('#request [data-action="send-code"]').click();
  await page.locator('#request [name="code"]').fill(await verificationCode(request, email));
  await page.locator('#request [data-action="verify"]').click();
  await page.locator('#request [name="terms"]').check();
  await page.locator("#request button.submit").click();

  const result = page.locator(".result-card");
  await expect(result).toContainText("Pendiente de aprobación de recepción");
  const manageLink = await result
    .getByRole("link", { name: /Ver seguimiento seguro/ })
    .getAttribute("href");
  expect(manageLink).toBeTruthy();

  const adminLogin = await request.post("/api/auth/login", {
    data: { email: "admin@demo.local", password: "BowlingDemo2026!" },
  });
  expect(adminLogin.ok()).toBe(true);
  const adminHeaders = {
    cookie: adminLogin.headers()["set-cookie"].split(";")[0],
    origin: "http://127.0.0.1:5173",
  };
  const settingsResponse = await request.get("/api/staff/settings", { headers: adminHeaders });
  expect(settingsResponse.ok()).toBe(true);
  const originalSettings = await settingsResponse.json();
  const originalRate = originalSettings.generalRateClpPerLaneHour;
  const updatedRate = originalRate + 1000;

  try {
    const changeRate = await request.put("/api/staff/settings", {
      headers: adminHeaders,
      data: { generalRateClpPerLaneHour: updatedRate },
    });
    expect(changeRate.ok()).toBe(true);

    await page.locator('.topbar nav [data-view="staff"]').click();
    await page.locator('#login [name="email"]').fill("recepcion@demo.local");
    await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
    await page.getByRole("button", { name: "Ingresar →" }).click();
    await page.locator('[data-action="page"][data-page="requests"]').click();

    const approval = page.locator(".staff-request").filter({ hasText: customerName });
    await expect(approval).toBeVisible();
    await approval.getByRole("button", { name: "Aprobar" }).click();
    await expect(approval).toContainText("Precio por aceptar");

    await page.goto(manageLink!);
    const newTotal = `$${(updatedRate * 3).toLocaleString("es-CL")}`;
    await expect(page.locator(".price-accept")).toContainText(newTotal);
    await page.getByRole("button", { name: "Aceptar precio actualizado" }).click();
    await expect(page.locator(".manage-card .pill.green")).toHaveText("Reserva confirmada");
    await expect(page.locator(".manage-grid")).toContainText(newTotal);
  } finally {
    const restoreRate = await request.put("/api/staff/settings", {
      headers: adminHeaders,
      data: { generalRateClpPerLaneHour: originalRate },
    });
    expect(restoreRate.ok()).toBe(true);
  }
});

test("customer renews an expired link and cancels the future reservation", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const bookingDate = addDays(await page.locator('#search [name="date"]').inputValue(), 12);
  const email = `renew-${Date.now()}@example.test`;
  const receptionLogin = await request.post("/api/auth/login", {
    data: { email: "recepcion@demo.local", password: "BowlingDemo2026!" },
  });
  expect(receptionLogin.ok()).toBe(true);
  const created = await request.post("/api/staff/bookings", {
    headers: {
      cookie: receptionLogin.headers()["set-cookie"].split(";")[0],
      origin: "http://127.0.0.1:5173",
    },
    data: {
      idempotencyKey: `e2e-renew-cancel-${Date.now()}`,
      channel: "counter_future",
      customerName: "E2E Renovación",
      email,
      players: 4,
      startAt: `${bookingDate}T18:00`,
      durationMinutes: 60,
    },
  });
  expect(created.status()).toBe(201);
  const bookingCode = (await created.json()).booking.code as string;

  await page.goto("/seguimiento?token=expired-e2e-token");
  const renewalForm = page.locator("#manage-renew");
  await expect(renewalForm).toBeVisible();
  const renewalAccessibility = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(renewalAccessibility.violations)).toBe("");
  await renewalForm.locator('[name="email"]').fill(email);
  await renewalForm.locator('[name="bookingCode"]').fill(bookingCode);
  await renewalForm.locator('[data-action="manage-send-code"]').click();
  await renewalForm
    .locator('[name="verificationCode"]')
    .fill(await verificationCode(request, email));
  await renewalForm.locator('[data-action="manage-verify"]').click();
  await expect(renewalForm.getByText("Correo verificado.")).toBeVisible();
  await renewalForm.getByRole("button", { name: "Enviar enlace nuevo →" }).click();

  await expect(page.locator(".manage-card .pill.green")).toHaveText("Reserva confirmada");
  await expect(page.locator(".manage-card")).toContainText(bookingCode);
  const cancelButton = page.getByRole("button", { name: "Cancelar reserva" });
  await expect(cancelButton).toBeVisible();
  page.once("dialog", async (dialog) => dialog.accept());
  await cancelButton.click();
  await expect(page.locator(".manage-card .pill.amber")).toHaveText("Cancelada");
  await expect(page.getByRole("status")).toContainText("Reserva cancelada");
  await expect(cancelButton).toHaveCount(0);
});

test("reception can create a walk-in booking and check it in from the board", async ({
  page,
  request,
}) => {
  const adminLogin = await request.post("/api/auth/login", {
    data: { email: "admin@demo.local", password: "BowlingDemo2026!" },
  });
  expect(adminLogin.ok()).toBe(true);
  const adminCookie = adminLogin.headers()["set-cookie"].split(";")[0];
  const authHeaders = { cookie: adminCookie, origin: "http://127.0.0.1:5173" };
  const settingsResponse = await request.get("/api/staff/settings", { headers: authHeaders });
  expect(settingsResponse.ok()).toBe(true);
  const originalSettings = await settingsResponse.json();
  const originalHours = originalSettings.weeklyHours;

  const startMs = Math.ceil((Date.now() + 30_000) / 600_000) * 600_000;
  const endMs = startMs + 60 * 60_000;
  const extendedEndMs = endMs + 15 * 60_000;
  const localParts = (instant: number) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Santiago",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
  const start = localParts(startMs);
  const operationalEnd = localParts(
    extendedEndMs + Number(originalSettings.closingMarginMinutes ?? 0) * 60_000,
  );
  const bookingDate = `${start.year}-${start.month}-${start.day}`;
  const startAt = `${bookingDate}T${start.hour}:${start.minute}`;
  const weekday = new Date(
    Date.UTC(Number(start.year), Number(start.month) - 1, Number(start.day)),
  ).getUTCDay();
  const temporaryHours = {
    ...originalHours,
    [weekday]: {
      open: `${start.hour}:${start.minute}`,
      close: `${operationalEnd.hour}:${operationalEnd.minute}`,
    },
  };
  const configure = await request.put("/api/staff/settings", {
    headers: authHeaders,
    data: { weeklyHours: temporaryHours },
  });
  expect(configure.ok()).toBe(true);

  try {
    await page.goto("/");
    await page.locator('.topbar nav [data-view="staff"]').click();
    await page.locator('#login [name="email"]').fill("recepcion@demo.local");
    await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
    await page.getByRole("button", { name: "Ingresar →" }).click();
    await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

    const created = await page.request.post("/api/staff/bookings", {
      headers: { origin: "http://127.0.0.1:5173" },
      data: {
        idempotencyKey: `e2e-checkin-${Date.now()}`,
        channel: "walk_in",
        customerName: "E2E Check-in",
        players: 4,
        startAt,
        startMs,
        durationMinutes: 60,
      },
    });
    const createdBody = await created.json();
    expect(created.status(), JSON.stringify(createdBody)).toBe(201);

    await page.reload();
    await page.locator('.topbar nav [data-view="staff"]').click();
    await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();
    const boardDate = page.locator('.calendar-date-picker input[name="board-date"]');
    if ((await boardDate.inputValue()) !== bookingDate) {
      await boardDate.fill(bookingDate);
      await boardDate.dispatchEvent("change");
    }
    const event = page.locator('[data-action="booking"]').filter({ hasText: "E2E Check-in" });
    await expect(event).toBeVisible();
    await event.click();
    const detail = page.locator(".modal");
    await detail.getByRole("button", { name: "Registrar check-in" }).click();
    await expect(page.getByRole("status")).toContainText("Check-in registrado");

    await page.locator('[data-action="booking"]').filter({ hasText: "E2E Check-in" }).click();
    await expect(page.locator(".modal .detail-grid")).toContainText("occupied");
    await page.locator(".modal").getByRole("button", { name: "Extender" }).click();
    const extensionDialog = page.locator(".modal");
    const extensionAccessibility = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(violationSummary(extensionAccessibility.violations)).toBe("");
    await extensionDialog.locator('#extend [name="minutes"]').selectOption("15");
    await extensionDialog.locator('#extend [name="accepted"]').check();
    await extensionDialog.locator("#extend button.primary").click();
    await expect(page.getByRole("status")).toContainText("Extensión autorizada y registrada");

    await page.locator('[data-action="booking"]').filter({ hasText: "E2E Check-in" }).click();
    const expectedEnd = localParts(extendedEndMs);
    await expect(page.locator(".modal .detail-grid")).toContainText(
      `${start.hour}:${start.minute}–${expectedEnd.hour}:${expectedEnd.minute}`,
    );
  } finally {
    const restore = await request.put("/api/staff/settings", {
      headers: authHeaders,
      data: { weeklyHours: originalHours },
    });
    expect(restore.ok()).toBe(true);
  }
});
