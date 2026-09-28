import { PROVIDER_ID_PATTERN, type ProviderId } from "@homebase/protocol";

import { AdapterError } from "./errors.js";

/**
 * Provider-scoped public identifiers.
 *
 * Provider-native session/request ids are only unique inside a provider. Once a
 * Host serves more than one provider, every id that is routed globally —
 * sessions (`/api/v1/sessions/:sessionId`), approvals, and questions — must
 * carry trusted provider scope. The encoding below is:
 *
 *     hb1~<providerId>~<base64url(nativeId)>
 *
 * - versioned (`hb1`) so the scheme can evolve;
 * - URL-path safe (only unreserved RFC 3986 characters);
 * - opaque to clients (they must round-trip, never parse);
 * - reversible only by trusted Host/adapter code;
 * - validated strictly on decode (shape, provider slug, canonical base64url,
 *   and length bounds) so malformed or wrong-provider ids fail closed.
 *
 * Providers never expose native ids, native id shapes, paths, or credentials
 * through this encoding.
 */
export const PUBLIC_ID_PREFIX = "hb1";
const PUBLIC_ID_SEPARATOR = "~";
const MAX_PUBLIC_ID_LENGTH = 200;
const MAX_NATIVE_ID_BYTES = 96;

export interface ParsedPublicId {
  providerId: ProviderId;
  nativeId: string;
}

/** Wraps a provider-native id into a Homebase public id. */
export function createPublicId(providerId: ProviderId, nativeId: string): string {
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new AdapterError("internal", `Invalid provider id "${providerId}" for a public id.`);
  }
  const trimmed = nativeId.trim();
  if (trimmed.length === 0) {
    throw new AdapterError("internal", "Native id must not be empty.");
  }
  const byteLength = Buffer.byteLength(trimmed, "utf8");
  if (byteLength > MAX_NATIVE_ID_BYTES) {
    throw new AdapterError("internal", `Native id is too long (${byteLength} bytes) for a public id.`);
  }
  const encoded = Buffer.from(trimmed, "utf8").toString("base64url");
  const id = `${PUBLIC_ID_PREFIX}${PUBLIC_ID_SEPARATOR}${providerId}${PUBLIC_ID_SEPARATOR}${encoded}`;
  if (id.length > MAX_PUBLIC_ID_LENGTH) {
    throw new AdapterError("internal", "Encoded public id exceeds the protocol length limit.");
  }
  return id;
}

/** Parses a public id; returns null for anything malformed or non-canonical. */
export function parsePublicId(value: string): ParsedPublicId | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PUBLIC_ID_LENGTH) return null;
  const parts = value.split(PUBLIC_ID_SEPARATOR);
  if (parts.length !== 3) return null;
  const [prefix, providerId, encoded] = parts;
  if (prefix !== PUBLIC_ID_PREFIX || !providerId || !encoded) return null;
  if (!PROVIDER_ID_PATTERN.test(providerId)) return null;

  let nativeId: string;
  try {
    nativeId = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (nativeId.length === 0) return null;
  // Re-encode to reject non-canonical/unpadded variants and binary garbage.
  if (Buffer.from(nativeId, "utf8").toString("base64url") !== encoded) return null;
  if (Buffer.byteLength(nativeId, "utf8") > MAX_NATIVE_ID_BYTES) return null;
  return { providerId, nativeId };
}

/** True when the id is a well-formed public id scoped to `providerId`. */
export function isPublicIdFor(value: string, providerId: ProviderId): boolean {
  const parsed = parsePublicId(value);
  return parsed !== null && parsed.providerId === providerId;
}

/**
 * Decodes a public id for a specific provider. Returns the native id, or null
 * when the id is malformed or scoped to a different provider (fail closed).
 */
export function decodePublicIdFor(value: string, providerId: ProviderId): string | null {
  const parsed = parsePublicId(value);
  if (!parsed || parsed.providerId !== providerId) return null;
  return parsed.nativeId;
}
