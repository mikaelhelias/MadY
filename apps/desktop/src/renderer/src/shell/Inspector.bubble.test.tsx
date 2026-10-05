// @vitest-environment jsdom
// Guards the bubble size-legend "Reference values" editor.
//
// The field keeps a local draft string and commits the parsed numbers only on blur / Enter,
// dropping empties. A controlled input that re-parsed on every keystroke and rejoined the
// parsed numbers into the value would make it impossible to
//   • add a bubble  — typing a trailing comma ("10,") would inject a spurious 0 → "10, 0"
//   • type decimals — "0." would collapse to "0" (the ".5" could never be typed)
// so the legend's values could not be edited or extended.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

// A bubble-shaped table: X, Y, and a Size column (the 3rd column drives radius).
const table: DataTable = {
  id: "t",
  kind: "column",
  name: "Bubbles",
  columns: [
    { id: "x", name: "GDP" },
    { id: "y", name: "Life exp" },
    { id: "s", name: "Population" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, y: 70, s: 1 } },
    { id: "r2", cells: { x: 2, y: 75, s: 50 } },
    { id: "r3", cells: { x: 3, y: 80, s: 100 } },
  ],
};

function setup(bubble?: Plot["bubble"], kind: PlotKind = "bubble", selection: GraphSelection = { kind: "plot" }) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(bubble ? { bubble } : {}) };
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const u = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />,
  );
  return { ...u, ...h };
}

/** The <input> in the .frow whose label is `label`. */
function fieldByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === label);
  if (!span) throw new Error(`no field labelled "${label}"`);
  return span.parentElement!.querySelector("input") as HTMLInputElement;
}

/** The last bubble.sizeLegendValues committed via onSetPlotOptions (undefined if none). */
function lastValues(onSetPlotOptions: ReturnType<typeof vi.fn>): number[] | undefined {
  const calls = onSetPlotOptions.mock.calls;
  return calls.length ? (calls[calls.length - 1]![0].bubble.sizeLegendValues as number[] | undefined) : undefined;
}

describe("Inspector — bubble size-legend Reference values", () => {
  it("the editor is present for a bubble plot", () => {
    const d = setup();
    expect(d.container.textContent).toContain("Bubble size legend");
    expect(fieldByLabel(d.container, "Reference values")).toBeTruthy();
  });

  it("commits the chosen values on blur → adds one bubble per value", () => {
    const d = setup();
    const input = fieldByLabel(d.container, "Reference values");
    fireEvent.change(input, { target: { value: "10, 20, 30, 40" } });
    fireEvent.blur(input);
    expect(lastValues(d.onSetPlotOptions)).toEqual([10, 20, 30, 40]);
  });

  it("does not inject a spurious 0 from a trailing comma while a value is being added", () => {
    const d = setup();
    const input = fieldByLabel(d.container, "Reference values");
    // Mid-typing a new value: the draft keeps exactly what was typed…
    fireEvent.change(input, { target: { value: "10, 20," } });
    expect(input.value).toBe("10, 20,"); // not reformatted to "10, 20, 0"
    expect(d.onSetPlotOptions).not.toHaveBeenCalled(); // nothing committed until blur
    // …and committing drops the empty token.
    fireEvent.blur(input);
    expect(lastValues(d.onSetPlotOptions)).toEqual([10, 20]);
  });

  it("lets you type decimals ('0.' is not cut to '0')", () => {
    const d = setup();
    const input = fieldByLabel(d.container, "Reference values");
    fireEvent.change(input, { target: { value: "0." } });
    expect(input.value).toBe("0."); // not collapsed to "0"
    fireEvent.change(input, { target: { value: "0.5, 1.5" } });
    fireEvent.blur(input);
    expect(lastValues(d.onSetPlotOptions)).toEqual([0.5, 1.5]);
  });

  it("Enter commits the same as blur", () => {
    const d = setup();
    const input = fieldByLabel(d.container, "Reference values");
    fireEvent.change(input, { target: { value: "5, 25, 125" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(lastValues(d.onSetPlotOptions)).toEqual([5, 25, 125]);
  });

  it("clearing the field reverts to auto (undefined)", () => {
    const d = setup({ sizeLegendValues: [10, 20] });
    const input = fieldByLabel(d.container, "Reference values");
    expect(input.value).toBe("10, 20"); // seeded from the committed values
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(lastValues(d.onSetPlotOptions)).toBeUndefined();
  });
});

/** The visible (not display:none / [hidden]) inspector sections, by summary title. */
function visibleSectionTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".inspsec")]
    .filter((s) => !s.hidden)
    .map((s) => (s.querySelector(":scope > summary")?.textContent ?? "").trim());
}

describe("Inspector — clicking the bubble legend surfaces its editor", () => {
  it("a bubble-legend selection pins the Annotate tab", () => {
    const d = setup(undefined, "bubble", { kind: "bubble-legend" });
    const activeTab = [...d.container.querySelectorAll(".inspcat")].find((b) => b.classList.contains("on"))?.textContent?.trim();
    expect(activeTab).toBe("Annotate");
  });

  it("shows only the Bubble size legend section (not every annotate section)", () => {
    const d = setup(undefined, "bubble", { kind: "bubble-legend" });
    const visible = visibleSectionTitles(d.container);
    expect(visible).toContain("Bubble size legend");
    // The other annotate sections (Annotations, Significance brackets) are hidden.
    expect(visible.some((t) => t.includes("Annotations"))).toBe(false);
    expect(visible.some((t) => t.includes("Significance"))).toBe(false);
    // …and the editor's field is reachable.
    expect(fieldByLabel(d.container, "Reference values")).toBeTruthy();
  });

  it("does not isolate when the plot (not the legend) is selected on the Annotate tab", () => {
    // Selecting the plot and switching to the Annotate tab shows all annotate sections.
    const d = setup(undefined, "bubble", { kind: "plot" });
    const annotateTab = [...d.container.querySelectorAll(".inspcat")].find((b) => b.textContent?.trim() === "Annotate")!;
    fireEvent.click(annotateTab);
    const visible = visibleSectionTitles(d.container);
    expect(visible).toContain("Bubble size legend");
    expect(visible.some((t) => t.includes("Annotations"))).toBe(true); // not isolated
  });
});

// The bubble Series list shows only the position series. The size column (2nd Y) is the
// radius encoding, not a drawn series: a row for it would carry a show/hide checkbox + colour
// swatch the builder never reads.
describe("Inspector — bubble Series list omits the size column", () => {
  it("lists only the position series (one row), not the size column", () => {
    const d = setup(undefined, "bubble", { kind: "plot" });
    const rows = [...d.container.querySelectorAll(".serieslist-row")];
    expect(rows).toHaveLength(1); // only the position series, not the size column
    expect((rows[0]!.textContent ?? "")).toContain("Life exp"); // the position column, not "Population"
  });
});
