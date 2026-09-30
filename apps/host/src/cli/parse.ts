import { parseArgs } from "node:util";

/** Global CLI arguments accepted before the optional command. */
export interface CliArguments {
  positionals: string[];
  config?: string;
  port?: string;
  bind?: string;
  url?: string;
  help: boolean;
  version: boolean;
  json?: boolean;
  noRestart?: boolean;
  purgeState?: boolean;
  serviceRuntime?: boolean;
  stateDir?: string;
  servicePath?: string;
}

/** Raised for malformed invocations; the dispatcher maps it to a usage error. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseCliArguments(argv: string[]): CliArguments {
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...argv],
        options: {
          config: { type: "string" },
          port: { type: "string" },
          bind: { type: "string" },
          url: { type: "string" },
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
          json: { type: "boolean" },
          "no-restart": { type: "boolean" },
          "purge-state": { type: "boolean" },
          "service-runtime": { type: "boolean" },
          "state-dir": { type: "string" },
          "service-path": { type: "string" },
        },
        allowPositionals: true,
      });
    } catch (error) {
      throw new CliUsageError(error instanceof Error ? error.message : String(error));
    }
  })();

  const { values, positionals } = parsed;
  return {
    positionals,
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(values.port !== undefined ? { port: values.port } : {}),
    ...(values.bind !== undefined ? { bind: values.bind } : {}),
    ...(values.url !== undefined ? { url: values.url } : {}),
    help: values.help === true,
    version: values.version === true,
    json: values.json === true,
    noRestart: values["no-restart"] === true,
    purgeState: values["purge-state"] === true,
    serviceRuntime: values["service-runtime"] === true,
    ...(values["state-dir"] !== undefined ? { stateDir: values["state-dir"] } : {}),
    ...(values["service-path"] !== undefined ? { servicePath: values["service-path"] } : {}),
  };
}
