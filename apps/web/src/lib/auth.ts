import { getTransport } from "./transport.js";

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  current?: boolean;
}
export interface AuthStatus {
  mode: "none" | "dev-token" | "device";
  authenticated: boolean;
  device?: Device;
}
let invitation: string | null = null;

// Runs at boot, before the React tree or a private request is started.
export function capturePairFragment(): void {
  if (location.pathname !== "/pair" || !location.hash) return;
  try {
    invitation = decodeURIComponent(location.hash.slice(1));
  } catch {
    invitation = null;
  }
  history.replaceState(history.state, "", location.pathname + location.search);
}
export function takeInvitation(): string | null {
  const value = invitation;
  invitation = null;
  return value;
}
export function authLost(): void {
  window.dispatchEvent(new Event("homebase:auth-lost"));
}
export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await getTransport().fetch("/api/v1/auth/status", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Host unreachable");
  return response.json() as Promise<AuthStatus>;
}
