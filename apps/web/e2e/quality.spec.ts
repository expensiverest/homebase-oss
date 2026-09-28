import { expect, test, type Page } from "@playwright/test";

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
    expect(background).toBe("rgb(14, 13, 12)");
    await expectNoHorizontalOverflow(page);
    await page.getByLabel("Switch to light theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("reduced motion is respected", async ({ page }) => {
    await page.goto("/?mock=normal");
    const reduced = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    expect(reduced).toBe(true);
    const caretAnimation = await page.evaluate(() => {
      const element = document.createElement("div");
      element.className = "hb-streaming-caret";
      element.innerHTML = '<div class="hb-markdown"><p>streaming</p></div>';
      document.body.append(element);
      const caret = element.querySelector("p") as HTMLElement;
      const style = getComputedStyle(caret, "::after");
      const duration = style.animationName === "none" ? "0s" : style.animationDuration;
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

test.describe("design regressions", () => {
  /** The textarea owns the composer width; actions never squeeze it. */
  async function textareaWidth(page: Page): Promise<number> {
    const box = await page.getByRole("textbox", { name: "Message" }).boundingBox();
    return box?.width ?? 0;
  }

  test("running composer keeps a wide textarea with stop, steer, queue and attach", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Add attachment")).toBeVisible();
    await expect(page.getByLabel("Steer the agent now")).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message" })
      .fill("Queue this follow-up\nacross several lines\nso the input grows\nlike a real draft");
    expect(await textareaWidth(page)).toBeGreaterThan(330);
    const box = await page.getByRole("textbox", { name: "Message" }).boundingBox();
    expect(box?.height ?? 0, "multiline draft grows the input").toBeGreaterThan(90);
    // Actions sit on one toolbar below the text, never beside it.
    const queue = await page.getByRole("button", { name: "Queue message" }).boundingBox();
    expect(queue!.y).toBeGreaterThan(box!.y + box!.height - 2);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  });

  test("running composer stays wide at 130% text", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("textbox", { name: "Message" }).fill("A queued draft");
    expect(await textareaWidth(page)).toBeGreaterThan(330);
    // Actions wrap inside the composer instead of spilling past its edge.
    const queue = await page.getByRole("button", { name: "Queue message" }).boundingBox();
    expect(queue!.x + queue!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 402) - 16);
    await expectNoHorizontalOverflow(page);
  });

  test("long project, branch and session names truncate without overflow", async ({ page }) => {
    const title =
      "Investigate why the nightly export job occasionally produces duplicate rows for customers in multiple regions";
    await page.goto("/?mock=normal");
    await expect(page.getByRole("button", { name: "Open project northwind-customer-portal-platform" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await openProject(page, "northwind-customer-portal-platform");
    await expect(page.getByRole("heading", { name: "northwind-customer-portal-platform", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: `Open session ${title}` })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await openSession(page, title);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("large model names truncate in the composer controls", async ({ page }) => {
    await page.goto("/?mock=models-large");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByLabel(/^Model:/).click();
    const sheet = page.getByRole("dialog", { name: "Model" });
    await sheet.getByLabel("Search models").fill("Catalog Model 380");
    await sheet.getByRole("radio", { name: /Catalog Model 380/ }).click();
    await sheet.getByRole("button", { name: "Use this model" }).click();
    await expect(page.getByLabel(/^Model: Catalog Model 380/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(await textareaWidth(page)).toBeGreaterThan(330);
  });

  test("healthy providers stay quiet; an outage explains itself with a retry", async ({ page }) => {
    await page.goto("/?mock=normal");
    await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.goto("/?mock=provider-down");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("OpenCode");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
