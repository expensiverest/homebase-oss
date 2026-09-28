import { randomUUID } from "node:crypto";

import { AdapterError } from "@homebase/adapter-sdk";
import type { ResolvedAttachment } from "@homebase/adapter-sdk";
import type { AgentAttachmentRef } from "@homebase/protocol";

/** Bounds copied from the lessons of the private implementation, kept intentionally small. */
export const ATTACHMENT_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const ATTACHMENT_MAX_FILES_PER_UPLOAD = 10;
export const ATTACHMENT_TTL_MS = 6 * 60 * 60 * 1000;

/** Initial allowlist: plain text and safe raster images. No archives, no SVG. */
export const ATTACHMENT_ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/markdown",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export interface StoredAttachment extends ResolvedAttachment {
  readonly kind: "image" | "file";
  readonly createdAt: number;
  lastAccessedAt: number;
}

export interface AttachmentStoreOptions {
  maxTotalBytes?: number;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Host-owned, in-memory attachment store.
 *
 * Bytes never touch disk, are never addressed by path, and expire after a TTL
 * or when the total cap forces LRU eviction. The browser uploads bytes and
 * receives ids; adapters resolve ids through `AdapterContext.resolveAttachment`.
 */
export class AttachmentStore {
  readonly #items = new Map<string, StoredAttachment>();
  readonly #maxTotalBytes: number;
  readonly #ttlMs: number;
  readonly #now: () => number;
  #totalBytes = 0;
  #sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: AttachmentStoreOptions = {}) {
    this.#maxTotalBytes = options.maxTotalBytes ?? ATTACHMENT_MAX_TOTAL_BYTES;
    this.#ttlMs = options.ttlMs ?? ATTACHMENT_TTL_MS;
    this.#now = options.now ?? Date.now;
    // Periodic cleanup keeps expired bytes from lingering in memory.
    this.#sweepTimer = setInterval(() => this.sweep(), Math.min(this.#ttlMs, 10 * 60 * 1000));
    this.#sweepTimer.unref?.();
  }

  get count(): number {
    return this.#items.size;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  add(input: { filename: string; mimeType: string; bytes: Uint8Array }): StoredAttachment {
    this.sweep();

    const mimeType = input.mimeType.trim().toLowerCase();
    if (!ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new AdapterError("invalid_attachment", `Unsupported attachment type "${mimeType}".`);
    }
    if (input.bytes.byteLength === 0) {
      throw new AdapterError("invalid_attachment", "Attachment is empty.");
    }
    if (input.bytes.byteLength > ATTACHMENT_MAX_FILE_BYTES) {
      throw new AdapterError("invalid_attachment", "Attachment exceeds the per-file size limit.");
    }
    assertContentMatchesMimeType(mimeType, input.bytes);

    const id = `att_${randomUUID()}`;
    const timestamp = this.#now();
    const attachment: StoredAttachment = {
      id,
      filename: sanitizeFilename(input.filename),
      mimeType,
      size: input.bytes.byteLength,
      bytes: input.bytes,
      kind: mimeType.startsWith("image/") ? "image" : "file",
      createdAt: timestamp,
      lastAccessedAt: timestamp,
    };

    this.#items.set(id, attachment);
    this.#totalBytes += attachment.size;
    this.#evictToFit();
    return attachment;
  }

  /** Returns the stored attachment or throws `invalid_attachment`. */
  get(attachmentId: string): StoredAttachment {
    const attachment = this.#items.get(attachmentId);
    if (!attachment || this.#now() - attachment.lastAccessedAt > this.#ttlMs) {
      if (attachment) {
        this.#items.delete(attachmentId);
        this.#totalBytes -= attachment.size;
      }
      throw new AdapterError("invalid_attachment", "The attachment is unknown or has expired.");
    }
    attachment.lastAccessedAt = this.#now();
    return attachment;
  }

  has(attachmentId: string): boolean {
    try {
      this.get(attachmentId);
      return true;
    } catch {
      return false;
    }
  }

  toRef(attachment: StoredAttachment): AgentAttachmentRef {
    return {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.size,
    };
  }

  sweep(): void {
    const cutoff = this.#now() - this.#ttlMs;
    for (const [id, attachment] of this.#items) {
      if (attachment.lastAccessedAt <= cutoff) {
        this.#items.delete(id);
        this.#totalBytes -= attachment.size;
      }
    }
  }

  #evictToFit(): void {
    while (this.#totalBytes > this.#maxTotalBytes && this.#items.size > 0) {
      let oldest: StoredAttachment | null = null;
      for (const attachment of this.#items.values()) {
        if (!oldest || attachment.lastAccessedAt < oldest.lastAccessedAt) {
          oldest = attachment;
        }
      }
      if (!oldest) break;
      this.#items.delete(oldest.id);
      this.#totalBytes -= oldest.size;
    }
  }

  dispose(): void {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
    this.#items.clear();
    this.#totalBytes = 0;
  }
}

/** Strips path separators and control characters; never trust the client's name. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : "attachment";
}

/** Cheap magic-byte check so a declared image cannot smuggle arbitrary bytes. */
function assertContentMatchesMimeType(mimeType: string, bytes: Uint8Array): void {
  const startsWith = (signature: number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (mimeType === "image/png" && !startsWith([0x89, 0x50, 0x4e, 0x47])) {
    throw new AdapterError("invalid_attachment", "File content does not match the declared PNG type.");
  }
  if (mimeType === "image/jpeg" && !startsWith([0xff, 0xd8, 0xff])) {
    throw new AdapterError("invalid_attachment", "File content does not match the declared JPEG type.");
  }
  if (mimeType === "image/gif") {
    const ascii = String.fromCharCode(...bytes.slice(0, 6));
    if (ascii !== "GIF87a" && ascii !== "GIF89a") {
      throw new AdapterError("invalid_attachment", "File content does not match the declared GIF type.");
    }
  }
  if (mimeType === "image/webp") {
    const riff = String.fromCharCode(...bytes.slice(0, 4));
    const webp = String.fromCharCode(...bytes.slice(8, 12));
    if (riff !== "RIFF" || webp !== "WEBP") {
      throw new AdapterError("invalid_attachment", "File content does not match the declared WebP type.");
    }
  }
  if (mimeType.startsWith("text/") && bytes.includes(0)) {
    throw new AdapterError("invalid_attachment", "Text attachments must not contain NUL bytes.");
  }
}
