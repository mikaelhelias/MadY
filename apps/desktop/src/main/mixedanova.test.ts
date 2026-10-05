// @vitest-environment node
/**
 * Mixed (split-plot) ANOVA — the app side. The statistics are checked independently in
 * engines/py/crosscheck.py (pingouin, statsmodels, eigenvalue ε); here:
 *   1. a Grouped sheet reaches the engine the right way round — each dataset a group, each subcolumn one subject
 *      measured down the rows, each row a time point — and a spare blank row is not a time point;
 *   2. the exported Python script, run on its own, prints the same F and p values the engine returns.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "@mady/core";
import type { DataTable, Project } from "@mady/core";
import { SidecarSupervisor } from "./sidecar";
import { buildPythonScript } from "../renderer/src/shell/scriptExport";

const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";
const SCIPY = (() => {
  try {
    execSync(`${py} -c "import scipy, numpy"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Week 0–3 down the rows; Control (4 mice) and Treated (3 mice), one subcolumn per mouse; a spare blank row last. */
const weeks = [0, 1, 2, 3];
const control = [[20.1, 20.5, 21.0, 21.2], [19.8, 20.0, 20.9, 21.5], [20.4, 20.9, 21.1, 21.8], [19.9, 20.2, 20.4, 21.0]];
const treated = [[20.2, 21.8, 23.1, 24.9], [19.7, 21.0, 22.8, 24.1], [20.0, 21.5, 23.5, 25.2]];
const table = {
  id: "t1", kind: "grouped", name: "Weights",
  columns: [
    { id: "wk", name: "Week", role: "x" },
    ...control.map((_, i) => ({ id: `c${i}`, name: i === 0 ? "Control" : `Control ${i + 1}`, role: "y", ...(i ? { group: "c0" } : {}) })),
    ...treated.map((_, i) => ({ id: `t${i}`, name: i === 0 ? "Treated" : `Treated ${i + 1}`, role: "y", ...(i ? { group: "t0" } : {}) })),
  ],
  rows: [
    ...weeks.map((w, r) => ({
      id: `r${r}`,
      cells: { wk: w, ...Object.fromEntries(control.map((s, i) => [`c${i}`, s[r]])), ...Object.fromEntries(treated.map((s, i) => [`t${i}`, s[r]])) },
    })),
    { id: "spare", cells: {} },
  ],
} as unknown as DataTable;
const params = { columns: ["c0", "t0"] };

describe("mixed ANOVA — the sheet reaches the engine the right way round", () => {
  it("datasets are groups, subcolumns are subjects, rows are time points; a blank row is not a time point", () => {
    const data = buildAnalysisData("mixedanova", params as never, table) as { groups: { label: string; subjects: number[][] }[]; timeLabels: string[] };
    expect(data.timeLabels).toEqual(["0", "1", "2", "3"]);
    expect(data.groups.map((g) => g.label)).toEqual(["Control", "Treated"]);
    expect(data.groups[0]!.subjects).toEqual(control);
    expect(data.groups[1]!.subjects).toEqual(treated);
  });
});

describe.skipIf(!SCIPY)("mixed ANOVA — the exported script reproduces MadY's numbers", () => {
  it("the script, run on its own, prints the engine's F and p for groups, time and groups × time", async () => {
    const data = buildAnalysisData("mixedanova", params as never, table);
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    let g: Record<string, number>;
    try {
      g = (await s.request("mixedanova", data as Record<string, unknown>))["glance"] as Record<string, number>;
    } finally {
      s.stop();
    }
    const project = { tables: [table], analyses: [{ id: "a1", name: "Mixed", method: "mixedanova", params, source: "t1" }] } as unknown as Project;
    const dir = mkdtempSync(join(tmpdir(), "mady-mixed-"));
    const file = join(dir, "script.py");
    writeFileSync(file, buildPythonScript(project));
    const out = execFileSync(py, [file], { encoding: "utf-8" });
    const line = (name: string) => out.split(/\r?\n/).find((l) => l.startsWith(name))!;
    const nums = (l: string) => [...l.matchAll(/= ([-\d.e+]+)/g)].map((m) => Number(m[1]));
    const [fG, pG] = nums(line("groups:"));
    const [fT, pT, pTgg, eps] = nums(line("time:"));
    const [fGT, pGT, pGTgg] = nums(line("groups x time:"));
    const close = (a: number, b: number) => expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)).toBeLessThan(1e-3);
    close(fG!, g["F_groups"]!); close(pG!, g["p_groups"]!);
    close(fT!, g["F_time"]!); close(pT!, g["p_time"]!); close(pTgg!, g["p_time_gg"]!); close(eps!, g["gg_epsilon"]!);
    close(fGT!, g["F_inter"]!); close(pGT!, g["p_inter"]!); close(pGTgg!, g["p_inter_gg"]!);
  }, 60_000);
});
