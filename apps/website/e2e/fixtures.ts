import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
    await use(page);
  },
});

export function appOrigin() {
  const baseURL = test.info().project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required for E2E tests.");
  return new URL(baseURL).origin;
}

export { expect };
export type { APIRequestContext, Page } from "@playwright/test";
