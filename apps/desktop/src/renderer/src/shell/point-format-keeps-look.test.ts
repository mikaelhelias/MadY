/**
 * Formatting one point must not repaint it.
 *
 * Guards against a per-point setting (even the dot's own current size) turning a dot pale with a
 * dark edge while every neighbour stays a solid disc (the ternary gallery chart draws such dots). The
 * colour-by-texture binding draws each dot solid; the per-point pass must not re-derive the
 * series' two-tone for a point just because it has a record.
 *
 * Both directions are asked, because a check that looks only one way cannot see a change that breaks the other:
 *   1. re-stating a point's own record (adding nothing) changes nothing it looks like — every
 *      series of every gallery card;
 *   2. a point that asks for two-tone still gets it, even on a dot the builder drew solid.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { buildPlotScene, type MarkScene, type SeriesScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";

const measure = (t: string, px: number): number => t.length * px * 0.6;

/** What a point looks like on screen: the renderer's own fallbacks, mark before series. */
const look = (ser: SeriesScene, mk: MarkScene): string =>
  JSON.stringify([mk.symbolFill ?? ser.symbolFill, mk.symbolFillColor ?? ser.symbolFillColor, mk.symbolOutline ?? ser.symbolOutline, mk.pointColor ?? ser.pointColor, mk.fill ?? ser.color]);

function withRecord(plot: Plot, key: string, rec: Record<string, unknown>): Plot {
  return { ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [key]: rec } } as Plot;
}

describe("formatting one point keeps its look", () => {
  it("re-stating a point's own record changes nothing it looks like, on every gallery chart", () => {
    const changed: string[] = [];
    let checked = 0;
    for (const item of galleryItems()) {
      const opts = { measure, ...scenePaletteOpt(item.plot) };
      const before = buildPlotScene(item.table, item.plot, opts);
      for (const s of before.series) {
        const m = s.marks[0];
        if (!m) continue;
        const key = `${s.id}:${m.rowId}`;
        const after = buildPlotScene(item.table, withRecord(item.plot, key, { ...(item.plot.pointStyles?.[key] ?? {}) }), opts);
        const s2 = after.series.find((x) => x.id === s.id);
        const m2 = s2?.marks.find((x) => x.rowId === m.rowId);
        if (!s2 || !m2) continue;
        checked++;
        if (look(s, m) !== look(s2, m2)) changed.push(`${item.plot.kind} "${item.plot.name}" ${s.id}: ${look(s, m)} → ${look(s2, m2)}`);
      }
    }
    // The instrument reached the charts that matter (ternary draws its dots solid from a column).
    expect(checked).toBeGreaterThan(50);
    expect(galleryItems().some((i) => i.plot.kind === "ternary")).toBe(true);
    expect(changed).toEqual([]);
  });

  it("a point that asks for two-tone still gets it on a dot the builder drew solid (ternary)", () => {
    const item = galleryItems().find((i) => i.plot.kind === "ternary")!;
    const opts = { measure, ...scenePaletteOpt(item.plot) };
    const before = buildPlotScene(item.table, item.plot, opts);
    const s = before.series[0]!;
    const m = s.marks[0]!;
    // The fixture exhibits the case: this dot is drawn solid by its data colour.
    expect(m.symbolFill).toBe("solid");
    const after = buildPlotScene(item.table, withRecord(item.plot, `${s.id}:${m.rowId}`, { symbolFill: "twotone" }), opts);
    const m2 = after.series[0]!.marks[0]!;
    expect(m2.symbolFill).toBe("open");
    expect(m2.symbolFillColor).not.toBe(m.fill);
    // Its neighbour is untouched.
    expect(look(after.series[0]!, after.series[0]!.marks[1]!)).toBe(look(s, s.marks[1]!));
  });
});
