// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SaveDialog } from "./SaveDialog";
import type { SaveFolderNode, SaveItem } from "./SaveDialog";

afterEach(cleanup);

/** Folder 1 holds a loose graph + an experiment with a graph and its datasheet. */
const folders: SaveFolderNode[] = [
  {
    id: "f1",
    name: "Project 1",
    members: [{ kind: "plot", id: "p1", name: "Graph 1" }],
    experiments: [
      {
        id: "e1",
        name: "Experiment 1",
        members: [
          { kind: "table", id: "t2", name: "Data 2" },
          { kind: "plot", id: "p2", name: "Graph 2" },
        ],
      },
    ],
  },
  { id: "f2", name: "Project 2", members: [{ kind: "table", id: "t3", name: "Data 3" }], experiments: [] },
];

function setup(folderList = folders, loose: SaveItem[] = []) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<SaveDialog folders={folderList} loose={loose} onConfirm={onConfirm} onCancel={onCancel} />);
  const saveBtn = () => utils.container.querySelector(".btn") as HTMLButtonElement;
  const box = (label: string) => utils.getByLabelText(label) as HTMLInputElement;
  return { ...utils, onConfirm, onCancel, saveBtn, box };
}

describe("SaveDialog", () => {
  it("defaults to everything checked → confirms with null (whole project)", () => {
    const d = setup();
    expect(d.saveBtn().textContent).toContain("everything");
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith(null);
  });

  it("unticking a folder saves the other one as a single folder pick", () => {
    const d = setup();
    fireEvent.click(d.box("Project 2"));
    expect(d.saveBtn().textContent).toContain("project folder");
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith([{ level: "folder", id: "f1" }]);
  });

  it("saves a single graph when it is the only thing left ticked", () => {
    const d = setup();
    fireEvent.click(d.box("Project 1")); // clear everything, then tick one graph
    fireEvent.click(d.box("Project 2"));
    fireEvent.click(d.box("Graph 2"));
    expect(d.saveBtn().textContent).toBe("Save this graph…");
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith([{ level: "object", kind: "plot", id: "p2" }]);
  });

  it("a fully-ticked experiment is one experiment pick, not one per object", () => {
    const d = setup();
    fireEvent.click(d.box("Project 2")); // off
    fireEvent.click(d.box("Graph 1")); // off → Project 1 is now partial, its experiment still whole
    expect(d.saveBtn().textContent).toBe("Save this experiment…");
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith([{ level: "experiment", id: "e1" }]);
  });

  it("a container reads as mixed while only part of it is ticked", () => {
    const d = setup();
    expect(d.box("Project 1").indeterminate).toBe(false);
    fireEvent.click(d.box("Graph 2"));
    expect(d.box("Experiment 1").indeterminate).toBe(true);
    expect(d.box("Project 1").indeterminate).toBe(true);
    expect(d.box("Project 1").checked).toBe(false);
  });

  it("unticking a folder unticks everything under it", () => {
    const d = setup();
    fireEvent.click(d.box("Project 1"));
    for (const label of ["Graph 1", "Experiment 1", "Data 2", "Graph 2"]) expect(d.box(label).checked).toBe(false);
  });

  it("offers loose objects too, and picks them by object", () => {
    const d = setup([], [{ kind: "plot", id: "p9", name: "Stray graph" }, { kind: "table", id: "t9", name: "Stray data" }]);
    fireEvent.click(d.box("Stray data"));
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith([{ level: "object", kind: "plot", id: "p9" }]);
  });

  it("disables Save when nothing is selected", () => {
    const d = setup();
    fireEvent.click(d.box("Project 1"));
    fireEvent.click(d.box("Project 2"));
    expect(d.saveBtn().disabled).toBe(true);
  });

  it("with an empty workspace, saves the whole project (null)", () => {
    const d = setup([]);
    expect(d.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    fireEvent.click(d.saveBtn());
    expect(d.onConfirm).toHaveBeenCalledWith(null);
  });

  it("the demo folder starts unticked and collapsed; the rest stay ticked + expanded", () => {
    const onConfirm = vi.fn();
    const { container, getByLabelText, queryByLabelText } = render(
      <SaveDialog folders={folders} loose={[]} demoFolderId="f1" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    // f1 ("Project 1") is the demo → its box is off and its children are not rendered (collapsed).
    expect((getByLabelText("Project 1") as HTMLInputElement).checked).toBe(false);
    expect(queryByLabelText("Graph 1")).toBeNull();
    expect(queryByLabelText("Experiment 1")).toBeNull();
    // The other project is untouched: ticked and expanded.
    expect((getByLabelText("Project 2") as HTMLInputElement).checked).toBe(true);
    // Save writes only the non-demo folder.
    fireEvent.click(container.querySelector(".btn") as HTMLButtonElement);
    expect(onConfirm).toHaveBeenCalledWith([{ level: "folder", id: "f2" }]);
  });

  it("the demo default is only a default, not a lock — it can be expanded and re-ticked", () => {
    const { getByLabelText, queryByLabelText } = render(
      <SaveDialog folders={folders} loose={[]} demoFolderId="f1" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    fireEvent.click(getByLabelText("Expand Project 1")); // the chevron
    expect(queryByLabelText("Graph 1")).not.toBeNull(); // children now visible
    fireEvent.click(getByLabelText("Project 1")); // re-tick the whole demo
    expect((getByLabelText("Graph 1") as HTMLInputElement).checked).toBe(true);
  });

  it("cancels", () => {
    const d = setup();
    fireEvent.click(d.container.querySelector(".btn-ghost") as HTMLButtonElement);
    expect(d.onCancel).toHaveBeenCalled();
  });
});
