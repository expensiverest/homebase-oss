import { describe, expect, it } from "vitest";
import { isLoopbackAddress, resolveRequestOrigin } from "../src/api/request-origin.js";

const requestUrl = "http://machine.example.ts.net/api/v1/providers/refresh";
const resolve = (overrides: Partial<Parameters<typeof resolveRequestOrigin>[0]> = {}) =>
  resolveRequestOrigin({ requestUrl, peerIsLoopback: true, ...overrides });

describe("trusted request origin", () => {
  it("uses the direct HTTP request origin without proxy headers", () => {
    expect(resolve({ requestUrl: "http://127.0.0.1:8787/api/v1/projects" })).toBe("http://127.0.0.1:8787");
    expect(resolve({ requestUrl: "http://[::1]:8787/api/v1/projects" })).toBe("http://[::1]:8787");
  });

  it("uses a single valid external origin from a loopback proxy", () => {
    expect(resolve({ forwardedProto: "https", forwardedHost: "machine.example.ts.net" })).toBe(
      "https://machine.example.ts.net",
    );
    expect(resolve({ forwardedProto: "http", forwardedHost: "machine.example.ts.net:8080" })).toBe(
      "http://machine.example.ts.net:8080",
    );
    expect(resolve({ forwardedProto: "https", forwardedHost: "machine.example.ts.net:443" })).toBe(
      "https://machine.example.ts.net",
    );
  });

  it("ignores forwarding headers from a non-loopback peer", () => {
    const expected = resolve({
      peerIsLoopback: false,
      forwardedProto: "https",
      forwardedHost: "evil.example",
    });
    expect(expected).toBe("http://machine.example.ts.net");
    expect("https://evil.example").not.toBe(expected);
  });

  it.each(["https,http", "javascript", "file", "https://evil.example", "", "https\n"])(
    "rejects malformed forwarded proto %j",
    (forwardedProto) => {
      expect(resolve({ forwardedProto, forwardedHost: "machine.example.ts.net" })).toBeNull();
    },
  );

  it.each([
    "good.ts.net,evil.example",
    "https://evil.example",
    "good.ts.net/evil",
    "good.ts.net\\evil",
    "good.ts.net:bad",
    "good.ts.net:99999",
    "user@good.ts.net",
    "good.ts.net?x=1",
    "good.ts.net#fragment",
    "",
  ])("rejects malformed forwarded host %j", (forwardedHost) => {
    expect(resolve({ forwardedProto: "https", forwardedHost })).toBeNull();
  });

  it("fails closed on incomplete trusted forwarding headers", () => {
    expect(resolve({ forwardedProto: "https" })).toBeNull();
    expect(resolve({ forwardedHost: "machine.example.ts.net" })).toBeNull();
  });

  it("recognizes only socket loopback addresses", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ["127.0.0.2", "192.168.1.2", "machine.example.ts.net", undefined])
      expect(isLoopbackAddress(address)).toBe(false);
  });
});
