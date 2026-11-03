// @vitest-environment node
/**
 * `clusterBreaks` — where the blocks end when a tree is cut into k clusters.
 *
 * This is what lets a heatmap take its breaks from the clustering instead of from hand-placed
 * numbers, so the two must agree exactly: a break falls where the cut changes cluster, in the
 * order the leaves are drawn (leaf ids mean nothing once the tree has reordered them).
 */
import { describe, expect, it } from "vitest";
import { clusterBreaks, clusterLabels, hclust } from "./cluster";

/** Three tight pairs, far apart — a tree with an obvious 3-way cut. */
const THREE_GROUPS = [
  [0, 0], [0.1, 0.1],
  [10, 10], [10.1, 10.1],
  [20, 20], [20.1, 20.1],
];

describe("clusterBreaks", () => {
  const tree = hclust(THREE_GROUPS, "euclidean", "average");

  it("cuts three obvious groups into three blocks, breaking between them", () => {
    const breaks = clusterBreaks(tree, 3);
    expect(breaks).toHaveLength(2);
    // every break separates two leaves with different cluster labels
    const labels = clusterLabels(tree, 3);
    for (const b of breaks) {
      expect(labels[tree.order[b]!]).not.toBe(labels[tree.order[b + 1]!]);
    }
    // …and no break falls inside a block
    for (let i = 0; i < tree.order.length - 1; i++) {
      const same = labels[tree.order[i]!] === labels[tree.order[i + 1]!];
      expect(breaks.includes(i), `position ${i}`).toBe(!same);
    }
  });

  it("k blocks means k-1 breaks", () => {
    expect(clusterBreaks(tree, 2)).toHaveLength(1);
    expect(clusterBreaks(tree, 3)).toHaveLength(2);
    expect(clusterBreaks(tree, 6)).toHaveLength(5);
  });

  it("is in display order, ascending, and never touches the ends", () => {
    const breaks = clusterBreaks(tree, 3);
    expect([...breaks].sort((a, b) => a - b)).toEqual(breaks);
    for (const b of breaks) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(tree.n - 1); // a break after the last leaf splits nothing
    }
  });

  it("k below 2, or a tree with fewer than two leaves, breaks nothing", () => {
    expect(clusterBreaks(tree, 1)).toEqual([]);
    expect(clusterBreaks(tree, 0)).toEqual([]);
    expect(clusterBreaks(hclust([[1, 1]], "euclidean", "average"), 3)).toEqual([]);
  });

  it("asking for more blocks than there are leaves gives every leaf its own, no more", () => {
    expect(clusterBreaks(tree, 99)).toHaveLength(5); // 6 leaves → 5 breaks, not 98
  });
});
