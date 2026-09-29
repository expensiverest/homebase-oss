import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, openProject, openSession, sendMessage } from "./helpers.js";

/**
 * Grok uses exactly the same shared UI as OpenCode and Claude. These checks
 * only exercise capability-driven surfaces: no Grok-specific screen exists.
 */
const GROK_SESSION = "Draft the migration plan";

test.describe("Grok through the shared UI", () => {
  test("is reported as a ready provider and is selectable in the launcher", async ({ page }) => {
    await page.goto("/?mock=normal");
    // OpenCode, Claude, and Grok all report ready on Projects.
    await expect(page.getByText("Grok", { exact: true })).toBeVisible();

    await openProject(page, "aurora-api");
    const choice = page.getByRole("radio", { name: "Grok" });
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-checked", "true");

    // Catalogs are capability-driven: Grok declares models, thinking, and modes.
    await expect(page.getByLabel(/^Model:/)).toContainText("Grok 4.7");
    await expect(page.getByRole("radiogroup", { name: "Thinking level" })).toBeVisible();

    await page.getByRole("button", { name: "New session" }).click();
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
  });

  test("opens a Grok session with normalized history, tools, and live text", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, GROK_SESSION);

    await expect(page.getByText("Plan drafted in three steps.")).toBeVisible();
    // The finished run folds; expand it to see its tool row.
    const folded = page.getByRole("button", { name: /Worked for/ });
    if (await folded.isVisible().catch(() => false)) await folded.click();
    await expect(page.getByText("Read", { exact: true })).toBeVisible();

    await sendMessage(page, "check the migration ordering");
    await expect(page.getByText(/Mock reply for grok/)).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("renders and resolves a Grok approval card", async ({ page }) => {
    await page.goto("/?mock=approval");
    await openProject(page, "aurora-api");
    await openSession(page, GROK_SESSION);

    const card = page.getByRole("region", { name: "Approval needed" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Run the test suite")).toBeVisible();
    await card.getByRole("button", { name: "Allow once" }).click();
    await expect(card).toHaveCount(0);
  });

  test("offers Stop but never queue or steer for Grok", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, GROK_SESSION);
    await sendMessage(page, "walk me through the whole migration plan in detail");

    await expect(page.getByRole("button", { name: "Stop the run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue message" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Steer the agent now" })).toHaveCount(0);
    await expect(page.getByPlaceholder("The agent is working…")).toBeVisible();
  });

  test("keeps Grok chat overflow-free in dark mode and at 130% text", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.getByLabel("Switch to dark theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await openProject(page, "aurora-api");
    await openSession(page, GROK_SESSION);
    await expectNoHorizontalOverflow(page);

    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    await expectNoHorizontalOverflow(page);
  });
});
