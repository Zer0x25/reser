import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures.js";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
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

test("public booking and reception board meet automated WCAG checks", async ({ page }) => {
  // This single scenario runs five serial Axe scans across different UI states.
  test.setTimeout(60_000);
  await page.goto("/");
  const publicPage = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(publicPage.violations)).toBe("");

  const dateInput = page.locator('#search [name="date"]');
  await dateInput.fill(addDays(await dateInput.inputValue(), 10));
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  await page.locator(".option-card").first().locator('[data-action="select"]').click();
  const publicRequestForm = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(publicRequestForm.violations)).toBe("");

  await page.goto("/recepcion");
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  const receptionBoard = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(receptionBoard.violations)).toBe("");

  await page.locator('[data-action="page"][data-page="requests"]').click();
  const requestQueue = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(requestQueue.violations)).toBe("");

  await page.locator('[data-action="page"][data-page="board"]').click();
  await page.getByRole("button", { name: "Día siguiente" }).click();
  const bookingEvent = page.locator('[data-action="booking"]').first();
  await expect(bookingEvent).toBeVisible();
  await bookingEvent.click();
  const bookingDetail = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(bookingDetail.violations)).toBe("");
});

test("admin workspace meets automated WCAG checks across sections", async ({ page }) => {
  await page.goto("/admin");
  await page.locator('#login [name="email"]').fill("admin@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Administración" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de administración" })).toBeVisible();

  const general = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(general.violations)).toBe("");

  await page
    .getByRole("navigation", { name: "Secciones de administración" })
    .getByRole("button", { name: /Tarifas y promociones/ })
    .click();
  const pricing = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(pricing.violations)).toBe("");

  await page
    .getByRole("navigation", { name: "Secciones de administración" })
    .getByRole("button", { name: /Precio dinámico/ })
    .click();
  const dynamicPricing = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(dynamicPricing.violations)).toBe("");
});

test("reception layout fits tablet and laptop viewports", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.goto("/recepcion");
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  for (const width of [320, 360, 375, 390, 414, 428, 768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.locator(".calendar-range-button")).toBeVisible();
    await expect(page.locator(".calendar-date-picker input")).toBeVisible();
    const layout = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => {
          if (element.closest(".board-scroll, .calendar-axis-viewport")) return false;
          const bounds = element.getBoundingClientRect();
          return bounds.left < -1 || bounds.right > window.innerWidth + 1;
        })
        .slice(0, 12)
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(" ", ".")} ${Math.round(bounds.left)}–${Math.round(bounds.right)}`;
        });
      return { scrollWidth, offenders };
    });
    expect(
      layout.scrollWidth,
      `Viewport ${width}px overflows: ${layout.offenders.join("; ")}`,
    ).toBe(width);
  }
});
