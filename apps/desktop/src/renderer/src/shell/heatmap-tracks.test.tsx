// @vitest-environment jsdom
/**
 * The annotation-strip controls.
 *
 * The two axes are edited differently because the data lives in different places, and the panel
 * has to say so rather than offer a column picker that could never work:
 *  • a row strip picks a sheet column;
 *  • a column strip types a value per column, because a table has no per-column field.
 * Both then share the same look controls, and each distinct value can be given its own colour —
 * which is what a paper needs when "Treated" has to be red in every panel.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "grp", name: "Group" },
    { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" },
  ],
  rows: ["G1", "G2", "G3", "G4"].map((g, i) => ({
    id: `r${i}`, cells: { g, grp: i < 2 ? "Ctrl" : "Treated", c0: i + 1, c1: i + 2, c2: i + 3 },
  })),
};

function show(heatmap: NonNullable<Plot["heatmap"]>) {
  const h = handlers();
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap } as Plot;
  render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...h} />,
  );
  return h;
}
const wrote = (h: ReturnType<typeof handlers>): NonNullable<Plot["heatmap"]> =>
  (h.onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap!;

describe("row strips read a column of the sheet", () => {
  it("adds one, and it starts on a real column rather than on nothing", () => {
    const h = show({});
    fireEvent.click(screen.getByLabelText("Add a row strip"));
    expect(wrote(h).rowTracks).toEqual([{ column: "g" }]);
  });

  it("the column can be changed, and the picker lists the sheet's columns", () => {
    const h = show({ rowTracks: [{ column: "g" }] });
    const pick = screen.getByLabelText("row strip 1 column") as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Pick a column…", "Gene", "Group", "S1", "S2", "S3"]);
    fireEvent.change(pick, { target: { value: "grp" } });
    expect(wrote(h).rowTracks).toEqual([{ column: "grp" }]);
  });

  it("takes a name and its own thickness", () => {
    const h = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.change(screen.getByLabelText("row strip 1 name"), { target: { value: "Group" } });
    expect(wrote(h).rowTracks).toEqual([{ column: "grp", name: "Group" }]);
    cleanup();
    const h2 = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.change(screen.getByLabelText("row strip 1 size"), { target: { value: "22" } });
    expect(wrote(h2).rowTracks).toEqual([{ column: "grp", size: 22 }]);
  });

  it("removes the strip you point at", () => {
    const h = show({ rowTracks: [{ column: "g" }, { column: "grp" }] });
    fireEvent.click(screen.getByLabelText("Remove row strip 1"));
    expect(wrote(h).rowTracks).toEqual([{ column: "grp" }]);
  });

  it("the last strip removed clears the field", () => {
    const h = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.click(screen.getByLabelText("Remove row strip 1"));
    expect(wrote(h).rowTracks).toBeUndefined();
  });

  it("offers no column picker for a column strip — a table has no per-column field to read", () => {
    show({ colTracks: [{ values: {} }] });
    expect(screen.queryByLabelText("column strip 1 column")).toBeNull();
  });
});

describe("column strips carry their own values", () => {
  it("offers one box per matrix column, named after it", () => {
    show({ colTracks: [{ values: {} }] });
    for (const name of ["S1", "S2", "S3"]) {
      expect(screen.getByLabelText(`column strip 1 value for ${name}`), `no box for ${name}`).toBeTruthy();
    }
    // …and NOT for the annotation column, which is not part of the matrix
    expect(screen.queryByLabelText("column strip 1 value for Gene")).toBeNull();
  });

  it("typing a value writes it under that column's id", () => {
    const h = show({ colTracks: [{ values: {} }] });
    fireEvent.change(screen.getByLabelText("column strip 1 value for S2"), { target: { value: "Batch B" } });
    expect(wrote(h).colTracks).toEqual([{ values: { c1: "Batch B" } }]);
  });

  it("clearing a value removes it rather than storing an empty string", () => {
    const h = show({ colTracks: [{ values: { c0: "A", c1: "B" } }] });
    fireEvent.change(screen.getByLabelText("column strip 1 value for S1"), { target: { value: "" } });
    expect(wrote(h).colTracks).toEqual([{ values: { c1: "B" } }]);
  });
});

describe("colours", () => {
  it("lists the distinct values a strip shows, and gives each its own colour", () => {
    const h = show({ rowTracks: [{ column: "grp" }] });
    expect(screen.getByText("Colours (2)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("row strip 1 colour for Treated"), { target: { value: "#ff0000" } });
    expect(wrote(h).rowTracks).toEqual([{ column: "grp", colors: { Treated: "#ff0000" } }]);
  });

  it("a value can be handed back to the automatic colour", () => {
    const h = show({ rowTracks: [{ column: "grp", colors: { Treated: "#ff0000" } }] });
    fireEvent.click(screen.getByLabelText("Automatic colour for Treated on row strip 1"));
    expect(wrote(h).rowTracks).toEqual([{ column: "grp", colors: undefined }]);
  });

  it("a strip showing nothing yet offers no colour list", () => {
    show({ rowTracks: [{}] });
    expect(screen.queryByText(/^Colours/)).toBeNull();
  });
});

describe("the shared strip settings", () => {
  it("appear only once a strip exists, and write the chart-wide fields", () => {
    show({});
    expect(screen.queryByLabelText("Size for all strips")).toBeNull();
    cleanup();
    const h = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.change(screen.getByLabelText("Size for all strips"), { target: { value: "20" } });
    expect(wrote(h).trackSize).toBe(20);
    expect(wrote(h).rowTracks, "the shared size must not stamp itself onto the strips").toEqual([{ column: "grp" }]);
    cleanup();
    const h2 = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.change(screen.getByLabelText("Gap between strips"), { target: { value: "6" } });
    expect(wrote(h2).trackGap).toBe(6);
  });
});

describe("replicate collapse", () => {
  it("is offered only where there IS a strip to group by — the strip says what is a replicate of what", () => {
    show({});
    expect(screen.queryByLabelText("Collapse replicate rows")).toBeNull();
    expect(screen.queryByLabelText("Collapse replicate columns")).toBeNull();
    cleanup();
    show({ colTracks: [{ values: { c0: "A" } }] });
    expect(screen.getByLabelText("Collapse replicate columns")).toBeTruthy();
    expect(screen.queryByLabelText("Collapse replicate rows"), "no row strip, nothing to group rows by").toBeNull();
  });

  it("writes mean or median", () => {
    const h = show({ colTracks: [{ values: { c0: "A" } }] });
    fireEvent.change(screen.getByLabelText("Collapse replicate columns"), { target: { value: "median" } });
    expect(wrote(h).collapseCols).toBe("median");
    cleanup();
    const h2 = show({ rowTracks: [{ column: "grp" }] });
    fireEvent.change(screen.getByLabelText("Collapse replicate rows"), { target: { value: "mean" } });
    expect(wrote(h2).collapseRows).toBe("mean");
  });

  it("the which-strip picker appears only when there is a choice to make", () => {
    show({ colTracks: [{ values: { c0: "A" } }], collapseCols: "mean" });
    expect(screen.queryByLabelText("Strip that groups the columns"), "one strip — no choice").toBeNull();
    cleanup();
    show({ colTracks: [{ name: "Batch", values: { c0: "A" } }, { name: "Arm", values: { c0: "X" } }], collapseCols: "mean" });
    const pick = screen.getByLabelText("Strip that groups the columns") as HTMLSelectElement;
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Batch", "Arm"]);
  });

  it("…and not at all while the collapse is off", () => {
    show({ colTracks: [{ name: "Batch", values: { c0: "A" } }, { name: "Arm", values: { c0: "X" } }] });
    expect(screen.queryByLabelText("Strip that groups the columns")).toBeNull();
  });

  it("picking a strip writes its position", () => {
    const h = show({ colTracks: [{ name: "Batch", values: { c0: "A" } }, { name: "Arm", values: { c0: "X" } }], collapseCols: "mean" });
    fireEvent.change(screen.getByLabelText("Strip that groups the columns"), { target: { value: "1" } });
    expect(wrote(h).collapseColsBy).toBe(1);
  });
});
