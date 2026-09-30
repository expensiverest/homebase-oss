import { runExecutable, type RunExecutable } from "@homebase/adapter-sdk";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileExists } from "../config/index.js";
import { launchdPlist, serviceArguments } from "./definitions.js";
import { ownedLaunchdDefinition, ownershipCollision } from "./ownership.js";
import { writeServiceFile } from "./files.js";
import type { ManagerOptions, ServiceDefinition, ServiceInspection, ServiceManager } from "./types.js";

export class LaunchdServiceManager implements ServiceManager {
  readonly kind = "launchd" as const;
  readonly identifier: string;
  readonly logSource = "<state-dir>/logs/host.log; launchctl print gui/<uid>/com.homebase.host";
  readonly #file: string;
  readonly #domain: string;
  readonly #run: RunExecutable;
  constructor(options: ManagerOptions & { uid?: number } = {}) {
    this.identifier = options.identifier ?? "com.homebase.host";
    if (!/^[a-zA-Z0-9._-]+$/.test(this.identifier)) throw new Error("Invalid Homebase LaunchAgent identifier.");
    this.#file = path.join(options.home ?? os.homedir(), "Library", "LaunchAgents", `${this.identifier}.plist`);
    this.#domain = `gui/${options.uid ?? process.getuid?.() ?? 0}`;
    this.#run = options.run ?? runExecutable;
  }
  get #target(): string {
    return `${this.#domain}/${this.identifier}`;
  }
  async isAvailable(): Promise<boolean> {
    try {
      return (await this.#run("launchctl", ["print", this.#domain])).code === 0;
    } catch {
      return false;
    }
  }
  async inspect(): Promise<ServiceInspection> {
    const installed = await fileExists(this.#file);
    const [result, disabled] = await Promise.all([
      this.#run("launchctl", ["print", this.#target]),
      this.#run("launchctl", ["print-disabled", this.#domain]),
    ]);
    if (disabled.code !== 0 || disabled.truncated || result.truncated || (result.code !== 0 && result.code !== 113))
      throw new Error("The user launchd session is unavailable. Run Homebase manually with `homebase`.");
    const definition = installed ? await readFile(this.#file, "utf8") : "";
    const owned = installed ? ownedLaunchdDefinition(definition, this.identifier) : null;
    const loaded = result.code === 0;
    if ((installed && !owned) || (loaded && !owned)) throw ownershipCollision("launchd", this.identifier);
    if (loaded && owned) {
      const nativePath = result.stdout.match(/^\s*path = (.+)$/m)?.[1];
      const nativeProgram = result.stdout.match(/^\s*program = (.+)$/m)?.[1];
      const nativeArgs = result.stdout
        .match(/^[ \t]*arguments = \{\n([\s\S]*?)^[ \t]*\}/m)?.[1]
        ?.replace(/\n$/, "")
        .split("\n")
        .map((arg) => arg.trim());
      if (
        nativePath !== this.#file ||
        nativeProgram !== owned.nodePath ||
        JSON.stringify(nativeArgs) !== JSON.stringify([owned.nodePath, ...serviceArguments(owned)])
      )
        throw ownershipCollision("launchd", this.identifier);
    }
    return {
      installed,
      loaded,
      ...(owned ? { ownedDefinition: owned } : {}),
      enabled: installed && !disabled.stdout.includes(`"${this.identifier}" => true`),
      running: result.code === 0 && /state = running/.test(result.stdout),
      definition,
    };
  }
  async #command(args: string[]): Promise<void> {
    const result = await this.#run("launchctl", args, { timeoutMs: 10000 });
    if (result.code !== 0) throw new Error(`launchd could not ${args[0]} Homebase. Run \`homebase doctor\`.`);
  }
  async install(d: ServiceDefinition): Promise<void> {
    const state = await this.inspect();
    if (state.loaded) await this.#command(["bootout", this.#target]);
    await mkdir(path.join(d.stateDir, "logs"), { recursive: true, mode: 0o700 });
    await writeServiceFile(this.#file, launchdPlist(d, this.identifier));
    await this.#command(["enable", this.#target]);
  }
  async start(): Promise<void> {
    const state = await this.inspect();
    if (!state.installed) throw new Error("Homebase LaunchAgent is not installed. Run `homebase setup`.");
    if (!state.loaded) await this.#command(["bootstrap", this.#domain, this.#file]);
    else await this.#command(["kickstart", this.#target]);
  }
  async stop(): Promise<void> {
    if ((await this.inspect()).loaded) await this.#command(["bootout", this.#target]);
  }
  async uninstall(): Promise<void> {
    if (!(await this.inspect()).installed) return;
    await this.stop();
    await rm(this.#file, { force: true });
  }
  matches(state: ServiceInspection, d: ServiceDefinition): boolean {
    return state.definition === launchdPlist(d, this.identifier);
  }
}
