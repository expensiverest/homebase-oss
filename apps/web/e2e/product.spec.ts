import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, expectTouchTargets, openProject, openSession } from "./helpers.js";

test("Recent and Folders navigate without per-row session queries", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/?mock=normal");
  await expect(page.getByRole("heading", { name: "Recent", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Folders", exact: true })).toBeVisible();
  expect(requests.filter((url) => /\/projects\/[^/]+\/sessions/.test(url))).toHaveLength(0);
  await page.getByRole("button", { name: "Open folder Development" }).click();
  await expect(page.getByRole("heading", { name: "Development", exact: true })).toBeVisible();
  await openProject(page, "aurora-api");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "Open folder src" }).click();
  await page.getByLabel("Back").click();
  await expect(page.getByRole("button", { name: "Open folder src" })).toBeVisible();
  await page.getByLabel("Back").click();
  await expect(page.getByRole("heading", { name: "aurora-api", exact: true })).toBeVisible();
  await page.getByLabel("Back").click();
  await expect(page.getByRole("heading", { name: "Development", exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
test("account Usage presents supported observations and honest unavailability", async ({ page }) => {
  await page.goto("/?mock=normal");
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Usage", exact: true });
  await expect(sheet.getByText("43% used")).toBeVisible();
  await expect(sheet.getByText("This provider does not expose account usage limits.")).toHaveCount(2);
  await expect(sheet.getByText(/Resets/).first()).toBeVisible();
  await expectTouchTargets(page);
});
test("session usage opens compact totals and details", async ({ page }) => {
  await page.goto("/?mock=normal");
  await openProject(page, "aurora-api");
  await openSession(page, "Document the gateway endpoints");
  await page.getByRole("button", { name: /Session usage/ }).click();
  const sheet = page.getByRole("dialog", { name: "Session usage" });
  await expect(sheet.getByText("12,400", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Cache read", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Reported cost", { exact: true })).toBeVisible();
});
test("known empty modes hide the chat picker; shared sheet has an empty state", async ({ page }) => {
  await page.goto("/?mock=mode-empty");
  await openProject(page, "aurora-api");
  await openSession(page, "Document the gateway endpoints");
  await expect(page.getByRole("button", { name: /^Mode:/ })).toHaveCount(0);
  await page.goto("/dev/ui");
  await page.getByRole("button", { name: "Open empty Mode sheet" }).click();
  const sheet = page.getByRole("dialog", { name: "Mode", exact: true });
  await expect(sheet.getByText(/No selectable modes/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Use this mode" })).toBeDisabled();
});
test("mode discovery errors disable Apply", async ({ page }) => {
  await page.goto("/?mock=mode-error");
  await openProject(page, "aurora-api");
  await openSession(page, "Document the gateway endpoints");
  await page.getByRole("button", { name: /^Mode:/ }).click();
  const sheet = page.getByRole("dialog", { name: "Mode", exact: true });
  await expect(sheet.getByRole("alert")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Use this mode" })).toBeDisabled();
});
test("Files browse folders, source and breadcrumbs with natural back navigation", async ({ page }) => {
  await page.goto("/?mock=normal");
  await openProject(page, "aurora-api");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
  await expectTouchTargets(page);
  await page.getByRole("button", { name: "Open folder src" }).click();
  await page.getByRole("button", { name: "Open file index.ts", exact: true }).click();
  await expect(page.locator("[data-code-block]")).toContainText("export function hello");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Open file index.ts", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "File breadcrumbs" })
    .getByRole("button", { name: "aurora-api", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Open folder src" })).toBeVisible();
});
test("HTML stays source and Markdown remains sanitized in both views", async ({ page }) => {
  await page.goto("/?mock=normal");
  await openProject(page, "aurora-api");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "Open folder src" }).click();
  await page.getByRole("button", { name: "Open file index.html" }).click();
  await expect(page.locator("[data-code-block]")).toContainText("<script>");
  expect(await page.evaluate(() => "projectExecuted" in window)).toBe(false);
  await page
    .getByRole("navigation", { name: "File breadcrumbs" })
    .getByRole("button", { name: "aurora-api", exact: true })
    .click();
  await page.getByRole("button", { name: "Open file README.md" }).click();
  await expect(page.getByRole("heading", { name: "Project notes", exact: true })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator('main a[href^="javascript:"]')).toHaveCount(0);
  await page.getByRole("radio", { name: "Source", exact: true }).click();
  await expect(page.locator("[data-code-block]")).toContainText("<script>");
});
test("images, binaries, oversized files and empty folders have useful states", async ({ page }) => {
  await page.goto("/?mock=normal");
  await openProject(page, "aurora-api");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const root = () =>
    page
      .getByRole("navigation", { name: "File breadcrumbs" })
      .getByRole("button", { name: "aurora-api", exact: true })
      .click();
  await page.getByRole("button", { name: "Open file logo.png" }).click();
  await expect(page.getByAltText("logo.png")).toBeVisible();
  await root();
  for (const name of ["archive.bin", "unsafe.svg"]) {
    await page.getByRole("button", { name: `Open file ${name}` }).click();
    await expect(page.getByText("This file can't be previewed in Homebase yet.", { exact: true })).toBeVisible();
    await root();
  }
  await page.getByRole("button", { name: "Open file large.log" }).click();
  await expect(page.getByText("This file is too large to preview", { exact: true })).toBeVisible();
  await root();
  await page.getByRole("button", { name: "Open folder empty" }).click();
  await expect(page.getByText("This folder is empty.", { exact: true })).toBeVisible();
});
test("Files and Usage support dark mode, large text and reduced motion", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("hb.theme", "dark"));
  await page.goto("/?mock=normal");
  await page.addStyleTag({ content: "html {font-size:130% !important}" });
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await openProject(page, "aurora-api");
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "Open folder src" }).click();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await page
    .getByRole("button", { name: "Open file a-very-long-component-filename-for-mobile-layout-testing.tsx" })
    .click();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});
