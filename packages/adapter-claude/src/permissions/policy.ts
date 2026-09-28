/**
 * Session-scoped permission policy for Claude approvals.
 *
 * Ported behavior from the private implementation, rewritten:
 * - resource extraction per tool,
 * - human-meaningful "always" patterns derived from the tool input,
 * - and prefix-boundary matching that never bleeds across directories.
 *
 * Rules live only in memory for the current session. Homebase never writes
 * Claude settings files.
 */

export function resourcesOf(toolName: string, input: Record<string, unknown>): string[] {
  const pick = (key: string): string[] => {
    const value = input[key];
    return typeof value === "string" && value.trim().length > 0 ? [value] : [];
  };
  switch (toolName) {
    case "Bash":
    case "PowerShell":
      return pick("command");
    case "Edit":
    case "Write":
    case "Read":
    case "NotebookEdit":
      return pick("file_path");
    case "WebFetch":
      return pick("url");
    case "WebSearch":
      return pick("query");
    case "Task":
      return pick("description");
    default:
      return [];
  }
}

function directoryOf(resource: string): string {
  const index = Math.max(resource.lastIndexOf("\\"), resource.lastIndexOf("/"));
  return index > 0 ? resource.slice(0, index) : resource;
}

export function savePatterns(toolName: string, input: Record<string, unknown>): string[] {
  const resources = resourcesOf(toolName, input);
  if (resources.length === 0) return [`${toolName} *`];
  const resource = resources[0] ?? "";

  if (toolName === "Bash" || toolName === "PowerShell") {
    const words = resource.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return [`${words[0]} ${words[1]} *`];
    if (words.length === 1) return [`${words[0]} *`];
    return [`${toolName} *`];
  }

  if (toolName === "WebFetch" || toolName === "WebSearch") {
    const host = /^https?:\/\/([^/]+)/.exec(resource)?.[1];
    return host ? [`${host}/*`] : [resource];
  }

  if (/^(Edit|Write|Read|NotebookEdit)$/.test(toolName)) {
    return [`${directoryOf(resource)}\\*`];
  }

  return [`${toolName} *`];
}

export function matchesRule(
  rules: Array<{ tool: string; pattern: string }>,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  const resources = resourcesOf(toolName, input);
  for (const rule of rules) {
    if (rule.tool !== toolName) continue;
    if (rule.pattern === "*" || rule.pattern === `${toolName} *`) return true;
    if (rule.pattern.endsWith(" *") || rule.pattern.endsWith("\\*") || rule.pattern.endsWith("/*")) {
      const prefix = rule.pattern.slice(0, -2);
      for (const resource of resources) {
        if (resource === prefix) return true;
        if (
          resource.startsWith(`${prefix} `) ||
          resource.startsWith(`${prefix}\\`) ||
          resource.startsWith(`${prefix}/`)
        ) {
          return true;
        }
      }
      continue;
    }
    for (const resource of resources) {
      if (resource === rule.pattern) return true;
    }
  }
  return false;
}
