/**
 * What each command does, in one line, for the model's prompt.
 *
 * Without this, the prompt gives an op only its name and its required field names:
 *
 *     - setAxis (needs id, axis, patch)
 *
 * That says nothing about what the op does or what goes inside `patch`. With such a bare prompt a
 * model has to guess: nothing says `title` belongs in an axis patch, and nothing lists the chart
 * kinds a `kind` value may take.
 *
 * Default-deny: every non-destructive op must appear here, enforced by `opHelp.test.ts`. A new
 * op with no help text fails the build rather than silently reaching a model as a bare name.
 *
 * Note: destructive ops are absent on purpose. They are never offered to a model, so there is
 * nothing to describe.
 *
 * `keys` is the half that matters most. `patch`, `style` and `annotation` are free-form objects
 * — a model with no idea what may go in one will invent a field, and an invented field is
 * silently ignored by the builder. These are the real names, taken from the model.
 */
import type { AgentOp } from "./agentApi";
import { STYLE_PRESETS } from "./presets";

export interface OpHelp {
  /** One line: what it does, in the words a user would use. */
  does: string;
  /** The field names that may appear inside this op's free-form object, where it has one. */
  keys?: string;
}

/** Every op a model may be offered, and what it is for. */
// The words in capitals are instructions to the model, not emphasis for a reader: this text was
// tuned against the command corpus with them, and opHelp.test.ts checks the key ones are sent.
export const OP_HELP: Partial<Record<AgentOp, OpHelp>> = {
  // reads
  listTables: { does: "list the datasheets in the project" },
  listGraphs: { does: "list the graphs in the project" },
  listAnalyses: { does: "list the statistical analyses in the project" },
  listFigures: { does: "list the multi-panel figures in the project" },
  getTable: { does: "read one datasheet's columns and rows, WITH their ids (the only way to get a row id)" },
  getGraph: { does: "read one graph's full settings" },
  getAnalysis: { does: "read one analysis and its results" },

  // making things
  createTable: { does: "create a new datasheet from data you supply" },
  createGraph: { does: "create a new graph of an existing datasheet" },
  createFigure: { does: "create an empty multi-panel figure page" },
  addFigurePanel: { does: "put an existing graph onto a figure as a panel" },
  setFigureOptions: { does: "change a figure's layout", keys: "columns, spacing, panelLabels" },

  // the graph itself
  setGraphKind: { does: "change what KIND of chart a graph is drawn as (bar, violin, box, heatmap, …)" },
  setGraphOptions: {
    does: "change a graph's own settings — this is where the graph's TITLE lives",
    keys: "title, subtitle, showLegend, barOrientation, figureWidth, figureHeight",
  },
  setAxis: {
    does: "change one axis of a graph (x, y, y2 or y3)",
    keys: "title, scale ('linear' or 'log10'), min, max, reversed, decimals",
  },
  setSeriesStyle: { does: "restyle ONE data series", keys: "color, symbol, symbolSize, lineWidth, lineDash, fill" },
  setFit: { does: "put a fitted curve on a graph, or remove it with null" },
  setFits: { does: "put one fitted curve per dataset on a graph, or remove them with null" },

  // things drawn on the graph
  addAnnotation: {
    does: "draw an object on a graph: a text label, a reference line, a bracket, an arrow, a shaded band",
    keys:
      "kind (REQUIRED: 'text' | 'hline' | 'vline' | 'bracket' | 'arrow' | 'segment' | 'rect' | 'ellipse' | " +
      "'callout' | 'highlight' | 'hband' | 'vband'), label (the TEXT of a note), value (the axis value a " +
      "reference line sits at), x and y (FRACTIONS of the plot area, 0 to 1 — not data values), color",
  },
  updateAnnotation: { does: "change an object already drawn on a graph", keys: "label, color, x, y, value" },
  removeAnnotation: { does: "remove one object from a graph" },
  setSignificance: { does: "style the significance markers on a graph", keys: "style ('stars' or 'pvalue'), thresholds" },

  // how it looks
  applyStylePreset: {
    // The names have to be here: a prompt that calls a preset "named" without naming one
    // leaves requests such as "the journal wants it in black and white" unanswerable. Taken
    // from STYLE_PRESETS, not copied, so a renamed preset cannot go stale here.
    does: `restyle a whole graph with a named built-in preset — one call instead of many. The presets are: ${STYLE_PRESETS.map((p) => p.name).join(" | ")}`,
  },
  setFont: { does: "change the font of one text element of a graph", keys: "size, family, bold, italic, color" },
  setLegend: { does: "change a graph's legend/key", keys: "show (false hides it), position, frame" },
  setGrid: { does: "change a graph's gridlines", keys: "x, y (true/false), color, dash, density" },
  setFrame: { does: "change the plot frame and ticks", keys: "frame ('box'|'lshape'|'offset'|'none'), tickDir, tickLen" },

  // the data
  setCell: { does: "write one cell of a datasheet (row and column are ids from getTable)" },
  addRow: { does: "append a row of values to a datasheet" },
  addColumn: { does: "append a new empty column to a datasheet" },
  renameColumn: { does: "rename one column — its id does not change, so graphs keep working" },
  setColumnType: { does: "set a column's data type" },
  sortRows: { does: "sort a datasheet's rows by one column" },
  setCellsExcluded: { does: "exclude cells from every graph and analysis (or put them back), without deleting them" },

  // analysis
  runAnalysis: {
    does: "set up a statistical analysis on a datasheet (does not compute it)",
    keys: "params holds the analysis's own settings, e.g. columns (an array of column ids)",
  },

  // the project
  addFolder: { does: "add a top-level project folder" },
  addExperiment: { does: "add an experiment inside a project folder" },
  renameFolder: { does: "rename a project folder" },
  renameExperiment: { does: "rename an experiment" },
};

/**
 * Worked examples, chosen from the requests a model is prone to get wrong.
 *
 * Not a random sample. Each one shows a common mistake: a title going to `createFigure`
 * instead of `setGraphOptions`, an annotation sent as a bare string instead of an object, a
 * two-part request answered with only one command. Examples of what a model already gets right
 * would teach it nothing.
 *
 * Note: their wording differs from the requests in `commandCorpus.ts`, so a model checked
 * against that corpus cannot answer by repeating these examples.
 */
export const PROMPT_EXAMPLES: { ask: string; answer: string }[] = [
  {
    ask: "give the chart the heading Tumour volume",
    answer: '[{"op":"setGraphOptions","id":"g1","patch":{"title":"Tumour volume"}}]',
  },
  {
    ask: "the bottom axis should be labelled Time (days)",
    answer: '[{"op":"setAxis","id":"g1","axis":"x","patch":{"title":"Time (days)"}}]',
  },
  {
    ask: "write 'p < 0.01' on the chart",
    answer: '[{"op":"addAnnotation","id":"g1","annotation":{"kind":"text","label":"p < 0.01","x":0.5,"y":0.9}}]',
  },
  {
    ask: "put a line across at 100",
    answer: '[{"op":"addAnnotation","id":"g1","annotation":{"kind":"hline","value":100}}]',
  },
  {
    ask: "draw it the other way round, biggest first",
    answer: '[{"op":"setAxis","id":"g1","axis":"x","patch":{"reversed":true}}]',
  },
  {
    ask: "make it a box plot and label the left axis Signal",
    answer:
      '[{"op":"setGraphKind","id":"g1","kind":"box"},{"op":"setAxis","id":"g1","axis":"y","patch":{"title":"Signal"}}]',
  },
];
