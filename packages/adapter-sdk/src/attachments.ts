/**
 * Host-owned attachment content handed to adapters through
 * `AdapterContext.resolveAttachment`.
 *
 * Adapters receive bytes for a specific uploaded attachment id; they never
 * receive filesystem paths or arbitrary file access. The Host owns upload,
 * validation, storage, expiry, and serving.
 */
export interface ResolvedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}
