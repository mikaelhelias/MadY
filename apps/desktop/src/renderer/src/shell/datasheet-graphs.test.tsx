// @vitest-environment jsdom
/**
 * The datasheet points back at its graphs.
 *
 * Like the "Datasheet" button on the graph ribbon that links a graph to its datasheet, a
 * datasheet has a control linking to its graphs — a dropdown menu, since one table can feed
 * many graphs, rather than a button that would have to guess which graph was meant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, Project } from "@mady/core";
import { DataPane } from "./panes";

afterEach(cleanup);

const table = (id: string, name: string): DataTable => ({
  id, kind: "xy", name,
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }],
});
const plot = (id: string, name: string, source: string): Plot => ({ id, name, source, status: "ok", styleOverrides: {}, kind: "xy" });

function proj(over: Partial<Project> = {}): Project {
  return {
    schemaVersion: 5,
    tables: [table("t1", "Sheet one"), table("t2", "Sheet two")],
    plots: [plot("p1", "Alpha", "t1"), plot("p2", "Beta", "t1"), plot("p3", "Gamma", "t2")],
    analyses: [],
    layouts: [],
    log: [],
    workspace: { folders: [], loose: [] },
    ...over,
  } as Project;
}

const ops = () => ({
  setFrozen: vi.fn(), setCell: vi.fn(), addRow: vi.fn(), addColumn: vi.fn(),
  renameColumn: vi.fn(), setColumnRole: vi.fn(), deleteRow: vi.fn(), deleteColumn: vi.fn(),
  setExcluded: vi.fn(), rename: vi.fn(), setNotes: vi.fn(), setEntryMode: vi.fn(),
  setColumnGroup: vi.fn(), setSubcolumns: vi.fn(), moveColumn: vi.fn(), moveRow: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

const pane = (tableId: string, onOpenPlot?: (id: string) => void, p = proj()) =>
  render(<DataPane project={p} tableId={tableId} ops={ops()} {...(onOpenPlot ? { onOpenPlot } : {})} />).container;

const menuBtn = (c: HTMLElement) => c.querySelector("[data-graphs-from-table]") as HTMLButtonElement | null;

describe("the Graphs menu on a datasheet", () => {
  it("counts only the graphs drawn from this sheet", () => {
    // t1 feeds Alpha + Beta; Gamma belongs to t2 and must not be offered here.
    expect(menuBtn(pane("t1", vi.fn()))!.getAttribute("data-graphs-from-table")).toBe("2");
    cleanup();
    expect(menuBtn(pane("t2", vi.fn()))!.getAttribute("data-graphs-from-table")).toBe("1");
  });

  it("names them, and opens the one you pick", () => {
    const onOpenPlot = vi.fn();
    const c = pane("t1", onOpenPlot);
    fireEvent.click(menuBtn(c)!);
    const items = [...c.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(["Alpha", "Beta"]);
    fireEvent.click(items[1]!);
    expect(onOpenPlot).toHaveBeenCalledWith("p2");
  });

  it("is disabled with a reason when the sheet has no graphs — never unconditionally", () => {
    // A toolbar button that ships `disabled: true` promises a feature that can never be used.
    // This one must be disabled only when there is genuinely nothing to open, and say why.
    const empty = proj({ plots: [] });
    const c = pane("t1", vi.fn(), empty);
    const b = menuBtn(c)!;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("title")).toMatch(/no graphs/i);
    cleanup();
    // …and the same button is live the moment a graph exists.
    expect(menuBtn(pane("t1", vi.fn()))!.disabled).toBe(false);
  });

  it("is not offered at all when nothing can open a graph", () => {
    // No callback = the surface cannot navigate; a menu whose every row is inert is worse
    // than no menu.
    expect(menuBtn(pane("t1"))).toBeNull();
  });

  it("lists a graph that borrows a series from this sheet, not only its source graphs", () => {
    // The two-sheet graph: its source is Sheet one, but it borrows a series from Sheet two via
    // plot.overlays. Sheet two's menu must reach it — the reverse of the ribbon's Datasheets menu.
    // Without this the borrowed sheet would show an empty "Graphs" menu.
    const composite = { ...plot("pc", "Composite", "t1"), overlays: [{ id: "ov", table: "t2", column: "y" }] } as Plot;
    const withOverlay = proj({ plots: [plot("p3", "Gamma", "t2"), composite] });
    // Sheet two now feeds Gamma (its own) and Composite (borrowed) = 2.
    const c = pane("t2", vi.fn(), withOverlay);
    expect(menuBtn(c)!.getAttribute("data-graphs-from-table")).toBe("2");
    fireEvent.click(menuBtn(c)!);
    expect([...c.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(["Gamma", "Composite"]);
  });

  it("skips a figure's internal panel clones", () => {
    // An unlinked figure's panels are private copies of the source graph. Listing them would
    // offer rows that open a copy rather than the graph the user knows about.
    const withFigure = proj({
      plots: [plot("p1", "Alpha", "t1"), plot("clone1", "Alpha (panel)", "t1")],
      layouts: [{ id: "L", name: "Figure 1", panels: ["clone1"], linked: false, panelSource: { clone1: "p1" } }],
    } as Partial<Project>);
    const c = pane("t1", vi.fn(), withFigure);
    expect(menuBtn(c)!.getAttribute("data-graphs-from-table")).toBe("1");
    fireEvent.click(menuBtn(c)!);
    expect([...c.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(["Alpha"]);
  });
});
