import { describe, expect, it } from "vitest";
import type { DataTable } from "./model";
import { buildAnalysisData, datasetName, datasetValues } from "./analysisData";
import { isRowGroupId, parseRowGroupId, rowGroupColumn, rowGroupId, rowGroupLevels, rowGroupsUsable } from "./rowGroups";
import { createSampleDocument } from "./sample";

/**
 * Group-by-row-category. A tidy/long sheet — one label column of categories plus a
 * single value dataset — holds its groups in rows, which is the right shape for a bar
 * chart, while the group-comparison tests read groups from columns. A row group is
 * addressed by a virtual dataset id so the whole spec → payload path works on it
 * unchanged.
 */
const treatments: DataTable = {
  id: "t",
  kind: "column",
  name: "Treatment means",
  columns: [
    { id: "g", name: "Group" },
    { id: "m", name: "Mean" },
    { id: "r2", name: "Rep 2", role: "y", group: "m" },
    { id: "r3", name: "Rep 3", role: "y", group: "m" },
  ],
  rows: [
    { id: "1", cells: { g: "Control", m: 12, r2: 15, r3: 9 } },
    { id: "2", cells: { g: "Drug A", m: 28, r2: 32, r3: 24 } },
    { id: "3", cells: { g: "Drug B", m: 19, r2: 22, r3: 16 } },
  ],
};

// A numeric X column is a continuous axis, not categories — offering to "group by" it
// would wreck ordinary XY tables (one group per dose).
const doseResponse: DataTable = {
  id: "d",
  kind: "xy",
  name: "Dose",
  columns: [
    { id: "x", name: "Dose" },
    { id: "y", name: "Response" },
  ],
  rows: [
    { id: "1", cells: { x: 1, y: 10 } },
    { id: "2", cells: { x: 2, y: 20 } },
  ],
};

describe("row-group ids", () => {
  it("round-trips a level, including one containing the separator", () => {
    const id = rowGroupId("g", "Drug A: 10mg");
    expect(isRowGroupId(id)).toBe(true);
    expect(parseRowGroupId(id)).toEqual({ labelColumnId: "g", level: "Drug A: 10mg" });
  });

  it("does not mistake an ordinary column id for a row group", () => {
    expect(isRowGroupId("col_12")).toBe(false);
    expect(parseRowGroupId("col_12")).toBeNull();
  });
});

describe("rowGroupLevels", () => {
  it("lists the distinct categories in first-seen row order", () => {
    expect(rowGroupLevels(treatments, "g")).toEqual(["Control", "Drug A", "Drug B"]);
  });

  it("collapses repeats and skips blanks", () => {
    const t: DataTable = {
      ...treatments,
      rows: [
        { id: "1", cells: { g: "B", m: 1 } },
        { id: "2", cells: { g: "A", m: 2 } },
        { id: "3", cells: { g: "B", m: 3 } },
        { id: "4", cells: { g: "  ", m: 4 } },
      ],
    };
    expect(rowGroupLevels(t, "g")).toEqual(["B", "A"]);
  });
});

describe("rowGroupsUsable", () => {
  it("is true for a categorical label column with one value dataset", () => {
    expect(rowGroupsUsable(treatments)).toBe(true);
  });

  it("is false when the label column is numeric — that is a continuous X, not categories", () => {
    expect(rowGroupsUsable(doseResponse)).toBe(false);
  });

  it("is false when the sheet already compares by column", () => {
    const wide: DataTable = {
      id: "w",
      kind: "column",
      name: "Wide",
      columns: [
        { id: "g", name: "Row" },
        { id: "a", name: "Control" },
        { id: "b", name: "Treated" },
      ],
      rows: [{ id: "1", cells: { g: "r1", a: 1, b: 2 } }],
    };
    expect(rowGroupsUsable(wide)).toBe(false);
  });

  it("is false with fewer than two categories", () => {
    const one: DataTable = { ...treatments, rows: [treatments.rows[0]!] };
    expect(rowGroupsUsable(one)).toBe(false);
  });

  // A parts-of-whole sheet (GDP by state, with a Region label column) must not be
  // offered a one-way ANOVA across regions. Composition data states shares of a total,
  // not independent groups to test — and such a suggestion would displace the sensible
  // "descriptive statistics". Same for the kinds that carry their own dedicated
  // analysis: contingency → chi-square, survival → Kaplan-Meier, and so on.
  it.each(["partsofwhole", "contingency", "survival", "multivariable", "nested"])(
    "is false for a %s sheet, whose categories are not comparable groups",
    (kind) => {
      expect(rowGroupsUsable({ ...treatments, kind } as DataTable)).toBe(false);
    },
  );

  it("stays true for the column/grouped sheets it is meant for", () => {
    expect(rowGroupsUsable({ ...treatments, kind: "column" } as DataTable)).toBe(true);
    expect(rowGroupsUsable({ ...treatments, kind: "grouped" } as DataTable)).toBe(true);
  });
});

describe("resolving a row group as a dataset", () => {
  it("pools the row's replicate values as that group's observations", () => {
    expect(datasetValues(treatments, rowGroupId("g", "Control"))).toEqual([12, 15, 9]);
    expect(datasetValues(treatments, rowGroupId("g", "Drug A"))).toEqual([28, 32, 24]);
  });

  it("gathers every row of a repeated category, not just the first", () => {
    const t: DataTable = {
      ...treatments,
      rows: [
        { id: "1", cells: { g: "Control", m: 1, r2: 2, r3: null } },
        { id: "2", cells: { g: "Drug A", m: 9 } },
        { id: "3", cells: { g: "Control", m: 3 } },
      ],
    };
    expect(datasetValues(t, rowGroupId("g", "Control"))).toEqual([1, 2, 3]);
  });

  it("names the group after its level", () => {
    expect(datasetName(treatments, rowGroupId("g", "Drug B"))).toBe("Drug B");
  });

  it("yields nothing for a level that is not present", () => {
    expect(datasetValues(treatments, rowGroupId("g", "Nope"))).toEqual([]);
  });
});

// The shipped demo holds its groups this way: "Treatment bar chart" (Experiment 2)
// keeps Control/Drug A/Drug B/Drug C in rows, and a group comparison must work on it.
// Checked against the real document, not a fixture.
describe("the sample project's Treatment sheet", () => {
  const json = createSampleDocument().toJSON();
  const t = json.tables.find((x) => x.name === "Treatment means")!;
  const label = rowGroupColumn(t)!;

  it("is recognised as row-grouped", () => {
    expect(rowGroupsUsable(t)).toBe(true);
    expect(rowGroupLevels(t, label)).toEqual(["Control", "Drug A", "Drug B", "Drug C"]);
  });

  it("builds an ANOVA whose groups are the treatments' own replicate values", () => {
    const cols = rowGroupLevels(t, label).map((lv) => rowGroupId(label, lv));
    const d = buildAnalysisData("anova", { columns: cols }, t) as { groups: number[][]; labels: string[] };
    expect(d.labels).toEqual(["Control", "Drug A", "Drug B", "Drug C"]);
    expect(d.groups).toEqual([[12, 15, 9], [28, 32, 24], [19, 22, 16], [35, 39, 31]]);
  });
});

describe("buildAnalysisData with row groups", () => {
  it("builds a two-group t test from two categories", () => {
    const d = buildAnalysisData(
      "ttest",
      { columns: [rowGroupId("g", "Control"), rowGroupId("g", "Drug A")], variant: "welch" },
      treatments,
    );
    expect(d).toMatchObject({ a: [12, 15, 9], b: [28, 32, 24] });
  });

  it("builds an ANOVA over every category, labelled by level", () => {
    const d = buildAnalysisData(
      "anova",
      { columns: rowGroupLevels(treatments, "g").map((lv) => rowGroupId("g", lv)) },
      treatments,
    ) as { groups: number[][]; labels: string[] };
    expect(d.labels).toEqual(["Control", "Drug A", "Drug B"]);
    expect(d.groups).toEqual([[12, 15, 9], [28, 32, 24], [19, 22, 16]]);
  });

  it("describes a single category", () => {
    expect(buildAnalysisData("describe", { columns: [rowGroupId("g", "Drug B")] }, treatments)).toMatchObject({
      values: [19, 22, 16],
    });
  });
});
