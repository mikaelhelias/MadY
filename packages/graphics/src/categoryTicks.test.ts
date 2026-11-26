// The category names along a banded axis, in the order they are drawn.
//
// Two readers need exactly the same list: the builder, which matches `categoryGroups.map` against
// it, and the Inspector's By-hand group editor, which shows one box per name. If the two ever
// disagreed, the editor would offer a name the builder never matches — a box you type into and
// nothing moves. So there is one function, and this is its test.
import { describe, expect, it } from "vitest";
import type { AxisScene, AxisTick } from "./scene.js";
import { categoryTicks, tickCategoryName } from "./categoryTicks.js";

const tick = (t: Partial<AxisTick>): AxisTick => ({ value: 0, pos: 0, label: "", ...t }) as AxisTick;
const axis = (ticks: AxisTick[]): AxisScene => ({ ticks }) as unknown as AxisScene;

describe("tickCategoryName", () => {
  it("is the drawn label when there is one", () => {
    expect(tickCategoryName(tick({ label: "Control" }))).toBe("Control");
  });

  it("keeps the name a crowded axis blanked out, so a group cannot silently lose a member", () => {
    expect(tickCategoryName(tick({ label: "", suppressedLabel: "Treated" }))).toBe("Treated");
  });

  it("is the full name when the drawn label was shortened to fit, so a group matches at any figure width", () => {
    // The paired dot plot shortens long row names on a narrow figure ("Cannabis use disord…"). The
    // shortened text depends on the width; a group list keyed by it stops matching when the
    // figure is resized, and the category silently drops out of its group.
    expect(tickCategoryName(tick({ label: "Cannabis use disord…", suppressedLabel: "Cannabis use disorder" }))).toBe("Cannabis use disorder");
  });

  it("is empty for a tick with no name at all", () => {
    expect(tickCategoryName(tick({ label: "" }))).toBe("");
  });
});

describe("categoryTicks", () => {
  it("lists the named ticks in drawing order, not the order they were stored in", () => {
    const ax = axis([
      tick({ pos: 300, label: "C" }),
      tick({ pos: 100, label: "A" }),
      tick({ pos: 200, label: "", suppressedLabel: "B" }),
    ]);
    expect(categoryTicks(ax).map(tickCategoryName)).toEqual(["A", "B", "C"]);
  });

  it("leaves out minor ticks and ticks with no name", () => {
    const ax = axis([
      tick({ pos: 100, label: "A" }),
      tick({ pos: 150, label: "x", minor: true }),
      tick({ pos: 200, label: "" }),
      tick({ pos: 250, label: "B" }),
    ]);
    expect(categoryTicks(ax).map(tickCategoryName)).toEqual(["A", "B"]);
  });

  it("does not reorder the axis it was given", () => {
    const ticks = [tick({ pos: 2, label: "B" }), tick({ pos: 1, label: "A" })];
    categoryTicks(axis(ticks));
    expect(ticks.map((t) => t.label)).toEqual(["B", "A"]);
  });
});
