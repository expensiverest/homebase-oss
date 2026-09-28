import { expect, test } from "@playwright/test";

import { connectionPillText, expectNoHorizontalOverflow, openProject, openSession, sendMessage } from "./helpers.js";

test.describe("provider resilience", () => {
  test("a provider outage degrades the project instead of the whole screen", async ({ page }) => {
    await page.goto("/?mock=provider-down");
    const outage = page.getByRole("alert");
    await expect(outage).toContainText(/OpenCode · unavailable/i);
    const retry = outage.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByRole("alert")).toContainText(/OpenCode · unavailable/i);
    // The healthy provider stays quietly listed as ready.
    await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await openProject(page, "aurora-api");
    await expect(page.getByRole("alert")).toContainText(/OpenCode · unavailable/i);
    // Claude sessions from the healthy provider stay usable.
    await openSession(page, "Fix the flaky auth test");
    await expect(page.getByText("I found the race")).toBeVisible();
    await page.getByLabel("Back").click();
    const launcher = page.getByRole("region", { name: "Start a session" });
    // Only the healthy provider can start sessions; no provider switch is offered.
    await expect(launcher.getByText("Claude Code")).toBeVisible();
    await expect(launcher.getByRole("radio", { name: "OpenCode" })).toHaveCount(0);
    await expect(launcher.getByRole("button", { name: "New session" })).toBeEnabled();
  });

  test("a signed-out provider explains itself and blocks starting a session", async ({ page }) => {
    await page.goto("/?mock=signed-out");
    await expect(page.getByRole("alert")).toContainText(/Claude Code · sign in required/i);
    await openProject(page, "aurora-api");
    const launcher = page.getByRole("region", { name: "Start a session" });
    await launcher.getByRole("radio", { name: "Claude Code" }).click();
    await expect(launcher.getByText(/not signed in/).first()).toBeVisible();
    await expect(launcher.getByRole("button", { name: "New session" })).toBeDisabled();
    // OpenCode still works.
    await launcher.getByRole("radio", { name: "OpenCode" }).click();
    await expect(launcher.getByRole("button", { name: "New session" })).toBeEnabled();
  });

  test("reconnects after the event stream drops and resumes streaming", async ({ page }) => {
    await page.goto("/?mock=reconnecting");
    await expect.poll(async () => connectionPillText(page), { timeout: 10_000 }).toContain("Reconnecting");
    await expect.poll(async () => connectionPillText(page), { timeout: 15_000 }).not.toContain("Reconnecting");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await sendMessage(page, "Are we still live?");
    await expect(page.getByText(/Mock reply for opencode/)).toBeVisible({ timeout: 20_000 });
  });

  test("resync invalidates and keeps the conversation usable", async ({ page }) => {
    await page.goto("/?mock=resync");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByRole("heading", { name: "Document the gateway endpoints" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Found two endpoints")).toBeVisible({ timeout: 10_000 });
    await sendMessage(page, "After resync, keep going");
    await expect(page.getByText(/Mock reply for opencode/)).toBeVisible({ timeout: 20_000 });
  });

  test("host errors show a calm error state instead of a blank screen", async ({ page }) => {
    await page.goto("/?mock=host-error");
    await expect(page.getByText("Homebase cannot reach the Host")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
