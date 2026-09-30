import { runExecutable, type RunExecutable } from "@homebase/adapter-sdk";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { systemdUnit } from "./definitions.js";
import { writeServiceFile } from "./files.js";
import type { ManagerOptions, ServiceDefinition, ServiceInspection, ServiceManager } from "./types.js";

export class SystemdUserServiceManager implements ServiceManager {
  readonly kind = "systemd-user" as const;
  readonly identifier: string;
  readonly logSource: string;
  readonly #run: RunExecutable;
  readonly #file: string;
  constructor(options: ManagerOptions = {}) {
    this.identifier = options.identifier ?? "homebase.service";
    if (!/^[a-zA-Z0-9._-]+\.service$/.test(this.identifier)) throw new Error("Invalid Homebase unit name.");
    this.#run = options.run ?? runExecutable;
    this.#file = path.join(options.home ?? os.homedir(), ".config", "systemd", "user", this.identifier);
    this.logSource = `journalctl --user -u ${this.identifier}`;
  }
  async #command(args: string[]): Promise<void> {
    const result = await this.#run("systemctl", ["--user", ...args], { timeoutMs: 10000 });
    if (result.code !== 0)
      throw new Error(
        `systemd user service could not ${args[0]}. Run \`homebase doctor\`; no sudo or linger change is needed for user-session startup.`,
      );
  }
  async isAvailable(): Promise<boolean> {
    try {
      return (await this.#run("systemctl", ["--user", "show-environment"])).code === 0;
    } catch {
      return false;
    }
  }
  async inspect(): Promise<ServiceInspection> {
    const result = await this.#run("systemctl", [
      "--user",
      "show",
      this.identifier,
      "--property=LoadState,ActiveState,UnitFileState,FragmentPath",
    ]);
    if (result.code !== 0) throw new Error("systemd --user is unavailable. Homebase can run manually with `homebase`.");
    const properties = Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => line.split(/=(.*)/s).slice(0, 2)),
    );
    const installed = properties.LoadState !== "not-found" && !!properties.FragmentPath;
    const definition = installed ? await readFile(properties.FragmentPath!, "utf8").catch(() => "") : "";
    return {
      installed,
      enabled: properties.UnitFileState === "enabled",
      running: properties.ActiveState === "active",
      definition,
    };
  }
  async install(d: ServiceDefinition): Promise<void> {
    const state = await this.inspect();
    if (state.installed && !state.definition?.includes("Description=Homebase user Host"))
      throw new Error("An unrelated homebase.service was left unchanged.");
    await writeServiceFile(this.#file, systemdUnit(d));
    await this.#command(["daemon-reload"]);
    await this.#command(["enable", this.identifier]);
  }
  async start(): Promise<void> {
    await this.#command(["start", this.identifier]);
  }
  async stop(): Promise<void> {
    if ((await this.inspect()).running) await this.#command(["stop", this.identifier]);
  }
  async uninstall(): Promise<void> {
    const state = await this.inspect();
    if (!state.installed) return;
    if (!state.definition?.includes("Description=Homebase user Host"))
      throw new Error("Refusing to remove an unrelated user service.");
    await this.#command(["disable", "--now", this.identifier]);
    await rm(this.#file, { force: true });
    await this.#command(["daemon-reload"]);
  }
  matches(state: ServiceInspection, d: ServiceDefinition): boolean {
    return state.definition === systemdUnit(d);
  }
}
