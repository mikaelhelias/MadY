// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SCATTER_SUMMARY_OPTS,
  scatterSummaryKey,
  scatterSummaryPair,
  type ScatterCenter,
  type ScatterError,
} from "./columnScatterSummary";

// The ribbon Summary and the Inspector's Summary dropdown both source their options from
// SCATTER_SUMMARY_OPTS, so this list is the only place a column-scatter centre+spread pair
// can be offered. Guard: it must offer every coherent pair and no incoherent one.

// Independent oracle (not the module's own helper): SD / SEM / 95% CI are spread about the
// mean, so pairing any of them with a median centre is the incoherent "median ± SD". The CI of
// the median is the mirror case: it belongs to the median, never around a mean.
const CENTERS: ScatterCenter[] = ["mean", "median"];
const ERRORS: ScatterError[] = ["none", "sd", "sem", "ci95", "range", "iqr", "ciMedian"];
const incoherent = (c: ScatterCenter, e: ScatterError): boolean =>
  (c === "median" && (e === "sd" || e === "sem" || e === "ci95")) || (c === "mean" && e === "ciMedian");

describe("column-scatter summary options", () => {
  it("offers no incoherent median + mean-stat pair", () => {
    const bad = SCATTER_SUMMARY_OPTS.filter((o) => incoherent(o.center, o.error));
    expect(bad.map((o) => o.key)).toEqual([]);
  });

  it("offers every coherent (centre, spread) pair — no valid pairing dropped (e.g. Mean + IQR)", () => {
    const offered = new Set(SCATTER_SUMMARY_OPTS.map((o) => `${o.center}/${o.error}`));
    const wantCoherent = CENTERS.flatMap((c) => ERRORS.map((e) => [c, e] as const))
      .filter(([c, e]) => !incoherent(c, e))
      .map(([c, e]) => `${c}/${e}`);
    expect([...offered].sort()).toEqual([...wantCoherent].sort());
    // Mean + IQR specifically must survive (a legitimate pairing, do not clamp).
    expect(offered.has("mean/iqr")).toBe(true);
  });

  it("has unique keys and round-trips key ↔ pair", () => {
    const keys = SCATTER_SUMMARY_OPTS.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const o of SCATTER_SUMMARY_OPTS) {
      expect(scatterSummaryPair(o.key)).toEqual({ center: o.center, error: o.error });
      expect(scatterSummaryKey({ center: o.center, error: o.error })).toBe(o.key);
    }
  });

  it("defaults to Mean ± SD when unset (undefined → Mean ± SD)", () => {
    expect(scatterSummaryKey(undefined)).toBe("sd");
    expect(scatterSummaryPair("sd")).toEqual({ center: "mean", error: "sd" });
  });

  it("shows a legacy incoherent pair as its coherent mean variant, without offering it", () => {
    // A project saved with median + SD has no option of its own; the dropdown shows the
    // mean variant (display only — the builder still draws the saved pair until changed).
    expect(scatterSummaryKey({ center: "median", error: "sd" })).toBe("sd");
    expect(SCATTER_SUMMARY_OPTS.some((o) => o.center === "median" && o.error === "sd")).toBe(false);
  });
});
