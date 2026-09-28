import type { AdapterLogger } from "./adapter.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Best-effort secret redaction for logs and diagnostics. This is a safety net,
 * not a license to log sensitive values: adapters must never log credentials in
 * the first place.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-***"],
  [/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_***"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_***"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "xox-***"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA***"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza***"],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "-----BEGIN PRIVATE KEY----- [redacted] -----END PRIVATE KEY-----",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***"],
  [/([?&](?:token|key|secret|password|access_token)=)[^&\s]+/gi, "$1***"],
  [
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
    "$1=***",
  ],
];

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  /** Injectable sink, primarily for tests. */
  sink?: Pick<Console, "debug" | "info" | "warn" | "error">;
}

/** Creates a structured console logger for an adapter or host module. */
export function createConsoleLogger(scope: string, options: ConsoleLoggerOptions = {}): AdapterLogger {
  const level = options.level ?? "info";
  const sink = options.sink ?? console;

  const write = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const prefix = `[${scope}]`;
    const safeMessage = redactSecrets(message);
    if (fields && Object.keys(fields).length > 0) {
      sink[entryLevel](prefix, safeMessage, redactSecrets(JSON.stringify(fields)));
    } else {
      sink[entryLevel](prefix, safeMessage);
    }
  };

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export interface RecordedLogEntry {
  level: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

export interface RecordingLogger {
  logger: AdapterLogger;
  entries: RecordedLogEntry[];
}

/** Recording logger for tests and diagnostics. */
export function createRecordingLogger(): RecordingLogger {
  const entries: RecordedLogEntry[] = [];
  const logger: AdapterLogger = {
    debug: (message, fields) => entries.push({ level: "debug", message, fields }),
    info: (message, fields) => entries.push({ level: "info", message, fields }),
    warn: (message, fields) => entries.push({ level: "warn", message, fields }),
    error: (message, fields) => entries.push({ level: "error", message, fields }),
  };
  return { logger, entries };
}
