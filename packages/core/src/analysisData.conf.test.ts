import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import type { DataTable } from "./model";

/**
 * The dialog shows one Confidence selector for every analysis and `AnalyzeSpec` always
 * carries `conf`, so every payload builder must forward it: a builder that drops it leaves
 * the engine on its default, whatever the user chose. The engine side is guarded by
 * crosscheck.py's `check_conf_threading`; this guards the payloads.
 */
describe("buildAnalysisData forwards conf", () => {
  const table: DataTable = {
    id: "t1", kind: "xy", name: "T",
    columns: [
      { id: "cx", name: "X", role: "x" },
      { id: "ca", name: "A", role: "y" },
      { id: "cb", name: "B", role: "y" },
      { id: "cg", name: "G", role: "y" },
    ],
    rows: [1, 2, 3, 4, 5, 6].map((v, i) => ({
      id: `r${i}`,
      cells: { cx: v, ca: v % 2, cb: (v + 1) % 2, cg: i < 3 ? "g1" : "g2" },
    })),
  } as never;

  const conf = (method: string, params: Record<string, unknown>): number | undefined =>
    (buildAnalysisData(method, { conf: 0.9, ...params } as never, table) as { conf?: number }).conf;

  it.each([
    ["survival", { columns: ["ca", "cb"] }],
    ["curvefit", { columns: ["cx", "ca"] }],
    ["globalfit", { columns: ["ca", "cb"] }],
    ["comparefits", { columns: ["cx", "ca"] }],
    ["mixedmodel", { columns: ["ca", "cg"] }],
  ] as const)("%s payload carries conf", (method, params) => {
    expect(conf(method, params as never)).toBe(0.9);
  });

  it("t test and ROC payloads carry conf too (control)", () => {
    expect(conf("ttest", { columns: ["ca", "cb"], variant: "welch" })).toBe(0.9);
    expect(conf("roc", { columns: ["ca", "cb"] })).toBe(0.9);
  });
});
