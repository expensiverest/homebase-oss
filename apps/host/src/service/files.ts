import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
export async function writeServiceFile(
  target: string,
  contents: string,
  encoding: BufferEncoding = "utf8",
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(contents, encoding);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
}
