// @vitest-environment jsdom
/**
 * "Apply to whole graph" restyles the series the graph draws. On graphs whose drawn series are not the sheet's columns
 * (the ordination groups, the scree line) it wrote the change onto the sheet's columns, and nothing changed.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { DataTable, NodeId, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { inspectorDocOps } from "./inspectorDocOps";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

function Live({ doc, plotId, columnId }: { doc: MadyDocument; plotId: NodeId; columnId: string }) {
  const [, setV] = useState(0);
  const [whole, setWhole] = useState(true);
  const ops = inspectorDocOps((fn) => { fn(doc); setV((v) => v + 1); }, () => plotId);
  const project = doc.toJSON();
  return (
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId }} plot={project.plots[0]!} table={project.tables[0]!} userPresets={[]} profileDefault={null}
      wholeGraph={whole} onSetWholeGraph={setWhole} onSelect={() => {}}
      onSetAxis={ops.setAxis} onSetAxisLength={ops.setAxisLength} onSetAxisTitleFont={ops.setAxisTitleFont}
      onSetSeriesStyle={ops.setSeriesStyle} onSetSeriesStyleAll={ops.setSeriesStyleAll} onSetPointStyle={ops.setPointStyle}
      onClearPointStyles={ops.clearPointStyles} onSetGrid={ops.setGrid} onSetFrame={ops.setFrame}
      onSetBarLayout={ops.setBarLayout} onSetBarShape={ops.setBarShape} onSetBoxWhisker={ops.setBoxWhisker}
      onSetPlotOptions={ops.setPlotOptions} onSetGraphTitle={ops.setGraphTitle} onSetPlotFont={ops.setPlotFont}
      onSetLegend={ops.setLegend} onSetSignificance={ops.setSignificance} onSetKind={vi.fn()} onHomogenizeFont={vi.fn()}
      onApplyPreset={vi.fn()} onApplyUserPreset={vi.fn()} onSaveUserPreset={() => null} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{} as never} />
  );
}

/**
 * On a graph that draws series of its own (ordination groups and loadings, the scree lines, dendrogram branches), the
 * clicked series' panel lists those series and counts them for "Apply to whole graph", not the sheet's columns, which
 * the drawing does not show as series (clicking one edited a series that is drawn nowhere).
 */
describe("the clicked series' panel lists the drawn series", () => {
  for (const title of ["Ordination — sites", "Ordination — variables", "Ordination — biplot", "Ordination — triplot (constrained)", "Scree plot", "Dendrogram"]) {
    it(`${title}`, () => {
      const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === title)!;
      const doc = new MadyDocument({ schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
      const drawn = buildPlotScene(item.table, item.plot, { width: 620, height: 420 }).series;
      const u = render(<Live doc={doc} plotId={item.plot.id} columnId={drawn[0]!.id} />);
      const rows = [...u.container.querySelectorAll(".serieslist-row")].map((r) => r.textContent?.trim() ?? "");
      expect(rows.length, rows.join(" | ")).toBe(drawn.length);
      const drawnNames = new Set(drawn.map((s) => s.name));
      for (const col of item.table.columns) if (!drawnNames.has(col.name)) expect(rows.some((r) => r.startsWith(col.name)), `sheet column "${col.name}" listed`).toBe(false);
      if (drawn.length > 1) expect(u.container.textContent).toContain(`→ all ${drawn.length} series`);
      // A drawn group, line or branch is no column of the sheet: no "Replicates … subcolumns" row.
      expect(u.container.textContent).not.toContain("subcolumn");
      // A computed series is drawn without error bars, whatever the sheet holds: no Error bars group, no advice on
      // replicates.
      expect(u.container.textContent).not.toMatch(/error bar/i);
      expect(u.container.textContent).not.toMatch(/replicate/i);
    });
  }
  it("Bland-Altman and ROC panels, which draw no error bars either, give no advice on replicates", () => {
    for (const title of ["Bland-Altman", "ROC curve"]) {
      const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === title)!;
      const doc = new MadyDocument({ schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
      const first = buildPlotScene(item.table, item.plot, { width: 620, height: 420 }).series[0]!;
      const u = render(<Live doc={doc} plotId={item.plot.id} columnId={first.id} />);
      expect(u.container.textContent, title).not.toMatch(/error bars need/i);
      cleanup();
    }
  });
  it("a sheet column's panel keeps its Replicates row", () => {
    const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === "XY (points + fitted curve)")!;
    const doc = new MadyDocument({ schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
    const first = buildPlotScene(item.table, item.plot, { width: 620, height: 420 }).series[0]!;
    const u = render(<Live doc={doc} plotId={item.plot.id} columnId={first.id} />);
    expect(u.container.textContent).toContain("subcolumn");
  });
});

describe("Apply to whole graph reaches the drawn series", () => {
  for (const title of ["Ordination — sites", "Ordination — biplot", "Ordination — triplot (constrained)", "Scree plot"]) {
    it(`${title}: Colour with the whole graph ticked recolours the drawing`, () => {
      const item = (galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]).find((i) => i.title === title)!;
      const doc = new MadyDocument({ schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
      const drawn = buildPlotScene(item.table, item.plot, { width: 620, height: 420 }).series.map((s) => s.id);
      const u = render(<Live doc={doc} plotId={item.plot.id} columnId={drawn[0]!} />);
      const colour = [...u.container.querySelectorAll<HTMLInputElement>("input[type=color]")][0]!;
      const size = { width: 620, height: 420 };
      const before = renderFingerprint(item.table, doc.toJSON().plots[0]!, size);
      act(() => { fireEvent.change(colour, { target: { value: "#ff0000" } }); fireEvent.blur(colour); });
      const after = doc.toJSON().plots[0]!;
      expect(renderFingerprint(item.table, after, size)).not.toBe(before);
      // Every drawn series took it, not only the clicked one.
      for (const id of drawn.filter((d) => d.startsWith("pca-g"))) expect(after.seriesStyles?.[id]?.color, id).toBe("#ff0000");
    });
  }
});
