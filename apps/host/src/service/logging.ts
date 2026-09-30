import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { redactSecrets, createConsoleLogger } from "@homebase/adapter-sdk";
import type { CliIo } from "../cli/io.js";
/** Two files, each bounded to 1 MiB. Operational messages only; no stream/transcript capture. */
export function serviceLogging(stateDir: string) {
  const dir = path.join(stateDir, "logs");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, "host.log");
  const write = (...parts: unknown[]) => {
    const text = `${new Date().toISOString()} ${redactSecrets(parts.map(String).join(" ")).slice(0, 8192)}\n`;
    try {
      if (statSync(target).size + Buffer.byteLength(text) > 1024 * 1024) {
        rmSync(`${target}.1`, { force: true });
        renameSync(target, `${target}.1`);
      }
    } catch {
      /* first write */
    }
    appendFileSync(target, text, { mode: 0o600 });
  };
  const sink = { debug: write, info: write, warn: write, error: write };
  return { io: { out: write, error: write } satisfies CliIo, logger: createConsoleLogger("host", { sink }) };
}
