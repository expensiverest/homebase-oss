import { expect, test, type Page } from "@playwright/test";

import {
  connectionPillText,
  expectNoHorizontalOverflow,
  expectTouchTargets,
  installMockVisualViewport,
  setMockVisualViewport,
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
    // Focus starts on the dialog itself (never on the search field: that would raise the keyboard).
    await expect(sheet).toBeFocused();
    await expect(sheet.getByLabel("Search models")).not.toBeFocused();
    // Tabbing stays trapped inside the dialog, however many times.
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
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

  test("running composer keeps a wide textarea with one run button and attach", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByLabel("Stop the run")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Add attachment")).toBeVisible();
    await expect(page.getByRole("button", { name: "More run actions" })).toBeVisible();
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
      // Sample every path across two cycles (2.4s each).
      const min = await brain.evaluate(async (svg) => {
        const paths = [...svg.querySelectorAll("path")];
        const lowest = paths.map(() => 1);
        const started = performance.now();
        while (performance.now() - started < 5000) {
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

  test("the composer has one action button that morphs with the run", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const runButton = page.locator("[data-run-button]");
    await expect(runButton).toHaveCount(1);
    await expect(runButton).toHaveAttribute("data-run-button", "stop", { timeout: 10_000 });
    await page.getByRole("textbox", { name: "Message" }).fill("a follow-up");
    await expect(runButton).toHaveAttribute("data-run-button", "queue");
    // Never a row of Stop, Steer and Queue: exactly one round action button (plus the chevron).
    await expect(
      page.getByRole("button", { name: /^(Stop the run|Steer the agent now|Queue message|Send message)$/ }),
    ).toHaveCount(1);
    await page.getByRole("textbox", { name: "Message" }).fill("");
    await expect(runButton).toHaveAttribute("data-run-button", "stop");
  });

  test("the run menu offers steer, queue and stop, and disables text actions with no text", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.locator('[data-run-button="stop"]')).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "More run actions" }).click();
    const menu = page.getByRole("menu", { name: "Run actions" });
    await expect(menu.getByRole("menuitem")).toHaveText(["Steer now", "Queue after this run", "Stop the run"]);
    await expect(menu.getByRole("menuitem", { name: "Steer now" })).toHaveAttribute("aria-disabled", "true");
    await expect(menu.getByRole("menuitem", { name: "Stop the run" })).not.toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expectTouchTargets(page);
  });

  test("pressing and holding the run button opens the menu without sending", async ({ page }) => {
    await page.goto("/?mock=active-stream");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill("hold to choose");
    const button = page.getByRole("button", { name: /Queue message/ });
    await button.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(page.getByRole("menu", { name: "Run actions" })).toBeVisible();
    // The click that ends the press must not fire the primary action.
    await button.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
    await button.dispatchEvent("click");
    await expect(input).toHaveValue("hold to choose");
    await page.getByRole("menuitem", { name: "Queue after this run" }).click();
    await expect(input).toHaveValue("");
  });

  test("the app shell follows the visual viewport when the keyboard opens", async ({ page }) => {
    await installMockVisualViewport(page);
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const fullHeight = page.viewportSize()!.height;
    const keyboardTop = 300;
    const visibleHeight = 480;
    const setViewport = (height: number | null, top: number) => setMockVisualViewport(page, height, top);
    await setViewport(visibleHeight, keyboardTop);
    const shell = page.locator("[data-app-shell]");
    await expect.poll(async () => Math.round((await shell.boundingBox())!.y)).toBe(keyboardTop);
    expect(Math.round((await shell.boundingBox())!.height)).toBe(visibleHeight);
    // The composer hugs the bottom of what is visible: nowhere near the status bar.
    const bar = (await page.locator("[data-prompt-bar]").boundingBox())!;
    expect(bar.y).toBeGreaterThanOrEqual(keyboardTop);
    expect(bar.y + bar.height).toBeLessThanOrEqual(keyboardTop + visibleHeight + 1);
    expect(bar.y + bar.height).toBeGreaterThan(keyboardTop + visibleHeight - 24);
    // With the keyboard up and the field focused, everything above the input steps aside...
    const picker = page.getByRole("button", { name: /^Model:/ });
    await expect(picker).toBeVisible();
    await page.getByRole("textbox", { name: "Message" }).focus();
    await expect(page.locator("[data-keyboard-open]")).toHaveAttribute("data-keyboard-open", "true");
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Mode:/ })).toHaveCount(0);
    // ...so the conversation gets the room, and the input is still there.
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
    // And it returns to the full screen when the keyboard closes.
    await setViewport(null, 0);
    await expect(picker).toBeVisible();
    await expect.poll(async () => Math.round((await shell.boundingBox())!.height)).toBe(fullHeight);
    expect(Math.round((await shell.boundingBox())!.y)).toBe(0);
  });

  test("sub-agents show a status strip and a sheet with each agent's state", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?mock=agents");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");

    // The strip appears as soon as the model spawns agents and counts the working ones.
    const strip = page.locator("[data-agents-strip]");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    await expect(strip).toContainText("of 4 agents working", { timeout: 15_000 });
    await expect(strip).toHaveAttribute("data-agents-strip", "working");
    expect((await strip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalOverflow(page);

    // One tap opens each agent's state.
    await strip.click();
    const sheet = page.getByRole("dialog", { name: "Agents" });
    await expect(sheet).toBeVisible();
    const rows = sheet.locator("[data-task-rows] > li");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Review gateway routes" })).toBeVisible();
    await expectTouchTargets(page);

    // Agents finish at different times: the routes agent completes, the dependency audit fails.
    const routes = rows.filter({ hasText: "Review gateway routes" });
    const deps = rows.filter({ hasText: "Audit dependency versions" });
    await expect(routes).toContainText("Completed", { timeout: 20_000 });
    await expect(deps).toContainText("Failed", { timeout: 20_000 });
    await expect(sheet.locator("[data-agents-summary]")).toContainText("failed");

    // What it was asked and what it answered is one tap further.
    await routes.getByRole("button").first().click();
    await expect(routes.getByText("Found 4 endpoints", { exact: false })).toBeVisible();
    await expect(routes.getByText("Read src/routes/gateway.ts", { exact: false })).toBeVisible();
    await deps.getByRole("button").first().click();
    await expect(deps.getByText("The npm registry request timed out after 30s.")).toBeVisible();

    // Once the run is over the strip settles and the summary stays reachable.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(strip).toHaveAttribute("data-agents-strip", "settled", { timeout: 30_000 });
    await expect(strip).toContainText("4 agents · 1 failed");
    // A few seconds after the last agent finishes the strip steps out of the way; the run's trace keeps the state.
    await expect(strip).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("All four agents reported back", { exact: false })).toBeVisible({ timeout: 15_000 });
  });

  test("the app fills the whole screen even when visualViewport reports a bit short (standalone PWA)", async ({
    page,
  }) => {
    await installMockVisualViewport(page);
    await page.goto("/?mock=normal");
    const height = page.viewportSize()!.height;
    const shell = page.locator("[data-app-shell]");
    // The reported bug: the shell stopped ~62px above the bottom, leaving a strip of plain background.
    await setMockVisualViewport(page, height - 62, 0);
    await expect.poll(async () => Math.round((await shell.boundingBox())!.height)).toBe(height);
    expect(Math.round((await shell.boundingBox())!.y)).toBe(0);
    // The last row of a list can be scrolled clear of the home-indicator area.
    await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("the document is screen-tall so iOS standalone uses the full screen", async ({ page }) => {
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    const metrics = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      overflow: getComputedStyle(document.body).overflow,
    }));
    // iOS only grows a standalone PWA's viewport to the full screen once the document is at least that tall.
    expect(metrics.documentHeight).toBeGreaterThan(metrics.viewportHeight * 1.5);
    expect(metrics.overflow).toBe("hidden");
    await expectNoHorizontalOverflow(page);
  });

  test("a drag on the composer cannot pan the page, while scroll areas still scroll", async ({ page }) => {
    await page.goto("/?mock=long-conversation");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
    // A touchmove that starts on the composer would pan the page (the shake with the keyboard up): it is blocked.
    const onComposer = await page.locator("[data-prompt-bar]").evaluate((element) => {
      const touch = new Touch({ identifier: 1, target: element, clientX: 200, clientY: 700 });
      const event = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        targetTouches: [touch],
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(onComposer).toBe(true);
    // The same drag on the thread is left alone, so the thread scrolls normally.
    const onThread = await page.locator("[data-chat-scroll]").evaluate((element) => {
      const touch = new Touch({ identifier: 2, target: element, clientX: 200, clientY: 400 });
      const event = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        targetTouches: [touch],
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(onThread).toBe(false);
    // A multi-line draft scrolls inside its own textarea, which must keep working too.
    const input = page.getByRole("textbox", { name: "Message" });
    await input.fill(Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n"));
    const onInput = await input.evaluate((element) => {
      const touch = new Touch({ identifier: 3, target: element, clientX: 200, clientY: 700 });
      const event = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [touch],
        targetTouches: [touch],
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(onInput).toBe(false);
  });

  test("opening the model picker never focuses the search field or raises the keyboard", async ({ page }) => {
    await page.goto("/?mock=models-large");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByRole("button", { name: /^Model:/ }).click();
    const dialog = page.getByRole("dialog", { name: "Model" });
    const search = page.getByRole("textbox", { name: "Search models" });
    await expect(search).toBeVisible();
    await expect(search).not.toBeFocused();
    // Focus is inside the dialog (keyboard/screen-reader users are not lost), just not on the field.
    await expect(dialog).toBeFocused();
    // Searching is the user's choice: tapping the field focuses it and typing filters the list.
    await search.click();
    await expect(search).toBeFocused();
    await search.fill("zzzz-no-such-model");
    await expect(dialog.getByText(/No models match|No matching/i).first()).toBeVisible();
  });

  test("an open sheet or image preview retints iOS's status-bar fade, and closing restores it", async ({ page }) => {
    await page.goto("/?mock=attachments");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const read = () =>
      page.evaluate(() => ({
        themeColors: [...document.querySelectorAll('meta[name="theme-color"]')].map(
          (meta) => (meta as HTMLMetaElement).content,
        ),
        rootBackground: document.documentElement.style.backgroundColor,
      }));
    const before = await read();
    expect(before.rootBackground).toBe("");
    // A sheet: the fade takes the dimmed page colour (darker than the light background).
    await page.getByRole("button", { name: /^Model:/ }).click();
    await expect(page.getByRole("dialog", { name: "Model" })).toBeVisible();
    const sheet = await read();
    expect(sheet.themeColors.every((color) => color !== before.themeColors[0])).toBe(true);
    expect(new Set(sheet.themeColors).size).toBe(1);
    expect(sheet.rootBackground).not.toBe("");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Model" })).toHaveCount(0);
    expect(await read()).toEqual(before);
    // The image preview goes darker still, and nests cleanly.
    await page.getByRole("button", { name: "Open image: latency-chart.svg" }).click();
    await expect(page.getByRole("dialog", { name: "Image preview" })).toBeVisible();
    const preview = await read();
    expect(preview.themeColors[0]).toBe("#181818");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Image preview" })).toHaveCount(0);
    expect(await read()).toEqual(before);
  });

  test("a re-render never steals focus from a sheet's search field, and Shift+Tab stays inside the dialog", async ({
    page,
  }) => {
    await installMockVisualViewport(page);
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByRole("button", { name: /^Model:/ }).click();
    const dialog = page.getByRole("dialog", { name: "Model" });
    const search = page.getByRole("textbox", { name: "Search models" });
    await search.click();
    await search.fill("aur");
    // Anything that re-renders the screen (here: the keyboard resizing the view) leaves focus and text alone.
    await setMockVisualViewport(page, 480, 300);
    await setMockVisualViewport(page, 470, 310);
    await setMockVisualViewport(page, null, 0);
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("aur");
    // From the dialog itself, Shift+Tab wraps within it instead of escaping to the page behind.
    await dialog.focus();
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
  });

  test("a sheet stays in view above the keyboard and its focused search field is not clipped", async ({ page }) => {
    await installMockVisualViewport(page);
    await page.goto("/?mock=normal");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await page.getByRole("button", { name: /^Model:/ }).click();
    const dialog = page.getByRole("dialog", { name: "Model" });
    const search = page.getByRole("textbox", { name: "Search models" });
    await expect(search).toBeVisible();

    // The keyboard opens: iOS shrinks the visible area and scrolls it down inside the layout viewport.
    const top = 300;
    const height = 480;
    await setMockVisualViewport(page, height, top);
    await search.focus();
    const frame = page.locator("[data-sheet-frame]");
    await expect.poll(async () => Math.round((await frame.boundingBox())!.y)).toBe(top);
    expect(Math.round((await frame.boundingBox())!.height)).toBe(height);
    // Sheet and search field are inside the visible area, not pushed above it.
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.y).toBeGreaterThanOrEqual(top - 1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(top + height + 1);
    const field = (await search.boundingBox())!;
    expect(field.y).toBeGreaterThanOrEqual(top);
    expect(field.y + field.height).toBeLessThanOrEqual(top + height);
    // The focus outline is drawn outside the field: leave room above it in the scroller (was clipped).
    const room = await search.evaluate((element) => {
      const scroller = element.closest("[data-sheet-body]")!;
      return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    });
    expect(room).toBeGreaterThanOrEqual(4);
    await expect(search).toBeFocused();

    // Keyboard closes: back to the ordinary bottom sheet.
    await setMockVisualViewport(page, null, 0);
    await expect.poll(async () => Math.round((await frame.boundingBox())!.y)).toBe(0);
    expect(Math.round((await frame.boundingBox())!.height)).toBe(page.viewportSize()!.height);
  });

  test("the agents strip steps aside while the keyboard is up", async ({ page }) => {
    await installMockVisualViewport(page);
    await page.goto("/?mock=agents");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const strip = page.locator("[data-agents-strip]");
    await expect(strip).toBeVisible({ timeout: 15_000 });
    const setViewport = (height: number | null, top: number) => setMockVisualViewport(page, height, top);
    await page.getByRole("textbox", { name: "Message" }).focus();
    await setViewport(480, 300);
    await expect(strip).toHaveCount(0);
    // Dismissing the keyboard brings it back, still live.
    await setViewport(null, 0);
    await expect(strip).toBeVisible();
  });

  test("a sub-agent has its own labelled thread, reachable from the parent and leading back", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/?mock=agents");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    const strip = page.locator("[data-agents-strip]");
    await expect(strip).toContainText("of 4 agents working", { timeout: 15_000 });

    // One tap from the sheet opens the agent's own thread.
    await strip.click();
    const sheet = page.getByRole("dialog", { name: "Agents" });
    await sheet.getByRole("button", { name: "Open sub-agent thread: Review gateway routes" }).click();
    await expect(sheet).toHaveCount(0);

    // It is clearly a sub-agent, with its parent named and linked.
    const header = page.locator("[data-subagent-header]");
    await expect(header).toContainText("Sub-agent");
    await expect(header).toContainText("Spawned by Document the gateway endpoints");
    await expect(page.getByRole("heading", { name: "Review gateway routes" })).toBeVisible();
    await expect(page.getByText("Read src/routes/gateway.ts and list every endpoint", { exact: false })).toBeVisible();
    // Read only: no composer, no delete, and a way back.
    await expect(page.getByRole("textbox", { name: "Message" })).toHaveCount(0);
    await expect(page.getByLabel("Delete session")).toHaveCount(0);
    await expect(page.locator("[data-subagent-footer]")).toContainText("Read only");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    // The thread fills in live while the agent works, then shows its result.
    await expect(page.getByText("Found 4 endpoints", { exact: false })).toBeVisible({ timeout: 20_000 });

    // Back to the parent: the strip and the run are still there.
    await page.getByRole("button", { name: "Parent", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Document the gateway endpoints" })).toBeVisible();
    await expect(page.locator("[data-agents-strip]")).toBeVisible();
    await expect(page.locator("[data-subagent-header]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();

    // Sub-agent threads never clutter the project's own session list.
    await page
      .getByRole("button", { name: /aurora-api/ })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Open session Document the gateway endpoints" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open session Review gateway routes/ })).toHaveCount(0);
  });

  test("a run without sub-agents shows no agents strip", async ({ page }) => {
    await page.goto("/?mock=run-tools");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.locator("[data-live-trace] [data-task-rows]")).toBeVisible();
    await expect(page.locator("[data-agents-strip]")).toHaveCount(0);
  });

  test.describe("thread scrolling", () => {
    const scroller = (page: Page) => page.locator("[data-chat-scroll]");
    const jump = (page: Page) => page.getByRole("button", { name: "Jump to bottom" });

    test("scrolling up is never pulled back to the bottom by live replies", async ({ page }) => {
      test.setTimeout(60_000);
      // A long history that keeps receiving live replies (at about 2.5s, 6.5s and 10.5s).
      await page.goto("/?mock=long-stream");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
      // Cold open: the thread starts at the bottom and offers no jump button.
      await expect(jump(page)).toHaveCount(0);

      // Read older messages: scroll well up.
      const before = await scroller(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight - 900;
        return element.scrollTop;
      });
      await expect(jump(page)).toBeVisible();

      // Let every live reply arrive and finish, sampling the position all the while.
      const drift = await scroller(page).evaluate(async (element, start) => {
        let worst = 0;
        const until = performance.now() + 15_000;
        while (performance.now() < until) {
          worst = Math.max(worst, Math.abs(element.scrollTop - start));
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return worst;
      }, before);
      expect(drift, "the reader's position never moved").toBeLessThanOrEqual(2);
      await expect(jump(page)).toBeVisible();

      // One tap returns to the newest reply, and the button steps away.
      await jump(page).click();
      const newest = page.getByText("Mock reply for opencode: Live follow-up 3");
      await expect(newest).toBeInViewport();
      await expect(jump(page)).toHaveCount(0);

      // Pinned again, the thread follows a new reply on its own.
      const sent = "one more thing";
      await sendMessage(page, sent);
      await expect(page.getByText(`Mock reply for opencode: ${sent}`)).toBeInViewport({ timeout: 15_000 });
    });

    test("loading earlier messages keeps the reader exactly where they were", async ({ page }) => {
      await page.goto("/?mock=long-conversation");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      const button = page.getByRole("button", { name: "Load earlier messages" });
      await expect(button).toBeVisible();
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();

      // Go to the top of what is loaded, as a reader would to load more.
      const measured = await scroller(page).evaluate((element) => {
        element.scrollTop = 0;
        return { height: element.scrollHeight, top: element.scrollTop };
      });
      await expect(jump(page)).toBeVisible();
      await button.click();
      await expect(button).toHaveCount(0);

      // The content that was on screen has not moved: the new content sits above it.
      const after = await scroller(page).evaluate((element) => ({
        height: element.scrollHeight,
        top: element.scrollTop,
        distanceFromBottom: element.scrollHeight - element.scrollTop - element.clientHeight,
      }));
      expect(after.height).toBeGreaterThan(measured.height);
      expect(Math.abs(after.top - (measured.top + (after.height - measured.height)))).toBeLessThanOrEqual(2);
      // ...and it did NOT jump to the bottom.
      expect(after.distanceFromBottom).toBeGreaterThan(1_000);
      await expect(jump(page)).toBeVisible();
      await expect(page.getByText("Follow-up request 1", { exact: true })).toBeAttached();
    });

    test("jump to bottom works on the first tap and leaves the composer focused (keyboard stays open)", async ({
      page,
    }) => {
      await page.goto("/?mock=long-conversation");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
      const input = page.getByRole("textbox", { name: "Message" });
      await input.focus();
      await scroller(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight - 900;
      });
      await expect(jump(page)).toBeVisible();
      // One tap: back at the newest message, with the composer still focused so the keyboard stays up.
      await jump(page).click();
      await expect(jump(page)).toHaveCount(0);
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeInViewport();
      await expect(input).toBeFocused();
    });

    test("the jump button is silent at the bottom, appears when scrolled up and works with the keyboard", async ({
      page,
    }) => {
      await page.goto("/?mock=long-conversation");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
      await expect(jump(page)).toHaveCount(0);
      await scroller(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight - 600;
      });
      await expect(jump(page)).toBeVisible();
      expect((await jump(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectNoHorizontalOverflow(page);
      await jump(page).focus();
      await page.keyboard.press("Enter");
      await expect(jump(page)).toHaveCount(0);
      await expect(page.getByText("Handled request 30.", { exact: true })).toBeInViewport();
    });
  });

  test.describe("image attachments", () => {
    const openAttachmentsSession = async (page: Page) => {
      await page.goto("/?mock=attachments");
      await openProject(page, "aurora-api");
      await openSession(page, "Document the gateway endpoints");
    };

    test("the composer shows only a small square preview with an easy remove, and tapping it opens it large", async ({
      page,
    }) => {
      await openAttachmentsSession(page);
      await page
        .locator('input[type="file"]')
        .setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: ONE_PIXEL_PNG });
      const chip = page.locator("[data-pending-image]");
      await expect(chip).toBeVisible();
      // No file name, no size: just the picture.
      await expect(chip).not.toContainText("notes.png");
      await expect(chip).not.toContainText(/\d\s?(B|KB|MB)/i);
      const thumb = (await chip.locator("[data-image-thumb]").boundingBox())!;
      expect(Math.round(thumb.width)).toBe(Math.round(thumb.height));
      expect(thumb.width).toBeLessThanOrEqual(72);
      // Removing is one obvious tap on a 44px target.
      const remove = page.getByRole("button", { name: "Remove notes.png" });
      expect((await remove.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectTouchTargets(page);
      // Tapping the preview opens it large; the close button and Escape both dismiss it.
      await chip.locator("[data-image-thumb]").click();
      const lightbox = page.getByRole("dialog", { name: "Image preview" });
      await expect(lightbox).toBeVisible();
      await expect(lightbox.getByRole("img")).toBeVisible();
      await lightbox.getByRole("button", { name: "Close preview" }).click();
      await expect(lightbox).toHaveCount(0);
      await chip.locator("[data-image-thumb]").click();
      await page.keyboard.press("Escape");
      await expect(lightbox).toHaveCount(0);
      // The attachment is still there, and removing it takes it away.
      await expect(chip).toBeVisible();
      await remove.click();
      await expect(chip).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test("a tall phone screenshot opens large inside the safe area, clear of the close button", async ({ page }) => {
      await openAttachmentsSession(page);
      await page.getByRole("button", { name: "Open image: phone-screenshot.svg" }).click();
      const lightbox = page.getByRole("dialog", { name: "Image preview" });
      await expect(lightbox).toBeVisible();
      const image = (await lightbox.getByRole("img").boundingBox())!;
      const close = (await lightbox.getByRole("button", { name: "Close preview" }).boundingBox())!;
      const viewport = page.viewportSize()!;
      // Whole picture, right way round and undistorted (402:874 portrait), filling the space it is given.
      expect(image.height).toBeGreaterThan(image.width * 2);
      expect(Math.abs(image.width / image.height - 402 / 874)).toBeLessThan(0.01);
      expect(image.height).toBeGreaterThan(viewport.height * 0.7);
      // Never under the close button's row, and never off the screen.
      expect(image.y).toBeGreaterThanOrEqual(close.y + close.height - 1);
      expect(image.y + image.height).toBeLessThanOrEqual(viewport.height);
      expect(image.x).toBeGreaterThanOrEqual(0);
      expect(image.x + image.width).toBeLessThanOrEqual(viewport.width);
      // The close button is a solid dark disc so it reads on any picture, and is a 44px target.
      expect(close.width).toBeGreaterThanOrEqual(44);
      const backing = await lightbox
        .getByRole("button", { name: "Close preview" })
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      // (Chromium may report it as rgba(...) or oklab(... / alpha): read the alpha either way.)
      const alpha = Number(/(?:,|\/)\s*([\d.]+)\s*\)$/.exec(backing)?.[1] ?? "1");
      expect(alpha).toBeGreaterThanOrEqual(0.6);
      await lightbox.getByRole("button", { name: "Close preview" }).click();
      await expect(lightbox).toHaveCount(0);
    });

    test("images in your messages and from the model are small squares that open large on tap", async ({ page }) => {
      await openAttachmentsSession(page);
      const thumbs = page.locator("[data-chat-scroll] [data-image-thumb]");
      await expect(thumbs).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        const box = (await thumbs.nth(index).boundingBox())!;
        // Small and square, not the full picture (the sources are 3:2, 720 wide).
        expect(Math.round(box.width)).toBe(Math.round(box.height));
        expect(box.width).toBeLessThanOrEqual(100);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);

      // Yours, then the model's: each opens the whole image on a dark backdrop.
      for (const name of ["mockup.svg", "latency-chart.svg"]) {
        await page.getByRole("button", { name: `Open image: ${name}` }).click();
        const lightbox = page.getByRole("dialog", { name: "Image preview" });
        await expect(lightbox).toBeVisible();
        const image = lightbox.getByRole("img");
        await expect(image).toBeVisible();
        // Large: the full 3:2 picture, not the cropped square.
        const size = (await image.boundingBox())!;
        expect(size.width).toBeGreaterThan(size.height * 1.3);
        expect(size.width).toBeGreaterThan(300);
        // Tapping outside the picture closes it.
        await page.mouse.click(6, 6);
        await expect(lightbox).toHaveCount(0);
      }
    });
  });

  test("user zoom remains available while the app shell contains one-finger page drag", async ({ page }) => {
    await page.goto("/?mock=long-conversation");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toContain("user-scalable=no");
    expect(viewport).not.toContain("maximum-scale=1");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).touchAction)).toBe("auto");
    const pinchPrevented = await page.locator("[data-chat-scroll]").evaluate((element) => {
      const a = new Touch({ identifier: 1, target: element, clientX: 150, clientY: 400 });
      const b = new Touch({ identifier: 2, target: element, clientX: 250, clientY: 400 });
      const event = new TouchEvent("touchmove", {
        bubbles: true,
        cancelable: true,
        touches: [a, b],
        targetTouches: [a, b],
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(pinchPrevented).toBe(false);
    const gesturePrevented = await page.evaluate(() => {
      const event = new Event("gesturestart", { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(gesturePrevented).toBe(false);
  });

  test("the top bar stays put while the thread scrolls, so Back is always reachable", async ({ page }) => {
    await page.goto("/?mock=long-conversation");
    await openProject(page, "aurora-api");
    await openSession(page, "Document the gateway endpoints");
    await expect(page.getByText("Handled request 30.", { exact: true })).toBeVisible();
    const back = page.getByRole("button", { name: /^Back to/ });
    const bar = page.locator("[data-thread-topbar]");
    const scroller = page.locator("[data-chat-scroll]");
    // At the bottom of a long thread (the title is far away), Back is still on screen and tappable.
    await expect(back).toBeInViewport();
    expect((await bar.boundingBox())!.y).toBe(0);
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Mid-thread too.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await expect(back).toBeInViewport();
    expect((await bar.boundingBox())!.y).toBe(0);
    // A hairline appears once the thread has scrolled away from the top, and is quiet at the very top.
    const edge = () => bar.evaluate((element) => getComputedStyle(element).borderBottomColor);
    await expect.poll(edge).not.toBe("rgba(0, 0, 0, 0)");
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect.poll(edge).toBe("rgba(0, 0, 0, 0)");
    // The thread does not slide under or behind the bar: its content starts below it.
    const barBox = (await bar.boundingBox())!;
    const scrollerBox = (await scroller.boundingBox())!;
    expect(scrollerBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
    // And Back works from deep in the thread.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await back.click();
    await expect(page.getByRole("button", { name: "Open session Document the gateway endpoints" })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Remove notes.png" })).toBeVisible();
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
