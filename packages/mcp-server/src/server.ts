/**
 * MCP wiring — mounts the transport-agnostic tool descriptors onto an `McpServer`.
 * This is the ONLY module that touches the MCP SDK, so the tool/session logic stays
 * testable without a live server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MadySession, type SessionOptions } from "./session.js";
import { buildTools } from "./tools.js";

export function createServer(opts?: SessionOptions): { server: McpServer; session: MadySession } {
  const session = new MadySession(opts);
  const server = new McpServer(
    { name: "mady", version: "0.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "MadY headless MCP server. Author and analyze MadY projects: create tables and graphs, " +
        "style axes/series, configure and compute statistical analyses, and save .mady files. " +
        "Every edit runs through the same validated, undoable path as the app. Deletes require confirm=true.",
    },
  );

  for (const tool of buildTools(session)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputShape },
      // The SDK parses args against inputShape before calling us; treat as a plain record.
      (async (args: Record<string, unknown>) => {
        try {
          const value = await tool.handler(args);
          const isError = typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;
          return {
            content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
            ...(isError ? { isError: true } : {}),
          };
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }) }],
            isError: true,
          };
        }
      }) as never,
    );
  }

  return { server, session };
}
