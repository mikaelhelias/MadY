// @vitest-environment jsdom
/**
 * The ring, squircle, oval and waffle marker shapes, chosen on
 * the principle that shapes should stay separable without colour: openness (the ring's
 * hole), roundness vs flat sides (squircle), aspect (oval), texture (the waffle's grid).
 *
 * The union in the model, the hand-kept dropdown in the Inspector and the `if (shape === …)`
 * chain in `Marker` are three lists that are bound to drift apart; this test reads the union off the
 * model source and holds the other two to it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SymbolShape } from "@mady/core";
import { Marker } from "./PlotFigure";
import { SHAPES } from "./Inspector";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "../../../../../../packages/core/src/model.ts"), "utf8");

/** Every member of `SymbolShape`, read off the model source. */
function unionShapes(): SymbolShape[] {
  const m = MODEL.match(/export type SymbolShape =([\s\S]*?);/);
  expect(m, "SymbolShape union not found").toBeTruthy();
  return [...m![1]!.matchAll(/"([a-z-]+)"/g)].map((x) => x[1] as SymbolShape);
}

function markup(shape: SymbolShape, size = 5): string {
  const { container } = render(
    <svg>
      <Marker shape={shape} cx={20} cy={20} size={size} color="#123456" fill="solid" opacity={1} outline="#000000" borderWidth={1.5} />
    </svg>,
  );
  const out = container.querySelector("svg")!.innerHTML;
  cleanup();
  return out;
}

describe("the ring, squircle, oval and waffle marker shapes", () => {
  const OWN: SymbolShape[] = ["ring", "squircle", "oval", "waffle"];

  it("the four shapes are in the union", () => {
    const u = unionShapes();
    for (const s of OWN) expect(u, `"${s}" is not a SymbolShape`).toContain(s);
  });

  it("every shape in the union is offered in the Inspector's dropdown, and nothing else is", () => {
    const listed = SHAPES.map(([v]) => v).sort();
    expect(listed).toEqual([...unionShapes()].sort());
  });

  it("every drawable shape draws, and no two draw the same thing", () => {
    const seen = new Map<string, SymbolShape>();
    for (const s of unionShapes()) {
      const m = markup(s);
      if (s === "none") { expect(m, "none draws nothing").toBe(""); continue; }
      expect(m, `"${s}" draws nothing`).not.toBe("");
      expect(seen.get(m), `"${s}" draws exactly what "${seen.get(m)}" draws`).toBeUndefined();
      seen.set(m, s);
    }
  });

  it("the octagon is in the union and in the dropdown", () => {
    expect(unionShapes()).toContain("octagon");
    expect(SHAPES.map(([v]) => v)).toContain("octagon");
  });

  it("the octagon has eight corners and a flat top, like a stop sign", () => {
    // Eight corners standing on a point would read as a circle at 5 px; the flat top and bottom
    // edges are what separate it from the circle and from the hexagon (which stands on a point).
    const { container } = render(
      <svg>
        <Marker shape="octagon" cx={20} cy={20} size={5} color="#123456" fill="solid" opacity={1} outline="#000000" borderWidth={1.5} />
      </svg>,
    );
    const pts = (container.querySelector("polygon")?.getAttribute("points") ?? "")
      .trim().split(/\s+/).filter(Boolean).map((p) => p.split(",").map(Number) as [number, number]);
    cleanup();
    expect(pts, "octagon: expected eight corners").toHaveLength(8);
    const top = Math.min(...pts.map(([, y]) => y));
    const onTop = pts.filter(([, y]) => Math.abs(y - top) < 1e-6);
    expect(onTop, "octagon: the top is a point, not a flat edge").toHaveLength(2);
    // Sized like its neighbours: wider than the 5 px circle's radius, not a dot.
    const halfWidth = Math.max(...pts.map(([x]) => x)) - 20;
    expect(halfWidth).toBeGreaterThan(5);
    expect(halfWidth).toBeLessThan(5 * 1.3);
  });

  it("the manual's list of symbols names every shape in the dropdown", () => {
    // The list in the Series chapter is written by hand, so it can fall behind the dropdown.
    // Read it off the manual source and hold it to the dropdown.
    const GUIDE = readFileSync(join(HERE, "guide.ts"), "utf8");
    const line = GUIDE.match(/"Symbols: ([^"]*?) — each/);
    expect(line, "the manual's symbol list was not found").toBeTruthy();
    const said = line![1]!.toLowerCase();
    for (const [v, label] of SHAPES) {
      const word = v === "triangle-down" ? "triangle up or down" : label.replace(/[^A-Za-z ]/g, "").trim().toLowerCase();
      expect(said, `the manual does not name "${v}"`).toContain(word);
    }
  });

  it("the waffle's windows stay open at small sizes (not drawn as a solid square at 3 px)", () => {
    // At 3 px a window is 1.44 px wide, and a 1.5 px outline drawn along its edges can cover it.
    // Two things must survive at every size:
    //  (1) each window stays at least 60 % open under its own edge line;
    //  (2) the band between the outer edge line and the window lines stays visible — if it
    //      closes (e.g. when only the window lines are thinned) the 3 px waffle reads as a dark
    //      square with a white cross.
    for (const size of [2, 3, 5, 8]) {
      for (const fill of ["solid", "open", "clear"] as const) {
        const { container } = render(
          <svg>
            <Marker shape="waffle" cx={20} cy={20} size={size} color="#123456" fill={fill} opacity={1} outline="#000000" borderWidth={1.5} />
          </svg>,
        );
        const stroked = Array.from(container.querySelectorAll("path")).filter((p) => {
          const s = p.getAttribute("stroke");
          return !!s && s !== "none";
        });
        // For each stroked path: its squares (half-side, farthest reach from the centre) + line width.
        const parts = stroked.map((p) => {
          const d = p.getAttribute("d") ?? "";
          const halves = [...d.matchAll(/h(-?[\d.]+)/g)].map((m) => Math.abs(Number(m[1])) / 2).filter((v) => v > 0);
          const reach = Math.max(...[...d.matchAll(/M(-?[\d.]+),/g)].map((m) => Math.abs(Number(m[1]) - 20)));
          return { half: Math.min(...halves), reach, sw: Number(p.getAttribute("stroke-width")), squares: halves.length };
        });
        cleanup();
        const tag = `waffle ${fill} ${size}px`;
        for (const q of parts) {
          expect(2 * q.half - q.sw, `${tag}: a ${(2 * q.half).toFixed(2)} px square under a ${q.sw} px line`).toBeGreaterThanOrEqual(0.6 * 2 * q.half - 1e-9);
        }
        // The outer edge is the path whose squares reach farthest with the largest half-side;
        // the windows are the smallest squares.
        const outer = parts.reduce((a, b) => (b.half > a.half ? b : a));
        const win = parts.reduce((a, b) => (b.half < a.half ? b : a));
        expect(outer, `${tag}: no separate window line`).not.toBe(win);
        const band = (outer.half - outer.sw / 2) - (win.reach + win.sw / 2);
        expect(band, `${tag}: the band inside the outer edge is closed`).toBeGreaterThanOrEqual(0.1 * outer.half);
      }
    }
  });

  it("the ring has a hole: two edges, not one disc", () => {
    // A ring drawn as a disc would read as a circle at 5 px — the hole is the whole point.
    expect(markup("ring")).toMatch(/evenodd/);
  });

  it("the waffle is a square with four windows, open in every fill mode", () => {
    // The waffle: a square pierced by a 2 × 2 grid of small
    // squares. Even-odd holes, so the page shows through whatever the fill — a checkerboard
    // is a different shape.
    for (const fill of ["solid", "open", "clear"] as const) {
      const { container } = render(
        <svg>
          <Marker shape="waffle" cx={20} cy={20} size={5} color="#123456" fill={fill} opacity={1} outline="#000000" borderWidth={1.5} />
        </svg>,
      );
      const path = container.querySelector("path");
      const d = path?.getAttribute("d") ?? "";
      const holes = (d.match(/M/g) ?? []).length - 1;
      cleanup();
      expect(path?.getAttribute("fill-rule"), `waffle (${fill}): the windows are not holes`).toBe("evenodd");
      expect(holes, `waffle (${fill}): expected four windows`).toBe(4);
    }
  });
});
