import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runExecutable } from "@homebase/adapter-sdk";
import { createServiceManager } from "../src/service/manager.js";
import { ServiceController } from "../src/service/service.js";
import { readHealth } from "../src/service/health.js";
import { sanitizePath } from "../src/service/metadata.js";
import { readAdminStatus } from "../src/setup/diagnostics.js";
import { HOST_VERSION } from "../src/version.js";

/** Real built Host and installed providers, opt-in, isolated security/config/task. No prompts. */
describe.skipIf(process.env.HOMEBASE_TEST_HOMEBASE_SERVICE !== "1" || process.platform !== "win32")(
  "live Windows Homebase service",
  () => {
    it("serves web/status, restarts and cleans up managed provider descendants", async () => {
      const id = randomUUID();
      const manager = createServiceManager("win32", { identifier: `Homebase Test ${id}` });
      const dir = await mkdtemp(path.join(os.tmpdir(), "homebase-host-live-"));
      const stateDir = path.join(dir, "state folder");
      await mkdir(stateDir);
      const configPath = path.join(stateDir, "config.json");
      const entryPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      const port = await new Promise<number>((resolve) => {
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
          const address = server.address() as { port: number };
          server.close(() => resolve(address.port));
        });
      });
      await writeFile(configPath, JSON.stringify({ host: { port }, projectRoots: [] }));
      const service = new ServiceController({
        manager,
        definition: {
          nodePath: process.execPath,
          entryPath,
          configPath,
          stateDir,
          path: sanitizePath(process.env.PATH ?? ""),
          homebaseVersion: HOST_VERSION,
        },
        port,
      });
      const descendants = async (): Promise<number[]> => {
        const script = `$all=@(Get-CimInstance Win32_Process); $root=@($all | Where-Object {$_.CommandLine -and $_.CommandLine.Contains($env:HOMEBASE_FIXTURE_CONFIG) -and $_.Name -eq 'node.exe'}); $ids=@($root | ForEach-Object {[int]$_.ProcessId}); do {$new=@($all | Where-Object {$ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId} | ForEach-Object {[int]$_.ProcessId}); $ids += $new} while($new.Count -gt 0); ConvertTo-Json -Compress -InputObject @($ids)`;
        const result = await runExecutable(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
          { env: { ...process.env, HOMEBASE_FIXTURE_CONFIG: configPath } },
        );
        return JSON.parse(result.stdout) as number[];
      };
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        await service.install();
        expect((await manager.inspect()).installed).toBe(true);
        await service.start();
        expect((await readHealth(port))?.version).toBe(HOST_VERSION);
        const status = await readAdminStatus(port, stateDir);
        expect(status?.providers.some((p) => p.id === "opencode")).toBe(true);
        expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
        const first = await descendants();
        expect(first.length).toBeGreaterThan(0);
        // Exact install and metadata repair must leave the Host/providers alive.
        await service.install();
        expect(first.every(alive)).toBe(true);
        expect((await readHealth(port))?.version).toBe(HOST_VERSION);
        await rm(path.join(stateDir, "service.json"));
        await service.install();
        expect(first.every(alive)).toBe(true);
        expect(await readFile(path.join(stateDir, "service.json"), "utf8")).toContain(HOST_VERSION);
        await service.restart();
        expect((await readHealth(port))?.version).toBe(HOST_VERSION);
        expect(first.every((pid) => !alive(pid))).toBe(true);
        const second = await descendants();
        await service.stop();
        expect(await readHealth(port)).toBeNull();
        expect(second.every((pid) => !alive(pid))).toBe(true);
        expect((await manager.inspect()).running).toBe(false);
        await service.start();
        await service.uninstall();
        expect((await manager.inspect()).installed).toBe(false);
        expect(await readFile(path.join(stateDir, "logs", "host.log"), "utf8")).toContain("Homebase Host");
        console.info(
          `Live Host: install/start/web/status/restart/stop/start/remove passed; ${first.length} first-run and ${second.length} restarted Host/provider processes exited. Providers: ${status?.providers.map((p) => `${p.id}:${p.installed ? "installed" : "missing"}`).join(", ")}`,
        );
      } finally {
        await service.uninstall().catch(() => undefined);
        await manager.stop().catch(() => undefined);
        await manager.uninstall().catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
      }
    }, 180000);
  },
);
