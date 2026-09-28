import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";

import { BRAIN_PATHS, foldVariants } from "./brainWave.js";

/*
 * The Thinking indicator's animated Brain, in its own module so Motion loads
 * only while reasoning actually streams. Adapted from Lucide-React-Motion's
 * `brain` signature (MIT, © 2026 Aadil Alli; see THIRD_PARTY_NOTICES.md): the
 * wave itself lives in brainWave.ts. Only this one icon is needed, so it is a
 * plain component rather than the library's icon framework.
 */

const PATH_VARIANTS = BRAIN_PATHS.map(({ phase, role }) => foldVariants(phase, role));

// Contraction pivots about the icon centre, as upstream does for every path.
const PATH_STYLE = { transformOrigin: "12px 12px", transformBox: "view-box" } as const;

export default function AnimatedBrain({ size }: { size: number }) {
  // Under prefers-reduced-motion the Brain never leaves `rest`: no loop at all.
  const reduced = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <m.svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        initial="rest"
        animate={reduced ? "rest" : "active"}
        data-motion-state={reduced ? "resting" : "looping"}
      >
        {BRAIN_PATHS.map(({ d }, i) => (
          <m.path key={d} d={d} variants={PATH_VARIANTS[i]} style={PATH_STYLE} />
        ))}
      </m.svg>
    </LazyMotion>
  );
}
