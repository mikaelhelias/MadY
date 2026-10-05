/**
 * Okabe-Ito — an 8-colour qualitative palette designed to be distinguishable
 * under all common forms of colour-vision deficiency (Okabe & Ito 2008). Used
 * as the default series palette so multi-series graphs are colourblind-safe by
 * default. Ordered for good contrast on a white plot (yellow late).
 */
export const OKABE_ITO: readonly string[] = [
  "#0072B2", // blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#D55E00", // vermillion
  "#CC79A7", // reddish purple
  "#56B4E9", // sky blue
  "#F0E442", // yellow
  "#000000", // black
];

/** Bright qualitative set (Tol "vibrant") — high contrast on white, still CVD-aware. */
export const TOL_VIBRANT: readonly string[] = [
  "#EE7733", "#0077BB", "#33BBEE", "#EE3377", "#CC3311", "#009988", "#BBBBBB",
];

/** Warm editorial ramp (oranges → reds → purples) for sequential-feeling series. */
export const WARM: readonly string[] = [
  "#F4A259", "#E76F51", "#D62246", "#A23B72", "#6A4C93", "#3D348B",
];

/** Perceptually-even greys — print / no-colour journals. */
export const GRAYSCALE: readonly string[] = [
  "#222222", "#555555", "#888888", "#AAAAAA", "#C8C8C8", "#E2E2E2",
];

/** Named palettes for the gallery's style controls and the palette picker. First = the default. */
export const PALETTES: Readonly<Record<string, readonly string[]>> = {
  "Okabe–Ito (colourblind-safe)": OKABE_ITO,
  "Vibrant": TOL_VIBRANT,
  "Warm": WARM,
  "Grayscale": GRAYSCALE,
};

/** The series colour for index `i` (cycles if there are more series than colours). */
export function seriesColor(i: number, palette: readonly string[] = OKABE_ITO): string {
  return palette[i % palette.length]!;
}

/**
 * Colours for a row of series, given each one's saved colour (undefined = none saved).
 *
 * A saved colour is kept as it is. A series with none takes its palette slot — unless a sibling
 * already wears that colour (saved, or given out earlier in this row), in which case it takes the
 * next palette colour nobody wears. Colours are saved when a graph is made, counted over its
 * datasheet's columns; a builder that skips a column (a text section column) counts differently,
 * so an added series could land on a sibling's colour. When every palette colour is taken it wraps
 * by slot, exactly as `seriesColor` does.
 */
export function seriesColors(saved: ReadonlyArray<string | undefined>, palette: readonly string[] = OKABE_ITO): string[] {
  const key = (c: string): string => c.trim().toLowerCase();
  const worn = new Set(saved.filter((c): c is string => !!c).map(key));
  return saved.map((own, i) => {
    if (own) return own;
    let pick = seriesColor(i, palette);
    for (let step = 0; step < palette.length && worn.has(key(pick)); step++) pick = seriesColor(i + step + 1, palette);
    if (worn.has(key(pick))) pick = seriesColor(i, palette); // palette used up: wrap by slot
    worn.add(key(pick));
    return pick;
  });
}
