// @vitest-environment jsdom
// Category groups that reach the scene must be drawn, on every chart.
//
// Guards against a figure that draws none of the resolved groups (`scene.categoryGroups`, coloured
// ticks) — no names, no dividing lines, no tint, no coloured labels. The lollipop and the paired
// dot plot render through their own figure components, so group drawing in the main figure alone
// does not cover them. The jsdom sweep in `Inspector.categoryaxis.test.tsx` cannot catch this,
// because it reads the scene, not the drawing.
//
// This renders the real figure and reads each part of the grouping back out of the DOM, on every
// gallery card and the flipped form of each kind that has one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { dataAxisOf, xColumn } from "@mady/core";
import { buildPlotScene, categoryTicks, tickCategoryName } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);

const cards = galleryItems().flatMap((g) => {
  const base = { key: g.key, plot: g.plot as Plot, table: g.table as DataTable };
  const kind = base.plot.kind ?? "xy";
  if (FLIPPABLE.has(kind) && (base.plot.barOrientation ?? "vertical") !== "horizontal") {
    return [base, { ...base, key: `${g.key} (flipped)`, plot: { ...base.plot, barOrientation: "horizontal" } as Plot }];
  }
  // A lollipop is horizontal by default; its vertical form carries the category names along X.
  if (kind === "lollipop" && (base.plot.barOrientation ?? "horizontal") === "horizontal") {
    return [base, { ...base, key: `${g.key} (flipped)`, plot: { ...base.plot, barOrientation: "vertical" } as Plot }];
  }
  return [base];
});

/** Every (card, axis) whose axis carries category names, grouped in two halves with the tint on. */
const cases = cards.flatMap((c) => {
  if ((c.plot.kind ?? "xy") === "upset") return []; // computed intersections: no grouping exists
  const s = buildPlotScene(c.table, c.plot, SIZE);
  return (["x", "y"] as const).flatMap((axis) => {
    const ax = axis === "x" ? s.x : s.y;
    if (!ax.band || ax.hidden) return [];
    const cats = categoryTicks(ax).map(tickCategoryName);
    if (cats.length < 2) return [];
    const half = Math.ceil(cats.length / 2);
    const map = Object.fromEntries(cats.map((n, i) => [n, i < half ? "Alpha group" : "Beta group"]));
    const key = dataAxisOf(c.plot, axis) === "x" ? "xAxis" : "yAxis";
    const plot = { ...c.plot, [key]: { ...(c.plot[key] ?? {}), categoryGroups: { map, tint: true } } } as Plot;
    return [{ ...c, axis, plot }];
  });
});

describe("category groups survive the layout decisions around them", () => {
  /**
   * A shortened name still groups by its full name. A narrow figure shortens long row names
   * ("Cannabis use disord…"). If the By-hand boxes were named after the shortened text, those
   * names would no longer match at another figure width — on the paired dot plot "Educational
   * attainment" and "Cannabis use disorder" would stay uncoloured, fall out of their group and
   * split it in two, with the group name drawn twice.
   */
  it("paired dot: names read on a narrow figure are the full names, and group every row on a wide one", () => {
    const card = cards.find((c) => c.plot.kind === "paireddot" && !c.key.endsWith("(flipped)"))!;
    const narrow = buildPlotScene(card.table, card.plot, SIZE);
    expect(narrow.y.ticks.some((t) => t.label.endsWith("…")), "no row name is shortened at this size — the fixture cannot show the defect").toBe(true);

    const xc = xColumn(card.table)!;
    const full = card.table.rows.map((r) => String(r.cells[xc.id] ?? ""));
    const names = categoryTicks(narrow.y).map(tickCategoryName);
    expect(names, "the names a group list is keyed by are the shortened labels, not the categories").toEqual(full);

    const half = Math.ceil(names.length / 2);
    const map = Object.fromEntries(names.map((n, i) => [n, i < half ? "Alpha group" : "Beta group"]));
    const wide = buildPlotScene(card.table, { ...card.plot, yAxis: { ...(card.plot.yAxis ?? {}), categoryGroups: { map } } } as Plot, { width: 1600, height: 420 });
    const uncoloured = categoryTicks(wide.y).filter((t) => !t.color).map(tickCategoryName);
    expect(uncoloured, "these rows fell out of their group at another figure width").toEqual([]);
    expect((wide.categoryGroups ?? []).map((g) => g.label), "a group was split in two").toEqual(["Alpha group", "Beta group"]);
  });

  /**
   * Group names down the right edge clear an outside legend. Guards against placing the names
   * past a legend width estimated with a fixed 18px symbol column: the real column grows with the
   * legend font and the marker size, so on a horizontal "Stacked bars + line" chart the names
   * would run through "Product C" and "Growth (%)".
   *
   * Measured in the renderer's own legend model (`Legend` in PlotFigure.tsx: box from
   * plotRight + gap + outsidePad, width = symbol column + widest label at len × font × 0.6 + padding),
   * so this compares with what is drawn, not with the builder's arithmetic.
   */
  it("names written down the right edge start past an outside-right legend", () => {
    const WIDE = { width: 900, height: 520 };
    const checked: string[] = [];
    const clashes: string[] = [];
    for (const c of cases.filter((x) => x.axis === "y")) {
      const s = buildPlotScene(c.table, c.plot, WIDE);
      const L = s.legendLayout;
      if (L.position !== "right" || s.legend.length === 0) continue;
      const fs = s.fonts.legend.size;
      const boxRight = s.plot.x + s.plot.width + (L.gap ?? 12) + (L.outsidePad ?? 0)
        + (L.swatchWidth ?? 18) + Math.max(0, ...s.legend.map((e) => e.label.length * fs * 0.6)) + 2 * (L.padding ?? 6);
      for (const g of s.categoryGroups ?? []) {
        if (!g.name || g.axis !== "y") continue;
        checked.push(c.key);
        // A name turned 90° runs down the page; its glyphs sit from ~a quarter em left of the anchor.
        const nameLeft = g.name.x - fs * 0.25;
        if (nameLeft < boxRight) clashes.push(`${c.key}: "${g.label}" starts at x=${nameLeft.toFixed(1)}, inside the legend that runs to x=${boxRight.toFixed(1)}`);
      }
    }
    expect(checked.some((k) => k.startsWith("stackline")), "the horizontal stacked-bars card was not checked — the fixture cannot show the defect").toBe(true);
    expect(clashes, clashes.join("\n")).toEqual([]);
  });
});

describe("category groups are drawn, not just resolved", () => {
  it("covers every kind that carries category names (a shrinking list means coverage vanished)", () => {
    const kinds = new Set<string>(cases.map((c) => c.plot.kind ?? "xy"));
    for (const k of ["bar", "box", "violin", "scatter", "beforeafter", "raincloud", "floatingbar", "dendrogram", "histogram",
      "forest", "pyramid", "ridgeline", "lollipop", "paireddot", "swimmer", "tracks"]) {
      expect(kinds.has(k), `no card of kind "${k}" reached this check`).toBe(true);
    }
  });

  for (const c of cases) {
    it(`${c.key} · ${c.axis}: names, dividing line, tint and coloured labels are in the figure`, () => {
      const scene = buildPlotScene(c.table, c.plot, SIZE);
      const groups = (scene.categoryGroups ?? []).filter((g) => g.axis === c.axis);
      expect(groups.map((g) => g.label), `${c.key}: the builder did not resolve the groups — this would test the builder, not the figure`)
        .toEqual(["Alpha group", "Beta group"]);

      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
      const texts = [...container.querySelectorAll("text")];
      const missing: string[] = [];
      for (const g of groups) {
        if (g.name && !texts.some((t) => (t.textContent ?? "").trim() === g.label)) missing.push(`the name "${g.label}"`);
        if (g.separator && ![...container.querySelectorAll("line")].some((l) =>
          l.getAttribute("stroke") === g.color && Math.abs(Number(l.getAttribute("y1")) - g.separator!.y1) < 0.01
          && Math.abs(Number(l.getAttribute("x1")) - g.separator!.x1) < 0.01)) missing.push(`the dividing line before "${g.label}"`);
        if (g.tint && ![...container.querySelectorAll("rect")].some((r) =>
          r.getAttribute("fill") === g.color && Math.abs(Number(r.getAttribute("x")) - g.tint!.x) < 0.01
          && Math.abs(Number(r.getAttribute("y")) - g.tint!.y) < 0.01)) missing.push(`the tint behind "${g.label}"`);
      }
      // Each grouped category's own label is drawn in its group's colour.
      const ax = c.axis === "x" ? scene.x : scene.y;
      for (const t of categoryTicks(ax)) {
        if (!t.color || t.label === "") continue;
        if (!texts.some((el) => (el.textContent ?? "").trim() === t.label && el.getAttribute("fill") === t.color)) {
          missing.push(`the label "${t.label}" in its group colour`);
        }
      }
      expect(missing, `${c.key} · ${c.axis}: resolved but not drawn — ${missing.join("; ")}`).toEqual([]);
    });
  }
});
