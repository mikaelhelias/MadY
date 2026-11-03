// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { MadyDocument, findPreset } from "@mady/core";
import {
  clearAnalysisDefault,
  getAnalysisDefault,
  getAppDefaults,
  getGlobalParams,
  getKindDefaults,
  getProfileForKind,
  listAnalysisDefaults,
  setAnalysisDefault,
  setAppDefaults,
  setGlobalParams,
  setKindDefault,
  setProfileDefault,
  resolveDateOrder,
} from "./profile";
import { seedPlotStyle } from "./seedStyle";

describe("profile — per-graph-type defaults", () => {
  beforeEach(() => localStorage.clear());

  it("a graph type with no override inherits the global default", () => {
    setProfileDefault({ kind: "builtin", name: "Scientific Journal" });
    expect(getProfileForKind("bar")).toEqual({ kind: "builtin", name: "Scientific Journal" });
    expect(getKindDefaults()).toEqual({});
  });

  it("a per-type override wins over the global default", () => {
    setProfileDefault({ kind: "builtin", name: "Scientific Journal" });
    setKindDefault("bar", { kind: "builtin", name: "Editorial" });
    expect(getProfileForKind("bar")).toEqual({ kind: "builtin", name: "Editorial" });
    expect(getProfileForKind("scatter")).toEqual({ kind: "builtin", name: "Scientific Journal" }); // untouched → global
  });

  it("an explicit None override differs from inheriting the global", () => {
    setProfileDefault({ kind: "builtin", name: "Scientific Journal" });
    setKindDefault("pie", null); // explicit "no preset for pie"
    expect(getProfileForKind("pie")).toBeNull();
    expect("pie" in getKindDefaults()).toBe(true);
  });

  it("'inherit' removes a per-type override (back to the global default)", () => {
    setProfileDefault({ kind: "builtin", name: "Scientific Journal" });
    setKindDefault("bar", { kind: "user", id: "u1" });
    expect(getProfileForKind("bar")).toEqual({ kind: "user", id: "u1" });
    setKindDefault("bar", "inherit");
    expect("bar" in getKindDefaults()).toBe(false);
    expect(getProfileForKind("bar")).toEqual({ kind: "builtin", name: "Scientific Journal" });
  });
});

describe("profile — global common params", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the curated params", () => {
    expect(getGlobalParams()).toEqual({});
    setGlobalParams({ titleSize: 20, axisThickness: 2, palette: ["#111", "#222"] });
    expect(getGlobalParams()).toEqual({ titleSize: 20, axisThickness: 2, palette: ["#111", "#222"] });
  });

  it("an empty palette is pruned (treated as 'leave the palette alone')", () => {
    setGlobalParams({ titleBold: true, palette: [] });
    expect(getGlobalParams()).toEqual({ titleBold: true });
  });
});

describe("profile → document seed (integration: the exact seedNewPlot sequence)", () => {
  beforeEach(() => localStorage.clear());

  it("a new graph of a type with a per-type default gets that preset, with global params layered on top", () => {
    setProfileDefault(null); // global = None → prove the per-type override is what applies
    setKindDefault("bar", { kind: "builtin", name: "Scientific Journal" });
    setGlobalParams({ titleSize: 22 }); // overrides the Scientific Journal preset's own title size

    const doc = new MadyDocument();
    const table = doc.addTable("T", "column", ["Cat", "Y"]);
    const plot = doc.addPlot("P", table.id);

    // The real seeding function (seedStyle.ts), shared by graph creation and the gallery,
    // so this test exercises the code a new graph goes through.
    doc.setPlotKind(plot.id, "bar");
    seedPlotStyle(doc, plot.id, "bar");

    const out = doc.toJSON().plots[0]!;
    expect(out.xAxis?.lineWidth).toBe(findPreset("Scientific Journal")!.axisThickness); // Scientific Journal preset applied
    expect(out.fonts?.title?.size).toBe(22); // the global setting wins over the preset's title size
  });
});

describe("profile — application defaults", () => {
  beforeEach(() => localStorage.clear());

  it("an unset store reads as empty (every consumer falls back to its built-in default)", () => {
    expect(getAppDefaults()).toEqual({});
  });

  it("round-trips each field", () => {
    setAppDefaults({ defaultGenre: "xy", conf: 90, errorBars: "sem", theme: "dark", autosaveMs: 3000, autosaveEnabled: false });
    expect(getAppDefaults()).toEqual({
      defaultGenre: "xy", conf: 90, errorBars: "sem", theme: "dark", autosaveMs: 3000, autosaveEnabled: false,
    });
  });

  it("a patch merges — only the named keys change", () => {
    setAppDefaults({ defaultGenre: "xy", conf: 95 });
    setAppDefaults({ theme: "dark" });
    expect(getAppDefaults()).toEqual({ defaultGenre: "xy", conf: 95, theme: "dark" });
  });

  it("setting a field to undefined clears it (reverts to the built-in fallback)", () => {
    setAppDefaults({ conf: 90, theme: "dark" });
    setAppDefaults({ conf: undefined });
    expect(getAppDefaults()).toEqual({ theme: "dark" });
    expect("conf" in getAppDefaults()).toBe(false);
  });

  it("autosaveEnabled: false survives (a falsy value is not treated as unset)", () => {
    setAppDefaults({ autosaveEnabled: false });
    expect(getAppDefaults().autosaveEnabled).toBe(false);
  });
});

describe("profile — per-method analysis defaults", () => {
  beforeEach(() => localStorage.clear());

  it("is undefined until set", () => {
    expect(getAnalysisDefault("ttest")).toBeUndefined();
    expect(listAnalysisDefaults()).toEqual([]);
  });

  it("round-trips whitelisted option fields", () => {
    setAnalysisDefault("ttest", { variant: "welch", tail: "greater", conf: 0.9 });
    expect(getAnalysisDefault("ttest")).toEqual({ variant: "welch", tail: "greater", conf: 0.9 });
    expect(listAnalysisDefaults()).toEqual(["ttest"]);
  });

  it("NEVER stores column/data selections — only method options", () => {
    setAnalysisDefault("ttest", {
      variant: "paired",
      columns: ["c1", "c2"], // data selection → must be dropped
      groupBy: "g1", // column ref → dropped
      control: 0, // index into columns → dropped
      pairs: [[0, 1]], // index pairs → dropped
      mu: 5, // reference value → dropped
      throughPoint: { x: 0, y: 0 }, // data-space point → dropped
    });
    expect(getAnalysisDefault("ttest")).toEqual({ variant: "paired" });
  });

  it("keeps rich option types (array ecLevels, boolean rout, numeric k)", () => {
    setAnalysisDefault("curvefit", { weighting: "1/Y2", rout: true, ecLevels: [10, 90] });
    expect(getAnalysisDefault("curvefit")).toEqual({ weighting: "1/Y2", rout: true, ecLevels: [10, 90] });
    setAnalysisDefault("cluster", { k: 3, standardize: false, linkage: "ward" });
    expect(getAnalysisDefault("cluster")).toEqual({ k: 3, standardize: false, linkage: "ward" });
  });

  it("methods are independent; clear removes just one", () => {
    setAnalysisDefault("ttest", { variant: "welch" });
    setAnalysisDefault("anova", { posthoc: "tukey" });
    expect(listAnalysisDefaults().sort()).toEqual(["anova", "ttest"]);
    clearAnalysisDefault("ttest");
    expect(getAnalysisDefault("ttest")).toBeUndefined();
    expect(getAnalysisDefault("anova")).toEqual({ posthoc: "tukey" });
  });

  it("saving an all-data-fields (empty after whitelist) opts-set clears the method", () => {
    setAnalysisDefault("ttest", { variant: "welch" });
    setAnalysisDefault("ttest", { columns: ["c1"] }); // nothing whitelisted → clears
    expect(getAnalysisDefault("ttest")).toBeUndefined();
    expect(listAnalysisDefaults()).toEqual([]);
  });
});

describe("resolveDateOrder — the saved preference, else the OS locale", () => {
  beforeEach(() => localStorage.clear());
  const setLang = (lang: string): void => { Object.defineProperty(navigator, "language", { value: lang, configurable: true }); };

  it("a saved preference wins over the locale", () => {
    setLang("en-US");
    setAppDefaults({ dateOrder: "dmy" });
    expect(resolveDateOrder()).toBe("dmy");
    setAppDefaults({ dateOrder: "mdy" });
    expect(resolveDateOrder()).toBe("mdy");
  });

  it("unset (Auto) infers from the OS locale — US → mdy, everywhere else → dmy", () => {
    setLang("en-US");
    expect(resolveDateOrder()).toBe("mdy");
    setLang("en-GB");
    expect(resolveDateOrder()).toBe("dmy");
    setLang("de-DE");
    expect(resolveDateOrder()).toBe("dmy");
  });
});
