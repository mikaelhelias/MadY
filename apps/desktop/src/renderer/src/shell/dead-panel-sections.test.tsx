// @vitest-environment jsdom
/**
 * Default-deny: a panel section that is on screen must be able to change the drawing.
 *
 * The Inspector has two measured registries for this (`deadControls.ts`) — but the test behind
 * them carries a hand-written `curated` escape list of kinds it never measures, on the grounds
 * that their rows are hand-picked per kind, so marker / error-bar / value-label controls on
 * those kinds would otherwise go unmeasured.
 *
 * This guard has no escape list, because it does not ask which branch built the rows. It renders
 * the real panel, reads the sections a user can see, and asks the drawing whether they do
 * anything. Three sections, three questions:
 *
 *   Data points      — at least one of its rows must move the drawing
 *   Error bars       — the Type select must offer a type that draws something
 *   Value label font — the font must move the drawing
 *
 * A row hidden behind its own `show:` predicate is not on screen and is not asked about; the
 * question is only ever about what a user is actually looking at.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";
import { FRAME_DEAD_KINDS, NO_MARKER_KINDS } from "./deadControls";
import { INK_SIZE, inkDiffers } from "./inkOracle";
import type { GraphSelection } from "./AppShell";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const H = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** A row a user can see: its group heading and its label. */
interface Row { group: string; label: string; el: HTMLElement }

const rowsOf = (c: HTMLElement): Row[] => {
  const out: Row[] = [];
  for (const el of c.querySelectorAll<HTMLElement>("label.frow, div.frow")) {
    const label = (el.querySelector(":scope > span")?.textContent ?? "").trim();
    if (!label) continue;
    let shown = true;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.hidden) shown = false;
    if (!shown) continue;
    let group = "";
    for (let n: Element | null = el.previousElementSibling; n; n = n.previousElementSibling) {
      // The heading carries a disclosure triangle ("▾Data points"). Matching the bare name
      // would find nothing, and every kind would read "the section is not shown".
      if (n.classList.contains("inspsub")) { group = (n.textContent ?? "").trim().replace(/^[^\p{L}]+/u, ""); break; }
    }
    out.push({ group, label, el });
  }
  return out;
};

/** Every id a series style could be keyed by — scene series, datasets, columns, rows. */
const styleIds = (t: DataTable, p: Plot, lk: ReturnType<typeof galleryLookup>): string[] => {
  const scene = buildPlotScene(t, p, { ...INK_SIZE, tables: lk });
  return [...new Set([
    ...scene.series.map((s) => s.id),
    ...tableDatasets(t).map((d) => d.id),
    ...t.columns.map((c) => c.id),
  ])];
};

/**
 * What is kept of a row once its panel is closed: its names and, for a menu, the values it offers.
 * Never the element. One kept element holds its whole closed panel in memory, and this file
 * keeps a row for every panel of every gallery chart — keeping elements would take the test
 * process past 4 GB.
 */
interface KeptRow { group: string; label: string; options: string[] }

interface Card { key: string; kind: string; table: DataTable; plot: Plot; lk: ReturnType<typeof galleryLookup>; rows: KeptRow[]; seriesPanel: boolean }

/** Hand control back so whatever each closed panel queued can run and its memory be freed. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Render every panel this figure can open, and keep the rows.
 *
 * The selections are discovered by driving the figure, never hand-listed — a panel a user
 * cannot open is not a panel, and scoring rows in one would produce many false findings per
 * kind. A kind whose figure opens no series panel is simply not asked the series-panel
 * questions.
 */
async function readCards(): Promise<Card[]> {
  const out: Card[] = [];
  for (const item of galleryItems()) {
    const t = item.table as DataTable, p = item.plot as Plot, lk = galleryLookup(item);
    const scene = buildPlotScene(t, p, { ...INK_SIZE, tables: lk });
    const found = new Map<string, GraphSelection>();
    const fig = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => { if (s) found.set(JSON.stringify(s), s); }} />);
    for (const el of fig.container.querySelectorAll("path, circle, rect, text, polygon, line, g")) {
      fireEvent.click(el);
      fireEvent.pointerDown(el, { button: 0, pointerId: 1 });
      fireEvent.pointerUp(el, { button: 0, pointerId: 1 });
    }
    cleanup();
    await settle();

    const rows: KeptRow[] = [];
    let seriesPanel = false;
    globalThis.localStorage?.setItem("mady.applyWholeSeries", "1");
    for (const sel of found.values()) {
      if ((sel as { kind: string }).kind === "plot") continue;
      const r = render(<Inspector activeSection="graphs" selection={sel} plot={p} table={t} userPresets={[]} profileDefault={null} {...H()} />);
      const here = rowsOf(r.container);
      if ((sel as { kind: string }).kind === "series" && here.length) seriesPanel = true;
      rows.push(...here.map((row) => ({ group: row.group, label: row.label, options: [...(row.el.querySelector("select")?.options ?? [])].map((o) => o.value) })));
      cleanup();
      await settle();
    }
    globalThis.localStorage?.clear();
    out.push({ key: item.key, kind: item.plot.kind ?? "xy", table: t, plot: p, lk, rows, seriesPanel });
  }
  return out;
}

let CARDS: Card[] = [];
beforeAll(async () => { CARDS = await readCards(); }, 300_000);

const styled = (c: Card, extra: Record<string, unknown>): Plot => {
  const ss: Record<string, unknown> = { ...((c.plot.seriesStyles ?? {}) as Record<string, unknown>) };
  for (const id of styleIds(c.table, c.plot, c.lk)) ss[id] = { ...((ss[id] as object) ?? {}), ...extra };
  return { ...c.plot, seriesStyles: ss } as Plot;
};

describe("a panel section on screen must be able to change the drawing", () => {
  it("Data points: at least one row on screen moves the drawing", () => {
    const dead: string[] = [];
    for (const c of CARDS) {
      if (!c.rows.some((r) => r.group === "Data points")) continue;
      // Every marker row the section can carry, as the pair of values that would tell them apart.
      const pairs: [Record<string, unknown>, Record<string, unknown>][] = [
        [{ symbol: "square" }, { symbol: "circle" }],
        [{ symbolSize: 16 }, { symbolSize: 3 }],
        [{ symbolFill: "open" }, { symbolFill: "solid" }],
        [{ symbolOpacity: 0.2 }, { symbolOpacity: 1 }],
        [{ symbolBorderWidth: 6, borderWidth: 6 }, { symbolBorderWidth: 0.5, borderWidth: 0.5 }],
        [{ color: "#ff0000" }, { color: "#0000ff" }],
      ];
      if (!pairs.some(([a, b]) => inkDiffers(c.table, styled(c, a), styled(c, b), c.lk))) dead.push(`${c.kind}/${c.key}`);
    }
    expect(dead, `the Data points section is on screen and every one of its rows is inert on: ${dead.join(", ")}`).toEqual([]);
  }, 120_000);

  it("Error bars: the Type select offers a type that draws something", () => {
    const dead: string[] = [];
    for (const c of CARDS) {
      const typeRow = c.rows.find((r) => r.group === "Error bars" && r.label === "Type");
      if (!typeRow) continue;
      const offered = typeRow.options.filter((v) => v !== "none");
      const draws = offered.some((v) => inkDiffers(c.table, styled(c, { errorBars: v }), styled(c, { errorBars: "none" }), c.lk));
      if (!draws) dead.push(`${c.kind}/${c.key} (Type offers ${offered.join("/") || "nothing but None"})`);
    }
    expect(dead, `the Error bars section is on screen and can draw no error bar on: ${dead.join(", ")}`).toEqual([]);
  }, 120_000);

  /**
   * The other direction.
   *
   * The test above only asks whether what is on screen is live; it cannot see a section that a
   * gate withholds, so a gate that hides a working control would pass it. This test guards
   * against that: a gate keyed on whether a row carries replicates or an entered spread
   * (`drawableErrorTypes`) would hide the error bars on column-format charts that pool their
   * rows (a column bar, a column scatter), where the control works.
   *
   * So: if the section is not offered, forcing an error type must not change the drawing.
   */
  it("Error bars: a section not offered must be one the drawing cannot use either", () => {
    const taken: string[] = [];
    for (const c of CARDS) {
      if (!c.seriesPanel) continue;                                   // no series panel → no claim
      if (c.rows.some((r) => r.group === "Error bars")) continue;     // offered; the test above judges it
      const draws = ["sd", "sem", "range", "iqr"].some((v) =>
        inkDiffers(c.table, styled(c, { errorBars: v }), styled(c, { errorBars: "none" }), c.lk));
      if (draws) taken.push(`${c.kind}/${c.key}`);
    }
    expect(taken, `the drawing does draw an error bar here and no control offers one: ${taken.join(", ")}`).toEqual([]);
  }, 120_000);

  it("Value label font: the font on screen moves the drawing", () => {
    const dead: string[] = [];
    for (const c of CARDS) {
      if (!c.rows.some((r) => /^Value label font/.test(r.group))) continue;
      const font = (size: number, color: string): Plot =>
        ({ ...c.plot, fonts: { ...(c.plot.fonts ?? {}), valueLabel: { ...(c.plot.fonts?.valueLabel ?? {}), size, color } } }) as Plot;
      if (!inkDiffers(c.table, font(26, "#ff0000"), font(8, "#0000ff"), c.lk)) dead.push(`${c.kind}/${c.key}`);
    }
    expect(dead, `the Value label font block is on screen and the drawing ignores it on: ${dead.join(", ")}`).toEqual([]);
  }, 120_000);
});

/**
 * …and the other half of the contract: a section that is withheld must say so.
 *
 * Both registries in `deadControls.ts` carry a sentence per kind; without it on screen the
 * section would simply disappear between chart kinds with no reason given. These hold the
 * sentences on screen.
 */
describe("a withheld section states its refusal", () => {
  const panel = (c: Card, sel: GraphSelection): HTMLElement => {
    const r = render(<Inspector activeSection="graphs" selection={sel} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...H()} />);
    return r.container;
  };
  const firstSeriesSel = (c: Card): GraphSelection | undefined => {
    const scene = buildPlotScene(c.table, c.plot, { ...INK_SIZE, tables: c.lk });
    const id = scene.series[0]?.id ?? tableDatasets(c.table)[0]?.id;
    return id ? ({ kind: "series", columnId: id } as GraphSelection) : undefined;
  };

  it("NO_MARKER_KINDS: the marker rows are gone and the sentence is on screen", () => {
    const kinds = Object.keys(NO_MARKER_KINDS).filter((k) => CARDS.some((c) => c.kind === k));
    expect(kinds.length, "no gallery card for any registered marker-less kind").toBeGreaterThan(5);
    for (const kind of kinds) {
      const c = CARDS.find((x) => x.kind === kind)!;
      const sel = firstSeriesSel(c);
      if (!sel) continue;
      const el = panel(c, sel);
      const said = el.querySelector('[data-refusal="Data points"]');
      expect(said?.textContent, `${kind}: the Data points section vanished without saying why`).toBe(NO_MARKER_KINDS[kind]);
      const rows = rowsOf(el).filter((r) => r.group === "Data points");
      expect(rows.map((r) => r.label), `${kind}: refused section still shows rows`).toEqual([]);
      cleanup();
    }
  }, 60_000);

  it("FRAME_DEAD_KINDS: the Grid/frame section states why instead of disappearing", () => {
    /* Network is exempt by design, not by oversight: its Frame section stays absent with no
       replacement note, and `Inspector.network.test.tsx` holds that. Listing it here would
       contradict that rule. */
    const kinds = Object.keys(FRAME_DEAD_KINDS).filter((k) => k !== "network" && CARDS.some((c) => c.kind === k));
    expect(kinds.length).toBeGreaterThan(5);
    for (const kind of kinds) {
      const c = CARDS.find((x) => x.kind === kind)!;
      const el = panel(c, { kind: "plot" } as GraphSelection);
      const btn = [...el.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => (b.textContent ?? "").trim() === "Frame");
      if (btn && !btn.classList.contains("disabled")) fireEvent.click(btn);
      const said = [...el.querySelectorAll("p.hint")].find((n) => n.textContent === FRAME_DEAD_KINDS[kind]);
      expect(said, `${kind}: the Grid, frame & axes section vanished without saying why`).toBeTruthy();
      cleanup();
    }
  }, 60_000);

  it("Error bars: a one-value-per-row series is refused out loud, a replicate-bearing one is untouched", () => {
    const bare = CARDS.find((c) => c.key === "xy")!;      // plain Y columns — no spread of any kind
    const reps = CARDS.find((c) => c.key === "bar")!;     // replicate subcolumns — the full menu

    const bareEl = panel(bare, firstSeriesSel(bare)!);
    expect(bareEl.querySelector('[data-refusal="Error bars"]')?.textContent, "a series with no spread must say what it would need")
      .toMatch(/replicates \(a grouped datasheet\)/);
    expect(rowsOf(bareEl).filter((r) => r.group === "Error bars").map((r) => r.label), "refused, so no rows — least of all a Type menu offering six intervals it cannot draw")
      .toEqual([]);
    cleanup();

    const repsEl = panel(reps, firstSeriesSel(reps)!);
    expect(repsEl.querySelector('[data-refusal="Error bars"]'), "replicates draw error bars — nothing to refuse").toBeNull();
    const typeRow = rowsOf(repsEl).find((r) => r.group === "Error bars" && r.label === "Type");
    const offered = [...(typeRow?.el.querySelector("select")?.options ?? [])].map((o) => o.value);
    expect(offered, "the full menu must survive for a dataset that can draw every interval")
      .toEqual(["none", "sd", "sem", "ci95", "range", "geoSd", "iqr"]);
    cleanup();
  }, 60_000);

  it("Error bars: a type already saved on a series keeps its menu, even if the data can no longer draw it", () => {
    const bare = CARDS.find((c) => c.key === "xy")!;
    const sel = firstSeriesSel(bare)!;
    const id = (sel as { columnId: string }).columnId;
    const kept: Card = { ...bare, plot: { ...bare.plot, seriesStyles: { ...(bare.plot.seriesStyles ?? {}), [id]: { ...(bare.plot.seriesStyles?.[id] ?? {}), errorBars: "sd" } } } as Plot };
    const el = panel(kept, sel);
    expect(el.querySelector('[data-refusal="Error bars"]'), "refusing here would strand a saved setting with no way to switch it off").toBeNull();
    const typeRow = rowsOf(el).find((r) => r.group === "Error bars" && r.label === "Type");
    expect([...(typeRow?.el.querySelector("select")?.options ?? [])].map((o) => o.value), "the saved value stays listed so the control never goes blank")
      .toContain("sd");
    cleanup();
  }, 60_000);
});
