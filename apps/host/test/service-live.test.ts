import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceManager } from "../src/service/manager.js";
import { waitUntil } from "../src/service/health.js";
import { sanitizePath } from "../src/service/metadata.js";

/** Explicit opt-in only: namespaced fixture, no providers, no model calls, finally cleanup. */
describe.skipIf(process.env.HOMEBASE_TEST_SERVICE !== "1")("live user service fixture", () => {
  it("install/query/start/stop/start/uninstall removes task and fixture process", async () => {
    const id = randomUUID();
    const identifier =
      process.platform === "win32"
        ? `Homebase Test ${id}`
        : process.platform === "darwin"
          ? `com.homebase.test.${id}`
          : `homebase-test-${id}.service`;
    const manager = createServiceManager(process.platform, { identifier });
    const dir = await mkdtemp(path.join(os.tmpdir(), "homebase-service-live-"));
    const stateDir = path.join(dir, "state folder %PATH% & literal");
    await mkdir(stateDir);
    const marker = path.join(stateDir, "marker.json");
    const configPath = path.join(stateDir, "config.json");
    const entryPath = path.join(dir, "fixture with spaces.mjs");
    await writeFile(configPath, JSON.stringify({ marker }));
    await writeFile(
      entryPath,
      `import {readFileSync,writeFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--config')+1],'utf8'));
writeFileSync(config.marker,JSON.stringify({pid:process.pid}));
const timer=setInterval(()=>{},1000);
process.on('SIGTERM',()=>{clearInterval(timer);process.exitCode=0;});
process.on('SIGINT',()=>{clearInterval(timer);process.exitCode=0;});\n`,
    );
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let pid = 0;
    try {
      expect(await manager.isAvailable()).toBe(true);
      await manager.install({
        nodePath: process.execPath,
        entryPath,
        configPath,
        stateDir,
        path: sanitizePath(process.env.PATH ?? process.env.Path ?? ""),
        homebaseVersion: "0.0.1",
      });
      expect((await manager.inspect()).installed).toBe(true);
      await manager.start();
      expect(
        await waitUntil(async () => {
          try {
            pid = JSON.parse(await readFile(marker, "utf8")).pid;
            return alive(pid);
          } catch {
            return false;
          }
        }, 15000),
      ).toBe(true);
      expect((await manager.inspect()).running).toBe(true);
      await manager.stop();
      expect(await waitUntil(async () => !alive(pid), 10000)).toBe(true);
      await rm(marker, { force: true });
      await manager.start();
      expect(
        await waitUntil(async () => {
          try {
            pid = JSON.parse(await readFile(marker, "utf8")).pid;
            return alive(pid);
          } catch {
            return false;
          }
        }, 15000),
      ).toBe(true);
      await manager.stop();
      await manager.uninstall();
      expect((await manager.inspect()).installed).toBe(false);
      expect(await waitUntil(async () => !alive(pid), 10000)).toBe(true);
    } finally {
      await manager.stop().catch(() => undefined);
      await manager.uninstall().catch(() => undefined);
      // This PID came exclusively from our random fixture's private marker.
      if (pid && alive(pid)) process.kill(pid);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);
});
