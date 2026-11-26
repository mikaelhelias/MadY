/**
 * Refuse an edit that cannot land, in words, before it runs.
 *
 * The edit tools take a free-form patch. Unchecked, a key no chart has, or a value outside the choices a setting takes, would
 * be stored and drawn as nothing (an axis scale of "log" would draw a linear axis; a legend position of "bottom" would leave
 * the legend where it is) while the reply said ok. The keys come from the option catalogue (every option of every chart, measured
 * against the model); the choices come from the enumerations below, which a test holds equal to model.ts.
 */
import { PLOT_KINDS } from "@mady/core";
import { optionFacts } from "./optionCatalog.js";

/** The choices of each enumerated setting. A path with a series id in it is written `seriesStyles.*.symbol`. */
export const ENUM_VALUES: Record<string, readonly string[]> = {
  "xAxis.scale": ["linear", "log10", "log2", "ln", "probit"],
  "yAxis.scale": ["linear", "log10", "log2", "ln", "probit"],
  "y2Axis.scale": ["linear", "log10", "log2", "ln", "probit"],
  "y3Axis.scale": ["linear", "log10", "log2", "ln", "probit"],
  "legend.position": ["right", "top", "topright", "topleft", "bottomright", "bottomleft", "none", "direct"],
  "legend.orientation": ["vertical", "horizontal"],
  frame: ["box", "lshape", "offset", "none"],
  tickDir: ["out", "in", "both", "none"],
  "grid.dash": ["solid", "dashed", "dotted", "dashdot", "longdash"],
  "seriesStyles.*.symbol": ["circle", "square", "triangle", "triangle-down", "diamond", "plus", "cross", "star", "hexagon", "pentagon", "octagon", "ring", "squircle", "oval", "waffle", "none"],
  "seriesStyles.*.symbolFill": ["solid", "open", "clear", "twotone"],
  "seriesStyles.*.connect": ["none", "straight", "step", "stepBefore", "stepAfter", "smooth", "cardinal", "catmullRom", "basis", "natural"],
  "seriesStyles.*.lineDash": ["solid", "dashed", "dotted", "dashdot", "longdash"],
  "seriesStyles.*.errorBars": ["none", "sd", "sem", "ci95", "range", "geoSd", "asymmetric", "iqr"],
  "seriesStyles.*.plotAs": ["auto", "bars", "line", "points", "area"],
  barLayout: ["grouped", "stacked", "overlay", "percent"],
  barShape: ["square", "rounded", "roundtop"],
  barSort: ["none", "asc", "desc"],
  barOrientation: ["vertical", "horizontal"],
  valuePlacement: ["above", "insideEnd", "insideBase"],
  boxWhisker: ["tukey", "minmax", "p10_90", "p5_95", "p2_5_97_5", "p1_99", "sd", "sem", "ci95"],
  kind: [...PLOT_KINDS],
};

const NAMED_COLOURS = new Set(
  ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
    "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
    "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
    "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
    "lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey " +
    "snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor none").split(" "),
);

/** A colour a drawing can use: hex, a colour function, a CSS variable, or a CSS colour name. */
export function isCssColor(s: string): boolean {
  const v = s.trim();
  if (v === "") return false;
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^()]+\)$/i.test(v)) return true;
  if (/^var\(--[\w-]+(,[^()]*)?\)$/i.test(v)) return true;
  return NAMED_COLOURS.has(v.toLowerCase());
}

/**
 * Colour settings whose name does not end in "color": each a CSS colour by its description in model.ts. A path with
 * a series or point id is written without it. A test reads model.ts and fails on a colour field missing from here.
 */
export const COLOUR_OPTIONS: ReadonlySet<string> = new Set([
  "background", "manhattan.colorA", "manhattan.colorB", "network.nodeStroke", "sunburst.stroke", "treemap.stroke", "swimmer.responseFill",
  ...["gradTo", "gradientTo", "patternBg", "sliceStroke", "symbolOutline", "twoToneEdge"].flatMap((f) => [`seriesStyles.${f}`, `pointStyles.${f}`]),
]);

/** An annotation's colour fields. */
export const ANNOTATION_COLOUR_FIELDS: readonly string[] = ["color", "fill", "borderColor"];

const notAColour = (shown: string, value: unknown): string =>
  `'${shown}' = ${JSON.stringify(value)} is not a colour (use #rrggbb, rgb(…), or a CSS colour name).`;

// ── the key registry ────────────────────────────────────────────────────────────

interface Registry {
  all: Set<string>;
  /** Every path that has something below it ("legend", "xAxis", "seriesStyles"). */
  parents: Set<string>;
}
let registry: Registry | undefined;
function paths(): Registry {
  if (registry) return registry;
  const f = optionFacts();
  const all = new Set<string>([...f.working, ...f.deadEverywhere, ...f.untestable]);
  const parents = new Set<string>();
  for (const p of all) {
    const segs = p.split(".");
    for (let i = 1; i < segs.length; i++) parents.add(segs.slice(0, i).join("."));
  }
  registry = { all, parents };
  return registry;
}

/** A path with a series / point id in it, without the id: `seriesStyles.col_3.color` -> `seriesStyles.color`. */
const withoutId = (segs: string[]): string[] => (segs[0] === "seriesStyles" || segs[0] === "pointStyles") && segs.length >= 2 ? [segs[0], ...segs.slice(2)] : segs;
const enumKey = (segs: string[]): string => (segs[0] === "seriesStyles" && segs.length >= 3 ? ["seriesStyles", "*", ...segs.slice(2)].join(".") : segs.join("."));

const words = (s: string): string[] => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** The options one level below `parent` ("" = the graph itself). */
function siblings(parent: string): string[] {
  const out = new Set<string>();
  const depth = parent === "" ? 0 : parent.split(".").length;
  for (const p of paths().all) {
    if (parent !== "" && !p.startsWith(`${parent}.`)) continue;
    out.add(p.split(".")[depth]!);
  }
  return [...out].sort();
}

function suggest(parent: string, key: string): string {
  const sib = siblings(parent);
  if (sib.length === 0) return "";
  if (sib.length <= 60) return ` The options here are: ${sib.join(", ")}.`;
  return ` Closest: ${closest(key, sib).join(", ")}. describe_options lists the options that change a chart's drawing.`;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Check a patch of options against the registry and the enumerations. `prefix` is where the patch sits ("legend", "xAxis",
 * "seriesStyles.*" for one series' style, "" for the whole graph). Returns one sentence per problem, none when it is fine.
 */
export function checkOptionPatch(patch: Record<string, unknown>, prefix = ""): string[] {
  const problems: string[] = [];
  const walk = (segs: string[], value: unknown): void => {
    const shown = segs.filter((s) => s !== "*").join(".");
    // Result data the analysis workflows write onto a graph (not options): not checked key by key, because the
    // catalogue lists only what it could measure and the workflows add fields of their own.
    if (DATA_ROOTS.has(segs[0]!)) return;
    const key = withoutId(segs);
    const dotted = key.join(".");
    const { all, parents } = paths();
    if (!all.has(dotted) && !parents.has(dotted)) {
      const parent = key.slice(0, -1).join(".");
      problems.push(`'${shown}' is not an option.${suggest(parent, key[key.length - 1]!)}`);
      return;
    }
    if (value !== null && value !== undefined) {
      const choices = ENUM_VALUES[enumKey(segs)];
      if (choices && !(typeof value === "string" && choices.includes(value))) {
        problems.push(`'${shown}' = ${JSON.stringify(value)} is not one of ${choices.join(", ")}.`);
        return;
      }
      const last = key[key.length - 1]!;
      if ((last === "color" || last.endsWith("Color") || COLOUR_OPTIONS.has(dotted)) && typeof value === "string" && !isCssColor(value)) {
        problems.push(notAColour(shown, value));
        return;
      }
    }
    if (isPlain(value) && parents.has(dotted)) {
      // A record keyed by series or point id: the next key is an id, not an option.
      const keyed = segs.length === 1 && (segs[0] === "seriesStyles" || segs[0] === "pointStyles");
      for (const [k, v] of Object.entries(value)) {
        if (keyed) {
          if (isPlain(v)) for (const [k2, v2] of Object.entries(v)) walk([...segs, k, k2], v2);
        } else walk([...segs, k], v);
      }
    }
  };
  const base = prefix === "" ? [] : prefix.split(".");
  for (const [k, v] of Object.entries(patch)) walk([...base, k], v);
  return problems;
}

/** Graph fields that hold an analysis result rather than an option. */
const DATA_ROOTS: ReadonlySet<string> = new Set(["pca", "roc", "survival", "fit", "fits"]);

/** Keys the small patches take. */
const FONT_KEYS = ["size", "family", "bold", "italic", "color"];
const FRAME_KEYS = ["frame", "tickDir", "tickLen"];

const AXIS_ROOT: Record<string, string> = { x: "xAxis", y: "yAxis", y2: "y2Axis", y3: "y3Axis" };

const list = (name: string, ps: string[]): string[] => ps.map((p) => `${name}: ${p}`);

/** The closest few of `choices` to a key that is not one of them: shared words first, then spelling. */
function closest(key: string, choices: readonly string[], n = 5): string[] {
  const kw = new Set(words(key));
  return choices
    .map((s) => ({ s, shared: words(s).filter((w) => kw.has(w)).length, d: distance(s.toLowerCase(), key.toLowerCase()) }))
    .sort((a, b) => b.shared - a.shared || a.d - b.d)
    .slice(0, n)
    .map((x) => x.s);
}

// ── annotations ─────────────────────────────────────────────────────────────────

/** The kinds of object an annotation can be (`AnnotationKind` in model.ts; a test holds the two equal). */
export const ANNOTATION_KINDS: readonly string[] = ["hline", "vline", "text", "bracket", "rect", "highlight", "ellipse", "arrow", "segment", "callout", "image", "vband", "hband"];

/** Every field an annotation has (`Annotation` in model.ts; a test holds the two equal). */
export const ANNOTATION_FIELDS: readonly string[] = [
  "id", "kind", "value", "label", "color", "dash", "width", "size", "fontFamily", "bold", "italic", "x", "y", "x2", "y2", "w", "h",
  "bandLo", "bandHi", "href", "fill", "fillOpacity", "align", "padding", "radius", "borderColor", "anchorX", "anchorY", "arrowHead",
  "rotation", "from", "to", "bracketY", "plannedY", "bracketShift", "bracketShape", "bracketLegs", "fromSeries", "toSeries", "showSymbol",
  "showP", "freeform", "p", "labelOverride", "role", "sig", "group", "locked", "inLegend", "labelOffset",
];

const BRACKET_ONLY = ["from", "to", "bracketY", "plannedY", "bracketShift", "bracketShape", "bracketLegs", "fromSeries", "toSeries", "showSymbol", "showP", "freeform", "p", "labelOverride", "sig"];

/**
 * Fields the drawing reads on some kinds only. Any other kind stores them and draws nothing from them: a vband given a
 * bracket's `from`/`to` is drawn at the default place, because a band spans `bandLo`..`bandHi` or `x`..`x`+`w`.
 */
export const KIND_ONLY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  value: ["hline", "vline"],
  bandLo: ["hband", "vband"],
  bandHi: ["hband", "vband"],
  href: ["image"],
  ...Object.fromEntries(BRACKET_ONLY.map((f) => [f, ["bracket"]])),
};

/** What places each kind on the graph, so a refusal can say what to send instead. */
const PLACED_BY: Readonly<Record<string, string>> = {
  hline: "A hline is placed by 'value' (a value on Y).",
  vline: "A vline is placed by 'value' (a value on X).",
  hband: "An hband spans 'bandLo' to 'bandHi' (values on Y), or 'y' to 'y' + 'h' (fractions of the plot, 0..1).",
  vband: "A vband spans 'bandLo' to 'bandHi' (values on X), or 'x' to 'x' + 'w' (fractions of the plot, 0..1).",
  bracket: "A bracket joins 'from' and 'to' (the positions of the two groups), at height 'bracketY'.",
  text: "A text's words are 'label', placed at 'x', 'y' (fractions of the plot, 0..1).",
  callout: "A callout's words are 'label', placed at 'x', 'y', with its arrow tip at 'x2', 'y2' (fractions of the plot, 0..1).",
  rect: "A rect is placed by 'x', 'y', 'w', 'h' (fractions of the plot, 0..1).",
  highlight: "A highlight is placed by 'x', 'y', 'w', 'h' (fractions of the plot, 0..1).",
  ellipse: "An ellipse is placed by 'x', 'y', 'w', 'h' (fractions of the plot, 0..1).",
  image: "An image is 'href' (a data URI), placed by 'x', 'y', 'w', 'h' (fractions of the plot, 0..1).",
  arrow: "An arrow runs from 'x', 'y' to 'x2', 'y2' (fractions of the plot, 0..1).",
  segment: "A segment runs from 'x', 'y' to 'x2', 'y2' (fractions of the plot, 0..1).",
};

/** Names an annotation field is often given under. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  text: "label", body: "label", caption: "label", title: "label", content: "label",
  fontSize: "size", lineWidth: "width", strokeWidth: "width", opacity: "fillOpacity", lineDash: "dash",
};

const article = (kind: string): string => (/^[aeiou]|^h(line|band)$/.test(kind) ? "an" : "a");

/**
 * Check one annotation's fields: every key must be an annotation field, and a field only some kinds draw must belong to
 * `kind`. `kind` undefined (an update whose annotation could not be looked up) checks the names only. `update` refuses a
 * change of kind or id, which an edit cannot make.
 */
export function checkAnnotationFields(fields: Record<string, unknown>, kind: string | undefined, update = false): string[] {
  const problems: string[] = [];
  const known = kind !== undefined && ANNOTATION_KINDS.includes(kind) ? kind : undefined;
  const hint = known ? ` ${PLACED_BY[known]}` : "";
  for (const k of Object.keys(fields)) {
    if (update && (k === "kind" || k === "id")) {
      problems.push(`'${k}' cannot be changed on an existing annotation; remove it and add a new one.`);
      continue;
    }
    if (!ANNOTATION_FIELDS.includes(k)) {
      const alias = FIELD_ALIASES[k];
      const usable = ANNOTATION_FIELDS.filter((f) => !known || !KIND_ONLY_FIELDS[f] || KIND_ONLY_FIELDS[f]!.includes(known));
      problems.push(`'${k}' is not an annotation field.${alias ? ` Did you mean '${alias}'?` : ` Closest: ${closest(k, usable).join(", ")}.`}${hint}`);
      continue;
    }
    const v = fields[k];
    if (ANNOTATION_COLOUR_FIELDS.includes(k) && typeof v === "string" && !isCssColor(v)) problems.push(notAColour(k, v));
    const owners = KIND_ONLY_FIELDS[k];
    if (known && owners && !owners.includes(known)) {
      problems.push(`'${k}' is not drawn on ${article(known)} ${known} (only on ${owners.join(" and ")}).${hint}`);
    }
  }
  return problems;
}

// ── analysis settings ───────────────────────────────────────────────────────────

/** Every setting an analysis takes (`AnalysisParams` in model.ts; a test holds the two equal). */
export const ANALYSIS_PARAM_FIELDS: readonly string[] = [
  "agreementK", "alpha", "baselineValue", "blockLabels", "bound", "boundHigh", "boundLow", "boundMode", "chengProsuff", "ciMethod", "columns",
  "compare", "compareOneCurve", "componentSelection", "conf", "consts", "control", "correction", "dimensions", "ecLevels", "equation", "expectedColumn",
  "explanatory", "explanatory2", "explanatory3", "fixed", "fixedK", "flag", "groupBy", "initialValues", "k", "kMax", "kaiserThreshold",
  "lambda", "linkage", "marker2", "metric", "minPeakFraction", "mu", "nResamples", "pairs", "pairwise", "pairwiseMethod",
  "parallelPercentile", "paramBounds", "percent", "permutations", "pooled", "posthoc", "rangeFrom", "rangeTo", "rout", "rscale", "scaling",
  "scanK", "scheme", "seed", "shared", "sloped", "smoothWindow", "standardize", "statistic", "tail", "throughPoint", "transform", "tries",
  "varianceThreshold", "variant", "variant2", "weighting",
];

/**
 * Check an analysis's settings by name. A setting no analysis has is stored and never read, so the analysis runs with its
 * default: `baseline: 2` on an area under the curve keeps the baseline at 0 (the setting is `baselineValue`).
 */
export function checkAnalysisParams(params: Record<string, unknown>): string[] {
  return Object.keys(params)
    .filter((k) => !ANALYSIS_PARAM_FIELDS.includes(k))
    .map((k) => `'${k}' is not an analysis setting. Closest: ${closest(k, ANALYSIS_PARAM_FIELDS).join(", ")}.`);
}

/**
 * The problems with one agent command's content that need no project: unknown or mistyped options, values outside their
 * choices, colours that are not colours, annotation fields and analysis settings that do not exist. Empty when the
 * command is fine (or is not one of the checked ops). `annotationKind` looks up the kind of an annotation an update
 * names; without it an update's fields are checked by name only.
 */
export function checkCommandContent(command: unknown, annotationKind?: (graph: string, annotation: string) => string | undefined): string[] {
  if (!isPlain(command) || typeof command.op !== "string") return [];
  const patch = isPlain(command.patch) ? command.patch : undefined;
  switch (command.op) {
    case "addAnnotation": {
      if (!isPlain(command.annotation)) return [];
      const kind = command.annotation.kind;
      if (typeof kind === "string" && !ANNOTATION_KINDS.includes(kind)) {
        return [`addAnnotation: kind ${JSON.stringify(kind)} is not an annotation kind. The kinds are: ${ANNOTATION_KINDS.join(", ")}.`];
      }
      return list("addAnnotation", checkAnnotationFields(command.annotation, typeof kind === "string" ? kind : undefined));
    }
    case "updateAnnotation": {
      if (!patch) return [];
      const kind = annotationKind && typeof command.id === "string" && typeof command.annotation === "string" ? annotationKind(command.id, command.annotation) : undefined;
      return list("updateAnnotation", checkAnnotationFields(patch, kind, true));
    }
    case "runAnalysis": return isPlain(command.params) ? list("runAnalysis", checkAnalysisParams(command.params)) : [];
    case "setGraphOptions": return patch ? list("setGraphOptions", checkOptionPatch(patch)) : [];
    case "setAxis": return patch && typeof command.axis === "string" && AXIS_ROOT[command.axis] ? list(`setAxis(${command.axis})`, checkOptionPatch(patch, AXIS_ROOT[command.axis])) : [];
    case "setLegend": return patch ? list("setLegend", checkOptionPatch(patch, "legend")) : [];
    case "setGrid": return patch ? list("setGrid", checkOptionPatch(patch, "grid")) : [];
    case "setSignificance": return patch ? list("setSignificance", checkOptionPatch(patch, "significance")) : [];
    case "setFrame": {
      if (!patch) return [];
      const known = Object.fromEntries(Object.entries(patch).filter(([k]) => FRAME_KEYS.includes(k)));
      const unknown = Object.keys(patch).filter((k) => !FRAME_KEYS.includes(k)).map((k) => `'${k}' is not an option. The options here are: ${FRAME_KEYS.join(", ")}.`);
      return list("setFrame", [...unknown, ...checkOptionPatch(known)]);
    }
    case "setFont": {
      if (!patch) return [];
      const out = Object.keys(patch).filter((k) => !FONT_KEYS.includes(k)).map((k) => `setFont: '${k}' is not a font option. The options here are: ${FONT_KEYS.join(", ")}.`);
      if (typeof patch.color === "string" && !isCssColor(patch.color)) out.push(`setFont: 'color' = ${JSON.stringify(patch.color)} is not a colour (use #rrggbb, rgb(…), or a CSS colour name).`);
      return out;
    }
    case "setSeriesStyle": return isPlain(command.style) ? list("setSeriesStyle", checkOptionPatch(command.style, "seriesStyles.*")) : [];
    default: return [];
  }
}

/**
 * The series ids an edit may name on this graph: its table's datasets plus the synthetic curves a chart draws (`roc-0`,
 * `est-diff`, `forest-summary`: an id with a hyphen), which exist only once their data does.
 */
export function seriesIdProblem(seriesId: string, known: readonly string[]): string | undefined {
  if (known.includes(seriesId) || /^[a-z]+-[a-z0-9]+$/i.test(seriesId)) return undefined;
  return `setSeriesStyle: '${seriesId}' is not a series of this graph. Its series are: ${known.join(", ") || "(none)"}.`;
}
