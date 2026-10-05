import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import { DEFAULT_FIT_FLAGS } from "./model";
import type { DataTable } from "./model";

/**
 * Nonlinear "flag poor fits" — the client's job is to thread the user's thresholds into
 * the curvefit payload ONLY when flagging is enabled (the engine does the comparing).
 * This guards that wiring; the engine's flag logic is guarded independently in
 * engines/py/crosscheck.py (`check_fit_flags`).
 */
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "cx", name: "X", role: "x" },
    { id: "cy", name: "Y", role: "y" },
  ],
  rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { cx: v, cy: v * v } })),
} as never;

const payload = (params: Record<string, unknown>): Record<string, unknown> =>
  buildAnalysisData("curvefit", { columns: ["cx", "cy"], variant: "4pl", ...params } as never, table);

describe("curvefit flag threading", () => {
  it("passes the thresholds through when enabled", () => {
    const flag = { ...DEFAULT_FIT_FLAGS, enabled: true };
    expect(payload({ flag }).flag).toEqual(flag);
  });

  it("omits the flag entirely when disabled or absent", () => {
    expect(payload({}).flag).toBeUndefined();
    expect(payload({ flag: { ...DEFAULT_FIT_FLAGS, enabled: false } }).flag).toBeUndefined();
  });

  it("DEFAULT_FIT_FLAGS is off by default (opt-in feature)", () => {
    expect(DEFAULT_FIT_FLAGS.enabled).toBe(false);
  });
});
