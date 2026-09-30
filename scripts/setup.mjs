import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run setup through npm: npm run setup");
for (const args of [
  ["run", "build"],
  ["link", "-w", "@homebase/host"],
]) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: root, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("../apps/host/dist/index.js", import.meta.url)), "setup", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit", shell: false },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
