import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";
import { CodeBlock } from "./beautiful/CodeBlock.js";

describe("untrusted provider output", () => {
  it("renders raw HTML and hostile SVG as inert text", () => {
    const markup = renderToStaticMarkup(
      createElement(Markdown, {
        text: "<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n<svg onload=alert(3) />",
      }),
    );
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img src=");
    expect(markup).toContain("&lt;img src=x onerror=");
    expect(markup).not.toContain("<svg");
  });
  it("rejects javascript links and keeps long terminal-looking text inert", () => {
    const text = `[click](javascript:alert(1))\n\n${"\u001b[31m<script>".repeat(1000)}`;
    const markup = renderToStaticMarkup(createElement(Markdown, { text }));
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });
  it("keeps tool output as escaped text, including ANSI and HTML sequences", () => {
    const markup = renderToStaticMarkup(
      createElement(CodeBlock, {
        code: "\u001b[31m<img src=x onerror=alert(1)><script>alert(2)</script>",
        language: null,
      }),
    );
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img src=");
    expect(markup).toContain("&lt;img");
  });
});
