import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RunExecutableResult } from "@homebase/adapter-sdk";
import { WindowsTaskServiceManager } from "../src/service/windows.js";
import { LaunchdServiceManager } from "../src/service/launchd.js";
import { SystemdUserServiceManager } from "../src/service/systemd.js";
import { createServiceManager } from "../src/service/manager.js";
import type { ServiceDefinition } from "../src/service/types.js";
import { windowsTaskXml, launchdPlist, systemdUnit, serviceArguments } from "../src/service/definitions.js";
import { ownedLaunchdDefinition, ownedSystemdDefinition } from "../src/service/ownership.js";
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
  function fixture(loaded = false, nativePath?: string, nativeArgs?: string[], nativeProgram?: string) {
    const file = path.join(dir, "Library", "LaunchAgents", "com.homebase.host.plist");
    const d = definition();
    const run = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === "print" && args[1]?.includes("com.homebase.host"))
        return loaded
          ? result(
              `path = ${nativePath ?? file}\nprogram = ${nativeProgram ?? d.nodePath}\nstate = running\narguments = {\n${(nativeArgs ?? [d.nodePath, ...serviceArguments(d)]).join("\n")}\n}`,
            )
          : result("", 113);
      return result();
    });
    return { file, d, run, manager: new LaunchdServiceManager({ run, home: dir, uid: 501 }) };
  }
  it.each(["install", "uninstall", "stop", "start"] as const)(
    "refuses %s of a loaded same-label job without our plist",
    async (action) => {
      const f = fixture(true);
      await expect(action === "install" ? f.manager.install(f.d) : f.manager[action]()).rejects.toThrow(
        "cannot verify",
      );
      expect(f.run.mock.calls.every((call) => ["print", "print-disabled"].includes(call[1][0]!))).toBe(true);
      await expect(readFile(f.file)).rejects.toThrow();
    },
  );
  it.each(["install", "uninstall"] as const)(
    "refuses %s of an unrelated plist, even with an ownership marker",
    async (action) => {
      const f = fixture();
      await mkdir(path.dirname(f.file), { recursive: true });
      const source = launchdPlist(f.d, "com.homebase.host").replace("<true/>", "<false/>");
      await writeFile(f.file, source);
      await expect(action === "install" ? f.manager.install(f.d) : f.manager.uninstall()).rejects.toThrow("No changes");
      expect(await readFile(f.file, "utf8")).toBe(source);
      expect(f.run.mock.calls.every((call) => ["print", "print-disabled"].includes(call[1][0]!))).toBe(true);
    },
  );
  it.each(["path", "arguments", "program"])(
    "refuses a loaded job whose native %s differs from our plist",
    async (field) => {
      const f = fixture(
        true,
        field === "path" ? "/other.plist" : undefined,
        field === "arguments" ? ["/other-program"] : undefined,
        field === "program" ? "/other-program" : undefined,
      );
      await mkdir(path.dirname(f.file), { recursive: true });
      await writeFile(f.file, launchdPlist(f.d, "com.homebase.host"));
      await expect(f.manager.install(f.d)).rejects.toThrow("cannot verify");
      expect(f.run.mock.calls.some((call) => call[1][0] === "bootout")).toBe(false);
    },
  );
  it("updates a verified plist/native pair normally", async () => {
    const f = fixture(true);
    await mkdir(path.dirname(f.file), { recursive: true });
    await writeFile(f.file, launchdPlist(f.d, "com.homebase.host"));
    expect((await f.manager.inspect()).running).toBe(true);
    await f.manager.install({ ...f.d, homebaseVersion: "0.0.2" });
    expect(f.run.mock.calls.some((call) => call[1][0] === "bootout")).toBe(true);
    expect(await readFile(f.file, "utf8")).toContain("0.0.2");
  });
  it("uninstalls a verified plist/native pair", async () => {
    const f = fixture(true);
    await mkdir(path.dirname(f.file), { recursive: true });
    await writeFile(f.file, launchdPlist(f.d, "com.homebase.host"));
    await f.manager.uninstall();
    expect(f.run.mock.calls.some((call) => call[1][0] === "bootout")).toBe(true);
    await expect(readFile(f.file)).rejects.toThrow();
  });
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
  function fixture(loaded = false, nativePath?: string) {
    const file = path.join(dir, ".config", "systemd", "user", "homebase.service");
    const run = vi.fn(async (_command: string, _args: readonly string[]) =>
      result(
        `LoadState=${loaded ? "loaded" : "not-found"}\nActiveState=${loaded ? "active" : "inactive"}\nUnitFileState=${loaded ? "enabled" : ""}\nFragmentPath=${loaded ? (nativePath ?? file) : ""}\nDropInPaths=\nNeedDaemonReload=no`,
      ),
    );
    return { file, run, manager: new SystemdUserServiceManager({ run, home: dir }) };
  }
  it.each(["install", "uninstall"] as const)(
    "refuses %s of an unrelated file even when native state says not-found",
    async (action) => {
      const f = fixture();
      await mkdir(path.dirname(f.file), { recursive: true });
      const source = systemdUnit(definition()).replace("Restart=on-failure", "Restart=always");
      await writeFile(f.file, source);
      await expect(action === "install" ? f.manager.install(definition()) : f.manager.uninstall()).rejects.toThrow(
        "No changes",
      );
      expect(await readFile(f.file, "utf8")).toBe(source);
      expect(f.run.mock.calls.every((call) => call[1]?.[1] === "show")).toBe(true);
    },
  );
  it.each(["install", "uninstall", "stop", "start"] as const)(
    "refuses %s when a loaded unit has an unexpected FragmentPath",
    async (action) => {
      const f = fixture(true, "/other/homebase.service");
      await mkdir(path.dirname(f.file), { recursive: true });
      const source = systemdUnit(definition());
      await writeFile(f.file, source);
      await expect(action === "install" ? f.manager.install(definition()) : f.manager[action]()).rejects.toThrow(
        "cannot verify",
      );
      expect(await readFile(f.file, "utf8")).toBe(source);
      expect(f.run.mock.calls.every((call) => call[1]?.[1] === "show")).toBe(true);
    },
  );
  it.each([false, true])("updates a verified %s-loaded unit safely", async (loaded) => {
    const f = fixture(loaded);
    await mkdir(path.dirname(f.file), { recursive: true });
    await writeFile(f.file, systemdUnit(definition()));
    expect((await f.manager.inspect()).installed).toBe(true);
    await f.manager.install({ ...definition(), homebaseVersion: "0.0.2" });
    expect(await readFile(f.file, "utf8")).toContain("0.0.2");
    expect(f.run.mock.calls.some((call) => call[1]?.[1] === "enable")).toBe(true);
  });
  it("starts, stops and uninstalls a verified loaded unit", async () => {
    const f = fixture(true);
    await mkdir(path.dirname(f.file), { recursive: true });
    await writeFile(f.file, systemdUnit(definition()));
    await f.manager.start();
    await f.manager.stop();
    await f.manager.uninstall();
    for (const action of ["start", "stop", "disable", "daemon-reload"])
      expect(f.run.mock.calls.some((call) => call[1]?.[1] === action)).toBe(true);
    await expect(readFile(f.file)).rejects.toThrow();
  });
  it.each(["DropInPaths=/other/override.conf", "NeedDaemonReload=yes"])(
    "refuses a loaded unit with unverified overrides or pending reload: %s",
    async (property) => {
      const f = fixture(true);
      await mkdir(path.dirname(f.file), { recursive: true });
      await writeFile(f.file, systemdUnit(definition()));
      f.run.mockResolvedValue(
        result(
          `LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nFragmentPath=${f.file}\nDropInPaths=\nNeedDaemonReload=no\n${property}`,
        ),
      );
      await expect(f.manager.uninstall()).rejects.toThrow("No changes");
      expect(f.run.mock.calls.every((call) => call[1]?.[1] === "show")).toBe(true);
      expect(await readFile(f.file, "utf8")).toBe(systemdUnit(definition()));
    },
  );
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
describe("canonical ownership proof", () => {
  it("round-trips escaped paths and rejects extra executable or policy fields", () => {
    const d = { ...definition(), entryPath: '/space & < > " \\ %n $HOME/entry.js', path: '/tools:$tools:%x:"quoted"' };
    const plist = launchdPlist(d, "com.homebase.host");
    const unit = systemdUnit(d);
    expect(ownedLaunchdDefinition(plist, "com.homebase.host")).toEqual(d);
    expect(ownedSystemdDefinition(unit)).toEqual(d);
    expect(
      ownedLaunchdDefinition(
        plist.replace("</dict></plist>", "<key>Program</key><string>/other</string></dict></plist>"),
        "com.homebase.host",
      ),
    ).toBeNull();
    expect(ownedSystemdDefinition(unit + "ExecStartPost=/other\n")).toBeNull();
  });
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
