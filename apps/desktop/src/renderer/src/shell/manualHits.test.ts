// @vitest-environment jsdom
/**
 * `manualHits` — the short "In the manual" list that Ctrl+K and the Ask bar both show. One
 * function, so the two boxes cannot rank or de-duplicate differently from each other.
 */
import { describe, expect, it } from "vitest";
import { manualHits, markSegments } from "./guideSearch";

describe("manualHits", () => {
  it("shows nothing until there are two characters to search for", () => {
    expect(manualHits("")).toEqual([]);
    expect(manualHits("a")).toEqual([]);
    expect(manualHits(" a ")).toEqual([]);
  });

  it("answers a plain question with functions first and never more than five rows", () => {
    const hits = manualHits("axis");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(5);
    for (const h of hits) {
      expect(h.name.length).toBeGreaterThan(0);
      expect(h.where.length).toBeGreaterThan(0);
      expect(h.target.entry ?? h.target.section, `${h.name}: a hit with nowhere to go`).toBeTruthy();
    }
    // `limit` is honoured, so a caller with less room gets fewer rows — not a truncated copy.
    expect(manualHits("axis", { limit: 2 }).length).toBe(2);
  });

  it("lists a name once, even when several entries carry it", () => {
    const names = manualHits("export").map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("drops an entry whose own command the caller is already offering", () => {
    const all = manualHits("export");
    const owned = all.find((h) => /^(action|tool):/.test(h.id));
    expect(owned, "the fixture needs an export hit that belongs to a command").toBeTruthy();
    const ownerId = /^(action|tool):(.+)$/.exec(owned!.id)![2]!;
    const without = manualHits("export", { exclude: new Set([ownerId]) });
    expect(without.map((h) => h.id)).not.toContain(owned!.id);
  });
});

describe("markSegments — what the Ask bar marks in a row", () => {
  it("marks each query word where it starts a word, keeping the text's own case", () => {
    expect(markSegments("Breaks (cuts)", "axis break")).toEqual([
      { text: "Break", hit: true },
      { text: "s (cuts)", hit: false },
    ]);
  });
  it("marks several words, in the middle of the text too", () => {
    expect(markSegments("Cut a stretch out of the axis", "axis cut")).toEqual([
      { text: "Cut", hit: true },
      { text: " a stretch out of the ", hit: false },
      { text: "axis", hit: true },
    ]);
  });
  it("does not mark inside a word — 'bar' never marks the middle of 'toolbar'", () => {
    expect(markSegments("toolbar bar", "bar")).toEqual([
      { text: "toolbar ", hit: false },
      { text: "bar", hit: true },
    ]);
  });
  it("an empty query or text marks nothing", () => {
    expect(markSegments("Axis", "")).toEqual([{ text: "Axis", hit: false }]);
    expect(markSegments("", "axis")).toEqual([{ text: "", hit: false }]);
  });
});
