import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api, ApiError } from "../lib/api.js";
import { capturePairFragment, takeInvitation } from "../lib/auth.js";
import { TopBar, ThemeToggle } from "../components/chrome.js";

let currentInvitation = takeInvitation();
export function PairScreen() {
  if (!currentInvitation) {
    capturePairFragment();
    currentInvitation = takeInvitation();
  }
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [state, setState] = useState<"ready" | "pairing" | "success" | "invalid" | "expired" | "used" | "unreachable">(
    currentInvitation ? "ready" : "invalid",
  );
  async function pair(event: React.FormEvent) {
    event.preventDefault();
    if (!currentInvitation) return;
    setState("pairing");
    try {
      await api.redeemPair(currentInvitation, name.trim());
      currentInvitation = null;
      setState("success");
      try {
        sessionStorage.setItem("hb.justPaired", "1");
      } catch {
        /* optional hint */
      }
      window.dispatchEvent(new Event("homebase:auth-changed"));
      void navigate({ to: "/" });
    } catch (error) {
      currentInvitation = null;
      setState(
        error instanceof ApiError && error.code === "pairing_expired"
          ? "expired"
          : error instanceof ApiError && error.code === "pairing_used"
            ? "used"
            : error instanceof ApiError && error.status > 0
              ? "invalid"
              : "unreachable",
      );
    }
  }
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll text-text">
      <header className="pt-safe">
        <TopBar leading={<span className="eyebrow">Homebase</span>} trailing={<ThemeToggle />} />
      </header>
      <section className="mx-auto mt-12 max-w-md px-4">
        <p className="eyebrow text-accent">Private access</p>
        <h1 className="mt-3 font-serif text-display">Pair this device</h1>
        <p className="mt-3 text-row text-muted">
          Give this device a name you will recognize later. You can remove its access at any time.
        </p>
        {state === "ready" || state === "pairing" ? (
          <form onSubmit={(event) => void pair(event)} className="mt-8 flex flex-col gap-4">
            <label className="text-callout font-semibold" htmlFor="device-name">
              Device name
            </label>
            <input
              id="device-name"
              autoComplete="off"
              maxLength={64}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="My iPhone"
              className="min-h-12 rounded-xl border border-border bg-surface px-4 text-row text-text"
            />
            <button
              disabled={state === "pairing"}
              className="min-h-12 rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-60"
            >
              {state === "pairing" ? "Pairing…" : "Pair device"}
            </button>
          </form>
        ) : (
          <p role="status" className="mt-8 rounded-xl bg-surface px-4 py-5 text-row">
            {state === "success"
              ? "Paired. Opening Projects…"
              : state === "unreachable"
                ? "The Host could not be reached. Check Tailscale and try again."
                : state === "expired"
                  ? "This invitation expired. Run homebase pair again on the Host."
                  : state === "used"
                    ? "This invitation was already used. Run homebase pair again on the Host."
                    : "This pairing link is invalid. Run homebase pair on the Host."}
          </p>
        )}
      </section>
    </main>
  );
}
