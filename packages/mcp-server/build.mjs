// Bundle the MCP server into a single self-contained, Node-runnable ESM binary.
//
// Why bundle: `@mady/core` / `@mady/contracts` compile with Bundler module
// resolution (extensionless relative imports), so their dist is meant to be consumed
// by a bundler — not run by raw Node. The desktop app inlines core the same way via
// electron-vite. We inline core + contracts + zod here and leave the MCP SDK external
// (it's a normal, Node-resolvable node_modules dependency).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here("./src/bin.ts")],
  outfile: here("./dist/mady-mcp.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  // No shebang banner — src/bin.ts already carries one, which esbuild preserves.
  // Resolve @mady/* to source so the bundle reflects current code, not a stale dist.
  alias: {
    "@mady/core": here("../core/src/index.ts"),
    "@mady/contracts": here("../contracts/src/index.ts"),
    "@mady/engine-client": here("../engine-client/src/index.ts"),
    "@mady/graphics": here("../graphics/src/index.ts"),
  },
  external: ["@modelcontextprotocol/sdk"],
});

console.log("bundled → packages/mcp-server/dist/mady-mcp.mjs");
