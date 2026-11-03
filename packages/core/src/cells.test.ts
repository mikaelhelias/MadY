import { describe, expect, it } from "vitest";
import {
  dateToDays,
  daysToISO,
  effectiveValue,
  formatCellValue,
  formatElapsed,
  isCellExcluded,
  excludedCount,
  applyExclusions,
  parseCellInput,
  parseDate,
  parseElapsed,
  remapCellFills,
  remapCellPatterns,
} from "./cells";
import { tableToNamedTable } from "./derive";
import { columnValues, datasetValues } from "./analysisData";
import { MadyDocument } from "./document";

describe("date helpers", () => {
  it("round-trips days ↔ ISO at the epoch and a known date", () => {
    expect(dateToDays(1970, 1, 1)).toBe(0);
    expect(daysToISO(0)).toBe("1970-01-01");
    expect(daysToISO(dateToDays(2024, 3, 15))).toBe("2024-03-15");
  });
  it("parses ISO (year-first, either separator), rejecting impossible dates", () => {
    expect(daysToISO(parseDate("2024-03-15")!)).toBe("2024-03-15");
    expect(daysToISO(parseDate("2024/03/15")!)).toBe("2024-03-15");
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("2020-02-30")).toBeNull(); // Feb 30 doesn't exist
  });

  // The ambiguous case Date.parse would silently guess at (always US month/day):
  // "05/06/2020" is 6 May in the US, 5 June elsewhere. The chosen order decides, deterministically.
  it("numeric slash/dash dates follow the chosen order (mdy vs dmy)", () => {
    expect(daysToISO(parseDate("05/06/2020", "mdy")!)).toBe("2020-05-06"); // May 6 (US)
    expect(daysToISO(parseDate("05/06/2020", "dmy")!)).toBe("2020-06-05"); // 5 Jun (international)
    expect(daysToISO(parseDate("13-02-2020", "dmy")!)).toBe("2020-02-13"); // 13 Feb — day>12 needs dmy
    expect(parseDate("13/02/2020", "mdy")).toBeNull(); // month 13 doesn't exist → stays text (not a wrong date)
    expect(daysToISO(parseDate("7/4/20", "mdy")!)).toBe("2020-07-04"); // two-digit year lands this century
  });

  it("accepts unambiguous textual months, order-independent", () => {
    expect(daysToISO(parseDate("5 Jun 2020")!)).toBe("2020-06-05");
    expect(daysToISO(parseDate("5 June 2020", "mdy")!)).toBe("2020-06-05");
    expect(daysToISO(parseDate("Jun 5, 2020", "dmy")!)).toBe("2020-06-05");
  });

  it("does not turn a bare number into a date (Date.parse reads '42' as 2042)", () => {
    expect(parseDate("42")).toBeNull();
    expect(parseDate("2020")).toBeNull();
    expect(parseDate("007")).toBeNull();
  });

  it("parseCellInput threads the date order for a date column", () => {
    expect(daysToISO(parseCellInput("05/06/2020", { type: "date" }, { dateOrder: "dmy" }) as number)).toBe("2020-06-05");
    expect(daysToISO(parseCellInput("05/06/2020", { type: "date" }, { dateOrder: "mdy" }) as number)).toBe("2020-05-06");
    expect(parseCellInput("42", { type: "date" })).toBe("42"); // not a date → kept as the typed text
  });
});

describe("elapsed helpers", () => {
  it("round-trips seconds ↔ h:mm:ss", () => {
    expect(parseElapsed("1:02:03")).toBe(3723);
    expect(formatElapsed(3723)).toBe("1:02:03");
    expect(parseElapsed("90")).toBe(90);
    expect(formatElapsed(90)).toBe("0:01:30");
    expect(parseElapsed("abc")).toBeNull();
  });
});

describe("formatCellValue", () => {
  it("formats by column type", () => {
    expect(formatCellValue(null)).toBe("");
    expect(formatCellValue(5)).toBe("5");
    expect(formatCellValue(3.14159, { decimals: 2 })).toBe("3.14");
    expect(formatCellValue(0, { type: "date" })).toBe("1970-01-01");
    expect(formatCellValue(3723, { type: "elapsed" })).toBe("1:02:03");
    expect(formatCellValue("Drug A", { type: "categorical" })).toBe("Drug A");
  });
});

describe("parseCellInput", () => {
  it("parses by column type and never coerces text labels", () => {
    expect(parseCellInput("42", { type: "number" })).toBe(42);
    expect(parseCellInput("42", { type: "text" })).toBe("42"); // stays a string
    expect(parseCellInput("Drug A", { type: "categorical" })).toBe("Drug A");
    expect(daysToISO(parseCellInput("2024-03-15", { type: "date" }) as number)).toBe("2024-03-15");
    expect(parseCellInput("1:02:03", { type: "elapsed" })).toBe(3723);
    expect(parseCellInput("", { type: "number" })).toBeNull();
  });

  it("typed entry uses the same number grammar as import: padded / hex / octal / binary IDs stay text", () => {
    // Raw Number() would read "007"→7, "0x1A"→26 — corrupting, the moment they are typed or
    // pasted, the padded sample IDs that import deliberately keeps as text.
    for (const col of [{ type: "number" as const }, undefined]) {
      expect(parseCellInput("007", col)).toBe("007");
      expect(parseCellInput("-012", col)).toBe("-012");
      expect(parseCellInput("0x1A", col)).toBe("0x1A");
      expect(parseCellInput("0o17", col)).toBe("0o17");
      expect(parseCellInput("0b101", col)).toBe("0b101");
      // …while genuine numbers still parse, including the ones that look padded but aren't.
      expect(parseCellInput("0", col)).toBe(0);
      expect(parseCellInput("0.5", col)).toBe(0.5);
      expect(parseCellInput("1e3", col)).toBe(1000);
      expect(parseCellInput("-3.25", col)).toBe(-3.25);
    }
  });

  it("an out-of-range ISO date stays text instead of rolling over into a believable wrong date", () => {
    // Date.UTC wraps: month 13 → next January, Feb 30 → Mar 1. A typo must stay visible.
    expect(parseCellInput("2020-13-01", { type: "date" })).toBe("2020-13-01");
    expect(parseCellInput("2020-02-30", { type: "date" })).toBe("2020-02-30");
    expect(parseCellInput("2020-05-40", { type: "date" })).toBe("2020-05-40");
    expect(parseDate("2020-13-01")).toBeNull();
    // real dates unchanged — including a leap day, which a naive "day ≤ 28" rule would wrongly reject
    expect(daysToISO(parseDate("2020-06-15")!)).toBe("2020-06-15");
    expect(daysToISO(parseDate("2020-02-29")!)).toBe("2020-02-29"); // 2020 is a leap year
    expect(parseDate("2021-02-29")).toBeNull(); // 2021 is not
  });
});

describe("MadyDocument — column types, decimals, freeze, exclusion", () => {
  it("sets + undoes column type and decimals", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const colId = t.columns[1]!.id;
    doc.setColumnType(t.id, colId, "elapsed");
    expect(t.columns[1]!.type).toBe("elapsed");
    doc.setColumnDecimals(t.id, colId, 2);
    expect(t.columns[1]!.decimals).toBe(2);
    doc.commands.undo();
    expect(t.columns[1]!.decimals).toBeUndefined();
    doc.commands.undo();
    expect(t.columns[1]!.type).toBeUndefined();
  });

  it("Format → Date reparses existing cells to date-serials, undoably", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["When", "Y"]);
    const colId = t.columns[0]!.id;
    // Date text as it arrives from a plain paste and from an Excel import (full ISO timestamp).
    const r1 = doc.addRow(t.id, ["2024-01-15", 1]);
    const r2 = doc.addRow(t.id, ["2024-03-01T00:00:00.000Z", 2]);

    doc.setColumnType(t.id, colId, "date");
    // stored as day-serials the date type can read/format/plot — not the raw strings
    expect(typeof t.rows[0]!.cells[colId]).toBe("number");
    expect(formatCellValue(t.rows[0]!.cells[colId]!, t.columns[0]!)).toBe("2024-01-15");
    expect(formatCellValue(t.rows[1]!.cells[colId]!, t.columns[0]!)).toBe("2024-03-01");

    // undo restores the exact original strings and the prior (untyped) column
    doc.commands.undo();
    expect(t.columns[0]!.type).toBeUndefined();
    expect(t.rows[0]!.cells[colId]).toBe("2024-01-15");
    expect(t.rows[1]!.cells[colId]).toBe("2024-03-01T00:00:00.000Z");
    void [r1, r2];
  });

  it("reparse keeps full number precision on a number→text change (no decimals clamp)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const colId = t.columns[0]!.id;
    doc.addRow(t.id, [3.14159265, 0]);
    doc.setColumnDecimals(t.id, colId, 2); // display would show "3.14"
    doc.setColumnType(t.id, colId, "text");
    expect(t.rows[0]!.cells[colId]).toBe("3.14159265"); // full precision, not "3.14"
  });

  it("freezes + unfreezes a table (undoable)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setTableFrozen(t.id, true);
    expect(doc.toJSON().tables[0]!.frozen).toBe(true);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.frozen).toBeFalsy();
  });

  it("excludes a cell: omitted from extraction, dependents stale, undoable", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const r = doc.addRow(t.id, [1, 10]);
    const colId = t.columns[1]!.id;
    const plot = doc.addPlot("P", t.id);
    doc.recompute();
    expect(doc.plotStatus(plot.id)).toBe("ok");

    doc.setCellsExcluded(t.id, [{ rowId: r.id, colId }], true);
    expect(isCellExcluded(t, r.id, colId)).toBe(true);
    expect(effectiveValue(t, t.rows[0]!, t.columns[1]!)).toBeNull();
    expect(tableToNamedTable(t).rows[0]![1]).toBeNull(); // drops out of transforms/derived too
    expect(doc.plotStatus(plot.id)).toBe("stale"); // graphs recompute without it

    doc.commands.undo();
    expect(isCellExcluded(t, r.id, colId)).toBe(false);
    expect(effectiveValue(t, t.rows[0]!, t.columns[1]!)).toBe(10);
  });

  /**
   * The stale badge must clear itself once the figure is drawing current data.
   *
   * It is a real signal, not decoration: it says "this figure does not show your latest
   * data". A table-backed graph redraws from the live document, so that stops being true
   * the instant the edit lands — leaving the badge up would make it permanent and meaningless.
   * An analysis-backed graph is a different case: it can only be as fresh as the result
   * behind it, which is computed out-of-process, so its badge must survive until both the
   * analysis and the graph's stored drawing have been refreshed.
   */
  it("clears a table-backed plot's stale flag, but keeps an analysis-backed one flagged", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const r = doc.addRow(t.id, [1, 10]);
    const colId = doc.toJSON().tables[0]!.columns[1]!.id;
    const plain = doc.addPlot("Plain", t.id);
    const fromAnalysis = doc.addPlot("From analysis", t.id);
    const an = doc.addAnalysis("A", "ttest", t.id, { columns: [colId] });
    doc.setAnalysisResult(an.id, { method: an.method, title: "Result", summary: "", terms: [], glance: {} });
    doc.setPlotOptions(fromAnalysis.id, { analysisSource: an.id });
    doc.refreshPlotStatus();
    expect(doc.plotStatus(plain.id)).toBe("ok");
    expect(doc.plotStatus(fromAnalysis.id)).toBe("ok");

    // Edit the data: both are flagged…
    doc.setCellsExcluded(t.id, [{ rowId: r.id, colId }], true);
    expect(doc.plotStatus(plain.id)).toBe("stale");
    expect(doc.plotStatus(fromAnalysis.id)).toBe("stale");

    // …and the plain one catches up by itself, while the analysis-backed one does not.
    doc.refreshPlotStatus();
    expect(doc.plotStatus(plain.id), "a table-backed graph stayed flagged after it caught up").toBe("ok");
    expect(
      doc.plotStatus(fromAnalysis.id),
      "an analysis-backed graph cleared before its analysis was re-run",
    ).toBe("stale");

    // A new result alone does not replace the graph's stored drawing.
    doc.setAnalysisResult(an.id, { method: an.method, title: "Result", summary: "", terms: [], glance: {} });
    doc.refreshPlotStatus();
    expect(doc.plotStatus(fromAnalysis.id), "an old drawing was incorrectly marked current").toBe("stale");
    doc.setPlotOptions(fromAnalysis.id, { analysisResultVersion: an.resultVersion });
    doc.refreshPlotStatus();
    expect(doc.plotStatus(fromAnalysis.id), "a refreshed drawing stayed flagged").toBe("ok");
  });

  /**
   * An excluded value must not reach a graph or an analysis.
   *
   * A scene builder or analysis extractor that reads `row.cells[...]` directly, without the
   * exclusion map, would still draw an excluded point, join it with the line, and count it in
   * the mean and the p-value — while the sheet shows it struck out in blue and the manual
   * says it is ignored. `applyExclusions` masks the table once at each entry; these pin that
   * it takes effect.
   */
  it("hides excluded values from the analysis pipeline, not just from derived tables", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const r = doc.addRow(t.id, [1, 10]);
    doc.addRow(t.id, [2, 20]);
    const yId = doc.toJSON().tables[0]!.columns[1]!.id;

    expect(columnValues(doc.toJSON().tables[0]!, yId)).toEqual([10, 20]);
    doc.setCellsExcluded(t.id, [{ rowId: r.id, colId: yId }], true);

    const masked = applyExclusions(doc.toJSON().tables[0]!);
    expect(columnValues(masked, yId), "the excluded value is still in the analysis").toEqual([20]);
    expect(datasetValues(masked, yId), "the excluded value is still in the dataset").toEqual([20]);
  });

  it("applyExclusions leaves a clean table untouched (same object, no copying)", () => {
    // The mask runs on every scene build and every analysis; the common case is that
    // nothing is excluded, and that case must not allocate a copy of the whole table.
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 10]);
    const live = doc.toJSON().tables[0]!;
    expect(applyExclusions(live)).toBe(live);
  });

  /**
   * The count that the on-screen note under a graph reports.
   *
   * The trap it guards: `excluded` is keyed by row and column id, so deleting a column
   * leaves its entries behind. Counting the map's own size would then claim exclusions the
   * user cannot find anywhere in the sheet — a number about their data that is simply wrong.
   */
  it("counts excluded values, ignoring entries whose column has since been deleted", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y", "Y2"]);
    const r1 = doc.addRow(t.id, [1, 10, 100]);
    const r2 = doc.addRow(t.id, [2, 20, 200]);
    const yId = doc.toJSON().tables[0]!.columns[1]!.id;
    const y2Id = doc.toJSON().tables[0]!.columns[2]!.id;

    expect(excludedCount(doc.toJSON().tables[0]!), "a clean table has none").toBe(0);

    doc.setCellsExcluded(t.id, [{ rowId: r1.id, colId: yId }, { rowId: r2.id, colId: y2Id }], true);
    expect(excludedCount(doc.toJSON().tables[0]!)).toBe(2);

    // Delete the column holding one of them — its `excluded` entry is now unaddressable.
    const y2Index = doc.toJSON().tables[0]!.columns.findIndex((c) => c.id === y2Id);
    doc.deleteColumn(t.id, y2Index);
    expect(
      excludedCount(doc.toJSON().tables[0]!),
      "counted an exclusion on a column that no longer exists",
    ).toBe(1);
  });
});

describe("MadyDocument — sortRowsByColumn", () => {
  const colVals = (doc: MadyDocument, tid: string, colId: string): unknown[] =>
    doc.toJSON().tables.find((t) => t.id === tid)!.rows.map((r) => r.cells[colId] ?? null);

  it("sorts rows ascending / descending by a numeric column", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [3, 30]);
    doc.addRow(t.id, [1, 10]);
    doc.addRow(t.id, [2, 20]);
    const x = t.columns[0]!.id;
    const y = t.columns[1]!.id;
    doc.sortRowsByColumn(t.id, x, "asc");
    expect(colVals(doc, t.id, x)).toEqual([1, 2, 3]);
    expect(colVals(doc, t.id, y)).toEqual([10, 20, 30]); // whole rows move, not just the key
    doc.sortRowsByColumn(t.id, x, "desc");
    expect(colVals(doc, t.id, x)).toEqual([3, 2, 1]);
  });

  it("sinks blanks to the bottom in both directions", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [2, 1]);
    doc.addRow(t.id, [null, 2]);
    doc.addRow(t.id, [1, 3]);
    const x = t.columns[0]!.id;
    doc.sortRowsByColumn(t.id, x, "asc");
    expect(colVals(doc, t.id, x)).toEqual([1, 2, null]);
    doc.sortRowsByColumn(t.id, x, "desc");
    expect(colVals(doc, t.id, x)).toEqual([2, 1, null]); // blank still last, not first
  });

  it("uses a natural (numeric-aware) order for text", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["Label", "Y"]);
    doc.setColumnType(t.id, t.columns[0]!.id, "text");
    doc.addRow(t.id, ["a10", 1]);
    doc.addRow(t.id, ["a2", 2]);
    doc.addRow(t.id, ["a1", 3]);
    const c = t.columns[0]!.id;
    doc.sortRowsByColumn(t.id, c, "asc");
    expect(colVals(doc, t.id, c)).toEqual(["a1", "a2", "a10"]); // not lexical a1,a10,a2
  });

  it("is undoable (restores the original row order)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [3, 1]);
    doc.addRow(t.id, [1, 2]);
    doc.addRow(t.id, [2, 3]);
    const x = t.columns[0]!.id;
    doc.sortRowsByColumn(t.id, x, "asc");
    expect(colVals(doc, t.id, x)).toEqual([1, 2, 3]);
    doc.commands.undo();
    expect(colVals(doc, t.id, x)).toEqual([3, 1, 2]);
  });
});

describe("remapCellFills", () => {
  const rowMap = new Map([["r1", "R1"], ["r2", "R2"]]);
  const colMap = new Map([["c1", "C1"], ["c2", "C2"]]);

  it("remaps row + column ids onto their new values", () => {
    const out = remapCellFills({ r1: { c1: "#fff", c2: "#000" } }, rowMap, colMap);
    expect(out).toEqual({ R1: { C1: "#fff", C2: "#000" } });
  });

  it("drops a fill whose row or column no longer exists", () => {
    const out = remapCellFills({ r1: { c1: "#f00" }, rGone: { c1: "#0f0" } }, rowMap, colMap);
    expect(out).toEqual({ R1: { C1: "#f00" } }); // the gone row is dropped
    const out2 = remapCellFills({ r1: { c1: "#f00", cGone: "#0f0" } }, rowMap, colMap);
    expect(out2).toEqual({ R1: { C1: "#f00" } }); // the gone column is dropped
  });

  it("returns undefined for empty / undefined input", () => {
    expect(remapCellFills(undefined, rowMap, colMap)).toBeUndefined();
    expect(remapCellFills({ rGone: { cGone: "#f00" } }, rowMap, colMap)).toBeUndefined();
  });
});

describe("remapCellPatterns", () => {
  const rowMap = new Map([["r1", "R1"], ["r2", "R2"]]);
  const colMap = new Map([["c1", "C1"], ["c2", "C2"]]);
  const hatch = { kind: "hatch" as const, color: "#333" };
  const dots = { kind: "dots" as const, color: "#a00" };

  it("remaps row + column ids, carrying the pattern object", () => {
    const out = remapCellPatterns({ r1: { c1: hatch, c2: dots } }, rowMap, colMap);
    expect(out).toEqual({ R1: { C1: hatch, C2: dots } });
  });

  it("drops a pattern whose row or column no longer exists", () => {
    const out = remapCellPatterns({ r1: { c1: hatch }, rGone: { c1: dots } }, rowMap, colMap);
    expect(out).toEqual({ R1: { C1: hatch } });
    const out2 = remapCellPatterns({ r1: { c1: hatch, cGone: dots } }, rowMap, colMap);
    expect(out2).toEqual({ R1: { C1: hatch } });
  });

  it("returns undefined for empty / undefined input", () => {
    expect(remapCellPatterns(undefined, rowMap, colMap)).toBeUndefined();
    expect(remapCellPatterns({ rGone: { cGone: hatch } }, rowMap, colMap)).toBeUndefined();
  });
});
