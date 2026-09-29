import { expect, test, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow, ONE_PIXEL_PNG, openProject, openSession } from "../helpers.js";

/**
 * Deterministic screenshots of the key mobile screens for design review.
 * Output: apps/web/screenshots/<name>-<theme>.png (402×874 @3×).
 *
 * Captures wait for fonts and for every code block to finish highlighting, so
 * an image never shows the plain pre-highlight frame. Nothing compares pixels.
 */

type Theme = "dark" | "light";

const OUT = "screenshots";
const LARGE_TEXT = "html { font-size: 130% !important; }";

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

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[data-code-block][data-highlight="pending"]')).toHaveCount(0);
  await page.waitForTimeout(250);
}

async function shot(page: Page, name: string, theme: Theme): Promise<void> {
  await settle(page);
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
    test("01 projects", async ({ page }) => {
      await boot(page, "normal", theme);
      await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
      await shot(page, "01-projects", theme);
    });

    test("02 project", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await expect(page.getByRole("button", { name: "New session" })).toBeVisible();
      await shot(page, "02-project", theme);
    });

    test("03 chat orbit (turn started, nothing yet)", async ({ page }) => {
      await boot(page, "run-starting", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator("[data-agent-loading]")).toBeVisible();
      await shot(page, "03-chat-orbit", theme);
    });

    test("04 chat thinking", async ({ page }) => {
      await boot(page, "run-thinking", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator('[data-thinking="active"]')).toBeVisible();
      await shot(page, "04-chat-thinking", theme);
    });

    test("05 chat tools (live trace, a row expanded)", async ({ page }) => {
      await boot(page, "run-tools", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      const rows = page.locator("[data-live-trace] [data-task-rows]");
      await expect(rows).toBeVisible();
      await rows.getByRole("button", { name: /Run npm test/ }).click();
      await shot(page, "05-chat-tools", theme);
    });

    test("06 chat completed work (folded, then opened)", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "beacon-web");
      await openSession(page, "Add cursor pagination to the audit log");
      await page.getByRole("button", { name: /^Worked for/ }).click();
      await expect(page.locator("[data-tool-chips]")).toBeVisible();
      await page.locator("[data-work-row]").scrollIntoViewIfNeeded();
      await shot(page, "06-chat-work", theme);
    });

    test("07 chat approval", async ({ page }) => {
      await boot(page, "approval", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Fix the flaky auth test");
      await expect(page.getByRole("region", { name: "Approval needed" })).toBeVisible();
      await shot(page, "07-chat-approval", theme);
    });

    test("08 chat recommendation (confirm question)", async ({ page }) => {
      await boot(page, "confirm", theme);
      await openProject(page, "beacon-web");
      await openSession(page, "Polish the onboarding empty state");
      await expect(page.getByRole("region", { name: "Question from the agent" })).toBeVisible();
      await shot(page, "08-chat-recommendation", theme);
    });

    test("09 chat idle prompt bar", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Refactor session storage");
      await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
      await expectWideComposer(page);
      await shot(page, "09-chat-idle", theme);
    });

    test("10 chat running prompt bar", async ({ page }) => {
      await boot(page, "active-stream", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
      await page
        .getByRole("textbox", { name: "Message" })
        .fill("Also cover pagination,\nerror shapes,\nand the retry headers\nfor the event stream.");
      await expectWideComposer(page);
      await shot(page, "10-chat-running", theme);
    });

    test("10b chat run menu", async ({ page }) => {
      await boot(page, "active-stream", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
      await page.getByRole("textbox", { name: "Message" }).fill("Also cover pagination.");
      await page.getByRole("button", { name: "More run actions" }).click();
      await expect(page.getByRole("menu", { name: "Run actions" })).toBeVisible();
      await expectWideComposer(page);
      await shot(page, "10b-chat-run-menu", theme);
    });

    test("16 agents strip while sub-agents work", async ({ page }) => {
      await boot(page, "agents", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator("[data-agents-strip]")).toContainText("4 of 4 agents working", { timeout: 20_000 });
      await shot(page, "16-agents-strip", theme);
    });

    test("17 agents sheet", async ({ page }) => {
      await boot(page, "agents", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator("[data-agents-strip]")).toContainText("of 4 agents working", { timeout: 20_000 });
      await page.locator("[data-agents-strip]").click();
      const sheet = page.getByRole("dialog", { name: "Agents" });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator("[data-task-rows] > li")).toHaveCount(4);
      await shot(page, "17-agents-sheet", theme);
    });

    test("18 sub-agent thread", async ({ page }) => {
      await boot(page, "agents", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator("[data-agents-strip]")).toContainText("of 4 agents working", { timeout: 20_000 });
      await page.locator("[data-agents-strip]").click();
      await page
        .getByRole("dialog", { name: "Agents" })
        .getByRole("button", { name: "Open sub-agent thread: Review gateway routes" })
        .click();
      await expect(page.locator("[data-subagent-header]")).toContainText("Sub-agent");
      await expect(page.getByText("Found 4 endpoints", { exact: false })).toBeVisible({ timeout: 20_000 });
      await shot(page, "18-subagent-thread", theme);
    });

    test("19 image attachments: thread, composer preview and large preview", async ({ page }) => {
      await boot(page, "attachments", theme);
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.locator("[data-chat-scroll] [data-image-thumb]")).toHaveCount(3);
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
      await expect(page.locator("[data-pending-image]")).toBeVisible();
      await shot(page, "19a-images-thread-composer", theme);
      await page.getByRole("button", { name: "Open image: latency-chart.svg" }).click();
      await expect(page.getByRole("dialog", { name: "Image preview" })).toBeVisible();
      await shot(page, "19b-image-lightbox", theme);
      await page.getByRole("button", { name: "Close preview" }).click();
      await page.getByRole("button", { name: "Open image: phone-screenshot.svg" }).click();
      await expect(page.getByRole("dialog", { name: "Image preview" })).toBeVisible();
      await shot(page, "19c-image-lightbox-portrait", theme);
    });

    test("11 code block", async ({ page }) => {
      await boot(page, "normal", theme);
      await openProject(page, "beacon-web");
      await openSession(page, "Add cursor pagination to the audit log");
      const code = page.locator("[data-code-block]").first();
      await code.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const block = document.querySelector("[data-code-block]");
        block?.scrollIntoView({ block: "center" });
      });
      await shot(page, "11-code-block", theme);
    });

    test("14 design QA page", async ({ page }) => {
      await boot(page, "normal", theme);
      await page.goto("/dev/ui");
      await expect(page.getByRole("heading", { name: "Design QA" })).toBeVisible();
      await settle(page);
      await page.screenshot({ path: `${OUT}/14-dev-ui-${theme}.png`, fullPage: true });
    });
  });
}

test("12 running prompt bar at 130% text", async ({ page }) => {
  await boot(page, "active-stream", "dark");
  await openProject(page, "aurora-api");
  await openSession(page, "Document the gateway endpoints");
  await page.addStyleTag({ content: LARGE_TEXT });
  await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("textbox", { name: "Message" }).fill("A queued follow-up\nwith two lines");
  await expectWideComposer(page);
  await shot(page, "12-chat-running-130", "dark");
});

test("13 folded work disclosure at 130% text", async ({ page }) => {
  await boot(page, "normal", "dark");
  await openProject(page, "beacon-web");
  await openSession(page, "Add cursor pagination to the audit log");
  await page.addStyleTag({ content: LARGE_TEXT });
  await page.locator("[data-work-row]").first().scrollIntoViewIfNeeded();
  await shot(page, "13-work-disclosure-130", "dark");
});

test("15 projects and project at 130% text", async ({ page }) => {
  await boot(page, "normal", "light");
  await page.addStyleTag({ content: LARGE_TEXT });
  await shot(page, "15a-projects-130", "light");
  await openProject(page, "northwind-customer-portal-platform");
  await page.addStyleTag({ content: LARGE_TEXT });
  await shot(page, "15b-project-long-130", "light");
});

for (const theme of ["dark", "light"] as const) {
  test(`17 pairing and devices (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("hb.theme", value), theme);
    await page.goto(`/pair?mock=auth-unpaired#hbpair1.${"A".repeat(43)}`);
    await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
    await shot(page, "17-pairing", theme);
    await page.getByLabel("Device name").fill("Daniel's iPhone");
    await page.getByRole("button", { name: "Pair device" }).click();
    await page.getByRole("button", { name: "Devices" }).click();
    await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
    await shot(page, "18-devices", theme);
  });
}

test("19 pairing at 130% text", async ({ page }) => {
  await page.goto(`/pair?mock=auth-unpaired#hbpair1.${"A".repeat(43)}`);
  await page.addStyleTag({ content: LARGE_TEXT });
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
  await shot(page, "19-pairing-130", "light");
});
