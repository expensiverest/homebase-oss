import { createServiceManager } from "../service/manager.js";
import { runDoctor, formatDoctor } from "../setup/diagnostics.js";
import { cliPaths } from "./context.js";
import type { CliArguments } from "./parse.js";
import type { CliIo } from "./io.js";
export async function runDoctorCommand(args: CliArguments, io: CliIo): Promise<number> {
  const report = await runDoctor({ ...cliPaths(args), manager: createServiceManager() });
  if (args.json) io.out(JSON.stringify(report, null, 2));
  else {
    io.out("Homebase doctor\n");
    const important = new Set([
      "runtime.cli",
      "config.valid",
      "projects.discovery",
      "service.installed",
      "service.running",
      "host.health",
      "pairing.devices",
      "tailscale.serve",
      "service.logs",
    ]);
    formatDoctor({
      ...report,
      checks: report.checks.filter(
        (check) => check.status !== "pass" || important.has(check.id) || check.id.startsWith("providers."),
      ),
    }).forEach((line) => io.out(line));
    io.out(
      `\n${report.checks.filter((check) => check.status === "pass").length} passed; ${report.checks.filter((check) => check.status === "warn").length} warnings; ${report.checks.filter((check) => check.status === "fail").length} failures.`,
    );
  }
  return report.ok ? 0 : 1;
}
