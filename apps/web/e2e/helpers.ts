import { expect, type Page } from "@playwright/test";

export async function openProject(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `Open project ${name}` }).click();
}

export async function openSession(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Open session ${title}` }).click();
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  const queue = page.getByRole("button", { name: "Queue message" });
  if (await queue.isVisible().catch(() => false)) {
    await queue.click();
    return;
  }
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Fails when the page can scroll horizontally (mobile layout requirement). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(1);
}

/**
 * Asserts that every visible control meets the 44px minimum touch target.
 * Inline text links inside Markdown are exempt (they are text, not controls).
 */
export async function expectTouchTargets(
  page: Page,
  selector = 'button:not([disabled]), [role="radio"], [role="checkbox"], select, textarea, input:not([type="hidden"])',
): Promise<void> {
  const violations = await page.evaluate((query) => {
    const failing: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(query)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44 || rect.width < 44) {
        const label = element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? element.tagName;
        failing.push(
          `${element.tagName.toLowerCase()} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        );
      }
    }
    return failing;
  }, selector);
  expect(violations, violations.join("\n")).toEqual([]);
}

export async function connectionPillText(page: Page): Promise<string> {
  return (await page.locator('[role="status"]').first().textContent()) ?? "";
}

export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Chromium has no software keyboard, so tests drive `visualViewport` the way iOS
 * does: shorter, and scrolled down inside the layout viewport. Until told
 * otherwise the mock reports the real window height, like a browser would.
 * Call before `page.goto`.
 */
export async function installMockVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = new EventTarget();
    let height: number | null = null;
    const viewport = Object.defineProperties(target, {
      height: { get: () => height ?? window.innerHeight },
      width: { get: () => window.innerWidth },
      offsetTop: { value: 0, writable: true },
      offsetLeft: { value: 0 },
      pageTop: { value: 0 },
      pageLeft: { value: 0 },
      scale: { value: 1 },
    });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    (window as unknown as { __setViewport: (h: number | null, t: number) => void }).__setViewport = (next, top) => {
      height = next;
      (viewport as unknown as { offsetTop: number }).offsetTop = top;
      target.dispatchEvent(new Event("resize"));
    };
  });
}

/** Simulates the keyboard opening (`height` shorter, `top` scrolled) or closing (`null`, 0). */
export async function setMockVisualViewport(page: Page, height: number | null, top: number): Promise<void> {
  await page.evaluate(
    ([h, t]) => (window as unknown as { __setViewport: (h: number | null, t: number) => void }).__setViewport(h, t!),
    [height, top] as const,
  );
}
