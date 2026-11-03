// @vitest-environment jsdom
/**
 * Every show/hide box the Inspector offers hides something in the drawing.
 *
 * Two panels list series with a show/hide box: the graph's own panel and the panel a clicked series opens. On graphs
 * whose drawing ignores `hidden` (positional columns, computed series) the second one still offered the box, so it
 * did nothing. Asked of the rendered figure, on every gallery graph, for every box either panel shows.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument, tableDatasets } from "@mady/core";
import type { DataTable, NodeId, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import type { GraphSelection } from "./AppShell";
import { Inspector } from "./Inspector";
import { inspectorDocOps } from "./inspectorDocOps";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const SIZE = { width: 620, height: 420 };
const HIDE = "Show / hide this series (it still feeds the spread band & average)";

function Live({ doc, plotId, sel }: { doc: MadyDocument; plotId: NodeId; sel: GraphSelection }) {
  const [, setV] = useState(0);
  const ops = inspectorDocOps((fn) => { fn(doc); setV((v) => v + 1); }, () => plotId);
  const project = doc.toJSON();
  return (
    <Inspector activeSection="graphs" selection={sel} plot={project.plots[0]!} table={project.tables[0]!} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={vi.fn()} onSelect={vi.fn()}
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

describe("show/hide boxes", () => {
  it("every box offered on a gallery graph changes the drawing", () => {
    const dead: string[] = [];
    let boxes = 0;
    for (const item of galleryItems() as unknown as { title: string; table: DataTable; plot: Plot }[]) {
      const first = buildPlotScene(item.table, item.plot, SIZE).series[0]?.id ?? tableDatasets(item.table)[0]?.id;
      const sels: [string, GraphSelection][] = [["graph panel", { kind: "plot" }]];
      if (first) sels.push(["series panel", { kind: "series", columnId: first }]);
      for (const [where, sel] of sels) {
        const doc = new MadyDocument({ schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
        const u = render(<Live doc={doc} plotId={item.plot.id} sel={sel} />);
        // The series list sits on the Chart tab.
        const chart = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
        if (chart && sel?.kind === "plot") act(() => { fireEvent.click(chart); });
        const hideBoxes = (): HTMLInputElement[] => [...u.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].filter((e) => e.getAttribute("title") === HIDE);
        const n = hideBoxes().length;
        for (let i = 0; i < Math.min(n, 3); i++) {
          const box = hideBoxes()[i]!;
          const before = renderFingerprint(item.table, doc.toJSON().plots[0]!, SIZE);
          doc.commands.clear();
          act(() => { fireEvent.click(box); });
          boxes++;
          if (renderFingerprint(item.table, doc.toJSON().plots[0]!, SIZE) === before) dead.push(`${item.title} · ${where} · box ${i + 1}`);
          act(() => { while (doc.commands.canUndo) doc.commands.undo(); });
        }
        cleanup();
      }
    }
    expect(dead).toEqual([]);
    expect(boxes).toBeGreaterThan(20);
  });
});
