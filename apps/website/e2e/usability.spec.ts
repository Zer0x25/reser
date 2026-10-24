import { expect, test } from "@playwright/test";

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("mobile customer can search and choose a booking without tiny text or lost keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");

  const date = page.locator('#search [name="date"]');
  await date.fill(addDays(await date.inputValue(), 10));
  await page.locator('#search [name="time"]').fill("18:00");
  await page.locator('#search [name="players"]').fill("4");
  await page.locator('#search [name="duration"]').selectOption("60");
  await page.getByRole("button", { name: "Buscar horarios →" }).click();

  const firstOption = page.locator(".option-card").first();
  await expect(firstOption).toBeVisible();
  const mobileReadability = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        if (element.closest(".board-scroll, .calendar-axis-viewport")) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > window.innerWidth + 1;
      })
      .slice(0, 8)
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}.${String(element.className).replaceAll(" ", ".")}`,
        bounds:
          Math.round(element.getBoundingClientRect().left) +
          "–" +
          Math.round(element.getBoundingClientRect().right),
      })),
    searchInputFont: Number.parseFloat(
      getComputedStyle(document.querySelector<HTMLInputElement>('#search [name="date"]')!).fontSize,
    ),
    optionDescriptionFont: Number.parseFloat(
      getComputedStyle(document.querySelector<HTMLElement>(".option-info p")!).fontSize,
    ),
  }));
  expect(
    mobileReadability.documentWidth,
    JSON.stringify(mobileReadability.overflowingElements),
  ).toBe(mobileReadability.viewportWidth);
  expect(mobileReadability.searchInputFont).toBeGreaterThanOrEqual(16);
  expect(mobileReadability.optionDescriptionFont).toBeGreaterThanOrEqual(12);

  await firstOption.locator('[data-action="select"]').click();
  await expect(page.locator('#request [name="name"]')).toBeFocused();
});
