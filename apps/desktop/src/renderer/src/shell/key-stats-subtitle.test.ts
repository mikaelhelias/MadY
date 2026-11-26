/**
 * The key-stats label is drawn under the graph title while it is still at its starting place — and it is never lost:
 * on a graph type whose drawing has no subtitle line, and on a graph whose title is hidden (every panel of a figure),
 * it stays where the plot keeps it. This runs every graph type of the gallery.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { keyStatsAnnotation } from "./keyResults";

const SIZE = { width: 620, height: 420 };
const measure = (text: string, px: number): number => text.length * px * 0.56;
const LINE = "p < 0.0001  ·  Cohen's d = 1.2";
const cards = galleryItems() as unknown as { table: DataTable; plot: Plot }[];
const withStats = (plot: Plot, role: "stats" | undefined, extra: Record<string, unknown> = {}): Plot =>
  ({ ...plot, annotations: [{ id: "kstat", ...keyStatsAnnotation(LINE), ...(role ? { role } : {}), ...extra }] }) as unknown as Plot;

/** Where a scene shows the label: under the title, or as a drawn annotation. */
const shown = (scene: ReturnType<typeof buildPlotScene>): { heading: boolean; inPlot: boolean } => ({
  heading: !!scene.subtitle && scene.subtitle.includes("Cohen"),
  inPlot: scene.annotations.some((a) => a.id === "kstat"),
});

describe("key-stats label on every graph type", () => {
  it("is drawn somewhere on every card, under the title or in the plot — never nowhere, never twice", () => {
    const lost: string[] = [];
    let underTitle = 0;
    for (const { table, plot } of cards) {
      const s = shown(buildPlotScene(table, withStats(plot, "stats"), { ...SIZE, measure }));
      if (s.heading && s.inPlot) lost.push(`${plot.kind}: drawn twice`);
      else if (!s.heading && !s.inPlot) lost.push(`${plot.kind}: not drawn`);
      if (s.heading) underTitle += 1;
    }
    expect(lost).toEqual([]);
    expect(underTitle, "most graph types draw it under the title").toBeGreaterThan(cards.length / 2);
  });

  /** The kinds whose drawing has no room for a text label at all: with or without this change, the label is not drawn there. */
  const cannotDrawLabels = cards
    .filter(({ table, plot }) => !shown(buildPlotScene(table, withStats(plot, undefined), { ...SIZE, measure })).inPlot)
    .map(({ plot }) => plot.kind);

  it("names the graph types that cannot draw a text label at all (so a loss is never blamed on this change)", () => {
    // The network drawing has no annotation layer; a label there is only visible under the title.
    expect(cannotDrawLabels).toEqual(["network"]);
  });

  /** Where the label stays: in the plot, like before this change — unless the kind cannot draw labels anywhere. */
  const stays = (kind: string): { heading: boolean; inPlot: boolean } => ({ heading: false, inPlot: !cannotDrawLabels.includes(kind as never) });

  it("stays where the plot keeps it on every card when the title is hidden (a panel in a figure)", () => {
    for (const { table, plot } of cards) {
      const s = shown(buildPlotScene(table, { ...withStats(plot, "stats"), showTitle: false }, { ...SIZE, measure }));
      expect(s, plot.kind).toEqual(stays(String(plot.kind)));
    }
  });

  it("stays where the plot keeps it on every card once the user has moved it", () => {
    for (const { table, plot } of cards) {
      const s = shown(buildPlotScene(table, withStats(plot, "stats", { x: 0.2 }), { ...SIZE, measure }));
      expect(s, plot.kind).toEqual(stays(String(plot.kind)));
    }
  });

  it("leaves a label saved before this look (no role) where it was", () => {
    for (const { table, plot } of cards) {
      const s = shown(buildPlotScene(table, withStats(plot, undefined), { ...SIZE, measure }));
      expect(s, plot.kind).toEqual(stays(String(plot.kind)));
    }
  });
});
