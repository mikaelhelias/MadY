/**
 * Interactive HTML can be found. The export writes a page a reader can hover, zoom, pan and
 * toggle, so the format list, the Interactive box (which appears only after HTML is picked) and
 * the export tour must all make that discoverable — a format labelled only "HTML
 * (self-contained, vector)" and a tour naming PNG, PDF and SVG alone would hide it.
 */
import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT_LABEL } from "./exporters";
import { GUIDE, stepTexts } from "./guide";
import { TOUR_FIRST_GRAPH } from "./tour";

describe("the interactive HTML export says it is there", () => {
  it("the format list names it as interactive", () => {
    expect(EXPORT_FORMAT_LABEL.html).toMatch(/interactive/i);
  });

  it("the export tour mentions it where the format is chosen", () => {
    const step = TOUR_FIRST_GRAPH.find((s) => s.id === "exportgo");
    expect(step?.text).toMatch(/HTML/);
    expect(step?.text).toMatch(/interactive/i);
    expect(step?.text).toMatch(/zoom/i);
  });

  it("the manual's Export chapter has a how-to for it, with the steps", () => {
    const chapter = GUIDE.find((s) => s.blocks.some((b) => b.kind === "h" && b.text === "Export a graph or a figure"))!;
    expect(chapter, "no manual chapter has the heading 'Export a graph or a figure'").toBeTruthy();
    const i = chapter.blocks.findIndex((b) => b.kind === "h" && /readers can explore/i.test(b.text));
    expect(i, "no 'readers can explore' how-to in the Export chapter").toBeGreaterThan(-1);
    const steps = chapter.blocks[i + 1];
    expect(steps?.kind).toBe("steps");
    const text = steps && steps.kind === "steps" ? stepTexts(steps).join(" ") : "";
    expect(text).toMatch(/HTML/);
    expect(text).toMatch(/Interactive/);
    // It says what the page does. Hover values work on every chart type
    // (`hover-values.test.tsx`); the one exception — a heatmap drawn as a density cloud or
    // hexagons — is named rather than hidden.
    expect(text).toMatch(/zoom/i);
    expect(text).toMatch(/legend/i);
    expect(text).toMatch(/hover a mark for its values/i);
    expect(text).toMatch(/density cloud or hexagons/i);
    expect(text).toMatch(/no internet|nothing fetched|fetches nothing/i);
  });
});
