// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import { getAppDefaults, getGlobalParams, getKindDefaults, getProfileDefault, listAnalysisDefaults, setAnalysisDefault, setAppDefaults } from "./profile";
import { findUserPreset, listUserPresets, saveUserPreset } from "./userPresets";
import { kindLabel } from "./UserPresetList";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("SettingsDialog", () => {
  const open = () => render(<SettingsDialog onClose={vi.fn()} onChanged={vi.fn()} />);

  it("sets a favourite preset for one graph type (persisted) and notifies onChanged", () => {
    const onChanged = vi.fn();
    const u = render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />);
    const sel = u.container.querySelector('select[aria-label="Default preset for Bar / column"]') as HTMLSelectElement;
    expect(sel).toBeTruthy();
    fireEvent.change(sel, { target: { value: "b:Scientific Journal" } });
    expect(getKindDefaults().bar).toEqual({ kind: "builtin", name: "Scientific Journal" });
    expect(onChanged).toHaveBeenCalled();
    // "Use global default" removes the per-type override again
    fireEvent.change(sel, { target: { value: "inherit" } });
    expect("bar" in getKindDefaults()).toBe(false);
  });

  it("sets and clears a global common default (title size)", () => {
    const u = open();
    const size = u.container.querySelector('input[aria-label="Title size"]') as HTMLInputElement;
    fireEvent.change(size, { target: { value: "22" } });
    expect(getGlobalParams().titleSize).toBe(22);
    fireEvent.change(size, { target: { value: "" } }); // blank → defer to preset
    expect(getGlobalParams().titleSize).toBeUndefined();
  });

  it("changes the global default preset", () => {
    const u = open();
    const sel = u.container.querySelector('select[aria-label="Global default preset"]') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "b:Editorial" } });
    expect(getProfileDefault()).toEqual({ kind: "builtin", name: "Editorial" });
  });

  it("sets a palette from a built-in preset", () => {
    const u = open();
    const sel = u.container.querySelector('select[aria-label="Colour palette"]') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "Scientific Journal" } });
    expect(Array.isArray(getGlobalParams().palette)).toBe(true);
    expect(getGlobalParams().palette!.length).toBeGreaterThan(0);
  });
});

describe("SettingsDialog — application defaults", () => {
  const open = (onChanged = vi.fn()) => ({ ...render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />), onChanged });
  const q = <T extends Element>(u: { container: Element }, sel: string) => u.container.querySelector(sel) as T;

  it("default graph type + error bars persist (unset shows the built-in default)", () => {
    const u = open();
    const type = q<HTMLSelectElement>(u, 'select[aria-label="Default graph type"]');
    expect(type.value).toBe("xy"); // unset → first genre
    fireEvent.change(type, { target: { value: "bar" } });
    expect(getAppDefaults().defaultGenre).toBe("bar");

    const err = q<HTMLSelectElement>(u, 'select[aria-label="Default error bars"]');
    expect(err.value).toBe("sd");
    fireEvent.change(err, { target: { value: "sem" } });
    expect(getAppDefaults().errorBars).toBe("sem");
  });

  it("default confidence persists", () => {
    const u = open();
    fireEvent.change(q<HTMLSelectElement>(u, 'select[aria-label="Default confidence level"]'), { target: { value: "99" } });
    expect(getAppDefaults().conf).toBe(99);
  });

  it("results-table rounding is off until chosen, persists, and can be switched back off", () => {
    const u = open();
    const sel = q<HTMLSelectElement>(u, 'select[aria-label="Round results tables"]');
    expect(sel.value).toBe("0");
    expect(getAppDefaults().resultDigits).toBeUndefined();
    fireEvent.change(sel, { target: { value: "4" } });
    expect(getAppDefaults().resultDigits).toBe(4);
    fireEvent.change(sel, { target: { value: "0" } });
    expect(getAppDefaults().resultDigits).toBe(0);
  });

  it("controls initialise from the saved store on mount (reopening reflects saved values)", () => {
    setAppDefaults({ defaultGenre: "bar", errorBars: "sem", conf: 99, theme: "dark", autosaveEnabled: false });
    const u = open();
    expect(q<HTMLSelectElement>(u, 'select[aria-label="Default graph type"]').value).toBe("bar");
    expect(q<HTMLSelectElement>(u, 'select[aria-label="Default error bars"]').value).toBe("sem");
    expect(q<HTMLSelectElement>(u, 'select[aria-label="Default confidence level"]').value).toBe("99");
    expect(q<HTMLSelectElement>(u, 'select[aria-label="Theme"]').value).toBe("dark");
    expect(q<HTMLSelectElement>(u, 'select[aria-label="Autosave"]').value).toBe("off");
  });

  it("theme change persists and notifies onChanged (AppShell applies it live)", () => {
    const u = open();
    fireEvent.change(q<HTMLSelectElement>(u, 'select[aria-label="Theme"]'), { target: { value: "dark" } });
    expect(getAppDefaults().theme).toBe("dark");
    expect(u.onChanged).toHaveBeenCalled();
  });

  it("autosave interval stores as ms; disabling persists autosaveEnabled=false", () => {
    const u = open();
    fireEvent.change(q<HTMLInputElement>(u, 'input[aria-label="Autosave interval in seconds"]'), { target: { value: "3" } });
    expect(getAppDefaults().autosaveMs).toBe(3000);
    fireEvent.change(q<HTMLSelectElement>(u, 'select[aria-label="Autosave"]'), { target: { value: "off" } });
    expect(getAppDefaults().autosaveEnabled).toBe(false);
  });

  it("lists a method's saved analysis default and clears it", () => {
    setAnalysisDefault("ttest", { variant: "welch" });
    const u = open();
    const clearBtn = q<HTMLButtonElement>(u, 'button[aria-label^="Clear saved default for"]');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn);
    expect(listAnalysisDefaults()).toEqual([]);
    // The row is gone → the empty-state note is shown.
    expect(u.container.textContent).toContain("No saved per-analysis defaults");
  });
});

/**
 * The "My saved presets" section is the same preset list the Inspector shows (`UserPresetList`): each saved preset with the
 * graph types it carries its own settings for, a star for the global default, rename and delete.
 */
describe("SettingsDialog — my saved presets is the shared preset module", () => {
  beforeEach(() => localStorage.clear());

  it("names the types a preset covers and lets the star make it the default", () => {
    const rec = saveUserPreset("Lab", { frame: "box" }, ["#111"], undefined, { bar: { barWidth: 0.9 } });
    const onChanged = vi.fn();
    const u = render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />);
    expect(u.getByLabelText("Rename Lab")).toBeTruthy();
    fireEvent.click(u.getByLabelText("Show the types in Lab")); // the chip unfolds the list
    expect(u.getByLabelText("Types in Lab").textContent).toContain(kindLabel("bar"));
    const star = u.getByTitle(`Set "Lab" as the default for new graphs`);
    fireEvent.click(star);
    expect(getProfileDefault()).toEqual({ kind: "user", id: rec.id });
    expect(onChanged).toHaveBeenCalled();
    // …and the global-default select above follows.
    const sel = u.container.querySelector('select[aria-label="Global default preset"]') as HTMLSelectElement;
    expect(sel.value).toBe(`u:${rec.id}`);
    // No graph is open here, so there is nothing to apply and no "+ type".
    expect(u.queryByTitle("Apply this saved preset (style + colours)")).toBeNull();
    expect(u.queryByLabelText(/^Add /)).toBeNull();
  });
});

describe("SettingsDialog — preset management writes the store", () => {
  it("Duplicate makes a copy beside the original; a pill's remove button drops that type; the handle reorders; all notify onChanged", () => {
    const a = saveUserPreset("Lab", { frame: "box" }, ["#111"], undefined, { bar: { barWidth: 0.9 }, pie: { pieDonut: 0.4 } });
    const b = saveUserPreset("Plain", {}, []);
    const onChanged = vi.fn();
    const u = render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(u.getByLabelText("More actions for Lab"));
    fireEvent.click(u.getByLabelText("Duplicate Lab"));
    expect(listUserPresets().map((p) => p.name)).toEqual(["Plain", "Lab", "Lab copy"]);
    expect(u.getByLabelText("Rename Lab copy")).toBeTruthy(); // the dialog re-read the store
    fireEvent.click(u.getByLabelText("Show the types in Lab"));
    fireEvent.click(u.getByLabelText(`Remove ${kindLabel("bar")} settings from Lab`));
    expect(findUserPreset(a.id)?.kinds).toEqual({ pie: { pieDonut: 0.4 } });
    fireEvent.keyDown(u.getByLabelText("Move Lab"), { key: "ArrowUp" });
    expect(listUserPresets().map((p) => p.id)[0]).toBe(a.id);
    expect(listUserPresets().map((p) => p.id)[1]).toBe(b.id);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("SettingsDialog — hover values in the interactive HTML export", () => {
  it("defaults to On, and Off is remembered", () => {
    const u = render(<SettingsDialog onClose={vi.fn()} onChanged={vi.fn()} />);
    const sel = u.container.querySelector('select[aria-label="Hover values in interactive HTML export"]') as HTMLSelectElement | null;
    expect(sel, "no hover-values setting").toBeTruthy();
    expect(sel!.value).toBe("on");
    fireEvent.change(sel!, { target: { value: "off" } });
    expect(getAppDefaults().exportHoverValues).toBe(false);
    fireEvent.change(sel!, { target: { value: "on" } });
    expect(getAppDefaults().exportHoverValues).toBe(true);
  });
});
