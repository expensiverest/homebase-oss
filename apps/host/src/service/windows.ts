import { runExecutable, type RunExecutable } from "@homebase/adapter-sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { windowsTaskXml, xml, windowsTaskAction, windowsLauncherHash, safeValue } from "./definitions.js";
import { writeServiceFile } from "./files.js";
import type { ManagerOptions, ServiceDefinition, ServiceInspection, ServiceManager } from "./types.js";

// COM returns numeric task states, independent of Windows display language.
const QUERY_SCRIPT = `$ErrorActionPreference='Stop'; $s=New-Object -ComObject Schedule.Service; $s.Connect();
try { $t=$s.GetFolder('\\').GetTask($env:HOMEBASE_TASK_QUERY); @{installed=$true; enabled=$t.Enabled; running=($t.State -eq 4); warning=('Last task result: '+$t.LastTaskResult); definition=$t.Xml} | ConvertTo-Json -Compress }
catch { if ($_.Exception.HResult -eq -2147024894) { @{installed=$false; enabled=$false; running=$false} | ConvertTo-Json -Compress } else { exit 2 } }`;
// Task Scheduler terminates the action, not its .NET child. Capture only children
// of the exact Homebase action; after Stop, re-check identity before tree cleanup.
// No PID from a provider, marker file, or caller is accepted.
const STOP_SCRIPT = `$ErrorActionPreference='Stop'; $s=New-Object -ComObject Schedule.Service; $s.Connect(); $t=$s.GetFolder('\\').GetTask($env:HOMEBASE_TASK_QUERY);
if (-not $t.Definition.RegistrationInfo.Description.StartsWith('Homebase user Host ')) { exit 3 }
$a=$t.Definition.Actions.Item(1); $all=@(Get-CimInstance Win32_Process); $children=@();
foreach ($p in $all) { if ($p.ExecutablePath -eq $a.Path -and $p.CommandLine -and $p.CommandLine.EndsWith($a.Arguments,[StringComparison]::Ordinal)) { $children += @($all | Where-Object { $_.ParentProcessId -eq $p.ProcessId }) } }
$t.Stop(0);
foreach ($c in $children) { $now=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c.ProcessId); if ($now -and $now.CreationDate -eq $c.CreationDate -and $now.ExecutablePath -eq $c.ExecutablePath) { & "$env:SystemRoot\\System32\\taskkill.exe" /PID $c.ProcessId /T /F | Out-Null } }`;
export class WindowsTaskServiceManager implements ServiceManager {
  readonly kind = "windows-task" as const;
  readonly identifier: string;
  readonly logSource = "<state-dir>/logs/host.log; Task Scheduler operational log";
  readonly #run: RunExecutable;
  constructor(options: ManagerOptions = {}) {
    this.#run = options.run ?? runExecutable;
    this.identifier = options.identifier ?? "Homebase Host";
    if (!/^[A-Za-z0-9 ._-]{1,180}$/.test(this.identifier)) throw new Error("Invalid Homebase task identifier.");
  }
  async isAvailable(): Promise<boolean> {
    try {
      await this.inspect();
      return true;
    } catch {
      return false;
    }
  }
  async inspect(): Promise<ServiceInspection> {
    const result = await this.#run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(QUERY_SCRIPT, "utf16le").toString("base64")],
      {
        env: { ...process.env, HOMEBASE_TASK_QUERY: this.identifier },
        timeoutMs: 8000,
        maxOutputBytes: 256 * 1024,
      },
    );
    if (result.code !== 0 || result.truncated)
      throw new Error(
        "Windows Task Scheduler could not be reached. Run `homebase doctor`; you can still run `homebase` manually.",
      );
    const value = JSON.parse(result.stdout) as ServiceInspection;
    if (
      typeof value.installed !== "boolean" ||
      typeof value.running !== "boolean" ||
      typeof value.enabled !== "boolean"
    )
      throw new Error("Task Scheduler returned an unknown state.");
    return value;
  }
  async install(d: ServiceDefinition): Promise<void> {
    const identity = await this.#run("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
    const sid = /S-1-\d+(?:-\d+)+/.exec(identity.stdout)?.[0];
    if (identity.code !== 0 || !sid) throw new Error("Could not determine the current Windows user for Homebase.");
    const existing = await this.inspect();
    if (existing.installed && !existing.definition?.includes("Homebase user Host"))
      throw new Error("A task named Homebase Host already exists and is not Homebase-owned. It was left unchanged.");
    const dir = await mkdtemp(path.join(os.tmpdir(), "homebase-task-"));
    try {
      const file = path.join(dir, "task.xml");
      await writeServiceFile(file, "\uFEFF" + windowsTaskXml(d, sid), "utf16le");
      await this.#command(["/Create", "/TN", this.identifier, "/XML", file, "/F"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  async #command(args: string[]): Promise<void> {
    const result = await this.#run("schtasks.exe", args, { timeoutMs: 10000 });
    if (result.code !== 0)
      throw new Error(
        `Windows Task Scheduler could not ${args[0]!.slice(1).toLowerCase()} Homebase (code ${result.code}). Run \`homebase doctor\`.`,
      );
  }
  async start(): Promise<void> {
    await this.#command(["/Run", "/TN", this.identifier]);
  }
  async stop(): Promise<void> {
    if (!(await this.inspect()).running) return;
    const result = await this.#run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(STOP_SCRIPT, "utf16le").toString("base64")],
      {
        env: { ...process.env, HOMEBASE_TASK_QUERY: this.identifier },
        timeoutMs: 10000,
      },
    );
    if (result.code !== 0)
      throw new Error("Task Scheduler could not stop Homebase and its owned process tree. Run `homebase doctor`.");
  }
  async uninstall(): Promise<void> {
    const state = await this.inspect();
    if (!state.installed) return;
    if (!state.definition?.includes("Homebase user Host"))
      throw new Error("Refusing to remove a task not owned by Homebase.");
    await this.#command(["/Delete", "/TN", this.identifier, "/F"]);
  }
  matches(state: ServiceInspection, d: ServiceDefinition): boolean {
    const source = state.definition ?? "";
    const action = windowsTaskAction(d);
    return (
      source.includes(`Homebase user Host ${windowsLauncherHash(d)}`) &&
      source.includes(`<Command>${xml(action.command)}</Command>`) &&
      source.includes(`<Arguments>${xml(action.arguments)}</Arguments>`) &&
      source.includes("<LogonType>InteractiveToken</LogonType>") &&
      !/<RunLevel>(?!LeastPrivilege<)/.test(source)
    );
  }
}
// Exported for hostile-path tests; all action arguments use the shared Windows quoting helper.
export const validateWindowsServiceValue = safeValue;
