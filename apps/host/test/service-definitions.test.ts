import { describe, expect, it } from "vitest";
import { quoteWindowsArgument } from "@homebase/adapter-sdk";
import {
  launchdPlist,
  systemdUnit,
  systemdQuote,
  windowsTaskXml,
  windowsLauncherSource,
  serviceArguments,
} from "../src/service/definitions.js";
import { sanitizePath, serviceMetadataSchema } from "../src/service/metadata.js";
import type { ServiceDefinition } from "../src/service/types.js";

const d: ServiceDefinition = {
  nodePath: "C:\\Program Files\\Node\\node.exe",
  entryPath: "C:\\Code & Tools\\host\\index.js",
  configPath: "C:\\Users\\fixture\\Homebase settings\\config.json",
  stateDir: "C:\\Users\\fixture\\Homebase state",
  path: "C:\\Program Files\\Node;C:\\Tools",
  homebaseVersion: "0.0.1",
};
describe("Windows task definition", () => {
  it("uses current-user logon and least privilege without a shell", () => {
    const task = windowsTaskXml(d, "S-1-5-21-1001");
    expect(task).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(task).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(task).toContain("<LogonTrigger>");
    expect(task).toContain("<Hidden>true</Hidden>");
    expect(task).not.toMatch(/cmd\.exe|LocalSystem|HighestAvailable|<WorkingDirectory>/);
  });
  it("quotes all space-containing paths and XML-escapes metacharacters", () => {
    const task = windowsTaskXml(d, "S-1-5-21-1001");
    expect(task).toContain("powershell.exe</Command>");
    const launcher = windowsLauncherSource(d);
    expect(launcher).toContain(Buffer.from(d.nodePath).toString("base64"));
    expect(launcher).toContain("CreateNoWindow=$true");
    expect(launcher).toContain("UseShellExecute=$false");
    expect(launcher).toContain("$p.WaitForExit()");
    expect(task).toContain("-WindowStyle Hidden -EncodedCommand");
  });
  it("sets a bounded restart policy, ignores duplicate starts, and has no execution limit", () => {
    expect(windowsTaskXml(d, "sid")).toContain("<Count>3</Count>");
    expect(windowsTaskXml(d, "sid")).toContain("IgnoreNew");
    expect(windowsTaskXml(d, "sid")).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });
  it.each(["path\nnext", "path\rnext", "path\0next"])("rejects control characters: %j", (value) =>
    expect(() => windowsTaskXml({ ...d, configPath: value }, "sid")).toThrow(),
  );
  it.each(["C:\\space folder\\", 'C:\\has "quotes"\\entry.js', "C:\\&()!%\\entry.js", ""])(
    "uses shared Windows quoting for %j",
    (value) => expect(serviceArguments({ ...d, entryPath: value })[0]).toBe(value),
  );
  it("doubles trailing slash before closing a Windows argument", () =>
    expect(quoteWindowsArgument("C:\\space folder\\")).toBe('"C:\\space folder\\\\"'));
});
describe("launchd definition", () => {
  const posix = {
    ...d,
    nodePath: "/opt/Node tools/node",
    entryPath: "/Users/fixture/a&b/<host>/index.js",
    configPath: "/Users/fixture/homebase/config.json",
    stateDir: "/Users/fixture/homebase",
    path: "/usr/bin:/opt/tools",
  };
  it("uses exact ProgramArguments and XML escaping", () => {
    const plist = launchdPlist(posix, "com.homebase.host");
    expect(plist).toContain("<key>ProgramArguments</key><array><string>/opt/Node tools/node</string>");
    expect(plist).toContain("a&amp;b/&lt;host&gt;");
    expect(plist).not.toContain("/bin/sh");
  });
  it("sets user context, autostart, failure-only KeepAlive, and log paths", () => {
    const plist = launchdPlist(posix, "com.homebase.host");
    for (const key of [
      "HOMEBASE_STATE_DIR",
      "PATH",
      "RunAtLoad",
      "SuccessfulExit",
      "StandardOutPath",
      "StandardErrorPath",
    ])
      expect(plist).toContain(key);
    expect(plist).toContain("<key>SuccessfulExit</key><false/>");
  });
});
describe("systemd definition", () => {
  it("escapes specifiers, dollar expansion, quotes, and backslashes", () => {
    expect(systemdQuote('a%u $HOME "b" \\c', true)).toBe('"a%%u $$HOME \\"b\\" \\\\c"');
  });
  it("sets user session restart/environment and no shell", () => {
    const unit = systemdUnit({ ...d, nodePath: "/opt/Node tools/node", entryPath: "/opt/%u/$USER/index.js" });
    expect(unit).toContain('ExecStart="/opt/Node tools/node" "/opt/%%u/$$USER/index.js"');
    for (const field of [
      "HOMEBASE_STATE_DIR=",
      "PATH=",
      "Restart=on-failure",
      "WantedBy=default.target",
      "KillMode=control-group",
    ])
      expect(unit).toContain(field);
    expect(unit).not.toMatch(/sudo|enable-linger|\/bin\/sh/);
  });
  it.each(["\n", "\r", "\0"])("rejects newline/NUL in environment %j", (value) =>
    expect(() => systemdUnit({ ...d, path: value })).toThrow(),
  );
});
describe("service runtime context", () => {
  it("sanitizes Windows PATH and removes relative/cwd/empty/duplicate entries", () =>
    expect(sanitizePath(';C:\\Tools;.;relative;C:\\Tools;"C:\\Program Files\\Node";bad\npath', "win32")).toBe(
      "C:\\Tools;C:\\Program Files\\Node",
    ));
  it("sanitizes POSIX PATH", () =>
    expect(sanitizePath(":/usr/bin:.:tools:/usr/bin:/opt/tools", "linux")).toBe("/usr/bin:/opt/tools"));
  it("rejects arbitrary credential/environment fields in metadata", () => {
    expect(
      serviceMetadataSchema.safeParse({
        ...d,
        version: 1,
        manager: "windows-task",
        installedAt: new Date().toISOString(),
        serviceIdentifier: "Homebase Host",
        XAI_API_KEY: "must-not-save",
      }).success,
    ).toBe(false);
  });
});
