// @vitest-environment node
/**
 * A fitted parameter that is a time prints in the X axis' own format: on an elapsed-time axis (seconds) as h:mm:ss;
 * on a date axis a place on the axis as its date and a length in days. Anything else is left to the number format.
 */
import { describe, expect, it } from "vitest";
import { fmtTimeParam } from "./fitParams";

const elapsed = { type: "elapsed" as const, origin: 0 };
// The first date of the sheet, as days since the epoch.
const dated = { type: "date" as const, origin: 19000 };

describe("fmtTimeParam", () => {
  it("no time axis: null, so the number format applies", () => {
    expect(fmtTimeParam("Half-life", 8580, 120, undefined)).toBeNull();
  });

  it("a parameter that is not a time: null on any time axis", () => {
    expect(fmtTimeParam("K", 0.01, 0.001, elapsed)).toBeNull();
    expect(fmtTimeParam("Hill slope", 1.2, undefined, dated)).toBeNull();
    expect(fmtTimeParam("R²", 0.99, undefined, dated)).toBeNull();
  });

  it("elapsed axis: a length and a place both as h:mm:ss, the error too", () => {
    expect(fmtTimeParam("Half-life", 8580, 120, elapsed)).toEqual({ value: "2:23:00", se: " ± 0:02:00" });
    expect(fmtTimeParam("Midpoint", 3600, undefined, elapsed)).toEqual({ value: "1:00:00", se: "" });
  });

  it("date axis: a length in days, a place as its date measured from the origin", () => {
    expect(fmtTimeParam("Half-life", 69.3, 2.1, dated)).toEqual({ value: "69.3 days", se: " ± 2.1 days" });
    expect(fmtTimeParam("Doubling time", 1, undefined, dated)).toEqual({ value: "1 day", se: "" });
    expect(fmtTimeParam("EC50", 14, 3, dated)).toEqual({ value: "2022-01-22", se: " ± 3 days" });
    expect(fmtTimeParam("Midpoint", 13.6, undefined, dated)).toEqual({ value: "2022-01-22", se: "" });
  });

  it("an error that is zero, negative or not finite is not printed", () => {
    for (const se of [0, -1, NaN, Infinity]) expect(fmtTimeParam("Half-life", 8580, se, elapsed)!.se).toBe("");
  });
});
