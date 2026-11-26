import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Default-deny: a figure that draws the resize grips must also wire them.
 *
 * `FigureResizeHandles` renders three rects with `ew-resize` / `ns-resize` / `nwse-resize`
 * cursors and a "Drag to resize width" tooltip. Pressing one calls `figResize.start`, which
 * only records the mode — the drag is committed by `figResize.onMove` on the figure's own
 * `<svg>`. Attach the grips without the handlers and you get a control that looks alive,
 * responds to the cursor, and can never change anything.
 *
 * A missing wiring shows up as `figResize.start` rendered more times than `figResize.onMove`
 * is wired. A browser drag test can see it, but
 * a coordinate drag needs `getScreenCTM()` and jsdom has none — so this reads the source
 * instead, runs in the fast suite, and catches a figure that forgets before it is rendered.
 *
 * Note: two legitimate dialects commit a grip drag: the shared `useFigureResize` hook
 * (`figResize.onMove` / `.onUp`, used by every bespoke figure) and the main body's own
 * inline implementation (`figResizeRef`). A block must use one of them.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "PlotFigure.tsx");

/** Split the file into top-level `function Name(...)` blocks (column-0 `function`). */
function topLevelBlocks(src: string): { name: string; body: string }[] {
  const lines = src.split(/\r?\n/);
  const starts: { name: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^(?:export\s+)?function\s+([A-Za-z0-9_]+)\s*\(/.exec(l);
    if (m) starts.push({ name: m[1]!, line: i });
  });
  return starts.map((s, i) => ({
    name: s.name,
    body: lines.slice(s.line, i + 1 < starts.length ? starts[i + 1]!.line : lines.length).join("\n"),
  }));
}

describe("figure-resize grips must be wired to a commit path", () => {
  const blocks = topLevelBlocks(readFileSync(SRC, "utf8"));

  it("finds the figures under test (guards the guard)", () => {
    const drawing = blocks.filter((b) => b.body.includes("<FigureResizeHandles"));
    // If this ever collapses to a handful, the parse broke — not the app.
    expect(drawing.length, "no figure renders <FigureResizeHandles — the source parse is broken").toBeGreaterThan(8);
    expect(drawing.map((b) => b.name)).toContain("LollipopFigureContent");
    expect(drawing.map((b) => b.name)).toContain("PairedDotFigureContent");
  });

  it("every figure that renders the grips also commits the drag", () => {
    const unwired = blocks
      .filter((b) => b.body.includes("<FigureResizeHandles"))
      .filter((b) => {
        const hook = b.body.includes("figResize.onMove") && b.body.includes("figResize.onUp");
        const inline = b.body.includes("figResizeRef"); // the main body's own implementation
        return !hook && !inline;
      })
      .map((b) => b.name);
    expect(
      unwired,
      "these figures draw a resize grip whose drag can never commit — wire figResize.onMove/onUp " +
        "onto their <svg> (compare HeatmapFigure), or stop drawing the grip",
    ).toEqual([]);
  });
});
