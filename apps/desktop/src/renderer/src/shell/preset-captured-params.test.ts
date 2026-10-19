/**
 * Preset parameters captured on definition — tick length, tick width, and the two axis-title gaps.
 *
 * These are captured whenever a preset is saved, without changing the current default or the
 * built-in presets.
 *
 * Two halves, and the second is the one that is easy to get wrong:
 *   • a preset that defines one of these must land it on the graph;
 *   • a preset that does not must leave the graph's own value alone — not clear it.
 *
 * The marker fields in `applyStylePreset` are written unconditionally on purpose (so switching
 * presets cannot leave the previous one's halo behind). Of the built-ins, only Universal design
 * sets any of these four (it sets tick length, tick width and title gap), so copying that pattern would
 * push `undefined` over a hand-set tick length whenever any other preset is applied. The "unset"
 * tests below catch that.
 *
 * Note: `preset-invariance.test.ts` is the companion: it hashes every built-in × every gallery card
 * against a recorded drawing, so a built-in that starts setting these fields shows up there.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS, findPreset } from "@mady/core";
import type { DataTable, Plot, Project, StylePreset } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { KIND_STYLE_KEYS, PRESET_EXCLUDED } from "./presetKeys";
import { SHARED_KEYS, capturePlotStyle } from "./templates";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 520, height: 360 };

const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [
    { id: "x", name: "Dose", role: "x", type: "number" },
    { id: "a", name: "Drug A", role: "y", type: "number" },
    { id: "b", name: "Drug B", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2 + 1, b: i * 1.4 } })),
};

/** A plot carrying the user's own hand-set axis look, to prove a preset does not wipe it. */
const handSet = (): Plot => ({
  id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  tickLen: 14,
  xAxis: { tickWidth: 3, titleGap: 21, tickLabelGap: 17 },
  yAxis: { tickWidth: 3, titleGap: 21, tickLabelGap: 17 },
} as unknown as Plot);

function apply(plot: Plot, preset: StylePreset): Plot {
  const p = JSON.parse(JSON.stringify(plot)) as Plot;
  const project: Project = { schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  doc.applyStylePreset(p.id, preset);
  return doc.toJSON().plots[0]!;
}

const house = (): StylePreset => findPreset("MadY default")!;
/** The house preset plus the four captured parameters — the shape a user-saved preset can have.
 *  Nothing in `STYLE_PRESETS` looks like this, by design. */
const withParams = (): StylePreset => ({ ...house(), name: "test", tickLen: 9, tickWidth: 2.5, titleGap: 13, tickLabelGap: 11 });

describe("a preset that defines the captured parameters lands them", () => {
  it("writes the tick length, tick width and both gaps onto the graph", () => {
    const out = apply(handSet(), withParams());
    expect(out.tickLen).toBe(9);
    for (const ax of [out.xAxis, out.yAxis]) {
      expect(ax?.tickWidth).toBe(2.5);
      expect(ax?.titleGap).toBe(13);
      expect(ax?.tickLabelGap).toBe(11);
    }
  });

  it("and the tick length + width reach the drawing, not just the plot", () => {
    const out = apply(handSet(), withParams());
    const s = buildPlotScene(table, out, { measure, ...SIZE });
    // `axisStyle.tickLen` is the plot-wide value the renderer falls back to; `x.tickWidth` is the
    // per-axis thickness it strokes the tick with.
    expect(s.axisStyle.tickLen).toBe(9);
    expect(s.x.tickWidth).toBe(2.5);
  });

  it("undo puts the graph's own values back", () => {
    const p = handSet();
    const project: Project = { schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const doc = new MadyDocument(project);
    doc.applyStylePreset(p.id, withParams());
    expect(doc.toJSON().plots[0]!.tickLen).toBe(9);
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.tickLen, "undo did not restore the tick length").toBe(14);
    expect(doc.toJSON().plots[0]!.xAxis?.titleGap).toBe(21);
  });
});

describe("a preset that does not define them leaves the graph's own alone", () => {
  it("keeps a hand-set tick length, tick width and gaps through a preset apply", () => {
    const out = apply(handSet(), house());
    expect(out.tickLen, "the preset cleared the user's tick length").toBe(14);
    for (const ax of [out.xAxis, out.yAxis]) {
      expect(ax?.tickWidth, "the preset cleared the user's tick thickness").toBe(3);
      expect(ax?.titleGap).toBe(21);
      expect(ax?.tickLabelGap).toBe(17);
    }
  });

  /** The rule, as a test: no built-in may carry one of these, with one exception. */
  /**
   * A built-in may carry one of these only by deliberate choice. "Universal design" is the
   * sole exception: it sets these parameters, and its rows in
   * `preset-invariance.fixtures.json` are recorded with them. Any other name
   * appearing here is a preset changing unnoticed.
   */
  it("only the Universal design preset defines any of them", () => {
    const offenders: string[] = [];
    for (const p of STYLE_PRESETS) {
      if (p.name === "Universal design") continue;
      for (const k of ["tickLen", "tickWidth", "titleGap", "tickLabelGap", "symbolOpacity", "sliceLabelSize", "valueLabelSize"] as const) {
        if (p[k] !== undefined) offenders.push(`${p.name}.${k} = ${String(p[k])}`);
      }
    }
    expect(offenders, `only "Universal design" may set the captured parameters:\n  - ${offenders.join("\n  - ")}\n`).toEqual([]);
  });
});

/**
 * Slice / value label sizes — two text elements a preset can set (13 px on every kind by
 * default; otherwise only a hand edit in the font picker moves them). Same conditional rule as the axis
 * parameters: a preset that defines them writes them, one that does not writes nothing.
 */
describe("slice / value label sizes are reachable from a preset", () => {
  const withLabels = (): StylePreset => ({ ...house(), name: "test", sliceLabelSize: 19, valueLabelSize: 17 });
  const pie: DataTable = {
    id: "pie", kind: "partsofwhole", name: "pie",
    columns: [{ id: "k", name: "Kind", type: "text" }, { id: "v", name: "Share", type: "number" }],
    rows: ([["A", 3], ["B", 2], ["C", 1]] as const).map(([k, v], i) => ({ id: `r${i}`, cells: { k, v } })),
  };
  const piePlot = (): Plot => ({ id: "pp", name: "pp", source: "pie", status: "ok", styleOverrides: {}, kind: "pie" } as unknown as Plot);

  it("a preset that defines them writes both fonts onto the graph", () => {
    const out = apply(handSet(), withLabels());
    expect(out.fonts?.sliceLabel?.size).toBe(19);
    expect(out.fonts?.valueLabel?.size).toBe(17);
  });

  it("…and they reach the drawing — a pie's slice labels and a bar's value labels", () => {
    const p = JSON.parse(JSON.stringify(piePlot())) as Plot;
    const project: Project = { schemaVersion: 4, tables: [pie], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const doc = new MadyDocument(project);
    doc.applyStylePreset(p.id, withLabels());
    const s = buildPlotScene(pie, doc.toJSON().plots[0]!, { measure, ...SIZE });
    expect(s.fonts.sliceLabel.size).toBe(19);
    expect(s.fonts.valueLabel.size).toBe(17);
  });

  it("a preset that does not define them writes neither, so the house size stands", () => {
    const out = apply(handSet(), house());
    expect(out.fonts?.sliceLabel).toBeUndefined();
    expect(out.fonts?.valueLabel).toBeUndefined();
    const s = buildPlotScene(table, out, { measure, ...SIZE });
    const bare = buildPlotScene(table, handSet(), { measure, ...SIZE });
    expect(s.fonts.sliceLabel.size).toBe(bare.fonts.sliceLabel.size);
    expect(s.fonts.valueLabel.size).toBe(bare.fonts.valueLabel.size);
  });
});

/**
 * The second and third Y axes are captured with the first. Guards against `y2Axis`/`y3Axis`
 * (both on `Plot`) missing from the capture key sets, which would make a dual-axis graph save its
 * look and silently lose the second axis's tick length, thickness, spacing and number format.
 */
describe("saving a graph's look captures every axis it has", () => {
  const dual = (): Plot => ({
    ...handSet(),
    y2Axis: { tickWidth: 4, titleGap: 25, title: "Second" },
    y3Axis: { tickLen: 8 },
  } as unknown as Plot);

  it("lists y2Axis and y3Axis in the shared set, and in neither of the other preset tables", () => {
    for (const k of ["y2Axis", "y3Axis"] as const) {
      expect(SHARED_KEYS).toContain(k);
      expect(k in KIND_STYLE_KEYS, `${k} must be shared, not a type's own`).toBe(false);
      expect(k in PRESET_EXCLUDED, `${k} must be shared, not excluded`).toBe(false);
    }
  });

  it("carries them into a saved preset", () => {
    const captured = capturePlotStyle(dual(), SHARED_KEYS);
    expect(captured.y2Axis?.tickWidth, "the 2nd Y axis was dropped when the look was saved").toBe(4);
    expect(captured.y2Axis?.titleGap).toBe(25);
    expect(captured.y3Axis?.tickLen).toBe(8);
  });

  it("and skips them on a graph that has none, rather than writing empties", () => {
    const captured = capturePlotStyle(handSet(), SHARED_KEYS);
    expect("y2Axis" in captured, "a single-axis graph saved an empty 2nd axis").toBe(false);
    expect("y3Axis" in captured).toBe(false);
  });
  /** …and it really does carry them, or the exception above is protecting nothing. */
  it("and Universal design carries them, so the exception is not vacuous", () => {
    const ud = findPreset("Universal design")!;
    expect([ud.tickLen, ud.tickWidth, ud.titleGap, ud.symbolOpacity].every((v) => v !== undefined)).toBe(true);
  });
});
