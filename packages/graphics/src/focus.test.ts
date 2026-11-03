// @vitest-environment node
/**
 * Focus — draw the chosen series in colour and everything else in grey.
 *
 * The figure that says "this group is the point, the rest is context". The alternative is
 * hiding the other series, which throws the evidence away: a reader cannot tell whether a
 * missing curve was flat, absent, or never measured.
 *
 * Note: checking only that the line goes grey is not enough. A marker paints from the series'
 * own `symbolFillColor`/`symbolOutline` and the legend swatch copies the marker, so the markers
 * and the legend key can stay in full colour while the line is grey, and a half-grey series
 * reads as a bug. The main test below is therefore default-deny over every colour-bearing field
 * the scene actually carries, discovered by comparing the two scenes — a colour channel added
 * later cannot escape it.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 520, height: 360 };
const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [
    { id: "x", name: "Dose", role: "x", type: "number" },
    { id: "a", name: "Drug A", role: "y", type: "number" },
    { id: "b", name: "Drug B", role: "y", type: "number" },
    { id: "c", name: "Vehicle", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2 + 1, b: i * 1.4, c: i * 0.7 } })),
};
const base: Plot = { id: "p", status: "ok", styleOverrides: {}, source: "t", name: "p", kind: "xy", legend: { show: true } };
const build = (p: Plot) => buildPlotScene(table, p, SIZE);
const focusing = (...ids: string[]): Plot => ({ ...base, seriesStyles: Object.fromEntries(ids.map((id) => [id, { focus: true }])) });

const isColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
/** Every colour-valued field on a series, discovered rather than listed — nested one level, so the
 *  fill descriptor and the level bands are included. */
function colours(o: unknown, path = "", out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(o)) { o.forEach((v, i) => colours(v, `${path}[${i}]`, out)); return out; }
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      if (k === "marks") continue; // marks are checked separately, and there are many
      if (isColour(v)) out[`${path}${k}`] = v;
      else if (v && typeof v === "object") colours(v, `${path}${k}.`, out);
    }
  }
  return out;
}

describe("focus — the chosen series keep their colour, the rest go grey", () => {
  it("does nothing at all until a series is focused", () => {
    expect(JSON.stringify(build(base))).toBe(JSON.stringify(build({ ...base, seriesStyles: { a: {} } })));
    expect(build(base).warnings).toEqual([]);
  });

  /**
   * The main check. Not only "the line is grey" — every colour the series carries must have
   * changed, discovered by diffing the two scenes rather than from a hand-written list (a
   * list can easily miss the marker colours).
   */
  it("greys every colour an unfocused series has, not just the obvious ones", () => {
    const off = build(base);
    const on = build(focusing("b"));
    for (const id of ["a", "c"]) {
      const before = colours(off.series.find((s) => s.id === id));
      const after = colours(on.series.find((s) => s.id === id));
      const keys = Object.keys(before);
      expect(keys.length, `series ${id} exposes no colours — the sweep is measuring nothing`).toBeGreaterThan(6);
      const unchanged = keys.filter((k) => before[k] === after[k]);
      expect(unchanged, `these colours on the de-emphasised series "${id}" were left in full colour: ${unchanged.join(", ")}`).toEqual([]);
    }
  });

  it("leaves the focused series exactly as it was", () => {
    const off = build(base);
    const on = build(focusing("b"));
    expect(colours(on.series.find((s) => s.id === "b"))).toEqual(colours(off.series.find((s) => s.id === "b")));
  });

  it("greys each mark of a de-emphasised series too", () => {
    const on = build(focusing("b"));
    const a = on.series.find((s) => s.id === "a")!;
    const b = on.series.find((s) => s.id === "b")!;
    expect(a.marks.length).toBeGreaterThan(0);
    for (const m of a.marks) {
      for (const v of [m.fill, m.symbolFillColor, m.symbolOutline, m.borderColor]) {
        if (isColour(v)) expect(v, "a mark kept a full-strength colour").not.toBe(b.color);
      }
    }
  });

  /** The key must agree with the drawing: a legend row in the original colour keys a colour
   *  that is no longer anywhere on the chart. */
  it("greys the legend row of every de-emphasised series, and only those", () => {
    const off = build(base);
    const on = build(focusing("b"));
    const rowOf = (s: ReturnType<typeof build>, id: string) => s.legend.find((e) => e.select?.as === "series" && e.select.id === id)!;
    expect(on.legend.length).toBe(3);
    expect(rowOf(on, "b").color).toBe(rowOf(off, "b").color);
    for (const id of ["a", "c"]) expect(rowOf(on, id).color, `the legend still keys ${id} in its old colour`).not.toBe(rowOf(off, id).color);
  });

  it("says so when everything is focused and nothing can recede", () => {
    const s = build(focusing("a", "b", "c"));
    expect(s.warnings.filter((w) => w.toLowerCase().includes("focused"))).toHaveLength(1);
    // …and it is not a false alarm: with one left out, no warning.
    expect(build(focusing("a", "b")).warnings.filter((w) => w.toLowerCase().includes("focused"))).toHaveLength(0);
  });

  /** A metallic or textured fill names a canned paint rather than carrying colours, so it
   *  cannot be muted. It is refused with a warning instead of leaving a full-colour patch on the chart. */
  /**
   * A key set to `undefined` is not a style. Handled in `inheritSeriesLook`, because every
   * clear-to-undefined control can produce one.
   *
   * The document merges style deltas with a spread, so clearing the only setting a series had
   * leaves `{ thatField: undefined }`: an object with one key and no style in it. Guards against
   * counting keys, which would make that series read as styled and stamp the kind's house
   * defaults on all of its unstyled siblings — on a bare graph, focusing a series and
   * un-focusing it would leave the others with 8-px house markers and an 18-px narrower plot.
   */
  it("a field cleared back to undefined does not turn the series into a styled one", () => {
    const bare = JSON.stringify(build(base));
    for (const cleared of [{ focus: undefined }, { color: undefined }, { symbolSize: undefined }]) {
      expect(
        JSON.stringify(build({ ...base, seriesStyles: { a: cleared } })),
        `clearing ${Object.keys(cleared)[0]} on one series changed the whole graph`,
      ).toBe(bare);
    }
    // …and a real style on one series still reaches its siblings, which is what the
    // inheritance is for — so this did not simply switch the feature off.
    expect(JSON.stringify(build({ ...base, seriesStyles: { a: { symbolSize: 11 } } }))).not.toBe(bare);
  });

  /**
   * A focus left pointing at a series this chart does not draw. ROC, survival and
   * Bland-Altman key their series by synthetic ids (`roc-0`, `surv-0`), so focusing a column and
   * then switching chart type leaves the flag orphaned. Guards against greying every curve with
   * nothing highlighted and no warning — a plot gone uniformly flat with no explanation.
   */
  it("leaves the chart alone, and says so, when the focused series is not on it", () => {
    const bare = build(base);
    const stale = build({ ...base, seriesStyles: { "not-a-series": { focus: true } } });
    expect(stale.series.map((x) => x.color), "the whole chart was greyed for a focus that reaches nothing")
      .toEqual(bare.series.map((x) => x.color));
    expect(stale.warnings.filter((w) => w.toLowerCase().includes("not on this chart"))).toHaveLength(1);
  });

  it("says which series keep a fill it cannot grey", () => {
    const s = build({ ...focusing("b"), seriesStyles: { b: { focus: true }, a: { fillType: "metallic", metallic: "gold" } } });
    const said = s.warnings.filter((w) => w.toLowerCase().includes("metallic"));
    if (s.series.find((x) => x.id === "a")!.fillSpec.type === "metallic") {
      expect(said, "a fill that cannot be greyed was left unreported").toHaveLength(1);
      expect(said[0]).toContain("Drug A");
    } else {
      // The fixture did not produce a metallic fill, so this check proves nothing — say so
      // rather than passing silently.
      expect(s.series.find((x) => x.id === "a")!.fillSpec.type, "fixture no longer exercises a metallic fill").toBe("metallic");
    }
  });
});
