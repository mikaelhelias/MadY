import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Style-field efficacy — does setting a `*Style` field change what is drawn?
 *
 * The broad net that scales without a hand-written list per kind. `control-efficacy.spec.ts`
 * drives Inspector controls (and so catches a control that is missing, mislabelled, or writes
 * the wrong field) but needs a list per kind. This one drives the model: it parses every
 * `export interface *Style` out of `model.ts` at test time — so it cannot drift from the schema
 * — and asserts each field visibly changes the figure.
 *
 * It catches an option the builder only consults in one branch, so it silently does nothing in
 * the common case (e.g. a node colour that applies only to value-less nodes).
 * `dead-style-fields.test.ts` cannot see that — a static grep only proves the name is mentioned.
 *
 * Note: a field is only reported as changing nothing after every candidate value fails to change the render.
 * Picking a value that happens to equal the current one would produce a false report.
 *
 * Note: fields with no synthesisable value (per-item override maps keyed by real ids, column
 * references) are skipped — and the skip list is printed, never silently dropped.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = join(HERE, "../packages/core/src/model.ts");

/** styleKey on `Plot` → the interface that types it, and a gallery card of that kind. */
const KIND_STYLES: { styleKey: string; iface: string; card: string }[] = [
  { styleKey: "network", iface: "NetworkStyle", card: "Network graph" },
  { styleKey: "parallel", iface: "ParallelStyle", card: "Parallel coordinates" },
  { styleKey: "treemap", iface: "TreemapStyle", card: "Treemap" },
  { styleKey: "heatmap", iface: "HeatmapStyle", card: "Heatmap — clustered, split, annotated" },
  { styleKey: "corrmatrix", iface: "CorrMatrixStyle", card: "Correlation matrix" },
  { styleKey: "alluvial", iface: "AlluvialStyle", card: "Alluvial / parallel sets" },
  { styleKey: "radar", iface: "RadarStyle", card: "Radar / spider" },
  { styleKey: "ridgeline", iface: "RidgelineStyle", card: "Ridgeline / horizon fold" },
  { styleKey: "histogram", iface: "HistogramStyle", card: "Histogram" },
  { styleKey: "bubble", iface: "BubbleStyle", card: "Bubble" },
  { styleKey: "volcano", iface: "VolcanoStyle", card: "Volcano" },
  { styleKey: "lollipop", iface: "LollipopStyle", card: "Lollipop / dumbbell" },
  { styleKey: "paireddot", iface: "PairedDotStyle", card: "Paired dot plot" },
  { styleKey: "floatingBar", iface: "FloatingBarStyle", card: "Floating bars (min→max)" },
  { styleKey: "columnScatter", iface: "ColumnScatterStyle", card: "Column scatter" },
  { styleKey: "estimation", iface: "EstimationStyle", card: "Estimation (Gardner-Altman)" },
  { styleKey: "forest", iface: "ForestStyle", card: "Forest plot" },
  { styleKey: "blandAltman", iface: "BlandAltmanStyle", card: "Bland-Altman" },
  { styleKey: "pyramid", iface: "PyramidStyle", card: "Population pyramid" },
  { styleKey: "dendrogram", iface: "DendrogramStyle", card: "Dendrogram" },
];

/**
 * A prerequisite value that is a column of the live sheet, named the way the reader sees it.
 *
 * A column id cannot be written into this file. Opening a gallery card copies its table into
 * the document and renumbers every column — Petal L is `"pl"` in `gallery.ts` and `"col_39"` once
 * the card is open — so a literal id is a dangling reference. The builder would then find no
 * colour column, never reach the branch under test, and the fields would read as changing nothing
 * because of this test itself (with `colorColumn: "pl"` the four colour-shaping fields change
 * nothing; naming the real column, all four move).
 *
 * Resolved against the plot's own sheet below, and a name that matches nothing fails the run.
 */
const COLUMN = (name: string): { column: string } => ({ column: name });

/**
 * Fields that only apply in a state the default gallery card is not in. Without these this test
 * reports perfectly good options as changing nothing — e.g. `heatmap.valueColor` is the colour of the
 * printed cell value, and nothing is printed until `showValues` is on. Each entry is the style
 * patch to apply first. (Verified against each field's own doc comment in model.ts.)
 */
const PREREQS: Record<string, Record<string, unknown>> = {
  "heatmap.valueColor": { showValues: true },
  "heatmap.showDendrogram": { cluster: "both" },
  "heatmap.resolution": { mode: "density2d" },
  "corrmatrix.valueDecimals": { showValues: true },
  "parallel.colorRamp": { colorScale: "value" },
  "parallel.colorReverse": { colorScale: "value" },
  "parallel.colorbarTitle": { colorScale: "value" },
  // The four shaping fields need the same value ramp as colorRamp above — and a numeric colour
  // column with it. The card colours by species, which is text: `colorScale: "value"` alone gives
  // a ramp with no finite values behind it, so gamma, steps and space move the colour bar but
  // `colorMidpoint` — a data value — has nothing to reposition and changes nothing. Over Petal L all
  // four move, and the lines carry the ramp too, so a defect that shaped the bar but not the lines
  // would still be caught. Without any prerequisite all four change nothing, correctly, because there
  // is no ramp to shape.
  "parallel.colorMidpoint": { colorScale: "value", colorColumn: COLUMN("Petal L") },
  "parallel.colorGamma": { colorScale: "value", colorColumn: COLUMN("Petal L") },
  "parallel.colorSteps": { colorScale: "value", colorColumn: COLUMN("Petal L") },
  "parallel.colorSpace": { colorScale: "value", colorColumn: COLUMN("Petal L") },
  // A radar tick's length and colour need a tick to exist — `showTicks` is off by default, so
  // without this they are reported as changing nothing when they are simply unexercised. (`showTicks` itself
  // needs no prerequisite: switching it on is the change.)
  "radar.tickLen": { showTicks: true },
  "radar.tickColor": { showTicks: true },
  // The forest pooled summary is off by default, and model / ciLevel only move that diamond
  // (fixed vs random-effects pooling; the summary's CI level). Turn the summary on first, or they
  // read as changing nothing when they simply have nothing to act on.
  "forest.model": { showSummary: true },
  "forest.ciLevel": { showSummary: true },
  // Measured on the card's own block (see `own` below), so a card option that masks a field has to
  // be switched off first. Each rule is the masking option named in the field's model.ts comment.
  "network.edgeColor": { edgeSignColors: false }, // sign colours override the flat link colour
  "heatmap.splitLineWidth": { splitStyle: "both" }, // the split card breaks with a gap; the rule needs a line
  "heatmap.splitColor": { splitStyle: "both" },
  "heatmap.splitDash": { splitStyle: "both" },
  "ridgeline.spectrum": { bands: 0 }, // level bands replace the spectrum (the builder says so)
  "ridgeline.spectrumMap": { bands: 0, spectrum: true },
  "ridgeline.spectrumMidpoint": { bands: 0, spectrum: true },
  "ridgeline.spectrumGamma": { bands: 0, spectrum: true },
  "ridgeline.spectrumSteps": { bands: 0, spectrum: true },
  "ridgeline.spectrumSpace": { bands: 0, spectrum: true },
  "histogram.normalCurveColor": { normalCurve: true },
  "histogram.densityCurveColor": { densityCurve: true },
  "histogram.densityBandwidth": { densityCurve: true },
  "lollipop.deltaColor": { showDelta: true }, // the house default switches the Δ% label off
};

/**
 * Card options to drop before driving a field — a bound column that takes the field's place. A
 * prerequisite cannot express "without": `undefined` does not survive the JSON hop, so the block
 * is rewritten without the key instead.
 */
const WITHOUT: Record<string, string[]> = {
  "network.sizeByDegree": ["sizeColumn"], // a size column overrides degree sizing
  "network.lowColor": ["groupColumn"], // the group colouring hides the node value ramp
  "network.highColor": ["groupColumn"],
  "parallel.lineColor": ["colorColumn"], // a colour column replaces the single line colour
};

/**
 * Fields no style patch can reach from a gallery card, with the reason. Recorded rather than silently
 * passed — an unexercised field must never look like a tested one.
 */
const UNREACHABLE: Record<string, string> = {
  "heatmap.nanColor": "needs a non-numeric cell in the data; not reachable by styling",
  "treemap.showGroupLabels": "needs groupColumn = a live column id (see the skipped-id list)",
  "lollipop.baseline": "explicitly ignored for the dumbbell (two-dot) form the gallery card uses",
  // The split card ("Heatmap — clustered, split, annotated") is the one with clustering, splits and
  // strips, so those fields are measured. What it cannot show:
  "heatmap.resolution": "density2d needs an XY column table; the split card is a matrix, which the density mode refuses with a notice",
  "heatmap.trackKeys": "a key is drawn for a numeric strip only; the split card's two strips are categorical",
  "heatmap.collapseRowsBy": "one strip per axis on the card, so the only valid index is 0 — which the number candidates (7, 2, 0.25) never try",
  "heatmap.collapseColsBy": "same as collapseRowsBy",
  "network.nodeColor": "every node of the card carries a value, so all take the low→high ramp; nodeColor colours only value-less nodes (builder colorOf)",
  "ridgeline.bandwidth": "the horizon-fold card draws given profiles (source: profile); a KDE bandwidth has no density to smooth",
};

/**
 * Fields that change nothing on their gallery card, each with its reason. The suite
 * stays green on these while any other field that changes nothing fails, and a listed field
 * that starts changing the drawing fails too (the same scheme as `figure-geometry`'s list).
 */
const KNOWN_NO_EFFECT: Record<string, string> = {
  // parallel.colorMidpoint / colorGamma / colorSteps / colorSpace need a numeric colour column
  // (see PREREQS); on a text colour column the builder takes its categorical branch and there is
  // no ramp for them to shape.
  "paireddot.stemColor": "read only while stemLinkColor is false, and each stem is linked to its dot's colour by default (builder: stemLinked ? undefined : cfg.stemColor)",
  "paireddot.stemLinkColor": "unlinking alone changes nothing: with stemColor unset, an unlinked stem falls back to its dot's colour, the same colour a linked stem takes",
};

interface Field {
  name: string;
  type: string;
}

/** Fields of one `export interface XStyle` block, with their declared type text. */
function fieldsOf(iface: string): Field[] {
  const src = readFileSync(MODEL, "utf8");
  const m = new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return [];
  return [...m[1]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:\s*([^;]+);/gm)].map((x) => ({
    name: x[1]!,
    type: x[2]!.replace(/\s+/g, " ").trim(),
  }));
}

/**
 * Candidate values to try for a field, most-likely-to-differ first. Returns [] when no value
 * can be reliably synthesised (the caller records a skip rather than a pass or a failure).
 */
function candidates(f: Field): unknown[] {
  const t = f.type.replace(/\s*\|\s*undefined$/, "").trim();

  // Per-item override maps and column references need real ids from the live document.
  if (/^Record</.test(t) || /NodeId/.test(t)) return [];

  if (/^boolean$/.test(t)) return [true, false];
  if (/^number$/.test(t)) return [7, 2, 0.25];

  // A union of string literals: try each member.
  const literals = [...t.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  if (literals.length > 1) return literals;
  if (literals.length === 1 && /^"[^"]+"$/.test(t)) return literals;

  if (/^string$/.test(t)) {
    // Colour-ish by name, but "colorbarTitle" is a title — a bare /colou?r/ test would feed it a
    // hex string and report the working control as changing nothing. Text-ish suffixes win.
    const textish = /(title|text|label|name|caption|units?)$/i.test(f.name);
    const colourish = !textish && (/colou?r/i.test(f.name) || /^(stroke|fill)$/.test(f.name));
    return colourish ? ["#ff00ff", "#00ff00"] : ["ZZTest", "QQTest"];
  }
  // Named types (GradRamp, LineDash, …) — resolve only if they are a literal union.
  const src = readFileSync(MODEL, "utf8");
  const alias = new RegExp(`export type ${t} =([^;]+);`).exec(src);
  if (alias) {
    const opts = [...alias[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
    if (opts.length > 1) return opts;
  }
  return [];
}

test.describe("style-field efficacy — every style field must change the drawing", () => {
  test("no per-kind style field silently does nothing", async ({ page }) => {
    test.setTimeout(600_000);
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const dead: string[] = [];
    const skipped: string[] = [];
    const noCard: string[] = [];

    for (const k of KIND_STYLES) {
      const fields = fieldsOf(k.iface);
      if (fields.length === 0) {
        noCard.push(`${k.iface}: no fields parsed from model.ts`);
        continue;
      }
      try {
        await app.openGallery();
        await app.openGalleryCard(k.card);
      } catch {
        noCard.push(`${k.card}: gallery card not found`);
        continue;
      }
      await app.settle();
      /**
       * Patch over the card's own block, the way every Inspector control does
       * (`onSetPlotOptions({ network: { ...nw, ...patch } })`). `setPlotOptions` assigns a top-level
       * key, so a bare `{ network: { nodeColor } }` would throw away the card's groupColumn,
       * sizeColumn and edgeSignColors — and this test would then measure every network field on a
       * stripped block (sign colours off → edgePositiveColor unchanged; values on → nodeColor unchanged).
       */
      const livePlot = await app.plot(await app.activePlotId());
      const own = (livePlot?.[k.styleKey] ?? {}) as Record<string, unknown>;
      /** This card's own sheet, so a `COLUMN("Petal L")` prerequisite can be turned into the id
       *  the document gave that column when the card was opened. */
      const sheet = (((await app.project()) as { tables?: Array<{ id: string; columns: Array<{ id: string; name: string }> }> }).tables ?? [])
        .find((t) => t.id === livePlot?.["source"]);

      for (const f of fields) {
        const key = `${k.styleKey}.${f.name}`;
        if (UNREACHABLE[key]) {
          skipped.push(`${key} — ${UNREACHABLE[key]}`);
          continue;
        }
        const values = candidates(f);
        if (values.length === 0) {
          skipped.push(`${key} (${f.type}) — no value can be synthesised`);
          continue;
        }
        const raw = PREREQS[key];
        // A COLUMN() prerequisite that names nothing fails the run, loudly. Falling back to the
        // literal name would put the field on the list of fields that change nothing, with no hint
        // that this test, not the app, was at fault.
        const pre = raw && Object.fromEntries(Object.entries(raw).map(([field, v]) => {
          const wanted = (v as { column?: string } | null)?.column;
          if (wanted == null) return [field, v];
          const col = (sheet?.columns ?? []).find((c) => c.name === wanted);
          if (!col) throw new Error(`${key}: prerequisite needs a column named "${wanted}" on ${k.card}; it has ${JSON.stringify((sheet?.columns ?? []).map((c) => c.name))}`);
          return [field, col.id];
        }));
        const without = WITHOUT[key] ?? [];
        const base = { ...Object.fromEntries(Object.entries(own).filter(([x]) => !without.includes(x))), ...(pre ?? {}) };
        if (pre || without.length) await app.setPlotOptions({ [k.styleKey]: base });

        let moved = false;
        for (const v of values) {
          const before = await app.renderFingerprint();
          await app.setPlotOptions({ [k.styleKey]: { ...base, [f.name]: v } });
          const after = await app.renderFingerprint();
          if (before.digest !== after.digest) {
            moved = true;
            break;
          }
        }
        // Back to the card's own block (field and prerequisite gone), so the next field starts
        // from the card as drawn.
        await app.setPlotOptions({ [k.styleKey]: own });
        if (!moved) {
          dead.push(`${key} (${f.type}) — tried ${JSON.stringify(values)}${pre ? ` after ${JSON.stringify(pre)}` : ""}${without.length ? ` without ${without.join(",")}` : ""}`);
        }
      }
    }

    // Never a silent cap: say exactly what was not exercised.
    console.log(`[style-field efficacy] skipped ${skipped.length} field(s) needing live ids:\n  - ${skipped.join("\n  - ")}`);
    if (noCard.length) console.log(`[style-field efficacy] unreachable kinds:\n  - ${noCard.join("\n  - ")}`);

    const unexpected = dead.filter((d) => !KNOWN_NO_EFFECT[d.split(" ")[0]!]);
    const fixed = Object.keys(KNOWN_NO_EFFECT).filter((k) => !dead.some((d) => d.startsWith(k)));

    expect(
      unexpected,
      "Style fields that change nothing — the option exists, the builder ignores it (or only " +
        "honours it in one branch, e.g. a node colour applied only to value-less nodes):\n  - " +
        unexpected.join("\n  - ") +
        "\n",
    ).toEqual([]);

    // Two-sided: a listed field that changes the drawing must be removed from the list, so an entry
    // can never quietly outlive the problem it describes.
    expect(
      fixed,
      "Listed in KNOWN_NO_EFFECT, but they change the drawing — delete their entries:\n  - " +
        fixed.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });
});
