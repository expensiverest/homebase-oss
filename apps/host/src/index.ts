#!/usr/bin/env node
import { runCli } from "./cli/index.js";

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Homebase failed: ${message}`);
    process.exitCode = 1;
  },
);
