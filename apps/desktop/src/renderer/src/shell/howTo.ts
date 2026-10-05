/**
 * The how-tos — one entry per thing you can do, answering "I want to X, how do I do that?"
 *
 * The manual's other three shapes do not answer that question. The function index
 * (`guideIndex.ts`) answers "where does axis tuning live". The topic chapters describe a
 * surface. The worked examples walk an end-to-end journey. A how-to is the unit: one action,
 * what it does, the gesture that does it, and a picture with that control circled.
 *
 * Every entry is keyed by a stable id built from the component, the group and the label of the
 * control it explains, so an entry follows its control through edits to the source. For every
 * surface listed in `HOW_TO_SURFACES`, each control has an entry here or a written exemption.
 * Surfaces without how-tos are listed in `HOW_TO_PENDING`, each with its number of controls.
 *
 * Seeded from the program's own words: where a control carries a `title=` tooltip already
 * written for a user, `what` is that sentence (tightened, not reworded into a second version
 * that will drift).
 *
 * `only` is not decoration. A how-to that says "tick it" for a control that does not appear
 * until something else is on is wrong in a way that wastes a reader's time. Every `only` here
 * states when the control appears in the running app.
 */

/** The manual pages that carry how-tos, one string per surface. */
export type HowToSurface = "Inspector > Axis";

export interface HowTo {
  /** The stable id of the control this answers (component, group and label). */
  id: string;
  /**
   * Other control ids that are the same control. The axis panel has two branches — one for an axis
   * carrying numbers, one for an axis carrying names — and a control rendered by both has two
   * ids and is one action to a reader. Naming them here lets the completeness check require an
   * entry for every id without the manual repeating itself.
   */
  alsoIds?: string[];
  /** The label on the control, as the reader sees it. */
  name: string;
  surface: HowToSurface;
  /** The group it sits in, as the panel names it. */
  group: string;
  /** One sentence: what it does. */
  what: string;
  /** The gesture: exactly what to do. */
  how: string;
  /** When the control is not always there — the precondition, in the reader's terms. */
  only?: string;
  /** Words a reader might arrive with. Never displayed. */
  keywords?: string[];
  /** The capture that shows it, and the numbered call-out pointing at it. */
  shot?: { file: string; mark: number };
}

/**
 * Where a surface lives in the program, and which chapter of the manual is its page.
 *
 * A `Record` over the union, so adding a surface to `HowToSurface` does not compile until this
 * is filled in — the index would otherwise file the new page's entries under whatever chapter the
 * last one used, and the search would send readers to the wrong place with nothing to notice it.
 */
export const HOW_TO_PAGE: Record<HowToSurface, { tab: string; chapter: string }> = {
  "Inspector > Axis": { tab: "Axis", chapter: "axes" },
};

/**
 * The groups, in the order the panel draws them — which is the order this page reads in. The
 * renderer takes its headings from here rather than from the order entries happen to be listed.
 */
export const HOW_TO_GROUPS: Record<HowToSurface, string[]> = {
  "Inspector > Axis": [
    "Which axis you are editing",
    "Scale",
    "Range",
    "Ticks",
    "Numbering",
    "Axis line",
    "Spacing",
    "Axis length",
    "Breaks (cuts)",
    "Custom ticks",
    "Shaded bands",
    "Series on this axis",
    "Category groups",
    "The 3-D scatter's three edges",
  ],
};

/**
 * The captures. Seven, not one: a panel with sixty controls cannot take sixty numbered boxes and
 * still be read, so it is photographed a few groups at a time. The alt text and the caption live
 * here beside the file, and `guide-shots.test.ts` holds them to the same contract as every other
 * picture in the manual - bundled, produced by the capture spec, and shown by something.
 */
export interface HowToShot {
  file: string;
  alt: string;
  caption: string;
}

const AXIS_1 = "axis-scale-range.png";
const AXIS_2 = "axis-ticks-numbering.png";
const AXIS_3 = "axis-line-spacing.png";
const AXIS_4 = "axis-breaks-bands.png";
const AXIS_5 = "axis-categories.png";
const AXIS_6 = "axis-3d.png";
const AXIS_7 = "axis-3d-line.png";

export const HOW_TO_SHOTS: HowToShot[] = [
  {
    file: AXIS_1,
    alt: "The top of the Inspector's Axis tab on the Y axis: the X / Y / Y2 / Y3 switcher with Y pressed, the axis Title box, Title direction with its Level, 45°, 90°, 135° and 180° buttons and an angle box, the Above the axis tickbox under it, then the Scale group with its type list, Reversed, Equal aspect, Hide axis and Scale bar, and the Range group with a minimum and a maximum.",
    caption: "The top of the Axis tab. Which axis you are editing, what it is called, which way its title reads, how it is spaced, and how far it runs. Photographed on the Y axis, because Title direction and Above the axis are drawn only for an axis that runs up the figure — and Level is pressed, because Above the axis is there only while the title is level.",
  },
  {
    file: AXIS_2,
    alt: "The Ticks and Numbering groups of the Axis tab: tick interval and minor ticks above, then number format, decimals, label rotation, prefix, suffix, thousands separator and decimal mark.",
    caption: "Where the ticks go, and how their numbers are written. Numbering is closed by default - click its heading to open it.",
  },
  {
    file: AXIS_3,
    alt: "The Axis line, Spacing and Axis length groups: line colour with its preset swatches, thickness, link ticks to axis, tick thickness, show ticks, tick length, the two spacing boxes, and the plotting-area length.",
    caption: "The line itself, the gaps around it, and the size of the plotting area - the control to reach for when two graphs have to match.",
  },
  {
    file: AXIS_4,
    alt: "The Breaks (cuts), Custom ticks and Shaded bands groups, each with one entry already added, and the Series on this axis list of tickboxes.",
    caption: "The four groups that add something to the axis. Each keeps a list of what you have added, with a cross to remove it.",
  },
  {
    file: AXIS_5,
    alt: "The Axis tab of a box-and-whisker chart's category axis, showing the Category groups panel with Group by set to By hand: one box per treatment (Control and Low dose typed as Controls, High dose as Treated), then colour labels, separators, group names, block tint, tint strength and one colour swatch per group.",
    caption: "An axis carrying names rather than numbers gets a different panel - and this group, which gathers the categories into named blocks.",
  },
  {
    file: AXIS_6,
    alt: "The 3-D scatter's axis panel: the X / Y / Z edge switcher, the title box, minimum and maximum, the scale list, tick interval, show ticks, tick length, number format, decimals, and the Prefix, Suffix, Thousands and Decimal mark rows the 2-D Numbering group has.",
    caption: "The 3-D scatter's three cube edges are real axes. This is the top half of their panel.",
  },
  {
    file: AXIS_7,
    alt: "The lower half of the 3-D scatter's axis panel: line colour, thickness, hide axis, the Spacing group with labels-to-axis, title-to-labels and label side, and the Reset row with its Clear button.",
    caption: "The rest of a cube edge, and the note saying which 2-D axis tools deliberately do not exist here.",
  },
];

export const HOW_TO: HowTo[] = [
  // ───────────────────────── which axis you are editing ─────────────────────────
  {
    id: "insp:axispanel:axis",
    name: "X / Y / Y2 / Y3",
    surface: "Inspector > Axis",
    group: "Which axis you are editing",
    what: "Switches the whole panel to another axis, without having to find that axis on the graph.",
    how: "Click X or Y at the top of the panel. Y2 appears on the chart types that support a second value axis — XY, area, bubble, histogram and volcano, and vertical bar, box, violin, column scatter, lollipop, raincloud and floating-bar charts. Their horizontal versions have it along the top, and the button reads X2. Y3 appears only on XY, area, bubble and volcano.",
    // Not "second axis" / "y2". Someone typing that wants the tickbox that puts a series on
    // the right-hand axis, not the button that moves this panel to it — and with those words here
    // this entry would outrank it. A keyword is a claim about what the reader meant.
    keywords: ["switch axis", "which axis", "change axis"],
    shot: { file: AXIS_1, mark: 1 },
  },
  {
    id: "insp:axispanel:title-2",
    alsoIds: ["insp:axispanel:title"],
    name: "Title",
    surface: "Inspector > Axis",
    group: "Which axis you are editing",
    what: "The name written along this axis. Left blank it follows the source column's name, so renaming the column in the datasheet renames the axis.",
    how: "Type the name. Clear the box to go back to the column's name. You can also double-click the title on the graph and retype it there.",
    keywords: ["axis title", "axis name", "label the axis", "units"],
    shot: { file: AXIS_1, mark: 2 },
  },
  {
    id: "insp:titledirectionrows:title-direction",
    name: "Title direction",
    surface: "Inspector > Axis",
    group: "Which axis you are editing",
    what: "Which way the axis title reads: Level, 45°, 90° (the usual turned title), 135°, 180°, or any angle you type. The graph makes room for it, and a long level title is split over lines.",
    how: "Click an angle, or type one in the box. On the graph, select the axis and drag the round grip at the end of its title: it holds at every 45°; hold Shift for any angle. If the title does not fit beside the axis, the graph says so above the figure — a level title is then written above the axis, any other angle stays turned.",
    only: "Shown on the axes that run up the figure — Y, and a right-hand Y2 or Y3. An axis across the figure keeps its title along it.",
    keywords: ["level title", "horizontal y title", "rotate axis title", "turn title", "title angle", "sideways", "vertical title"],
    shot: { file: AXIS_1, mark: 3 },
  },
  {
    id: "insp:titledirectionrows:above-the-axis",
    name: "Above the axis",
    surface: "Inspector > Axis",
    group: "Which axis you are editing",
    what: "Writes the level title over the top end of the axis instead of beside it, so it takes no width from the plot.",
    how: "Tick it.",
    only: "Appears once Title direction is Level.",
    keywords: ["title on top", "title above", "y title above axis"],
    shot: { file: AXIS_1, mark: 4 },
  },

  // ───────────────────────────────── Scale ─────────────────────────────────
  {
    id: "insp:axispanel:scale:type",
    name: "Type",
    surface: "Inspector > Axis",
    group: "Scale",
    what: "How the axis spaces its values: linear, log base 10, log base 2, natural log, or probability (probit), on which a normal cumulative distribution plots as a straight line.",
    how: "Pick from the list. A log axis needs positive values — with data at or below zero the graph says so above the figure and draws linear instead.",
    keywords: ["log", "logarithmic", "log10", "log2", "ln", "probit", "probability", "semilog"],
    shot: { file: AXIS_1, mark: 5 },
  },
  {
    id: "insp:axispanel:scale:reversed",
    name: "Reversed",
    surface: "Inspector > Axis",
    group: "Scale",
    what: "Runs the axis the other way — high values at the origin end.",
    how: "Tick it. On a Y axis that puts the largest value at the bottom, which is the convention in some fields.",
    keywords: ["flip axis", "invert axis", "descending", "upside down", "reverse"],
    shot: { file: AXIS_1, mark: 6 },
  },
  {
    id: "insp:axispanel:scale:equal-aspect-1-1",
    name: "Equal aspect (1:1)",
    surface: "Inspector > Axis",
    group: "Scale",
    what: "Makes one data unit the same number of pixels on X as on Y, so a distance on the graph means the same thing in both directions. MadY widens whichever axis is packed too tightly rather than shrinking the plot, so nothing leaves the picture, and zooming keeps the 1:1 scale.",
    how: "Tick it. It needs two linear axes without breaks; an axis range you typed by hand is left alone.",
    only: "Shown on XY, area, bubble and volcano charts and the ordination maps — the kinds where a distance on the page is meant to be read as a distance.",
    keywords: ["aspect ratio", "square", "1:1", "isotropic", "same scale"],
    shot: { file: AXIS_1, mark: 7 },
  },
  {
    id: "insp:axispanel:hide-axis",
    name: "Hide axis",
    surface: "Inspector > Axis",
    group: "Scale",
    what: "Hides this axis's line, ticks, numbers and title while the data stays mapped to it exactly as before.",
    how: "Tick it. Pair it with a scale bar (below) and the frame set to None for the clean imaging look. On an axis carrying names rather than numbers this same tickbox is under Category labels.",
    keywords: ["hide", "remove axis", "no axis", "clean", "invisible"],
    shot: { file: AXIS_1, mark: 8 },
  },
  {
    id: "insp:axispanel:scale:scale-bar",
    name: "Scale bar",
    surface: "Inspector > Axis",
    group: "Scale",
    what: "Draws a corner bar of a stated length instead of a numbered axis — the convention for micrographs and maps.",
    how: "Type the length in data units in the first box. The second box takes the text drawn beside it (“10 µm”) and only accepts one once a length is set.",
    keywords: ["scale bar", "micron", "µm", "microscopy", "map scale"],
    shot: { file: AXIS_1, mark: 9 },
  },

  // ───────────────────────────────── Range ─────────────────────────────────
  {
    id: "insp:axispanel:range:min-max",
    name: "Min / Max",
    surface: "Inspector > Axis",
    group: "Range",
    what: "The lowest and highest value the axis shows. Left blank, the axis fits the data and grows as you add to it, so nothing is ever clipped by accident.",
    how: "Type a number in either box; clear it to go back to automatic. Points outside the range are not drawn and the graph says how many. You can also drag along the axis on the figure to pan, and the boxes follow what you did.",
    keywords: ["minimum", "maximum", "limits", "zoom", "start at zero", "clip", "bounds"],
    shot: { file: AXIS_1, mark: 10 },
  },

  // ───────────────────────────────── Ticks ─────────────────────────────────
  {
    id: "insp:axispanel:ticks:tick-interval",
    name: "Tick interval",
    surface: "Inspector > Axis",
    group: "Ticks",
    what: "The spacing between numbered ticks, in data units.",
    how: "Type the spacing — 25 puts a tick at 0, 25, 50 and so on. Clear it for the automatic “nice” interval.",
    keywords: ["major ticks", "spacing", "every", "step", "interval", "gridline spacing"],
    shot: { file: AXIS_2, mark: 1 },
  },
  {
    id: "insp:axispanel:ticks:minor-ticks",
    name: "Minor ticks",
    surface: "Inspector > Axis",
    group: "Ticks",
    what: "How many unlabelled ticks sit between each numbered one.",
    how: "Type a count from 0 to 20. Clear it for none.",
    keywords: ["minor", "subdivisions", "small ticks", "in between"],
    shot: { file: AXIS_2, mark: 2 },
  },

  // ─────────────────────────────── Numbering ───────────────────────────────
  {
    id: "insp:axispanel:numbering:format",
    name: "Format",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "How the tick numbers are written: automatic, plain decimal, scientific (1.5×10³), powers of ten (10ⁿ), or a percentage.",
    how: "Pick from the list.",
    keywords: ["scientific notation", "exponent", "percent", "percentage", "number format", "powers"],
    shot: { file: AXIS_2, mark: 3 },
  },
  {
    id: "insp:axispanel:numbering:decimals",
    name: "Decimals",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "A fixed number of decimal places on every tick number.",
    how: "Type 0 to 10. Clear it and trailing zeros are trimmed instead.",
    keywords: ["decimal places", "rounding", "precision", "significant figures"],
    shot: { file: AXIS_2, mark: 4 },
  },
  {
    id: "insp:axispanel:label-rotation",
    name: "Label rotation",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "Turns the tick labels, so long ones stop colliding with each other.",
    how: "Pick Horizontal, 45°, 90°, −45° or −90°. On an axis carrying names rather than numbers this same control is under Category labels.",
    keywords: ["rotate", "angle", "vertical labels", "slanted", "overlapping labels", "45"],
    shot: { file: AXIS_2, mark: 5 },
  },
  {
    id: "insp:tickaffixrows:prefix",
    name: "Prefix",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "Text put in front of every tick number — a currency symbol, say. On a 3-D scatter each edge has its own.",
    how: "Type it (“$”). Clear the box to remove it.",
    keywords: ["currency", "dollar", "unit", "before"],
    shot: { file: AXIS_2, mark: 6 },
  },
  {
    id: "insp:tickaffixrows:suffix",
    name: "Suffix",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "Text put after every tick number — a unit, say.",
    how: "Type it (“%”, “ mm”). Clear the box to remove it.",
    keywords: ["unit", "percent sign", "after", "mm", "kg"],
    shot: { file: AXIS_2, mark: 7 },
  },
  {
    id: "insp:tickaffixrows:thousands",
    name: "Thousands",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "The digit-grouping separator on large tick numbers.",
    how: "Pick None, comma (1,000), period (1.000), space (1 000) or apostrophe (1’000).",
    keywords: ["separator", "grouping", "comma", "1000", "big numbers"],
    shot: { file: AXIS_2, mark: 8 },
  },
  {
    id: "insp:tickaffixrows:decimal-mark",
    name: "Decimal mark",
    surface: "Inspector > Axis",
    group: "Numbering",
    what: "Whether the decimal point is written as a point or a comma.",
    how: "Pick Point (3.14) or Comma (3,14). Pair period-thousands with comma-decimal for the European 1.234,5 style.",
    keywords: ["comma decimal", "european", "locale", "3,14"],
    shot: { file: AXIS_2, mark: 9 },
  },

  // ─────────────────────────────── Axis line ───────────────────────────────
  {
    id: "insp:axispanel:axis-line:colour",
    name: "Colour",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "This axis's own line colour, independent of the other axis.",
    how: "Click the swatch and pick a colour, use the pipette to lift one off the screen, or click one of the preset swatches under the row. The ⨯ beside it puts the default back.",
    keywords: ["axis colour", "line colour", "black axis", "grey"],
    shot: { file: AXIS_3, mark: 1 },
  },
  {
    id: "insp:axispanel:axis-line:thickness",
    name: "Thickness",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "How heavy the axis line is drawn, in points.",
    how: "Type a number between 0.25 and 8. Clear it for the default 1.25.",
    keywords: ["line width", "stroke", "weight", "heavier axis"],
    shot: { file: AXIS_3, mark: 2 },
  },
  {
    id: "insp:axispanel:axis-line:link-ticks-to-axis",
    name: "Link ticks to axis",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "Keeps the tick marks the same thickness as the axis line.",
    how: "Leave it ticked and the ticks follow the line. Untick it to set the tick thickness on its own — the box below is disabled until you do.",
    keywords: ["tick thickness", "match", "independent"],
    shot: { file: AXIS_3, mark: 3 },
  },
  {
    id: "insp:axispanel:axis-line:tick-thickness",
    name: "Tick thickness",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "How heavy the tick marks are drawn, independently of the axis line.",
    how: "Untick “Link ticks to axis” first, then type a number between 0.25 and 8.",
    only: "The box is there but disabled while “Link ticks to axis” is on — its tooltip says so.",
    keywords: ["tick width", "tick stroke"],
    shot: { file: AXIS_3, mark: 4 },
  },
  {
    id: "insp:axispanel:axis-line:show-ticks",
    name: "Show ticks",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "Draws or hides this axis's tick marks. The numbers stay either way.",
    how: "Untick it to lose the marks and keep the labels.",
    keywords: ["no ticks", "hide ticks", "remove ticks"],
    shot: { file: AXIS_3, mark: 5 },
  },
  {
    id: "insp:axispanel:axis-line:tick-length",
    name: "Tick length",
    surface: "Inspector > Axis",
    group: "Axis line",
    what: "How far each tick mark sticks out, in pixels.",
    how: "Type 0 to 30. Clear it for the default 5.",
    only: "Disabled while “Show ticks” is off — there is nothing to lengthen.",
    keywords: ["longer ticks", "tick size", "inward"],
    shot: { file: AXIS_3, mark: 6 },
  },

  // ──────────────────────────────── Spacing ────────────────────────────────
  {
    id: "insp:axispanel:spacing:labels-axis",
    name: "Labels ↔ axis",
    surface: "Inspector > Axis",
    group: "Spacing",
    what: "The gap between the tick numbers and the axis line.",
    how: "Type 0 to 60 pixels. Clear it for automatic. Raise it to lift the numbers off a heavy axis.",
    keywords: ["gap", "padding", "too close", "overlap", "distance"],
    shot: { file: AXIS_3, mark: 7 },
  },
  {
    id: "insp:axispanel:spacing:title-labels",
    name: "Title ↔ labels",
    surface: "Inspector > Axis",
    group: "Spacing",
    what: "The gap between the axis title and the tick numbers.",
    how: "Type 0 to 60 pixels. Clear it for automatic.",
    keywords: ["gap", "title spacing", "move title", "padding"],
    shot: { file: AXIS_3, mark: 8 },
  },

  // ────────────────────────────── Axis length ──────────────────────────────
  {
    id: "insp:axispanel:axis-length:length-px",
    name: "Length (px)",
    surface: "Inspector > Axis",
    group: "Axis length",
    what: "The width of the plotting area on X, or its height on Y — the way to make several graphs match exactly.",
    how: "Type a number of pixels between 40 and 2000, or drag the right end of the X axis (the top of the Y axis) on the figure. The ⨯ beside the box goes back to fitting the figure.",
    keywords: ["resize", "size", "bigger", "smaller", "plot width", "plot height", "match graphs", "resize the graph"],
    shot: { file: AXIS_3, mark: 9 },
  },

  // ─────────────────────────── Breaks (cuts) ───────────────────────────
  {
    id: "insp:axispanel:breaks-cuts:break-start",
    name: "from · to · Add cut",
    surface: "Inspector > Axis",
    group: "Breaks (cuts)",
    what: "Compresses a range of values out of the axis — a broken axis, for when one far point would otherwise squash everything interesting into a corner.",
    how: "Open Breaks (cuts), type the first and last value of the empty band in the two boxes, and press Add cut. Add several if you need them. It works on linear and log axes.",
    keywords: ["break", "cut", "broken axis", "gap", "discontinuous", "outlier", "squashed", "axis break"],
    shot: { file: AXIS_4, mark: 1 },
  },
  {
    id: "insp:axispanel:breaks-cuts:suggest-cut",
    name: "Suggest cut",
    surface: "Inspector > Axis",
    group: "Breaks (cuts)",
    what: "Proposes a cut when one wide empty band dominates the axis, and fills the two boxes with it.",
    how: "Press it, then press Add cut to accept. It is greyed out when no single gap stands out, and its tooltip says which gap it found.",
    keywords: ["suggest", "automatic break", "find gap", "outlier"],
    shot: { file: AXIS_4, mark: 2 },
  },
  {
    id: "insp:axispanel:breaks-cuts:break-mark",
    name: "Break mark",
    surface: "Inspector > Axis",
    group: "Breaks (cuts)",
    what: "How the cut is drawn on the axis: a double slash, a zigzag, or a plain gap with no mark.",
    how: "Pick from the list.",
    only: "Appears once there is at least one cut.",
    keywords: ["slash", "zigzag", "break symbol", "squiggle"],
    shot: { file: AXIS_4, mark: 3 },
  },
  {
    id: "insp:axispanel:breaks-cuts:remove-this-break",
    name: "A cut you have added",
    surface: "Inspector > Axis",
    group: "Breaks (cuts)",
    what: "Each cut you have made is listed by its two values.",
    how: "Press the ⨯ at the end of its row to remove it.",
    only: "There is one row per cut, so the list is empty until you add one.",
    keywords: ["remove break", "delete cut", "undo break"],
    shot: { file: AXIS_4, mark: 4 },
  },

  // ───────────────────────────── Custom ticks ─────────────────────────────
  {
    id: "insp:axispanel:custom-ticks:new-tick-value",
    name: "value · label · Add tick",
    surface: "Inspector > Axis",
    group: "Custom ticks",
    what: "Puts an extra labelled tick and gridline at exactly the value you choose — a threshold, a reference dose, a cut-off.",
    how: "Type the value, optionally the text to write at it, and press Add tick. Leave the label blank and the formatted number is used.",
    keywords: ["extra tick", "threshold", "custom label", "mark a value", "own tick"],
    shot: { file: AXIS_4, mark: 5 },
  },
  {
    id: "insp:axispanel:custom-ticks:remove-this-tick",
    name: "A tick you have added",
    surface: "Inspector > Axis",
    group: "Custom ticks",
    what: "Each extra tick is listed by its value and its text.",
    how: "Press the ⨯ at the end of its row to remove it.",
    only: "There is one row per tick, so the list is empty until you add one.",
    keywords: ["remove tick", "delete tick"],
    shot: { file: AXIS_4, mark: 6 },
  },

  // ───────────────────────────── Shaded bands ─────────────────────────────
  {
    id: "insp:axispanel:shaded-bands:band-start",
    name: "from · to · colour · Add band",
    surface: "Inspector > Axis",
    group: "Shaded bands",
    what: "Shades the plot between two values on this axis — a normal range, a therapeutic window, a zone you want the reader to see. It moves with the scale, so it stays correct when you change the range.",
    how: "Type the two values, click the swatch to choose the colour, and press Add band.",
    keywords: ["shade", "band", "normal range", "zone", "highlight", "reference range", "stripe"],
    shot: { file: AXIS_4, mark: 7 },
  },
  {
    id: "insp:axispanel:shaded-bands:remove-this-band",
    name: "A band you have added",
    surface: "Inspector > Axis",
    group: "Shaded bands",
    what: "Each band is listed with its colour, its two values and its text.",
    how: "Press the ⨯ at the end of its row to remove it.",
    only: "There is one row per band, so the list is empty until you add one.",
    keywords: ["remove band", "delete band"],
    shot: { file: AXIS_4, mark: 8 },
  },

  // ─────────────────────── Series on this axis ───────────────────────
  {
    id: "insp:axispanel:series-on-this-axis:series",
    // Named for its group, because the rows have no fixed label of their own — each one is
    // titled with a series' name out of the datasheet. "One tickbox per dataset" is accurate but
    // unsearchable; this is the heading a reader actually sees above them.
    name: "Series on this axis",
    surface: "Inspector > Axis",
    group: "Series on this axis",
    what: "Which datasets are measured against this axis. This is how a second Y axis gets its data, and how you plot two quantities in different units on one graph.",
    how: "On the left (Y) axis, untick a series to move it to the right (Y2) axis. On Y2 or Y3, tick a series to bring it here — that axis appears as soon as one is on it, with its own range, scale, ticks and title.",
    only: "Shown on the value axes of the chart types that support a second axis: XY, area, bubble and volcano, and histogram, vertical bar, box, violin, column scatter, lollipop, raincloud and floating-bar charts (those have Y2 only, no Y3). Their horizontal versions have one too, along the top (X2).",
    keywords: ["second y axis", "y2", "right axis", "two units", "plot on", "dual axis"],
    shot: { file: AXIS_4, mark: 9 },
  },

  // ─────────────────────── Category labels (banded axis) ───────────────────────
  // Label rotation and Hide axis are one control each, defined once and rendered by both
  // branches of the panel. They are documented under the group a reader meets first (Numbering,
  // Scale) and their `how` says where the other branch puts them, rather than being repeated.

  // ─────────────────────────── Category groups ───────────────────────────
  {
    id: "insp:axispanel:category-groups:group-by",
    name: "Group by",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Gathers the categories into named blocks along the axis — “Domain”, “Treatment arm”, “Site” — taken from a column of your data, or typed by hand.",
    how: "Pick the column that names each row's group, or pick By hand to type each category's group yourself. A text column added to the datasheet appears in the list.",
    only: "Only on an axis that carries names rather than numbers — a bar, box, violin, scatter, before-after, raincloud, floating-bar, histogram or dendrogram X axis (the Y axis when a bar, box, violin, scatter or floating-bar chart is horizontal), or the Y axis of a forest, pyramid, ridgeline, lollipop (its X axis when vertical), paired-dot, swimmer or tracks chart.",
    keywords: ["group", "brackets", "blocks", "categories", "domain", "super category", "by hand", "manual groups"],
    shot: { file: AXIS_5, mark: 1 },
  },
  {
    id: "insp:axispanel:category-groups:c",
    name: "One box per category (By hand)",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Which group each category belongs to, when the groups are typed by hand instead of taken from a column — for example putting two treatments in one block.",
    how: "Type a group name beside a category. Type the same name beside another category to put the two in one block; clear a box to take that category out of every group. Names you have already used are offered as you type.",
    only: "Appears once Group by is set to By hand.",
    keywords: ["manual groups", "group treatments", "assign group", "by hand", "type group"],
    shot: { file: AXIS_5, mark: 2 },
  },
  {
    id: "insp:axispanel:category-groups:colour-labels",
    name: "Colour labels",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Draws each category's name in its group's colour.",
    how: "Untick it to keep the names in the ordinary text colour.",
    only: "Appears once groups are switched on — a column or By hand under Group by.",
    keywords: ["coloured names", "group colour"],
    shot: { file: AXIS_5, mark: 3 },
  },
  {
    id: "insp:axispanel:category-groups:separators",
    name: "Separators",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Draws a rule between one group and the next.",
    how: "Untick it to remove the rules.",
    only: "Appears once groups are switched on — a column or By hand under Group by.",
    keywords: ["divider", "line between", "rule"],
    shot: { file: AXIS_5, mark: 4 },
  },
  {
    id: "insp:axispanel:category-groups:group-names",
    name: "Group names",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Writes each group's name alongside the axis, past the category names.",
    how: "Untick it to leave the groups unnamed. Drag a group name on the figure to reposition it. To rename a group, edit it in the datasheet column — or, with By hand, type the new name in its boxes.",
    only: "Appears once groups are switched on — a column or By hand under Group by.",
    keywords: ["group label", "bracket label", "name the block"],
    shot: { file: AXIS_5, mark: 5 },
  },
  {
    id: "insp:axispanel:category-groups:block-tint",
    name: "Block tint",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Washes a faint band of the group's colour behind each block.",
    how: "Tick it. A Tint strength slider appears under it.",
    only: "Appears once groups are switched on — a column or By hand under Group by.",
    keywords: ["shading", "background", "band", "wash"],
    shot: { file: AXIS_5, mark: 6 },
  },
  {
    id: "insp:axispanel:category-groups:tint-strength",
    name: "Tint strength",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "How strong the block tint is — from a barely-there wash to a clear band of colour behind each group.",
    how: "Drag the slider.",
    only: "Appears only once Block tint is ticked.",
    keywords: ["opacity", "faint", "stronger", "tint"],
    shot: { file: AXIS_5, mark: 7 },
  },
  {
    id: "insp:axispanel:category-groups:g",
    name: "One swatch per group",
    surface: "Inspector > Axis",
    group: "Category groups",
    what: "Each group's own colour, used for its label, its rule and its tint.",
    how: "Click the swatch beside a group's name and pick a colour.",
    only: "One row per group, so they appear once groups are switched on — a column or By hand.",
    keywords: ["group colour", "recolour", "swatch"],
    shot: { file: AXIS_5, mark: 8 },
  },

  // ─────────────────── the 3-D scatter's three cube edges ───────────────────
  {
    id: "insp:scatter3daxispanel:x-y-z",
    name: "X / Y / Z",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Switches the panel between the cube's three edges.",
    how: "Click X, Y or Z at the top of the panel — or click the edge itself on the figure.",
    only: "The 3-D scatter's axis panel. It is deliberately smaller than the ordinary one: axis length, breaks, bands, tick rotation and category grouping have no meaningful drawing on a slanted, orbiting edge, and the panel says so at the foot rather than offering controls that would have no effect.",
    keywords: ["3d", "z axis", "cube", "three dimensional"],
    shot: { file: AXIS_6, mark: 1 },
  },
  {
    id: "insp:scatter3daxispanel:title",
    name: "Title",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "The name drawn at this edge's end. Blank = the source column's name.",
    how: "Type it.",
    keywords: ["3d axis title", "z title"],
    shot: { file: AXIS_6, mark: 2 },
  },
  {
    id: "insp:scatter3daxispanel:min",
    name: "Min",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "A manual lower bound. Blank fits the data.",
    how: "Type a number. Points outside the range are not drawn, and the graph says how many.",
    keywords: ["3d range", "minimum"],
    shot: { file: AXIS_6, mark: 3 },
  },
  {
    id: "insp:scatter3daxispanel:max",
    name: "Max",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "A manual upper bound. Blank fits the data.",
    how: "Type a number.",
    keywords: ["3d range", "maximum"],
    shot: { file: AXIS_6, mark: 4 },
  },
  {
    id: "insp:scatter3daxispanel:scale",
    name: "Scale",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Linear or log (base 10, base 2, natural) on this edge.",
    how: "Pick from the list. Log needs positive values — with data at or below zero the axis says so and draws linear.",
    keywords: ["3d log", "logarithmic"],
    shot: { file: AXIS_6, mark: 5 },
  },
  {
    id: "insp:scatter3daxispanel:tick-interval",
    name: "Tick interval",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Spacing between tick numbers on this edge, in data units.",
    how: "Type the spacing. Blank is automatic.",
    keywords: ["3d ticks", "spacing"],
    shot: { file: AXIS_6, mark: 6 },
  },
  {
    id: "insp:scatter3daxispanel:show-ticks",
    name: "Show ticks",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Draws or hides this edge's tick marks.",
    how: "Untick it to remove them.",
    keywords: ["3d ticks", "hide"],
    shot: { file: AXIS_6, mark: 7 },
  },
  {
    id: "insp:scatter3daxispanel:tick-length",
    name: "Tick length",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "How far each tick mark sticks out, in pixels.",
    how: "Type 1 to 16.",
    keywords: ["3d ticks", "length"],
    shot: { file: AXIS_6, mark: 8 },
  },
  {
    id: "insp:scatter3daxispanel:number-format",
    name: "Number format",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Automatic, decimal, scientific or percent, on this edge.",
    how: "Pick from the list.",
    keywords: ["3d numbering", "scientific"],
    shot: { file: AXIS_6, mark: 9 },
  },
  {
    id: "insp:scatter3daxispanel:decimals",
    name: "Decimals",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Fixed decimal places on this edge's numbers.",
    how: "Type a count. Blank trims trailing zeros.",
    keywords: ["3d decimals", "precision"],
    shot: { file: AXIS_6, mark: 10 },
  },
  {
    id: "insp:scatter3daxispanel:colour",
    name: "Colour",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "This edge's own colour. The other two keep theirs.",
    how: "Click the swatch and pick a colour.",
    keywords: ["3d axis colour"],
    shot: { file: AXIS_7, mark: 1 },
  },
  {
    id: "insp:scatter3daxispanel:thickness",
    name: "Thickness",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "How heavy this edge is drawn.",
    how: "Type a number between 0.25 and 8.",
    keywords: ["3d line width"],
    shot: { file: AXIS_7, mark: 2 },
  },
  {
    id: "insp:scatter3daxispanel:hide-axis",
    name: "Hide axis",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Hides this edge — line, ticks, numbers and name — while the data mapping stays.",
    how: "Tick it.",
    keywords: ["3d hide", "remove edge"],
    shot: { file: AXIS_7, mark: 3 },
  },
  {
    id: "insp:scatter3daxispanel:reset",
    name: "Reset",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Clears this edge's overrides — back to an automatic range, a linear scale and the shared styling.",
    how: "Press the Clear button beside it. Only this edge is affected; the other two keep what you set.",
    keywords: ["3d reset", "default", "clear", "start over"],
    shot: { file: AXIS_7, mark: 4 },
  },
  {
    id: "insp:scatter3daxispanel:spacing:labels-axis",
    name: "Labels ↔ axis",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "The gap between this edge's tick numbers and its line — the same control the 2-D axes have.",
    how: "Open Spacing at the foot of the panel and type 0 to 60 pixels. Raise it to lift the numbers off the edge.",
    keywords: ["3d spacing", "gap"],
    shot: { file: AXIS_7, mark: 5 },
  },
  {
    id: "insp:scatter3daxispanel:spacing:title-labels",
    name: "Title ↔ labels",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "The gap between this edge's name and its tick numbers.",
    how: "Open Spacing and type 0 to 60 pixels.",
    keywords: ["3d spacing", "title gap"],
    shot: { file: AXIS_7, mark: 6 },
  },
  {
    id: "insp:scatter3daxispanel:spacing:label-side",
    name: "Label side",
    surface: "Inspector > Axis",
    group: "The 3-D scatter's three edges",
    what: "Which side of the edge the tick marks and numbers sit on.",
    how: "Pick “Flip to other side” when they collide with the data or with another edge.",
    keywords: ["3d flip", "other side", "collide"],
    shot: { file: AXIS_7, mark: 7 },
  },
];

/**
 * Control ids that a how-to would only repeat, each with the reason written out.
 *
 * An exemption is a claim, and the claim has to be checkable by reading it. "Not needed" is
 * not a reason; "this is the same control, rendered by the other branch of the panel" is.
 */
export const HOW_TO_EXEMPT: Record<string, string> = {
  // Empty for the Axis tab, and that is the right answer rather than a gap: the two controls that
  // would have needed one — the Title box and the Hide-axis tickbox, each rendered by both
  // branches of the panel — are the same control to a reader, so they are joined with `alsoIds`
  // on the entry that documents them. An exemption says "no how-to is owed"; `alsoIds` says
  // "one how-to already covers this". They are different claims and the completeness check
  // refuses to let a control carry both.
};

/** The surfaces whose how-tos are written: every control on each has an entry above. */
export const HOW_TO_SURFACES: HowToSurface[] = ["Inspector > Axis"];

/**
 * The surfaces that carry no how-tos, with the exact number of controls each has, so a control added to or removed from one of them is noticed. A surface whose how-tos are written is listed in `HOW_TO_SURFACES` instead.
 */
export const HOW_TO_PENDING: Record<string, number> = {
  "Analysis methods": 49,
  "Annotation kinds": 14,
  "Chart kinds": 49,
  "Datasheet": 21,
  "Dialog > Analyze": 87,
  "Dialog > Apply Look": 3,
  "Dialog > Bug Report": 4,
  "Dialog > Cell Fill Menu": 2,
  "Dialog > Cell Pattern Menu": 2,
  "Dialog > Col Math": 12,
  "Dialog > Export": 8,
  "Dialog > Export All": 5,
  "Dialog > Extract": 1,
  "Dialog > Find Replace": 7,
  "Dialog > Frequency": 5,
  "Dialog > Ggplot Import": 3,
  "Dialog > Gradient Editor": 25,
  "Dialog > Import": 11,
  "Dialog > Merge": 9,
  "Dialog > Monte Carlo": 4,
  "Dialog > New Graph": 21,
  "Dialog > Power": 5,
  "Dialog > Prune": 9,
  "Dialog > QQ": 4,
  "Dialog > Recovery": 1,
  "Dialog > Reshape": 5,
  "Dialog > Row Stats": 2,
  "Dialog > Save": 1,
  "Dialog > Settings": 22,
  "Dialog > Simulate": 11,
  "Dialog > Sort": 3,
  "Dialog > Split": 4,
  "Dialog > Threshold Ladder": 1,
  "Dialog > Transform": 9,
  "Dialog > Transpose": 2,
  "Dialog > Zoom": 1,
  "Dialog > shared dialog chrome": 4,
  "Inspector > Annotate": 116,
  "Inspector > Chart": 393,
  "Inspector > Data": 41,
  "Inspector > Frame": 25,
  "Inspector > Style": 4,
  "Inspector > Text": 24,
  "Menu commands": 89,
  "On the figure": 94,
  "Ribbons and panes": 54,
  "Table formats": 15,
  "Transforms": 52,
};

/** The how-tos for one surface, grouped and in the panel's own order. */
export function howTosBySurface(surface: HowToSurface): { group: string; rows: HowTo[] }[] {
  const out: { group: string; rows: HowTo[] }[] = [];
  for (const group of HOW_TO_GROUPS[surface]) {
    const rows = HOW_TO.filter((h) => h.surface === surface && h.group === group);
    if (rows.length > 0) out.push({ group, rows });
  }
  return out;
}
