import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunExecutableResult } from "@homebase/adapter-sdk";
import { WindowsTaskServiceManager } from "../src/service/windows.js";
import { LaunchdServiceManager } from "../src/service/launchd.js";
import { SystemdUserServiceManager } from "../src/service/systemd.js";
import { createServiceManager } from "../src/service/manager.js";
import type { ServiceDefinition } from "../src/service/types.js";
import { windowsTaskXml } from "../src/service/definitions.js";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-manager-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const result = (stdout = "", code = 0): RunExecutableResult => ({
  command: "fixture",
  stdout,
  stderr: "",
  code,
  truncated: false,
});
function definition(): ServiceDefinition {
  return {
    nodePath: process.execPath,
    entryPath: path.join(dir, "entry.js"),
    configPath: path.join(dir, "config.json"),
    stateDir: dir,
    path: "",
    homebaseVersion: "0.0.1",
  };
}
describe("Windows manager", () => {
  it("accepts native omission of default least privilege and rejects elevation", () => {
    const d = definition();
    const source = windowsTaskXml(d, "S-1-5-21-1001");
    const m = new WindowsTaskServiceManager();
    expect(
      m.matches(
        {
          installed: true,
          enabled: true,
          running: false,
          definition: source.replace("<RunLevel>LeastPrivilege</RunLevel>", ""),
        },
        d,
      ),
    ).toBe(true);
    expect(
      m.matches(
        {
          installed: true,
          enabled: true,
          running: false,
          definition: source.replace("LeastPrivilege", "HighestAvailable"),
        },
        d,
      ),
    ).toBe(false);
  });
  it("inspects numeric COM state via a fixed script, never localized terminal text", async () => {
    const run = vi
      .fn()
      .mockResolvedValue(
        result(JSON.stringify({ installed: true, enabled: true, running: true, definition: "fixture XML" })),
      );
    const m = new WindowsTaskServiceManager({ run });
    expect((await m.inspect()).running).toBe(true);
    expect(run.mock.calls[0]![0]).toBe("powershell.exe");
    expect(run.mock.calls[0]![1]).toContain("-EncodedCommand");
  });
  it("installs generated XML with current SID and argv-only schtasks", async () => {
    const run = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === "whoami.exe") return result('"fixture","S-1-5-21-1001"');
      if (command === "powershell.exe")
        return result(JSON.stringify({ installed: false, running: false, enabled: false }));
      const xmlPath = args[args.indexOf("/XML") + 1]!;
      expect(await readFile(xmlPath, "utf16le")).toContain("InteractiveToken");
      return result();
    });
    await new WindowsTaskServiceManager({ run, identifier: "Homebase Test fixture" }).install(definition());
    expect(run.mock.calls.at(-1)![1]).toContain("/Create");
  });
  it("native start uses exact task name argv", async () => {
    const run = vi.fn().mockResolvedValue(result());
    await new WindowsTaskServiceManager({ run, identifier: "Homebase Test fixture" }).start();
    expect(run.mock.calls[0]![1]).toEqual(["/Run", "/TN", "Homebase Test fixture"]);
  });
  it("manager errors are bounded/actionable without stderr credentials", async () => {
    const run = vi.fn().mockResolvedValue({ ...result("", 1), stderr: "provider-key-secret" });
    await expect(new WindowsTaskServiceManager({ run }).start()).rejects.toThrow("Task Scheduler");
  });
  it("unrelated task is not overwritten", async () => {
    const run = vi.fn(async (command: string) =>
      command === "whoami.exe"
        ? result("S-1-5-21-1001")
        : result(JSON.stringify({ installed: true, running: false, enabled: true, definition: "other task" })),
    );
    await expect(new WindowsTaskServiceManager({ run }).install(definition())).rejects.toThrow("not Homebase-owned");
    expect(run.mock.calls.some((call) => call[0] === "schtasks.exe")).toBe(false);
  });
  it("rejects hostile identifiers", () =>
    expect(() => new WindowsTaskServiceManager({ identifier: "Homebase; rm" })).toThrow());
});
describe("launchd manager", () => {
  it("writes a per-user agent and modern enable/bootstrap argv", async () => {
    const run = vi.fn(async (_command: string, args: readonly string[]) =>
      result("", args[0] === "print" && args[1]?.includes("com.homebase.host") ? 113 : 0),
    );
    const m = new LaunchdServiceManager({ run, home: dir, uid: 501 });
    await m.install(definition());
    await m.start();
    expect(await readFile(path.join(dir, "Library", "LaunchAgents", "com.homebase.host.plist"), "utf8")).toContain(
      "ProgramArguments",
    );
    expect(
      run.mock.calls.some(
        (call) =>
          JSON.stringify(call[1]) ===
          JSON.stringify([
            "bootstrap",
            "gui/501",
            path.join(dir, "Library", "LaunchAgents", "com.homebase.host.plist"),
          ]),
      ),
    ).toBe(true);
  });
  it("unavailable user session degrades without sudo", async () => {
    const run = vi.fn().mockResolvedValue(result("", 1));
    expect(await new LaunchdServiceManager({ run, home: dir, uid: 501 }).isAvailable()).toBe(false);
  });
});
describe("systemd user manager", () => {
  it("writes temp user unit, daemon-reloads and enables with --user", async () => {
    const run = vi
      .fn()
      .mockResolvedValue(result("LoadState=not-found\nActiveState=inactive\nUnitFileState=\nFragmentPath="));
    const m = new SystemdUserServiceManager({ run, home: dir });
    await m.install(definition());
    expect(await readFile(path.join(dir, ".config", "systemd", "user", "homebase.service"), "utf8")).toContain(
      "WantedBy=default.target",
    );
    expect(run.mock.calls.some((call) => JSON.stringify(call[1]) === JSON.stringify(["--user", "daemon-reload"]))).toBe(
      true,
    );
    expect(run.mock.calls.every((call) => call[1][0] === "--user")).toBe(true);
  });
  it("unavailable user bus degrades gracefully", async () => {
    const run = vi.fn().mockResolvedValue(result("", 1));
    expect(await new SystemdUserServiceManager({ run, home: dir }).isAvailable()).toBe(false);
  });
  it("restart is orchestrated above native manager", () =>
    expect("restart" in new SystemdUserServiceManager({ home: dir })).toBe(false));
});
describe("platform manager selection", () => {
  it.each(["win32", "darwin", "linux"] as const)("selects manager for %s", (platform) =>
    expect(createServiceManager(platform).kind).not.toBe("unsupported"),
  );
  it("unsupported platform provides honest manual fallback", async () => {
    const m = createServiceManager("freebsd");
    expect(await m.isAvailable()).toBe(false);
    await expect(m.install(definition())).rejects.toThrow("manually");
  });
});
