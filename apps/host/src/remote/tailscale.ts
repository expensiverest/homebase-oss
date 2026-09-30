import { runExecutable, ExecutableFailure, type RunExecutable } from "@homebase/adapter-sdk";
import { z } from "zod";

const serveSchema = z
  .object({
    TCP: z.record(z.string(), z.object({ HTTPS: z.boolean().optional() }).passthrough()).optional(),
    Web: z
      .record(
        z.string(),
        z
          .object({
            Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    AllowFunnel: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough();
export type ServeStatus = z.infer<typeof serveSchema>;
export type ServeState = "missing" | "correct" | "conflict" | "funnel" | "ambiguous";
export interface TailscaleStatus {
  installed: boolean;
  connected: boolean;
  serve: ServeState;
  url: string | null;
  message: string;
}
export function normalizeServe(raw: unknown, port: number): Pick<TailscaleStatus, "serve" | "url"> {
  const parsed = serveSchema.safeParse(raw);
  if (!parsed.success) return { serve: "ambiguous", url: null };
  const status = parsed.data;
  if (Object.values(status.AllowFunnel ?? {}).some(Boolean)) return { serve: "funnel", url: null };
  const matches: string[] = [];
  for (const [host, web] of Object.entries(status.Web ?? {})) {
    const proxy = web.Handlers?.["/"]?.Proxy;
    if (proxy !== `http://127.0.0.1:${port}` && proxy !== `http://localhost:${port}`) continue;
    try {
      const url = new URL(`https://${host}`);
      if (
        !/^[a-z0-9.-]+\.ts\.net$/i.test(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        continue;
      if (status.TCP?.[url.port || "443"]?.HTTPS === true) matches.push(url.origin);
    } catch {
      /* malformed entry */
    }
  }
  if (matches.length === 1) return { serve: "correct", url: matches[0]! };
  if (matches.length > 1) return { serve: "ambiguous", url: null };
  const nonempty = Object.entries(status).some(
    ([_key, value]) => value != null && (typeof value !== "object" || Object.keys(value).length > 0),
  );
  return { serve: nonempty ? "conflict" : "missing", url: null };
}
export class TailscaleClient {
  readonly #run: RunExecutable;
  constructor(run: RunExecutable = runExecutable) {
    this.#run = run;
  }
  async inspect(port: number): Promise<TailscaleStatus> {
    const empty = { installed: true, connected: false, serve: "ambiguous" as const, url: null };
    try {
      const result = await this.#run("tailscale", ["status", "--json"], { timeoutMs: 5000 });
      if (result.code !== 0 || result.truncated)
        return { ...empty, message: "Tailscale status is unavailable. Run `tailscale status`." };
      const status = z.object({ BackendState: z.string() }).parse(JSON.parse(result.stdout));
      if (status.BackendState !== "Running")
        return { ...empty, message: "Tailscale is not connected. Run `tailscale up` yourself, then rerun setup." };
      const serve = await this.#run("tailscale", ["serve", "status", "--json"], { timeoutMs: 5000 });
      if (serve.code !== 0 || serve.truncated)
        return { ...empty, connected: true, message: "Serve status could not be read. No changes were made." };
      const normalized = normalizeServe(JSON.parse(serve.stdout), port);
      const messages: Record<ServeState, string> = {
        correct: "Tailscale private HTTPS is configured.",
        missing: "Private Serve is not configured.",
        conflict:
          "An existing Serve configuration conflicts with Homebase. Inspect `tailscale serve status`; it was left unchanged.",
        funnel: "Public Funnel is enabled. Homebase requires private Serve; disable Funnel yourself before setup.",
        ambiguous: "Serve status is ambiguous. No changes were made.",
      };
      return { installed: true, connected: true, ...normalized, message: messages[normalized.serve] };
    } catch (error) {
      if (error instanceof ExecutableFailure && error.kind === "not_found")
        return {
          ...empty,
          installed: false,
          message: "Tailscale is not installed. Install it and sign in for private phone access.",
        };
      return {
        ...empty,
        message: "Tailscale returned an unknown state. Run `tailscale status`; no changes were made.",
      };
    }
  }
  async configure(port: number): Promise<TailscaleStatus> {
    const before = await this.inspect(port);
    if (before.serve === "correct" && before.connected) return before;
    if (!before.connected || before.serve !== "missing") throw new Error(before.message);
    const result = await this.#run("tailscale", ["serve", "--bg", `http://127.0.0.1:${port}`], { timeoutMs: 15000 });
    if (result.code !== 0)
      throw new Error(
        "Tailscale could not configure private Serve. Check its permissions with `tailscale serve status`; the Homebase service was preserved.",
      );
    const after = await this.inspect(port);
    if (after.serve !== "correct" || !after.url)
      throw new Error(
        "Serve command finished, but its private HTTPS mapping could not be verified. Run `homebase doctor`.",
      );
    return after;
  }
}
