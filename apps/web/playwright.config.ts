import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile E2E runs entirely against deterministic in-app mocks (VITE_MOCK is
 * enabled for the dev server and every navigation selects a scenario with
 * `?mock=<name>`). No provider quota is ever spent by browser tests.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4317",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 402, height: 874 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        reducedMotion: "reduce",
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 4317 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_MOCK: "1" },
  },
});
