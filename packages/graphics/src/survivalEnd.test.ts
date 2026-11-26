import { describe, expect, it } from "vitest";
import { followUpEnd, holdToEnd } from "./survivalEnd";

describe("followUpEnd — where a Kaplan–Meier curve stops", () => {
  it("is the last step when nothing is censored after it", () => {
    expect(followUpEnd([0, 3, 7], [2, 5])).toBe(7);
    expect(followUpEnd([0, 3, 7], undefined)).toBe(7);
  });

  it("is the last censoring time when someone is followed past the last event", () => {
    expect(followUpEnd([0, 3, 7], [5, 9, 12])).toBe(12);
  });

  it("ignores non-finite times and survives an empty curve", () => {
    expect(followUpEnd([0, 3, Number.NaN], [Number.POSITIVE_INFINITY, 4])).toBe(4);
    expect(followUpEnd([], [])).toBe(0);
  });
});

describe("holdToEnd — carry the last level flat to the end of follow-up", () => {
  const pts = [{ t: 0, s: 1 }, { t: 3, s: 0.6 }, { t: 7, s: 0.4 }];

  it("appends the last level at the end time", () => {
    expect(holdToEnd(pts, 12)).toEqual([...pts, { t: 12, s: 0.4 }]);
  });

  it("leaves a curve that already reaches the end unchanged", () => {
    expect(holdToEnd(pts, 7)).toEqual(pts);
    expect(holdToEnd(pts, 5)).toEqual(pts);
  });

  it("does not alter the input array and tolerates an empty one", () => {
    const copy = pts.map((p) => ({ ...p }));
    holdToEnd(pts, 12);
    expect(pts).toEqual(copy);
    expect(holdToEnd([], 5)).toEqual([]);
  });
});
