// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { PowerDialog } from "./PowerDialog";

afterEach(cleanup);

/** A canned engine `power` response so the dialog can be tested without a sidecar. */
function fakeEngine(result: Record<string, unknown>, ok = true) {
  const runAnalysis = vi.fn().mockResolvedValue(ok ? { ok: true, results: result } : { ok: false, message: "bad inputs" });
  (window as unknown as { mady: unknown }).mady = { runAnalysis };
  return runAnalysis;
}

const canned = {
  glance: { test: "ttest-two", solve: "n", effect: 0.5, alpha: 0.05, power: 0.8, n: 64, total: 128, per_group: true },
  extra: { tradeoff: { power: [0.7, 0.8, 0.9], n: [51, 64, 86], total: [102, 128, 172] } },
  summary: "Unpaired t power (two-sided, α = 0.05): n per group = 64 (128 total).",
  terms: [],
};

describe("PowerDialog", () => {
  it("calls the engine `power` method and renders the solved N + tradeoff table", async () => {
    const run = fakeEngine(canned);
    const u = render(<PowerDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0]![0]).toBe("power");
    // default payload: unpaired t, solve n, effect 0.5, power 0.8.
    expect(run.mock.calls[0]![1]).toMatchObject({ test: "ttest-two", solve: "n", effect: 0.5, power: 0.8 });
    // The solved value + the tradeoff rows render.
    await waitFor(() => expect(u.container.querySelector('[aria-label="Solved value"]')!.textContent).toContain("64"));
    const rows = u.container.querySelectorAll(".importpreview tbody tr");
    expect(rows).toHaveLength(3);
    expect(rows[1]!.textContent).toContain("64"); // power 0.80 → 64/grp
  });

  it("switching Solve-for reshapes the payload (power given N drops the power input, sends n)", async () => {
    const run = fakeEngine({ ...canned, glance: { ...canned.glance, solve: "power", power: 0.8 } });
    const u = render(<PowerDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    fireEvent.change(u.container.querySelector('select[aria-label="Solve for"]') as HTMLSelectElement, { target: { value: "power" } });
    await waitFor(() => {
      const last = run.mock.calls[run.mock.calls.length - 1]![1] as Record<string, unknown>;
      expect(last.solve).toBe("power");
      expect(last).toHaveProperty("n"); // n is now an input
      expect(last.power).toBeUndefined(); // power is the output
    });
  });

  it("two-proportions design sends p1/p2 (not a raw effect)", async () => {
    const run = fakeEngine(canned);
    const u = render(<PowerDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(run).toHaveBeenCalled());
    fireEvent.change(u.container.querySelector('select[aria-label="Design"]') as HTMLSelectElement, { target: { value: "twoproportions" } });
    await waitFor(() => {
      const last = run.mock.calls[run.mock.calls.length - 1]![1] as Record<string, unknown>;
      expect(last.test).toBe("twoproportions");
      expect(last).toHaveProperty("p1");
      expect(last).toHaveProperty("p2");
    });
  });

  it("shows a graceful error when the engine rejects the inputs", async () => {
    fakeEngine(canned, false);
    const u = render(<PowerDialog onCancel={vi.fn()} />);
    await waitFor(() => expect(u.container.textContent).toContain("bad inputs"));
  });
});
