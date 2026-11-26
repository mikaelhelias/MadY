// @vitest-environment jsdom
/**
 * Contract guard for the interactive HTML export's series-toggle.
 *
 * The runtime hides a series by matching a legend row's `data-mady-series` against the
 * mark group's `data-mady-series`. That toggle therefore works for a chart kind only if
 * both hooks are present and agree. bar / box / violin / scatter / area all render
 * through the shared `<g class="gfx-series">` group, so tagging that group once covers
 * them — this test locks that in so a renderer refactor can't silently un-tag a kind
 * (which would break the export's toggle with no other test noticing).
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import { PlotFigure } from "./PlotFigure";
import { buildFor, FIX } from "./plot-fixtures";

afterEach(cleanup);

function markup(kind: string) {
  const fx = FIX.find((x) => x.kind === kind);
  if (!fx) throw new Error(`no fixture for ${kind}`);
  const scene = buildFor(fx);
  const { container } = render(
    <PlotFigure scene={scene} selected={null} onSelect={() => {}} onMoveLegend={() => {}} onMoveAnnotation={() => {}} onMoveColorbar={() => {}} onEditText={() => {}} />,
  );
  return { container, seriesIds: new Set(scene.series.map((s) => s.id)) };
}

describe("interactive-export toggle hooks", () => {
  // Every Cartesian series kind must tag its mark group so the export can hide it.
  for (const kind of ["bar", "box", "violin", "scatter", "area"]) {
    it(`${kind}: every gfx-series group carries a data-mady-series matching a real series id`, () => {
      const { container, seriesIds } = markup(kind);
      const groups = [...container.querySelectorAll("g.gfx-series")];
      expect(groups.length, `${kind} drew no series groups`).toBeGreaterThan(0);
      for (const g of groups) {
        const tag = g.getAttribute("data-mady-series");
        expect(tag, `${kind}: a gfx-series group is untagged`).toBeTruthy();
        expect(seriesIds.has(tag!), `${kind}: data-mady-series "${tag}" is not a real series id`).toBe(true);
      }
    });
  }

  it("grouped bar: legend rows resolve to the same series ids the mark groups use", () => {
    // The grouped-bar fixture emits a series legend (Baseline / Treated); each row must
    // carry the series id whose group it toggles — otherwise a legend click is a no-op.
    const { container, seriesIds } = markup("bar");
    const rows = [...container.querySelectorAll("[data-mady-legend]")];
    expect(rows.length, "grouped bar drew no legend rows").toBeGreaterThan(0);
    const rowIds = rows.map((r) => r.getAttribute("data-mady-series"));
    for (const id of rowIds) expect(seriesIds.has(id!), `legend row id "${id}" is not a series`).toBe(true);
    // and the two sides actually overlap (the click has a group to hide)
    const groupIds = new Set([...container.querySelectorAll("g.gfx-series")].map((g) => g.getAttribute("data-mady-series")));
    for (const id of rowIds) expect(groupIds.has(id), `no gfx-series group for legend id "${id}"`).toBe(true);
  });

  it("a legend row is only tagged when it resolves to a series (no dangling toggle targets)", () => {
    // box/violin here have their categories on the axis, not in a legend, so they emit no
    // legend rows — and must not emit stray data-mady-legend hooks that would toggle nothing.
    for (const kind of ["box", "violin"]) {
      const { container } = markup(kind);
      for (const r of container.querySelectorAll("[data-mady-legend]")) {
        expect(r.getAttribute("data-mady-series"), `${kind}: a legend hook with no series id`).toBeTruthy();
      }
    }
  });
});
