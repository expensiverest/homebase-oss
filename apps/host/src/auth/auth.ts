import { createHash, timingSafeEqual } from "node:crypto";

import type { HostConfig } from "../config/index.js";

export interface AuthDecision {
  ok: boolean;
  status?: 401 | 429;
  code?: "invalid_request" | "rate_limited";
  message?: string;
  retryAfterSeconds?: number;
}

interface FailureRecord {
  count: number;
  blockedUntil: number;
}

export interface AuthenticatorOptions {
  mode: "none" | "dev-token";
  devToken?: string;
  /** Failed attempts before the client key is temporarily locked out. */
  maxFailures?: number;
  lockoutMs?: number;
}

/**
 * Phase 1 authentication: a local development token. Pairing and per-device
 * credentials replace this in Phase 5, but the shape of the check — constant
 * time comparison, failure throttling, and no secrets in query strings — is
 * already the shape the product needs.
 */
export class Authenticator {
  readonly mode: "none" | "dev-token";
  readonly #expectedDigest: Buffer | null;
  readonly #maxFailures: number;
  readonly #lockoutMs: number;
  readonly #failures = new Map<string, FailureRecord>();

  constructor(options: AuthenticatorOptions) {
    this.mode = options.mode;
    this.#expectedDigest = options.devToken ? digest(options.devToken) : null;
    this.#maxFailures = options.maxFailures ?? 10;
    this.#lockoutMs = options.lockoutMs ?? 60_000;
  }

  authenticate(authorizationHeader: string | undefined, clientKey: string): AuthDecision {
    if (this.mode === "none") {
      return { ok: true };
    }

    const now = Date.now();
    const record = this.#failures.get(clientKey);
    if (record && record.blockedUntil > now) {
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: "Too many failed authentication attempts. Try again later.",
        retryAfterSeconds: Math.ceil((record.blockedUntil - now) / 1_000),
      };
    }

    const provided = extractBearerToken(authorizationHeader);
    if (provided && this.#matches(provided)) {
      this.#failures.delete(clientKey);
      return { ok: true };
    }

    const count = (record?.count ?? 0) + 1;
    if (count >= this.#maxFailures) {
      this.#failures.set(clientKey, { count: 0, blockedUntil: now + this.#lockoutMs });
      return {
        ok: false,
        status: 429,
        code: "rate_limited",
        message: "Too many failed authentication attempts. Try again later.",
        retryAfterSeconds: Math.ceil(this.#lockoutMs / 1_000),
      };
    }
    this.#failures.set(clientKey, { count, blockedUntil: 0 });
    return { ok: false, status: 401, code: "invalid_request", message: "Missing or invalid credentials." };
  }

  #matches(provided: string): boolean {
    if (!this.#expectedDigest) return false;
    const providedDigest = digest(provided);
    return (
      providedDigest.length === this.#expectedDigest.length && timingSafeEqual(providedDigest, this.#expectedDigest)
    );
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export function createAuthenticator(config: HostConfig): Authenticator {
  return new Authenticator({
    mode: config.auth.mode,
    ...(config.auth.devToken !== undefined ? { devToken: config.auth.devToken } : {}),
  });
}
