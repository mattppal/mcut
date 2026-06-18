import { defineConfig } from "@playwright/test";

/**
 * Editor e2e smoke. Every parity batch ships with a spec here — keyboard
 * behavior regresses invisibly otherwise.
 *
 * Local: `bun run build && bunx playwright test` (set MCUT_CHROME_PATH to a
 * Chrome binary to skip the managed-browser download).
 * CI: the e2e job builds, installs chromium, and runs this.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3123",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    launchOptions: process.env.MCUT_CHROME_PATH
      ? { executablePath: process.env.MCUT_CHROME_PATH }
      : {},
  },
  webServer: {
    command: "bun run start --port 3123",
    url: "http://127.0.0.1:3123",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
