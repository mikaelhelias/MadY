// @vitest-environment jsdom
/**
 * The heatmap's "Column label angle" can choose flat. Unset means Auto - flat, or 45° when the
 * names do not fit - so 0° must be written as 0, not as "unset", or a user could never keep long names flat.
 * Guards against the control treating 0 as empty and writing unset. Driven through the real
 * control, read back from the rebuilt scene.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";

afterEach(cleanup);
const LONG = ["Untreated control", "Drug A high dose", "Drug B low dose", "Drug C combination", "Combination therapy"];
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "g", name: "Gene", role: "x" }, ...LONG.map((n, i) => ({ id: `c${i}`, name: n, role: "y" as const }))],
  rows: ["GeneA", "GeneB", "GeneC"].map((g, r) => ({ id: `r${r}`, cells: { g, ...Object.fromEntries(LONG.map((_, i) => [`c${i}`, (r + i) % 5])) } })),
};
const plot = (labelRotation?: number): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: labelRotation == null ? {} : { labelRotation } }) as Plot;
const SIZE = { width: 580, height: 380, measure: (t: string, px: number) => t.length * px * 0.6 };

function control(p: Plot) {
  const writes: Partial<Plot>[] = [];
  const f = vi.fn();
  const h = {
    onSelect: f, onSetAxis: f, onSetAxisLength: f, onSetAxisTitleFont: f,
    onSetSeriesStyle: f, onSetSeriesStyleAll: f, onSetPointStyle: f, onClearPointStyles: f,
    onSetGrid: f, onSetFrame: f, onSetKind: f, onSetBarLayout: f, onSetBarShape: f, onSetBoxWhisker: f,
    onSetPlotOptions: (patch: Partial<Plot>) => writes.push(patch), onSetGraphTitle: f, onSetPlotFont: f, onHomogenizeFont: f,
    onSetLegend: f, onSetSignificance: f, onApplyPreset: f,
    onApplyUserPreset: f, onSaveUserPreset: f, onDeleteUserPreset: f, onSetProfileDefault: f,
    annotationOps: { add: f, update: f, remove: f, reorder: f, align: f, group: f, ungroup: f, setLocked: f, addImage: f, replaceImage: f },
  };
  const props = { ...h, activeSection: "graphs", selection: { kind: "plot" }, plot: p, table, userPresets: [], profileDefault: null } as unknown as ComponentProps<typeof Inspector>;
  const { container } = render(<Inspector {...props} />);
  const sel = container.querySelector<HTMLSelectElement>('select[aria-label="Column label angle"]');
  return { sel, writes };
}
const applied = (p: Plot, patch: Partial<Plot>): Plot => ({ ...p, ...patch, heatmap: { ...(p.heatmap ?? {}), ...(patch.heatmap ?? {}) } }) as Plot;

describe("heatmap column label angle", () => {
  it("unset reads Auto, and the drawing tilts the long names", () => {
    const { sel } = control(plot());
    expect(sel, "no Column label angle control").toBeTruthy();
    expect(sel!.value).toBe("auto");
    expect(buildPlotScene(table, plot(), SIZE).heatmap!.labelRotation).toBe(45);
  });

  it("choosing 0° writes 0 and the drawing keeps the long names flat", () => {
    const { sel, writes } = control(plot());
    fireEvent.change(sel!, { target: { value: "0" } });
    const patch = writes.at(-1)!;
    const p = applied(plot(), patch);
    expect(p.heatmap!.labelRotation).toBe(0);
    expect(buildPlotScene(table, p, SIZE).heatmap!.labelRotation ?? 0).toBe(0);
  });

  it("choosing Auto again clears the angle", () => {
    const { sel, writes } = control(plot(30));
    expect(sel!.value).toBe("30");
    fireEvent.change(sel!, { target: { value: "auto" } });
    expect(writes.at(-1)!.heatmap!.labelRotation).toBeUndefined();
  });
});
