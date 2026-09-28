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
  fetch: (input, init) => globalThis.fetch(input, init),
};

let transport: Transport = browserTransport;
let bearerToken: string | null = null;

export function setTransport(next: Transport | null): void {
  transport = next ?? browserTransport;
}

export function getTransport(): Transport {
  return transport;
}

/** Phase 5 pairing will supply the device credential here. */
export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

export function authHeaders(): Record<string, string> {
  return bearerToken ? { authorization: `Bearer ${bearerToken}` } : {};
}

export function hasCredentials(): boolean {
  return bearerToken !== null;
}
