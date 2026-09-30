import { rm } from "node:fs/promises";
import { AdminClient } from "../cli/admin.js";
import { readHealth, portAvailable, waitUntil, type HostHealth } from "./health.js";
import { metadataPath, readServiceMetadata, writeServiceMetadata } from "./metadata.js";
import type { ServiceDefinition, ServiceInspection, ServiceManager } from "./types.js";
import { definitionsEqual } from "./metadata.js";

export interface ServiceControllerOptions {
  manager: ServiceManager;
  definition: ServiceDefinition;
  port: number;
  health?: (port: number) => Promise<HostHealth | null>;
  availablePort?: (port: number) => Promise<boolean>;
  shutdown?: () => Promise<boolean>;
  timeoutMs?: number;
  stopTimeoutMs?: number;
}
export class ServiceController {
  readonly manager: ServiceManager;
  readonly definition: ServiceDefinition;
  readonly #options: ServiceControllerOptions;
  readonly #health: (port: number) => Promise<HostHealth | null>;
  constructor(options: ServiceControllerOptions) {
    this.#options = options;
    this.manager = options.manager;
    this.definition = options.definition;
    this.#health = options.health ?? readHealth;
  }
  async #assertOwned(state: ServiceInspection): Promise<void> {
    if (!state.installed) return;
    const previous = await readServiceMetadata(this.definition.stateDir);
    const owned = state.ownedDefinition;
    if (
      !this.manager.matches(state, this.definition) &&
      !this.manager.matches(state, previous ?? this.definition) &&
      !(owned && owned.configPath === this.definition.configPath && owned.stateDir === this.definition.stateDir)
    ) {
      throw new Error(
        "The installed service does not match this Homebase installation. It was left unchanged. Run `homebase doctor` with the service's config/state directory.",
      );
    }
  }
  async install(): Promise<void> {
    if (!(await this.manager.isAvailable()))
      throw new Error("Homebase's user service manager is unavailable. You can still run `homebase` manually.");
    if (!Number.isInteger(this.#options.port) || this.#options.port < 1)
      throw new Error("Background services require a fixed port. Run `homebase setup` to choose one.");
    const state = await this.manager.inspect();
    await this.#assertOwned(state);
    const previous = await readServiceMetadata(this.definition.stateDir);
    const nativeCurrent = state.installed && this.manager.matches(state, this.definition);
    if (
      state.installed &&
      !nativeCurrent &&
      previous &&
      (previous.configPath !== this.definition.configPath || previous.stateDir !== this.definition.stateDir)
    ) {
      throw new Error(
        "The installed service uses another config/state directory. Use its config for service commands or uninstall it explicitly first.",
      );
    }
    if (nativeCurrent && state.enabled) {
      if (
        !previous ||
        !definitionsEqual(previous, this.definition) ||
        previous.manager !== this.manager.kind ||
        previous.serviceIdentifier !== this.manager.identifier
      )
        await writeServiceMetadata(this.manager, this.definition);
      return;
    }
    const wasRunning = state.running;
    if (wasRunning) await this.stop();
    const healthy = await this.#health(this.#options.port);
    if (!healthy && !(await (this.#options.availablePort ?? portAvailable)(this.#options.port)))
      throw new Error(
        `Port ${this.#options.port} is occupied by another process. Choose another port with \`homebase setup\`.`,
      );
    await this.manager.install(this.definition);
    await writeServiceMetadata(this.manager, this.definition);
    if (wasRunning) await this.start();
  }
  async start(): Promise<void> {
    const state = await this.manager.inspect();
    await this.#assertOwned(state);
    if (!state.installed)
      throw new Error("Homebase service is not installed. Run `homebase setup` or `homebase service install`.");
    if (await this.#health(this.#options.port)) {
      if (!state.running)
        throw new Error("A foreground Homebase Host already uses this port. Stop it before starting the service.");
    } else if (!(await (this.#options.availablePort ?? portAvailable)(this.#options.port))) {
      throw new Error(`Port ${this.#options.port} is occupied. Homebase will not stop the other application.`);
    }
    if (!state.running) await this.manager.start();
    const ready = await waitUntil(
      async () => (await this.#health(this.#options.port))?.version === this.definition.homebaseVersion,
      this.#options.timeoutMs ?? 45000,
    );
    if (!ready)
      throw new Error(
        `Homebase service started, but the Host did not become healthy with version ${this.definition.homebaseVersion} on 127.0.0.1:${this.#options.port} within ${Math.round((this.#options.timeoutMs ?? 45000) / 1000)} seconds. Run \`homebase doctor\`.`,
      );
  }
  async stop(): Promise<void> {
    const state = await this.manager.inspect();
    await this.#assertOwned(state);
    if (!state.installed || !state.running) return;
    let accepted = false;
    try {
      if (this.#options.shutdown) accepted = await this.#options.shutdown();
      else {
        const response = await new AdminClient({ port: this.#options.port, stateDir: this.definition.stateDir }).call(
          "/api/v1/admin/shutdown",
          "POST",
        );
        accepted = response.status === 202 && ((await response.json()) as { accepted?: boolean }).accepted === true;
      }
    } catch {
      /* Bounded native fallback below. */
    }
    if (accepted)
      await waitUntil(
        async () => !(await this.#health(this.#options.port)) && !(await this.manager.inspect()).running,
        this.#options.stopTimeoutMs ?? 20000,
      );
    await this.manager.stop();
    if (
      !(await waitUntil(
        async () => !(await this.manager.inspect()).running && !(await this.#health(this.#options.port)),
        this.#options.stopTimeoutMs ?? 5000,
      ))
    ) {
      throw new Error(
        "The Homebase Host is still reachable after stopping the service. Run `homebase doctor`; state was preserved.",
      );
    }
  }
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }
  async uninstall(): Promise<void> {
    await this.#assertOwned(await this.manager.inspect());
    await this.stop();
    await this.manager.uninstall();
    await rm(metadataPath(this.definition.stateDir), { force: true });
  }
}
