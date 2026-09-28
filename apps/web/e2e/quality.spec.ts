import { expect, test, type Page } from "@playwright/test";

import {
  connectionPillText,
  expectNoHorizontalOverflow,
  expectTouchTargets,
  ONE_PIXEL_PNG,
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

test.describe("agent work presentation", () => {
  test("the orbit shows before any work", async ({ page }) => {
    await page.goto("/?mock=run-starting");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.locator("[data-agent-loading]")).toBeVisible();
  });

  // Separate tests: each mock scenario starts its own event sequence.
  test("the orbit is gone once tools are visible", async ({ page }) => {
    await page.goto("/?mock=run-tools");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.locator("[data-live-trace] [data-task-rows]")).toBeVisible();
    await expect(page.locator("[data-agent-loading]")).toHaveCount(0);
  });

  test("the animated brain shows for active reasoning and rests under reduced motion", async ({ page }) => {
    await page.goto("/?mock=run-thinking");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const brain = page.locator('[data-brain="animated"] svg');
    await expect(brain).toHaveCount(1);
    // The suite runs with prefers-reduced-motion: reduce; the icon must not loop.
    await expect(brain).toHaveAttribute("data-motion-state", "resting");
    // Not merely slowed down: no path is animating and every path holds full opacity.
    await expect(brain.locator("path")).toHaveCount(8);
    const state = await brain.evaluate((svg) => ({
      running: svg.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
      opacities: [...svg.querySelectorAll("path")].map((path) => getComputedStyle(path).opacity),
      hidden: svg.getAttribute("aria-hidden"),
    }));
    expect(state.running).toBe(0);
    expect(new Set(state.opacities)).toEqual(new Set(["1"]));
    expect(state.hidden).toBe("true");
  });

  test.describe("with motion allowed", () => {
    test.use({ reducedMotion: "no-preference" });

    test("the animated brain ripples a wave through the folds while the outline holds", async ({ page }) => {
      await page.goto("/?mock=run-thinking");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      const brain = page.locator('[data-brain="animated"] svg');
      await expect(brain).toHaveAttribute("data-motion-state", "looping");
      await expect(brain.locator("path")).toHaveCount(8);
      // Sample every path across two cycles (1.2s each).
      const min = await brain.evaluate(async (svg) => {
        const paths = [...svg.querySelectorAll("path")];
        const lowest = paths.map(() => 1);
        const started = performance.now();
        while (performance.now() - started < 2600) {
          paths.forEach((path, index) => {
            lowest[index] = Math.min(lowest[index]!, Number(getComputedStyle(path).opacity));
          });
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return { lowest, folds: [paths[0]!.getAttribute("d"), paths[1]!.getAttribute("d")] };
      });
      // Paths 0 and 1 are the interior fissures: they dip deep (0.35).
      expect(min.lowest[0]).toBeLessThan(0.6);
      expect(min.lowest[1]).toBeLessThan(0.6);
      // The enclosing outline only ever brushes (0.72), so it stays above the fold dip.
      for (const outline of min.lowest.slice(2)) {
        expect(outline).toBeLessThan(0.95);
        expect(outline).toBeGreaterThan(0.6);
      }
    });
  });

  test("settled reasoning shows a still brain", async ({ page }) => {
    await page.goto("/?mock=run-tools");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.locator('[data-brain="static"]')).toHaveCount(1);
    await expect(page.locator('[data-brain="animated"]')).toHaveCount(0);
  });

  test("a confirm question uses the recommendation card with no fabricated confidence", async ({ page }) => {
    await page.goto("/?mock=confirm");
    await openProject(page, "beacon-web");
    await openSession(page, "Polish the onboarding empty state");
    const card = page.getByRole("region", { name: "Question from the agent" });
    await expect(card.getByText("Use SQLite for local settings storage?")).toBeVisible();
    await expect(card.locator("[data-signal], [data-confidence]")).toHaveCount(0);
    await expect(card).not.toContainText(/confidence/i);
    await expectTouchTargets(page);
    await card.getByRole("button", { name: "Yes, go ahead" }).click();
    await expect(card).toHaveCount(0);
  });

  test("tool details stay inspectable from the folded work", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "beacon-web");
    await openSession(page, "Add cursor pagination to the audit log");
    await page.getByRole("button", { name: /^Worked for/ }).click();
    const chips = page.locator("[data-tool-chips]");
    await chips.getByRole("button", { name: /Run npm test -- audit-log/ }).click();
    await expect(chips.getByText("Tests: 14 passed, 14 total")).toBeVisible();
  });

  test("the folded-work chevron stays with its summary when the text wraps", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/?mock=normal");
    await openProject(page, "beacon-web");
    await openSession(page, "Add cursor pagination to the audit log");
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    const button = page.getByRole("button", { name: /^Worked for/ });
    const box = (await button.boundingBox())!;
    const chevron = (await button.locator("[data-work-chevron]").boundingBox())!;
    // The summary wraps onto more than one line at this size...
    expect(box.height).toBeGreaterThan(60);
    // ...and the chevron sits on the last line, right after the text, not detached at the far edge.
    expect(chevron.y + chevron.height).toBeGreaterThan(box.y + box.height - 34);
    const lastWord = await button.evaluate((element) => {
      const range = document.createRange();
      const texts = [...element.querySelectorAll("span")].filter((span) => span.textContent?.trim());
      const last = texts[texts.length - 1] as HTMLElement;
      range.selectNodeContents(last);
      const rects = [...range.getClientRects()];
      return rects[rects.length - 1]?.right ?? 0;
    });
    expect(chevron.x - lastWord).toBeLessThan(24);
    await expectNoHorizontalOverflow(page);
  });

  test("marks grow with text but stay capped at 130%", async ({ page }) => {
    await page.goto("/?mock=normal");
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    const mark = (await page.locator('[data-mark="project"]').first().boundingBox())!;
    expect(mark.width).toBeGreaterThan(44);
    expect(mark.width).toBeLessThanOrEqual(Math.round(44 * 1.15) + 0.5);
    await expectNoHorizontalOverflow(page);
    await openProject(page, "aurora-api");
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    const provider = (await page.locator('[data-mark="provider"]').first().boundingBox())!;
    expect(provider.width).toBeLessThanOrEqual(Math.round(38 * 1.15) + 0.5);
    await expectNoHorizontalOverflow(page);
  });

  test("prompt bar keeps a wide input with attachment, long model and running actions at 130%", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
    await expect(page.getByText("notes.png")).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
    await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("textbox", { name: "Message" }).fill("One\ntwo\nthree");
    const input = (await page.getByRole("textbox", { name: "Message" }).boundingBox())!;
    expect(input.width).toBeGreaterThan(330);
    const queue = (await page.getByRole("button", { name: "Queue message" }).boundingBox())!;
    expect(queue.x + queue.width).toBeLessThanOrEqual(402 - 16);
    await expectNoHorizontalOverflow(page);
  });
});
