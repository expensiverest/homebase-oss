import { describe, expect, it } from "vitest";
import { serveUrlFromStatus, validatePairUrl } from "../src/remote.js";

describe("pairing origin", () => {
  it("accepts only a clean HTTPS origin", () => {
    expect(validatePairUrl("https://machine.tailnet.ts.net/")).toBe("https://machine.tailnet.ts.net");
    for (const value of [
      "http://machine.tailnet.ts.net",
      "https://user:pass@machine.tailnet.ts.net",
      "https://machine.tailnet.ts.net/path",
      "https://machine.tailnet.ts.net/?token=x",
      "https://machine.tailnet.ts.net/#secret",
    ]) {
      expect(() => validatePairUrl(value)).toThrow();
    }
  });
  it("detects only an unambiguous private HTTPS Serve proxy", () => {
    const status = {
      TCP: { "443": { HTTPS: true }, "80": { HTTPS: false }, "8443": { HTTPS: true } },
      Web: {
        "host.tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } },
        "host.tailnet.ts.net:80": { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } },
      } as Record<string, { Handlers: { "/": { Proxy: string } } }>,
      AllowFunnel: {} as Record<string, boolean>,
    };
    expect(serveUrlFromStatus(status, 8787)).toBe("https://host.tailnet.ts.net");
    status.AllowFunnel["host.tailnet.ts.net:443"] = true;
    expect(serveUrlFromStatus(status, 8787)).toBeNull();
    delete status.AllowFunnel["host.tailnet.ts.net:443"];
    status.Web["host.tailnet.ts.net:8443"] = { Handlers: { "/": { Proxy: "http://127.0.0.1:8787" } } };
    expect(serveUrlFromStatus(status, 8787)).toBeNull();
    delete status.Web["host.tailnet.ts.net:443"];
    expect(serveUrlFromStatus(status, 8787)).toBe("https://host.tailnet.ts.net:8443");
  });
});
