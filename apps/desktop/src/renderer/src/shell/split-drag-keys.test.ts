// @vitest-environment node
/**
 * A small graph (Graph ▸ Split into small graphs) keeps every position and size as its own and
 * refuses any other edit. That promise holds only while every on-graph drag writes a setting the
 * split rule counts as a position. This reads AppShell's drag handlers and fails, naming the
 * handler, when one writes anything else — a new drag would otherwise be refused on every small
 * graph with a message the user cannot act on.
 *
 * A handler passes when it calls a document method proven kept by `splitCopies.test.ts`
 * (`DRAG_CALLS` there), or writes a key `isPositionKey` accepts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPositionKey } from "@mady/core";

const SRC = readFileSync(fileURLToPath(new URL("./AppShell.tsx", import.meta.url)), "utf8");

/** Document calls a drag makes whose result `splitCopies.test.ts` proves is kept on a copy. */
const KEPT_CALLS = ["setTitleOffset", "setLegendOffset", "setAxisTitleOffset", "moveRefLineLabel", "resizeFigure", "scaleFigure", "setAxisLength", "moveAnnotation"];

/** Drags that are not positions, each with the reason a refusal on a small graph is right. */
const NOT_POSITIONS: Record<string, string> = {
  onRotateAxisTitle: "turns the title — the same setting as the Axis tab's Title direction, a style",
  onWidthResize: "bar / box width — a style the Inspector also sets, not a place on the graph",
  onCamera3D: "3-D view — 3-D scatter cannot be split",
  onParallelEdit: "parallel-coordinates brushes and axis order — that chart cannot be split",
  onLegendDock: "puts a fitted curve or drawn line in the legend — the same setting as its Show in legend box, a style",
};

/** The source of a named function or const arrow in AppShell (its body up to the next member). */
function bodyOf(name: string): string {
  const m = new RegExp(`(?:const ${name} = |function ${name}\\()`).exec(SRC);
  if (!m) return "";
  const rest = SRC.slice(m.index);
  const end = rest.slice(1).search(/\n {2}(?:const |function |\/\*\*)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/** AppShell's helpers imported from its own sibling modules (`./legendLoose`…), by name → file. */
const IMPORTED = new Map<string, string>();
for (const m of SRC.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(\.\/[\w./-]+)"/g)) {
  for (const n of m[1]!.split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!)) if (n) IMPORTED.set(n, m[2]!);
}

/** The source of a top-level function or const exported by the sibling module `name` comes from. */
function importedBodyOf(name: string): string {
  const mod = IMPORTED.get(name);
  if (!mod) return "";
  let src = "";
  for (const ext of [".ts", ".tsx"]) {
    try { src = readFileSync(fileURLToPath(new URL(mod + ext, import.meta.url)), "utf8"); break; } catch { /* next extension */ }
  }
  const m = new RegExp(`export (?:function ${name}\\(|const ${name} = )`).exec(src);
  if (!m) return "";
  const rest = src.slice(m.index);
  const end = rest.slice(1).search(/\n(?:export |function |const |\/\*\*)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/** Each drag handler prop and the code it runs (inline, or the function it names). */
function handlers(): { name: string; code: string }[] {
  const out: { name: string; code: string }[] = [];
  const re = /\b(on(?:Move\w+|FigureResize|FigureScale|AxisResize|RotateAxisTitle|Camera3D|ParallelEdit|WidthResize|LegendLoose|LegendDock))\s*[:=]\s*\{?/g;
  for (let m; (m = re.exec(SRC)); ) {
    const after = SRC.slice(re.lastIndex, re.lastIndex + 1500);
    const stop = after.search(/\n\s+on[A-Z]\w*\s*[:=]/);
    let code = stop < 0 ? after : after.slice(0, stop);
    const ref = /^\s*([a-zA-Z_]\w*)\s*[},\n]/.exec(code);
    if (ref && !/^(?:widthResizable|activePlot)$/.test(ref[1]!)) code = bodyOf(ref[1]!);
    else if (/^\s*widthResizable \? (\w+)/.test(code)) code = bodyOf(/^\s*widthResizable \? (\w+)/.exec(code)![1]!);
    // Helpers called with the document (moveAxisTitle(d, …)) are part of the handler.
    for (const h of code.matchAll(/\b(\w+)\(d,/g)) code += "\n" + bodyOf(h[1]!);
    // …and so is a patch-building helper that lives in its own file (`legendLooseSet(activePlot, …)`).
    for (const h of new Set([...code.matchAll(/\b(\w+)\(/g)].map((x) => x[1]!))) code += "\n" + importedBodyOf(h);
    out.push({ name: m[1]!, code });
  }
  return out;
}

function keptBy(code: string): string | null {
  const call = KEPT_CALLS.find((c) => new RegExp(`\\.${c}\\(`).test(code));
  if (call) return call;
  // Any key the handler writes (`valueDx: dx`, `labelOffsets: {…}`, `[key]` from a "…Offsets"
  // literal). Only a position-named key can pass, so reading more keys cannot pass a bad drag.
  const keys = [...code.matchAll(/(\w+)\s*:/g), ...code.matchAll(/"(\w+)"/g)].map((k) => k[1]!);
  return keys.find(isPositionKey) ?? null;
}

describe("every drag on a graph writes something a small graph keeps", () => {
  const all = handlers();

  it("reads the real handlers (a scan that finds none proves nothing)", () => {
    expect(new Set(all.map((h) => h.name)).size).toBeGreaterThan(30);
  });

  it("each drag handler writes a position or size — or is listed with its reason", () => {
    const bad = all
      .filter((h) => !(h.name in NOT_POSITIONS) && keptBy(h.code) === null)
      .map((h) => `${h.name}: ${h.code.trim().slice(0, 160)}`);
    expect(bad, "a drag writes a setting a small graph would refuse").toEqual([]);
  });

  it("the listed exceptions are still real handlers", () => {
    const names = new Set(all.map((h) => h.name));
    expect(Object.keys(NOT_POSITIONS).filter((n) => !names.has(n))).toEqual([]);
  });
});
