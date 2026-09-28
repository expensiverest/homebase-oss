import { expect, test } from "@playwright/test";

import { connectionPillText, expectNoHorizontalOverflow, openProject, openSession, sendMessage } from "./helpers.js";

test.describe("provider resilience", () => {
  test("a provider outage degrades the project instead of the whole screen", async ({ page }) => {
    await page.goto("/?mock=provider-down");
    await expect(page.getByText("Unavailable")).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByText("Unavailable")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await openProject(page, "aurora-api");
    await expect(page.getByText("OpenCode unavailable")).toBeVisible();
    // Claude sessions from the healthy provider stay usable.
    await openSession(page, "Fix the flaky auth test");
    await expect(page.getByText("I found the race")).toBeVisible();
    await page.getByLabel("Back").click();
    await page.getByLabel("New session").click();
    const sheet = page.getByRole("dialog", { name: "New session" });
    await expect(sheet.getByRole("radio", { name: "Claude Code" })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "OpenCode" })).toHaveCount(0);
  });

  test("a signed-out provider explains itself and blocks starting a session", async ({ page }) => {
    await page.goto("/?mock=signed-out");
    await expect(page.getByText("Sign in required")).toBeVisible();
    await openProject(page, "aurora-api");
    await page.getByLabel("New session").click();
    const sheet = page.getByRole("dialog", { name: "New session" });
    await sheet.getByRole("radio", { name: "Claude Code" }).click();
    await expect(sheet.getByText(/not signed in/).first()).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Start session" })).toBeDisabled();
    // OpenCode still works.
    await sheet.getByRole("radio", { name: "OpenCode" }).click();
    await expect(sheet.getByRole("button", { name: "Start session" })).toBeEnabled();
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
