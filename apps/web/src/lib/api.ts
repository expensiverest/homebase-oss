import {
  agentApprovalRequestSchema,
  agentDiffSchema,
  agentMessageSchema,
  agentModeSchema,
  agentModelSchema,
  agentProjectSchema,
  agentProviderSchema,
  agentQuestionRequestSchema,
  agentSessionSchema,
  agentProviderUsageSchema,
  agentSessionUsageSchema,
  projectOverviewSchema,
  projectSummarySchema,
  projectDirectoryListingSchema,
  projectFilePreviewSchema,
  apiErrorSchema,
  approvalResultSchema,
  createSessionInputSchema,
  questionAnswerSchema,
  sendMessageInputSchema,
  setModeInputSchema,
  setModelInputSchema,
  type AgentApprovalRequest,
  type AgentAttachmentRef,
  type AgentDiff,
  type AgentMode,
  type AgentMessage,
  type AgentModel,
  type AgentProvider,
  type AgentProject,
  type AgentQuestionRequest,
  type AgentSession,
  type AgentProviderUsage,
  type ApprovalResult,
  type CreateSessionInput,
  type QuestionAnswer,
  type SendMessageInput,
  type SetModeInput,
  type SetModelInput,
} from "@homebase/protocol";
import { z } from "zod";

import { authHeaders, getTransport } from "./transport.js";
import type { Device } from "./auth.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface RequestOptions<T> {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  schema?: z.ZodType<T>;
}

async function request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  const init: RequestInit = { method: options.method ?? "GET", headers, signal: options.signal };
  if (init.method !== "GET") headers["x-homebase-client"] = "1";
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await getTransport().fetch(path, init);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, "unreachable", "Homebase cannot reach the Host.");
  }

  const text = await response.text();
  let json: unknown = null;
  if (text.trim().length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    }
    throw new ApiError(response.status, "http_error", `Homebase request failed with HTTP ${response.status}.`);
  }

  if (options.schema) {
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      if (import.meta.env.DEV) console.warn("Homebase API validation failed", path, parsed.error.issues);
      throw new ApiError(0, "invalid_response", "Homebase returned data this client does not understand.");
    }
    return parsed.data;
  }
  return json as T;
}

const providersSchema = z.object({ providers: z.array(agentProviderSchema) });
const projectsSchema = z.object({ projects: z.array(agentProjectSchema) });
const projectSchema = z.object({ project: agentProjectSchema });
const sessionSchema = z.object({ session: agentSessionSchema });
const sessionsPageSchema = z.object({
  sessions: z.array(agentSessionSchema),
  nextCursor: z.string().nullable(),
});
const messagesPageSchema = z.object({
  messages: z.array(agentMessageSchema),
  nextCursor: z.string().nullable(),
});
const actionsSchema = z.object({
  approvals: z.array(agentApprovalRequestSchema),
  questions: z.array(agentQuestionRequestSchema),
});
const modelsSchema = z.object({ models: z.array(agentModelSchema) });
const modesSchema = z.object({ modes: z.array(agentModeSchema) });
const diffSchema = z.object({ diff: agentDiffSchema });
const usageSchema = z.object({ usage: agentProviderUsageSchema.nullable() });
const acceptedSchema = z.object({ accepted: z.boolean() });
const resolvedSchema = z.object({ resolved: z.boolean() });
const attachmentsSchema = z.object({ attachments: z.unknown().array() });

export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** One typed, provider-neutral API client used by every screen. */
export const api = {
  overview: () => request("/api/v1/projects/overview", { schema: projectOverviewSchema }),
  rootProjects: (rootId: string) =>
    request(`/api/v1/project-roots/${encodeURIComponent(rootId)}/projects`, {
      schema: z.object({ projects: z.array(projectSummarySchema) }),
    }).then((body) => body.projects),
  files: (projectId: string, relativePath: string, signal?: AbortSignal) =>
    request(`/api/v1/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(relativePath)}`, {
      schema: projectDirectoryListingSchema,
      signal,
    }),
  file: (projectId: string, relativePath: string, signal?: AbortSignal) =>
    request(`/api/v1/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(relativePath)}`, {
      schema: projectFilePreviewSchema,
      signal,
    }),
  fileImage: async (projectId: string, relativePath: string, signal: AbortSignal): Promise<Blob> => {
    const response = await getTransport().fetch(
      `/api/v1/projects/${encodeURIComponent(projectId)}/file-bytes?path=${encodeURIComponent(relativePath)}`,
      { headers: authHeaders(), signal, cache: "no-store" },
    );
    if (!response.ok) throw new ApiError(response.status, "file_unavailable", "Image preview is unavailable.");
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(response.headers.get("content-type") ?? ""))
      throw new ApiError(0, "invalid_response", "Unsupported image type.");
    return response.blob();
  },
  sessionUsage: (sessionId: string) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/usage`, {
      schema: z.object({ usage: agentSessionUsageSchema.nullable() }),
    }).then((body) => body.usage),
  health: () => request<{ status: string; version: string; latestSequence: number }>("/api/v1/health"),
  devices: () => request<{ devices: Device[] }>("/api/v1/devices"),
  renameDevice: (id: string, name: string) =>
    request<{ device: Device }>(`/api/v1/devices/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } }),
  revokeDevice: (id: string) =>
    request<{ device: Device }>(`/api/v1/devices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  redeemPair: (credential: string, name: string) =>
    request<{ device: Device }>("/api/v1/pairing/redeem", { method: "POST", body: { credential, name } }),

  providers: () => request("/api/v1/providers", { schema: providersSchema }).then((body) => body.providers),
  refreshProviders: () =>
    request("/api/v1/providers/refresh", { method: "POST", schema: providersSchema }).then((body) => body.providers),

  projects: () => request("/api/v1/projects", { schema: projectsSchema }).then((body) => body.projects),
  project: (projectId: string) =>
    request(`/api/v1/projects/${encodeURIComponent(projectId)}`, { schema: projectSchema }).then(
      (body) => body.project,
    ),

  sessions: async (projectId: string, cursor?: string | null): Promise<ListPage<AgentSession>> => {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);
    const body = await request(`/api/v1/projects/${encodeURIComponent(projectId)}/sessions?${query.toString()}`, {
      schema: sessionsPageSchema,
    });
    return { items: body.sessions, nextCursor: body.nextCursor };
  },

  session: (sessionId: string) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { schema: sessionSchema }).then(
      (body) => body.session,
    ),
  createSession: (input: CreateSessionInput) =>
    request("/api/v1/sessions", {
      method: "POST",
      body: createSessionInputSchema.parse(input),
      schema: sessionSchema,
    }).then((body) => body.session),
  deleteSession: (sessionId: string) =>
    request<void>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }),

  messages: async (sessionId: string, cursor?: string | null): Promise<ListPage<AgentMessage>> => {
    const query = new URLSearchParams({ limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const body = await request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`, {
      schema: messagesPageSchema,
    });
    return { items: body.messages, nextCursor: body.nextCursor };
  },

  actions: (sessionId: string) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/actions`, { schema: actionsSchema }),

  sendMessage: (sessionId: string, input: SendMessageInput) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: sendMessageInputSchema.parse(input),
      schema: acceptedSchema,
    }),
  queueMessage: (sessionId: string, input: SendMessageInput) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/queue`, {
      method: "POST",
      body: sendMessageInputSchema.parse(input),
      schema: acceptedSchema,
    }),
  steerMessage: (sessionId: string, input: SendMessageInput) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/steer`, {
      method: "POST",
      body: sendMessageInputSchema.parse(input),
      schema: acceptedSchema,
    }),
  interrupt: (sessionId: string) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/interrupt`, { method: "POST", schema: acceptedSchema }),

  resolveApproval: (requestId: string, result: ApprovalResult) =>
    request(`/api/v1/approvals/${encodeURIComponent(requestId)}`, {
      method: "POST",
      body: approvalResultSchema.parse(result),
      schema: resolvedSchema,
    }),
  answerQuestion: (requestId: string, answer: QuestionAnswer) =>
    request(`/api/v1/questions/${encodeURIComponent(requestId)}`, {
      method: "POST",
      body: questionAnswerSchema.parse(answer),
      schema: resolvedSchema,
    }),

  setModel: (sessionId: string, input: SetModelInput) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: "POST",
      body: setModelInputSchema.parse(input),
      schema: acceptedSchema,
    }),
  setMode: (sessionId: string, input: SetModeInput) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/mode`, {
      method: "POST",
      body: setModeInputSchema.parse(input),
      schema: acceptedSchema,
    }),

  diff: (sessionId: string) =>
    request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/diff`, { schema: diffSchema }).then((body) => body.diff),
  usage: (providerId: string) =>
    request(`/api/v1/providers/${encodeURIComponent(providerId)}/usage`, { schema: usageSchema }).then(
      (body) => body.usage,
    ),

  models: (projectId: string, providerId: string) =>
    request(`/api/v1/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}/models`, {
      schema: modelsSchema,
    }).then((body) => body.models),
  modes: (projectId: string, providerId: string) =>
    request(`/api/v1/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(providerId)}/modes`, {
      schema: modesSchema,
    }).then((body) => body.modes),

  uploadAttachments: async (files: File[]): Promise<AgentAttachmentRef[]> => {
    const form = new FormData();
    for (const file of files) form.append("file", file, file.name);
    const response = await getTransport().fetch("/api/v1/attachments", {
      method: "POST",
      body: form,
      headers: { ...authHeaders(), "x-homebase-client": "1" },
    });
    const json = (await response.json().catch(() => null)) as unknown;
    const parsed = attachmentsSchema.safeParse(json);
    if (!response.ok || !parsed.success) {
      throw new ApiError(response.status || 0, "invalid_attachment", "The attachment upload failed.");
    }
    return parsed.data.attachments as AgentAttachmentRef[];
  },

  attachmentUrl: (attachmentId: string) => `/api/v1/attachments/${encodeURIComponent(attachmentId)}`,
};

export type {
  AgentApprovalRequest,
  AgentAttachmentRef,
  AgentDiff,
  AgentMode,
  AgentMessage,
  AgentModel,
  AgentProvider,
  AgentProject,
  AgentQuestionRequest,
  AgentSession,
  AgentProviderUsage,
};
