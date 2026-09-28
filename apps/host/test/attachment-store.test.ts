import { describe, expect, it } from "vitest";

import { AttachmentStore, sanitizeFilename } from "../src/attachments/index.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("sanitizeFilename", () => {
  it("strips paths, control characters, and reserved characters", () => {
    expect(sanitizeFilename("C:\\Users\\someone\\notes.txt")).toBe("notes.txt");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("bad\u0000name<>.txt")).toBe("badname__.txt");
    expect(sanitizeFilename("")).toBe("attachment");
    expect(sanitizeFilename("...")).toBe("attachment");
  });
});

describe("AttachmentStore", () => {
  it("stores text and image bytes and returns refs", () => {
    const store = new AttachmentStore();
    const text = store.add({ filename: "notes.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hello") });
    expect(store.toRef(text)).toMatchObject({ kind: "file", name: "notes.txt", mimeType: "text/plain" });

    const image = store.add({ filename: "shot.png", mimeType: "image/png", bytes: PNG });
    expect(store.toRef(image).kind).toBe("image");
    expect(store.get(image.id).bytes).toEqual(PNG);
    store.dispose();
  });

  it("rejects disallowed types, empty files, and mismatched image content", () => {
    const store = new AttachmentStore();
    expect(() => store.add({ filename: "app.exe", mimeType: "application/octet-stream", bytes: PNG })).toThrowError(
      /Unsupported/,
    );
    expect(() => store.add({ filename: "empty.txt", mimeType: "text/plain", bytes: new Uint8Array() })).toThrowError(
      /empty/,
    );
    expect(() =>
      store.add({ filename: "fake.png", mimeType: "image/png", bytes: new TextEncoder().encode("not a png") }),
    ).toThrowError(/declared PNG/);
    expect(() =>
      store.add({ filename: "nul.txt", mimeType: "text/plain", bytes: new Uint8Array([1, 0, 2]) }),
    ).toThrowError(/NUL/);
    store.dispose();
  });

  it("expires attachments after the TTL", () => {
    let now = 1_000;
    const store = new AttachmentStore({ ttlMs: 100, now: () => now });
    const attachment = store.add({ filename: "notes.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) });
    expect(store.has(attachment.id)).toBe(true);
    now += 101;
    expect(store.has(attachment.id)).toBe(false);
    expect(() => store.get(attachment.id)).toThrowError(/expired|unknown/);
    store.dispose();
  });

  it("evicts least-recently-used attachments beyond the total cap", () => {
    let now = 1_000;
    const store = new AttachmentStore({ maxTotalBytes: 10, now: () => now });
    const first = store.add({ filename: "a.txt", mimeType: "text/plain", bytes: new Uint8Array([1, 2, 3, 4]) });
    now += 1;
    const second = store.add({ filename: "b.txt", mimeType: "text/plain", bytes: new Uint8Array([1, 2, 3, 4]) });
    now += 1;
    // Touch `first` so `second` becomes the LRU entry.
    store.get(first.id);
    now += 1;
    const third = store.add({ filename: "c.txt", mimeType: "text/plain", bytes: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(store.has(first.id)).toBe(true);
    expect(store.has(second.id)).toBe(false);
    expect(store.has(third.id)).toBe(true);
    store.dispose();
  });
});
