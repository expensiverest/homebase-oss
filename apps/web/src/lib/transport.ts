/**
 * Single credential/transport injection point.
 *
 * REST and SSE both go through here so Phase 5 pairing can add device
 * credentials once, and mock mode can replace the transport without touching
 * components.
 */
export interface Transport {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

const browserTransport: Transport = {
  fetch: async (input, init) => {
    const response = await globalThis.fetch(input, { credentials: "same-origin", ...init });
    if (response.status === 401 && !input.endsWith("/api/v1/auth/status")) {
      window.dispatchEvent(new Event("homebase:auth-lost"));
    }
    return response;
  },
};

let transport: Transport = browserTransport;
let bearerToken: string | null = null;

export function setTransport(next: Transport | null): void {
  transport = next ?? browserTransport;
}

export function getTransport(): Transport {
  return transport;
}

/** Bearer token remains for explicit dev-token testing only. */
export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

export function authHeaders(): Record<string, string> {
  return bearerToken ? { authorization: `Bearer ${bearerToken}` } : {};
}

export function hasCredentials(): boolean {
  return bearerToken !== null;
}
