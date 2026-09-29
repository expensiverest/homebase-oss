import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { HostConfig } from "../config/index.js";
import type { DeviceState, PublicDevice } from "./device-state.js";
import { deviceCredentialFromCookie } from "./device-cookie.js";

export interface AuthDecision {
  ok: boolean;
  principal?: { kind: "none" | "dev-token" } | { kind: "device"; deviceId: string };
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
  mode: "none" | "dev-token" | "device";
  devToken?: string;
  devices?: DeviceState;
  /** Failed attempts before the client key is temporarily locked out. */
  maxFailures?: number;
  lockoutMs?: number;
}

/**
 * Device-cookie authentication for normal operation, with explicit none and
 * dev-token modes for local development and API tests.
 */
export class Authenticator {
  readonly mode: "none" | "dev-token" | "device";
  readonly devices?: DeviceState;
  #invitation: { token: string; expiresAt: number } | null = null;
  #consumedInvitation: string | null = null;
  readonly #pairFailures = new Map<string, FailureRecord>();
  #globalPairWindow = { count: 0, resetAt: Date.now() + 60_000 };
  readonly #expectedDigest: Buffer | null;
  readonly #maxFailures: number;
  readonly #lockoutMs: number;
  readonly #failures = new Map<string, FailureRecord>();

  constructor(options: AuthenticatorOptions) {
    this.mode = options.mode;
    this.devices = options.devices;
    this.#expectedDigest = options.devToken ? digest(options.devToken) : null;
    this.#maxFailures = options.maxFailures ?? 10;
    this.#lockoutMs = options.lockoutMs ?? 60_000;
  }

  authenticate(authorizationHeader: string | undefined, clientKey: string, cookie?: string): AuthDecision {
    if (this.mode === "none") {
      return { ok: true, principal: { kind: "none" } };
    }

    const provided =
      this.mode === "device" ? deviceCredentialFromCookie(cookie) : extractBearerToken(authorizationHeader);
    const device = this.mode === "device" && provided ? this.devices?.verify(provided) : null;
    if (provided && (device || (this.mode === "dev-token" && this.#matches(provided)))) {
      return { ok: true, principal: device ? { kind: "device", deviceId: device.id } : { kind: "dev-token" } };
    }
    // A bad request must never lock a valid paired device out through the
    // shared loopback address used by Tailscale Serve.
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

  createInvitation(): { token: string; expiresAt: string } {
    const token = `hbpair1.${randomBytes(32).toString("base64url")}`;
    const expiresAt = Date.now() + 5 * 60_000;
    this.#invitation = { token, expiresAt };
    this.#consumedInvitation = null;
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async redeem(
    token: string,
    name: string,
    clientKey: string,
  ): Promise<
    | { status: "ok"; device: PublicDevice; credential: string }
    | { status: "invalid" | "expired" | "used" | "rate_limited"; retryAfterSeconds?: number }
  > {
    const now = Date.now();
    const invitation = this.#invitation;
    const validFormat = /^hbpair1\.[A-Za-z0-9_-]{43}$/.test(token);
    const matches =
      validFormat &&
      invitation &&
      timingSafeEqual(Buffer.from(shaToken(token), "hex"), Buffer.from(shaToken(invitation.token), "hex"));
    if (matches && invitation.expiresAt > now) {
      // Consume synchronously before the first await; concurrent redemptions have one winner.
      this.#invitation = null;
      this.#consumedInvitation = shaToken(token);
      this.#pairFailures.delete(clientKey);
      const created = await this.devices!.add(name);
      return { status: "ok", ...created };
    }
    const failure = this.#pairFailures.get(clientKey);
    if (failure && failure.blockedUntil > now)
      return { status: "rate_limited", retryAfterSeconds: Math.ceil((failure.blockedUntil - now) / 1000) };
    if (matches && invitation && invitation.expiresAt <= now) {
      this.#invitation = null;
      return this.#failedPair(clientKey, "expired");
    }
    return this.#failedPair(
      clientKey,
      validFormat && !invitation && this.#consumedInvitation === shaToken(token) ? "used" : "invalid",
    );
  }

  #failedPair(
    clientKey: string,
    status: "invalid" | "expired" | "used",
  ): { status: "invalid" | "expired" | "used" | "rate_limited"; retryAfterSeconds?: number } {
    const now = Date.now();
    if (now >= this.#globalPairWindow.resetAt) this.#globalPairWindow = { count: 0, resetAt: now + 60_000 };
    this.#globalPairWindow.count++;
    if (this.#globalPairWindow.count > 1_000) {
      return { status: "rate_limited", retryAfterSeconds: Math.ceil((this.#globalPairWindow.resetAt - now) / 1_000) };
    }
    const previous = this.#pairFailures.get(clientKey);
    const count = (previous?.count ?? 0) + 1;
    if (count >= 10) {
      this.#pairFailures.set(clientKey, { count: 0, blockedUntil: Date.now() + 60_000 });
      return { status: "rate_limited", retryAfterSeconds: 60 };
    }
    this.#pairFailures.set(clientKey, { count, blockedUntil: 0 });
    return { status };
  }

  #matches(provided: string): boolean {
    if (!this.#expectedDigest) return false;
    const providedDigest = digest(provided);
    return (
      providedDigest.length === this.#expectedDigest.length && timingSafeEqual(providedDigest, this.#expectedDigest)
    );
  }
}

function shaToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

export function createAuthenticator(config: HostConfig, devices?: DeviceState): Authenticator {
  return new Authenticator({
    mode: config.auth.mode,
    ...(devices ? { devices } : {}),
    ...(config.auth.devToken !== undefined ? { devToken: config.auth.devToken } : {}),
  });
}
