// @vitest-environment jsdom
/**
 * Selection → panel — clicking a thing must open a panel that can act on it.
 *
 * Other tests check that a click emits a selection (`scene-census`) and that a drag commits
 * (`e2e/dead-affordance.spec.ts`); this one checks where the Inspector then lands. The case it
 * guards against: a click on a heatmap data cell selects the cell but opens the Inspector on
 * **Data** — a tab that is greyed for matrix heatmaps and whose pane is a read-only readout ending
 * in "…are in the Heatmap panel (click the chart background)". The click would work and the
 * selection be real, yet the user would be sent somewhere else.
 *
 * The rule: `activeTab` must never resolve to a tab that is disabled for the current chart kind.
 * `deadRailTabs` is internal to Inspector, so the disabled set is measured from a neutral
 * `{kind:"plot"}` render (where disabled tabs carry `.disabled`) rather than imported — the
 * check needs no production change to run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";
import { galleryItems } from "./gallery";

afterEach(cleanup);

function handlers() {
  return {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
}

function show(plot: Plot, table: DataTable, selection: GraphSelection) {
  return render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers()} />,
  );
}

/** Rail tabs that render greyed for this plot — measured with a neutral selection. */
function deadTabs(plot: Plot, table: DataTable): Set<string> {
  const { container } = show(plot, table, { kind: "plot" });
  const dead = new Set<string>();
  for (const b of container.querySelectorAll<HTMLButtonElement>(".inspcat")) {
    if (b.classList.contains("disabled")) dead.add((b.textContent ?? "").trim());
  }
  cleanup();
  return dead;
}

/** The rail tab currently shown as active. */
function activeTab(container: HTMLElement): string {
  const on = [...container.querySelectorAll<HTMLButtonElement>(".inspcat")].find((b) => b.classList.contains("on"));
  return (on?.textContent ?? "").trim();
}

/**
 * Enabled, writable controls in the visible panel body — a pane with none is a dead end.
 *
 * Note: must be scoped to a visible `.inspsec` (or a bespoke editor's own rows). Counting every
 * control in the render, including the rail buttons and the search box, would score a
 * completely empty pane as healthy — e.g. the heatmap cell routed to the Chart tab while the
 * body still shows a read-only readout.
 */
function liveControls(container: HTMLElement): number {
  const visible = [...container.querySelectorAll<HTMLElement>(".inspsec")].filter((s) => !s.hidden);
  const scopes: HTMLElement[] = visible.length ? visible : [...container.querySelectorAll<HTMLElement>(".insphd")].map((h) => h.parentElement!).filter(Boolean);
  return scopes
    .flatMap((s) => [...s.querySelectorAll<HTMLElement>("input, select, textarea, button.swbtn, button.btn-mini")])
    .filter((el) => !(el as HTMLInputElement).disabled)
    .length;
}

/**
 * Selections a user can produce per chart kind. Only kinds whose element genuinely exists are
 * listed; the point is the routing, so one representative element per kind is enough.
 */
const CASES: { key: string; selection: GraphSelection; what: string }[] = [
  { key: "heatmap", selection: { kind: "heatmap-cell", row: 0, col: 0 }, what: "a heatmap data cell" },
  { key: "corrmatrix", selection: { kind: "corr-cell", row: 0, col: 1 }, what: "a correlation cell" },
  { key: "treemap", selection: { kind: "treemap-cell", cellId: "c0" }, what: "a treemap cell" },
  { key: "pie", selection: { kind: "pie-slice", datasetId: "s0" }, what: "a pie slice" },
];

describe("selection → panel — a click must open a panel that can act on what was clicked", () => {
  const items = galleryItems();

  for (const c of CASES) {
    const item = items.find((i) => (i.plot.kind ?? "xy") === c.key);

    it(`${c.key}: clicking ${c.what} lands on a live tab, not a greyed one`, () => {
      expect(item, `no gallery item for ${c.key}`).toBeTruthy();
      const dead = deadTabs(item!.plot, item!.table);
      const { container } = show(item!.plot, item!.table, c.selection);
      const tab = activeTab(container);
      expect(
        dead.has(tab),
        `clicking ${c.what} opens the "${tab}" tab, which is greyed out for this chart kind ` +
          `(dead: ${[...dead].join(", ") || "none"}). A click must never route the user to a tab that cannot act.`,
      ).toBe(false);
    });

    it(`${c.key}: the panel opened by ${c.what} offers at least one usable control`, () => {
      const { container } = show(item!.plot, item!.table, c.selection);
      expect(
        liveControls(container),
        `the panel opened by clicking ${c.what} contains no editable control — it is a read-only dead end`,
      ).toBeGreaterThan(0);
    });
  }
});
