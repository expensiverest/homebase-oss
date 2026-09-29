import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Only accept a Serve HTTPS root that clearly proxies this Host port. */
export async function detectServeUrl(port: number): Promise<string | null> {
  try {
    const { stdout } = await run("tailscale", ["serve", "status", "--json"], { timeout: 5000 });
    return serveUrlFromStatus(JSON.parse(stdout), port);
  } catch {
    return null;
  }
}

interface ServeStatus {
  TCP?: Record<string, { HTTPS?: boolean }>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
  AllowFunnel?: Record<string, boolean>;
}

export function serveUrlFromStatus(status: ServeStatus, port: number): string | null {
  const matches: string[] = [];
  for (const [host, web] of Object.entries(status.Web ?? {})) {
    if (status.AllowFunnel?.[host]) continue;
    const proxy = web.Handlers?.["/"]?.Proxy;
    if (proxy !== `http://127.0.0.1:${port}` && proxy !== `http://localhost:${port}`) continue;
    try {
      const url = new URL(`https://${host}`);
      if (url.username || url.password || !url.hostname.endsWith(".ts.net")) continue;
      if (status.TCP?.[url.port || "443"]?.HTTPS !== true) continue;
      matches.push(url.origin);
    } catch {
      /* malformed Serve entry */
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

export function validatePairUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Pairing URL must be a clean HTTPS origin, for example https://machine.tailnet.ts.net");
  }
  return url.origin;
}
