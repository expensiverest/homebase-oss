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
