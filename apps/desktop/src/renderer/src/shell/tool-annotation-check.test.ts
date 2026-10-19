/**
 * Every annotation the app itself makes passes the agent tools' annotation check.
 *
 * The tools refuse a field no annotation has, and a field only some kinds draw when it is given to another kind (a
 * vband with a bracket's `from`/`to`). The opposite fault is a refusal of something the app draws: an agent could then
 * not build a graph a user can. The gallery cards, the showcase cards, the option drawables and the per-kind fixtures
 * hold every annotation shape the app produces, so each one must come through with no problem.
 */
import { describe, expect, it } from "vitest";
import type { Annotation } from "@mady/core";
import { checkAnnotationFields } from "../../../../../../packages/mcp-server/src/inputCheck";
import { galleryItems, optionDrawables } from "./gallery";
import { richCards } from "./showcase";
import { FIX } from "./plot-fixtures";

const sources: Array<[string, Array<{ annotations?: Annotation[] | undefined } | undefined>]> = [
  ["gallery", galleryItems().map((g) => g.plot)],
  ["showcase", richCards().map((c) => c.plot)],
  ["option drawables", optionDrawables().map((o) => o.plot)],
  ["kind fixtures", FIX.map((f) => f.extra)],
];

describe("annotations the app makes pass the tools' check", () => {
  for (const [name, plots] of sources) {
    it(name, () => {
      const anns = plots.flatMap((p) => p?.annotations ?? []);
      const problems = anns.flatMap((a) => checkAnnotationFields(a as unknown as Record<string, unknown>, a.kind).map((p) => `${a.id} (${a.kind}): ${p}`));
      expect(problems).toEqual([]);
    });
  }

  it("the sources hold annotations of many kinds, so the check above has something to refuse", () => {
    const kinds = new Set(sources.flatMap(([, plots]) => plots.flatMap((p) => (p?.annotations ?? []).map((a) => a.kind))));
    expect(kinds.size).toBeGreaterThanOrEqual(6);
  });
});
