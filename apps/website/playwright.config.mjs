import { defineConfig } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `bowling-e2e-${process.pid}.sqlite`);
process.on("exit", () => {
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      rmSync(`${databasePath}${suffix}`, { force: true });
    } catch {
      // Keep test teardown best-effort if SQLite already removed a sidecar file.
    }
  }
});

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    headless: true,
    locale: "es-CL",
    timezoneId: "Pacific/Auckland",
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "node server/index.mjs & API_PID=$!; trap 'kill $API_PID 2>/dev/null || true' EXIT; ./node_modules/.bin/vp dev --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    env: {
      DATABASE_PATH: databasePath,
      MVP_MODE: "demo",
      NODE_ENV: "development",
      PORT: "3001",
      TOKEN_SECRET: "playwright-demo-secret-with-at-least-32-bytes",
    },
  },
});
