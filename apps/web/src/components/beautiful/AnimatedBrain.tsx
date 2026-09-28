import { Brain } from "lucide-react-motion";

/**
 * The Thinking indicator's animated Brain (lucide-react-motion, MIT), in its
 * own module so it can be code-split: the library evaluates every icon's
 * animation at import time, so it is loaded only when reasoning actually
 * streams. `trigger="mount"` + `repeat={Infinity}` is the library's spinner
 * timing; the library honors prefers-reduced-motion (the icon rests).
 */
export default function AnimatedBrain({ size }: { size: number }) {
  return <Brain trigger="mount" repeat={Infinity} mode="signature" size={size} strokeWidth={2} aria-hidden />;
}
