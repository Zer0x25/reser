import { expect, test } from "@playwright/test";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("@smoke public booking entrypoint loads the OX brand and demo disclosure", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Buscar horarios →" })).toBeVisible();
  await expect(page.getByText("Bowling Espacio OX").first()).toBeVisible();
  await expect(page.getByText("Entorno de demostración")).toBeVisible();
});

test("@smoke reception can navigate the calendar, zoom it, and use a free lane", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Acceso del equipo/ }).click();
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  const boardDate = page.locator('.calendar-date-picker input[name="board-date"]');
  const today = await boardDate.inputValue();
  await page.getByRole("button", { name: "Día siguiente" }).click();
  const nextDay = addDays(today, 1);
  await expect(boardDate).toHaveValue(nextDay);

  const range = page.locator(".calendar-range-button");
  await range.click();
  await expect(range.locator(".calendar-range-label")).not.toHaveText("Total");

  await page.getByRole("button", { name: "Día anterior" }).click();
  await expect(boardDate).toHaveValue(today);
  await page.locator('[data-action="calendar-slot"]').first().press("Enter");
  await expect(page.locator("#manual")).toBeVisible();
  await expect(page.locator('#manual [name="startAt"]')).toHaveValue(new RegExp(`^${today}T`));
  await expect(page.getByRole("status")).toContainText("Inicio precargado");
});

test("@smoke mobile reception can zoom and scroll the calendar", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Acceso del equipo/ }).click();
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });

  const range = page.locator(".calendar-range-button");
  const stepNext = page.locator('[data-action="calendar-range-step"][data-direction="next"]');
  await stepNext.click();
  await stepNext.click();
  await stepNext.click();
  await expect(range.locator(".calendar-range-label")).toHaveText("4 h");

  const scrollRight = page.getByRole("button", { name: "Mostrar horas siguientes" });
  await expect(scrollRight).toBeEnabled();
  const scroller = page.locator(".board-scroll");
  await scrollRight.click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});
