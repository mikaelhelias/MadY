import { describe, it, expect } from "vitest";
import { chordLayout, type ChordEdge } from "./chord";

const edges: ChordEdge[] = [
  { source: "A", target: "B", weight: 3 },
  { source: "A", target: "C", weight: 1 },
  { source: "B", target: "C", weight: 2 },
];

describe("chordLayout", () => {
  it("gives each node an arc ∝ its incident weight", () => {
    const lay = chordLayout(edges);
    // A: 3+1=4, B: 3+2=5, C: 1+2=3 → total 12
    expect(lay.total).toBe(12);
    const arc = (n: string) => lay.nodes.find((x) => x.name === n)!;
    expect(arc("A").value).toBe(4);
    expect(arc("B").value).toBe(5);
    expect(arc("C").value).toBe(3);
    // Full circle (no padding): the arcs tile [0, 2π] with no gap.
    const span = (n: string) => arc(n).endAngle - arc(n).startAngle;
    expect(span("A")).toBeCloseTo((4 / 12) * 2 * Math.PI, 6);
    expect(lay.nodes.reduce((s, a) => s + (a.endAngle - a.startAngle), 0)).toBeCloseTo(2 * Math.PI, 6);
  });

  it("makes one ribbon per undirected pair, its ends ∝ the pair weight", () => {
    const lay = chordLayout(edges);
    expect(lay.ribbons.length).toBe(3); // A-B, A-C, B-C
    const ab = lay.ribbons.find((r) => (r.source === "A" && r.target === "B") || (r.source === "B" && r.target === "A"))!;
    expect(ab.value).toBe(3);
    // Its end on A spans 3/4 of A's arc; on B spans 3/5 of B's arc.
    const arc = (n: string) => lay.nodes.find((x) => x.name === n)!;
    const aSpan = Math.abs((ab.source === "A" ? ab.sourceEnd - ab.sourceStart : ab.targetEnd - ab.targetStart));
    expect(aSpan).toBeCloseTo((3 / 4) * (arc("A").endAngle - arc("A").startAngle), 6);
  });

  it("a node's arc equals the sum of the ribbon ends sitting on it (the invariant)", () => {
    const lay = chordLayout(edges);
    for (const node of lay.nodes) {
      let sum = 0;
      for (const r of lay.ribbons) {
        if (r.source === node.name) sum += r.sourceEnd - r.sourceStart;
        if (r.target === node.name) sum += r.targetEnd - r.targetStart;
      }
      expect(sum, `${node.name} arc vs its ribbon ends`).toBeCloseTo(node.endAngle - node.startAngle, 6);
    }
  });

  it("merges i→j and j→i onto one ribbon (undirected)", () => {
    const lay = chordLayout([
      { source: "A", target: "B", weight: 2 },
      { source: "B", target: "A", weight: 1 },
    ]);
    expect(lay.ribbons.length).toBe(1);
    expect(lay.ribbons[0]!.value).toBe(3); // 2 + 1
  });

  it("drops self-loops and non-positive weights", () => {
    const lay = chordLayout([
      { source: "A", target: "A", weight: 5 }, // self-loop
      { source: "A", target: "B", weight: 0 }, // zero weight
      { source: "A", target: "C", weight: 4 },
    ]);
    expect(lay.nodes.map((n) => n.name).sort()).toEqual(["A", "C"]);
    expect(lay.ribbons.length).toBe(1);
  });

  it("inserts a gap between arcs when padAngle > 0", () => {
    const pad = 0.1;
    const lay = chordLayout(edges, { padAngle: pad });
    const arcs = lay.nodes;
    expect(arcs.length).toBe(3);
    // Total drawn arc = 2π − 3·pad.
    const drawn = arcs.reduce((s, a) => s + (a.endAngle - a.startAngle), 0);
    expect(drawn).toBeCloseTo(2 * Math.PI - 3 * pad, 6);
  });

  it("orders nodes by descending weight when asked", () => {
    const lay = chordLayout(edges, { order: "weight" });
    // B(5) > A(4) > C(3)
    expect(lay.nodes.map((n) => n.name)).toEqual(["B", "A", "C"]);
  });
});
