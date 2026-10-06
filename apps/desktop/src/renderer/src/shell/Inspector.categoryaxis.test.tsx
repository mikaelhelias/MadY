// @vitest-environment jsdom
// The categorical X axis offers the three controls its builder honours.
//
// On bar · box · violin · scatter · beforeafter the X spec carries the category names, and
// `buildPlotScene` honours `tickRotation`, `hidden` and `categoryGroups` on it. Guards against the
// panel returning early without them. Label rotation matters most: its own tooltip reads "45° or
// 90° for long category labels", so it must be reachable on the axes that carry category labels.
// `categoryGroups` must also not appear only after an early return, i.e. on the ~30 kinds whose X
// is numeric, where the model documents it as ignored.
//
// Note: each control is checked twice, and the second check is the important one: "the control
// committed" is not the same claim as "it reached the drawing". Every case below applies the patch
// the panel produced and rebuilds the scene.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, DataTable, Plot } from "@mady/core";
import { dataAxisOf } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector, setManualCategoryGroup } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/** The kinds whose X spec bands — `CATEGORICAL_X` in `Inspector.tsx`. */
const CATEGORICAL_X = ["bar", "box", "violin", "scatter", "beforeafter"];

const handlers = (onSetAxis: (axis: string, patch: Partial<AxisSpec>) => void) => ({
  onSelect: vi.fn(),
  onSetAxis, onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Render the X-axis (category) panel and hand back the container + the patches it wrote. */
function panel(plot: Plot, table: DataTable) {
  const patches: Partial<AxisSpec>[] = [];
  const sel: GraphSelection = { kind: "axis", axis: "x" };
  const { container } = render(
    <Inspector
      activeSection="graphs"
      selection={sel}
      plot={plot}
      table={table}
      userPresets={[]}
      profileDefault={null}
      {...handlers((_a, p) => patches.push(p))}
    />,
  );
  return { container, patches };
}

/** The control on the `.frow` whose own label is exactly `label`. */
function control(container: HTMLElement, label: string): HTMLElement | undefined {
  for (const row of container.querySelectorAll<HTMLElement>(".frow")) {
    const span = row.querySelector(":scope > span");
    if ((span?.textContent ?? "").trim() !== label) continue;
    const el = row.querySelector<HTMLElement>("input, select");
    if (el) return el;
  }
  return undefined;
}

describe("categorical X axis — the panel offers what the builder honours", () => {
  // A horizontal bar card carries its categories on Y, so it is outside this sweep's premise
  // (categorical X). It is not dropped blindly: the assertion below checks that every excluded
  // card really has a banded Y axis and a continuous X — a vertical card mis-flagged would fail.
  // Caution: use a single galleryItems() call. Every call builds fresh objects, so an identity
  // check across two calls excludes nothing and the horizontal card stays in the sweep.
  const all = galleryItems();
  const horizontal = all.filter((i) => (i.plot.kind ?? "xy") === "bar" && i.plot.barOrientation === "horizontal");
  const items = all.filter((i) => CATEGORICAL_X.includes(i.plot.kind ?? "xy") && !horizontal.includes(i));

  it("a horizontal bar card is left out only because its categories sit on Y", () => {
    expect(horizontal.length, "the fixture needs one horizontal bar card").toBeGreaterThan(0);
    for (const h of horizontal) {
      const s = buildPlotScene(h.table, h.plot, { width: 360, height: 250 });
      expect(s.y.ticks.filter((t) => t.label).length, `${h.key}: no category labels on Y`).toBeGreaterThan(0);
      expect(s.x.ticks.every((t) => !t.label || /^[d.,%-−s]+$/.test(t.label)), `${h.key}: X carries names, it belongs in the sweep`).toBe(true);
    }
  });

  it("covers all five categorical-X kinds (a shrinking list means coverage vanished)", () => {
    // Coverage, not uniqueness: every categorical-X kind must have at least one card. `bar`
    // legitimately has two (grouped + simple-column), so compare the set — this
    // still fails the moment any kind loses its card (the list of distinct kinds shrinks).
    expect([...new Set(items.map((i) => i.plot.kind))].sort()).toEqual([...CATEGORICAL_X].sort());
  });

  for (const label of ["Label rotation", "Hide axis", "Group by"]) {
    it(`offers "${label}" on every categorical-X kind`, () => {
      const missing: string[] = [];
      for (const item of items) {
        const { container } = panel(item.plot, item.table);
        if (!control(container, label)) missing.push(item.plot.kind ?? "xy");
        cleanup();
      }
      expect(missing, `"${label}" is absent from the category-axis panel on: ${missing.join(", ")}`).toEqual([]);
    });
  }

  it("Label rotation writes tickRotation and the scene rotates the category labels", () => {
    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      const { container, patches } = panel(item.plot, item.table);
      const sel = control(container, "Label rotation")!;
      fireEvent.change(sel, { target: { value: "45" } });
      expect(patches, `${kind}: rotation did not commit`).toContainEqual({ tickRotation: 45 });
      cleanup();

      const before = buildPlotScene(item.table, item.plot, { width: 360, height: 250 });
      const after = buildPlotScene(item.table, { ...item.plot, xAxis: { ...(item.plot.xAxis ?? {}), tickRotation: 45 } }, { width: 360, height: 250 });
      expect(before.x.tickRotation ?? 0, `${kind}: fixture already rotated — it cannot show the change`).toBe(0);
      expect(after.x.tickRotation, `${kind}: tickRotation never reached the scene`).toBe(45);
    }
  });

  it("Hide axis writes hidden and the scene drops the category labels", () => {
    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      const { container, patches } = panel(item.plot, item.table);
      fireEvent.click(control(container, "Hide axis")!);
      expect(patches, `${kind}: hide did not commit`).toContainEqual({ hidden: true });
      cleanup();

      const before = buildPlotScene(item.table, item.plot, { width: 360, height: 250 });
      const after = buildPlotScene(item.table, { ...item.plot, xAxis: { ...(item.plot.xAxis ?? {}), hidden: true } }, { width: 360, height: 250 });
      const labelled = (s: typeof before): number => s.x.ticks.filter((t) => t.label).length;
      expect(labelled(before), `${kind}: fixture has no labelled ticks — it cannot show them disappear`).toBeGreaterThan(0);
      expect(labelled(after), `${kind}: hiding the axis left its labels drawn`).toBe(0);
    }
  });
});

describe("categorical X axis — Group by", () => {
  /** The bar fixture plus a text column naming each row's group, which is what makes the
   *  "Group by" picker non-empty (a numeric column names no groups). */
  function groupedBar(): { table: DataTable; plot: Plot } {
    const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === "bar")!;
    const table: DataTable = {
      ...item.table,
      columns: [...item.table.columns, { id: "domain", name: "Domain" }],
      rows: item.table.rows.map((r, i) => ({ ...r, cells: { ...r.cells, domain: i === 0 ? "Early" : "Late" } })),
    } as DataTable;
    return { table, plot: item.plot };
  }

  it("offers the grouping column, writes it, and the scene resolves the groups", () => {
    const { table, plot } = groupedBar();
    const { container, patches } = panel(plot, table);

    const sel = control(container, "Group by") as HTMLSelectElement;
    const option = [...sel.options].find((o) => o.value !== "");
    expect(option?.textContent, "the text column is not offered as a grouping column").toBe("Domain");

    fireEvent.change(sel, { target: { value: option!.value } });
    expect(patches.at(-1)).toEqual({ categoryGroups: { column: "domain" } });
    cleanup();

    const before = buildPlotScene(table, plot, { width: 360, height: 250 });
    const after = buildPlotScene(table, { ...plot, xAxis: { ...(plot.xAxis ?? {}), categoryGroups: { column: "domain" } } }, { width: 360, height: 250 });
    expect(before.categoryGroups ?? [], "the fixture already has groups — it cannot show them appear").toEqual([]);
    expect((after.categoryGroups ?? []).map((g) => g.label), "the grouping never reached the scene").toEqual(["Early", "Late"]);
  });
});

// ─────────────────────────────── Group by ▸ By hand ───────────────────────────────
//
// `categoryGroups.map` (a category name → group name list) is honoured by the builder and reached
// through "By hand", so treatments can be grouped without adding a text column to the datasheet.
// "By hand" gives one box per category on the axis; typing the same group name into two boxes puts
// those two categories in one block.
//
// Note: each case merges two categories into one group. A list that gives every category its own
// group draws the same blocks as no list at all on some kinds, so it could not show the editor working.

describe("categorical axis — Group by ▸ By hand", () => {
  /** The spec a patch from the panel lands on — the data axis the panel wrote through. */
  const specKey = (dataAxis: string): "xAxis" | "yAxis" => (dataAxis === "x" ? "xAxis" : "yAxis");

  /** The panel wired to real state, so a second edit sees the first (the app's own loop). */
  function live(start: Plot, table: DataTable, axis: "x" | "y") {
    const state = { plot: start };
    function Harness() {
      const [plot, setPlot] = useState(start);
      const onSetAxis = (a: string, p: Partial<AxisSpec>): void =>
        setPlot((cur) => {
          const key = specKey(a);
          const next = { ...cur, [key]: { ...(cur[key] ?? {}), ...p } } as Plot;
          state.plot = next;
          return next;
        });
      return (
        <Inspector activeSection="graphs" selection={{ kind: "axis", axis }} plot={plot} table={table}
          userPresets={[]} profileDefault={null} {...handlers(onSetAxis)} />
      );
    }
    const { container } = render(<Harness />);
    return { container, state };
  }

  /** The categories the scene draws along `axis`, left→right / top→bottom, by their full names —
   *  read straight off the ticks here, not through the helper the panel uses. A tick whose label a
   *  narrow figure shortened ("Cannabis use disord…") keeps its full name in `suppressedLabel`, and
   *  that is the category: a group keyed by the shortened text stops matching at another width. */
  function drawnCategories(table: DataTable, plot: Plot, axis: "x" | "y"): string[] {
    const s = buildPlotScene(table, plot, { width: 620, height: 420 });
    return (axis === "x" ? s.x : s.y).ticks
      .filter((t) => !t.minor && (t.label || t.suppressedLabel))
      .slice()
      .sort((a, b) => a.pos - b.pos)
      .map((t) => t.suppressedLabel || t.label);
  }

  const boxes = (c: HTMLElement): HTMLInputElement[] =>
    [...c.querySelectorAll<HTMLInputElement>('input[aria-label^="Group for "]')];

  /**
   * Every chart the editor applies to, not a hand-picked few: it must work for all applicable
   * graph types. Every gallery card, plus the flipped (horizontal) form of each kind that has
   * one — the set `band-axis-labels-fit.test.ts` sweeps — on each axis whose panel offers
   * Group by, read from the rendered panel so no kind can be left out by a written list.
   * `axis-category-panel.test.tsx` (unflipped) and the flipped check below prove the panel offers it
   * exactly where groups change the drawing.
   */
  const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);
  const cards = galleryItems().flatMap((g) => {
    const base = { key: g.key, plot: g.plot as Plot, table: g.table as DataTable };
    const kind = base.plot.kind ?? "xy";
    if (FLIPPABLE.has(kind) && (base.plot.barOrientation ?? "vertical") !== "horizontal") {
      return [base, { ...base, key: `${g.key} (flipped)`, plot: { ...base.plot, barOrientation: "horizontal" } as Plot }];
    }
    // A lollipop is horizontal by default; its vertical form carries the category names along X.
    if (kind === "lollipop" && (base.plot.barOrientation ?? "horizontal") === "horizontal") {
      return [base, { ...base, key: `${g.key} (flipped)`, plot: { ...base.plot, barOrientation: "vertical" } as Plot }];
    }
    return [base];
  });
  /** Render the axis panel: does it offer Group by, and is it the category panel (names) rather
   *  than the numbers panel? The category branch names itself "axis (categories)" in its heading. */
  const axisPanelOf = (plot: Plot, table: DataTable, axis: "x" | "y"): { groupBy: boolean; categorical: boolean } => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "axis", axis }} plot={plot} table={table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    const out = { groupBy: control(container, "Group by") != null, categorical: /axis \(categories\)/i.test(container.textContent ?? "") };
    cleanup();
    return out;
  };
  const offersGroupBy = (plot: Plot, table: DataTable, axis: "x" | "y"): boolean => axisPanelOf(plot, table, axis).groupBy;
  const cases = cards.flatMap((c) =>
    (["x", "y"] as const).filter((axis) => offersGroupBy(c.plot, c.table, axis)).map((axis) => ({ ...c, axis })));

  it("reaches every kind with a category axis, both ways round (a shrinking list means coverage vanished)", () => {
    const reached = [...new Set(cases.map((c) => `${c.plot.kind}${c.plot.barOrientation === "horizontal" ? " (horizontal)" : ""} on ${c.axis}`))].sort();
    // Every kind with a category axis (CATEGORICAL_X / CATEGORICAL_Y in `Inspector.tsx`), plus the
    // flipped distribution kinds. UpSet is absent on purpose: its categories are computed
    // intersections, which no table column or typed list can group.
    expect(reached).toEqual([
      "bar (horizontal) on y",
      "bar on x",
      "beforeafter on x",
      "box (horizontal) on y",
      "box on x",
      "dendrogram on x",
      "floatingbar (horizontal) on y",
      "floatingbar on x",
      "forest on y",
      "histogram on x",
      "lollipop on x",
      "lollipop on y",
      "paireddot on y",
      "pyramid on y",
      "raincloud on x",
      "ridgeline on y",
      "scatter (horizontal) on y",
      "scatter on x",
      "swimmer on y",
      "tracks on y",
      "violin (horizontal) on y",
      "violin on x",
    ]);
  });

  it("on a flipped chart, Group by is offered on each axis exactly where groups change the drawing", () => {
    const wrong: string[] = [];
    const flipped = cards.filter((c) => c.key.endsWith("(flipped)"));
    expect(flipped.length, "no flipped cards — the check below looks at nothing").toBeGreaterThan(0);
    for (const c of flipped) {
      for (const axis of ["x", "y"] as const) {
        const cats = drawnCategories(c.table, c.plot, axis);
        const panel = axisPanelOf(c.plot, c.table, axis);
        const offered = panel.groupBy;
        // The axis that carries names gets the category panel; the axis that carries numbers does not.
        const banded = !!buildPlotScene(c.table, c.plot, { width: 620, height: 420 })[axis].band;
        if (panel.categorical !== banded) wrong.push(`${c.key} · ${axis}: the axis carries ${banded ? "names" : "numbers"}, but the ${panel.categorical ? "category" : "numbers"} panel is shown`);
        if (cats.length < 2) {
          if (offered) wrong.push(`${c.key} · ${axis}: Group by is offered on an axis with no category names`);
          continue;
        }
        const key = specKey(dataAxisOf(c.plot, axis));
        const merged = { ...c.plot, [key]: { ...(c.plot[key] ?? {}), categoryGroups: { map: { [cats[0]!]: "G1", [cats[1]!]: "G1" } } } } as Plot;
        const moves = JSON.stringify(buildPlotScene(c.table, merged, { width: 620, height: 420 }))
          !== JSON.stringify(buildPlotScene(c.table, c.plot, { width: 620, height: 420 }));
        if (moves !== offered) wrong.push(`${c.key} · ${axis}: groups ${moves ? "change" : "do not change"} the drawing, but Group by is ${offered ? "offered" : "not offered"}`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  for (const c of cases) {
    it(`${c.key}: one box per drawn category, and two categories typed into one group draw as one block`, () => {
      const cats = drawnCategories(c.table, c.plot, c.axis);
      // Two categories are enough to merge (before-after has exactly Before and After); a third, when
      // the card has one, is kept in a second group to show the blocks are told apart.
      expect(cats.length, `${c.key}: fewer than 2 categories — the fixture cannot merge any`).toBeGreaterThanOrEqual(2);
      const third = cats[2];

      const { container, state } = live(c.plot, c.table, c.axis);
      const groupBy = control(container, "Group by") as HTMLSelectElement;
      const byHand = [...groupBy.options].find((o) => o.textContent === "By hand");
      expect(byHand, `${c.key}: Group by has no "By hand" choice`).toBeTruthy();
      fireEvent.change(groupBy, { target: { value: byHand!.value } });

      // The spec that carries the names: X on a vertical bar, Y on a forest, X again on a flipped box
      // (drawn down Y) — the same mapping the panel writes through.
      const dataKey = specKey(dataAxisOf(c.plot, c.axis));
      expect(state.plot[dataKey]?.categoryGroups, `${c.key}: By hand did not switch the axis to a hand-made list`).toEqual({ map: {} });
      expect(boxes(container).map((b) => b.getAttribute("aria-label")), `${c.key}: the boxes are not the drawn categories, in drawn order`)
        .toEqual(cats.map((n) => `Group for ${n}`));

      fireEvent.change(boxes(container)[0]!, { target: { value: "Early" } });
      fireEvent.change(boxes(container)[1]!, { target: { value: " Early " } });
      if (third) fireEvent.change(boxes(container)[2]!, { target: { value: "Late" } });
      // Stored as typed; the drawing trims, which the scene check below proves (" Early " joins "Early").
      const merged = { [cats[0]!]: "Early", [cats[1]!]: " Early " };
      expect(state.plot[dataKey]?.categoryGroups?.map).toEqual(third ? { ...merged, [third]: "Late" } : merged);

      const before = buildPlotScene(c.table, c.plot, { width: 620, height: 420 });
      const after = buildPlotScene(c.table, state.plot, { width: 620, height: 420 });
      expect(before.categoryGroups ?? [], `${c.key}: the fixture already has groups — it cannot show them appear`).toEqual([]);
      expect((after.categoryGroups ?? []).map((g) => g.label), `${c.key}: the hand-made groups never reached the drawing`)
        .toEqual(third ? ["Early", "Late"] : ["Early"]);

      // Clearing a box takes that category back out of every group.
      fireEvent.change(boxes(container)[1]!, { target: { value: "" } });
      const cleared = { [cats[0]!]: "Early" };
      expect(state.plot[dataKey]?.categoryGroups?.map).toEqual(third ? { ...cleared, [third]: "Late" } : cleared);
      cleanup();
    });
  }

  it("picking a column after By hand drops the hand-made list (a list left behind would silently win over the column)", () => {
    const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === "bar" && i.plot.barOrientation !== "horizontal")!;
    const table: DataTable = {
      ...item.table,
      columns: [...item.table.columns, { id: "domain", name: "Domain" }],
      rows: item.table.rows.map((r, i) => ({ ...r, cells: { ...r.cells, domain: i === 0 ? "Early" : "Late" } })),
    } as DataTable;
    const { container, state } = live(item.plot, table, "x");
    const groupBy = (): HTMLSelectElement => control(container, "Group by") as HTMLSelectElement;
    fireEvent.change(groupBy(), { target: { value: [...groupBy().options].find((o) => o.textContent === "By hand")!.value } });
    fireEvent.change(boxes(container)[0]!, { target: { value: "Solo" } });
    expect(state.plot.xAxis?.categoryGroups?.map, "the fixture never wrote a hand-made list").toBeTruthy();

    fireEvent.change(groupBy(), { target: { value: "domain" } });
    expect(state.plot.xAxis?.categoryGroups).toEqual({ column: "domain" });
    expect(boxes(container), "the By-hand boxes stayed up after a column was chosen").toEqual([]);
    const s = buildPlotScene(table, state.plot, { width: 620, height: 420 });
    expect((s.categoryGroups ?? []).map((g) => g.label)).toEqual(["Early", "Late"]);
  });
});

describe("setManualCategoryGroup", () => {
  it("puts a category in a group", () => {
    expect(setManualCategoryGroup({ map: {} }, "IQ", "Cognition")).toEqual({ map: { IQ: "Cognition" } });
  });

  it("keeps the name as typed, so a space typed inside a name survives the next keystroke", () => {
    expect(setManualCategoryGroup({ map: {} }, "IQ", "Early ")).toEqual({ map: { IQ: "Early " } });
  });

  it("an empty name takes the category out, and the list stays (By hand stays chosen)", () => {
    expect(setManualCategoryGroup({ map: { IQ: "Cognition", EA: "Cognition" } }, "IQ", "  ")).toEqual({ map: { EA: "Cognition" } });
    expect(setManualCategoryGroup({ map: { IQ: "Cognition" } }, "IQ", "")).toEqual({ map: {} });
  });

  it("keeps every other setting and does not change the spec it was given", () => {
    const start = { map: { IQ: "A" }, tint: true, colors: { A: "#ff0000" } };
    const next = setManualCategoryGroup(start, "EA", "A");
    expect(next).toEqual({ map: { IQ: "A", EA: "A" }, tint: true, colors: { A: "#ff0000" } });
    expect(start.map).toEqual({ IQ: "A" });
  });
});
