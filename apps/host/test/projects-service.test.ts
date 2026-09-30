import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProjectsCommand } from "../src/cli/projects.js";
import { parseCliArguments } from "../src/cli/parse.js";
import { captureIo } from "./helpers/service-fixture.js";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hb-project-service-"));
  await mkdir(path.join(dir, "project"));
  vi.stubEnv("HOMEBASE_STATE_DIR", path.join(dir, "state"));
  vi.stubEnv("HOMEBASE_CONFIG", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
describe("service-aware project commands", () => {
  it("successful add restarts exactly once after atomic config commit", async () => {
    const restart = vi.fn(async () => {
      const raw = JSON.parse(await readFile(path.join(dir, "state", "config.json"), "utf8"));
      expect(raw.projectRoots).toHaveLength(1);
      return true;
    });
    await runProjectsCommand(parseCliArguments(["projects", "add", path.join(dir, "project")]), captureIo(), restart);
    expect(restart).toHaveBeenCalledOnce();
  });
  it("duplicate add does not restart", async () => {
    const restart = vi.fn(async () => true);
    const args = parseCliArguments(["projects", "add", path.join(dir, "project")]);
    await runProjectsCommand(args, captureIo(), restart);
    restart.mockClear();
    await runProjectsCommand(args, captureIo(), restart);
    expect(restart).not.toHaveBeenCalled();
  });
  it("failed mutation never restarts", async () => {
    const restart = vi.fn(async () => true);
    await expect(
      runProjectsCommand(parseCliArguments(["projects", "add", path.join(dir, "missing")]), captureIo(), restart),
    ).rejects.toThrow();
    expect(restart).not.toHaveBeenCalled();
  });
  it("missing remove never restarts", async () => {
    const restart = vi.fn(async () => true);
    await runProjectsCommand(
      parseCliArguments(["projects", "remove", path.join(dir, "missing")]),
      captureIo(),
      restart,
    );
    expect(restart).not.toHaveBeenCalled();
  });
  it("no service retains foreground restart guidance", async () => {
    const io = captureIo();
    await runProjectsCommand(parseCliArguments(["projects", "add", path.join(dir, "project")]), io);
    expect(io.lines.join("\n")).toContain("Restart Homebase");
  });
  it("--no-restart suppresses restart", async () => {
    const restart = vi.fn(async () => true);
    await runProjectsCommand(
      parseCliArguments(["projects", "add", path.join(dir, "project"), "--no-restart"]),
      captureIo(),
      restart,
    );
    expect(restart).not.toHaveBeenCalled();
  });
  it("successful remove restarts exactly once", async () => {
    const restart = vi.fn(async () => true);
    await runProjectsCommand(parseCliArguments(["projects", "add", path.join(dir, "project")]), captureIo(), restart);
    restart.mockClear();
    await runProjectsCommand(
      parseCliArguments(["projects", "remove", path.join(dir, "project")]),
      captureIo(),
      restart,
    );
    expect(restart).toHaveBeenCalledOnce();
  });
});
