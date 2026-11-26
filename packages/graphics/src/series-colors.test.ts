import { describe, expect, it } from "vitest";
import { OKABE_ITO, seriesColors } from "./palette";

const [BLUE, ORANGE, GREEN, VERMILLION] = OKABE_ITO as [string, string, string, string];

describe("seriesColors — a series with no saved colour never repeats a sibling's", () => {
  it("with nothing saved, every series takes its palette slot (unchanged from seriesColor)", () => {
    expect(seriesColors([undefined, undefined, undefined])).toEqual([BLUE, ORANGE, GREEN]);
  });

  it("saved colours are kept exactly, even when they repeat each other (a user's choice)", () => {
    expect(seriesColors(["#123456", "#123456"])).toEqual(["#123456", "#123456"]);
  });

  it("an unsaved series skips a colour a saved sibling already wears", () => {
    // Paired-dot case: the two saved series wear orange and green (stamped one slot later than
    // their position, because the section text column counts as a slot), so a third series added without a
    // colour would land on green by slot — two series, one colour.
    // It takes the next colour after its slot (vermillion), not the first free one (blue): that is
    // the colour re-applying a preset stamps on the 4th column, so restyling does not make it jump.
    expect(seriesColors([ORANGE, GREEN, undefined])).toEqual([ORANGE, GREEN, VERMILLION]);
  });

  it("a saved colour later in the list is also avoided", () => {
    expect(seriesColors([undefined, ORANGE])).toEqual([BLUE, ORANGE]);
    expect(seriesColors([undefined, BLUE])).toEqual([ORANGE, BLUE]);
  });

  it("a colour just given to an earlier unsaved series is not given out twice", () => {
    // slot 0 (blue) is saved further on → the first series moves to orange, so the second, whose
    // own slot is orange, must move on too.
    expect(seriesColors([undefined, undefined, BLUE])).toEqual([ORANGE, GREEN, BLUE]);
  });

  it("colour case does not hide a clash", () => {
    expect(seriesColors([GREEN.toLowerCase(), undefined, undefined])).toEqual([GREEN.toLowerCase(), ORANGE, VERMILLION]);
  });

  it("once the palette is used up, it wraps by slot, as seriesColor does", () => {
    const saved = [...OKABE_ITO];
    expect(seriesColors([...saved, undefined])[8]).toBe(OKABE_ITO[0]);
  });
});
