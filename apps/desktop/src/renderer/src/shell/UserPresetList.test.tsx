// @vitest-environment jsdom
/**
 * The one list of saved presets, on its two surfaces. With a graph open (Inspector) a card
 * applies on click and "+ type" adds the open graph's type-specific settings; without one
 * (Settings) neither exists, and the row renames instead. Both show the types a preset covers
 * as one line — the open graph's type and a chip counting the rest — that unfolds on demand,
 * and keep the secondary actions (Rename, Duplicate, Types…, Export…, Delete) behind one
 * "More actions" (⋯) menu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { UserPresetList, kindLabel, movedBefore, movedBy, presetKindsText, typesChipText } from "./UserPresetList";
import type { UserPreset } from "./userPresets";

afterEach(cleanup);

const presets: UserPreset[] = [
  { id: "up_a", name: "Lab", style: { frame: "box" }, palette: ["#111", "#222"], kinds: { pie: { pieDonut: 0.4 }, bar: { barWidth: 0.9 } }, createdAt: 2 },
  { id: "up_b", name: "Plain", style: {}, palette: [], createdAt: 1 },
];
const base = { presets, profileDefault: null, onDelete: vi.fn(), onSetProfileDefault: vi.fn() };
/** Open a card's "More actions" menu and press one of its items. */
const pick = (u: ReturnType<typeof render>, name: string, item: string): void => {
  fireEvent.click(u.getByLabelText(`More actions for ${name}`));
  fireEvent.click(u.getByLabelText(`${item} ${name}`));
};

describe("UserPresetList — with a graph open (the Inspector)", () => {
  const spies = () => ({ onApply: vi.fn(), onAddKind: vi.fn(), onDelete: vi.fn(), onSetProfileDefault: vi.fn() });

  it("a card applies on click; '+ type' on the types line adds the open graph's type; a saved type shows a check mark", () => {
    const s = spies();
    const u = render(<UserPresetList variant="inspector" presets={presets} profileDefault={null} activeKind="xy" {...s} />);
    fireEvent.click(u.getByText("Lab"));
    expect(s.onApply).toHaveBeenCalledWith(presets[0]);
    fireEvent.click(u.getByLabelText(`Add ${kindLabel("xy")} settings to Lab`));
    expect(s.onAddKind).toHaveBeenCalledWith("up_a");
    cleanup();
    const v = render(<UserPresetList variant="inspector" presets={presets} profileDefault={null} activeKind="bar" {...spies()} />);
    expect(v.queryByLabelText(`Add ${kindLabel("bar")} settings to Lab`)).toBeNull(); // already there: shown with a check mark
    expect(v.container.querySelector(".pc-row .pc-kind.active")?.textContent).toBe(`${kindLabel("bar")} ✓`);
    expect(v.getByLabelText(`Add ${kindLabel("bar")} settings to Plain`)).toBeTruthy();
  });

  it("the types line is one chip, worded from what is already on the line; it unfolds the full list", () => {
    expect(presetKindsText(presets[0]!)).toBe(`${kindLabel("bar")}, ${kindLabel("pie")}`);
    expect(typesChipText(0, false)).toBe("shared look only");
    expect(typesChipText(2, false)).toBe("2 types");
    expect(typesChipText(2, true)).toBe("1 more type");
    expect(typesChipText(1, true)).toBe("no other type");
    const u = render(<UserPresetList variant="inspector" presets={presets} profileDefault={null} activeKind="bar" {...spies()} />);
    const chipLab = u.getByLabelText("Show the types in Lab") as HTMLButtonElement;
    expect(chipLab.textContent).toBe("1 more type");
    expect(chipLab.getAttribute("aria-expanded")).toBe("false");
    expect(u.queryByLabelText("Types in Lab")).toBeNull();
    fireEvent.click(chipLab);
    expect(chipLab.getAttribute("aria-expanded")).toBe("true");
    const rows = [...u.getByLabelText("Types in Lab").querySelectorAll("li")].map((li) => li.querySelector("span")?.textContent);
    expect(rows).toEqual([kindLabel("bar"), kindLabel("pie")]);
    fireEvent.click(chipLab);
    expect(u.queryByLabelText("Types in Lab")).toBeNull();
    const chipPlain = u.getByLabelText("Show the types in Plain") as HTMLButtonElement;
    expect(chipPlain.textContent).toBe("shared look only");
    expect(chipPlain.disabled).toBe(true);
  });

  it("'+ type' is disabled, and says why, when the graph has nothing of its own to add", () => {
    const u = render(<UserPresetList variant="inspector" presets={presets} profileDefault={null} activeKind="xy" canAddKind={false} {...spies()} />);
    const btn = u.getByLabelText(`Add ${kindLabel("xy")} settings to Lab`) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/no .* setting to add/);
  });

  it("the star sets and clears the default; Delete sits in the More actions menu", () => {
    const s = spies();
    const u = render(<UserPresetList variant="inspector" presets={presets} profileDefault={{ kind: "user", id: "up_a" }} activeKind="bar" {...s} />);
    const stars = u.getAllByRole("button", { pressed: true });
    expect(stars).toHaveLength(1);
    fireEvent.click(stars[0]!);
    expect(s.onSetProfileDefault).toHaveBeenCalledWith(null);
    expect(u.queryByLabelText("Delete Plain")).toBeNull(); // behind the menu
    pick(u, "Plain", "Delete");
    expect(s.onDelete).toHaveBeenCalledWith("up_b");
    expect(u.queryByLabelText("Delete Plain")).toBeNull(); // the menu closed
  });

  it("the More actions menu closes on Escape, and lists only what the caller can do", () => {
    const u = render(<UserPresetList variant="inspector" presets={presets} profileDefault={null} activeKind="bar" {...spies()} />);
    fireEvent.click(u.getByLabelText("More actions for Lab"));
    const items = [...u.getByRole("menu").querySelectorAll("[role=menuitem]")].map((b) => b.textContent);
    expect(items).toEqual(["Types…", "Delete"]); // no rename / duplicate / export callbacks given
    fireEvent.keyDown(u.getByRole("menu"), { key: "Escape" });
    expect(u.queryByRole("menu")).toBeNull();
    fireEvent.click(u.getByLabelText("More actions for Plain"));
    expect([...u.getByRole("menu").querySelectorAll("[role=menuitem]")].map((b) => b.textContent)).toEqual(["Delete"]); // nothing to list
  });
});

describe("UserPresetList — without a graph (Settings)", () => {
  it("renames on blur, deletes and stars from the row; no apply, no '+ type', no check mark", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    const onSetProfileDefault = vi.fn();
    const u = render(<UserPresetList variant="settings" presets={presets} profileDefault={null} onRename={onRename} onDelete={onDelete} onSetProfileDefault={onSetProfileDefault} />);
    const box = u.getByLabelText("Rename Lab") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Lab 2" } });
    fireEvent.blur(box);
    expect(onRename).toHaveBeenCalledWith("up_a", "Lab 2");
    pick(u, "Lab", "Delete");
    expect(onDelete).toHaveBeenCalledWith("up_a");
    fireEvent.click(u.getAllByRole("button", { pressed: false })[0]!);
    expect(onSetProfileDefault).toHaveBeenCalledWith({ kind: "user", id: "up_a" });
    expect(u.queryByLabelText(/^Add /)).toBeNull();
    expect(u.queryByTitle("Apply this saved preset (style + colours)")).toBeNull();
    expect(u.container.querySelector(".pc-kind.active")).toBeNull();
    expect((u.getByLabelText("Show the types in Lab") as HTMLButtonElement).textContent).toBe("2 types");
    expect((u.getByLabelText("Show the types in Plain") as HTMLButtonElement).textContent).toBe("shared look only");
    // Settings renames in its box, so its menu carries no Rename item.
    fireEvent.click(u.getByLabelText("More actions for Lab"));
    expect([...u.getByRole("menu").querySelectorAll("[role=menuitem]")].map((b) => b.textContent)).toEqual(["Types…", "Delete"]);
  });
});

describe("UserPresetList — Export… in the More actions menu, on both surfaces", () => {
  it("calls back with the preset; absent, no item", () => {
    const onExport = vi.fn();
    const a = render(<UserPresetList variant="inspector" activeKind="bar" onApply={vi.fn()} onAddKind={vi.fn()} onExport={onExport} {...base} />);
    pick(a, "Lab", "Export");
    expect(onExport).toHaveBeenCalledWith(presets[0]);
    cleanup();
    const b = render(<UserPresetList variant="settings" onRename={vi.fn()} onExport={onExport} {...base} />);
    pick(b, "Plain", "Export");
    expect(onExport).toHaveBeenLastCalledWith(presets[1]);
    cleanup();
    const c = render(<UserPresetList variant="settings" onRename={vi.fn()} {...base} />);
    fireEvent.click(c.getByLabelText("More actions for Lab"));
    expect(c.queryByLabelText("Export Lab")).toBeNull();
  });
});

describe("UserPresetList — management", () => {
  it("Inspector: Rename (More actions menu) turns the name into a box; Enter keeps the new name, Esc leaves it", () => {
    const onRename = vi.fn();
    const u = render(<UserPresetList variant="inspector" activeKind="bar" onApply={vi.fn()} onRename={onRename} {...base} />);
    pick(u, "Lab", "Rename");
    const box = u.getByLabelText("New name for Lab") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Lab 2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("up_a", "Lab 2");
    expect(u.queryByLabelText("New name for Lab")).toBeNull();
    pick(u, "Plain", "Rename");
    const box2 = u.getByLabelText("New name for Plain") as HTMLInputElement;
    fireEvent.change(box2, { target: { value: "Gone" } });
    fireEvent.keyDown(box2, { key: "Escape" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(u.queryByLabelText("New name for Plain")).toBeNull();
  });

  it("Duplicate (More actions menu) calls back with the id on both surfaces; absent, no item", () => {
    const onDuplicate = vi.fn();
    const a = render(<UserPresetList variant="inspector" activeKind="bar" onApply={vi.fn()} onDuplicate={onDuplicate} {...base} />);
    pick(a, "Lab", "Duplicate");
    expect(onDuplicate).toHaveBeenCalledWith("up_a");
    cleanup();
    const b = render(<UserPresetList variant="settings" onRename={vi.fn()} onDuplicate={onDuplicate} {...base} />);
    pick(b, "Plain", "Duplicate");
    expect(onDuplicate).toHaveBeenLastCalledWith("up_b");
    cleanup();
    const c = render(<UserPresetList variant="settings" onRename={vi.fn()} {...base} />);
    fireEvent.click(c.getByLabelText("More actions for Lab"));
    expect(c.queryByLabelText("Duplicate Lab")).toBeNull();
  });

  it("the unfolded list carries a remove button per type that drops that type — and does not apply the card; 'Types…' in the menu unfolds it too", () => {
    const onRemoveKind = vi.fn();
    const onApply = vi.fn();
    const u = render(<UserPresetList variant="inspector" activeKind="bar" onApply={onApply} onRemoveKind={onRemoveKind} {...base} />);
    expect(u.queryByLabelText(/^Remove /)).toBeNull(); // folded: nothing to click
    pick(u, "Lab", "Types");
    fireEvent.click(u.getByLabelText(`Remove ${kindLabel("pie")} settings from Lab`));
    expect(onRemoveKind).toHaveBeenCalledWith("up_a", "pie");
    expect(onApply).not.toHaveBeenCalled();
    cleanup();
    const s = render(<UserPresetList variant="settings" onRename={vi.fn()} onRemoveKind={onRemoveKind} {...base} />);
    fireEvent.click(s.getByLabelText("Show the types in Lab"));
    fireEvent.click(s.getByLabelText(`Remove ${kindLabel("bar")} settings from Lab`));
    expect(onRemoveKind).toHaveBeenLastCalledWith("up_a", "bar");
    cleanup();
    const n = render(<UserPresetList variant="settings" onRename={vi.fn()} {...base} />);
    fireEvent.click(n.getByLabelText("Show the types in Lab"));
    expect(n.queryByLabelText(/^Remove /)).toBeNull(); // no callback: the list names the types, no remove button
  });

  it("the handle orders the list: ↑/↓ keys, and a drop onto another card", () => {
    const onReorder = vi.fn();
    const u = render(<UserPresetList variant="inspector" activeKind="bar" onApply={vi.fn()} onReorder={onReorder} {...base} />);
    fireEvent.keyDown(u.getByLabelText("Move Plain"), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledWith(["up_b", "up_a"]);
    fireEvent.keyDown(u.getByLabelText("Move Lab"), { key: "ArrowUp" }); // already first: no call
    expect(onReorder).toHaveBeenCalledTimes(1);
    const rows = u.container.querySelectorAll(".pc-row");
    const dt = { effectAllowed: "", setData: vi.fn(), getData: () => "up_b" };
    fireEvent.dragStart(u.getByLabelText("Move Plain"), { dataTransfer: dt });
    fireEvent.dragOver(rows[0]!, { dataTransfer: dt });
    fireEvent.drop(rows[0]!, { dataTransfer: dt });
    expect(onReorder).toHaveBeenLastCalledWith(["up_b", "up_a"]);
    expect(onReorder).toHaveBeenCalledTimes(2);
  });

  it("movedBefore / movedBy — the order arithmetic", () => {
    expect(movedBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(movedBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(movedBefore(["a", "b", "c"], "a", "a")).toEqual(["a", "b", "c"]);
    expect(movedBy(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(movedBy(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });
});

describe("UserPresetList — the simple view (manage=false)", () => {
  it("shows the card and its star only: no handle, no types line, no menu, no list; apply still works", () => {
    const onApply = vi.fn();
    const u = render(<UserPresetList variant="inspector" manage={false} activeKind="bar" onApply={onApply} onAddKind={vi.fn()} onRename={vi.fn()} onDuplicate={vi.fn()} onRemoveKind={vi.fn()} onReorder={vi.fn()} onExport={vi.fn()} {...base} />);
    expect(u.queryByLabelText(/^More actions for /)).toBeNull();
    expect(u.queryByLabelText(/^Move /)).toBeNull();
    expect(u.queryByLabelText(/^Show the types in /)).toBeNull();
    expect(u.queryByLabelText(/^Add /)).toBeNull();
    expect(u.container.querySelector(".pc-actions")).toBeNull();
    expect(u.getAllByRole("button", { pressed: false })).toHaveLength(2); // the two star buttons
    fireEvent.click(u.getByText("Lab"));
    expect(onApply).toHaveBeenCalledWith(presets[0]);
  });

  it("Settings ignores it — the management page always shows its line and menu", () => {
    const u = render(<UserPresetList variant="settings" manage={false} onRename={vi.fn()} onDuplicate={vi.fn()} {...base} />);
    expect(u.getByLabelText("More actions for Lab")).toBeTruthy();
    expect(u.getByLabelText("Show the types in Lab")).toBeTruthy();
  });
});
