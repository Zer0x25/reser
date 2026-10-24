import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

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
  await page.goto("/");
  const publicPage = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(publicPage.violations)).toBe("");

  await page.locator('.topbar nav [data-view="staff"]').click();
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  const receptionBoard = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(violationSummary(receptionBoard.violations)).toBe("");
});

test("reception layout fits tablet and laptop viewports", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.locator('.topbar nav [data-view="staff"]').click();
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 1024 });
    await expect(page.locator(".calendar-range-button")).toBeVisible();
    await expect(page.locator(".calendar-date-picker input")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBe(0);
  }
});
