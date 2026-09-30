import { quoteWindowsArgument } from "@homebase/adapter-sdk";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ServiceDefinition } from "./types.js";

export function safeValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("Service values must not contain line breaks or NUL bytes.");
  return value;
}
export const xml = (value: string): string =>
  safeValue(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );
export function serviceArguments(d: ServiceDefinition): string[] {
  return [
    d.entryPath,
    "--config",
    d.configPath,
    "--service-runtime",
    "--state-dir",
    d.stateDir,
    "--service-path",
    d.path,
  ];
}
/** Task Scheduler's Hidden flag hides the task, not its console. A fixed
 * PowerShell/.NET launcher uses CreateNoWindow and waits for the exact Node
 * process. Paths are base64 data, never PowerShell expressions. Encoding also
 * prevents Task Scheduler expanding literal %VARIABLE% in user paths. */
export function windowsLauncherSource(d: ServiceDefinition): string {
  const data = (value: string) =>
    `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(safeValue(value), "utf8").toString("base64")}'))`;
  const args = serviceArguments(d)
    .map((arg) => quoteWindowsArgument(safeValue(arg)))
    .join(" ");
  return `$ErrorActionPreference='Stop'; $p=New-Object System.Diagnostics.Process; $p.StartInfo.FileName=${data(d.nodePath)}; $p.StartInfo.Arguments=${data(args)}; $p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true; try { [void]$p.Start(); $p.WaitForExit(); exit $p.ExitCode } finally { $p.Dispose() }`;
}
export function windowsLauncherHash(d: ServiceDefinition): string {
  return createHash("sha256").update(windowsLauncherSource(d)).digest("hex");
}
export function windowsTaskAction(d: ServiceDefinition): { command: string; arguments: string } {
  return {
    command: path.win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    arguments: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(windowsLauncherSource(d), "utf16le").toString("base64"),
    ]
      .map(quoteWindowsArgument)
      .join(" "),
  };
}
export function windowsTaskXml(d: ServiceDefinition, userId: string): string {
  const action = windowsTaskAction(d);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Homebase user Host ${windowsLauncherHash(d)}</Description></RegistrationInfo>
<Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger></Triggers>
<Principals><Principal id="Homebase"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings>
<Actions Context="Homebase"><Exec><Command>${xml(action.command)}</Command><Arguments>${xml(action.arguments)}</Arguments></Exec></Actions>
</Task>\n`;
}
export function launchdPlist(d: ServiceDefinition, identifier: string): string {
  const args = [d.nodePath, ...serviceArguments(d)].map((arg) => `<string>${xml(arg)}</string>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>HomebaseVersion</key><string>${xml(d.homebaseVersion)}</string>
<key>HomebaseOwnership</key><string>Homebase user Host</string>
<key>Label</key><string>${xml(identifier)}</string>
<key>ProgramArguments</key><array>${args}</array>
<key>EnvironmentVariables</key><dict><key>HOMEBASE_STATE_DIR</key><string>${xml(d.stateDir)}</string><key>PATH</key><string>${xml(d.path)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
}
/** systemd syntax: percent specifiers and dollar substitutions must stay literal. */
export function systemdQuote(value: string, command = false): string {
  return (
    '"' +
    safeValue(value)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/%/g, "%%")
      .replace(/\$/g, command ? "$$$$" : "$") +
    '"'
  );
}
export function systemdUnit(d: ServiceDefinition): string {
  return `# Homebase version ${safeValue(d.homebaseVersion)}
[Unit]
Description=Homebase user Host
After=network.target

[Service]
Type=simple
ExecStart=${[d.nodePath, ...serviceArguments(d)].map((arg) => systemdQuote(arg, true)).join(" ")}
Environment=${systemdQuote(`HOMEBASE_STATE_DIR=${d.stateDir}`)}
Environment=${systemdQuote(`PATH=${d.path}`)}
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
`;
}
