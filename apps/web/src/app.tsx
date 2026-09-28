import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { useVisualViewportHeight } from "./lib/chatScroll.js";
import { installVisibilityReconnect, registerInvalidator, startLiveStream, stopLiveStream } from "./lib/live.js";
import { invalidateForEvent } from "./lib/queries.js";
import { ChatScreen } from "./screens/ChatScreen.js";
import { DevUI } from "./screens/DevUI.js";
import { ProjectScreen } from "./screens/ProjectScreen.js";
import { ProjectsScreen } from "./screens/ProjectsScreen.js";

/**
 * Server state lives in TanStack Query. Nothing here persists the cache: the
 * query cache contains private conversation data and stays in memory only.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 2_000,
      gcTime: 5 * 60_000,
    },
  },
});

function AppShell() {
  // visualViewport shrinks when the iOS keyboard opens; the shell follows it so
  // the composer is never hidden behind the keyboard.
  const viewportHeight = useVisualViewportHeight();
  return (
    <div
      className="relative mx-auto flex w-full max-w-[720px] flex-col overflow-hidden bg-bg text-text"
      style={{ height: viewportHeight ? `${viewportHeight}px` : "100dvh" }}
    >
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ProjectsScreen });
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$projectId", component: ProjectScreen });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: "/s/$sessionId", component: ChatScreen });
const devUiRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dev/ui", component: DevUI });

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, chatRoute, devUiRoute]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

/** Wires the single global event stream into query invalidation. */
function Bootstrap(): null {
  useEffect(() => {
    registerInvalidator((event) => invalidateForEvent(queryClient, event));
    const stopVisibility = installVisibilityReconnect();
    startLiveStream();
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      stopVisibility();
      stopLiveStream();
      registerInvalidator(null);
    };
  }, []);
  return null;
}

export function start(): void {
  const container = document.getElementById("root");
  if (!container) throw new Error("Homebase web client could not find #root.");
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Bootstrap />
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
