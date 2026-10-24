import { expect, test } from "./fixtures.js";

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
  await expect(page.locator('.topbar [data-view="staff"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: /recepción|administración/i })).toHaveCount(0);
});

test("@smoke reception can navigate the calendar, zoom it, and use a free lane", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page.getByText("PORTAL ADMINISTRADOR")).toBeVisible();
  await page.goto("/recepcion");
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Solo administración" })).toBeVisible();
  await page.goto("/recepcion");
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();

  const boardDate = page.locator('.calendar-date-picker input[name="board-date"]');
  const today = await boardDate.inputValue();
  await page.getByRole("button", { name: "Día siguiente" }).click();
  const nextDay = addDays(today, 1);
  await expect(boardDate).toHaveValue(nextDay);

  const search = page.getByRole("searchbox", { name: "Encontrar reserva" });
  await search.fill("valentina");
  await expect(page.locator("#board-filter-count")).toHaveText("1 reserva coincide");
  await expect(page.locator(".booking-event:not([hidden])")).toHaveCount(1);
  const statusFilter = page.locator("#board-booking-status");
  await statusFilter.selectOption("confirmed");
  await expect(page.locator("#board-filter-count")).toHaveText("1 reserva coincide");
  await statusFilter.selectOption("held");
  await expect(page.locator("#board-filter-count")).toContainText("No encontramos reservas");
  await statusFilter.selectOption("all");
  await search.fill("no existe");
  await expect(page.locator(".booking-event:not([hidden])")).toHaveCount(0);
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(search).toHaveValue("");
  await expect.poll(() => page.locator(".booking-event:not([hidden])").count()).toBeGreaterThan(1);

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

test("@smoke @visual mobile reception can zoom and scroll the calendar", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-24T15:00:00-03:00") });
  await page.route("**/api/staff/board?*", async (route) => {
    const response = await route.fetch();
    const board = await response.json();
    const start = board.axisStartMs + 60 * 60_000;
    await route.fulfill({
      response,
      json: {
        ...board,
        reservations: [
          {
            id: "visual-demo-booking",
            code: "V-DEMO01",
            customerName: "Reserva de prueba",
            customerPhone: "+56900000000",
            start,
            end: start + 60 * 60_000,
            players: 4,
            laneCount: 1,
            lanes: [1],
            status: "confirmed",
            utcOffset: "-03:00",
          },
        ],
      },
    });
  });
  await page.route("**/api/staff/requests", (route) => route.fulfill({ json: { requests: [] } }));
  await page.goto("/recepcion");
  await page.locator('#login [name="email"]').fill("recepcion@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("heading", { name: "Tablero de pistas" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".metrics")).toHaveScreenshot("reception-metrics-mobile.png", {
    animations: "disabled",
  });
  await expect(page.locator(".board-filterbar")).toHaveScreenshot("reception-filters-mobile.png", {
    animations: "disabled",
  });
  await expect(page.locator(".calendar-controls")).toHaveScreenshot(
    "reception-calendar-controls-mobile.png",
    { animations: "disabled" },
  );

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
