import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runExecutable } from "@homebase/adapter-sdk";
import { createServiceManager } from "../src/service/manager.js";
import { ServiceController } from "../src/service/service.js";
import { readHealth, waitUntil } from "../src/service/health.js";
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
      const projectPath = path.join(dir, "projects", "Example");
      await mkdir(path.join(projectPath, ".git"), { recursive: true });
      await mkdir(path.join(projectPath, "src"));
      await writeFile(path.join(projectPath, "src", "index.ts"), "export const example = true;");
      await mkdir(path.join(dir, "outside"));
      await writeFile(path.join(dir, "outside", "secret.txt"), "outside fixture");
      await symlink(path.join(dir, "outside"), path.join(projectPath, "escape"), "junction");
      const entryPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
      const port = await new Promise<number>((resolve) => {
        const server = createServer();
        server.listen(0, "127.0.0.1", () => {
          const address = server.address() as { port: number };
          server.close(() => resolve(address.port));
        });
      });
      await writeFile(
        configPath,
        JSON.stringify({
          host: { port },
          projectRoots: [path.join(dir, "projects"), projectPath],
          providers: { mock: { enabled: true } },
        }),
      );
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
        let cookie = "";
        const request = (route: string, options: RequestInit = {}) =>
          fetch(`http://127.0.0.1:${port}/api/v1${route}`, {
            ...options,
            headers: { cookie, "x-homebase-client": "1", "content-type": "application/json", ...options.headers },
            signal: AbortSignal.timeout(10000),
          });
        await service.install();
        expect((await manager.inspect()).installed).toBe(true);
        await service.start();
        expect((await readHealth(port))?.version).toBe(HOST_VERSION);
        const status = await readAdminStatus(port, stateDir);
        expect(status?.providers.some((p) => p.id === "opencode")).toBe(true);
        expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
        const adminKey = (await readFile(path.join(stateDir, "admin-key"), "utf8")).trim();
        const invite = (await (
          await request("/admin/pair", { method: "POST", headers: { "x-homebase-admin": adminKey } })
        ).json()) as { token: string };
        const redeemed = await request("/pairing/redeem", {
          method: "POST",
          body: JSON.stringify({ credential: invite.token, name: "Fixture device" }),
        });
        expect(redeemed.status).toBe(201);
        cookie = redeemed.headers.get("set-cookie")!.split(";")[0]!;
        const overview = (await (await request("/projects/overview")).json()) as {
          roots: Array<{ id: string; projectCount: number }>;
        };
        expect(overview.roots.map((r) => r.projectCount).sort()).toEqual([0, 1]);
        const root = overview.roots.find((r) => r.projectCount === 1)!;
        const folder = (await (await request(`/project-roots/${root.id}/projects`)).json()) as {
          projects: Array<{ id: string; lastActivityAt: string | null }>;
        };
        expect(folder.projects).toHaveLength(1);
        const project = folder.projects[0]!;
        expect((await request(`/projects/${project.id}/files?path=src`)).status).toBe(200);
        const code = (await (await request(`/projects/${project.id}/file?path=src/index.ts`)).json()) as {
          text: string;
        };
        expect(code.text).toBe("export const example = true;");
        expect(
          (await request(`/projects/${project.id}/file?path=${encodeURIComponent("../outside/secret.txt")}`)).status,
        ).toBe(400);
        expect((await request(`/projects/${project.id}/file?path=escape/secret.txt`)).status).toBe(403);
        const created = (await (
          await request("/sessions", {
            method: "POST",
            body: JSON.stringify({ provider: "mock", projectId: project.id }),
          })
        ).json()) as { session: { id: string } };
        expect(created.session.id).toBeTruthy();
        if (status?.providers.find((p) => p.id === "opencode")?.installed) {
          const modes = (await (await request(`/projects/${project.id}/providers/opencode/modes`)).json()) as {
            modes: Array<{ id: string }>;
          };
          expect(modes.modes.map((m) => m.id)).toContain("build");
          expect(modes.modes.map((m) => m.id)).toContain("plan");
        }
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
        expect(await waitUntil(async () => first.every((pid) => !alive(pid)), 5000)).toBe(true);
        const restored = (await (await request("/projects/overview")).json()) as {
          recent: Array<{ id: string; lastActivityAt: string }>;
        };
        expect(restored.recent[0]?.id).toBe(project.id);
        expect(restored.recent[0]?.lastActivityAt).toBeTruthy();
        const second = await descendants();
        await service.stop();
        expect(await readHealth(port)).toBeNull();
        // Windows can retain an exited process briefly while OS handles settle.
        // A persistent owned descendant still fails this bounded cleanup check.
        expect(await waitUntil(async () => second.every((pid) => !alive(pid)), 5000)).toBe(true);
        expect((await manager.inspect()).running).toBe(false);
        await service.start();
        await service.uninstall();
        expect((await manager.inspect()).installed).toBe(false);
        expect(await readFile(path.join(stateDir, "logs", "host.log"), "utf8")).toContain("Homebase Host");
        console.info(
          `Live Host: install/start/web/status/hierarchy/files/containment/modes/persisted-recency/restart/stop/start/remove passed; ${first.length} first-run and ${second.length} restarted Host/provider processes exited. Providers: ${status?.providers.map((p) => `${p.id}:${p.installed ? "installed" : "missing"}`).join(", ")}`,
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
