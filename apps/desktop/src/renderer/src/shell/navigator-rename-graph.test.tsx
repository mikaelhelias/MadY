// @vitest-environment jsdom
/**
 * Rename a graph from the navigator — the same double-click that renames a folder or an experiment.
 *
 * A graph's name is what the drawing shows as the title until one is typed, so it must be
 * renameable. It is renamed in the same place and the same way as a folder or an experiment:
 * Enter or blur commits, Escape cancels.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Navigator } from "./Navigator";

afterEach(cleanup);

const project = (): Project => ({
  schemaVersion: 4,
  tables: [{ id: "t", kind: "column", name: "Sheet", columns: [{ id: "g", name: "Group", role: "x" }, { id: "a", name: "A", role: "y" }], rows: [{ id: "r0", cells: { g: "x", a: 1 } }] }],
  plots: [{ id: "p", name: "Graph 1", source: "t", status: "ok", styleOverrides: {}, kind: "bar" } as Plot],
  analyses: [], log: [],
  workspace: { folders: [{ id: "f", name: "My project", experiments: [], members: [{ kind: "table", id: "t" }, { kind: "plot", id: "p" }] }], loose: [] },
} as unknown as Project);

function nav(onRenameObject = vi.fn(), onRename = vi.fn(), onOpenObject = vi.fn()) {
  const utils = render(
    <Navigator
      project={project()} activeKey=""
      onOpenObject={onOpenObject} onOpenLayout={vi.fn()} onAddLayout={vi.fn()} onOpenDocs={vi.fn()}
      onAddProject={vi.fn()} onAddExperiment={vi.fn()} onAddDataset={vi.fn()} onAddGraph={vi.fn()}
      onRename={onRename} onRenameObject={onRenameObject}
      onDeleteObject={vi.fn()} onDeleteExperiment={vi.fn()} onDeleteFolder={vi.fn()}
    />,
  );
  const label = (text: string): HTMLElement | undefined =>
    [...utils.container.querySelectorAll<HTMLElement>(".navlabel")].find((e) => (e.textContent ?? "").trim() === text);
  return { ...utils, label, onRenameObject, onRename, onOpenObject };
}

describe("renaming a graph in the navigator", () => {
  it("the fixture lists the graph (it can exhibit the bug)", () => {
    expect(nav().label("Graph 1")).toBeTruthy();
  });

  it("double-click the graph's name, type, Enter: renamed", () => {
    const { label, container, onRenameObject } = nav();
    fireEvent.doubleClick(label("Graph 1")!);
    const input = container.querySelector<HTMLInputElement>("input.navedit");
    expect(input, "no rename box opened").toBeTruthy();
    expect(input!.value).toBe("Graph 1");
    fireEvent.change(input!, { target: { value: "Dose response" } });
    fireEvent.keyDown(input!, { key: "Enter" });
    fireEvent.blur(input!);
    expect(onRenameObject).toHaveBeenCalledTimes(1);
    expect(onRenameObject).toHaveBeenCalledWith("plot", "p", "Dose response");
  });

  it("Escape cancels and puts the name back", () => {
    const { label, container, onRenameObject } = nav();
    fireEvent.doubleClick(label("Graph 1")!);
    const input = container.querySelector<HTMLInputElement>("input.navedit")!;
    fireEvent.change(input, { target: { value: "Dose response" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameObject).not.toHaveBeenCalled();
    expect(container.querySelector("input.navedit")).toBeFalsy();
    expect(label("Graph 1")).toBeTruthy();
  });

  it("Escape still cancels when the browser fires a blur as the box closes", () => {
    // Some browsers blur a focused input as it is removed. Escape and that blur land in one batch
    // here, so the input is still mounted when the blur arrives - without the cancel guard, the
    // draft the user just abandoned would be committed on the way out.
    const { label, container, onRenameObject } = nav();
    fireEvent.doubleClick(label("Graph 1")!);
    const input = container.querySelector<HTMLInputElement>("input.navedit")!;
    fireEvent.change(input, { target: { value: "Abandoned" } });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onRenameObject).not.toHaveBeenCalled();
  });

  it("a blank or unchanged name commits nothing", () => {
    const { label, container, onRenameObject } = nav();
    fireEvent.doubleClick(label("Graph 1")!);
    const input = container.querySelector<HTMLInputElement>("input.navedit")!;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    fireEvent.doubleClick(label("Graph 1")!);
    fireEvent.blur(container.querySelector<HTMLInputElement>("input.navedit")!);
    expect(onRenameObject).not.toHaveBeenCalled();
  });

  it("a single click opens the graph", () => {
    const { label, onOpenObject } = nav();
    fireEvent.click(label("Graph 1")!);
    expect(onOpenObject).toHaveBeenCalledWith("plot", "p");
  });

  it("a folder renames by double-click, typing and blur", () => {
    const { label, container, onRename } = nav();
    fireEvent.doubleClick(label("My project")!);
    const input = container.querySelector<HTMLInputElement>("input.navedit")!;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("folder", "f", "Renamed");
  });

  it("the renamed graph draws its new name as the title when it has none of its own", () => {
    const doc = new MadyDocument(project());
    doc.renamePlot("p", "Dose response");
    const saved = doc.toJSON();
    expect(buildPlotScene(saved.tables[0]!, saved.plots[0]!, { width: 500, height: 360 }).title).toBe("Dose response");
  });
});
