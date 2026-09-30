import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { atomicWriteJson, isMissingFileError, readJsonObjectFile } from "../config/index.js";
import { HOST_VERSION } from "../version.js";
import type { ServiceDefinition, ServiceManager } from "./types.js";

const absolute = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value) && !/[\r\n\0]/.test(value));
export const serviceMetadataSchema = z
  .object({
    version: z.literal(1),
    manager: z.enum(["windows-task", "launchd", "systemd-user", "unsupported"]),
    installedAt: z.string().datetime(),
    homebaseVersion: z.string().min(1),
    nodePath: absolute,
    entryPath: absolute,
    configPath: absolute,
    stateDir: absolute,
    serviceIdentifier: z.string().min(1),
    path: z.string().refine((value) => !/[\r\n\0]/.test(value)),
  })
  .strict();
export type ServiceMetadata = z.infer<typeof serviceMetadataSchema>;
export const metadataPath = (stateDir: string): string => path.join(stateDir, "service.json");
export function definitionsEqual(a: ServiceDefinition, b: ServiceDefinition): boolean {
  return ["nodePath", "entryPath", "configPath", "stateDir", "path", "homebaseVersion"].every(
    (key) => a[key as keyof ServiceDefinition] === b[key as keyof ServiceDefinition],
  );
}
export async function readServiceMetadata(stateDir: string): Promise<ServiceMetadata | null> {
  try {
    return serviceMetadataSchema.parse(await readJsonObjectFile(metadataPath(stateDir)));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw new Error(
      "Homebase service metadata is corrupt. Inspect the OS service with `homebase service status` before repair.",
    );
  }
}
export async function writeServiceMetadata(manager: ServiceManager, definition: ServiceDefinition): Promise<void> {
  await atomicWriteJson(
    metadataPath(definition.stateDir),
    serviceMetadataSchema.parse({
      ...definition,
      version: 1,
      manager: manager.kind,
      serviceIdentifier: manager.identifier,
      installedAt: new Date().toISOString(),
    }),
  );
}
export function sanitizePath(value: string, platform: NodeJS.Platform = process.platform): string {
  const impl = platform === "win32" ? path.win32 : path.posix;
  const delimiter = platform === "win32" ? ";" : ":";
  return [
    ...new Set(
      value
        .split(delimiter)
        .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
        .filter((entry) => impl.isAbsolute(entry) && !/[\r\n\0]/.test(entry))
        .map((entry) => impl.normalize(entry)),
    ),
  ].join(delimiter);
}
export async function currentDefinition(
  configPath: string,
  stateDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServiceDefinition> {
  return {
    nodePath: await realpath(process.execPath),
    entryPath: await realpath(fileURLToPath(new URL("../index.js", import.meta.url))),
    configPath: await realpath(configPath),
    stateDir: await realpath(stateDir),
    path: sanitizePath(env.PATH ?? env.Path ?? ""),
    homebaseVersion: HOST_VERSION,
  };
}
