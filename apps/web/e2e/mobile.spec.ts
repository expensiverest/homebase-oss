import { expect, test } from "@playwright/test";

import { expectNoHorizontalOverflow, ONE_PIXEL_PNG, openProject, openSession, sendMessage } from "./helpers.js";

test.describe("primary user journey", () => {
  test("projects list shows mixed provider status", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
    await expect(page.getByText("OpenCode", { exact: true })).toBeVisible();
    await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open project beacon-web" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("project shows OpenCode and Claude sessions together", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await expect(page.getByRole("button", { name: "Open session Document the gateway endpoints" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open session Fix the flaky auth test" })).toBeVisible();
    await expect(page.getByText("Needs you")).toBeVisible();
    await expect(page.getByText("Working")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("creates an OpenCode session through provider, model, mode, and thinking", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    // The launcher is part of the project screen, not hidden behind a "+".
    const launcher = page.getByRole("region", { name: "Start a session" });
    await expect(launcher.getByRole("radio", { name: "OpenCode" })).toBeVisible();
    await expect(launcher.getByRole("radio", { name: "Claude Code" })).toBeVisible();
    await launcher.getByRole("radio", { name: "OpenCode" }).click();
    await launcher.getByLabel("Thinking level").getByRole("radio", { name: "High" }).click();
    await launcher.getByRole("button", { name: /^Mode:/ }).click();
    await page.getByRole("dialog", { name: "Mode" }).getByRole("radio", { name: /Plan/ }).click();
    await expect(launcher.getByRole("button", { name: "Mode: Plan. Change mode" })).toBeVisible();
    await launcher.getByRole("button", { name: "New session" }).click();
    await expect(page.getByRole("heading", { name: "New session" })).toBeVisible();
    await expect(page.getByText("No messages yet")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("streams a reply, renders a tool row, and lands the final answer", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByRole("heading", { name: "Document the gateway endpoints" })).toBeVisible();
    await sendMessage(page, "Summarize the endpoints");
    await expect(page.getByText("Summarize the endpoints").first()).toBeVisible();
    await expect(page.getByText("src/lib/session.ts")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Mock reply for opencode/)).toBeVisible({ timeout: 15_000 });
    // Exactly one user bubble: the optimistic copy is replaced by history.
    await expect(page.locator("p.whitespace-pre-wrap").filter({ hasText: "Summarize the endpoints" })).toHaveCount(1, {
      timeout: 15_000,
    });
  });

  test("answers an approval after a reload-style refetch", async ({ page }) => {
    await page.goto("/?mock=approval");
    await openProject(page, "aurora-api");
    await openSession(page, "Fix the flaky auth test");
    const card = page.getByRole("region", { name: "Approval needed" });
    await expect(card).toBeVisible();
    await expect(card.getByText("npm test -- auth", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Allow once" }).click();
    await expect(card).toHaveCount(0);
    // Re-entering the session rebuilds the card from the Host read model; the
    // resolved request is gone.
    await page.getByLabel("Back").click();
    await openSession(page, "Fix the flaky auth test");
    await expect(page.getByRole("region", { name: "Approval needed" })).toHaveCount(0);
  });

  test("answers a structured question", async ({ page }) => {
    await page.goto("/?mock=question");
    await openProject(page, "beacon-web");
    await openSession(page, "Polish the onboarding empty state");
    const card = page.getByRole("region", { name: "Question from the agent" });
    await expect(card).toBeVisible();
    await card.getByRole("radio", { name: "SQLite" }).click();
    await card.getByRole("checkbox", { name: "iOS" }).click();
    await card.getByRole("button", { name: "Submit answer" }).click();
    await expect(card).toHaveCount(0);
  });

  test("one button stops, queues and steers a running turn", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    // Nothing typed: the one button is Stop, with a chevron for the rest.
    await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "More run actions" })).toBeVisible();
    // Text typed: the same button becomes Queue.
    await page.getByRole("textbox", { name: "Message" }).fill("also cover pagination");
    await expect(page.getByRole("button", { name: "Queue message" })).toBeVisible();
    await expect(page.getByLabel("Stop the run")).toHaveCount(0);
    // Steer lives in the menu.
    await page.getByRole("button", { name: "More run actions" }).click();
    await page.getByRole("menuitem", { name: "Steer now" }).click();
    await expect(page.getByText("also cover pagination").first()).toBeVisible();
    await page.getByLabel("Stop the run").click();
    await expect(page.getByLabel("Stop the run")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  });

  test("switches model and thinking level from the session", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel(/^Model:/).click();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: /Aurora 1/ }).click();
    await sheet.getByRole("radio", { name: "High" }).click();
    await sheet.getByRole("button", { name: "Use this model" }).click();
    await expect(page.getByLabel(/^Model: Aurora 1/)).toContainText(/high/i);
  });

  test("searches a large model catalog", async ({ page }) => {
    await page.goto("/?mock=models-large");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel(/^Model:/).click();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await sheet.getByLabel("Search models").fill("Catalog Model 042");
    await expect(sheet.getByRole("radio", { name: /Catalog Model 042/ })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /Catalog Model/ })).toHaveCount(1);
  });

  test("switches mode", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel(/^Mode:/).click();
    const sheet = page.getByRole("dialog", { name: "Mode" });
    await sheet.getByRole("radio", { name: /Plan/ }).click();
    await sheet.getByRole("button", { name: "Use this mode" }).click();
    await expect(page.getByLabel(/^Mode: Plan/)).toBeVisible();
  });

  test("attaches an image and shows it in the conversation", async ({ page }) => {
    await page.goto("/?mock=attachments");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    // The composer shows only the small preview, with a way to remove it (no name or size).
    await expect(page.getByRole("button", { name: "Remove diagram.png" })).toBeVisible();
    await sendMessage(page, "What do you see here?");
    await expect(page.getByAltText(/diagram|Attached image/).first()).toBeVisible();
  });

  test("rejects images where the provider only accepts text input", async ({ page }) => {
    await page.goto("/?mock=claude-image-only");
    await openProject(page, "aurora-api");
    await openSession(page, "Fix the flaky auth test");
    // Claude keeps image input on other models; pick the text-only model first.
    await page.getByLabel(/^Model:/).click();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await sheet.getByRole("radio", { name: /Claude Haiku/ }).click();
    await sheet.getByRole("button", { name: "Use this model" }).click();
    await expect(page.getByLabel("Add attachment")).toHaveCount(0);
  });

  test("shows the diff affordance only where diffs are supported", async ({ page }) => {
    await page.goto("/?mock=diff");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel("Show changes").click();
    const sheet = page.getByRole("dialog", { name: "Changes" });
    await expect(sheet.getByText("src/lib/session.ts")).toBeVisible();
    await expect(sheet.getByText("+12")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    // A Claude session must not offer the same control.
    await page.getByLabel("Back").click();
    await openSession(page, "Fix the flaky auth test");
    await expect(page.getByLabel("Show changes")).toHaveCount(0);
  });

  test("deletes a session where the provider supports it and keeps others intact", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel("Delete session").click();
    const sheet = page.getByRole("dialog", { name: "Delete session?" });
    await sheet.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Open session Document the gateway endpoints" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open session Fix the flaky auth test" })).toBeVisible();

    // Claude sessions expose no delete control.
    await openSession(page, "Fix the flaky auth test");
    await expect(page.getByLabel("Delete session")).toHaveCount(0);
  });

  test("pages through a long conversation without losing the newest message", async ({ page }) => {
    await page.goto("/?mock=long-conversation");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByRole("button", { name: "Load earlier messages" })).toBeVisible();
    await expect(page.getByText("Handled request 30.")).toBeVisible();
    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await expect(page.getByRole("button", { name: "Load earlier messages" })).toHaveCount(0);
    await expect(page.getByText("Follow-up request 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
  });

  test("pages through many sessions", async ({ page }) => {
    await page.goto("/?mock=many-sessions");
    await openProject(page, "aurora-api");
    await expect(page.getByRole("button", { name: "Load older sessions" })).toBeVisible();
    await page.getByRole("button", { name: "Load older sessions" }).click();
    await expect(page.getByRole("button", { name: "Load older sessions" })).toHaveCount(0);
  });

  test("shows an empty project list calmly", async ({ page }) => {
    await page.goto("/?mock=empty");
    await expect(page.getByText("No projects yet")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
