import { describe, it, expect } from "vitest";
import { sunburstHierarchy, sunburstDepth, type SunburstItem } from "./sunburst";

const items: SunburstItem[] = [
  { path: ["Animalia", "Chordata"], value: 3, rowId: "r1" },
  { path: ["Animalia", "Arthropoda"], value: 5, rowId: "r2" },
  { path: ["Plantae", "Angiosperms"], value: 2, rowId: "r3" },
  { path: ["Animalia", "Chordata"], value: 1, rowId: "r4" },
];
const cols = ["kingdom", "phylum"];

describe("sunburstHierarchy", () => {
  it("rolls a parent's value up to the sum of its children", () => {
    const root = sunburstHierarchy(items, cols);
    expect(root.value).toBe(11); // 3+5+2+1
    const animalia = root.children.find((c) => c.name === "Animalia")!;
    expect(animalia.value).toBe(9); // 3+5+1
    const plantae = root.children.find((c) => c.name === "Plantae")!;
    expect(plantae.value).toBe(2);
    // a parent equals the sum of its children, at every node
    for (const node of [root, animalia, plantae]) {
      if (node.children.length) {
        expect(node.value).toBe(node.children.reduce((s, c) => s + c.value, 0));
      }
    }
  });

  it("merges repeated paths into one leaf (Chordata seen twice → 4)", () => {
    const root = sunburstHierarchy(items, cols);
    const chordata = root.children.find((c) => c.name === "Animalia")!.children.find((c) => c.name === "Chordata")!;
    expect(chordata.value).toBe(4); // 3 + 1
  });

  it("keeps children in first-appearance order", () => {
    const root = sunburstHierarchy(items, cols);
    expect(root.children.map((c) => c.name)).toEqual(["Animalia", "Plantae"]);
    const animalia = root.children[0]!;
    expect(animalia.children.map((c) => c.name)).toEqual(["Chordata", "Arthropoda"]);
  });

  it("tags each node with its level column id and a representative source row", () => {
    const root = sunburstHierarchy(items, cols);
    const animalia = root.children[0]!;
    expect(animalia.columnId).toBe("kingdom");
    expect(animalia.children[0]!.columnId).toBe("phylum");
    expect(animalia.rowId).toBe("r1"); // first row through Animalia
  });

  it("reports the deepest depth", () => {
    expect(sunburstDepth(sunburstHierarchy(items, cols))).toBe(2);
  });

  it("skips all-blank paths and stops a row's descent at a blank level (a shallower leaf)", () => {
    const mixed: SunburstItem[] = [
      { path: ["A", "X"], value: 2, rowId: "a" },
      { path: ["A", ""], value: 3, rowId: "b" }, // ends at A — A gets +3 but no blank child
      { path: ["", ""], value: 9, rowId: "c" }, // skipped entirely
    ];
    const root = sunburstHierarchy(mixed, cols);
    expect(root.value).toBe(5); // 2 + 3 (the all-blank row dropped)
    const a = root.children.find((c) => c.name === "A")!;
    expect(a.value).toBe(5);
    expect(a.children.map((c) => c.name)).toEqual(["X"]); // no "" child from row b
    expect(a.children[0]!.value).toBe(2);
  });

  it("treats a non-finite value as 0 (no NaN poisoning the roll-up)", () => {
    const root = sunburstHierarchy([{ path: ["A"], value: NaN, rowId: "a" }, { path: ["A"], value: 4, rowId: "b" }], cols);
    expect(root.children[0]!.value).toBe(4);
  });
});
