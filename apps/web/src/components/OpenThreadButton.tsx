import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

/** Opens a sub-agent's own thread. One 44px target, kept separate from a row's expand toggle. */
export function OpenThreadButton({
  sessionId,
  title,
  onOpen,
}: {
  sessionId: string;
  title: string;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      aria-label={`Open sub-agent thread: ${title}`}
      title="Open thread"
      data-open-thread
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
        void navigate({ to: "/s/$sessionId", params: { sessionId } });
      }}
      className="mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-accent transition-colors active:bg-fill"
    >
      <ArrowUpRight size={19} strokeWidth={2.25} aria-hidden />
    </button>
  );
}
