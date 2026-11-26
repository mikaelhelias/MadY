import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Series-style efficacy — the everyday kinds.
 *
 * `style-field-efficacy` covers kinds that own a per-kind `*Style` (network, heatmap, treemap…).
 * The most-used kinds — xy, bar, box, violin, column scatter, area — have no per-kind style at
 * all: they are styled through `SeriesStyle` (keyed by column id) plus plot-level
 * fields. This test provides their efficacy coverage.
 *
 * Note: a `SeriesStyle` field is kind-specific by nature: `barShape` means nothing on a box plot,
 * `whisker` means nothing on a bar. So a field is reported only when it moves the drawing on no
 * kind at all. Judging per-kind would bury the real failures under hundreds of by-design misses.
 *
 * Note: this needs a live column id (`seriesStyles` is keyed by one), which is why it cannot be
 * folded into the schema-driven check.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = join(HERE, "../packages/core/src/model.ts");

/**
 * The kinds tested are enumerated from the gallery at run time, not listed here.
 *
 * A hard-coded list leaves out any kind not on it (e.g. radar, whose missing scope toggle would
 * then go undetected), and a new chart kind would be silently outside this suite, with nothing
 * failing to say so. Reading the cards off the gallery makes enrolment automatic: add a card,
 * and it is tested.
 *
 * A kind that renders no `[data-mady-series]` group (pie is the standing example — its slices are
 * not series marks) reports itself in `unreachableKinds` rather than being predicted here.
 */

interface Field {
  name: string;
  type: string;
}

function seriesStyleFields(): Field[] {
  const src = readFileSync(MODEL, "utf8");
  const m = /export interface SeriesStyle \{([\s\S]*?)\n\}/.exec(src);
  if (!m) return [];
  return [...m[1]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:\s*([^;]+);/gm)].map((x) => ({
    name: x[1]!,
    type: x[2]!.replace(/\s+/g, " ").trim(),
  }));
}

/** Candidate values from the declared type; [] = cannot responsibly synthesise one. */
function candidates(f: Field): unknown[] {
  const t = f.type.replace(/\s*\|\s*undefined$/, "").trim();
  if (/^Record</.test(t) || /NodeId/.test(t) || /\[\]$/.test(t)) return [];
  if (/^boolean$/.test(t)) return [true, false];
  if (/^number$/.test(t)) return [7, 2, 0.25];
  const literals = [...t.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  if (literals.length >= 1 && /^"/.test(t)) return literals;
  if (literals.length > 1) return literals;
  if (/^string$/.test(t)) {
    const textish = /(title|text|label|name|caption|units?)$/i.test(f.name);
    // Colours whose name does not contain "colour": gradTo/gradientTo are ramp endpoints,
    // twoToneEdge is an outline. Feeding them "ZZTest" would make working fields look ineffective.
    const NAMED_COLOURS = new Set(["stroke", "fill", "gradTo", "gradientTo", "twoToneEdge", "nanColor"]);
    const colourish = !textish && (/colou?r/i.test(f.name) || NAMED_COLOURS.has(f.name));
    return colourish ? ["#ff00ff", "#00ff00"] : ["ZZTest", "QQTest"];
  }
  const src = readFileSync(MODEL, "utf8");
  const alias = new RegExp(`export type ${t} =([^;]+);`).exec(src);
  if (alias) {
    const opts = [...alias[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    if (opts.length > 1) return opts;
  }
  return [];
}

/**
 * State a series field needs before it can possibly draw. Most of these cluster: the advanced
 * fills are behind a `fillType` discriminator, so setting `patternColor` on a solid-filled bar
 * is by design a no-op. `sid` is the live series column id — some fields need a column
 * reference, and the series' own column is a valid one.
 *
 * Without this the test flags about 35 working fields as having no effect, which makes the
 * report easy to dismiss and so hides the real failures.
 */
function prereqFor(name: string, sid: string): Record<string, unknown> | null {
  // Caution: specific rules first. Below the broad prefix rules, `/^grad/` would match
  // `gradTo` and `/^pointLabel/` would match pointLabelSize/Color — so both would run with the
  // wrong prerequisite and be reported as having no effect while working.
  if (name === "gradTo") return { fillType: "graduated", gradRamp: "twocolor" };
  // The blend colour space only exists where two colours are blended — the two-colour ramp. On
  // the built-in single-hue ramps there is nothing to blend, so driven bare it changes nothing.
  if (name === "gradSpace") return { fillType: "graduated", gradRamp: "twocolor", gradTo: "#0000ff" };
  if (/^pointLabel(Size|Color)$/.test(name)) return { pointLabels: "y" };
  if (name === "lineTension") return { connect: "cardinal" };
  // A mutually-dependent pair: lineColor is only read when linkLineColor is false, and
  // linkLineColor only changes anything when lineColor is set. Neither moves alone.
  if (name === "lineColor") return { linkLineColor: false };
  if (name === "linkLineColor") return { lineColor: "#00ff00" };
  if (name === "symbolFillColor") return { symbolFill: "open" };
  /**
   * The bar-swarm point trio. All three are read only through `pointStyleOf`, which runs when
   * a bar's dots are unlinked from the bar — so driven bare they move nothing and would be
   * reported. They work: `bar-points.test.ts` drives all three against the builder.
   *
   * Note: these must sit above the `/^twoTone/` rule: `symbolTwoToneTint` does not match it
   * (different prefix) and would otherwise fall through with no prerequisite at all.
   */
  if (/^symbolTwoTone(Tint|Shade)$/.test(name)) return { symbolFill: "twotone", linkPointsToBar: false, color: "#00a000" };
  // Linking is only visible when the points' own colour differs from the bar's — linked, the
  // dots take the bar's fill; unlinked, their own. Same colour either way = no delta to see.
  if (name === "linkPointsToBar") return { color: "#00ff00", fillColor: "#0000ff", symbolFill: "solid" };

  // Broad prefix rules — the advanced fills sit behind a `fillType` discriminator.
  if (/^twoTone/.test(name)) return { fillType: "twotone" };
  if (/^pattern/.test(name)) return { fillType: "pattern" };
  if (/^gradient/.test(name)) return { fillType: "gradient" };
  // FillType has both "gradient" and "graduated"; gradMap/gradRamp/gradMin/gradMax are the latter.
  if (/^grad/.test(name)) return { fillType: "graduated" };
  if (name === "metallic") return { fillType: "metallic" };
  if (name === "special") return { fillType: "special" };
  if (/^value(Text|Dx|Dy)$/.test(name)) return { showValues: true };
  if (/^colorFrom/.test(name)) return { colorFromColumn: sid };
  if (/^pointLabel/.test(name)) return { pointLabelColumn: sid };
  /**
   * The error ribbon and its edge need an interval to render. Setting a type is half of it;
   * the other half is data with replicates, which no prerequisite can supply — see the
   * error-ribbon note in the list below. The prerequisite is set anyway so that if a gallery
   * card gains replicates, these fields prove themselves immediately and any stale entries fail.
   */
  if (/^(errorDisplay|band[A-Z])/.test(name)) return { errorBars: "sd", errorDisplay: "band", bandEdgeWidth: 2 };
  return null;
}


/**
 * Series fields that change nothing on any gallery card, each with the reason.
 * Two-sided: an entry that starts working also fails, so the list cannot outlive its reason.
 */
const KNOWN_NO_EFFECT: Record<string, string> = {
  // The pie slice fields need no entry: the pie card is the parts-of-whole format and the
  // builder honours per-slice two-tone/stroke/explode/label fields, so they change the drawing
  // and this test checks them.

  // Fields that change nothing on any gallery card. Such a field either has no effect, or
  // needs state/data the gallery card does not have (e.g. showOutliers can only draw something
  // if the data has an outlier).
  // Read from per-point overrides (plot.pointStyles["col:row"]), never from seriesStyles.
  // Typed on SeriesStyle but consumed point-side — setting them in seriesStyles puts them in
  // the wrong place, so this test cannot reach them.
  valueText: "not series-level — consumed from plot.pointStyles; only a per-point check can reach it",
  valueDx: "not series-level — same as valueText",
  valueDy: "not series-level — same as valueText",
  // showOutliers / outlierSize: the box/violin gallery card's data carries an outlier,
  // so toggling / sizing it changes the drawing; this test checks them (no entries).
  /*
   * The XY error ribbon. Same class as showOutliers: it renders the error interval
   * the T-bars already carry, so with no interval there is nothing to render, and the
   * gallery's xy + area cards are plain Y columns with no replicates. Only those two kinds draw
   * a band at all (a ribbon needs a curve to follow), so no other card can prove it either, and
   * no styling can create an error interval in data that has none.
   *
   * Note: these fields are checked elsewhere and do work: `xy-error-band.test.tsx`
   * drives all six against a replicate-bearing table and the box card's gallery table, and checks
   * the band reaches the drawing. `prereqFor` above already sets them up, so if a gallery card
   * gains replicates any entries for them fail as working and must be deleted.
   */
  twoToneEdge: "the edge colour of a two-tone symbol (drawn as its symbolOutline); the /^twoTone/ prerequisite sets a two-tone bar fill, not a two-tone symbol, so there is nothing for it to change",
};

test.describe("series-style efficacy — the everyday kinds", () => {
  test("no SeriesStyle field changes nothing on every kind that could use it", async ({ page }) => {
    test.setTimeout(900_000);
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const fields = seriesStyleFields();
    expect(fields.length, "parsed no SeriesStyle fields — the regex or the model moved").toBeGreaterThan(20);

    /** field → the kinds on which it visibly changed the drawing. */
    const movedOn = new Map<string, string[]>();
    const skipped: string[] = [];
    const unreachableKinds: string[] = [];

    const cards = await app.openGallery();
    expect(cards.length, "the gallery listed no cards — enumeration is broken, not the app").toBeGreaterThan(20);

    for (const card of cards) {
      // A field only has to prove itself once: it is reported only when it moves the drawing on
      // no kind at all. So later kinds test only what is still unproven, which keeps testing
      // every card affordable — most fields are settled by the first kind or two, and the
      // remaining ones are exactly those worth investigating further.
      const unproven = fields.filter((f) => !movedOn.has(f.name) && candidates(f).length > 0);
      if (unproven.length === 0) {
        console.log(`[series-style efficacy] every field proved alive before ${card} — stopping early`);
        break;
      }
      try {
        await app.openGallery();
        await app.openGalleryCard(card);
      } catch {
        unreachableKinds.push(`${card}: gallery card not found`);
        continue;
      }
      await app.settle();
      const sid = await app.firstSeriesId();
      if (!sid) {
        unreachableKinds.push(`${card}: no [data-mady-series] in the rendered figure`);
        continue;
      }
      // …plus any series-style key that has no `data-mady-series` group of its own (the
      // forest pooled summary). Writing only to `sid` would report every summary-only field as having no effect.
      const synth = await app.syntheticSeriesIds();
      const keys = [sid, ...synth];
      /**
       * The style delta, applied under every key this figure honours.
       *
       * Except for a field whose whole meaning is a difference between the summary and the
       * studies. This test replaces `seriesStyles` wholesale, so the studies arrive bare — and
       * a summary "linked" to a bare study looks exactly like an unlinked bare summary, so
       * `linkSummaryToStudies` would appear to have no effect: not because it does nothing, but because both
       * sides of the comparison are flattened. Give the studies a distinct look and put
       * the field on the summary alone. (`linkPointsToBar` needs the same treatment, for the
       * same reason, and is handled by its `prereqFor` entry above.)
       */
      const SUMMARY_ONLY = new Set(["summaryShape", "linkSummaryToStudies"]);
      const STUDY_LOOK = { color: "#00a000", symbolFill: "solid", symbolSize: 9, symbolOutline: "#000000" };
      const styleFor = (delta: Record<string, unknown>, field: string): Record<string, unknown> =>
        synth.length > 0 && SUMMARY_ONLY.has(field)
          ? { [sid]: STUDY_LOOK, ...Object.fromEntries(synth.map((k) => [k, delta])) }
          : Object.fromEntries(keys.map((k) => [k, delta]));

      for (const f of fields) {
        const values = candidates(f);
        if (values.length === 0) {
          if (card === cards[0]) skipped.push(`${f.name} (${f.type})`); // listed once, from the first card tested
          continue;
        }
        if (movedOn.has(f.name)) continue; // already proved alive on an earlier kind
        const pre = prereqFor(f.name, sid);
        let moved = false;
        for (const v of values) {
          await app.setPlotOptions({ seriesStyles: styleFor({ ...(pre ?? {}) }, f.name) });
          const before = await app.renderFingerprint();
          await app.setPlotOptions({ seriesStyles: styleFor({ ...(pre ?? {}), [f.name]: v }, f.name) });
          const after = await app.renderFingerprint();
          if (before.digest !== after.digest) {
            moved = true;
            break;
          }
        }
        await app.setPlotOptions({ seriesStyles: {} }); // clean slate for the next field
        if (moved) movedOn.set(f.name, [...(movedOn.get(f.name) ?? []), card]);
      }
    }

    const testable = fields.filter((f) => candidates(f).length > 0);
    const dead = testable.filter((f) => !movedOn.has(f.name)).map((f) => `${f.name} (${f.type})`);

    console.log(
      `[series-style efficacy] ${testable.length} testable field(s) across ${cards.length} gallery kinds; ` +
        `${skipped.length} skipped (need live ids / arrays):\n  - ${skipped.join("\n  - ")}`,
    );
    if (unreachableKinds.length) console.log(`[series-style efficacy] unreachable:\n  - ${unreachableKinds.join("\n  - ")}`);

    const unexpected = dead.filter((d) => !KNOWN_NO_EFFECT[d.split(" ")[0]!]);
    const fixed = Object.keys(KNOWN_NO_EFFECT).filter((k) => !dead.some((d) => d.startsWith(k)));

    expect(
      unexpected,
      "Series style fields that change nothing on any kind — the option exists on every series " +
        "and no builder honours it anywhere:\n  - " +
        unexpected.join("\n  - ") +
        "\n",
    ).toEqual([]);
    expect(
      fixed,
      "Listed as changing nothing, but they change the drawing — delete their entries:\n  - " + fixed.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});
