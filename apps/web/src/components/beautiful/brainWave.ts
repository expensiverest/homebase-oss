import type { Variants } from "motion/react";

/*
 * Wave data for the animated Brain (see AnimatedBrain.tsx). Adapted from
 * Lucide-React-Motion's `brain` signature and `brain-fold-ripple` motion (MIT,
 * © 2026 Aadil Alli; see THIRD_PARTY_NOTICES.md). Kept apart from the component
 * so it is plain data and easy to test.
 *
 * A thought propagates, it does not pulse: each path dips and recovers a beat
 * after its neighbour, entering at the lower-left lobe and leaving through the
 * lower-right. The interior fissures carry the wave hardest (opacity 0.35 plus
 * a 1.5% contraction); the enclosing hemisphere arcs only get a shallow 0.72
 * brush and never scale, so the outline holds its silhouette.
 */

export type Role = "fold" | "outline";

/** Lucide `brain` geometry (ISC), each path with the wave's arrival phase (fraction of a cycle). */
export const BRAIN_PATHS: ReadonlyArray<{ d: string; phase: number; role: Role }> = [
  { d: "M12 18V5", phase: 0.3, role: "fold" },
  { d: "M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4", phase: 0.4, role: "fold" },
  { d: "M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5", phase: 0.2, role: "outline" },
  { d: "M17.997 5.125a4 4 0 0 1 2.526 5.77", phase: 0.5, role: "outline" },
  { d: "M18 18a4 4 0 0 0 2-7.464", phase: 0.6, role: "outline" },
  { d: "M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517", phase: 0.05, role: "outline" },
  { d: "M6 18a4 4 0 0 1-2-7.464", phase: 0, role: "outline" },
  { d: "M6.003 5.125a4 4 0 0 0-2.526 5.77", phase: 0.1, role: "outline" },
];

/** Small lead-in so the first `times` entry never duplicates 0. */
export const WAVE_LEAD = 0.04;
/** How long the activity front takes to cross one fold, as a fraction of the cycle. */
export const WAVE_WIDTH = 0.12;
/**
 * Upstream runs the wave over 1.2s, which reads as a flicker on a phone at 17px.
 * Homebase slows it to a calm 2.4s; the wave shape and timing fractions are unchanged.
 */
export const CYCLE_SECONDS = 2.4;

/** Opacity and scale both start and end at rest. */
export function foldVariants(phase: number, role: Role): Variants {
  const enter = WAVE_LEAD + phase;
  const peak = enter + WAVE_WIDTH;
  const exit = peak + WAVE_WIDTH;
  const fold = role === "fold";
  return {
    rest: { opacity: 1, scale: 1 },
    active: {
      opacity: [1, 1, fold ? 0.35 : 0.72, 1, 1],
      scale: fold ? [1, 1, 0.985, 1, 1] : [1, 1, 1, 1, 1],
      transition: {
        duration: CYCLE_SECONDS,
        repeat: Infinity,
        ease: "easeInOut",
        times: [0, enter, peak, exit, 1],
      },
    },
  };
}
