// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STYLE_PRESETS, findPreset } from "./presets";
import { MadyDocument } from "./document";

/**
 * A preset that says "two-tone" must make the bars two-tone, not only the dots.
 *
 * `symbolFill` is the marker's treatment; a bar's fill is `fillType`, a different field. A
 * preset that sets only `symbolFill` gives the points a two-tone look and leaves every bar on
 * the builder's `solid` fallback, so its description claims a treatment the figure does not have.
 */
describe("the house preset's bar fill", () => {
  const house = findPreset("MadY default")!;

  it("specifies a bar fill treatment, not just a marker one", () => {
    expect(house, "the house preset is gone or renamed").toBeTruthy();
    expect(house.symbolFill, "the marker treatment changed").toBe("twotone");
    expect(
      house.fillType,
      "the preset promises two-tone but sets no bar fill — bars fall back to solid",
    ).toBe("twotone");
  });

  it("reaches a bar's series style when the preset is applied", () => {
    // The mapping in applyStylePreset is what carries it; a field on the preset that never
    // reaches `seriesStyles` is exactly as dead as not setting it.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["G", "Y"]);
    doc.addRow(t.id, ["one", 10]);
    const plot = doc.addPlot("P", t.id);
    doc.setPlotOptions(plot.id, { kind: "bar" });
    doc.applyStylePreset(plot.id, house);

    const styles = doc.toJSON().plots[0]!.seriesStyles ?? {};
    const first = Object.values(styles)[0] as { fillType?: string; symbolFill?: string } | undefined;
    expect(first, "the preset wrote no series style at all").toBeTruthy();
    expect(first!.fillType, "fillType never reached the series style").toBe("twotone");
    expect(first!.symbolFill, "the marker treatment stopped being applied").toBe("twotone");
  });

  it("leaves presets that specify no bar fill alone", () => {
    // Undefined must stay undefined — the builder's `solid` default — or adding this field
    // would silently restyle every other preset's bars.
    const others = STYLE_PRESETS.filter((p) => p.name !== "MadY default");
    expect(others.length).toBeGreaterThan(0);
    for (const p of others) {
      if (p.fillType !== undefined) {
        expect(["twotone", "solid", "pattern", "gradient", "metallic", "special", "graduated"]).toContain(p.fillType);
      }
    }
  });
});
