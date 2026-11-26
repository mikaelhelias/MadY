// @vitest-environment jsdom
/**
 * The estimation plot's "Difference" — its own object, with a panel that says so.
 *
 * The Difference is styled like the forest plot's summary: its colour, fill and outline are
 * editable on their own.
 * Clicking the dot selects `est-diff`, "Difference" is in the series list, and colour reaches
 * both the marker and the bootstrap half-violin. What this file guards is the rest:
 *
 *  1. The panel has a heading. Without one it is indistinguishable from a control-group point,
 *     and the Difference cannot be told apart from the data points.
 *  2. The scope toggles do not reach the groups. `onSetSeriesStyleAll` enumerates the table's
 *     datasets, so "apply to whole graph" from the Difference would restyle the two raw groups
 *     (both taking the two-tone tint of the colour set on the Difference).
 *  3. No control that does nothing, measured by rebuilding: `symbol` must reach the builder (not a
 *     hard-coded circle), and the error-bar `Type` / `Direction` / `Caps` are not offered (the
 *     whisker is a bootstrap CI, computed and drawn both-ways-with-caps regardless).
 *  4. The bootstrap distribution has styling of its own: `fillColor`/`fillOpacity` drive it
 *     through `seriesExtras`, so this kind offers both, and the half-violin is not tied to the
 *     point estimate's colour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };
const item = () => galleryItems().find((g) => (g.plot.kind ?? "xy") === "estimation")!;
const build = (style: Record<string, unknown> = {}) => {
  const g = item();
  return buildPlotScene(g.table, { ...g.plot, seriesStyles: { ...(g.plot.seriesStyles ?? {}), "est-diff": style } } as Plot, SIZE);
};
const diff = (s: ReturnType<typeof build>) => s.series.find((x) => x.id === "est-diff")!;

describe("the fixture can exhibit the behaviour", () => {
  it("draws a Difference series with a marker, a CI whisker and a bootstrap violin", () => {
    const d = diff(build());
    expect(d.name).toBe("Difference");
    expect(d.marks.some((m) => m.violin), "no bootstrap distribution").toBe(true);
    expect(d.marks.some((m) => m.errLowCy !== undefined), "no CI whisker").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. It is reachable and it says what it is.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetSeriesStyle: (id: string, patch: unknown) => void, onSetSeriesStyleAll = vi.fn()) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle, onSetSeriesStyleAll, onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(columnId = "est-diff", style: Record<string, unknown> = {}) {
  const g = item();
  const writes: { id: string; patch: unknown }[] = [];
  const all: unknown[] = [];
  const plot = { ...g.plot, seriesStyles: { ...(g.plot.seriesStyles ?? {}), "est-diff": style } } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId, part: "points" }} plot={plot} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers((id, patch) => writes.push({ id, patch }), vi.fn((p: unknown) => all.push(p)))} />,
  );
  return { container, writes, all, plot, table: g.table as DataTable };
}

const rows = (c: HTMLElement): string[] =>
  [...c.querySelectorAll(".frow > span:first-child")]
    .filter((e) => { for (let n: HTMLElement | null = e as HTMLElement; n; n = n.parentElement) if (n.hidden) return false; return true; })
    .map((e) => (e.textContent ?? "").trim());

function control<T extends HTMLElement = HTMLElement>(c: HTMLElement, label: string): T | undefined {
  for (const row of c.querySelectorAll<HTMLElement>(".frow")) {
    if ((row.querySelector(":scope > span")?.textContent ?? "").trim() !== label) continue;
    for (let n: HTMLElement | null = row; n; n = n.parentElement) if (n.hidden) return undefined;
    const el = row.querySelector<T>("select, input");
    if (el) return el;
  }
  return undefined;
}

describe("clicking the Difference", () => {
  it("selects est-diff, not one of the groups", () => {
    const g = item();
    const scene = buildPlotScene(g.table, g.plot as Plot, SIZE);
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    const grp = container.querySelector('[data-mady-series="est-diff"]')!;
    fireEvent.click(grp.querySelector("circle")!);
    expect((picks[0] as { columnId: string }).columnId).toBe("est-diff");
  });

  it("opens a panel that names it with a heading", () => {
    const { container } = panel();
    expect(container.querySelector("[data-diff-head]")?.textContent).toContain("Difference");
    expect(container.textContent).toContain("bootstrap confidence interval");
  });

  it("a group's panel is not given that heading", () => {
    // The control case: without it, "the heading is there" could be true of every series.
    const { container } = panel(item().table.columns[1]!.id);
    expect(container.querySelector("[data-diff-head]")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The scope toggles do not reach the raw groups.
// ─────────────────────────────────────────────────────────────────────────────
describe("scope", () => {
  it("the Difference offers no whole-graph / whole-series toggle", () => {
    // `onSetSeriesStyleAll` enumerates the table's datasets, so from here it would restyle the
    // two groups — which is not what "apply this to the whole graph" means when the thing you
    // clicked is a computed effect size. The forest plot's summary omits the toggles for the
    // same reason.
    const r = rows(panel().container);
    expect(r).not.toContain("Apply to whole graph");
    expect(r).not.toContain("Apply to whole series");
  });

  it("…but a group still has them", () => {
    expect(rows(panel(item().table.columns[1]!.id).container)).toContain("Apply to whole graph");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No control that does nothing, and the offered ones reach the drawing.
// ─────────────────────────────────────────────────────────────────────────────
describe("every control on the Difference does something", () => {
  it("offers no error-bar Type / Direction / Caps rows — its whisker is a bootstrap CI", () => {
    const r = rows(panel().container);
    expect(r).not.toContain("Type");
    expect(r).not.toContain("Direction");
    expect(r).not.toContain("Caps");
    // …and the rows that do work are there.
    expect(r).toContain("Thickness");
    expect(r).toContain("Cap width");
  });

  /**
   * The same claim, against what the panel does — the gate is the Difference, not the kind.
   *
   * An estimation group draws no error bar under any setting (`errorBars` "sd" and "none" build
   * an identical scene), so a Type menu there would do nothing, and the whole section is
   * refused out loud on a group. If anyone made `isEstimationDiff` kind-wide, `showErrX` would go true for the group too and the
   * group would keep the whisker rows instead of the refusal — which is what this fails on.
   */
  it("a group is refused out loud — the whisker exemption is the Difference's, not the kind's", () => {
    const g = panel(item().table.columns[1]!.id).container;
    expect(rows(g)).not.toContain("Type");
    expect(rows(g), "the Difference's live whisker rows must not leak onto a group").not.toContain("Thickness");
    expect(g.querySelector('[data-refusal="Error bars"]')?.textContent).toMatch(/no error bar to style/);
  });

  /**
   * Each control, driven, then the patch applied and the scene rebuilt. Only the rebuilt scene
   * shows whether a row does anything — asking the panel proves nothing.
   */
  for (const [label, value, read] of [
    ["Shape", "square", (s: ReturnType<typeof build>) => diff(s).symbol],
    ["Size", "12", (s: ReturnType<typeof build>) => diff(s).symbolSize],
  ] as const) {
    it(`${label} reaches the drawing`, () => {
      const before = read(build());
      const { container, writes } = panel();
      const el = control<HTMLSelectElement>(container, label)!;
      expect(el, `${label} is not on the panel`).toBeDefined();
      fireEvent.change(el, { target: { value } });
      expect(writes.length, `${label} wrote nothing`).toBeGreaterThan(0);
      const after = read(build(writes.at(-1)!.patch as Record<string, unknown>));
      expect(after, `${label} wrote a field the builder ignores`).not.toEqual(before);
    });
  }

  it("Shape specifically — not hard-coded to a circle", () => {
    expect(diff(build()).symbol).toBe("circle");
    expect(diff(build({ symbol: "square" })).symbol).toBe("square");
  });

  it("the bootstrap distribution takes its own colour and opacity, apart from the marker", () => {
    // The half-violin is drawn from fillColor / fillOpacity; the marker from color / symbol*.
    // Without a control for either, the distribution could only be the dot's colour. Setting
    // the fill must not drag the marker with it.
    const s = build({ color: "#0000ff", fillColor: "#ff0000", fillOpacity: 0.3 });
    expect(diff(s).fillColor).toBe("#ff0000");
    expect(diff(s).fillOpacity).toBe(0.3);
    expect(diff(s).color, "the marker followed the distribution's fill").toBe("#0000ff");
  });

  it("…and the Fill controls for it are on the panel", () => {
    const r = rows(panel().container);
    expect(r).toContain("Fill");
    expect(r).toContain("Opacity");
  });

  it("the violin is drawn with that fill — not just stored on the series", () => {
    const scene = build({ fillColor: "#ff0000", fillOpacity: 0.3 });
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const grp = container.querySelector('[data-mady-series="est-diff"]')!;
    const violin = [...grp.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#ff0000");
    expect(violin, "the bootstrap distribution is not drawn in its own fill").toBeDefined();
    expect(violin!.getAttribute("fill-opacity")).toBe("0.3");
  });
});
