import { expect, test } from "@playwright/test";

const valid = `hbpair1.${"A".repeat(43)}`;
test("unpaired browser pairs from a fragment, stays paired, manages devices, and clears private data on revoke", async ({
  page,
}) => {
  await page.goto("/?mock=auth-unpaired");
  await expect(page.getByText("Pair a device to continue")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toHaveCount(0);
  await page.goto(`/pair?mock=auth-unpaired#${valid}`);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await expect(page.getByRole("heading", { name: "Pair this device" })).toBeVisible();
  await page.getByLabel("Device name").fill("Test Phone");
  await page.getByRole("button", { name: "Pair device" }).click();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Devices" }).click();
  await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  await expect(page.getByText("Test Phone")).toBeVisible();
  await page.getByRole("button", { name: "Rename" }).first().click();
  await page.getByRole("dialog", { name: "Rename device" }).getByLabel("Device name").fill("My iPhone");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("My iPhone")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("dialog", { name: "Revoke device?" }).getByRole("button", { name: "Revoke access" }).click();
  await expect(page.getByRole("dialog", { name: "Revoke device?" })).toHaveCount(0);
  await expect(page.getByText("Work iPad", { exact: true })).toBeVisible();
  await expect(page.getByText("Revoked")).toBeVisible();
  await page.getByRole("button", { name: "Forget this device" }).click();
  await page
    .getByRole("dialog", { name: "Forget this device?" })
    .getByRole("button", { name: "Forget this device" })
    .click();
  await expect(page.getByText("Pair a device to continue")).toBeVisible();
  await expect(page.getByText("My iPhone")).toHaveCount(0);
});

test("invalid, expired, and used links explain themselves and never keep a fragment", async ({ page }) => {
  for (const [index, [token, expected]] of (
    [
      ["invalid", "invalid"],
      [`hbpair1.${"B".repeat(43)}`, "expired"],
      [`hbpair1.${"C".repeat(43)}`, "already used"],
    ] as const
  ).entries()) {
    await page.goto(`/pair?mock=auth-unpaired&case=${index}#${token}`);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    await page.getByLabel("Device name").fill("Phone");
    await page.getByRole("button", { name: "Pair device" }).click();
    await expect(page.getByRole("status")).toContainText(expected);
  }
});

test("remote revoke closes the live stream and removes private Projects data", async ({ page }) => {
  await page.goto(`/pair?mock=auth-unpaired#${valid}`);
  await page.getByLabel("Device name").fill("Phone");
  await page.getByRole("button", { name: "Pair device" }).click();
  await expect(page.getByRole("button", { name: "Open project aurora-api" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("homebase:mock-remote-revoke")));
  await expect(page.getByText("Pair a device to continue")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project aurora-api" })).toHaveCount(0);
});
