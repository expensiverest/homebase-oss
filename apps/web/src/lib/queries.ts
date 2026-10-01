import { useInfiniteQuery, useQuery, type QueryClient } from "@tanstack/react-query";

import type { AgentEvent, AgentMessage, AgentSession } from "@homebase/protocol";

import { api, type ListPage } from "./api.js";

export const qk = {
  providers: ["providers"] as const,
  projects: ["projects"] as const,
  overview: ["project-overview"] as const,
  rootProjects: (rootId: string) => ["root-projects", rootId] as const,
  sessionUsage: (sessionId: string) => ["session", sessionId, "usage"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  sessions: (projectId: string) => ["project", projectId, "sessions"] as const,
  session: (sessionId: string) => ["session", sessionId] as const,
  messages: (sessionId: string) => ["session", sessionId, "messages"] as const,
  actions: (sessionId: string) => ["session", sessionId, "actions"] as const,
  diff: (sessionId: string) => ["session", sessionId, "diff"] as const,
  models: (projectId: string, providerId: string) => ["catalog", projectId, providerId, "models"] as const,
  modes: (projectId: string, providerId: string) => ["catalog", projectId, providerId, "modes"] as const,
  usage: (providerId: string) => ["usage", providerId] as const,
};

const LIVE_STALE = 5_000;

export function useOverview() {
  return useQuery({ queryKey: qk.overview, queryFn: api.overview, staleTime: 15_000 });
}
export function useRootProjects(rootId: string) {
  return useQuery({
    queryKey: qk.rootProjects(rootId),
    queryFn: () => api.rootProjects(rootId),
    enabled: !!rootId,
    staleTime: 15_000,
  });
}
export function useSessionUsage(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.sessionUsage(sessionId),
    queryFn: () => api.sessionUsage(sessionId),
    enabled: !!sessionId && enabled,
    staleTime: 30_000,
  });
}

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: () => api.providers(), staleTime: 15_000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => api.projects(), staleTime: 15_000 });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: qk.project(projectId ?? ""),
    queryFn: () => api.project(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  });
}

export function useSessions(projectId: string | undefined) {
  return useInfiniteQuery({
    queryKey: qk.sessions(projectId ?? ""),
    queryFn: ({ pageParam }) => api.sessions(projectId as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage<AgentSession>) => last.nextCursor,
    enabled: Boolean(projectId),
    staleTime: LIVE_STALE,
  });
}

export function useSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: qk.session(sessionId ?? ""),
    queryFn: () => api.session(sessionId as string),
    enabled: Boolean(sessionId),
    staleTime: 2_000,
  });
}

export function useMessages(sessionId: string | undefined) {
  return useInfiniteQuery({
    queryKey: qk.messages(sessionId ?? ""),
    queryFn: ({ pageParam }) => api.messages(sessionId as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ListPage<AgentMessage>) => last.nextCursor,
    enabled: Boolean(sessionId),
    staleTime: LIVE_STALE,
  });
}

export function useActions(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.actions(sessionId ?? ""),
    queryFn: () => api.actions(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 1_000,
  });
}

export function useModels(projectId: string | undefined, providerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.models(projectId ?? "", providerId ?? ""),
    queryFn: () => api.models(projectId as string, providerId as string),
    enabled: Boolean(projectId && providerId) && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useModes(projectId: string | undefined, providerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.modes(projectId ?? "", providerId ?? ""),
    queryFn: () => api.modes(projectId as string, providerId as string),
    enabled: Boolean(projectId && providerId) && enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDiff(sessionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.diff(sessionId ?? ""),
    queryFn: () => api.diff(sessionId as string),
    enabled: Boolean(sessionId) && enabled,
    staleTime: 2_000,
  });
}

export function useUsage(providerId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.usage(providerId ?? ""),
    queryFn: () => api.usage(providerId as string),
    enabled: Boolean(providerId) && enabled,
    staleTime: 60_000,
  });
}

/** Extracts a session id from an event, when it has one. */
function eventSessionId(event: AgentEvent): string | null {
  if (event.sessionId) return event.sessionId;
  if (event.type === "approval.requested") return event.data.approval.sessionId;
  if (event.type === "question.requested") return event.data.question.sessionId;
  if (event.type === "session.created" || event.type === "session.updated") return event.data.session.id;
  if (event.type === "session.deleted") return event.data.sessionId;
  return null;
}

/**
 * Event-driven invalidation: text deltas never trigger refetches; structural,
 * terminal, and provider events do. Called from the global stream subscriber.
 */
export function invalidateForEvent(client: QueryClient, event: AgentEvent | { type: "resync" }): void {
  const invalidate = (queryKey: readonly unknown[]) => {
    void client.invalidateQueries({ queryKey });
  };

  if (event.type === "resync") {
    void client.invalidateQueries();
    return;
  }

  switch (event.type) {
    case "provider.connected":
    case "provider.updated":
    case "provider.disconnected":
      invalidate(qk.providers);
      void client.invalidateQueries({ queryKey: ["usage"] });
      return;
    case "session.created":
    case "session.updated":
    case "session.deleted": {
      invalidate(qk.projects);
      invalidate(qk.overview);
      invalidate(["root-projects"]);
      const sessionId = eventSessionId(event);
      if (sessionId) invalidate(qk.session(sessionId));
      const projectId =
        event.type === "session.deleted" ? null : (event.data.session.projectId ?? event.projectId ?? null);
      if (projectId) invalidate(qk.sessions(projectId));
      else void client.invalidateQueries({ queryKey: ["project"] });
      return;
    }
    case "turn.completed":
    case "turn.failed":
    case "turn.interrupted": {
      const sessionId = eventSessionId(event);
      if (!sessionId) return;
      invalidate(qk.session(sessionId));
      invalidate(qk.messages(sessionId));
      invalidate(qk.actions(sessionId));
      invalidate(qk.diff(sessionId));
      invalidate(qk.sessionUsage(sessionId));
      invalidate(qk.overview);
      invalidate(["root-projects"]);
      return;
    }
    case "approval.requested":
    case "approval.resolved":
    case "question.requested":
    case "question.resolved": {
      const sessionId = eventSessionId(event);
      if (!sessionId) return;
      invalidate(qk.actions(sessionId));
      invalidate(qk.session(sessionId));
      return;
    }
    case "diff.updated": {
      const sessionId = eventSessionId(event);
      if (sessionId) invalidate(qk.diff(sessionId));
      return;
    }
    case "usage.updated":
      invalidate(qk.usage(event.data.usage.provider));
      return;
    case "session.usage.updated":
      invalidate(qk.sessionUsage(event.data.usage.sessionId));
      return;
    case "plan.updated": {
      const sessionId = eventSessionId(event);
      if (sessionId) invalidate(qk.messages(sessionId));
      return;
    }
    default:
      return;
  }
}
