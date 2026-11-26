/**
 * Melting temperature payload: each selected dataset is a
 * sample, and each of its replicate columns travels on its own (a Tm per column), row-aligned
 * with one X list — the XY payload flattens replicates into pooled points, which would make a
 * per-column Tm impossible.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisData, unitFromHeader } from "./analysisData";
import type { DataTable } from "./model";

const table = {
  id: "t", kind: "xy", name: "Melt",
  columns: [
    { id: "x", name: "Temperature (°C)", role: "x" },
    { id: "a1", name: "Apo", role: "y" },
    { id: "a2", name: "Apo B", role: "y", group: "a1" },
    { id: "l", name: "Ligand", role: "y" },
  ],
  rows: [
    { id: "r0", cells: { x: 40, a1: 1, a2: 2, l: 3 } },
    { id: "r1", cells: { x: 50, a1: 4, a2: "", l: 6 } },
    { id: "r2", cells: { x: 60, a1: 7, a2: 8, l: 9 } },
  ],
} as unknown as DataTable;

describe("meltingtemp payload", () => {
  it("one entry per sample, its replicate columns separate and row-aligned with X (blank = null)", () => {
    const p = buildAnalysisData("meltingtemp", { columns: ["a1", "l"] } as never, table) as {
      datasets: { label: string; x: (number | null)[]; replicates: { label: string; y: (number | null)[] }[] }[];
    };
    expect(p.datasets.map((d) => d.label)).toEqual(["Apo", "Ligand"]);
    expect(p.datasets[0]!.x).toEqual([40, 50, 60]);
    expect(p.datasets[0]!.replicates).toEqual([
      { label: "Apo", y: [1, 4, 7] },
      { label: "Apo B", y: [2, null, 8] },
    ]);
    expect(p.datasets[1]!.replicates).toEqual([{ label: "Ligand", y: [3, 6, 9] }]);
  });

  it("carries the options, the control by name, and the unit from X's header", () => {
    const p = buildAnalysisData("meltingtemp", {
      columns: ["a1", "l"], sloped: true, rangeFrom: 45, rangeTo: 58, smoothWindow: 7, control: 0, conf: 0.9,
    } as never, table) as Record<string, unknown>;
    expect(p).toMatchObject({ sloped: true, from: 45, to: 58, smoothWindow: 7, control: "Apo", unit: "°C", conf: 0.9 });
  });

  it("leaves unset options out", () => {
    const p = buildAnalysisData("meltingtemp", { columns: ["l"] } as never, table) as Record<string, unknown>;
    for (const k of ["sloped", "from", "to", "smoothWindow", "control"]) expect(p).not.toHaveProperty(k);
  });
});

describe("unitFromHeader", () => {
  it("reads the unit in the last brackets", () => {
    expect(unitFromHeader("Temperature (°C)")).toBe("°C");
    expect(unitFromHeader("T [K]")).toBe("K");
    expect(unitFromHeader("Temp (sample 2) (°F)")).toBe("°F");
    expect(unitFromHeader("  Temperature ( °C ) ")).toBe("°C");
  });
  it("is empty when there are none, or they are not at the end", () => {
    expect(unitFromHeader("Temperature")).toBe("");
    expect(unitFromHeader("(°C) Temperature")).toBe("");
  });
});
