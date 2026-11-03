// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { AnalyzeDialog } from "./AnalyzeDialog";
import { METHOD_GROUPS } from "./analysis";

afterEach(cleanup);

/**
 * The configure view, checked for every analysis method against every datasheet kind.
 *
 * The landing tiles and the catalogue are tested separately; this covers the third
 * surface, where the user actually sets a test up. It guards against one failure mode
 * that a per-method test does not catch: a configuration that cannot be run and does not
 * say why — for example Equivalence (TOST), whose ±Δ bound deliberately has no default,
 * so Run stays disabled until the user enters one and the dialog must say so.
 *
 * Three things are asserted for all ~320 combinations: the view renders, it offers a
 * way to choose data, and if Run is blocked the reason is visible.
 */
const col = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra });
const rows = (n: number, make: (i: number) => Record<string, unknown>) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, cells: make(i) }));

const FIXTURES: Record<string, DataTable> = {
  xy: {
    id: "t", kind: "xy", name: "XY",
    columns: [col("x", "Dose"), col("y1", "A"), col("y2", "B")],
    rows: rows(8, (i) => ({ x: i + 1, y1: i * 2 + 1, y2: i * 3 + 2 })),
  } as unknown as DataTable,
  column: {
    id: "t", kind: "column", name: "Column",
    columns: [col("g", "Row"), col("a", "Control"), col("b", "Treated"), col("c", "Drug")],
    rows: rows(6, (i) => ({ g: i + 1, a: 10 + i, b: 20 + i, c: 30 + i })),
  } as unknown as DataTable,
  // The tidy shape: groups in rows behind a single value column.
  "column-one-dataset": {
    id: "t", kind: "column", name: "One dataset",
    columns: [col("g", "Group"), col("m", "Mean")],
    rows: rows(4, (i) => ({ g: `L${i}`, m: 10 + i })),
  } as unknown as DataTable,
  grouped: {
    id: "t", kind: "grouped", name: "Grouped",
    columns: [col("g", "Time"), col("a", "Ctrl"), col("b", "Trt")],
    rows: rows(6, (i) => ({ g: `T${i}`, a: 5 + i, b: 9 + i })),
  } as unknown as DataTable,
  contingency: {
    id: "t", kind: "contingency", name: "Contingency",
    columns: [col("g", "Row"), col("a", "Yes"), col("b", "No")],
    rows: rows(2, (i) => ({ g: `R${i}`, a: 10 + i, b: 20 + i })),
  } as unknown as DataTable,
  survival: {
    id: "t", kind: "survival", name: "Survival",
    columns: [col("x", "Time"), col("a", "GrpA"), col("b", "GrpB")],
    rows: rows(8, (i) => ({ x: i + 1, a: i % 2, b: (i + 1) % 2 })),
  } as unknown as DataTable,
  partsofwhole: {
    id: "t", kind: "partsofwhole", name: "Parts",
    columns: [col("g", "Slice"), col("v", "Value")],
    rows: rows(4, (i) => ({ g: `S${i}`, v: 10 + i })),
  } as unknown as DataTable,
  multivariable: {
    id: "t", kind: "multivariable", name: "Multi",
    columns: [col("g", "Case"), col("a", "V1"), col("b", "V2"), col("c", "V3"), col("d", "V4")],
    rows: rows(10, (i) => ({ g: i, a: i, b: i * 2, c: i * 3 + 1, d: i % 2 })),
  } as unknown as DataTable,
  nested: {
    id: "t", kind: "nested", name: "Nested",
    columns: [col("g", "Row"), col("a", "A"), col("a2", "A2", { role: "y", group: "a" }), col("b", "B"), col("b2", "B2", { role: "y", group: "b" })],
    rows: rows(6, (i) => ({ g: i, a: 10 + i, a2: 11 + i, b: 20 + i, b2: 21 + i })),
  } as unknown as DataTable,
};

const ALL_METHODS = [...new Set(METHOD_GROUPS.flatMap((g) => g.methods))];
/** Wording that counts as telling the user why Run is blocked. */
const EXPLAINS = /pick|need|only one|at least|two different|requires|enter an|not enough/i;

/**
 * Check every method against one datasheet kind.
 * Returns the problems found; empty = clean.
 */
function checkKind(kindName: string, table: DataTable): string[] {
  const problems: string[] = [];
  for (const method of ALL_METHODS) {
    cleanup();
    let u: ReturnType<typeof render>;
    try {
      u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} />);
      fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
      const pick = u.container.querySelector(`[data-method="${method}"]`);
      if (!pick) { problems.push(`${kindName}/${method}: missing from the catalogue`); continue; }
      fireEvent.click(pick);
    } catch (e) {
      problems.push(`${kindName}/${method}: crashed — ${(e as Error).message.slice(0, 90)}`);
      continue;
    }
    const run = u.container.querySelector(".btn") as HTMLButtonElement | null;
    if (!run) { problems.push(`${kindName}/${method}: no Run button`); continue; }
    const notes = [...u.container.querySelectorAll(".note")].map((n) => n.textContent ?? "").join(" ");
    const selects = u.container.querySelectorAll("select").length;
    const boxes = u.container.querySelectorAll(".angroups input[type=checkbox]").length;
    if (run.disabled && !EXPLAINS.test(notes)) {
      problems.push(`${kindName}/${method}: Run disabled with no visible reason`);
    }
    if (selects === 0 && boxes === 0) problems.push(`${kindName}/${method}: no way to choose data`);
  }
  return problems;
}

describe("Analyze configure view — every method × every datasheet kind", () => {
  /**
   * One test per datasheet kind. Every method × kind combination in one test under a single
   * time limit would leave too little headroom: under full-suite load it takes several times as
   * long as in isolation, so a busy machine would time out intermittently.
   *
   * Splitting is safe because the rendered outcome is a pure function of (table, method):
   * no async effects, no Date/random, `recommendations` defaults to []. Load can only change
   * the duration, never the result — so a timeout is not a hidden defect, and splitting cannot
   * mask one. Every method × kind combination and all three assertions are covered; each test
   * mounts one kind's dialogs, with a wide margin under its own 60 s limit,
   * and a real problem still fails its kind's test by name.
   */
  it.each(Object.entries(FIXTURES))(
    "%s: renders, offers data pickers, and never blocks Run without saying why",
    (kindName, table) => {
      expect(checkKind(kindName, table)).toEqual([]);
    },
    60_000,
  );

  it("equivalence explains its missing bound rather than showing a dead Run button", () => {
    const u = render(<AnalyzeDialog table={FIXTURES["column"]!} onRun={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    fireEvent.click(u.container.querySelector('[data-method="equivalence"]')!);
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(true);
    expect(u.container.textContent).toMatch(/enter an equivalence bound/i);
    // …and supplying one unblocks it.
    fireEvent.change(u.container.querySelector('input[aria-label="Equivalence bound"]')!, { target: { value: "2" } });
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Analyze configure — designate a control on the t test (each group vs a control)", () => {
  // FIXTURES.column is a wide sheet with three datasets (Control / Treated / Drug), so
  // rowGroupsUsable is false and the group pickers offer all three — a t test can pit only
  // two of them against each other, so "vs one control" is the whole point.
  const threeGroups = FIXTURES["column"]!;
  const openTtest = (table: DataTable, variant?: string) => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click([...u.container.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    fireEvent.click(u.container.querySelector('[data-method="ttest"]')!);
    if (variant) fireEvent.change(u.container.querySelector('select[aria-label="Type"]') as HTMLSelectElement, { target: { value: variant } });
    return u;
  };
  const controlField = (u: ReturnType<typeof render>) =>
    u.container.querySelector('select[aria-label="Control group (t test)"]') as HTMLSelectElement | null;
  const switchNudge = (u: ReturnType<typeof render>) =>
    [...u.container.querySelectorAll("button")].find((b) => /Switch to ANOVA . Dunnett/.test(b.textContent ?? ""));

  it("puts a Control group field on the (parametric) t test when it faces three or more groups", () => {
    // The control is chosen on the t test itself, where a user comparing groups looks for it.
    const u = openTtest(threeGroups); // default variant = unpaired (Student)
    expect(controlField(u), "no inline control field under a 3-group Student t test").toBeTruthy();
    expect(controlField(u)!.querySelectorAll("option").length, "not every group reached the control field").toBe(3);
    expect([...u.container.querySelectorAll("button")].some((b) => /Compare every group to/.test(b.textContent ?? "")), "no run-vs-control button").toBe(true);
    // The parametric case offers the field instead of a switch-to-ANOVA button.
    expect(switchNudge(u), "a switch-to-ANOVA button is shown alongside the field").toBeFalsy();
  });

  it("says nothing for a genuine two-group t test — the control field is a consequence, not furniture", () => {
    // Drop the third dataset: two datasets is exactly what a t test is for.
    const two = { ...threeGroups, columns: threeGroups.columns.slice(0, 3) } as unknown as DataTable;
    const u = openTtest(two);
    expect(controlField(u), "the control field appeared for a real two-group t test").toBeFalsy();
    expect(switchNudge(u), "a vs-control nudge appeared for a real two-group t test").toBeFalsy();
  });

  it("Mann-Whitney (nonparametric) keeps the ANOVA + Dunnett nudge — no rank-based vs-control post-hoc exists", () => {
    const u = openTtest(threeGroups, "mann-whitney");
    expect(controlField(u), "an inline (parametric) control field wrongly appeared for Mann-Whitney").toBeFalsy();
    expect(switchNudge(u), "Mann-Whitney lost its vs-control door").toBeTruthy();
  });
});
