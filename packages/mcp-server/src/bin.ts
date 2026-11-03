#!/usr/bin/env node
/**
 * `mady-mcp` — the stdio MCP server entry point. A local coding agent (Claude Code,
 * Codex, …) spawns this and speaks MCP over stdin/stdout. No network, no key.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { server, session } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = (): void => {
    void session.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  // stdout is the MCP channel — diagnostics must go to stderr only.
  process.stderr.write(`mady-mcp failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
