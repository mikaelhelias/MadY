/**
 * The value-label prerequisite must know every kind that carries its own `showValues`.
 *
 * A kind missing from the list makes a working control look broken: without `paireddot.showValues`,
 * a check that sets only the plot-wide flag draws no labels and wrongly concludes the value-label
 * font does nothing on the paired dot. With the paired dot's own switch on, the font moves the drawing.
 *
 * A hand-list drifts, so this reads the model instead: every `showValues?:` a style
 * interface declares must be in `VALUE_LABEL_SWITCHES`, and nothing else may be. Add a kind with
 * its own value-label switch and this fails until the prerequisite knows about it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VALUE_LABEL_SWITCHES } from "./optionEffects";

describe("VALUE_LABEL_SWITCHES is derived from the model, not remembered", () => {
  it("lists exactly the kinds whose style interface declares its own showValues", () => {
    const src = readFileSync(resolve(process.cwd(), "packages/core/src/model.ts"), "utf8");

    // Which interface does each `showValues?:` belong to? The last one declared before it.
    const ifaces = [...src.matchAll(/export interface (\w+)/g)];
    const owners: string[] = [];
    for (const m of src.matchAll(/\n\s+showValues\?:/g)) {
      const owner = ifaces.filter((i) => (i.index ?? 0) < (m.index ?? 0)).at(-1)?.[1];
      if (owner && owner !== "Plot") owners.push(owner);
    }

    /*
     * …and the Plot field name is read off the Plot interface, never guessed from the interface
     * name: lower-casing the first letter gives `corrMatrix` and `pairedDot`, while the fields are
     * spelled `corrmatrix` and `paireddot`. A derivation that needs hand-correction is the very
     * hand-list this test replaces.
     */
    const kinds = owners
      .map((iface) => {
        const m = new RegExp("\\n\\s+(\\w+)\\?:\\s*" + iface + "\\b").exec(src);
        expect(m, `no Plot field is typed ${iface}`).toBeTruthy();
        return m![1]!;
      })
      .sort();

    expect(kinds.length, "the model declares no per-kind showValues — this test is measuring nothing").toBeGreaterThan(3);
    expect([...VALUE_LABEL_SWITCHES].sort(), `the model declares: ${kinds.join(", ")}`).toEqual(kinds);
  });
});
