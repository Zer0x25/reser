import { expect, test, type Page } from "./fixtures.js";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function setSmallBookingSearch(page: Page) {
  const date = page.locator('#search [name="date"]');
  await date.fill(addDays(await date.inputValue(), 10));
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
}

test("mobile customer can search and choose a booking without tiny text or lost keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await setSmallBookingSearch(page);
  const search = page.locator("#search .search-button");
  await page.route("**/api/availability*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await search.click();
  await expect(search).toHaveText("Buscando…");
  await expect(search).toBeDisabled();

  const firstOption = page.locator(".option-card").first();
  await expect(firstOption).toBeVisible();
  await page.unroute("**/api/availability*");
  await expect(firstOption.locator('[data-action="select"]')).toBeFocused();

  for (const width of [320, 360, 375, 390, 414, 428, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 740 });
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      searchInputFont: Number.parseFloat(
        getComputedStyle(document.querySelector<HTMLInputElement>('#search [name="date"]')!)
          .fontSize,
      ),
      optionDescriptionFont: Number.parseFloat(
        getComputedStyle(document.querySelector<HTMLElement>(".option-info p")!).fontSize,
      ),
    }));
    expect(layout.documentWidth, `Horizontal overflow at ${width}px`).toBe(layout.viewportWidth);
    if (width <= 700) {
      expect(
        layout.searchInputFont,
        `Search field is too small at ${width}px`,
      ).toBeGreaterThanOrEqual(16);
      expect(
        layout.optionDescriptionFont,
        `Option text is too small at ${width}px`,
      ).toBeGreaterThanOrEqual(12);
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.keyboard.press("Enter");
  await expect(page.locator('#request [name="name"]')).toBeFocused();
});

test("simulated availability handles empty results, connection failure, and retry", async ({
  page,
}) => {
  await page.goto("/");
  await setSmallBookingSearch(page);
  const search = page.locator("#search .search-button");

  await page.route("**/api/availability*", (route) =>
    route.fulfill({ status: 200, json: { alternatives: [] } }),
  );
  await search.click();
  const empty = page.locator(".availability-empty");
  await expect(empty).toContainText("No encontramos horarios");
  await expect(empty).toBeFocused();
  await page.unroute("**/api/availability*");

  await page.route("**/api/availability*", (route) => route.abort("failed"));
  await search.click();
  const notice = page.getByRole("status");
  await expect(notice).toContainText("No pudimos conectar con el servicio");
  await expect(notice).toBeFocused();
  await expect(page.locator(".availability-empty")).toHaveCount(0);
  await page.unroute("**/api/availability*");

  await search.click();
  await expect(page.locator(".option-card").first()).toBeVisible();
  await expect(page.locator('.option-card [data-action="select"]').first()).toBeFocused();
});
