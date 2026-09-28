import { bodyLimit } from "hono/body-limit";
import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z, ZodType } from "zod";

import type { AdapterLogger } from "@homebase/adapter-sdk";
import {
  HOMEBASE_API_VERSION,
  HOMEBASE_PROTOCOL_VERSION,
  approvalResultSchema,
  createSessionInputSchema,
  questionAnswerSchema,
  sendMessageInputSchema,
  setModeInputSchema,
  setModelInputSchema,
  type AgentProject,
  type JsonValue,
} from "@homebase/protocol";

import { getConnInfo } from "@hono/node-server/conninfo";

import type { Authenticator } from "../auth/index.js";
import { ATTACHMENT_MAX_FILES_PER_UPLOAD, type AttachmentStore } from "../attachments/index.js";
import type { HostConfig } from "../config/index.js";
import { errorBody, HostError, normalizeError } from "../errors.js";
import type { EventBus } from "../events/index.js";
import type { ProjectRegistry } from "../projects/index.js";
import type { ProviderRegistry } from "../providers/index.js";
import type { SessionService } from "../sessions/index.js";
import { sseEventsHandler } from "./sse.js";

export interface ApiDependencies {
  version: string;
  startedAt: number;
  config: HostConfig;
  bus: EventBus;
  providers: ProviderRegistry;
  projects: ProjectRegistry;
  sessions: SessionService;
  attachments: AttachmentStore;
  auth: Authenticator;
  logger: AdapterLogger;
}

export interface ApiEnv {
  Variables: {
    requestId: string;
  };
}

const MAX_BODY_BYTES = 1024 * 1024;
/** Multipart uploads get their own, larger limit; all other JSON bodies stay at 1 MiB. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Builds the Homebase Host API: REST for commands and reads, SSE for the
 * normalized event stream. Every failure uses the stable `{ error: { code } }`
 * envelope; provider-native errors never reach clients unsanitized.
 */
export function createApiApp(deps: ApiDependencies): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.use("/api/*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    await next();
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
  });

  const jsonLimit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json(errorBody(new HostError("invalid_request", "Request body is too large."), c.get("requestId")), 413),
  });
  app.use("/api/*", async (c, next) => {
    // Multipart attachment uploads use a route-specific limit instead.
    if (c.req.path === "/api/v1/attachments" && c.req.method === "POST") return next();
    return jsonLimit(c, next);
  });

  // Authentication. Health stays reachable for local diagnostics; it never
  // contains secrets or project data.
  app.use("/api/*", async (c, next) => {
    if (deps.auth.mode === "none") return next();
    if (c.req.path === "/api/v1/health") return next();

    const decision = deps.auth.authenticate(c.req.header("authorization"), clientKey(c));
    if (!decision.ok) {
      if (decision.retryAfterSeconds !== undefined) {
        c.header("retry-after", String(decision.retryAfterSeconds));
      }
      const error = new HostError(decision.code ?? "invalid_request", decision.message ?? "Unauthorized.", {
        status: decision.status ?? 401,
      });
      return c.json(errorBody(error, c.get("requestId")), error.status as ContentfulStatusCode);
    }
    return next();
  });

  app.onError((error, c) => {
    const hostError = normalizeError(error);
    const requestId = c.get("requestId");
    if (hostError.code === "internal" || hostError.status >= 500) {
      deps.logger.error("API request failed.", {
        requestId,
        path: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return c.json(errorBody(hostError, requestId), hostError.status as ContentfulStatusCode);
  });

  app.get("/api/v1/health", (c) =>
    c.json({
      status: "ok",
      version: deps.version,
      apiVersion: HOMEBASE_API_VERSION,
      protocolVersion: HOMEBASE_PROTOCOL_VERSION,
      uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1_000),
      latestSequence: deps.bus.latestSequence,
    }),
  );

  app.get("/api/v1/providers", (c) => c.json({ providers: deps.providers.listProviders() }));

  app.get("/api/v1/providers/:providerId", (c) =>
    c.json({ provider: deps.providers.getProvider(c.req.param("providerId")) }),
  );

  app.get("/api/v1/providers/:providerId/usage", async (c) =>
    c.json({ usage: await deps.sessions.getUsage(c.req.param("providerId")) }),
  );

  app.get("/api/v1/projects", (c) =>
    c.json({ projects: deps.projects.list().map((project) => withAvailability(project, deps)) }),
  );

  app.get("/api/v1/projects/:projectId", (c) =>
    c.json({ project: withAvailability(deps.projects.require(c.req.param("projectId")), deps) }),
  );

  app.get("/api/v1/projects/:projectId/sessions", async (c) => {
    const page = await deps.sessions.listForProject(c.req.param("projectId"), {
      limit: limitParam(c),
      cursor: cursorParam(c),
    });
    return c.json({ sessions: page.items, nextCursor: page.nextCursor, previousCursor: page.previousCursor });
  });

  app.get("/api/v1/projects/:projectId/providers/:providerId/models", async (c) => {
    const project = deps.projects.require(c.req.param("projectId"));
    const models = await deps.providers.listModels(c.req.param("providerId"), project);
    return c.json({ models });
  });

  app.get("/api/v1/projects/:projectId/providers/:providerId/modes", async (c) => {
    const project = deps.projects.require(c.req.param("projectId"));
    const modes = await deps.providers.listModes(c.req.param("providerId"), project);
    return c.json({ modes });
  });

  app.post("/api/v1/sessions", async (c) => {
    const input = await parseBody(c, createSessionInputSchema);
    const session = await deps.sessions.create(input);
    return c.json({ session }, 201);
  });

  app.get("/api/v1/sessions/:sessionId", async (c) =>
    c.json({ session: await deps.sessions.get(c.req.param("sessionId")) }),
  );

  app.get("/api/v1/sessions/:sessionId/messages", async (c) => {
    const page = await deps.sessions.listMessages(c.req.param("sessionId"), {
      limit: limitParam(c),
      cursor: cursorParam(c),
    });
    return c.json({ messages: page.items, nextCursor: page.nextCursor, previousCursor: page.previousCursor });
  });

  app.delete("/api/v1/sessions/:sessionId", async (c) => {
    await deps.sessions.delete(c.req.param("sessionId"));
    return c.body(null, 204);
  });

  app.post("/api/v1/sessions/:sessionId/messages", async (c) => {
    const input = await parseBody(c, sendMessageInputSchema);
    await deps.sessions.send(c.req.param("sessionId"), input);
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/v1/sessions/:sessionId/interrupt", async (c) => {
    await deps.sessions.interrupt(c.req.param("sessionId"));
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/v1/sessions/:sessionId/steer", async (c) => {
    const input = await parseBody(c, sendMessageInputSchema);
    await deps.sessions.steer(c.req.param("sessionId"), input);
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/v1/sessions/:sessionId/queue", async (c) => {
    const input = await parseBody(c, sendMessageInputSchema);
    await deps.sessions.queue(c.req.param("sessionId"), input);
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/v1/sessions/:sessionId/model", async (c) => {
    const input = await parseBody(c, setModelInputSchema);
    await deps.sessions.setModel(c.req.param("sessionId"), input);
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/v1/sessions/:sessionId/mode", async (c) => {
    const input = await parseBody(c, setModeInputSchema);
    await deps.sessions.setMode(c.req.param("sessionId"), input);
    return c.json({ accepted: true }, 202);
  });

  app.get("/api/v1/sessions/:sessionId/diff", async (c) =>
    c.json({ diff: await deps.sessions.getDiff(c.req.param("sessionId")) }),
  );

  app.post("/api/v1/approvals/:requestId", async (c) => {
    const input = await parseBody(c, approvalResultSchema);
    await deps.sessions.resolveApproval(c.req.param("requestId"), input);
    return c.json({ resolved: true }, 202);
  });

  app.post("/api/v1/questions/:requestId", async (c) => {
    const input = await parseBody(c, questionAnswerSchema);
    await deps.sessions.answerQuestion(c.req.param("requestId"), input);
    return c.json({ resolved: true }, 202);
  });

  app.get("/api/v1/events", (c) => sseEventsHandler(c, deps));

  app.post(
    "/api/v1/attachments",
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) =>
        c.json(errorBody(new HostError("invalid_attachment", "Upload is too large."), c.get("requestId")), 413),
    }),
    async (c) => {
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        throw new HostError("invalid_request", "Attachments must be uploaded as multipart/form-data.");
      }
      const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
      if (files.length === 0) {
        throw new HostError("invalid_request", "No files were uploaded.");
      }
      if (files.length > ATTACHMENT_MAX_FILES_PER_UPLOAD) {
        throw new HostError("invalid_attachment", `At most ${ATTACHMENT_MAX_FILES_PER_UPLOAD} files per upload.`);
      }
      const stored = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        stored.push(deps.attachments.add({ filename: file.name, mimeType: file.type, bytes }));
      }
      return c.json({ attachments: stored.map((attachment) => deps.attachments.toRef(attachment)) }, 201);
    },
  );

  app.get("/api/v1/attachments/:attachmentId", (c) => {
    const attachment = deps.attachments.get(c.req.param("attachmentId"));
    const disposition = attachment.mimeType.startsWith("image/") ? "inline" : "attachment";
    return new Response(attachment.bytes, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.size),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": `${disposition}; filename="${attachment.filename.replace(/"/g, "")}"`,
      },
    });
  });

  app.all("/api/*", (c) =>
    c.json(errorBody(new HostError("not_found", "No such API route."), c.get("requestId")), 404),
  );

  return app;
}

function withAvailability(project: AgentProject, deps: ApiDependencies): AgentProject {
  return { ...project, providersAvailable: deps.providers.availableProviderIds() };
}

function limitParam(c: Context): number | undefined {
  const raw = c.req.query("limit");
  if (raw === undefined || raw === "") return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new HostError("invalid_request", "Invalid limit parameter.");
  }
  return value;
}

function cursorParam(c: Context): string | undefined {
  const raw = c.req.query("cursor");
  return raw && raw.length > 0 ? raw : undefined;
}

/** Reads and validates a JSON body, producing stable validation errors. */
async function parseBody<S extends ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HostError("invalid_request", "Request body must be valid JSON.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    }));
    throw new HostError("invalid_request", "Request body failed validation.", {
      details: { issues: issues as unknown as JsonValue },
    });
  }
  return result.data;
}

function clientKey(c: Context): string {
  try {
    // Available when served by @hono/node-server; tests using app.request()
    // fall back to a shared key.
    const info = getConnInfo(c);
    return info.remote.address ?? "unknown";
  } catch {
    return "local";
  }
}
