import path from "node:path";
import { z } from "zod";
import { timestampSchema } from "@homebase/protocol";
import type { AdapterLogger } from "@homebase/adapter-sdk";
import { atomicWriteJson, isMissingFileError, readJsonObjectFile } from "../config/index.js";

const schema = z.object({
  version: z.literal(1),
  projects: z.record(z.string().regex(/^prj_[a-f0-9]{12}$/), timestampSchema),
});

/** Lightweight navigation recency. Contains no paths, messages or file contents. */
export class ProjectActivity {
  readonly #values = new Map<string, string>();
  #pending: Promise<void> = Promise.resolve();
  #saving = false;
  #dirty = false;
  private constructor(
    readonly file: string,
    readonly logger?: AdapterLogger,
  ) {}
  static async open(stateDir: string, logger?: AdapterLogger): Promise<ProjectActivity> {
    const store = new ProjectActivity(path.join(stateDir, "project-activity.json"), logger);
    try {
      const data = schema.parse(await readJsonObjectFile(store.file));
      for (const [id, time] of Object.entries(data.projects)) store.#values.set(id, new Date(time).toISOString());
    } catch (error) {
      if (!isMissingFileError(error))
        logger?.warn("Project activity metadata is unavailable; recency will rebuild from sessions.");
    }
    return store;
  }
  get(projectId: string): string | null {
    return this.#values.get(projectId) ?? null;
  }
  advance(projectId: string, time: string): void {
    if (!/^prj_[a-f0-9]{12}$/.test(projectId) || !timestampSchema.safeParse(time).success) return;
    const normalized = new Date(time).toISOString();
    if ((this.#values.get(projectId) ?? "") >= normalized) return;
    this.#values.set(projectId, normalized);
    this.#dirty = true;
    if (!this.#saving) this.#pending = this.#save();
  }
  async #save(): Promise<void> {
    this.#saving = true;
    try {
      // Coalesce bursts of session history into the latest private snapshot.
      // Serialized writes prevent an older snapshot replacing newer activity.
      while (this.#dirty) {
        this.#dirty = false;
        await atomicWriteJson(this.file, { version: 1, projects: Object.fromEntries(this.#values) });
      }
    } catch {
      this.logger?.warn("Project activity could not be saved.");
    } finally {
      this.#saving = false;
    }
  }
  async flush(): Promise<void> {
    await this.#pending;
  }
}
