import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api.js";
import type { Device } from "../lib/auth.js";
import { BackButton, TopBar, ThemeToggle } from "../components/chrome.js";
import { Sheet, TextField } from "../components/ui.js";

export function DevicesScreen() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ kind: "rename" | "revoke"; device: Device } | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.devices().then(
      (result) => setDevices(result.devices),
      () => setError("Devices could not be loaded."),
    );
  }, []);
  async function rename() {
    const device = editing?.device;
    const name = draftName.trim();
    if (!device || !name || name === device.name) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      await api.renameDevice(device.id, name);
      setDevices((items) => items.map((item) => (item.id === device.id ? { ...item, name } : item)));
      setEditing(null);
    } catch {
      setError("Could not rename device.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    const device = editing?.device;
    if (!device) return;
    setBusy(true);
    try {
      await api.revokeDevice(device.id);
      setDevices((items) =>
        items.map((item) => (item.id === device.id ? { ...item, revokedAt: new Date().toISOString() } : item)),
      );
      setEditing(null);
      if (device.current) window.dispatchEvent(new Event("homebase:auth-lost"));
    } catch {
      setError("Could not revoke device.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-safe pb-safe-scroll text-text">
      <header className="pt-safe">
        <TopBar
          leading={<BackButton label="Projects" onClick={() => void navigate({ to: "/" })} />}
          trailing={<ThemeToggle />}
        />
      </header>
      <section className="mx-auto max-w-xl px-4">
        <p className="eyebrow text-accent">Settings</p>
        <h1 className="mt-3 font-serif text-display">Devices</h1>
        <p className="mt-3 text-row text-muted">
          Run <code>homebase pair</code> on your computer to add another device.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-bad">
            {error}
          </p>
        )}
        <ul className="mt-8 divide-y divide-border">
          {devices.map((device) => (
            <li key={device.id} className="py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-row font-semibold">
                    {device.name} {device.current && <span className="text-caption text-muted">(this device)</span>}
                  </p>
                  <p className="mt-1 text-caption text-muted">
                    Paired {new Date(device.createdAt).toLocaleDateString()} · Last seen{" "}
                    {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleDateString() : "never"}
                    {device.revokedAt ? " · Revoked" : ""}
                  </p>
                </div>
              </div>
              {!device.revokedAt && (
                <div className="mt-3 flex gap-4">
                  <button
                    className="min-h-11 text-callout text-accent"
                    onClick={() => {
                      setDraftName(device.name);
                      setEditing({ kind: "rename", device });
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="min-h-11 text-callout text-bad"
                    onClick={() => setEditing({ kind: "revoke", device })}
                  >
                    {device.current ? "Forget this device" : "Revoke"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      <Sheet
        open={editing?.kind === "rename"}
        onClose={() => setEditing(null)}
        title="Rename device"
        footer={
          <button
            disabled={busy || !draftName.trim()}
            className="min-h-12 w-full rounded-xl bg-accent px-4 font-semibold text-white disabled:opacity-50"
            onClick={() => void rename()}
          >
            Save name
          </button>
        }
      >
        <TextField
          label="Device name"
          value={draftName}
          maxLength={64}
          onChange={(event) => setDraftName(event.target.value)}
        />
      </Sheet>
      <Sheet
        open={editing?.kind === "revoke"}
        onClose={() => setEditing(null)}
        title={editing?.device.current ? "Forget this device?" : "Revoke device?"}
        footer={
          <button
            disabled={busy}
            className="min-h-12 w-full rounded-xl bg-bad px-4 font-semibold text-white disabled:opacity-50"
            onClick={() => void revoke()}
          >
            {editing?.device.current ? "Forget this device" : "Revoke access"}
          </button>
        }
      >
        <p className="text-row text-muted">
          {editing?.device.name} will lose access immediately. You can pair it again from the Host computer.
        </p>
      </Sheet>
    </main>
  );
}
