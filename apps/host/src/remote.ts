import { TailscaleClient, normalizeServe, type ServeStatus } from "./remote/tailscale.js";
export { TailscaleClient, normalizeServe };

/** Only accept a Serve HTTPS root that clearly proxies this Host port. */
export async function detectServeUrl(port: number): Promise<string | null> {
  return (await new TailscaleClient().inspect(port)).url;
}

export function serveUrlFromStatus(status: ServeStatus, port: number): string | null {
  return normalizeServe(status, port).url;
}

export function validatePairUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Pairing URL must be a clean HTTPS origin, for example https://machine.tailnet.ts.net");
  }
  return url.origin;
}
