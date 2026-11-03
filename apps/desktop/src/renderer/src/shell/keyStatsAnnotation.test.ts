/**
 * The key-stats label wraps inside the plot. A long result line (a two-way ANOVA's three p-values) was one
 * unbroken line centred at the top, wider than the plot: it ran over the Y axis and into the legend.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { keyStatsAnnotation } from "./keyResults";

const SIZE = { width: 620, height: 420 };
const LONG = "p (row factor) < 0.0001  ·  p (column factor) = 0.00104  ·  p (interaction) = 0.404  ·  more words to be sure";

const card = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "xy")!;
const withLabel = (line: string): Plot =>
  ({ ...card.plot, annotations: [{ id: "k1", ...keyStatsAnnotation(line) }] }) as Plot;

describe("key-stats annotation", () => {
  it("a long line is wrapped onto more than one line", () => {
    const scene = buildPlotScene(card.table, withLabel(LONG), SIZE);
    const ann = scene.annotations.find((a) => a.id === "k1")!;
    expect(ann.textBox, "the label is laid out as a wrapped box").toBeDefined();
    expect(ann.textBox!.lines.length, "a line this long must wrap").toBeGreaterThan(1);
  });

  it("a short line stays on one line", () => {
    const scene = buildPlotScene(card.table, withLabel("p = 0.03"), SIZE);
    const ann = scene.annotations.find((a) => a.id === "k1")!;
    expect(ann.textBox?.lines.length ?? 1).toBe(1);
  });
});
