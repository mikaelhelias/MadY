/**
 * The panel-assembler test fixture — one datasheet, four graphs A–D filed across two projects,
 * and one figure `L` filed under Project P1 / Experiment E1. The same shape as the file-local
 * fixture in `LayoutPane.test.tsx`, shared by the other assembler test files
 * (`LayoutPane.fields.test.tsx`, …).
 */
import type { DataTable, FigureLayout, Plot, Project } from "@mady/core";

export const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
};

export const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });

export function proj(layout: Partial<FigureLayout> = {}): Project {
  return {
    schemaVersion: 5,
    tables: [table],
    plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma"), plot("D", "Delta")],
    analyses: [],
    layouts: [{ id: "L", name: "Figure 1", panels: [], ...layout }],
    log: [],
    workspace: {
      folders: [
        { id: "f1", name: "Project P1", documentation: "", members: [], experiments: [
          { id: "e1", name: "Exp E1", members: [{ kind: "plot", id: "A" }, { kind: "layout", id: "L" }] },
          { id: "e2", name: "Exp E2", members: [{ kind: "plot", id: "B" }] },
        ] },
        { id: "f2", name: "Project P2", documentation: "", members: [], experiments: [
          { id: "e3", name: "Exp E3", members: [{ kind: "plot", id: "C" }] },
        ] },
      ],
      loose: [{ kind: "plot", id: "D" }],
    },
  };
}
