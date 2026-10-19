/**
 * @mady/mcp-server — a headless MCP server that lets an external local coding agent
 * (Claude Code, Codex, Kimi, …) drive MadY. LOCAL, keyless, zero cloud: it holds an
 * in-memory `MadyDocument` and mutates it through the same validated agent-command
 * path the desktop app uses. See `README.md` for the client config.
 */
export { createServer } from "./server.js";
export { MadySession } from "./session.js";
export type { ComputeRequest, ComputeResult, SessionOptions } from "./session.js";
export { buildTools, coveredOps, opToolName, schemaOps, type ToolDescriptor } from "./tools.js";
export { EngineClient, EngineError, resolveEngine, type EngineClientOptions } from "./engineClient.js";
