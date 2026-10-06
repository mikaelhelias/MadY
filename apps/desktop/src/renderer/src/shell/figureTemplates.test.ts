// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FigureLayout } from "@mady/core";
import {
  captureFigureTemplate,
  deleteFigureTemplate,
  FIGURE_TEMPLATE_KEYS,
  listFigureTemplates,
  saveFigureTemplate,
} from "./figureTemplates";

const layout = (over: Partial<FigureLayout> = {}): FigureLayout =>
  ({
    id: "L",
    name: "Figure 1",
    panels: ["plt_1", "plt_2"],
    columns: 2,
    gutter: 24,
    lettering: "lower",
    letterSize: 9,
    sharedAxisLabels: true,
    ...over,
  }) as FigureLayout;

beforeEach(() => globalThis.localStorage?.clear());
afterEach(() => globalThis.localStorage?.clear());

describe("captureFigureTemplate — what travels and what must not", () => {
  it("captures the arrangement", () => {
    const t = captureFigureTemplate(layout());
    expect(t.columns).toBe(2);
    expect(t.gutter).toBe(24);
    expect(t.lettering).toBe("lower");
    expect(t.letterSize).toBe(9);
    expect(t.sharedAxisLabels).toBe(true);
  });

  // The whole point of a template is that it is portable. Anything identifying this figure,
  // or keyed by plot id, would be meaningless (or destructive) applied to another one.
  it("never captures which graphs are in the figure", () => {
    const t = captureFigureTemplate(layout());
    expect(t).not.toHaveProperty("panels");
    expect(t).not.toHaveProperty("panelSource");
    expect(t).not.toHaveProperty("id");
    expect(t).not.toHaveProperty("name");
  });

  it("never captures anything keyed by plot id", () => {
    const t = captureFigureTemplate(
      layout({
        panelPositions: { plt_1: { x: 10, y: 20 } },
        panelSizes: { plt_1: { w: 300, h: 200 } },
        labelPos: { plt_1: { x: 4, y: 4 } },
        letterText: { plt_1: "S1" },
        panelSpan: { plt_1: 2 },
      }),
    );
    for (const k of ["panelPositions", "panelSizes", "labelPos", "letterText", "panelSpan"]) {
      expect(t, k).not.toHaveProperty(k);
    }
  });

  it("never captures the editing aids or the link state", () => {
    const t = captureFigureTemplate(layout({ showGrid: true, showRuler: true, showPanelNames: true, linked: false }));
    // guides are workspace aids, absent from the export; `linked` would detach + clone panels
    for (const k of ["showGrid", "showRuler", "showPanelNames", "linked"]) {
      expect(t, k).not.toHaveProperty(k);
    }
  });

  it("records defaults explicitly, so applying a template can turn options off", () => {
    // a template saved from a plain figure must be able to reset a figure that had extras on
    const plain = captureFigureTemplate(layout({ columns: 2, gutter: undefined, sharedAxisLabels: undefined }));
    expect("gutter" in plain).toBe(true);
    expect(plain.gutter).toBeUndefined();
    expect("sharedAxisLabels" in plain).toBe(true);
    expect(plain.sharedAxisLabels).toBeUndefined();
  });

  it("deep-copies, so editing the figure afterwards cannot mutate a saved template", () => {
    const l = layout();
    const t = captureFigureTemplate(l);
    l.lettering = "numeric";
    expect(t.lettering).toBe("lower");
  });

  it("the key list holds only portable fields", () => {
    for (const banned of ["panels", "panelPositions", "panelSizes", "labelPos", "letterText", "panelSpan", "id", "name", "linked", "guides", "snapToGrid"]) {
      expect(FIGURE_TEMPLATE_KEYS, banned).not.toContain(banned);
    }
  });
});

describe("figure template store", () => {
  it("saves, lists newest-first, and round-trips", () => {
    saveFigureTemplate("Lab standard", captureFigureTemplate(layout()));
    saveFigureTemplate("Two column", captureFigureTemplate(layout({ columns: 3 })));
    const all = listFigureTemplates();
    expect(all.map((t) => t.name)).toEqual(["Two column", "Lab standard"]);
    expect(all[1]!.layout.columns).toBe(2);
    expect(all[0]!.layout.columns).toBe(3);
  });

  it("overwrites by name instead of duplicating", () => {
    saveFigureTemplate("House", captureFigureTemplate(layout({ columns: 2 })));
    saveFigureTemplate("House", captureFigureTemplate(layout({ columns: 4 })));
    const all = listFigureTemplates();
    expect(all).toHaveLength(1);
    expect(all[0]!.layout.columns).toBe(4);
  });

  it("trims the name and ignores a blank one", () => {
    saveFigureTemplate("  Padded  ", captureFigureTemplate(layout()));
    saveFigureTemplate("   ", captureFigureTemplate(layout()));
    expect(listFigureTemplates().map((t) => t.name)).toEqual(["Padded"]);
  });

  it("caps the list, dropping the oldest", () => {
    for (let i = 0; i < 10; i++) saveFigureTemplate(`T${i}`, captureFigureTemplate(layout()));
    const all = listFigureTemplates();
    expect(all).toHaveLength(8);
    expect(all[0]!.name).toBe("T9"); // newest kept
    expect(all.map((t) => t.name)).not.toContain("T0"); // oldest dropped
  });

  it("deletes by name", () => {
    saveFigureTemplate("A", captureFigureTemplate(layout()));
    saveFigureTemplate("B", captureFigureTemplate(layout()));
    deleteFigureTemplate("A");
    expect(listFigureTemplates().map((t) => t.name)).toEqual(["B"]);
  });

  it("survives a corrupt store rather than breaking the assembler", () => {
    globalThis.localStorage.setItem("mady.figureTemplates.v1", "{not json");
    expect(listFigureTemplates()).toEqual([]);
    globalThis.localStorage.setItem("mady.figureTemplates.v1", '{"nope":1}');
    expect(listFigureTemplates()).toEqual([]);
    globalThis.localStorage.setItem("mady.figureTemplates.v1", '[null,{"name":"ok","layout":{}}]');
    expect(listFigureTemplates().map((t) => t.name)).toEqual(["ok"]);
  });
});

describe("reset semantics survive the store", () => {
  // JSON.stringify drops undefined, so the "this option was at its default" markers do not
  // survive being saved. figureTemplatePatch rebuilds them, which is what lets a plain house
  // style turn off options the target figure had on.
  it("a saved plain template still yields an explicit undefined for every option", async () => {
    const { figureTemplatePatch } = await import("./figureTemplates");
    saveFigureTemplate("Plain", captureFigureTemplate(layout({ gutter: undefined, sharedAxisLabels: undefined, alignX: undefined })));
    const stored = listFigureTemplates()[0]!;
    // the raw stored object has lost them — this is the trap being guarded
    expect("sharedAxisLabels" in stored.layout).toBe(false);
    // …and the patch puts them back
    const patch = figureTemplatePatch(stored);
    for (const k of ["gutter", "sharedAxisLabels", "alignX"] as const) {
      expect(k in patch, k).toBe(true);
      expect(patch[k], k).toBeUndefined();
    }
    expect(patch.columns).toBe(2); // real values still carried
  });
});
