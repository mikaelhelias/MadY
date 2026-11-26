// @vitest-environment jsdom
/**
 * The demo project's analyses ship without results (the numbers are never typed into the
 * fixture); the app computes them through the real engine on boot, the same way it fills an
 * opened .mady whose analyses have no result (`fillMissingAnalysisResults`).
 *
 * Two things must hold:
 *  1. on boot, every result-less analysis is sent to the engine and its result attached;
 *  2. attaching a derived value to an untouched document must not make it dirty — otherwise a
 *     fresh launch quits through the "unsaved changes" prompt having changed nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { AppShell } from "./AppShell";

type Mady = { runAnalysis: ReturnType<typeof vi.fn>; setDirty: ReturnType<typeof vi.fn> };
const install = (): Mady => {
  const mady: Mady = {
    runAnalysis: vi.fn(async (method: string) => ({
      ok: true,
      results: { method, title: `stub ${method}`, terms: [], glance: { p: 0.01 }, summary: "stub" },
    })),
    setDirty: vi.fn(),
  };
  (window as unknown as { mady: unknown }).mady = mady;
  return mady;
};
afterEach(() => {
  cleanup();
  delete (window as unknown as { mady?: unknown }).mady;
});

describe("AppShell — demo analyses are computed on boot", () => {
  it("sends every result-less demo analysis to the engine once and attaches the results", async () => {
    const mady = install();
    render(<AppShell />);
    await waitFor(() => expect(mady.runAnalysis.mock.calls.length).toBeGreaterThanOrEqual(6));
    const methods = mady.runAnalysis.mock.calls.map((c) => c[0] as string).sort();
    expect(methods).toEqual(["anova", "anova", "cluster", "curvefit", "pca", "ttest"]);
    // Each call carries the engine payload built from the live sheet (not an empty object).
    for (const [, data] of mady.runAnalysis.mock.calls) expect(Object.keys(data as object).length).toBeGreaterThan(0);
  });

  it("the untouched document stays clean after the results land (derived values do not dirty it)", async () => {
    const mady = install();
    render(<AppShell />);
    await waitFor(() => expect(mady.runAnalysis.mock.calls.length).toBeGreaterThanOrEqual(6));
    // Let the last result's re-render report its dirty state to main.
    await waitFor(() => expect(mady.setDirty).toHaveBeenCalled());
    const last = mady.setDirty.mock.calls.at(-1)![0] as boolean;
    expect(last, "a fresh launch that changed nothing must not read as unsaved").toBe(false);
  });
});
