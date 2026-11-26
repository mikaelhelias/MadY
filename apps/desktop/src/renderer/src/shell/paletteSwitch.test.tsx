// @vitest-environment jsdom
/**
 * Colour scheme ▸ Palette after a style preset. A preset writes every dataset's colour into its series style, so the
 * palette choice must take those colours away or it never shows; a colour picked by hand for one series stays.
 */
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { NodeId, Plot, Project } from "@mady/core";
import { buildPlotScene, PALETTES } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { inspectorDocOps } from "./inspectorDocOps";
import { galleryItems } from "./gallery";
import { paletteSwitchPatch } from "./paletteSwitch";
import { graphSceneOptions } from "./panes";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const box = galleryItems().find((i) => i.plot.kind === "box")!;
const SIZE = { width: 620, height: 420 };
const docWith = (plot: Plot): MadyDocument => new MadyDocument({ schemaVersion: 4, tables: [box.table], plots: [plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
// The drawing as the app builds it: the palette reaches the builder through the app's scene options.
const firstColour = (doc: MadyDocument): string | null | undefined => {
  const project = doc.toJSON();
  const p = project.plots[0]!;
  return buildPlotScene(project.tables[0]!, p, { ...graphSceneOptions(project, p, null), ...SIZE }).series[0]!.color;
};

function Live({ doc, plotId }: { doc: MadyDocument; plotId: NodeId }) {
  const [, setV] = useState(0);
  const ops = inspectorDocOps((fn) => { fn(doc); setV((v) => v + 1); }, () => plotId);
  const project = doc.toJSON();
  const plot = project.plots[0]!;
  return (
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={project.tables[0]!} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} onSelect={() => {}}
      onSetAxis={ops.setAxis} onSetAxisLength={ops.setAxisLength} onSetAxisTitleFont={ops.setAxisTitleFont}
      onSetSeriesStyle={ops.setSeriesStyle} onSetSeriesStyleAll={ops.setSeriesStyleAll} onSetPointStyle={ops.setPointStyle}
      onClearPointStyles={ops.clearPointStyles} onSetGrid={ops.setGrid} onSetFrame={ops.setFrame}
      onSetBarLayout={ops.setBarLayout} onSetBarShape={ops.setBarShape} onSetBoxWhisker={ops.setBoxWhisker}
      onSetPlotOptions={ops.setPlotOptions} onSetGraphTitle={ops.setGraphTitle} onSetPlotFont={ops.setPlotFont}
      onSetLegend={ops.setLegend} onSetSignificance={ops.setSignificance}
      onSetKind={() => {}} onHomogenizeFont={() => {}}
      onApplyPreset={() => {}} onApplyUserPreset={() => {}} onSaveUserPreset={() => null} onDeleteUserPreset={() => {}} onSetProfileDefault={() => {}}
      annotationOps={{} as never} />
  );
}

describe("Palette after a style preset", () => {
  it("the gallery box chart carries the preset's colours, so it is a fixture that can show the fault", () => {
    const doc = docWith(box.plot);
    expect(Object.values(box.plot.seriesStyles ?? {}).some((s) => s.color)).toBe(true);
    expect(firstColour(doc)).toBe(Object.values(box.plot.seriesStyles ?? {})[0]?.color);
  });

  it("choosing a palette in the panel recolours the drawing, as one undo step", () => {
    const doc = docWith(box.plot);
    const before = firstColour(doc);
    const u = render(<Live doc={doc} plotId={box.plot.id} />);
    const chart = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Chart");
    if (chart) act(() => { fireEvent.click(chart); });
    const select = [...u.container.querySelectorAll<HTMLSelectElement>("select")].find((s) => [...s.options].some((o) => o.value === "Vibrant"))!;
    doc.commands.clear();
    act(() => { fireEvent.change(select, { target: { value: "Vibrant" } }); });
    expect(firstColour(doc)?.toLowerCase()).toBe(PALETTES["Vibrant"]![0]!.toLowerCase());
    act(() => { doc.commands.undo(); });
    expect(doc.commands.canUndo).toBe(false);
    expect(firstColour(doc)).toBe(before);
  });

  it("a colour picked by hand for one series stays", () => {
    const preset = STYLE_PRESETS[0]!;
    const doc = docWith(box.plot);
    doc.applyStylePreset(box.plot.id, preset);
    const plot = doc.toJSON().plots[0]!;
    const ids = Object.keys(plot.seriesStyles ?? {});
    doc.setSeriesStyle(box.plot.id, ids[1]!, { color: "#123456" });
    const patch = paletteSwitchPatch(doc.toJSON().plots[0]!, box.table, "Warm");
    expect(patch.seriesStyles?.[ids[1]!]?.color).toBe("#123456");
    expect(patch.seriesStyles?.[ids[0]!]?.color).toBeUndefined();
    expect(patch.paletteColors).toBeUndefined();
  });
});
