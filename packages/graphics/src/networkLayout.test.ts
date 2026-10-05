import { describe, it, expect } from "vitest";
import { buildGraph, forceLayout, circularLayout, layeredLayout, normalizePositions } from "./networkLayout.js";

describe("networkLayout — buildGraph (edge list → graph)", () => {
  it("dedupes nodes in first-appearance order and counts degree", () => {
    const g = buildGraph(["A", "A", "B"], ["B", "C", "C"]);
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(g.edges).toHaveLength(3);
    const deg = Object.fromEntries(g.nodes.map((n) => [n.id, n.degree]));
    expect(deg).toEqual({ A: 2, B: 2, C: 2 });
  });

  it("defaults weight to 1, honours positive finite weights, and drops empty / self-loop rows", () => {
    // row0 A→B w2 · row1 B→C w(undef→1) · row2 C→C self-loop dropped · row3 ""→X empty dropped · row4 D→D self-loop dropped
    const g = buildGraph(["A", "B", "C", "", "D"], ["B", "C", "C", "X", "D"], [2, undefined, 1, 1, 1]);
    expect(g.edges.map((e) => `${e.source}>${e.target}:${e.weight}`)).toEqual(["A>B:2", "B>C:1"]);
    // A negative weight keeps its magnitude and its sign (a correlation edge list carries
    // signed rho), and widths stay positive. Coercing the cell to 1 would destroy both.
    const gw = buildGraph(["A"], ["B"], [-5]);
    expect(gw.edges[0]!.weight).toBe(5);
    expect(gw.edges[0]!.sign).toBe(-1);
    // A zero weight still falls back to 1 (positive width), with no sign to colour by.
    const gz = buildGraph(["A"], ["B"], [0]);
    expect(gz.edges[0]!.weight).toBe(1);
    expect(gz.edges[0]!.sign).toBe(0);
    // …and a missing weight is sign 0 too — "no weight" must never read as "positive".
    const gm = buildGraph(["A"], ["B"]);
    expect(gm.edges[0]!.sign).toBe(0);
  });

  it("attaches group + size metric from the first row a node leads", () => {
    const g = buildGraph(
      ["A", "B", "A"], ["B", "C", "C"],
      undefined, undefined,
      ["G1", "  ", "G2"], // A leads rows 0+2 — the first usable cell wins; blank is not usable
      [4, undefined, 9],
    );
    const by = Object.fromEntries(g.nodes.map((n) => [n.id, { g: n.group, m: n.metric }]));
    expect(by.A).toEqual({ g: "G1", m: 4 });
    expect(by.B).toEqual({ g: undefined, m: undefined }); // blank group + missing metric stay unset
    expect(by.C).toEqual({ g: undefined, m: undefined }); // never leads a row
  });

  it("attaches a per-node value from the first row a node leads", () => {
    const g = buildGraph(["A", "B", "A"], ["B", "C", "C"], undefined, [0.9, -0.4, 0.1]);
    const val = Object.fromEntries(g.nodes.map((n) => [n.id, n.value]));
    expect(val.A).toBeCloseTo(0.9); // A's value from its first row
    expect(val.B).toBeCloseTo(-0.4); // B leads row 2
    expect(val.C).toBeUndefined(); // C never leads a row → no value
  });
});

describe("networkLayout — layouts", () => {
  const g = buildGraph(["A", "B", "C", "D", "A"], ["B", "C", "D", "A", "C"]);

  it("force layout is deterministic (same input → identical positions)", () => {
    const p1 = forceLayout(g.nodes, g.edges, { seed: 42, iterations: 80 });
    const p2 = forceLayout(g.nodes, g.edges, { seed: 42, iterations: 80 });
    expect(p1).toEqual(p2);
    expect(p1).toHaveLength(4);
    expect(p1.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
  });

  it("force layout separates non-adjacent nodes (no two nodes coincide)", () => {
    const p = forceLayout(g.nodes, g.edges, { seed: 7, iterations: 200 });
    let minPair = Infinity;
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) minPair = Math.min(minPair, Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y));
    expect(minPair).toBeGreaterThan(0.02);
  });

  it("circular layout puts nodes on a circle of radius ~0.42 about the centre", () => {
    const p = circularLayout(g.nodes);
    expect(p).toHaveLength(4);
    for (const q of p) expect(Math.hypot(q.x - 0.5, q.y - 0.5)).toBeCloseTo(0.42, 5);
  });

  it("handles the degenerate 0- and 1-node cases", () => {
    expect(forceLayout([], [])).toEqual([]);
    const one = buildGraph(["A"], ["A"]); // a self-loop row is skipped, so it adds no node
    expect(one.nodes).toHaveLength(0);
    const solo = buildGraph(["A"], ["B"]);
    expect(forceLayout([solo.nodes[0]!], [])).toEqual([{ x: 0.5, y: 0.5 }]);
  });
});

describe("networkLayout — layeredLayout", () => {
  it("ranks a chain A→B→C→D into four left-to-right layers", () => {
    const g = buildGraph(["A", "B", "C"], ["B", "C", "D"]);
    const p = layeredLayout(g.nodes, g.edges);
    const xOf = Object.fromEntries(g.nodes.map((n, i) => [n.id, p[i]!.x]));
    // Strictly increasing x along the chain (0, 1/3, 2/3, 1).
    expect(xOf.A).toBeCloseTo(0, 5);
    expect(xOf.B).toBeCloseTo(1 / 3, 5);
    expect(xOf.C).toBeCloseTo(2 / 3, 5);
    expect(xOf.D).toBeCloseTo(1, 5);
  });

  it("puts a shared source and its two targets in adjacent layers (longest path)", () => {
    // A→B, A→C, B→D, C→D → layers A=0, B=C=1, D=2.
    const g = buildGraph(["A", "A", "B", "C"], ["B", "C", "D", "D"]);
    const p = layeredLayout(g.nodes, g.edges);
    const xOf = Object.fromEntries(g.nodes.map((n, i) => [n.id, p[i]!.x]));
    expect(xOf.A).toBeCloseTo(0, 5);
    expect(xOf.B).toBeCloseTo(0.5, 5);
    expect(xOf.C).toBeCloseTo(0.5, 5); // same layer as B
    expect(xOf.D).toBeCloseTo(1, 5);
    // The two co-layer nodes are separated on the y axis (no overlap).
    const bi = g.nodes.findIndex((n) => n.id === "B");
    const ci = g.nodes.findIndex((n) => n.id === "C");
    expect(p[bi]!.y).not.toBeCloseTo(p[ci]!.y, 2);
    expect(p.every((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)).toBe(true);
  });

  it("is deterministic and cycle-safe (a back-edge doesn't hang or blow up)", () => {
    const g = buildGraph(["A", "B", "C"], ["B", "C", "A"]); // 3-cycle
    const p1 = layeredLayout(g.nodes, g.edges);
    const p2 = layeredLayout(g.nodes, g.edges);
    expect(p1).toEqual(p2);
    expect(p1).toHaveLength(3);
    expect(p1.every((q) => q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1)).toBe(true);
  });
});

describe("networkLayout — normalizePositions", () => {
  it("rescales to fill [0,1]² and centres a zero-span axis", () => {
    const norm = normalizePositions([{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.5 }]);
    expect(Math.min(...norm.map((p) => p.x))).toBeCloseTo(0, 6);
    expect(Math.max(...norm.map((p) => p.x))).toBeCloseTo(1, 6);
    expect(norm.every((p) => p.y === 0.5)).toBe(true); // zero-span y centred
  });
});
