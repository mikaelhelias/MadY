// @vitest-environment jsdom
// Persistent panel groups. Shift-click selection is transient — the moment
// you click elsewhere, the bond is gone. A group makes that bond persistent:
// grouped panels keep moving as one, through free-drag and the keyboard, until ungrouped.
// Movement only — a group never resizes its members or fights the aligned grid.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { groupDragPatch, LayoutPane, nextPanelGroupTag, withGroupMembers } from "./panes";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
};
const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });

function proj(layout: Partial<FigureLayout>): Project {
  return {
    schemaVersion: 5,
    tables: [table],
    plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma")],
    analyses: [],
    layouts: [{
      id: "L", name: "Figure 1", panels: ["A", "B", "C"], freeform: true,
      panelPositions: { A: { x: 0, y: 0 }, B: { x: 420, y: 0 }, C: { x: 0, y: 320 } },
      ...layout,
    }],
    log: [],
    workspace: { folders: [], loose: [{ kind: "plot", id: "A" }, { kind: "plot", id: "B" }, { kind: "plot", id: "C" }, { kind: "layout", id: "L" }] },
  };
}

const layoutOf = (p: Project): FigureLayout => p.layouts![0]!;

describe("panel groups — the pure movement bond", () => {
  it("groupDragPatch translates every other member by the dragged delta; locked members stay", () => {
    const layout = layoutOf(proj({
      panelGroups: { A: "grp-1", B: "grp-1", C: "grp-1" },
      panelLocked: { C: true },
    }));
    const posOf = (id: string) => layout.panelPositions![id]!;
    // A dragged from (0,0) to (50,30)
    const patch = groupDragPatch(layout, "A", 50, 30, posOf);
    expect(patch["B"]).toEqual({ x: 470, y: 30 });
    expect(patch["C"], "a locked member must not move").toBeUndefined();
  });

  it("an ungrouped panel produces an empty patch (drag stays a solo move)", () => {
    const layout = layoutOf(proj({}));
    expect(groupDragPatch(layout, "A", 50, 30, (id) => layout.panelPositions![id]!)).toEqual({});
  });

  it("withGroupMembers expands a selection to whole groups (a keyboard nudge moves a group as a drag does)", () => {
    const layout = layoutOf(proj({ panelGroups: { A: "g", B: "g" } }));
    expect([...withGroupMembers(layout, new Set(["A"]))].sort()).toEqual(["A", "B"]);
    expect([...withGroupMembers(layout, new Set(["C"]))].sort()).toEqual(["C"]);
  });

  it("nextPanelGroupTag never collides with an existing tag", () => {
    expect(nextPanelGroupTag({})).toBe("grp-1");
    expect(nextPanelGroupTag({ A: "grp-1", B: "grp-7" })).toBe("grp-8");
  });
});

describe("panel groups — the Arrange toolbar bond", () => {
  const editing = (over: Record<string, unknown> = {}) => ({
    selection: { kind: "plot" as const },
    selectedPlot: null,
    onSelectPanel: vi.fn(),
    onSelect: vi.fn(),
    onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
    ...over,
  });

  it("Group writes ONE shared tag for the shift-selection; Ungroup clears it", () => {
    const onSetLayoutOptions = vi.fn();
    const { container } = render(
      <LayoutPane project={proj({})} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}}
        onSetLayoutOptions={onSetLayoutOptions} editing={editing() as never} />,
    );
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Group");
    expect(btn, "no Group button on the Arrange toolbar").toBeTruthy();
    expect(btn!.disabled).toBe(false);
    fireEvent.click(btn!);
    const patch = onSetLayoutOptions.mock.calls.at(-1)![0] as Partial<FigureLayout>;
    const g = patch.panelGroups!;
    expect(g["A"]).toBeTruthy();
    expect(g["A"]).toBe(g["B"]);
    expect(g["C"]).toBeUndefined();
  });

  it("a fully-grouped selection offers Ungroup instead, and clears the tags", () => {
    const onSetLayoutOptions = vi.fn();
    const { container } = render(
      <LayoutPane project={proj({ panelGroups: { A: "g1", B: "g1" } })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}}
        onSetLayoutOptions={onSetLayoutOptions} editing={editing() as never} />,
    );
    const panels = [...container.querySelectorAll(".laypanel")] as HTMLElement[];
    fireEvent.mouseDown(panels[0]!, { shiftKey: true });
    fireEvent.mouseDown(panels[1]!, { shiftKey: true });
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Ungroup");
    expect(btn, "a grouped selection must offer Ungroup").toBeTruthy();
    fireEvent.click(btn!);
    const patch = onSetLayoutOptions.mock.calls.at(-1)![0] as Partial<FigureLayout>;
    // an emptied map clears to undefined entirely — either way, no tag survives
    expect(patch.panelGroups?.["A"]).toBeUndefined();
    expect(patch.panelGroups?.["B"]).toBeUndefined();
    expect("panelGroups" in patch, "Ungroup must write the panelGroups patch").toBe(true);
  });

  it("Group is disabled below two selected panels", () => {
    const { container } = render(
      <LayoutPane project={proj({})} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}}
        onSetLayoutOptions={() => {}} editing={editing() as never} />,
    );
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Group");
    expect(btn!.disabled).toBe(true);
  });
});
