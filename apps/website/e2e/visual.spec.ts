import { expect, test } from "./fixtures.js";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("@visual public booking screens match mobile visual baselines", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-24T15:00:00-03:00") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Entorno de demostración")).toBeVisible();
  await expect(page).toHaveScreenshot("public-booking-mobile.png", {
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page).toHaveScreenshot("public-booking-desktop.png", {
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });

  const date = page.locator('#search [name="date"]');
  const bookingDate = addDays(await date.inputValue(), 7);
  const startMs = Date.parse(`${bookingDate}T18:00:00-03:00`);
  await page.route("**/api/availability*", (route) =>
    route.fulfill({
      status: 200,
      json: {
        alternatives: [
          {
            startAt: `${bookingDate}T18:00`,
            startMs,
            endMs: startMs + 60 * 60_000,
            startTime: "18:00",
            endTime: "19:00",
            utcOffset: "-03:00",
            durationMinutes: 60,
            laneCount: 1,
            minimumLanes: 1,
            grouped: true,
            quote: { totalClp: 12_000, baseClp: 12_000, discountClp: 0 },
            distanceMinutes: 0,
            rank: 1,
            recommended: true,
          },
        ],
        date: bookingDate,
        preparationMinutes: 10,
        timezone: "America/Santiago",
      },
    }),
  );
  await date.fill(bookingDate);
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();
  await expect(page.locator(".option-card")).toHaveCount(1);
  await expect(page.locator(".availability-empty")).toHaveCount(0);
  await expect(page.locator(".options .eyebrow")).toHaveText("1 OPCIÓN ENCONTRADA");
  await expect(page.locator(".option-info .tag.green")).toHaveText("Recomendado");
  await expect(page.locator(".booking-card")).toHaveScreenshot("public-availability-mobile.png", {
    animations: "disabled",
  });

  await page.locator('.option-card [data-action="select"]').click();
  await expect(page.locator(".request-card")).toHaveScreenshot("public-request-mobile.png", {
    animations: "disabled",
  });
});

test("@visual admin workspace keeps settings focused on desktop and mobile", async ({ page }) => {
  await page.goto("/admin");
  await page.locator('#login [name="email"]').fill("admin@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  await expect(page.getByRole("navigation", { name: "Secciones de administración" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-operation-desktop.png", {
    animations: "disabled",
  });

  const nav = page.getByRole("navigation", { name: "Secciones de administración" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-operation-mobile.png", {
    animations: "disabled",
  });
  await nav.getByRole("button", { name: /Tarifas y promociones/ }).click();
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-pricing-mobile.png", {
    animations: "disabled",
  });
});
