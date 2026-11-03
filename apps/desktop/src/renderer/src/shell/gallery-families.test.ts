// @vitest-environment node
/**
 * The chart gallery is organised by family. Every card belongs to one named family and the
 * pane lists the families in a fixed order (XY first, ordination last), so a user scanning for
 * "the bar charts" or "the genomics figures" finds them together, never a Manhattan plot placed
 * between XY and Area.
 *
 * Default-deny: a card whose key is not in the family map fails here (a new card must be filed),
 * and an empty family fails too (a heading with nothing under it is a stale heading).
 */
import { describe, expect, it } from "vitest";
import { GALLERY_FAMILIES, galleryItems } from "./gallery";

describe("chart gallery — families", () => {
  const items = galleryItems();

  it("every card is filed under one of the declared families (default-deny)", () => {
    const names = new Set<string>(GALLERY_FAMILIES);
    const unfiled = items.filter((it) => !names.has(it.family)).map((it) => it.key);
    expect(unfiled, `cards with no family: ${unfiled.join(", ")}`).toEqual([]);
  });

  it("the cards come out grouped, in the declared family order, and no family is empty", () => {
    const seq = items.map((it) => it.family);
    // Grouped = the family sequence never returns to an earlier family.
    const firstSeen = new Map<string, number>();
    seq.forEach((f, i) => { if (!firstSeen.has(f)) firstSeen.set(f, i); });
    const ranks = seq.map((f) => GALLERY_FAMILIES.indexOf(f));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i]!, `card ${items[i]!.key} (${seq[i]}) comes after ${items[i - 1]!.key} (${seq[i - 1]})`).toBeGreaterThanOrEqual(ranks[i - 1]!);
    for (const f of GALLERY_FAMILIES) expect(seq.includes(f), `family "${f}" has no card`).toBe(true);
  });

  it("tests that pick a card by kind land on the canonical card: plain XY, the bracketed bar, the plain histogram", () => {
    // Several tests take `items.find(kind === …)` — the first card of a kind. These are the
    // cards they mean, and the family sort must keep each ahead of its option-wearing siblings.
    expect(items[0]!.key).toBe("xy");
    expect(items.find((it) => (it.plot.kind ?? "xy") === "bar")!.key).toBe("bar");
    expect(items.find((it) => it.plot.kind === "histogram")!.key).toBe("histogram");
  });
});
