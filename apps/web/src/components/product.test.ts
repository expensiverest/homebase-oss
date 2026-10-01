import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentMode, AgentSessionUsage } from "@homebase/protocol";
import { ModeSheet } from "./Sheets.js";
import { ProviderUsageDetail, SessionUsageDetail, sessionUsageLabel } from "./Usage.js";
import { FileContent } from "../screens/FilesScreen.js";

const modes: AgentMode[] = [
  { id: "build", name: "Build" },
  { id: "plan", name: "Plan" },
];
const renderMode = (overrides = {}) =>
  renderToStaticMarkup(
    createElement(ModeSheet, {
      open: true,
      onClose: () => undefined,
      modes,
      loading: false,
      currentMode: null,
      busy: false,
      onApply: () => undefined,
      ...overrides,
    }),
  );
describe("mode catalog states", () => {
  it("shows loading and disables apply", () => {
    const html = renderMode({ loading: true });
    expect(html).toContain("Loading modes");
    expect(html).toContain('disabled=""');
  });
  it("shows a proper empty state with disabled apply", () => {
    const html = renderMode({ modes: [] });
    expect(html).toContain("No selectable modes");
    expect(html).toContain('disabled=""');
  });
  it("shows errors without empty radio rows", () => {
    const html = renderMode({ error: "Modes unavailable" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Modes unavailable");
    expect(html).toContain('disabled=""');
  });
  it("identifies current selection and permits apply", () => {
    const html = renderMode({ currentMode: "plan" });
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('disabled=""');
  });
  it("requires a valid selection, including stale native selection", () => {
    for (const currentMode of [null, "removed"]) expect(renderMode({ currentMode })).toContain('disabled=""');
  });
});
describe("usage availability", () => {
  const usage: AgentSessionUsage = {
    provider: "example",
    sessionId: "s",
    tokens: { inputTokens: 10000, outputTokens: 2400, totalTokens: 12400 },
    costUsd: 0.08,
    updatedAt: "2026-09-30T10:00:00Z",
  };
  it("keeps the session summary compact and details normalized", () => {
    expect(sessionUsageLabel(usage)).toContain("12.4k tokens");
    const html = renderToStaticMarkup(createElement(SessionUsageDetail, { usage }));
    expect(html).toContain("Reported cost");
    expect(html).not.toContain("Reasoning");
  });
  it("does not fabricate zero usage when unavailable", () => {
    expect(renderToStaticMarkup(createElement(SessionUsageDetail, { usage: null }))).toContain("isn&#x27;t available");
    expect(sessionUsageLabel({ ...usage, tokens: {}, costUsd: null })).toBe("Usage details");
  });
  it("displays quota percentage, reset and fetched age", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderUsageDetail, {
        usage: {
          provider: "example",
          windows: [{ id: "a", label: "5 hour", unit: "percent", usedPercent: 43, resetsAt: "2026-10-01T10:00:00Z" }],
          fetchedAt: usage.updatedAt,
        },
      }),
    );
    expect(html).toContain("43% used");
    expect(html).toContain("Resets");
    expect(html).toContain('aria-valuenow="43"');
  });
});
describe("project preview content isolation", () => {
  const base = {
    projectId: "p",
    relativePath: "index.html",
    name: "index.html",
    sizeBytes: 50,
    kind: "text" as const,
    mimeType: "text/plain",
  };
  it("renders HTML only as escaped source", () => {
    const html = renderToStaticMarkup(
      createElement(FileContent, { preview: { ...base, language: "html", text: "<script>alert(1)</script>" } }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("uses the existing safe Markdown renderer", () => {
    const html = renderToStaticMarkup(
      createElement(FileContent, {
        preview: {
          ...base,
          language: "markdown",
          text: "<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n![tracking](https://example.com/pixel)",
        },
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<img");
  });
  it("never embeds unsupported SVG", () => {
    const html = renderToStaticMarkup(
      createElement(FileContent, {
        preview: {
          ...base,
          name: "evil.svg",
          kind: "unsupported",
          language: null,
          text: '<svg onload="alert(1)"></svg>',
        },
      }),
    );
    expect(html).toContain("can&#x27;t be previewed");
    expect(html).not.toContain("onload");
  });
});
