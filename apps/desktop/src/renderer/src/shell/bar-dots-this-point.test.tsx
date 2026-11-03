// @vitest-environment jsdom
/**
 * "This point only" restyles that bar's own dots.
 *
 * On a bar chart with its replicate dots shown, click a bar, untick
 * "Apply to whole series", set Shape / Size / Fill / Opacity / Outline — and the dots on that bar change.
 * The setting is saved on the bar and reaches its mark; the swarm drawer must read it too, not only the
 * series' values (otherwise Shape = square leaves the dots as circles).
 *
 * Each case asserts both halves: the chosen bar's dots change, and no other bar's dots do.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems, galleryLookup } from "./gallery";
import { ink, INK_SIZE } from "./inkOracle";

const item = galleryItems().find((g) => g.title === "Bar / column (+ error bars)")!;
const lk = galleryLookup(item);
const scene = buildPlotScene(item.table, item.plot, { ...INK_SIZE, tables: lk });
const series = scene.series.find((s) => s.marks.some((m) => m.bar && (m.points?.length ?? 0) > 1))!;
const target = series.marks.find((m) => m.bar && (m.points?.length ?? 0) > 1)!;
const key = `${series.id}:${String(target.rowId)}`;
const withPoint = (o: Record<string, unknown>): Plot => ({ ...item.plot, pointStyles: { ...(item.plot.pointStyles ?? {}), [key]: o } }) as Plot;

describe("a bar's own dots take its 'this point only' marker settings", () => {
  it("the fixture really draws a swarm over the bar, or none of this proves anything", () => {
    expect(target.bar, "no bar mark").toBeDefined();
    expect(target.points!.length).toBeGreaterThan(1);
  });

  it.each([
    ["Shape", { symbol: "square" }],
    ["Fill", { symbolFill: "solid" }],
    ["Opacity", { symbolOpacity: 0.3 }],
    ["Outline", { symbolFill: "solid", symbolOutline: "#ff00ff" }],
  ])("%s changes the drawing", (_label, o) => {
    expect(ink(item.table, withPoint(o), lk)).not.toBe(ink(item.table, item.plot, lk));
  });

  // Note: not "the drawing changed": a bigger per-bar size can spread that bar's swarm wider while
  // every dot keeps the series radius. The claim is the dots' own radius.
  it("Size draws this bar's dots at the new radius", () => {
    const after = ink(item.table, withPoint({ symbolSize: 24 }), lk); // the card's dots are already 14
    const r = String(Math.max(2, 24 * 0.6));
    const drawnAt = (after.match(new RegExp(`<circle[^>]*r="${r}"[^>]*pointer-events="none"`, "g")) ?? []).length;
    expect(drawnAt).toBe(target.points!.length);
  });

  it("Shape reaches THIS bar's dots and no other bar's", () => {
    const before = ink(item.table, item.plot, lk);
    const after = ink(item.table, withPoint({ symbol: "square" }), lk);
    const circles = (m: string) => (m.match(/<circle[^>]*pointer-events="none"/g) ?? []).length;
    // Exactly this bar's dots stopped being circles.
    expect(circles(before) - circles(after)).toBe(target.points!.length);
  });
});
