import { defineConfig } from "@playwright/test";

import base from "./playwright.config.js";

/**
 * Visual QA: renders the key mobile screens at 402×874 (iPhone 16 Pro) in both
 * themes and writes PNGs to `screenshots/`. It asserts composition invariants
 * (no overflow, a wide composer) but never compares pixels, so it does not
 * become a brittle golden-image gate. Run with `npm run screenshots -w @homebase/web`
 * and review the images next to the design reference.
 */
export default defineConfig({
  ...base,
  testDir: "./e2e/visual",
  testMatch: /.*\.visual\.ts$/,
  outputDir: "./test-results/visual",
  reporter: [["list"]],
});
