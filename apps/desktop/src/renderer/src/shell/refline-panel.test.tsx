// @vitest-environment jsdom
/**
 * The builder-made reference lines: click one, get a panel, and the edit reaches the drawing.
 *
 * These lines share one mechanism across several kinds:
 *   • Bland-Altman: the horizontal threshold lines must be selectable and restylable.
 *   • PCA biplot: the dashed origin line must open a proper panel when clicked.
 *   • ROC curve: the grey dashed diagonal must open a working panel (and the same for the
 *     paired dot's dividers).
 *
 * Guards against: a click on a Bland-Altman limit, a PCA origin line, the forest no-effect
 * line, the pyramid centre, a volcano threshold or the estimation zero line selecting
 * `{kind:"annotation"}` for an id with no entry in `plot.annotations`, which leaves a panel with
 * no controls; the ROC diagonal opening a Data panel whose writes go to
 * `seriesStyles["roc-diag"]`, which the ROC builder does not read; and the paired-dot dividers
 * ignoring clicks (`pointerEvents:"none"`).
 *
 * Note: every case here ends at the drawing. A panel that writes a field no builder reads looks
 * exactly like one that works, and that is the defect this file exists to catch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { REFERENCE_LINES, referenceLinesFor } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 620, height: 420 };
/**
 * The EC50 / IC50 marker exists only once a fit with a potency estimate is attached, and no
 * gallery card ships one — so the XY case carries the fit an Analyze → Dose-response run would
 * have written (`setPlotFit`), on the gallery's own dose-response table (doses 0.1 … 100).
 * Without it every fit-marker assertion below would be vacuous.
 */
const XY_FIT: Partial<Plot> = {
  fit: {
    label: "Dose-response (4PL)",
    points: [[0.1, 5], [0.3, 8], [1, 20], [3, 50], [10, 80], [30, 92], [100, 95]],
    marker: { x: 3, y: 50, label: "EC50 = 3" },
  },
  // The line of identity is opt-in (`present: showIdentity`), so the xy fixture must turn it on
  // — exactly as `fit` above makes the conditional fit-marker present — or every identity
  // assertion below would be vacuous. The gallery xy card is a dose-response whose X auto-picks
  // a log scale; a y = x line only draws when both axes share a scale type, so the fixture pins
  // X to linear (linear/linear) to exhibit it. The fit-marker (dose x = 3) still draws on linear.
  showIdentity: true,
  xAxis: { scale: "linear" },
};
/**
 * The trim-and-fill adjusted line is opt-in (`present: funnel.trimFill`), so the funnel
 * fixture must turn the overlay on — the identity/fit precedent above. The gallery
 * funnel table's lopsided odds-ratio cloud imputes k0 = 1 in log space, so the line
 * really draws (the "guarding the guard" block below asserts exactly that).
 */
const FUNNEL_TF: Partial<Plot> = { funnel: { trimFill: true } };
const item = (kind: string) => galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
const plotFor = (kind: string, over: Partial<Plot> = {}): Plot =>
  ({ ...item(kind).plot, ...(kind === "xy" ? XY_FIT : {}), ...(kind === "funnel" ? FUNNEL_TF : {}), ...over }) as Plot;
const build = (kind: string, over: Partial<Plot> = {}) => buildPlotScene(item(kind).table, plotFor(kind, over), SIZE);

/** Every line in the registry, with a gallery chart that draws it. */
const CASES = REFERENCE_LINES.map((r) => ({ ...r, kind: r.kinds[0]! }));

// ─────────────────────────────────────────────────────────────────────────────
// 1. The fixture can exhibit the behaviour: each line is actually drawn.
// ─────────────────────────────────────────────────────────────────────────────
describe("guarding the guard — every registry line is really on its chart", () => {
  for (const c of CASES) {
    it(`${c.kind} draws ${c.id}`, () => {
      const scene = build(c.kind);
      const drawn =
        c.id === "roc-diag" || c.id === "qq-identity" ? scene.series.some((s) => s.id === c.id)
        : c.id === "pd-section" ? (scene.paireddot?.sections ?? []).some((s) => s.divider)
        : c.id === "fit-marker" ? !!scene.fit?.marker
        : scene.annotations.some((a) => a.id === c.id);
      expect(drawn, `${c.kind} never draws ${c.id} — every assertion below would be vacuous`).toBe(true);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Clicking the line selects it as a reference line.
// ─────────────────────────────────────────────────────────────────────────────
describe("clicking one selects it", () => {
  /** Click every element of the figure; collect the refline ids it emitted. */
  const refIdsFromClicks = (kind: string): string[] => {
    const scene = build(kind);
    const got: string[] = [];
    const { container } = render(
      <PlotFigure scene={scene} zoom={1} onSelect={(s) => { if (s && (s as { kind: string }).kind === "refline") got.push((s as { id: string }).id); }} />,
    );
    for (const el of container.querySelectorAll("path, circle, rect, text, polygon, line, g")) fireEvent.click(el);
    cleanup();
    return [...new Set(got)];
  };

  for (const kind of [...new Set(CASES.map((c) => c.kind))]) {
    it(`${kind}: every line it draws is reachable by clicking`, () => {
      const want = referenceLinesFor(kind as Plot["kind"], plotFor(kind)).map((r) => r.id).sort();
      expect(refIdsFromClicks(kind).sort()).toEqual(want);
    });
  }

  it("an XY graph with no fit lists no EC50 / IC50 marker — the registry entry is conditional", () => {
    // The control case for `present`: the marker must not be promised on a fit-less graph.
    expect(referenceLinesFor("xy", { fit: undefined }).map((r) => r.id)).toEqual([]);
    // With the fixture's fit + opted-in identity, both conditional xy lines are present (registry
    // order: identity precedes the fit-marker). The no-fit case above still proves fit-marker is gated.
    expect(referenceLinesFor("xy", plotFor("xy")).map((r) => r.id)).toEqual(["identity", "fit-marker"]);
  });

  it("an ordinary annotation still selects as an annotation — this is a routing test, not a blanket rewrite", () => {
    // The control case. Without it, "everything emits refline" would pass the block above.
    const scene = build("blandaltman", { annotations: [{ id: "free", kind: "text", x: 0.5, y: 0.5, label: "note" }] });
    const got: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => got.push(s)} />);
    fireEvent.click(container.querySelector('[data-ann="free"]')!);
    expect(got).toEqual([{ kind: "annotation", id: "free" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The panel is the reference-line panel, and it is not a dead end.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void, onSelect = vi.fn()) => ({
  onSelect,
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(kind: string, sel: GraphSelection, plotOver: Partial<Plot> = {}) {
  const g = item(kind);
  const patches: Partial<Plot>[] = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={sel} plot={plotFor(kind, plotOver)} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p))} />,
  );
  return { container, patches };
}

/** The control on the `.frow` whose own label is exactly `label`. */
function control<T extends HTMLElement = HTMLInputElement>(container: HTMLElement, label: string): T | undefined {
  for (const row of container.querySelectorAll<HTMLElement>(".frow")) {
    const span = row.querySelector(":scope > span");
    if ((span?.textContent ?? "").trim() !== label) continue;
    const el = row.querySelector<T>("input, select");
    if (el) return el;
  }
  return undefined;
}

describe("the panel", () => {
  for (const c of CASES) {
    it(`${c.id}: names the line and offers colour, thickness and dashes`, () => {
      const { container } = panel(c.kind, { kind: "refline", id: c.id });
      expect(container.textContent, `${c.id}: the panel does not name the line`).toContain(c.name);
      // The dead end a builder-owned line must never show.
      expect(container.textContent).not.toContain("This annotation was removed");
      expect(control(container, "Colour"), `${c.id}: no colour control`).toBeDefined();
      expect(control(container, "Thickness"), `${c.id}: no thickness control`).toBeDefined();
      expect(control<HTMLSelectElement>(container, "Dashes"), `${c.id}: no dash control`).toBeDefined();
      expect(control(container, "Show"), `${c.id}: no show switch`).toBeDefined();
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. …and the edit reaches the drawing. The half that matters.
// ─────────────────────────────────────────────────────────────────────────────
/** How the line is actually drawn, whichever layer draws it. */
function drawn(scene: ReturnType<typeof build>, id: string): { color: string | null; dash: string | null; width: number } | undefined {
  if (id === "roc-diag" || id === "qq-identity") {
    // Both are drawn through the series layer (they need a line path) but answer to the
    // reference-line panel and `refLineStyles` keys — the roc-diag precedent.
    const s = scene.series.find((x) => x.id === id);
    return s ? { color: s.color, dash: s.dash, width: s.lineWidth } : undefined;
  }
  if (id === "pd-section") {
    const pd = scene.paireddot;
    if (!pd || !pd.sections.some((s) => s.divider)) return undefined;
    return { color: pd.sectionColor ?? null, dash: pd.sectionDash, width: pd.sectionWidth };
  }
  if (id === "fit-marker") {
    const m = scene.fit?.marker;
    return m ? { color: m.color, dash: m.dash, width: m.width } : undefined;
  }
  const a = scene.annotations.find((x) => x.id === id);
  return a ? { color: a.color, dash: a.dash, width: a.width } : undefined;
}

describe("the edit reaches the drawing", () => {
  for (const c of CASES) {
    it(`${c.id}: colour, thickness and dash all land`, () => {
      const before = drawn(build(c.kind), c.id)!;
      const after = drawn(build(c.kind, { refLineStyles: { [c.id]: { color: "#123456", width: 5, dash: "dotted" } } }), c.id)!;
      expect(after.color, `${c.id}: colour did not reach the drawing`).toBe("#123456");
      expect(after.width, `${c.id}: thickness did not reach the drawing`).toBe(5);
      expect(after.dash, `${c.id}: dash did not reach the drawing`).not.toBe(before.dash);
      // The dash pattern must scale with the resolved width; a hairline dash on a 5px line
      // results if the conversion runs before the width override.
      expect(after.dash, `${c.id}: dash was converted at the old width`).toBe("5.0,15.0");
    });

    it(`${c.id}: hiding it removes it from the drawing, and only it`, () => {
      const siblings = referenceLinesFor(c.kind as Plot["kind"], plotFor(c.kind)).filter((r) => r.id !== c.id);
      const scene = build(c.kind, { refLineHidden: { [c.id]: true } });
      expect(drawn(scene, c.id), `${c.id}: hidden and still drawn`).toBeUndefined();
      for (const s of siblings) {
        expect(drawn(scene, s.id), `hiding ${c.id} also removed ${s.id}`).toBeDefined();
      }
    });

    it(`${c.id}: the panel's controls write what the builder reads`, () => {
      const { container, patches } = panel(c.kind, { kind: "refline", id: c.id });
      fireEvent.change(control<HTMLSelectElement>(container, "Dashes")!, { target: { value: "longdash" } });
      expect(patches).toHaveLength(1);
      // Apply what the panel wrote and rebuild: the check is made on the drawing.
      const after = drawn(build(c.kind, patches[0]!), c.id)!;
      // Note: checked against the width the line is actually drawn at, not a hardcoded 1. A
      // fixed "11.0,5.0" would be wrong for the two lines whose default width is 1.25
      // (`ba-bias`, `pd-section`), where the pattern scales correctly. Reading the width back
      // from the same scene makes this measure the relationship rather than one arbitrary case.
      const w = Math.max(1, after.width);
      expect(after.dash, `${c.id}: the panel's dash choice never reached the drawing`).toBe(`${(11 * w).toFixed(1)},${(5 * w).toFixed(1)}`);
    });
  }

  it("an untouched chart is byte-identical — the per-line default look survives", () => {
    // Bland-Altman is the case that proves it: the bias is solid and its limits are dashed,
    // and that distinction is meaningful. A resolver that defaulted everything to one dash
    // would pass every test above and quietly flatten it.
    const s = build("blandaltman");
    // Note: `""`, not null. The bias default is `dashArray("solid", 1.25) ?? ""`, and this is a
    // byte-identical claim, so asserting null would be asserting a change.
    // Both are "no dash" to SVG; what matters is that the bias and its limits still differ.
    expect(drawn(s, "ba-bias")!.dash).toBe("");
    expect(drawn(s, "ba-loa-hi")!.dash).toBe("5 3");
    expect(drawn(s, "ba-loa-lo")!.dash).toBe("5 3");
  });

  it("the graph-wide setting still moves every line, and one line can then diverge", () => {
    const all = build("blandaltman", { refLine: { color: "#ff0000" } });
    expect(drawn(all, "ba-bias")!.color).toBe("#ff0000");
    expect(drawn(all, "ba-loa-hi")!.color).toBe("#ff0000");
    const one = build("blandaltman", { refLine: { color: "#ff0000" }, refLineStyles: { "ba-bias": { color: "#00ff00" } } });
    expect(drawn(one, "ba-bias")!.color).toBe("#00ff00");
    expect(drawn(one, "ba-loa-hi")!.color, "the per-line override leaked to its siblings").toBe("#ff0000");
  });

  /**
   * Lines whose position the user sets. A volcano guide's panel must let the user set the
   * threshold (e.g. to 2), not only colour / thickness / dashes; the same number is also under
   * Chart → Volcano. The panel carries a value box for exactly the lines a user chooses (the
   * volcano's three cut-offs, the forest null), and every one of them must reach the drawing,
   * i.e. the guide must actually move.
   */
  it("a volcano fold-change guide's panel has a value box, and setting it to 2 moves both ± guides", () => {
    const { container, patches } = panel("volcano", { kind: "refline", id: "vc-fc-pos" });
    const box = control(container, "Cut-off |log₂ FC|");
    expect(box, "no value box on the fold-change guide's panel").toBeDefined();
    expect(Number(box!.value)).toBe(1); // opens showing the value the guide is drawn at
    fireEvent.change(box!, { target: { value: "2" } });
    expect(patches).toHaveLength(1);
    expect(patches[0]!.volcano?.fcThreshold).toBe(2); // the same field Chart → Volcano edits
    // …and it reaches the drawing: the scene holds the guides in pixels, so the claim is that
    // the up guide moved right and the down guide moved left (the ± mirror), by the same amount.
    const px = (scene: ReturnType<typeof build>, id: string) => scene.annotations.find((a) => a.id === id)!.x1!;
    const before = build("volcano");
    const after = build("volcano", patches[0]!);
    expect(px(after, "vc-fc-pos"), "the up guide did not move").toBeGreaterThan(px(before, "vc-fc-pos"));
    expect(px(after, "vc-fc-neg"), "the down guide is the mirror of the same cut-off and must move too").toBeLessThan(px(before, "vc-fc-neg"));
    const centre = (px(before, "vc-fc-pos") + px(before, "vc-fc-neg")) / 2; // x = 0
    expect(px(after, "vc-fc-pos") - centre).toBeCloseTo(centre - px(after, "vc-fc-neg"), 6); // still mirrored
  });

  it("the volcano p guide and the forest null line have value boxes that reach the drawing", () => {
    const p = panel("volcano", { kind: "refline", id: "vc-p" });
    fireEvent.change(control(p.container, "Cut-off −log₁₀ p")!, { target: { value: "2" } });
    expect(p.patches[0]!.volcano?.pThreshold).toBe(2);
    const y = (scene: ReturnType<typeof build>) => scene.annotations.find((a) => a.id === "vc-p")!.y1!;
    expect(y(build("volcano", p.patches[0]!)), "the p guide did not move up (SVG y shrinks)").toBeLessThan(y(build("volcano")));

    const f = panel("forest", { kind: "refline", id: "forest-ref" });
    fireEvent.change(control(f.container, "Null value")!, { target: { value: "0" } });
    expect(f.patches[0]!.forest?.refValue).toBe(0);
  });

  it("a computed line (Bland-Altman bias) has no value box — the graph decides where it sits", () => {
    const { container } = panel("blandaltman", { kind: "refline", id: "ba-bias" });
    expect(control(container, "Cut-off |log₂ FC|")).toBeUndefined();
    expect(control(container, "Null value")).toBeUndefined();
  });

  it("'Reset this line' / 'Match the others' are text buttons, not colour swatches", () => {
    // Guards against the colour-swatch class `swbtn` (fixed square, padding 0), which renders
    // them as two 22×22 px squares with the words clipped out.
    const { container } = panel("volcano", { kind: "refline", id: "vc-fc-pos" });
    for (const label of ["Reset this line", "Match the others"]) {
      const b = [...container.querySelectorAll("button")].find((x) => x.textContent?.trim() === label);
      expect(b, `${label} missing`).toBeDefined();
      expect(b!.className, `${label} is styled as a colour swatch`).not.toMatch(/\bswbtn\b/);
      expect(b!.className).toMatch(/\bbtn-mini\b/);
    }
  });

  it("the ROC diagonal ignores seriesStyles", () => {
    // Guards against re-pointing the diagonal at `seriesStyles`, which would leave a Data panel
    // whose controls write a field the reference-line styling does not use.
    const s = build("roc", { seriesStyles: { "roc-diag": { color: "#ff00ff", lineWidth: 9 } } });
    expect(drawn(s, "roc-diag")!.color).not.toBe("#ff00ff");
    expect(drawn(s, "roc-diag")!.width).not.toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The Chart tab lists them, so they are findable without knowing to click.
// ─────────────────────────────────────────────────────────────────────────────
describe("the Chart tab's list", () => {
  for (const kind of [...new Set(CASES.map((c) => c.kind))]) {
    it(`${kind}: every line has a row with a hide switch`, () => {
      const { container } = panel(kind, { kind: "plot" });
      for (const r of referenceLinesFor(kind as Plot["kind"], plotFor(kind))) {
        // By aria-label, not by the row's leading span: these rows deliberately have no
        // leading span (see the note in Inspector.tsx — it is what keeps the Open button and
        // the Show switch separately named for the check that every control reaches the document).
        const box = container.querySelector<HTMLInputElement>(`input[aria-label="Show ${r.name}"]`);
        expect(box, `${kind}: no row for ${r.id}`).not.toBeNull();
        expect(box!.checked).toBe(true);
      }
    });
  }

  for (const kind of [...new Set(CASES.map((c) => c.kind))]) {
    it(`${kind}: each row's name opens that line — the exact id, not just "something happened"`, () => {
      // Note: this is what lets `function-matrix.test.tsx` exempt these buttons from its
      // check that every control reaches the document: they commit no document edit, so it cannot see them, and
      // "it called onSelect" would not catch a row wired to the wrong line's id.
      for (const r of referenceLinesFor(kind as Plot["kind"], plotFor(kind))) {
        const g = item(kind);
        const onSelect = vi.fn();
        const { container } = render(
          <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plotFor(kind)} table={g.table}
            userPresets={[]} profileDefault={null} {...handlers(vi.fn(), onSelect)} />,
        );
        const btn = container.querySelector<HTMLButtonElement>(`button[aria-label="Open ${r.name} (reference line)"]`);
        expect(btn, `${kind}: no way to open ${r.id} from the list`).not.toBeNull();
        fireEvent.click(btn!);
        expect(onSelect).toHaveBeenCalledWith({ kind: "refline", id: r.id });
        cleanup();
      }
    });
  }

  it("a chart with no reference lines gets no list", () => {
    const { container } = panel("bar", { kind: "plot" });
    expect(container.textContent).not.toContain("Each line — click one on the graph");
  });
});
