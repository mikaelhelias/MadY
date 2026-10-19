// @vitest-environment jsdom
/**
 * The focus ring is offered only where it reaches the drawing.
 *
 * The Series list writes the table column's id. On most kinds that is the id the builder draws
 * the series under — but not on all of them. Measured over every gallery card by driving the
 * real ring:
 *
 *   • before–after draws one series per subject (`g-ba-r0…`), qq draws `qq`, manhattan draws
 *     `manhattan`, upset draws `__upsetn__` — a ring would write a column id none of them read;
 *   • lollipop · rose · paired dot · treemap · venn · parallel · tracks draw nothing in the
 *     series layer at all, and on some of them the focus warning ("Every series on this chart
 *     is focused") would be wrong after focusing one of several.
 *
 * This drives each ring and checks the id it writes against the ids the scene actually draws, so
 * `FOCUS_KINDS` can never drift from the builder. It checks both directions — a ring that cannot
 * work, and a kind that quietly lost a ring that could.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector, FOCUS_KINDS } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };

const handlers = (set: (id: string, d: SeriesStyle) => void) => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: set, onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Click every focus ring this card offers; return the ids they wrote and how many series the
 *  list showed. Note: the row count, not `scene.series.length`: a ROC scene carries its identity
 *  diagonal as a second series while the list shows one curve, so counting scene series would
 *  report a kind that had "lost" its ring. The list is what the gate keys on, so measure that. */
function ringsWrite(item: { table: never; plot: Plot }): { wrote: string[]; rows: number } {
  const wrote: string[] = [];
  const { container, unmount } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers((id) => wrote.push(id))} />);
  const rows = container.querySelectorAll(".serieslist-row").length;
  for (const r of container.querySelectorAll(".focusbtn")) fireEvent.click(r);
  unmount();
  return { wrote, rows };
}

describe("the focus ring reaches the drawing, everywhere it is offered", () => {
  const cards = galleryItems() as unknown as { table: never; plot: Plot }[];

  it("the gallery is loaded (guards the sweep itself)", () => {
    expect(cards.length).toBeGreaterThan(30);
  });

  /** The core check. Not "is the kind in the list" — click the ring and see
   *  whether the id it writes is a series the chart actually draws. */
  it("every ring writes an id the chart draws", () => {
    const dead: string[] = [];
    let clicked = 0;
    for (const card of cards) {
      const drawn = new Set(buildPlotScene(card.table, card.plot, SIZE).series.map((s) => s.id));
      for (const id of ringsWrite(card).wrote) {
        clicked++;
        if (!drawn.has(id)) dead.push(`${card.plot.kind ?? "xy"} (${card.plot.name}): the ring writes "${id}", which the chart does not draw`);
      }
      cleanup();
    }
    expect(clicked, "no ring was clicked — the sweep is measuring nothing").toBeGreaterThan(15);
    expect(dead, `focus rings that cannot do anything:\n  - ${dead.join("\n  - ")}\n`).toEqual([]);
  }, 300_000);

  /** …and the other direction: a kind must not quietly lose a ring that works. */
  it("every kind in FOCUS_KINDS still offers the ring on at least one card", () => {
    const offering = new Set<string>();
    const multi = new Set<string>();
    for (const card of cards) {
      const { wrote, rows } = ringsWrite(card);
      if (wrote.length > 0) offering.add(card.plot.kind ?? "xy");
      // A card that lists two or more series is one where focus has something to contrast.
      if (rows >= 2) multi.add(card.plot.kind ?? "xy");
      cleanup();
    }
    // Single-series cards legitimately show no ring (nothing to push into the background), so a
    // kind counts as lost only when it lists ≥2 series somewhere and still offers none.
    const reallyLost = [...FOCUS_KINDS].filter((k) => multi.has(k) && !offering.has(k));
    expect(reallyLost, `these kinds can focus but offer no ring: ${reallyLost.join(", ")}`).toEqual([]);
    expect(offering.size, "no kind offers the ring at all").toBeGreaterThan(5);
  }, 300_000);

  /** The kinds whose list ids the drawing never reads, named, so a failure says which one offers the ring. */
  it("the kinds whose list ids the drawing never reads offer no ring", () => {
    const banned = ["qq", "manhattan", "upset", "lollipop", "rose", "paireddot", "treemap", "venn", "parallel", "tracks", "forest", "funnel", "ternary"];
    const back: string[] = [];
    for (const card of cards) {
      const kind = card.plot.kind ?? "xy";
      if (!banned.includes(kind)) continue;
      if (ringsWrite(card).wrote.length > 0) back.push(`${kind} (${card.plot.name})`);
      cleanup();
    }
    expect(back, `the focus ring is offered on kinds that cannot honour it: ${back.join(", ")}`).toEqual([]);
  }, 300_000);

  /**
   * Before–after is not in the banned list: it lists the subject lines it draws, and focusing one
   * greys the rest (focus-drawn-series.test.tsx). The guard here: no ring there may write a table
   * column id (Pre / Post) - the id the drawing never reads.
   */
  it("before-after's rings write the subjects it draws, never a table column", () => {
    let clicked = 0;
    const bad: string[] = [];
    for (const card of cards.filter((c) => c.plot.kind === "beforeafter")) {
      const cols = new Set((card.table as unknown as { columns: { id: string }[] }).columns.map((c) => c.id));
      for (const id of ringsWrite(card).wrote) {
        clicked++;
        if (cols.has(id)) bad.push(`${card.plot.name}: "${id}"`);
      }
      cleanup();
    }
    expect(clicked, "no before-after ring was clicked - this measures nothing").toBeGreaterThan(1);
    expect(bad, `rings writing a column id before-after does not draw: ${bad.join(", ")}`).toEqual([]);
  }, 300_000);
});
