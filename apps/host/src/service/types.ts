import type { RunExecutable } from "@homebase/adapter-sdk";

export type ServiceKind = "windows-task" | "launchd" | "systemd-user" | "unsupported";
export interface ServiceDefinition {
  nodePath: string;
  entryPath: string;
  configPath: string;
  stateDir: string;
  /** Only absolute PATH directories, with no cwd/empty entries. */
  path: string;
  homebaseVersion: string;
}
export interface ServiceInspection {
  installed: boolean;
  enabled: boolean;
  running: boolean;
  /** A verified native job may be loaded even while stopped. */
  loaded?: boolean;
  /** Verified canonical on-disk definition, paired with native identity where loaded. */
  ownedDefinition?: ServiceDefinition;
  /** Native definition, retained locally for comparison, never printed. */
  definition?: string;
  warning?: string;
}
export interface ServiceManager {
  readonly kind: ServiceKind;
  readonly identifier: string;
  readonly logSource: string;
  isAvailable(): Promise<boolean>;
  inspect(): Promise<ServiceInspection>;
  install(definition: ServiceDefinition): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  uninstall(): Promise<void>;
  matches(inspection: ServiceInspection, definition: ServiceDefinition): boolean;
}
export interface ManagerOptions {
  run?: RunExecutable;
  home?: string;
  identifier?: string;
}
