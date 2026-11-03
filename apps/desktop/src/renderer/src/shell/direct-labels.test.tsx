// @vitest-environment jsdom
/**
 * Direct labels — offered exactly where they can be drawn, and drawn where they are offered.
 *
 * Guards against a control that promises something the drawing cannot do. "Direct labels
 * (no legend)" appears in the same Position dropdown that decides where a legend sits, so on a
 * pie or a volcano it would be one click to a figure that lost its key and gained nothing.
 *
 * The list is derived from the builder here, never from a copy: every gallery card is built
 * with the option on, and the Inspector is asked whether it offers it. The two cannot drift.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector, DIRECT_LABEL_KINDS } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const asDirect = (plot: Plot): Plot => ({ ...plot, legend: { ...plot.legend, show: true, position: "direct" } });

/** Does the builder name any series on the drawing for this card? */
const buildsNames = (item: { table: never; plot: Plot }): boolean =>
  buildPlotScene(item.table, asDirect(item.plot), SIZE).series.some((s) => s.directLabel != null);

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Is "Direct labels" an option in the Inspector's legend Position control for this card? */
function offersDirect(item: { table: never; plot: Plot }): boolean {
  const { container, unmount } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const found = [...container.querySelectorAll("option")].some((o) => (o as HTMLOptionElement).value === "direct");
  unmount();
  return found;
}

describe("direct labels — offered where they work", () => {
  const cards = galleryItems() as unknown as { table: never; plot: Plot }[];

  it("the gallery is loaded (guards the check itself)", () => {
    expect(cards.length).toBeGreaterThan(30);
  });

  it("the Inspector offers the option on exactly the kinds whose builder draws names", () => {
    // By kind: one card is enough to decide a kind, and several kinds have more than one card.
    const draws = new Map<string, boolean>();
    for (const c of cards) {
      const k = c.plot.kind ?? "xy";
      draws.set(k, (draws.get(k) ?? false) || buildsNames(c));
    }
    const wrong: string[] = [];
    for (const [k, can] of draws) if (can !== DIRECT_LABEL_KINDS.has(k)) wrong.push(`${k}: builder ${can ? "draws" : "draws no"} names, Inspector ${DIRECT_LABEL_KINDS.has(k) ? "offers" : "hides"} the option`);
    expect(wrong, `DIRECT_LABEL_KINDS is out of step with the builder:\n  - ${wrong.join("\n  - ")}\n`).toEqual([]);
  });

  /**
   * The constant above is only half the promise — this asks the rendered control, which is what
   * a user actually meets.
   *
   * A 60s timeout, because this mounts the whole Inspector once per kind; that exceeds the 5s
   * default under a full-suite run. One card per kind,
   * because a kind's answer cannot vary between its cards.
   */
  it("and the dropdown agrees with that list on every kind", () => {
    const wrong: string[] = [];
    const done = new Set<string>();
    for (const c of cards) {
      const k = c.plot.kind ?? "xy";
      if (done.has(k)) continue;
      // Kinds with no legend at all hide the whole block — nothing to check there.
      if (buildPlotScene(c.table, { ...c.plot, legend: { ...c.plot.legend, show: true } }, SIZE).legend.length === 0) continue;
      done.add(k);
      if (offersDirect(c) !== DIRECT_LABEL_KINDS.has(k)) wrong.push(`${k} (${c.plot.name})`);
    }
    expect(done.size, "no kind was checked — the check stopped measuring").toBeGreaterThan(20);
    expect(wrong, `the Position dropdown disagrees with DIRECT_LABEL_KINDS on: ${wrong.join(", ")}`).toEqual([]);
  }, 60_000);
});

describe("direct labels — drawn, clickable, draggable, renameable", () => {
  const card = (galleryItems() as unknown as { table: never; plot: Plot }[])
    .find((c) => (c.plot.kind ?? "xy") === "xy")!;
  const scene = () => buildPlotScene(card.table, asDirect(card.plot), SIZE);

  it("prints every series' name on the chart and no legend box", () => {
    const s = scene();
    const { container } = render(<PlotFigure scene={s} />);
    expect(container.querySelector(".gfx-legend"), "a legend box was drawn as well as the names").toBeNull();
    const text = container.textContent ?? "";
    for (const ser of s.series) if (ser.directLabel) expect(text).toContain(ser.directLabel.text);
  });

  it("a name is drawn in its own series' colour, so it keys the curve", () => {
    const s = scene();
    const named = s.series.filter((x) => x.directLabel);
    expect(named.length).toBeGreaterThan(1);
    const { container } = render(<PlotFigure scene={s} />);
    for (const ser of named) {
      const el = [...container.querySelectorAll("text")].find((t) => t.textContent === ser.directLabel!.text);
      expect(el, `"${ser.name}" is not on the chart`).toBeTruthy();
      expect(el!.getAttribute("fill")).toBe(ser.color);
    }
  });

  /**
   * The name is the legend row's text, not the series' name. A ROC row reads
   * "Biomarker (AUC 0.860, 95% CI …)" for a series called "Biomarker", and the AUC is the whole
   * reason a ROC carries a key. Drawing `series.name` would throw it away.
   */
  it("keeps everything the legend row said — a ROC name still carries its AUC", () => {
    const roc = (galleryItems() as unknown as { table: never; plot: Plot }[])
      .find((c) => (c.plot.kind ?? "xy") === "roc")!;
    const s = buildPlotScene(roc.table, asDirect(roc.plot), SIZE);
    const named = s.series.filter((x) => x.directLabel);
    expect(named.length).toBeGreaterThan(0);
    expect(named.map((x) => x.directLabel!.text).join(" "), "the ROC name lost the AUC the legend row carried").toContain("AUC");
    const { container } = render(<PlotFigure scene={s} />);
    expect(container.textContent).toContain(named[0]!.directLabel!.text);
  });

  // A name is drawn with the legend font, and the series panel has no size for it, so a click on a
  // name opens Text ▸ Title & legend, exactly like a legend label; the line and points still select the series.
  it("clicking a name opens its size (Title & legend), like a legend label", () => {
    const s = scene();
    const onSelect = vi.fn();
    const ser = s.series.find((x) => x.directLabel)!;
    const { container } = render(<PlotFigure scene={s} onSelect={onSelect} />);
    const el = [...container.querySelectorAll("text")].find((t) => t.textContent === ser.directLabel!.text)!;
    fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
    fireEvent.click(el);
    expect(onSelect).toHaveBeenCalledWith({ kind: "chart-section", title: "Title & legend" });
    expect(onSelect).not.toHaveBeenCalledWith({ kind: "series", columnId: ser.id });
  });

  it("the user's drag rides on top of the placement", () => {
    const s = scene();
    const ser = s.series.find((x) => x.directLabel)!;
    const base = ser.directLabel!;
    const moved = buildPlotScene(card.table, {
      ...asDirect(card.plot),
      seriesStyles: { ...card.plot.seriesStyles, [ser.id]: { ...card.plot.seriesStyles?.[ser.id], directLabelOffset: { dx: 17, dy: -23 } } },
    }, SIZE).series.find((x) => x.id === ser.id)!;
    // The rule's placement is unchanged; the drag is carried separately and added by the renderer.
    expect(moved.directLabel!.x).toBeCloseTo(base.x, 5);
    expect(moved.directLabel!.offset).toEqual({ dx: 17, dy: -23 });
    const { container } = render(<PlotFigure scene={{ ...s, series: s.series.map((x) => (x.id === ser.id ? moved : x)) }} />);
    const el = [...container.querySelectorAll("text")].find((t) => t.textContent === ser.directLabel!.text)!;
    expect(el.getAttribute("transform"), "the drag was not applied to the drawn name").toBe("translate(17 -23)");
  });
});

/**
 * Two placement cases, each pinned on the card whose geometry can exhibit it.
 *
 * Both need a real card's geometry to appear at all, so synthetic fixtures cannot guard them.
 */
describe("direct labels — placement on real cards", () => {
  const cards = galleryItems() as unknown as { table: never; plot: Plot }[];
  const card = (name: string) => cards.find((c) => c.plot.name === name || c.plot.id === name)!;
  const measure = (t: string, px: number) => t.length * px * 0.6;
  const built = (name: string) => buildPlotScene(card(name).table, asDirect(card(name).plot), { ...SIZE, measure });

  /**
   * Two keys cannot name one series. The ternary's four rows (Sand · Loam · Silt · Clay)
   * all point at the same single cloud of points, so each name would overwrite the last: the chart
   * would draw one, arbitrarily chosen, in the first row's colour, on a differently-coloured point,
   * repeating an edge title already on the axis — and say nothing, because every row has resolved
   * to a series. Guards against three keys being lost silently.
   */
  it("the ternary names nothing and says why, instead of drawing one key of four", () => {
    const s = built("p-ternary");
    const rows = s.legendLayout.directEntries ?? [];
    expect(rows.length, "the ternary fixture does not have several keys on one series").toBeGreaterThan(1);
    expect(new Set(rows.map((e) => (e.select?.as === "series" ? e.select.id : e.label))).size,
      "the fixture's keys do not share a series — it cannot exhibit the defect").toBe(1);
    expect(s.series.every((x) => x.directLabel == null), "a key was drawn for a series four keys claim").toBe(true);
    const said = s.warnings.filter((w) => w.toLowerCase().includes("direct label"));
    expect(said, "three keys vanished without a word").toHaveLength(1);
    for (const e of rows) expect(said[0], `the warning does not name "${e.label}"`).toContain(e.label);
  });

  /**
   * A name off the canvas is a dropped name. Four ranked lines converging at the right
   * edge with an 18px legend font: guards against names placed past the plot's right edge,
   * where only their first letters would show. The placer warns (it is genuinely crowded),
   * but a warning about a label nobody can see is not the contract.
   */
  it("every name on the bump chart is inside the plot, crowded or not", () => {
    const s = built("p-bump");
    const named = s.series.filter((x) => x.directLabel);
    expect(named.length, "the bump fixture drew no names").toBeGreaterThan(2);
    expect(s.warnings.some((w) => w.toLowerCase().includes("direct label")),
      "the bump card is not crowded — it cannot exhibit the defect").toBe(true);
    for (const ser of named) {
      const d = ser.directLabel!;
      const w = measure(d.text, s.fonts.legend.size) * 1.15;
      const x1 = d.anchor === "end" ? d.x - w : d.x;
      expect(x1, `"${d.text}" starts left of the plot`).toBeGreaterThanOrEqual(s.plot.x - 0.5);
      expect(x1 + w, `"${d.text}" runs off the right of the plot`).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5);
      expect(d.y).toBeGreaterThanOrEqual(s.plot.y - 0.5);
      expect(d.y).toBeLessThanOrEqual(s.plot.y + s.plot.height + 0.5);
    }
  });
});
