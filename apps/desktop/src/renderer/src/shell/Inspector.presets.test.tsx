// @vitest-environment jsdom
/**
 * The Save row of the Style preset panel: "Include this graph type's own settings" is ticked
 * to start with, Save and "★ Set this graph as the default" both pass its state, and unticking
 * it saves the shared look only. The built-in cards stay first in the section (the guided tour
 * clicks the first card).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { STYLE_PRESETS } from "@mady/core";
import { StylePresetPanel } from "./Inspector";

afterEach(cleanup);

function open(onSave = vi.fn(() => ({ id: "up_new", name: "Lab", style: {}, palette: [], createdAt: 1 }))) {
  const onSetProfileDefault = vi.fn();
  const u = render(
    <StylePresetPanel
      userPresets={[]}
      profileDefault={null}
      plotKind="bar"
      canAddKind
      onApplyPreset={vi.fn()}
      onApplyUserPreset={vi.fn()}
      onSaveUserPreset={onSave}
      onAddPresetKind={vi.fn()}
      onDeleteUserPreset={vi.fn()}
      onSetProfileDefault={onSetProfileDefault}
    />,
  );
  return { u, onSave, onSetProfileDefault };
}

describe("Style preset panel — saving with the graph type's own settings", () => {
  it("the box starts ticked and Save passes it", () => {
    const { u, onSave } = open();
    const box = u.getByLabelText("Include this graph type's own settings") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.change(u.getByLabelText("Preset name"), { target: { value: "Lab" } });
    fireEvent.click(u.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith("Lab", true);
  });

  it("unticked, Save passes false", () => {
    const { u, onSave } = open();
    fireEvent.click(u.getByLabelText("Include this graph type's own settings"));
    fireEvent.change(u.getByLabelText("Preset name"), { target: { value: "Lab plain" } });
    fireEvent.click(u.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith("Lab plain", false);
  });

  it("'★ Set this graph as the default' saves with the box's state and makes it the default", () => {
    const { u, onSave, onSetProfileDefault } = open();
    fireEvent.click(u.getByText("★ Set this graph as the default"));
    expect(onSave).toHaveBeenCalledWith("My style", true);
    expect(onSetProfileDefault).toHaveBeenCalledWith({ kind: "user", id: "up_new" });
  });

  it("the tooltip says what the box does in plain words", () => {
    const { u } = open();
    const row = u.getByLabelText("Include this graph type's own settings").closest("label")!;
    expect(row.title).toMatch(/bar width/);
    expect(row.title).toMatch(/ignored on other types/);
  });

  it("the built-in cards come first in the panel", () => {
    const { u } = open();
    const first = u.container.querySelector("button.btn-mini")!;
    expect(first.textContent).toContain(STYLE_PRESETS[0]!.name);
  });
});

describe("Style preset panel — preset files", () => {
  it("'Import preset…' without the desktop app says so, never a silent no-op", async () => {
    delete (window as { mady?: unknown }).mady;
    const { u } = open();
    fireEvent.click(u.getByText("Import preset…"));
    await new Promise((r) => setTimeout(r, 0));
    expect(u.container.textContent).toContain("Import needs the desktop app");
  });
});

describe("Style preset panel — management callbacks reach the cards", () => {
  const lab = { id: "up_a", name: "Lab", style: {}, palette: ["#111"], kinds: { pie: { pieDonut: 0.4 } }, createdAt: 2 };
  const plain = { id: "up_b", name: "Plain", style: {}, palette: [], createdAt: 1 };

  it("Rename, Duplicate (with its refusal shown), a pill's ✕ and the handle call through", () => {
    const onRename = vi.fn();
    const onDuplicate = vi.fn(() => "Not duplicated: the preset list is full (60); delete one first.");
    const onRemoveKind = vi.fn();
    const onReorder = vi.fn();
    const u = render(
      <StylePresetPanel
        userPresets={[lab, plain]}
        profileDefault={null}
        plotKind="bar"
        canAddKind
        onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()}
        onSaveUserPreset={vi.fn(() => null)}
        onAddPresetKind={vi.fn()}
        onDeleteUserPreset={vi.fn()}
        onRenameUserPreset={onRename}
        onDuplicateUserPreset={onDuplicate}
        onRemovePresetKind={onRemoveKind}
        onReorderUserPresets={onReorder}
        onSetProfileDefault={vi.fn()}
      />,
    );
    const pick = (name: string, item: string): void => {
      fireEvent.click(u.getByLabelText(`More actions for ${name}`));
      fireEvent.click(u.getByLabelText(`${item} ${name}`));
    };
    fireEvent.click(u.getByLabelText("Manage presets")); // the simple view hides the controls until then
    pick("Lab", "Rename");
    const box = u.getByLabelText("New name for Lab") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Lab 2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("up_a", "Lab 2");
    pick("Lab", "Duplicate");
    expect(onDuplicate).toHaveBeenCalledWith("up_a");
    expect(u.container.textContent).toContain("Not duplicated"); // the refusal is shown, not swallowed
    fireEvent.click(u.getByLabelText("Show the types in Lab")); // unfold the list, then its ✕
    fireEvent.click(u.getByLabelText(/^Remove .* settings from Lab$/));
    expect(onRemoveKind).toHaveBeenCalledWith("up_a", "pie");
    fireEvent.keyDown(u.getByLabelText("Move Plain"), { key: "ArrowUp" });
    expect(onReorder).toHaveBeenCalledWith(["up_b", "up_a"]);
  });

  it("without the callbacks the cards draw none of the four controls", () => {
    const u = render(
      <StylePresetPanel
        userPresets={[lab]}
        profileDefault={null}
        plotKind="bar"
        onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()}
        onSaveUserPreset={vi.fn(() => null)}
        onDeleteUserPreset={vi.fn()}
        onSetProfileDefault={vi.fn()}
      />,
    );
    fireEvent.click(u.getByLabelText("Manage presets"));
    fireEvent.click(u.getByLabelText("More actions for Lab"));
    expect(u.queryByLabelText("Rename Lab")).toBeNull();
    expect(u.queryByLabelText("Duplicate Lab")).toBeNull();
    fireEvent.click(u.getByLabelText("Show the types in Lab"));
    expect(u.queryByLabelText(/^Remove /)).toBeNull();
    expect(u.queryByLabelText("Move Lab")).toBeNull();
  });
});

describe("Style preset panel — the simple view and Manage…", () => {
  const lab = { id: "up_a", name: "Lab", style: {}, palette: ["#111"], kinds: { pie: { pieDonut: 0.4 } }, createdAt: 2 };
  const mount = (presets: typeof lab[]) =>
    render(
      <StylePresetPanel
        userPresets={presets}
        profileDefault={null}
        plotKind="bar"
        canAddKind
        onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()}
        onSaveUserPreset={vi.fn(() => null)}
        onAddPresetKind={vi.fn()}
        onDeleteUserPreset={vi.fn()}
        onRenameUserPreset={vi.fn()}
        onDuplicateUserPreset={vi.fn(() => null)}
        onRemovePresetKind={vi.fn()}
        onReorderUserPresets={vi.fn()}
        onSetProfileDefault={vi.fn()}
      />,
    );

  it("starts simple: the cards carry no management row; Manage… reveals it, Done hides it again", () => {
    const u = mount([lab]);
    const toggle = u.getByLabelText("Manage presets") as HTMLButtonElement;
    expect(toggle.textContent).toBe("Manage…");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(u.queryByLabelText("More actions for Lab")).toBeNull();
    expect(u.queryByLabelText("Move Lab")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Done");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(u.getByLabelText("More actions for Lab")).toBeTruthy();
    expect(u.getByLabelText("Move Lab")).toBeTruthy();
    expect(u.getByLabelText("Add Bar / column settings to Lab")).toBeTruthy();
    fireEvent.click(toggle);
    expect(u.queryByLabelText("More actions for Lab")).toBeNull();
  });

  it("with no preset of your own there is nothing to manage, so no Manage… button", () => {
    const u = mount([]);
    expect(u.queryByLabelText("Manage presets")).toBeNull();
  });
});
