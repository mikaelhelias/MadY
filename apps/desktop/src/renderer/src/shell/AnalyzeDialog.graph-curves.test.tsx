// @vitest-environment jsdom
/**
 * Opened on a graph, the Analyze dialog starts from that graph: a one-curve analysis starts on the
 * series selected on it, and a several-curve analysis ticks the series the graph shows.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { AnalyzeDialog } from "./AnalyzeDialog";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const table = {
  id: "t", kind: "xy", name: "Doses",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "a", name: "Compound A", role: "y" },
    { id: "b", name: "Compound B", role: "y" },
    { id: "c", name: "Compound C", role: "y" },
  ],
  rows: [0.1, 1, 10, 100, 1000].map((x, i) => ({ id: `r${i}`, cells: { x, a: i * 20, b: i * 15 + 3, c: i * 10 + 5 } })),
} as unknown as DataTable;

const runBtn = (c: HTMLElement) => c.querySelector(".btn") as HTMLButtonElement;
const runSpec = (c: HTMLElement, onRun: ReturnType<typeof vi.fn>) => {
  fireEvent.click(runBtn(c));
  return onRun.mock.calls.at(-1)![0];
};
const open = (props: Partial<Parameters<typeof AnalyzeDialog>[0]>) => {
  const onRun = vi.fn();
  const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} {...props} />);
  return { c: u.container, onRun };
};

describe("Analyze opened on a graph", () => {
  it("a curve fit starts on the series selected on the graph", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl", graphCurves: { selected: "b", shown: ["a", "b", "c"] } });
    expect(runSpec(c, onRun).columns).toEqual(["x", "b"]);
  });

  it("a linear regression starts on the series selected on the graph", () => {
    const { c, onRun } = open({ initialMethod: "regression", graphCurves: { selected: "c", shown: ["a", "b", "c"] } });
    expect(runSpec(c, onRun).columns).toEqual(["x", "c"]);
  });

  it("a global fit ticks only the series the graph shows", () => {
    const { c, onRun } = open({ initialMethod: "globalfit", initialVariant: "4pl", graphCurves: { shown: ["a", "c"] } });
    expect(runSpec(c, onRun).columns).toEqual(["a", "c"]);
  });

  it("a global fit keeps every shown series when only one is selected (it needs two)", () => {
    const { c, onRun } = open({ initialMethod: "globalfit", initialVariant: "4pl", graphCurves: { selected: "b", shown: ["a", "b"] } });
    expect(runSpec(c, onRun).columns).toEqual(["a", "b"]);
  });

  it("melting temperature starts on the selected series alone", () => {
    const { c, onRun } = open({ initialMethod: "meltingtemp", graphCurves: { selected: "b", shown: ["a", "b", "c"] } });
    expect(runSpec(c, onRun).columns).toEqual(["b"]);
  });

  it("switching the test to a global fit inside the dialog ticks the graph's shown series", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl", graphCurves: { shown: ["b", "c"] } });
    fireEvent.change(c.querySelector('[aria-label="Test"]') as HTMLSelectElement, { target: { value: "globalfit" } });
    expect(runSpec(c, onRun).columns).toEqual(["b", "c"]);
  });

  it("opened on the sheet, a curve fit still starts on the first series", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl" });
    expect(runSpec(c, onRun).columns).toEqual(["x", "a"]);
  });
});

const curveBox = (c: HTMLElement, name: string): HTMLInputElement | undefined =>
  [...c.querySelectorAll("label.angroup")].find((l) => (l.textContent ?? "").trim() === name)?.querySelector("input") ?? undefined;

describe("Curve fit ▸ several series, one fit each", () => {
  it("opened on a graph with nothing selected, every shown series is ticked and goes into the run", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl", graphCurves: { shown: ["a", "b", "c"] } });
    expect(["Compound A", "Compound B", "Compound C"].map((n) => curveBox(c, n)?.checked)).toEqual([true, true, true]);
    expect(runSpec(c, onRun).columns).toEqual(["x", "a", "b", "c"]);
  });

  it("unticking a series leaves it out of the run", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl", graphCurves: { shown: ["a", "b", "c"] } });
    fireEvent.click(curveBox(c, "Compound B")!);
    expect(runSpec(c, onRun).columns).toEqual(["x", "a", "c"]);
  });

  it("ticking a second series on the sheet adds it to the run", () => {
    const { c, onRun } = open({ initialMethod: "curvefit", initialVariant: "4pl" });
    fireEvent.click(curveBox(c, "Compound C")!);
    expect(runSpec(c, onRun).columns).toEqual(["x", "a", "c"]);
  });

  it("the X column is not offered as a curve, and with nothing ticked Run is off", () => {
    const { c } = open({ initialMethod: "curvefit", initialVariant: "4pl", graphCurves: { selected: "a", shown: ["a", "b", "c"] } });
    expect(curveBox(c, "Dose")).toBeUndefined();
    fireEvent.click(curveBox(c, "Compound A")!);
    expect(runBtn(c).disabled).toBe(true);
  });

  it("a column of names (a note beside the series) is not offered, and not ticked when the graph lists it", () => {
    const withNote = {
      ...table,
      columns: [table.columns[0]!, { id: "note", name: "Note", role: "y" }, ...table.columns.slice(1)],
      rows: table.rows.map((r, i) => ({ ...r, cells: { ...r.cells, note: `well ${i}` } })),
    } as unknown as DataTable;
    const onRun = vi.fn();
    const { container } = render(<AnalyzeDialog table={withNote} onRun={onRun} onCancel={vi.fn()} initialMethod="curvefit" initialVariant="4pl"
      graphCurves={{ shown: ["note", "a", "b", "c"] }} />);
    expect(curveBox(container, "Note")).toBeUndefined();
    expect(runSpec(container, onRun).columns).toEqual(["x", "a", "b", "c"]);
  });

  it("a linear regression keeps its one Y series", () => {
    const { c, onRun } = open({ initialMethod: "regression", graphCurves: { shown: ["a", "b", "c"] } });
    expect(curveBox(c, "Compound B")).toBeUndefined();
    expect(runSpec(c, onRun).columns).toEqual(["x", "a"]);
  });
});
