import { createServer } from "node:net";
import { HOMEBASE_API_VERSION, HOMEBASE_PROTOCOL_VERSION } from "@homebase/protocol";
import { z } from "zod";

const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  apiVersion: z.literal(HOMEBASE_API_VERSION),
  protocolVersion: z.literal(HOMEBASE_PROTOCOL_VERSION),
  uptimeSeconds: z.number().nonnegative(),
  latestSequence: z.number().nonnegative(),
});
export type HostHealth = z.infer<typeof healthSchema>;
export async function readHealth(port: number): Promise<HostHealth | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, {
      signal: AbortSignal.timeout(1000),
      redirect: "error",
    });
    if (!response.ok) return null;
    const parsed = healthSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  return false;
}
export async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
