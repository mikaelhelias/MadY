import { describe, expect, it } from "vitest";
import { hclust, clusterLabels, vectorDistance, pairwiseDistances } from "./cluster";

// Four 1-D points A=0 B=1 C=4 D=6 → pairwise euclidean:
//   AB=1 AC=4 AD=6 BC=3 BD=5 CD=2.
const P: number[][] = [[0], [1], [4], [6]];

describe("vectorDistance / pairwiseDistances", () => {
  it("euclidean / manhattan / correlation", () => {
    expect(vectorDistance([0, 0], [3, 4], "euclidean")).toBeCloseTo(5, 10);
    expect(vectorDistance([0, 0], [3, 4], "manhattan")).toBeCloseTo(7, 10);
    // Perfectly correlated → distance 0; anti-correlated → 2.
    expect(vectorDistance([1, 2, 3], [2, 4, 6], "correlation")).toBeCloseTo(0, 10);
    expect(vectorDistance([1, 2, 3], [3, 2, 1], "correlation")).toBeCloseTo(2, 10);
  });
  it("symmetric matrix with a zero diagonal", () => {
    const D = pairwiseDistances(P, "euclidean");
    expect(D[0]![1]).toBeCloseTo(1, 10);
    expect(D[2]![3]).toBeCloseTo(2, 10);
    expect(D[0]![0]).toBe(0);
    expect(D[1]![3]).toBeCloseTo(D[3]![1]!, 12);
  });
});

// Merge heights are exactly hand-computable for these three classic linkages.
describe("hclust — merge heights match hand computation", () => {
  const heightsInOrder = (r: ReturnType<typeof hclust>): number[] =>
    r.nodes.filter((n) => n.left !== null).map((n) => n.height);

  it("average: AB@1, CD@2, then {AB}-{CD}=avg(4,6,3,5)=4.5", () => {
    const r = hclust(P, "euclidean", "average");
    expect(heightsInOrder(r)).toEqual([1, 2, 4.5]);
    expect(r.order).toEqual([0, 1, 2, 3]); // A B | C D, no crossings
    expect(r.root).toBe(6); // 2n-2
    expect(r.nodes).toHaveLength(7); // 2n-1
  });

  it("single: {AB}-{CD}=min(4,6,3,5)=3", () => {
    const r = hclust(P, "euclidean", "single");
    expect(heightsInOrder(r)).toEqual([1, 2, 3]);
  });

  it("complete: {AB}-{CD}=max(4,6,3,5)=6", () => {
    const r = hclust(P, "euclidean", "complete");
    expect(heightsInOrder(r)).toEqual([1, 2, 6]);
  });

  // Ward's Lance-Williams recurrence is only valid on Euclidean geometry, so `hclust`
  // forces Euclidean for ward regardless of the requested metric (mirroring the scipy
  // analysis path). 2-D points chosen so euclidean and manhattan distances genuinely
  // differ — otherwise this test would pass vacuously.
  const Q: number[][] = [[0, 0], [1, 1], [4, 0], [5, 5]];
  const heights = (r: ReturnType<typeof hclust>): number[] => r.nodes.filter((n) => n.left !== null).map((n) => n.height);
  it("ward is computed on Euclidean even when another metric is requested", () => {
    // The fixture must distinguish metrics, or the equality below proves nothing:
    expect(heights(hclust(Q, "manhattan", "average"))).not.toEqual(heights(hclust(Q, "euclidean", "average")));
    // …yet ward+manhattan is coerced to ward+euclidean (remove the coercion and this fails):
    expect(heights(hclust(Q, "manhattan", "ward"))).toEqual(heights(hclust(Q, "euclidean", "ward")));
    expect(heights(hclust(Q, "correlation", "ward"))).toEqual(heights(hclust(Q, "euclidean", "ward")));
  });

  // Independent oracle: a recomputation sharing no code with the implementation. Reference
  // merge heights from scipy.cluster.hierarchy.linkage on the 6 points
  // below, euclidean — a completely different implementation than this file's Lance-Williams.
  //   Q6 = [[0,0],[1,1],[4,0],[5,5],[2,3],[6,1]]
  //   scipy: single  [1.414214,2.236068,2.236068,3.162278,3.605551]
  //          complete[1.414214,2.236068,3.605551,5.09902,7.071068]
  //          average [1.414214,2.236068,2.92081,4.387121,5.11112]
  //          ward    [1.414214,2.236068,3.366502,5.196152,7.023769]
  it("merge heights match scipy.cluster.hierarchy.linkage (independent oracle)", () => {
    const Q6: number[][] = [[0, 0], [1, 1], [4, 0], [5, 5], [2, 3], [6, 1]];
    const sortedHeights = (link: "single" | "complete" | "average" | "ward"): number[] =>
      hclust(Q6, "euclidean", link).nodes.filter((n) => n.left !== null).map((n) => n.height).sort((a, b) => a - b);
    const scipy = {
      single: [1.414214, 2.236068, 2.236068, 3.162278, 3.605551],
      complete: [1.414214, 2.236068, 3.605551, 5.09902, 7.071068],
      average: [1.414214, 2.236068, 2.92081, 4.387121, 5.11112],
      ward: [1.414214, 2.236068, 3.366502, 5.196152, 7.023769],
    } as const;
    for (const link of ["single", "complete", "average", "ward"] as const) {
      const got = sortedHeights(link);
      expect(got, link).toHaveLength(5);
      got.forEach((h, i) => expect(h, `${link}[${i}]`).toBeCloseTo(scipy[link][i]!, 5));
    }
  });

  it("heights are monotone non-decreasing (leaves → root) for every linkage", () => {
    for (const link of ["single", "complete", "average", "ward"] as const) {
      const r = hclust(P, "euclidean", link);
      const h = r.nodes.filter((n) => n.left !== null).map((n) => n.height);
      for (let i = 1; i < h.length; i++) expect(h[i]!).toBeGreaterThanOrEqual(h[i - 1]! - 1e-9);
      // A valid binary tree: n-1 internal nodes, order is a permutation of 0…n-1.
      expect(h).toHaveLength(3);
      expect([...r.order].sort()).toEqual([0, 1, 2, 3]);
    }
  });
});

describe("clusterLabels — cutting the tree", () => {
  it("k=2 splits {A,B} from {C,D}", () => {
    const r = hclust(P, "euclidean", "average");
    const l = clusterLabels(r, 2);
    expect(l[0]).toBe(l[1]); // A,B together
    expect(l[2]).toBe(l[3]); // C,D together
    expect(l[0]).not.toBe(l[2]); // different clusters
    expect(new Set(l).size).toBe(2);
  });
  it("k=1 → all one cluster; k=n → all distinct", () => {
    const r = hclust(P, "euclidean", "average");
    expect(new Set(clusterLabels(r, 1)).size).toBe(1);
    expect(new Set(clusterLabels(r, 4)).size).toBe(4);
  });
  it("labels read left→right (adjacent leaves in a cut cluster share a label)", () => {
    const r = hclust(P, "euclidean", "average");
    const l = clusterLabels(r, 2);
    // order is [0,1,2,3]; labels along that order are non-decreasing 0,0,1,1.
    const along = r.order.map((leaf) => l[leaf]!);
    expect(along).toEqual([0, 0, 1, 1]);
  });
});

describe("hclust — degenerate sizes", () => {
  it("n=0 and n=1 give trivial trees (no crash)", () => {
    expect(hclust([], "euclidean", "average").order).toEqual([]);
    const one = hclust([[5]], "euclidean", "average");
    expect(one.order).toEqual([0]);
    expect(one.nodes).toHaveLength(1);
  });
  it("2-D observations cluster by proximity", () => {
    // Two tight pairs far apart → both within-pair merges happen before the cross merge.
    const data = [[0, 0], [1, 0], [20, 20], [21, 20]];
    const r = hclust(data, "euclidean", "average");
    // The two lowest internal nodes (ids 4,5) are the within-pair merges {0,1} and {2,3}.
    const pair = (node: (typeof r.nodes)[number]): Set<number> => new Set([node.left!, node.right!]);
    const merges = [pair(r.nodes[4]!), pair(r.nodes[5]!)];
    expect(merges).toContainEqual(new Set([0, 1]));
    expect(merges).toContainEqual(new Set([2, 3]));
    // The root joins the two pair-clusters (ids 4 and 5), not two raw leaves.
    expect(pair(r.nodes[6]!)).toEqual(new Set([4, 5]));
  });
});
