// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MonteCarloDialog } from "./MonteCarloDialog";

afterEach(cleanup);

/** A canned engine `montecarlo` response so the dialog can be tested without a sidecar. */
function fakeEngine(result: Record<string, unknown>, ok = true) {
  const runAnalysis = vi.fn().mockResolvedValue(ok ? { ok: true, results: result } : { ok: false, message: "bad inputs" });
  (window as unknown as { mady: unknown }).mady = { runAnalysis };
  return runAnalysis;
}

const canned = {
  glance: { iterations: 300, converged: 300, conv_rate: 100, points: 10, replicates: 1, n: 10 },
  summary: "300 Monte-Carlo fits of Michaelis-Menten (300 converged, 100%).",
  terms: [
    { term: "Vmax", true: 100, estimate: 100.2, bias: 0.2, sd: 3.98, cv: 3.97, ciLow: 92.5, ciHigh: 108.1 },
    { term: "KM", true: 10, estimate: 10.2, bias: 0.2, sd: 2.1, cv: 20.6, ciLow: 6.3, ciHigh: 14.5 },
  ],
};

describe("MonteCarloDialog", () => {
  it("calls the engine `montecarlo` method and renders the per-parameter distribution table", async () => {
    const run = fakeEngine(canned);
    const u = render(<MonteCarloDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toBe("montecarlo");
    // default payload: Michaelis-Menten, true Vmax/KM = 100/10, 300 iterations.
    expect(run.mock.calls[0]![1]).toMatchObject({ model: "mm", trueParams: [100, 10], iterations: 300 });
    await waitFor(() => expect(u.container.querySelectorAll(".importpreview tbody tr")).toHaveLength(2));
    expect(u.container.textContent).toContain("Vmax");
    expect(u.container.textContent).toContain("3.98"); // Vmax fitted SD
  });

  it("picking a different model reshapes the payload (4PL → its true params + log-X)", async () => {
    const run = fakeEngine(canned);
    const u = render(<MonteCarloDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    fireEvent.change(u.container.querySelector('select[aria-label="Model"]') as HTMLSelectElement, { target: { value: "4pl" } });
    await waitFor(() => {
      const last = run.mock.calls[run.mock.calls.length - 1]![1] as Record<string, unknown>;
      expect(last.model).toBe("4pl");
      expect(last.trueParams).toEqual([0, 100, 1, 1]);
      expect(last.xLog).toBe(true);
    });
  });

  it("editing a true-parameter value flows into the payload", async () => {
    const run = fakeEngine(canned);
    const u = render(<MonteCarloDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    fireEvent.change(u.container.querySelector('input[aria-label="Vmax (true)"]') as HTMLInputElement, { target: { value: "250" } });
    await waitFor(() => {
      const last = run.mock.calls[run.mock.calls.length - 1]![1] as Record<string, unknown>;
      expect((last.trueParams as number[])[0]).toBe(250);
    });
  });

  it("shows a graceful error when the engine rejects the inputs", async () => {
    fakeEngine(canned, false);
    const u = render(<MonteCarloDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(u.container.textContent).toContain("bad inputs"));
  });
});
