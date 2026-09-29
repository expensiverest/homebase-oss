import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { useVisibleViewport } from "./lib/chatScroll.js";
import { getAuthStatus, type AuthStatus } from "./lib/auth.js";
import { lockPagePanning } from "./lib/touchScroll.js";
import {
  clearLastSequence,
  installVisibilityReconnect,
  registerInvalidator,
  startLiveStream,
  stopLiveStream,
  useLive,
} from "./lib/live.js";
import { invalidateForEvent } from "./lib/queries.js";
import { ChatScreen } from "./screens/ChatScreen.js";
import { DevUI } from "./screens/DevUI.js";
import { ProjectScreen } from "./screens/ProjectScreen.js";
import { ProjectsScreen } from "./screens/ProjectsScreen.js";
import { PairScreen } from "./screens/PairScreen.js";
import { DevicesScreen } from "./screens/DevicesScreen.js";

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
  const location = useLocation();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getAuthStatus().then(
        (result) => {
          if (active) {
            setAuth(result);
            setUnreachable(false);
          }
        },
        () => {
          if (active) setUnreachable(true);
        },
      );
    };
    const lost = () => {
      stopLiveStream();
      clearLastSequence();
      queryClient.clear();
      useLive.getState().resetOverlay();
      useLive.getState().setConnection("auth-required");
      setAuth({ mode: "device", authenticated: false });
    };
    window.addEventListener("homebase:auth-lost", lost);
    window.addEventListener("homebase:auth-changed", refresh);
    refresh();
    return () => {
      active = false;
      window.removeEventListener("homebase:auth-lost", lost);
      window.removeEventListener("homebase:auth-changed", refresh);
    };
  }, []);
  // The shell is fixed to the screen (top and bottom 0), so the page itself never scrolls. (In an
  // iOS standalone PWA that only reaches the real bottom because `html` has a tall min-height:
  // see index.css.) Only while the
  // software keyboard is up does it take the visual viewport's height AND offset: iOS keeps the
  // layout viewport full-height and scrolls the visual one to reveal the caret, so without this
  // the composer would jump under the status bar. (Android resizes the layout viewport itself.)
  //
  // The transform is always present, even at 0: it makes the shell the containing block for
  // `position: fixed` descendants, so sheets fill exactly the shell (the visible area) instead of the
  // full-height layout viewport, where the keyboard would cover or push them.
  const visible = useVisibleViewport();
  const keyboard = visible?.keyboard === true;
  // `html` is deliberately taller than the screen (see index.css), so a drag on anything that is
  // not a scroll area (the composer) must not be allowed to pan the page: that is what made the
  // screen shake while the keyboard was up. Real scrollers are unaffected.
  useEffect(() => lockPagePanning(), []);
  return (
    <div
      data-app-shell
      className="fixed inset-x-0 top-0 mx-auto flex w-full max-w-[720px] flex-col overflow-hidden bg-bg text-text"
      style={
        keyboard
          ? {
              bottom: "auto",
              height: `${visible.height}px`,
              transform: `translateY(${visible.top}px)`,
            }
          : { bottom: 0, transform: "translateY(0)" }
      }
    >
      {location.pathname === "/pair" ? (
        <Outlet />
      ) : unreachable ? (
        <div className="m-auto px-6 text-center text-row">
          <p>Homebase cannot reach the Host. Check your connection.</p>
          <button className="mt-4 min-h-11 text-accent" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      ) : !auth ? (
        <div className="m-auto text-muted">Connecting…</div>
      ) : auth.authenticated ? (
        <>
          <Bootstrap />
          <Outlet />
        </>
      ) : (
        <div className="m-auto max-w-md px-6 text-center">
          <p className="eyebrow text-accent">Homebase</p>
          <h1 className="mt-4 font-serif text-display">Pair a device to continue</h1>
          <p className="mt-4 text-row text-muted">
            Run <code>homebase pair</code> on your computer, then scan the QR code with this device.
          </p>
        </div>
      )}
    </div>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: ProjectsScreen });
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: "/p/$projectId", component: ProjectScreen });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: "/s/$sessionId", component: ChatScreen });
const devUiRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dev/ui", component: DevUI });
const pairRoute = createRoute({ getParentRoute: () => rootRoute, path: "/pair", component: PairScreen });
const devicesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/devices", component: DevicesScreen });

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, chatRoute, devUiRoute, pairRoute, devicesRoute]);

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
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
