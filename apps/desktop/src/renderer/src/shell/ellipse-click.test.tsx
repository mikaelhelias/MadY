// @vitest-environment jsdom
/**
 * Clicking a confidence ellipse opens its own section — a click on each ellipse opens the
 * section of the side panel that controls it.
 *
 * The per-group confidence/data ellipse (the ordination overlay of PCA/PCoA score plots)
 * must not be drawn with `pointerEvents="none"`, which would make it the one element that
 * breaks the rule "every element is clickable to its own tab". A click selects
 * `{ kind: "chart-section", title: "Confidence ellipse" }`, which pins that section open in
 * the Chart tab (the same mechanism every other section-opening click uses).
 *
 * Default-deny, driven from the gallery: every kind whose Inspector offers the ellipse
 * section is swept with `ellipse.show` forced on; each drawn ellipse must produce the
 * selection when clicked. A kind that gains the section later is covered the day its card
 * exists — no hand-written list to rot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W } from "./figureFit";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

const SIZE = { width: FIGURE_DEFAULT_W, height: FIGURE_DEFAULT_H };

/** The kinds whose Inspector mounts the "Confidence ellipse" section (Inspector.tsx). */
const ELLIPSE_KINDS = ["xy", "area", "bubble", "volcano", "pcascore", "pcabiplot"] as const;

describe("confidence-ellipse click", () => {
  it("every drawn ellipse opens the Confidence ellipse section on click", () => {
    let sweptKinds = 0;
    for (const kind of ELLIPSE_KINDS) {
      const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind);
      if (!item) continue;
      const plot: Plot = { ...item.plot, ellipse: { ...(item.plot.ellipse ?? {}), show: true } };
      const scene = buildPlotScene(item.table, plot, SIZE);
      if (!scene.ellipses?.length) continue; // e.g. every series < 3 points — nothing drawn
      sweptKinds += 1;
      const picks: GraphSelection[] = [];
      const { container } = render(
        <PlotFigure scene={scene} zoom={1} onSelect={(s: GraphSelection) => picks.push(s)} />,
      );
      const els = container.querySelectorAll("ellipse.gfx-conf-ellipse");
      expect(els.length, `${kind}: the scene has ${scene.ellipses.length} ellipses but the figure drew ${els.length}`).toBe(scene.ellipses.length);
      for (const el of els) fireEvent.click(el);
      const opened = picks.filter((p) => p?.kind === "chart-section" && p.title === "Confidence ellipse");
      expect(opened.length, `${kind}: clicking its ellipses must open the Confidence ellipse section`).toBe(els.length);
      cleanup();
    }
    // The loop must have actually seen ellipses — a gallery where nothing draws one
    // would make this test pass while proving nothing.
    expect(sweptKinds, "no gallery card produced a drawn ellipse — the loop checked nothing").toBeGreaterThan(0);
  });

  it("the selection really opens the section: Inspector shows the ellipse controls expanded", () => {
    // The other half of the click path. If either side renames the section, one of these
    // two tests fails. PlotFigure emits the title; the Inspector pins that section open.
    const item = galleryItems().find((i) => i.plot.kind === "pcascore")!;
    const { container } = render(
      <Inspector
        activeSection="graphs"
        selection={{ kind: "chart-section", title: "Confidence ellipse" }}
        plot={item.plot}
        table={item.table}
        userPresets={[]}
        profileDefault={null}
        onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
      />,
    );
    const section = [...container.querySelectorAll("details.inspsec")].find((d) =>
      (d.querySelector("summary")?.textContent ?? "").includes("Confidence ellipse"));
    expect(section, "the Confidence ellipse section is not rendered for pcascore").toBeTruthy();
    expect((section as HTMLDetailsElement).open, "the section is shown but collapsed, so the clicked ellipse opens nothing the user can see").toBe(true);
    expect(section!.textContent).toContain("Show ellipses");
  });

  it("the PCoA/ordination card demos multiple treatments with their ellipses", () => {
    const item = galleryItems().find((i) => i.plot.kind === "pcascore")!;
    expect(item.plot.ellipse?.show, "the ordination card must ship with ellipses on").toBe(true);
    const groups = new Set(item.plot.pca?.groups ?? []);
    expect(groups.size, "the card should show several treatments").toBeGreaterThanOrEqual(3);
    const scene = buildPlotScene(item.table, item.plot, SIZE);
    expect(scene.ellipses?.length, "one ellipse per treatment").toBe(groups.size);
  });
});
