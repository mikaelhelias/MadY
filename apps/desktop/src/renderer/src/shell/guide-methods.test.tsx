// @vitest-environment jsdom
/**
 * The manual's method list is derived, and must stay that way.
 *
 * "The statistics on offer" reads as prose grouped by the question a reader is asking, which is
 * the right shape for reading and the wrong shape for checking. So the chapter also carries a
 * `methods` block: every method, in the Analyze dialog's own groups, with the sentence the
 * dialog shows for it. Nothing in that table is typed into the manual — `METHOD_GROUPS` decides
 * the grouping and the order, and `guideIndex()` supplies the name and the when-to-use line.
 *
 * What this file refuses to let happen:
 *  - the block being dropped from the chapter (the list would silently become the prose alone,
 *    and the prose is a summary — it does not name every variant);
 *  - a method existing in the dialog and not in the rendered table;
 *  - a group heading rendering with nothing under it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { METHOD_GROUPS } from "./analysis";
import { methodLabel } from "./AnalyzeDialog";
import { GUIDE } from "./guide";
import { GuidePane } from "./GuidePane";
import { guideIndex } from "./guideIndex";

afterEach(cleanup);

describe("the manual's method list", () => {
  it("is not vacuously green — the dialog really does offer this many methods", () => {
    const ids = METHOD_GROUPS.flatMap((g) => g.methods);
    expect(METHOD_GROUPS.length).toBeGreaterThan(5);
    expect(ids.length).toBeGreaterThan(30);
    expect(new Set(ids).size, "a method listed in two groups").toBe(ids.length);
  });

  it("the chapter carries the derived block, not a hand-typed list", () => {
    const chapter = GUIDE.find((s) => s.id === "analysis");
    expect(chapter, "the statistics chapter is gone").toBeTruthy();
    expect(
      chapter!.blocks.some((b) => b.kind === "methods"),
      "“The statistics on offer” no longer renders the derived method table — the prose alone is a summary",
    ).toBe(true);
  });

  it("renders every method the Analyze dialog offers, named the way it names them", () => {
    const { container } = render(<GuidePane version="1" />);
    const table = container.querySelector(".guide-methods");
    expect(table, "no method table rendered").toBeTruthy();
    const rows = [...container.querySelectorAll(".guide-methods tbody tr")];
    const names = rows.map((r) => r.querySelector("th")?.textContent ?? "");
    const missing = METHOD_GROUPS.flatMap((g) => g.methods)
      .map((m) => methodLabel(m))
      .filter((label) => !names.includes(label));
    expect(missing, `these methods are in the dialog but not in the manual's table: ${missing.join(", ")}`).toEqual([]);
  });

  it("every row carries the when-to-use sentence from the method registry", () => {
    const { container } = render(<GuidePane version="1" />);
    const byName = new Map(
      [...container.querySelectorAll(".guide-methods tbody tr")].map((r) => [
        r.querySelector("th")?.textContent ?? "",
        r.querySelector("td")?.textContent ?? "",
      ]),
    );
    for (const m of METHOD_GROUPS.flatMap((g) => g.methods)) {
      const entry = guideIndex().find((e) => e.id === `method:${m}`)!;
      expect(byName.get(entry.name), `${m} rendered without its sentence`).toBe(entry.what);
    }
  });

  it("every group is a heading with rows under it — never an empty one", () => {
    const { container } = render(<GuidePane version="1" />);
    const tables = [...container.querySelectorAll(".guide-methods")];
    expect(tables.length).toBe(METHOD_GROUPS.length);
    for (const t of tables) {
      expect((t.querySelector("caption")?.textContent ?? "").length, "a group with no name").toBeGreaterThan(0);
      expect(t.querySelectorAll("tbody tr").length, `“${t.querySelector("caption")?.textContent}” is an empty heading`).toBeGreaterThan(0);
    }
  });

  it("the count beside the heading is the number of rows actually drawn", () => {
    const { container } = render(<GuidePane version="1" />);
    const badge = [...container.querySelectorAll(".guide-indexn")].map((n) => n.textContent);
    const rows = container.querySelectorAll(".guide-methods tbody tr").length;
    expect(badge, "no count claims the method total").toContain(String(rows));
    expect(rows).toBe(METHOD_GROUPS.flatMap((g) => g.methods).length);
  });
});
