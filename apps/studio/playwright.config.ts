import { defineConfig } from "@playwright/test";

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
