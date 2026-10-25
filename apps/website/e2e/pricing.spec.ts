import { createHmac } from "node:crypto";
import { appOrigin, expect, test, type APIRequestContext, type Page } from "./fixtures.js";

const tokenSecret = "playwright-demo-secret-with-at-least-32-bytes";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function configureDynamicPricing(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { email: "admin@demo.local", password: "BowlingDemo2026!" },
  });
  expect(login.ok()).toBe(true);
  const headers = {
    cookie: login.headers()["set-cookie"].split(";")[0],
    origin: appOrigin(),
  };
  const current = await request.get("/api/staff/settings", { headers });
  expect(current.ok()).toBe(true);
  const originalDynamicPricing = (await current.json()).dynamicPricing;
  const updated = await request.put("/api/staff/settings", {
    headers,
    data: {
      dynamicPricing: {
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
      },
    },
  });
  expect(updated.ok()).toBe(true);
  return { headers, originalDynamicPricing };
}

async function restoreDynamicPricing(
  request: APIRequestContext,
  headers: Record<string, string>,
  dynamicPricing: unknown,
) {
  const response = await request.put("/api/staff/settings", {
    headers,
    data: { dynamicPricing },
  });
  expect(response.ok()).toBe(true);
}

async function searchForDynamicPrice(page: Page) {
  await page.goto("/");
  const dateInput = page.locator('#search [name="date"]');
  const bookingDate = addDays(await dateInput.inputValue(), 1);
  await dateInput.fill(bookingDate);
  await page.locator('#search [name="time"]').fill("20:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  const discountedOptions = page.locator(".option-card").filter({ hasText: "Precio especial" });
  await expect(discountedOptions.first()).toBeVisible();
  return discountedOptions.first();
}

async function verifyCustomerEmail(
  page: Page,
  request: APIRequestContext,
  customerName: string,
  email: string,
) {
  await page.locator('#request [name="name"]').fill(customerName);
  await page.locator('#request [name="email"]').fill(email);
  await page.locator('#request [data-action="send-code"]').click();
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
  await page.locator('#request [name="code"]').fill(code!);
  await page.locator('#request [data-action="verify"]').click();
  await page.locator('#request [name="terms"]').check();
}

function makeExpiredQuoteToken(token: string) {
  const [body] = token.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.expiresAt = Date.now() - 1;
  const expiredBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", tokenSecret)
    .update(`quote:${expiredBody}`)
    .digest("base64url");
  return `${expiredBody}.${signature}`;
}

test("customer sees and books an eligible dynamic price", async ({ page, request }) => {
  const { headers, originalDynamicPricing } = await configureDynamicPricing(request);
  try {
    const option = await searchForDynamicPrice(page);
    await expect(option.locator(".option-price-total")).toContainText("$12.000");
    await expect(option.locator(".option-price-total")).toContainText("$9.600");
    await option.locator('[data-action="select"]').click();
    await expect(page.locator(".request-card .total")).toContainText("$9.600");
    await expect(page.locator(".quote-lock")).toContainText("Precio válido hasta");

    const email = `dynamic-${Date.now()}@example.test`;
    await verifyCustomerEmail(page, request, "Cliente E2E precio dinámico", email);
    await page.locator("#request button.submit").click();

    const result = page.locator(".result-card");
    await expect(result).toContainText("Tu espacio quedó confirmado.");
    const manageLink = await result
      .getByRole("link", { name: /Ver seguimiento seguro/ })
      .getAttribute("href");
    expect(manageLink).toBeTruthy();
    await page.goto(manageLink!);
    await expect(page.locator(".manage-grid")).toContainText("$9.600");
    await expect(page.locator(".manage-grid")).toContainText("Base $12.000 · descuento $2.400");

    await page.goto("/admin");
    await page.locator('#login [name="email"]').fill("admin@demo.local");
    await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
    await page.getByRole("button", { name: "Ingresar →" }).click();
    const adminNav = page.getByRole("navigation", { name: "Secciones de administración" });
    await adminNav.getByRole("button", { name: /Precio dinámico/ }).click();
    const performance = page.locator(".pricing-performance");
    await expect(performance).toContainText("Resultados del piloto");
    await expect(performance.locator(".pricing-performance-metrics article").nth(1)).toContainText(
      "1",
    );
    await expect(performance.locator(".pricing-performance-metrics article").nth(3)).toContainText(
      "$2.400",
    );
    await performance.locator('[name="pricingPerformanceDays"]').selectOption("7");
    await expect(performance.locator('[name="pricingPerformanceDays"]')).toHaveValue("7");
    await expect(performance.locator(".pricing-performance-metrics article").nth(3)).toContainText(
      "$2.400",
    );
  } finally {
    await restoreDynamicPricing(request, headers, originalDynamicPricing);
  }
});

test("expired dynamic quote clears stale options and explains the next step", async ({
  page,
  request,
}) => {
  const { headers, originalDynamicPricing } = await configureDynamicPricing(request);
  try {
    await page.route("**/api/availability*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.alternatives = body.alternatives.map((option: any) => ({
        ...option,
        quoteToken: makeExpiredQuoteToken(option.quoteToken),
        quoteExpiresAt: Date.now() - 1,
      }));
      await route.fulfill({ response, json: body });
    });

    const option = await searchForDynamicPrice(page);
    await option.locator('[data-action="select"]').click();
    const email = `expired-dynamic-${Date.now()}@example.test`;
    await verifyCustomerEmail(page, request, "Cliente E2E cotización vencida", email);
    await page.locator("#request button.submit").click();

    await expect(page.locator(".notice")).toContainText("La cotización venció");
    await expect(page.locator(".option-card")).toHaveCount(0);
    await expect(page.locator("#search")).toBeVisible();
  } finally {
    await restoreDynamicPricing(request, headers, originalDynamicPricing);
  }
});
