import { chromium, defineConfig } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const databasePath = join(tmpdir(), `bowling-e2e-${process.pid}.sqlite`);
const previewMode = process.env.PLAYWRIGHT_PREVIEW === "true";
const appUrl = previewMode ? "http://127.0.0.1:3001" : "http://127.0.0.1:5173";
const bundledChromium = chromium.executablePath();
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
    baseURL: appUrl,
    browserName: "chromium",
    headless: true,
    locale: "es-CL",
    timezoneId: "Pacific/Auckland",
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: existsSync(bundledChromium)
        ? bundledChromium
        : existsSync("/usr/bin/chromium")
          ? "/usr/bin/chromium"
          : undefined,
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: previewMode
      ? "node e2e/mail-sink.mjs & MAIL_SINK_PID=$!; node server/index.mjs & API_PID=$!; trap 'kill $API_PID $MAIL_SINK_PID 2>/dev/null || true' EXIT; wait $API_PID"
      : "node e2e/mail-sink.mjs & MAIL_SINK_PID=$!; node server/index.mjs & API_PID=$!; trap 'kill $API_PID $MAIL_SINK_PID 2>/dev/null || true' EXIT; ./node_modules/.bin/vp dev --host 127.0.0.1",
    url: appUrl,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    env: {
      DATABASE_PATH: databasePath,
      MVP_MODE: "demo",
      NODE_ENV: "development",
      PLAYWRIGHT_LOGIN_ATTEMPT_LIMIT: "50",
      PORT: "3001",
      TOKEN_SECRET: "playwright-demo-secret-with-at-least-32-bytes",
      MAIL_DELIVERY_URL: "http://127.0.0.1:3002/deliver",
      MAIL_DELIVERY_TOKEN: "e2e-mail-token",
      MAIL_FROM: "reservas@e2e.example.test",
      PUBLIC_APP_URL: appUrl,
    },
  },
});
