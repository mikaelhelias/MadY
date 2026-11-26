// @vitest-environment node
/**
 * Guards the two-edition isolation: the standard edition must not ship the agent
 * surface. That relies on `agentBridge` being reached only through the dynamic
 * `import("./agentBridge")` behind the compile-time `__AGENT_API__` guard in AppShell —
 * a static import anywhere in shipped renderer source would pull it into every bundle,
 * silently defeating the split.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shellDir = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...sourceFiles(join(dir, e.name)));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

describe("agent-edition isolation", () => {
  it("shipped renderer source imports agentBridge only dynamically (never statically)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(shellDir)) {
      if (file.endsWith("agentBridge.ts")) continue; // the module itself
      const src = readFileSync(file, "utf8");
      // A static import: `import ... from "…/agentBridge"` or `import "…/agentBridge"`.
      // The allowed form is the dynamic `import("./agentBridge")`, which this does not match.
      if (/\bimport\b[^\n(]*\bfrom\s*["'][^"']*agentBridge["']/.test(src) || /\bimport\s*["'][^"']*agentBridge["']/.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, `these files statically import agentBridge, which would ship it in the standard edition:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
