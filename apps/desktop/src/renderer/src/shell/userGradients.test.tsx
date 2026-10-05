// @vitest-environment jsdom
/**
 * The user's cross-project gradient shelf.
 *
 * Small, but it is the thing standing between a user and losing a ramp they spent time on, so
 * the two failure modes that actually happen are pinned: a corrupt entry on disk (the file is
 * user-editable, and one bad record must not take the colour picker down with it), and the
 * round trip through storage.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Gradient } from "@mady/core";
import { findUserGradient, listUserGradients, removeUserGradient, saveUserGradient } from "./userGradients";

const g = (id: string, name = "Mine"): Gradient => ({
  id, name, mode: "stops",
  stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }],
});

describe("userGradients shelf", () => {
  beforeEach(() => localStorage.clear());

  it("saves, lists, finds and removes", () => {
    saveUserGradient(g("a", "A"));
    saveUserGradient(g("b", "B"));
    expect(listUserGradients().map((x) => x.name)).toEqual(["A", "B"]);
    expect(findUserGradient("a")?.stops).toHaveLength(2);
    removeUserGradient("a");
    expect(listUserGradients().map((x) => x.id)).toEqual(["b"]);
    expect(findUserGradient("a")).toBeUndefined();
  });

  it("saving the same id REPLACES it rather than piling up duplicates", () => {
    saveUserGradient(g("a", "First"));
    saveUserGradient({ ...g("a", "Renamed"), steps: 5 });
    expect(listUserGradients()).toHaveLength(1);
    expect(findUserGradient("a")).toMatchObject({ name: "Renamed", steps: 5 });
  });

  it("survives the storage round trip in full — stops, shaping and the sweep", () => {
    const rich: Gradient = {
      ...g("a"), mode: "sweep", space: "lab", steps: 6, gamma: 1.4, midpoint: 0.3,
      sweep: { hueFrom: 10, hueTo: 300, hueDirection: "ccw", hueCycles: 2, saturation: [1, 0.4], lightness: 0.5, sweepStops: 41 },
    };
    saveUserGradient(rich);
    expect(findUserGradient("a")).toEqual(rich);
  });

  it("a corrupt shelf reads as EMPTY rather than throwing — the colour picker must still open", () => {
    localStorage.setItem("mady.userGradients.v1", "{not json at all");
    expect(listUserGradients()).toEqual([]);
    // …and it can be written over.
    saveUserGradient(g("a"));
    expect(listUserGradients().map((x) => x.id)).toEqual(["a"]);
  });

  it("ONE malformed entry is dropped; the good ones beside it survive", () => {
    localStorage.setItem(
      "mady.userGradients.v1",
      JSON.stringify([g("a", "Good"), { id: 7 }, null, { name: "no id or stops" }, g("b", "Also good")]),
    );
    expect(listUserGradients().map((x) => x.name)).toEqual(["Good", "Also good"]);
  });

  it("a shelf that is not even a list reads as empty", () => {
    localStorage.setItem("mady.userGradients.v1", JSON.stringify({ a: 1 }));
    expect(listUserGradients()).toEqual([]);
  });
});
