import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigError, configSummary, loadConfig } from "../src/config/index.js";

let dir: string;
let stateDir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "homebase-config-"));
  stateDir = path.join(dir, "state");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("configuration loading", () => {
  it("uses safe defaults when no config file exists", async () => {
    const config = await loadConfig({ cwd: dir, env: {}, stateDir });
    expect(config.host.port).toBe(8787);
    expect(config.host.bindAddress).toBe("127.0.0.1");
    expect(config.auth.mode).toBe("device");
    expect(config.projectRoots).toEqual([]);
  });

  it("loads a JSON config file", async () => {
    const configPath = path.join(dir, "explicit.json");
    await writeFile(
      configPath,
      JSON.stringify({
        host: { port: 9100, bindAddress: "127.0.0.1", logLevel: "debug" },
        projectRoots: [dir],
        projectScanDepth: 2,
      }),
      "utf8",
    );

    const config = await loadConfig({ configPath, env: {}, stateDir });
    expect(config.host.port).toBe(9100);
    expect(config.projectScanDepth).toBe(2);
    expect(config.projectRoots).toEqual([dir]);
  });

  it("applies environment overrides over file values", async () => {
    const configPath = path.join(dir, "overrides.json");
    await writeFile(configPath, JSON.stringify({ host: { port: 9100 } }), "utf8");

    const config = await loadConfig({
      configPath,
      stateDir,
      env: {
        HOMEBASE_PORT: "9200",
        HOMEBASE_BIND_ADDRESS: "127.0.0.1",
        HOMEBASE_PROJECT_ROOTS: [dir, path.dirname(dir)].join(path.delimiter),
      },
    });

    expect(config.host.port).toBe(9200);
    expect(config.projectRoots).toEqual([dir, path.dirname(dir)]);
  });

  it("rejects unparseable values with a clear issue list", async () => {
    try {
      await loadConfig({ env: { HOMEBASE_PORT: "not-a-port" }, stateDir });
      throw new Error("expected loadConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).issues.join(" ")).toContain("host.port");
    }
  });

  it("fails when an explicitly requested config file is missing", async () => {
    await expect(loadConfig({ configPath: path.join(dir, "nope.json"), env: {}, stateDir })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("rejects relative project roots", async () => {
    await expect(loadConfig({ env: { HOMEBASE_PROJECT_ROOTS: "relative/path" }, stateDir })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});

describe("security invariants", () => {
  it("refuses a non-loopback bind without authentication", async () => {
    await expect(
      loadConfig({ env: { HOMEBASE_BIND_ADDRESS: "0.0.0.0", HOMEBASE_AUTH_MODE: "none" }, stateDir }),
    ).rejects.toBeInstanceOf(ConfigError);

    try {
      await loadConfig({ env: { HOMEBASE_BIND_ADDRESS: "0.0.0.0", HOMEBASE_AUTH_MODE: "none" }, stateDir });
    } catch (error) {
      expect((error as ConfigError).issues.join(" ")).toContain("authentication");
    }
  });

  it("allows a non-loopback bind when a dev token is configured", async () => {
    const config = await loadConfig({
      env: {
        HOMEBASE_BIND_ADDRESS: "0.0.0.0",
        HOMEBASE_DEV_TOKEN: "a".repeat(48),
      },
      stateDir,
    });
    expect(config.auth.mode).toBe("dev-token");
  });

  it("requires dev tokens to be long enough to matter", async () => {
    await expect(
      loadConfig({ env: { HOMEBASE_BIND_ADDRESS: "0.0.0.0", HOMEBASE_DEV_TOKEN: "short" }, stateDir }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("never includes the dev token in config summaries", async () => {
    const token = "s".repeat(64);
    const config = await loadConfig({ env: { HOMEBASE_DEV_TOKEN: token }, stateDir });
    const summary = JSON.stringify(configSummary(config));
    expect(summary).not.toContain(token);
    expect(summary).toContain('"authMode":"dev-token"');
  });
});
