// A second value axis on horizontal bars — drawn along the top.
//
// On a horizontal bar the values run left to right, so the second value axis cannot sit on the
// right: it is a top axis. It is the same setting as a vertical chart's second axis
// (`seriesStyles.axis = "y2"`, `plot.y2Axis`) — flipping a chart keeps which series are on it —
// drawn with `side: "top"`.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import type { PlotScene } from "./scene";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 300 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 500 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 400 } },
  ],
};
const hbar = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t3", kind: "bar", barOrientation: "horizontal", seriesStyles: styles, ...over }) as Plot;
const build = (p: Plot): PlotScene => buildPlotScene(t3, p, SIZE);
const trend = (s: PlotScene) => s.series.find((x) => x.id === "line")!;

describe("horizontal bar — a series on the second axis gets a top value axis", () => {
  it("Trend as a line: a top axis fitted to Trend, the bottom axis fits Sales alone, room reserved above the plot", () => {
    const plain = build(hbar({ line: { plotAs: "line" } }));
    const s = build(hbar({ line: { plotAs: "line", axis: "y2" } }));
    expect(s.y2, "no second axis was drawn").toBeDefined();
    expect(s.y2!.side).toBe("top");
    expect(s.y2!.domain[0]).toBeLessThanOrEqual(300);
    expect(s.y2!.domain[1]).toBeGreaterThanOrEqual(500);
    expect(s.y2!.domain[0], "a line keeps a range fitted to its own values").toBeGreaterThan(0);
    expect(s.x.domain[1], "the bottom axis still stretches to Trend").toBeLessThan(100);
    // runs along the plot's top edge, left to right
    expect(s.y2!.range).toEqual([s.plot.x, s.plot.x + s.plot.width]);
    for (const t of s.y2!.ticks) expect(t.pos >= s.plot.x - 0.5 && t.pos <= s.plot.x + s.plot.width + 0.5).toBe(true);
    expect(s.plot.y, "no room was reserved above the plot for the top axis").toBeGreaterThan(plain.plot.y);
    expect(s.y2!.titlePos!, "the top axis title is not above the plot").toBeLessThan(s.plot.y);
    for (const m of trend(s).marks) expect(m.cx >= s.plot.x - 1 && m.cx <= s.plot.x + s.plot.width + 1).toBe(true);
    expect(s.warnings.some((w) => /second value axis/i.test(w))).toBe(false);
  });

  it("the top axis is titled with its series' name unless a title is typed", () => {
    expect(build(hbar({ line: { axis: "y2", plotAs: "line" } })).y2!.title).toBe("Trend");
    expect(build(hbar({ line: { axis: "y2", plotAs: "line" } }, { y2Axis: { title: "Price" } })).y2!.title).toBe("Price");
  });

  it("bars on the top axis stand on 0: the axis reaches 0 and no bar starts left of the plot", () => {
    const s = build(hbar({ line: { axis: "y2" } }));
    expect(s.y2!.domain[0]).toBeLessThanOrEqual(0);
    for (const m of trend(s).marks) expect(m.bar!.x).toBeGreaterThanOrEqual(s.plot.x - 1);
  });

  it("nothing on the second axis: no top axis", () => {
    expect(build(hbar({})).y2).toBeUndefined();
  });
});

describe("horizontal bar — what the second axis cannot do is said, never dropped", () => {
  it("a series on a third axis (Y3) warns and names the series", () => {
    expect(build(hbar({ line: { axis: "y3" } })).warnings.some((w) => /Trend/.test(w) && /third/i.test(w))).toBe(true);
  });
  it("a log scale on the second axis warns", () => {
    expect(build(hbar({ line: { axis: "y2", plotAs: "line" } }, { y2Axis: { scale: "log10" } })).warnings.some((w) => /log/i.test(w))).toBe(true);
  });
});

describe("horizontal bar — brackets and axis options with a series on the top axis", () => {
  it("a planned significance bracket does not stretch the bottom axis back out", () => {
    const planned = { id: "b1", kind: "bracket" as const, from: 1, to: 3, bracketY: 530, plannedY: true, p: 0.001, role: "significance" as const };
    const s = build(hbar({ line: { axis: "y2", plotAs: "line" } }, { annotations: [planned] }));
    expect(s.x.domain[1], "the planned height stretched the bottom axis").toBeLessThan(100);
    expect(s.annotations.find((a) => a.id === "b1")?.path, "the bracket was not drawn").toBeTruthy();
  });

  it("a bracket needing room widens the top axis too, so it clears the bars drawn on it", () => {
    const auto = { id: "b2", kind: "bracket" as const, from: 1, to: 3, p: 0.01, role: "significance" as const };
    const s = build(hbar({ line: { axis: "y2" } }, { annotations: [auto] }));
    const b = s.annotations.find((a) => a.id === "b2");
    expect(b?.path, "the bracket was not drawn").toBeTruthy();
    // Note: without this the check would also pass with no top axis (the series would share the
    // bottom axis and the bracket would fit trivially), so it would prove nothing.
    expect(s.y2?.side, "the fixture must draw its bars on the top axis").toBe("top");
    const inkRight = Math.max(...s.series.flatMap((se) => se.marks.map((m) => (m.bar ? m.bar.x + m.bar.w : -Infinity))));
    expect(b!.x1!, "the bracket sits on the bars instead of beyond them").toBeGreaterThan(inkRight);
  });

  it("extra ticks and colour bands on the top axis are placed left to right, like the bottom axis's", () => {
    const s = build(hbar({ line: { axis: "y2", plotAs: "line" } }, { y2Axis: { extraTicks: [{ value: 450, label: "goal" }], bands: [{ from: 320, to: 380 }] } }));
    const tick = s.y2!.ticks.find((t) => t.label === "goal");
    expect(tick, "the extra tick was dropped").toBeDefined();
    expect(tick!.pos > s.plot.x && tick!.pos < s.plot.x + s.plot.width).toBe(true);
    const band = (s.axisBands ?? [])[0];
    expect(band, "the band was dropped").toBeDefined();
    expect(band!.h, "a top-axis band must span the plot's HEIGHT, not its width").toBeCloseTo(s.plot.height, 3);
    expect(band!.w).toBeLessThan(s.plot.width);
  });
});
