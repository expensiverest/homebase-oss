import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { AdapterLogger } from "@homebase/adapter-sdk";
import type { Context } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticWebOptions {
  /** Absolute path to the built web client (`apps/web/dist`). */
  distPath: string;
  logger?: AdapterLogger;
}

const DEV_MESSAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Homebase</title></head>
<body style="font-family: system-ui; margin: 3rem auto; max-width: 34rem; line-height: 1.5">
<h1>Homebase web client is not built</h1>
<p>The Host is running, but no production web build was found at <code>apps/web/dist</code>.</p>
<p>Build it with <code>npm run build -w @homebase/web</code>, or run the Vite dev server with
<code>npm run dev -w @homebase/web</code> (it proxies <code>/api</code> to this Host).</p>
<p>The API itself is available under <code>/api/v1/health</code>.</p>
</body></html>`;

/**
 * Serves the built PWA from the Host.
 *
 * - `/api/*` is never handled here (API routes are registered first and the
 *   API catch-all answers before this handler is reached).
 * - SPA fallback to `index.html` for navigation requests; missing files with
 *   an extension get a real 404 instead of HTML.
 * - Hashed Vite assets are immutable; `index.html`, the manifest, and icons
 *   revalidate so new releases take effect.
 * - Path traversal is blocked by resolving inside the dist root.
 */
export function createStaticWebHandler(options: StaticWebOptions) {
  const distPath = path.resolve(options.distPath);
  const indexPath = path.join(distPath, "index.html");

  const respond = (body: string, contentType: string, cacheControl: string, status = 200): Response =>
    new Response(body, {
      status,
      headers: { "content-type": contentType, "cache-control": cacheControl, "x-content-type-options": "nosniff" },
    });

  return async (c: Context, next: () => Promise<void>): Promise<Response | void> => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    const pathname = c.req.path;
    if (pathname.startsWith("/api/")) return next();

    if (!existsSync(indexPath)) {
      if (pathname === "/" || !path.extname(pathname)) {
        options.logger?.warn("Web client build not found; serving development instructions.", { distPath });
        return respond(DEV_MESSAGE, CONTENT_TYPES[".html"] ?? "text/html", "no-store");
      }
      return next();
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return respond("Bad request", "text/plain; charset=utf-8", "no-store", 400);
    }

    const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
    const candidate = path.resolve(distPath, relative);
    const inside = candidate === distPath || candidate.startsWith(distPath + path.sep);

    if (inside && relative.length > 0 && existsSync(candidate) && statSync(candidate).isFile()) {
      const extension = path.extname(candidate).toLowerCase();
      const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
      const immutable = /(^|[\\/])assets[\\/]/.test(candidate);
      const revalidate =
        extension === ".html" ||
        extension === ".webmanifest" ||
        extension === ".ico" ||
        extension === ".txt" ||
        !immutable;
      const cacheControl = revalidate ? "no-cache" : "public, max-age=31536000, immutable";
      try {
        const body = readFileSync(candidate);
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": contentType,
            "cache-control": cacheControl,
            "x-content-type-options": "nosniff",
          },
        });
      } catch {
        return respond("Internal error", "text/plain; charset=utf-8", "no-store", 500);
      }
    }

    // Unknown path with a file extension: a real 404 rather than SPA HTML.
    if (path.extname(decoded).length > 0) {
      return respond("Not found", "text/plain; charset=utf-8", "no-store", 404);
    }

    // SPA deep link: serve the shell.
    try {
      const body = readFileSync(indexPath, "utf8");
      return respond(body, CONTENT_TYPES[".html"] ?? "text/html", "no-cache");
    } catch {
      return respond("Internal error", "text/plain; charset=utf-8", "no-store", 500);
    }
  };
}
