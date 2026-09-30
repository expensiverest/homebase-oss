import { launchdPlist, systemdUnit } from "./definitions.js";
import type { ServiceDefinition } from "./types.js";

const unxml = (value: string) =>
  value.replace(
    /&(amp|lt|gt|quot|apos);/g,
    (_, key: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[key]!,
  );
function fromArguments(args: string[], homebaseVersion: string): ServiceDefinition | null {
  if (
    args.length !== 9 ||
    args[2] !== "--config" ||
    args[4] !== "--service-runtime" ||
    args[5] !== "--state-dir" ||
    args[7] !== "--service-path"
  )
    return null;
  return {
    nodePath: args[0]!,
    entryPath: args[1]!,
    configPath: args[3]!,
    stateDir: args[6]!,
    path: args[8]!,
    homebaseVersion,
  };
}
/** Only our complete canonical format is accepted, including all command and policy fields.
 * A product name/comment alone is never evidence of ownership. No general XML/unit parser needed. */
export function ownedLaunchdDefinition(source: string, identifier: string): ServiceDefinition | null {
  const version = source.match(/<key>HomebaseVersion<\/key><string>(.*?)<\/string>/)?.[1];
  const block = source.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/)?.[1];
  if (version === undefined || block === undefined) return null;
  const args = [...block.matchAll(/<string>(.*?)<\/string>/g)].map((match) => unxml(match[1]!));
  const definition = fromArguments(args, unxml(version));
  return definition && launchdPlist(definition, identifier) === source ? definition : null;
}
export function ownedSystemdDefinition(source: string): ServiceDefinition | null {
  const version = source.match(/^# Homebase version (.+)\n/)?.[1];
  const command = source.match(/^ExecStart=(.+)$/m)?.[1];
  if (!version || !command) return null;
  const args = [...command.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) =>
    match[1]!
      .replace(/\\([\\"])/g, "$1")
      .replace(/%%/g, "%")
      .replace(/\$\$/g, "$"),
  );
  const definition = fromArguments(args, version);
  return definition && systemdUnit(definition) === source ? definition : null;
}
export function ownershipCollision(kind: string, identifier: string): Error {
  return new Error(
    `A ${kind} service named ${identifier} already exists, but Homebase cannot verify that it owns it. No changes were made. Inspect the existing service before retrying setup.`,
  );
}
