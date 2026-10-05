import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPlotScene } from "@mady/graphics";
import { describe, expect, it } from "vitest";
import { widthResizeTarget } from "./AppShell";
import { galleryItems } from "./gallery";
import { isCategoryKind } from "./PlotFigure";

/**
 * Default-deny: no width-drag handle on a kind that has no width to drag.
 *
 * `PlotFigure` draws a pair of transparent `ew-resize` `EdgeHandles` straddling every box /
 * violin / vertical bar, gated on `isCat && onWidthResize && !scene.distHorizontal`. The
 * commit runs through `AppShell.resizeWidth`, which routes by kind — and a kind outside
 * `widthResizeTarget`'s two lists has nowhere to write a width.
 *
 * `estimation` is such a kind: it draws one violin for the bootstrap difference distribution,
 * whose half-width is the builder constant `bandW * 0.32` with no field behind it, so a handle
 * on it could never commit a drag in either direction.
 *
 * Since the kind has no width field, the handle is not drawn. `onWidthResize` is the
 * renderer's only gate, so AppShell withholds it — and part 2 pins that, because it is the
 * line an edit would most easily undo.
 */
const APPSHELL = join(dirname(fileURLToPath(import.meta.url)), "AppShell.tsx");

describe("width edge handles are only drawn where a width command exists", () => {
  const items = galleryItems();

  /** Kinds whose real scene contains marks the renderer would hang handles on. */
  const handleEligible = items.filter((item) => {
    const scene = buildPlotScene(item.table, item.plot, { width: 520, height: 380 });
    if (!isCategoryKind(scene.kind) || scene.distHorizontal) return false;
    return scene.series.some((s) => s.marks.some((m) => m.violin || m.box || (m.bar && !scene.barHorizontal)));
  });

  it("covers the gallery (guards the guard)", () => {
    expect(items.length).toBeGreaterThan(20);
    // If this collapses to zero the scene reading broke, and every assertion below turns vacuous.
    expect(handleEligible.length, "no gallery kind draws handle-eligible marks — the scene reading is broken").toBeGreaterThan(3);
  });

  /**
   * The recorded set of kinds that draw a handle-eligible glyph and have nowhere to write.
   * A new kind joining this list is a decision, not an accident: give it a width field, or
   * confirm it must be suppressed like estimation and add it here with the reason.
   */
  it("only estimation draws a handle-eligible glyph with no width command", () => {
    const noField = handleEligible.filter((i) => widthResizeTarget(i.plot.kind) === null).map((i) => i.plot.kind);
    expect(noField).toEqual(["estimation"]);
  });

  it("AppShell withholds onWidthResize instead of passing it unconditionally", () => {
    const src = readFileSync(APPSHELL, "utf8");
    const passes = [...src.matchAll(/onWidthResize[=:]\s*([^,\n]+)/g)].map((m) => m[1]!.trim());
    expect(passes.length, "no onWidthResize pass site found — the source search is broken").toBeGreaterThan(1);
    const ungated = passes.filter((p) => !p.includes("widthResizable"));
    expect(
      ungated,
      "every onWidthResize pass must be gated on `widthResizable`, or kinds with no width " +
        "command (estimation) get an edge handle whose drag can never commit",
    ).toEqual([]);
  });

  it("resizeWidth refuses an unroutable kind loudly rather than returning", () => {
    const src = readFileSync(APPSHELL, "utf8");
    const body = src.slice(src.indexOf("const resizeWidth ="));
    expect(body.slice(0, body.indexOf("};"))).toContain("unresolvedTarget(");
  });
});
