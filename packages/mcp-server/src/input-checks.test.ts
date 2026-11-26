/**
 * The edit tools say so when an edit cannot land. An unknown option, a value outside the options a setting takes, a series
 * that is not on the graph and a chart kind that does not exist are never accepted ("ok") while changing nothing (an axis
 * scale of "log" drawing a linear axis, a legend position of "bottom" leaving the legend in place, a graph of an unknown
 * kind created). Each is refused in words that name the problem and the choices, and nothing is changed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogKinds, describeOptions } from "./optionCatalog";
import { ANALYSIS_PARAM_FIELDS, ANNOTATION_COLOUR_FIELDS, ANNOTATION_FIELDS, ANNOTATION_KINDS, COLOUR_OPTIONS, ENUM_VALUES, KIND_ONLY_FIELDS, checkAnnotationFields, checkOptionPatch, isCssColor } from "./inputCheck";
import { MadySession } from "./session";
import { buildTools } from "./tools";

const setup = async () => {
  const session = new MadySession();
  const tools = buildTools(session);
  const call = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args) as Promise<{ ok: boolean; error?: string; value?: { id: string }; code?: string }>;
  const t = await call("create_table", { name: "T", kind: "xy", columns: ["x", "y"], rows: [[1, 2], [2, 4], [3, 9]] });
  const g = await call("create_graph", { name: "g", table: t.value!.id, kind: "xy" });
  const plot = () => session.document.toJSON().plots.find((p) => p.id === g.value!.id)!;
  return { session, call, gid: g.value!.id, tid: t.value!.id, plot, colId: session.document.toJSON().tables[0]!.columns[1]!.id };
};
const refused = (r: { ok: boolean; error?: string }, ...words: RegExp[]) => {
  expect(r.ok, "the edit was accepted").toBe(false);
  for (const w of words) expect(r.error ?? "").toMatch(w);
};

describe("chart kinds", () => {
  it("create_graph and set_graph_kind refuse a kind that does not exist, naming the real ones", async () => {
    const { call, gid, session } = await setup();
    const before = session.document.toJSON().plots.length;
    refused(await call("create_graph", { name: "z", table: session.document.toJSON().tables[0]!.id, kind: "nonsense" }), /nonsense/, /bar/);
    expect(session.document.toJSON().plots.length, "a refused graph was created").toBe(before);
    refused(await call("set_graph_kind", { id: gid, kind: "nonsense" }), /nonsense/);
    expect((await call("set_graph_kind", { id: gid, kind: "bar" })).ok).toBe(true);
  });
});

describe("axis", () => {
  it("a scale of 'log' is refused with the real scales; 'log10' is accepted and lands", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("set_axis", { id: gid, axis: "x", patch: { scale: "log" } }), /scale/, /log10/);
    expect(plot().xAxis?.scale, "a refused value was stored").toBeUndefined();
    expect((await call("set_axis", { id: gid, axis: "x", patch: { scale: "log10" } })).ok).toBe(true);
    expect(plot().xAxis?.scale).toBe("log10");
  });

  it("an option the axis does not have is refused, with the nearest real one", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("set_axis", { id: gid, axis: "y", patch: { tickSpacing: 1 } }), /tickSpacing/, /majorStep/);
    expect(plot().yAxis?.["tickSpacing" as never]).toBeUndefined();
  });

  it("every value in one patch is checked and every problem is reported, none applied", async () => {
    const { call, gid, plot } = await setup();
    const r = await call("set_axis", { id: gid, axis: "y", patch: { title: "fine", scale: "log", bogus: 1 } });
    refused(r, /scale/, /bogus/);
    expect(plot().yAxis?.title, "part of a refused patch was applied").toBeUndefined();
  });
});

describe("legend, grid, frame, font", () => {
  it("legend position 'bottom' is refused and the real positions are listed", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("set_legend", { id: gid, patch: { position: "bottom" } }), /position/, /bottomright/);
    expect(plot().legend?.position).toBeUndefined();
    expect((await call("set_legend", { id: gid, patch: { position: "bottomright" } })).ok).toBe(true);
  });

  it("a legend option that does not exist is refused", async () => {
    const { call, gid } = await setup();
    refused(await call("set_legend", { id: gid, patch: { nothere: true } }), /nothere/);
  });

  it("grid dash and frame values are checked", async () => {
    const { call, gid } = await setup();
    refused(await call("set_grid", { id: gid, patch: { dash: "wavy" } }), /dash/, /dotted/);
    expect((await call("set_grid", { id: gid, patch: { dash: "dotted", show: true } })).ok).toBe(true);
    refused(await call("set_frame", { id: gid, patch: { frame: "circle" } }), /frame/, /lshape/);
    refused(await call("set_frame", { id: gid, patch: { tickLength: 4 } }), /tickLength/, /tickLen/);
    expect((await call("set_frame", { id: gid, patch: { frame: "box", tickDir: "in", tickLen: 6 } })).ok).toBe(true);
  });

  it("a font patch takes size, family, bold, italic and colour only", async () => {
    const { call, gid } = await setup();
    refused(await call("set_font", { id: gid, element: "title", patch: { fontSize: 20 } }), /fontSize/, /size/);
    refused(await call("set_font", { id: gid, element: "title", patch: { color: "notacolour" } }), /colou?r/);
    expect((await call("set_font", { id: gid, element: "title", patch: { size: 20, bold: true, color: "#112233" } })).ok).toBe(true);
  });
});

describe("graph options", () => {
  it("an option no chart has is refused, with the nearest real one and a pointer to describe_options", async () => {
    const { call, gid } = await setup();
    refused(await call("set_graph_options", { id: gid, patch: { bogusOption: 1 } }), /bogusOption/, /describe_options/);
    refused(await call("set_graph_options", { id: gid, patch: { showTitel: false } }), /showTitel/, /showTitle/);
  });

  it("a nested option is checked at its own level", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("set_graph_options", { id: gid, patch: { legend: { position: "bottom" } } }), /legend\.position/);
    refused(await call("set_graph_options", { id: gid, patch: { legend: { nothere: 1 } } }), /legend\.nothere/);
    expect((await call("set_graph_options", { id: gid, patch: { legend: { position: "top" }, title: "ok" } })).ok).toBe(true);
    expect(plot().title).toBe("ok");
  });

  it("a kind in the patch is checked like any kind", async () => {
    const { call, gid } = await setup();
    refused(await call("set_graph_options", { id: gid, patch: { kind: "nonsense" } }), /nonsense/);
  });

  it("every example the catalogue gives is accepted: nothing documented is refused", () => {
    const refusals: string[] = [];
    let checked = 0;
    for (const kind of catalogKinds()) {
      for (const o of describeOptions({ kind }).options) {
        // Build the nested patch the example stands for: "a.b.c" with value v is { a: { b: { c: v } } }.
        const patch: Record<string, unknown> = {};
        let at = patch;
        const parts = o.option.split(".");
        // A per-series option sits under a series id, as a real patch writes it.
        if (parts[0] === "seriesStyles" || parts[0] === "pointStyles") parts.splice(1, 0, "col_1");
        parts.slice(0, -1).forEach((p) => { at = (at[p] = {}) as Record<string, unknown>; });
        at[parts[parts.length - 1]!] = o.example;
        const problems = checkOptionPatch(patch);
        checked++;
        if (problems.length) refusals.push(`${kind}: ${o.option} = ${JSON.stringify(o.example)} -> ${problems.join("; ")}`);
      }
    }
    expect(checked, "no examples were checked").toBeGreaterThan(500);
    expect(refusals.slice(0, 20), `${refusals.length} documented examples refused`).toEqual([]);
  });
});

describe("series style", () => {
  it("a series that is not on the graph is refused, naming the ones that are", async () => {
    const { call, gid, colId } = await setup();
    refused(await call("set_series_style", { id: gid, series: "col_999", style: { color: "#ff0000" } }), /col_999/, new RegExp(colId));
    expect((await call("set_series_style", { id: gid, series: colId, style: { color: "#ff0000" } })).ok).toBe(true);
  });

  it("a colour that is not a colour is refused; hex, rgb() and names are accepted", async () => {
    const { call, gid, colId } = await setup();
    refused(await call("set_series_style", { id: gid, series: colId, style: { color: "notacolour" } }), /color/);
    for (const c of ["#e63946", "#fff", "rgb(10, 20, 30)", "steelblue"]) {
      expect((await call("set_series_style", { id: gid, series: colId, style: { color: c } })).ok, c).toBe(true);
    }
  });

  it("a style option that does not exist, or a value outside its choices, is refused", async () => {
    const { call, gid, colId } = await setup();
    refused(await call("set_series_style", { id: gid, series: colId, style: { markerSize: 8 } }), /markerSize/, /symbolSize/);
    refused(await call("set_series_style", { id: gid, series: colId, style: { symbol: "blob" } }), /symbol/, /circle/);
    refused(await call("set_series_style", { id: gid, series: colId, style: { plotAs: "bar" } }), /plotAs/, /bars/);
    expect((await call("set_series_style", { id: gid, series: colId, style: { symbol: "square", plotAs: "bars", lineWidth: 2 } })).ok).toBe(true);
  });

  it("a synthetic series id (a curve, a summary) is not refused before it exists", async () => {
    const { call, gid } = await setup();
    expect((await call("set_series_style", { id: gid, series: "roc-0", style: { color: "#112233" } })).ok).toBe(true);
  });
});

describe("the same checks guard the batch and the live window", () => {
  it("a batch with a bad value is refused before any of it runs", async () => {
    const { session, gid, plot } = await setup();
    const r = session.execBatch([{ op: "setAxis", id: gid, axis: "y", patch: { title: "A" } }, { op: "setLegend", id: gid, patch: { position: "bottom" } }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Command 2 of 2.*position/) });
    expect(plot().yAxis?.title, "the first command of a refused batch ran").toBeUndefined();
  });

  it("live_execute refuses before it reaches for a window", async () => {
    const { call, gid } = await setup();
    const r = await call("live_execute", { command: { op: "setLegend", id: gid, patch: { position: "bottom" } } });
    refused(r, /position/);
  });
});

describe("annotations", () => {
  const anns = (plot: () => { annotations?: unknown[] | undefined }) => plot().annotations ?? [];

  it("a vband given a bracket's from/to is refused, naming bandLo and bandHi; nothing is added", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("add_annotation", { id: gid, annotation: { kind: "vband", from: 1.5, to: 2.5 } }), /'from'/, /'to'/, /bracket/, /bandLo/, /bandHi/);
    expect(anns(plot), "a refused annotation was added").toEqual([]);
  });

  it("a text given 'text' for its words is refused, naming 'label'", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("add_annotation", { id: gid, annotation: { kind: "text", text: "hello" } }), /'text'/, /'label'/);
    expect(anns(plot)).toEqual([]);
  });

  it("a field no annotation has is refused with the closest real ones", async () => {
    const { call, gid } = await setup();
    refused(await call("add_annotation", { id: gid, annotation: { kind: "hline", value: 3, labelColour: "red" } }), /labelColour/, /Closest/, /color/);
  });

  it("a kind that does not exist is refused, naming the kinds", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("add_annotation", { id: gid, annotation: { kind: "circle", x: 0.5, y: 0.5 } }), /circle/, /ellipse/);
    expect(anns(plot)).toEqual([]);
  });

  it("what places each kind is accepted and lands", async () => {
    const { call, gid, plot } = await setup();
    const good = [
      { kind: "vband", bandLo: 1.5, bandHi: 2.5, label: "zone" },
      { kind: "vband", x: 0.2, w: 0.3 },
      { kind: "hband", bandLo: 2, bandHi: 4 },
      { kind: "hline", value: 3, label: "ref" },
      { kind: "vline", value: 2 },
      { kind: "text", label: "hello", x: 0.5, y: 0.2, size: 14, bold: true },
      { kind: "callout", label: "peak", x: 0.3, y: 0.3, x2: 0.6, y2: 0.6, arrowHead: "end" },
      { kind: "bracket", from: 1, to: 2, bracketY: 8, label: "*" },
      { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2, fill: "#eeeeee" },
      { kind: "arrow", x: 0.1, y: 0.1, x2: 0.4, y2: 0.4 },
      { kind: "image", href: "data:image/png;base64,AAAA", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    ];
    for (const a of good) expect((await call("add_annotation", { id: gid, annotation: a })).ok, JSON.stringify(a)).toBe(true);
    expect(anns(plot)).toHaveLength(good.length);
  });

  it("update_annotation checks the patch against the annotation's own kind, and refuses a change of kind", async () => {
    const { call, gid, plot } = await setup();
    const added = (await call("add_annotation", { id: gid, annotation: { kind: "vband", bandLo: 1, bandHi: 2 } })) as unknown as { ok: boolean; value: { annotation: string } };
    const ann = added.value.annotation;
    refused(await call("update_annotation", { id: gid, annotation: ann, patch: { from: 1.2 } }), /'from'/, /vband/, /bandLo/);
    refused(await call("update_annotation", { id: gid, annotation: ann, patch: { kind: "hband" } }), /kind/, /cannot be changed/);
    expect(plot().annotations?.[0]).toMatchObject({ kind: "vband", bandLo: 1, bandHi: 2 });
    expect((await call("update_annotation", { id: gid, annotation: ann, patch: { bandLo: 1.2, label: "zone" } })).ok).toBe(true);
    expect(plot().annotations?.[0]).toMatchObject({ bandLo: 1.2, label: "zone" });
  });

  it("a batch with a misnamed annotation field is refused before any of it runs", async () => {
    const { session, gid, plot } = await setup();
    const r = session.execBatch([{ op: "setAxis", id: gid, axis: "y", patch: { title: "A" } }, { op: "addAnnotation", id: gid, annotation: { kind: "text", text: "x" } }]);
    expect(r[0]).toMatchObject({ ok: false, error: expect.stringMatching(/Command 2 of 2.*'text'.*'label'/) });
    expect(plot().yAxis?.title).toBeUndefined();
  });
});

describe("analysis settings", () => {
  it("run_analysis refuses a setting no analysis has, naming the closest real one; nothing is added", async () => {
    const { call, session, tid, colId } = await setup();
    refused(await call("run_analysis", { name: "AUC", method: "auc", table: tid, params: { columns: [colId], nonsenseSetting: 7, baseline: 2 } }), /nonsenseSetting/, /'baseline'/, /baselineValue/);
    expect(session.document.toJSON().analyses, "a refused analysis was added").toEqual([]);
  });

  it("compute_analysis refuses an unknown setting before it reaches the engine", async () => {
    const { call, tid, colId } = await setup();
    refused(await call("compute_analysis", { method: "auc", table: tid, params: { columns: [colId], baseline: 2 } }), /'baseline'/, /baselineValue/);
  });

  it("real settings are accepted", async () => {
    const { call, tid, colId } = await setup();
    expect((await call("run_analysis", { name: "AUC", method: "auc", table: tid, params: { columns: [colId], variant: "custom", baselineValue: 2 } })).ok).toBe(true);
  });
});

describe("the enumerations match the model they were copied from", () => {
  const model = readFileSync(new URL("../../core/src/model.ts", import.meta.url), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const members = (name: string): string[] => {
    const i = model.indexOf(`export type ${name} =`);
    const j = model.indexOf("\nexport ", i + 10);
    return [...strip(model.slice(i, j)).matchAll(/"([A-Za-z0-9_-]+)"/g)].map((m) => m[1]!);
  };
  const inline = (field: string): string[] => {
    const m = new RegExp(`^  ${field}\\?: ([^\\n]+?)(?: \\| undefined)?;`, "m").exec(model);
    return [...(m?.[1] ?? "").matchAll(/"([A-Za-z0-9_-]+)"/g)].map((x) => x[1]!);
  };
  const named: Record<string, string> = {
    "xAxis.scale": "AxisScale", "yAxis.scale": "AxisScale", "y2Axis.scale": "AxisScale", "y3Axis.scale": "AxisScale",
    "legend.position": "LegendPosition", frame: "FrameStyle", tickDir: "TickDir", "grid.dash": "LineDash",
    "seriesStyles.*.symbol": "SymbolShape", "seriesStyles.*.symbolFill": "SymbolFill", "seriesStyles.*.connect": "ConnectMode",
    "seriesStyles.*.lineDash": "LineDash", "seriesStyles.*.errorBars": "ErrorBarType", barLayout: "BarLayout", barShape: "BarShape", boxWhisker: "BoxWhisker",
  };
  for (const [path, type] of Object.entries(named)) {
    it(`${path} = ${type}`, () => expect([...ENUM_VALUES[path]!].sort()).toEqual(members(type).sort()));
  }
  const inlines: Record<string, string> = { "seriesStyles.*.plotAs": "plotAs", barSort: "barSort", barOrientation: "barOrientation", valuePlacement: "valuePlacement" };
  for (const [path, field] of Object.entries(inlines)) {
    it(`${path} = the ${field} union`, () => expect([...ENUM_VALUES[path]!].sort()).toEqual(inline(field).sort()));
  }
  /** The fields of one interface, read from its body. */
  const fields = (name: string): string[] => {
    const i = model.indexOf(`export interface ${name} {`);
    const j = model.indexOf("\n}", i);
    return [...strip(model.slice(i, j)).matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]!);
  };
  it("the annotation kinds = AnnotationKind", () => expect([...ANNOTATION_KINDS].sort()).toEqual(members("AnnotationKind").sort()));
  it("the annotation fields = the fields of Annotation", () => expect([...ANNOTATION_FIELDS].sort()).toEqual(fields("Annotation").sort()));
  it("the analysis settings = the fields of AnalysisParams", () => expect([...ANALYSIS_PARAM_FIELDS].sort()).toEqual(fields("AnalysisParams").sort()));
  it("every kind-only field is a field, owned by real kinds", () => {
    for (const [f, owners] of Object.entries(KIND_ONLY_FIELDS)) {
      expect(ANNOTATION_FIELDS, f).toContain(f);
      for (const o of owners) expect(ANNOTATION_KINDS, `${f} → ${o}`).toContain(o);
    }
  });
});

describe("isCssColor", () => {
  it("accepts what a drawing can use and refuses what it cannot", () => {
    for (const c of ["#fff", "#ffff", "#e63946", "#e63946cc", "rgb(1,2,3)", "rgba(1, 2, 3, 0.5)", "hsl(10 50% 50%)", "var(--ink)", "steelblue", "transparent", "currentColor", "none"]) expect(isCssColor(c), c).toBe(true);
    for (const c of ["notacolour", "#12", "#ggg", "rgb(", "", "red blue"]) expect(isCssColor(c), c).toBe(false);
  });
});

describe("colour settings whose name does not say colour", () => {
  /** The patch that sets one option path, with a series id where the path is per series. */
  const patchFor = (path: string, value: unknown): Record<string, unknown> => {
    const segs = path.split(".");
    if (segs[0] === "seriesStyles" || segs[0] === "pointStyles") segs.splice(1, 0, "col_1");
    return segs.reduceRight<unknown>((v, k) => ({ [k]: v }), value) as Record<string, unknown>;
  };

  it("each is refused when the value is not a colour, and accepted when it is", () => {
    for (const path of COLOUR_OPTIONS) {
      expect(checkOptionPatch(patchFor(path, "zz")).join(" "), path).toMatch(/not a colour/);
      expect(checkOptionPatch(patchFor(path, "#336699")), path).toEqual([]);
    }
    expect(checkOptionPatch({ background: "transparent" })).toEqual([]);
    // A setting of the same name that is not a colour keeps its own type: the legend's background is on or off.
    expect(checkOptionPatch({ legend: { background: true } })).toEqual([]);
  });

  it("set_graph_options refuses a background that is not a colour and leaves the graph as it was", async () => {
    const { call, gid, plot } = await setup();
    refused(await call("set_graph_options", { id: gid, patch: { background: "zz" } }), /background/, /not a colour/);
    expect(plot().background).toBeUndefined();
    expect((await call("set_graph_options", { id: gid, patch: { background: "#f4f1ea" } })).ok).toBe(true);
  });

  it("an annotation's colours are checked too", () => {
    for (const f of ANNOTATION_COLOUR_FIELDS) {
      expect(checkAnnotationFields({ [f]: "zz" }, "rect").join(" "), f).toMatch(/not a colour/);
      expect(checkAnnotationFields({ [f]: "#336699" }, "rect"), f).toEqual([]);
    }
  });

  it("every text field the model describes as a colour is checked as one", () => {
    // A field typed `string` whose own description names a colour, fill, stroke or background must be checked:
    // named "…color", or listed. Text that is not a colour is named here with what it is.
    const NOT_A_COLOUR: Record<string, string> = {
      colorbarTitle: "a heading", valueLegendTitle: "a heading", palette: "a palette name", spectrumMap: "a colour map name",
    };
    const model = readFileSync(new URL("../../core/src/model.ts", import.meta.url), "utf8").split("\n");
    const listed = new Set([...COLOUR_OPTIONS].map((p) => p.split(".").pop()!).concat(ANNOTATION_COLOUR_FIELDS));
    const missed: string[] = [];
    model.forEach((line, i) => {
      const m = /^\s*(\w+)\??:\s*string(\s*\|\s*undefined)?;/.exec(line);
      if (!m || !model[i - 1]?.trim().endsWith("*/")) return;
      let j = i - 1;
      while (j > 0 && !model[j]!.includes("/**")) j--;
      const doc = model.slice(j, i).join(" ");
      if (!/colou?r|\bfill\b|\bstroke\b|background|\bink\b/i.test(doc)) return;
      const name = m[1]!;
      if (name === "color" || name.endsWith("Color") || listed.has(name) || NOT_A_COLOUR[name]) return;
      missed.push(`${name} (model.ts:${i + 1})`);
    });
    expect(missed).toEqual([]);
  });
});