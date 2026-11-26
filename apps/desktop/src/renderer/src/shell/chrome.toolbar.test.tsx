// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Toolbar } from "./chrome";
import { DEFAULT_TOOLBAR_GROUPS } from "./toolbar";

afterEach(cleanup);

// Minimal props; individual tests override what they care about.
function setup(over: Record<string, unknown> = {}) {
  const props = {
    onAnalyze: vi.fn(),
    onNewProject: vi.fn(),
    onSave: vi.fn(),
    onOpen: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    canExport: true,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canBack: false,
    canForward: false,
    onBack: vi.fn(),
    onForward: vi.fn(),
    groups: DEFAULT_TOOLBAR_GROUPS,
    onReorderGroups: vi.fn(),
    onReorderWithinGroup: vi.fn(),
    onNewDataset: vi.fn(),
    onDuplicateData: vi.fn(),
    hasData: true,
    onDesign: vi.fn(),
    onMagic: vi.fn(),
    hasPlot: true,
    ...over,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ...render(<Toolbar {...(props as any)} />), props };
}

const byTitle = (c: HTMLElement, sub: string): HTMLButtonElement | undefined =>
  [...c.querySelectorAll("button")].find((b) => (b.getAttribute("title") ?? "").includes(sub));

// jsdom drag events carry no DataTransfer; supply a mock so setData/getData don't throw.
const dt = () => {
  const store: Record<string, string> = {};
  return { setData: (k: string, v: string) => void (store[k] = v), getData: (k: string) => store[k] ?? "" };
};

describe("Toolbar — named groups", () => {
  it("renders one caption per group, in default order, above the icons", () => {
    const { container } = setup();
    const captions = [...container.querySelectorAll(".gl")].map((e) => e.textContent);
    expect(captions).toEqual(["File", "Edit", "Data", "Analyze", "Graph"]);
    // each caption sits inside a .grp that also holds a .row of tool buttons
    for (const grp of container.querySelectorAll(".grp")) {
      expect(grp.querySelector(".gl"), "group has no caption").toBeTruthy();
      expect(grp.querySelector(".row .tool"), "group has no icons").toBeTruthy();
    }
  });

  it("puts undo/redo inside the Edit group, not in a fixed right cluster", () => {
    const { container, props } = setup();
    const editGrp = [...container.querySelectorAll(".grp")].find((g) => g.querySelector(".gl")?.textContent === "Edit")!;
    const undo = editGrp.querySelector<HTMLButtonElement>('button[title^="Undo"]')!;
    const redo = editGrp.querySelector<HTMLButtonElement>('button[title^="Redo"]')!;
    expect(undo).toBeTruthy();
    expect(redo).toBeTruthy();
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onRedo).toHaveBeenCalledTimes(1);
  });

  it("captions are draggable and a caption drop reorders groups", () => {
    const { container, props } = setup();
    const fileCap = [...container.querySelectorAll(".gl")].find((e) => e.textContent === "File")! as HTMLElement;
    expect(fileCap.getAttribute("draggable")).toBe("true");
    // start dragging File, drop on the Graph group's divider/cell
    const d = dt();
    fireEvent.dragStart(fileCap, { dataTransfer: d });
    const graphGrp = [...container.querySelectorAll(".grp")].find((g) => g.querySelector(".gl")?.textContent === "Graph")!;
    fireEvent.dragOver(graphGrp, { dataTransfer: d });
    fireEvent.drop(graphGrp, { dataTransfer: d });
    expect(props.onReorderGroups).toHaveBeenCalledWith("File", expect.any(Number));
  });

  it("dragging an icon onto a sibling reorders within the group", () => {
    const { container, props } = setup();
    const fileGrp = [...container.querySelectorAll(".grp")].find((g) => g.querySelector(".gl")?.textContent === "File")!;
    const [first, , third] = [...fileGrp.querySelectorAll<HTMLButtonElement>(".row .tool")];
    const d = dt();
    fireEvent.dragStart(first!, { dataTransfer: d });
    fireEvent.dragOver(third!, { dataTransfer: d });
    fireEvent.drop(third!, { dataTransfer: d });
    expect(props.onReorderWithinGroup).toHaveBeenCalledWith("File", expect.any(String), expect.any(Number));
  });
});

describe("Toolbar — datasheet buttons + Save dot", () => {
  it("New datasheet + Duplicate call their handlers; Duplicate disables without data", () => {
    const a = setup();
    fireEvent.click(byTitle(a.container, "New datasheet")!);
    expect(a.props.onNewDataset).toHaveBeenCalledTimes(1);
    fireEvent.click(byTitle(a.container, "Duplicate the current datasheet")!);
    expect(a.props.onDuplicateData).toHaveBeenCalledTimes(1);
    cleanup();
    const b = setup({ hasData: false });
    expect(byTitle(b.container, "Duplicate the current datasheet")?.disabled).toBe(true);
  });

  it("shows the unsaved-changes dot only when dirty", () => {
    const clean = setup({ dirty: false });
    expect(clean.container.querySelector(".savedot")).toBeNull();
    cleanup();
    const dirty = setup({ dirty: true });
    expect(dirty.container.querySelector(".savedot")).toBeTruthy();
    expect(byTitle(dirty.container, "unsaved changes")).toBeTruthy();
  });
});
