import { connect } from "node:net";

/**
 * Adapter-internal approval channel.
 *
 * The Claude CLI can only ask for permission through an MCP tool, and the MCP
 * server is a child process of the CLI. Homebase therefore runs a loopback-only
 * TCP channel inside the Host process that these short-lived MCP servers
 * connect to. It is not a public service: it binds 127.0.0.1 on an ephemeral
 * port and requires a per-process random token. One ask per connection.
 */
export interface ApprovalAsk {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string | null;
}

export type ApprovalDecision =
  { behavior: "allow"; updatedInput?: Record<string, unknown> } | { behavior: "deny"; message: string };

export interface ChannelAskMessage {
  type: "ask";
  token: string;
  ask: ApprovalAsk;
}

export type ChannelReplyMessage = { type: "decision"; decision: ApprovalDecision } | { type: "error"; message: string };

export function encodeChannelLine(message: ChannelAskMessage | ChannelReplyMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Client side, used by the MCP server process spawned by Claude. */
export function askApprovalChannel(
  port: number,
  token: string,
  ask: ApprovalAsk,
  timeoutMs: number,
): Promise<ApprovalDecision> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("The Homebase approval request timed out."));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(encodeChannelLine({ type: "ask", token, ask }));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      clearTimeout(timer);
      let message: ChannelReplyMessage;
      try {
        message = JSON.parse(buffer.slice(0, index)) as ChannelReplyMessage;
      } catch {
        socket.destroy();
        reject(new Error("The Homebase approval channel sent an unreadable reply."));
        return;
      }
      socket.end();
      if (message.type === "decision") resolve(message.decision);
      else reject(new Error(message.message));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
