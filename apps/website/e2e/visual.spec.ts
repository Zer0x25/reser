import { expect, test, type Page } from "./fixtures.js";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("@visual public booking screens match mobile visual baselines", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-24T15:00:00-03:00") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Entorno de demostración")).toBeVisible();
  const arrows = await page.locator("svg.arrow-up-right").evaluateAll((icons) =>
    icons.map((icon) => {
      const bounds = icon.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }),
  );
  expect(arrows).toHaveLength(3);
  expect(arrows.every(({ width, height }) => width > 0 && height > 0)).toBe(true);
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
            quoteToken: "visual-test-quote-token",
            quoteExpiresAt: startMs + 20 * 60_000,
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

async function openAdmin(page: Page) {
  await page.goto("/admin");
  await page.route("**/api/staff/pricing/performance**", (route) =>
    route.fulfill({
      status: 200,
      json: {
        windowDays: 30,
        from: 0,
        to: 0,
        operational: {
          verifiedRevenueClp: 42_000,
          availableLaneHours: 560,
          activeLaneCount: 12,
          revenuePerAvailableLaneHourClp: 75,
          inventory: {
            reservationCount: 8,
            availableLaneHours: 560,
            committedLaneHours: 312,
            occupancyPercent: 55.7,
            unbookableGapLaneHours: 42.5,
            unbookableGapPercent: 7.6,
            minimumSellableMinutes: 70,
            configurationEstimated: true,
            assignmentEstimated: true,
          },
        },
        totals: {
          reservationCount: 8,
          confirmedCount: 5,
          pendingCount: 1,
          cancelledCount: 2,
          dynamicAppliedCount: 2,
          dynamicDiscountCommittedClp: 4_800,
          dynamicQuoteTotalClp: 19_200,
          dynamicPotentialNotAppliedCount: 1,
          dynamicPotentialNotAppliedClp: 1_200,
        },
        byChannel: [
          {
            channel: "web",
            reservationCount: 6,
            confirmedCount: 4,
            pendingCount: 1,
            cancelledCount: 1,
            dynamicAppliedCount: 2,
            dynamicDiscountCommittedClp: 4_800,
            dynamicQuoteTotalClp: 19_200,
            dynamicPotentialNotAppliedCount: 1,
            dynamicPotentialNotAppliedClp: 1_200,
          },
          {
            channel: "phone",
            reservationCount: 2,
            confirmedCount: 1,
            pendingCount: 0,
            cancelledCount: 1,
            dynamicAppliedCount: 0,
            dynamicDiscountCommittedClp: 0,
            dynamicQuoteTotalClp: 0,
            dynamicPotentialNotAppliedCount: 0,
            dynamicPotentialNotAppliedClp: 0,
          },
        ],
        funnel: {
          totals: {
            offeredCount: 44,
            selectedCount: 12,
            reservedCount: 8,
            confirmedCount: 6,
            paidCount: 3,
            verifiedRevenueClp: 30_000,
            contractedLaneHours: 5,
            revenuePerLaneHourClp: 6_000,
          },
          byPricingGroup: [
            {
              pricingGroup: "dynamic_applied",
              offeredCount: 10,
              selectedCount: 4,
              reservedCount: 3,
              confirmedCount: 2,
              paidCount: 1,
              verifiedRevenueClp: 9_600,
              contractedLaneHours: 2,
              revenuePerLaneHourClp: 4_800,
            },
            {
              pricingGroup: "dynamic_potential",
              offeredCount: 8,
              selectedCount: 1,
              reservedCount: 0,
              confirmedCount: 0,
              paidCount: 0,
              verifiedRevenueClp: 0,
              contractedLaneHours: 0,
              revenuePerLaneHourClp: null,
            },
            {
              pricingGroup: "standard",
              offeredCount: 26,
              selectedCount: 7,
              reservedCount: 5,
              confirmedCount: 4,
              paidCount: 2,
              verifiedRevenueClp: 20_400,
              contractedLaneHours: 3,
              revenuePerLaneHourClp: 6_800,
            },
          ],
        },
      },
    }),
  );
  await page.route("**/api/staff/settings", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const settings = await response.json();
    if (settings.dynamicPricing) settings.dynamicPricing.configVersion = 1;
    await route.fulfill({ response, json: settings });
  });
  await page.locator('#login [name="email"]').fill("admin@demo.local");
  await page.locator('#login [name="password"]').fill("BowlingDemo2026!");
  await page.getByRole("button", { name: "Ingresar →" }).click();
  const nav = page.getByRole("navigation", { name: "Secciones de administración" });
  await expect(nav).toBeVisible();
  return nav;
}

test("@visual admin workspace keeps settings focused on desktop and mobile", async ({ page }) => {
  const nav = await openAdmin(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-operation-desktop.png", {
    animations: "disabled",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-operation-mobile.png", {
    animations: "disabled",
  });
  await nav.getByRole("button", { name: /Tarifas y promociones/ }).click();
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-pricing-mobile.png", {
    animations: "disabled",
  });

  const navButtons = nav.locator("button");
  await expect(navButtons).toHaveCount(5);
  await expect(nav.locator('[data-section="pricing"]')).toContainText("Apagado");
  const navLayout = await nav.evaluate((element) => {
    const buttons = [...element.querySelectorAll("button")];
    const rows = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    return {
      rows: rows.size,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      buttonOverflow: buttons.some((button) => button.scrollWidth > button.clientWidth + 1),
    };
  });
  expect(navLayout.rows).toBe(2);
  expect(navLayout.scrollWidth).toBe(navLayout.clientWidth);
  expect(navLayout.buttonOverflow).toBe(false);
  for (let index = 0; index < 5; index += 1) await expect(navButtons.nth(index)).toBeVisible();
});

async function openDynamicPricingPanel(page: Page) {
  const nav = await openAdmin(page);
  await nav.getByRole("button", { name: /Precio dinámico/ }).click();
  const pricingPerformance = page.locator(".pricing-performance");
  await expect(pricingPerformance).toContainText("$4.800");
  await expect(pricingPerformance).toContainText("Ocupación y fragmentación histórica");
  await expect(pricingPerformance).toContainText("55,7%");
  await expect(pricingPerformance).toContainText("línea base estimada");
  await expect(pricingPerformance).toContainText("asignaciones anteriores al registro");
  return pricingPerformance;
}

test("@visual dynamic pricing performance panel matches desktop", async ({ page }) => {
  await openDynamicPricingPanel(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-dynamic-pricing-desktop.png", {
    animations: "disabled",
  });
});

test("@visual dynamic pricing performance panel matches mobile", async ({ page }) => {
  const pricingPerformance = await openDynamicPricingPanel(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-dynamic-pricing-mobile.png", {
    animations: "disabled",
  });
  expect(
    await pricingPerformance.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

async function openPricingSimulator(page: Page) {
  await page.route("**/api/staff/pricing/preview", (route) =>
    route.fulfill({
      status: 200,
      json: {
        available: true,
        previewOnly: true,
        startAt: "2026-10-31T20:00",
        laneCount: 1,
        quote: {
          baseClp: 12_000,
          discountClp: 2_400,
          totalClp: 9_600,
          promotionName: null,
          pricingSource: "dynamic",
          dynamic: {
            applied: true,
            discountClp: 2_400,
            potentialDiscountClp: 2_400,
            totalAfterDiscountClp: 9_600,
          },
        },
        preview: {
          eligible: true,
          applied: true,
          potentialDiscountClp: 2_400,
          totalAfterDiscountClp: 9_600,
          discountPercent: 20,
          riskPoints: 3,
          reason: "Baja ocupación en esta franja",
          reasonCode: "low_occupancy",
          signals: { occupancyPercent: 18, leadTimeHours: 144 },
          tier: { minPoints: 3, discountPercent: 20 },
          configVersion: 1,
        },
      },
    }),
  );
  const nav = await openAdmin(page);
  await nav.getByRole("button", { name: /Precio dinámico/ }).click();
  await page.locator('#dynamic-preview [name="startAt"]').fill("2026-10-31T20:00");
  await page.getByRole("button", { name: "Simular oferta" }).click();
  await expect(page.locator(".pricing-preview")).toBeVisible();
}

test("@visual dynamic pricing simulator result matches desktop", async ({ page }) => {
  await openPricingSimulator(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".admin-view")).toHaveScreenshot(
    "admin-dynamic-simulator-desktop.png",
    {
      animations: "disabled",
    },
  );
});

test("@visual dynamic pricing simulator result matches mobile", async ({ page }) => {
  await openPricingSimulator(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".admin-view")).toHaveScreenshot("admin-dynamic-simulator-mobile.png", {
    animations: "disabled",
  });
});
