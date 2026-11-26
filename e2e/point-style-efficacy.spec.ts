import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Per-point style efficacy — "Format this point".
 *
 * The third efficacy layer. `style-field-efficacy` drives per-kind `*Style`, `series-style-
 * efficacy` drives `SeriesStyle` — and neither reaches `plot.pointStyles`, the per-mark
 * overrides keyed by `${seriesId}:${rowId}`. `valueText`, `valueDx` and `valueDy` are typed on
 * `SeriesStyle` but consumed only point-side, so set at series level they appear to do nothing. This is
 * where they actually live.
 *
 * The contract is `paintPointStyles` in buildScene: colour/fill, fill shape (the FILL_SHAPE_KEYS
 * group), border, the value-label trio, and the symbol group. Anything it honours must visibly
 * change the drawing; anything it does not is outside this check.
 *
 * Note: needs two live ids (series + row), parsed from a drawn mark's `mark-<series>-<row>` id.
 * Note: a per-point override must change one mark, not the series — asserted explicitly, because
 * "something changed" would also pass if the whole series repainted.
 */

interface PointCase {
  field: string;
  value: unknown;
  /** Series-level state the override needs before it can draw. */
  prereq?: Record<string, unknown>;
  /** Plot-level state it needs. Note: scope matters. The model says the per-bar value label
   *  draws when the plot's (not the series') showValues is on; putting that in seriesStyles makes the whole
   *  value trio appear to do nothing. Read the field's doc comment for which object owns the switch. */
  plotPrereq?: Record<string, unknown>;
  /** Kinds this override applies to; judged to do nothing only if it changes nothing on all of them. */
  kinds?: string[];
}

const BAR = "Bar / column (+ error bars)";
const XY = "XY (points + fitted curve)";

const POINT_CASES: PointCase[] = [
  // colour / fill — honoured on both bars and points
  { field: "color", value: "#ff00ff" },
  { field: "fillColor", value: "#00ff00" },
  { field: "fillOpacity", value: 0.25 },
  { field: "borderColor", value: "#ff00ff" },
  { field: "borderWidth", value: 5 },

  // the value-label trio — the reason this file exists. Labels must be on to see them.
  { field: "valueText", value: "ZZTest", plotPrereq: { showValues: true }, kinds: [BAR] },
  { field: "valueDx", value: 17, plotPrereq: { showValues: true }, kinds: [BAR] },
  { field: "valueDy", value: 17, plotPrereq: { showValues: true }, kinds: [BAR] },

  // fill shape group (FILL_SHAPE_KEYS) — re-resolves this one mark's fill spec
  { field: "fillType", value: "pattern", kinds: [BAR] },
  { field: "metallic", value: "gold", prereq: { fillType: "metallic" }, kinds: [BAR] },

  // symbol group — point kinds only
  { field: "symbol", value: "square", kinds: [XY] },
  { field: "symbolSize", value: 12, kinds: [XY] },
  { field: "symbolOpacity", value: 0.3, kinds: [XY] },
  { field: "symbolOutline", value: "#ff00ff", kinds: [XY] },
  { field: "symbolFillColor", value: "#00ff00", prereq: { symbolFill: "open" }, kinds: [XY] },
];

/** Overrides known to change nothing, each with its reason. Two-sided: an entry that starts working also fails. */
const KNOWN_NO_EFFECT: Record<string, string> = {};

test.describe("per-point style efficacy — 'Format this point' must actually format it", () => {
  test("every per-point override changes the drawing, and changes one mark", async ({ page }) => {
    test.setTimeout(600_000);
    await collectErrors(page);
    const app = new MadyApp(page);
    await app.open();

    const noChange: string[] = [];
    const wholeSeries: string[] = [];
    const unreachable: string[] = [];

    for (const card of [BAR, XY]) {
      await app.openGallery();
      await app.openGalleryCard(card);
      await app.settle();

      const key = await app.firstMarkKey();
      if (!key) {
        unreachable.push(`${card}: no mark-<series>-<row> element to target`);
        continue;
      }
      const pointKey = `${key.seriesId}:${key.rowId}`;

      for (const c of POINT_CASES) {
        if (c.kinds && !c.kinds.includes(card)) continue;

        // Series-level prerequisite (e.g. labels on) applied to the series, not the point.
        await app.setPlotOptions({
          ...(c.plotPrereq ?? {}),
          seriesStyles: c.prereq ? { [key.seriesId]: c.prereq } : {},
          pointStyles: {},
        });
        const before = await app.renderFingerprint();

        await app.setPlotOptions({ pointStyles: { [pointKey]: { ...(c.prereq ?? {}), [c.field]: c.value } } });
        const after = await app.renderFingerprint();

        if (before.digest === after.digest) {
          noChange.push(`${c.field} on ${card} — nothing changed`);
        } else {
          // A per-point override must not repaint the whole series. Compare how many marks
          // carry the new look: exactly one should differ from its neighbours.
          const distinctFills = new Set(after.nodeFill!.split(",")).size;
          const distinctWidths = new Set(after.perPathWidth!.split("|")).size;
          if (distinctFills === 1 && distinctWidths === 1 && /color|fill|border/i.test(c.field)) {
            wholeSeries.push(`${c.field} on ${card} — every mark looks identical; the override may have hit the series`);
          }
        }
        await app.setPlotOptions({ seriesStyles: {}, pointStyles: {} });
      }
    }

    if (unreachable.length) console.log(`[point-style efficacy] unreachable:\n  - ${unreachable.join("\n  - ")}`);

    const byField = new Map<string, number>();
    for (const d of noChange) byField.set(d.split(" ")[0]!, (byField.get(d.split(" ")[0]!) ?? 0) + 1);
    const applicable = (f: string): number => POINT_CASES.filter((c) => c.field === f).flatMap((c) => c.kinds ?? [BAR, XY]).length;
    const noEffectAnywhere = [...byField.entries()].filter(([f, n]) => n >= applicable(f)).map(([f]) => f);

    const unexpected = noEffectAnywhere.filter((f) => !KNOWN_NO_EFFECT[f]);
    const fixed = Object.keys(KNOWN_NO_EFFECT).filter((f) => !noEffectAnywhere.includes(f));

    expect(
      unexpected,
      "Per-point overrides that change nothing — 'Format this point' offers them and the mark " +
        "does not move:\n  - " +
        unexpected.join("\n  - ") +
        "\n",
    ).toEqual([]);
    expect(
      wholeSeries,
      "Per-point overrides that repaint the whole series — a point override must affect one " +
        "mark:\n  - " +
        wholeSeries.join("\n  - ") +
        "\n",
    ).toEqual([]);
    expect(
      fixed,
      "Listed as known to change nothing, but these overrides work — remove their entries:\n  - " + fixed.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});
