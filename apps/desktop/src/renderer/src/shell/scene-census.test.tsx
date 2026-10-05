// @vitest-environment jsdom
/**
 * Scene census — default-deny over every element class the renderer can draw.
 *
 * This guards against a class of defect no behavioural test can catch: an interaction
 * decision that was never made. If nobody decides that an element (for example a network
 * link) should be clickable, no test asserts it, and the omission can pass every other check.
 * Tests encode intent; they cannot find intent that was never formed.
 *
 * So this file does not ask "does X work?". It asks "has a decision been recorded for X?".
 * Every field PlotScene declares must appear in CLASSIFICATION below as exactly one of:
 *   • interactive — a user can click it; the claimed selection must stay reachable (see the
 *                   note on that check — it is precise for unique selections, a reachability
 *                   guard for the shared `series`/`axis` families).
 *   • chrome      — deliberately not selectable, with the reason written down.
 *   • config      — never drawn (a number, a flag, a font), so there is nothing to click.
 *   • gap         — should be interactive and is not. Emitted as it.todo, so it stays counted
 *                   and visible instead of quietly passing (the repo's existing idiom).
 *
 * A new scene field fails this file until it is classified, so the decision becomes a
 * required, reviewed, searchable line of code.
 *
 * Note: this cannot tell whether a decision is correct — only that one was made. Every
 * `chrome` reason is a judgement that needs review; if a user would plausibly want to click
 * the element, `chrome` is the wrong answer.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PlotFigure } from "./PlotFigure";
import { FIX, buildFor } from "./plot-fixtures";

afterEach(cleanup);

type Entry =
  | { role: "interactive"; selects: string; note?: string }
  | { role: "chrome"; reason: string }
  | { role: "config"; reason: string }
  | { role: "gap"; want: string; ref: string };

/**
 * The decision table — one line per PlotScene field.
 *
 * Keep the reasons specific. A vague reason such as "computed sub-parts follow their parent"
 * can hide an element that users do expect to click (network links, for example).
 */
const CLASSIFICATION: Record<string, Entry> = {
  // ── the drawable data ──────────────────────────────────────────────────────
  series: { role: "interactive", selects: "series" },
  legend: { role: "interactive", selects: "series", note: "a legend row selects its series" },
  annotations: { role: "interactive", selects: "annotation" },
  atRisk: { role: "interactive", selects: "series", note: "a number-at-risk row selects its KM curve" },
  // An image panel's picture is not a data element: there is nothing inside it to select,
  // and its framing (fit / size / alt) is edited from the Inspector, not by clicking the
  // pixels. The panel itself is still selectable AS a panel in the figure assembler.
  image: { role: "chrome", reason: "a picture, not data — no sub-element to select; fit/alt are Inspector fields" },
  pie: { role: "interactive", selects: "pie-slice" },
  treemap: { role: "interactive", selects: "treemap-cell" },
  heatmap: { role: "interactive", selects: "heatmap-cell" },
  corrmatrix: { role: "interactive", selects: "corr-cell" },
  alluvial: { role: "interactive", selects: "alluvial-node" },
  network: { role: "interactive", selects: "network-node", note: "links select too → network-edge" },
  lollipop: { role: "interactive", selects: "series" },
  // Funnel region/contours are backdrop shading behind the study dots (which are ordinary
  // series marks and carry the interaction); the pooled line is a refline annotation.
  funnel: { role: "chrome", reason: "pseudo-CI shading + trim-and-fill imputed dots (no table row to click) — the study dots are series marks, the pooled/adjusted lines are registered reflines" },
  venn: { role: "interactive", selects: "venn-set" },
  // upset: set-size bars + matrix row labels select their set; the intersection bars are the
  // series' own marks (chart-section click — per-bar recolour is not offered).
  upset: { role: "interactive", selects: "upset-set" },
  // swimmer: a timeline bar selects the Start dataset's per-row point (its colour panel);
  // event glyphs are ordinary series marks.
  swimmer: { role: "interactive", selects: "series" },
  // rose: wedges are bins (many rows each — no data element to select); clicking one
  // opens the chart-section that owns sectors/bands/colour. Rings + direction labels are
  // the two axes' tick ladders.
  rose: { role: "interactive", selects: "chart-section" },
  // tracks: a tile strip is a whole column (not a styled point series) — clicking one opens
  // the chart-section that owns the track layout + colours; categorical legend rows do too.
  tracks: { role: "interactive", selects: "chart-section" },
  // sunburst: a ring segment is a bin (an aggregated hierarchy node, many rows) — clicking one
  // opens the Chart type chart-section that owns the levels/value/colour controls.
  sunburst: { role: "interactive", selects: "chart-section" },
  // chord: a node arc / ribbon is an aggregate (a node's total weight / a pair's weight) — no
  // per-row object; clicking one opens the Chart type chart-section that owns its controls.
  chord: { role: "interactive", selects: "chart-section" },
  // oncoprint: a tile is an aggregated (gene × sample) cell — no per-row object; clicking one
  // opens the Chart type chart-section that owns the sort/colour controls.
  oncoprint: { role: "interactive", selects: "chart-section" },
  // ternary: the edge titles (= composition column names) click through to their column's
  // series/Data panel, drag via onMoveTernaryAxisLabel and rename their column on
  // double-click; the triangle/ticks/grid stay pure furniture and the points are series marks.
  ternary: { role: "interactive", selects: "series" },
  paireddot: { role: "interactive", selects: "series" },
  bubbleLegend: { role: "interactive", selects: "bubble-legend" },

  // ── axes ──────────────────────────────────────────────────────────────────
  x: { role: "interactive", selects: "axis" },
  y: { role: "interactive", selects: "axis" },
  categoryGroups: { role: "interactive", selects: "axis", note: "a category-group name is draggable (onMoveCategoryGroupName) and clicking it selects the axis that owns the grouping. Its text is a column value (renamed in the datasheet like any tick label) or, with Group by ▸ By hand, typed in the Axis tab's boxes — never edited on canvas, so there is deliberately no edit callback, consistent with axisLabels below" },
  y2: { role: "chrome", reason: "a secondary value axis is drawn by the same AxisScene path as x/y and is reached through the same axis selection; it has no element of its own" },
  y3: { role: "chrome", reason: "as y2 — a third value axis, same drawing path" },

  // ── text: edited in place, so it yields no GraphSelection ──────────────────
  title: { role: "chrome", reason: "text is dragged + double-click-edited in place rather than 'selected'; the direct-manipulation contract asserts both for every kind (PlotFigure.matrix.test.tsx)" },
  subtitle: { role: "chrome", reason: "as title — the contract test asserts every kind renders and edits it" },
  footer: { role: "chrome", reason: "as title — a free caption, edited in place" },
  significanceCaption: { role: "chrome", reason: "a generated caption describing the significance threshold — a readout of plot.significance, styled in that panel. Draggable in place (onMoveSignificanceCaption) like the title/subtitle; its text is derived from the ladder, so there is no edit callback" },
  significanceCaptionStyle: { role: "config", reason: "the caption's resolved size/family/weight/colour + persisted drag offset — numbers and flags, set in the Significance panel" },
  zoneLegend: { role: "chrome", reason: "a derived key for the shaded zone bands — one row per labelled band (its fill + caption). Its rows are edited on each band (label + colour in the annotation editor); its on/off + corner is the Annotations panel 'Zone key' select. Nothing on the key itself is a distinct selection target, so it yields no GraphSelection" },

  // ── computed overlays whose position IS data ──────────────────────────────
  // A fitted curve's shape is the analysis output and cannot be moved or reshaped, but its
  // look can: clicking the curve or a band opens the "Fitted curve" section (colour, thickness,
  // dashes, opacity, band fills, show); the EC50/IC50 crosshair is a reference line
  // (`fit-marker`) with its own panel.
  fit: { role: "interactive", selects: "chart-section", note: "curve + bands → the Fitted curve section; the marker → refline fit-marker; the label stays separately draggable (onMoveFitLabel)" },
  fits: { role: "interactive", selects: "chart-section", note: "as fit — the multi-fit form" },
  ellipses: { role: "chrome", reason: "a confidence ellipse is computed from the points it encloses; dragging it would assert a covariance the data does not have. Toggled/styled in the Confidence-ellipse panel" },
  forestSummary: { role: "interactive", selects: "series", note: "clicking the pooled summary selects seriesStyles['forest-summary'] — its own panel, headed by name, with a link switch to the studies. Its position and width stay data: xLo/xHi are the pooled CI" },
  spreadBand: { role: "chrome", reason: "derived from the series it spans (mean ± spread) — no independent position" },
  paretoLine: { role: "chrome", reason: "the Pareto cumulative-% line is a readout of the bars (their running total in the drawn order, on the Y2 axis) — it cannot be moved without misrepresenting the bars. Toggled + recoloured in the bar 'Chart type' block (Cumulative % line + Line colour); a click on it routes there (chart-section). Off by default, so no fixture-by-kind draws it — an 'interactive' classification would fail the render-on-some-kind check" },
  distributionCurves: { role: "chrome", reason: "opt-in curves fitted to a histogram (the normal fit from the data's mean/SD; the kernel density estimate), scaled to the bars. Their shape is the fit and cannot be moved; they are toggled + recoloured in the histogram 'Chart type' panel (Normal curve / Density curve + colour + Smoothness), like spreadBand, and a click on a curve routes there (chart-section). Off by default, so no fixture draws them — an 'interactive' classification would fail the render-on-some-kind check" },
  valueLabels: { role: "chrome", reason: "a bar's value label is a readout of its datum. It is individually draggable (onMoveValueLabel) and that drag is proven end-to-end by e2e/dead-affordance.spec.ts; it is not a selection target" },

  parallel: { role: "interactive", selects: "parallel-line", note: "a data polyline selects its row → per-line recolour" },
  colorbar: { role: "interactive", selects: "colorbar", note: "the value colour scale selects itself → its title is editable. A colour bar that is drag-only (onMove but no onSelect) leaves its title uneditable" },

  // Both are data and both select. Claiming `interactive` here is not only a label: it makes
  // the check below render every kind that draws the field and assert the click, so the
  // handlers are proven rather than assumed.
  radar: { role: "interactive", selects: "series", note: "a radar polygon selects its series; the spokes/rings stay chrome" },
  scatter3d: { role: "interactive", selects: "series", note: "a 3-D point selects its series — the click is distinguished from the camera-orbit drag by draggedRef" },

  // ── geometry / config: nothing drawn that a user could click ───────────────
  width: { role: "config", reason: "figure size in px" },
  height: { role: "config", reason: "figure size in px" },
  background: { role: "config", reason: "the paper colour, set in the Background panel" },
  backdrop: { role: "config", reason: "the opt-in decorative gradient/wave backdrop, set in the Background panel" },
  plot: { role: "config", reason: "the plot rect (numbers)" },
  auto: { role: "config", reason: "auto-computed axis domains, reported so the Inspector can show 'auto'" },
  grid: { role: "chrome", reason: "grid lines are a backdrop styled in the Frame panel — a per-line selection is not offered: it would be noise" },
  axisStyle: { role: "config", reason: "frame / tick direction / tick length" },
  axisBands: { role: "chrome", reason: "user-specified {from,to} shaded strips in data coordinates (Axis tab → Shaded bands) — a 'normal range' backdrop behind the data. Nothing alternates or is per-category: that is categoryGroups' block tint, which is a separate field" },
  scaleBars: { role: "chrome", reason: "drawn scale bars that replace an axis; styled through the axis panel" },
  legendLayout: { role: "config", reason: "resolved legend placement (numbers/enums)" },
  titleOffset: { role: "config", reason: "the persisted heading drag offset (moves the title + subtitle as a block)" },
  subtitleOffset: { role: "config", reason: "the subtitle's own drag offset, stacked on titleOffset — the subtitle is drag/edit-only text, so it yields no selection (its drag is proven by the e2e tests)" },
  legendOffset: { role: "config", reason: "the persisted legend drag offset" },
  colorbarOffset: { role: "config", reason: "the persisted colour-bar drag offset (reused by the survival at-risk table + bubble size legend)" },
  titleAlign: { role: "config", reason: "an enum" },
  barShape: { role: "config", reason: "an enum" },
  barHorizontal: { role: "config", reason: "a flag" },
  barsPerBand: { role: "config", reason: "a number — how many bars share a category band; the edge-drag width-resize divisor" },
  barGroupLabels: { role: "chrome", reason: "computed outer-group labels on a three-way bar (a second category-label row); the group name is edited in the Inspector's Bar groups section, not by clicking the label" },
  distHorizontal: { role: "config", reason: "a flag" },
  axisGaps: { role: "config", reason: "resolved axis-break geometry (numbers)" },
  axisLabels: { role: "chrome", reason: "tick labels are data (renamed via the datasheet, not the canvas) — a documented cross-cutting limit that applies to every kind" },
  kind: { role: "config", reason: "the PlotKind discriminator" },
  fonts: { role: "config", reason: "resolved font specs" },
  warnings: { role: "config", reason: "builder diagnostics, surfaced as a note rather than drawn on the canvas" },
  valueAxis: {
    role: "config",
    reason:
      "which visual axis carries values — an enum the renderer reads to invert a bracket height / endpoint drag on a transposed chart. Nothing is drawn from it, and it must come from the builder rather than isTransposedPlot, which disagrees for lollipop",
  },
  zoomable: {
    role: "config",
    reason:
      "which axes the builder honours a domain override on, and the GraphView key each reports through. Not drawn — it gates the wheel/drag gesture. It comes from the builder rather than a list in the renderer: a list can withhold zoom from an axis that supports it, or promise the gesture on a builder that ignores the override, where the drag lands and the picture never moves. The declaration describes the builder, and zoomable.test.ts holds the two halves together",
  },
};

/**
 * The ground truth is the type, not the fixtures. Fields that only appear when configured
 * (atRisk, fit, ellipses, titleOffset…) are emitted by no default fixture — gating on fixture
 * output would let exactly those escape unclassified, which is the opposite of default-deny.
 * So read PlotScene's declared fields straight from the source.
 */
const SCENE_KEYS: string[] = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "../../../../../../packages/graphics/src/scene.ts"), "utf8");
  const m = /export interface PlotScene \{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error("scene census: could not find `export interface PlotScene` — update the path/regex");
  return [...m[1]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((x) => x[1]!);
})();

/** Which fixture kinds actually emit each field (drives the probes + better messages). */
const DRAWN_BY = new Map<string, string[]>();
for (const fx of FIX) {
  const scene = buildFor(fx) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(scene)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue; // present but empty → nothing drawn
    if (!DRAWN_BY.has(k)) DRAWN_BY.set(k, []);
    DRAWN_BY.get(k)!.push(fx.kind);
  }
}

/**
 * Every GraphSelection kind reachable by clicking something on a given kind's figure.
 *
 * Discovered, not hand-written: click everything the renderer marks clickable and collect what
 * comes back. Hand-written selectors are unreliable here — "the first rect with
 * cursor:pointer" is the axis hit-rect, so `series` would look unreachable on every kind.
 */
function reachableSelections(kindName: string): Set<string> {
  const fx = FIX.find((f) => f.kind === kindName)!;
  const onSelect = vi.fn();
  const { container } = render(
    <PlotFigure scene={buildFor(fx)} selected={null} onSelect={onSelect} onMoveLegend={() => {}} onMoveAnnotation={() => {}} onMoveColorbar={() => {}} onEditText={() => {}} />,
  );
  // `pointer` is not enough: a group can be both draggable and clickable (the bubble size
  // legend is cursor:move and selects itself on click), so a pointer-only filter would report
  // it as unreachable. Take every cursor that implies "you can grab or press
  // this", plus the annotation/edge handles which carry their identity in a data attribute.
  const targets = [...container.querySelectorAll("*")].filter(
    (e) =>
      /^(pointer|move|grab)$/.test((e as unknown as SVGElement).style?.cursor ?? "") ||
      e.hasAttribute("data-ann-shape") ||
      e.hasAttribute("data-ann-text") ||
      e.hasAttribute("data-edge-id"),
  );
  for (const t of targets) {
    // Some elements select on pointerdown (network nodes), others on click — drive both.
    fireEvent.pointerDown(t);
    fireEvent.pointerUp(t);
    fireEvent.click(t);
  }
  const kinds = new Set(onSelect.mock.calls.map((c) => (c[0] as { kind?: string } | null)?.kind).filter(Boolean) as string[]);
  cleanup();
  return kinds;
}

describe("scene census — every element class must have a decision recorded", () => {
  it("classifies every field PlotScene declares (a new one fails until it is classified)", () => {
    const unclassified = SCENE_KEYS.filter((k) => !CLASSIFICATION[k]).map(
      (k) => `${k}${DRAWN_BY.has(k) ? `  (drawn by: ${DRAWN_BY.get(k)!.slice(0, 4).join(", ")})` : "  (no fixture exercises it)"}`,
    );
    expect(
      unclassified,
      "These scene fields exist but nobody has decided whether a user can interact with them. Add each to " +
        "CLASSIFICATION as interactive (naming the selection it yields) / chrome or config (with a reason) / gap (with what it should do):\n  - " +
        unclassified.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });

  it("does not carry classifications for fields PlotScene does not declare", () => {
    const declared = new Set(SCENE_KEYS);
    const stale = Object.keys(CLASSIFICATION).filter((k) => !declared.has(k));
    expect(stale, `CLASSIFICATION describes fields that are not on PlotScene — delete them:\n  - ${stale.join("\n  - ")}\n`).toEqual([]);
  });

  /**
   * Note: scope of this check.
   *
   * It drives a click over everything clickable on a kind that draws the field, and asserts
   * the claimed selection comes back. For a field whose `selects` is unique to it
   * (pie-slice · treemap-cell · heatmap-cell · corr-cell · alluvial-node · network-node ·
   * bubble-legend · annotation) nothing else can produce that value, so this is a precise
   * proof of that field.
   *
   * For the shared families it is not. `series` is claimed by series/legend/atRisk/lollipop/
   * paireddot, and `axis` by x and y — and they co-occur on the same figures, so a click on a
   * data point satisfies the legend's claim. Removing the legend's click-to-select entirely
   * does not fail this file.
   *
   * That per-element proof lives where it can be precise — the direct-manipulation contract
   * ("legend rows select their series", auto-enrolled per multi-series kind, in
   * PlotFigure.matrix.test.tsx), which the same removal fails on xy/area/bar/pyramid.
   * So this check is a reachability guard (the selection kind still works somewhere on that
   * figure) and the classification gate above is this file's main job. Isolating by kind
   * does not work here: it only produces false failures, because x/y and the series family
   * are never drawn apart.
   */
  for (const key of SCENE_KEYS) {
    const entry = CLASSIFICATION[key];
    if (!entry || entry.role !== "interactive") continue;
    const kinds = DRAWN_BY.get(key) ?? [];
    if (kinds.length === 0) continue; // unexercised — the coverage test above fails on it
    it(`${key}: its selection ("${entry.selects}") is still reachable by clicking`, () => {
      const ok = kinds.some((k) => reachableSelections(k).has(entry.selects));
      expect(
        ok,
        `${key} is classified interactive (selects "${entry.selects}") but on none of the kinds that draw it ` +
          `(${kinds.join(", ")}) did clicking anything produce that selection. Either the click handling broke, or the ` +
          "classification is wrong.",
      ).toBe(true);
    });
  }

  it("leaves no interactive claim unproven (every one must be exercised by a fixture)", () => {
    const unproven = SCENE_KEYS.filter((k) => CLASSIFICATION[k]?.role === "interactive" && !DRAWN_BY.has(k));
    // This fails rather than warns. An "interactive" claim that no fixture draws is an
    // unchecked claim, which this file exists to prevent. A console.warn would not do:
    // vitest swallows console output, so the warning would never be seen.
    expect(
      unproven,
      "These fields are claimed interactive but no fixture draws them, so the claim is untested. " +
        "Give plot-fixtures.ts the data that makes them render, or reclassify them to match what is drawn:\n  - " +
        unproven.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });

  // Known gaps stay visible and counted, each as a todo, rather than passing quietly. Closing
  // one means deleting its entry and giving it an `interactive` claim.
  for (const key of SCENE_KEYS) {
    const entry = CLASSIFICATION[key];
    if (!entry || entry.role !== "gap") continue;
    it.todo(`${key}: ${entry.want} — open (${entry.ref})`);
  }
});
