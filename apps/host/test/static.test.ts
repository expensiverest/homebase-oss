import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestHost, type TestHost, type TestHostOptions } from "./helpers/host-fixture.js";

let hosts: TestHost[] = [];
let distDir: string;

beforeEach(() => {
  distDir = mkdtempSync(path.join(tmpdir(), "hb-web-dist-"));
  mkdirSync(path.join(distDir, "assets"), { recursive: true });
  writeFileSync(
    path.join(distDir, "index.html"),
    '<!doctype html><html><body><div id="root">Homebase shell</div></body></html>',
    "utf8",
  );
  writeFileSync(path.join(distDir, "assets", "index-abc12345.js"), "console.log('homebase');", "utf8");
  writeFileSync(path.join(distDir, "manifest.webmanifest"), '{"name":"Homebase"}', "utf8");
  writeFileSync(path.join(path.dirname(distDir), "hb-outside-secret.txt"), "do-not-serve", "utf8");
});

afterEach(async () => {
  for (const host of hosts) await host.cleanup();
  hosts = [];
  rmSync(distDir, { recursive: true, force: true });
  rmSync(path.join(path.dirname(distDir), "hb-outside-secret.txt"), { force: true });
});

async function setup(options: TestHostOptions = {}): Promise<TestHost> {
  const host = await createTestHost({ ...options, webDistPath: distDir });
  hosts.push(host);
  return host;
}

describe("static web serving", () => {
  it("serves the shell at / and deep links, and hashed assets as immutable", async () => {
    const host = await setup();

    const root = await host.runtime.app.request("/");
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toContain("text/html");
    expect(await root.text()).toContain("Homebase shell");

    const deepLink = await host.runtime.app.request("/s/ses_whatever");
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain("Homebase shell");

    const asset = await host.runtime.app.request("/assets/index-abc12345.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    const manifest = await host.runtime.app.request("/manifest.webmanifest");
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get("content-type")).toContain("manifest+json");
    expect(manifest.headers.get("cache-control")).toContain("no-cache");

    const htmlCache = root.headers.get("cache-control");
    expect(htmlCache).toContain("no-cache");
  });

  it("never SPA-falls back for API routes or missing files", async () => {
    const host = await setup();

    const api = await host.runtime.app.request("/api/v1/nope");
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(api.headers.get("cache-control")).toBe("no-store");

    const missingAsset = await host.runtime.app.request("/assets/missing-xyz.js");
    expect(missingAsset.status).toBe(404);
    expect(await missingAsset.text()).not.toContain("Homebase shell");
  });

  it("blocks path traversal outside the dist directory", async () => {
    const host = await setup();

    for (const attempt of [
      "/../hb-outside-secret.txt",
      "/..%2Fhb-outside-secret.txt",
      "/assets/../../hb-outside-secret.txt",
    ]) {
      const response = await host.runtime.app.request(attempt);
      expect(response.status, attempt).toBe(404);
      expect(await response.text(), attempt).not.toContain("do-not-serve");
    }
  });

  it("explains how to build when no web build exists", async () => {
    const emptyDir = mkdtempSync(path.join(tmpdir(), "hb-web-empty-"));
    try {
      const host = await createTestHost({ webDistPath: emptyDir });
      hosts.push(host);
      const response = await host.runtime.app.request("/");
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("web client is not built");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("serves the real built web client when apps/web/dist exists", async () => {
    const realDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
    if (!existsSync(path.join(realDist, "index.html"))) {
      // The web workspace is built before this suite in `npm run verify`.
      return;
    }
    const host = await createTestHost({ webDistPath: realDist });
    hosts.push(host);

    const root = await host.runtime.app.request("/");
    expect(root.status).toBe(200);
    const html = await root.text();
    expect(html).toContain('id="root"');
    const assetPath = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(assetPath).toBeTruthy();
    const asset = await host.runtime.app.request(assetPath as string);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toContain("immutable");
    const manifest = await host.runtime.app.request("/manifest.webmanifest");
    expect(manifest.status).toBe(200);
  });
});
