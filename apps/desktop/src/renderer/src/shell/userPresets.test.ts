// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { MAX_USER_PRESETS, deleteUserPreset, duplicateUserPreset, findUserPreset, insertUserPreset, listUserPresets, removeUserPresetKind, reorderUserPresets, saveUserPreset, setUserPresetKind } from "./userPresets";
import { getProfileDefault, setProfileDefault } from "./profile";

const style: Partial<Plot> = { figureWidth: 640, frame: "box", fonts: { title: { size: 28, family: "Helvetica" } } };

describe("userPresets store", () => {
  beforeEach(() => localStorage.clear());

  it("saves, lists (newest-first), finds, and deletes custom presets", () => {
    const a = saveUserPreset("House A", style, ["#111", "#222"]);
    const b = saveUserPreset("House B", { figureWidth: 480 }, []);
    const list = listUserPresets();
    expect(list.map((p) => p.name)).toEqual(["House B", "House A"]); // newest first
    expect(findUserPreset(a.id)?.palette).toEqual(["#111", "#222"]);
    deleteUserPreset(b.id);
    expect(listUserPresets().map((p) => p.name)).toEqual(["House A"]);
  });

  it("overwriting by name keeps the same id (so a default reference stays valid)", () => {
    const first = saveUserPreset("House", style, ["#111"]);
    const again = saveUserPreset("House", { figureWidth: 999 }, ["#999"]);
    expect(again.id).toBe(first.id);
    expect(listUserPresets()).toHaveLength(1);
    expect(findUserPreset(first.id)?.style.figureWidth).toBe(999);
  });

  it("persists across reads (localStorage round-trip)", () => {
    const rec = saveUserPreset("Persisted", style, ["#abc"]);
    expect(findUserPreset(rec.id)?.name).toBe("Persisted"); // fresh read parses storage
  });
});

describe("profile default (built-in | custom | none) with back-compat", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the house preset when never set", () => {
    expect(getProfileDefault()).toEqual({ kind: "builtin", name: "MadY default" });
  });

  it("round-trips a custom (user) default and an explicit None", () => {
    setProfileDefault({ kind: "user", id: "up_1" });
    expect(getProfileDefault()).toEqual({ kind: "user", id: "up_1" });
    setProfileDefault(null);
    expect(getProfileDefault()).toBeNull(); // explicit opt-out, not the house default
  });

  it("reads the legacy bare-name format as a built-in reference", () => {
    localStorage.setItem("mady.profile.presetName", "Nature"); // old format
    expect(getProfileDefault()).toEqual({ kind: "builtin", name: "Nature" });
  });
});

/**
 * A preset's per-type sections (`kinds`): a bar's own settings saved from a bar chart, a pie's
 * from a pie, in the same named preset. Saving by an existing name replaces the shared look and
 * merges the sections, so extending a preset from a second graph type never throws away the
 * first. A preset with no sections round-trips untouched.
 */
describe("userPresets — per-type sections", () => {
  beforeEach(() => localStorage.clear());

  it("saving by an existing name keeps the sections of the other types", () => {
    const first = saveUserPreset("Lab", style, ["#111"], undefined, { bar: { barWidth: 0.9 } });
    const again = saveUserPreset("Lab", { figureWidth: 700 }, ["#222"], undefined, { pie: { pieDonut: 0.5 } });
    expect(again.id).toBe(first.id);
    expect(again.style).toEqual({ figureWidth: 700 }); // the shared look is replaced
    expect(again.kinds).toEqual({ bar: { barWidth: 0.9 }, pie: { pieDonut: 0.5 } }); // the sections merge
    expect(findUserPreset(first.id)?.kinds?.bar?.barWidth).toBe(0.9);
  });

  it("saving the same type again replaces only that type's section", () => {
    saveUserPreset("Lab", style, [], undefined, { bar: { barWidth: 0.9, barShape: "rounded" }, pie: { pieDonut: 0.5 } });
    const again = saveUserPreset("Lab", style, [], undefined, { bar: { barWidth: 0.3 } });
    expect(again.kinds).toEqual({ bar: { barWidth: 0.3 }, pie: { pieDonut: 0.5 } });
  });

  it("a save without sections writes no `kinds` key, and an old record round-trips untouched", () => {
    const rec = saveUserPreset("Plain", style, ["#111"]);
    expect("kinds" in rec).toBe(false);
    expect("kinds" in findUserPreset(rec.id)!).toBe(false);
    localStorage.setItem("mady.userPresets.v1", JSON.stringify([{ id: "up_old", name: "Old", style, palette: [], createdAt: 1 }]));
    expect(findUserPreset("up_old")).toEqual({ id: "up_old", name: "Old", style, palette: [], createdAt: 1 });
  });

  it("setUserPresetKind writes one type's section and nothing else", () => {
    const rec = saveUserPreset("Lab", style, ["#111"], ["square"], { bar: { barWidth: 0.9 } });
    setUserPresetKind(rec.id, "pie", { pieDonut: 0.4 });
    const after = findUserPreset(rec.id)!;
    expect(after.kinds).toEqual({ bar: { barWidth: 0.9 }, pie: { pieDonut: 0.4 } });
    expect(after.style).toEqual(style);
    expect(after.palette).toEqual(["#111"]);
    expect(after.shapes).toEqual(["square"]);
    expect(after.createdAt).toBe(rec.createdAt); // not re-dated: the list order is unchanged
    expect(() => setUserPresetKind("up_missing", "pie", { pieDonut: 0.4 })).toThrow(/no preset/);
  });

  it("insertUserPreset adds a whole record and refuses at the cap instead of evicting", () => {
    for (let i = 0; i < MAX_USER_PRESETS; i++) saveUserPreset(`P${i}`, style, []); // the cap itself, whatever it is
    const ids = listUserPresets().map((p) => p.id);
    const r = insertUserPreset({ id: "up_x", name: "Extra", style, palette: [], createdAt: 5 });
    expect(r.ok).toBe(false);
    expect(listUserPresets().map((p) => p.id)).toEqual(ids); // nothing evicted, nothing added
    deleteUserPreset(ids[0]!);
    const r2 = insertUserPreset({ id: "up_x", name: "Extra", style, palette: [], createdAt: 5 });
    expect(r2.ok).toBe(true);
    expect(findUserPreset("up_x")?.name).toBe("Extra");
  });
});

describe("userPresets — management (rename in place, duplicate, drop a type, order)", () => {
  beforeEach(() => localStorage.clear());

  it("duplicate: a fresh id, a “… copy” name that never clashes, the same sections, placed right after the original", () => {
    const a = saveUserPreset("Lab", style, ["#111"], undefined, { bar: { barWidth: 0.9 } });
    saveUserPreset("Other", {}, []);
    const r1 = duplicateUserPreset(a.id);
    const r2 = duplicateUserPreset(a.id);
    if (!r1.ok || !r2.ok) throw new Error("refused");
    expect(r1.preset.id).not.toBe(a.id);
    expect([r1.preset.name, r2.preset.name]).toEqual(["Lab copy", "Lab copy 2"]);
    expect(r1.preset.kinds).toEqual({ bar: { barWidth: 0.9 } });
    expect(r1.preset.style).toEqual(style);
    // The copy sits after its original; the original keeps its place.
    expect(listUserPresets().map((p) => p.name)).toEqual(["Other", "Lab", "Lab copy 2", "Lab copy"]);
    expect(() => duplicateUserPreset("nope")).toThrow(/no preset/);
  });

  it("duplicate refuses at the cap instead of evicting", () => {
    for (let i = 0; i < MAX_USER_PRESETS; i++) saveUserPreset(`P${i}`, {}, []);
    expect(listUserPresets()).toHaveLength(MAX_USER_PRESETS);
    const r = duplicateUserPreset(listUserPresets()[0]!.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/full/);
    expect(listUserPresets()).toHaveLength(MAX_USER_PRESETS);
  });

  it("the cap is 60", () => {
    expect(MAX_USER_PRESETS).toBe(60);
  });

  it("removeUserPresetKind drops one type's section and nothing else; refuses out loud otherwise", () => {
    const a = saveUserPreset("Lab", style, ["#111"], undefined, { bar: { barWidth: 0.9 }, pie: { pieDonut: 0.4 } });
    const next = removeUserPresetKind(a.id, "bar");
    expect(next.kinds).toEqual({ pie: { pieDonut: 0.4 } });
    expect(next.style).toEqual(style);
    expect(findUserPreset(a.id)?.kinds).toEqual({ pie: { pieDonut: 0.4 } });
    const last = removeUserPresetKind(a.id, "pie");
    expect("kinds" in last).toBe(false); // no empty `kinds` key left behind
    expect(() => removeUserPresetKind(a.id, "pie")).toThrow(/no pie section/);
    expect(() => removeUserPresetKind("nope", "pie")).toThrow(/no preset/);
  });

  it("reorder: the named order is kept across reads; a later save joins the end; an unknown id throws", () => {
    const a = saveUserPreset("A", {}, []);
    const b = saveUserPreset("B", {}, []);
    const c = saveUserPreset("C", {}, []);
    expect(listUserPresets().map((p) => p.name)).toEqual(["C", "B", "A"]); // newest first until ordered
    reorderUserPresets([a.id, c.id, b.id]);
    expect(listUserPresets().map((p) => p.name)).toEqual(["A", "C", "B"]);
    saveUserPreset("D", {}, []);
    expect(listUserPresets().map((p) => p.name)).toEqual(["A", "C", "B", "D"]);
    // Overwriting an ordered preset by name keeps its slot.
    saveUserPreset("C", { figureWidth: 1 }, []);
    expect(listUserPresets().map((p) => p.name)).toEqual(["A", "C", "B", "D"]);
    expect(() => reorderUserPresets([a.id, "nope"])).toThrow(/no preset/);
  });
});
