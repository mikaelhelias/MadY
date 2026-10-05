// @vitest-environment jsdom
// A banded axis gets the category panel, and only the kinds that honour groups get that section.
//
// The Inspector chooses between its two axis panels — categorical (title · label rotation ·
// hide-axis · spacing · groups) and continuous (scale · number format · manual range). Many
// kinds have a banded axis, including a lollipop, forest, paired-dot, pyramid or ridgeline, all
// of which band down Y. Guards against a hand-kept kind list that offers scale and number-format
// rows for an axis carrying names, and none of the category rows.
//
// Banded and "honours category groups" are the same condition on every gallery kind and both
// axes (the two tests below check each side against the scene). So one list, not two.
//
// Caution: grouping by `columns[0]` on box/violin/scatter/raincloud/floatingbar/histogram/
// before-after groups by the category column itself — one group per category, a no-op — and
// would suggest only six kinds honour groups. The fixture below merges two categories instead
// (see also `Inspector.categoryaxis`).
//
// The list is derived here from the scene, so it cannot drift from the builder.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { dataAxisOf } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };

/** Which visual axis does the scene band? Read off the scene, never assumed. */
function bandedAxes(table: Parameters<typeof buildPlotScene>[0], plot: Plot): { x: boolean; y: boolean } {
  const s = buildPlotScene(table, plot, SIZE) as unknown as { x: { band?: boolean }; y: { band?: boolean } };
  return { x: !!s.x.band, y: !!s.y.band };
}

/**
 * Does `categoryGroups` on this data spec actually change the drawing?
 *
 * Group by an explicit `map` that merges two categories. Grouping by `columns[0]` would not
 * work: on box · violin · scatter · raincloud · floatingbar · histogram · before-after that column
 * is the category column — so it makes one group per category, which is a no-op, and those kinds
 * would read as "does not honour groups". A fixture that cannot exhibit the behaviour cannot
 * measure it.
 */
/**
 * Write the groups to the spec that carries the names, not the one named like the axis. A
 * horizontal bar chart draws its categories down Y but keeps them on `xAxis` (`dataAxisOf`).
 * Writing `yAxis` for the Y panel would never move the drawing on the "Ranked dots" card; written
 * to `xAxis`, groups draw correctly there.
 */
function groupsMove(table: Parameters<typeof buildPlotScene>[0], plot: Plot, axis: "x" | "y"): boolean {
  const s = buildPlotScene(table, plot, SIZE);
  const spec = dataAxisOf(plot, axis) === "x" ? "xAxis" : "yAxis";
  const cats = (axis === "x" ? s.x : s.y).ticks.filter((t) => !t.minor && t.label).map((t) => t.label);
  if (cats.length < 2) return false;
  const map: Record<string, string> = { [cats[0]!]: "G1", [cats[1]!]: "G1" };
  if (cats[2]) map[cats[2]] = "G2";
  const base = JSON.stringify(s);
  const next = JSON.stringify(buildPlotScene(table, {
    ...plot, [spec]: { ...(plot[spec] ?? {}), categoryGroups: { map, labelColor: true, separators: true, names: true } },
  } as Plot, SIZE));
  return next !== base;
}

/** Render the axis panel and report which sections/rows it offers. */
function axisPanel(table: Parameters<typeof buildPlotScene>[0], plot: Plot, axis: "x" | "y") {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "axis", axis } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null}
      onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }} />,
  );
  const text = (container.textContent ?? "");
  // Note: `SubSection` renders its title in a <summary> of `details.inspsub2`, not as a control
  // label — reading only `label > span` finds nothing and fails on `bar`, which plainly has the
  // section. Read the summaries too, and the section's own "Group by" row as the second signal.
  const summaries = [...container.querySelectorAll("details.inspsub2 > summary, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim());
  const rows = [...container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return {
    // The categorical branch names itself in its heading.
    isCategorical: /axis \(categories\)/i.test(text),
    hasGroups: summaries.some((l) => /category groups/i.test(l)) && rows.includes("Group by"),
  };
}

describe("the axis panel matches the axis the builder actually draws", () => {
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    const plot = item.plot as Plot;

    it(`${kind}: a banded axis gets the category panel, a continuous one does not`, () => {
      const banded = bandedAxes(item.table, plot);
      for (const axis of ["x", "y"] as const) {
        const p = axisPanel(item.table, plot, axis);
        expect(p.isCategorical, banded[axis]
          ? `${kind}: its ${axis} axis is banded (the scene says so) but the Inspector offers the continuous panel — scale and number format for an axis of names`
          : `${kind}: its ${axis} axis is continuous but the Inspector offers the category panel`).toBe(banded[axis]);
      }
    });

    it(`${kind}: the Category groups section appears exactly where groups move the drawing`, () => {
      for (const axis of ["x", "y"] as const) {
        const spec = dataAxisOf(plot, axis) === "x" ? "xAxis" : "yAxis";
        const moves = groupsMove(item.table, plot, axis);
        const p = axisPanel(item.table, plot, axis);
        expect(p.hasGroups, moves
          ? `${kind}: \`${spec}.categoryGroups\` changes the drawing but no Category groups control reaches it`
          : `${kind}: the ${axis} panel offers Category groups, but \`${spec}.categoryGroups\` moves nothing — a control that does nothing`).toBe(moves);
      }
    });
  }

  /**
   * Guards the guard. Both buckets must be non-empty on real fixtures, or every assertion above
   * is vacuous. The floors are loose on purpose: at least 14 kinds band an axis and at least 6
   * honour category groups, enough to catch a detector that finds (almost) nothing.
   */
  it("both measurements actually find something", () => {
    let banded = 0, groups = 0;
    for (const item of galleryItems()) {
      const plot = item.plot as Plot;
      const b = bandedAxes(item.table, plot);
      if (b.x || b.y) banded += 1;
      if (groupsMove(item.table, plot, "x") || groupsMove(item.table, plot, "y")) groups += 1;
    }
    expect(banded, "no kind bands an axis — the scene's `band` flag is gone").toBeGreaterThanOrEqual(14);
    expect(groups, "no kind honours categoryGroups — the detector is broken").toBeGreaterThanOrEqual(6);
  });
});
