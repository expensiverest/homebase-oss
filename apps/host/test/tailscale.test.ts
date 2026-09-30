import { describe, expect, it, vi } from "vitest";
import { ExecutableFailure, type RunExecutableResult } from "@homebase/adapter-sdk";
import { normalizeServe, TailscaleClient } from "../src/remote/tailscale.js";
const mapping = (port = 8787) => ({
  TCP: { "443": { HTTPS: true } },
  Web: { "fixture.example.ts.net:443": { Handlers: { "/": { Proxy: `http://127.0.0.1:${port}` } } } },
});
const result = (value: unknown, code = 0): RunExecutableResult => ({
  command: "tailscale",
  stdout: JSON.stringify(value),
  stderr: "",
  code,
  truncated: false,
});
describe("structured Tailscale inspection", () => {
  it("recognizes empty/missing Serve", () => expect(normalizeServe({}, 8787)).toEqual({ serve: "missing", url: null }));
  it("recognizes private HTTPS exact proxy", () =>
    expect(normalizeServe(mapping(), 8787)).toEqual({ serve: "correct", url: "https://fixture.example.ts.net" }));
  it("rejects Funnel anywhere in config", () =>
    expect(normalizeServe({ ...mapping(), AllowFunnel: { "unrelated.ts.net:443": true } }, 8787).serve).toBe("funnel"));
  it("leaves conflicting ports alone", () => expect(normalizeServe(mapping(4096), 8787).serve).toBe("conflict"));
  it("treats unknown structures as conflict/ambiguous", () => {
    expect(normalizeServe({ future: { config: true } }, 8787).serve).toBe("conflict");
    expect(normalizeServe({ Web: "bad" }, 8787).serve).toBe("ambiguous");
  });
  it("reports executable missing", async () => {
    const run = vi.fn().mockRejectedValue(new ExecutableFailure("not_found", "missing"));
    expect((await new TailscaleClient(run).inspect(8787)).installed).toBe(false);
  });
  it("reports disconnected without login", async () => {
    const run = vi.fn().mockResolvedValue(result({ BackendState: "NeedsLogin", User: { secretIdentity: true } }));
    const status = await new TailscaleClient(run).inspect(8787);
    expect(status.connected).toBe(false);
    expect(JSON.stringify(status)).not.toContain("secretIdentity");
    expect(run).toHaveBeenCalledOnce();
  });
  it("reports connected private mapping", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result({ BackendState: "Running" }))
      .mockResolvedValueOnce(result(mapping()));
    expect((await new TailscaleClient(run).inspect(8787)).url).toBe("https://fixture.example.ts.net");
  });
  it("configures only empty Serve and verifies after command", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result({ BackendState: "Running" }))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({ BackendState: "Running" }))
      .mockResolvedValueOnce(result(mapping()));
    expect((await new TailscaleClient(run).configure(8787)).serve).toBe("correct");
    expect(run.mock.calls[2]![1]).toEqual(["serve", "--bg", "http://127.0.0.1:8787"]);
  });
  it.each([mapping(4096), { ...mapping(), AllowFunnel: { "fixture.example.ts.net:443": true } }, { Web: "bad" }])(
    "refuses mutation for unsafe state %j",
    async (config) => {
      const run = vi
        .fn()
        .mockResolvedValueOnce(result({ BackendState: "Running" }))
        .mockResolvedValueOnce(result(config));
      await expect(new TailscaleClient(run).configure(8787)).rejects.toThrow();
      expect(run).toHaveBeenCalledTimes(2);
    },
  );
  it("does not assume command success without verified mapping", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(result({ BackendState: "Running" }))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({}))
      .mockResolvedValueOnce(result({ BackendState: "Running" }))
      .mockResolvedValueOnce(result({}));
    await expect(new TailscaleClient(run).configure(8787)).rejects.toThrow("could not be verified");
  });
});
