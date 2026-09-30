import { describe, expect, it } from "vitest";
import { ClaudeProcessController } from "../src/process/controller.js";

describe("owned Claude shutdown", () => {
  it("awaits an owned no-model child exiting and remains idempotent", async () => {
    let exited = false;
    const controller = new ClaudeProcessController({
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      env: {},
      handlers: {
        onFrame: () => undefined,
        onInit: () => undefined,
        onExit: () => {
          exited = true;
        },
      },
    });
    controller.start();
    expect(controller.alive).toBe(true);
    await controller.dispose();
    await controller.dispose();
    expect(controller.alive).toBe(false);
    expect(exited).toBe(true);
  });
});
