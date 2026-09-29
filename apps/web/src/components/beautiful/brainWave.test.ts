import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Brain } from "lucide-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BRAIN_PATHS, CYCLE_SECONDS, foldVariants, WAVE_LEAD, WAVE_WIDTH } from "./brainWave.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

type Active = {
  opacity: number[];
  scale: number[];
  transition: { duration: number; repeat: number; ease: string; times: number[] };
};
const active = (phase: number, role: "fold" | "outline") => foldVariants(phase, role).active as Active;

describe("animated Brain wave", () => {
  it("animates exactly the eight paths of Lucide's static Brain", () => {
    const markup = renderToStaticMarkup(createElement(Brain));
    const lucidePaths = [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]);
    expect(lucidePaths).toHaveLength(8);
    expect(BRAIN_PATHS.map((path) => path.d).sort()).toEqual([...lucidePaths].sort());
  });

  it("is a travelling wave: every path arrives at a distinct time, entering lower-left and leaving lower-right", () => {
    const phases = BRAIN_PATHS.map((path) => path.phase);
    expect(new Set(phases).size).toBe(phases.length);
    const byPhase = [...BRAIN_PATHS].sort((a, b) => a.phase - b.phase);
    expect(byPhase[0]?.d).toBe("M6 18a4 4 0 0 1-2-7.464");
    expect(byPhase.at(-1)?.d).toBe("M18 18a4 4 0 0 0 2-7.464");
  });

  it("loops forever over a calm 2.4s ease-in-out cycle", () => {
    for (const { phase, role } of BRAIN_PATHS) {
      const { transition } = active(phase, role);
      expect(transition.duration).toBe(2.4);
      expect(transition.repeat).toBe(Infinity);
      expect(transition.ease).toBe("easeInOut");
    }
    expect(CYCLE_SECONDS).toBe(2.4);
  });

  it("dips deep on the folds and only brushes the outline, which never scales", () => {
    const fold = active(0.3, "fold");
    expect(Math.min(...fold.opacity)).toBe(0.35);
    expect(Math.min(...fold.scale)).toBe(0.985);
    const outline = active(0.2, "outline");
    expect(Math.min(...outline.opacity)).toBe(0.72);
    expect(new Set(outline.scale)).toEqual(new Set([1]));
  });

  it("starts and ends every cycle at rest with strictly increasing keyframe times", () => {
    for (const { phase, role } of BRAIN_PATHS) {
      const { opacity, scale, transition } = active(phase, role);
      expect([opacity[0], opacity.at(-1), scale[0], scale.at(-1)]).toEqual([1, 1, 1, 1]);
      const { times } = transition;
      expect(times).toHaveLength(opacity.length);
      expect(times[0]).toBe(0);
      expect(times.at(-1)).toBe(1);
      expect(times[1]).toBeCloseTo(WAVE_LEAD + phase);
      expect(times[3]! - times[1]!).toBeCloseTo(2 * WAVE_WIDTH);
      for (let index = 1; index < times.length; index += 1) expect(times[index]).toBeGreaterThan(times[index - 1]!);
    }
  });

  it("rests at full opacity and scale", () => {
    expect(foldVariants(0, "outline").rest).toEqual({ opacity: 1, scale: 1 });
  });
});

describe("lucide-react-motion is not a dependency", () => {
  it("is absent from package.json, the lockfile and the web source", () => {
    const manifest = readFileSync(here("../../../package.json"), "utf8");
    const lock = readFileSync(here("../../../../../package-lock.json"), "utf8");
    expect(manifest).not.toContain("lucide-react-motion");
    expect(lock).not.toContain("lucide-react-motion");
    expect(JSON.parse(manifest).dependencies.motion).toBeTruthy();

    const needle = ["lucide", "react", "motion"].join("-");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : /\.(tsx?|css)$/.test(name) ? [full] : [];
      });
    const offenders = walk(here("../..")).filter((file) => {
      // Attribution comments may name the upstream project; imports must not.
      const source = readFileSync(file, "utf8");
      return new RegExp(`from\\s+["']${needle}["']|import\\(\\s*["']${needle}`).test(source);
    });
    expect(offenders).toEqual([]);
  });
});
