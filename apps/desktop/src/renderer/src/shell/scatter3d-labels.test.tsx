// @vitest-environment jsdom
/**
 * The 3-D scatter's axis labels: clear of the axis, and draggable.
 *
 * The labels are nudged away from the axis automatically so they do not clash with it, and
 * they can be dragged, as every text in the program must be.
 *
 * Guards against a label gap measured as a fraction of the cube rather than in pixels. Such a
 * gap shrinks with zoom and ignores the type size, so a larger axis-title font (for example
 * 18 → 22 px) stops clearing the axis.
 *
 * The Z label's drag offset has its own storage: X and Y keep theirs on their AxisSpec
 * (`titleOffset`), while the Z offset is stored as `scatter3d.zTitleOffset`, which is where the
 * builder reads it (not from `zAxis`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
const card = () => galleryItems().find((x) => (x.plot.kind ?? "xy") === "scatter3d")!;
const build = (patch: Partial<Plot> = {}) => {
  const g = card();
  return buildPlotScene(g.table, { ...g.plot, ...patch } as Plot, SIZE);
};

describe("the labels clear the axis", () => {
  it("the fixture can exhibit it — three axes, each with a label and an end", () => {
    const s = build();
    expect(s.scatter3d?.axes).toHaveLength(3);
    for (const a of s.scatter3d!.axes) expect(a.label, "an unnamed axis cannot clash with anything").toBeTruthy();
  });

  /**
   * The gap is in pixels and scales with the type. A gap proportional to the cube would stay
   * the same as the font grows, so a larger font would close it.
   */
  it("every label sits a real gap beyond its axis end, sized by the font", () => {
    for (const size of [12, 22, 40]) {
      const s = build({ fonts: { ...(card().plot.fonts ?? {}), axisTitle: { size } } } as Partial<Plot>);
      const need = size * 0.9;
      for (const a of s.scatter3d!.axes) {
        const gap = Math.hypot(a.lx - a.x2, a.ly - a.y2);
        expect(gap, `at font ${size} the "${a.label}" label sits ${gap.toFixed(1)}px from its axis end`).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it("…and the gap grows with the font, rather than staying put", () => {
    // In a box too small for 40 px names the builder draws them smaller and warns (the graph fills
    // its box) — so this is measured where 40 px is really drawn, and asserts it was.
    const roomy = (patch: Partial<Plot>) => buildPlotScene(card().table, { ...card().plot, ...patch } as Plot, { width: 1400, height: 1100 });
    const small = roomy({ fonts: { ...(card().plot.fonts ?? {}), axisTitle: { size: 12 } } } as Partial<Plot>);
    const big = roomy({ fonts: { ...(card().plot.fonts ?? {}), axisTitle: { size: 40 } } } as Partial<Plot>);
    expect(big.fonts.axisTitle.size, "fixture: the 40 px names are drawn at 40 px").toBe(40);
    const gap = (s: ReturnType<typeof build>): number => Math.hypot(s.scatter3d!.axes[0]!.lx - s.scatter3d!.axes[0]!.x2, s.scatter3d!.axes[0]!.ly - s.scatter3d!.axes[0]!.y2);
    expect(gap(big), "the gap ignores the type size — it is measured along the cube, not in pixels").toBeGreaterThan(gap(small) * 1.5);
  });

  it("the label is pushed outward, away from the origin — not across the cube", () => {
    const s = build();
    for (const a of s.scatter3d!.axes) {
      const dEnd = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
      const dLabel = Math.hypot(a.lx - a.x1, a.ly - a.y1);
      expect(dLabel, `the "${a.label}" label is nearer the origin than its own axis end`).toBeGreaterThan(dEnd);
    }
  });
});

describe("the labels are draggable, like every text", () => {
  const AXES = [["X", 0], ["Y", 1], ["Z", 2]] as const;

  for (const [name, i] of AXES) {
    it(`the ${name} label reports a drag`, () => {
      const moves: [string, number, number][] = [];
      const s = build();
      const { container } = render(
        <PlotFigure scene={s} zoom={1} onSelect={vi.fn()} onCamera3D={vi.fn()}
          onMoveAxisTitle={(axis, dx, dy) => moves.push([axis, dx, dy])} />,
      );
      const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === s.scatter3d!.axes[i]!.label)!;
      expect(label, `the ${name} label is not drawn`).toBeTruthy();
      fireEvent.pointerDown(label, { clientX: 100, clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(label, { clientX: 130, clientY: 118, pointerId: 1 });
      fireEvent.pointerUp(label, { clientX: 130, clientY: 118, pointerId: 1 });
      cleanup();
      expect(moves, `dragging the ${name} label moved nothing`).toHaveLength(1);
      expect(moves[0]![0], "the drag was reported for the wrong axis").toBe(["x", "y", "z"][i]);
    });
  }

  it("a stored offset moves the drawn label", () => {
    const at = (patch: Partial<Plot>): { x: number; y: number } => {
      const s = build(patch);
      const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={vi.fn()} onCamera3D={vi.fn()} onMoveAxisTitle={vi.fn()} />);
      const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === s.scatter3d!.axes[2]!.label)!;
      const g = el.closest("g[transform]") ?? el;
      const tr = g.getAttribute("transform") ?? el.getAttribute("transform") ?? "";
      cleanup();
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(tr);
      return { x: m ? Number(m[1]) : Number(el.getAttribute("x")), y: m ? Number(m[2]) : Number(el.getAttribute("y")) };
    };
    const base = at({});
    const moved = at({ scatter3d: { ...(card().plot.scatter3d ?? {}), zTitleOffset: { dx: 40, dy: 25 } } } as Partial<Plot>);
    expect(`${moved.x},${moved.y}`, "the stored Z offset never reached the drawing").not.toBe(`${base.x},${base.y}`);
  });
});
