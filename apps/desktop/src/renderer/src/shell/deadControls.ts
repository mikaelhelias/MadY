/**
 * Kinds on which a whole Inspector group can never change the drawing — measured, not guessed.
 *
 * `dead-controls-and-formats.test.tsx` builds every gallery kind, toggles the group's options and
 * compares the rendered drawing; a kind whose drawing never moves must be listed here (with the sentence the
 * panel shows instead), and a kind listed here whose drawing does move fails the build. So the
 * lists cannot drift from the builders: add a builder feature and the guard asks for the kind
 * to be taken off the list; remove one and it asks for the kind to be added.
 *
 * The lists are checked against that measurement rather than trusted as written, because a
 * list kept by hand alone is easily wrong in both directions.
 */

/** The Frame tab's "Grid, frame & axes" section (frame style, tick direction/length, gridlines). */
export const FRAME_DEAD_KINDS: Record<string, string> = {
  pie: "A pie has no plot frame or gridlines — slice outlines and labels live in the Pie chart section.",
  radar: "A radar's rings and spokes are its grid — set them in the Radar section.",
  venn: "A Venn diagram has no frame or gridlines — disc outlines live in the Venn diagram section.",
  rose: "A polar histogram's rings are its grid — set them in the Polar histogram section.",
  alluvial: "An alluvial diagram has no frame or gridlines.",
  chord: "A chord diagram has no frame or gridlines — the ring is set in the Chart type section.",
  corrmatrix: "A correlation matrix has no frame or gridlines — cell borders live in the Correlation matrix section.",
  oncoprint: "An oncoprint has no frame or gridlines — the tile grid is set in the Chart type section.",
  parallel: "Parallel coordinates has no plot frame or gridlines — each vertical axis is styled by clicking it.",
  scatter3d: "A 3-D scatter's cube is its frame — its edges and grid live in the 3-D scatter section.",
  sunburst: "A sunburst has no frame or gridlines — ring gaps live in the Chart type section.",
  treemap: "A treemap has no frame or gridlines — cell borders live in the Treemap section.",
  network: "A network graph has no frame or gridlines.",
};

/** The series panel's marker rows (shape, size, fill, opacity, outline) and error-bar rows. */
export const NO_MARKER_KINDS: Record<string, string> = {
  alluvial: "An alluvial's ribbons and nodes are not point markers — colour them in the Alluvial section.",
  chord: "A chord's arcs and ribbons are not point markers — colour them in the Chart type section.",
  corrmatrix: "Correlation cells are not point markers — the pie glyphs are styled in the Correlation matrix section.",
  dendrogram: "A dendrogram draws branches, not markers — line width and colours live in the Dendrogram section.",
  oncoprint: "Oncoprint tiles are not point markers — alteration colours live in the Chart type section.",
  parallel: "Parallel-coordinates lines carry no markers — line colour and width live in the Parallel coordinates section.",
  // Measured on the drawing (dead-controls-and-formats.test.tsx): the scene carries the marker
  // fields for these three, but the renderer never draws them.
  ridgeline: "A ridgeline draws stacked ridges, not point markers — fill, bands and overlap live in the Chart type section.",
  roc: "A ROC curve is a step line with no point markers — line width and colour are its look.",
  survival: "A survival curve is a step line — its censor ticks are not markers; line width and colour are its look.",
  sunburst: "Sunburst segments are not point markers — colours live in the Chart type section.",
  // None of the marker rows moves a timeline track's drawing. `tracks` has no
  // series-panel branch of its own, so it falls through to here, and it must not sit in the
  // guard's `curated` escape list or it would go unmeasured.
  tracks: "A timeline track is a coloured strip per column, not point markers — track height, the colour ramps and the strip labels live in the Chart type section.",
  treemap: "Treemap cells are not point markers — colours live in the Treemap section.",
  venn: "Venn discs are not point markers — set colours are in the Venn diagram section.",
};
