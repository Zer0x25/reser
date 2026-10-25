import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "./fixtures.js";

const tokenSecret = "playwright-demo-secret-with-at-least-32-bytes";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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

test("expired quote offers refresh and preserves the complete search", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const date = addDays(await page.locator('#search [name="date"]').inputValue(), 1);
  const time = "19:00";
  const players = 5;
  const duration = 120;
  let availabilityCalls = 0;
  await page.route("**/api/availability*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    availabilityCalls += 1;
    if (availabilityCalls === 1) {
      body.alternatives = body.alternatives.map((option: any) => ({
        ...option,
        quoteToken: makeExpiredQuoteToken(option.quoteToken),
        quoteExpiresAt: Date.now() - 1,
      }));
    }
    await route.fulfill({ response, json: body });
  });

  await page.locator('#search [name="date"]').fill(date);
  await page.locator('#search [name="time"]').fill(time);
  await page.locator('#search [name="players"]').fill(`${players}`);
  await page.locator('#search [name="duration"]').selectOption(`${duration}`);
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  const staleOption = page.locator(".option-card").first();
  await expect(staleOption).toBeVisible();
  await staleOption.locator('[data-action="select"]').click();

  const email = `expired-quote-${Date.now()}@example.test`;
  await verifyCustomerEmail(page, request, "Cliente E2E cotización vencida", email);
  await page.locator("#request button.submit").click();

  await expect(page.locator(".notice")).toContainText("La cotización venció");
  await expect(page.getByRole("button", { name: "Actualizar horarios y precios" })).toBeVisible();
  await expect(page.locator(".option-card")).toHaveCount(0);
  await expect(page.locator(".request-card")).toHaveCount(0);
  await expect(page.locator('#search [name="date"]')).toHaveValue(date);
  await expect(page.locator('#search [name="time"]')).toHaveValue(time);
  await expect(page.locator('#search [name="players"]')).toHaveValue(`${players}`);
  await expect(page.locator('#search [name="duration"]')).toHaveValue(`${duration}`);

  await page.getByRole("button", { name: "Actualizar horarios y precios" }).click();
  await expect(page.locator(".option-card").first()).toBeVisible();
  await expect.poll(() => availabilityCalls).toBe(2);
  await expect(page.locator('#search [name="date"]')).toHaveValue(date);
  await expect(page.locator('#search [name="time"]')).toHaveValue(time);
  await expect(page.locator('#search [name="players"]')).toHaveValue(`${players}`);
  await expect(page.locator('#search [name="duration"]')).toHaveValue(`${duration}`);
  await expect(page.locator(".request-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actualizar horarios y precios" })).toHaveCount(0);
});
