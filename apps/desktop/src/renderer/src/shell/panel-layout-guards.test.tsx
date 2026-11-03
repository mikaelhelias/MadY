// @vitest-environment jsdom
/**
 * Figure-panel layout. Guards against:
 *  1. a corner letter sitting on a long Y-axis title ("Difference (Method A − Method B)");
 *  2. a card the aligner sets lower than its row leaving its letter tens of px above it;
 *  3. the clustered heatmap's names drawing below 8 px on screen (it fits its names to its cells);
 *  4. a grid read off where a new figure's cards sit keeping an empty top-left slot (half the figure white);
 *  5. a tall ridgeline being centred far in from its column edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { measureText } from "./textMeasure";
import { heatmapReadableScale, LayoutPane, packHoles, yTitleBox } from "./panes";

afterEach(cleanup);
const items = galleryItems();
const card = (t: string) => items.find((g) => g.title === t)!;

function figure(titles: string[], layout: Record<string, unknown> = {}) {
  const picks = titles.map(card);
  const project = {
    schemaVersion: 5,
    tables: picks.map((g, i) => ({ ...g.table, id: `t${i}` })),
    plots: picks.map((g, i) => ({ ...g.plot, id: `P${i}`, source: `t${i}` })),
    analyses: [],
    layouts: [{ id: "L", name: "F", panels: picks.map((_, i) => `P${i}`), freeform: false, alignX: true, alignY: true, labelAlignX: true, labelAlignY: true, panelFontScale: true, ...layout }],
    log: [],
    workspace: { folders: [], loose: [] },
  } as unknown as Project;
  const { container } = render(<LayoutPane project={project} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={vi.fn()} />);
  const panel = (i: number) => container.querySelector(`.laypanel[data-pid="P${i}"]`) as HTMLElement;
  const box = (el: HTMLElement) => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
  return { container, panel, box };
}

describe("yTitleBox — the Y-axis title's box, as the renderer places it", () => {
  const scene = { plot: { x: 80, y: 20, width: 300, height: 200 }, fonts: { yAxisTitle: { size: 20 } } };
  const m = (t: string, px: number) => t.length * px * 0.5;
  it("a turned title is centred on the plot, as tall as its text is long, at titlePos", () => {
    const b = yTitleBox({ ...scene, y: { title: "Response (a.u.)", titlePos: 30 } }, m)!;
    const len = m("Response (a.u.)", 20);
    expect(b.t).toBeCloseTo(120 - len / 2, 6);
    expect(b.b).toBeCloseTo(120 + len / 2, 6);
    expect(b.l).toBeCloseTo(30 - 0.8 * 20, 6); // ascent to the left of the baseline
    expect(b.r).toBeCloseTo(30 + 0.25 * 20, 6);
  });
  it("its own font, its centre and a dragged offset move it", () => {
    const b = yTitleBox({ ...scene, y: { title: "Y", titlePos: 30, titleCenter: 60, titleFont: 10, titleOffset: { dx: 5, dy: -7 } } }, m)!;
    expect((b.t + b.b) / 2).toBeCloseTo(53, 6);
    expect(b.l).toBeCloseTo(35 - 8, 6);
  });
  it("a level (turned to 0°) title runs along x", () => {
    const b = yTitleBox({ ...scene, y: { title: "Rank", titleTurn: { angle: 0, x: 10, y: 15, anchor: "start" } } }, m)!;
    expect(b.l).toBeCloseTo(10, 6);
    expect(b.r).toBeCloseTo(10 + m("Rank", 20), 6);
  });
  it("no title → no box", () => {
    expect(yTitleBox({ ...scene, y: { title: "  " } }, m)).toBeUndefined();
    expect(yTitleBox(scene, m)).toBeUndefined();
  });
});

describe("heatmapReadableScale — from the text a heatmap really draws", () => {
  it("the clustered heatmap: its fitted 9 px names set it (8/9), not its 20 px tick font", () => {
    const g = card("Heatmap — clustered, split, annotated");
    const s = buildPlotScene(g.table, g.plot, { measure: measureText, width: g.plot.figureWidth ?? 823, height: g.plot.figureHeight ?? 595 });
    expect(s.heatmap!.labelFont!.size, "fixture: names fitted to 9 px").toBe(9);
    expect(heatmapReadableScale(s)).toBeCloseTo(8 / 9, 6);
  });
  it("no floor: 26 px names may shrink to 8/26; never above 1; 0 for a non-heatmap", () => {
    const f = { tick: { size: 20 }, legend: { size: 22 } };
    expect(heatmapReadableScale({ fonts: f, heatmap: { labelFont: { size: 26 }, barFont: { size: 26 } } })).toBeCloseTo(8 / 26, 6);
    expect(heatmapReadableScale({ fonts: f, heatmap: { labelFont: { size: 6 } } })).toBe(1);
    expect(heatmapReadableScale({ fonts: f, heatmap: {} })).toBeCloseTo(8 / 12, 6); // capped tick font, as drawn
    expect(heatmapReadableScale({ fonts: f })).toBe(0);
  });
});

describe("packHoles — a grid read off card positions never keeps an empty slot", () => {
  it("B, C above, A below-left in 3 columns → one full row, reading order kept", () => {
    const got = packHoles([{ c: 0, r: 1 }, { c: 1, r: 0 }, { c: 2, r: 0 }], 3, [0, 500, 1000], true);
    expect(got).toEqual([{ c: 2, r: 0 }, { c: 0, r: 0 }, { c: 1, r: 0 }]);
  });
  it("no hole → unchanged (a short last row is not a hole); spanning cards → unchanged", () => {
    const full = [{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 0, r: 1 }];
    expect(packHoles(full, 2, [0, 1, 0], true)).toEqual(full);
    const holed = [{ c: 1, r: 0 }, { c: 0, r: 1 }];
    expect(packHoles(holed, 2, [1, 0], false)).toEqual(holed);
  });
});

describe("the figures that exhibit them", () => {
  it("no corner letter lands on the Bland-Altman's long Y title — the letters stand above the cards", () => {
    const { container } = figure(["Bump chart (rankings)", "Dendrogram", "Timeline tracks", "Bland-Altman"]);
    const letters = [...container.querySelectorAll(".laypanel-letter-float")] as HTMLElement[];
    expect(letters.length, "fixture: four letters").toBe(4);
    for (const l of letters) expect(parseFloat(l.style.top), `letter "${l.textContent}" in its card's corner`).toBeLessThan(0);
  });

  it("the parallel-coordinates card the aligner set lower keeps its letter at its own card", () => {
    // The grid: raincloud + estimation above, the heatmap + parallel coordinates below.
    const { container, panel, box } = figure(["Raincloud", "Estimation (Gardner-Altman)", "Heatmap — clustered, split, annotated", "Parallel coordinates"], { columns: 2 });
    const cards = [0, 1, 2, 3].map((i) => box(panel(i)));
    const par = cards[3]!;
    const rowTop = Math.min(...cards.filter((c) => Math.abs(c.y - par.y) < 150).map((c) => c.y));
    expect(par.y - rowTop, "fixture: the aligner set it lower than its row").toBeGreaterThan(26);
    const letter = panel(3).querySelector(".laypanel-letter-float") as HTMLElement;
    expect(parseFloat(letter.style.top), "its letter is at its own card, not the row's line above it").toBeGreaterThan(-40);
    void container;
  });

  it("the clustered heatmap's names reach 8 px on screen", () => {
    const { panel } = figure(["Heatmap — clustered, split, annotated", "Estimation (Gardner-Altman)", "Raincloud", "Parallel coordinates"]);
    const svg = panel(0).querySelector("svg.gfx-figure") as SVGSVGElement;
    const k = Number(svg.getAttribute("width")) / Number((svg.getAttribute("viewBox") ?? "0 0 1 1").split(" ")[2]);
    const small: string[] = [];
    for (const t of svg.querySelectorAll("text")) {
      if (!(t.textContent ?? "").trim()) continue;
      let el: Element | null = t; let fs = "";
      while (el && !fs) { fs = el.getAttribute("font-size") ?? ""; el = el.parentElement; }
      const px = parseFloat(fs);
      if (Number.isFinite(px) && px * k < 7.95) small.push(`"${(t.textContent ?? "").trim().slice(0, 10)}" ${(px * k).toFixed(1)}`);
    }
    expect([...new Set(small)].slice(0, 8)).toEqual([]);
  });

  it("Align all packs a figure whose cards sat with a hole — no empty slot, one full row", () => {
    // The new figure's own placement: the Venn below-left, the other two above-right.
    const { panel, box } = figure(["Venn diagram", "Bars + line (2nd axis)", "Polar histogram (wind rose)"], {
      panelPositions: { P0: { x: 8, y: 320 }, P1: { x: 300, y: 8 }, P2: { x: 820, y: 8 } },
    });
    const cards = [0, 1, 2].map((i) => box(panel(i)));
    const tops = cards.map((c) => Math.round(c.y));
    expect(new Set(tops).size, `three cards in one row (tops ${tops.join(", ")})`).toBe(1);
    const lefts = cards.map((c) => c.x).sort((a, b) => a - b);
    expect(lefts[0], "the row starts at the figure's left edge").toBeLessThan(20);
  });

  it("a tall ridgeline sits flush on its column edge, not centred beside a wider heatmap", () => {
    // Align all spans the ridgeline over two rows (it is much taller than the sunburst beside it); the readable heatmap
    // below it is the widest card in that column, and neither sets the column's line.
    const { panel, box } = figure(["Ridgeline / horizon fold", "Sunburst", "Treemap", "Heatmap — clustered, split, annotated", "Alluvial / parallel sets"], { columns: 2 });
    const cards = [0, 1, 2, 3, 4].map((i) => box(panel(i)));
    const [ridge, , , heat] = cards as [ReturnType<typeof box>, unknown, unknown, ReturnType<typeof box>];
    expect(ridge.h, "fixture: the ridgeline spans two rows").toBeGreaterThan(cards[1]!.h * 1.8);
    expect(heat.w, "fixture: the heatmap below is wider").toBeGreaterThan(ridge.w + 20);
    expect(ridge.x - heat.x, "ridgeline inset from its column edge").toBeLessThan(2);
  });

  it("a card the user spans over two rows is as tall as those rows — never over the card below it", () => {
    // Sized as 2 × the figure's tallest card, a two-row ridgeline would run over the heatmap in the next row.
    const { panel, box } = figure(["Ridgeline / horizon fold", "Bar / column (+ error bars)", "Sunburst", "Heatmap — clustered, split, annotated", "Alluvial / parallel sets"], { columns: 2, panelRowSpan: { P0: 2 } });
    const ridge = box(panel(0));
    const heat = box(panel(3));
    expect(Math.abs(heat.x - ridge.x), "fixture: the heatmap sits under the ridgeline").toBeLessThan(2);
    expect(ridge.y + ridge.h, "the ridgeline ends above the heatmap").toBeLessThanOrEqual(heat.y + 0.5);
  });

  it("a card spanning two rows that is taller than them pushes the next row down — never over it", () => {
    // The ranked dots keeps its 25 names readable and is lowered to line up its plot top, so it can reach past its
    // two rows; the next row must move down rather than let it overlap the bubble chart below (or an axis title).
    const { panel, box } = figure(["Ranked dots vs a reference", "Bubble-grid heatmap", "Heatmap", "Bubble", "ROC curve"]);
    const cards = [0, 1, 2, 3, 4].map((i) => box(panel(i)));
    expect(cards[0]!.h, "fixture: the ranked dots spans two rows").toBeGreaterThan(cards[1]!.h + cards[2]!.h);
    const over: string[] = [];
    for (let a = 0; a < cards.length; a++)
      for (let b = a + 1; b < cards.length; b++) {
        const A = cards[a]!, B = cards[b]!;
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x), oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
        if (ox > 1 && oy > 1) over.push(`P${a}×P${b} ${Math.round(ox)}×${Math.round(oy)}`);
      }
    expect(over).toEqual([]);
  });
});
