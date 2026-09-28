import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { preloadHighlighter } from "../lib/highlight.js";
import { safeHref } from "../lib/viewmodel.js";
import { CodeBlock } from "./beautiful/CodeBlock.js";

// Conversations are where code appears; start loading the highlighter as soon
// as this module is used so the first block rarely renders plain.
preloadHighlighter();

const remarkPlugins = [remarkGfm];

/**
 * Assistant Markdown. Raw HTML in model output is never rendered
 * (react-markdown's default), links are protocol-checked, remote images are
 * not loaded, and fenced code goes through the tokenising Code Block.
 */
const components: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    const external = !safe.startsWith("#");
    return (
      <a href={safe} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
        {children}
      </a>
    );
  },
  code: ({ className, children }) => {
    const match = /language-([\w-]+)/.exec(className ?? "");
    const raw = String(children ?? "");
    if (match || raw.includes("\n")) {
      return <CodeBlock code={raw} language={match?.[1] ?? null} />;
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  img: ({ alt }) => {
    // Remote images inside model output are not loaded; they would leak
    // browsing metadata. Show the alt text instead.
    return <span className="text-muted">[{alt ?? "image"}]</span>;
  },
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="hb-markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
