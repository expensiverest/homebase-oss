import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const WARM_BG = "#0e0d0c";

describe("app icon and theme metadata", () => {
  const manifest = JSON.parse(readFileSync(root("public/manifest.webmanifest"), "utf8")) as {
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; purpose?: string }>;
  };

  it("uses the warm Phase 4 background, not the old cool one", () => {
    expect(manifest.theme_color).toBe(WARM_BG);
    expect(manifest.background_color).toBe(WARM_BG);
    const svg = readFileSync(root("public/icons/icon.svg"), "utf8");
    expect(svg).toContain(`fill="${WARM_BG}"`);
    expect(svg).not.toContain("#101014");
  });

  it("references icon files that exist, including a maskable one", () => {
    for (const icon of manifest.icons) expect(existsSync(root(`public${icon.src}`)), icon.src).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("points the HTML shell at the same icons and colors", () => {
    const html = readFileSync(root("index.html"), "utf8");
    expect(html).toContain('href="/icons/apple-touch-icon.png"');
    expect(html).toContain('href="/icons/icon.svg"');
    expect(html).toContain(`content="${WARM_BG}"`);
    expect(existsSync(root("public/icons/apple-touch-icon.png"))).toBe(true);
  });
});
