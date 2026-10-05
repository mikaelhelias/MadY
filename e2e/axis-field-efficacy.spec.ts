import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Axis-field efficacy — does setting an `AxisSpec` field change the drawing?
 *
 * The sibling of `style-field-efficacy`, whose scope is `*Style` interfaces only. Without
 * this test `AxisSpec` has no detector, so a control such as "Add cut" can be offered on
 * every chart kind by the Axis tab while `breaks` reaches only some of the places a scale
 * is built, and nothing checks whether turning it on does anything.
 *
 * A per-kind fix alone does not hold — fixing one builder leaves the same gap in every
 * other builder. This guard makes each new chart kind declare itself.
 *
 * Caution: patch, never replace. `setPlotOptions({yAxis: {...}})` replaces the whole spec,
 * so writing a bare `{breaks}` would silently drop the card's own axis title/format — the
 * drawing would then change for the wrong reason and every field would look alive. Each
 * check therefore reads the live axis first and merges into it.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = join(HERE, "../packages/core/src/model.ts");

/** Axis-bearing kinds, by gallery card. Pie / radar / 3-D scatter have no axes at all. */
const AXIS_KINDS: { card: string; axes: ("xAxis" | "yAxis")[] }[] = [
  { card: "XY (points + fitted curve)", axes: ["xAxis", "yAxis"] },
  { card: "Area", axes: ["xAxis", "yAxis"] },
  { card: "Bar / column (+ error bars)", axes: ["yAxis"] },
  { card: "Box & whisker", axes: ["yAxis"] },
  { card: "Violin", axes: ["yAxis"] },
  { card: "Column scatter", axes: ["yAxis"] },
  { card: "Raincloud", axes: ["yAxis"] },
  { card: "Floating bars (min→max)", axes: ["yAxis"] },
  { card: "Estimation (Gardner-Altman)", axes: ["yAxis"] },
  { card: "Forest plot", axes: ["xAxis"] },
  { card: "Bland-Altman", axes: ["xAxis", "yAxis"] },
  { card: "Population pyramid", axes: ["xAxis"] },
  { card: "Bubble", axes: ["xAxis", "yAxis"] },
  { card: "Histogram", axes: ["xAxis", "yAxis"] },
  { card: "Volcano", axes: ["xAxis", "yAxis"] },
  { card: "Before–after (paired)", axes: ["yAxis"] },
  { card: "Ridgeline / horizon fold", axes: ["xAxis"] },
  { card: "Lollipop / dumbbell", axes: ["xAxis"] },  // value axis is X (defaults horizontal)
  { card: "Paired dot plot", axes: ["xAxis"] },
  { card: "Survival (Kaplan-Meier)", axes: ["xAxis", "yAxis"] },
  { card: "ROC curve", axes: ["xAxis", "yAxis"] },
  { card: "Ordination — sites", axes: ["xAxis", "yAxis"] },
  { card: "Dendrogram", axes: ["yAxis"] },
];

/**
 * Fields that cannot be meaningfully swept, with the reason. Each is a decision, not a silence:
 * an entry here says "this is not expected to move the picture on its own".
 */
const UNREACHABLE: Record<string, string> = {
  title: "a title is text the user types; an empty default means nothing to change",
  titleOffset: "a drag offset — meaningless until a title exists",
  titleFont: "font objects are covered by the font-role tests",
  categoryGroups: "needs real column ids from the live table — cannot be synthesised",
  scaleBar: "opt-in ornament with its own guard",
  hidden: "hides the axis wholesale — trivially true, and it masks every other field",
  // Note: these work — their effect cannot be shown on this data. The gallery cards carry
  // small, tidy numbers, so a thousands separator, extra decimals or a comma decimal point
  // have nothing to change. Reporting them would flag working features as doing nothing.
  thousands: "needs tick values ≥ 1000 — no gallery card has them",
  decimals: "gallery ticks are already integers at the default precision",
  decimalSep: "needs a fractional tick — gallery ticks are integers",
};

/**
 * (kind · axis · field) combinations where the control legitimately does nothing, with
 * the reason. Each is a decision recorded here rather than a silent pass.
 */
const NOT_APPLICABLE: Record<string, string> = {
  "Histogram · xAxis.breaks":
    "a histogram's X axis holds bin labels (it delegates to a bar chart with a categorical " +
    "axis), so there is no numeric range to cut",
  "Histogram · xAxis.extraTicks": "categorical axis — ticks are the bins themselves",
  "Histogram · xAxis.scale": "categorical axis — no log scale to apply",
  "Histogram · xAxis.majorStep": "categorical axis — one tick per bin",
  "Histogram · xAxis.minorCount": "categorical axis — no minor ticks between bins",
  "Histogram · xAxis.min": "categorical axis — no numeric domain",
  "Histogram · xAxis.max": "categorical axis — no numeric domain",
  "Histogram · xAxis.bands": "categorical axis — bands are a data range",
  "Histogram · xAxis.format": "categorical axis — labels are strings",
};

/**
 * Values to try, per declared type — with the range-sensitive ones derived from the axis's
 * own tick values.
 *
 * Note: a fixed value such as `breaks: [{from: 2, to: 4}]` lies outside the domain of a
 * ROC curve (0–1), a forest plot's effect size, and several others. A cut outside the data
 * is correctly a no-op, so those kinds would be reported as doing nothing while working. A cut between
 * two real ticks makes the check meaningful everywhere.
 */
function candidates(name: string, type: string, ticks: number[]): unknown[] {
  const lo = ticks.length >= 2 ? ticks[0]! : 0;
  const hi = ticks.length >= 2 ? ticks[ticks.length - 1]! : 1;
  const span = hi - lo || 1;
  const a = lo + span * 0.3;
  const b = lo + span * 0.6;
  if (name === "breaks") return [[{ from: a, to: b }]];
  if (name === "extraTicks") return [[{ value: lo + span * 0.45, label: "mid" }]];
  if (name === "bands") return [[{ from: a, to: b, color: "#ff0000", opacity: 0.5 }]];
  if (name === "min") return [lo - span];
  if (name === "max") return [hi + span];
  if (name === "scale") return ["log10"];
  if (name === "format") return ["scientific"];
  if (name === "breakStyle") return ["zigzag", "gap"];
  if (name === "thousands") return ["space"];
  if (name === "decimalSep") return ["comma"];
  if (type.includes("boolean")) return [true];
  if (type.includes("string")) return ["#ff0000", "XX"];
  if (type.includes("number")) return [7, 2];
  return [];
}

/**
 * Combinations that change nothing, each with its reason. The list works both ways:
 * the test fails if any of these starts working (delete the entry) or if anything not listed
 * here changes nothing (fix it, or add an entry that argues why).
 */
const KNOWN_NO_EFFECT: Record<string, string> = {
  "Bar / column (+ error bars) · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Bland-Altman · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Dendrogram · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Estimation (Gardner-Altman) · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Histogram · xAxis.breakStyle":
    "changes nothing on this card; listed so it is not counted as covered",
  "Histogram · xAxis.prefix":
    "changes nothing on this card; listed so it is not counted as covered",
  "Histogram · xAxis.reversed":
    "changes nothing on this card; listed so it is not counted as covered",
  "Histogram · xAxis.suffix":
    "changes nothing on this card; listed so it is not counted as covered",
  "Histogram · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Lollipop / dumbbell · xAxis.minorCount":
    "changes nothing on this card; listed so it is not counted as covered",
  "Lollipop / dumbbell · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Ordination — sites · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Ordination — sites · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Paired dot plot · xAxis.minorCount":
    "changes nothing on this card; listed so it is not counted as covered",
  "Paired dot plot · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Population pyramid · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Ridgeline / horizon fold · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately. Measured on this card: its value axis is Week, starting at 0, and the scene says so — \"Log axis needs all-positive values — using linear.\" Its two siblings (extraTicks, bands) are measured after the test's own cut is removed again; see the restore note below.",
  "ROC curve · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "ROC curve · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Survival (Kaplan-Meier) · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Survival (Kaplan-Meier) · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Volcano · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "Volcano · yAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
  "XY (points + fitted curve) · xAxis.majorStep":
    "changes nothing on this card; listed so it is not counted as covered",
  "XY (points + fitted curve) · xAxis.minorCount":
    "changes nothing on this card; listed so it is not counted as covered",
  "XY (points + fitted curve) · xAxis.scale":
    "log10 is legitimately refused when the axis data include non-positive values (ROC 0-1, volcano log2FC, PCA scores, survival time from 0). Whether that refusal warns rather than passing in silence is asserted separately",
};

interface Field { name: string; type: string }

function axisFields(): Field[] {
  const src = readFileSync(MODEL, "utf8");
  const m = /export interface AxisSpec \{([\s\S]*?)\n\}/.exec(src);
  if (!m) return [];
  return [...m[1]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??: ([^;]+);/gm)].map((x) => ({
    name: x[1]!,
    type: x[2]!.trim(),
  }));
}

test.describe("axis-field efficacy — every AxisSpec field must change the drawing", () => {
  test("no axis field silently does nothing on a kind that offers it", async ({ page }) => {
    test.setTimeout(900_000);
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const fields = axisFields().filter((f) => !UNREACHABLE[f.name]);
    expect(fields.length, "AxisSpec fields must be readable from model.ts").toBeGreaterThan(10);
    expect(fields.some((f) => f.name === "breaks"), "the test must include `breaks`").toBe(true);

    const dead: string[] = [];
    const skipped: string[] = [];
    const noCard: string[] = [];
    /** Axes whose scene could not be read — a broken test, like a card that cannot be opened. */
    const noAxis: string[] = [];

    for (const k of AXIS_KINDS) {
      try {
        await app.openGallery();
        await app.openGalleryCard(k.card);
      } catch {
        noCard.push(`${k.card}: gallery card not found`);
        continue;
      }
      await app.settle();
      const plotId = await app.activePlotId();

      for (const axis of k.axes) {
        /**
         * The axis's own numbers — its domain and major ticks — read from the scene that draws the figure.
         *
         * Never scrape them off the picture. Collecting tick numbers by position ("X ticks are in the bottom
         * 40%") also picks up the other axis's labels and reference-line captions: on Bland-Altman the X check
         * would read −1.5 (a Y label) and derive a test value of 6.8 for an axis whose domain is 9–17. A value
         * outside the domain is correctly a no-op, so working controls would be reported as doing nothing.
         *
         * None of the cards above is a flipped chart, so the data-axis name and the drawn axis are the same one.
         */
        const axisScene = await app.sceneAxis(axis === "xAxis" ? "x" : "y");
        if (!axisScene) { noAxis.push(`${k.card} · ${axis}: no scene axis could be read`); continue; }
        const ticks = axisScene.ticks.length >= 2 ? axisScene.ticks : axisScene.domain;

        for (const f of fields) {
          const key = `${k.card} · ${axis}.${f.name}`;
          const values = candidates(f.name, f.type, ticks);
          if (values.length === 0) {
            skipped.push(`${key} (${f.type}) — no value can be synthesised`);
            continue;
          }
          if (NOT_APPLICABLE[key]) { skipped.push(`${key} — ${NOT_APPLICABLE[key]}`); continue; }
          /**
           * Title direction is drawn only for an axis that runs up the figure. `Inspector.tsx`
           * renders `TitleDirectionRows` for y / y3 / a right-hand y2 and never for x (`titleSide`
           * is null there), and the how-to says so: "an axis across the figure keeps its title
           * along it". This test checks "changes nothing on a kind that offers it", so judging these
           * two on the X spec would judge a control that is not there.
           */
          if ((f.name === "titleAngle" || f.name === "titleAbove") && axis === "xAxis") {
            skipped.push(`${key} — Title direction is offered only on an axis that runs up the figure; the X panel never renders it`);
            continue;
          }
          // Read the live axis and merge, so each try changes exactly one thing.
          const live = ((await app.plot(plotId)) ?? {}) as Record<string, unknown>;
          const original = (live[axis] ?? {}) as Record<string, unknown>;
          let base = original;
          // A cut style cannot show without a cut. Same idea as `PREREQS` in `style-field-efficacy.spec.ts`.
          if (f.name === "breakStyle" && ticks.length >= 2) {
            const lo = ticks[0]!, span = (ticks[ticks.length - 1]! - lo) || 1;
            base = { ...base, breaks: [{ from: lo + span * 0.3, to: lo + span * 0.6 }] };
          }
          /**
           * "Above the axis" applies only while the title is level, and the builder reports this
           * with a warning instead of ignoring it: at 90° the geometry is byte-identical and the
           * scene carries "The Y-axis title goes above its axis only when it is level (0°)…".
           * Without this the test would measure the refusal and call the control ineffective; with it,
           * titleAbove moves the plot down (y 44 → 79 on an XY card) and the feature is measured.
           */
          if (f.name === "titleAbove") base = { ...base, titleAngle: 0 };

          let moved = false;
          for (const v of values) {
            const before = await app.renderFingerprint();
            await app.setPlotOptions({ [axis]: { ...base, [f.name]: v } });
            const after = await app.renderFingerprint();
            if (before.digest !== after.digest) { moved = true; break; }
          }
          /**
           * Restore the axis as it was — never the prerequisite copy. Restoring `base` would write
           * `breakStyle`'s injected cut back onto the live axis, so every field measured after it
           * (extraTicks, bands, tickRotation…) would be judged on a chart with a slice of its axis
           * collapsed. `axisPixel` returns null on a broken axis, so custom ticks and shaded bands
           * are skipped there by design — the test would report its own leftover as a control
           * that does nothing. On Ridgeline and XY both fields work on a clean axis and change
           * nothing with a cut present, wherever the test value sits.
           *
           * The ridgeline builder mentions neither field (they are resolved for every kind at one
           * choke point), so reading that builder alone makes them look unhandled. They are also covered in the
           * fast suite: `ridgeline-axis-extras.test.tsx` draws the card with a custom tick and a
           * shaded band, fold off and on, and reads them off the SVG.
           */
          await app.setPlotOptions({ [axis]: original });
          if (!moved) dead.push(key);
        }
      }
    }

    // Never a silent cap.
    console.log(`[axis-field efficacy] skipped ${skipped.length}:\n  - ${skipped.slice(0, 40).join("\n  - ")}`);
    console.log(`[axis-field efficacy] no effect ${dead.length}:\n  - ${dead.join("\n  - ")}`);

    // Note: a card that could not be opened is a broken test, not a skip: if a gallery name
    // drifts, that whole kind stops being checked and the suite still passes.
    expect(
      noCard,
      `gallery cards not found — these kinds were not checked:\n  - ${noCard.join("\n  - ")}`,
    ).toEqual([]);

    expect(
      noAxis,
      `axes whose scene could not be read — these were not checked:\n  - ${noAxis.join("\n  - ")}`,
    ).toEqual([]);

    const unexpected = dead.filter((d) => !KNOWN_NO_EFFECT[d]);
    const fixed = Object.keys(KNOWN_NO_EFFECT).filter((k) => !dead.includes(k));

    expect(
      unexpected,
      "Axis fields that change nothing — the Axis tab offers the control and the builder " +
        "ignores it:\n  - " + unexpected.join("\n  - ") + "\n",
    ).toEqual([]);

    // An entry whose field changes the drawing must be removed from the list, so an entry can
    // never quietly outlive the problem it describes.
    expect(
      fixed,
      "Listed in KNOWN_NO_EFFECT, but they change the drawing — delete their entries:\n  - " +
        fixed.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});
