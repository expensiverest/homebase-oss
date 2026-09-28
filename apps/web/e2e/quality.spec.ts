import { expect, test } from "@playwright/test";

import {
  connectionPillText,
  expectNoHorizontalOverflow,
  expectTouchTargets,
  openProject,
  openSession,
  sendMessage,
} from "./helpers.js";

test.describe("quality gates", () => {
  test("no horizontal overflow on projects, sessions, and chat", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expectNoHorizontalOverflow(page);
    await openProject(page, "aurora-api");
    await expectNoHorizontalOverflow(page);
    await openSession(page, "Document the gateway endpoints");
    await expectNoHorizontalOverflow(page);
    await page.getByLabel(/^Model:/).click();
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);
  });

  test("every control meets the 44px touch target", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expectTouchTargets(page);
    await openProject(page, "aurora-api");
    await expectTouchTargets(page);
    await openSession(page, "Document the gateway endpoints");
    await expectTouchTargets(page);
  });

  test("survives 130% root text without overflow", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await openProject(page, "aurora-api");
    await expectNoHorizontalOverflow(page);
    await openSession(page, "Document the gateway endpoints");
    await expectNoHorizontalOverflow(page);
    await sendMessage(page, "Does this layout still hold?");
    await expect(page.getByText(/Mock reply for opencode/)).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page);
  });

  test("light and dark themes both render", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("Switch to dark theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe("rgb(16, 16, 20)");
    await expectNoHorizontalOverflow(page);
    await page.getByLabel("Switch to light theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("reduced motion is respected", async ({ page }) => {
    await page.goto("/?mock=normal");
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced).toBe(true);
    const caretAnimation = await page.evaluate(() => {
      const element = document.createElement("span");
      element.className = "hb-streaming-caret";
      document.body.append(element);
      const duration = getComputedStyle(element, "::after").animationDuration;
      element.remove();
      return duration;
    });
    expect(Number.parseFloat(caretAnimation)).toBeLessThan(0.01);
  });

  test("sheets trap focus, close on Escape, and restore focus", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const trigger = page.getByLabel(/^Model:/);
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Search models")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("icon-only buttons carry accessible labels", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((button) => {
          const text = (button.textContent ?? "").trim();
          const rect = button.getBoundingClientRect();
          return text.length === 0 && rect.width > 0 && !button.getAttribute("aria-label");
        })
        .map((button) => button.outerHTML.slice(0, 80)),
    );
    expect(unlabeled).toEqual([]);
  });

  test("approval flows are keyboard operable", async ({ page }) => {
    await page.goto("/?mock=approval");
    await openProject(page, "aurora-api");
    await openSession(page, "Fix the flaky auth test");
    const allow = page.getByRole("region", { name: "Approval needed" }).getByRole("button", { name: "Allow once" });
    await allow.focus();
    await expect(allow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Approval needed" })).toHaveCount(0);
  });

  test("connection state stays quiet when healthy", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expect.poll(async () => connectionPillText(page), { timeout: 10_000 }).not.toContain("Connecting");
    expect(await connectionPillText(page)).not.toContain("Reconnecting");
  });
});
