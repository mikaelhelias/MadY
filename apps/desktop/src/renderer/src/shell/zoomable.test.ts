/**
 * `PlotScene.zoomable` must match what the builder actually does.
 *
 * The renderer offers scroll-to-zoom and drag-to-pan on exactly the axes this field names,
 * and reports the new window back through the `key` it names. Both halves can be wrong, and
 * they fail in opposite ways:
 *
 *   • declared but not honoured → the gesture lands, the view state changes, and the picture
 *     never moves — a silent no-op, which counts as a defect.
 *   • honoured but not declared → the axis simply cannot be zoomed, and nothing anywhere
 *     says so (e.g. a hand-kept list in the renderer that leaves out kinds whose builder honours
 *     a value-domain override, so zoom works only on some graphs).
 *
 * So this is measured, never asserted from a list. Each kind is built twice more — once
 * per domain key — and the answer is read off the built scene. The declaration has to equal
 * what came back.
 *
 * Caution: two things make a probe like this misreport:
 *  - a negative probe domain is unrepresentable on a log axis, so the builder discards it and
 *    the kind reads as "ignores the override". The gallery's XY has a log10 X, which would read
 *    as unzoomable. The probe domain is positive for that reason.
 *  - every gallery plot is drawn in its default orientation, so a loop over the gallery alone
 *    never exercises the case the `key` field exists for. The flipped variants below are the
 *    point of the file: a horizontal bar is dragged along X and must report `yDomain`.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { PlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";

/** Positive (log-safe) and unlikely to coincide with any fixture's natural extent. */
const PROBE: [number, number] = [2.5, 41.25];
const SIZE = { width: 520, height: 360 };

const isProbe = (d: readonly number[] | undefined): boolean =>
  !!d && Math.abs(d[0]! - PROBE[0]) < 1e-9 && Math.abs(d[1]! - PROBE[1]) < 1e-9;
const same = (a: readonly number[] | undefined, b: readonly number[] | undefined): boolean =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

/**
 * Pixels per data unit, read off the major ticks the axis drew — the mapping a reader measures
 * against, not the frame (the XY builder insets the data mapping by a marker's width, and that
 * inset differs between the two axes).
 */
function perUnit(ax: { ticks: { value: number; pos: number; minor: boolean }[] }): number | null {
  const m = ax.ticks.filter((t) => !t.minor);
  const a = m[0];
  const b = m[m.length - 1];
  if (!a || !b || a.value === b.value) return null;
  return Math.abs(b.pos - a.pos) / Math.abs(b.value - a.value);
}

/** Is this scene drawn 1:1 — one data unit the same pixels on X as on Y? */
function isSquare(s: PlotScene): boolean {
  const px = perUnit(s.x);
  const py = perUnit(s.y);
  return px != null && py != null && Math.abs(px / py - 1) < 1e-6;
}

type Entry = { visual: "x" | "y"; key: "x" | "y" };
const norm = (e: Entry[]): string[] => e.map((z) => `${z.visual}<-${z.key}`).sort();

/** Which (visual axis, view key) pairs does this builder really honour? */
function observe(table: DataTable, plot: Plot): { found: Entry[]; muddy: string[] } {
  const base = buildPlotScene(table, plot, SIZE);
  const found: Entry[] = [];
  const muddy: string[] = [];
  for (const key of ["x", "y"] as const) {
    const s = buildPlotScene(table, plot, { ...SIZE, [`${key}Domain`]: PROBE });
    for (const visual of ["x", "y"] as const) {
      if (isProbe(s[visual].domain)) found.push({ visual, key });
      else if (!same(s[visual].domain, base[visual].domain)) {
        /*
         * The override moved this axis without landing on it — normally a clamp or a re-nice.
         * Neither "honoured" nor "ignored", and reporting it as ignored would hide a
         * half-working zoom behind a green test. Fail loudly instead of guessing.
         *
         * One legitimate exception, and it is pinned rather than waved through: `equalAspect`
         * couples the two axes on purpose — a 1:1 map that stopped being 1:1 the moment it is
         * zoomed into would be the very distortion the option removes. So the other axis is
         * allowed to follow, and the outcome is asserted: the built picture must actually be
         * 1:1. A clamp or a re-nice would not be, so the exception lets nothing else escape.
         */
        if (plot.equalAspect === true && isSquare(s)) continue;
        muddy.push(`${key}Domain moved the ${visual} axis to [${s[visual].domain}] instead of [${PROBE}]`);
      }
    }
  }
  return { found, muddy };
}

/** Every gallery kind, plus the flipped variants of the kinds that can transpose. */
function cases(): { name: string; table: DataTable; plot: Plot }[] {
  const items = galleryItems() as unknown as { key: string; table: DataTable; plot: Plot }[];
  const flipped = items
    .filter((i) => ["bar", "box", "violin", "scatter", "floatingbar"].includes(i.key))
    .map((i) => ({ name: `${i.key} (horizontal)`, table: i.table, plot: { ...i.plot, barOrientation: "horizontal" } as Plot }));
  return [...items.map((i) => ({ name: i.key, table: i.table, plot: i.plot })), ...flipped];
}

describe("PlotScene.zoomable is measured, not declared", () => {
  const all = cases();

  // A loop that silently stops enumerating reads exactly like a passing one. The floor counts
  // gallery kinds plus flipped orientations and is kept loose; a drop below it means the source
  // shrank, not that the app got simpler.
  it("covers the whole gallery", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
  });

  for (const c of all) {
    it(`${c.name}: the declaration equals what the builder does`, () => {
      const scene: PlotScene = buildPlotScene(c.table, c.plot, SIZE);
      const { found, muddy } = observe(c.table, c.plot);
      expect(muddy).toEqual([]);
      expect(norm(scene.zoomable ?? [])).toEqual(norm(found));
    });
  }

  /**
   * `scene.auto` must be the un-zoomed home, not an echo of the window currently applied.
   *
   * Guards against a builder setting `auto` from the domain it has just built — which is the
   * overridden one whenever a window is applied. That breaks two things on a kind with pan/zoom:
   * the renderer's soft-lock detent compares against `auto` (so it could never fire), and
   * drag-to-pan wakes up by comparing the domain to `auto` (so it could never wake). Both fail
   * silently — the gesture is simply inert.
   */
  for (const c of all) {
    const declared = buildPlotScene(c.table, c.plot, SIZE).zoomable ?? [];
    if (!declared.length) continue;
    it(`${c.name}: auto stays at the home extent while zoomed`, () => {
      const home = buildPlotScene(c.table, c.plot, SIZE);
      for (const z of declared) {
        const zoomed = buildPlotScene(c.table, c.plot, { ...SIZE, [`${z.key}Domain`]: PROBE });
        // The axis really did move — otherwise the next assertion is about nothing.
        expect(same(zoomed[z.visual].domain, home[z.visual].domain)).toBe(false);
        expect(zoomed.auto[z.visual]).toEqual(home.auto[z.visual]);
      }
    });
  }

  /**
   * The room a bracket stack forces (the buildScene retry that raises the value-axis max
   * until the stack fits) is part of the home extent. A build
   * with a zoom window applied never runs that widening (the window pins the domain), so its
   * `auto` could report the data-only home — and the detent / reset target would disagree with
   * what an actual un-zoomed rebuild produces. Only height-less brackets (`bracketY == null`, the
   * shape a hand-added blank bracket has) reach the retry; an explicit `bracketY` folds into
   * the domain through significanceHeadroom() identically in both builds and never diverges —
   * which is why the gallery card (explicit heights) cannot exhibit this and a dedicated
   * fixture must.
   */
  it("bar with height-less significance brackets: zoomed auto equals the widened home", () => {
    const bar = all.find((x) => x.name === "bar")!;
    const plot = {
      ...bar.plot,
      annotations: [
        { id: "hand1", kind: "bracket", from: 1, to: 2, p: 0.01, role: "significance" },
        { id: "hand2", kind: "bracket", from: 2, to: 3, p: 0.02, role: "significance" },
        { id: "hand3", kind: "bracket", from: 1, to: 3, p: 0.001, role: "significance" },
      ],
    } as Plot;
    const home = buildPlotScene(bar.table, plot, SIZE);
    // The fixture must be able to exhibit the bug: the stack really pushed the home extent
    // beyond the data-only one. If this stops holding, the equality below proves nothing.
    const bare = buildPlotScene(bar.table, { ...bar.plot, annotations: undefined } as Plot, SIZE);
    expect(home.auto.y[1]!).toBeGreaterThan(bare.auto.y[1]!);
    const zoomed = buildPlotScene(bar.table, plot, { ...SIZE, yDomain: PROBE });
    expect(same(zoomed.y.domain, home.y.domain)).toBe(false);
    expect(zoomed.auto.y).toEqual(home.auto.y);
  });

  // The case the `key` field exists for, stated on its own so it cannot be lost in the loop above.
  it("a flipped bar is dragged along X and reports through yDomain", () => {
    const c = all.find((x) => x.name === "bar (horizontal)")!;
    const scene = buildPlotScene(c.table, c.plot, SIZE);
    expect(scene.zoomable).toEqual([{ visual: "x", key: "y" }]);
    // …and the upright one is the other way round, so this is not just "always y".
    const up = all.find((x) => x.name === "bar")!;
    expect(buildPlotScene(up.table, up.plot, SIZE).zoomable).toEqual([{ visual: "y", key: "y" }]);
  });
});
