/**
 * Hover hints for the Inspector's schema-driven controls, keyed by field `key`.
 *
 * Keyed by key, not per-schema, because the same control appears in many chart kinds:
 * `twoToneTint` shows up under Area fill, Data points, Fill and Slice, and `fillType` under
 * four more. One entry here reaches every one of them, and they cannot drift apart.
 *
 * Note: **deliberately not exhaustive, and it should stay that way.** There are about a hundred fields; most
 * have labels that already say everything ("Opacity", "Thickness", "Size"). A hint on those
 * restates the label and teaches people that hovering here is a waste of a second — which
 * costs the hints that do matter their audience. Entries earn their place by explaining one
 * of three things:
 *
 *   1. a label that is a term of art, not a description — "Two-tone", "Cardinal", "Explode";
 *   2. an effect you cannot predict without trying it — what a bandwidth does to a violin;
 *   3. a trap worth naming — a Cardinal curve bulging past the data it was drawn from.
 *
 * A field carrying its own `hint` in the schema wins over this table, for the rare control
 * that means something different in one chart kind than in another.
 */
export const FIELD_HINTS: Readonly<Record<string, string>> = {
  // ── Fills ────────────────────────────────────────────────────────────────────
  fillType:
    "How the shape is filled: a flat colour, two-tone, a pattern, a gradient, a metallic sheen, or a colour that follows the value",
  twoToneTint: "Two-tone fills: how much lighter the inside is than its outline",
  twoToneShade: "Two-tone fills: how much darker the outline is than its inside",
  pattern: "Hatching, dots, grids and so on — these survive black-and-white printing, where colour alone does not",
  patternScale: "How tightly the pattern repeats — lower is coarser, higher is finer",
  patternColor: "The colour the pattern is drawn in (its background is set separately)",
  patternBg: "What sits behind the pattern — the fill colour, or nothing at all",
  gradientAngle: "Direction the gradient runs, in degrees. 0° is left-to-right",
  gradientTo: "The colour the gradient ends at; it starts from the fill colour above",
  metallic: "A preset metal sheen — gold, silver, copper and the rest",
  special: "A themed decorative fill — Rainbow facets, Galaxy, Carbon and the rest",

  // ── Colour and symbol driven by the data ─────────────────────────────────────
  gradMap: "Which value decides each shape's colour",
  gradRamp: "The colour scale used for value-graduated fills. Viridis and cividis stay readable to colourblind readers",
  gradReversed: "Flip the scale, so low values take the dark end instead of the light one",
  gradMin: "Value that maps to the start of the ramp. Leave empty to use the data's own minimum",
  gradMax: "Value that maps to the end of the ramp. Leave empty to use the data's own maximum",
  colorFromColumn: "Colour each point by the values in this column, instead of one colour for the whole series",
  colorFromMode: "Whether the column is read as numbers (a continuous ramp) or as categories (one colour each)",
  colorFromRamp: "The colour scale used when colouring by a numeric column",
  colorFromReversed: "Flip the ramp, so low values take the dark end",
  symbolFromColumn: "Give each category in this column its own symbol shape — readable without colour",

  // ── Lines ────────────────────────────────────────────────────────────────────
  connect:
    "How points are joined. Straight connects the dots; Smooth (monotone) curves without ever overshooting; Cardinal adds a smoothness slider",
  lineTension:
    "How rounded the Cardinal curve is. High values can bulge past your points, implying values you did not measure",
  lineDash: "Solid, dashed, dotted — a second way to tell series apart when colour is not available",
  linkLineColor: "Keep the connecting line the same colour as its data points, so changing one changes both",

  // ── Data points ──────────────────────────────────────────────────────────────
  symbol: "Marker shape. Varying shape as well as colour keeps series apart in print and for colourblind readers",
  symbolFill: "Solid, open (filled with the page colour, so gridlines do not show through), or clear (see-through)",

  // ── Error bars ───────────────────────────────────────────────────────────────
  errorBars: "What the bar spans: SD, SEM, a 95% confidence interval, the full range, or a geometric SD",
  errorDir: "Draw the bar upward, downward, or both ways from the mean",
  errorCaps: "The short crossbars at the ends of each error bar",

  // ── Box, violin and raincloud ────────────────────────────────────────────────
  whiskerSides: "Draw both whiskers, or only the upper or lower one",
  showOutliers: "Draw points beyond the whiskers individually, instead of hiding them inside the whisker",
  violinBandwidth:
    "How smooth the violin's silhouette is. Higher smooths detail away; lower shows more structure, including noise",
  violinShowBox: "Draw a small box-and-whisker inside the violin, so the quartiles are readable too",
  boxWidth: "Width of the box or violin as a fraction of the space for its category",

  // ── Pie ──────────────────────────────────────────────────────────────────────
  sliceExplode: "Pull this slice away from the centre to draw attention to it",
  sliceLabel: "What each slice's label shows — its name, its value, its percentage, or a combination",

  // ── Which axis ───────────────────────────────────────────────────────────────
  axis: "Which value axis this dataset is measured against — useful when two series share an X but not a scale",
  plotAs: "How this dataset is drawn, so one graph can mix (say) bars with a line",

  // ── Point labels ─────────────────────────────────────────────────────────────
  pointLabels: "Print a label beside each point — all of them, or only the extremes worth naming",
  pointLabelColumn: "Which column supplies the text for those labels",
};
