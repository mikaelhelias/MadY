// @vitest-environment jsdom
/**
 * Clicking an axis title opens that axis' panel — on every graph that draws one.
 *
 * A click on the X or Y axis title opens the side panel's Axis tab at that axis' own
 * section (X axis or Y axis), on every graph where X and Y axis titles are present.
 *
 * The axis line and its tick labels open the Axis panel too. Guards against the title — the
 * element a user aims at to rename or restyle an axis — falling through to the <svg> root and
 * selecting the whole plot, which opens the graph Title / Subtitle / footer fields instead.
 * `{ kind: "axis", axis }` is all that is needed: `Inspector`'s `derivedTab` maps that
 * selection to the Axis rail tab, and `AxisPanel` renders the sub-part for `selection.axis`.
 *
 * Default-deny, driven from the gallery. It sweeps every chart kind and asks the scene which
 * titles exist, so a new kind that draws an axis title is covered as soon as it is added — no
 * hand-written list to go stale. Titles are found by their text + rotation, never by index
 * (picking "the last <line>" by index can match a legend stub instead).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W } from "./figureFit";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

const SIZE = { width: FIGURE_DEFAULT_W, height: FIGURE_DEFAULT_H };

/**
 * Kinds whose axis title must not select an axis, each with the reason. Checked in both
 * directions below, so an excuse cannot go stale.
 */
const NO_AXIS_PANEL: Record<string, string> = {
  // Inspector.tsx: `hasAxes = !["pie","radar","scatter3d"]` — the 3-D scatter has no Axis rail
  // tab at all (its three axes are a projection, not editable AxisSpecs), so selecting one
  // would pin a tab that does not exist. Pie and radar draw no axis titles in the first place.
  scatter3d: "no Axis tab — its axes are a projection, not editable AxisSpecs",
};

/** The <text> element drawing an axis title: matched by its text and its rotation. */
function titleEl(container: HTMLElement, text: string, rotated: boolean): SVGTextElement[] {
  return [...container.querySelectorAll("text")].filter((t) => {
    if ((t.textContent ?? "").trim() !== text.trim()) return false;
    const tr = t.getAttribute("transform") ?? "";
    // Caution: `rotate(-90` without the closing paren. The main figure writes `rotate(-90)` but
    // `DraggableTitle` writes `rotate(-90 <x> <y>)`, so matching the paren would find no
    // y titles on lollipop and paired dot, and the failure would look like an app bug.
    return rotated ? tr.includes("rotate(-90") : !tr.includes("rotate(-90");
  }) as unknown as SVGTextElement[];
}

/** Click it the two ways a user can: a plain click, and a press-release with no movement
 *  (which is what `DraggableTitle` listens for). */
function clickIt(el: Element): void {
  fireEvent.pointerDown(el, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(el, { clientX: 10, clientY: 10 });
  fireEvent.click(el, { clientX: 10, clientY: 10 });
}

interface Case { key: string; kind: string; axis: "x" | "y"; title: string; rotated: boolean; plot?: Plot }

/** Every (card × axis) that actually draws a title — asked of the built scene, not a list. */
const CASES: Case[] = galleryItems().flatMap((g) => {
  const kind = g.plot.kind ?? "xy";
  const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
  const out: Case[] = [];
  if (s.x.title.trim()) out.push({ key: g.key, kind, axis: "x", title: s.x.title, rotated: false, plot: g.plot as Plot });
  if (s.y.title.trim()) out.push({ key: g.key, kind, axis: "y", title: s.y.title, rotated: true, plot: g.plot as Plot });
  return out;
});

/**
 * Note: a fixture that cannot exhibit the behaviour cannot guard it. The heatmap card names
 * neither axis, so the sweep above never reaches the heatmap's two title sites (disabling them
 * makes nothing fail). These cases give it titles, in both of its modes: matrix (the card's
 * default) and point, which are separate render paths with separate titles.
 */
const HEATMAP_EXTRA: Case[] = (() => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "heatmap");
  if (!g) return [];
  const out: Case[] = [];
  for (const mode of ["matrix", "point"] as const) {
    const plot = { ...g.plot, heatmap: { ...(g.plot.heatmap ?? {}), mode }, xAxis: { title: `Column (${mode})` }, yAxis: { title: `Row (${mode})` } } as Plot;
    const s = buildPlotScene(g.table, plot, SIZE);
    if (s.x.title.trim()) out.push({ key: `heatmap:${mode}`, kind: "heatmap", axis: "x", title: s.x.title, rotated: false, plot });
    if (s.y.title.trim()) out.push({ key: `heatmap:${mode}`, kind: "heatmap", axis: "y", title: s.y.title, rotated: true, plot });
  }
  return out;
})();

describe("the sweep can exhibit the behaviour", () => {
  it("the heatmap cases actually draw titles — otherwise they guard nothing", () => {
    expect(HEATMAP_EXTRA.length, "no heatmap title case was built").toBeGreaterThan(1);
  });

  it("finds axis titles across many kinds, not just one", () => {
    expect(CASES.length, "no axis titles found at all — the sweep is measuring nothing").toBeGreaterThan(30);
    expect(new Set(CASES.map((c) => c.kind)).size, "only a couple of kinds draw titles?").toBeGreaterThan(15);
    expect(CASES.some((c) => c.axis === "x") && CASES.some((c) => c.axis === "y")).toBe(true);
  });

  it("the exempt list is accurate — every kind on it is a real gallery kind", () => {
    const kinds = new Set<string>(galleryItems().map((g) => String(g.plot.kind ?? "xy")));
    for (const k of Object.keys(NO_AXIS_PANEL)) expect(kinds.has(k), `${k} is not a chart kind`).toBe(true);
  });
});

describe("clicking an axis title selects that axis", () => {
  for (const c of [...CASES, ...HEATMAP_EXTRA]) {
    const exempt = NO_AXIS_PANEL[c.kind];
    it(`${c.key} · ${c.axis} axis ("${c.title}")${exempt ? " — refused" : ""}`, () => {
      const g = galleryItems().find((x) => x.key === c.key.split(":")[0])!;
      const onSelect = vi.fn<(s: GraphSelection) => void>();
      const scene = buildPlotScene(g.table, c.plot ?? (g.plot as Plot), SIZE);
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={onSelect} />);
      const els = titleEl(container, c.title, c.rotated);
      expect(els.length, `the ${c.axis} title "${c.title}" is not drawn once — found ${els.length}`).toBe(1);
      clickIt(els[0]!);
      const got = onSelect.mock.calls.map(([s]) => s);
      if (exempt) {
        expect(got.some((s) => s?.kind === "axis"), `${c.key} selects an axis but ${exempt}`).toBe(false);
        return;
      }
      expect(
        got,
        `clicking the ${c.axis} axis title on ${c.key} did not open its axis panel — it selected ${JSON.stringify(got)}`,
      ).toContainEqual({ kind: "axis", axis: c.axis });
    });
  }
});
