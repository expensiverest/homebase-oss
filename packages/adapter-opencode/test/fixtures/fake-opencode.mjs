#!/usr/bin/env node
/**
 * Deterministic fake `opencode` CLI used by managed-server lifecycle tests.
 *
 * Modes (FAKE_OPENCODE_MODE):
 * - `normal` (default): binds 127.0.0.1 on the requested port (0 = ephemeral),
 *   honors Basic auth from OPENCODE_PASSWORD/OPENCODE_SERVER_PASSWORD, prints
 *   the real `server listening on ...` line OpenCode prints.
 * - `v1`: `--version` prints a v1 version (CLI-age compatibility tests).
 * - `port-busy`: exits with an EADDRINUSE-style diagnostic.
 * - `exit`: exits immediately with a failure diagnostic.
 * - `hang`: never binds and never exits (startup timeout tests).
 *
 * Optional FAKE_OPENCODE_START_DELAY_MS makes /api/info answer 503 first,
 * mirroring OpenCode's "starting" state.
 */
import http from "node:http";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_OPENCODE_MODE ?? "normal";
const password = process.env.OPENCODE_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD ?? "";

if (args.includes("--version") || args[0] === "version") {
  console.log(mode === "v1" ? "1.18.33" : "opencode v2.0.18");
  process.exit(0);
}

if (args[0] !== "serve") {
  console.error(`fake-opencode: unsupported command: ${args.join(" ")}`);
  process.exit(2);
}

if (process.env.FAKE_OPENCODE_PID_FILE) {
  writeFileSync(process.env.FAKE_OPENCODE_PID_FILE, String(process.pid));
}

if (mode === "port-busy") {
  console.error("Error: listen EADDRINUSE: address already in use 127.0.0.1:4096");
  process.exit(1);
}
if (mode === "exit") {
  console.error("fake-opencode: failed to start");
  process.exit(3);
}
if (mode === "hang") {
  setInterval(() => undefined, 1_000);
} else {
  const portIndex = args.indexOf("--port");
  const requested = portIndex >= 0 ? Number(args[portIndex + 1]) : 0;
  const delayMs = Number(process.env.FAKE_OPENCODE_START_DELAY_MS ?? "0");
  const startedAt = Date.now();
  const expectedAuth = password ? `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}` : null;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/info") {
      if (expectedAuth && request.headers.authorization !== expectedAuth) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ _tag: "UnauthorizedError" }));
        return;
      }
      if (delayMs > 0 && Date.now() - startedAt < delayMs) {
        response.writeHead(503, { "retry-after": "1" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: "2.0.18", pid: process.pid, urls: [] }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ _tag: "NotFoundError" }));
  });

  server.listen(Number.isFinite(requested) ? requested : 0, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : requested;
    console.log(`server listening on http://127.0.0.1:${actualPort}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
