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
  };
}
