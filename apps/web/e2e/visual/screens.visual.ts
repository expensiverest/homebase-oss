import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, openProject, openSession } from "../helpers.js";

/**
 * Deterministic screenshots of the key mobile screens for design review.
 * Output: apps/web/screenshots/<name>-<theme>.png
 */

type Theme = "dark" | "light";

const OUT = "screenshots";

async function boot(page: Page, scenario: string, theme: Theme): Promise<void> {
  await page.addInitScript((value) => {
    try {
      localStorage.setItem("hb.theme", value);
    } catch {
      // ignore
    }
  }, theme);
  await page.goto(`/?mock=${scenario}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function shot(page: Page, name: string, theme: Theme): Promise<void> {
  // Fonts and the first query round-trip settle before capture.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
}

/** The textarea must own the composer width, running or not. */
async function expectWideComposer(page: Page): Promise<void> {
  const box = await page.getByRole("textbox", { name: "Message" }).boundingBox();
  expect(box, "composer textarea").not.toBeNull();
  const viewport = page.viewportSize();
  expect(box!.width, "composer textarea width").toBeGreaterThan((viewport?.width ?? 402) * 0.7);
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`screens (${theme})`, () => {
    test("projects", async ({ page }) => {
      await boot(page, "normal", theme);
      await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
      await shot(page, "01-projects", theme);
    });

    test("projects with a provider problem", async ({ page }) => {
      await boot(page, "provider-down", theme);
      await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
      await shot(page, "02-projects-provider-down", theme);
    });

    test("project", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
      await shot(page, "03-project", theme);
    });

    test("project with long names", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "northwind-customer-portal-platform");
      await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
      await shot(page, "04-project-long-names", theme);
    });

    test("chat idle", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Refactor session storage");
      await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
      await expectWideComposer(page);
      await shot(page, "05-chat-idle", theme);
    });

    test("chat running", async ({ page }) => {
      await boot(page, "active-stream", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
      await page
        .getByRole("textbox", { name: "Message" })
        .fill("Also cover pagination,\nerror shapes,\nand the retry headers\nfor the event stream.");
      await expectWideComposer(page);
      await shot(page, "06-chat-running", theme);
    });

    test("chat approval", async ({ page }) => {
      await boot(page, "approval", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Fix the flaky auth test");
      await expect(page.getByRole("region", { name: "Approval needed" })).toBeVisible();
      await shot(page, "07-chat-approval", theme);
    });

    test("chat question", async ({ page }) => {
      await boot(page, "question", theme);
      await openProject(page, "beacon-web");
      await openSession(page, "Polish the onboarding empty state");
      await expect(page.getByRole("region", { name: "Question from the agent" })).toBeVisible();
      await shot(page, "08-chat-question", theme);
    });

    test("chat long output", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "beacon-web");
      await openSession(page, "Add cursor pagination to the audit log");
      await expect(page.getByText("Worked for", { exact: false }).first()).toBeVisible();
      await shot(page, "09-chat-long-output", theme);
    });

    test("chat composer focused with a long draft", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Refactor session storage");
      const box = page.getByRole("textbox", { name: "Message" });
      await box.fill(Array.from({ length: 8 }, (_, index) => `Line ${index + 1} of a longer prompt`).join("\n"));
      await box.focus();
      await expectWideComposer(page);
      await shot(page, "10-chat-composer-draft", theme);
    });

    test("new session sheet", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await page.getByRole("button", { name: /^Model:/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shot(page, "11-model-sheet", theme);
    });

    test("design QA page", async ({ page }) => {
      await boot(page, "normal", theme);
      await page.goto("/dev/ui");
      await expect(page.getByRole("heading", { name: "Design QA" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${OUT}/12-dev-ui-${theme}.png`, fullPage: true });
    });
  });
}

test("130% text keeps the project and chat layout", async ({ page }) => {
  await boot(page, "active-stream", "dark");
  await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
  await shot(page, "13-projects-130", "dark");
  await openProject(page, "aurora-api");
  await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
  await shot(page, "14-project-130", "dark");
  await openSession(page, "Document the gateway endpoints");
  await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
  await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Message" }).fill("A queued follow-up\nwith two lines");
  await expectWideComposer(page);
  await shot(page, "15-chat-running-130", "dark");
});
