import { expect, test, type APIRequestContext } from "@playwright/test";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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
    endMs + Number(originalSettings.closingMarginMinutes ?? 0) * 60_000,
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
  } finally {
    const restore = await request.put("/api/staff/settings", {
      headers: authHeaders,
      data: { weeklyHours: originalHours },
    });
    expect(restore.ok()).toBe(true);
  }
});
