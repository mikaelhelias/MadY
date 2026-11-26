import { describe, expect, it } from "vitest";
import { assertAnalysisResult, isAnalysisCurve, parseEngineMessage } from "./validation";

const result = { method: "describe", title: "Summary", terms: [{ term: "mean", estimate: 2 }], glance: { n: 3 }, summary: "Three observations." };
describe("untrusted engine data", () => {
  it.each([null, [], {}, { type: "hello", engine: "py", version: "1", contractVersion: "1" },
    { type: "result", id: "r", ok: false, results: {} }, { type: "error", id: "r", ok: false, code: "made_up", message: "Bad" }])("rejects invalid envelopes: %j", value => {
    expect(() => parseEngineMessage(value)).toThrow();
  });
  it("accepts structured errors and handshake library metadata", () => {
    const hello = { type: "hello", engine: "py", version: "1", contractVersion: 1, libraries: { scipy: "1" } };
    expect(parseEngineMessage(hello)).toEqual(hello);
    const error = { type: "error", id: "r", ok: false, code: "numerical", message: "Insufficient data" };
    expect(parseEngineMessage(error)).toEqual(error);
  });
  it.each([{ ...result, terms: [{ term: "mean", p: "not a probability" }] },
    { ...result, glance: { n: Infinity } }, { ...result, warnings: [3] },
    { ...result, method: "globalfit", extra: { curves: "invalid" } },
    { ...result, method: "regression", extra: { curve: { x: [1], y: [] } } }])("rejects malformed results: %j", value => {
    expect(() => assertAnalysisResult(value)).toThrow();
  });
  it("accepts PCA boolean metadata while retaining numeric term fields", () => {
    expect(() => assertAnalysisResult({ ...result, method: "pca", terms: [{ term: "PC1", estimate: 2, retained: true }], glance: { converged: true } }, "pca")).not.toThrow();
  });
  it("checks method identity and supports the ANOVA alias", () => {
    expect(() => assertAnalysisResult(result, "ttest")).toThrow(/different/);
    expect(() => assertAnalysisResult({ ...result, method: "anova1" }, "anova")).not.toThrow();
  });
  it("allows null curve gaps but requires aligned finite samples and bands", () => {
    expect(isAnalysisCurve({ x: [1, 2], y: [null, 4], ciLow: [null, 3] })).toBe(true);
    for (const value of [{ x: [1], y: [2, 3] }, { x: [Infinity], y: [2] }, { x: [1], y: [2], ciLow: [] }, "curve"])
      expect(isAnalysisCurve(value)).toBe(false);
  });
});
