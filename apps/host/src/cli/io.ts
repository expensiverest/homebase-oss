import { ConfigError } from "../config/index.js";

/** Injectable output surface so CLI behavior is testable without a TTY. */
export interface CliIo {
  out(line: string): void;
  error(line: string): void;
}

export const consoleIo: CliIo = {
  out: (line) => console.log(line),
  error: (line) => console.error(line),
};

/** Prints a human-readable failure; validation issues are listed individually. */
export function printFailure(io: CliIo, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  io.error(`Homebase: ${message}`);
  if (error instanceof ConfigError) {
    for (const issue of error.issues) io.error(`  - ${issue}`);
  }
}
