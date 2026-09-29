import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif";
import "./styles/index.css";
import { capturePairFragment } from "./lib/auth.js";

capturePairFragment();

/**
 * Entry point.
 *
 * Mock mode is loaded dynamically and only in development or when VITE_MOCK=1,
 * so scenario fixtures never ship in the production bundle. A scenario is
 * selected with `?mock=<name>` (remembered in sessionStorage for SPA
 * navigation).
 */
async function boot(): Promise<void> {
  const wantsMock = import.meta.env.DEV || import.meta.env.VITE_MOCK === "1";
  if (wantsMock) {
    const mock = await import("./mock/index.js");
    const scenario = mock.readScenario();
    if (scenario) mock.installMock(scenario);
  }
  const app = await import("./app.js");
  app.start();
}

void boot();
