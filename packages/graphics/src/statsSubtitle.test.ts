import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { homeStatsLabel, routeStatsToSubtitle, withoutRoutedStats, wrapStatsLine } from "./statsSubtitle";

const measure = (text: string, px: number): number => text.length * px * 0.56;
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [[1, 2], [2, 4], [3, 5], [4, 8]].map((v, i) => ({ id: `r${i}`, cells: { x: v[0]!, y: v[1]! } })),
};
const LINE = "p < 0.0001  ·  Cohen's d = 1.2";
const stats = (over: Record<string, unknown> = {}) => ({ id: "k", kind: "text", x: 0.5, y: 0.07, w: 0.9, label: LINE, size: 14, role: "stats", ...over });
const plotOf = (patch: Record<string, unknown> = {}): Plot =>
  ({ id: "p", name: "XY", source: "t", status: "ok", styleOverrides: {}, kind: "xy", annotations: [stats()], ...patch }) as unknown as Plot;
const text = (t: string): number => measure(t, 13);

describe("routeStatsToSubtitle", () => {
  it("moves a label still at its starting place into the subtitle and removes it from the plot", () => {
    const r = routeStatsToSubtitle(plotOf(), 500, text)!;
    expect(r.text).toBe(LINE);
    expect(r.plot.subtitle).toBe(LINE);
    expect(r.plot.annotations).toEqual([]);
  });

  it("goes under a subtitle the graph already has", () => {
    const r = routeStatsToSubtitle(plotOf({ subtitle: "n = 24 plots" }), 500, text)!;
    expect(r.plot.subtitle).toBe(`n = 24 plots\n${LINE}`);
  });

  it("leaves the label in the plot when the title is hidden (a panel in a figure, or the title switched off)", () => {
    expect(routeStatsToSubtitle(plotOf({ showTitle: false }), 500, text)).toBeUndefined();
  });

  it("leaves a label the user moved or resized where it is", () => {
    expect(routeStatsToSubtitle(plotOf({ annotations: [stats({ x: 0.3 })] }), 500, text)).toBeUndefined();
    expect(routeStatsToSubtitle(plotOf({ annotations: [stats({ y: 0.4 })] }), 500, text)).toBeUndefined();
    expect(routeStatsToSubtitle(plotOf({ annotations: [stats({ w: 0.5 })] }), 500, text)).toBeUndefined();
  });

  it("ignores a text label that is not the stats label", () => {
    expect(routeStatsToSubtitle(plotOf({ annotations: [stats({ role: undefined })] }), 500, text)).toBeUndefined();
    expect(routeStatsToSubtitle(plotOf({ annotations: [] }), 500, text)).toBeUndefined();
  });
});

describe("wrapStatsLine", () => {
  const long = "p (row factor) < 0.0001  ·  p (column factor) = 0.00104  ·  p (interaction) = 0.404";
  it("keeps a line that fits on one line", () => {
    expect(wrapStatsLine(LINE, 500, text)).toBe(LINE);
  });
  it("breaks a long line at its separators, never inside a result", () => {
    const out = wrapStatsLine(long, 300, text);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(text(l), l).toBeLessThanOrEqual(300);
    expect(lines.join("  ·  ")).toBe(long);
  });
});

describe("homeStatsLabel", () => {
  it("is the label that would be drawn under the title", () => {
    expect(homeStatsLabel(plotOf())).toBe(LINE);
  });
  it("is nothing when the title is hidden, the label moved, or there is none", () => {
    expect(homeStatsLabel(plotOf({ showTitle: false }))).toBeUndefined();
    expect(homeStatsLabel(plotOf({ annotations: [stats({ x: 0.2 })] }))).toBeUndefined();
    expect(homeStatsLabel(plotOf({ annotations: [] }))).toBeUndefined();
  });
});

describe("withoutRoutedStats", () => {
  it("takes the stats text off the end of the drawn subtitle", () => {
    expect(withoutRoutedStats(`n = 24\n${LINE}`, LINE)).toBe("n = 24");
    expect(withoutRoutedStats(LINE, LINE)).toBe("");
  });
  it("finds the line however it was broken into lines", () => {
    const long = "p (row factor) < 0.0001  ·  p (column factor) = 0.00104  ·  p (interaction) = 0.404";
    const drawn = `n = 24\n${wrapStatsLine(long, 300, text)}`;
    expect(drawn.split("\n").length).toBeGreaterThan(2);
    expect(withoutRoutedStats(drawn, long)).toBe("n = 24");
  });
  it("leaves a subtitle the user edited the stats out of", () => {
    expect(withoutRoutedStats("my own words", LINE)).toBe("my own words");
  });
});

describe("buildPlotScene with a key-stats label", () => {
  const opts = { width: 580, height: 380, measure };

  it("draws the label under the title and frees the plot area", () => {
    const scene = buildPlotScene(table, plotOf(), opts);
    expect(scene.subtitle).toBe(LINE);
    expect(scene.annotations.find((a) => a.id === "k")).toBeUndefined();
    const bare = buildPlotScene(table, plotOf({ annotations: [] }), opts);
    expect(scene.plot.y, "the heading band is taller by the stats line").toBeGreaterThan(bare.plot.y);
  });

  it("keeps the label in the plot when the title is hidden", () => {
    const scene = buildPlotScene(table, plotOf({ showTitle: false }), opts);
    expect(scene.annotations.find((a) => a.id === "k")?.textBox?.lines.join(" ") ?? "").toContain("p < 0.0001");
  });
});
