import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import { MadyDocument } from "./document";
import { dateToDays } from "./cells";
import type { DataTable } from "./model";

/**
 * Survival start/end-date entry. A survival table can carry a
 * `date`-typed `survStart`/`survEnd` pair; the analysis payload's `time` is the elapsed
 * span (end − start) in `survivalDates.unit`, computed at analysis time — the raw dates
 * stay in the sheet.
 *
 * Oracle: the `time` arrays a date table produces must equal the elapsed values entered
 * by hand into a plain survival table. The elapsed values here are literal integers
 * (35, 100, 70, 200 days), independent of the extractor's subtraction, so the test
 * fails if the code stores a raw day-serial, the start date, or forgets to divide by the
 * unit (replacing `(e - s)` with `e`, or dropping `/perUnit`, breaks every `time` assertion
 * below).
 */

type Group = { label: string; time: number[]; event: number[] };
const times = (out: unknown): number[][] => (out as { groups: Group[] }).groups.map((g) => g.time);
const events = (out: unknown): number[][] => (out as { groups: Group[] }).groups.map((g) => g.event);

// Two subjects per group. Elapsed spans (days): A → 35, 100 · B → 70, 200.
const D = (y: number, m: number, d: number): number => dateToDays(y, m, d);

const dateTable: DataTable = {
  id: "t", kind: "survival", name: "S",
  survivalDates: { unit: "days" },
  columns: [
    { id: "cs", name: "Start date", role: "survStart", type: "date" },
    { id: "ce", name: "End date", role: "survEnd", type: "date" },
    { id: "ca", name: "Group A", role: "y" },
    { id: "cb", name: "Group B", role: "y" },
  ],
  rows: [
    // start,               end (+span days),        A event, B event
    { id: "r0", cells: { cs: D(2020, 1, 1), ce: D(2020, 2, 5), ca: 1, cb: "" } }, // +35
    { id: "r1", cells: { cs: D(2020, 3, 1), ce: D(2020, 6, 9), ca: 0, cb: "" } }, // +100
    { id: "r2", cells: { cs: D(2021, 1, 1), ce: D(2021, 3, 12), ca: "", cb: 1 } }, // +70
    { id: "r3", cells: { cs: D(2021, 5, 1), ce: D(2021, 11, 17), ca: "", cb: 0 } }, // +200
  ],
} as never;

describe("survival date-pair entry", () => {
  it("computes elapsed = end − start in days, matching a hand-entered elapsed table", () => {
    const out = buildAnalysisData("survival", { columns: ["ca", "cb"] } as never, dateTable);
    expect(times(out)).toEqual([[35, 100], [70, 200]]);
    // Event codes still normalise to 1/0; a blank group cell drops that subject.
    expect(events(out)).toEqual([[1, 0], [1, 0]]);
  });

  it("divides by the chosen unit (weeks = ÷7)", () => {
    const weeks = { ...dateTable, survivalDates: { unit: "weeks" as const } };
    const out = buildAnalysisData("survival", { columns: ["ca", "cb"] } as never, weeks);
    expect(times(out)).toEqual([[35 / 7, 100 / 7], [70 / 7, 200 / 7]]);
  });

  it("drops a row that ends before it starts (negative span)", () => {
    const bad: DataTable = {
      ...dateTable,
      rows: [
        { id: "r0", cells: { cs: D(2020, 6, 1), ce: D(2020, 1, 1), ca: 1, cb: "" } }, // end < start → dropped
        { id: "r1", cells: { cs: D(2020, 1, 1), ce: D(2020, 2, 5), ca: 1, cb: "" } }, // +35 kept
      ],
    } as never;
    const out = buildAnalysisData("survival", { columns: ["ca", "cb"] } as never, bad);
    expect(times(out)[0]).toEqual([35]);
  });

  it("elapsed mode ignores a stranded date pair — never reads a day-serial as time", () => {
    // Same columns, but date entry toggled off: the extractor must pick the real numeric
    // time column, not the huge day-serials in the start/end columns.
    const elapsed: DataTable = {
      id: "t", kind: "survival", name: "S",
      columns: [
        { id: "cs", name: "Start date", role: "survStart", type: "date" },
        { id: "ce", name: "End date", role: "survEnd", type: "date" },
        { id: "ct", name: "Time", role: "x" },
        { id: "ca", name: "Group A", role: "y" },
      ],
      rows: [
        { id: "r0", cells: { cs: D(2020, 1, 1), ce: D(2020, 2, 5), ct: 12, ca: 1 } },
        { id: "r1", cells: { cs: D(2020, 3, 1), ce: D(2020, 6, 9), ct: 48, ca: 0 } },
      ],
    } as never;
    const out = buildAnalysisData("survival", { columns: ["ca"] } as never, elapsed);
    expect(times(out)).toEqual([[12, 48]]);
  });
});

describe("setSurvivalDates / setSurvivalTimeUnit ops", () => {
  it("turning date entry ON mints a Start/End date pair and defaults to days", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("S", "survival", ["Time", "Group A"]);
    doc.setSurvivalDates(t.id, true);
    const tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    expect(tbl.survivalDates).toEqual({ unit: "days" });
    const start = tbl.columns.find((c) => c.role === "survStart");
    const end = tbl.columns.find((c) => c.role === "survEnd");
    expect(start?.type).toBe("date");
    expect(end?.type).toBe("date");
  });

  it("turning it off keeps a pair that holds entered dates (non-destructive)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("S", "survival", ["Time", "Group A"]);
    doc.setSurvivalDates(t.id, true);
    let tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    const startId = tbl.columns.find((c) => c.role === "survStart")!.id;
    // Enter a date, then toggle back to elapsed.
    const rowId = tbl.rows.length ? tbl.rows[0]!.id : doc.addRow(t.id, []).id;
    doc.setCell(t.id, rowId, startId, dateToDays(2020, 1, 1));
    doc.setSurvivalDates(t.id, false);
    tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    expect(tbl.survivalDates).toBeUndefined();
    expect(tbl.columns.some((c) => c.role === "survStart")).toBe(true); // kept — held data
  });

  it("turning it off removes an empty pair (clean)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("S", "survival", ["Time", "Group A"]);
    doc.setSurvivalDates(t.id, true);
    doc.setSurvivalDates(t.id, false);
    const tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    expect(tbl.survivalDates).toBeUndefined();
    expect(tbl.columns.some((c) => c.role === "survStart" || c.role === "survEnd")).toBe(false);
  });

  it("setSurvivalTimeUnit changes the unit; no-op when not in date mode", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("S", "survival", ["Time", "Group A"]);
    doc.setSurvivalTimeUnit(t.id, "years"); // elapsed mode → no-op
    expect(doc.toJSON().tables.find((x) => x.id === t.id)!.survivalDates).toBeUndefined();
    doc.setSurvivalDates(t.id, true);
    doc.setSurvivalTimeUnit(t.id, "years");
    expect(doc.toJSON().tables.find((x) => x.id === t.id)!.survivalDates).toEqual({ unit: "years" });
  });

  it("switching away from survival demotes the date pair to plain columns and clears the mode", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("S", "survival", ["Time", "Group A"]);
    doc.setSurvivalDates(t.id, true);
    // Put data in the pair so it is kept, then convert to XY.
    let tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    const startId = tbl.columns.find((c) => c.role === "survStart")!.id;
    const rowId = doc.addRow(t.id, []).id;
    doc.setCell(t.id, rowId, startId, dateToDays(2020, 1, 1));
    doc.setTableKind(t.id, "xy");
    tbl = doc.toJSON().tables.find((x) => x.id === t.id)!;
    expect(tbl.survivalDates).toBeUndefined();
    expect(tbl.columns.some((c) => c.role === "survStart" || c.role === "survEnd")).toBe(false);
    // The former start-date column survives as a normal data column (its date is intact).
    expect(tbl.columns.some((c) => c.id === startId)).toBe(true);
  });
});
