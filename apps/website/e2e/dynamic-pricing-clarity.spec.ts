import { expect, test, type APIRequestContext, type Page } from "./fixtures.js";

const dynamicPricing = {
  mode: "active",
  floorClpPerLaneHour: 8_000,
  maxDiscountPercent: 30,
  maxDiscountClpPerLaneHour: 3_000,
  advanceWindowHours: 48,
  lowOccupancyThresholdPercent: 50,
  mediumOccupancyThresholdPercent: 70,
  riskTiers: [{ minPoints: 3, discountPercent: 20 }],
  protectedWeekdays: [],
  protectedBands: [],
  protectedDates: [],
  dailyDiscountBudgetClp: 1_000_000,
  quoteTtlMinutes: 20,
  channels: ["web"],
  pilot: { weekdays: [], bands: [] },
};

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function configurePricing(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { email: "admin@demo.local", password: "BowlingDemo2026!" },
  });
  expect(login.ok()).toBe(true);
  const headers = {
    cookie: login.headers()["set-cookie"].split(";")[0],
    origin: "http://127.0.0.1:5173",
  };
  const current = await request.get("/api/staff/settings", { headers });
  expect(current.ok()).toBe(true);
  const original = (await current.json()) as {
    dynamicPricing: unknown;
    promotions: unknown;
  };
  const promotion = {
    name: "Promoción E2E",
    enabled: true,
    kind: "percent",
    value: 25,
    startsAt: Date.now() - 60 * 60_000,
    endsAt: Date.now() + 48 * 60 * 60_000,
    channel: "web",
  };
  const updated = await request.put("/api/staff/settings", {
    headers,
    data: { dynamicPricing, promotions: [promotion] },
  });
  expect(updated.ok()).toBe(true);
  return { headers, original, promotionName: promotion.name };
}

async function restorePricing(
  request: APIRequestContext,
  headers: Record<string, string>,
  original: { dynamicPricing: unknown; promotions: unknown },
) {
  const restored = await request.put("/api/staff/settings", {
    headers,
    data: { dynamicPricing: original.dynamicPricing, promotions: original.promotions },
  });
  expect(restored.ok()).toBe(true);
}

async function loginAdmin(page: Page) {
  await page.goto("/admin");
  await page.locator('#login [name="email"]').fill("admin@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await page.getByRole("navigation", { name: "Secciones de administración" }).waitFor();
}

async function searchForPrice(page: Page, date: string) {
  await page.goto("/");
  await page.locator('#search [name="date"]').fill(date);
  await page.locator('#search [name="time"]').fill("20:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
}

test("simulator uses unsaved draft and separates dynamic potential from applied promotion", async ({
  page,
  request,
}) => {
  const { headers, original, promotionName } = await configurePricing(request);
  try {
    await page.goto("/");
    const bookingDate = addDays(await page.locator('#search [name="date"]').inputValue(), 1);
    await loginAdmin(page);
    await page
      .getByRole("navigation", { name: "Secciones de administración" })
      .getByRole("button", { name: /Precio dinámico/ })
      .click();
    await page.locator('#dynamic-settings [name="floor"]').fill("11000");

    const startAt = `${bookingDate}T20:00`;
    await page.locator('#dynamic-preview [name="startAt"]').fill(startAt);
    await page.getByRole("button", { name: "Simular oferta" }).click();

    const preview = page.locator(".pricing-preview");
    await expect(preview).toContainText("cambios sin guardar");
    await expect(preview).toContainText("Descuento dinámico potencial");
    await expect(preview).toContainText("$1.000");
    await expect(preview).toContainText(`${promotionName} · $3.000`);
    await expect(preview).toContainText("Total al cliente");
    await expect(preview).toContainText("$9.000");
    await expect(preview).toContainText("Precio dinámico potencial (no aplicado)");
    await expect(preview).toContainText("$11.000");

    const saved = await request.get("/api/staff/settings", { headers });
    const savedSettings = await saved.json();
    expect(savedSettings.dynamicPricing.floorClpPerLaneHour).toBe(8_000);
    expect(savedSettings.dynamicPricing.maxDiscountPercent).toBe(30);
  } finally {
    await restorePricing(request, headers, original);
  }
});

test("customer price breakdown names the applied benefit and never mislabels potential savings", async ({
  page,
  request,
}) => {
  const { headers, original, promotionName } = await configurePricing(request);
  try {
    await page.goto("/");
    const date = addDays(await page.locator('#search [name="date"]').inputValue(), 1);
    await searchForPrice(page, date);
    const promotionalOption = page
      .locator(".option-card")
      .filter({ hasText: promotionName })
      .first();
    await expect(promotionalOption).toBeVisible();
    const promotionalPrice = promotionalOption.locator(".option-price-total");
    await expect(promotionalPrice).toContainText("Catálogo $12.000");
    await expect(promotionalPrice).toContainText(
      `Descuento aplicado · Promoción · ${promotionName}: $3.000`,
    );
    await expect(promotionalPrice).toContainText("Ahorro $3.000");
    await expect(promotionalPrice).toContainText("Precio potencial dinámico (no aplicado)");
    await expect(promotionalPrice).toContainText("$9.600");
    await expect(promotionalPrice).toContainText("$9.000");
    await promotionalOption.locator('[data-action="select"]').click();
    await expect(page.locator(".request-card .total")).toContainText("Ahorro $3.000");
    await expect(page.locator(".request-card .total")).toContainText("$9.000");

    const promotionRemoved = await request.put("/api/staff/settings", {
      headers,
      data: { promotions: [] },
    });
    expect(promotionRemoved.ok()).toBe(true);
    await searchForPrice(page, date);
    const dynamicOption = page
      .locator(".option-card")
      .filter({ hasText: "Precio dinámico aplicado" })
      .first();
    await expect(dynamicOption).toBeVisible();
    const dynamicPrice = dynamicOption.locator(".option-price-total");
    await expect(dynamicPrice).toContainText("Catálogo $12.000");
    await expect(dynamicPrice).toContainText("Descuento aplicado · Precio dinámico: $2.400");
    await expect(dynamicPrice).toContainText("Ahorro $2.400");
    await expect(dynamicPrice).toContainText("$9.600");
    await expect(dynamicPrice).not.toContainText("Precio potencial dinámico");
  } finally {
    await restorePricing(request, headers, original);
  }
});
