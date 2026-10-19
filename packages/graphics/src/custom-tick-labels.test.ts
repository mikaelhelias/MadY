// A custom tick's label must not land on the axis's own label. Guards against a tick added with "Add tick" at —
// or near — an automatic one drawing both labels on top of each other ("week 20" over "20", with or without an
// axis cut).
//
// The custom tick wins: the automatic label is blanked, and the automatic tick keeps its mark and its gridline, with
// its text remembered in `suppressedLabel` (the convention `deOverlapX` and the rotated re-spacing already use).
// Removing the whole tick would drop a gridline the user never asked to lose.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { AxisScene, PlotScene } from "./scene.js";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }],
  rows: [0, 2, 4, 6, 8, 10].map((x, i) => ({ id: `r${i}`, cells: { x, a: 10 + i } })),
};
const SIZE = { width: 640, height: 420 };
const build = (over: Partial<Plot>): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over } as Plot, SIZE);

const majors = (ax: AxisScene) => ax.ticks.filter((t) => !t.minor);
const labelled = (ax: AxisScene) => majors(ax).filter((t) => t.label !== "");
/** The automatic ticks of an axis, before any custom tick is added. */
const autoValues = (ax: AxisScene) => majors(ax).map((t) => t.value);

describe("a custom tick's label replaces the automatic label it would sit on", () => {
  const plain = build({});
  const autos = autoValues(plain.x);
  const mid = autos[Math.floor(autos.length / 2)]!;      // an automatic tick in the middle of the axis
  const step = (autos[1]! - autos[0]!) || 1;
  const near = mid - step * 0.08;                        // close enough that the two labels would collide
  const far = mid + step * 0.5;                          // midway to the next automatic tick

  it("the fixture's axis really has automatic ticks to collide with", () => {
    expect(autos.length).toBeGreaterThan(3);
    expect(labelled(plain.x).length).toBe(autos.length);
  });

  it("a custom tick AT an automatic tick: the custom label is drawn, the automatic one is not", () => {
    const s = build({ xAxis: { extraTicks: [{ value: mid, label: "peak" }] } });
    const drawn = labelled(s.x).map((t) => t.label);
    expect(drawn, "the custom label is missing").toContain("peak");
    expect(drawn.filter((l) => l === String(mid)), `the automatic label "${mid}" is still drawn under the custom one`).toEqual([]);
    const auto = majors(s.x).find((t) => t.value === mid && t.label === "");
    expect(auto, "the automatic tick was removed instead of having its label blanked").toBeDefined();
    expect(auto!.suppressedLabel, "the automatic label's text was not remembered").toBe(String(mid));
  });

  it("a custom tick near an automatic tick: same — the automatic label gives way", () => {
    const s = build({ xAxis: { extraTicks: [{ value: near, label: "peak" }] } });
    const drawn = labelled(s.x).map((t) => t.label);
    expect(drawn).toContain("peak");
    expect(drawn.filter((l) => l === String(mid)), `"${mid}" is drawn under the custom label`).toEqual([]);
  });

  it("a custom tick clear of the automatic ones changes nothing about them", () => {
    const s = build({ xAxis: { extraTicks: [{ value: far, label: "gap" }] } });
    const drawn = labelled(s.x).map((t) => t.label);
    expect(drawn).toContain("gap");
    for (const v of autos) expect(drawn, `the automatic label "${v}" was blanked although nothing sits on it`).toContain(String(v));
    expect(majors(s.x).some((t) => t.suppressedLabel), "a label was suppressed with nothing overlapping it").toBe(false);
  });

  it("the automatic tick keeps its mark and gridline — only its text goes", () => {
    const s = build({ xAxis: { extraTicks: [{ value: mid, label: "peak" }] } });
    // Both ticks stand at that value: the automatic one (its mark and gridline kept, its text blanked) and the
    // custom one the user asked for. Dropping the automatic tick would take away a gridline nobody asked to lose.
    const there = majors(s.x).filter((t) => t.value === mid);
    expect(there.length, "the automatic tick was removed instead of keeping its mark").toBe(2);
    expect(there.filter((t) => t.label === "peak").length, "the custom tick is missing").toBe(1);
    expect(there.filter((t) => t.label === "" && t.suppressedLabel === String(mid)).length, "the automatic tick did not keep its mark with its text remembered").toBe(1);
    expect(majors(s.x).length, "the axis lost or gained a tick mark").toBe(autos.length + 1);
  });

  it("with no custom ticks, every automatic label is drawn unchanged", () => {
    const s = build({});
    expect(labelled(s.x).map((t) => t.label)).toEqual(labelled(plain.x).map((t) => t.label));
    expect(majors(s.x).some((t) => t.suppressedLabel)).toBe(false);
  });
});

describe("the same on a Y axis", () => {
  const plain = build({});
  const autos = autoValues(plain.y);
  const mid = autos[Math.floor(autos.length / 2)]!;

  it("a custom tick at an automatic one blanks the automatic label, not the custom one", () => {
    // A short label, narrower than the automatic ones, so the left margin is unaffected (the long-label case
    // is below).
    const s = build({ yAxis: { extraTicks: [{ value: mid, label: "T" }] } });
    const drawn = labelled(s.y).map((t) => t.label);
    expect(drawn, "the custom label is missing").toContain("T");
    expect(drawn.filter((l) => l === String(mid)), `the automatic label "${mid}" is still drawn under the custom one`).toEqual([]);
    expect(s.warnings, "a label that fits warned about nothing").toEqual([]);
  });

  /**
   * A typed custom label gets its room.
   *
   * The left margin measures the custom tick labels as well as the automatic ones. Measuring only the
   * automatic labels would let a wider custom label run off the canvas, where the edge rule blanks it. The
   * room is reserved rather than the label refused with a warning; the cost is a narrower plot on any
   * graph that carries such a label.
   */
  it("a custom label wider than the automatic ones is drawn in full - the room beside the axis grows for it", () => {
    const s = build({ yAxis: { extraTicks: [{ value: mid, label: "a very long custom label" }] } });
    expect(labelled(s.y).map((t) => t.label), "the label the user typed was not drawn").toContain("a very long custom label");
    expect(s.warnings.filter((w) => w.includes("a very long custom label")), "it still warns that the label has no room").toEqual([]);
    expect(s.plot.x, "the plot did not make room - the label must be hanging off the canvas").toBeGreaterThan(build({}).plot.x);
  });

  it("a custom label no wider than the automatic ones costs no room at all", () => {
    expect(build({ yAxis: { extraTicks: [{ value: mid, label: "1" }] } }).plot.x).toBe(build({}).plot.x);
  });
});
