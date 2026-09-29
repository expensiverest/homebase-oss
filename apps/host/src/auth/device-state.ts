import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const deviceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(64),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime().nullable(),
    revokedAt: z.string().datetime().nullable(),
  })
  .strict();
const stateSchema = z.object({ version: z.literal(1), devices: z.array(deviceSchema) }).strict();
export type DeviceRecord = z.infer<typeof deviceSchema>;
export type PublicDevice = Omit<DeviceRecord, "digest">;

export const DEVICE_COOKIE = "__Host-homebase-device";
const credentialPattern = /^hbdev1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const privateName = (record: DeviceRecord): PublicDevice => ({
  id: record.id,
  name: record.name,
  createdAt: record.createdAt,
  lastSeenAt: record.lastSeenAt,
  revokedAt: record.revokedAt,
});

export class DeviceState {
  readonly directory: string;
  readonly adminKey: string;
  #devices: DeviceRecord[];
  #pending: Promise<void> = Promise.resolve();
  #revocation = new Set<(id: string) => void>();
  #lastPersistedSeen = new Map<string, number>();

  private constructor(directory: string, adminKey: string, devices: DeviceRecord[]) {
    this.directory = directory;
    this.adminKey = adminKey;
    this.#devices = devices;
  }

  static async open(
    directory = process.env.HOMEBASE_STATE_DIR ?? path.join(os.homedir(), ".homebase"),
  ): Promise<DeviceState> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    const statePath = path.join(directory, "security.json");
    let devices: DeviceRecord[] = [];
    try {
      const raw = await readFile(statePath, "utf8");
      const parsed = stateSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new Error("invalid schema");
      devices = parsed.data.devices;
      if (process.platform !== "win32") await chmod(statePath, 0o600);
    } catch (error) {
      if (!isMissing(error))
        throw new Error("Homebase security state is corrupt or has an unsupported version. Refusing startup.");
    }
    const keyPath = path.join(directory, "admin-key");
    let adminKey: string;
    try {
      adminKey = (await readFile(keyPath, "utf8")).trim();
    } catch (error) {
      if (!isMissing(error)) throw new Error("Homebase local admin key cannot be read. Refusing startup.");
      const generated = randomBytes(32).toString("base64url");
      try {
        const file = await open(keyPath, "wx", 0o600);
        try {
          await file.writeFile(generated);
          await file.sync();
        } finally {
          await file.close();
        }
      } catch (writeError) {
        if (!isExists(writeError)) throw writeError;
      }
      adminKey = (await readFile(keyPath, "utf8")).trim();
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(adminKey))
      throw new Error("Homebase local admin key is invalid. Refusing startup.");
    if (process.platform !== "win32") await chmod(keyPath, 0o600);
    const store = new DeviceState(directory, adminKey, devices);
    if (devices.length === 0) {
      try {
        await readFile(statePath);
      } catch (error) {
        if (isMissing(error)) await store.#write();
        else throw error;
      }
    }
    return store;
  }

  list(): PublicDevice[] {
    return this.#devices.map(privateName);
  }
  get(id: string): PublicDevice | null {
    const item = this.#devices.find((device) => device.id === id);
    return item ? privateName(item) : null;
  }
  verify(credential: string): PublicDevice | null {
    const match = credentialPattern.exec(credential);
    if (!match) return null;
    const record = this.#devices.find((device) => device.id === match[1]);
    if (!record || record.revokedAt) return null;
    const actual = Buffer.from(sha(credential), "hex");
    const expected = Buffer.from(record.digest, "hex");
    if (!timingSafeEqual(actual, expected)) return null;
    record.lastSeenAt = new Date().toISOString();
    const now = Date.now();
    if (now - (this.#lastPersistedSeen.get(record.id) ?? 0) > 60_000) {
      this.#lastPersistedSeen.set(record.id, now);
      void this.#enqueue(async () => this.#write());
    }
    return privateName(record);
  }
  async add(name: string): Promise<{ device: PublicDevice; credential: string }> {
    const id = crypto.randomUUID();
    const credential = `hbdev1.${id}.${randomBytes(32).toString("base64url")}`;
    const record: DeviceRecord = {
      id,
      name,
      digest: sha(credential),
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      revokedAt: null,
    };
    await this.#enqueue(async () => {
      this.#devices.push(record);
      await this.#write();
    });
    return { device: privateName(record), credential };
  }
  async rename(id: string, name: string): Promise<PublicDevice | null> {
    return this.#enqueue(async () => {
      const record = this.#devices.find((item) => item.id === id && !item.revokedAt);
      if (!record) return null;
      record.name = name;
      await this.#write();
      return privateName(record);
    });
  }
  async revoke(id: string): Promise<PublicDevice | null> {
    return this.#enqueue(async () => {
      const record = this.#devices.find((item) => item.id === id && !item.revokedAt);
      if (!record) return null;
      record.revokedAt = new Date().toISOString();
      await this.#write();
      for (const listener of this.#revocation) listener(id);
      return privateName(record);
    });
  }
  onRevoke(listener: (id: string) => void): () => void {
    this.#revocation.add(listener);
    return () => this.#revocation.delete(listener);
  }
  checkAdmin(value: string | undefined): boolean {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
    return timingSafeEqual(Buffer.from(value), Buffer.from(this.adminKey));
  }
  #enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(action);
    this.#pending = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  async #write(): Promise<void> {
    const target = path.join(this.directory, "security.json");
    const temp = path.join(this.directory, `.security-${crypto.randomUUID()}.tmp`);
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, devices: this.#devices }, null, 2));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true });
    }
  }
}
function isMissing(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
function isExists(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}
