import { ArrowUp, ChevronUp, ListEnd, Square, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** What the one round button does right now. */
export type RunButtonMode = "send" | "queue" | "steer" | "stop";

export interface RunMenuItem {
  key: "steer" | "queue" | "stop";
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const MODE_LABEL: Record<RunButtonMode, string> = {
  send: "Send message",
  queue: "Queue message",
  steer: "Steer the agent now",
  stop: "Stop the run",
};

const MENU_ICON: Record<RunMenuItem["key"], ReactNode> = {
  steer: <Zap size={17} strokeWidth={2.25} className="text-accent" aria-hidden />,
  queue: <ListEnd size={17} strokeWidth={2.25} aria-hidden />,
  stop: <Square size={13} fill="currentColor" strokeWidth={0} className="mx-[2px] text-bad" aria-hidden />,
};

const LONG_PRESS_MS = 420;

function ModeIcon({ mode }: { mode: RunButtonMode }) {
  switch (mode) {
    case "stop":
      return <Square size={13} fill="currentColor" strokeWidth={0} aria-hidden />;
    case "queue":
      return <ListEnd size={19} strokeWidth={2.4} aria-hidden />;
    case "steer":
      return <Zap size={18} strokeWidth={2.4} aria-hidden />;
    default:
      return <ArrowUp size={20} strokeWidth={2.5} aria-hidden />;
  }
}

/**
 * The composer's single action button. One round control that changes with the
 * moment: Send when idle; while a run is going, Stop when the input is empty
 * and Queue (or Steer, if that is all the provider offers) once there is text.
 * The other run actions live in a small menu, opened by pressing and holding
 * the button or by the chevron beside it, so the toolbar never grows a row.
 */
export function RunButton({
  mode,
  disabled,
  onPress,
  menu,
}: {
  mode: RunButtonMode;
  disabled: boolean;
  onPress: () => void;
  /** Extra run actions; the menu affordances only exist while there are some. */
  menu: RunMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const menuId = useId();
  const hasMenu = menu.length > 0;
  const stop = mode === "stop";

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => () => clearTimer(), []);

  // The menu only makes sense while there is something in it.
  useEffect(() => {
    if (!hasMenu) setOpen(false);
  }, [hasMenu]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      chevronRef.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open)
      rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex items-center" data-run-button={mode}>
      {hasMenu ? (
        <button
          ref={chevronRef}
          type="button"
          aria-label="More run actions"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors active:bg-fill"
        >
          <ChevronUp
            size={16}
            strokeWidth={2.4}
            aria-hidden
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}

      <button
        type="button"
        aria-label={MODE_LABEL[mode]}
        title={hasMenu ? `${MODE_LABEL[mode]} (hold for more)` : MODE_LABEL[mode]}
        disabled={disabled}
        onPointerDown={(event) => {
          longPressed.current = false;
          if (!hasMenu || event.pointerType === "mouse" || disabled) return;
          clearTimer();
          timer.current = setTimeout(() => {
            timer.current = null;
            longPressed.current = true;
            setOpen(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(event) => {
          // Touch long-press would otherwise raise the browser's own menu.
          if (hasMenu) event.preventDefault();
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          setOpen(false);
          onPress();
        }}
        className={`inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full transition-[transform,background-color,color,box-shadow] duration-200 [-webkit-touch-callout:none] enabled:active:scale-[0.94] disabled:bg-fill-strong disabled:text-muted disabled:shadow-none ${
          stop ? "bg-bad-soft text-bad" : "bg-accent text-on-accent shadow-[var(--shadow-accent)]"
        }`}
      >
        <span key={mode} className="flex" style={{ animation: "bui-pop-in 200ms cubic-bezier(0.23,1,0.32,1) both" }}>
          <ModeIcon mode={mode} />
        </span>
      </button>

      {open && hasMenu ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Run actions"
          className="absolute bottom-full right-0 z-20 mb-2 min-w-[13rem] overflow-hidden rounded-[16px] border border-border bg-surface p-1 shadow-[var(--shadow-surface)]"
          style={{ animation: "bui-pop-in 160ms cubic-bezier(0.23,1,0.32,1) both" }}
        >
          {menu.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-disabled={item.disabled ? true : undefined}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-3 text-left text-callout font-medium transition-colors active:bg-fill ${
                item.disabled ? "text-faint" : item.key === "stop" ? "text-bad" : "text-text"
              }`}
            >
              {MENU_ICON[item.key]}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
