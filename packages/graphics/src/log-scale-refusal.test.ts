import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

/**
 * A log scale a kind cannot draw is refused with a warning.
 *
 * Four kinds lay their value axis out with a bespoke linear scale and never read
 * `AxisSpec.scale` at all: setting "Log10" in the Axis tab does nothing on either axis,
 * even with all-positive data, so the builder must say so. Silence would be worse than the
 * data-dependent refusal box/scatter already make ("Log Y needs all-positive values"),
 * which at least explains itself. A control the user turns on that changes nothing, with
 * no message, is indistinguishable from a broken app.
 *
 * These pin the refusal, not the absence of the feature: honouring log on a mirrored
 * pyramid axis or an estimation plot's paired-difference axis would be a separate feature,
 * and a kind that gains it would assert here that the scale is honoured instead.
 */
const positive: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c0", name: "G" }, { id: "c1", name: "A", role: "y" }, { id: "c2", name: "B", role: "y" }],
  rows: [
    { id: "r0", cells: { c0: "one", c1: 1, c2: 5 } },
    { id: "r1", cells: { c0: "two", c1: 40, c2: 200 } },
    { id: "r2", cells: { c0: "three", c1: 900, c2: 7000 } },
  ],
};

const build = (kind: string, patch: Record<string, unknown>): { warnings: string[] } =>
  buildPlotScene(positive, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...patch } as unknown as Plot,
    { width: 460, height: 320 }) as unknown as { warnings: string[] };

const KINDS: [string, string][] = [
  ["lollipop", "lollipop / dumbbell chart"],
  ["paireddot", "paired dot plot"],
  ["pyramid", "population pyramid"],
  ["estimation", "estimation plot"],
];

describe("a log scale a kind cannot draw is refused with a warning", () => {
  for (const [kind, label] of KINDS) {
    for (const axis of ["xAxis", "yAxis"] as const) {
      it(`${kind}: a log request on ${axis} is refused with a warning`, () => {
        const w = build(kind, { [axis]: { scale: "log10" } }).warnings;
        expect(w.some((x) => x.includes(label) && /log scale is not available/i.test(x)), `warnings were ${JSON.stringify(w)}`).toBe(true);
      });
    }

    it(`${kind}: says nothing when no log scale was asked for`, () => {
      // The other half of the contract — a warning that always fires is noise, and would
      // train the user to ignore the panel that carries the real ones.
      const w = build(kind, {}).warnings;
      expect(w.some((x) => /log scale is not available/i.test(x))).toBe(false);
      expect(build(kind, { yAxis: { scale: "linear" } }).warnings.some((x) => /log scale is not available/i.test(x))).toBe(false);
    });
  }

  it("control case: kinds that support log are untouched — they honour it", () => {
    // box/scatter/bar/histogram draw a real log value axis; they must not gain the refusal.
    for (const kind of ["box", "scatter", "bar", "histogram"]) {
      const lin = JSON.stringify(build(kind, {}));
      const log = JSON.stringify(build(kind, { yAxis: { scale: "log10" } }));
      expect(lin === log, `${kind} should honour a log value axis on positive data`).toBe(false);
      expect(build(kind, { yAxis: { scale: "log10" } }).warnings.some((x) => /not available/i.test(x))).toBe(false);
    }
  });
});

/**
 * The same case in six more bespoke kinds plus volcano. None of survival / ROC /
 * Bland-Altman / ordination score plot / ordination triplot / dendrogram reads
 * `AxisSpec.scale` either, so without a refusal the control would do nothing, with no
 * message, on all of them. Volcano is different: it
 * forces linear deliberately, because its axes are already log-transformed data (log2 fold
 * change is signed, so a log scale would drop the down-regulated half) — and it must say so.
 */
const SURV_T: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "Weeks" }], rows: [] };
const SURV_P = {
  kind: "survival",
  survival: [{ label: "Treated", times: [0, 5, 10], surv: [1, 0.7, 0.4] }],
};
const ROC_P = {
  kind: "roc",
  roc: [{ label: "Marker", auc: 0.82, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.5, tpr: 0.8 }, { fpr: 1, tpr: 1 }] }],
};
const PCA_P = {
  kind: "pcascore",
  pca: {
    varLabels: ["Va", "Vb"], pcLabels: ["PC1", "PC2"], explained: [0.7, 0.3], eigenvalues: [1.4, 0.6],
    loadings: [[0.7, -0.2], [0.5, 0.6]], scores: [[-1.5, 0.4], [1.4, -0.5]], groups: ["A", "B"],
  },
};
const PAIRED: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "s", name: "S", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [
    { id: "r0", cells: { s: 1, a: 10, b: 10.6 } },
    { id: "r1", cells: { s: 2, a: 12, b: 11.4 } },
    { id: "r2", cells: { s: 3, a: 8, b: 8.2 } },
    { id: "r3", cells: { s: 4, a: 14, b: 13.8 } },
  ],
};

const buildOn = (table: DataTable, patch: Record<string, unknown>): { warnings: string[] } =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, ...patch } as unknown as Plot,
    { width: 460, height: 340 }) as unknown as { warnings: string[] };

const MORE: [string, DataTable, Record<string, unknown>, string][] = [
  ["survival", SURV_T, SURV_P, "a survival curve"],
  ["roc", SURV_T, ROC_P, "a ROC curve"],
  // The same builder draws a PCoA / NMDS / CA, so the refusal says "ordination". The triplot joins it — an ordination axis is a signed latent
  // coordinate that crosses zero, so a log scale is meaningless on every one of them.
  ["pcascore", SURV_T, PCA_P, "an ordination score plot"],
  ["triplot", SURV_T, { kind: "triplot", pca: (PCA_P as { pca: unknown }).pca }, "an ordination triplot"],
  ["blandaltman", PAIRED, { kind: "blandaltman" }, "a Bland-Altman plot"],
  ["dendrogram", PAIRED, { kind: "dendrogram" }, "a dendrogram"],
  ["volcano", PAIRED, { kind: "volcano" }, "a volcano plot"],
];

describe("the same refusal in six more kinds + volcano", () => {
  for (const [kind, table, patch, label] of MORE) {
    for (const axis of ["xAxis", "yAxis"] as const) {
      it(`${kind}: a log request on ${axis} is refused with a warning`, () => {
        const w = buildOn(table, { ...patch, [axis]: { scale: "log10" } }).warnings;
        expect(w.some((x) => x.includes(label) && /log scale is not available/i.test(x)),
          `warnings were ${JSON.stringify(w)}`).toBe(true);
      });
    }
    it(`${kind}: stays quiet when no log scale was asked for`, () => {
      expect(buildOn(table, patch).warnings.some((x) => /log scale is not available/i.test(x))).toBe(false);
    });
  }
});
