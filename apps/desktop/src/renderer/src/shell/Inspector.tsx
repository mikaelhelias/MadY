import { DISPLAY_SCALE_MAX, DISPLAY_SCALE_MIN, graphDisplayScale, graphLayoutSize } from "./graphDisplay";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { AssistantNudge } from "./AssistantNudge";
import { NUMBER_FORMAT_CHOICES } from "./numberFormats";
import { pieExplodeAll, pieExplodeShown } from "./pieExplode";
import { pointSpreadShown, pointSpreadWholeGraph } from "./pointSpread";
import { barWidthShown, barWidthWholeGraph } from "./barWidth";
import { GRAPH_PRINT_SIZES, MIN_PRINT_PT, printedPt, printWidthFor } from "./printSizes";
import { FRAME_DEAD_KINDS, NO_MARKER_KINDS } from "./deadControls";
import type { Suggestion } from "./assistant";
import type { GradRamp, Gradient, AlignOp, Annotation, AreaStack, SpreadMode, ArrowHead, AxisScale, AxisSpec, BackdropPreset, BackdropStyle, BarLayout, BarShape, BracketShape, BoxWhisker, CategoryGroupSpec, DataTable, EllipseSpec, FitParamLine, FitStyle, FontElement, FontSpec, FrameStyle, GridStyle, LegendPosition, LegendSpec, LineDash, NetworkStyle, NodeId, NumberFormat, ThousandsSeparator, DecimalSeparator, PieLabelMode, Plot, PlotKind, SeriesStyle, SignificanceDisplay, SignificanceStyle, StylePreset, TickDir } from "@mady/core";
import { valueAtPx } from "./axisValue";
import { canJoinLegend, dataAxisOf, EQUAL_ASPECT_KINDS, isArrangeableAnnotation, isTransposedPlot, referenceLine, referenceLinesFor, STYLE_PRESETS, swimmerColumns } from "@mady/core";
import { ThresholdLadder } from "./ThresholdLadder";
import type { UserPreset } from "./userPresets";
import type { ProfileDefault } from "./profile";
import { exportUserLibrary, importUserLibrary } from "./durableStore";
import { axisEntryId, inspectorEntryId, inspectorTabEntryId } from "./guideIds";
import { GuideHelp } from "./guideLink";
import { drawableErrorTypes, tableDatasets, xColumn } from "@mady/core";
import type { Dataset } from "@mady/core";
import { fitLinesWithout } from "./fitParams";
import { axisTitleFontSpec, buildPlotScene, defaultTitleAngle, normalizeAngle, categoryTicks, DATA_DRIVEN_KINDS, HIGHLIGHT_DEFAULT, highlightColumnOf, makeRamp, XY_FAMILY_KINDS, xyFamilyDatasets, mergeFontSpec, OKABE_ITO, PALETTES, resolveBuiltinRamp, seriesColor, tickCategoryName, WAFFLE_ICON_CYCLE, WAFFLE_OTHER_COLOR, WAFFLE_OTHER_ID } from "@mady/graphics";
import { templateMigrationReport } from "./migrateTemplates";
import { captureKindSection } from "./presetKeys";
import { PaletteSwatches, UserPresetList } from "./UserPresetList";
import { exportPresetFile, importPresetFiles, importSummary } from "./presetFile";
import { SCATTER_SUMMARY_OPTS, scatterSummaryKey, scatterSummaryPair } from "./columnScatterSummary";
import type { GraphSelection, Section } from "./AppShell";
import { SchemaForm, ColorInput, recentColors } from "./SchemaForm";
import type { Field } from "./SchemaForm";
import { GradientEditor } from "./GradientEditor";
import { HeatSplitEditor } from "./HeatSplitEditor";
import { HeatTrackEditor } from "./HeatTrackEditor";
import { listUserGradients, saveUserGradient } from "./userGradients";

/**
 * Slug for an Inspector section title — "Title & legend" → "title-legend".
 *
 * It keys the collapsed/expanded state, and it is also the section's DOM
 * id (`insp-title-legend`), which is what the manual's call-out capture aims at and what a
 * deep link from the manual scrolls to. One derivation, so a section cannot be findable in
 * storage and invisible to everything else.
 */
export function inspectorSectionSlug(title: string): string {
  return title.replace(/&amp;|[^a-z0-9]+/gi, "-").toLowerCase();
}

/** The DOM id of an Inspector section's `<details>`. */
export const inspectorSectionId = (title: string): string => `insp-${inspectorSectionSlug(title)}`;

/**
 * The DOM id of a sub-section's `<details>` — the lighter grouping inside a panel.
 *
 * The Axis tab is built entirely from these and has no `<Section>` of its own, so without an id
 * there is nothing for the manual's call-out capture to aim at, and nothing for a deep link to
 * scroll to. Same slug, a different prefix, so the two levels cannot collide.
 */
export const inspectorGroupId = (title: string): string => `inspsub-${inspectorSectionSlug(title)}`;

/** Persisted expand/collapse for an inspector section, keyed by a stable id. */
function sectionKey(title: string): string {
  return "mady.inspsec." + inspectorSectionSlug(title);
}
function readSectionOpen(title: string, fallback: boolean): boolean {
  const v = globalThis.localStorage?.getItem(sectionKey(title));
  return v === null || v === undefined ? fallback : v === "1";
}
function persistSectionOpen(title: string, open: boolean): void {
  globalThis.localStorage?.setItem(sectionKey(title), open ? "1" : "0");
}

/**
 * A collapsible inspector section — keeps the (long) Format panel scannable.
 * Expand/collapse is remembered per section across sessions (localStorage), so a
 * user who lives in one group doesn't re-open it every time. `open` is the
 * first-run default only.
 */
function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [isOpen, setIsOpen] = useState(() => readSectionOpen(title, open));
  return (
    <details
      className="inspsec"
      id={inspectorSectionId(title)}
      open={isOpen}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== isOpen) {
          setIsOpen(next);
          persistSectionOpen(title, next);
        }
      }}
    >
      <summary className="insphd inspsum">
        {title}
        <SectionHelp id={inspectorEntryId(title)} what={title} />
      </summary>
      <div className="inspsec-body">{children}</div>
    </details>
  );
}

/**
 * The "?" beside a heading.
 *
 * A "?" that opens the manual at nothing is worse than no "?": the reader has been promised
 * an answer and handed an empty search box. Every `<Section>` title has an entry — the index is
 * built from `INSPECTOR_SECTIONS` and `guideIndex.test` is default-deny on it — so those are
 * unconditional. A sub-section is different: only the Axis tab's groups (`AXIS_GROUPS`) are indexed,
 * so `only` limits the button to the list that really has entries. `guide-help.test` holds both
 * directions, so this can never paper over a missing entry.
 */
function SectionHelp({ id, what, only }: { id: string; what: string; only?: readonly string[] | undefined }) {
  if (only && !only.includes(what)) return null;
  return <GuideHelp target={{ entry: id }} what={what} />;
}

/** A lighter collapsible sub-section (uppercase label + chevron) within a panel. Open by default. */
function SubSection({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="inspsub2" id={inspectorGroupId(title)} {...(open ? { open: true } : {})}>
      <summary>
        {title}
        {/* The Axis tab is built entirely from these, and its groups are the answer to
            "where is axis tuning" — the question this whole tab was built to answer. A group with no
            entry (most panels' own sub-groups) simply gets no "?". */}
        <SectionHelp id={axisEntryId(title)} what={title} only={AXIS_GROUPS} />
      </summary>
      <div className="inspsub2-body">{children}</div>
    </details>
  );
}

/**
 * Per-series show/hide list — one row per series: a visibility checkbox, the series'
 * colour swatch, and its name. The editable variant (pass `onSelect`) turns the name
 * into a button that selects that series for styling (the selected row is highlighted);
 * the read-only variant (no `onSelect`) is the plot-level visibility overview.
 */
/** Swimmer rows: the structural datasets (bar Start/End · Response pair · Ongoing — the
 *  shared core `swimmerColumns` contract) carry no hide box (hiding half a bar is not a
 *  drawing); event-series rows keep theirs, honoured by the builder. */
function swimmerNoHide(table: DataTable): (d: { id: NodeId }) => boolean {
  const sc = swimmerColumns(table);
  const structural = new Set(
    [sc.start, sc.end, sc.responseStart, sc.responseEnd, sc.ongoing]
      .filter((x): x is NonNullable<typeof x> => x != null)
      .map((x) => x.id),
  );
  return (d) => structural.has(d.id);
}

/**
 * Kinds where the focus ring in the Series list can actually reach the drawing.
 *
 * The list writes the table column's id. On these kinds that id is the id the builder draws the
 * series under, so focusing it greys the others. Everywhere else it is not, and the ring would be
 * a control that could only produce a warning (checked on every gallery card):
 *
 *  • before–after draws one series per subject (`g-ba-r0…`), qq draws `qq`, manhattan draws
 *    `manhattan`, upset draws `__upsetn__` — the ring would write a column id none of them read;
 *  • lollipop · rose · paired dot · treemap · venn · parallel · tracks draw nothing in the
 *    series layer at all, so there is nothing for the pass to grey, and the focus warning
 *    ("Every series on this chart is focused") would be wrong on some of them.
 *
 * Derived from the builder by `focus-offered.test.tsx`, which drives the real ring and checks
 * the id it writes against the ids the scene actually draws, rather than a hand-kept copy.
 *
 * Two further gates ride on top of this one, both shared with other controls:
 *  • `noHide` — where hiding a series cannot mean anything (forest, funnel, ternary, qq,
 *    manhattan, the swimmer's structural rows), neither can focusing it. Same reason, same
 *    predicate; reused rather than restated.
 *  • fewer than two rows — with one series there is nothing to push into the background, so the
 *    ring could only ever report that.
 */
export const FOCUS_KINDS = new Set([
  "area", "bar", "blandaltman", "box", "bubble", "floatingbar", "histogram", "raincloud",
  "ridgeline", "roc", "scatter", "survival", "swimmer", "violin", "volcano", "xy",
]);

/**
 * Kinds that draw their series under ids of their own (`pca-g0`, `g-ba-r0`, `scree`, `dendro-0`, the pyramid's
 * sides) - the drawing greys the rest when one of those ids is focused, but no table column carries them. These
 * list the series the drawing produces, with focus only: hiding one means nothing here (estimation and pyramid read
 * their datasets by position; the others are computed). Guard: `focus-drawn-series.test.tsx`.
 */
export const DRAWN_FOCUS_KINDS = new Set(["pcascore", "pcabiplot", "triplot", "estimation", "beforeafter", "pyramid", "scree", "dendrogram"]);

function SeriesVisibilityList({
  datasets,
  plot,
  onSetSeriesStyle,
  selectedId,
  onSelect,
  noHide,
  foreign,
  onRemoveForeign,
  focusOnly,
}: {
  datasets: { id: NodeId; name: string; color?: string | undefined }[];
  /** The drawn series of a `DRAWN_FOCUS_KINDS` chart: the focus ring alone, no show/hide box. */
  focusOnly?: boolean | undefined;
  /** Series borrowed from other datasheets (`plot.overlays`): column id → that sheet's name. */
  foreign?: Record<NodeId, string> | undefined;
  /** Drop a borrowed series (its overlay reference) — the row's × button. */
  onRemoveForeign?: ((columnId: NodeId) => void) | undefined;
  plot: Plot;
  onSetSeriesStyle: (columnId: NodeId, delta: SeriesStyle) => void;
  selectedId?: NodeId | undefined;
  onSelect?: ((sel: GraphSelection) => void) | undefined;
  /** Omit the show/hide box: the kind reads its datasets by position (a forest's estimate ·
   *  lower · upper), so "hide one" cannot mean anything but "compute something else" — the
   *  builder ignores `hidden` there, and a checkbox that does nothing is a dead control.
   *  A predicate withholds the box per row (the swimmer: structural Start/End/Response/
   *  Ongoing rows have none, event-series rows keep theirs). */
  noHide?: boolean | ((d: { id: NodeId; name: string }) => boolean) | undefined;
}) {
  // The ring only exists where it reaches the drawing — see FOCUS_KINDS above for what each
  // of these three conditions is protecting against.
  const canFocus = (focusOnly || FOCUS_KINDS.has(plot.kind ?? "xy")) && datasets.length >= 2;
  const anyFocus = canFocus && datasets.some((d) => plot.seriesStyles?.[d.id]?.focus);
  return (
    <div className="serieslist" {...(focusOnly ? { "data-drawn-focus": "" } : {})}>
      {anyFocus && (
        /* One click back to a normal plot. Un-focusing series one at a time works, but with six focused
           it is six clicks to return to a normal plot, and a user who cannot find their way
           back from a look does not try it in the first place. */
        <div className="frow" style={{ justifyContent: "space-between", gap: 6 }}>
          <span className="hint" style={{ margin: 0 }}>Greyed series are context.</span>
          <button
            type="button"
            className="linkbtn"
            onClick={() => { for (const d of datasets) if (plot.seriesStyles?.[d.id]?.focus) onSetSeriesStyle(d.id, { focus: undefined }); }}
          >
            Clear focus
          </button>
        </div>
      )}
      {datasets.map((d, i) => {
        const hidden = plot.seriesStyles?.[d.id]?.hidden ?? false;
        const focused = plot.seriesStyles?.[d.id]?.focus ?? false;
        const colour = d.color ?? plot.seriesStyles?.[d.id]?.color ?? seriesColor(i);
        const isSel = d.id === selectedId;
        const swatch = (
          <span aria-hidden style={{ width: 11, height: 11, borderRadius: 2, background: colour, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)", flex: "0 0 auto" }} />
        );
        return (
          <div className="frow serieslist-row" key={d.id} style={{ gap: 6, alignItems: "center" }}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect({ kind: "series", columnId: d.id, part: "points" })}
                title="Edit this series"
                style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: isSel ? 700 : 400, color: isSel ? "var(--accent)" : "inherit" }}
              >
                {swatch}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                {foreign?.[d.id] && (
                  <span className="serfrom" title={`Borrowed from the datasheet “${foreign[d.id]}”. Its values live there; only its look lives on this graph.`} style={{ fontSize: 11, opacity: 0.75, marginLeft: 4, whiteSpace: "nowrap" }}>
                    from {foreign[d.id]}
                  </span>
                )}
                {foreign?.[d.id] && onRemoveForeign && (
                  <button
                    type="button"
                    className="swbtn"
                    aria-label={`Remove borrowed series ${d.name}`}
                    title="Stop drawing this borrowed series (the other datasheet is untouched)"
                    onClick={(e) => { e.stopPropagation(); onRemoveForeign(d.id); }}
                  >
                    ×
                  </button>
                )}
              </button>
            ) : (
              <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                {swatch}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                {foreign?.[d.id] && (
                  <span className="serfrom" title={`Borrowed from the datasheet “${foreign[d.id]}”. Its values live there; only its look lives on this graph.`} style={{ fontSize: 11, opacity: 0.75, marginLeft: 4, whiteSpace: "nowrap" }}>
                    from {foreign[d.id]}
                  </span>
                )}
                {foreign?.[d.id] && onRemoveForeign && (
                  <button
                    type="button"
                    className="swbtn"
                    aria-label={`Remove borrowed series ${d.name}`}
                    title="Stop drawing this borrowed series (the other datasheet is untouched)"
                    onClick={(e) => { e.stopPropagation(); onRemoveForeign(d.id); }}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
            {/* Focus — the sibling of the show/hide box, and deliberately not the same thing.
                Hiding a curve throws the evidence away: a reader cannot tell whether it was
                flat, absent or never measured. Focusing keeps every curve on the page and greys
                the ones that are context, so the figure says what it is about. Nothing happens
                until at least one series carries it, and switching the last one off restores
                the plot exactly. */}
            {canFocus && (focusOnly || !(typeof noHide === "function" ? noHide(d) : noHide)) && (
            <button
              type="button"
              className={`focusbtn${focused ? " on" : ""}`}
              aria-label={`Focus ${d.name}`}
              aria-pressed={focused}
              title={anyFocus
                ? (focused ? `“${d.name}” is in focus — the greyed series are context. Click to take it out of focus.` : `Bring “${d.name}” into focus too.`)
                : `Focus “${d.name}” — it keeps its colour and every other series goes grey.`}
              onClick={() => onSetSeriesStyle(d.id, { focus: focused ? undefined : true })}
            >
              {focused ? "◉" : "○"}
            </button>
            )}
            {!focusOnly && !(typeof noHide === "function" ? noHide(d) : noHide) && (
              <input
                type="checkbox"
                checked={!hidden}
                title="Show / hide this series (it still feeds the spread band & average)"
                onChange={(e) => onSetSeriesStyle(d.id, { hidden: !e.target.checked })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

type FramePatch = { frame?: FrameStyle; tickDir?: TickDir; tickLen?: number };
type GraphTitlePatch = {
  title?: string | undefined;
  showTitle?: boolean;
  subtitle?: string | undefined;
  titleAlign?: Plot["titleAlign"];
  footer?: Plot["footer"];
};

/** Persisted "apply changes to the whole series" toggle (default on). When off,
 *  colour/marker edits to a selected point affect only that point (highlighting). */
function useWholeSeries(): { value: boolean; set: (v: boolean) => void } {
  const KEY = "mady.applyWholeSeries";
  const [value, setValue] = useState<boolean>(() => globalThis.localStorage?.getItem(KEY) !== "0");
  const set = (v: boolean): void => {
    setValue(v);
    globalThis.localStorage?.setItem(KEY, v ? "1" : "0");
  };
  return { value, set };
}

/* "Apply changes to the whole graph (every series / group)" — when on, a single style edit
 * restyles all datasets at once (colours, error bars, widths, fills…) instead of just the
 * selected series. Layered on top of `useWholeSeries`, which it overrides.
 *
 * The state lives in AppShell, not here: `AppShell.resizeWidth` has to see it too, or dragging
 * a box edge with the toggle ticked would resize one box. Owning it above both consumers is what
 * lets a canvas gesture honour the scope. It starts off and resets per graph, so a bulk scope
 * can never get stuck on. */

/** Normalise a footer edit: blank fields drop out; an empty footer becomes undefined. */
function cleanFooter(f: { left?: string; right?: string }): Plot["footer"] {
  const left = f.left?.trim() ? f.left : undefined;
  const right = f.right?.trim() ? f.right : undefined;
  return left || right ? { ...(left ? { left } : {}), ...(right ? { right } : {}) } : undefined;
}
type SetPlotFont = (element: FontElement, patch: Partial<FontSpec>) => void;
type SetLegend = (patch: Partial<LegendSpec>) => void;
type SetSignificance = (patch: Partial<SignificanceStyle>) => void;
type AnnotationOps = {
  add: (ann: Omit<Annotation, "id">) => void;
  update: (id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>) => void;
  remove: (id: NodeId) => void;
  reorder: (id: NodeId, to: "front" | "back") => void;
  /** Align / distribute / equalise a multi-object selection (the Arrange toolbar). */
  align: (ids: NodeId[], op: AlignOp) => void;
  /** Group a selection so the objects translate together when one is dragged. */
  group: (ids: NodeId[]) => void;
  /** Ungroup: dissolve the group(s) the selected objects belong to. */
  ungroup: (ids: NodeId[]) => void;
  /** Lock / unlock objects against dragging (style edits still work). */
  setLocked: (ids: NodeId[], locked: boolean) => void;
  /** Pick an image from disk and insert it as an embedded image annotation. */
  addImage: () => void;
  /** Replace the bytes of an existing image annotation (re-pick the file). */
  replaceImage: (id: NodeId) => void;
};

/** Set of the drawing-shape annotation kinds (vs reference lines / text / brackets). */
const SHAPE_KINDS = new Set(["rect", "highlight", "ellipse", "arrow", "segment", "callout"]);

/**
 * The kinds where a significance bracket is meaningful — a category axis carrying real
 * groups, and a value axis to sit above.
 *
 * An allow-list rather than a list of exclusions ("not heatmap, not network, not pie…"), which
 * would let through every chart whose axes are both continuous. On those a bracket's `from`/`to`
 * are two data values, so it spans a stretch of the scale and compares nothing — the same reason
 * the ridgeline is excluded: brackets belong to bar/box/violin with a few side-by-side
 * groups. Every kind in this list has a categorical axis on which each adjacent pair is placed
 * exactly; the continuous kinds — xy · area · blandaltman · pcascore · pcaload · pcabiplot · bubble ·
 * volcano · survival · roc — have no groups at all.
 *
 * It gates the "Add bracket" button as well as the styling section. Hiding one without the
 * other would allow creating a bracket that cannot be styled, which is worse than either.
 *
 * `bracket-endpoints.test.ts` proves every kind in this list places a bracket on the two
 * categories it names; `annotations-drawn.test.tsx` proves every kind outside it has no category
 * axis to span, so nothing meaningful is being withheld.
 */
// Exported for `bracket-editor.test.tsx`, which proves every kind
// in this list actually offers the add-bracket controls — the list and the panels cannot drift.
export const BRACKET_KINDS = new Set<string>([
  "bar", "box", "violin", "scatter", "raincloud", "floatingbar", "estimation",
  "pyramid", "scree", "dendrogram", "histogram", "beforeafter", "lollipop", "paireddot", "forest",
  // upset: manual brackets span the drawn intersection columns (the bar builder's own
  // geometry); the planner stays closed — a "sets" table unlocks no analyses to plan from.
  "upset",
]);

/**
 * Kinds whose builder draws an attached curve fit (`plot.fit` / `plot.fits`): the continuous
 * XY family. The Fitted curve section is offered only here — an analysis attaches its fit to
 * the first graph of its table whatever that graph's kind, and on a bar chart the fit is
 * simply not drawn, so a section there would be controls over nothing.
 * Derived and re-checked from the builder by `fit-style.test.tsx` — do not edit by hand
 * without running it.
 */
export const FIT_KINDS = new Set<string>(["xy", "area", "bubble", "volcano"]);

/**
 * Does any series still draw as a bar - the rectangle a bar value label is placed against? A series
 * set to draw as line, points or area loses its bar (on a stacked chart only "line" does; points and
 * area are refused there and stay bars). With no bar left, the value shift and the value position have
 * nothing to act on (both gate on this - value-shift.test.tsx, value-position-gate.test.tsx): the
 * Ranked dots card is a bar chart whose one series is points, and its numbers ride the dots as point
 * labels instead. Mirrors the bar builder's `wants` / stacked refusal; `value-shift.test.tsx` checks
 * it against the drawing on every gallery card, so the two cannot drift apart unnoticed.
 */
function barsCarryValueLabels(plot: Plot, series: { id: string }[]): boolean {
  const stacked = plot.barLayout === "stacked" || plot.barLayout === "percent";
  return series.some((d) => {
    const as = plot.seriesStyles?.[d.id]?.plotAs;
    return !(as === "line" || (!stacked && (as === "points" || as === "area")));
  });
}

/**
 * Moves every value label up or down (px): `valueLabelDy`. The builder applies it on bar,
 * histogram and UpSet value labels. Dragging a value label is not a substitute: that drag writes
 * one bar's own `valueDy`. One row for every place it is offered, so the chart types cannot drift apart.
 * Guard: `value-shift.test.tsx` (a census, both directions: shown ⇔ it moves the drawing).
 */
function ValueShiftRow({ label, plot, onSetPlotOptions }: { label: string; plot: Plot; onSetPlotOptions: (patch: Partial<Plot>) => void }) {
  return (
    <label className="frow" title="Moves every value label up or down, in pixels. Negative moves up, positive moves down. Blank = no shift.">
      <span>{label}</span>
      <input
        type="number"
        className="numin"
        step={1}
        value={plot.valueLabelDy ?? ""}
        placeholder="0"
        aria-label={label}
        onChange={(e) => {
          const t = e.target.value.trim();
          const n = Math.round(Number(t));
          onSetPlotOptions({ valueLabelDy: t === "" || !Number.isFinite(n) || n === 0 ? undefined : n });
        }}
      />
    </label>
  );
}

/** Bar shape — one definition for every chart the bar builder draws (bar / histogram, and the
 *  UpSet intersection bars, which that builder draws too). */
function BarShapeRow({ plot, onSetBarShape }: { plot: Plot; onSetBarShape: (shape: BarShape) => void }) {
  return (
    <label className="frow">
      <span>Bar shape</span>
      <select className="selin" value={plot.barShape ?? "square"} onChange={(e) => onSetBarShape(e.target.value as BarShape)}>
        <option value="square">Square</option>
        <option value="rounded">Rounded</option>
        <option value="roundtop">Round top</option>
      </select>
    </label>
  );
}

/** Bar width as a share of the category band (the bar builder's `barWidth`). */
function BarWidthRow({ plot, onSetPlotOptions, fallback, title }: { plot: Plot; onSetPlotOptions: (patch: Partial<Plot>) => void; fallback: number; title: string }) {
  return (
    <label className="frow">
      <span>Bar width</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.02}
          value={plot.barWidth ?? fallback}
          title={title}
          onChange={(e) => onSetPlotOptions({ barWidth: Math.min(1, Math.max(0.1, Number(e.target.value))) })}
        />
        <span style={{ width: 32, textAlign: "right" }}>{Math.round((plot.barWidth ?? fallback) * 100)}%</span>
      </span>
    </label>
  );
}

/** How far apart a group's data points sit sideways (0.25–3×; 1 = the standard look). One control, on the Data tab, for
 *  every chart that draws its data points as a swarm — bars, box / violin, estimation, column scatter.
 *  The tick box beside it, ticked by default, sets the whole graph; unticked, only the clicked series.
 *  The raincloud widens its rain with its Width slider, which scales the whole raincloud. */
function PointSpreadRow({ value, onChange, whole }: {
  value: number;
  onChange: (n: number) => void;
  whole: { checked: boolean; locked: boolean; onToggle: (v: boolean) => void };
}) {
  return (
    <WholeGraphSliderRow
      label="Point spread"
      title="How far apart the data points in a group sit sideways. 1× is the standard spacing; lower packs them closer, higher spreads them out. Points never leave their own bar or box."
      min={0.25}
      max={3}
      step={0.05}
      value={value}
      shown={`${value.toFixed(2).replace(/\.?0+$/, "")}×`}
      onChange={onChange}
      whole={whole}
      wholeTitle="Ticked: the point spread applies to the whole graph. Unticked: only to the series you clicked."
    />
  );
}

/** A slider with a "whole graph" tick box beside it (Point spread, Bar width): ticked = every series, unticked = the
 *  clicked one. Locked ticked while the tab's "Apply to whole graph" is on. */
function WholeGraphSliderRow({ label, title, min, max, step, value, shown, onChange, whole, wholeTitle }: {
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  shown: string;
  onChange: (n: number) => void;
  whole: { checked: boolean; locked: boolean; onToggle: (v: boolean) => void };
  wholeTitle: string;
}) {
  return (
    <div className="frow" title={title}>
      <span>{label}</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
        />
        <span style={{ width: 32, textAlign: "right" }}>{shown}</span>
        <label
          style={{ display: "flex", gap: 3, alignItems: "center", fontSize: 11, whiteSpace: "nowrap", opacity: whole.locked ? 0.6 : 1 }}
          title={whole.locked
            ? "Apply to whole graph (top of this tab) is ticked, so every change reaches every series."
            : wholeTitle}
        >
          <input
            type="checkbox"
            aria-label={`${label}: whole graph`}
            checked={whole.checked}
            disabled={whole.locked}
            onChange={(e) => whole.onToggle(e.target.checked)}
          />
          whole graph
        </label>
      </span>
    </div>
  );
}

/** Order the categories / groups by value (`Plot.barSort`) — one definition for bars and for box, violin and column
 *  scatter groups. */
function SortRow({ label, largest, title, plot, onSetPlotOptions }: { label: string; largest: string; title: string; plot: Plot; onSetPlotOptions: (patch: Partial<Plot>) => void }) {
  return (
    <label className="frow" title={title}>
      <span>{label}</span>
      <select
        className="selin"
        aria-label={label}
        value={plot.barSort ?? "none"}
        onChange={(e) => onSetPlotOptions({ barSort: e.target.value === "none" ? undefined : (e.target.value as "asc" | "desc") })}
      >
        <option value="none">Table order</option>
        <option value="desc">{largest}</option>
        <option value="asc">Smallest first</option>
      </select>
    </label>
  );
}

/** Where each bar's value label sits (the bar builder's `valuePlacement`). */
function ValuePositionRow({ label, plot, onSetPlotOptions }: { label: string; plot: Plot; onSetPlotOptions: (patch: Partial<Plot>) => void }) {
  return (
    <label className="frow" title="Where each bar's value sits: above the bar, inside at its top, or inside at its foot just off the axis. A bar too short for the text falls back to Above. Drag a label to move it; while dragging it snaps to the other labels' line.">
      <span>{label}</span>
      <select
        className="selin"
        aria-label={label}
        value={plot.valuePlacement ?? "above"}
        onChange={(e) => onSetPlotOptions({ valuePlacement: e.target.value === "above" ? undefined : (e.target.value as Plot["valuePlacement"]) })}
      >
        <option value="above">Above the bar</option>
        <option value="insideEnd">Inside, at the top</option>
        <option value="insideBase">Inside, at the foot</option>
      </select>
    </label>
  );
}

/** The series id the UpSet builder draws its intersection bars under (a synthesised count column). */
const UPSET_COUNT_ID = "__upsetn__";

/**
 * The UpSet intersection bars' own styling — shape, width, fill, opacity, outline, and one
 * highlighted bar.
 *
 * The bar builder draws these bars and honours every one of these options, and clicking a bar
 * opens this section. The shape and width rows
 * are the bar chart's own; the rest write the bars' series (`__upsetn__`) and, for the highlight,
 * that one bar's per-point record — exactly what a bar chart's series and a single bar's own style write.
 *
 * Note: a bar is keyed by its position (`ix-0` = the first bar drawn), the same key the count labels'
 * drag and text already use. Re-sorting, or data that reorders the intersections, moves a highlight
 * to whichever combination lands in that place — said in the row's hint.
 */
function UpsetBarStyleRows({
  plot, table, onSetBarShape, onSetPlotOptions, onSetSeriesStyle, onSetPointStyle,
}: {
  plot: Plot;
  table: DataTable;
  onSetBarShape: (shape: BarShape) => void;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  onSetSeriesStyle: (columnId: NodeId, delta: SeriesStyle) => void;
  onSetPointStyle: (columnId: NodeId, rowId: NodeId, delta: SeriesStyle) => void;
}) {
  const st = plot.seriesStyles?.[UPSET_COUNT_ID] ?? {};
  const setBars = (delta: SeriesStyle): void => onSetSeriesStyle(UPSET_COUNT_ID, delta);
  let columns: { members: number[] }[] = [];
  let setNames: string[] = [];
  try {
    const up = buildPlotScene(table, plot, {}).upset;
    columns = up?.columns ?? [];
    setNames = up?.sets.map((s) => s.label) ?? [];
  } catch {
    columns = [];
  }
  const HIGHLIGHT_KEYS = ["fillColor", "fillOpacity", "borderColor", "borderWidth"] as const;
  const prefix = `${UPSET_COUNT_ID}:`;
  // The highlighted bar = the first bar carrying a highlight field (a count's drag/text alone is not one).
  const hiRow = Object.entries(plot.pointStyles ?? {}).find(([k, v]) => k.startsWith(prefix) && HIGHLIGHT_KEYS.some((f) => v?.[f] !== undefined))?.[0].slice(prefix.length);
  const hi = hiRow ? plot.pointStyles?.[`${prefix}${hiRow}`] ?? {} : {};
  const clearHighlight = (rowId: string): void => onSetPointStyle(UPSET_COUNT_ID, rowId, { fillColor: undefined, fillOpacity: undefined, borderColor: undefined, borderWidth: undefined });
  return (
    <>
      <div className="inspsub">Intersection bars</div>
      <BarShapeRow plot={plot} onSetBarShape={onSetBarShape} />
      <BarWidthRow plot={plot} onSetPlotOptions={onSetPlotOptions} fallback={0.82} title="Fraction of each intersection's column filled by its bar (0.1–1)" />
      <label className="frow" title="Two-tone: a light interior with a darker outline of the same colour.">
        <span>Bar fill</span>
        <select className="selin" aria-label="Intersection bar fill" value={st.fillType === "twotone" ? "twotone" : "solid"} onChange={(e) => setBars({ fillType: e.target.value === "twotone" ? "twotone" : undefined })}>
          <option value="solid">Solid</option>
          <option value="twotone">Two-tone</option>
        </select>
      </label>
      <label className="frow">
        <span>Bar opacity</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="range" min={0.05} max={1} step={0.05} aria-label="Intersection bar opacity" value={st.fillOpacity ?? 1} onChange={(e) => setBars({ fillOpacity: Number(e.target.value) })} />
          <span style={{ width: 32, textAlign: "right" }}>{Math.round((st.fillOpacity ?? 1) * 100)}%</span>
        </span>
      </label>
      {/* Two-tone derives the outline from the bar colour, as the bar chart's Contour row does — hidden there too. */}
      {st.fillType !== "twotone" && (
        <label className="frow">
          <span>Outline colour</span>
          <ColorInput value={st.borderColor ?? "#1a1a1a"} aria-label="Intersection bar outline colour" onChange={(c) => setBars({ borderColor: c || undefined, ...(st.borderWidth ? {} : { borderWidth: 1 }) })} />
        </label>
      )}
      <label className="frow">
        <span>Outline width</span>
        <input type="number" className="numin" min={0} max={8} step={0.25} aria-label="Intersection bar outline width" value={st.borderWidth ?? ""} placeholder="0"
          onChange={(e) => { const v = e.target.value.trim() === "" ? undefined : Number(e.target.value); setBars({ borderWidth: v !== undefined && Number.isFinite(v) ? v : undefined }); }} />
      </label>
      <label className="frow" title="Draw one intersection in its own colour. The highlight belongs to a bar's place — change the sort and it stays on the bar now in that place.">
        <span>Highlight bar</span>
        <select
          className="selin"
          aria-label="Highlight bar"
          value={hiRow ?? ""}
          onChange={(e) => {
            const next = e.target.value;
            if (hiRow) clearHighlight(hiRow);
            if (next) onSetPointStyle(UPSET_COUNT_ID, next, { fillColor: hi.fillColor ?? "#d0342c", ...(hi.fillOpacity !== undefined ? { fillOpacity: hi.fillOpacity } : {}), ...(hi.borderColor !== undefined ? { borderColor: hi.borderColor } : {}), ...(hi.borderWidth !== undefined ? { borderWidth: hi.borderWidth } : {}) });
          }}
        >
          <option value="">None</option>
          {columns.map((c, i) => (
            <option key={i} value={`ix-${i}`}>{`${i + 1}. ${c.members.map((m) => setNames[m] ?? "?").join(" ∩ ")}`}</option>
          ))}
        </select>
      </label>
      {hiRow && (
        <>
          <label className="frow">
            <span>Highlight colour</span>
            <ColorInput value={hi.fillColor ?? "#d0342c"} aria-label="Highlight colour" onChange={(c) => onSetPointStyle(UPSET_COUNT_ID, hiRow, { fillColor: c || "#d0342c" })} />
          </label>
          <label className="frow">
            <span>Highlight opacity</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="range" min={0.05} max={1} step={0.05} aria-label="Highlight opacity" value={hi.fillOpacity ?? st.fillOpacity ?? 1} onChange={(e) => onSetPointStyle(UPSET_COUNT_ID, hiRow, { fillOpacity: Number(e.target.value) })} />
              <span style={{ width: 32, textAlign: "right" }}>{Math.round((hi.fillOpacity ?? st.fillOpacity ?? 1) * 100)}%</span>
            </span>
          </label>
          <label className="frow">
            <span>Highlight outline</span>
            <ColorInput value={hi.borderColor ?? "#1a1a1a"} aria-label="Highlight outline colour" onChange={(c) => onSetPointStyle(UPSET_COUNT_ID, hiRow, { borderColor: c || undefined, ...(hi.borderWidth ? {} : { borderWidth: 1.5 }) })} />
          </label>
        </>
      )}
    </>
  );
}

/**
 * The right-hand value axes a kind's drawing has — what the Axis tab's Y2 / Y3 buttons, its
 * "Series on this axis" tickboxes and the series panel's "Plot on" row offer. The XY-family builder
 * draws Y2 and Y3. The bar builder and the box / violin / column-scatter builder draw one second
 * axis in either orientation — down the right on a vertical chart, along the top on a horizontal one
 * — and refuse Y3 with a warning. Raincloud, floating bar and lollipop draw the same
 * one second axis. Every other kind's drawing has no second value axis.
 */
export function rightValueAxes(plot: Pick<Plot, "kind" | "barOrientation">): ("y2" | "y3")[] {
  const kind = plot.kind ?? "xy";
  if (kind === "xy" || kind === "area" || kind === "bubble" || kind === "volcano") return ["y2", "y3"];
  // The histogram is drawn by the bar builder, so it has one right-hand axis, not two. Listing it
  // with the XY family would offer a Y3 button whose only outcome is the bar builder's Y3 refusal.
  // Checked against the drawing: `right-axes-drawn.test.tsx`.
  if (kind === "histogram") return ["y2"];
  // Raincloud, floating bar and lollipop draw the same one second axis.
  if (kind === "bar" || kind === "box" || kind === "violin" || kind === "scatter" || kind === "raincloud" || kind === "floatingbar" || kind === "lollipop") return ["y2"];
  return [];
}

/**
 * Where the chart draws its second axis: along the top when its values run left to right. `isTransposedPlot` covers
 * the flipped bar family, but a lollipop is horizontal when no orientation is set and keeps its value spec on `xAxis`
 * (not transposed in the data sense), so it is named here too - the Axis tab calls a top axis X2, not Y2.
 */
export function secondAxisOnTop(plot: Pick<Plot, "kind" | "barOrientation">): boolean {
  if (plot.kind === "lollipop") return (plot.barOrientation ?? "horizontal") === "horizontal";
  return isTransposedPlot(plot);
}

/**
 * Kinds whose builder emits no legend, because a per-series one would be untrue of the drawing —
 * their datasets are not what the picture distinguishes. The Legend block is withheld there,
 * so "Show → Always" is never offered where it would do nothing.
 * Derived and re-checked from the builder by `legend-offered.test.tsx`; run it after any edit
 * to this list.
 */
export const NO_SERIES_LEGEND = new Set([
  "heatmap", "corrmatrix", "alluvial", "network", "scatter3d", "dendrogram", "forest", "funnel", "estimation", "pcaload", "venn", "upset", "manhattan", "chord",
]);

/**
 * Kinds that can replace the legend with direct labels — the series named on the drawing beside
 * its own data (`legend.position` = "direct").
 *
 * The requirement is a line or a cloud of points to sit beside, with clear paper next to it: a
 * survival or ROC curve is a line with no marks at all, and it takes a name at its end better
 * than anything. Four families are left out, each for its own reason (the first three
 * live in `DIRECT_LABEL_REDUNDANT` in the builder, with the evidence):
 *   • slices, cells, spokes and zones drawn outside the series layer — nothing to sit beside;
 *   • groups already named on the category axis — the name would appear twice;
 *   • bars and blocks that fill the plot — there is no clear paper beside a bar;
 *   • charts whose legend rows share one series — a ternary keys four composition columns
 *     drawn as a single cloud of points, and a direct label names one series, not four.
 *
 * Derived and re-checked from the builder by `direct-labels.test.tsx` (it builds every
 * gallery card with the option on and compares) — do not edit by hand without running it.
 */
export const DIRECT_LABEL_KINDS = new Set([
  "area", "beforeafter", "blandaltman", "pcabiplot", "pcascore", "qq", "roc", "scree",
  "survival", "triplot", "xy",
]);

/** …and of those, the ones where `fonts.legend` still styles something else — the heatmap colour
 *  bar, the correlation-matrix ramp, the alluvial labels, the PCA loading labels, the bubble size
 *  legend — so the font control stays even though the legend rows go. `legend-offered.test.tsx`
 *  checks this list against the rendered drawing. */
const LEGEND_FONT_ONLY = new Set(["heatmap", "corrmatrix", "alluvial", "pcaload", "bubble",
  // venn: the rows are withheld, but the legend font sizes the zone counts + set labels
  "venn",
  // manhattan: no legend rows, but the legend font sizes the genome-wide / suggestive
  // threshold-line labels (reference-line labels draw with fonts.legend).
  "manhattan"]);

/**
 * Kinds whose drawing is lettered with the chart-wide `fonts.tick` and that have no Axis panel to
 * reach it from — so the block is offered in the Text tab instead, named for what it letters here.
 *
 * Listed only where there is no existing route: setting `fonts.tick` moves each of these
 * drawings, and no other control on the kind writes it. Network, heatmap and the correlation matrix are deliberately absent — each already
 * has its own named block writing `fonts.tick`, and radar has two (Edge label / Ring value). A
 * second control for the same text is the confusion this exists to remove.
 *
 * `hideSize` where the kind already has its own size control for that text, so the two cannot
 * disagree — the same reason the network's node-label block hides its size.
 * Guarded by `text-tab-tick-font.test.tsx`.
 */
const TICK_FONT_LABEL: Record<string, { label: string; hideSize?: boolean }> = {
  // the names written around the ring — `chord.labelSize` already owns their size
  chord: { label: "Node label font", hideSize: true },
  oncoprint: { label: "Gene & sample label font" },
  rose: { label: "Compass & ring label font" },
  sunburst: { label: "Segment label font" },
  ternary: { label: "Axis number font" },
  scatter3d: { label: "Axis number font" },
};

/**
 * Why each of those charts has no legend, in one sentence, shown where the controls would be.
 *
 * A control that simply vanishes between chart types reads as a bug in the program. A greyed
 * one is worse — a permanently-disabled control is a dead end, and
 * `toolbar.no-dead-buttons.test.ts` bans it. So: the heading stays, the rows go, and the
 * refusal is stated. Every sentence below was checked against what the kind actually draws
 * (`heatmap.showColorbar` is on; the correlation matrix names all five variables and draws a
 * ramp; the network names all twelve nodes; 3-D scatter names all three axes; the dendrogram's
 * leaves, the forest's studies and estimation's bands are all axis tick labels).
 */
const NO_LEGEND_WHY: Record<string, string> = {
  heatmap: "Cells are coloured by value — the colour bar is this chart's key.",
  corrmatrix: "Cells are coloured by correlation — the colour ramp is the key, and every variable is named on the matrix.",
  alluvial: "The two columns are the ends of the flows, not separate series.",
  network: "Every node is named on the chart itself. For a legend that names something, colour the nodes by a group column or the links by weight sign (Network graph section).",
  scatter3d: "One point cloud on three named axes.",
  dendrogram: "One tree — every leaf is named on the axis.",
  forest: "One forest — every row is named with its study.",
  funnel: "One cloud of studies — the three columns are one funnel, and the pooled line is the key. Label the dots from the Series panel (Point labels) to name studies.",
  venn: "Every circle is named on the diagram itself — click one to recolour that set.",
  upset: "Sets are named on the matrix rows and intersections by the dot columns — a legend would repeat the drawing. Click a set-size bar to recolour that set.",
  estimation: "Each band is named on the axis, and the last one is a computed difference.",
  pcaload: "The arrows are the variables, not the datasets.",
  bubble: "One series — the 2nd Y column is the bubble SIZE, not a second series — so a legend row could only repeat the Y axis title. Colour the points from a column (Series → Colour from column) for a legend that names something.",
  manhattan: "One marker series along the genome — the two alternating shades only separate neighbouring chromosomes (named on the axis), so a legend would name nothing. Recolour them in the Chart type section; the threshold lines are labelled where they cross.",
  chord: "Every node is named on its own arc around the ring, so a legend would repeat the drawing. Colour the nodes by a group column (Chart type ▸ Group column) or recolour one in the Chart type ▸ Node colours list.",
};

/**
 * …and bubble is conditional, which is why it is not simply in the set above. Binding the
 * points' colour (or symbol) to a column makes the builder legend the values, and that legend
 * is worth having and needs its controls. So the section goes away only while the chart has
 * nothing but its single series to name. Mirrors `dataDrivenLegend` in the builder.
 */
function hasDataDrivenLegend(plot: Plot): boolean {
  return Object.values(plot.seriesStyles ?? {}).some((s) => !!s?.colorFromColumn || !!s?.symbolFromColumn);
}

/**
 * …and the network is conditional the same way: binding node groups to a
 * column and/or colouring links by weight sign makes the builder resolve a real legend
 * (group rows + sign rows), and that legend needs its controls. Unbound, the network keeps
 * no legend and the section stays a stated refusal. Mirrors `buildNetworkScene`.
 */
function hasNetworkLegend(plot: Plot): boolean {
  return !!plot.network?.groupColumn || plot.network?.edgeSignColors === true;
}

/** Curated font-family stacks for the per-element typography editor ("" = theme default). */
export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Sans-serif", value: "system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Calibri", value: "Calibri, 'Segoe UI', sans-serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Courier (mono)", value: "'Courier New', Courier, monospace" },
];

/** The theme background hex (`--bg`) — what an unstyled pie-slice border actually
 *  renders as on the canvas (`stroke="var(--bg)"`). A colour <input> needs a hex, so
 *  we resolve the CSS custom property (light #ffffff / dark #14171c) instead of a
 *  hardcoded #ffffff that would mislead the picker on a dark theme. */
function themeBgHex(): string {
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return v;
  }
  return "#ffffff";
}

/** Preset colour palette row (the same swatches as data points) — reused under every
 *  colour picker so axis / font / annotation / series colours stay consistent. Mirrors
 *  the SchemaForm swatch control, including the shared "Recent" custom-colour row. */
function ColourSwatches({ value, onPick }: { value: string | undefined; onPick: (c: string) => void }) {
  const sel = (value ?? "").toLowerCase();
  const recents = recentColors();
  const swatchBtn = (c: string, key: string): ReactNode => (
    <button
      key={key}
      type="button"
      className={"swbtn" + (sel === c.toLowerCase() ? " on" : "")}
      style={{ background: c }}
      title={c}
      aria-label={`Colour ${c}`}
      onClick={() => onPick(c)}
    />
  );
  return (
    <div className="swcol" style={{ marginTop: 2, marginBottom: 6 }}>
      <div className="swatches swsm">{SWATCHES.map((c) => swatchBtn(c, c))}</div>
      {recents.length > 0 && (
        <div className="swatches swsm swrecent" title="Recently used colours">
          <span className="swrecent-l">Recent</span>
          {recents.map((c, i) => swatchBtn(c, `r${i}-${c}`))}
        </div>
      )}
    </div>
  );
}

/** A colour input + "default" reset + the preset palette, shared by the annotation editors. */
function ColourField({ value, onSet, label }: { value: string | undefined; onSet: (c: string | undefined) => void; label: string }) {
  return (
    <>
      <label className="frow">
        <span>Colour</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput value={value ?? "#1a1a1a"} aria-label={label} onChange={(c) => onSet(c)} />
          <button type="button" className="swbtn" title="Default colour" onClick={() => onSet(undefined)}>
            ⨯
          </button>
        </span>
      </label>
      <ColourSwatches value={value} onPick={onSet} />
    </>
  );
}

/**
 * Text box rows — alignment, wrap width, background, border, padding, corners — for a text
 * annotation, a callout and a text object on the figure canvas, in that order everywhere. The box stays centred on the
 * text's point; Align lines the words up inside it. A callout's background is its existing Fill row and its border
 * width / style are its arrow's Thickness / Line style (one outline), so `kind: "callout"` shows only what is new.
 * `wrapUnit`: "%" of the plot width on a graph, "px" on the figure canvas.
 */
export function TextBoxRows({ a, onUpdate, kind, wrapUnit }: {
  a: Annotation;
  onUpdate: (patch: Partial<Omit<Annotation, "id" | "kind">>) => void;
  kind: "text" | "callout";
  wrapUnit: "%" | "px";
}) {
  const blankNum = (t: string): number | undefined => (t.trim() === "" || !Number.isFinite(Number(t)) ? undefined : Number(t));
  const wrapShown = a.w == null ? "" : wrapUnit === "%" ? Math.round(a.w * 1000) / 10 : Math.round(a.w);
  return (
    <>
      <label className="frow">
        <span>Align</span>
        <select className="selin" value={a.align ?? "middle"} onChange={(e) => onUpdate({ align: e.target.value === "middle" ? undefined : (e.target.value as "start" | "end") })}>
          <option value="start">Left</option>
          <option value="middle">Centre</option>
          <option value="end">Right</option>
        </select>
      </label>
      <label className="frow" title="Wrap the words at this width; blank = one line per typed line">
        <span>Wrap width {wrapUnit}</span>
        <input
          type="number"
          className="numin"
          min={wrapUnit === "%" ? 5 : 20}
          max={wrapUnit === "%" ? 100 : 2000}
          placeholder="none"
          value={wrapShown}
          onChange={(e) => {
            const v = blankNum(e.target.value);
            onUpdate({ w: v == null || v <= 0 ? undefined : wrapUnit === "%" ? v / 100 : v });
          }}
        />
      </label>
      {kind === "text" && (
        <label className="frow">
          <span>Background</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ColorInput className="colorin" value={a.fill ?? "#ffffff"} aria-label="Background colour" onChange={(c) => onUpdate({ fill: c })} />
            <button type="button" className="swbtn" title="No background" onClick={() => onUpdate({ fill: undefined, fillOpacity: undefined })}>
              ⨯
            </button>
          </span>
        </label>
      )}
      {kind === "text" && a.fill && (
        <label className="frow">
          <span>Background opacity</span>
          <input type="number" className="numin" min={0} max={1} step={0.05} value={a.fillOpacity ?? 1} onChange={(e) => onUpdate({ fillOpacity: Math.min(1, Math.max(0, Number(e.target.value))) })} />
        </label>
      )}
      <label className="frow">
        <span>Box border</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput className="colorin" value={a.borderColor ?? "#1a1a1a"} aria-label="Box border colour" onChange={(c) => onUpdate({ borderColor: c })} />
          <button type="button" className="swbtn" title="No border" onClick={() => onUpdate({ borderColor: undefined })}>
            ⨯
          </button>
        </span>
      </label>
      {kind === "text" && a.borderColor && (
        <>
          <label className="frow">
            <span>Border width</span>
            <input type="number" className="numin" min={0.25} max={12} step={0.25} value={a.width ?? 1} onChange={(e) => onUpdate({ width: blankNum(e.target.value) })} />
          </label>
          <label className="frow">
            <span>Border style</span>
            <select className="selin" value={a.dash ?? "solid"} onChange={(e) => onUpdate({ dash: e.target.value === "solid" ? undefined : (e.target.value as LineDash) })}>
              {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </>
      )}
      <label className="frow">
        <span>Padding</span>
        <input type="number" className="numin" min={0} max={60} step={1} placeholder="6" value={a.padding ?? ""} onChange={(e) => onUpdate({ padding: blankNum(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Corner radius</span>
        <input type="number" className="numin" min={0} max={60} step={1} placeholder="4" value={a.radius ?? ""} onChange={(e) => onUpdate({ radius: blankNum(e.target.value) })} />
      </label>
    </>
  );
}

/**
 * Pin to a data value: a text's point, or the end of a callout / arrow / line, can sit at axis
 * values instead of a place on the plot, and then follows the data. The builder decides which axes can take a value
 * (a category axis cannot; bespoke charts place annotations on the plot only), so this asks it: it rebuilds the chart
 * with the point pinned at the values where it sits now and offers exactly the axes that resolved. Those values are
 * also where a newly pinned point starts, so switching never makes it jump. Nothing resolves → no row.
 */
export function anchorOffer(a: Annotation, plot: Plot | undefined, table: DataTable | undefined): { x?: number | undefined; y?: number | undefined; yAcross?: true | undefined } {
  if (!plot || !table) return {};
  try {
    const SIZE = { width: 620, height: 420 };
    const base = buildPlotScene(table, plot, SIZE);
    const sa = base.annotations.find((x) => x.id === a.id);
    if (!sa) return {};
    const px = a.kind === "text" ? sa.labelX : sa.x2;
    const py = a.kind === "text" ? sa.labelY : sa.y2;
    if (px == null || py == null) return {};
    const round = (v: number): number => Number(v.toPrecision(4));
    // The Y value is read along Y, or across where the builder draws the value axis horizontally — which the probe
    // itself reports (`anchorAcross`); the drawing's look is never used to guess it.
    const seedX = round(valueAtPx(base.x, base.plot, px, "x"));
    const seedYdown = round(valueAtPx(base.y, base.plot, py, "y"));
    const seedYacross = round(valueAtPx(base.x, base.plot, px, "x"));
    const probeAnn = {
      ...a,
      ...(Number.isFinite(seedX) ? { anchorX: seedX } : {}),
      ...(Number.isFinite(seedYdown) ? { anchorY: seedYdown } : Number.isFinite(seedYacross) ? { anchorY: seedYacross } : {}),
    };
    const probe = buildPlotScene(table, { ...plot, annotations: (plot.annotations ?? []).map((x) => (x.id === a.id ? probeAnn : x)) }, SIZE);
    const pa = probe.annotations.find((x) => x.id === a.id);
    const got = pa?.anchored;
    return {
      ...(got === "x" || got === "xy" ? { x: seedX } : {}),
      ...(got === "y" || got === "xy" ? { y: pa?.anchorAcross ? seedYacross : seedYdown } : {}),
      ...((got === "y" || got === "xy") && pa?.anchorAcross ? { yAcross: true as const } : {}),
    };
  } catch {
    return {};
  }
}

function AnchorRows({ a, plot, table, onUpdate }: {
  a: Annotation;
  plot: Plot | undefined;
  table: DataTable | undefined;
  onUpdate: (patch: Partial<Omit<Annotation, "id" | "kind">>) => void;
}) {
  const offer = useMemo(() => anchorOffer(a, plot, table), [a, plot, table]);
  const canX = offer.x !== undefined;
  const canY = offer.y !== undefined;
  if (!canX && !canY) return null;
  const pinned = a.anchorX != null || a.anchorY != null;
  const num = (t: string): number | undefined => (t.trim() === "" || !Number.isFinite(Number(t)) ? undefined : Number(t));
  return (
    <>
      <label className="frow" title={a.kind === "text" ? "Where the text sits: a place on the plot, or data values it follows" : "Where the tip points: a place on the plot, or data values it follows"}>
        <span>Pin to</span>
        <select
          className="selin"
          value={pinned ? "data" : "plot"}
          onChange={(e) => onUpdate(e.target.value === "data"
            ? { ...(canX ? { anchorX: offer.x } : {}), ...(canY ? { anchorY: offer.y } : {}) }
            : { anchorX: undefined, anchorY: undefined })}
        >
          <option value="plot">Plot position</option>
          <option value="data">Data value</option>
        </select>
      </label>
      {pinned && canX && (
        <label className="frow">
          <span>X value</span>
          <input type="number" className="numin" value={a.anchorX ?? ""} placeholder="plot position" onChange={(e) => onUpdate({ anchorX: num(e.target.value) })} />
        </label>
      )}
      {pinned && canY && (
        <label className="frow">
          {/* On a horizontal chart the values run across: say so, or "Y value" reads as the vertical axis. */}
          <span>{offer.yAcross ? "Value (across)" : "Y value"}</span>
          <input type="number" className="numin" value={a.anchorY ?? ""} placeholder="plot position" onChange={(e) => onUpdate({ anchorY: num(e.target.value) })} />
        </label>
      )}
    </>
  );
}

/** Editor for one annotation (reference line / text box / significance bracket).
 *  Used both in the list (graph background) and the dedicated click-to-edit panel.
 *  `plot` + `seriesNames` are optional context: the bracket editor uses them for the
 *  within-group (sub-bar) endpoint pickers and the label tickboxes' inherited state. */
function AnnotationEditor({ a, ops, plot, table, seriesNames, onSetSignificance }: { a: Annotation; ops: AnnotationOps; plot?: Plot | undefined; table?: DataTable | undefined; seriesNames?: string[] | undefined; onSetSignificance?: SetSignificance | undefined }) {
  /**
   * Bracket style applies to the whole graph by default: a change to one significance bracket
   * applies to all of them, and a tick box limits it to the one bracket.
   * Thickness · Shape · Legs · Symbol size · Colour write the plot-wide
   * `significance` setting and clear every bracket's own override of that field, so all of them
   * follow. Tick "Only this bracket" and the same controls write this bracket alone.
   */
  const [onlyThis, setOnlyThis] = useState(false);
  const allBrackets = (plot?.annotations ?? []).filter((x) => x.kind === "bracket");
  const applyBracketStyle = (
    field: "width" | "bracketShape" | "bracketLegs" | "size" | "color",
    value: number | string | undefined,
    plotField: "width" | "shape" | "legs" | "labelSize" | "color",
  ): void => {
    if (onlyThis || !onSetSignificance) { ops.update(a.id, { [field]: value }); return; }
    onSetSignificance({ [plotField]: value } as Partial<SignificanceStyle>);
    for (const b of allBrackets) if ((b as unknown as Record<string, unknown>)[field] !== undefined) ops.update(b.id, { [field]: undefined });
  };
  const sig = plot?.significance ?? {};
  if (a.kind === "bracket") {
    // Sub-bar endpoints exist only where the drawing has side-by-side bars inside a
    // category: the grouped bar layout with ≥2 series. Everywhere else the picker is
    // withheld — offering it would create endpoints the builder refuses.
    const cellSeries =
      plot?.kind === "bar" && (plot.barLayout ?? "grouped") === "grouped" && (seriesNames?.length ?? 0) >= 2
        ? seriesNames!
        : null;
    const seriesPick = (label: string, value: number | undefined, field: "fromSeries" | "toSeries"): ReactNode => (
      <label className="frow" title="Point this end of the bracket at one bar inside its group — the within-group comparison (e.g. Control vs Treated inside Day 1).">
        <span>{label}</span>
        <select
          className="selin"
          value={value ?? ""}
          onChange={(e) => ops.update(a.id, { [field]: e.target.value === "" ? undefined : Number(e.target.value) })}
        >
          <option value="">Whole group</option>
          {cellSeries!.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
    );
    // The tickboxes' inherited state: with neither set, the bracket follows the plot-wide
    // display — signs unless it is numeric, the p-value when it is.
    const display = plot?.significance?.display ?? "stars";
    const symbolOn = a.showSymbol ?? display !== "numeric";
    const pOn = a.showP ?? display === "numeric";
    return (
      <div className="annrow">
        <div className="frow">
          <span>Significance bracket</span>
          <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove bracket">
            Remove
          </button>
        </div>
        <label className="frow">
          <span>From (group #)</span>
          <input type="number" className="numin" value={a.from ?? 1} onChange={(e) => ops.update(a.id, { from: Number(e.target.value) })} />
        </label>
        {cellSeries && seriesPick("From bar", a.fromSeries, "fromSeries")}
        <label className="frow">
          <span>To (group #)</span>
          <input type="number" className="numin" value={a.to ?? 2} onChange={(e) => ops.update(a.id, { to: Number(e.target.value) })} />
        </label>
        {cellSeries && seriesPick("To bar", a.toSeries, "toSeries")}
        <label className="frow">
          <span>Height (Y)</span>
          <input
            type="number"
            className="numin"
            value={a.bracketY ?? ""}
            placeholder="auto (near top)"
            onChange={(e) => {
              const t = e.target.value.trim();
              ops.update(a.id, { bracketY: t === "" ? undefined : Number(t) });
            }}
          />
        </label>
        {/* The p is editable here, so a typed p can be corrected without deleting the
            bracket and starting over. Clearing it reverts the bracket to its free-text label. */}
        <label className="frow" title="The comparison's p-value. The label renders from it live through the graph's significance style; clear it to type a free label instead.">
          <span>p-value</span>
          <input
            type="number"
            className="numin"
            min={0}
            max={1}
            step="any"
            value={a.p ?? ""}
            placeholder="e.g. 0.0043"
            onChange={(e) => {
              const t = e.target.value.trim();
              const n = Number(t);
              ops.update(a.id, { p: t === "" || !Number.isFinite(n) ? undefined : Math.min(1, Math.max(0, n)) });
            }}
          />
        </label>
        {a.p != null ? (
          <>
            {/* What the label shows, per bracket: the signs and the
                p-value tick independently — "★★", "p=0.004", or "★★ p=0.004". Ticking
                either writes both flags, so the bracket stops following the plot-wide
                display the moment it is customised. */}
            <label className="frow">
              <span>Significance signs</span>
              <input
                type="checkbox"
                checked={symbolOn}
                onChange={(e) => ops.update(a.id, { showSymbol: e.target.checked, showP: pOn })}
              />
            </label>
            <label className="frow">
              <span>Show p-value</span>
              <input
                type="checkbox"
                checked={pOn}
                onChange={(e) => ops.update(a.id, { showSymbol: symbolOn, showP: e.target.checked })}
              />
            </label>
          </>
        ) : (
          <label className="frow">
            <span>Label</span>
            <input
              type="text"
              className="numin"
              value={a.label ?? ""}
              placeholder="e.g. *** or p=0.01"
              onChange={(e) => ops.update(a.id, { label: e.target.value === "" ? undefined : e.target.value })}
            />
          </label>
        )}
        {/* Free position & size: auto placement is a starting point,
            not a cage. Ticked, the selected bracket grows round handles on its ends —
            drag them to resize it freely. Unticking clears the stored ends, snapping the
            bracket back to the two groups it names. */}
        <label className="frow" title="Unlock this bracket from its groups: round handles appear on its ends when it is selected — drag them to move and resize it freely. Untick to snap it back to the groups it names.">
          <span>Free position &amp; size</span>
          <input
            type="checkbox"
            checked={a.freeform ?? false}
            onChange={(e) => ops.update(a.id, e.target.checked ? { freeform: true } : { freeform: undefined, x: undefined, x2: undefined })}
          />
        </label>
        <label className="frow" title="Slide this bracket along the category axis. 0 = centred on the pair it spans — the position a canvas drag magnets back to.">
          <span>Sideways %</span>
          <input
            type="number"
            className="numin"
            step={1}
            value={a.bracketShift != null ? Math.round(a.bracketShift * 100) : 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              ops.update(a.id, { bracketShift: Number.isFinite(n) && n !== 0 ? n / 100 : undefined });
            }}
          />
        </label>
        {onSetSignificance && (
          <label className="frow" title="Off (default): the style below — thickness, shape, legs, symbol size, colour — changes every bracket on this graph. On: only this bracket.">
            <span>Only this bracket</span>
            <input type="checkbox" aria-label="Only this bracket" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} />
          </label>
        )}
        <label className="frow">
          <span>Thickness</span>
          <input type="number" className="numin" min={0.5} max={8} step={0.25} aria-label="Bracket thickness"
            value={onlyThis ? (a.width ?? sig.width ?? 1.5) : (sig.width ?? 1.5)}
            onChange={(e) => applyBracketStyle("width", Number(e.target.value), "width")} />
        </label>
        <label className="frow">
          <span>Shape</span>
          <select
            className="selin"
            aria-label="Bracket shape"
            value={onlyThis ? (a.bracketShape ?? "") : (sig.shape ?? "bracket")}
            onChange={(e) => applyBracketStyle("bracketShape", (e.target.value || undefined) as BracketShape | undefined, "shape")}
          >
            {onlyThis && <option value="">Follow the graph</option>}
            <option value="bracket">Square (⌐¬)</option>
            <option value="rounded">Rounded</option>
            <option value="brace">Curly brace</option>
            <option value="line">Plain bar (no ends)</option>
          </select>
        </label>
        {/* Legs — right next to Shape, on the clicked bracket (as well as in the plot-wide
            Significance section, which is not where a clicked bracket lands).
            Per bracket, defaulting to the graph's setting, exactly like Shape. Bar charts only — and
            UpSet, whose intersection bars the bar builder draws. */}
        {(plot?.kind === "bar" || plot?.kind === "histogram" || plot?.kind === "upset") && (
          <label className="frow" title="Equal: both legs the tick length — a flat bracket high over both bars. Reach the bars: each leg runs down to just above its own bar (its top, error bar or points), so a bracket between a tall and a short bar has a long leg on the short side.">
            <span>Legs</span>
            <select
              className="selin"
              aria-label="Bracket legs"
              value={onlyThis ? (a.bracketLegs ?? "") : (sig.legs ?? "equal")}
              onChange={(e) => applyBracketStyle("bracketLegs", (e.target.value || undefined) as "equal" | "reach" | undefined, "legs")}
            >
              {onlyThis && <option value="">Follow the graph</option>}
              <option value="equal">Equal length</option>
              <option value="reach">Reach the bars</option>
            </select>
          </label>
        )}
        <label className="frow" title="Font size of the symbol above the bracket">
          <span>Symbol size</span>
          <input
            type="number"
            className="numin"
            min={6}
            max={48}
            aria-label="Bracket symbol size"
            style={{ width: 110 }}
            value={(onlyThis ? a.size : sig.labelSize) ?? ""}
            placeholder="graph default"
            onChange={(e) => {
              const t = e.target.value.trim();
              applyBracketStyle("size", t === "" ? undefined : Math.min(48, Math.max(6, Number(t))), "labelSize");
            }}
          />
        </label>
        <ColourField value={onlyThis ? a.color : sig.color} onSet={(c) => applyBracketStyle("color", c, "color")} label="Bracket colour" />
      </div>
    );
  }
  if (a.kind === "text") {
    return (
      <div className="annrow">
        <div className="frow">
          <span>Text box</span>
          <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove text box">
            Remove
          </button>
        </div>
        <label className="frow">
          <span>Text</span>
          <input type="text" className="numin" value={a.label ?? ""} onChange={(e) => ops.update(a.id, { label: e.target.value })} />
        </label>
        <label className="frow">
          <span>X position %</span>
          <input
            type="number"
            className="numin"
            min={0}
            max={100}
            value={Math.round((a.x ?? 0.5) * 100)}
            onChange={(e) => ops.update(a.id, { x: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
          />
        </label>
        <label className="frow">
          <span>Y position %</span>
          <input
            type="number"
            className="numin"
            min={0}
            max={100}
            value={Math.round((a.y ?? 0.12) * 100)}
            onChange={(e) => ops.update(a.id, { y: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
          />
        </label>
        <label className="frow">
          <span>Size</span>
          <input
            type="number"
            className="numin"
            min={6}
            max={72}
            value={a.size ?? ""}
            placeholder="13"
            onChange={(e) => {
              const t = e.target.value.trim();
              ops.update(a.id, { size: t === "" ? undefined : Number(t) });
            }}
          />
        </label>
        <label className="frow">
          <span>Font</span>
          <select className="selin" value={a.fontFamily ?? ""} onChange={(e) => ops.update(a.id, { fontFamily: e.target.value || undefined })}>
            {FONT_FAMILIES.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="frow">
          <span>Style</span>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: 700 }}>
              <input type="checkbox" checked={a.bold ?? false} onChange={(e) => ops.update(a.id, { bold: e.target.checked || undefined })} /> B
            </label>
            <label style={{ display: "flex", gap: 4, alignItems: "center", fontStyle: "italic" }}>
              <input type="checkbox" checked={a.italic ?? false} onChange={(e) => ops.update(a.id, { italic: e.target.checked || undefined })} /> I
            </label>
          </span>
        </label>
        <label className="frow">
          <span>Rotation °</span>
          <input
            type="number"
            className="numin"
            min={-180}
            max={180}
            step={1}
            value={a.rotation ?? 0}
            onChange={(e) => ops.update(a.id, { rotation: Number(e.target.value) || undefined })}
          />
        </label>
        <AnchorRows a={a} plot={plot} table={table} onUpdate={(patch) => ops.update(a.id, patch)} />
        <ColourField value={a.color} onSet={(c) => ops.update(a.id, { color: c })} label="Text colour" />
        <TextBoxRows a={a} kind="text" wrapUnit="%" onUpdate={(patch) => ops.update(a.id, patch)} />
      </div>
    );
  }
  if (SHAPE_KINDS.has(a.kind)) {
    const SHAPE_LABEL: Record<string, string> = { rect: "Box", highlight: "Highlight", ellipse: "Ellipse", arrow: "Arrow", segment: "Line", callout: "Callout" };
    const hasArrow = a.kind === "arrow" || a.kind === "segment" || a.kind === "callout";
    const hasFill = a.kind === "rect" || a.kind === "highlight" || a.kind === "ellipse" || a.kind === "callout";
    const hasRotation = a.kind === "rect" || a.kind === "highlight" || a.kind === "ellipse";
    /**
     * Every shape draws its `label`, not just a callout: all six emit a real `<text>` carrying it.
     * `hasText` therefore covers all shape kinds, so a box, highlight, ellipse, arrow or line
     * never renders a caption that no control can set.
     */
    const hasText = SHAPE_KINDS.has(a.kind);
    return (
      <div className="annrow">
        <div className="frow">
          <span>{SHAPE_LABEL[a.kind] ?? "Shape"}</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" className="btn-mini" title="Bring to front" onClick={() => ops.reorder(a.id, "front")}>
              ⤒
            </button>
            <button type="button" className="btn-mini" title="Send to back" onClick={() => ops.reorder(a.id, "back")}>
              ⤓
            </button>
            <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove shape">
              Remove
            </button>
          </span>
        </div>
        {hasText && (
          <label className="frow">
            <span>Text</span>
            <input type="text" className="numin" value={a.label ?? ""} onChange={(e) => ops.update(a.id, { label: e.target.value })} />
          </label>
        )}
        {canJoinLegend(a.kind) && <InLegendRow a={a} ops={ops} plot={plot} />}
        {hasArrow && <AnchorRows a={a} plot={plot} table={table} onUpdate={(patch) => ops.update(a.id, patch)} />}
        <ColourField value={a.color} onSet={(c) => ops.update(a.id, { color: c })} label="Border colour" />
        {hasFill && (
          <label className="frow">
            {/* A callout's fill is the background of its words' box. */}
            <span>{a.kind === "callout" ? "Background" : "Fill"}</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <ColorInput className="colorin" value={a.fill ?? "#cccccc"} aria-label="Fill colour" onChange={(c) => ops.update(a.id, { fill: c })} />
              <button type="button" className="swbtn" title="No fill (transparent)" onClick={() => ops.update(a.id, { fill: undefined })}>
                ⨯
              </button>
            </span>
          </label>
        )}
        {hasFill && a.fill && (
          <label className="frow">
            <span>Fill opacity</span>
            <input
              type="number"
              className="numin"
              min={0}
              max={1}
              step={0.05}
              value={a.fillOpacity ?? 1}
              onChange={(e) => ops.update(a.id, { fillOpacity: Math.min(1, Math.max(0, Number(e.target.value))) })}
            />
          </label>
        )}
        {a.kind === "callout" && <TextBoxRows a={a} kind="callout" wrapUnit="%" onUpdate={(patch) => ops.update(a.id, patch)} />}
        {/* The label's own size — `size` changes it on all six shapes, so a
            written caption can be resized. Shown once there is a label: a size control with
            nothing to size is a control that does nothing. */}
        {(a.label ?? "") !== "" && (
          <label className="frow">
            <span>Text size</span>
            <input type="number" className="numin" min={6} max={48} step={0.5} value={a.size ?? 12} onChange={(e) => ops.update(a.id, { size: Number(e.target.value) || undefined })} />
          </label>
        )}
        <label className="frow">
          <span>Thickness</span>
          <input type="number" className="numin" min={0.5} max={12} step={0.25} value={a.width ?? 1.5} onChange={(e) => ops.update(a.id, { width: Number(e.target.value) })} />
        </label>
        <label className="frow">
          <span>Line style</span>
          <select className="selin" value={a.dash ?? "solid"} onChange={(e) => ops.update(a.id, { dash: e.target.value as LineDash })}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
            <option value="dashdot">Dash-dot</option>
            <option value="longdash">Long dash</option>
          </select>
        </label>
        {hasArrow && (
          <label className="frow">
            <span>Arrowhead</span>
            <select className="selin" value={a.arrowHead ?? (a.kind === "segment" ? "none" : "end")} onChange={(e) => ops.update(a.id, { arrowHead: e.target.value as ArrowHead })}>
              <option value="none">None</option>
              <option value="end">End</option>
              <option value="both">Both ends</option>
            </select>
          </label>
        )}
        {hasRotation && (
          <label className="frow">
            <span>Rotation °</span>
            <input type="number" className="numin" min={-180} max={180} step={1} value={a.rotation ?? 0} onChange={(e) => ops.update(a.id, { rotation: Number(e.target.value) })} />
          </label>
        )}
        <p className="note" style={{ fontSize: 11 }}>Drag the shape to move it; drag a handle to resize. Shapes track the plot on resize/zoom.</p>
      </div>
    );
  }
  if (a.kind === "image") {
    return (
      <div className="annrow">
        <div className="frow">
          <span>Image</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button type="button" className="btn-mini" title="Bring to front" onClick={() => ops.reorder(a.id, "front")}>
              ⤒
            </button>
            <button type="button" className="btn-mini" title="Send to back" onClick={() => ops.reorder(a.id, "back")}>
              ⤓
            </button>
            <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove image">
              Remove
            </button>
          </span>
        </div>
        <label className="frow">
          <span>Opacity</span>
          <input
            type="range"
            className="rangein"
            min={0.1}
            max={1}
            step={0.05}
            value={a.fillOpacity ?? 1}
            onChange={(e) => ops.update(a.id, { fillOpacity: Math.min(1, Math.max(0.1, Number(e.target.value))) })}
          />
        </label>
        <label className="frow">
          <span>Rotation °</span>
          <input type="number" className="numin" min={-180} max={180} step={1} value={a.rotation ?? 0} onChange={(e) => ops.update(a.id, { rotation: Number(e.target.value) })} />
        </label>
        <ColourField value={a.color} onSet={(c) => ops.update(a.id, { color: c })} label="Border colour" />
        {a.color && (
          <label className="frow">
            <span>Border width</span>
            <input type="number" className="numin" min={0} max={12} step={0.25} value={a.width ?? 1.5} onChange={(e) => ops.update(a.id, { width: Number(e.target.value) })} />
          </label>
        )}
        <div className="frow">
          <span />
          <button type="button" className="btn-mini" onClick={() => ops.replaceImage(a.id)}>
            Replace image…
          </button>
        </div>
        <p className="note" style={{ fontSize: 11 }}>
          Drag to move; drag a corner handle to resize; drag the top grip to rotate. The image is embedded in the file.
        </p>
      </div>
    );
  }
  if (a.kind === "vband" || a.kind === "hband") {
    const vert = a.kind === "vband";
    const pos = (vert ? a.x : a.y) ?? 0.4;
    const size = (vert ? a.w : a.h) ?? 0.2;
    const setPos = (f: number): void => ops.update(a.id, vert ? { x: f } : { y: f });
    const setSize = (f: number): void => ops.update(a.id, vert ? { w: f } : { h: f });
    // Opt-in axis-value anchoring: a band can be
    // pinned to an axis-value range instead of a fraction of the plot, so a zone (VIF Low/Mod/
    // High, a normal range, a threshold) lands on real numbers and re-tracks the axis. The band
    // spans one axis — the value axis it runs across: a vband's X (via dataAxisOf for a
    // transposed chart), an hband's Y. Setting bandLo/bandHi turns it on; clearing them reverts.
    const dataAnchored = a.bandLo != null && a.bandHi != null;
    const spec = plot ? (plot[`${dataAxisOf(plot, vert ? "x" : "y")}Axis`] as AxisSpec | undefined) : undefined;
    // Seed the value range when switching on: a third-to-two-thirds slice of the axis's own
    // bounds when they're set (a visible zone the user then narrows), else a plain 0–1.
    const seedRange = (): { lo: number; hi: number } => {
      const lo = spec?.min, hi = spec?.max;
      if (typeof lo === "number" && typeof hi === "number" && hi > lo) {
        const r = (v: number): number => Number(v.toPrecision(3));
        return { lo: r(lo + (hi - lo) / 3), hi: r(lo + (2 * (hi - lo)) / 3) };
      }
      return { lo: 0, hi: 1 };
    };
    const setAnchor = (mode: "frac" | "data"): void => {
      if (mode === "data") { const s = seedRange(); ops.update(a.id, { bandLo: s.lo, bandHi: s.hi }); }
      else ops.update(a.id, { bandLo: undefined, bandHi: undefined });
    };
    return (
      <div className="annrow">
        <div className="frow">
          <span>{vert ? "Vertical band (X range)" : "Horizontal band (Y range)"}</span>
          <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove band">
            Remove
          </button>
        </div>
        <label className="frow">
          <span>Label</span>
          <input type="text" className="numin" value={a.label ?? ""} placeholder="optional caption" onChange={(e) => ops.update(a.id, { label: e.target.value === "" ? undefined : e.target.value })} />
        </label>
        {a.label && <CaptionSizeRow a={a} ops={ops} />}
        <ColourField value={a.fill} onSet={(c) => ops.update(a.id, { fill: c })} label="Fill" />
        <label className="frow">
          <span>Transparency</span>
          <input type="range" className="rangein" min={0} max={1} step={0.02} value={a.fillOpacity ?? 0.16} onChange={(e) => ops.update(a.id, { fillOpacity: Math.min(1, Math.max(0, Number(e.target.value))) })} />
        </label>
        <label className="frow">
          <span>Anchor</span>
          <select className="numin" aria-label="Band anchor" value={dataAnchored ? "data" : "frac"} onChange={(e) => setAnchor(e.target.value as "frac" | "data")}>
            <option value="frac">Plot % (fraction of the plot)</option>
            <option value="data">{vert ? "Data value (X range)" : "Data value (Y range)"}</option>
          </select>
        </label>
        {dataAnchored ? (
          <>
            <label className="frow">
              <span>From value</span>
              <input type="number" className="numin" value={a.bandLo ?? 0} onChange={(e) => ops.update(a.id, { bandLo: Number(e.target.value) })} />
            </label>
            <label className="frow">
              <span>To value</span>
              <input type="number" className="numin" value={a.bandHi ?? 0} onChange={(e) => ops.update(a.id, { bandHi: Number(e.target.value) })} />
            </label>
            <p className="note" style={{ fontSize: 11 }}>
              Pinned to the {vert ? "X" : "Y"} axis — it moves with the scale and clips to the axis. Edited by value here, not by dragging.
            </p>
          </>
        ) : (
          <>
            <label className="frow">
              <span>{vert ? "Left %" : "Top %"}</span>
              <input type="number" className="numin" min={0} max={100} value={Math.round(pos * 100)} onChange={(e) => setPos(Math.min(1, Math.max(0, Number(e.target.value) / 100)))} />
            </label>
            <label className="frow">
              <span>{vert ? "Width %" : "Height %"}</span>
              <input type="number" className="numin" min={1} max={100} value={Math.round(size * 100)} onChange={(e) => setSize(Math.min(1, Math.max(0, Number(e.target.value) / 100)))} />
            </label>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="annrow">
      <div className="frow">
        <span>{a.kind === "hline" ? "Horizontal line (Y)" : "Vertical line (X)"}</span>
        <button type="button" className="btn-mini" onClick={() => ops.remove(a.id)} aria-label="Remove reference line">
          Remove
        </button>
      </div>
      <label className="frow">
        <span>Value</span>
        <input
          type="number"
          className="numin"
          value={a.value ?? ""}
          onChange={(e) => {
            const t = e.target.value.trim();
            ops.update(a.id, { value: t === "" ? undefined : Number(t) });
          }}
        />
      </label>
      <label className="frow">
        <span>Label</span>
        <input
          type="text"
          className="numin"
          value={a.label ?? ""}
          placeholder="none"
          onChange={(e) => ops.update(a.id, { label: e.target.value === "" ? undefined : e.target.value })}
        />
      </label>
      {a.label && <CaptionSizeRow a={a} ops={ops} />}
      <InLegendRow a={a} ops={ops} plot={plot} />
      <label className="frow">
        <span>Style</span>
        <select className="selin" value={a.dash ?? "dashed"} onChange={(e) => ops.update(a.id, { dash: e.target.value as LineDash })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="dashdot">Dash-dot</option>
          <option value="longdash">Long dash</option>
        </select>
      </label>
      <label className="frow">
        <span>Thickness</span>
        <input type="number" className="numin" min={0.5} max={8} step={0.25} value={a.width ?? 1.5} onChange={(e) => ops.update(a.id, { width: Number(e.target.value) })} />
      </label>
      <ColourField value={a.color} onSet={(c) => ops.update(a.id, { color: c })} label="Reference-line colour" />
    </div>
  );
}

/**
 * The size of a band's or reference line's caption — `Annotation.size`, the field a text box already sizes
 * with. Shown only while there is a caption to size. Blank = the legend font the caption falls back to.
 * (So clicking a caption such as "Treatment", "Response", "LOD" or "Travel" opens a panel that can size it.)
 */
/**
 * "Show in legend" for a drawn line (hline / vline / segment / arrow): the line becomes a legend row — its own dash,
 * colour and width as the key, its caption as the words — and the caption leaves the plot. The same as dropping the
 * caption onto the legend; dragging the row back out undoes it. Where this graph draws no legend block (hidden, or
 * direct labels) the line keeps its caption, and the row says so rather than looking like it did nothing.
 */
function InLegendRow({ a, ops, plot }: { a: Annotation; ops: AnnotationOps; plot?: Plot | undefined }) {
  const lg = plot?.legend;
  const noBlock = lg?.show === false || lg?.position === "none" || lg?.position === "direct";
  return (
    <>
      <label className="frow" title="List this line in the legend. You can also drag its label onto the legend, and drag the row out to take it back.">
        <span>Show in legend</span>
        <input
          type="checkbox"
          checked={a.inLegend === true}
          aria-label="Show this line in the legend"
          onChange={(e) => ops.update(a.id, e.target.checked ? { inLegend: true, labelOffset: undefined } : { inLegend: undefined })}
        />
      </label>
      {a.inLegend && noBlock && (
        <p className="note" style={{ fontSize: 11 }}>
          This graph's legend is {lg?.position === "direct" ? "set to labels beside the lines" : "hidden"}, so the line keeps its label on the graph.
        </p>
      )}
    </>
  );
}

function CaptionSizeRow({ a, ops }: { a: Annotation; ops: AnnotationOps }) {
  return (
    <label className="frow">
      <span>Label size</span>
      <input
        type="number"
        className="numin"
        style={{ width: 76 }}
        min={6}
        max={48}
        value={a.size ?? ""}
        placeholder="legend"
        aria-label="Caption size"
        onChange={(e) => {
          const t = e.target.value.trim();
          ops.update(a.id, { size: t === "" ? undefined : Math.min(48, Math.max(6, Number(t))) });
        }}
      />
    </label>
  );
}

/** Curated figure-background paper swatches (light papers + dark/navy for posters). */
const BACKGROUND_SWATCHES: string[] = [
  "#ffffff", "#f7f7f5", "#fbf7ec", "#f4f1ea", "#f0f2f5", "#e9eef3",
  "#eaf3ea", "#fdeef0", "#eef0fb", "#fff8e1", "#f0f9ff", "#f5f0ff",
  "#1a1a2e", "#0b1020", "#222222", "#0f2230",
];

/** Per-series confidence/data-ellipse overlay (XY scatter) — show · level · mode · fill. */
/** Bubble size-legend editor. The "Reference values" field keeps a local draft
 *  string so the user can freely type a comma-separated list (add values, type
 *  decimals, use trailing commas) — it only commits parsed numbers on blur / Enter.
 *  Parsing on every keystroke would inject spurious 0s and eat decimals. */
function BubbleLegendPanel({ plot, onSet, defaults, note }: {
  plot: Plot;
  onSet: (patch: Partial<Plot>) => void;
  /** Radii the builder falls back to for this kind — a PCA score dot starts far smaller
   *  than a bubble. The inputs must show the same numbers the graph is drawing. */
  defaults?: { minRadius: number; maxRadius: number } | undefined;
  /** Closing note; the default explains the bubble chart's 2nd Y column. */
  note?: string | undefined;
}) {
  const b = plot.bubble ?? {};
  const dMin = defaults?.minRadius ?? 4;
  const dMax = defaults?.maxRadius ?? 22;
  const setB = (patch: Partial<NonNullable<Plot["bubble"]>>): void => onSet({ bubble: { ...b, ...patch } });
  // The committed values, as text; the draft mirrors it until the user edits.
  const committed = (b.sizeLegendValues ?? []).join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? committed;
  const commit = (raw: string): void => {
    // Drop empty tokens (so a trailing comma doesn't become 0); keep finite numbers.
    const nums = raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isFinite(n));
    setB({ sizeLegendValues: nums.length ? nums : undefined });
    setDraft(null);
  };
  return (
    <>
      <label className="frow">
        <span>Show size legend</span>
        <input type="checkbox" checked={b.showSizeLegend ?? true} onChange={(e) => setB({ showSizeLegend: e.target.checked })} />
      </label>
      <label className="frow" title="Heading above the size legend. Blank = the size column's name.">
        <span>Legend title</span>
        <input type="text" className="numin" style={{ width: 120 }} value={b.sizeLegendTitle ?? ""} placeholder="(size column)" onChange={(e) => setB({ sizeLegendTitle: e.target.value === "" ? undefined : e.target.value })} />
      </label>
      <label className="frow" title="Smallest bubble radius (px) — the size column minimum maps to this.">
        <span>Min radius</span>
        <input type="number" className="numin" min={1} max={40} step={1} style={{ width: 60 }} value={b.minRadius ?? dMin} onChange={(e) => { const t = e.target.value.trim(); setB({ minRadius: t === "" ? undefined : Number(t) }); }} />
      </label>
      <label className="frow" title="Largest bubble radius (px) — the size column maximum maps to this.">
        <span>Max radius</span>
        <input type="number" className="numin" min={2} max={60} step={1} style={{ width: 60 }} value={b.maxRadius ?? dMax} onChange={(e) => { const t = e.target.value.trim(); setB({ maxRadius: t === "" ? undefined : Number(t) }); }} />
      </label>
      <label className="frow" title="Values shown in the legend (comma-separated) — each gets its own reference sphere. Blank = auto (max · mid · min).">
        <span>Reference values</span>
        <input
          type="text"
          className="numin"
          style={{ width: 120 }}
          value={text}
          placeholder="auto"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
        />
      </label>
      <label className="frow" title="Resize the whole size legend (the reference spheres + labels).">
        <span>Legend size</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="range" min={0.5} max={3} step={0.1} value={b.sizeLegendScale ?? 1} onChange={(e) => setB({ sizeLegendScale: Number(e.target.value) })} />
          <span style={{ width: 30, textAlign: "right" }}>{(b.sizeLegendScale ?? 1).toFixed(1)}×</span>
        </span>
      </label>
      <p className="note" style={{ fontSize: 11, marginTop: 4 }}>
        {note ?? "The bubble radius encodes the 2nd Y column. Enter reference values (any count) to choose the bubbles shown. Drag the legend on the graph to reposition it."}
      </p>
    </>
  );
}

/** The depth component actually in force on a PCA score/biplot — mirrors the builder's
 *  auto rule for `PcaStyle.sizeComponent`, so the control shows what the graph is doing:
 *  both kinds size by the first component on neither axis. -1 = off (uniform dots). */
function pcaSizeComponent(plot: Plot, kind: string, ncomp: number): number {
  const explicit = plot.pcaStyle?.sizeComponent;
  if (explicit !== undefined) return Math.trunc(explicit);
  if (kind !== "pcascore" && kind !== "pcabiplot") return -1;
  const xC = plot.pcaStyle?.xComponent ?? 0;
  const yC = plot.pcaStyle?.yComponent ?? 1;
  for (let i = 0; i < ncomp; i++) if (i !== xC && i !== yC) return i;
  return -1;
}

/** A comma-separated number-list input with a local draft buffer — the user types
 *  freely (add values, decimals, trailing commas) and it commits on blur / Enter,
 *  dropping empty tokens. Blank commits `undefined` (= auto). Shared by the bubble
 *  size-legend and the heatmap colour-bar value editors. */
function NumberListInput({ values, placeholder, width, onCommit }: {
  values: number[] | undefined;
  placeholder?: string;
  width?: number;
  onCommit: (nums: number[] | undefined) => void;
}) {
  const committed = (values ?? []).join(", ");
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string): void => {
    const nums = raw.split(/[,\s]+/).map((s) => s.trim()).filter((s) => s !== "").map(Number).filter((n) => Number.isFinite(n));
    onCommit(nums.length ? nums : undefined);
    setDraft(null);
  };
  return (
    <input
      type="text"
      className="numin"
      style={{ width: width ?? 120 }}
      value={draft ?? committed}
      placeholder={placeholder ?? "auto"}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

/**
 * The reference-line panel — one panel for every guide line a chart draws itself.
 *
 * These lines are not in `plot.annotations` (the builder recomputes them every rebuild), so the
 * annotation editor cannot find them and would report *"This annotation was removed."* — a dead
 * end on Bland-Altman, forest, pyramid, estimation, volcano and the three PCA kinds. The ROC
 * chance diagonal would otherwise open a full Data panel of Shape / Fill / Opacity controls for
 * a line with no markers, writing to `seriesStyles["roc-diag"]`, which the ROC builder never reads.
 *
 * These lines need the same edits as an axis (thickness, colour, dash type, etc.).
 *
 * Style and hide only — no move, no delete. These lines sit at computed statistics (a bias,
 * a null value, an origin, a control mean); dragging one asserts a number the data does not
 * have, and a delete cannot stick because the next rebuild puts it back. The panel says so
 * rather than offering a control that silently does nothing.
 */
/** The colour a single fitted curve gets when the fit carries none — the builder's fallback
 *  (`OKABE_ITO[1]`), so the panels open on the colour actually drawn. */
const DEFAULT_FIT_INK = OKABE_ITO[1] ?? "#E69F00";

function RefLinePanel({ id, plot, onSet, onSelect, onSetPlotFont }: {
  id: string;
  plot: Plot;
  onSet: (patch: Partial<Plot>) => void;
  onSelect: (sel: GraphSelection) => void;
  onSetPlotFont: SetPlotFont;
}) {
  const info = referenceLine(id);
  const own = plot.refLineStyles?.[id] ?? {};
  const all = plot.refLine ?? {};
  const hidden = plot.refLineHidden?.[id] ?? false;
  const allOff = all.show === false;
  // What the line is actually drawn with right now, so every control opens showing the drawn value
  // rather than a blank that reads as "unset" next to a line that is plainly coloured.
  // The EC50 marker's built-in colour is the fit's (the builder falls back to `pf.color`,
  // then the default fit ink); its built-in width is in the registry, so the panel does not
  // open on "1 px, grey" while the line is 1.5 px in the fit's colour.
  const builtInColor = id === "fit-marker" ? plot.fitStyle?.color ?? plot.fit?.color ?? plot.fits?.[0]?.color ?? DEFAULT_FIT_INK : "#9aa0aa";
  const effColor = own.color ?? all.color ?? builtInColor;
  const effWidth = own.width ?? all.width ?? info?.width ?? 1;
  const effDash = own.dash ?? all.dash ?? info?.dash ?? "dashed";

  const set = (patch: Partial<NonNullable<Plot["refLineStyles"]>[string]>): void => {
    const next = { ...(plot.refLineStyles ?? {}) };
    const merged = { ...(next[id] ?? {}), ...patch };
    // Drop the entry entirely once nothing is overridden, so "Reset" really does return the
    // graph to the state a fresh one is in (and the saved file does not grow empty objects).
    const live = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
    if (Object.keys(live).length === 0) delete next[id];
    else next[id] = live;
    onSet({ refLineStyles: Object.keys(next).length ? next : undefined });
  };
  const setHidden = (h: boolean): void => {
    const next = { ...(plot.refLineHidden ?? {}) };
    if (h) next[id] = true;
    else delete next[id];
    onSet({ refLineHidden: Object.keys(next).length ? next : undefined });
  };
  const siblings = referenceLinesFor(plot.kind, plot).filter((r) => r.id !== id);

  // The value the line sits at, for the lines the user sets rather than the graph computes:
  // the volcano's three thresholds and the forest no-effect value. Clicking such a line opens
  // this box beside its colour / thickness / dashes, so the value can be set where the line was
  // clicked, not only under Chart → Volcano. Writes the same field that control edits, so the
  // two never disagree. The ± fold-
  // change guides are one number (`fcThreshold`), so editing either moves both.
  const valueRow = ((): { label: string; hint: string; value: number; def: number; set: (v: number | undefined) => void } | null => {
    if (id === "vc-fc-pos" || id === "vc-fc-neg") {
      const v = plot.volcano ?? {};
      return {
        label: "Cut-off |log₂ FC|", hint: "The |log₂ fold-change| both guides sit at (1 = 2-fold, 2 = 4-fold). Editing either guide moves both — they are one cut-off, mirrored.",
        value: v.fcThreshold ?? 1, def: 1,
        set: (n) => onSet({ volcano: { ...v, fcThreshold: n } }),
      };
    }
    if (id === "vc-p") {
      const v = plot.volcano ?? {};
      return {
        label: "Cut-off −log₁₀ p", hint: "The −log₁₀ p the guide sits at. 1.30 ≈ p < 0.05; 2 = p < 0.01.",
        value: v.pThreshold ?? 1.301, def: 1.301,
        set: (n) => onSet({ volcano: { ...v, pThreshold: n } }),
      };
    }
    if (id === "forest-ref") {
      const f = plot.forest ?? {};
      return {
        label: "Null value", hint: "The no-effect value the studies are compared against: 1 for ratios (OR / RR / HR), 0 for differences.",
        value: f.refValue ?? 1, def: 1,
        set: (n) => onSet({ forest: { ...f, refValue: n } }),
      };
    }
    return null;
  })();

  return (
    <>
      <div className="insphd">{info?.name ?? "Reference line"}</div>
      {info && <p className="note" style={{ fontSize: 11, marginTop: 0 }}>{info.hint}</p>}
      {valueRow && (
        <label className="frow" title={valueRow.hint}>
          <span>{valueRow.label}</span>
          <input
            type="number" className="numin" step="any" style={{ width: 70 }}
            aria-label={`Reference line value — ${valueRow.label}`}
            value={valueRow.value}
            onChange={(e) => {
              const t = e.target.value.trim();
              if (t === "") { valueRow.set(undefined); return; } // blank → the default
              const n = Number(t);
              if (Number.isFinite(n)) valueRow.set(n);
            }}
          />
        </label>
      )}
      <label className="frow" title="Hide just this line. The others keep their own switches.">
        <span>Show</span>
        <input type="checkbox" checked={!hidden} disabled={allOff} onChange={(e) => setHidden(!e.target.checked)} />
      </label>
      {allOff && (
        <p className="note" style={{ fontSize: 11 }}>
          All of this graph’s reference lines are switched off in <strong>Chart → Reference lines</strong>. Turn that back on to see this one.
        </p>
      )}
      <label className="frow">
        <span>Colour</span>
        <ColorInput className="colorin" value={effColor} aria-label="Reference line colour" onChange={(c) => set({ color: c })} />
      </label>
      <ColourSwatches value={own.color} onPick={(c) => set({ color: c })} />
      <label className="frow" title="Line thickness in pixels. The dash pattern scales with it.">
        <span>Thickness</span>
        <input
          type="number" className="numin" min={0.25} max={12} step={0.25} value={effWidth}
          aria-label="Reference line thickness"
          onChange={(e) => {
            const v = Number(e.target.value);
            set({ width: Number.isFinite(v) ? Math.min(12, Math.max(0.25, v)) : undefined });
          }}
        />
      </label>
      <label className="frow">
        <span>Dashes</span>
        <select className="selin" value={effDash} aria-label="Reference line dashes" onChange={(e) => set({ dash: e.target.value as LineDash })}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="dashdot">Dash-dot</option>
          <option value="longdash">Long dash</option>
        </select>
      </label>
      {plot.refLineLabels?.[id] !== undefined || id.startsWith("ba-") ? (
        <label className="frow" title="The caption drawn beside the line. Blank restores the value the chart computes.">
          <span>Label</span>
          <input
            type="text" className="numin" style={{ width: 120 }}
            value={plot.refLineLabels?.[id] ?? ""}
            placeholder="(computed)"
            onChange={(e) => {
              const next = { ...(plot.refLineLabels ?? {}) };
              if (e.target.value.trim()) next[id] = e.target.value;
              else delete next[id];
              onSet({ refLineLabels: Object.keys(next).length ? next : undefined });
            }}
          />
        </label>
      ) : null}
      {/* The caption is text, so it needs a font control as well as the line style and the
          wording: clicking "Bias 0.12" must be able to size the text too. Every computed
          caption is drawn with the legend font, so this is that control. */}
      {/* Note: the EC50 / IC50 label is the one caption drawn with the tick font (it sits at the
          axis it marks), so the legend-font control would edit the legend and not this label.
          It gets its own font control instead. */}
      {id === "fit-marker" ? (
        /* The label's own font, rather than the tick font, which also moves every axis number and
           is absent on most charts. Blank fields inherit the tick font. */
        <FontControls
          label="Label font"
          element="tick"
          spec={{ ...(plot.fonts?.tick ?? {}), ...(plot.refLineLabelFonts?.[id] ?? {}) }}
          defaultSize={plot.fonts?.tick?.size ?? 12}
          onSetPlotFont={onSetPlotFont}
          onSet={(patch) => onSet({ refLineLabelFonts: { ...(plot.refLineLabelFonts ?? {}), [id]: { ...(plot.refLineLabelFonts?.[id] ?? {}), ...patch } } })}
        />
      ) : (
        <FontControls label="Caption type" element="legend" spec={plot.fonts?.legend} defaultSize={12} onSetPlotFont={onSetPlotFont} />
      )}
      {/* Note: `btn-mini`, not `swbtn`: swbtn is the 22×22 px colour-swatch square (padding 0),
          which would render these text buttons as two tiny squares with the words clipped.
          btn-mini is the text-button class the "← Back to graph" button below already uses. */}
      <div className="frow" style={{ marginTop: 8, gap: 6, justifyContent: "flex-start" }}>
        <button
          type="button" className="btn-mini"
          title="Clear this line's own colour, thickness and dashes — back to the graph-wide setting, then the built-in look."
          onClick={() => onSet({ refLineStyles: (() => { const n = { ...(plot.refLineStyles ?? {}) }; delete n[id]; return Object.keys(n).length ? n : undefined; })() })}
        >
          Reset this line
        </button>
        {siblings.length > 0 && (
          <button
            type="button" className="btn-mini"
            title={`Give the other ${siblings.length} reference line${siblings.length === 1 ? "" : "s"} on this graph the same colour, thickness and dashes.`}
            onClick={() => {
              const next = { ...(plot.refLineStyles ?? {}) };
              for (const s of siblings) next[s.id] = { color: effColor, width: effWidth, dash: effDash };
              next[id] = { color: effColor, width: effWidth, dash: effDash };
              onSet({ refLineStyles: next });
            }}
          >
            Match the others
          </button>
        )}
      </div>
      <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
        {valueRow
          ? "This line sits at the value set above, so it can’t be dragged or deleted — change the value to move it, or hide it."
          : "This line sits at a value the graph computes from the data, so it can’t be dragged or deleted — the graph would draw it again at the same value. Hide it instead."}
      </p>
      <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
        ← Back to graph
      </button>
    </>
  );
}

function EllipsePanel({ plot, onSet }: { plot: Plot; onSet: (patch: Partial<Plot>) => void }) {
  const e = plot.ellipse ?? {};
  const set = (patch: Partial<EllipseSpec>): void => onSet({ ellipse: { ...e, ...patch } });
  return (
    <>
      <label className="frow">
        <span>Show ellipses</span>
        <input type="checkbox" checked={e.show ?? false} onChange={(ev) => set({ show: ev.target.checked || undefined })} />
      </label>
      <label className="frow">
        <span>Type</span>
        <select className="selin" value={e.mode ?? "data"} onChange={(ev) => set({ mode: ev.target.value as EllipseSpec["mode"] })}>
          <option value="data">Confidence (data spread)</option>
          <option value="mean">Confidence of the mean (÷√n)</option>
          <option value="sd">Standard deviation (k·SD)</option>
          <option value="sem">Standard error (k·SEM)</option>
        </select>
      </label>
      {(e.mode ?? "data") === "data" || (e.mode ?? "data") === "mean" ? (
        <label className="frow">
          <span>Level</span>
          <select className="selin" value={String(e.level ?? 0.95)} onChange={(ev) => set({ level: Number(ev.target.value) })}>
            <option value="0.6827">68%</option>
            <option value="0.9">90%</option>
            <option value="0.95">95%</option>
            <option value="0.99">99%</option>
          </select>
        </label>
      ) : (
        <label className="frow">
          <span>Multiplier (k)</span>
          <select className="selin" value={String(e.k ?? 2)} onChange={(ev) => set({ k: Number(ev.target.value) })}>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="3">3×</option>
          </select>
        </label>
      )}
      <label className="frow">
        <span>Fill opacity</span>
        <input
          type="number"
          className="numin"
          min={0}
          max={1}
          step={0.02}
          value={e.fillOpacity ?? 0.12}
          onChange={(ev) => set({ fillOpacity: Math.min(1, Math.max(0, Number(ev.target.value))) })}
        />
      </label>
      <label className="frow">
        <span>Border width</span>
        <input
          type="number"
          className="numin"
          min={0}
          max={10}
          step={0.25}
          value={e.borderWidth ?? 1.5}
          onChange={(ev) => set({ borderWidth: Math.min(10, Math.max(0, Number(ev.target.value))) })}
        />
      </label>
      <p className="note" style={{ fontSize: 11 }}>
        A covariance ellipse around each series' points (needs ≥3). The uncertainty ellipse of PCA / PCoA / ordination scatter.
      </p>
    </>
  );
}

/**
 * The fitted-curve panel — the curve a fit / regression / global fit drew, and its bands.
 *
 * The fit's drawn items (dashed lines marking a value, coloured bands marking a range…) can be
 * selected, edited (colour, opacity, line thickness, dash type…) and shown or hidden. Without a style
 * the curve is 2.4px solid and the bands 0.18 / 0.08 opaque.
 *
 * Writes `plot.fitStyle` — deliberately not `plot.fit`, which the next re-fit replaces. The
 * EC50 / IC50 marker is a reference line and has its own panel (click it, or the row under
 * Chart → EC50 / IC50 marker); the link at the bottom goes there.
 */
function FitPanel({ plot, onSet, onSelect }: { plot: Plot; onSet: (patch: Partial<Plot>) => void; onSelect: (sel: GraphSelection) => void }) {
  const fs = plot.fitStyle ?? {};
  const set = (patch: Partial<FitStyle>): void => {
    const merged = { ...fs, ...patch };
    // Drop unset fields so "Reset" really returns to a fresh graph's state.
    const live = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as FitStyle;
    onSet({ fitStyle: Object.keys(live).length ? live : undefined });
  };
  const fits = [...(plot.fit ? [plot.fit] : []), ...(plot.fits ?? [])];
  const hasCi = fits.some((f) => (f.confidenceBand?.length ?? 0) >= 2);
  const hasPi = fits.some((f) => (f.predictionBand?.length ?? 0) >= 2);
  const hasMarker = fits.some((f) => f.marker);
  // The colour the curve is drawn with when nothing is overridden — the fit's own, else the
  // default fit ink — so the picker opens on the truth rather than a blank.
  const effColor = fs.color ?? fits[0]?.color ?? DEFAULT_FIT_INK;
  const opacityRow = (label: string, value: number, onChange: (v: number | undefined) => void, aria: string) => (
    <label className="frow" title="0 = invisible, 1 = solid.">
      <span>{label}</span>
      <input
        type="number" className="numin" min={0} max={1} step={0.02} value={value}
        aria-label={aria}
        onChange={(e) => { const v = Number(e.target.value); onChange(Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined); }}
      />
    </label>
  );
  return (
    <>
      <p className="note" style={{ fontSize: 11, marginTop: 0 }}>
        The curve the fit drew{hasCi || hasPi ? " and its bands" : ""}. Click any of them on the graph to land here.
        The curve’s shape is the fit itself — restyle it, or hide it; a re-fit keeps this look.
      </p>
      <div className="inspsub">Curve</div>
      <label className="frow" title="Hide the fitted curve. Its bands and marker stay.">
        <span>Show</span>
        <input type="checkbox" checked={fs.show !== false} aria-label="Show fitted curve" onChange={(e) => set({ show: e.target.checked ? undefined : false })} />
      </label>
      {/* Hidden while the curve is: a hidden curve has nothing to key. */}
      {fs.show !== false && (
        <label className="frow" title="List the fitted curve in the legend: its own line as the key, the fit's name as the words. Drag the row out of the legend to take it back out.">
          <span>Show in legend</span>
          <input type="checkbox" checked={fs.inLegend === true} aria-label="Show fitted curve in legend" onChange={(e) => set({ inLegend: e.target.checked || undefined })} />
        </label>
      )}
      <label className="frow">
        <span>Colour</span>
        <ColorInput className="colorin" value={effColor} aria-label="Fitted curve colour" onChange={(c) => set({ color: c })} />
      </label>
      <ColourSwatches value={fs.color} onPick={(c) => set({ color: c })} />
      <label className="frow" title="Line thickness in pixels. The dash pattern scales with it.">
        <span>Thickness</span>
        <input
          type="number" className="numin" min={0.25} max={12} step={0.25} value={fs.width ?? 2.4}
          aria-label="Fitted curve thickness"
          onChange={(e) => { const v = Number(e.target.value); set({ width: Number.isFinite(v) ? Math.min(12, Math.max(0.25, v)) : undefined }); }}
        />
      </label>
      <label className="frow">
        <span>Dashes</span>
        <select className="selin" value={fs.dash ?? "solid"} aria-label="Fitted curve dashes" onChange={(e) => set({ dash: e.target.value === "solid" ? undefined : (e.target.value as LineDash) })}>
          {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {opacityRow("Opacity", fs.opacity ?? 1, (v) => set({ opacity: v }), "Fitted curve opacity")}
      {hasCi && (
        <>
          <div className="inspsub" style={{ marginTop: 10 }}>Confidence band</div>
          <label className="frow" title="The band the mean response lies in (95%).">
            <span>Show</span>
            <input type="checkbox" checked={fs.ciShow !== false} aria-label="Show confidence band" onChange={(e) => set({ ciShow: e.target.checked ? undefined : false })} />
          </label>
          <label className="frow" title="Blank = the curve's colour.">
            <span>Colour</span>
            <ColorInput className="colorin" value={fs.ciColor ?? effColor} aria-label="Confidence band colour" onChange={(c) => set({ ciColor: c })} />
          </label>
          {opacityRow("Opacity", fs.ciOpacity ?? 0.18, (v) => set({ ciOpacity: v }), "Confidence band opacity")}
        </>
      )}
      {hasPi && (
        <>
          <div className="inspsub" style={{ marginTop: 10 }}>Prediction band</div>
          <label className="frow" title="The wider band a new observation would fall in (95%).">
            <span>Show</span>
            <input type="checkbox" checked={fs.piShow !== false} aria-label="Show prediction band" onChange={(e) => set({ piShow: e.target.checked ? undefined : false })} />
          </label>
          <label className="frow" title="Blank = the curve's colour.">
            <span>Colour</span>
            <ColorInput className="colorin" value={fs.piColor ?? effColor} aria-label="Prediction band colour" onChange={(c) => set({ piColor: c })} />
          </label>
          {opacityRow("Opacity", fs.piOpacity ?? 0.08, (v) => set({ piOpacity: v }), "Prediction band opacity")}
        </>
      )}
      <div className="frow" style={{ marginTop: 8, gap: 6 }}>
        <button
          type="button" className="swbtn"
          title="Clear every override here — back to the built-in look (the fit's colour, 2.4px solid, bands at 18% / 8%)."
          onClick={() => onSet({ fitStyle: undefined })}
        >
          Reset
        </button>
        {hasMarker && (
          <button
            type="button" className="swbtn"
            title="The EC50 / IC50 crosshair is a reference line with its own colour, thickness, dashes and show switch."
            onClick={() => onSelect({ kind: "refline", id: "fit-marker" })}
          >
            EC50 / IC50 marker →
          </button>
        )}
      </div>
    </>
  );
}

/** Figure (paper) background chooser — transparent · default · many swatches · custom. */
function BackgroundPanel({ plot, onSet }: { plot: Plot; onSet: (patch: Partial<Plot>) => void }) {
  const bg = plot.background;
  const set = (c: string | undefined): void => onSet({ background: c });
  return (
    <>
      <div className="frow">
        <span>Paper</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className={"btn-mini" + (bg === "transparent" ? " on" : "")} onClick={() => set("transparent")}>
            Transparent
          </button>
          <button type="button" className={"btn-mini" + (bg == null ? " on" : "")} onClick={() => set(undefined)}>
            Default
          </button>
        </span>
      </div>
      <div className="swgrid">
        {BACKGROUND_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={"swatch" + (bg === c ? " on" : "")}
            style={{ background: c }}
            title={c}
            aria-label={`Background ${c}`}
            onClick={() => set(c)}
          />
        ))}
      </div>
      <label className="frow">
        <span>Custom</span>
        <ColorInput
          className="colorin"
          value={typeof bg === "string" && bg.startsWith("#") ? bg : "#ffffff"}
          aria-label="Custom background colour"
          onChange={(c) => set(c)}
        />
      </label>
      <p className="note" style={{ fontSize: 11 }}>Transparent = no paper (best for overlaying / transparent PNG export).</p>
      <BackdropControls plot={plot} onSet={onSet} />
    </>
  );
}

/** Preset id → its label + a two-colour chip previewing the palette. */
const BACKDROP_PRESETS: { id: BackdropPreset; label: string; chip: [string, string] }[] = [
  { id: "aurora", label: "Aurora", chip: ["#dce8f7", "#fbe3cd"] },
  { id: "spectrum", label: "Spectrum", chip: ["#141a4a", "#e2561d"] },
  { id: "tide", label: "Tide", chip: ["#f4ecd8", "#123a6b"] },
];

/**
 * Opt-in decorative backdrop (gradient + wave bands). Off unless the user picks a preset,
 * and never suggested elsewhere — it's a slide/poster look, not a publication one, which
 * the note states once rather than warning repeatedly.
 */
function BackdropControls({ plot, onSet }: { plot: Plot; onSet: (patch: Partial<Plot>) => void }) {
  const bd = plot.backdrop;
  const setBd = (patch: Partial<BackdropStyle> | undefined): void =>
    onSet({ backdrop: patch === undefined ? undefined : { ...bd, ...patch } });
  const activePreset = bd?.preset ?? "aurora";
  return (
    <>
      <div className="frow">
        <span>Backdrop</span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={"btn-mini" + (!bd ? " on" : "")} onClick={() => setBd(undefined)}>
            None
          </button>
          {BACKDROP_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={"btn-mini" + (bd && activePreset === p.id ? " on" : "")}
              title={`${p.label} backdrop`}
              onClick={() => setBd({ preset: p.id })}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  marginRight: 4,
                  verticalAlign: "-1px",
                  borderRadius: 2,
                  background: `linear-gradient(135deg, ${p.chip[0]}, ${p.chip[1]})`,
                }}
              />
              {p.label}
            </button>
          ))}
        </span>
      </div>
      {bd && (
        <>
          <label className="frow">
            <span>Wave bands</span>
            <input type="checkbox" checked={bd.waves !== false} onChange={(e) => setBd({ waves: e.target.checked })} />
          </label>
          {bd.waves !== false && (
            <>
              <label className="frow">
                <span>Bands</span>
                <input
                  type="number"
                  className="numin"
                  min={1}
                  max={6}
                  value={bd.waveCount ?? 3}
                  onChange={(e) => setBd({ waveCount: Number(e.target.value) })}
                />
              </label>
              <label className="frow">
                <span>Band strength</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bd.waveOpacity ?? 0.22}
                  aria-label="Backdrop band strength"
                  onChange={(e) => setBd({ waveOpacity: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          <label className="frow">
            <span>Angle</span>
            <input
              type="number"
              className="numin"
              step={15}
              value={bd.angle ?? 135}
              aria-label="Backdrop gradient angle"
              onChange={(e) => setBd({ angle: Number(e.target.value) })}
            />
          </label>
          <label className="frow">
            <span>Opacity</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={bd.opacity ?? 1}
              aria-label="Backdrop opacity"
              onChange={(e) => setBd({ opacity: Number(e.target.value) })}
            />
          </label>
          <label className="frow">
            <span>Legibility</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={bd.scrim ?? (activePreset === "aurora" ? 0.12 : activePreset === "tide" ? 0.58 : 0.62)}
              aria-label="Backdrop legibility scrim"
              onChange={(e) => setBd({ scrim: Number(e.target.value) })}
            />
          </label>
          <div className="frow">
            <span>Shape</span>
            <button type="button" className="btn-mini" onClick={() => setBd({ seed: (bd.seed ?? 1) + 1 })}>
              Reshuffle
            </button>
          </div>
          <p className="note" style={{ fontSize: 11 }}>
            Decorative — made for slides, posters and social cards. Journals generally want a plain
            background, so leave this off for a publication figure.
          </p>
        </>
      )}
    </>
  );
}

/** One-click typography homogenisation by type — push this graph's size for one
 *  role to every graph (the figure group), each role independently. */
function HomogenizePanel({ plot, onHomogenize }: { plot: Plot; onHomogenize: (element: FontElement) => void }) {
  const ROLES: { element: FontElement; label: string; def: number }[] = [
    { element: "title", label: "Titles", def: 18 },
    { element: "subtitle", label: "Subtitles", def: 13 },
    { element: "axisTitle", label: "Axis titles", def: 15 },
    { element: "tick", label: "Tick numbers", def: 13 },
    { element: "legend", label: "Legends", def: 13 },
  ];
  return (
    <>
      <p className="note" style={{ fontSize: 11 }}>
        Set this graph's size for one role across <b>every</b> graph — so all axis titles (or all ticks, …) match
        in one click.
      </p>
      {ROLES.map((r) => (
        <div className="frow" key={r.element}>
          <span>
            {r.label} <span style={{ color: "var(--muted)" }}>({plot.fonts?.[r.element]?.size ?? r.def}px)</span>
          </span>
          <button type="button" className="btn-mini" title={`Apply ${plot.fonts?.[r.element]?.size ?? r.def}px to all graphs' ${r.label.toLowerCase()}`} onClick={() => onHomogenize(r.element)}>
            Apply to all
          </button>
        </div>
      ))}
    </>
  );
}

/** Plot-wide significance-bracket formatting (label style / decimals / colour / width). */
function SignificancePanel({ plot, onSet, onAddBracket }: { plot: Plot; onSet: (patch: Partial<SignificanceStyle>) => void; onAddBracket?: (() => void) | undefined }) {
  const s = plot.significance ?? {};
  const display = s.display ?? "stars";
  const count = (plot.annotations ?? []).filter((a) => a.kind === "bracket" && a.p != null).length;
  return (
    <>
      {/* The action lives in the section, not two menus away: a button adds a bracket,
          rather than a note describing where adding happens elsewhere. */}
      {onAddBracket && (
        <div className="frow">
          <span>{count > 0 ? `${count} on this graph` : "None on this graph yet"}</span>
          <button type="button" className="btn-mini" onClick={onAddBracket}>
            Add a bracket
          </button>
        </div>
      )}
      <p className="note" style={{ fontSize: 11 }}>
        Controls how every significance bracket carrying a p-value is labelled. Click a bracket on the graph to
        pick its two groups and its p; <b>Design ▸ Significance brackets from an analysis…</b> places every
        significant comparison automatically.
      </p>
      <label className="frow">
        <span>Label</span>
        <select className="selin" value={display} onChange={(e) => onSet({ display: e.target.value as SignificanceDisplay })}>
          <option value="stars">Stars (∗ ∗∗ ∗∗∗)</option>
          <option value="numeric">Numeric (p=0.012)</option>
          <option value="threshold">Threshold (p&lt;0.05)</option>
        </select>
      </label>
      {display === "numeric" && (
        <label className="frow">
          <span>Decimals</span>
          <input
            type="number"
            className="numin"
            min={1}
            max={6}
            value={s.decimals ?? 3}
            onChange={(e) => onSet({ decimals: Math.min(6, Math.max(1, Number(e.target.value) || 3)) })}
          />
        </label>
      )}
      {display === "numeric" && (
        <label
          className="frow"
          title="Off: a very small p is reported at the cap (p<0.001), the journal-standard convention. On: it is printed exactly and typeset — p=1.2 × 10⁻⁶, never 1.2e-6."
        >
          <span>Exact small p</span>
          <input type="checkbox" checked={s.exactP ?? false} onChange={(e) => onSet({ exactP: e.target.checked || undefined })} />
        </label>
      )}
      {display !== "numeric" && (
        <label className="frow" title="Show a caption at the bottom listing the symbol → p-value cut-offs actually used">
          <span>Threshold legend</span>
          <input type="checkbox" checked={s.legend ?? false} onChange={(e) => onSet({ legend: e.target.checked || undefined })} />
        </label>
      )}
      {display !== "numeric" && s.legend && (
        <SubSection title="Legend text">
          <p className="note" style={{ fontSize: 11 }}>
            Drag the key itself on the graph to reposition it — it snaps back to centre.
          </p>
          <label className="frow" title="What goes between the entries, e.g. '* p<0.05; ** p<0.01'">
            <span>Separator</span>
            <input
              type="text"
              className="numin"
              style={{ width: 72 }}
              value={s.legendSeparator ?? "; "}
              onChange={(e) => onSet({ legendSeparator: e.target.value === "; " ? undefined : e.target.value })}
            />
          </label>
          <label className="frow">
            <span>Size</span>
            <input
              type="number"
              className="numin"
              min={6}
              max={48}
              style={{ width: 96 }}
              value={s.legendSize ?? ""}
              placeholder="legend size"
              onChange={(e) => {
                const t = e.target.value.trim();
                onSet({ legendSize: t === "" ? undefined : Math.min(48, Math.max(6, Number(t))) });
              }}
            />
          </label>
          <label className="frow">
            <span>Font</span>
            <select className="selin" value={s.legendFontFamily ?? ""} onChange={(e) => onSet({ legendFontFamily: e.target.value || undefined })}>
              {FONT_FAMILIES.map((f) => (
                <option key={f.label} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <div className="frow">
            <span>Style</span>
            <span style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11 }}>
              <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={s.legendBold ?? false} onChange={(e) => onSet({ legendBold: e.target.checked || undefined })} />
                <b>B</b>
              </label>
              <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={s.legendItalic ?? false} onChange={(e) => onSet({ legendItalic: e.target.checked || undefined })} />
                <i>I</i>
              </label>
            </span>
          </div>
          <ColourField value={s.legendColor} onSet={(c) => onSet({ legendColor: c })} label="Legend colour" />
        </SubSection>
      )}
      {display !== "numeric" && (
        <SubSection title="Thresholds">
          <ThresholdLadder
            value={s.thresholds}
            display={display}
            nsSymbol={s.nsSymbol}
            hideNs={s.hideNs}
            scope="graph"
            onChange={(thresholds) => onSet({ thresholds })}
            onChangeNs={(nsSymbol) => onSet({ nsSymbol })}
            onChangeHideNs={(hideNs) => onSet({ hideNs })}
          />
        </SubSection>
      )}
      <label className="frow">
        <span>Bracket colour</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput value={s.color ?? "#1a1a1a"} aria-label="Bracket colour" onChange={(c) => onSet({ color: c })} />
          <button type="button" className="swbtn" title="Default colour" onClick={() => onSet({ color: undefined })}>
            ⨯
          </button>
        </span>
      </label>
      <ColourSwatches value={s.color} onPick={(c) => onSet({ color: c })} />
      <label className="frow">
        <span>Bracket thickness</span>
        <input
          type="number"
          className="numin"
          min={0.5}
          max={8}
          step={0.25}
          value={s.width ?? 1.5}
          onChange={(e) => onSet({ width: Number(e.target.value) })}
        />
      </label>
      <label className="frow" title="How the bar between the two groups is drawn">
        <span>Bracket shape</span>
        <select className="selin" value={s.shape ?? "bracket"} onChange={(e) => onSet({ shape: e.target.value as BracketShape })}>
          <option value="bracket">Square (⌐¬)</option>
          <option value="rounded">Rounded</option>
          <option value="brace">Curly brace</option>
          <option value="line">Plain bar (no ends)</option>
        </select>
      </label>
      {/* Legs that reach the bars — the bar builders only (bar + histogram, and UpSet, whose intersection
          bars that builder draws: they report where each bar's ink ends; nothing else does, and there the
          builder refuses with a warning). */}
      {(plot.kind === "bar" || plot.kind === "histogram" || plot.kind === "upset") && ((s.shape ?? "bracket") === "bracket" || (s.shape ?? "bracket") === "rounded") && (
        <label className="frow" title="Equal: both legs the tick length — a flat bracket high over both bars. Reach the bars: each leg runs down to just above its own bar (its top, error bar or points), so a bracket between a tall and a short bar has a long leg on the short side.">
          <span>Legs</span>
          <select className="selin" aria-label="Bracket legs" value={s.legs ?? "equal"} onChange={(e) => onSet({ legs: e.target.value === "reach" ? "reach" : undefined })}>
            <option value="equal">Equal length</option>
            <option value="reach">Reach the bars</option>
          </select>
        </label>
      )}
      {(s.shape ?? "bracket") !== "line" && (
        <label className="frow" title="How far the bracket's ends turn back toward the data (0 = a plain bar)">
          <span>End ticks</span>
          <input
            type="number"
            className="numin"
            min={0}
            max={24}
            step={1}
            value={s.tick ?? 6}
            onChange={(e) => onSet({ tick: Math.min(24, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </label>
      )}
      <label className="frow" title="Font size of the symbol printed above the bracket">
        <span>Symbol size</span>
        <input
          type="number"
          className="numin"
          min={6}
          max={48}
          style={{ width: 96 }}
          value={s.labelSize ?? ""}
          placeholder="legend size"
          onChange={(e) => {
            const t = e.target.value.trim();
            onSet({ labelSize: t === "" ? undefined : Math.min(48, Math.max(6, Number(t))) });
          }}
        />
      </label>
      <label className="frow" title="Print the symbol in its own ink — e.g. black stars over a grey bracket">
        <span>Symbol colour</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput value={s.labelColor ?? s.color ?? "#1a1a1a"} aria-label="Symbol colour" onChange={(c) => onSet({ labelColor: c })} />
          <button type="button" className="swbtn" title="Follow the bracket colour" onClick={() => onSet({ labelColor: undefined })}>
            ⨯
          </button>
        </span>
      </label>
      <ColourSwatches value={s.labelColor} onPick={(c) => onSet({ labelColor: c })} />
    </>
  );
}

/**
 * Arrange toolbar for a multi-object selection — the Arrange tools (align edges,
 * align/centre, distribute spacing, equalise size). Operates on the freely-2-D
 * annotation kinds; reference lines / brackets / bands in the selection are ignored
 * by the engine. Each button is one undoable step via `ops.align`.
 */
function ArrangePanel({ plot, ids, ops, onSelect }: { plot: Plot; ids: NodeId[]; ops: AnnotationOps; onSelect: (sel: GraphSelection) => void }) {
  const selected = (plot.annotations ?? []).filter((a) => ids.includes(a.id));
  const arrangeable = selected.filter((a) => isArrangeableAnnotation(a.kind));
  const sizeable = arrangeable.filter((a) => a.kind === "rect" || a.kind === "highlight" || a.kind === "ellipse" || a.kind === "image");
  const nA = arrangeable.length;
  // A row of arrange buttons sharing an enable condition.
  const Row = ({ label, items, enabled }: { label: string; items: [AlignOp, string, string][]; enabled: boolean }) => (
    <div className="frow">
      <span>{label}</span>
      <span className="layseg" role="group" aria-label={label}>
        {items.map(([op, glyph, title]) => (
          <button key={op} type="button" className="layseg-btn" title={title} disabled={!enabled} onClick={() => ops.align(ids, op)}>
            {glyph}
          </button>
        ))}
      </span>
    </div>
  );
  return (
    <div className="arrange-panel">
      <p className="note" style={{ marginTop: 0 }}>
        {nA} object{nA === 1 ? "" : "s"} selected{selected.length > nA ? ` (${selected.length - nA} axis-locked, skipped)` : ""}.
        Shift-click objects to add or remove.
      </p>
      <Row
        label="Align"
        enabled={nA >= 2}
        items={[
          ["left", "⇤", "Align left edges"],
          ["center-x", "⇔", "Align horizontal centres"],
          ["right", "⇥", "Align right edges"],
          ["top", "⤒", "Align top edges"],
          ["center-y", "⇕", "Align vertical centres"],
          ["bottom", "⤓", "Align bottom edges"],
        ]}
      />
      <Row
        label="Distribute"
        enabled={nA >= 3}
        items={[
          ["distribute-h", "↔", "Distribute horizontal spacing evenly"],
          ["distribute-v", "↕", "Distribute vertical spacing evenly"],
        ]}
      />
      <Row
        label="Equal size"
        enabled={sizeable.length >= 2}
        items={[
          ["equalize-w", "W", "Make the same width (boxes/ellipses)"],
          ["equalize-h", "H", "Make the same height (boxes/ellipses)"],
        ]}
      />
      <div className="frow">
        <span>Group</span>
        <span className="layseg" role="group" aria-label="Group and lock">
          <button type="button" className="layseg-btn" title="Group — the objects move together when one is dragged" disabled={nA < 2} onClick={() => ops.group(ids)}>
            Group
          </button>
          <button type="button" className="layseg-btn" title="Ungroup the selected object(s)" disabled={!arrangeable.some((a) => a.group !== undefined)} onClick={() => ops.ungroup(ids)}>
            Ungroup
          </button>
          {(() => {
            const allLocked = selected.length > 0 && selected.every((a) => a.locked);
            return (
              <button type="button" className="layseg-btn" title={allLocked ? "Unlock — allow dragging again" : "Lock — protect against dragging (style edits still work)"} disabled={selected.length < 1} onClick={() => ops.setLocked(ids, !allLocked)}>
                {allLocked ? "Unlock" : "Lock"}
              </button>
            );
          })()}
        </span>
      </div>
      <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
        ← Back to graph
      </button>
    </div>
  );
}

/** The per-link override maps on NetworkStyle, and the value type each one holds. */
type EdgeMapKey = "edgeColors" | "edgeWidths" | "edgeOpacities";
type EdgeMapVal<K extends EdgeMapKey> = K extends "edgeColors" ? string : number;

/**
 * Editor for one network link (edge), reached by clicking it on the graph.
 *
 * A link is the one network element with two equally-wanted edit scopes: make this link
 * stand out, or set the look of every link from the one you clicked. So the scope is an
 * explicit toggle rather than a silent default:
 *   • "This link" → per-edge overrides (`network.edgeColors/edgeWidths/edgeOpacities`),
 *     keyed by `networkEdgeKey` so they survive a re-layout.
 *   • "All links"  → the shared `network.edgeColor/edgeWidth/edgeOpacity`.
 * Per-link overrides win over the shared style, so the panel says so when any exist.
 */
function NetworkEdgePanel({
  plot,
  edgeId,
  onSetPlotOptions,
  onSelect,
}: {
  plot: Plot;
  edgeId: string;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  onSelect: (sel: GraphSelection) => void;
}) {
  const [scope, setScope] = useState<"one" | "all">("one");
  const nw = plot.network ?? {};
  const setNw = (patch: Partial<NetworkStyle>): void => onSetPlotOptions({ network: { ...nw, ...patch } });
  /** This link's entry in one override map, set or dropped. Returns the whole map (undefined
   *  when it empties) — a patch value, never a write, so several can go in one patch. The
   *  value type follows the key, so passing `undefined` can't collapse it to Record<string,
   *  undefined>. */
  const withOne = <K extends EdgeMapKey>(key: K, v: EdgeMapVal<K> | undefined): Record<string, EdgeMapVal<K>> | undefined => {
    const next = { ...((nw[key] ?? {}) as Record<string, EdgeMapVal<K>>) };
    if (v === undefined) delete next[edgeId];
    else next[edgeId] = v;
    return Object.keys(next).length ? next : undefined;
  };
  const setOne = <K extends EdgeMapKey>(key: K, v: EdgeMapVal<K> | undefined): void =>
    setNw({ [key]: withOne(key, v) } as Partial<NetworkStyle>);
  const sharedColor = nw.edgeColor ?? "#5b6470";
  const sharedWidth = nw.edgeWidth ?? 1;
  const sharedOpacity = nw.edgeOpacity ?? 0.5;
  const oneColor = nw.edgeColors?.[edgeId];
  const oneWidth = nw.edgeWidths?.[edgeId];
  const oneOpacity = nw.edgeOpacities?.[edgeId];
  const all = scope === "all";
  // What the controls show: the effective value for the active scope.
  const color = all ? sharedColor : oneColor ?? sharedColor;
  const width = all ? sharedWidth : oneWidth ?? sharedWidth;
  const opacity = all ? sharedOpacity : oneOpacity ?? sharedOpacity;
  const setColor = (c: string | undefined): void => (all ? setNw({ edgeColor: c }) : setOne("edgeColors", c));
  const setWidth = (w: number | undefined): void => (all ? setNw({ edgeWidth: w }) : setOne("edgeWidths", w));
  const setOpacity = (o: number | undefined): void => (all ? setNw({ edgeOpacity: o }) : setOne("edgeOpacities", o));
  const overrides = Object.keys(nw.edgeColors ?? {}).length + Object.keys(nw.edgeWidths ?? {}).length + Object.keys(nw.edgeOpacities ?? {}).length;
  const tuned = oneColor !== undefined || oneWidth !== undefined || oneOpacity !== undefined;
  const [from, to] = edgeId.split("→");
  return (
    <>
      <div className="insphd">{from} → {to}</div>
      <div className="frow">
        <span>Apply to</span>
        <span className="layseg" role="group" aria-label="Link style scope">
          <button type="button" className={"layseg-btn" + (all ? "" : " on")} aria-pressed={!all} title="Style only the link you clicked" onClick={() => setScope("one")}>
            This link
          </button>
          <button type="button" className={"layseg-btn" + (all ? " on" : "")} aria-pressed={all} title="Style every link in the graph" onClick={() => setScope("all")}>
            All links
          </button>
        </span>
      </div>
      <label className="frow">
        <span>Link colour</span>
        <ColorInput className="colorin" value={color} aria-label="Link colour" onChange={(c) => setColor(c)} />
      </label>
      <ColourSwatches value={all ? nw.edgeColor : oneColor} onPick={(c) => setColor(c)} />
      <label className="frow">
        <span>Thickness</span>
        <input
          type="number"
          className="numin"
          aria-label="Link thickness"
          value={width}
          min={0.25}
          max={20}
          step={0.25}
          onChange={(e) => setWidth(e.target.value.trim() === "" ? undefined : Number(e.target.value))}
        />
      </label>
      <label className="frow">
        <span>Opacity</span>
        <input
          type="range"
          aria-label="Link opacity"
          value={opacity}
          min={0.05}
          max={1}
          step={0.05}
          onChange={(e) => setOpacity(Number(e.target.value))}
        />
      </label>
      {!all && tuned && (
        <label className="frow" style={{ marginTop: 6 }}>
          <span>This link</span>
          <button
            type="button"
            className="swbtn"
            title="Clear this link's overrides (back to the shared link style)"
            // one patch: three sequential setOne calls would each rebuild from the same
            // stale `nw`, so the last would resurrect the overrides the first two dropped.
            onClick={() => setNw({ edgeColors: withOne("edgeColors", undefined), edgeWidths: withOne("edgeWidths", undefined), edgeOpacities: withOne("edgeOpacities", undefined) })}
          >
            Reset
          </button>
        </label>
      )}
      <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
        {all
          ? "Styling every link in the graph."
          : "Styling only this link. A hand-set thickness is the drawn width, so this link stops scaling with its weight."}
        {overrides > 0 && all ? " Links you styled individually keep their own look until you reset them." : ""}
      </p>
      <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
        ← Back to graph
      </button>
    </>
  );
}

/** The per-node override maps on NetworkStyle, and the value type each one holds. */
type NodeMapKey = "nodeColors" | "nodeTwoTones" | "nodeStrokes" | "nodeStrokeWidths" | "nodeSizes";
type NodeMapVal<K extends NodeMapKey> = K extends "nodeStrokeWidths" | "nodeSizes"
  ? number
  : K extends "nodeTwoTones"
    ? boolean
    : string;

/**
 * Editor for one network node, reached by clicking it on the graph — the node twin of
 * `NetworkEdgePanel`, with the same explicit scope toggle:
 *   • "This node" → per-node overrides (`nodeColors` / `nodeTwoTones` / `nodeStrokes` /
 *     `nodeStrokeWidths` / `nodeSizes`), keyed by node id so they survive a re-layout.
 *   • "All nodes" → the shared `nodeColor` / `nodeTwoTone` / `nodeStroke` / `nodeStrokeWidth`
 *     / `nodeSize`.
 * Per-node overrides win over the shared style. On a value-coloured graph the ramp wins
 * over the shared fill (so "All nodes" fill paints only value-less nodes) but never over a
 * per-node fill — the notes below say so.
 */
function NetworkNodePanel({
  plot,
  nodeId,
  onSetPlotOptions,
  onSelect,
}: {
  plot: Plot;
  nodeId: string;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  onSelect: (sel: GraphSelection) => void;
}) {
  const [scope, setScope] = useState<"one" | "all">("one");
  const nw = plot.network ?? {};
  const setNw = (patch: Partial<NetworkStyle>): void => onSetPlotOptions({ network: { ...nw, ...patch } });
  /** This node's entry in one override map, set or dropped — a patch value (same contract
   *  as the link panel's `withOne`), so the Reset below can drop five maps in one patch. */
  const withOne = <K extends NodeMapKey>(key: K, v: NodeMapVal<K> | undefined): Record<string, NodeMapVal<K>> | undefined => {
    const next = { ...((nw[key] ?? {}) as Record<string, NodeMapVal<K>>) };
    if (v === undefined) delete next[nodeId];
    else next[nodeId] = v;
    return Object.keys(next).length ? next : undefined;
  };
  const setOne = <K extends NodeMapKey>(key: K, v: NodeMapVal<K> | undefined): void =>
    setNw({ [key]: withOne(key, v) } as Partial<NetworkStyle>);
  const all = scope === "all";
  const name = nw.nodeLabels?.[nodeId] ?? nodeId;
  const oneFill = nw.nodeColors?.[nodeId];
  // What the controls show: the effective value for the active scope (the shared fill
  // default mirrors the builder's; on a valued graph the drawn fill may be the ramp's).
  const fill = (all ? undefined : oneFill) ?? nw.nodeColor ?? "#0072B2";
  // Note: two-tone is on by default — mirror `buildNetworkScene`'s `?? true` (it matches the
  // marker look). A `?? false` here would show the box unchecked while every node is drawn two-tone.
  const twoTone = all ? nw.nodeTwoTone ?? true : nw.nodeTwoTones?.[nodeId] ?? nw.nodeTwoTone ?? true;
  const stroke = all ? nw.nodeStroke : nw.nodeStrokes?.[nodeId] ?? nw.nodeStroke;
  const strokeW = (all ? undefined : nw.nodeStrokeWidths?.[nodeId]) ?? nw.nodeStrokeWidth ?? 1;
  const oneSize = nw.nodeSizes?.[nodeId];
  const setFill = (c: string | undefined): void => (all ? setNw({ nodeColor: c }) : setOne("nodeColors", c));
  // Store the boolean as is: `on || undefined` would turn "off" into "unset", which the builder
  // resolves back to the "on" default — so two-tone could never be switched off. Clearing back
  // to inherit is what the "Reset" button is for.
  const setTwoTone = (on: boolean): void => (all ? setNw({ nodeTwoTone: on }) : setOne("nodeTwoTones", on));
  const setStroke = (c: string | undefined): void => (all ? setNw({ nodeStroke: c }) : setOne("nodeStrokes", c));
  const setStrokeW = (v: number | undefined): void => (all ? setNw({ nodeStrokeWidth: v }) : setOne("nodeStrokeWidths", v));
  const tuned =
    oneFill !== undefined ||
    nw.nodeTwoTones?.[nodeId] !== undefined ||
    nw.nodeStrokes?.[nodeId] !== undefined ||
    nw.nodeStrokeWidths?.[nodeId] !== undefined ||
    oneSize !== undefined;
  const autoPlace = (): void => {
    if (!nw.nodePositions?.[nodeId]) return;
    const next = { ...nw.nodePositions };
    delete next[nodeId];
    setNw({ nodePositions: Object.keys(next).length ? next : undefined });
  };
  return (
    <>
      <div className="insphd">{name}</div>
      <div className="frow">
        <span>Apply to</span>
        <span className="layseg" role="group" aria-label="Node style scope">
          <button type="button" className={"layseg-btn" + (all ? "" : " on")} aria-pressed={!all} title="Style only the node you clicked" onClick={() => setScope("one")}>
            This node
          </button>
          <button type="button" className={"layseg-btn" + (all ? " on" : "")} aria-pressed={all} title="Style every node in the graph" onClick={() => setScope("all")}>
            All nodes
          </button>
        </span>
      </div>
      <label className="frow">
        <span>Fill</span>
        <ColorInput className="colorin" value={fill} aria-label="Node fill colour" onChange={(c) => setFill(c)} />
      </label>
      <ColourSwatches value={all ? nw.nodeColor : oneFill} onPick={(c) => setFill(c)} />
      <label className="frow" title="Two-tone fill — draw the node's outline as a darker shade of its fill colour (outline darker than the inner fill).">
        <span>Two-tone</span>
        <input type="checkbox" aria-label="Two-tone node (darker outline)" checked={twoTone} onChange={(e) => setTwoTone(e.target.checked)} />
      </label>
      <label className="frow" title="Outline colour. ⨯ returns to the theme background ring.">
        <span>Outline</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput className="colorin" value={stroke ?? "#ffffff"} aria-label="Node outline colour" onChange={(c) => setStroke(c)} />
          <button type="button" className="swbtn" title="Theme outline (clear the override)" onClick={() => setStroke(undefined)}>⨯</button>
        </span>
      </label>
      <label className="frow">
        <span>Outline width</span>
        <input
          type="number"
          className="numin"
          aria-label="Node outline width"
          min={0}
          max={10}
          step={0.25}
          value={strokeW}
          onChange={(e) => setStrokeW(e.target.value.trim() === "" ? undefined : Number(e.target.value))}
        />
      </label>
      {all ? (
        <label className="frow" title="Base radius for every node (Size by degree still scales automatic nodes).">
          <span>Size</span>
          <input type="range" min={2} max={16} step={0.5} value={nw.nodeSize ?? 6} onChange={(e) => setNw({ nodeSize: Number(e.target.value) })} />
        </label>
      ) : (
        <label className="frow" title="Radius of this node, px. A hand-set size is the drawn radius, so this node stops scaling with its degree. Blank = automatic.">
          <span>Size</span>
          <input
            type="number"
            className="numin"
            aria-label="Node size"
            min={1}
            max={40}
            step={0.5}
            value={oneSize ?? ""}
            placeholder="auto"
            onChange={(e) => setOne("nodeSizes", e.target.value.trim() === "" ? undefined : Number(e.target.value))}
          />
        </label>
      )}
      {!all && tuned && (
        <label className="frow" style={{ marginTop: 6 }}>
          <span>This node</span>
          <button
            type="button"
            className="swbtn"
            title="Clear this node's style overrides (back to the shared node style)"
            // one patch: sequential setOne calls would each rebuild from the same stale
            // `nw`, so the last would resurrect the overrides the first ones dropped.
            onClick={() =>
              setNw({
                nodeColors: withOne("nodeColors", undefined),
                nodeTwoTones: withOne("nodeTwoTones", undefined),
                nodeStrokes: withOne("nodeStrokes", undefined),
                nodeStrokeWidths: withOne("nodeStrokeWidths", undefined),
                nodeSizes: withOne("nodeSizes", undefined),
              })
            }
          >
            Reset
          </button>
        </label>
      )}
      {nw.nodePositions?.[nodeId] && (
        <label className="frow">
          <span>Position</span>
          <button type="button" className="swbtn" title="Return this node to the automatic layout" onClick={autoPlace}>Auto-place</button>
        </label>
      )}
      <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
        {all
          ? "Styling every node. On a value-coloured graph the ramp keeps painting valued nodes — set Low/High in the Network graph panel. Nodes you styled individually keep their own look until you reset them."
          : "Styling only this node — its fill wins over the value ramp. Drag the node to move it; double-click its label to rename it."}
      </p>
      <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
        ← Back to graph
      </button>
    </>
  );
}

/** Annotation list editor — reference lines (value/dash) + text boxes (text/position/size). */
function AnnotationsPanel({ plot, table, ops, seriesNames, onSetPlotOptions }: { plot: Plot; table?: DataTable | undefined; ops: AnnotationOps; seriesNames?: string[] | undefined; onSetPlotOptions?: ((patch: Partial<Plot>) => void) | undefined }) {
  const list = plot.annotations ?? [];
  // A zone key is offered only once there is something to key: at least one zone band carries a
  // caption (no labelled bands ⇒ the key would be empty, so the control is a dead end). Each
  // labelled band becomes one keyed row; its on/off + corner lives here, its rows on the bands.
  const hasLabelledBand = list.some((a) => (a.kind === "hband" || a.kind === "vband") && (a.label ?? "").trim() !== "");
  return (
    <>
      <div className="frow">
        <span>Add</span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn-mini" onClick={() => ops.add({ kind: "hline", value: 0, dash: "dashed" })}>
            H-line
          </button>
          <button type="button" className="btn-mini" onClick={() => ops.add({ kind: "vline", value: 0, dash: "dashed" })}>
            V-line
          </button>
          <button type="button" className="btn-mini" onClick={() => ops.add({ kind: "text", label: "Text", x: 0.5, y: 0.12 })}>
            Text
          </button>
          {/* Same rule as the Significance brackets section. Offering "Add bracket" on a chart
              with no groups creates one that spans two data values and compares nothing — and
              leaves the user holding an object whose styling section is deliberately hidden. */}
          {BRACKET_KINDS.has(plot.kind ?? "xy") && (
          <button type="button" className="btn-mini" onClick={() => ops.add({ kind: "bracket", from: 1, to: 2, label: "*" })}>
            Bracket
          </button>
          )}
        </span>
      </div>
      <div className="frow">
        <span>Draw</span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="btn-mini" title="Rectangle / box" onClick={() => ops.add({ kind: "rect", x: 0.34, y: 0.3, w: 0.26, h: 0.2 })}>
            Box
          </button>
          <button type="button" className="btn-mini" title="Highlight box (bold outline + faint tint over a region)" onClick={() => ops.add({ kind: "highlight", x: 0.34, y: 0.3, w: 0.26, h: 0.2 })}>
            Highlight
          </button>
          <button type="button" className="btn-mini" title="Ellipse" onClick={() => ops.add({ kind: "ellipse", x: 0.34, y: 0.3, w: 0.26, h: 0.2 })}>
            Ellipse
          </button>
          <button type="button" className="btn-mini" title="Arrow" onClick={() => ops.add({ kind: "arrow", x: 0.3, y: 0.55, x2: 0.6, y2: 0.35, arrowHead: "end" })}>
            Arrow
          </button>
          <button type="button" className="btn-mini" title="Line segment" onClick={() => ops.add({ kind: "segment", x: 0.3, y: 0.5, x2: 0.6, y2: 0.5 })}>
            Line
          </button>
          <button type="button" className="btn-mini" title="Callout (text + arrow)" onClick={() => ops.add({ kind: "callout", label: "Note", x: 0.2, y: 0.2, x2: 0.5, y2: 0.5, arrowHead: "end" })}>
            Callout
          </button>
          <button type="button" className="btn-mini" title="Insert an image (PNG / JPG / SVG) onto the graph" onClick={() => ops.addImage()}>
            Image…
          </button>
        </span>
      </div>
      {hasLabelledBand && onSetPlotOptions && (
        <label className="frow" title="Show a key for the shaded zone bands in a plot corner. Each band that has a caption becomes one row (its fill + its label); the caption then shows only in the key.">
          <span>Zone key</span>
          <select
            className="numin"
            aria-label="Zone key"
            value={plot.zoneLegend ?? "off"}
            onChange={(e) => onSetPlotOptions({ zoneLegend: e.target.value === "off" ? undefined : (e.target.value as NonNullable<Plot["zoneLegend"]>) })}
          >
            <option value="off">Off</option>
            <option value="topleft">Top-left</option>
            <option value="topright">Top-right</option>
            <option value="bottomleft">Bottom-left</option>
            <option value="bottomright">Bottom-right</option>
          </select>
        </label>
      )}
      {list.length === 0 && (
        <p className="note" style={{ fontSize: 11 }}>
          Reference lines mark a value on an axis; text boxes float over the plot; brackets show significance
          between two groups. V-lines apply to XY graphs.
        </p>
      )}
      <p className="note" style={{ fontSize: 11 }}>
        Tip: click an annotation on the graph to edit it on its own.
      </p>
      {list.map((a) => (
        <AnnotationEditor key={a.id} a={a} ops={ops} plot={plot} table={table} seriesNames={seriesNames} />
      ))}
    </>
  );
}

/** Per-element typography editor (family / size / bold / italic / colour). Live + undoable. */
function FontControls({
  label,
  element,
  spec,
  defaultSize,
  onSetPlotFont,
  onSet,
  hideSize,
}: {
  label: string;
  element: FontElement;
  spec: FontSpec | undefined;
  defaultSize: number;
  onSetPlotFont: SetPlotFont;
  /** Override sink — when given, edits route here instead of `onSetPlotFont(element, …)` (per-axis title fonts). */
  onSet?: (patch: Partial<FontSpec>) => void;
  /** Hide the Size row when the size is owned by a different control (network node labels are
   *  sized by `network.labelSize`). Showing it there would be misleading: it re-lays the figure
   *  without changing the text it claims to size. */
  hideSize?: boolean | undefined;
}) {
  const s = spec ?? {};
  const set = (patch: Partial<FontSpec>): void => (onSet ? onSet(patch) : onSetPlotFont(element, patch));
  return (
    <>
      <div className="inspsub">{label}</div>
      <label className="frow">
        <span>Font</span>
        <select className="selin" value={s.family ?? ""} onChange={(e) => set({ family: e.target.value || undefined })}>
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {!hideSize && (
      <label className="frow">
        <span>Size</span>
        <input
          type="number"
          className="numin"
          min={4}
          max={96}
          value={s.size ?? ""}
          placeholder={String(defaultSize)}
          onChange={(e) => {
            const t = e.target.value.trim();
            set({ size: t === "" ? undefined : Number(t) });
          }}
        />
      </label>
      )}
      <label className="frow">
        <span>Style</span>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: 700 }}>
            <input type="checkbox" checked={s.bold ?? false} onChange={(e) => set({ bold: e.target.checked || undefined })} /> B
          </label>
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontStyle: "italic" }}>
            <input type="checkbox" checked={s.italic ?? false} onChange={(e) => set({ italic: e.target.checked || undefined })} /> I
          </label>
        </span>
      </label>
      <label className="frow">
        <span>Colour</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <ColorInput value={s.color ?? "#1a1a1a"} aria-label={`${label} colour`} onChange={(c) => set({ color: c })} />
          <button type="button" className="swbtn" title="Default colour" aria-label={`${label} default colour`} onClick={() => set({ color: undefined })}>
            ⨯
          </button>
        </span>
      </label>
      <ColourSwatches value={s.color} onPick={(c) => set({ color: c })} />
    </>
  );
}

/** The colour a series is drawn in, for ids the table knows nothing about (`dendro-0`, `scree-cum`,
 *  `pca-g1`, `roc-0`). Returns undefined rather than throwing — a panel must never take the figure
 *  down with it. */
function sceneColorOf(table: DataTable, plot: Plot, seriesId: string): string | undefined {
  try {
    return buildPlotScene(table, plot, { width: 620, height: 420 }).series.find((x) => x.id === seriesId)?.color;
  } catch {
    return undefined;
  }
}

/**
 * Does the drawing carry an error bar for this series once one is asked for?
 *
 * The reliable test, needed because `drawableErrorTypes(ds)` alone is not enough.
 * `drawableErrorTypes(ds)` asks whether a row carries replicates or an entered spread — exactly
 * right for a grouped bar or an XY point, and wrong for a column-format chart that pools its rows
 * instead: a column bar's mean ± SD comes from the five values down the column, and that dataset
 * declares no drawable type at all. Gating the Error bars section on it alone would hide a working
 * control (guarded by `dead-panel-sections.test.tsx`, which asks the other direction:
 * a section not offered must be one the drawing cannot use either).
 *
 * It compares the whole scene, not `scene.series.find(id)`. Three kinds draw their figure
 * from components whose series ids are not the panel's column (a lollipop's scene carries no
 * series at all), so a lookup by id would fall through to "cannot tell → leave the control" and
 * keep dead sections on screen. A fourth, estimation, draws its whisker from a bootstrap CI
 * whether the control says "sd" or "none" — the reach is real and the control does nothing, which
 * only a before/after comparison can tell apart from a control that works.
 *
 * Costs two scene builds, and only in the case where the dataset declares nothing.
 */
function errorBarsReachDrawing(table: DataTable, plot: Plot, seriesId: string): boolean {
  /**
   * The whole scene, minus its warnings.
   *
   * Not `marks[].errLow/errHigh`: every kind carries its interval in its own shape. A
   * lollipop's opt-in whisker lives on its own dot objects and its scene has no `series` at all,
   * so reading the mark fields would report "no whisker here" for a kind that draws one — and
   * refuse a live control. The scene is the one thing every builder writes into.
   *
   * `warnings` must be removed. Asking for an interval the data cannot supply makes the
   * builder say so (`warnUndrawableError`), so a scene carrying only that warning "differs" —
   * which would read every dead control as live, on exactly the charts this gate is for.
   */
  const reaches = (errorBars: string): string => {
    const scene = buildPlotScene(
      table,
      { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [seriesId]: { ...(plot.seriesStyles?.[seriesId] ?? {}), errorBars } } } as Plot,
      { width: 620, height: 420 },
    );
    return JSON.stringify({ ...scene, warnings: [] });
  };
  try {
    return reaches("sd") !== reaches("none");
  } catch {
    return true; // a panel must never take a control away because a probe threw
  }
}

/**
 * Second-level tabs for the graph (background) panel — the panel has many sections,
 * so they are grouped into a handful of categories.
 * Each tab owns the sections whose title contains one of its `titles` substrings;
 * a tab only hides the others, so every section keeps its place and behaviour. Sections
 * that match no tab fall under "Chart" so nothing is ever orphaned.
 */
export const PLOT_TABS: { id: string; label: string; titles: string[] }[] = [
  { id: "chart", label: "Chart", titles: ["Series", "Chart type", "Colour scheme", "Pie chart", "Heatmap"] },
  { id: "frame", label: "Frame", titles: ["Graph size", "Plot margins", "Grid, frame", "Background"] },
  { id: "text", label: "Text", titles: ["Title &"] },
  { id: "annotate", label: "Annotate", titles: ["Annotations", "Significance", "Confidence ellipse", "Fitted curve", "Bubble size"] },
  { id: "style", label: "Style", titles: ["Style preset", "Homogenise"] },
];
const PLOT_TAB_IDS = new Set(PLOT_TABS.map((t) => t.id));
/** Which tab owns a section title (default: "chart" so nothing is orphaned). */
export function tabForSection(title: string): string {
  for (const t of PLOT_TABS) if (t.id !== "chart" && t.titles.some((x) => title.includes(x))) return t.id;
  return "chart";
}

/**
 * The seven rail tabs, as data.
 *
 * Module scope rather than inside the component because the manual's function index enumerates
 * them, and the `hint` is already the one-line answer to "what is this tab for" — the same
 * sentence the user gets as a tooltip. Two copies of that sentence would drift.
 *
 * The component filters "axis" out for a chart that has no axes (`hasAxes`); the index keeps it,
 * because the index describes what the program can do, not what this graph offers right now.
 */
export const INSPECTOR_TABS: { id: string; label: string; hint: string }[] = [
  { id: "chart", label: "Chart", hint: "The chart type itself — how the data is drawn, and the options belonging to this kind of graph" },
  { id: "frame", label: "Frame", hint: "Everything around the plot: graph size, margins, gridlines, the frame and the legend" },
  { id: "axis", label: "Axis", hint: "Range, scale, ticks, gridlines and breaks for the selected axis" },
  { id: "data", label: "Data", hint: "How the data marks look — colours, symbols, lines, fills and error bars. Click a bar, point or line first to edit just that one" },
  { id: "text", label: "Text", hint: "Titles, axis titles, tick labels and legend text — fonts, sizes and colours" },
  { id: "annotate", label: "Annotate", hint: "Things drawn on top of the chart: text, arrows, shapes, reference lines and significance brackets" },
  { id: "style", label: "Style", hint: "Apply a preset to the whole graph, save the current look as your own (with this graph type's own settings), and export or import presets" },
];

/**
 * Every collapsible section in the graph panel, by title — the unit the manual indexes the
 * Inspector at (per section, with the rows named in the chapter's prose).
 * `tabForSection` says which tab each one appears under, so this list plus that function is the
 * whole map from "where is X" to a tab and a heading.
 *
 * Note: hand-kept, and `guideIndex.test.ts` reads every `<Section title="…">` out of this file and
 * refuses a mismatch in either direction — a section added to the JSX and not here is a control
 * the manual cannot point at.
 */
export const INSPECTOR_SECTIONS: string[] = [
  "Series",
  "Chart type",
  "Colour scheme",
  "Style preset",
  "Graph size",
  "Plot margins",
  "Pie chart",
  "Survival (Kaplan-Meier)",
  "3-D scatter",
  "Radar chart",
  "Parallel coordinates",
  "Colour bar (legend)",
  "Fit parameters",
  "Image",
  "Treemap",
  "Correlation matrix",
  "Alluvial / parallel sets",
  "Network graph",
  "Heatmap",
  "Grid, frame & axes",
  "Background",
  "Title & legend",
  "Annotations",
  "Significance brackets",
  "Confidence ellipse",
  "Fitted curve",
  "Bubble size legend",
  "Homogenise type across graphs",
];

/**
 * The Axis tab's groups. It has no `<Section>`s of its own — the axis editor is one panel of
 * `<SubSection>`s — so the index needs them named here, or "where is axis tuning" has nothing
 * to answer with. Same default-deny gate as the sections above.
 */
export const AXIS_GROUPS: string[] = [
  "Scale",
  "Range",
  "Ticks",
  "Numbering",
  "Fonts",
  "Axis length",
  "Axis line",
  "Spacing",
  "Category groups",
  "Category labels",
  "Breaks (cuts)",
  "Custom ticks",
  "Shaded bands",
  "Series on this axis",
];

/**
 * Inspector — the right dock. Its Format tab is driven by the graph selection:
 * click an axis or a series on the graph and edit its real props here
 * (live + undoable). Mirrors the on-canvas editing surface.
 */
/** What the Inspector needs to tell the user a graph is a small graph. */
export interface SmallGraphNotice {
  /** The original's name; null when the original has been deleted. */
  originalName: string | null;
  seriesName: string;
  onOpenOriginal: () => void;
  onDetach: () => void;
}

/** A small graph follows its original: only positions and sizes are its own. Said up front, so
 *  a refused change is never a surprise — with the two ways out. */
export function SmallGraphNoticeBox({ originalName, seriesName, onOpenOriginal, onDetach }: SmallGraphNotice) {
  return (
    <div className="importnotice smallgraph-notice" role="note">
      <div>
        {originalName === null ? (
          <>This small graph shows the series <b>{seriesName}</b>. Its original graph was deleted, so it no longer follows it.</>
        ) : (
          <>
            This small graph shows the series <b>{seriesName}</b> of <b>{originalName}</b>. It follows the original:
            only positions and sizes (moved labels, legend, title, graph size) can be changed here. Make other changes
            on the original, or detach this graph to edit it on its own.
          </>
        )}
        <div className="smallgraph-actions">
          {originalName !== null && <button type="button" onClick={onOpenOriginal}>Open original</button>}
          <button type="button" onClick={onDetach}>Detach</button>
        </div>
      </div>
    </div>
  );
}

export function Inspector({
  figureFit,
  activeSection,
  selection,
  onSelect,
  wholeGraph = false,
  onSetWholeGraph = () => {},
  barWidthWhole,
  onSetBarWidthWhole,
  plot,
  table,
  foreignSeries,
  otherTables,
  onSetAxis,
  onSetAxisLength,
  onSetAxisTitleFont,
  onSetSeriesStyle,
  onSetSeriesStyleAll,
  onSetPointStyle,
  onClearPointStyles,
  onSetGrid,
  onSetFrame,
  onSetKind,
  onSetBarLayout,
  onSetBarShape,
  onSetBoxWhisker,
  onSetPlotOptions,
  onSetGraphTitle,
  onSetPlotFont,
  onHomogenizeFont,
  onSetLegend,
  onSetSignificance,
  onApplyPreset,
  userPresets,
  onApplyUserPreset,
  onSaveUserPreset,
  onAddPresetKind,
  onDeleteUserPreset,
  onRenameUserPreset,
  onDuplicateUserPreset,
  onRemovePresetKind,
  onReorderUserPresets,
  profileDefault,
  onSetProfileDefault,
  onUserLibraryImported,
  gradients = [],
  gradientOps,
  annotationOps,
  statsOverlay,
  equationOverlay,
  assistant,
  docVersion,
  smallGraph,
  figureSlot,
}: {
  /** Size an unsized figure is drawn at (the startup fit); null = the renderer default. */
  figureFit?: { width: number; height: number } | null | undefined;
  activeSection: Section;
  selection: GraphSelection;
  onSelect: (sel: GraphSelection) => void;
  /** Bulk-apply scope ("Apply to whole graph"), owned by AppShell so that canvas gestures —
   *  which never reach this component — can honour it too. Optional: without it the
   *  Inspector takes the default (off) path. */
  wholeGraph?: boolean;
  onSetWholeGraph?: (v: boolean) => void;
  /** Bar width's own "whole graph" box (Data tab), owned by AppShell because the bar-edge drag honours it. Optional:
   *  without it the panel keeps its own, ticked to start. */
  barWidthWhole?: boolean | undefined;
  onSetBarWidthWhole?: ((v: boolean) => void) | undefined;
  plot: Plot | undefined;
  /** The plot's table with its overlays joined in (AppShell resolves `plot.overlays`), so every
   *  dataset-keyed panel below sees a borrowed series exactly like a local one. */
  table: DataTable | undefined;
  /** Borrowed series (`plot.overlays`): column id → the sheet it came from, for the row chip. */
  foreignSeries?: Record<NodeId, string> | undefined;
  /** The project's other datasheets, for "Add series from another datasheet" (composite graphs). */
  otherTables?: DataTable[] | undefined;
  onSetAxis: (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;
  onSetAxisLength: (axis: "x" | "y", length: number | null) => void;
  onSetAxisTitleFont: (axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>) => void;
  onSetSeriesStyle: (columnId: NodeId, delta: SeriesStyle) => void;
  onSetSeriesStyleAll: (columnIds: NodeId[], delta: SeriesStyle, coalesceTag?: string) => void;
  onSetPointStyle: (columnId: NodeId, rowId: NodeId, delta: SeriesStyle) => void;
  onClearPointStyles: (columnId: NodeId) => void;
  onSetGrid: (delta: GridStyle) => void;
  onSetFrame: (patch: FramePatch) => void;
  onSetKind: (kind: PlotKind) => void;
  onSetBarLayout: (layout: BarLayout) => void;
  onSetBarShape: (shape: BarShape) => void;
  onSetBoxWhisker: (whisker: BoxWhisker) => void;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  onSetGraphTitle: (patch: GraphTitlePatch) => void;
  onSetPlotFont: SetPlotFont;
  onHomogenizeFont: (element: FontElement) => void;
  onSetLegend: SetLegend;
  onSetSignificance: SetSignificance;
  onApplyPreset: (preset: StylePreset) => void;
  userPresets: UserPreset[];
  onApplyUserPreset: (preset: UserPreset) => void;
  /** `includeKind`: also save the open graph's type-specific settings as a section of the preset. */
  onSaveUserPreset: (name: string, includeKind: boolean) => UserPreset | null;
  /** "+ type" on a saved preset's card: add the open graph's type-specific settings to it. */
  onAddPresetKind?: ((id: NodeId) => void) | undefined;
  onDeleteUserPreset: (id: NodeId) => void;
  /** Preset management: rename, duplicate (returns a refusal to show, or null), drop a type's section, reorder. */
  onRenameUserPreset?: ((id: NodeId, name: string) => void) | undefined;
  onDuplicateUserPreset?: ((id: NodeId) => string | null) | undefined;
  onRemovePresetKind?: ((id: NodeId, kind: PlotKind) => void) | undefined;
  onReorderUserPresets?: ((ids: string[]) => void) | undefined;
  profileDefault: ProfileDefault;
  onSetProfileDefault: (d: ProfileDefault) => void;
  onUserLibraryImported?: (() => void) | undefined;
  /** The project's user-built colour ramps — every ramp picker lists them, and a `custom:<id>`
   *  chosen here resolves through them when the scene is built. */
  gradients?: Gradient[] | undefined;
  /** Save / delete a gradient, and mint an id for a new one. Absent in the many test renders
   *  that never touch colours: the pickers then offer the built-ins only. */
  gradientOps?: {
    save: (g: Gradient) => void;
    remove: (id: string) => void;
    nextId: () => string;
    /** Graph names still painting with a gradient — Delete is refused while any remain. */
    usedBy: (id: string) => string[];
  } | undefined;
  annotationOps: AnnotationOps;
  /** Graph-level "show key stats" toggle (driven by an analysis of this graph's data). */
  statsOverlay?: { available: boolean; on: boolean; onToggle: (on: boolean) => void } | undefined;
  equationOverlay?: { available: boolean; on: boolean; onToggle: (on: boolean) => void } | undefined;
  /** Context-aware next-step nudge: the top suggestion + run/dismiss. */
  assistant?: { suggestion: Suggestion | null; onRun: (suggestion: Suggestion) => void; onDismiss: (id: string) => void } | undefined;
  /** The document's edit counter. The datasheet and graph objects are edited in place, so a list
   *  memoised on them alone keeps the data from before an edit (an undo, a redo, a cell). */
  docVersion?: number | undefined;
  /** Set when this graph is a small graph (Graph ▸ Split into small graphs): the notice that
   *  says where it comes from, what can be changed on it, and the two ways out. */
  smallGraph?: SmallGraphNotice | undefined;
  /**
   * A figure is open: the Inspector keeps a place at the top of its body for what is picked on the figure (a canvas
   * object's settings, a panel's X / Y / W / H). The figure page draws into it (`LayoutPaneContent`'s
   * `inspectorSlot`).
   */
  figureSlot?: ((el: HTMLDivElement | null) => void) | undefined;
}) {
  const [filter, setFilter] = useState("");
  /** The gradient editor, when open: the working copy + where its result goes back to. */
  const [gradEdit, setGradEdit] = useState<{ gradient: Gradient; apply: (ref: string) => void } | null>(null);
  const [plotCat, setPlotCat] = useState<string>(() => {
    const saved = globalThis.localStorage?.getItem("mady.plotCat");
    return saved && PLOT_TAB_IDS.has(saved) ? saved : "chart";
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasFormat = Boolean(selection && plot && table);
  const pickCat = (id: string): void => { setPlotCat(id); globalThis.localStorage?.setItem("mady.plotCat", id); };
  // The top rail unifies the graph-wide section groups (Chart/Frame/Text/Annotate/
  // Style) with the per-element editors (Axis, Data) into one navigable strip. The
  // active tab is derived from the live selection, so clicking an axis or a data
  // point on the graph automatically lights up (and shows) the matching tab.
  const plotKind = plot?.kind ?? "xy";
  // scatter3d is not in this list — its cube edges are real axes (range, scale,
  // ticks on plot.xAxis/yAxis/zAxis), served by their own smaller panel (Scatter3DAxisPanel).
  const hasAxes = !["pie", "radar"].includes(plotKind);
  // A matrix heatmap has no editable scale/tick axes, and a heatmap column isn't a
  // styleable data series (no markers / line / error bars). Those rail tabs are
  // greyed (disabled) rather than removed, on a matrix heatmap only. "Data" still
  // lights up when a cell is clicked (cells edit directly).
  const heatmapMatrix = plotKind === "heatmap" && (plot?.heatmap?.mode ?? "matrix") === "matrix";
  // A network graph is axis-less, and its scene draws no annotation layer either — both
  // rail tabs are greyed (with the reason) rather than removed, matching the heatmap
  // treatment. Data stays live: it routes to the first node (nodes are the data elements).
  /** Kinds with no cartesian axes: the Axis tab is greyed with this note instead of the full continuous panel. */
  const AXISLESS_AXIS_NOTE: Record<string, string> = {
    alluvial: "An alluvial diagram has no axes — its stages and flows are set in the Alluvial section; the stage labels are the column names.",
    chord: "A chord diagram has no axes — the ring, arcs and ribbons are set in the Chart type section.",
    corrmatrix: "A correlation matrix has no axes — the variables are its rows and columns; cell size, colours and labels live in the Correlation matrix section.",
    oncoprint: "An oncoprint has no axes — gene and sample order, colours and the percent column live in the Chart type section.",
    // not parallel coordinates: each of its vertical axes is a real, clickable axis with its own
    // panel (chart-furniture-click.test) — the tab is live there on purpose.
    sunburst: "A sunburst has no axes — the rings are the hierarchy levels; radius, labels and colours live in the Chart type section.",
    treemap: "A treemap has no axes — cell size is the value; grouping, colours and labels live in the Treemap section.",
  };
  const deadRailTabs: Record<string, string> = heatmapMatrix
    ? {
        axis: "Heatmaps have no editable axes — set the row/column labels & titles in the Heatmap section.",
        data: "A heatmap column isn't a styled data series (no markers, line, or error bars). Click a cell to edit its value.",
      }
    : plotKind === "network"
      ? {
          axis: "A network graph has no axes — layout, node spacing and labels are set in the Network graph section.",
          annotate: "Annotations and significance brackets aren't drawn on a network graph — use node/link styling and labels instead.",
        }
      : plotKind === "venn"
        ? {
            // Data stays live: clicking a disc selects its set and that panel opens there.
            axis: "A Venn diagram has no axes — sets, counts and layout live in the Venn diagram section.",
          }
        : plotKind === "ternary"
          ? {
              // Data stays live: the points are a real series, and edge titles route there.
              axis: "A ternary's three axes are its composition columns — tick labels live in the Ternary section, the triangular grid in the Frame tab's Grid section.",
            }
          : plotKind === "rose"
            ? {
                axis: "A polar histogram's axes are the compass ring and the count rings — sectors, bands and the convention live in the Polar histogram section.",
                // Data is live (a greyed Data tab would leave no way to pick the colours): a wedge is a
                // bin, not a series, so the tab opens where the wedge colour is set — Chart type ▸ Polar histogram.
              }
            : AXISLESS_AXIS_NOTE[plotKind]
              ? {
                  // These kinds draw no cartesian axes, so the full continuous Axis panel
                  // (~40 controls) would change nothing. Greyed with the sentence that says where
                  // the equivalent lives — the same treatment as heatmap and network.
                  axis: AXISLESS_AXIS_NOTE[plotKind]!,
                }
            : plotKind === "tracks"
              ? {
                  // Axis stays live: the time (X) axis and the track-name (Y) band are both
                  // real, editable axes. Data is dead — a track is a whole column, not a
                  // styled point series.
                  data: "Timeline tracks are tile strips of whole columns, not styled point series. Track heights, gaps, labels and the missing-cell colour live in the Chart type section (a numeric track's ramp rides its column's Colour-by-data ramp).",
                }
              : {};
  /**
   * The side-panel sub-tabs. Each carries a `hint` saying what lives behind it — the labels
   * are single nouns, and "Frame" vs "Chart" vs "Style" is not guessable from the word alone.
   * The hint is shown whenever the tab is enabled; a disabled tab shows the reason it is
   * disabled instead, which is the more urgent thing to say at that moment.
   */
  // From the module-level registry (the manual's index reads the same one); a chart with no
  // axes simply does not offer that tab.
  const RAIL = INSPECTOR_TABS.filter((t) => t.id !== "axis" || hasAxes);
  const isDataSel = selection?.kind === "series" || selection?.kind === "pie-slice" || selection?.kind === "venn-set" || selection?.kind === "upset-set" || selection?.kind === "treemap-cell" || selection?.kind === "network-node" || selection?.kind === "network-edge" || selection?.kind === "parallel-line" || selection?.kind === "alluvial-node" || selection?.kind === "heatmap-cell" || selection?.kind === "corr-cell";
  const derivedTab =
    selection?.kind === "axis" ? "axis"
    /**
     * A parallel-coordinates axis is an axis. Without this case, selecting one would fall
     * through to `plotCat` — the last tab used — and the rail would highlight that tab
     * while the panel shows the axis editor.
     */
    : selection?.kind === "parallel-axis" ? "axis"
    // Click a box/violin/raincloud → land on Chart, where its Whiskers (centre & spread) control
    // lives, so clicking the median/whisker surfaces that control. Colour/style
    // is one tab away on Data. Bar/scatter keep Data — their Error-bars Type control is there.
    : selection?.kind === "series" && (plot?.kind === "box" || plot?.kind === "violin" || plot?.kind === "raincloud") ? "chart"
    : isDataSel ? "data"
    : selection?.kind === "annotation" || selection?.kind === "bubble-legend" ? "annotate"
    // A reference line is chart furniture, not an annotation the user placed — and Chart is
    // where the list of them lives, so "← Back to graph" lands somewhere coherent.
    : selection?.kind === "refline" ? "chart"
    // A legend row naming a group opens the section that decides that group's appearance.
    /**
     * A pinned section opens the tab that owns it, not always Chart. Most users of this
     * selection (a volcano zone, a treemap region, a parallel group) pin Chart sections, but
     * the legend pins "Title & legend", which lives under Text with the legend's font size and
     * symbol-size slider; a fixed "chart" would light Chart while the pinned section is hidden.
     */
    : selection?.kind === "chart-section" ? tabForSection(selection.title)
    : selection?.kind === "colorbar" ? "chart" // the colour-bar controls live in the Chart → Heatmap section
    : plotCat;
  // A selection never opens a tab that is inert for this chart kind. `onRailTab` refuses a user
  // click on a dead tab, and the derived tab needs the same guard — otherwise clicking a heatmap
  // cell would land on the greyed Data pane, a read-only readout that says the controls are
  // elsewhere. Chart is never dead and owns the per-kind sections (the Heatmap panel included),
  // so it is the correct fallback.
  const activeTab = deadRailTabs[derivedTab] ? "chart" : derivedTab;
  const onRailTab = (id: string): void => {
    if (deadRailTabs[id] && activeTab !== id) return; // greyed / inert for this chart kind
    if (id === "axis") { onSelect(selection?.kind === "axis" ? selection : { kind: "axis", axis: "x" }); return; }
    if (id === "data") {
      if (isDataSel) return; // already editing a data element
      // A rose's wedges are bins: its data colour (Wedge colour) lives in Chart type ▸ Polar histogram.
      if (plotKind === "rose") { onSelect({ kind: "chart-section", title: "Chart type" }); return; }
      // A network's data elements are its nodes, not table-column series (the series
      // panel's marker/line/error controls are all inert there) — so the Data tab
      // lands on the first node's editor instead.
      if (plotKind === "network") {
        const src = table?.columns[0];
        const firstNode = src ? table.rows.map((r) => String(r.cells[src.id] ?? "").trim()).find((s) => s !== "") : undefined;
        if (firstNode) { onSelect({ kind: "network-node", nodeId: firstNode }); return; }
        onSelect({ kind: "plot" });
        pickCat("chart");
        return;
      }
      const ds = table ? tableDatasets(table)[0] : undefined;
      if (!ds) { onSelect({ kind: "plot" }); pickCat("chart"); return; }
      // A parts-of-whole pie keys slices by row id (one slice per row), so the Data-tab
      // default must pick the first drawn slice's row id, not the value-column id, which
      // the pie builder never reads (a write there would change nothing).
      const pieSliceId =
        table && table.kind === "partsofwhole"
          ? (table.rows.find((r) => Number(r.cells[ds.id]) > 0)?.id ?? table.rows[0]?.id ?? ds.id)
          : ds.id;
      onSelect(plotKind === "pie" ? { kind: "pie-slice", datasetId: pieSliceId } : { kind: "series", columnId: ds.id });
      return;
    }
    onSelect({ kind: "plot" });
    pickCat(id);
  };
  // Live "find an option" filter. Runs after every render (no deps) so it stays
  // applied as the user edits or re-selects. It only toggles the `hidden` DOM
  // property — which React never manages here — so no control logic is touched
  // and nothing can break: clearing the box restores everything verbatim.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    const q = filter.trim().toLowerCase();
    const leaves = root.querySelectorAll<HTMLElement>(".frow, .swcol");
    const wraps = root.querySelectorAll<HTMLElement>(".inspsec, .inspsub2, .inspgroup");
    if (!q) {
      root.classList.remove("filtering");
      leaves.forEach((el) => { el.hidden = false; });
      wraps.forEach((el) => { el.hidden = false; });
      // Second-level category tabs (graph panel only): show just the active tab's
      // sections. Same hidden-only mechanism as the filter — no JSX is moved.
      if (selection?.kind === "plot" || selection?.kind === "bubble-legend" || selection?.kind === "colorbar" || selection?.kind === "heatmap-cell" || selection?.kind === "heatmap-split" || selection?.kind === "heatmap-track" || selection?.kind === "chart-section") {
        // A bubble-legend click pins the Annotate tab and surfaces only the size-legend
        // editor; a colour-bar click pins the Chart tab and surfaces only the Colour bar
        // section; a heatmap cell click surfaces the Heatmap section, which owns cell
        // colours, the value scale, labels and borders — so the user lands directly on
        // the editor for the thing they clicked instead of a note pointing elsewhere.
        const isBubbleLegend = selection?.kind === "bubble-legend";
        const isColorbar = selection?.kind === "colorbar";
        // A split or a strip opens the same section a cell does — the Heatmap section owns every
        // one of them — and the panel then marks the row for the one that was clicked.
        const isHeatCell = selection?.kind === "heatmap-cell" || selection?.kind === "heatmap-split" || selection?.kind === "heatmap-track";
        // …and the same idea, named by the section rather than hard-coded per selection kind:
        // a legend row for a group (a volcano zone, a treemap region, a parallel group) opens
        // the section that owns that group's appearance.
        const pinSection = selection?.kind === "chart-section" ? selection.title : undefined;
        // A remembered category that is greyed for this chart kind (e.g. "annotate" saved on an
        // XY graph, then a network opened) must fall back exactly like the rail highlight does
        // — otherwise the rail lights "Chart" while the greyed tab's sections are shown.
        const savedCat = deadRailTabs[plotCat] ? "chart" : plotCat;
        // …and the pinned section decides its own tab (see `derivedTab` above) — the two must
        // agree, or the rail highlights one tab while the sections shown belong to another.
        const cat = isBubbleLegend ? "annotate" : isColorbar || isHeatCell ? "chart" : pinSection ? tabForSection(pinSection) : savedCat;
        root.querySelectorAll<HTMLElement>(".inspsec").forEach((sec) => {
          const t = sec.querySelector(":scope > summary")?.textContent ?? "";
          sec.hidden = isBubbleLegend
            ? !t.includes("Bubble size")
            : isColorbar ? !t.includes("Colour bar")
            : isHeatCell ? !t.includes("Heatmap")
            : pinSection ? !t.includes(pinSection)
            : tabForSection(t) !== cat;
          /**
           * Also open it. `Section` remembers its own open state (and most default to closed), so
           * a pinned section would otherwise be shown collapsed — clicking a correlation row
           * label, a treemap cell, a radar ring or a network node would land on a closed header
           * with nothing under it, which reads as "this text cannot be edited". Setting `.open`
           * fires the component's own `onToggle`, so the state stays in one place.
           */
          const pinned = isBubbleLegend || isColorbar || isHeatCell || !!pinSection;
          if (pinned && !sec.hidden && sec instanceof HTMLDetailsElement && !sec.open) sec.open = true;
        });
      }
      return;
    }
    root.classList.add("filtering");
    leaves.forEach((el) => { el.hidden = !(el.textContent ?? "").toLowerCase().includes(q); });
    // a section whose header matches stays fully open (show all its rows) — so
    // typing a group name ("axis line", "scale") surfaces the whole group.
    const headText = (el: HTMLElement): string =>
      (el.querySelector(":scope > summary, :scope > .inspsub-toggle")?.textContent ?? "").toLowerCase();
    wraps.forEach((el) => {
      if (headText(el).includes(q)) el.querySelectorAll<HTMLElement>(".frow, .swcol").forEach((l) => { l.hidden = false; });
    });
    // hide a section/group only when its header doesn't match and none of its leaves do
    wraps.forEach((el) => {
      const anyVisible = Array.from(el.querySelectorAll<HTMLElement>(".frow, .swcol")).some((l) => !l.hidden);
      el.hidden = !anyVisible && !headText(el).includes(q);
    });
  });
  return (
    <div className="insp">
      <div className="insptabs">
        <button className="dtab on">Format</button>
      </div>
      {smallGraph && <SmallGraphNoticeBox {...smallGraph} />}
      {hasFormat && (
        <div className="inspcats" role="tablist" aria-label="Inspector sections">
          {RAIL.map((t) => {
            const disabled = !!deadRailTabs[t.id] && activeTab !== t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                aria-disabled={disabled || undefined}
                title={disabled ? deadRailTabs[t.id] : t.hint}
                className={"inspcat" + (activeTab === t.id ? " on" : "") + (disabled ? " disabled" : "")}
                onClick={() => onRailTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
          {/* one "?" for the rail, pointing at whichever tab is open — not seven of them.
              A "?" on every tab would double the rail's contents to answer a question a reader
              asks about the tab they are looking at, and the seven buttons would be the widest
              thing in a 300-px panel. */}
          <GuideHelp
            target={{ entry: inspectorTabEntryId(activeTab) }}
            what={`Inspector ${RAIL.find((t) => t.id === activeTab)?.label ?? ""}`.trim()}
            className="guidehelp-rail"
          />
        </div>
      )}
      {hasFormat && (
        <div className="inspfilter">
          <Search size={13} aria-hidden />
          <input
            className="inspfilter-in"
            type="search"
            value={filter}
            placeholder="Filter options…"
            aria-label="Filter inspector options"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div className="inspbody" ref={bodyRef}>
        {figureSlot && <div className="figinsp" ref={figureSlot} />}
        {plot && statsOverlay?.available && (
          <label className="grbtog" style={{ display: "flex", gap: 6, marginBottom: 8 }}
            title="Overlay this graph's analysis key result (p-value / effect size / R² …) as a movable, editable label">
            <input type="checkbox" checked={statsOverlay.on} onChange={(e) => statsOverlay.onToggle(e.target.checked)} />
            Show key stats on graph
          </label>
        )}
        {plot && equationOverlay?.available && (
          <label className="grbtog" style={{ display: "flex", gap: 6, marginBottom: 8 }}
            title="Overlay this graph's best-fit equation (with the fitted values) as a movable, editable label">
            <input type="checkbox" checked={equationOverlay.on} onChange={(e) => equationOverlay.onToggle(e.target.checked)} />
            Show fit equation on graph
          </label>
        )}
        {selection && plot && table ? (
          <SelectionEditor
            docVersion={docVersion}
            figureFit={figureFit}
            selection={selection}
            onSelect={onSelect}
            wholeGraph={wholeGraph}
            onSetWholeGraph={onSetWholeGraph}
            barWidthWhole={barWidthWhole}
            onSetBarWidthWhole={onSetBarWidthWhole}
            onSetPointStyle={onSetPointStyle}
            onClearPointStyles={onClearPointStyles}
            plot={plot}
            table={table}
            foreignSeries={foreignSeries}
            otherTables={otherTables}
            onSetAxis={onSetAxis}
            onSetAxisLength={onSetAxisLength}
            onSetAxisTitleFont={onSetAxisTitleFont}
            onSetSeriesStyle={onSetSeriesStyle}
            onSetSeriesStyleAll={onSetSeriesStyleAll}
            onSetGrid={onSetGrid}
            onSetFrame={onSetFrame}
            onSetKind={onSetKind}
            onSetBarLayout={onSetBarLayout}
            onSetBarShape={onSetBarShape}
            onSetBoxWhisker={onSetBoxWhisker}
            onSetPlotOptions={onSetPlotOptions}
            onSetGraphTitle={onSetGraphTitle}
            onSetPlotFont={onSetPlotFont}
            onHomogenizeFont={onHomogenizeFont}
            onSetLegend={onSetLegend}
            onSetSignificance={onSetSignificance}
            onApplyPreset={onApplyPreset}
            userPresets={userPresets}
            onApplyUserPreset={onApplyUserPreset}
            onSaveUserPreset={onSaveUserPreset}
            onAddPresetKind={onAddPresetKind}
            onDeleteUserPreset={onDeleteUserPreset}
            onRenameUserPreset={onRenameUserPreset}
            onDuplicateUserPreset={onDuplicateUserPreset}
            onRemovePresetKind={onRemovePresetKind}
            onReorderUserPresets={onReorderUserPresets}
            profileDefault={profileDefault}
            onSetProfileDefault={onSetProfileDefault}
            onUserLibraryImported={onUserLibraryImported}
            gradients={gradients}
            gradientOps={gradientOps}
            onEditGradient={(g, apply) => setGradEdit({ gradient: g, apply })}
            annotationOps={annotationOps}
          />
        ) : (
          <p className="note">
            {figureSlot
              ? "Click a panel or an object on the figure to edit it."
              : activeSection === "graphs"
              ? "Click an axis or a series on the graph to edit it."
              : "Select a graph to format it, or switch to the Assistant."}
          </p>
        )}
      </div>
      {assistant?.suggestion && (
        <div className="inspfoot">
          <AssistantNudge suggestion={assistant.suggestion} onRun={assistant.onRun} onDismiss={assistant.onDismiss} />
        </div>
      )}
      {gradEdit && (
        <GradientEditor
          gradient={gradEdit.gradient}
          usedBy={gradientOps?.usedBy(gradEdit.gradient.id) ?? []}
          inLibrary={listUserGradients().some((g) => g.id === gradEdit.gradient.id)}
          onCancel={() => setGradEdit(null)}
          onSaveToLibrary={(g) => {
            // The shelf is per-machine; the project keeps its own copy (below), so a shared
            // .mady never opens with its colours missing.
            saveUserGradient(g);
            gradientOps?.save(g);
            setGradEdit({ ...gradEdit, gradient: g });
          }}
          onDone={(g) => {
            gradientOps?.save(g);
            gradEdit.apply(`custom:${g.id}`);
            setGradEdit(null);
          }}
          {...(gradients.some((g) => g.id === gradEdit.gradient.id)
            ? { onDelete: () => { gradientOps?.remove(gradEdit.gradient.id); setGradEdit(null); } }
            : {})}
        />
      )}
    </div>
  );
}

function SelectionEditor({
  figureFit,
  selection,
  onSelect,
  wholeGraph: wholeGraphValue,
  onSetWholeGraph,
  barWidthWhole: barWidthWholeProp,
  onSetBarWidthWhole,
  plot,
  table,
  docVersion,
  foreignSeries,
  otherTables,
  onSetAxis,
  onSetAxisLength,
  onSetAxisTitleFont,
  onSetSeriesStyle,
  onSetSeriesStyleAll,
  onSetPointStyle,
  onClearPointStyles,
  onSetGrid,
  onSetFrame,
  onSetKind,
  onSetBarLayout,
  onSetBarShape,
  onSetBoxWhisker,
  onSetPlotOptions,
  onSetGraphTitle,
  onSetPlotFont,
  onHomogenizeFont,
  onSetLegend,
  onSetSignificance,
  onApplyPreset,
  userPresets,
  onApplyUserPreset,
  onSaveUserPreset,
  onAddPresetKind,
  onDeleteUserPreset,
  onRenameUserPreset,
  onDuplicateUserPreset,
  onRemovePresetKind,
  onReorderUserPresets,
  profileDefault,
  onSetProfileDefault,
  onUserLibraryImported,
  gradients = [],
  gradientOps,
  onEditGradient,
  annotationOps,
}: {
  figureFit?: { width: number; height: number } | null | undefined;
  selection: NonNullable<GraphSelection>;
  onSelect: (sel: GraphSelection) => void;
  /** Bulk-apply scope, owned by AppShell so canvas gestures can honour it too. */
  wholeGraph: boolean;
  onSetWholeGraph: (v: boolean) => void;
  barWidthWhole?: boolean | undefined;
  onSetBarWidthWhole?: ((v: boolean) => void) | undefined;
  plot: Plot;
  table: DataTable;
  docVersion?: number | undefined;
  foreignSeries?: Record<NodeId, string> | undefined;
  /** The project's other datasheets, for "Add series from another datasheet" (composite graphs). */
  otherTables?: DataTable[] | undefined;
  onSetAxis: (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;
  onSetAxisLength: (axis: "x" | "y", length: number | null) => void;
  onSetAxisTitleFont: (axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>) => void;
  onSetSeriesStyle: (columnId: NodeId, delta: SeriesStyle) => void;
  onSetSeriesStyleAll: (columnIds: NodeId[], delta: SeriesStyle, coalesceTag?: string) => void;
  onSetPointStyle: (columnId: NodeId, rowId: NodeId, delta: SeriesStyle) => void;
  onClearPointStyles: (columnId: NodeId) => void;
  onSetGrid: (delta: GridStyle) => void;
  onSetFrame: (patch: FramePatch) => void;
  onSetKind: (kind: PlotKind) => void;
  onSetBarLayout: (layout: BarLayout) => void;
  onSetBarShape: (shape: BarShape) => void;
  onSetBoxWhisker: (whisker: BoxWhisker) => void;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  onSetGraphTitle: (patch: GraphTitlePatch) => void;
  onSetPlotFont: SetPlotFont;
  onHomogenizeFont: (element: FontElement) => void;
  onSetLegend: SetLegend;
  onSetSignificance: SetSignificance;
  onApplyPreset: (preset: StylePreset) => void;
  userPresets: UserPreset[];
  onApplyUserPreset: (preset: UserPreset) => void;
  /** `includeKind`: also save the open graph's type-specific settings as a section of the preset. */
  onSaveUserPreset: (name: string, includeKind: boolean) => UserPreset | null;
  /** "+ type" on a saved preset's card: add the open graph's type-specific settings to it. */
  onAddPresetKind?: ((id: NodeId) => void) | undefined;
  onDeleteUserPreset: (id: NodeId) => void;
  /** Preset management: rename, duplicate (returns a refusal to show, or null), drop a type's section, reorder. */
  onRenameUserPreset?: ((id: NodeId, name: string) => void) | undefined;
  onDuplicateUserPreset?: ((id: NodeId) => string | null) | undefined;
  onRemovePresetKind?: ((id: NodeId, kind: PlotKind) => void) | undefined;
  onReorderUserPresets?: ((ids: string[]) => void) | undefined;
  profileDefault: ProfileDefault;
  onSetProfileDefault: (d: ProfileDefault) => void;
  onUserLibraryImported?: (() => void) | undefined;
  gradients?: Gradient[] | undefined;
  gradientOps?: {
    save: (g: Gradient) => void;
    remove: (id: string) => void;
    nextId: () => string;
    usedBy: (id: string) => string[];
  } | undefined;
  onEditGradient?: ((g: Gradient, apply: (ref: string) => void) => void) | undefined;
  annotationOps: AnnotationOps;
}) {
  // Hook must run unconditionally (Rules of Hooks) — used only by the series panel.
  const wholeSeries = useWholeSeries();
  // Point spread's own "whole graph" tick box (Data tab): ticked by default; unticked = only the clicked series.
  const [spreadWhole, setSpreadWhole] = useState(true);
  // Bar width's "whole graph" box: AppShell's when it passes one (so the bar-edge drag follows it), else this panel's.
  const [barWholeLocal, setBarWholeLocal] = useState(true);
  const barWhole = barWidthWholeProp ?? barWholeLocal;
  const setBarWhole = onSetBarWidthWhole ?? setBarWholeLocal;
  // Draft fields for the parallel axis panel's custom-tick adder. Hooks cannot live inside the
  // `selection.kind` branch that uses them (Rules of Hooks), so they sit here like `wholeSeries`.
  const [pcTickVal, setPcTickVal] = useState("");
  const [pcTickLbl, setPcTickLbl] = useState("");
  /** Ask the parent to open the gradient editor. It lives up there because this component
   *  returns from a dozen different branches, and a dialog rendered inside one of them would
   *  disappear the moment the selection changed under it. */
  const setGradEdit = (e: { gradient: Gradient; apply: (ref: string) => void }): void => onEditGradient?.(e.gradient, e.apply);
  /** A ramp dropdown's onChange: either set the ramp, or open the editor on what it shows now. */
  const pickRamp = (value: string, current: string, apply: (ref: string) => void): void => {
    if (value !== EDIT_RAMP) { apply(value); return; }
    setGradEdit({ gradient: gradientToEdit(current, gradients, gradientOps?.nextId() ?? `grad_${Date.now().toString(36)}`), apply });
  };
  /** The options every ramp dropdown offers (built-ins + the project's own + the editor). */
  const rampOpts = (base: ReadonlyArray<readonly [string, string]>): [string, string][] =>
    rampOptions(base, gradients, Boolean(gradientOps));
  // "Apply to whole graph" is owned by AppShell, not this component. It has to be, or a canvas
  // gesture (the box-width drag) cannot see it — see the comment on `wholeGraph` in AppShell.
  const wholeGraph = { value: wholeGraphValue, set: onSetWholeGraph };
  // A heatmap cell joins this branch (rather than getting its own read-only pane) so the click
  // lands on real, editable controls: the sectioned plot panel, Chart tab, Heatmap section
  // surfaced — exactly like a colour-bar click. A separate pane could only print the cell's
  // value and say the controls were somewhere else.
  // Note: `chart-section` joins this branch rather than getting a panel of its own: the section it
  // pins is one of the sections this branch renders, so the pinning effect has nothing to hide
  // unless they are all on screen. Same reason the colour bar and the heatmap cell are here.
  if (selection.kind === "plot" || selection.kind === "bubble-legend" || selection.kind === "colorbar" || selection.kind === "heatmap-cell" || selection.kind === "heatmap-split" || selection.kind === "heatmap-track" || selection.kind === "chart-section") {
    const g = plot.grid ?? {};
    const kind = plot.kind ?? "xy";
    const legends =
      kind === "bubble" ? hasDataDrivenLegend(plot)
      : kind === "network" ? hasNetworkLegend(plot)
      : !NO_SERIES_LEGEND.has(kind);
    // The Series list must reflect the drawn series, not the raw table columns:
    //  • bubble plots only the 1st Y (position); the 2nd Y is the size encoding.
    //  • ROC / survival draw one curve per plot.roc / plot.survival entry, keyed roc-i /
    //    surv-i (not the source columns) — so show/hide + colour target the real curves.
    //  • Bland-Altman draws one "Difference" series keyed by the 2nd method column.
    const baDs = tableDatasets(table);
    const baStyleId = kind === "blandaltman" ? ((baDs.length >= 2 ? baDs[1]?.id : baDs[0]?.id) ?? "") : "";
    const seriesList =
      kind === "bubble"
        ? xyFamilyDatasets(table).slice(0, 1)
        : XY_FAMILY_KINDS.has(kind)
          ? xyFamilyDatasets(table)
        : kind === "roc"
          ? (plot.roc ?? []).map((c, i) => ({ id: `roc-${i}`, name: c.label }))
          : kind === "survival"
            ? (plot.survival ?? []).map((c, i) => ({ id: `surv-${i}`, name: c.label }))
            : kind === "blandaltman" && baStyleId
              ? [{ id: baStyleId, name: "Difference" }]
              : // Forest: the pooled summary is a mark the user can style, but it is computed
                // rather than a table column, so it has no dataset to appear as. Listed under
                // the synthetic id the builder reads (`forest-summary`) — without this the only
                // way to reach it is to know you can click the diamond.
                // Only when there is one: listing a summary on a plot that draws none would be
                // a row whose every control changes nothing.
                kind === "forest" && (plot.forest?.showSummary ?? false)
                ? [...tableDatasets(table), { id: "forest-summary", name: "Summary" }]
                : tableDatasets(table);
    // Kinds that draw synthetic series (clustering tree / PCA groups + loadings / scree
    // components) keyed independently of the table's datasets — a datasets-keyed list is
    // inert + misleading there (edits write keys the builder never reads). These series
    // are styled by clicking them on the canvas instead. Suppress the list.
    // Focus on a chart that draws its own series: list what the drawing produces (names made unique - a tree's
    // branches are all "Cluster"), ring only. See DRAWN_FOCUS_KINDS.
    const drawnFocusList = DRAWN_FOCUS_KINDS.has(kind)
      ? (() => {
          const ser = buildPlotScene(table, plot, {}).series;
          const count = new Map<string, number>();
          for (const x of ser) count.set(x.name, (count.get(x.name) ?? 0) + 1);
          const nth = new Map<string, number>();
          return ser.map((x) => {
            const k = (nth.get(x.name) ?? 0) + 1;
            nth.set(x.name, k);
            return { id: x.id, name: (count.get(x.name) ?? 0) > 1 ? `${x.name} ${k}` : x.name, color: x.color ?? undefined };
          });
        })()
      : [];
    const drawnFocus = drawnFocusList.length >= 2 && (
      <>
        <p className="hint" style={{ margin: "2px 0" }}>Focus a series: it keeps its colour and the rest go grey.</p>
        <SeriesVisibilityList datasets={drawnFocusList} plot={plot} onSetSeriesStyle={onSetSeriesStyle} focusOnly />
      </>
    );
    const syntheticSeries = kind === "dendrogram" || kind === "scree" || kind === "pcascore" || kind === "pcaload" || kind === "pcabiplot" || kind === "triplot";
    const showSeriesList =
      seriesList.length >= 1 && kind !== "pie" && kind !== "radar" && kind !== "heatmap" && kind !== "corrmatrix" && kind !== "alluvial" && kind !== "network" && kind !== "scatter3d"
      // sunburst / chord / oncoprint colour their ink by a data value (branch / node /
      // alteration-type name), not by a table column — so a column-keyed series list here would
      // be a dead control. Each provides a real per-element colour list in its own
      // Chart-type panel instead (the venn "click a set" pattern).
      && kind !== "sunburst" && kind !== "chord" && kind !== "oncoprint"
      // estimation + pyramid read their datasets by position — control vs test, left side vs
      // right side. There is no such thing as hiding one: dropping it would renumber the rest and
      // silently compare a different pair, so the builders deliberately ignore `hidden` there.
      // A list whose every checkbox does nothing would be a dead control.
      && kind !== "estimation" && kind !== "pyramid" && !syntheticSeries;
    /**
     * The kinds whose per-element styling is reachable by clicking but has no list to advertise
     * it — named by the thing to click, so the note can say it.
     *
     * Each one's click path is in `PlotFigure`
     * (radar → `{kind:"series"}` on the polygon, scatter3d → `{kind:"series"}` on the point).
     *
     * Pie is deliberately absent, because the Pie chart section
     * already ends with "Click a slice to set its colour, explode, border, and label." — as
     * treemap does for its cells. A second sentence saying the same thing adds nothing.
     * Excluded for a different reason: heatmap · corrmatrix · alluvial ·
     * network, whose `seriesStyles` really is inert and whose styling lives in their
     * own Chart-section panels, so pointing them at a series editor would be the wrong
     * instruction.
     *
     * For the five synthetic-series kinds, each name below is the element the selection
     * actually comes from —
     *   pcascore · pcabiplot   10 × `circle` inside `g.gfx-series`  → the points
     *   pcaload                 4 × `circle` inside `g.gfx-series`  → the points
     *                             (note: its arrows are annotations, not series — do not say arrow)
     *   scree                   6 × `circle` + 2 × `path`           → the points on the curve
     *   dendrogram              3 × `path` (0 marks — the branches themselves)
     * `synthetic-series-styling.test.tsx` re-derives this from the figure and fails if a kind
     * gains or loses a click path.
     */
    const clickToStyleTarget =
      kind === "radar" ? "a polygon"
      : kind === "scatter3d" || kind === "pcascore" || kind === "pcabiplot" || kind === "pcaload" ? "a point"
      : kind === "scree" ? "a point on the curve"
      : kind === "dendrogram" ? "a branch"
      : null;
    // A matrix heatmap has no series palette, no gridlines/frame/tick axes, and no
    // significance brackets — those sections are inert, so hide them (the colour ramp
    // lives in the Heatmap section instead). Point-mode heatmaps (density/hexbin) do
    // have real axes + grid, so keep those for them.
    const heatmapMatrix = kind === "heatmap" && (plot.heatmap?.mode ?? "matrix") === "matrix";
    return (
      <>
        {/* Axis editing lives on the "Axis" rail tab (its X/Y/Y2/Y3 switcher + full controls).
            There is no separate "Edit axis" quick-jump row: rendered outside the tab sections, it
            would sit at the top of every tab (Chart, Frame, Style…) and duplicate the Axis tab. */}
        {!showSeriesList && drawnFocus && <Section title="Series" open>{drawnFocus}</Section>}
        {showSeriesList && (
          <Section title="Series" open>
            {/* Composite graphs — a series borrowed from another datasheet is a plot option
                (`plot.overlays`, a reference), removed here on its row; added by the picker below
                the list. Only kinds with a shared X axis (xy / area / bar) can take one. */}
            <SeriesVisibilityList datasets={seriesList} plot={plot} onSetSeriesStyle={onSetSeriesStyle} foreign={foreignSeries}
              onRemoveForeign={(colId) => {
                const kept = (plot.overlays ?? []).filter((o) => o.column !== colId);
                onSetPlotOptions({ overlays: kept.length ? kept : undefined });
              }}
              noHide={kind === "forest" || kind === "funnel" || kind === "ternary" || kind === "qq" || kind === "manhattan" ? true : kind === "swimmer" ? swimmerNoHide(table) : false} />
            {drawnFocus}
            {(kind === "xy" || kind === "area" || kind === "bar") && (otherTables ?? []).length > 0 && (() => {
              const borrowed = new Set((plot.overlays ?? []).map((o) => o.column));
              const choices = (otherTables ?? [])
                .filter((t) => t.id !== plot.source && xColumn(t))
                .flatMap((t) => tableDatasets(t).filter((d) => !borrowed.has(d.id)).map((d) => ({ value: `${t.id}::${d.id}`, label: `${t.name} ▸ ${d.name}` })));
              if (choices.length === 0) return null;
              return (
                <label className="frow" title="Draw a column of another datasheet on this graph. It is joined onto this axis — by X value on an XY graph, by category name on bars — and then styled like any series (Render as, right axis, colour). The other sheet keeps its own data and statistics; this graph only holds a reference.">
                  <span>From another sheet</span>
                  <select
                    className="selin"
                    aria-label="Add series from another datasheet"
                    value=""
                    onChange={(e) => {
                      const [tableId, column] = e.target.value.split("::");
                      if (!tableId || !column) return;
                      const id = `ov-${column}`;
                      onSetPlotOptions({ overlays: [...(plot.overlays ?? []), { id, table: tableId, column }] });
                    }}
                  >
                    <option value="">Add series from another datasheet…</option>
                    {choices.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </label>
              );
            })()}
          </Section>
        )}
        {/* Discoverability, not a dead control. On these kinds per-element styling
            is fully alive but is reached by clicking the element on the canvas, and without the
            list there would be no sign that it exists. A styling route that cannot be found reads
            as "does not work", so the route is stated instead of assumed. */}
        {clickToStyleTarget && (
          <Section title="Series" open>
            <p className="note" style={{ fontSize: 11, margin: 0 }}>
              Click {clickToStyleTarget} on the graph to style it — colour, outline and the rest
              appear here once it is selected. This chart has no series list because its parts are
              not table columns.
            </p>
          </Section>
        )}
        <Section title="Chart type" open>
          <label className="frow">
            <span>Type</span>
            <select className="selin" value={kind} onChange={(e) => onSetKind(e.target.value as PlotKind)}>
              <option value="xy">XY (points / line)</option>
              <option value="area">Area</option>
              <option value="bar">Bar / column</option>
              <option value="histogram">Histogram</option>
              <option value="box">Box &amp; whisker</option>
              <option value="violin">Violin</option>
              <option value="scatter">Column scatter</option>
              <option value="raincloud">Raincloud</option>
              <option value="bubble">Bubble</option>
              <option value="volcano">Volcano</option>
              <option value="beforeafter">Before–after (paired)</option>
              <option value="pie">Pie</option>
              <option value="treemap">Treemap (Voronoi)</option>
              <option value="heatmap">Heatmap</option>
              <option value="corrmatrix">Correlation matrix</option>
              <option value="alluvial">Alluvial / parallel sets</option>
              <option value="network">Network graph</option>
              <option value="radar">Radar / spider</option>
              <option value="parallel">Parallel coordinates</option>
              <option value="scatter3d">3D scatter</option>
              <option value="ridgeline">Ridgeline / joyplot</option>
              <option value="lollipop">Lollipop / dumbbell</option>
              <option value="paireddot">Paired dot plot</option>
              <option value="floatingbar">Floating bars (min→max)</option>
              <option value="estimation">Estimation (Gardner-Altman)</option>
              <option value="forest">Forest plot</option>
              <option value="funnel">Funnel plot</option>
              <option value="venn">Venn / Euler diagram</option>
              <option value="upset">UpSet plot</option>
              <option value="swimmer">Swimmer plot</option>
              <option value="blandaltman">Bland-Altman</option>
              <option value="pyramid">Population pyramid</option>
              {/* "Ordination", not "PCA": these kinds now draw a PCoA, an NMDS and a
                  correspondence analysis as well, and a CA labelled "PCA — score plot" is a
                  false label on a published figure. The PlotKind strings are unchanged, so
                  every saved project still opens. */}
              <option value="pcascore">Ordination — sites (PCA · PCoA · NMDS · CA)</option>
              <option value="pcaload">Ordination — variables (loadings)</option>
              <option value="pcabiplot">Ordination — biplot</option>
              <option value="scree">Scree plot</option>
              <option value="dendrogram">Dendrogram (clustering)</option>
            </select>
          </label>
          {/* `bar` or `histogram`. A histogram honours barOrientation and barWidth, so the block
              is shown on it too.
              Bar layout stays bar-only: a histogram has one series of bins, so there is nothing
              to group or stack. Bar shape is not bar-only: each of the three shapes changes a
              histogram's drawing, in both orientations. */}
          {(kind === "bar" || kind === "histogram") && (
            <>
              {kind === "bar" && (
              <label className="frow">
                <span>Bars</span>
                <select
                  className="selin"
                  value={plot.barLayout ?? "grouped"}
                  onChange={(e) => onSetBarLayout(e.target.value as BarLayout)}
                >
                  <option value="grouped">Grouped (interleaved)</option>
                  <option value="stacked">Stacked</option>
                  <option value="percent">Stacked 100%</option>
                  <option value="overlay">Overlaid (up/down)</option>
                </select>
              </label>
              )}
              {/* Ribbons only exist between stacked segments — on grouped/overlay the builder
                  refuses with a warning, so the control is hidden there (panel ≡ drawing). */}
              {kind === "bar" && ((plot.barLayout ?? "grouped") === "stacked" || plot.barLayout === "percent") && (
                <>
                  <label className="frow" title="Connect each series' segment to the same series' segment in the next bar with a translucent ribbon — the linked relative-abundance look. The ribbon only traces the segments' edges; it adds no numbers.">
                    <span>Connect stacks</span>
                    <input
                      type="checkbox"
                      aria-label="Connect stacked bars with ribbons"
                      checked={plot.barRibbons === true}
                      onChange={(e) => onSetPlotOptions({ barRibbons: e.target.checked })}
                    />
                  </label>
                  {plot.barRibbons === true && (
                    <label className="frow" title="Ribbon fill opacity — light keeps the bars primary, dark makes a stratum easy to trace">
                      <span>Ribbon opacity</span>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={plot.barRibbonOpacity ?? 0.45}
                          onChange={(e) => onSetPlotOptions({ barRibbonOpacity: Math.min(1, Math.max(0, Number(e.target.value))) })}
                        />
                        <span style={{ width: 32, textAlign: "right" }}>{Math.round((plot.barRibbonOpacity ?? 0.45) * 100)}%</span>
                      </span>
                    </label>
                  )}
                </>
              )}
              <BarShapeRow plot={plot} onSetBarShape={onSetBarShape} />
              <label className="frow">
                <span>Orientation</span>
                <button
                  type="button"
                  className="btn-mini"
                  title="Flip between vertical columns and horizontal bars"
                  onClick={() => onSetPlotOptions({ barOrientation: (plot.barOrientation ?? "vertical") === "horizontal" ? "vertical" : "horizontal" })}
                >
                  {(plot.barOrientation ?? "vertical") === "horizontal" ? "↔ Horizontal" : "↕ Vertical"} — flip
                </button>
              </label>
              {kind === "bar" && (
                <SortRow
                  label="Sort bars"
                  largest="Largest first (waterfall)"
                  title="Order the categories by value instead of table order. Largest first (waterfall) or smallest first. A single series sorts by its own value; grouped/stacked bars sort by the category total. Per-bar colours, value labels and significance brackets all follow their bars through the sort."
                  plot={plot}
                  onSetPlotOptions={onSetPlotOptions}
                />
              )}
              {/* Pareto: a derived cumulative-% line over the bars on a right-hand 0–100 % axis, in
                  the drawn order (Largest first above = the classic Pareto). Vertical bars only —
                  the horizontal builder draws no second value axis and refuses it, so the control
                  is hidden there (panel ≡ drawing). */}
              {kind === "bar" && (plot.barOrientation ?? "vertical") !== "horizontal" && (
                <>
                  <label className="frow" title="Draw the running total of the bars as a percentage of the whole, as a line on a right-hand 0–100 % axis, in the drawn order. With Sort bars = Largest first this is the Pareto chart: the vital few on the left, the line showing how much of the total they cover.">
                    <span>Cumulative % line</span>
                    <input type="checkbox" checked={plot.paretoLine === true} onChange={(e) => onSetPlotOptions({ paretoLine: e.target.checked })} />
                  </label>
                  {plot.paretoLine === true && (
                    <label className="frow" title="Colour of the cumulative % line.">
                      <span>Line colour</span>
                      <ColorInput value={plot.paretoLineColor ?? "#c0392b"} aria-label="Cumulative % line colour" onChange={(c) => onSetPlotOptions({ paretoLineColor: c })} />
                    </label>
                  )}
                </>
              )}
              {/* Histogram bars are contiguous by default (100%); dialling this down puts gaps
                  between the bins, like a column chart. Bar charts default to 82%. */}
              {/* A bar chart's Bar width is on the Data tab, with its "whole graph" tick box; a
                  histogram has one series, so its width stays here. */}
              {kind !== "bar" && (
                <BarWidthRow
                  plot={plot}
                  onSetPlotOptions={onSetPlotOptions}
                  fallback={kind === "histogram" ? 1 : 0.82}
                  title={kind === "histogram" ? "Bar width: 100% = touching bins, less = gaps between the bars" : "Fraction of the category band filled by bars (0.1–1)"}
                />
              )}
              {/* Three-way grouped bar: give each dataset an outer group name. Bars then cluster by
                  group with a gap + the group labelled under each cluster. Grouped layout, ≥3 datasets. */}
              {kind === "bar" && (plot.barLayout ?? "grouped") === "grouped" && seriesList.length >= 3 && (
                <div className="frow" style={{ alignItems: "start" }} title="Three-way grouping: give each dataset an outer group name (e.g. A,B → “Drug 1”; C,D → “Drug 2”). Bars cluster by group with a gap and the group name is labelled under each cluster (vertical bars). Leave all blank for an ordinary grouped bar.">
                  <span>Bar groups</span>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 6px", alignItems: "center", flex: 1 }}>
                    {seriesList.map((d) => (
                      <Fragment key={d.id}>
                        <span style={{ fontSize: 12 }}>{d.name}</span>
                        <input
                          type="text"
                          className="numin"
                          style={{ width: "100%" }}
                          placeholder="group…"
                          aria-label={`Bar group for ${d.name}`}
                          value={plot.barSeriesGroups?.[d.id] ?? ""}
                          onChange={(e) => {
                            const next = { ...(plot.barSeriesGroups ?? {}) };
                            if (e.target.value.trim()) next[d.id] = e.target.value;
                            else delete next[d.id];
                            onSetPlotOptions({ barSeriesGroups: Object.keys(next).length ? next : undefined });
                          }}
                        />
                      </Fragment>
                    ))}
                  </div>
                </div>
              )}
              {/* Decimal places for the on-bar value labels (the Show-values toggle lives in the
                  graph ribbon; blank = auto-trim). The builder+renderer already read it. */}
              {/* Offered only where a series still draws a bar: the placement is measured against the bar, and a
                  chart drawn entirely as points or a line has none (Ranked dots), so it would place nothing there -
                  only change the room reserved at the top. Guard: value-position-gate.test.tsx. */}
              {plot.showValues && barsCarryValueLabels(plot, seriesList) && (
                <ValuePositionRow label="Value position" plot={plot} onSetPlotOptions={onSetPlotOptions} />
              )}
              {plot.showValues && (
                <label className="frow" title="Decimal places for the value label on each bar (blank = auto)">
                  <span>Value decimals</span>
                  <input
                    type="number"
                    className="numin"
                    min={0}
                    max={4}
                    step={1}
                    value={plot.valueDecimals ?? ""}
                    placeholder="auto"
                    onChange={(e) => {
                      const t = e.target.value.trim();
                      onSetPlotOptions({ valueDecimals: t === "" ? undefined : Math.max(0, Math.min(4, Math.floor(Number(t) || 0))) });
                    }}
                  />
                </label>
              )}
              {plot.showValues && barsCarryValueLabels(plot, seriesList) && <ValueShiftRow label="Value shift" plot={plot} onSetPlotOptions={onSetPlotOptions} />}
            </>
          )}
          {kind === "area" && (
            <label className="frow">
              <span>Stacking</span>
              <select
                className="selin"
                value={plot.areaStack ?? "none"}
                onChange={(e) => onSetPlotOptions({ areaStack: e.target.value as AreaStack })}
              >
                <option value="none">Overlaid</option>
                <option value="stacked">Stacked</option>
                <option value="percent">100% stacked</option>
                <option value="stream">Stream (centred)</option>
              </select>
            </label>
          )}
          {kind === "area" && (plot.areaStack ?? "none") === "none" && (
            <label className="frow" title="Value the fill drops to (overlaid areas). Blank = 0. Set the axis minimum to fill the whole band.">
              <span>Fill baseline</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="number"
                  className="numin"
                  step="any"
                  style={{ width: 70 }}
                  value={plot.areaBaseline ?? ""}
                  placeholder="0"
                  onChange={(e) => { const t = e.target.value.trim(); onSetPlotOptions({ areaBaseline: t === "" ? undefined : Number(t) }); }}
                />
                <button type="button" className="swbtn" title="Reset to 0" onClick={() => onSetPlotOptions({ areaBaseline: undefined })}>⨯</button>
              </span>
            </label>
          )}
          {/* Spread band is suppressed by the builder when an area is stacked/percent
              (spreadMode forced to "none"), so hide the dead control there. */}
          {/* `bubble` and `volcano` are included because the builder draws the spread band
              and its mean line on both, with `spread.mode` set and with `showMean` on. Same reasoning as the confidence-ellipse section: XY-family scatters. */}
          {(kind === "xy" || kind === "bubble" || kind === "volcano" || (kind === "area" && (plot.areaStack ?? "none") === "none")) && (
            <>
              <label className="frow">
                <span>Spread band</span>
                <select
                  className="selin"
                  value={plot.spread?.mode ?? "none"}
                  onChange={(e) =>
                    onSetPlotOptions({ spread: { ...(plot.spread ?? {}), mode: e.target.value as SpreadMode } })
                  }
                >
                  <option value="none">None</option>
                  <option value="range">Range (min–max)</option>
                  <option value="sd">Mean ± SD</option>
                  <option value="sem">Mean ± SEM</option>
                  <option value="iqr">IQR (25–75%)</option>
                </select>
              </label>
              {/* The multiplier. `buildPlotScene` reads `spreadSpec?.k ?? 1`, so this row lets a
                  spread band be ±2 SD (or any other multiple) as well as the default ±1 SD.
                  Only for SD / SEM: the model says so, and a multiplier on a range or an IQR
                  would be a number with no meaning - those two are the data's own extremes. */}
              {((plot.spread?.mode ?? "none") === "sd" || plot.spread?.mode === "sem") && (
                <label className="frow" title="How many SD / SEM the band reaches either side of the mean. 1 = mean ± 1 SD (the default); 2 = mean ± 2 SD.">
                  <span>Multiplier</span>
                  <input
                    type="number"
                    className="numin"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={plot.spread?.k ?? ""}
                    placeholder="1"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      onSetPlotOptions({
                        spread: {
                          ...(plot.spread ?? { mode: "sd" as SpreadMode }),
                          ...(e.target.value !== "" && Number.isFinite(v) && v > 0 ? { k: v } : { k: undefined }),
                        },
                      });
                    }}
                  />
                </label>
              )}
              {/* The band's own colour + opacity (`spread.color` and `spread.opacity`, honoured
                  by the builder on area/bubble/volcano/xy). Shown with the rest of the band's
                  settings, i.e. only once a mode is set. */}
              {(plot.spread?.mode ?? "none") !== "none" && (
                <label className="frow" title="Colour of the shaded spread band (blank = the series colour)">
                  <span>Band colour</span>
                  <ColorInput
                    className="colorin"
                    aria-label="Band colour"
                    value={plot.spread?.color ?? "#888888"}
                    onChange={(c) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), color: c } })}
                  />
                </label>
              )}
              {(plot.spread?.mode ?? "none") !== "none" && (
                <label className="frow" title="How opaque the shaded spread band is">
                  <span>Band opacity</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={plot.spread?.opacity ?? 0.18}
                      onChange={(e) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), opacity: Number(e.target.value) } })}
                    />
                    <span style={{ width: 32, textAlign: "right" }}>{Math.round((plot.spread?.opacity ?? 0.18) * 100)}%</span>
                  </span>
                </label>
              )}
              {(plot.spread?.mode ?? "none") !== "none" && (
                <label className="frow">
                  <span>Average line</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={plot.spread?.showMean ?? false}
                      onChange={(e) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), showMean: e.target.checked } })}
                    />
                    <input
                      type="text"
                      className="numin"
                      style={{ width: 96 }}
                      placeholder="label (e.g. Avg)"
                      value={plot.spread?.meanLabel ?? ""}
                      onChange={(e) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), meanLabel: e.target.value || undefined } })}
                    />
                  </span>
                </label>
              )}
              {/* The line's own settings, shown only while it is drawn, including
                  `spread.meanColor`, which the builder honours — like Band colour above.
                  The line traces a curve for the median or the mean. */}
              {(plot.spread?.mode ?? "none") !== "none" && (plot.spread?.showMean ?? false) && (
                <>
                  <label className="frow" title="The statistic the line traces across the series at each X">
                    <span>Line shows</span>
                    <select
                      className="selin"
                      value={plot.spread?.center ?? "mean"}
                      onChange={(e) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), center: e.target.value as "mean" | "median" } })}
                    >
                      <option value="mean">Mean</option>
                      <option value="median">Median</option>
                    </select>
                  </label>
                  <label className="frow" title="Colour of the average line (blank = mid grey)">
                    <span>Line colour</span>
                    <ColorInput
                      className="colorin"
                      aria-label="Spread line colour"
                      value={plot.spread?.meanColor ?? "#7a7a85"}
                      onChange={(c) => onSetPlotOptions({ spread: { ...(plot.spread ?? { mode: "range" }), meanColor: c } })}
                    />
                  </label>
                </>
              )}
            </>
          )}
          {kind === "lollipop" && (() => {
            const l = plot.lollipop ?? {};
            const setL = (patch: Partial<NonNullable<Plot["lollipop"]>>) => onSetPlotOptions({ lollipop: { ...l, ...patch } });
            return (
              <>
                <label className="frow">
                  <span>Orientation</span>
                  <button
                    type="button"
                    className="btn-mini"
                    title="Flip between horizontal rows and vertical columns"
                    onClick={() => onSetPlotOptions({ barOrientation: (plot.barOrientation ?? "horizontal") === "horizontal" ? "vertical" : "horizontal" })}
                  >
                    {(plot.barOrientation ?? "horizontal") === "horizontal" ? "↔ Horizontal" : "↕ Vertical"} — flip
                  </button>
                </label>
                <label className="frow">
                  <span>Baseline / index</span>
                  <input
                    type="number"
                    className="numin"
                    placeholder="0"
                    value={l.baseline ?? ""}
                    onChange={(e) => setL({ baseline: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label className="frow">
                  <span>Dot size</span>
                  <input type="range" min={2} max={12} step={0.5} value={l.dotSize ?? 5} onChange={(e) => setL({ dotSize: Number(e.target.value) })} />
                </label>
                <label className="frow">
                  <span>Stem width</span>
                  <input type="number" className="numin" min={0.5} max={12} step={0.25} value={l.stemWidth ?? 2} onChange={(e) => setL({ stemWidth: Number(e.target.value) })} />
                </label>
                <label className="frow">
                  <span>Link stem to data colour</span>
                  <input
                    type="checkbox"
                    checked={l.stemLinkColor ?? false}
                    title="On: the stem colour follows the data-point colour. Off: set the stem colour below."
                    onChange={(e) => setL({ stemLinkColor: e.target.checked })}
                  />
                </label>
                {!(l.stemLinkColor ?? false) && (
                  <label className="frow">
                    <span>Stem colour</span>
                    <ColorInput className="colorin" value={l.stemColor ?? "#8b8792"} aria-label="Stem colour" onChange={(c) => setL({ stemColor: c })} />
                  </label>
                )}
                <label className="frow">
                  <span>Value labels</span>
                  <input type="checkbox" checked={l.showValues ?? true} onChange={(e) => setL({ showValues: e.target.checked })} />
                </label>
                <label className="frow">
                  <span>Δ% labels</span>
                  <input type="checkbox" checked={l.showDelta ?? true} onChange={(e) => setL({ showDelta: e.target.checked })} />
                </label>
                {(l.showDelta ?? true) && (
                  <label className="frow">
                    <span>Δ% colour</span>
                    <ColorInput className="colorin" value={l.deltaColor ?? "#1a9850"} aria-label="Delta percent colour" onChange={(c) => setL({ deltaColor: c })} />
                  </label>
                )}
              </>
            );
          })()}
          {kind === "paireddot" && (() => {
            const p = plot.paireddot ?? {};
            const setP = (patch: Partial<NonNullable<Plot["paireddot"]>>) => onSetPlotOptions({ paireddot: { ...p, ...patch } });
            const connector = p.connector ?? "toZero";
            return (
              <>
                <label className="frow">
                  <span>Row form</span>
                  <select
                    className="selin"
                    value={connector}
                    title="How the per-series dots on a row relate"
                    onChange={(e) => setP({ connector: e.target.value as NonNullable<Plot["paireddot"]>["connector"] })}
                  >
                    <option value="toZero">Stems to baseline (double lollipop)</option>
                    <option value="dumbbell">Dumbbell (connect the dots)</option>
                    <option value="none">Dots only</option>
                  </select>
                </label>
                {connector === "toZero" && (
                  <label className="frow">
                    <span>Baseline</span>
                    <input
                      type="number"
                      className="numin"
                      placeholder="0"
                      value={p.baseline ?? ""}
                      onChange={(e) => setP({ baseline: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
                    />
                  </label>
                )}
                {connector === "toZero" && (
                  <label className="frow">
                    <span>Series spread</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="range" min={0} max={1} step={0.05} value={p.seriesSpread ?? 0.55} onChange={(e) => setP({ seriesSpread: Number(e.target.value) })} />
                      <span style={{ width: 32, textAlign: "right" }}>{Math.round((p.seriesSpread ?? 0.55) * 100)}%</span>
                    </span>
                  </label>
                )}
                <label className="frow">
                  <span>Dot size</span>
                  <input type="range" min={2} max={12} step={0.5} value={p.dotSize ?? 5} onChange={(e) => setP({ dotSize: Number(e.target.value) })} />
                </label>
                <label className="frow">
                  <span>Stem / connector width</span>
                  <input type="number" className="numin" min={0.5} max={12} step={0.25} value={p.stemWidth ?? 2} onChange={(e) => setP({ stemWidth: Number(e.target.value) })} />
                </label>
                {connector === "toZero" && (
                  <label className="frow">
                    <span>Link stem to dot colour</span>
                    <input
                      type="checkbox"
                      checked={p.stemLinkColor ?? true}
                      title="On: each stem follows its dot's colour. Off: use the stem colour below."
                      onChange={(e) => setP({ stemLinkColor: e.target.checked })}
                    />
                  </label>
                )}
                {(connector === "dumbbell" || !(p.stemLinkColor ?? true)) && connector !== "none" && (
                  <label className="frow">
                    <span>{connector === "dumbbell" ? "Connector colour" : "Stem colour"}</span>
                    <ColorInput className="colorin" value={p.stemColor ?? "#8b8792"} aria-label="Stem colour" onChange={(c) => setP({ stemColor: c })} />
                  </label>
                )}
                <label className="frow">
                  <span>Value labels</span>
                  <input type="checkbox" checked={p.showValues ?? false} onChange={(e) => setP({ showValues: e.target.checked })} />
                </label>
                <label className="frow">
                  <span>Section groups</span>
                  <input
                    type="checkbox"
                    checked={p.showSections ?? true}
                    title="Draw dashed dividers + rotated labels for a leading text grouping column"
                    onChange={(e) => setP({ showSections: e.target.checked })}
                  />
                </label>
                {(p.showSections ?? true) && (
                  <label className="frow">
                    <span>Section colour</span>
                    <ColorInput className="colorin" value={p.sectionColor ?? "#8b8792"} aria-label="Section colour" onChange={(c) => setP({ sectionColor: c })} />
                  </label>
                )}
              </>
            );
          })()}
          {kind === "ridgeline" && (
            <>
              <label className="frow" title="What each row draws. Density = a smoothed distribution of the row's pooled values (the classic joyplot). Values over X = the row's value along the table's X column — time-series rows, the horizon look; negative values fold upward and Level bands colour them by sign.">
                <span>Rows show</span>
                <select
                  className="selin"
                  value={plot.ridgeline?.source ?? "density"}
                  onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), source: e.target.value === "profile" ? "profile" : undefined } })}
                >
                  <option value="density">Density (distribution)</option>
                  <option value="profile">Values over X</option>
                </select>
              </label>
              <label className="frow" title="Slice each row's height into this many equal levels, each filled one shade deeper — the nested iso-contour / horizon fill, keyed by a band legend. 0 = off (plain fill). Replaces the spectrum fill while on. The horizon fold follows BiomeHorizon (Ran Blekhman's laboratory). No code is reused.">
                <span>Level bands</span>
                <input
                  type="number"
                  className="numin"
                  style={{ width: 56 }}
                  min={0}
                  max={8}
                  step={1}
                  value={plot.ridgeline?.bands ?? 0}
                  onChange={(e) => { const n = Math.max(0, Math.min(8, Math.round(Number(e.target.value)))); onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), bands: n > 0 ? n : undefined } }); }}
                />
              </label>
              {(plot.ridgeline?.source ?? "density") === "profile" && (plot.ridgeline?.bands ?? 0) > 0 && (
                <label className="frow" title="Where each row's fold is centred: its own median (raw abundances work without pre-computed z-scores), its mean, or zero (values as entered — right when the rows already are z-scores).">
                  <span>Fold origin</span>
                  <select
                    className="selin"
                    value={plot.ridgeline?.origin ?? "median"}
                    onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), origin: e.target.value === "median" ? undefined : (e.target.value as "mean" | "zero") } })}
                  >
                    <option value="median">Row median</option>
                    <option value="mean">Row mean</option>
                    <option value="zero">Zero</option>
                  </select>
                </label>
              )}
              {(plot.ridgeline?.bands ?? 0) > 0 && (
                <label className="frow" title="Ramp anchors: level 1 is a light tint, the top level this exact colour — positive levels left, negative right (negatives appear in Values-over-X rows).">
                  <span>Band colours</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <ColorInput className="colorin" value={plot.ridgeline?.bandPosColor ?? "#2166ac"} aria-label="Positive band colour" onChange={(c) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), bandPosColor: c } })} />
                    <ColorInput className="colorin" value={plot.ridgeline?.bandNegColor ?? "#b2182b"} aria-label="Negative band colour" onChange={(c) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), bandNegColor: c } })} />
                  </span>
                </label>
              )}
              <label className="frow">
                <span>Overlap</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="range"
                    min={0.4}
                    max={3}
                    step={0.1}
                    value={plot.ridgeline?.overlap ?? 1.5}
                    onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), overlap: Number(e.target.value) } })}
                  />
                  <span style={{ width: 28, textAlign: "right" }}>{(plot.ridgeline?.overlap ?? 1.5).toFixed(1)}×</span>
                </span>
              </label>
              <label className="frow">
                <span>Smoothing</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="range"
                    min={0.3}
                    max={3}
                    step={0.1}
                    value={plot.ridgeline?.bandwidth ?? 1}
                    onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), bandwidth: Number(e.target.value) } })}
                  />
                  <span style={{ width: 28, textAlign: "right" }}>{(plot.ridgeline?.bandwidth ?? 1).toFixed(1)}×</span>
                </span>
              </label>
              <label className="frow">
                <span>Fill opacity</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={plot.ridgeline?.fillOpacity ?? 0.55}
                    onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), fillOpacity: Number(e.target.value) } })}
                  />
                  <span style={{ width: 28, textAlign: "right" }}>{Math.round((plot.ridgeline?.fillOpacity ?? 0.55) * 100)}%</span>
                </span>
              </label>
              <label className="frow">
                <span title="Fill every ridge with one gradient anchored to the X axis (low colour at the axis minimum, high colour at the maximum) — shared across all rows, so left-leaning ridges read as the low colour and right-leaning ones as the high colour.">Spectrum fill</span>
                <input
                  type="checkbox"
                  checked={plot.ridgeline?.spectrum ?? false}
                  onChange={(e) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), spectrum: e.target.checked || undefined } })}
                />
              </label>
              {plot.ridgeline?.spectrum && (
                <label className="frow">
                  <span>Spectrum colours</span>
                  <select
                    className="selin"
                    value={plot.ridgeline?.spectrumMap ?? "coolwarm"}
                    onChange={(e) => pickRamp(e.target.value, plot.ridgeline?.spectrumMap ?? "coolwarm", (ref) => onSetPlotOptions({ ridgeline: { ...(plot.ridgeline ?? {}), spectrumMap: ref } }))}
                    title="The colormap the axis-anchored spectrum ramps through"
                  >
                    {rampOpts(HEATMAP_COLORMAPS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              )}
              {plot.ridgeline?.spectrum && (
                <RampShapeRows
                  midpoint={plot.ridgeline?.spectrumMidpoint} gamma={plot.ridgeline?.spectrumGamma}
                  steps={plot.ridgeline?.spectrumSteps} space={plot.ridgeline?.spectrumSpace}
                  onChange={(pt) => onSetPlotOptions({ ridgeline: {
                    ...(plot.ridgeline ?? {}),
                    ...("midpoint" in pt ? { spectrumMidpoint: pt.midpoint } : {}),
                    ...("gamma" in pt ? { spectrumGamma: pt.gamma } : {}),
                    ...("steps" in pt ? { spectrumSteps: pt.steps } : {}),
                    ...("space" in pt ? { spectrumSpace: pt.space } : {}),
                  } })}
                />
              )}
            </>
          )}
          {kind === "floatingbar" && (
            <>
              <label className="frow">
                <span>Centre line</span>
                <select
                  className="selin"
                  value={plot.floatingBar?.line ?? "mean"}
                  onChange={(e) => onSetPlotOptions({ floatingBar: { ...(plot.floatingBar ?? {}), line: e.target.value as "mean" | "median" | "none" } })}
                >
                  <option value="mean">At the mean</option>
                  <option value="median">At the median</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label className="frow">
                <span>Orientation</span>
                <button
                  type="button"
                  className="btn-mini"
                  title="Flip between vertical and horizontal floating bars"
                  onClick={() => onSetPlotOptions({ barOrientation: (plot.barOrientation ?? "vertical") === "horizontal" ? "vertical" : "horizontal" })}
                >
                  {(plot.barOrientation ?? "vertical") === "horizontal" ? "↔ Horizontal" : "↕ Vertical"} — flip
                </button>
              </label>
            </>
          )}
          {kind === "estimation" && (
            <>
              <label className="frow">
                <span>Design</span>
                <select
                  className="selin"
                  value={plot.estimation?.paired ? "paired" : "unpaired"}
                  onChange={(e) => onSetPlotOptions({ estimation: { ...(plot.estimation ?? {}), paired: e.target.value === "paired" } })}
                >
                  <option value="unpaired">Unpaired (two groups)</option>
                  <option value="paired">Paired (per-subject)</option>
                </select>
              </label>
              <label className="frow">
                <span>CI level</span>
                <select
                  className="selin"
                  value={String(plot.estimation?.ciLevel ?? 0.95)}
                  onChange={(e) => onSetPlotOptions({ estimation: { ...(plot.estimation ?? {}), ciLevel: Number(e.target.value) } })}
                >
                  <option value="0.9">90%</option>
                  <option value="0.95">95%</option>
                  <option value="0.99">99%</option>
                </select>
              </label>
              <label className="frow">
                <span>Bootstrap resamples</span>
                <input
                  type="number"
                  className="selin"
                  min={200}
                  max={10000}
                  step={500}
                  value={plot.estimation?.resamples ?? 2000}
                  onChange={(e) => onSetPlotOptions({ estimation: { ...(plot.estimation ?? {}), resamples: Math.max(200, Math.min(10000, Number(e.target.value) || 2000)) } })}
                />
              </label>
              <label className="frow">
                <span>Seed</span>
                <input
                  type="number"
                  className="selin"
                  value={plot.estimation?.seed ?? 20240704}
                  onChange={(e) => onSetPlotOptions({ estimation: { ...(plot.estimation ?? {}), seed: Math.floor(Number(e.target.value) || 0) } })}
                />
              </label>
            </>
          )}
          {(kind ?? "xy") === "xy" && (
            <label className="frow" title="Draw the line of identity (y = x) — the diagonal a perfect X = Y agreement would follow, for method-comparison scatter (Deming / Passing-Bablok / any XY). Once on, style or hide it in the list below. Drawn only where the X and Y ranges overlap.">
              <span>Line of identity (y = x)</span>
              <input type="checkbox" aria-label="Show the line of identity" checked={plot.showIdentity === true} onChange={(e) => onSetPlotOptions({ showIdentity: e.target.checked })} />
            </label>
          )}
          {(kind ?? "xy") === "xy" && (
            <label className="frow" title="Bump chart: plot each series' rank among the series at every X (the largest value = rank 1), not its raw Y. The Y axis becomes a reversed integer ‘Rank’ axis. Turns a rankings-over-stages table into the classic bump chart, drawn as an ordinary line chart.">
              <span>Rank (bump) chart</span>
              <input type="checkbox" aria-label="Plot ranks (bump chart)" checked={plot.plotRanks === true} onChange={(e) => onSetPlotOptions({ plotRanks: e.target.checked })} />
            </label>
          )}
          {referenceLinesFor(kind, plot).length > 0 && (
            <label className="frow" title="Colour + visibility of all this chart's reference/threshold lines at once — here the EC50 / IC50 potency crosshair (the drop-line to the dose axis), and the volcano/ROC/forest/Bland-Altman/PCA/pyramid/estimation guide lines elsewhere. Click a line on the graph to style it on its own.">
              <span>{referenceLinesFor(kind, plot).every((r) => r.id === "fit-marker") ? "EC50 / IC50 marker" : "Reference lines"}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" aria-label="Show reference lines" checked={plot.refLine?.show !== false} onChange={(e) => onSetPlotOptions({ refLine: { ...(plot.refLine ?? {}), show: e.target.checked } })} />
                <ColorInput value={plot.refLine?.color ?? "#9aa0aa"} aria-label="Reference line colour" onChange={(c) => onSetPlotOptions({ refLine: { ...(plot.refLine ?? {}), color: c } })} />
              </span>
            </label>
          )}
          {/* The lines themselves, one row each. Clicking a line on the graph opens the same
              panel; this list is here because a guide line is a small target and, until one
              has been clicked, nothing shows that it is an object at all. Each row is
              {hide switch, name, open}. */}
          {referenceLinesFor(kind, plot).length > 0 && (
            <>
              <p className="hint" style={{ margin: "8px 0 2px" }}>
                Each line — click one on the graph, or here, for its colour, thickness and dashes.
              </p>
              {/* Note: the line's name is the button that opens it, and there is no leading
                  `<span>` on the row. Both are deliberate: `function-matrix.test.tsx` names a
                  control by its row's first span, so a name-span would make the open button
                  and the show switch report as the same control — and the exemption needed for
                  the (navigation-only) button would then have blanket-exempted the switch too.
                  Names distinct → each is measured on its own. It is also the better target:
                  a hairline dashed rule on the canvas is hard to hit. */}
              {referenceLinesFor(kind, plot).map((r) => (
                <div className="frow" key={r.id} title={r.hint}>
                  <button
                    type="button"
                    className="linkrow"
                    aria-label={`Open ${r.name} (reference line)`}
                    onClick={() => onSelect({ kind: "refline", id: r.id })}
                  >
                    {r.name}
                  </button>
                  <input
                    type="checkbox"
                    aria-label={`Show ${r.name}`}
                    checked={!(plot.refLineHidden?.[r.id] ?? false)}
                    onChange={(e) => {
                      const next = { ...(plot.refLineHidden ?? {}) };
                      if (e.target.checked) delete next[r.id];
                      else next[r.id] = true;
                      onSetPlotOptions({ refLineHidden: Object.keys(next).length ? next : undefined });
                    }}
                  />
                </div>
              ))}
            </>
          )}
          {kind === "forest" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Columns: estimate · lower CI · upper CI (one study per row). Set the effect
                axis to a log scale from Axis → Scale for ratio measures (OR / RR / HR).
              </p>
              <label className="frow" title="Value where the vertical no-effect line is drawn. 1 for ratios (OR/RR/HR), 0 for differences. Blank = no line.">
                <span>Reference at</span>
                <input
                  type="number"
                  className="selin"
                  step="any"
                  value={plot.forest?.refValue == null ? "" : plot.forest.refValue}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    onSetPlotOptions({ forest: { ...(plot.forest ?? {}), refValue: raw === "" ? null : Number(raw) } });
                  }}
                />
              </label>
              <label className="frow" title="Scale each study's marker area by its inverse-variance weight (derived from the CI width).">
                <span>Weight markers</span>
                <input
                  type="checkbox"
                  checked={plot.forest?.weightMarkers ?? false}
                  onChange={(e) => onSetPlotOptions({ forest: { ...(plot.forest ?? {}), weightMarkers: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Draw a pooled inverse-variance summary diamond below the studies, tagged with the heterogeneity I².">
                <span>Pooled summary</span>
                <input
                  type="checkbox"
                  checked={plot.forest?.showSummary ?? false}
                  onChange={(e) => onSetPlotOptions({ forest: { ...(plot.forest ?? {}), showSummary: e.target.checked } })}
                />
              </label>
              {(plot.forest?.showSummary ?? false) && (
                <label className="frow" title="Pooling model for the summary diamond. Fixed-effect assumes a single true effect shared by all studies; random-effects (DerSimonian-Laird) lets the true effect vary between studies — a wider, usually more realistic interval when studies disagree (high I²).">
                  <span>Pooling model</span>
                  <select
                    className="selin"
                    value={plot.forest?.model ?? "fixed"}
                    onChange={(e) => onSetPlotOptions({ forest: { ...(plot.forest ?? {}), model: e.target.value as "fixed" | "random" } })}
                  >
                    <option value="fixed">Fixed-effect</option>
                    <option value="random">Random-effects (DL)</option>
                  </select>
                </label>
              )}
              {((plot.forest?.showSummary ?? false) || (plot.forest?.weightMarkers ?? false)) && (
                <label className="frow" title="The confidence level the entered lower/upper limits were computed at. It back-calculates each study's standard error for pooling and inverse-variance marker weights — set it to match how the study CIs were reported, or the weights (and pooled interval) are wrong.">
                  <span>Limits are</span>
                  <select
                    className="selin"
                    value={String(Math.round((plot.forest?.ciLevel ?? 0.95) * 100))}
                    onChange={(e) => onSetPlotOptions({ forest: { ...(plot.forest ?? {}), ciLevel: Number(e.target.value) / 100 } })}
                  >
                    <option value="90">90% CIs</option>
                    <option value="95">95% CIs</option>
                    <option value="99">99% CIs</option>
                  </select>
                </label>
              )}
            </>
          )}
          {kind === "funnel" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                The forest plot's publication-bias check, from the same columns: estimate ·
                lower CI · upper CI. Each study plots at (effect, standard error) with SE 0 at
                the top; without bias the cloud fills the funnel symmetrically. Set the effect
                axis to a log scale from Axis → Scale for ratio measures (OR / RR / HR).
              </p>
              <label className="frow" title="Pooling model for the centre line and the funnel apex. Fixed-effect assumes a single true effect; random-effects (DerSimonian-Laird) lets it vary between studies.">
                <span>Model</span>
                <select
                  className="selin"
                  value={plot.funnel?.model ?? "fixed"}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), model: e.target.value as "fixed" | "random" } })}
                >
                  <option value="fixed">Fixed-effect</option>
                  <option value="random">Random-effects (DL)</option>
                </select>
              </label>
              <label className="frow" title="The confidence level the entered CIs were computed at — it back-calculates each study's standard error and sets the pseudo-CI funnel's slope. Match how the study CIs were reported.">
                <span>Region level</span>
                <select
                  className="selin"
                  value={String(Math.round((plot.funnel?.ciLevel ?? 0.95) * 100))}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), ciLevel: Number(e.target.value) / 100 } })}
                >
                  <option value="90">90%</option>
                  <option value="95">95%</option>
                  <option value="99">99%</option>
                </select>
              </label>
              <label className="frow" title="Shade the pseudo-CI triangle around the pooled effect — the funnel studies should fill symmetrically in the absence of bias.">
                <span>Show region</span>
                <input
                  type="checkbox"
                  checked={plot.funnel?.showRegion ?? true}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), showRegion: e.target.checked } })}
                />
              </label>
              {(plot.funnel?.showRegion ?? true) && (
                <label className="frow" title="How strongly the pseudo-CI region is shaded (0–1).">
                  <span>Region opacity</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="range" min={0.02} max={0.4} step={0.02} value={plot.funnel?.regionOpacity ?? 0.08} onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), regionOpacity: Number(e.target.value) } })} />
                    <span style={{ width: 32, textAlign: "right" }}>{(plot.funnel?.regionOpacity ?? 0.08).toFixed(2)}</span>
                  </span>
                </label>
              )}
              <label className="frow" title="Contour-enhanced mode: shade significance bands (p .10 / .05 / .01) centred on zero instead of the pooled effect — shows whether any asymmetry sits in significant or non-significant territory. Replaces the pooled-centred region while on. Needs a linear effect axis (zero must exist).">
                <span>Contours</span>
                <input
                  type="checkbox"
                  checked={plot.funnel?.contour ?? false}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), contour: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Draw the dashed pooled-effect centre line. Its colour/dash live under Reference lines like every other built line.">
                <span>Pooled line</span>
                <input
                  type="checkbox"
                  checked={plot.funnel?.showPooled ?? true}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), showPooled: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Duval-Tweedie trim-and-fill: estimate how many small studies the lopsided funnel is missing, draw them as hollow mirrored dots, and mark the adjusted pooled effect with a second (dotted) centre line. A sensitivity view — the Publication bias analysis reports the numbers.">
                <span>Trim-and-fill</span>
                <input
                  type="checkbox"
                  checked={plot.funnel?.trimFill ?? false}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), trimFill: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Scale each study dot's area by its inverse-variance weight (precise studies draw bigger) — the forest plot's marker-weighting rule.">
                <span>Size by precision</span>
                <input
                  type="checkbox"
                  checked={plot.funnel?.sizeByPrecision ?? false}
                  onChange={(e) => onSetPlotOptions({ funnel: { ...(plot.funnel ?? {}), sizeByPrecision: e.target.checked } })}
                />
              </label>
            </>
          )}
          {kind === "rose" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                The first value column is an angle in degrees (values wrap — −5° reads as
                355°), binned into equal sectors. A second value column stacks each wedge
                into magnitude bands — the wind rose. Wedges are bins: click one to edit
                this section&apos;s options.
              </p>
              <label className="frow" title="Number of angular bins the circle is divided into.">
                <span>Sectors</span>
                <select
                  className="selin"
                  value={String(plot.rose?.sectors ?? 16)}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), sectors: Number(e.target.value) } })}
                >
                  <option value="4">4</option>
                  <option value="8">8</option>
                  <option value="12">12</option>
                  <option value="16">16</option>
                  <option value="24">24</option>
                  <option value="36">36</option>
                </select>
              </label>
              <label className="frow" title="Number of magnitude bands each wedge stacks into (needs a second value column). Band edges run in equal steps from 0 to the largest magnitude.">
                <span>Bands</span>
                <select
                  className="selin"
                  value={String(plot.rose?.bands ?? 4)}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), bands: Number(e.target.value) } })}
                >
                  <option value="1">1 (off)</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                </select>
              </label>
              <label className="frow" title="Ticked (the wind convention): 0° is North at the top and angles run clockwise, with N/NE/E… labels. Un-ticked (the mathematical convention): 0° is East and angles run counterclockwise, with degree labels.">
                <span>Compass (N up)</span>
                <input
                  type="checkbox"
                  checked={plot.rose?.compass ?? true}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), compass: e.target.checked } })}
                />
              </label>
              {/* The count rings' own look (the rings are clickable and editable) — like
                  the radar's rings; clicking a ring on the graph opens this section. */}
              <label className="frow" title="Draw the count rings. Their numbers stay either way.">
                <span>Show rings</span>
                <input type="checkbox" checked={plot.rose?.ringShow ?? true}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), ringShow: e.target.checked } })} />
              </label>
              <label className="frow">
                <span>Ring colour</span>
                <ColorInput className="colorin" value={plot.rose?.ringColor ?? "#e4e7ea"} aria-label="Ring colour"
                  onChange={(c) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), ringColor: c } })} />
              </label>
              <label className="frow">
                <span>Ring width</span>
                <input type="number" className="numin" min={0.25} max={6} step={0.25} value={plot.rose?.ringWidth ?? 1}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), ringWidth: Number(e.target.value) } })} />
              </label>
              <label className="frow">
                <span>Ring dashes</span>
                <select className="selin" value={plot.rose?.ringDash ?? "solid"}
                  onChange={(e) => onSetPlotOptions({ rose: { ...(plot.rose ?? {}), ringDash: e.target.value as LineDash } })}>
                  {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              {(() => {
                // The wedges' base colour = the angle column's series colour; with the Data
                // rail dead for a bins-not-series kind, this is the control that reaches it.
                const angleId = table ? tableDatasets(table)[0]?.id : undefined;
                if (!angleId) return null;
                // One colour per magnitude band (so the colours can be picked), each showing the
                // colour drawn — its own, or its shade of the Wedge colour — with a reset while it has its own.
                const ranges = table ? buildPlotScene(table, plot, { width: 620, height: 420 }).rose?.bandRanges ?? [] : [];
                const own = plot.rose?.bandColors ?? {};
                const setBand = (bi: number, c: string | undefined): void => {
                  const next = { ...own };
                  if (c === undefined) delete next[String(bi)];
                  else next[String(bi)] = c;
                  onSetPlotOptions({ rose: { ...(plot.rose ?? {}), bandColors: Object.keys(next).length ? next : undefined } });
                };
                const fmt = (v: number): string => String(Number(v.toFixed(2)));
                return (
                  <>
                    <label className="frow" title="Base colour of the wedges; magnitude bands ramp from a light tint to a dark shade of it.">
                      <span>Wedge colour</span>
                      <ColorInput className="colorin" value={plot.seriesStyles?.[angleId]?.color ?? seriesColor(0)} aria-label="Wedge colour" onChange={(c) => onSetSeriesStyle(angleId, { color: c })} />
                    </label>
                    {ranges.length > 1 && ranges.map((b, bi) => (
                      <label key={bi} className="frow" title="This magnitude band's colour. Reset it to take its shade of the Wedge colour again.">
                        <span>{`Band ${fmt(b.lo)}–${fmt(b.hi)}`}</span>
                        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <ColorInput className="colorin" value={b.color} aria-label={`Band colour ${bi + 1}`} onChange={(c) => setBand(bi, c)} />
                          {own[String(bi)] !== undefined && (
                            <button type="button" className="swbtn" title={`Band colour ${bi + 1}: back to its shade`} onClick={() => setBand(bi, undefined)}>⨯</button>
                          )}
                        </span>
                      </label>
                    ))}
                  </>
                );
              })()}
            </>
          )}
          {kind === "tracks" && (() => {
            const tk = plot.tracks ?? {};
            const setTk = (patch: Partial<typeof tk>): void => onSetPlotOptions({ tracks: { ...tk, ...patch } });
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  The first column is the shared time (x) axis; every other column is a track
                  strip. A numeric column ramps on its own scale (its own colour bar); a text
                  column becomes a categorical strip (a hue per label, keyed in the legend).
                  Drop this graph and another time-axis chart into a figure to stack them.
                </p>
                <label className="frow" title="Fixed height of each track strip, in pixels. Blank = share the plot height evenly across all tracks.">
                  <span>Track height</span>
                  <input
                    type="number"
                    className="numin"
                    placeholder="auto"
                    min={4}
                    value={tk.trackHeight ?? ""}
                    onChange={(e) => setTk({ trackHeight: e.target.value.trim() === "" ? undefined : Math.max(1, Number(e.target.value)) })}
                  />
                </label>
                <label className="frow" title="Vertical gap between adjacent track strips, in pixels.">
                  <span>Track gap</span>
                  <input type="number" className="numin" min={0} max={40} value={tk.trackGap ?? 4} onChange={(e) => setTk({ trackGap: Math.max(0, Number(e.target.value)) })} />
                </label>
                <label className="frow" title="Gap between adjacent tiles within a track, in pixels. 0 = a seamless run of tiles.">
                  <span>Tile gap</span>
                  <input type="number" className="numin" min={0} max={20} value={tk.tileGap ?? 0} onChange={(e) => setTk({ tileGap: Math.max(0, Number(e.target.value)) })} />
                </label>
                <label className="frow" title="Show the track-name labels down the left (category) axis.">
                  <span>Track labels</span>
                  <input type="checkbox" checked={tk.showTrackLabels ?? true} onChange={(e) => setTk({ showTrackLabels: e.target.checked })} />
                </label>
                <label className="frow" title="Colour ramp used by numeric tracks that don't set their own (each track still ramps on its own min/max).">
                  <span>Numeric colormap</span>
                  <select className="selin" value={tk.colormap ?? "viridis"}
                    onChange={(e) => pickRamp(e.target.value, tk.colormap ?? "viridis", (ref) => setTk({ colormap: ref as typeof tk.colormap }))}>
                    {rampOpts(HEATMAP_COLORMAPS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <RampShapeRows
                  midpoint={tk.colorMidpoint} gamma={tk.colorGamma} steps={tk.colorSteps} space={tk.colorSpace}
                  onChange={(pt) => setTk({
                    ...("midpoint" in pt ? { colorMidpoint: pt.midpoint } : {}),
                    ...("gamma" in pt ? { colorGamma: pt.gamma } : {}),
                    ...("steps" in pt ? { colorSteps: pt.steps } : {}),
                    ...("space" in pt ? { colorSpace: pt.space } : {}),
                  })}
                />
                <label className="frow" title="On: fill a missing cell with a flat colour. Off: leave a gap in the strip (no data at that time).">
                  <span>Fill gaps</span>
                  <input type="checkbox" checked={tk.fillGaps ?? false} onChange={(e) => setTk({ fillGaps: e.target.checked })} />
                </label>
                {(tk.fillGaps ?? false) && (
                  <label className="frow" title="Colour drawn for a missing cell when Fill gaps is on.">
                    <span>Gap colour</span>
                    <ColorInput className="colorin" value={tk.nanColor ?? "#dddddd"} aria-label="Gap colour" onChange={(c) => setTk({ nanColor: c })} />
                  </label>
                )}
              </>
            );
          })()}
          {kind === "qq" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Observed vs expected −log₁₀ p-values against the uniform null. Points hug the
                y = x line until real associations pull away at the top; the genomic inflation
                factor λ (1.0 = well-calibrated) rides in the legend.
              </p>
              <label className="frow" title="Which column holds the association P-values. Default: the P column of an association sheet, else the last numeric column.">
                <span>P-value column</span>
                <select
                  className="selin"
                  value={plot.qq?.pColumn ?? ""}
                  onChange={(e) => onSetPlotOptions({ qq: { ...(plot.qq ?? {}), pColumn: e.target.value || undefined } })}
                >
                  <option value="">Auto</option>
                  {table.columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="frow" title="Draw the y = x null reference line. Once on, click it on the graph to style it (colour / thickness / dashes).">
                <span>y = x line</span>
                <input type="checkbox" checked={plot.qq?.showIdentityLine ?? true} onChange={(e) => onSetPlotOptions({ qq: { ...(plot.qq ?? {}), showIdentityLine: e.target.checked } })} />
              </label>
              <label className="frow" title="Print the genomic inflation factor λ = median(χ²₁)/0.4549 in the legend (1.0 = calibrated, >1 = inflation).">
                <span>Show λ (inflation)</span>
                <input type="checkbox" checked={plot.qq?.showLambda ?? true} onChange={(e) => onSetPlotOptions({ qq: { ...(plot.qq ?? {}), showLambda: e.target.checked } })} />
              </label>
            </>
          )}
          {kind === "manhattan" && (() => {
            const m = plot.manhattan ?? {};
            const setM = (patch: Partial<NonNullable<Plot["manhattan"]>>) => onSetPlotOptions({ manhattan: { ...m, ...patch } });
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  −log₁₀ p for every marker along the genome. Chromosomes are laid end to end and
                  shaded in two alternating tones; the genome-wide and suggestive lines mark
                  significance. The dense sub-threshold cloud is thinned to the pixel grid so a
                  genome-scale scatter still draws — peaks are always kept whole.
                </p>
                <label className="frow" title="Which column holds the P-values. Default: the P column of an association sheet (last numeric).">
                  <span>P-value column</span>
                  <select className="selin" value={m.pColumn ?? ""} onChange={(e) => setM({ pColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Which column holds each marker's chromosome. Default: the Chromosome column.">
                  <span>Chromosome column</span>
                  <select className="selin" value={m.chrColumn ?? ""} onChange={(e) => setM({ chrColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Which column holds each marker's base-pair position. Default: the Position column.">
                  <span>Position column</span>
                  <select className="selin" value={m.posColumn ?? ""} onChange={(e) => setM({ posColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Draw the genome-wide significance line. Once on, click it on the graph to style it.">
                  <span>Genome-wide line</span>
                  <input type="checkbox" checked={m.genomeWideLine ?? true} onChange={(e) => setM({ genomeWideLine: e.target.checked })} />
                </label>
                <label className="frow" title="Genome-wide significance threshold (P-value); the line sits at −log10 of it. Default 5×10⁻⁸.">
                  <span>Genome-wide P</span>
                  <input type="number" className="numin" step="any" min={0} max={1} value={m.genomeWideP ?? 5e-8} onChange={(e) => setM({ genomeWideP: Number(e.target.value) || undefined })} />
                </label>
                <label className="frow" title="Draw the suggestive significance line. Once on, click it on the graph to style it.">
                  <span>Suggestive line</span>
                  <input type="checkbox" checked={m.suggestiveLine ?? true} onChange={(e) => setM({ suggestiveLine: e.target.checked })} />
                </label>
                <label className="frow" title="Suggestive significance threshold (P-value). Default 1×10⁻⁵.">
                  <span>Suggestive P</span>
                  <input type="number" className="numin" step="any" min={0} max={1} value={m.suggestiveP ?? 1e-5} onChange={(e) => setM({ suggestiveP: Number(e.target.value) || undefined })} />
                </label>
                <label className="frow" title="Colour for even-numbered chromosomes.">
                  <span>Chromosome colour A</span>
                  <ColorInput value={m.colorA ?? "#274060"} aria-label="Chromosome colour A" onChange={(c) => setM({ colorA: c })} />
                </label>
                <label className="frow" title="Colour for odd-numbered chromosomes.">
                  <span>Chromosome colour B</span>
                  <ColorInput value={m.colorB ?? "#7b93b8"} aria-label="Chromosome colour B" onChange={(c) => setM({ colorB: c })} />
                </label>
                <label className="frow" title="Thin the dense sub-threshold cloud to the pixel grid so a genome-scale scatter (10⁵–10⁶ markers) still draws quickly. Peaks above the kept threshold are never thinned.">
                  <span>Thin dense cloud</span>
                  <input type="checkbox" checked={m.decimate ?? true} onChange={(e) => setM({ decimate: e.target.checked })} />
                </label>
                <label className="frow" title="Keep every marker at or above this −log10(p) un-thinned (the interesting peaks). Default 2 (p ≤ 0.01).">
                  <span>Keep above −log₁₀ p</span>
                  <input type="number" className="numin" step="any" min={0} value={m.keepAbove ?? 2} onChange={(e) => setM({ keepAbove: Number(e.target.value) })} />
                </label>
              </>
            );
          })()}
          {kind === "ternary" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Each row is a 3-part composition — the first three value columns, normalized
                per row (percentages, fractions or raw amounts all work). Click a point to
                style it; double-click an edge title to rename its column. The triangular
                grid follows the Grid section on the Frame tab.
              </p>
              <label className="frow" title="Edge tick labels read 0–100 (percent). Un-tick for 0–1 fractions.">
                <span>Percent labels</span>
                <input
                  type="checkbox"
                  checked={plot.ternary?.percent ?? true}
                  onChange={(e) => onSetPlotOptions({ ternary: { ...(plot.ternary ?? {}), percent: e.target.checked } })}
                />
              </label>
              {/* The three edge names are lettered with the X-axis title font, and the ternary's Axis tab is
                  greyed — so their size is set here, and clicking one opens this control. The same
                  FontControls + per-axis handler the heatmap's titles use. */}
              <FontControls
                label="Edge name font"
                element="axisTitle"
                spec={axisTitleFontSpec(plot, "x")}
                defaultSize={15}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => onSetAxisTitleFont("x", patch)}
              />
            </>
          )}
          {kind === "sunburst" && (() => {
            const su = plot.sunburst ?? {};
            const setSu = (patch: Partial<NonNullable<Plot["sunburst"]>>) => onSetPlotOptions({ sunburst: { ...su, ...patch } });
            const chosenLevels = new Set(su.levelColumns ?? []);
            const toggleLevel = (id: NodeId) => {
              const next = (su.levelColumns ?? []).includes(id)
                ? (su.levelColumns ?? []).filter((x) => x !== id)
                : [...(su.levelColumns ?? []), id];
              setSu({ levelColumns: next.length ? next : undefined });
            };
            const level1Id = (su.levelColumns ?? []).find((id) => table.columns.some((c) => c.id === id))
              ?? table.columns.find((c) => table.rows.some((r) => { const v = r.cells[c.id]; return v != null && String(v).trim() !== "" && !Number.isFinite(Number(v)); }))?.id
              ?? table.columns[0]?.id;
            const branches = level1Id ? [...new Set(table.rows.map((r) => String(r.cells[level1Id] ?? "").trim()).filter(Boolean))] : [];
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  The leading category columns are the hierarchy levels (inner ring = level 1);
                  a value column (or the row count) sizes each leaf. Each segment sweeps its share
                  of the whole. Recolour a top-level branch below — its colour flows to the rings
                  inside it.
                </p>
                {branches.length > 0 && branches.length <= 40 && (
                  <div className="frow" style={{ alignItems: "flex-start" }}>
                    <span title="Recolour one top-level branch; the rings inside it inherit the hue (shaded lighter toward the leaves).">Branch colours</span>
                    <div className="angroups" style={{ maxHeight: 150 }}>
                      {branches.map((b, i) => (
                        <label className="angroup" key={b} style={{ justifyContent: "space-between", gap: 6 }}>
                          <span>{b}</span>
                          <ColorInput value={plot.seriesStyles?.[b]?.color ?? seriesColor(i)} aria-label={`${b} colour`} onChange={(col) => onSetSeriesStyle(b, { color: col })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="frow" style={{ alignItems: "flex-start" }}>
                  <span title="Which columns are the ring levels, inner→outer (checked order). None checked = auto (every leading text column).">Levels</span>
                  <div className="angroups" style={{ maxHeight: 130 }}>
                    {table.columns.map((c) => (
                      <label className="angroup" key={c.id}>
                        <input type="checkbox" checked={chosenLevels.has(c.id)} onChange={() => toggleLevel(c.id)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="frow" title="Column whose number sizes each leaf. Auto = the first numeric column after the level columns; none = every row counts as 1.">
                  <span>Value column</span>
                  <select className="selin" value={su.valueColumn ?? ""} onChange={(e) => setSu({ valueColumn: e.target.value || undefined })}>
                    <option value="">Auto / count</option>
                    {table.columns.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Append each segment's percentage after its label.">
                  <span>Show %</span>
                  <input type="checkbox" checked={su.showValues === true} onChange={(e) => setSu({ showValues: e.target.checked })} />
                </label>
                <label className="frow" title="Draw each segment's category label along its arc (only where it fits).">
                  <span>Segment labels</span>
                  <input type="checkbox" checked={su.showLabels !== false} onChange={(e) => setSu({ showLabels: e.target.checked })} />
                </label>
                <label className="frow" title="Empty centre hole as a fraction of the radius (0 = full pie, 0.4 = a donut).">
                  <span>Centre hole</span>
                  <input type="number" className="numin" step={0.05} min={0} max={0.8} value={su.innerRadius ?? 0} onChange={(e) => setSu({ innerRadius: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Angular gap between neighbouring segments, in degrees (0 = touching).">
                  <span>Segment gap (°)</span>
                  <input type="number" className="numin" step={0.5} min={0} max={5} value={su.padAngle ?? 0} onChange={(e) => setSu({ padAngle: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Base label font size (px); blank = the theme tick size.">
                  <span>Label size</span>
                  <input type="number" className="numin" step={1} min={6} max={40} value={su.labelSize ?? ""} onChange={(e) => setSu({ labelSize: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label className="frow" title="Segment border colour.">
                  <span>Border colour</span>
                  <ColorInput value={su.stroke ?? "#ffffff"} aria-label="Segment border colour" onChange={(c) => setSu({ stroke: c })} />
                </label>
                <label className="frow" title="Segment border width (px).">
                  <span>Border width</span>
                  <input type="number" className="numin" step={0.5} min={0} max={6} value={su.strokeWidth ?? 1} onChange={(e) => setSu({ strokeWidth: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Segment fill opacity (0–1).">
                  <span>Fill opacity</span>
                  <input type="number" className="numin" step={0.05} min={0.1} max={1} value={su.fillOpacity ?? 1} onChange={(e) => setSu({ fillOpacity: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Print the grand total in the centre hole (needs a non-zero centre hole).">
                  <span>Show total</span>
                  <input type="checkbox" checked={su.showTotal === true} onChange={(e) => setSu({ showTotal: e.target.checked })} />
                </label>
              </>
            );
          })()}
          {kind === "chord" && (() => {
            const c = plot.chord ?? {};
            const setC = (patch: Partial<NonNullable<Plot["chord"]>>) => onSetPlotOptions({ chord: { ...c, ...patch } });
            const srcC = table.columns.find((x) => x.id === c.sourceColumn) ?? table.columns[0];
            const tgtC = table.columns.find((x) => x.id === c.targetColumn) ?? table.columns[1];
            const nodes = [...new Set([
              ...(srcC ? table.rows.map((r) => String(r.cells[srcC.id] ?? "").trim()) : []),
              ...(tgtC ? table.rows.map((r) => String(r.cells[tgtC.id] ?? "").trim()) : []),
            ].filter(Boolean))];
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Each entity is an arc sized by its total incident weight; a weighted link is a
                  ribbon between two arcs. Reads an edge list (Source · Target · Weight) or a square
                  adjacency matrix. Recolour a node below (or colour all nodes by a group column).
                </p>
                {nodes.length > 0 && nodes.length <= 40 && (
                  <div className="frow" style={{ alignItems: "flex-start" }}>
                    <span title="Recolour one node's arc; its ribbons follow when 'Colour ribbons by source' is on.">Node colours</span>
                    <div className="angroups" style={{ maxHeight: 150 }}>
                      {nodes.map((n, i) => (
                        <label className="angroup" key={n} style={{ justifyContent: "space-between", gap: 6 }}>
                          <span>{n}</span>
                          <ColorInput value={plot.seriesStyles?.[n]?.color ?? seriesColor(i)} aria-label={`${n} colour`} onChange={(col) => onSetSeriesStyle(n, { color: col })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <label className="frow" title="Column holding the link source. Auto = the first text column.">
                  <span>Source column</span>
                  <select className="selin" value={c.sourceColumn ?? ""} onChange={(e) => setC({ sourceColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Column holding the link target. Auto = the second text column.">
                  <span>Target column</span>
                  <select className="selin" value={c.targetColumn ?? ""} onChange={(e) => setC({ targetColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Column holding the link weight. Auto = the first numeric column; missing = 1.">
                  <span>Weight column</span>
                  <select className="selin" value={c.weightColumn ?? ""} onChange={(e) => setC({ weightColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Colour node arcs by a category column (a node's group travels with its first appearance as a source).">
                  <span>Group column</span>
                  <select className="selin" value={c.groupColumn ?? ""} onChange={(e) => setC({ groupColumn: e.target.value || undefined })}>
                    <option value="">None</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Order the nodes around the ring.">
                  <span>Node order</span>
                  <select className="selin" value={c.order ?? "input"} onChange={(e) => setC({ order: e.target.value as "input" | "weight" | "name" })}>
                    <option value="input">As entered</option>
                    <option value="weight">By weight</option>
                    <option value="name">By name</option>
                  </select>
                </label>
                <label className="frow" title="Colour each ribbon by its source node's hue (un-tick for neutral grey).">
                  <span>Colour ribbons by source</span>
                  <input type="checkbox" checked={c.colorBySource !== false} onChange={(e) => setC({ colorBySource: e.target.checked })} />
                </label>
                <label className="frow" title="Draw each node's name outside its arc.">
                  <span>Node labels</span>
                  <input type="checkbox" checked={c.showLabels !== false} onChange={(e) => setC({ showLabels: e.target.checked })} />
                </label>
                <label className="frow" title="Gap between adjacent node arcs, in degrees.">
                  <span>Arc gap (°)</span>
                  <input type="number" className="numin" step={0.5} min={0} max={10} value={c.padAngle ?? 2} onChange={(e) => setC({ padAngle: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Radial thickness of the node ring, as a fraction of the radius.">
                  <span>Arc thickness</span>
                  <input type="number" className="numin" step={0.01} min={0.02} max={0.2} value={c.arcThickness ?? 0.08} onChange={(e) => setC({ arcThickness: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Ribbon fill opacity (0–1).">
                  <span>Ribbon opacity</span>
                  <input type="number" className="numin" step={0.05} min={0.1} max={1} value={c.ribbonOpacity ?? 0.65} onChange={(e) => setC({ ribbonOpacity: Number(e.target.value) })} />
                </label>
                <label className="frow" title="Node-label font size (px); blank = the theme tick size.">
                  <span>Label size</span>
                  <input type="number" className="numin" step={1} min={6} max={40} value={c.labelSize ?? ""} onChange={(e) => setC({ labelSize: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </>
            );
          })()}
          {kind === "oncoprint" && (() => {
            const o = plot.oncoprint ?? {};
            const setO = (patch: Partial<NonNullable<Plot["oncoprint"]>>) => onSetPlotOptions({ oncoprint: { ...o, ...patch } });
            const altCol = table.columns.find((c) => c.id === o.alterationColumn) ?? table.columns[2];
            const types = altCol ? [...new Set(table.rows.map((r) => String(r.cells[altCol.id] ?? "").trim()).filter(Boolean))] : [];
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Genes down the rows, samples across the columns, each cell coloured by its
                  alteration type. Reads an alterations sheet — one row per Sample · Gene ·
                  Alteration event; a cell with several alterations stacks them.
                </p>
                <label className="frow" title="Column holding each event's sample. Auto = the first column.">
                  <span>Sample column</span>
                  <select className="selin" value={o.sampleColumn ?? ""} onChange={(e) => setO({ sampleColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Column holding each event's gene. Auto = the second column.">
                  <span>Gene column</span>
                  <select className="selin" value={o.geneColumn ?? ""} onChange={(e) => setO({ geneColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Column holding the alteration type. Auto = the third column.">
                  <span>Alteration column</span>
                  <select className="selin" value={o.alterationColumn ?? ""} onChange={(e) => setO({ alterationColumn: e.target.value || undefined })}>
                    <option value="">Auto</option>
                    {table.columns.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
                  </select>
                </label>
                <label className="frow" title="Order the gene rows.">
                  <span>Gene order</span>
                  <select className="selin" value={o.geneSort ?? "freq"} onChange={(e) => setO({ geneSort: e.target.value as "freq" | "input" })}>
                    <option value="freq">By frequency</option>
                    <option value="input">As entered</option>
                  </select>
                </label>
                <label className="frow" title="Order the sample columns. Staircase sorts the samples so the altered cells form a descending staircase, gene by gene.">
                  <span>Sample order</span>
                  <select className="selin" value={o.sampleSort ?? "memo"} onChange={(e) => setO({ sampleSort: e.target.value as "memo" | "input" })}>
                    <option value="memo">Staircase</option>
                    <option value="input">As entered</option>
                  </select>
                </label>
                <label className="frow" title="Print each gene's altered-sample percentage at the right of its row.">
                  <span>Show %</span>
                  <input type="checkbox" checked={o.showPercent !== false} onChange={(e) => setO({ showPercent: e.target.checked })} />
                </label>
                <label className="frow" title="Draw the sample names under the columns (off by default — a cohort has hundreds).">
                  <span>Sample labels</span>
                  <input type="checkbox" checked={o.showSampleLabels === true} onChange={(e) => setO({ showSampleLabels: e.target.checked })} />
                </label>
                <label className="frow" title="Gap between tiles as a fraction of the cell.">
                  <span>Tile gap</span>
                  <input type="number" className="numin" step={0.05} min={0} max={0.5} value={o.tileGap ?? 0.15} onChange={(e) => setO({ tileGap: Number(e.target.value) })} />
                </label>
                {/* The gaps' colour — offered only while there is a gap to show it. */}
                {(o.tileGap ?? 0.15) > 0 && (
                  <label className="frow" title="Colour of the gaps between tiles. Reset it to let the background show through again.">
                    <span>Gap colour</span>
                    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <ColorInput value={o.gapColor ?? "#ffffff"} aria-label="Gap colour" onChange={(c) => setO({ gapColor: c })} />
                      {o.gapColor !== undefined && (
                        <button type="button" className="swbtn" title="Gap colour: back to see-through" onClick={() => setO({ gapColor: undefined })}>⨯</button>
                      )}
                    </span>
                  </label>
                )}
                <label className="frow" title="Background colour of an unaltered cell.">
                  <span>Empty cell colour</span>
                  <ColorInput value={o.emptyColor ?? "#eceef1"} aria-label="Empty cell colour" onChange={(c) => setO({ emptyColor: c })} />
                </label>
                {types.length > 0 && (
                  <div className="frow" style={{ alignItems: "flex-start" }}>
                    <span title="Recolour one alteration type — every tile of that type follows.">Type colours</span>
                    <div className="angroups" style={{ maxHeight: 150 }}>
                      {types.map((t, i) => (
                        <label className="angroup" key={t} style={{ justifyContent: "space-between", gap: 6 }}>
                          <span>{t}</span>
                          <ColorInput value={plot.seriesStyles?.[t]?.color ?? seriesColor(i)} aria-label={`${t} colour`} onChange={(c) => onSetSeriesStyle(t, { color: c })} />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <label className="frow" title="Row/column label font size (px); blank = the theme tick size.">
                  <span>Label size</span>
                  <input type="number" className="numin" step={1} min={6} max={40} value={o.labelSize ?? ""} onChange={(e) => setO({ labelSize: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </>
            );
          })()}
          {kind === "venn" && (() => {
            const v = plot.venn ?? {};
            const set = (patch: Partial<NonNullable<Plot["venn"]>>) => onSetPlotOptions({ venn: { ...v, ...patch } });
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Row = item, one column per set — any non-empty, non-zero cell makes the item a
                  member. Up to three sets; the UpSet plot shows more. Click a circle to
                  recolour that set; double-click its label to rename the column.
                </p>
                <label className="frow" title="Make circle areas proportional to the set sizes and overlaps to the intersection counts. Exact for two sets; a best-fit for three (the graph says so when circles cannot be faithful). Subsets nest and disjoint sets separate — the Euler behaviour.">
                  <span>Area-proportional</span>
                  <input type="checkbox" checked={v.proportional ?? false} onChange={(e) => set({ proportional: e.target.checked || undefined })} />
                </label>
                <label className="frow" title="Print each zone's item count.">
                  <span>Show counts</span>
                  <input type="checkbox" checked={v.showCounts ?? true} onChange={(e) => set({ showCounts: e.target.checked })} />
                </label>
                <label className="frow" title="Append each zone's share of the union, e.g. 12 (20%).">
                  <span>Percent of union</span>
                  <input type="checkbox" checked={v.showPercents ?? false} onChange={(e) => set({ showPercents: e.target.checked || undefined })} />
                </label>
                <label className="frow" title="How strongly each disc is filled — overlaps read by the colours blending.">
                  <span>Overlap opacity</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="range" min={0.1} max={0.8} step={0.05} value={v.fillOpacity ?? 0.35} onChange={(e) => set({ fillOpacity: Number(e.target.value) })} />
                    <span style={{ width: 32, textAlign: "right" }}>{(v.fillOpacity ?? 0.35).toFixed(2)}</span>
                  </span>
                </label>
                <label className="frow" title="Circle outline width (0 = none).">
                  <span>Outline</span>
                  <input type="number" className="numin" style={{ width: 52 }} min={0} max={8} step={0.5} value={v.outlineWidth ?? 1.5} onChange={(e) => set({ outlineWidth: Number(e.target.value) })} />
                </label>
                <label className="frow" title="One outline colour for every circle; empty = each set's own colour.">
                  <span>Outline colour</span>
                  <ColorInput value={v.outlineColor ?? ""} onChange={(c) => set({ outlineColor: c || undefined })} />
                </label>
              </>
            );
          })()}
          {kind === "upset" && (() => {
            const u = plot.upset ?? {};
            const set = (patch: Partial<NonNullable<Plot["upset"]>>) => onSetPlotOptions({ upset: { ...u, ...patch } });
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  Same membership sheet as the Venn (row = item, one column per set), any
                  number of sets: bars = how many items fall in exactly that combination,
                  dots = which sets the combination is. Click a set-size bar to recolour
                  that set; double-click its label to rename the column.
                </p>
                <label className="frow" title='"Size" = largest intersection first (the classic look). "Degree" = single sets first, then pairs, then triples…'>
                  <span>Sort by</span>
                  <select value={u.sortBy ?? "size"} onChange={(e) => set({ sortBy: e.target.value === "degree" ? "degree" : "size" })}>
                    <option value="size">Size (largest first)</option>
                    <option value="degree">Degree (singles first)</option>
                  </select>
                </label>
                <label className="frow" title="Show at most this many intersection columns. When some are left out, the graph says so.">
                  <span>Max intersections</span>
                  <input type="number" className="numin" style={{ width: 52 }} min={1} max={100} step={1} value={u.maxIntersections ?? 15} onChange={(e) => set({ maxIntersections: Math.max(1, Number(e.target.value) || 15) })} />
                </label>
                <label className="frow" title="Hide intersections with fewer items than this.">
                  <span>Min size</span>
                  <input type="number" className="numin" style={{ width: 52 }} min={0} step={1} value={u.minSize ?? 0} onChange={(e) => set({ minSize: Math.max(0, Number(e.target.value) || 0) || undefined })} />
                </label>
                <label className="frow" title="Also draw the set combinations that have NO items (all of them, still capped above).">
                  <span>Empty intersections</span>
                  <input type="checkbox" checked={u.showEmpty ?? false} onChange={(e) => set({ showEmpty: e.target.checked || undefined })} />
                </label>
                <label className="frow" title="Per-set total-size bars at the left of the matrix.">
                  <span>Set-size bars</span>
                  <input type="checkbox" checked={u.showSetSizes ?? true} onChange={(e) => set({ showSetSizes: e.target.checked })} />
                </label>
                <label className="frow" title="Print each intersection's count above its bar (the standard bar value labels). Move them up or down with Count shift.">
                  <span>Counts above bars</span>
                  <input type="checkbox" checked={plot.showValues ?? false} onChange={(e) => onSetPlotOptions({ showValues: e.target.checked })} />
                </label>
                {/* The shift is offered here because the bar value-label rows never show on an
                    UpSet chart. */}
                {plot.showValues && <ValueShiftRow label="Count shift" plot={plot} onSetPlotOptions={onSetPlotOptions} />}
                {plot.showValues && <ValuePositionRow label="Count position" plot={plot} onSetPlotOptions={onSetPlotOptions} />}
                <label className="frow" title="One colour for every intersection bar.">
                  <span>Bar colour</span>
                  <ColorInput value={u.barColor ?? "#454c54"} onChange={(c) => set({ barColor: c || undefined })} />
                </label>
                <label className="frow" title="Colour of the membership dots and connectors (a set's own Series colour overrides it for that row).">
                  <span>Dot colour</span>
                  <ColorInput value={u.dotColor ?? "#454c54"} onChange={(c) => set({ dotColor: c || undefined })} />
                </label>
                <UpsetBarStyleRows plot={plot} table={table} onSetBarShape={onSetBarShape} onSetPlotOptions={onSetPlotOptions} onSetSeriesStyle={onSetSeriesStyle} onSetPointStyle={onSetPointStyle} />
              </>
            );
          })()}
          {kind === "swimmer" && (() => {
            const sw = plot.swimmer ?? {};
            const set = (patch: Partial<NonNullable<Plot["swimmer"]>>) => onSetPlotOptions({ swimmer: { ...sw, ...patch } });
            return (
              <>
                <p className="hint" style={{ margin: "2px 0 6px" }}>
                  One row per subject: Start and End are the first two numeric columns (or the
                  survival date pair, drawn as elapsed time); columns named "Response start" /
                  "Response end" fill the in-bar interval, "Ongoing" draws the arrow, and every
                  other numeric column is an event-glyph series with the ordinary Series
                  controls. Colour the Start series from a Stage column to paint the bars.
                </p>
                <label className="frow" title='"Duration" = longest bar first (the classic look). "Table" = the sheet&apos;s row order.'>
                  <span>Sort subjects</span>
                  <select value={sw.sortBy ?? "duration"} onChange={(e) => set({ sortBy: e.target.value === "table" ? "table" : "duration" })}>
                    <option value="duration">By duration (longest first)</option>
                    <option value="table">Sheet order</option>
                  </select>
                </label>
                <label className="frow" title="Bar thickness as a share of each subject's band.">
                  <span>Bar thickness</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="range" min={0.1} max={1} step={0.05} value={sw.barHeight ?? 0.55} onChange={(e) => set({ barHeight: Number(e.target.value) })} />
                    <span style={{ width: 32, textAlign: "right" }}>{(sw.barHeight ?? 0.55).toFixed(2)}</span>
                  </span>
                </label>
                <label className="frow" title='Arrow cap on subjects whose "Ongoing" cell is non-empty and non-zero.'>
                  <span>Ongoing arrow</span>
                  <input type="checkbox" checked={sw.showOngoingArrow ?? true} onChange={(e) => set({ showOngoingArrow: e.target.checked })} />
                </label>
                <label className="frow" title="Fill of the response interval drawn inside the bar.">
                  <span>Response colour</span>
                  <ColorInput value={sw.responseFill ?? "#1a9850"} onChange={(c) => set({ responseFill: c || undefined })} />
                </label>
                <label className="frow" title="Opacity of the response interval.">
                  <span>Response opacity</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="range" min={0.1} max={1} step={0.05} value={sw.responseOpacity ?? 0.9} onChange={(e) => set({ responseOpacity: Number(e.target.value) })} />
                    <span style={{ width: 32, textAlign: "right" }}>{(sw.responseOpacity ?? 0.9).toFixed(2)}</span>
                  </span>
                </label>
                <label className="frow" title="Print each subject's duration at the bar end (the standard value labels — decimals and font live with them).">
                  <span>Duration labels</span>
                  <input type="checkbox" checked={plot.showValues ?? false} onChange={(e) => onSetPlotOptions({ showValues: e.target.checked })} />
                </label>
              </>
            );
          })()}
          {kind === "blandaltman" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Columns: the two methods' paired measurements. X = their mean, Y = their
                difference; lines mark the bias and the limits of agreement.
              </p>
              <label className="frow" title="Plot the difference as a percent of the mean (proportional-bias form) instead of absolute units.">
                <span>Percent difference</span>
                <input
                  type="checkbox"
                  checked={plot.blandAltman?.percent ?? false}
                  onChange={(e) => onSetPlotOptions({ blandAltman: { ...(plot.blandAltman ?? {}), percent: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Limits of agreement = bias ± this multiple of the SD of the differences. 1.96 ≈ 95% limits.">
                <span>Agreement (× SD)</span>
                <select
                  className="selin"
                  value={String(plot.blandAltman?.agreementK ?? 1.96)}
                  onChange={(e) => onSetPlotOptions({ blandAltman: { ...(plot.blandAltman ?? {}), agreementK: Number(e.target.value) } })}
                >
                  <option value="1.96">1.96 (95%)</option>
                  <option value="2">2</option>
                  <option value="2.58">2.58 (99%)</option>
                  <option value="3">3</option>
                </select>
              </label>
              {/* Note: the per-line switches for Bland-Altman's three lines are the generic
                  reference-line list above (same ids, same labels, same behaviour) plus a
                  Style… button each — shared with the other seven kinds that draw such lines. */}
              <p className="hint" style={{ margin: "8px 0 2px" }}>Drag a line’s label on the graph to move it; the line stays at its value.</p>
            </>
          )}
          {kind === "pyramid" && (
            <>
              <p className="hint" style={{ margin: "2px 0 6px" }}>
                Columns: the two groups (drawn left / right) over shared category rows.
              </p>
              <label className="frow" title="Print each bar's value at its tip.">
                <span>Show values</span>
                <input
                  type="checkbox"
                  checked={plot.pyramid?.showValues ?? false}
                  onChange={(e) => onSetPlotOptions({ pyramid: { ...(plot.pyramid ?? {}), showValues: e.target.checked } })}
                />
              </label>
              <label className="frow" title="Bar thickness as a fraction of each category band.">
                <span>Bar thickness</span>
                <input
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.05}
                  value={plot.pyramid?.barWidth ?? 0.8}
                  onChange={(e) => onSetPlotOptions({ pyramid: { ...(plot.pyramid ?? {}), barWidth: Number(e.target.value) } })}
                />
              </label>
              {(plot.pyramid?.showValues ?? false) && (
                <FontControls label="Value label font" element="valueLabel" spec={plot.fonts?.valueLabel} defaultSize={11} onSetPlotFont={onSetPlotFont} />
              )}
            </>
          )}
          {(kind === "pcascore" || kind === "pcaload" || kind === "pcabiplot" || kind === "triplot") && (() => {
            const pcs = plot.pca?.pcLabels ?? [];
            const setPca = (patch: Partial<NonNullable<Plot["pcaStyle"]>>): void =>
              onSetPlotOptions({ pcaStyle: { ...(plot.pcaStyle ?? {}), ...patch } });
            if (pcs.length === 0) return <p className="hint" style={{ margin: "2px 0" }}>Create this from an ordination: Analyze → PCA, principal coordinates (PCoA), NMDS or correspondence analysis, then its graph button.</p>;
            return (
              <>
                {kind === "triplot" && (
                  <>
                    {/* LC versus WA scores, a standard choice in the literature. LC places each
                        case from the explanatory variables (what the model says); WA places it
                        from what was observed. They separate exactly where the model fits badly,
                        so a figure has to say which it drew — and the reader has to be able to switch. */}
                    <label className="frow" title="Which set of case scores to draw. LC places each case from the explanatory variables (the fitted values); WA places it from the observed response. They agree where the model fits and separate where it does not.">
                      <span>Case scores</span>
                      <select className="selin" aria-label="Case scores" value={plot.pcaStyle?.siteScores ?? "wa"}
                        onChange={(e) => setPca({ siteScores: e.target.value as "lc" | "wa" })}>
                        <option value="wa">WA — from the observed response</option>
                        <option value="lc">LC — from the explanatory variables</option>
                      </select>
                    </label>
                    <label className="frow" title="Draw the cases. Off leaves the variables' picture on its own.">
                      <span>Show cases</span>
                      <input type="checkbox" aria-label="Show cases" checked={plot.pcaStyle?.showSites !== false}
                        onChange={(e) => setPca({ showSites: e.target.checked })} />
                    </label>
                    <label className="frow" title="Draw the explanatory variables: an arrow for a measured one, a centroid for a category's level (a category has a place, not a direction of increase).">
                      <span>Show explanatory</span>
                      <input type="checkbox" aria-label="Show explanatory variables" checked={plot.pcaStyle?.showEnv !== false}
                        onChange={(e) => setPca({ showEnv: e.target.checked })} />
                    </label>
                    <label className="frow" title="Draw the response variables as points among the cases, or as arrows from the origin — the convention some journals use.">
                      <span>Response variables as</span>
                      <select className="selin" aria-label="Response variables as" value={plot.pcaStyle?.speciesAs ?? "points"}
                        onChange={(e) => setPca({ speciesAs: e.target.value as "points" | "arrows" })}>
                        <option value="points">Points</option>
                        <option value="arrows">Arrows</option>
                      </select>
                    </label>
                    <label className="frow" title="How far the explanatory arrows reach across the cloud. They are correlations, so their natural length is at most 1 and has to be stretched; 0.8 of the cloud's reach is the convention.">
                      <span>Arrow reach</span>
                      <input type="number" className="numin" min={0.05} max={5} step={0.1} aria-label="Arrow reach"
                        value={plot.pcaStyle?.arrowScale ?? 0.8}
                        onChange={(e) => setPca({ arrowScale: Number(e.target.value) })} />
                    </label>
                  </>
                )}
                {/* An ordination (CA / PCoA / NMDS) carries the variables as points in the
                    same space as the cases — the joint plot is a correspondence analysis, so
                    the switch appears only when the analysis actually brought them. */}
                {(plot.pca?.speciesScores?.length ?? 0) > 0 && (kind === "pcascore" || kind === "triplot") && (
                  <label className="frow" title="Draw the variables as points among the cases — a case sits near the variables it is relatively rich in. Only a CA, PCoA, NMDS, RDA or CCA carries them; a PCA has loadings (arrows) instead.">
                    <span>Show variables</span>
                    <input type="checkbox" aria-label="Show variable points"
                      checked={plot.pcaStyle?.showSpecies !== false}
                      onChange={(e) => setPca({ showSpecies: e.target.checked })} />
                  </label>
                )}
                <label className="frow" title="Which principal component to plot on the X axis.">
                  <span>X axis</span>
                  <select className="selin" value={plot.pcaStyle?.xComponent ?? 0} onChange={(e) => setPca({ xComponent: Number(e.target.value) })}>
                    {pcs.map((pc, i) => <option key={i} value={i}>{pc}</option>)}
                  </select>
                </label>
                <label className="frow" title="Which principal component to plot on the Y axis.">
                  <span>Y axis</span>
                  <select className="selin" value={plot.pcaStyle?.yComponent ?? 1} onChange={(e) => setPca({ yComponent: Number(e.target.value) })}>
                    {pcs.map((pc, i) => <option key={i} value={i}>{pc}</option>)}
                  </select>
                </label>
                {/* A third component as each dot's size — depth. Score plots only: the
                    loadings plot draws arrows, not cases, so there is nothing to size. */}
                {kind !== "pcaload" && (
                  <label className="frow" title="Show a third component as each dot's size — big = near, small = far, like a 3D view.">
                    <span>Dot size (depth)</span>
                    <select className="selin" value={pcaSizeComponent(plot, kind, pcs.length)} onChange={(e) => setPca({ sizeComponent: Number(e.target.value) })}>
                      <option value={-1}>Off (all the same)</option>
                      {pcs.map((pc, i) => <option key={i} value={i}>{pc}</option>)}
                    </select>
                  </label>
                )}
                {/* Loading arrows + variable labels (loadings/biplot only). Their colour was
                    reachable by no control (biplot hard-pinned #b5342f); their font too. */}
                {kind !== "pcascore" && (
                  <>
                    <label className="frow" title="Colour of the loading arrows + variable labels.">
                      <span>Loadings colour</span>
                      <ColorInput
                        className="colorin"
                        value={plot.seriesStyles?.["pca-loadings"]?.color ?? (kind === "pcabiplot" ? "#b5342f" : seriesColor(0))}
                        aria-label="Loadings colour"
                        onChange={(c) => onSetSeriesStyle("pca-loadings", { color: c })}
                      />
                    </label>
                    <FontControls label="Loading labels" element="legend" spec={plot.fonts?.legend} defaultSize={12} onSetPlotFont={onSetPlotFont} />
                  </>
                )}
              </>
            );
          })()}
          {kind === "scree" && (
            <>
              <label className="frow" title="Plot the raw eigenvalue or the % of variance each component explains.">
                <span>Metric</span>
                <select
                  className="selin"
                  value={plot.pcaStyle?.screeMetric ?? "percent"}
                  onChange={(e) => onSetPlotOptions({ pcaStyle: { ...(plot.pcaStyle ?? {}), screeMetric: e.target.value as "percent" | "eigenvalue" } })}
                >
                  <option value="percent">% variance explained</option>
                  <option value="eigenvalue">Eigenvalue</option>
                </select>
              </label>
              <label className="frow" title="Overlay the cumulative-variance curve (running total across components).">
                <span>Cumulative curve</span>
                <input
                  type="checkbox"
                  checked={plot.pcaStyle?.screeCumulative ?? false}
                  onChange={(e) => onSetPlotOptions({ pcaStyle: { ...(plot.pcaStyle ?? {}), screeCumulative: e.target.checked } })}
                />
              </label>
            </>
          )}
          {kind === "dendrogram" && (() => {
            const dc = plot.dendrogram ?? {};
            const setD = (patch: Partial<NonNullable<Plot["dendrogram"]>>): void => onSetPlotOptions({ dendrogram: { ...dc, ...patch } });
            return (
              <>
                <label className="frow" title="Cluster the rows (each a profile across the value columns) or the columns.">
                  <span>Cluster</span>
                  <select className="selin" value={dc.target ?? "rows"} onChange={(e) => setD({ target: e.target.value as "rows" | "columns" })}>
                    <option value="rows">Rows</option>
                    <option value="columns">Columns</option>
                  </select>
                </label>
                <label className="frow" title="Distance between two profiles.">
                  <span>Distance</span>
                  <select className="selin" value={dc.metric ?? "euclidean"} onChange={(e) => setD({ metric: e.target.value as NonNullable<Plot["dendrogram"]>["metric"] })}>
                    <option value="euclidean">Euclidean</option>
                    <option value="manhattan">Manhattan</option>
                    <option value="correlation">1 − correlation</option>
                  </select>
                </label>
                <label className="frow" title="How the distance between two clusters is defined.">
                  <span>Linkage</span>
                  <select className="selin" value={dc.linkage ?? "average"} onChange={(e) => setD({ linkage: e.target.value as NonNullable<Plot["dendrogram"]>["linkage"] })}>
                    <option value="average">Average (UPGMA)</option>
                    <option value="complete">Complete</option>
                    <option value="single">Single</option>
                    <option value="ward">Ward</option>
                  </select>
                </label>
                <label className="frow" title="Tree growth direction.">
                  <span>Orientation</span>
                  <select className="selin" value={dc.orientation ?? "vertical"} onChange={(e) => setD({ orientation: e.target.value as "vertical" | "horizontal" })}>
                    <option value="vertical">Vertical (grows up)</option>
                    <option value="horizontal">Horizontal (grows right)</option>
                  </select>
                </label>
                <label className="frow" title="Colour this many top clusters distinctly (0/1 = single colour).">
                  <span>Colour clusters</span>
                  <input type="number" className="selin" min={0} max={12} value={dc.colorClusters ?? 0} onChange={(e) => setD({ colorClusters: Math.max(0, Math.min(12, Math.floor(Number(e.target.value) || 0))) })} />
                </label>
              </>
            );
          })()}
          {kind === "histogram" && (() => {
            const h = plot.histogram ?? {};
            const setH = (patch: Partial<NonNullable<Plot["histogram"]>>): void =>
              onSetPlotOptions({ histogram: { ...h, ...patch } });
            const widthSet = h.binWidth != null && h.binWidth > 0;
            // Custom bins override width / count / start, so those controls grey out when set.
            const edgesSet = Array.isArray(h.binRanges) && h.binRanges.some((r) => Array.isArray(r) && (r[0] != null || r[1] != null));
            // Parse the "Custom bins" text: a bare edge list ("10, 30, 50") → contiguous bins, or a
            // list of ranges ("10-30, 50-70, 90+", "<10") → explicit bins with gaps / open ends.
            const parseBins = (text: string): Array<[number | null, number | null]> | undefined => {
              const toks = text.split(",").map((s) => s.trim()).filter(Boolean);
              if (!toks.length) return undefined;
              if (toks.every((t) => Number.isFinite(Number(t)))) {
                const e = [...new Set(toks.map(Number))].sort((a, b) => a - b);
                return e.length >= 2 ? e.slice(1).map((hi, i) => [e[i]!, hi] as [number, number]) : undefined;
              }
              const out: Array<[number | null, number | null]> = [];
              for (const t of toks) {
                let m: RegExpMatchArray | null;
                if ((m = t.match(/^[<≤]\s*(-?\d*\.?\d+)$/))) out.push([null, Number(m[1])]);
                else if ((m = t.match(/^(-?\d*\.?\d+)\s*\+$/)) || (m = t.match(/^[>≥]\s*(-?\d*\.?\d+)$/))) out.push([Number(m[1]), null]);
                else if ((m = t.match(/^(-?\d*\.?\d+)\s*(?:–|-|\.\.|to)\s*(-?\d*\.?\d+)$/))) out.push([Number(m[1]), Number(m[2])]);
              }
              return out.length ? out : undefined;
            };
            const binsToText = (rs?: Array<[number | null, number | null]>): string =>
              (rs ?? []).map(([lo, hi]) => (lo == null ? `<${hi}` : hi == null ? `${lo}+` : `${lo}-${hi}`)).join(", ");
            return (
              <>
                <label className="frow" title="What the bar heights represent: raw count, fraction/percent of total, or a running (cumulative) total.">
                  <span>Frequencies</span>
                  <select className="selin" value={h.freq ?? "count"} onChange={(e) => setH({ freq: e.target.value as NonNullable<Plot["histogram"]>["freq"] })}>
                    <option value="count">Count</option>
                    <option value="relative">Relative frequency</option>
                    <option value="percent">Percent of total</option>
                    <option value="cumulative">Cumulative count</option>
                    <option value="cumulativePercent">Cumulative %</option>
                  </select>
                </label>
                <label className="frow" title="Bin width in data units — round bins, e.g. 10 → 0–10, 10–20. Overrides the bin count; blank = auto.">
                  <span>Bin width</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      className="numin"
                      min={0}
                      step="any"
                      style={{ width: 70 }}
                      disabled={edgesSet}
                      value={h.binWidth ?? ""}
                      placeholder={edgesSet ? "custom" : "auto"}
                      onChange={(e) => { const t = e.target.value.trim(); setH({ binWidth: t === "" ? undefined : Number(t) }); }}
                    />
                    <button type="button" className="swbtn" title="Auto bin width" onClick={() => setH({ binWidth: undefined })}>⨯</button>
                  </span>
                </label>
                <label className="frow" title="Number of bins — used when no bin width is set.">
                  <span>Bins</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="range"
                      min={2}
                      max={40}
                      step={1}
                      disabled={widthSet || edgesSet}
                      value={h.bins ?? 10}
                      onChange={(e) => setH({ bins: Number(e.target.value) })}
                    />
                    <span style={{ width: 38, textAlign: "right" }}>{widthSet ? "—" : (h.bins ?? "auto")}</span>
                  </span>
                </label>
                <label className="frow" title="Lower edge of the first bin. Blank = auto (data minimum, snapped to the bin width).">
                  <span>Start</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      className="numin"
                      step="any"
                      style={{ width: 70 }}
                      disabled={edgesSet}
                      value={h.origin ?? ""}
                      placeholder={edgesSet ? "custom" : "auto"}
                      onChange={(e) => { const t = e.target.value.trim(); setH({ origin: t === "" ? undefined : Number(t) }); }}
                    />
                    <button type="button" className="swbtn" title="Auto start" onClick={() => setH({ origin: undefined })}>⨯</button>
                  </span>
                </label>
                <label className="frow" title="Custom bins, comma-separated. Either an edge list (10, 30, 50 → contiguous bins) or ranges: 10-30, 50-70 (a gap skips 30–50), 90+ (open above), <10 (open below). Overrides bin width / count / start; values in no bin are left out.">
                  <span>Custom bins</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="text"
                      className="numin"
                      style={{ width: 142 }}
                      placeholder="e.g. 10-30, 50-70, 90+"
                      value={binsToText(h.binRanges)}
                      onChange={(e) => setH({ binRanges: parseBins(e.target.value) })}
                    />
                    <button type="button" className="swbtn" title="Clear custom bins" onClick={() => setH({ binRanges: undefined })}>⨯</button>
                  </span>
                </label>
                <label className="frow" title="Draw each bar's width proportional to its bin's data range on a numeric axis — a true variable-width histogram, so a 40-wide bin reads as twice a 20-wide one. Off = equal-width bars with range labels. Vertical bars only.">
                  <span>Proportional width</span>
                  <input type="checkbox" checked={h.proportionalWidth ?? false} onChange={(e) => setH({ proportionalWidth: e.target.checked })} />
                </label>
                <label className="frow" title="Draw a data-point marker at the top of each bar. Off by default — a histogram is bars; use the Bar width slider above to put gaps between them.">
                  <span>Data points</span>
                  <input type="checkbox" checked={h.showPoints ?? false} onChange={(e) => setH({ showPoints: e.target.checked })} />
                </label>
                <label className="frow" title="Overlay a normal (Gaussian) curve fitted to the data's own mean and SD, scaled to the frequency axis. Drawn on Count / Relative / Percent with equal-width bins.">
                  <span>Normal curve</span>
                  <input type="checkbox" checked={h.normalCurve === true} onChange={(e) => setH({ normalCurve: e.target.checked })} />
                </label>
                {h.normalCurve === true && (
                  <label className="frow" title="Colour of the normal-curve overlay.">
                    <span>Curve colour</span>
                    <ColorInput value={h.normalCurveColor ?? "#c0392b"} aria-label="Normal-curve colour" onChange={(c) => setH({ normalCurveColor: c })} />
                  </label>
                )}
                <label className="frow" title="Overlay a smooth density curve (kernel density estimate, the same estimate a violin uses) scaled to the frequency axis — the data's own shape, no distribution assumed. Drawn on Count / Relative / Percent with equal-width bins. With the normal curve also on, the normal one is dashed.">
                  <span>Density curve</span>
                  <input type="checkbox" checked={h.densityCurve === true} onChange={(e) => setH({ densityCurve: e.target.checked })} />
                </label>
                {h.densityCurve === true && (
                  <>
                    <label className="frow" title="Colour of the density-curve overlay.">
                      <span>Curve colour</span>
                      <ColorInput value={h.densityCurveColor ?? "#1f6f8b"} aria-label="Density-curve colour" onChange={(c) => setH({ densityCurveColor: c })} />
                    </label>
                    <label className="frow" title="Bandwidth as a multiple of Silverman's rule: below 1 follows the data more closely (spikier), above 1 smooths it.">
                      <span>Smoothness</span>
                      <input type="range" min={0.25} max={3} step={0.05} value={h.densityBandwidth ?? 1} onChange={(e) => setH({ densityBandwidth: Number(e.target.value) })} />
                    </label>
                  </>
                )}
              </>
            );
          })()}
          {(kind === "box" || kind === "violin" || kind === "raincloud" || kind === "floatingbar") && (
            <label className="frow">
              {/* Floating bars reuse the same BoxWhisker definition to set what the bar spans
                  (min→max default, percentiles, or mean±SD/SEM/CI) — so it's labelled "Bar spans"
                  and drops "Tukey", which describes whiskers a floating bar doesn't draw. */}
              <span>{kind === "floatingbar" ? "Bar spans" : "Whiskers"}</span>
              <select
                className="selin"
                value={plot.boxWhisker ?? (kind === "floatingbar" ? "minmax" : "tukey")}
                onChange={(e) => onSetBoxWhisker(e.target.value as BoxWhisker)}
              >
                {kind !== "floatingbar" && <option value="tukey">Tukey (1.5·IQR)</option>}
                <option value="minmax">Min to max</option>
                <option value="p10_90">10–90 percentile</option>
                <option value="p5_95">5–95 percentile</option>
                <option value="p2_5_97_5">2.5–97.5 percentile</option>
                <option value="p1_99">1–99 percentile</option>
                <option value="sd">Mean ± SD</option>
                <option value="sem">Mean ± SEM</option>
                <option value="ci95">Mean ± 95% CI</option>
              </select>
            </label>
          )}
          {(kind === "box" || kind === "violin") && (
            <label className="frow">
              <span>Points</span>
              <span>
                <input
                  type="checkbox"
                  aria-label="Overlay individual points"
                  checked={plot.showBoxPoints ?? false}
                  onChange={(e) => onSetPlotOptions({ showBoxPoints: e.target.checked })}
                />{" "}
                Show all points
              </span>
            </label>
          )}
          {(kind === "box" || kind === "violin" || kind === "scatter") && (
            <SortRow
              label="Sort groups"
              largest="Largest first"
              title={kind === "scatter"
                ? "Order the groups by their centre line (the mean or median chosen under Summary) instead of table order. Colours and significance brackets follow their groups."
                : "Order the groups by their median instead of table order. Colours and significance brackets follow their groups."}
              plot={plot}
              onSetPlotOptions={onSetPlotOptions}
            />
          )}
          {(kind === "box" || kind === "violin") && (
            <label className="frow">
              <span>Mean</span>
              <span>
                <input
                  type="checkbox"
                  aria-label="Overlay the group mean as a plus sign"
                  checked={plot.showBoxMean ?? false}
                  onChange={(e) => onSetPlotOptions({ showBoxMean: e.target.checked })}
                />{" "}
                Show mean (+)
              </span>
            </label>
          )}
          {kind === "scatter" && (
            <label className="frow" title="Centre & spread — the line over the swarm and its error interval. Each option names its own centre (mean or median); SD/SEM/95% CI are about the mean, so there is no invalid 'median ± SD'.">
              <span>Summary</span>
              <select
                className="selin"
                value={scatterSummaryKey(plot.columnScatter)}
                onChange={(e) => {
                  const { center, error } = scatterSummaryPair(e.target.value);
                  onSetPlotOptions({ columnScatter: { ...(plot.columnScatter ?? {}), center, error } });
                }}
              >
                {SCATTER_SUMMARY_OPTS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>
          )}
          {(kind === "box" || kind === "violin" || kind === "scatter") && (
            <label className="frow">
              <span>Orientation</span>
              <button
                type="button"
                className="btn-mini"
                title="Flip between vertical and horizontal (value axis on X, categories on Y)"
                onClick={() => onSetPlotOptions({ barOrientation: (plot.barOrientation ?? "vertical") === "horizontal" ? "vertical" : "horizontal" })}
              >
                {(plot.barOrientation ?? "vertical") === "horizontal" ? "↔ Horizontal" : "↕ Vertical"} — flip
              </button>
            </label>
          )}
          {kind === "volcano" && (() => {
            const v = plot.volcano ?? {};
            const setV = (patch: Partial<NonNullable<Plot["volcano"]>>): void => onSetPlotOptions({ volcano: { ...v, ...patch } });
            const numV = (key: "fcThreshold" | "pThreshold", def: number) => ({
              type: "number" as const, className: "numin", step: "any", style: { width: 70 },
              value: v[key] ?? def,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => { const t = e.target.value.trim(); setV({ [key]: t === "" ? undefined : Number(t) }); },
            });
            const swatch = (key: "upColor" | "downColor" | "nsColor", def: string, label: string) => (
              <label className="frow">
                <span>{label}</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <ColorInput className="colorin" value={v[key] ?? def} aria-label={`${label} colour`} onChange={(c) => setV({ [key]: c })} />
                  <button type="button" className="swbtn" title="Default" onClick={() => setV({ [key]: undefined })}>⨯</button>
                </span>
              </label>
            );
            return (
              <>
                <label className="frow" title="|log₂ fold-change| cutoff for significance — the two vertical dashed guides.">
                  <span>Fold-change cutoff</span>
                  <input {...numV("fcThreshold", 1)} />
                </label>
                <label className="frow" title="−log₁₀ p cutoff for significance — the horizontal dashed guide. 1.30 ≈ p < 0.05.">
                  <span>−log₁₀ p cutoff</span>
                  <input {...numV("pThreshold", 1.301)} />
                </label>
                {swatch("upColor", "#1a9850", "Up-regulated")}
                {swatch("downColor", "#d62728", "Down-regulated")}
                {swatch("nsColor", "#b3b6bd", "Not significant")}
                <p className="note" style={{ fontSize: 11, marginTop: 4 }}>
                  Points are coloured by zone (above the cutoffs = up / down, else not-significant). To recolour a single
                  point, click it and set its colour with “Apply to whole series” off.
                </p>
              </>
            );
          })()}
        </Section>

        {kind !== "heatmap" && (
        <Section title="Colour scheme" open>
          {(() => {
            const keys = Object.keys(PALETTES);
            const activeKey = plot.palette && PALETTES[plot.palette] ? plot.palette : keys[0]!;
            const swatch = PALETTES[activeKey] ?? OKABE_ITO;
            return (
              <>
                <label className="frow">
                  <span>Palette</span>
                  <select
                    className="selin"
                    value={plot.palette && PALETTES[plot.palette] ? plot.palette : ""}
                    // Clearing paletteColors too: a preset's literal palette must not keep
                    // winning over the named palette the user is choosing right now.
                    onChange={(e) => onSetPlotOptions({ palette: e.target.value === "" ? undefined : e.target.value, paletteColors: undefined })}
                  >
                    <option value="">{keys[0]} · default</option>
                    {keys.slice(1).map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <div className="swatches" style={{ marginTop: 4 }}>
                  {swatch.map((c, i) => (
                    <span
                      key={`${c}-${i}`}
                      className="swbtn"
                      style={{ background: c, cursor: "default" }}
                      title={c}
                      aria-label={`Series ${i + 1} colour ${c}`}
                    />
                  ))}
                </div>
                <p className="note" style={{ fontSize: 11, marginTop: 6 }}>
                  Recolours every series at once. A colour you set on an individual series (click it) still wins.
                </p>
              </>
            );
          })()}
        </Section>
        )}

        <Section title="Style preset">
          <StylePresetPanel
            userPresets={userPresets}
            plotKind={plot.kind ?? "xy"}
            canAddKind={captureKindSection(plot) !== undefined}
            profileDefault={profileDefault}
            onApplyPreset={onApplyPreset}
            onApplyUserPreset={onApplyUserPreset}
            onSaveUserPreset={onSaveUserPreset}
            onAddPresetKind={onAddPresetKind}
            onDeleteUserPreset={onDeleteUserPreset}
            onRenameUserPreset={onRenameUserPreset}
            onDuplicateUserPreset={onDuplicateUserPreset}
            onRemovePresetKind={onRemovePresetKind}
            onReorderUserPresets={onReorderUserPresets}
            onSetProfileDefault={onSetProfileDefault}
            onUserLibraryImported={onUserLibraryImported}
          />
        </Section>

        <Section title="Graph size">
          {/* Width and height scale the whole graph (resizing keeps proportions). They
              report the size the graph is shown at - its laid-out size times its scale - and moving either one sets the
              scale, so text, marks and legend grow and shrink together and the shape is kept. The presets below choose
              the shape the graph is laid out in. */}
          {(() => {
            const lay = graphLayoutSize(plot);
            const k = graphDisplayScale(plot, figureFit);
            return (
              <>
                <label className="frow">
                  <span>Width <span className="galleryval">{Math.round(lay.width * k)}</span></span>
                  <input
                    type="range"
                    min={Math.round(lay.width * DISPLAY_SCALE_MIN)}
                    max={Math.round(lay.width * Math.min(DISPLAY_SCALE_MAX, 2))}
                    step={10}
                    value={Math.round(lay.width * k)}
                    onChange={(e) => onSetPlotOptions({ displayScale: Number(e.target.value) / lay.width })}
                  />
                </label>
                <label className="frow">
                  <span>Height <span className="galleryval">{Math.round(lay.height * k)}</span></span>
                  <input
                    type="range"
                    min={Math.round(lay.height * DISPLAY_SCALE_MIN)}
                    max={Math.round(lay.height * Math.min(DISPLAY_SCALE_MAX, 2))}
                    step={10}
                    value={Math.round(lay.height * k)}
                    onChange={(e) => onSetPlotOptions({ displayScale: Number(e.target.value) / lay.height })}
                  />
                </label>
              </>
            );
          })()}
          <div className="frow">
            <span>Presets</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn-mini" onClick={() => onSetPlotOptions({ figureWidth: 580, figureHeight: 380, displayScale: undefined })}>Default</button>
              <button type="button" className="btn-mini" onClick={() => onSetPlotOptions({ figureWidth: 480, figureHeight: 480, displayScale: undefined })}>Square</button>
              <button type="button" className="btn-mini" onClick={() => onSetPlotOptions({ figureWidth: 820, figureHeight: 360, displayScale: undefined })}>Wide</button>
            </span>
          </div>
          {/* Print size never re-lays out the graph: Width and Height stay; the whole drawing
              prints scaled together (the "Keep proportions" rule). The Export dialog starts its
              print width from it, and the note says what the text will print at. */}
          {(() => {
            // Print scales the drawing as laid out (its shown scale does not change what prints at a given width).
            const now = graphLayoutSize(plot);
            const mm = plot.printWidthMm;
            const fonts = mm !== undefined ? buildPlotScene(table, plot, now).fonts : undefined;
            const pt = (px: number) => (mm !== undefined ? printedPt(px, now.width, mm) : 0);
            const smallest = fonts ? Math.min(fonts.tick.size, fonts.legend.size, fonts.axisTitle.size, fonts.title.size) : 0;
            return (<>
              <div className="frow" title="How wide this graph prints. The whole graph is scaled together — text, points, lines and margins keep their proportions; its Width and Height do not change. The Export dialog starts from this print width. Widths vary by journal — check your target's guide for authors.">
                <span>Print size</span>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {GRAPH_PRINT_SIZES.map((sz) => {
                    const w = printWidthFor(sz, now.width / Math.max(1, now.height));
                    return (
                      <button
                        key={sz.label}
                        type="button"
                        className="btn-mini"
                        aria-pressed={mm === w}
                        title={sz.hMm !== undefined ? `Fit a full page (${sz.wMm} × ${sz.hMm} mm): prints ${w} mm wide` : `Prints ${sz.wMm} mm wide`}
                        onClick={() => onSetPlotOptions({ printWidthMm: w })}
                      >
                        {sz.label}
                      </button>
                    );
                  })}
                  <button type="button" className="btn-mini" aria-pressed={mm === undefined} title="No print size" onClick={() => onSetPlotOptions({ printWidthMm: undefined })}>
                    Off
                  </button>
                </span>
              </div>
              {mm !== undefined && fonts && (
                <p className="note" data-print-note style={{ fontSize: 11 }}>
                  Prints {mm} mm wide, the whole graph scaled together. Axis numbers ({fonts.tick.size} px) print at {pt(fonts.tick.size).toFixed(1)} pt.
                  {pt(smallest) < MIN_PRINT_PT && ` The smallest text prints at ${pt(smallest).toFixed(1)} pt — most journals ask for at least ${MIN_PRINT_PT} pt: make the graph narrower (Width) or its text larger (Text tab).`}
                </p>
              )}
            </>);
          })()}
          <div className="frow" title="Reposition the title + legend together for a common figure style">
            <span>Layout</span>
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LAYOUT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="btn-mini"
                  title={p.hint}
                  onClick={() => onSetPlotOptions({ titleAlign: p.titleAlign, legend: { ...(plot.legend ?? {}), ...p.legend }, frame: p.frame })}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </div>
          <p className="note" style={{ fontSize: 11 }}>Layout presets move the title &amp; legend together; size, fonts, and colours stay as set.</p>
        </Section>

        {/* Offered on every kind, including pie · radar · scatter3d · treemap · parallel:
            every builder honours all four sides of `plotPad`, so none of the boxes is dead.
            `plot-margins.test.ts` holds every kind to it. */}
        <Section title="Plot margins">
            {(() => {
              const mp = plot.plotPad ?? {};
              const setSide = (side: "top" | "right" | "bottom" | "left", v: string): void => {
                const n = v.trim() === "" ? undefined : Math.max(0, Number(v));
                const next = { ...mp, [side]: n };
                // drop empty/zero sides so an all-clear pad serialises as undefined
                const clean = Object.fromEntries(Object.entries(next).filter(([, val]) => val != null && val !== 0));
                onSetPlotOptions({ plotPad: Object.keys(clean).length ? clean : undefined });
              };
              const sideInput = (side: "top" | "right" | "bottom" | "left", label: string) => (
                <label className="frow">
                  <span>{label}</span>
                  <input
                    type="number"
                    className="numin"
                    min={0}
                    max={300}
                    step={2}
                    value={mp[side] ?? ""}
                    placeholder="0"
                    onChange={(e) => setSide(side, e.target.value)}
                  />
                </label>
              );
              return (
                <>
                  {sideInput("top", "Top")}
                  {sideInput("right", "Right")}
                  {sideInput("bottom", "Bottom")}
                  {sideInput("left", "Left")}
                  <p className="note" style={{ fontSize: 11 }}>
                    Extra whitespace (px) between the plotting area and the figure edge, on top of the auto margins. The figure keeps its size; the plot shrinks to fit. Leave blank for auto.
                  </p>
                </>
              );
            })()}
        </Section>

        {kind === "pie" && (
          <Section title="Pie chart" open>
            <label className="frow" title="Draw the parts-of-whole as a pie (arc wedges) or a waffle — a 10×10 grid of unit cells coloured by category, each cell ≈ 1% of the whole. Same data, legend and colours.">
              <span>Display</span>
              <select
                className="selin"
                value={plot.pieDisplay ?? "pie"}
                onChange={(e) => onSetPlotOptions({ pieDisplay: e.target.value as "pie" | "waffle" })}
              >
                <option value="pie">Pie</option>
                <option value="waffle">Waffle (square grid)</option>
              </select>
            </label>
            {plot.pieDisplay === "waffle" && (
              <label className="frow" title="Draw each cell as its category's shape instead of a square — an icon array. Groups can then be told apart without colour. Click a cell to choose that category's shape.">
                <span>Cells as shapes</span>
                <input type="checkbox" checked={plot.waffleIcons === true} onChange={(e) => onSetPlotOptions({ waffleIcons: e.target.checked })} />
              </label>
            )}
            {plot.pieDisplay === "waffle" && (
              <label className="frow" title="1 % of the whole: always a 10 × 10 grid. One observation: the values are counts, one cell each (above 100 in total, one cell stands for several), with a caption under the grid saying so.">
                <span>Each cell is</span>
                <select className="selin" value={plot.waffleUnit ?? "percent"} onChange={(e) => onSetPlotOptions({ waffleUnit: e.target.value as "percent" | "count" })}>
                  <option value="percent">1 % of the whole</option>
                  <option value="count">One observation</option>
                </select>
              </label>
            )}
            {plot.pieDisplay === "waffle" && (
              <label className="frow" title="Show only this many groups — the largest, in table order — and combine the rest into one group, drawn last. Leave empty to show every group. Click the combined group to set its colour and shape.">
                <span>Groups shown</span>
                <input type="number" className="numin" min={1} step={1} value={plot.waffleMaxGroups ?? ""} placeholder="all" onChange={(e) => { const t = e.target.value.trim(); onSetPlotOptions({ waffleMaxGroups: t === "" ? undefined : Math.max(1, Math.floor(Number(t))) }); }} />
              </label>
            )}
            {plot.pieDisplay === "waffle" && plot.waffleMaxGroups != null && (
              <label className="frow" title="The name of the combined group, in the legend and on its cells.">
                <span>Name for the rest</span>
                <input type="text" className="numin" value={plot.waffleOtherName ?? ""} placeholder="Other" onChange={(e) => onSetPlotOptions({ waffleOtherName: e.target.value === "" ? undefined : e.target.value })} />
              </label>
            )}
            {plot.pieDisplay === "waffle" && plot.waffleUnit === "count" && (() => {
              const auto = buildPlotScene(table, { ...plot, waffleCaption: undefined }, { width: 400, height: 300 }).pie?.caption?.text ?? "";
              return (<>
                <label className="frow" title="The word for one observation in the caption under the grid — patient, mouse, cell.">
                  <span>Unit name</span>
                  <input type="text" className="numin" value={plot.waffleUnitName ?? ""} placeholder="observation" onChange={(e) => onSetPlotOptions({ waffleUnitName: e.target.value === "" ? undefined : e.target.value })} />
                </label>
                <label className="frow" title="Your own words for the caption under the grid. Leave empty for the automatic one. You can also double-click the caption on the graph.">
                  <span>Caption</span>
                  <input type="text" className="numin" value={plot.waffleCaption ?? ""} placeholder={auto} onChange={(e) => onSetPlotOptions({ waffleCaption: e.target.value === "" ? undefined : e.target.value })} />
                </label>
                <FontControls label="Caption font (shared with the legend)" element="legend" spec={plot.fonts?.legend} defaultSize={12} onSetPlotFont={onSetPlotFont} />
              </>);
            })()}
            {(plot.pieDisplay ?? "pie") !== "waffle" && (<>
            <label className="frow">
              <span>Start angle°</span>
              <input
                type="number"
                className="numin"
                value={plot.pieStartAngle ?? 0}
                step={15}
                onChange={(e) => onSetPlotOptions({ pieStartAngle: Number(e.target.value) })}
              />
            </label>
            <label className="frow">
              <span>Direction</span>
              <select
                className="selin"
                value={plot.pieDirection ?? "cw"}
                onChange={(e) => onSetPlotOptions({ pieDirection: e.target.value as "cw" | "ccw" })}
              >
                <option value="cw">Clockwise</option>
                <option value="ccw">Counter-clockwise</option>
              </select>
            </label>
            <label className="frow">
              <span>Donut hole</span>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.05}
                value={plot.pieDonut ?? 0}
                onChange={(e) => onSetPlotOptions({ pieDonut: Number(e.target.value) })}
              />
            </label>
            {/* Every slice at once — 0 brings the pie together. One slice: click it (Data tab). */}
            {table && (
              <label className="frow" title="Pull every slice away from the centre by the same amount — 0 brings the pie together. To move one slice, click it.">
                <span>Explode (all slices)</span>
                <input
                  type="range"
                  aria-label="Explode all slices"
                  min={0}
                  max={0.4}
                  step={0.02}
                  value={pieExplodeShown(plot, table)}
                  onChange={(e) => onSetPlotOptions(pieExplodeAll(plot, table, Number(e.target.value)))}
                />
              </label>
            )}
            <label className="frow">
              <span>Labels</span>
              <select
                className="selin"
                value={plot.pieLabels ?? "percent"}
                onChange={(e) => onSetPlotOptions({ pieLabels: e.target.value as PieLabelMode })}
              >
                {PIE_LABELS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="frow">
              <span>Label position</span>
              <select
                className="selin"
                value={plot.pieLabelPosition ?? "inside"}
                onChange={(e) => onSetPlotOptions({ pieLabelPosition: e.target.value as "inside" | "outside" })}
              >
                <option value="inside">Inside slice</option>
                <option value="outside">Outside rim</option>
              </select>
            </label>
            </>)}
            <p className="note" style={{ fontSize: 11 }}>Click a slice or waffle cell to set its colour{(plot.pieDisplay ?? "pie") !== "waffle" ? ", explode, border, and label" : ""}.</p>
          </Section>
        )}

        {kind === "survival" && (
          <Section title="Survival (Kaplan-Meier)" open>
            <p className="note" style={{ fontSize: 11 }}>Click a curve to set its line colour / width / dash.</p>
            <label className="frow" title="Plot the ascending cumulative-incidence (event-rate) curve, 1 − S, instead of the descending survival fraction. Both use the same 0–1 axis; the CI band and censor ticks follow. Off = survival.">
              <span>Cumulative incidence (1 − S)</span>
              <input type="checkbox" checked={plot.survivalCumulativeIncidence === true} onChange={(e) => onSetPlotOptions({ survivalCumulativeIncidence: e.target.checked })} />
            </label>
            <label className="frow" title="Show the Greenwood 95% confidence band behind each step curve.">
              <span>Confidence band</span>
              <input type="checkbox" checked={plot.survivalShowCI !== false} onChange={(e) => onSetPlotOptions({ survivalShowCI: e.target.checked })} />
            </label>
            {plot.survivalShowCI !== false && (
              <label className="frow" title="Fill opacity of the confidence band (0 = invisible, 1 = solid).">
                <span>Band opacity</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="range" min={0} max={0.5} step={0.01} value={plot.survivalCiOpacity ?? 0.15} onChange={(e) => onSetPlotOptions({ survivalCiOpacity: Number(e.target.value) })} />
                  <span style={{ width: 32, textAlign: "right" }}>{Math.round((plot.survivalCiOpacity ?? 0.15) * 100)}%</span>
                </span>
              </label>
            )}
            <label className="frow" title="Show a small tick on the step line at each censoring time.">
              <span>Censor ticks</span>
              <input type="checkbox" checked={plot.survivalShowCensor !== false} onChange={(e) => onSetPlotOptions({ survivalShowCensor: e.target.checked })} />
            </label>
            {plot.survivalAtRisk && plot.survivalAtRisk.rows.length > 0 && (
              <label className="frow" title="Draw the number-at-risk table under the graph, aligned to the time axis.">
                <span>Number at risk</span>
                <input type="checkbox" checked={plot.survivalShowAtRisk !== false} onChange={(e) => onSetPlotOptions({ survivalShowAtRisk: e.target.checked })} />
              </label>
            )}
            {/* The table's own font — clicking its heading or a row name lands here. Blank
                fields inherit the chart's tick font the table always used. */}
            {plot.survivalAtRisk && plot.survivalAtRisk.rows.length > 0 && plot.survivalShowAtRisk !== false && (
              <FontControls
                label="Number-at-risk font"
                element="tick"
                spec={{ ...(plot.fonts?.tick ?? {}), ...(plot.survivalAtRiskFont ?? {}) }}
                defaultSize={plot.fonts?.tick?.size ?? 12}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => onSetPlotOptions({ survivalAtRiskFont: { ...(plot.survivalAtRiskFont ?? {}), ...patch } })}
              />
            )}
          </Section>
        )}

        {kind === "scatter3d" && (() => {
          const s3 = plot.scatter3d ?? {};
          const setS3 = (patch: Partial<NonNullable<Plot["scatter3d"]>>) => onSetPlotOptions({ scatter3d: { ...s3, ...patch } });
          const cols = table.columns;
          const yId = cols[1]?.id;
          const ms: SeriesStyle = (yId ? plot.seriesStyles?.[yId] : undefined) ?? {};
          const setMarker = (delta: SeriesStyle): void => { if (yId) onSetSeriesStyle(yId, delta); };
          const mColor = ms.color ?? seriesColor(0);
          const xAx = plot.xAxis ?? {};
          const titleRow = (label: string, val: string | undefined, colName: string, set: (v: string | undefined) => void) => (
            <label className="frow">
              <span>{label}</span>
              <input type="text" className="numin" style={{ width: 120 }} value={val ?? ""} placeholder={colName}
                onChange={(e) => set(e.target.value === "" ? undefined : e.target.value)} />
            </label>
          );
          return (
            <Section title="3-D scatter" open>
              <p className="note" style={{ fontSize: 11 }}>Drag the plot to rotate · scroll to zoom.</p>
              {titleRow("X axis title", plot.xAxis?.title, cols[0]?.name ?? "X", (v) => onSetAxis("x", { title: v }))}
              {titleRow("Y axis title", plot.yAxis?.title, cols[1]?.name ?? "Y", (v) => onSetAxis("y", { title: v }))}
              {titleRow("Z axis title", s3.zTitle, cols[2]?.name ?? "Z", (v) => setS3({ zTitle: v }))}
              <label className="frow">
                <span>Point colour</span>
                <ColorInput className="colorin" value={mColor} aria-label="Point colour" onChange={(c) => setMarker({ color: c })} />
              </label>
              <label className="frow">
                <span>Point size</span>
                <input type="number" className="numin" min={1} max={24} step={0.5} value={ms.symbolSize ?? 4}
                  onChange={(e) => setMarker({ symbolSize: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Point fill</span>
                <select className="selin" value={ms.symbolFill ?? "solid"} onChange={(e) => setMarker({ symbolFill: e.target.value as SeriesStyle["symbolFill"] })}>
                  {SYMBOL_FILLS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="frow">
                <span>Point opacity</span>
                <input type="range" min={0} max={1} step={0.05} value={ms.symbolOpacity ?? 0.85}
                  onChange={(e) => setMarker({ symbolOpacity: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Axis colour</span>
                <ColorInput className="colorin" value={xAx.lineColor ?? "#7a7580"} aria-label="Axis colour" onChange={(c) => onSetAxis("x", { lineColor: c })} />
              </label>
              <label className="frow">
                <span>Axis thickness</span>
                <input type="number" className="numin" min={0.5} max={8} step={0.25} value={xAx.lineWidth ?? 1.5}
                  onChange={(e) => onSetAxis("x", { lineWidth: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Floor grid</span>
                <input type="checkbox" checked={s3.showGrid !== false} onChange={(e) => setS3({ showGrid: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Grid colour</span>
                <ColorInput className="colorin" value={s3.gridColor ?? "#d9d6dc"} aria-label="Grid colour" onChange={(c) => setS3({ gridColor: c })} />
              </label>
              <label className="frow" title="Fade points toward the back of the cloud so front/back reads on the flat isometric view (opacity only — point size is unchanged). Rotating still separates overlaps.">
                <span>Depth shading</span>
                <input type="checkbox" checked={s3.depthShade === true} onChange={(e) => setS3({ depthShade: e.target.checked ? true : undefined })} />
              </label>
              {/* X/Y/Z axis labels render with the axis-title font — expose it (a 3-D plot has
                  no cartesian AxisPanel, so that font was otherwise unreachable). */}
              <FontControls label="Axis title font" element="axisTitle" spec={plot.fonts?.axisTitle} defaultSize={13} onSetPlotFont={onSetPlotFont} />
              <p className="note" style={{ fontSize: 11 }}>Points are spheres; markers use the default two-tone or open marker styling.</p>
            </Section>
          );
        })()}

        {kind === "radar" && (() => {
          const rd = plot.radar ?? {};
          const setRd = (patch: Partial<NonNullable<Plot["radar"]>>) => onSetPlotOptions({ radar: { ...rd, ...patch } });
          return (
            <Section title="Radar chart" open>
              <p className="note" style={{ fontSize: 11 }}>Click a series polygon to set its line / fill colour.</p>
              <label className="frow" title="Outer scale value (the outermost ring). Blank = auto.">
                <span>Scale max</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" className="numin" step="any" style={{ width: 70 }} value={rd.scaleMax ?? ""} placeholder="auto"
                    onChange={(e) => { const t = e.target.value.trim(); setRd({ scaleMax: t === "" ? undefined : Number(t) }); }} />
                  <button type="button" className="swbtn" title="Auto" onClick={() => setRd({ scaleMax: undefined })}>⨯</button>
                </span>
              </label>
              <label className="frow">
                <span>Rings</span>
                <input type="number" className="numin" min={1} max={10} step={1} value={rd.ringCount ?? 4}
                  onChange={(e) => setRd({ ringCount: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Grid colour</span>
                <ColorInput className="colorin" value={rd.gridColor ?? "#d9d6dc"} aria-label="Grid colour" onChange={(c) => setRd({ gridColor: c })} />
              </label>
              <label className="frow">
                <span>Grid width</span>
                <input type="number" className="numin" min={0.25} max={6} step={0.25} value={rd.gridWidth ?? 1}
                  onChange={(e) => setRd({ gridWidth: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Spoke colour</span>
                <ColorInput className="colorin" value={rd.spokeColor ?? "#b8b4bd"} aria-label="Spoke colour" onChange={(c) => setRd({ spokeColor: c })} />
              </label>
              <label className="frow">
                <span>Spoke width</span>
                <input type="number" className="numin" min={0.25} max={6} step={0.25} value={rd.spokeWidth ?? 1}
                  onChange={(e) => setRd({ spokeWidth: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Vertex dots</span>
                <input type="checkbox" checked={rd.showDots !== false} onChange={(e) => setRd({ showDots: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Dot size</span>
                <input type="number" className="numin" min={0} max={10} step={0.5} value={rd.dotSize ?? 2.5}
                  onChange={(e) => setRd({ dotSize: Number(e.target.value) })} />
              </label>
              <label className="frow" title="Draw a spread interval at each vertex — radar's error bars. Needs replicates (a grouped datasheet) or a Mean+SD entry format; a single-value radar shows nothing.">
                <span>Error bars</span>
                <select className="selin" value={rd.errorType ?? "none"} onChange={(e) => setRd({ errorType: e.target.value as NonNullable<Plot["radar"]>["errorType"] })}>
                  <option value="none">None</option>
                  <option value="sd">± SD</option>
                  <option value="sem">± SEM</option>
                  <option value="ci95">95% CI</option>
                </select>
              </label>
              {rd.errorType && rd.errorType !== "none" && (
                <label className="frow" title="Show the spread as a translucent band between the low/high polygons instead of a whisker at each vertex.">
                  <span>As band</span>
                  <input type="checkbox" checked={rd.errorBand === true} onChange={(e) => setRd({ errorBand: e.target.checked })} />
                </label>
              )}
              <label className="frow" title="Dash pattern for the concentric rings.">
                <span>Grid dashes</span>
                <select className="selin" value={rd.gridDash ?? "solid"} onChange={(e) => setRd({ gridDash: e.target.value as LineDash })}>
                  {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="frow" title="Dash pattern for the radial spokes.">
                <span>Spoke dashes</span>
                <select className="selin" value={rd.spokeDash ?? "solid"} onChange={(e) => setRd({ spokeDash: e.target.value as LineDash })}>
                  {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="frow" title="Small marks on the vertical axis at each labelled ring, like the ticks on a normal axis.">
                <span>Tick marks</span>
                <input type="checkbox" checked={rd.showTicks ?? false} onChange={(e) => setRd({ showTicks: e.target.checked || undefined })} />
              </label>
              {rd.showTicks && (
                <>
                  <label className="frow">
                    <span>Tick length</span>
                    <input type="number" className="numin" min={1} max={20} step={0.5} value={rd.tickLen ?? 5}
                      onChange={(e) => setRd({ tickLen: Number(e.target.value) })} />
                  </label>
                  <label className="frow">
                    <span>Tick colour</span>
                    <ColorInput className="colorin" value={rd.tickColor ?? rd.gridColor ?? "#d9d6dc"} aria-label="Tick colour" onChange={(c) => setRd({ tickColor: c })} />
                  </label>
                </>
              )}
              {/* The edge (category) labels have their own font rather than the plot-wide tick
                  font, which a radar has no other use for and no panel on this chart exposes.
                  The ring values have a second one, because they are numbers and usually want
                  to be smaller than the names. */}
              <FontControls
                label="Edge label font"
                element="tick"
                spec={rd.labelFont ?? plot.fonts?.tick}
                defaultSize={12}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => setRd({ labelFont: { ...(rd.labelFont ?? {}), ...patch } })}
              />
              <FontControls
                label="Ring value font"
                element="tick"
                spec={rd.ringFont ?? rd.labelFont ?? plot.fonts?.tick}
                defaultSize={12}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => setRd({ ringFont: { ...(rd.ringFont ?? {}), ...patch } })}
              />
              <p className="note" style={{ fontSize: 11 }}>Click any ring, spoke or edge label on the graph to come back here.</p>
            </Section>
          );
        })()}

        {kind === "parallel" && (() => {
          const pcs = plot.parallel ?? {};
          const setPc = (patch: Partial<NonNullable<Plot["parallel"]>>) => onSetPlotOptions({ parallel: { ...pcs, ...patch } });
          return (
            <Section title="Parallel coordinates" open>
              {/* Note: the note mentions the click as well as the two drags; without it the
                  per-axis panel (tick interval, minor ticks, …) is hard to discover. */}
              <p className="note" style={{ fontSize: 11 }}>Each numeric column is a vertical axis; each row is a line. Colour by a category (hues) or a numeric column (a value ramp + colorbar). <b>Click a variable name</b> for that axis&rsquo;s own ticks, label and number format. <b>Drag on an axis</b> to filter a range (click to clear); <b>drag a variable label</b> sideways to reorder the axes.</p>
              {pcs.brushes && Object.keys(pcs.brushes).length > 0 && (
                <label className="frow">
                  <span>Filters</span>
                  <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setPc({ brushes: {} })}>Clear all ({Object.keys(pcs.brushes).length})</button>
                </label>
              )}
              <label className="frow" title="Colour each line by this column; it's excluded from the axes. A numeric column gives a continuous ramp, a text column gives category hues.">
                <span>Colour by</span>
                <select className="selin" value={pcs.colorColumn ?? ""} onChange={(e) => setPc({ colorColumn: e.target.value || undefined })}>
                  <option value="">None (single colour)</option>
                  {table.columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              {pcs.colorColumn && (
                <>
                  <label className="frow" title="Auto = a numeric column → a continuous value ramp (+ colorbar); a text column → category hues (+ legend). Force one if the auto pick is wrong.">
                    <span>Colour scale</span>
                    <select className="selin" value={pcs.colorScale ?? "auto"} onChange={(e) => setPc({ colorScale: e.target.value as "auto" | "category" | "value" })}>
                      <option value="auto">Auto</option>
                      <option value="value">Continuous (value ramp)</option>
                      <option value="category">Categories (hues)</option>
                    </select>
                  </label>
                  {(pcs.colorScale ?? "auto") !== "category" && (
                    <>
                      <label className="frow" title="Colour ramp for the continuous value colouring.">
                        <span>Ramp</span>
                        <select className="selin" value={pcs.colorRamp ?? "viridis"}
                          onChange={(e) => pickRamp(e.target.value, pcs.colorRamp ?? "viridis", (ref) => setPc({ colorRamp: ref as NonNullable<Plot["parallel"]>["colorRamp"] }))}>
                          {rampOpts(HEATMAP_COLORMAPS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </label>
                      <label className="frow">
                        <span>Reverse ramp</span>
                        <input type="checkbox" checked={pcs.colorReverse === true} onChange={(e) => setPc({ colorReverse: e.target.checked })} />
                      </label>
                      <RampShapeRows
                        midpoint={pcs.colorMidpoint} gamma={pcs.colorGamma} steps={pcs.colorSteps} space={pcs.colorSpace}
                        onChange={(pt) => setPc({
                          ...("midpoint" in pt ? { colorMidpoint: pt.midpoint } : {}),
                          ...("gamma" in pt ? { colorGamma: pt.gamma } : {}),
                          ...("steps" in pt ? { colorSteps: pt.steps } : {}),
                          ...("space" in pt ? { colorSpace: pt.space } : {}),
                        })}
                      />
                    </>
                  )}
                </>
              )}
              <label className="frow">
                <span>Line width</span>
                <input type="number" className="numin" min={0.25} max={6} step={0.25} value={pcs.lineWidth ?? 1}
                  onChange={(e) => setPc({ lineWidth: Number(e.target.value) })} />
              </label>
              <label className="frow" title="Low opacity reveals density where many lines overlap.">
                <span>Line opacity</span>
                <input type="number" className="numin" min={0.05} max={1} step={0.05} value={pcs.lineOpacity ?? 0.6}
                  onChange={(e) => setPc({ lineOpacity: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Curved links</span>
                <input type="checkbox" checked={pcs.curved === true} onChange={(e) => setPc({ curved: e.target.checked })} />
              </label>
              <label className="frow" title="A scale of round values down each axis, so a point can be read off the middle of an axis and not just at its ends.">
                <span>Value ticks</span>
                <input type="checkbox" checked={pcs.showTicks !== false} onChange={(e) => setPc({ showTicks: e.target.checked })} />
              </label>
              {pcs.showTicks !== false && (
                <label className="frow" title="Blank = auto (as many as fit without the labels colliding). A hint: values are snapped to a round 1/2/5 scale, so the count landed on is the nearest one that stays round.">
                  <span>Ticks per axis</span>
                  <input type="number" className="numin" min={2} max={8} step={1} placeholder="auto" value={pcs.tickCount ?? ""}
                    onChange={(e) => setPc({ tickCount: e.target.value === "" ? undefined : Number(e.target.value) })} />
                </label>
              )}
              <label className="frow">
                <span>Axis colour</span>
                <ColorInput className="colorin" value={pcs.axisColor ?? "#b8b4bd"} aria-label="Axis colour" onChange={(c) => setPc({ axisColor: c })} />
              </label>
              {!pcs.colorColumn && (
                <label className="frow">
                  <span>Line colour</span>
                  <ColorInput className="colorin" value={pcs.lineColor ?? "#1f77b4"} aria-label="Line colour" onChange={(c) => setPc({ lineColor: c })} />
                </label>
              )}
              {/* Two fonts, because an axis draws two different things: the variable name (the
                  axis's title) and the scale numbers (its ticks). Both are reachable here since
                  parallel has no AxisPanel. With one shared font,
                  shrinking the numbers would shrink every name with them. */}
              <FontControls label="Variable name font" element="axisTitle" spec={plot.fonts?.axisTitle} defaultSize={15} onSetPlotFont={onSetPlotFont} />
              <FontControls label="Tick value font" element="tick" spec={plot.fonts?.tick} defaultSize={11} onSetPlotFont={onSetPlotFont} />
            </Section>
          );
        })()}

        {/* The parallel value colour bar. A separate section titled "Colour bar" (like the
            heatmap's) because clicking the bar on the graph pins this section — the routing
            matches on that title, so the two must stay named alike. */}
        {kind === "parallel" && (plot.parallel?.colorScale ?? "auto") !== "category" && plot.parallel?.colorColumn && (() => {
          const pcs = plot.parallel ?? {};
          const colName = table.columns.find((c) => c.id === pcs.colorColumn)?.name ?? "";
          return (
            <Section title="Colour bar (legend)" open>
              <label className="frow" title="Heading drawn beside the colour bar. Blank = the colour column's name.">
                <span>Title</span>
                <input
                  type="text"
                  className="numin"
                  placeholder={colName}
                  value={pcs.colorbarTitle ?? ""}
                  onChange={(e) => onSetPlotOptions({ parallel: { ...pcs, colorbarTitle: e.target.value.trim() === "" ? undefined : e.target.value } })}
                />
              </label>
              <p className="note" style={{ fontSize: 11, marginTop: 6 }}>
                You can also double-click the title on the graph to rename it, and drag the bar to reposition it. The ramp itself is in the <strong>Parallel coordinates</strong> panel.
              </p>
            </Section>
          );
        })()}

        {plot.fit?.params && plot.fit.params.length > 0 && (() => {
          const fp = plot.fitParams ?? {};
          const setFp = (patch: Partial<NonNullable<Plot["fitParams"]>>) => onSetPlotOptions({ fitParams: { ...fp, ...patch } });
          return (
            <Section title="Fit parameters" open>
              <p className="note" style={{ fontSize: 11 }}>
                The fitted values printed on the graph. Tick the ones to show. Drag a line to move it —
                anywhere, including outside the axes — and double-click it to type your own text (units, a
                different name). The numbers update with the fit; a line you typed keeps your text and warns
                if its fitted value changes.
              </p>
              <label className="frow" title="Show the fitted parameters on the graph">
                <span>Show</span>
                <input
                  type="checkbox"
                  aria-label="Show fit parameters"
                  checked={fp.show !== false}
                  onChange={(e) => setFp({ show: e.target.checked ? undefined : false })}
                />
              </label>
              <label className="frow" title="Which edge the lines align to.">
                <span>Align</span>
                <select
                  className="selin"
                  aria-label="Fit parameter alignment"
                  value={fp.align ?? "right"}
                  onChange={(e) => setFp({ align: e.target.value as "left" | "right" })}
                >
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </label>
              <label className="frow" title="Font size of the block; blank follows the legend size">
                <span>Size</span>
                <input
                  type="number"
                  className="numin"
                  aria-label="Fit parameter size"
                  min={5}
                  max={40}
                  value={fp.size ?? ""}
                  placeholder="auto"
                  onChange={(e) => setFp({ size: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </label>
              <label className="frow" title="On: the lines move as one block. Off: drag each line on its own.">
                <span>Move lines together</span>
                <input
                  type="checkbox"
                  aria-label="Move fit parameter lines together"
                  checked={fp.together === true}
                  // Joining the lines puts each back in its place in the block.
                  onChange={(e) => setFp(e.target.checked
                    ? { together: true, lines: fitLinesWithout(fp.lines, "offset") }
                    : { together: undefined })}
                />
              </label>
              <div className="fit-param-lines" role="group" aria-label="Fit parameter lines">
                {(plot.fit.params ?? []).map((fitted, k) => {
                  const key = plot.fit?.paramKeys?.[k] ?? `#${k}`;
                  const lo = fp.lines?.[key] ?? {};
                  const shown = lo.show ?? k < 6;
                  const typed = lo.text;
                  const stale = typed !== undefined && lo.fittedText !== undefined && lo.fittedText !== fitted;
                  const setLine = (patch: Partial<FitParamLine>) =>
                    setFp({ lines: { ...(fp.lines ?? {}), [key]: { ...lo, ...patch } } });
                  return (
                    <div key={key} className="frow" title={typed !== undefined ? `Fitted: ${fitted}` : undefined}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                        <input
                          type="checkbox"
                          aria-label={`Show ${key}`}
                          checked={shown}
                          onChange={(e) => setLine({ show: e.target.checked })}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(typed ?? fitted).replace(/[\^_]\{([^}]*)\}/g, "$1")}
                        </span>
                      </label>
                      {stale && <span className="warn" style={{ fontSize: 11 }} title={`The fit now gives: ${fitted}`}>value changed</span>}
                      {typed !== undefined && (
                        <button
                          className="btn-mini"
                          aria-label={`Reset ${key} to the fitted text`}
                          onClick={() => setLine({ text: undefined, fittedText: undefined })}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {(fp.offset || Object.values(fp.lines ?? {}).some((l) => l.offset)) && (
                <button className="btn-mini" onClick={() => setFp({ offset: undefined, lines: fitLinesWithout(fp.lines, "offset") })}>
                  Reset position
                </button>
              )}
            </Section>
          );
        })()}
        {kind === "image" && (() => {
          const im = plot.image ?? { src: "" };
          const setIm = (patch: Partial<NonNullable<Plot["image"]>>) => onSetPlotOptions({ image: { ...im, ...patch } });
          return (
            <Section title="Image" open>
              <p className="note" style={{ fontSize: 11 }}>
                A picture panel — a micrograph, blot, schematic or diagram. The image is embedded in the project, so it
                travels with the file.
              </p>
              <label
                className="frow"
                title="How the picture fills a panel of a different shape. Contain never crops or distorts it — the faithful default for a micrograph. Cover fills the panel and crops the overflow; Stretch distorts."
              >
                <span>Fit</span>
                <select
                  className="selin"
                  aria-label="Image fit"
                  value={im.fit ?? "contain"}
                  onChange={(e) => setIm({ fit: e.target.value as "contain" | "cover" | "fill" })}
                >
                  <option value="contain">Contain (never crop or distort)</option>
                  <option value="cover">Cover (fill, cropping the overflow)</option>
                  <option value="fill">Stretch (distorts)</option>
                </select>
              </label>
              <label className="frow" title="Turn the picture in quarter turns — for a scan or micrograph that arrived sideways. The panel shows the rotated frame at its true aspect.">
                <span>Rotate</span>
                <select
                  className="selin"
                  aria-label="Image rotation"
                  value={String(im.rotate ?? 0)}
                  onChange={(e) => { const v = Number(e.target.value) as 0 | 90 | 180 | 270; setIm({ rotate: v === 0 ? undefined : v }); }}
                >
                  <option value="0">None</option>
                  <option value="90">90° clockwise</option>
                  <option value="180">180°</option>
                  <option value="270">90° counter-clockwise</option>
                </select>
              </label>
              {(() => {
                // Crop, as trimmed-off percentages per edge (of the displayed orientation) —
                // stored as the remaining window {x,y,w,h} in fractions of the source.
                const c = im.crop ?? { x: 0, y: 0, w: 1, h: 1 };
                const pct = { left: c.x, right: 1 - c.x - c.w, top: c.y, bottom: 1 - c.y - c.h };
                const setEdge = (edge: keyof typeof pct, raw: number): void => {
                  const v = Math.max(0, Math.min(90, raw)) / 100;
                  const p = { ...pct, [edge]: v };
                  // Never let the window collapse: opposing edges keep ≥5% of the picture.
                  const w = Math.max(0.05, 1 - p.left - p.right);
                  const h = Math.max(0.05, 1 - p.top - p.bottom);
                  const next = { x: Math.min(p.left, 1 - w), y: Math.min(p.top, 1 - h), w, h };
                  const isFull = next.x === 0 && next.y === 0 && next.w === 1 && next.h === 1;
                  setIm({ crop: isFull ? undefined : next });
                };
                const edgeInput = (edge: keyof typeof pct, label: string): React.ReactNode => (
                  <input
                    key={edge}
                    type="number"
                    className="numin"
                    style={{ width: 52 }}
                    min={0}
                    max={90}
                    step={1}
                    aria-label={`Crop ${label} %`}
                    value={Math.round(pct[edge] * 100)}
                    onChange={(e) => setEdge(edge, Number(e.target.value))}
                  />
                );
                return (
                  <>
                    <label className="frow" title="Trim the picture — the percentage cut off each side. The panel shows only the remaining window, at its true aspect. Your framing choice, shown here, never a silent crop.">
                      <span>Crop L/R %</span>
                      <span style={{ display: "flex", gap: 4 }}>{edgeInput("left", "left")}{edgeInput("right", "right")}</span>
                    </label>
                    <label className="frow" title="Trim the picture top and bottom, as percentages.">
                      <span>Crop T/B %</span>
                      <span style={{ display: "flex", gap: 4 }}>{edgeInput("top", "top")}{edgeInput("bottom", "bottom")}</span>
                    </label>
                    {im.crop && (
                      <button type="button" className="btn-mini" onClick={() => setIm({ crop: undefined })} title="Remove the crop — show the whole picture again">
                        Reset crop
                      </button>
                    )}
                  </>
                );
              })()}
              <label
                className="frow"
                title="What the picture shows, in words. Many journals ask for it, screen readers read it out, and the Caption button's drafted caption uses it, since a caption cannot be drafted from the picture itself."
              >
                <span>Alt text</span>
                <input
                  className="selin"
                  aria-label="Image alt text"
                  value={im.alt ?? ""}
                  placeholder="Describe what the picture shows"
                  onChange={(e) => setIm({ alt: e.target.value })}
                />
              </label>
            </Section>
          );
        })()}
        {kind === "treemap" && (() => {
          const tm = plot.treemap ?? {};
          const setTm = (patch: Partial<NonNullable<Plot["treemap"]>>) => onSetPlotOptions({ treemap: { ...tm, ...patch } });
          return (
            <Section title="Treemap" open>
              <p className="note" style={{ fontSize: 11 }}>Cell area is proportional to each value. Click a cell to recolour just that one.</p>
              <label className="frow" title="Voronoi = organic weighted cells; Squarified = the classic rectangular treemap (nested by group).">
                <span>Layout</span>
                <select className="selin" value={tm.layout ?? "voronoi"} onChange={(e) => setTm({ layout: e.target.value as "voronoi" | "squarified" })}>
                  <option value="voronoi">Voronoi (organic cells)</option>
                  <option value="squarified">Squarified (rectangles)</option>
                </select>
              </label>
              {(tm.layout ?? "voronoi") === "voronoi" && (
                <label className="frow">
                  <span>Boundary</span>
                  <select className="selin" value={tm.boundary ?? "circle"} onChange={(e) => setTm({ boundary: e.target.value as "circle" | "ellipse" | "rect" })}>
                    <option value="circle">Circle</option>
                    <option value="ellipse">Ellipse (fill box)</option>
                    <option value="rect">Rectangle</option>
                  </select>
                </label>
              )}
              {table.kind === "partsofwhole" && (
                <label className="frow" title="Colour cells by a category column (e.g. region): each group a hue, shaded light→dark by value.">
                  <span>Colour by group</span>
                  <select className="selin" value={tm.groupColumn ?? ""} onChange={(e) => setTm({ groupColumn: e.target.value || undefined })}>
                    <option value="">None (palette)</option>
                    {table.columns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {table.kind === "partsofwhole" && tm.groupColumn && (tm.layout ?? "voronoi") === "voronoi" && (tm.boundary ?? "circle") !== "rect" && (
                <label className="frow" title="Draw each region's name around the boundary, as a heading for its group of cells. Needs a group column on a circle/ellipse boundary.">
                  <span>Region labels</span>
                  <input type="checkbox" checked={tm.showGroupLabels === true} onChange={(e) => setTm({ showGroupLabels: e.target.checked })} />
                </label>
              )}
              {table.kind === "partsofwhole" && (
                <label className="frow" title="Draw a small icon/emoji atop each cell from this column (a flag or symbol). Small cells omit it.">
                  <span>Cell icon</span>
                  <select className="selin" value={tm.iconColumn ?? ""} onChange={(e) => setTm({ iconColumn: e.target.value || undefined })}>
                    <option value="">None</option>
                    {table.columns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="frow">
                <span>Show labels</span>
                <input type="checkbox" checked={tm.showLabels !== false} onChange={(e) => setTm({ showLabels: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Show values</span>
                <input type="checkbox" checked={tm.showValues === true} onChange={(e) => setTm({ showValues: e.target.checked })} />
              </label>
              <label className="frow" title="Shrink labels on smaller cells so they fit.">
                <span>Scale labels to cell</span>
                <input type="checkbox" checked={tm.scaleLabels !== false} onChange={(e) => setTm({ scaleLabels: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Label size</span>
                <input type="number" className="numin" min={4} max={48} step={0.5} value={tm.labelSize ?? 12}
                  onChange={(e) => setTm({ labelSize: Number(e.target.value) })} />
              </label>
              {/* Cell labels render with the tick font (family/weight/colour); Label size above
                  overrides just the size. Reachable here since treemap has no AxisPanel. */}
              {/* Two controls for one text must not compete. The builder reads
                  `treemap.labelSize ?? fonts.tick.size`, so once "Label size" above is set, a
                  Size row writing the tick font would do nothing. Its size therefore writes that
                  same field; family / weight / colour still go to the shared tick font, which is
                  what draws them. */}
              <FontControls
                label="Cell label font"
                element="tick"
                spec={{ ...(plot.fonts?.tick ?? {}), ...(tm.labelSize != null ? { size: tm.labelSize } : {}) }}
                defaultSize={12}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => {
                  const { size, ...rest } = patch;
                  if (size !== undefined) setTm({ labelSize: size });
                  if (Object.keys(rest).length) onSetPlotFont("tick", rest);
                }}
              />
              <label className="frow">
                <span>Cell border</span>
                <ColorInput className="colorin" value={tm.stroke ?? "#ffffff"} aria-label="Cell border colour" onChange={(c) => setTm({ stroke: c })} />
              </label>
              <label className="frow">
                <span>Border width</span>
                <input type="number" className="numin" min={0} max={8} step={0.25} value={tm.strokeWidth ?? 1.5}
                  onChange={(e) => setTm({ strokeWidth: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Fill opacity</span>
                <input type="number" className="numin" min={0.1} max={1} step={0.05} value={tm.fillOpacity ?? 1}
                  onChange={(e) => setTm({ fillOpacity: Number(e.target.value) })} />
              </label>
              {(tm.layout ?? "voronoi") === "voronoi" && (
                <label className="frow" title="Higher = tighter area accuracy, slower layout.">
                  <span>Layout iterations</span>
                  <input type="number" className="numin" min={20} max={400} step={10} value={tm.iterations ?? 160}
                    onChange={(e) => setTm({ iterations: Number(e.target.value) })} />
                </label>
              )}
              {/* The packing starts from a seeded scatter; the builder honours the seed
                  (`treemap.seed`), and this row sets it. Same areas,
                  another arrangement. Squarified layouts have no randomness, so voronoi only. */}
              {(tm.layout ?? "voronoi") === "voronoi" && (
                <label className="frow" title="Try another arrangement of the same cells — each number gives a different packing; the areas stay exact. Blank = the default arrangement.">
                  <span>Arrangement</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="number" className="numin" style={{ width: 74 }} min={0} step={1} value={tm.seed ?? ""} placeholder="default" aria-label="Arrangement number"
                      onChange={(e) => { const v = e.target.value.trim() === "" ? undefined : Math.round(Number(e.target.value)); setTm({ seed: v !== undefined && Number.isFinite(v) ? v : undefined }); }} />
                    <button type="button" className="btn-mini" title="Next arrangement" onClick={() => setTm({ seed: (tm.seed ?? 0) + 1 })}>Another</button>
                  </span>
                </label>
              )}
            </Section>
          );
        })()}

        {kind === "corrmatrix" && (() => {
          const cm = plot.corrmatrix ?? {};
          const setCm = (patch: Partial<NonNullable<Plot["corrmatrix"]>>) => onSetPlotOptions({ corrmatrix: { ...cm, ...patch } });
          const blockText = (cm.blockSizes ?? []).join(", ");
          return (
            <Section title="Correlation matrix" open>
              <p className="note" style={{ fontSize: 11 }}>Each cell shows the correlation between two columns — pie fill ∝ |r|; the +/− colours follow the figure palette unless you set them below.</p>
              <label className="frow" title="Pearson = linear correlation; Spearman = rank (monotonic) correlation.">
                <span>Correlation</span>
                <select className="selin" value={cm.method ?? "pearson"} onChange={(e) => setCm({ method: e.target.value as "pearson" | "spearman" })}>
                  <option value="pearson">Pearson (linear)</option>
                  <option value="spearman">Spearman (rank)</option>
                </select>
              </label>
              <label className="frow" title="How each cell draws its correlation.">
                <span>Cell glyph</span>
                <select className="selin" value={cm.glyph ?? "pie"} onChange={(e) => setCm({ glyph: e.target.value as "pie" | "circle" | "ellipse" | "square" | "number" })}>
                  <option value="pie">Pie (fill ∝ |r|)</option>
                  <option value="circle">Circle (area ∝ |r|)</option>
                  <option value="ellipse">Ellipse (tilt = sign)</option>
                  <option value="square">Square (colour only)</option>
                  <option value="number">Number (r value)</option>
                </select>
              </label>
              {/* Symbol size, in the cells and in the key beside them. Both were computed from
                  the grid with nothing to change them — and the key's was capped at a 9px radius,
                  so it stayed tiny however large the figure got. Sliders, like every other
                  symbol size in the program. */}
              <label className="frow" title="Size of the glyph in each cell, as a multiple of the size it takes from the cell. 1.2 = glyphs just touching their neighbours.">
                <span>Symbol size</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="range" min={0.2} max={1.2} step={0.05}
                    aria-label="Cell symbol size"
                    value={cm.glyphScale ?? 1}
                    onChange={(e) => setCm({ glyphScale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
                  />
                  <span style={{ width: 34, textAlign: "right" }}>{(cm.glyphScale ?? 1).toFixed(2)}×</span>
                </span>
              </label>
              <label className="frow" title="Size of the symbols in the correlation key, as a multiple of the size they take from the cell.">
                <span>Key symbol size</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="range" min={0.4} max={2} step={0.1}
                    aria-label="Key symbol size"
                    value={cm.legendGlyphScale ?? 1}
                    onChange={(e) => setCm({ legendGlyphScale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
                  />
                  <span style={{ width: 34, textAlign: "right" }}>{(cm.legendGlyphScale ?? 1).toFixed(1)}×</span>
                </span>
              </label>
              <label className="frow" title="Draw only the lower / upper triangle (the matrix is symmetric) or the full square.">
                <span>Show</span>
                <select className="selin" value={cm.triangle ?? "lower"} onChange={(e) => setCm({ triangle: e.target.value as "lower" | "upper" | "full" })}>
                  <option value="lower">Lower triangle</option>
                  <option value="upper">Upper triangle</option>
                  <option value="full">Full matrix</option>
                </select>
              </label>
              <label className="frow">
                <span>Diagonal (r = 1)</span>
                <input type="checkbox" checked={cm.showDiagonal !== false} onChange={(e) => setCm({ showDiagonal: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Show r values</span>
                <input type="checkbox" checked={cm.showValues === true} onChange={(e) => setCm({ showValues: e.target.checked })} />
              </label>
              {cm.showValues && (
                <label className="frow">
                  <span>Decimals</span>
                  <input type="number" className="numin" min={0} max={4} step={1} value={cm.valueDecimals ?? 2} onChange={(e) => setCm({ valueDecimals: Number(e.target.value) })} />
                </label>
              )}
              <label className="frow" title="Colour at r = +1 (blended toward white at 0).">
                <span>Positive colour</span>
                <ColorInput className="colorin" value={cm.positiveColor ?? "#2166ac"} aria-label="Positive-correlation colour" onChange={(c) => setCm({ positiveColor: c })} />
              </label>
              <label className="frow" title="Colour at r = −1 (blended toward white at 0).">
                <span>Negative colour</span>
                <ColorInput className="colorin" value={cm.negativeColor ?? "#b2182b"} aria-label="Negative-correlation colour" onChange={(c) => setCm({ negativeColor: c })} />
              </label>
              <label className="frow">
                <span>Row labels</span>
                <input type="checkbox" checked={cm.showRowLabels !== false} onChange={(e) => setCm({ showRowLabels: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Column labels</span>
                <input type="checkbox" checked={cm.showColLabels !== false} onChange={(e) => setCm({ showColLabels: e.target.checked })} />
              </label>
              <label className="frow" title="Rotate the column labels (0 = horizontal).">
                <span>Label angle</span>
                <input type="number" className="numin" min={0} max={90} step={5} value={cm.labelRotation ?? 45} onChange={(e) => setCm({ labelRotation: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Scale legend</span>
                <input type="checkbox" checked={cm.showLegend !== false} onChange={(e) => setCm({ showLegend: e.target.checked })} />
              </label>
              <label className="frow" title="Draw faint gridlines between cells.">
                <span>Grid lines</span>
                <input type="checkbox" checked={cm.cellBorderColor !== "none" && cm.cellBorderColor !== ""} onChange={(e) => setCm({ cellBorderColor: e.target.checked ? "#e6e6e6" : "none" })} />
              </label>
              <label className="frow" title="Comma-separated group sizes (e.g. 4, 5, 5) → dashed dividers + faint tints marking domain blocks along the diagonal.">
                <span>Domain blocks</span>
                <input type="text" className="numin" style={{ width: 90 }} placeholder="e.g. 4, 5, 5" value={blockText}
                  onChange={(e) => {
                    const sizes = e.target.value.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
                    setCm({ blockSizes: sizes.length ? sizes : undefined });
                  }} />
              </label>
              {/* Row/column/value labels render with the tick font — expose it (corrmatrix has no axis panel). */}
              {/* Writes `corrmatrix.labelFont`, not the shared tick font: the builder caps the
                  tick font at 12px for a matrix label (`labelSize = labelFont?.size ??
                  min(fonts.tick.size, 12)`), so setting that to 30 would change nothing.
                  `corrmatrix.labelFont` exists for exactly this, and it is not capped. */}
              <FontControls
                label="Label font"
                element="tick"
                spec={cm.labelFont ?? plot.fonts?.tick}
                defaultSize={12}
                onSetPlotFont={onSetPlotFont}
                onSet={(patch) => setCm({ labelFont: { ...(cm.labelFont ?? {}), ...patch } })}
              />
            </Section>
          );
        })()}

        {kind === "alluvial" && (() => {
          const al = plot.alluvial ?? {};
          const setAl = (patch: Partial<NonNullable<Plot["alluvial"]>>) => onSetPlotOptions({ alluvial: { ...al, ...patch } });
          const chosen = new Set(al.columns ?? []);
          const toggleCol = (id: NodeId) => {
            const next = new Set(chosen);
            next.has(id) ? next.delete(id) : next.add(id);
            setAl({ columns: next.size ? [...next] : undefined });
          };
          return (
            <Section title="Alluvial / parallel sets" open>
              <p className="note" style={{ fontSize: 11 }}>Each categorical column is an axis; ribbons connect category blocks, sized by shared-row counts. Colours flow across all axes.</p>
              <div className="frow" style={{ alignItems: "flex-start" }}>
                <span title="Which columns are the ordered axes (left→right, table order). None checked = auto (every text column).">Axes</span>
                <div className="angroups" style={{ maxHeight: 130 }}>
                  {table.columns.map((c) => (
                    <label className="angroup" key={c.id}>
                      <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggleCol(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
              <label className="frow" title="Colour each stream by its category on the first or last axis.">
                <span>Colour by</span>
                <select className="selin" value={al.colorBy ?? "first"} onChange={(e) => setAl({ colorBy: e.target.value as "first" | "last" })}>
                  <option value="first">First axis</option>
                  <option value="last">Last axis</option>
                </select>
              </label>
              <label className="frow">
                <span>Straight ribbons</span>
                <input type="checkbox" checked={al.straight === true} onChange={(e) => setAl({ straight: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Ribbon opacity</span>
                <input type="number" className="numin" min={0.05} max={1} step={0.05} value={al.ribbonOpacity ?? 0.5} onChange={(e) => setAl({ ribbonOpacity: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Node width</span>
                <input type="number" className="numin" min={2} max={48} step={1} value={al.nodeWidth ?? 16} onChange={(e) => setAl({ nodeWidth: Number(e.target.value) })} />
              </label>
              <label className="frow" title="Gap between stacked category blocks, as a fraction of plot height.">
                <span>Node gap</span>
                <input type="number" className="numin" min={0} max={0.2} step={0.005} value={al.nodeGap ?? 0.02} onChange={(e) => setAl({ nodeGap: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Show labels</span>
                <input type="checkbox" checked={al.showLabels !== false} onChange={(e) => setAl({ showLabels: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Node colour</span>
                <ColorInput className="colorin" value={al.nodeColor ?? "#9aa0aa"} aria-label="Node colour" onChange={(c) => setAl({ nodeColor: c })} />
              </label>
              {/* AlluvialFigure draws every category-block label with fonts.tick — expose it
                  (alluvial has no axis panel), so the labels' typeface is reachable. */}
              {al.showLabels !== false && (
                <FontControls label="Node label font" element="tick" spec={plot.fonts?.tick} defaultSize={12} onSetPlotFont={onSetPlotFont} />
              )}
            </Section>
          );
        })()}

        {kind === "network" && (() => {
          const nw = plot.network ?? {};
          const setNw = (patch: Partial<NonNullable<Plot["network"]>>) => onSetPlotOptions({ network: { ...nw, ...patch } });
          const layout = nw.layout ?? "force";
          // Bindable data columns = everything past the two endpoint columns. The builder
          // refuses a bad pick with a scene warning, so the lists stay simple.
          const dataCols = table.columns.slice(2);
          return (
            <Section title="Network graph" open>
              <p className="note" style={{ fontSize: 11 }}>The table is an edge list: the first two columns are the source and target; the next numeric column is the edge weight (a signed weight — e.g. a correlation — keeps its sign for link colouring), and a further numeric column colours each node on a diverging scale. The selectors below can instead colour nodes by a category column and size them by a metric column.</p>
              <label className="frow" title="Node placement algorithm.">
                <span>Layout</span>
                <select className="selin" value={layout} onChange={(e) => setNw({ layout: e.target.value as "force" | "circular" | "layered" })}>
                  <option value="force">Force-directed</option>
                  <option value="layered">Layered (columns)</option>
                  <option value="circular">Circular</option>
                </select>
              </label>
              <label className="frow">
                <span>Node size</span>
                <input type="range" min={2} max={16} step={0.5} value={nw.nodeSize ?? 6} onChange={(e) => setNw({ nodeSize: Number(e.target.value) })} />
              </label>
              {/* When a size column owns the channel, the degree tickbox would be misleading
                  (the builder ignores it) — the select row replaces it. */}
              {!nw.sizeColumn && (
                <label className="frow" title="Scale each node's radius by how many edges it has.">
                  <span>Size by degree</span>
                  <input type="checkbox" checked={nw.sizeByDegree ?? true} onChange={(e) => setNw({ sizeByDegree: e.target.checked })} />
                </label>
              )}
              <label className="frow" title="Size each node from a numeric column (read from the row where the node first appears as a source). Area tracks the value; replaces degree sizing.">
                <span>Size nodes by</span>
                <select className="selin" value={nw.sizeColumn ?? ""} onChange={(e) => setNw({ sizeColumn: (e.target.value || undefined) as typeof nw.sizeColumn })}>
                  <option value="">None (degree)</option>
                  {dataCols.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="frow" title="Colour each node from a category column (read from the row where the node first appears as a source): one palette colour per group, plus a group legend.">
                <span>Colour nodes by</span>
                <select className="selin" value={nw.groupColumn ?? ""} onChange={(e) => setNw({ groupColumn: (e.target.value || undefined) as typeof nw.groupColumn })}>
                  <option value="">None (value / flat)</option>
                  {dataCols.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="frow" title="Node fill when no value column colours them.">
                <span>Node colour</span>
                <ColorInput className="colorin" value={nw.nodeColor ?? "#0072B2"} aria-label="Node colour" onChange={(c) => setNw({ nodeColor: c })} />
              </label>
              <label className="frow" title="Two-tone fill: draw each node's outline as a darker shade of its fill colour (outline darker than the inner fill).">
                <span>Two-tone fill</span>
                {/**
                  * Off is stored as an explicit false — `|| undefined` would mean "inherit", i.e. back to on.
                  *
                  * The untouched state must match the picture. A shared `nodeStroke` wins over
                  * two-tone, and the network house default always sets one (`var(--bg)`, the
                  * page-colour halo), so a plain `?? true` would show the box ticked on every
                  * network while the nodes draw a plain halo.
                  *
                  * `nodeStroke === undefined` is exactly the builder's condition for falling through
                  * to two-tone, so the tick says what is drawn. An explicit choice still wins.
                  */}
                <input type="checkbox" aria-label="Two-tone nodes (darker outline)" checked={nw.nodeTwoTone ?? nw.nodeStroke === undefined} onChange={(e) => setNw({ nodeTwoTone: e.target.checked })} />
              </label>
              <label className="frow" title="Outline colour drawn around every node. ⨯ returns to the theme background ring.">
                <span>Node outline</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <ColorInput className="colorin" value={nw.nodeStroke ?? "#ffffff"} aria-label="Node outline colour" onChange={(c) => setNw({ nodeStroke: c })} />
                  <button type="button" className="swbtn" title="Theme outline (clear the override)" onClick={() => setNw({ nodeStroke: undefined })}>⨯</button>
                </span>
              </label>
              <label className="frow" title="Outline thickness around every node, px.">
                <span>Outline width</span>
                <input type="number" className="numin" min={0} max={10} step={0.25} value={nw.nodeStrokeWidth ?? 1} onChange={(e) => setNw({ nodeStrokeWidth: Number(e.target.value) })} />
              </label>
              <label className="frow" title="Diverging colour-scale endpoints for the per-node value column.">
                <span>Value low → high</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <ColorInput className="colorin" value={nw.lowColor ?? "#3b6fb0"} aria-label="Low value colour" onChange={(c) => setNw({ lowColor: c })} />
                  <ColorInput className="colorin" value={nw.highColor ?? "#c0392b"} aria-label="High value colour" onChange={(c) => setNw({ highColor: c })} />
                </span>
              </label>
              <label className="frow">
                <span>Edge width</span>
                <input type="number" className="numin" min={0.25} max={8} step={0.25} value={nw.edgeWidth ?? 1} onChange={(e) => setNw({ edgeWidth: Number(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Edge colour</span>
                <ColorInput className="colorin" value={nw.edgeColor ?? "#5b6470"} aria-label="Edge colour" onChange={(c) => setNw({ edgeColor: c })} />
              </label>
              <label className="frow" title="Colour each link by its weight's sign — positive one colour, negative another (the correlation-network look), plus a sign legend. Links without a weight keep the edge colour.">
                <span>Colour links by sign</span>
                <input type="checkbox" checked={nw.edgeSignColors === true} onChange={(e) => setNw({ edgeSignColors: e.target.checked })} />
              </label>
              {nw.edgeSignColors === true && (
                <label className="frow" title="Positive-link and negative-link colours.">
                  <span>Link + / −</span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <ColorInput className="colorin" value={nw.edgePositiveColor ?? "#c0392b"} aria-label="Positive link colour" onChange={(c) => setNw({ edgePositiveColor: c })} />
                    <ColorInput className="colorin" value={nw.edgeNegativeColor ?? "#3b6fb0"} aria-label="Negative link colour" onChange={(c) => setNw({ edgeNegativeColor: c })} />
                  </span>
                </label>
              )}
              <label className="frow">
                <span>Edge opacity</span>
                <input type="number" className="numin" min={0.05} max={1} step={0.05} value={nw.edgeOpacity ?? 0.5} onChange={(e) => setNw({ edgeOpacity: Number(e.target.value) })} />
              </label>
              <label className="frow" title="Draw edges as gentle curves instead of straight lines.">
                <span>Curved edges</span>
                <input type="checkbox" checked={nw.curved === true} onChange={(e) => setNw({ curved: e.target.checked })} />
              </label>
              <label className="frow">
                <span>Show labels</span>
                <input type="checkbox" checked={nw.showLabels !== false} onChange={(e) => setNw({ showLabels: e.target.checked })} />
              </label>
              {nw.showLabels !== false && (
                <label className="frow" title="Node-label size. Node labels are sized for the diagram, not by the axis tick font — at the tick default a name is wider than the gap between nodes.">
                  <span>Label size</span>
                  <input type="number" className="numin" min={5} max={40} step={1} value={nw.labelSize ?? 12} onChange={(e) => setNw({ labelSize: Number(e.target.value) })} />
                </label>
              )}
              {nw.showLabels !== false && (
                <label className="frow" title="Only label nodes with at least this many edges (0 = label all).">
                  <span>Label min degree</span>
                  <input type="number" className="numin" min={0} max={20} step={1} value={nw.labelMinDegree ?? 0} onChange={(e) => setNw({ labelMinDegree: Number(e.target.value) })} />
                </label>
              )}
              {nw.showLabels !== false && (
                <FontControls label="Node label font" element="tick" spec={plot.fonts?.tick} defaultSize={12} onSetPlotFont={onSetPlotFont} hideSize />
              )}
            </Section>
          );
        })()}

        {kind === "heatmap" && (() => {
          const h = plot.heatmap ?? {};
          const set = (patch: Partial<NonNullable<Plot["heatmap"]>>) => onSetPlotOptions({ heatmap: { ...h, ...patch } });
          const numOrAuto = (s: string) => (s.trim() === "" ? undefined : Number(s));
          const mode = h.mode ?? "matrix";
          const isPoint = mode === "density2d" || mode === "hexbin";
          return (
            <Section title="Heatmap" open>
              <label className="frow">
                <span>Mode</span>
                <select className="selin" value={mode} onChange={(e) => set({ mode: e.target.value as typeof h.mode })}>
                  <option value="matrix">Matrix (row × column)</option>
                  <option value="density2d">2D density cloud (KDE)</option>
                  <option value="hexbin">Hexbin (point counts)</option>
                </select>
              </label>
              {isPoint && (
                <label className="frow">
                  <span>Resolution</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="range" min={10} max={90} step={2} value={h.resolution ?? 40} onChange={(e) => set({ resolution: Number(e.target.value) })} />
                    <span style={{ width: 28, textAlign: "right" }}>{h.resolution ?? 40}</span>
                  </span>
                </label>
              )}
              {!isPoint && (
                <label className="frow" title="How each cell draws its value. Tiles = the classic filled heatmap. Bubbles = a centred dot whose area is proportional to the value's size (its magnitude when the scale crosses zero — a −0.8 dot draws as big as a +0.8 one, the colour carries the sign), in the same ramp colours — the publication bubble grid / dot plot.">
                  <span>Cells</span>
                  <select className="selin" value={h.cellShape ?? "tile"} onChange={(e) => set({ cellShape: e.target.value === "tile" ? undefined : (e.target.value as typeof h.cellShape) })}>
                    <option value="tile">Tiles (filled)</option>
                    <option value="bubble">Bubbles (size = value)</option>
                  </select>
                </label>
              )}
              <label className="frow">
                <span>Colormap</span>
                <select className="selin" value={h.colormap ?? "viridis"}
                  onChange={(e) => pickRamp(e.target.value, h.colormap ?? "viridis", (ref) => set({ colormap: ref as typeof h.colormap }))}>
                  {rampOpts(HEATMAP_COLORMAPS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="frow">
                <span>Reverse</span>
                <input type="checkbox" checked={h.reverse ?? false} onChange={(e) => set({ reverse: e.target.checked })} />
              </label>
              <RampShapeRows
                midpoint={h.colorMidpoint} gamma={h.colorGamma} steps={h.colorSteps} space={h.colorSpace}
                onChange={(pt) => set({
                  ...("midpoint" in pt ? { colorMidpoint: pt.midpoint } : {}),
                  ...("gamma" in pt ? { colorGamma: pt.gamma } : {}),
                  ...("steps" in pt ? { colorSteps: pt.steps } : {}),
                  ...("space" in pt ? { colorSpace: pt.space } : {}),
                })}
              />
              <label className="frow">
                <span>Scale min</span>
                <input type="number" className="numin" placeholder="auto" value={h.valueMin ?? ""} onChange={(e) => set({ valueMin: numOrAuto(e.target.value) })} />
              </label>
              <label className="frow">
                <span>Scale max</span>
                <input type="number" className="numin" placeholder="auto" value={h.valueMax ?? ""} onChange={(e) => set({ valueMax: numOrAuto(e.target.value) })} />
              </label>
              {!isPoint && (
                <label className="frow">
                  <span>Show values</span>
                  <input type="checkbox" checked={h.showValues ?? false} onChange={(e) => set({ showValues: e.target.checked })} />
                </label>
              )}
              {/* In-cell value text colour; blank = per-cell auto contrast (builder: valueColor ?? contrast). */}
              {!isPoint && h.showValues && (
                <label className="frow" title="Colour of the in-cell value text (blank = automatic per-cell contrast)">
                  <span>Value text colour</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <ColorInput className="colorin" value={h.valueColor ?? "#000000"} aria-label="Value text colour" onChange={(c) => set({ valueColor: c })} />
                    <button type="button" className="swbtn" title="Auto (per-cell contrast)" onClick={() => set({ valueColor: undefined })}>⨯</button>
                  </span>
                </label>
              )}
              {/* Splits: the shared setting first, then the per-break list. The order is the
                  point — the row everybody reaches for sits above, and a break only leaves it
                  when the user deliberately overrides that break. */}
              {!isPoint && (() => {
                const dflt = {
                  style: h.splitStyle ?? "gap" as const,
                  gap: h.splitGap ?? 8,
                  lineWidth: h.splitLineWidth ?? 1.5,
                  color: h.splitColor ?? "#333333",
                };
                const nRows = table?.rows.length ?? 0;
                const nCols = tableDatasets(table ?? { id: "", kind: "xy", name: "", columns: [], rows: [] }).length;
                const any = (h.rowSplits?.length ?? 0) + (h.colSplits?.length ?? 0) > 0;
                const clustering = h.cluster ?? "none";
                const clustersRows = clustering === "rows" || clustering === "both";
                const clustersCols = clustering === "columns" || clustering === "both";
                const rowsFromTree = clustersRows && (h.rowSplitK ?? 0) >= 2;
                const colsFromTree = clustersCols && (h.colSplitK ?? 0) >= 2;
                return (
                  <>
                    <h4 className="inspsub">Splits</h4>
                    <label className="frow" title="How every break is drawn unless that break says otherwise: an empty space, a rule, or a rule inside a space.">
                      <span>Break style</span>
                      <select className="selin" aria-label="Break style for all splits" value={h.splitStyle ?? "gap"}
                        onChange={(e) => set({ splitStyle: e.target.value as typeof h.splitStyle })}>
                        <option value="gap">Space</option>
                        <option value="line">Rule</option>
                        <option value="both">Space + rule</option>
                      </select>
                    </label>
                    {dflt.style !== "line" && (
                      <label className="frow" title="Width of the space every break opens, in pixels.">
                        <span>Space</span>
                        <input type="number" className="numin" min={0} max={80} step={1} aria-label="Space for all splits"
                          value={h.splitGap ?? 8} onChange={(e) => set({ splitGap: Number(e.target.value) })} />
                      </label>
                    )}
                    {dflt.style !== "gap" && (
                      <>
                        <label className="frow" title="Thickness of the rule every break draws, in pixels.">
                          <span>Rule thickness</span>
                          <input type="number" className="numin" min={0} max={12} step={0.5} aria-label="Rule thickness for all splits"
                            value={h.splitLineWidth ?? 1.5} onChange={(e) => set({ splitLineWidth: Number(e.target.value) })} />
                        </label>
                        <label className="frow">
                          <span>Rule colour</span>
                          <ColorInput className="colorin" aria-label="Rule colour for all splits"
                            value={h.splitColor ?? "#333333"} onChange={(c) => set({ splitColor: c })} />
                        </label>
                        <label className="frow" title="Dash pattern every rule draws with, unless that break says otherwise.">
                          <span>Rule dash</span>
                          <select className="selin" aria-label="Rule dash for all splits" value={h.splitDash ?? "solid"}
                            onChange={(e) => set({ splitDash: e.target.value as typeof h.splitDash })}>
                            <option value="solid">Solid</option>
                            <option value="dashed">Dashed</option>
                            <option value="dotted">Dotted</option>
                            <option value="dashdot">Dash-dot</option>
                            <option value="longdash">Long dash</option>
                          </select>
                        </label>
                      </>
                    )}
                    {/* Blocks from the tree — offered only on an axis that has a tree, because
                        cutting one that does not exist can only draw nothing. When it is on, the
                        hand-placed list for that axis is hidden: it would not be drawn, and a
                        list of breaks that does nothing is worse than no list. */}
                    {(clustersRows || clustersCols) && (
                      <p className="hint">
                        Breaks can follow the clustering instead of row numbers — they then stay right when the data changes.
                      </p>
                    )}
                    {clustersRows && (
                      <label className="frow" title="Cut the row tree into this many blocks and break between them. Blank or 1 = use the breaks you place by hand below.">
                        <span>Row blocks from tree</span>
                        <input type="number" className="numin" min={2} max={Math.max(2, nRows)} step={1}
                          aria-label="Row blocks from the tree" placeholder="off"
                          value={h.rowSplitK ?? ""}
                          onChange={(e) => set({ rowSplitK: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      </label>
                    )}
                    {rowsFromTree ? (
                      <p className="hint">
                        The row breaks come from the tree, so they take the shared look above. Clear the box to place them by hand.
                      </p>
                    ) : (
                      <HeatSplitEditor axis="row" count={nRows} splits={h.rowSplits ?? []} defaults={dflt}
                        selectedAt={selection.kind === "heatmap-split" && selection.axis === "row" ? selection.at : undefined}
                        onChange={(next) => set({ rowSplits: next.length ? next : undefined })} />
                    )}
                    {clustersCols && (
                      <label className="frow" title="Cut the column tree into this many blocks and break between them. Blank or 1 = use the breaks you place by hand below.">
                        <span>Column blocks from tree</span>
                        <input type="number" className="numin" min={2} max={Math.max(2, nCols)} step={1}
                          aria-label="Column blocks from the tree" placeholder="off"
                          value={h.colSplitK ?? ""}
                          onChange={(e) => set({ colSplitK: e.target.value === "" ? undefined : Number(e.target.value) })} />
                      </label>
                    )}
                    {colsFromTree ? (
                      <p className="hint">
                        The column breaks come from the tree, so they take the shared look above. Clear the box to place them by hand.
                      </p>
                    ) : (
                      <HeatSplitEditor axis="col" count={nCols} splits={h.colSplits ?? []} defaults={dflt}
                        selectedAt={selection.kind === "heatmap-split" && selection.axis === "col" ? selection.at : undefined}
                        onChange={(next) => set({ colSplits: next.length ? next : undefined })} />
                    )}
                    <h4 className="inspsub">Annotation strips</h4>
                    <HeatTrackEditor
                      axis="row" table={table!} columns={tableDatasets(table!).map((d) => ({ id: d.id, name: d.name }))}
                      sheetColumns={table!.columns} tracks={h.rowTracks ?? []} ramps={HEATMAP_COLORMAPS}
                      selectedIndex={selection.kind === "heatmap-track" && selection.axis === "row" ? selection.index : undefined}
                      onChange={(next) => set({ rowTracks: next.length ? next : undefined })}
                    />
                    <HeatTrackEditor
                      axis="col" table={table!} columns={tableDatasets(table!).map((d) => ({ id: d.id, name: d.name }))}
                      sheetColumns={table!.columns} tracks={h.colTracks ?? []} ramps={HEATMAP_COLORMAPS}
                      selectedIndex={selection.kind === "heatmap-track" && selection.axis === "col" ? selection.index : undefined}
                      onChange={(next) => set({ colTracks: next.length ? next : undefined })}
                    />
                    {/* Replicate collapse — offered only where there is a strip to group by,
                        because the grouping is what says which rows/columns are replicates of
                        each other. Which strip is pickable when there is more than one. */}
                    {(h.rowTracks?.length ?? 0) > 0 && (
                      <>
                        <label className="frow" title="Average the rows that share a strip value into one row. The collapsed row is labelled so the figure says it is an average.">
                          <span>Collapse rows</span>
                          <select className="selin" aria-label="Collapse replicate rows" value={h.collapseRows ?? "off"}
                            onChange={(e) => set({ collapseRows: e.target.value as typeof h.collapseRows })}>
                            <option value="off">Off (every row)</option>
                            <option value="mean">Average (mean)</option>
                            <option value="median">Average (median)</option>
                          </select>
                        </label>
                        {(h.collapseRows ?? "off") !== "off" && (h.rowTracks?.length ?? 0) > 1 && (
                          <label className="frow" title="Which strip says which rows belong together.">
                            <span>Group rows by</span>
                            <select className="selin" aria-label="Strip that groups the rows" value={h.collapseRowsBy ?? 0}
                              onChange={(e) => set({ collapseRowsBy: Number(e.target.value) })}>
                              {(h.rowTracks ?? []).map((t, i) => (
                                <option key={i} value={i}>{t.name || `Strip ${i + 1}`}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                    {(h.colTracks?.length ?? 0) > 0 && (
                      <>
                        <label className="frow" title="Average the columns that share a strip value into one column — the replicates of a treatment become one.">
                          <span>Collapse columns</span>
                          <select className="selin" aria-label="Collapse replicate columns" value={h.collapseCols ?? "off"}
                            onChange={(e) => set({ collapseCols: e.target.value as typeof h.collapseCols })}>
                            <option value="off">Off (every column)</option>
                            <option value="mean">Average (mean)</option>
                            <option value="median">Average (median)</option>
                          </select>
                        </label>
                        {(h.collapseCols ?? "off") !== "off" && (h.colTracks?.length ?? 0) > 1 && (
                          <label className="frow" title="Which strip says which columns belong together.">
                            <span>Group columns by</span>
                            <select className="selin" aria-label="Strip that groups the columns" value={h.collapseColsBy ?? 0}
                              onChange={(e) => set({ collapseColsBy: Number(e.target.value) })}>
                              {(h.colTracks ?? []).map((t, i) => (
                                <option key={i} value={i}>{t.name || `Strip ${i + 1}`}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </>
                    )}
                    {((h.rowTracks?.length ?? 0) + (h.colTracks?.length ?? 0)) > 0 && (
                      <>
                        <label className="frow" title="Thickness of every strip that does not set its own, in pixels.">
                          <span>Strip size</span>
                          <input type="number" className="numin" min={2} max={60} step={1} aria-label="Size for all strips"
                            value={h.trackSize ?? 16} onChange={(e) => set({ trackSize: Number(e.target.value) })} />
                        </label>
                        <label className="frow" title="Space between a strip and the cells, and between two strips.">
                          <span>Strip gap</span>
                          <input type="number" className="numin" min={0} max={20} step={1} aria-label="Gap between strips"
                            value={h.trackGap ?? 3} onChange={(e) => set({ trackGap: Number(e.target.value) })} />
                        </label>
                        {/* A strip whose values are numbers shades through a ramp, and nothing
                            else on the figure says what the shading means — so it gets a little
                            colour bar. A strip of words needs none: it draws the words. */}
                        <label className="frow" title="Draw a small colour bar for each strip whose values are numbers, showing what its shading means. Strips of words key themselves.">
                          <span>Key for numeric strips</span>
                          <input type="checkbox" aria-label="Key for numeric strips"
                            checked={h.trackKeys !== false} onChange={(e) => set({ trackKeys: e.target.checked })} />
                        </label>
                        {/* The same FontControls the row/column labels get — family, size, bold,
                            italic, because this text is fully editable like every other
                            text on the graph. */}
                        <FontControls
                          label="Strip text font"
                          element="tick"
                          spec={h.trackFont}
                          defaultSize={10}
                          onSetPlotFont={onSetPlotFont}
                          onSet={(patch) => set({ trackFont: { ...(h.trackFont ?? {}), ...patch } })}
                        />
                      </>
                    )}
                    {any && (
                      <FontControls
                        label="Block name font"
                        element="tick"
                        spec={h.splitLabelFont}
                        defaultSize={10}
                        onSetPlotFont={onSetPlotFont}
                        onSet={(patch) => set({ splitLabelFont: { ...(h.splitLabelFont ?? {}), ...patch } })}
                      />
                    )}
                  </>
                );
              })()}
              {!isPoint && (
                <label className="frow" title="Hierarchically cluster and reorder the rows / columns so similar profiles sit adjacent (revealing blocks), with attached dendrograms.">
                  <span>Cluster</span>
                  <select className="selin" value={h.cluster ?? "none"} onChange={(e) => set({ cluster: e.target.value as typeof h.cluster })}>
                    <option value="none">None (table order)</option>
                    <option value="rows">Rows</option>
                    <option value="columns">Columns</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              )}
              {!isPoint && (h.cluster ?? "none") !== "none" && (
                <>
                  <label className="frow" title="Distance metric for clustering.">
                    <span>Distance</span>
                    <select className="selin" value={h.clusterMetric ?? "euclidean"} onChange={(e) => set({ clusterMetric: e.target.value as typeof h.clusterMetric })}>
                      <option value="euclidean">Euclidean</option>
                      <option value="manhattan">Manhattan</option>
                      <option value="correlation">1 − correlation</option>
                    </select>
                  </label>
                  <label className="frow" title="Linkage for clustering.">
                    <span>Linkage</span>
                    <select className="selin" value={h.clusterLinkage ?? "average"} onChange={(e) => set({ clusterLinkage: e.target.value as typeof h.clusterLinkage })}>
                      <option value="average">Average</option>
                      <option value="complete">Complete</option>
                      <option value="single">Single</option>
                      <option value="ward">Ward</option>
                    </select>
                  </label>
                  <label className="frow" title="Draw the attached dendrogram tree(s).">
                    <span>Dendrograms</span>
                    <input type="checkbox" checked={h.showDendrogram ?? true} onChange={(e) => set({ showDendrogram: e.target.checked })} />
                  </label>
                </>
              )}
              {!isPoint && (
                <label className="frow">
                  <span>Missing colour</span>
                  <ColorInput className="colorin" aria-label="Missing colour" value={h.nanColor ?? "#dddddd"} onChange={(c) => set({ nanColor: c })} />
                </label>
              )}
              {/* A width with no colour draws in the page colour (heatBorderStroke), so the colour box
                  shows the page colour until one is chosen, rather than a white that nothing draws. */}
              {isPoint ? (<>
                <label className="frow">
                  <span>Mark border</span>
                  <ColorInput className="colorin" aria-label="Mark border colour" value={h.cellBorderColor ?? themeBgHex()} onChange={(c) => set({ cellBorderColor: c, cellBorderWidth: h.cellBorderWidth || 1 })} />
                </label>
                <label className="frow">
                  <span>Border width</span>
                  <input type="range" min={0} max={4} step={0.5} value={h.cellBorderWidth ?? 0} onChange={(e) => set({ cellBorderWidth: Number(e.target.value) })} />
                </label>
              </>) : (<>
                <label className="frow" title="A thin line of page colour between the cells. It helps colours be read accurately: without it, each cell is judged against its neighbours, so the same colour looks darker among light cells and lighter among dark ones.">
                  <span>Gap between cells</span>
                  <input type="range" min={0} max={4} step={0.5} value={h.cellBorderWidth ?? 0} onChange={(e) => set({ cellBorderWidth: Number(e.target.value) })} />
                </label>
                <label className="frow" title="The colour of the gap (or border) between cells. The page colour until you choose one.">
                  <span>Gap colour</span>
                  <ColorInput className="colorin" aria-label="Gap colour" value={h.cellBorderColor ?? themeBgHex()} onChange={(c) => set({ cellBorderColor: c, cellBorderWidth: h.cellBorderWidth || 1 })} />
                </label>
              </>)}
              {!isPoint && (
                <label className="frow">
                  <span>Row labels</span>
                  <input type="checkbox" checked={h.showRowLabels ?? true} onChange={(e) => set({ showRowLabels: e.target.checked })} />
                </label>
              )}
              {!isPoint && (
                <label className="frow">
                  <span>Column labels</span>
                  <input type="checkbox" checked={h.showColLabels ?? true} onChange={(e) => set({ showColLabels: e.target.checked })} />
                </label>
              )}
              {!isPoint && (
                /* Auto = flat, turned 45° only when the names do not fit side by side. A chosen angle -
                    0° included - is kept. A select rather than a slider, because unset means "tilt if needed",
                    so 0° must be stored as a real value for flat to be chosen. */
                <label className="frow" title="Rotate the column labels (0° = horizontal, 90° = vertical). Auto keeps them flat and turns them 45° only when they do not fit side by side.">
                  <span>Column label angle</span>
                  <select
                    className="selin"
                    aria-label="Column label angle"
                    value={h.labelRotation == null ? "auto" : String(h.labelRotation)}
                    onChange={(e) => set({ labelRotation: e.target.value === "auto" ? undefined : Number(e.target.value) })}
                  >
                    <option value="auto">Auto</option>
                    {[0, 15, 30, 45, 60, 75, 90].map((d) => <option key={d} value={String(d)}>{d}°</option>)}
                    {h.labelRotation != null && ![0, 15, 30, 45, 60, 75, 90].includes(h.labelRotation) && <option value={String(h.labelRotation)}>{h.labelRotation}°</option>}
                  </select>
                </label>
              )}
              {!isPoint && (
                <FontControls
                  label="Row/column label font"
                  element="tick"
                  spec={h.labelFont}
                  defaultSize={12}
                  onSetPlotFont={onSetPlotFont}
                  onSet={(patch) => set({ labelFont: { ...(h.labelFont ?? {}), ...patch } })}
                />
              )}
              {!isPoint && (
                <label className="frow" title="Title for the columns axis (drawn under the grid; draggable + double-click editable on the graph).">
                  <span>Column axis title</span>
                  <input type="text" className="numin" style={{ width: 120 }} value={plot.xAxis?.title ?? ""} placeholder="(none)" onChange={(e) => onSetAxis("x", { title: e.target.value || undefined })} />
                </label>
              )}
              {/* The two titles are styled here as well as typed: a matrix heatmap has no Axis
                  tab, where every other chart offers the per-axis title font. The same FontControls
                  and the same per-axis handler as the Axis tab — shown once there is a title to letter. */}
              {!isPoint && plot.xAxis?.title && (
                <FontControls
                  label="Column title font"
                  element="axisTitle"
                  spec={axisTitleFontSpec(plot, "x")}
                  defaultSize={15}
                  onSetPlotFont={onSetPlotFont}
                  onSet={(patch) => onSetAxisTitleFont("x", patch)}
                />
              )}
              {!isPoint && (
                <label className="frow" title="Title for the rows axis (drawn rotated on the left; draggable + double-click editable on the graph).">
                  <span>Row axis title</span>
                  <input type="text" className="numin" style={{ width: 120 }} value={plot.yAxis?.title ?? ""} placeholder="(none)" onChange={(e) => onSetAxis("y", { title: e.target.value || undefined })} />
                </label>
              )}
              {!isPoint && plot.yAxis?.title && (
                <>
                  <FontControls
                    label="Row title font"
                    element="axisTitle"
                    spec={axisTitleFontSpec(plot, "y")}
                    defaultSize={15}
                    onSetPlotFont={onSetPlotFont}
                    onSet={(patch) => onSetAxisTitleFont("y", patch)}
                  />
                  {/* The Axis tab's "Title ↔ labels" row. Only the row title: the column title sits
                      at the foot of the figure, so its gap moves nothing that is drawn. */}
                  <label className="frow" title="Gap between the row title and the row labels — the same 'Title ↔ labels' control the Axis tab offers on other charts.">
                    <span>Row title ↔ labels</span>
                    <input type="number" className="numin" min={0} max={60} value={plot.yAxis?.titleGap ?? ""} placeholder="6" onChange={(e) => { const v = e.target.value === "" ? undefined : Number(e.target.value); onSetAxis("y", { titleGap: v !== undefined && Number.isFinite(v) ? v : undefined }); }} />
                  </label>
                </>
              )}
            </Section>
          );
        })()}

        {kind === "heatmap" && (() => {
          // The colour bar is the heatmap's legend — its own clearly-labelled section
          // (clicking the bar on the graph jumps straight here).
          const h = plot.heatmap ?? {};
          const set = (patch: Partial<NonNullable<Plot["heatmap"]>>) => onSetPlotOptions({ heatmap: { ...h, ...patch } });
          return (
            <Section title="Colour bar (legend)" open>
              <label className="frow">
                <span>Show colour bar</span>
                <input type="checkbox" checked={h.showColorbar ?? true} onChange={(e) => set({ showColorbar: e.target.checked })} />
              </label>
              {(h.showColorbar ?? true) && (
                <>
                  <label className="frow" title="Heading beside the colour bar.">
                    <span>Title</span>
                    <input
                      type="text"
                      className="numin"
                      value={h.colorbarTitle ?? ""}
                      placeholder="(none)"
                      onChange={(e) => set({ colorbarTitle: e.target.value || undefined })}
                    />
                  </label>
                  <label className="frow" title="Values labelled on the colour bar (comma-separated) — each gets its own tick. Entering values replaces the auto min/max. Blank = auto.">
                    <span>Values</span>
                    <NumberListInput values={h.colorbarTickValues} onCommit={(nums) => set({ colorbarTickValues: nums })} />
                  </label>
                  <label className="frow" title="When no explicit values are set, also label the quartiles (¼ · ½ · ¾) between min and max.">
                    <span>Quartile ticks (auto)</span>
                    <input type="checkbox" checked={h.colorbarTicks ?? false} disabled={!!(h.colorbarTickValues && h.colorbarTickValues.length)} onChange={(e) => set({ colorbarTicks: e.target.checked || undefined })} />
                  </label>
                  <FontControls
                    label="Font"
                    element="legend"
                    spec={h.colorbarFont}
                    defaultSize={13}
                    onSetPlotFont={onSetPlotFont}
                    onSet={(patch) => set({ colorbarFont: { ...(h.colorbarFont ?? {}), ...patch } })}
                  />
                  <p className="note" style={{ fontSize: 11, marginTop: 4 }}>
                    Drag the colour bar on the graph to reposition it.
                  </p>
                </>
              )}
            </Section>
          );
        })()}

        {/* A matrix heatmap and a network scene both hardcode grid:none + frame:none —
            these controls would be silent no-ops there, so they are not offered. */}
        {/* Kinds with no frame / gridlines to move are listed in FRAME_DEAD_KINDS (its test
            compares the scene per kind); the section is replaced by the sentence that says where the
            equivalent lives. */}
        {/* Network is exempt by design: its Frame section stays absent with no replacement
            note, and `Inspector.network.test.tsx` holds it. Every other kind in the registry
            gets its sentence. */}
        {!heatmapMatrix && kind !== "network" && FRAME_DEAD_KINDS[kind] && (
          <Section title="Grid, frame &amp; axes">
            <p className="hint" style={{ margin: "2px 0" }} data-refusal="Grid, frame &amp; axes">{FRAME_DEAD_KINDS[kind]}</p>
          </Section>
        )}
        {!heatmapMatrix && !FRAME_DEAD_KINDS[kind] && (
        <Section title="Grid, frame &amp; axes">
          <div className="inspsub">Gridlines</div>
          <label className="frow">
            <span>Gridlines</span>
            <input type="checkbox" checked={g.show ?? true} onChange={(e) => onSetGrid({ show: e.target.checked })} />
          </label>
          <label className="frow">
            <span>Density</span>
            <select className="selin" value={String(g.density ?? 6)} onChange={(e) => onSetGrid({ density: Number(e.target.value) })}>
              <option value="4">Few</option>
              <option value="6">Normal</option>
              <option value="10">Many</option>
            </select>
          </label>
          <label className="frow">
            <span>Thickness</span>
            <select className="selin" value={String(g.width ?? 1)} onChange={(e) => onSetGrid({ width: Number(e.target.value) })}>
              <option value="0.5">0.5</option>
              <option value="1">1</option>
              <option value="1.5">1.5</option>
              <option value="2">2</option>
            </select>
          </label>
          <label className="frow">
            <span>Line style</span>
            <select className="selin" value={g.dash ?? "solid"} onChange={(e) => onSetGrid({ dash: e.target.value as GridStyle["dash"] })}>
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="longdash">Long dash</option>
              <option value="dashdot">Dash-dot</option>
            </select>
          </label>
          <label className="frow">
            <span>Minor lines</span>
            <input type="checkbox" checked={g.minor ?? false} onChange={(e) => onSetGrid({ minor: e.target.checked })} />
          </label>
          <div className="frow">
            <span>Colour</span>
            <span />
          </div>
          <div className="swatches">
            <button
              className={"swbtn" + (g.color == null ? " on" : "")}
              style={{ background: "var(--line)" }}
              title="Default (theme)"
              aria-label="Default gridline colour"
              onClick={() => onSetGrid({ color: undefined })}
            />
            {["#cdd2d8", "#9aa0a8", "#555b62"].map((c) => (
              <button
                key={c}
                className={"swbtn" + (g.color?.toLowerCase() === c ? " on" : "")}
                style={{ background: c }}
                title={c}
                aria-label={`Gridline colour ${c}`}
                onClick={() => onSetGrid({ color: c })}
              />
            ))}
          </div>

          <div className="inspsub" style={{ marginTop: 10 }}>Frame &amp; ticks</div>
          <label className="frow">
            <span>Frame</span>
            <select className="selin" value={plot.frame ?? "lshape"} onChange={(e) => onSetFrame({ frame: e.target.value as FrameStyle })}>
              <option value="lshape">L-shape</option>
              <option value="box">Full box</option>
              <option value="offset">Offset</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="frow">
            <span>Tick direction</span>
            <select className="selin" value={plot.tickDir ?? "out"} onChange={(e) => onSetFrame({ tickDir: e.target.value as TickDir })}>
              <option value="out">Outward</option>
              <option value="in">Inward</option>
              <option value="both">Both</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="frow">
            <span>Tick length</span>
            <input type="number" className="numin" min={0} max={20} step={0.5} value={plot.tickLen ?? 5} onChange={(e) => onSetFrame({ tickLen: Number(e.target.value) })} />
          </label>
          <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
            Density applies to linear axes (log axes use decades). Click an axis to format its scale/range/numbering.
          </p>
        </Section>
        )}

        <Section title="Background">
          <BackgroundPanel plot={plot} onSet={onSetPlotOptions} />
        </Section>

        <Section title="Title &amp; legend">
          <div className="inspsub">Title</div>
          <label className="frow">
            <span>Show title</span>
            <input type="checkbox" checked={plot.showTitle ?? true} onChange={(e) => onSetGraphTitle({ showTitle: e.target.checked })} />
          </label>
          <label className="frow">
            <span>Title</span>
            <input
              type="text"
              className="numin textin-wide"
              value={plot.title ?? ""}
              placeholder={plot.name}
              onChange={(e) => onSetGraphTitle({ title: e.target.value === "" ? undefined : e.target.value })}
            />
          </label>
          <label className="frow">
            <span>Subtitle</span>
            <input
              type="text"
              className="numin textin-wide"
              value={plot.subtitle ?? ""}
              placeholder="none"
              onChange={(e) => onSetGraphTitle({ subtitle: e.target.value === "" ? undefined : e.target.value })}
            />
          </label>
          <label className="frow">
            <span>Alignment</span>
            <select
              className="selin"
              value={plot.titleAlign ?? "center"}
              onChange={(e) => onSetGraphTitle({ titleAlign: e.target.value as Plot["titleAlign"] })}
            >
              <option value="left">Left (editorial)</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <FontControls label="Title font" element="title" spec={plot.fonts?.title} defaultSize={18} onSetPlotFont={onSetPlotFont} />
          <FontControls label="Subtitle font" element="subtitle" spec={plot.fonts?.subtitle} defaultSize={13} onSetPlotFont={onSetPlotFont} />
          {/* The chart-wide tick font is otherwise set in the Axis panel, and six kinds
              have no Axis tab to open — yet their drawing is lettered with `fonts.tick`: the chord's
              node names, the oncoprint's gene rows, the rose's compass and count rings, the
              sunburst's segments, the ternary's axis numbers, the 3-D scatter's axis numbers.
              The font moves every one of those drawings, so it goes here, beside the other
              chart-wide fonts, where every font that is not an axis's own already lives.
              Note: only kinds with no existing route. Network, heatmap and the correlation matrix
              already carry their own named block writing `fonts.tick`, and radar has two — adding
              a second control for the same text is the confusion this is meant to remove. */}
          {TICK_FONT_LABEL[kind] && (
            <FontControls
              label={TICK_FONT_LABEL[kind]!.label}
              element="tick"
              spec={plot.fonts?.tick}
              defaultSize={13}
              onSetPlotFont={onSetPlotFont}
              {...(TICK_FONT_LABEL[kind]!.hideSize ? { hideSize: true } : {})}
            />
          )}

          <div className="inspsub" style={{ marginTop: 10 }}>Footer / source mark</div>
          <label className="frow">
            <span>Left</span>
            <input
              type="text"
              className="numin textin-wide"
              value={plot.footer?.left ?? ""}
              placeholder="e.g. Source: …"
              onChange={(e) => onSetGraphTitle({ footer: cleanFooter({ ...(plot.footer ?? {}), left: e.target.value }) })}
            />
          </label>
          <label className="frow">
            <span>Right</span>
            <input
              type="text"
              className="numin textin-wide"
              value={plot.footer?.right ?? ""}
              placeholder="e.g. Fig. 1"
              onChange={(e) => onSetGraphTitle({ footer: cleanFooter({ ...(plot.footer ?? {}), right: e.target.value }) })}
            />
          </label>

          {/* Nine kinds cannot produce a correct per-series legend, because their
              datasets are not what the drawing distinguishes: a forest's three columns are one
              forest (the studies are the y ticks); a dendrogram's five samples are one tree over
              six genes; alluvial's two columns are the ends of the flows; a network's are edge
              attributes; 3-D scatter's are the Y and Z channels of one cloud; estimation's third
              band is a computed Difference; PCA loadings are per-variable; heatmap and
              correlation matrix have their own colour key. Their builders emit no legend at all,
              so offering this block there would make "Show → Always" do nothing.
              `legend-offered.test.tsx` derives this list from the builder, so it cannot drift.
              The heading stays on every kind and says why instead — a section that silently
              disappears between chart types reads as a bug in the program. */}
          <div className="inspsub" style={{ marginTop: 10 }}>Legend</div>
          {!legends && (
            <p className="hint" style={{ margin: "2px 0" }}>{NO_LEGEND_WHY[kind] ?? "This chart draws no legend."}</p>
          )}
          {legends && <>
          {/* `legend-show-row`: three controls are labelled "Show"; this is the only tri-state
              one, and `function-matrix.test.tsx` must tell it from the other two (which it checks). */}
          <label className="frow legend-show-row">
            <span>Show</span>
            <select
              className="selin"
              value={plot.legend?.show === undefined ? "auto" : plot.legend.show ? "on" : "off"}
              onChange={(e) => onSetLegend({ show: e.target.value === "auto" ? undefined : e.target.value === "on" })}
            >
              <option value="auto">Auto (≥2 series)</option>
              <option value="on">Always</option>
              <option value="off">Hidden</option>
            </select>
          </label>
          {/* "Direct labels" belongs here, in the control that already answers "where does the
              key go?", because it is the other answer to that question and not a second feature:
              choosing it means there is no legend block at all, each series is named beside its
              own data instead. Offered only where a row has geometry to sit beside — see
              `DIRECT_LABEL_KINDS`, which is derived from the builder. */}
          <label className="frow">
            <span>Position</span>
            <select className="selin" value={plot.legend?.position ?? "right"} onChange={(e) => onSetLegend({ position: e.target.value as LegendPosition })}>
              <option value="right">Outside right</option>
              <option value="top">Outside top (a row above the plot)</option>
              <option value="topright">Inside top-right</option>
              <option value="topleft">Inside top-left</option>
              <option value="bottomright">Inside bottom-right</option>
              <option value="bottomleft">Inside bottom-left</option>
              {DIRECT_LABEL_KINDS.has(kind) && <option value="direct">Direct labels (no legend)</option>}
              <option value="none">Hidden</option>
            </select>
          </label>
          {DIRECT_LABEL_KINDS.has(kind) ? (
            (plot.legend?.position ?? "right") === "direct" && (
              <p className="hint" style={{ margin: "2px 0" }}>
                Each series is named on the chart beside its own data, in its own colour, and no legend box is drawn. The names use the legend font below, and any of them can be dragged or renamed on the chart.
              </p>
            )
          ) : (
            <p className="hint" style={{ margin: "2px 0" }}>
              Direct labels are not offered on this chart: its groups are already named on the category axis, or its legend keys slices, zones and nodes drawn outside the series layer — either way a name on the chart would repeat what is already there.
            </p>
          )}
          <label className="frow">
            <span>Layout</span>
            <select className="selin" value={plot.legend?.orientation ?? "vertical"} onChange={(e) => onSetLegend({ orientation: e.target.value as "vertical" | "horizontal" })}>
              <option value="vertical">Vertical (column)</option>
              <option value="horizontal">Horizontal (row)</option>
            </select>
          </label>
          <label className="frow">
            <span>Border</span>
            <input type="checkbox" checked={plot.legend?.border ?? false} onChange={(e) => onSetLegend({ border: e.target.checked || undefined })} />
          </label>
          <label className="frow">
            <span>Background</span>
            <input type="checkbox" checked={plot.legend?.background ?? false} onChange={(e) => onSetLegend({ background: e.target.checked || undefined })} />
          </label>
          {/* The frame's look. Border and Background above are on/off; how the box looks
              defaults to a 1px line, paper fill, radius 4 and 6px pad. Each control below writes
              only when moved off that default, so an untouched legend draws with the default. The
              colour and thickness rows appear with the frame that uses them. */}
          {plot.legend?.border && (
            <>
              <label className="frow" title="Colour of the legend's frame. Blank = the theme's line colour.">
                <span>Frame colour</span>
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <ColorInput value={plot.legend?.borderColor ?? "#c8c8c8"} aria-label="Legend frame colour" onChange={(c) => onSetLegend({ borderColor: c })} />
                  {plot.legend?.borderColor != null && (
                    <button type="button" className="linkbtn" onClick={() => onSetLegend({ borderColor: undefined })}>⨯</button>
                  )}
                </span>
              </label>
              <label className="frow" title="Thickness of the legend's frame in px. Blank = 1.">
                <span>Frame thickness</span>
                <input
                  type="number" className="numin" min={0} max={8} step={0.25}
                  value={plot.legend?.borderWidth ?? ""} placeholder="1"
                  onChange={(e) => onSetLegend({ borderWidth: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
                />
              </label>
            </>
          )}
          {plot.legend?.background && (
            <label className="frow" title="Fill behind the legend's rows. Blank = the paper colour.">
              <span>Box fill</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <ColorInput value={plot.legend?.backgroundColor ?? "#ffffff"} aria-label="Legend box fill" onChange={(c) => onSetLegend({ backgroundColor: c })} />
                {plot.legend?.backgroundColor != null && (
                  <button type="button" className="linkbtn" onClick={() => onSetLegend({ backgroundColor: undefined })}>⨯</button>
                )}
              </span>
            </label>
          )}
          {(plot.legend?.border || plot.legend?.background) && (
            <label className="frow" title="Corner rounding of the legend box in px. 0 = square corners. Blank = 4.">
              <span>Corner radius</span>
              <input
                type="number" className="numin" min={0} max={24} step={1}
                value={plot.legend?.borderRadius ?? ""} placeholder="4"
                onChange={(e) => onSetLegend({ borderRadius: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          )}
          <label className="frow" title="Space between the legend's frame and its rows, in px. Blank = 6. The outside-right margin grows with it, so the rows never run off the figure.">
            <span>Box padding</span>
            <input
              type="number" className="numin" min={0} max={40} step={1}
              value={plot.legend?.padding ?? ""} placeholder="6"
              onChange={(e) => onSetLegend({ padding: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
            />
          </label>
          {(plot.legend?.position ?? "right") === "right" ? (
            <label className="frow" title="Distance between the plot and the outside legend column">
              <span>Gap from plot</span>
              <input
                type="number"
                className="numin"
                min={0}
                max={120}
                step={1}
                value={plot.legend?.gap ?? ""}
                placeholder="12"
                onChange={(e) => onSetLegend({ gap: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          ) : (plot.legend?.position ?? "right") !== "none" ? (
            <label className="frow" title="Padding between the plot corner and an inside legend">
              <span>Inset padding</span>
              <input
                type="number"
                className="numin"
                min={0}
                max={120}
                step={1}
                value={plot.legend?.inset ?? ""}
                placeholder="8"
                onChange={(e) => onSetLegend({ inset: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
              />
            </label>
          ) : null}
          {/* The symbol size. It follows the legend font on its own (1× = the default look at
              a 13px font); this multiplies it, for a key that needs to read at a distance or
              to get out of the way. Mirrors the bubble size legend's slider. */}
          <label className="frow" title="Size of the legend's symbols (marker, line stub, dot) as a multiple of the size they take from the legend font. 1 = matched to the text.">
            <span>Symbol size</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="range" min={0.4} max={3} step={0.1}
                aria-label="Legend symbol size"
                value={plot.legend?.symbolScale ?? 1}
                onChange={(e) => onSetLegend({ symbolScale: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
              />
              <span style={{ width: 30, textAlign: "right" }}>{(plot.legend?.symbolScale ?? 1).toFixed(1)}×</span>
            </span>
          </label>
          {/* What a bar's key shows — the bar or its data point (the choice is offered whenever both are
              drawn). Offered only where the chart draws both:
              a bar chart whose bars carry their points. */}
          {kind === "bar" && (() => {
            const sc = buildPlotScene(table, plot, { width: 400, height: 300 });
            return sc.legend.length > 0 && sc.series.some((sr) => sr.marks.some((m) => m.bar && m.points && m.points.length > 0));
          })() && (
            <label className="frow" title="When the bars carry their data points: key each series by its bar, or by its data point drawn as it is on the chart.">
              <span>Key shows</span>
              <select
                aria-label="Legend key for bars with points"
                value={plot.legend?.barKey ?? "bar"}
                onChange={(e) => onSetLegend({ barKey: e.target.value === "point" ? "point" : undefined })}
              >
                <option value="bar">Bar</option>
                <option value="point">Data point</option>
              </select>
            </label>
          )}
          </>}
          {/* Note: the legend font outlives the legend on three of those kinds: it is the fallback
              for the heatmap colour bar, the correlation-matrix ramp and the alluvial labels
              (checked by rendering), and for the PCA loadings' arrow labels. So it
              is gated on its own effect, not on the legend. */}
          {(legends || LEGEND_FONT_ONLY.has(kind)) && (
            <FontControls label="Legend font" element="legend" spec={plot.fonts?.legend} defaultSize={13} onSetPlotFont={onSetPlotFont} />
          )}
          {/*
            Value-label font (`fonts.valueLabel`), offered on every kind that draws value labels:
            bar, histogram, lollipop, xy, area, bubble, volcano and paired dot, as well as the
            pyramid, which has its own copy inside its block.

            Value labels arrive by several routes and the font is one shared setting, so one
            control serves all of them rather than per-kind copies: the plot-wide `showValues`
            (bar / histogram / lollipop / pyramid) and the per-series `pointLabels`
            (xy / area / bubble / volcano). Shown only when labels are actually on the page —
            the same rule the "Value decimals" field already follows. A font for text that is
            not drawn would be a dead control.
          */}
          {/* The lollipop draws its value labels from its own `lollipop.showValues`, which
              defaults to on, so it needs its own clause. (Pyramid is deliberately absent: it has
              the same control inside its own block, next to its own switch, and listing it here
              would show two.) `value-label-font.test.tsx` checks the drawing, not these flags. */}
          {/* The paired dot has its own "Value labels" checkbox too (`paireddot.showValues`,
              in its Chart section). The guard drives each kind's own switch alone: setting every
              route at once would let the `pointLabels` route reveal the block and hide a gap. */}
          {/* The lollipop's green Δ% uses the value-label font too, and it is on by default while
              the value labels are not, so without this clause a lollipop with labels off would
              draw Δ text in a font with no control. Note: the gallery-wide tests do not cover it —
              the lollipop card sets `showDelta: false`. */}
          {((plot.showValues ?? false) ||
            (kind === "lollipop" && (plot.lollipop?.showValues ?? true)) ||
            (kind === "lollipop" && (plot.lollipop?.showDelta ?? true)) ||
            (kind === "paireddot" && (plot.paireddot?.showValues ?? false)) ||
            Object.values(plot.seriesStyles ?? {}).some((s) => s?.pointLabels && s.pointLabels !== "none")) && (
            <FontControls label="Value label font" element="valueLabel" spec={plot.fonts?.valueLabel} defaultSize={11} onSetPlotFont={onSetPlotFont} />
          )}
        </Section>

        {/* The network scene draws no annotation layer, so offering the adders there
            would create objects that never render. */}
        {kind !== "network" && (
          <Section title="Annotations">
            <AnnotationsPanel plot={plot} table={table} ops={annotationOps} seriesNames={table ? tableDatasets(table).map((d) => d.name) : undefined} onSetPlotOptions={onSetPlotOptions} />
          </Section>
        )}
        {/* Significance brackets need a category axis to span and a value axis to sit at, so the
            axis-less kinds cannot draw one: `fractionalAnnotations` drops every bracket with
            "a bracket endpoint is not a category on this chart". Annotations proper are drawn on
            all of these (they position fractionally) — brackets are the one kind that still
            cannot be placed, so this list is longer than the annotations gate above rather than
            equal to it. `annotations-drawn.test.tsx` derives the same list from the builder and
            fails if the two drift apart.
            The ridgeline is excluded although it does draw *a* bracket — but not one that
            compares two groups. A ridgeline's groups are its Y ticks and X is the measurement
            axis, and the scene does not declare `valueAxis: "x"`, so a bracket's from/to resolve
            against the wrong axis: spanning the first two ridges lands at x = −65 → −43, off the
            canvas. The only bracket that appears joins two points on the measurement axis, which
            is not a comparison of anything. Scientifically it does not fit either: the convention
            belongs to bar/box/violin, and a ridgeline is normally many ordered groups where the
            claim worth making is a trend, not a stack of pairwise tests. */}
        {BRACKET_KINDS.has(kind) && (
          <Section title="Significance brackets">
            <SignificancePanel
              plot={plot}
              onSet={onSetSignificance}
              // The same blank-bracket shape the Design menu adds; the user then picks
              // its two groups (and p) on the bracket itself or in its panel.
              onAddBracket={() => annotationOps.add({ kind: "bracket", from: 1, to: 2, label: "*" })}
            />
          </Section>
        )}
        {/* `bubble` and `volcano` are in this list because the builder draws the ellipse on
            both when `ellipse.show` is on. They are XY-family
            scatters (`ellipse.show` / `level` / `fillOpacity` / `borderWidth` all apply). */}
        {(kind === "xy" || kind === "area" || kind === "bubble" || kind === "volcano" || kind === "pcascore" || kind === "pcabiplot" || kind === "triplot") && (
          <Section title="Confidence ellipse">
            <EllipsePanel plot={plot} onSet={onSetPlotOptions} />
          </Section>
        )}
        {/* The fitted curve + its bands — only once an analysis has put one on the graph, and
            only on the kinds whose builder draws `plot.fit` (gated on the fit alone, the section
            would do nothing on 30 kinds: an analysis attaches its fit to
            the first graph of the table whatever its kind, and a bar chart draws no curve). So
            the section is never a control over nothing. Clicking the curve or a band pins it.
            `fit-style.test.tsx` derives this list from the builder and fails if it drifts. */}
        {FIT_KINDS.has(kind) && ((plot.fit?.points?.length ?? 0) >= 2 || (plot.fits ?? []).some((f) => (f.points?.length ?? 0) >= 2)) && (
          <Section title="Fitted curve" open>
            <FitPanel plot={plot} onSet={onSetPlotOptions} onSelect={onSelect} />
          </Section>
        )}
        {kind === "bubble" && (
          <Section title="Bubble size legend" open>
            <BubbleLegendPanel plot={plot} onSet={onSetPlotOptions} />
          </Section>
        )}
        {/* A PCA score/biplot sizing its dots by a third component reuses the same size
            legend — same `plot.bubble` fields, same scene block, same renderer. It only
            appears once "Dot size (depth)" is on; with uniform dots there is nothing to
            explain, and the section would be a control over nothing. */}
        {(kind === "pcascore" || kind === "pcabiplot") && pcaSizeComponent(plot, kind, plot.pca?.pcLabels?.length ?? 0) >= 0 && (
          <Section title="Bubble size legend" open>
            <BubbleLegendPanel
              plot={plot}
              onSet={onSetPlotOptions}
              defaults={{ minRadius: 2, maxRadius: 9 }}
              note="The dot radius encodes the depth component chosen under Chart → Dot size — the most negative score is the smallest dot, the most positive the largest. Drag the legend on the graph to reposition it."
            />
          </Section>
        )}
        <Section title="Homogenise type across graphs">
          <HomogenizePanel plot={plot} onHomogenize={onHomogenizeFont} />
        </Section>
      </>
    );
  }

  // A builder-made reference line — its own panel, because it is its own kind of object.
  if (selection.kind === "refline") {
    return (
      <RefLinePanel id={selection.id} plot={plot} onSet={onSetPlotOptions} onSelect={onSelect} onSetPlotFont={onSetPlotFont} />
    );
  }

  if (selection.kind === "annotation") {
    const ann = (plot.annotations ?? []).find((a) => a.id === selection.id);
    // A PCA loading vector (arrow + its variable label) is builder-owned, so it has no entry
    // in plot.annotations — without this branch it would fall through to "this annotation was
    // removed", which is both false and a dead end. Its position is the loading itself, so
    // only the colour is editable here.
    // `e` / `s` keys too: a triplot's explanatory arrows (`pca-arrow-e0`) and an ordination's
    // species arrows (`pca-arrow-s0`) are the same builder-owned drawable under prefixed keys, and
    // the pattern accepts them so the arrows' thickness / dashes / head (honoured by the builder)
    // can be edited.
    const vec = /^pca-(arrow|vlabel)-([se]?\d+)$/.exec(selection.id);
    if (!ann && vec) {
      const isLabel = vec[1] === "vlabel";
      const key = vec[2]!;
      const ps = plot.pcaStyle;
      const setPca = (patch: Partial<NonNullable<Plot["pcaStyle"]>>): void => onSetPlotOptions({ pcaStyle: { ...(ps ?? {}), ...patch } });
      // The builder's own defaults per key family: explanatory green, species red, loadings shared.
      const shared = key.startsWith("e")
        ? "#2f6f4f"
        : key.startsWith("s")
          ? plot.seriesStyles?.["pca-species"]?.color ?? "#b5342f"
          : plot.seriesStyles?.["pca-loadings"]?.color ?? (plot.kind === "pcabiplot" ? "#b5342f" : seriesColor(1));
      const arrowC = ps?.arrowColors?.[key];
      /** The label's own colour, falling back to its arrow's — the builder's rule, mirrored. */
      const current = isLabel ? ps?.varLabelColors?.[key] : arrowC;
      const effective = current ?? arrowC ?? shared;
      const drawnName = (): string | undefined => {
        try {
          const lab = buildPlotScene(table, plot, {}).annotations.find((a) => a.id === `pca-vlabel-${key}`);
          return lab?.label || undefined;
        } catch {
          return undefined;
        }
      };
      const name = ps?.varLabelText?.[key] ?? (/^\d+$/.test(key) ? plot.pca?.varLabels?.[Number(key)] : drawnName()) ?? (/^\d+$/.test(key) ? `Loading ${Number(key) + 1}` : key);
      return (
        <>
          {/* Say which of the two is selected. The arrow and its label have separate colours,
              so the heading names the vector or the label, not only the variable. */}
          <div className="insphd">{name}{isLabel ? " — label" : " — vector"}</div>
          <label className="frow">
            <span>{isLabel ? "Label colour" : "Vector colour"}</span>
            <ColorInput className="colorin" value={effective} aria-label={isLabel ? "Label colour" : "Vector colour"} onChange={(c) => annotationOps.update(selection.id, { color: c })} />
          </label>
          <ColourSwatches value={current} onPick={(c) => annotationOps.update(selection.id, { color: c })} />
          <label className="frow" style={{ marginTop: 6 }}>
            <span>Auto colour</span>
            <button
              type="button"
              className="swbtn"
              title={isLabel ? "Clear this label's own colour (back to its arrow's colour)" : "Clear this vector's colour override (back to the shared loadings colour)"}
              onClick={() => annotationOps.update(selection.id, { color: undefined })}
            >
              Reset
            </button>
          </label>
          {/* The vectors' line styling — shared by all of them, like a chart's gridlines.
              A vector needs the same edits as an axis, not only its colour. */}
          {!isLabel && (
            <>
              <div className="inspsub" style={{ marginTop: 10 }}>All vectors</div>
              <label className="frow" title="Thickness of every loading arrow. The arrowhead scales with it.">
                <span>Thickness</span>
                <input
                  type="number" className="numin" min={0.25} max={8} step={0.25} value={ps?.arrowWidth ?? 1.4}
                  aria-label="Loading arrow thickness"
                  onChange={(e) => { const v = Number(e.target.value); setPca({ arrowWidth: Number.isFinite(v) ? v : undefined }); }}
                />
              </label>
              <label className="frow">
                <span>Dashes</span>
                <select className="selin" value={ps?.arrowDash ?? "solid"} aria-label="Loading arrow dashes" onChange={(e) => setPca({ arrowDash: e.target.value as LineDash })}>
                  {DASHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="frow" title="A vector without a head reads as a line rather than a direction.">
                <span>Arrowhead</span>
                <input type="checkbox" checked={ps?.arrowHead !== false} aria-label="Loading arrowhead" onChange={(e) => setPca({ arrowHead: e.target.checked ? undefined : false })} />
              </label>
            </>
          )}
          {/* A label is text, so its font belongs here beside its colour: clicking a loading name
              must reach size and font too. These names are drawn with the legend font (the same
              one the chart panel calls "Loading labels"), so this is that control, next to what it edits. */}
          {isLabel && (
            <FontControls label="Label type" element="legend" spec={plot.fonts?.legend} defaultSize={12} onSetPlotFont={onSetPlotFont} />
          )}
          <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
            {isLabel
              ? <>This label’s own colour, and the type all the loading names share. Blank the colour with <strong>Reset</strong> and it follows its arrow again. Drag it to reposition, or double-click to rename.</>
              : <>The arrow’s length and direction are the loading itself, so it can’t be moved. Click its <strong>label</strong> to colour the name separately. <strong>Loadings colour</strong> (all vectors at once) is in the chart panel.</>}
          </p>
          <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
            ← Back to graph
          </button>
        </>
      );
    }
    /**
     * A value label on a population pyramid (`pyr-val-<row>:<col>`). Like the PCA loading names
     * it is drawn by the builder from the data, so it has no entry in `plot.annotations`; without
     * this branch it would fall through to "This annotation was removed" — false, and a dead end
     * for the one thing a label needs: its font. Its text and position are editable (double-click
     * to rename, drag to move); its existence comes from the data.
     */
    if (!ann && /^pyr-val-/.test(selection.id)) {
      return (
        <>
          <div className="insphd">Value label</div>
          <FontControls label="Value label type" element="valueLabel" spec={plot.fonts?.valueLabel} defaultSize={11} onSetPlotFont={onSetPlotFont} />
          <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
            Every value label on this chart shares this type. Double-click one to rewrite it, or drag it to
            move that one alone. Turn them all off with <strong>Show values</strong> in the chart panel.
          </p>
          <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
            ← Back to graph
          </button>
        </>
      );
    }
    if (!ann) {
      return <p className="note">This annotation was removed. Click the graph background to add another.</p>;
    }
    return (
      <>
        <div className="insphd">Annotation</div>
        <AnnotationEditor a={ann} ops={annotationOps} plot={plot} table={table} seriesNames={table ? tableDatasets(table).map((d) => d.name) : undefined} onSetSignificance={onSetSignificance} />
        <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
          ← Back to graph
        </button>
      </>
    );
  }

  // Multi-object selection → the Arrange (align / distribute / equalise) toolbar.
  if (selection.kind === "annotations") {
    return (
      <>
        <div className="insphd">Arrange objects</div>
        <ArrangePanel plot={plot} ids={selection.ids} ops={annotationOps} onSelect={onSelect} />
      </>
    );
  }

  if (selection.kind === "axis") {
    // The 3-D scatter's axes are projected cube edges — a smaller panel serves them: range,
    // scale, ticks, fonts and line styling apply; length/breaks/bands/rotation do not exist
    // on a slanted edge and are refused with a note there rather than shown dead.
    if (plot.kind === "scatter3d") {
      return <Scatter3DAxisPanel axis={selection.axis === "y" || selection.axis === "z" ? selection.axis : "x"} plot={plot} table={table} onSelect={onSelect} onSetAxis={onSetAxis} onSetPlotFont={onSetPlotFont} />;
    }
    // "z" exists only on the 3-D scatter; a stale selection (kind switched under it) falls to X.
    const ax2d = selection.axis === "z" ? "x" : selection.axis;
    return <AxisPanel docVersion={docVersion} selection={{ axis: ax2d, ...(selection.focus ? { focus: selection.focus } : {}) }} plot={plot} table={table} onSelect={onSelect} onSetAxis={onSetAxis} onSetAxisLength={onSetAxisLength} onSetSeriesStyle={onSetSeriesStyle} onSetPlotFont={onSetPlotFont} onSetAxisTitleFont={onSetAxisTitleFont} onSetPlotOptions={onSetPlotOptions} />;
  }

  // pie slice — colour, explode, border, and per-slice label override.
  if (selection.kind === "venn-set" || selection.kind === "upset-set") {
    // One set (Venn disc, or an UpSet matrix row + its size bar): its colour is the
    // ordinary per-dataset series colour. Deliberately small: the marker/line vocabulary
    // has nothing to style on a filled disc or a membership dot.
    const datasets = tableDatasets(table);
    const idx = Math.max(0, datasets.findIndex((d) => d.id === selection.datasetId));
    const name = datasets[idx]?.name ?? "Set";
    const s = plot.seriesStyles?.[selection.datasetId] ?? {};
    const effective = s.color ?? seriesColor(idx);
    const setFields: Field[] = [
      { group: "Set", key: "color", label: "Colour", kind: "color", default: effective },
      { group: "Set", key: "color", label: "Swatch", kind: "swatches", default: effective, swatches: SWATCHES },
      { group: "Set", key: "hidden", label: "Hide this set", kind: "checkbox", default: false },
    ];
    return (
      <>
        <div className="insphd">{name}</div>
        <SchemaForm
          fields={setFields}
          value={{ ...s, color: effective }}
          onChange={(delta) => onSetSeriesStyle(selection.datasetId, delta as SeriesStyle)}
        />
        <p className="note" style={{ fontSize: 11 }}>
          Double-click the label on the diagram to rename this set (it renames the column).
        </p>
      </>
    );
  }
  if (selection.kind === "pie-slice") {
    const datasets = tableDatasets(table);
    // Slices are row-keyed for a parts-of-whole pie (one slice per row) and dataset-keyed
    // otherwise. Resolve the slice's index / name / colour from the right keyspace: a
    // plain datasets.findIndex on a row id returns -1, which would show datasets[0]'s
    // name and seriesColor(0) for every slice. The write path uses the same row-id key.
    const xc = xColumn(table);
    const rowIdx = table.kind === "partsofwhole" ? table.rows.findIndex((r) => r.id === selection.datasetId) : -1;
    const dsIdx = datasets.findIndex((d) => d.id === selection.datasetId);
    const idx = rowIdx >= 0 ? rowIdx : Math.max(0, dsIdx);
    const sliceRow = rowIdx >= 0 ? table.rows[rowIdx] : undefined;
    // A waffle's combined small groups ("Other") is no table row: its name, colour and shape are its own.
    const isOther = selection.datasetId === WAFFLE_OTHER_ID;
    const sliceName = isOther
      ? plot.waffleOtherName?.trim() || "Other"
      : sliceRow && xc ? (String(sliceRow.cells[xc.id] ?? "").trim() || "Slice") : (datasets[Math.max(0, dsIdx)]?.name ?? "Slice");
    const s = plot.seriesStyles?.[selection.datasetId] ?? {};
    const effective = s.color ?? (isOther ? WAFFLE_OTHER_COLOR : seriesColor(idx));
    // Icon waffle: the shape this category is drawn with, read off the drawing's own legend row —
    // a table position is wrong once an empty row is skipped or small groups are combined.
    const iconWaffle = plot.pieDisplay === "waffle" && plot.waffleIcons === true;
    const drawnShape = iconWaffle
      ? buildPlotScene(table, plot, { width: 400, height: 300 }).legend.find((e) => e.select?.id === selection.datasetId)?.symbol
      : undefined;
    const iconDefault = drawnShape ?? WAFFLE_ICON_CYCLE[idx % WAFFLE_ICON_CYCLE.length]!;
    const sliceFields: Field[] = [
      { group: "Slice", key: "color", label: "Colour", kind: "color", default: effective },
      { group: "Slice", key: "symbol", label: "Shape", kind: "select", default: iconDefault, options: SHAPES.filter(([v]) => v !== "none"), show: () => iconWaffle },
      { group: "Slice", key: "color", label: "Swatch", kind: "swatches", default: effective, swatches: SWATCHES },
      { group: "Slice", key: "sliceExplode", label: "Explode", kind: "range", default: 0, min: 0, max: 0.4, step: 0.02 },
      // Two-tone derives a light fill + darker edge from the slice colour above.
      { group: "Slice", key: "fillType", label: "Fill style", kind: "select", default: "solid", options: [["solid", "Solid"], ["twotone", "Two-tone (light fill + dark edge)"]] },
      { group: "Slice", key: "twoToneTint", label: "Fill lightness", kind: "range", default: 0.7, min: 0, max: 0.95, step: 0.05, show: (v) => v.fillType === "twotone" },
      { group: "Slice", key: "twoToneShade", label: "Edge darkness", kind: "range", default: 0.35, min: 0, max: 0.9, step: 0.05, show: (v) => v.fillType === "twotone" },
      { group: "Slice", key: "sliceStroke", label: "Border", kind: "color", default: themeBgHex(), show: (v) => v.fillType !== "twotone" },
      { group: "Slice", key: "sliceStrokeWidth", label: "Border width", kind: "number", default: 1.5, min: 0, max: 8, step: 0.25 },
      { group: "Label", key: "sliceLabel", label: "Show", kind: "select", default: plot.pieLabels ?? "percent", options: PIE_LABELS },
      // Per-slice label font — overrides the shared font for this slice only.
      { group: "This slice's label font", key: "sliceLabelSize", label: "Size", kind: "number", default: plot.fonts?.sliceLabel?.size ?? 12, min: 4, max: 60, step: 0.5 },
      { group: "This slice's label font", key: "sliceLabelBold", label: "Bold", kind: "checkbox", default: false },
      { group: "This slice's label font", key: "sliceLabelItalic", label: "Italic", kind: "checkbox", default: false },
    ];
    return (
      <>
        <div className="insphd">{sliceName}</div>
        <SchemaForm
          fields={sliceFields}
          value={{ ...s, color: effective }}
          onChange={(delta) => onSetSeriesStyle(selection.datasetId, delta as SeriesStyle)}
        />
        <FontControls
          label="Label font (all slices)"
          element="sliceLabel"
          spec={plot.fonts?.sliceLabel}
          defaultSize={12}
          onSetPlotFont={onSetPlotFont}
        />
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          “Label font (all slices)” restyles every slice; the <strong>This slice’s label font</strong> size/bold/italic overrides just this one. Start angle, donut hole, and the default label mode are in the <strong>Pie chart</strong> panel (click the chart background).
        </p>
      </>
    );
  }

  // treemap cell — a focused colour override for this one cell (wins over the
  // palette / group colour). Cell id = a row id (parts-of-whole) or a dataset id.
  if (selection.kind === "treemap-cell") {
    const datasets = tableDatasets(table);
    const dsIdx = datasets.findIndex((d) => d.id === selection.cellId);
    const xc = table.columns.find((c) => c.role === "x") ?? table.columns[0];
    const row = table.rows.find((r) => r.id === selection.cellId);
    const cellName = dsIdx >= 0 ? datasets[dsIdx]!.name : row && xc ? String(row.cells[xc.id] ?? "Cell") : "Cell";
    const s = plot.seriesStyles?.[selection.cellId] ?? {};
    const effective = s.color ?? seriesColor(Math.max(0, dsIdx));
    // Per-cell border override — wins over the treemap's global boundary for this
    // one polygon (mirrors the pie slice's Border/Border-width). The
    // default reflects the global boundary the cell currently renders with.
    const cellFields: Field[] = [
      { group: "Cell", key: "color", label: "Colour", kind: "color", default: effective },
      { group: "Cell", key: "color", label: "Swatch", kind: "swatches", default: effective, swatches: SWATCHES },
      { group: "Cell border", key: "sliceStroke", label: "Border", kind: "color", default: plot.treemap?.stroke ?? themeBgHex() },
      { group: "Cell border", key: "sliceStrokeWidth", label: "Border width", kind: "number", default: plot.treemap?.strokeWidth ?? 1.5, min: 0, max: 8, step: 0.25 },
    ];
    return (
      <>
        <div className="insphd">{cellName}</div>
        <SchemaForm fields={cellFields} value={{ ...s, color: effective }} onChange={(delta) => onSetSeriesStyle(selection.cellId, delta as SeriesStyle)} />
        <label className="frow" style={{ marginTop: 6 }}>
          <span>Auto colour</span>
          <button type="button" className="swbtn" title="Clear this cell's colour override (back to palette / group)" onClick={() => onSetSeriesStyle(selection.cellId, { color: undefined } as SeriesStyle)}>Reset</button>
        </label>
        {/* A click on a treemap cell's own words (its name, its value, a region's icon) lands here,
            so the font belongs here too, beside the colour, and the labels can be sized from the
            panel their click opens. Chart-wide, as it says. */}
        <FontControls
          label="Cell label font (all cells)"
          element="tick"
          spec={{ ...(plot.fonts?.tick ?? {}), ...(plot.treemap?.labelSize != null ? { size: plot.treemap.labelSize } : {}) }}
          defaultSize={12}
          onSetPlotFont={onSetPlotFont}
          onSet={(patch) => {
            // Same field the Treemap section writes — see the note there. A size set here that
            // went to `fonts.tick` would be swallowed whole by `treemap.labelSize`.
            const { size, ...rest } = patch;
            if (size !== undefined) onSetPlotOptions({ treemap: { ...(plot.treemap ?? {}), labelSize: size } });
            if (Object.keys(rest).length) onSetPlotFont("tick", rest);
          }}
        />
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          This colour overrides the palette / group colour for just this cell. Boundary, labels, and <strong>Colour by group</strong> are in the <strong>Treemap</strong> panel (click the chart background).
        </p>
      </>
    );
  }

  // network node — recolour / re-place / rename a single node.
  // The node twin of the link editor below: fill / two-tone / outline /
  // size for this node, or pushed to every node, from the clicked node.
  if (selection.kind === "network-node") {
    return <NetworkNodePanel plot={plot} nodeId={selection.nodeId} onSetPlotOptions={onSetPlotOptions} onSelect={onSelect} />;
  }

  // network link — style this link alone, or push the same style to every link. The scope
  // toggle is explicit (not a hidden default) because both are what you'd reach for: tuning
  // one link to highlight it, or dialling in the look of the whole graph from the link you
  // happened to click.
  if (selection.kind === "network-edge") {
    return <NetworkEdgePanel plot={plot} edgeId={selection.edgeId} onSetPlotOptions={onSetPlotOptions} onSelect={onSelect} />;
  }

  /**
   * parallel axis — one variable's own tick settings.
   *
   * Parallel coordinates has N axes, one per column, so there is nowhere for the single
   * `xAxis`/`yAxis` pair every other chart uses to live. These are stored per column id in
   * `parallel.perAxis`, the same keying as `brushes` and `axisOrder`, so a setting survives a
   * re-sort of the table. Blank always means "fall back to the plot-wide value".
   */
  if (selection.kind === "parallel-axis") {
    const pcs = plot.parallel ?? {};
    const colId = selection.colId;
    const spec = pcs.perAxis?.[colId] ?? {};
    const name = table.columns.find((c) => c.id === colId)?.name ?? colId;
    const setAxis = (patch: Partial<NonNullable<Plot["parallel"]>["perAxis"] extends Record<string, infer V> | undefined ? V : never>) => {
      const next = { ...(pcs.perAxis ?? {}) };
      const merged = { ...spec, ...patch };
      // Drop the entry entirely once nothing is set, so an untouched axis leaves no trace in
      // the saved document.
      if (Object.values(merged).every((v) => v === undefined)) delete next[colId];
      else next[colId] = merged;
      onSetPlotOptions({ parallel: { ...pcs, perAxis: Object.keys(next).length ? next : undefined } });
    };
    const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
    return (
      <>
        <div className="insphd">{name} — axis</div>
        <p className="note" style={{ fontSize: 11 }}>Settings for <b>this</b> axis. Blank = follow the chart-wide setting. Click another variable name to switch axes.</p>
        <label className="frow" title="What the label above this axis says on the figure. The column keeps its own name in the data sheet.">
          <span>Axis label</span>
          <input type="text" className="numin" style={{ width: 130 }} placeholder={name}
            value={spec.title ?? ""} onChange={(e) => setAxis({ title: e.target.value.trim() === "" ? undefined : e.target.value })} />
        </label>
        <label className="frow" title="Exact spacing between ticks, in this variable's own units. Wins over the tick count — an interval is a stronger statement than a count, so it is honoured exactly.">
          <span>Tick interval</span>
          <input type="number" className="numin" min={0} step="any" placeholder="auto" value={spec.majorStep ?? ""}
            onChange={(e) => setAxis({ majorStep: num(e.target.value) })} />
        </label>
        <label className="frow" title="Unlabelled subdivisions drawn between each pair of numbered ticks.">
          <span>Minor ticks</span>
          <input type="number" className="numin" min={0} max={20} step={1} placeholder="none" value={spec.minorCount ?? ""}
            onChange={(e) => setAxis({ minorCount: num(e.target.value) })} />
        </label>
        <label className="frow" title="Numbered ticks on this axis only. Blank = the chart-wide count.">
          <span>Ticks on this axis</span>
          <input type="number" className="numin" min={2} max={8} step={1} placeholder="auto" value={spec.tickCount ?? ""}
            onChange={(e) => setAxis({ tickCount: num(e.target.value) })} />
        </label>
        <label className="frow" title="Put this variable's low values at the top. Where two neighbouring axes run opposite to each other every line crosses in an X; flipping one turns that tangle into parallel lines.">
          <span>Flip axis</span>
          <input type="checkbox" checked={spec.reversed === true} onChange={(e) => setAxis({ reversed: e.target.checked })} />
        </label>
        {/* How this axis's numbers are written — one variable can be a percentage while the
            next is a count, which a single chart-wide format cannot express. */}
        <label className="frow" title="How this axis's numbers are written.">
          <span>Number format</span>
          <select className="selin" value={spec.format ?? "decimal"}
            onChange={(e) => setAxis({ format: e.target.value as NumberFormat })}>
            {NUMBER_FORMAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="frow" title="Decimal places on this axis. Blank = as many as it takes to print each tick exactly.">
          <span>Decimals</span>
          <input type="number" className="numin" min={0} max={6} step={1} placeholder="auto" value={spec.decimals ?? ""}
            onChange={(e) => setAxis({ decimals: num(e.target.value) })} />
        </label>
        <label className="frow" title="Text before each number on this axis, e.g. a currency symbol.">
          <span>Prefix</span>
          <input type="text" className="numin" style={{ width: 60 }} placeholder="none" value={spec.prefix ?? ""}
            onChange={(e) => setAxis({ prefix: e.target.value === "" ? undefined : e.target.value })} />
        </label>
        <label className="frow" title="Text after each number on this axis, e.g. a unit.">
          <span>Suffix</span>
          <input type="text" className="numin" style={{ width: 60 }} placeholder="none" value={spec.suffix ?? ""}
            onChange={(e) => setAxis({ suffix: e.target.value === "" ? undefined : e.target.value })} />
        </label>
        <label className="frow" title="Digit grouping for large numbers on this axis.">
          <span>Thousands</span>
          <select className="selin" value={spec.thousands ?? "none"}
            onChange={(e) => setAxis({ thousands: e.target.value === "none" ? undefined : (e.target.value as ThousandsSeparator) })}>
            <option value="none">None</option>
            <option value="comma">1,200</option>
            <option value="period">1.200</option>
            <option value="space">1 200</option>
            <option value="apostrophe">1’200</option>
          </select>
        </label>
        {/* Custom ticks — same shape as the Axis panel's own editor, so the gesture is the one
            already learned elsewhere in the app. */}
        <div className="insphd" style={{ marginTop: 10 }}>Custom ticks</div>
        {(spec.extraTicks ?? []).map((t, i) => (
          <label className="frow" key={`${t.value}-${i}`}>
            <span>{t.value}{t.label ? ` · ${t.label}` : ""}</span>
            <button type="button" className="swbtn" title="Remove this tick"
              onClick={() => {
                const next = (spec.extraTicks ?? []).filter((_, j) => j !== i);
                setAxis({ extraTicks: next.length ? next : undefined });
              }}>⨯</button>
          </label>
        ))}
        <div className="frow" style={{ gap: 6 }}>
          <input type="number" className="numin" style={{ width: 64 }} step="any" aria-label="New tick value" placeholder="value" value={pcTickVal} onChange={(e) => setPcTickVal(e.target.value)} />
          <input type="text" className="numin" style={{ width: 80 }} aria-label="New tick label" placeholder="label (opt)" value={pcTickLbl} onChange={(e) => setPcTickLbl(e.target.value)} />
          <button type="button" className="btn-mini" onClick={() => {
            const v = Number(pcTickVal);
            if (!Number.isFinite(v) || pcTickVal.trim() === "") return;
            setAxis({ extraTicks: [...(spec.extraTicks ?? []), { value: v, ...(pcTickLbl.trim() ? { label: pcTickLbl.trim() } : {}) }] });
            setPcTickVal(""); setPcTickLbl("");
          }}>Add tick</button>
        </div>
        <p className="note" style={{ fontSize: 11 }}>A tick at an exact value on this axis — a threshold or cut-off. Blank label = the formatted number. A value outside the data range is not drawn.</p>
        <label className="frow" style={{ marginTop: 6 }}>
          <span>Reset</span>
          <button type="button" className="swbtn" title="Clear this axis's overrides — back to the chart-wide settings"
            onClick={() => setAxis({ majorStep: undefined, minorCount: undefined, tickCount: undefined, extraTicks: undefined, reversed: undefined, format: undefined, decimals: undefined, prefix: undefined, suffix: undefined, thousands: undefined, title: undefined })}>Clear</button>
        </label>
        {/* The two texts on this axis are edited here. Clicking a variable name or a tick
            number opens this panel, so it carries font rows as well as range, ticks and number
            format, and either text can be resized from where it lands. Both fonts are chart-wide
            (every axis shares them), which the labels say; the same controls remain in the
            Parallel coordinates section. */}
        <SubSection title="Fonts" open>
          <FontControls label="Variable name font (all axes)" element="axisTitle" spec={plot.fonts?.axisTitle} defaultSize={15} onSetPlotFont={onSetPlotFont} />
          <FontControls label="Tick value font (all axes)" element="tick" spec={plot.fonts?.tick} defaultSize={11} onSetPlotFont={onSetPlotFont} />
        </SubSection>
      </>
    );
  }

  // parallel line — recolour one row's line, to pull a single case out of the bundle.
  if (selection.kind === "parallel-line") {
    const pcs = plot.parallel ?? {};
    const rowId = selection.rowId;
    const current = pcs.lineColors?.[rowId];
    // Name the case by its lead (label) column, so the panel says "Beta", not "row_3".
    const lead = table.columns.find((c) => (c.role ?? "") === "x") ?? table.columns[0];
    const row = table.rows.find((r) => r.id === rowId);
    const name = lead && row ? String(row.cells[lead.id] ?? "").trim() || rowId : rowId;
    const setColor = (c?: string) => {
      const next = { ...(pcs.lineColors ?? {}) };
      if (c) next[rowId] = c;
      else delete next[rowId];
      onSetPlotOptions({ parallel: { ...pcs, lineColors: Object.keys(next).length ? next : undefined } });
    };
    /** Per-row width/opacity overrides, same row-id keying as the colour override. */
    const setNum = (key: "lineWidths" | "lineOpacities", v?: number) => {
      const next = { ...((pcs[key] ?? {}) as Record<string, number>) };
      if (v === undefined || Number.isNaN(v)) delete next[rowId];
      else next[rowId] = v;
      onSetPlotOptions({ parallel: { ...pcs, [key]: Object.keys(next).length ? next : undefined } });
    };
    const curW = pcs.lineWidths?.[rowId];
    const curO = pcs.lineOpacities?.[rowId];
    return (
      <>
        <div className="insphd">{name}</div>
        <label className="frow">
          <span>Line colour</span>
          <ColorInput className="colorin" value={current ?? pcs.lineColor ?? "#1f77b4"} aria-label="Line colour" onChange={(c) => setColor(c)} />
        </label>
        <ColourSwatches value={current} onPick={(c) => setColor(c)} />
        <label className="frow" style={{ marginTop: 6 }}>
          <span>Auto colour</span>
          <button type="button" className="swbtn" title="Clear this line's colour override (back to the colour mapping)" onClick={() => setColor(undefined)}>Reset</button>
        </label>
        <label className="frow" style={{ marginTop: 6 }} title="Thickness of this trace. Colour alone rarely pulls one case out of a dense bundle.">
          <span>Line width</span>
          <input
            type="number"
            className="numin"
            min={0.25}
            max={8}
            step={0.25}
            value={curW ?? pcs.lineWidth ?? 1}
            onChange={(e) => setNum("lineWidths", e.target.value.trim() === "" ? undefined : Number(e.target.value))}
          />
        </label>
        <label className="frow" title="Opacity of this trace — keep one case solid while the bundle behind it stays faint.">
          <span>Line opacity</span>
          <input
            type="number"
            className="numin"
            min={0.05}
            max={1}
            step={0.05}
            value={curO ?? pcs.lineOpacity ?? 0.6}
            onChange={(e) => setNum("lineOpacities", e.target.value.trim() === "" ? undefined : Number(e.target.value))}
          />
        </label>
        <label className="frow">
          <span>Auto width/opacity</span>
          <button
            type="button"
            className="swbtn"
            title="Clear this line's width + opacity overrides (back to the graph-wide values)"
            onClick={() => {
              // one update: two sequential setNum calls would both read the same stale `pcs`,
              // so the second would silently undo the first.
              const w = { ...((pcs.lineWidths ?? {}) as Record<string, number>) };
              const o = { ...((pcs.lineOpacities ?? {}) as Record<string, number>) };
              delete w[rowId];
              delete o[rowId];
              onSetPlotOptions({
                parallel: {
                  ...pcs,
                  lineWidths: Object.keys(w).length ? w : undefined,
                  lineOpacities: Object.keys(o).length ? o : undefined,
                },
              });
            }}
          >
            Reset
          </button>
        </label>
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          Colour, width and opacity here apply to <strong>this row only</strong>, overriding the graph-wide
          values — the usual way to pull one case out of the bundle. The graph-wide defaults and the
          colour ramp are in the <strong>Parallel coordinates</strong> panel (click the chart background).
        </p>
        <button type="button" className="btn-mini" style={{ marginTop: 8 }} onClick={() => onSelect({ kind: "plot" })}>
          ← Back to graph
        </button>
      </>
    );
  }

  // alluvial node — recolour a single category block (and the flows it originates).
  if (selection.kind === "alluvial-node") {
    const al = plot.alluvial ?? {};
    const key = `${selection.axis}:${selection.category}`;
    const current = al.nodeColors?.[key];
    const setColor = (c?: string) => {
      const next = { ...(al.nodeColors ?? {}) };
      if (c) next[key] = c; else delete next[key];
      onSetPlotOptions({ alluvial: { ...al, nodeColors: Object.keys(next).length ? next : undefined } });
    };
    return (
      <>
        <div className="insphd">{selection.category}</div>
        <label className="frow">
          <span>Colour</span>
          <ColorInput className="colorin" value={current ?? al.nodeColor ?? "#9aa0aa"} aria-label="Node colour" onChange={(c) => setColor(c)} />
        </label>
        <label className="frow" style={{ marginTop: 6 }}>
          <span>Auto colour</span>
          <button type="button" className="swbtn" title="Clear this node's colour override" onClick={() => setColor(undefined)}>Reset</button>
        </label>
        {/* Clicking the name lands here, so the name's font belongs here beside the colour, and
            an alluvial node label can be resized from the panel its own click opens. Chart-wide,
            as the label says — the same control is in the Alluvial section. */}
        <FontControls label="Node label font (all nodes)" element="tick" spec={plot.fonts?.tick} defaultSize={12} onSetPlotFont={onSetPlotFont} />
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          Recolours this category block. A block on the colour axis also recolours the flows it originates. Ribbon opacity, node width and colour-by are in the <strong>Alluvial</strong> panel (click the chart background).
        </p>
      </>
    );
  }

  // heatmap cell: a `heatmap-cell` selection does not land here. Cells route into the sectioned plot
  // panel above, which surfaces the Heatmap editor directly, rather than a read-only
  // Row/Column/Value readout that could only point elsewhere.

  // corr-cell — recolour just this glyph (overrides the r→colour scale). Key = `${row}:${col}`.
  if (selection.kind === "corr-cell") {
    const datasets = tableDatasets(table);
    const rowName = datasets[selection.row]?.name ?? `Row ${selection.row + 1}`;
    const colName = datasets[selection.col]?.name ?? `Column ${selection.col + 1}`;
    const key = `${selection.row}:${selection.col}`;
    const cm = plot.corrmatrix ?? {};
    const override = cm.cellColors?.[key];
    const setCellColor = (color: string | undefined): void => {
      const next = { ...(cm.cellColors ?? {}) };
      if (color) next[key] = color;
      else delete next[key];
      onSetPlotOptions({ corrmatrix: { ...cm, cellColors: Object.keys(next).length ? next : undefined } });
    };
    return (
      <>
        <div className="insphd">{rowName} × {colName}</div>
        <label className="frow">
          <span>Cell colour</span>
          <ColorInput className="colorin" value={override ?? "#2166ac"} aria-label="Cell colour" onChange={(c) => setCellColor(c)} />
        </label>
        <ColourSwatches value={override} onPick={(c) => setCellColor(c)} />
        <label className="frow" style={{ marginTop: 6 }}>
          <span>Auto colour</span>
          <button type="button" className="swbtn" title="Clear this cell's colour override (back to the correlation scale)" onClick={() => setCellColor(undefined)}>Reset</button>
        </label>
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          Overrides the correlation-scale colour for just this cell. The Positive/Negative scale colours (the palette) are in the <strong>Correlation matrix</strong> panel (click the chart background).
        </p>
      </>
    );
  }

  // series — fully schema-driven (a new tunable = one field below).
  // `columnId` is the dataset id (its lead Y column); resolve the dataset so the
  // colour index + error-bar default match what buildScene draws.
  const colId = selection.columnId;
  // ROC / survival draw synthetic series keyed roc-i / surv-i (one per plot.roc /
  // plot.survival curve), not the table columns — resolve the colour index, name and
  // whole-graph target from those, else findIndex on the synthetic id returns -1 and the
  // editor mis-seeds (seriesColor(0) + datasets[0]'s name for every curve).
  const rawDs = tableDatasets(table);
  // Bland-Altman draws one "Difference" series keyed by the 2nd method column (styleId);
  // listing the two method columns is misleading (only styleId maps to the drawn series).
  const baStyleId = (rawDs.length >= 2 ? rawDs[1]?.id : rawDs[0]?.id) ?? "";
  const datasets: Dataset[] =
    plot.kind === "roc"
      ? (plot.roc ?? []).map((c, i) => ({ id: `roc-${i}`, name: c.label, replicates: [] }))
      : plot.kind === "survival"
        ? (plot.survival ?? []).map((c, i) => ({ id: `surv-${i}`, name: c.label, replicates: [] }))
        : plot.kind === "blandaltman" && baStyleId
          ? [{ id: baStyleId, name: "Difference", replicates: [] }]
          : // Estimation draws Control (0) · Test (1) · the synthetic "est-diff" difference
            // glyph (2, seriesColor(2)); listing only the raw columns collapses est-diff's
            // colour index to 0, so its Inspector swatch would show the wrong default.
            plot.kind === "estimation"
            ? [...rawDs.slice(0, 2), { id: "est-diff", name: "Difference", replicates: [] }]
            : rawDs;
  const dsIndexRaw = datasets.findIndex((d) => d.id === colId);
  const dsIndex = Math.max(0, dsIndexRaw);
  const ds = datasets[dsIndex];

  const s = plot.seriesStyles?.[colId] ?? {};
  /**
   * A synthetic id is in no dataset, so `findIndex` returns −1, the index collapses to 0, and
   * the swatch would show `seriesColor(0)` — `#0072b2` — for every element of dendrogram ·
   * scree · PCA · ROC, whatever it is actually drawn in. The path is reachable (clicking a branch
   * emits `{kind:"series", columnId:"dendro-0"}` and styling it changes the drawing), so the
   * panel would misreport the current colour.
   *
   * Parsing the id would not fix it: a dendrogram's branches are coloured by cluster, so
   * `dendro-0` is drawn `#e69f00` while `dendro-1` is `#0072b2`. The only correct seed is what the
   * builder drew, so ask it — and only when the id is not a known dataset, which is exactly the
   * case that would mis-seed. `buildPlotScene` is pure and ~1-3 ms.
   */
  const drawnColor = dsIndexRaw < 0 ? sceneColorOf(table, plot, colId) : undefined;
  const effective = s.color ?? drawnColor ?? seriesColor(dsIndex);
  // Spread is available when there are ≥2 replicates or summary error columns;
  // that drives the default error-bar type (SD by default), matching buildScene.
  const replicateCount = ds?.replicates.length ?? 1;
  const hasSpread = Boolean(ds && (ds.sd || ds.sem || replicateCount >= 2));
  // Lollipop error bars are opt-in (the builder default is "none", so a lollipop without the setting
  // draws no whiskers); the control must default to "none" too, or it would show "SD" while the
  // graph draws nothing. New wizard lollipops stamp an explicit type, which then wins.
  const errDefault = hasSpread && plot.kind !== "lollipop" ? "sd" : "none";
  const kind = plot.kind ?? "xy";
  // A histogram is drawn as bars, so its series/point editor is the bar fill editor
  // (fill / two-tone / border), never the scatter marker (shape / size) editor.
  const barLike = kind === "bar" || kind === "histogram";
  /** A bar-chart series drawn as points (`plotAs: "points"`, the ranked dots): no bar, only its dots. */
  const pointsOnly = kind === "bar" && s.plotAs === "points";
  /** Every point of this series carries its own colour (per-point `pointColor` / `color`), so the series Colour
   *  reaches no dot — the panel says so instead of showing a colour drawn nowhere. */
  const ownColoured = table.rows.filter((r) => { const p = plot.pointStyles?.[`${colId}:${r.id}`]; return !!(p?.pointColor ?? p?.color); }).length;
  const everyPointOwnColour = table.rows.length > 0 && ownColoured === table.rows.length;

  // --- per-point vs per-series routing (a single point's own style → highlight) ---
  // The tickbox (on by default, persisted) makes every change apply to the whole
  // series. Untick it + click a point → colour/marker changes hit only that point.
  const rowId = selection.kind === "series" ? selection.rowId : undefined;
  // A violin is one mark per dataset, so the user reads all violins as the "series"
  // and a single violin as the "datapoint": toggle on → restyle every violin, off
  // → just the clicked one. (Other chart types use the per-point highlight model
  // below.) Violins never use point-overrides, so perPoint stays false.
  const isViolin = kind === "violin";
  const isRaincloud = kind === "raincloud";
  /**
   * A raincloud's series carries three marks — `<id>-cloud`, `<id>-box`, `<id>-rain` — and
   * clicking one already selects it by name. Two of them take their own fill.
   *
   * Routing it like a violin ("three marks share one series style") would be wrong for the
   * cloud and the box. In the builder, `a1:a1-cloud` moves the cloud alone
   * and `a1:a1-box` the box alone, while the series key moves both — so only per-mark routing
   * lets the cloud and its inner box have different fills.
   *
   * The rain is not like them. A per-mark fill on `a1-rain` moves nothing at all, so it
   * keeps routing to the series; targeting it would be a control that silently does nothing.
   * Its own Shape / Size / Opacity rows are series-level and already work.
   */
  const raincloudPart: "cloud" | "box" | "rain" | null = !isRaincloud || !rowId
    ? null
    : rowId.endsWith("-cloud") ? "cloud" : rowId.endsWith("-box") ? "box" : "rain";
  const perPartFill = raincloudPart === "cloud" || raincloudPart === "box";
  const glyphSeries = isViolin || (isRaincloud && !perPartFill);
  // Before-after: each row (subject) is its own series (id = row id), so a "series"
  // is one subject and "whole graph" means every subject. There is no meaningful
  // per-point highlight (a subject's marks share the subject id), so route edits to
  // the subject's series style and never to a dead pointStyle key.
  const isBeforeAfter = kind === "beforeafter";
  // Whole-graph mode overrides per-point: edits target every series, so the form
  // shows the series baseline (not a single point's override).
  const perPoint = !wholeGraph.value && !wholeSeries.value && !!rowId && !glyphSeries && !isBeforeAfter;
  const pointCount = Object.keys(plot.pointStyles ?? {}).filter((k) => k.startsWith(`${colId}:`)).length;
  /** Keys that make sense to override on a single point (the highlight set). */
  const POINT_KEYS_BASE: (keyof SeriesStyle)[] = ["color", "fillColor", "fillOpacity", "symbol", "symbolSize", "symbolOpacity", "symbolFill", "symbolFillColor", "symbolOutline", "twoToneTint", "twoToneShade", "twoToneEdge"];
  // Bars can carry the whole fill look per bar (pattern/ink/density/gradient/metallic
  // + contour), so on a bar those keys target the selected bar too — matching the
  // colour. Only bars: other chart kinds use the base highlight set.
  const BAR_FILL_KEYS: (keyof SeriesStyle)[] = ["fillType", "twoToneTint", "twoToneShade", "pattern", "patternScale", "patternColor", "patternBg", "gradientTo", "gradientAngle", "metallic", "special", "gradRamp", "gradMap", "gradReversed", "gradTo", "borderColor", "borderWidth"];
  /**
   * A pyramid belongs here too; leaving it out would write to the wrong target. Its mark is a
   * filled bar and the builder honours a per-point fill on each one (one override moves exactly
   * one bar, and a patterned bar references its own `<pattern>`). The panel shows
   * the "Style" and "Contour width" rows, and with pyramid outside this set `applyStyle` would
   * sweep them into `rest` and send them to `onSetSeriesStyle`, so patterning one bar would
   * pattern every bar of the series.
   *
   * Deliberately not folded into `barLike`, which also decides the symbol two-tone and
   * symbol-outline key mapping. A pyramid draws no markers, so those must stay as they are.
   */
  // `lollipop` joins them for the same reason: its panel's "Outline width" row writes
  // `borderWidth`, a per-point override moves exactly one mark, and without the key in this set
  // `applyStyle` would send it to the whole series, thickening every lollipop instead of one.
  const perPointBarFill = barLike || kind === "pyramid" || kind === "lollipop";
  /**
   * A raincloud part takes these three and nothing else, because of how the builder reads
   * part keys: `fillType`/`pattern` leak to the other part, and gradient · metallic · two-tone ·
   * contour colour · contour width · every `symbol*` move nothing per part. Handing the part
   * the whole highlight set would ship a dozen controls that quietly do nothing.
   */
  const RAINCLOUD_PART_KEYS: (keyof SeriesStyle)[] = ["color", "fillColor", "fillOpacity"];
  const POINT_KEYS: (keyof SeriesStyle)[] = isRaincloud
    ? RAINCLOUD_PART_KEYS
    : perPointBarFill
      ? [...POINT_KEYS_BASE, ...BAR_FILL_KEYS]
      : POINT_KEYS_BASE;
  /**
   * The forest pooled summary is its own series, not one of the studies.
   *
   * It is keyed by the synthetic id `forest-summary` — computed, so it has no table column —
   * which is exactly why the scope toggles must not reach it: `onSetSeriesStyleAll(datasets)`
   * enumerates the table's datasets, so "apply to whole graph" while the summary is selected
   * would restyle the studies instead. This routing, with the panel heading, keeps the summary
   * distinguishable from the other data points.
   */
  const isForestSummary = kind === "forest" && colId === "forest-summary";
  /**
   * The estimation plot's "Difference" — the same shape of object as the forest summary, with
   * the same needs.
   *
   * Clicking the dot selects `est-diff`, it is in the series list, and colour/shape/outline all
   * reach the drawing. The panel it opens needs a heading, or it is indistinguishable from a
   * control-group point. Two further points:
   *
   *  1. The scope toggles must not reach it. `onSetSeriesStyleAll` enumerates the table's
   *     datasets, so "apply to whole graph" from the Difference panel would restyle the two raw
   *     groups (they would take the two-tone tint of the colour set on the Difference) — the
   *     same reasoning as for the forest summary.
   *  2. The bootstrap half-violin is drawn from `fillColor`/`fillOpacity`, which `seriesExtras`
   *     honours, so this kind offers fill controls; without them the distribution could only
   *     be the same colour as the point estimate.
   */
  const isEstimationDiff = kind === "estimation" && colId === "est-diff";
  /** Appearance fields the link carries. Mirrors `SUMMARY_LOOK` in the builder. */
  const SUMMARY_LOOK: (keyof SeriesStyle)[] = ["color", "symbolFill", "symbolFillColor", "symbolOpacity", "symbolOutline", "symbolBorderWidth", "borderWidth", "symbolSize", "twoToneTint", "twoToneShade", "twoToneEdge", "filled"];
  // Default true, except on a summary already styled by hand — the same rule the
  // builder applies, and it has to be the same or the tickbox would show one state and the
  // drawing another.
  const summaryLinkDefault = !SUMMARY_LOOK.some((k) => s[k] !== undefined);
  const summaryLinked = isForestSummary && (s.linkSummaryToStudies ?? summaryLinkDefault);
  /** The study markers' style — what the summary wears while the link is on. A forest reads
   *  its estimate/CI from the first dataset, so that dataset's style is the studies' style. */
  const studyStyle: SeriesStyle = (isForestSummary ? plot.seriesStyles?.[datasets[0]?.id ?? ""] : undefined) ?? {};
  const applyStyle = (raw: SeriesStyle): void => {
    // Unticking "Match …" → seed the line's own colour with the current colour, so the
    // line keeps its appearance and is immediately independent (rather than still
    // tracking the marker colour until the user picks a line colour).
    const delta: SeriesStyle = raw.linkLineColor === false ? { ...raw, lineColor: effective } : raw;
    if (isForestSummary) {
      // Unticking "Match the studies" seeds the summary's own look with what is on screen, so
      // nothing jumps and the next edit starts from what is visible. Without the seed the
      // summary keeps tracking the studies through the builder's fallbacks until each field is
      // set — i.e. the switch would look like it had done nothing.
      if (raw.linkSummaryToStudies === false) {
        const seed: SeriesStyle = {};
        for (const k of SUMMARY_LOOK) if (studyStyle[k] !== undefined) (seed as Record<string, unknown>)[k] = studyStyle[k];
        onSetSeriesStyle(colId, { ...seed, color: seed.color ?? effective, ...delta });
        return;
      }
      onSetSeriesStyle(colId, delta);
      return;
    }
    // Before-after: "whole graph" = every subject (row); otherwise the selected subject.
    if (isBeforeAfter) {
      if (wholeGraph.value) onSetSeriesStyleAll(table.rows.map((r) => r.id), delta, Object.keys(delta).sort().join(","));
      else onSetSeriesStyle(colId, delta);
      return;
    }
    // "Apply to whole graph" — restyle every series/group in one coalesced undo.
    // Takes precedence over the per-series / per-point routing below.
    if (wholeGraph.value) {
      onSetSeriesStyleAll(datasets.map((d) => d.id), delta, Object.keys(delta).sort().join(","));
      return;
    }
    if (glyphSeries) {
      // on → all violins/rainclouds (one coalesced undo); off → only the selected one.
      if (wholeSeries.value) onSetSeriesStyleAll(datasets.map((d) => d.id), delta, Object.keys(delta).sort().join(","));
      else onSetSeriesStyle(colId, delta);
      return;
    }
    if (perPoint && rowId) {
      const pd: SeriesStyle = {};
      const rest: SeriesStyle = {};
      for (const k of Object.keys(delta) as (keyof SeriesStyle)[]) {
        if (POINT_KEYS.includes(k)) (pd as Record<string, unknown>)[k] = delta[k];
        else (rest as Record<string, unknown>)[k] = delta[k];
      }
      if (Object.keys(pd).length) onSetPointStyle(colId, rowId, pd);
      if (Object.keys(rest).length) onSetSeriesStyle(colId, rest); // non-visual keys stay series-wide
    } else {
      onSetSeriesStyle(colId, delta);
    }
  };

  // Symbol fill mode defaults from the legacy `filled` flag for back-compat.
  const fillDefault = s.symbolFill ?? (s.filled === false ? "open" : "solid");
  // A light tint of the series colour — the suggested starting fill for a hollow
  // marker (the "light fill under a darker outline" look).
  const lightTint = (hex: string, amt = 0.62): string => {
    const h = hex.replace("#", "");
    const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(f.slice(0, 6).padEnd(6, "0"), 16);
    const ch = (v: number) => Math.round(v + (255 - v) * amt).toString(16).padStart(2, "0");
    return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  };
  // Y2 (second value axis) is only available on continuous XY / area charts.
  /**
   * `bubble`, `histogram` and `volcano` included: the builder draws their second value axis —
   * `seriesStyles.axis: "y2"` makes a real Y2 appear, with its own ticks, on each of the three.
   *
   * Note: a histogram does draw a second value axis, so its `plotAs` group keeps the
   * "Value axis" row too.
   */
  // The row offers exactly the right-hand axes this kind's drawing has (`rightValueAxes`): Y2 + Y3
  // on the XY family, Y2 only on vertical box / violin / column scatter. A bar keeps its
  // own "Value axis" row under "Plot as" (plotAsFields), so it gets none here — two rows, one key.
  const seriesRightAxes = kind === "bar" ? [] : rightValueAxes(plot);
  // A horizontal box / violin / column scatter draws its second axis along the top, and
  // its main value axis along the bottom — the row names them the way the chart shows them.
  const topSecondAxis = secondAxisOnTop(plot);
  const axisField: Field[] = seriesRightAxes.length
    ? [{ group: "Value axis", key: "axis", label: "Plot on", kind: "select", default: "y", options: [["y", topSecondAxis ? "Bottom (X)" : "Left (Y)"], ...seriesRightAxes.map((a): [string, string] => (a === "y2" ? ["y2", topSecondAxis ? "Top (X2)" : "Right (Y2)"] : ["y3", "Right (Y3)"]))] }]
    : [];
  // Data-driven per-point formatting: bind a table column to each point's colour / symbol /
  // label ("plot symbol from a column"). Offered on exactly the kinds the builder honours it on
  // — `DATA_DRIVEN_KINDS` is the one list, so a second hand-written list here cannot drift from
  // it (ternary and swimmer included, so the ternary gallery chart's colour-by-texture can be
  // changed or removed).
  //
  // Swimmer draws two different things. The start series' binding paints the bars, by category
  // only (the builder refuses a ramp with a warning), and nothing else of it is drawn per row; the
  // other structural columns (End, Response start / end, Ongoing) draw no per-row glyph at all.
  // Only the event columns are one-glyph-per-row series.
  const swimCols = kind === "swimmer" ? swimmerColumns(table) : null;
  const swimStart = !!swimCols && swimCols.start?.id === colId;
  const swimStructural = !!swimCols && !swimStart && [swimCols.end, swimCols.responseStart, swimCols.responseEnd, swimCols.ongoing].some((d) => d?.id === colId);
  const ddKinds = DATA_DRIVEN_KINDS.has(kind) && !swimStructural;
  const ddColourOnly = swimStart;
  const columnOptions: [string, string][] = [["", "None"], ...table.columns.map((c) => [c.id, c.name] as [string, string])];
  // "X value" / "Y value" label a point with its position. On a ternary the position is a point
  // inside the triangle, not a value in the table (the dot sits at 0.075 across, not at "Sand
  // 30"), and on a swimmer both are the same event time — so those two choices say what they draw.
  const labelPositionOptions: [string, string][] =
    kind === "ternary" ? [] : kind === "swimmer" ? [["x", "Time"]] : [["x", "X value"], ["y", "Y value"]];
  // Point labels also apply to volcano (gene names on significant points) — but not the
  // colour/symbol-by-column binding, which would override its up/down/ns zone encoding.
  const pointLabelFields: Field[] = [
    { group: "Point labels", key: "pointLabels", label: "Label points", kind: "select", default: "none", options: [["none", "None"], ...labelPositionOptions, ["col", "Column…"]] },
    { group: "Point labels", key: "pointLabelColumn", label: "Label column", kind: "select", default: "", options: columnOptions, show: (v) => v.pointLabels === "col" },
    { group: "Point labels", key: "pointLabelSize", label: "Label size", kind: "number", default: 9, min: 5, max: 24, step: 0.5, show: (v) => v.pointLabels !== undefined && v.pointLabels !== "none" },
    { group: "Point labels", key: "pointLabelColor", label: "Label colour", kind: "color", default: effective, show: (v) => v.pointLabels !== undefined && v.pointLabels !== "none" },
    // Find & highlight beside the labels it reuses: the found points are painted, drawn on top and labelled by name.
    { group: "Find & highlight", key: "highlightNames", label: "Find names", kind: "names", default: [],
      hint: "Type or paste names (one per line, or separated by commas). The points with these names are drawn on top in the highlight colour and labelled. Names not found are listed under the graph." },
    { group: "Find & highlight", key: "highlightColumn", label: "In column", kind: "select", default: highlightColumnOf(s, table) ?? "", options: columnOptions,
      show: (v) => Array.isArray(v.highlightNames) && v.highlightNames.length > 0 },
    { group: "Find & highlight", key: "highlightColor", label: "Colour", kind: "color", default: HIGHLIGHT_DEFAULT,
      show: (v) => Array.isArray(v.highlightNames) && v.highlightNames.length > 0 },
    { group: "Find & highlight", key: "highlightLabels", label: "Label them", kind: "checkbox", default: true,
      show: (v) => Array.isArray(v.highlightNames) && v.highlightNames.length > 0 },
  ];
  const dataDrivenFields: Field[] = ddColourOnly
    ? [{ group: "Colour by data", key: "colorFromColumn", label: "Colour bars by", kind: "select", default: "", options: columnOptions }]
    : ddKinds
    ? [
        { group: "Colour by data", key: "colorFromColumn", label: "Colour by", kind: "select", default: "", options: columnOptions },
        { group: "Colour by data", key: "colorFromMode", label: "Mapping", kind: "select", default: "auto", options: [["auto", "Auto"], ["continuous", "Continuous (ramp)"], ["category", "Category (palette)"]], show: (v) => !!v.colorFromColumn },
        { group: "Colour by data", key: "colorFromRamp", label: "Ramp", kind: "select", default: "viridis", options: rampOpts(GRAD_RAMPS), show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        { group: "Colour by data", key: "colorFromReversed", label: "Reverse ramp", kind: "checkbox", default: false, show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        // The colour-SHAPING knobs; the plot's colour bar follows them, because it keys these marks.
        { group: "Colour by data", key: "colorFromMidpoint", label: "Centre at", kind: "optnumber", default: undefined, step: 0.5, show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        { group: "Colour by data", key: "colorFromGamma", label: "Detail bias", kind: "optnumber", default: undefined, step: 0.1, show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        { group: "Colour by data", key: "colorFromSteps", label: "Colour steps", kind: "optnumber", default: undefined, step: 1, show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        { group: "Colour by data", key: "colorFromSpace", label: "Blend", kind: "select", default: "rgb", options: [["rgb", "Straight (RGB)"], ["hsl", "Vivid (HSL)"], ["lab", "Perceptual (Lab)"]], show: (v) => !!v.colorFromColumn && v.colorFromMode !== "category" },
        { group: "Symbol by data", key: "symbolFromColumn", label: "Shape by", kind: "select", default: "", options: columnOptions },
        ...pointLabelFields,
      ]
    : kind === "volcano"
      ? pointLabelFields
      : [];
  const symbolFields: Field[] = [
    { group: "Data points", key: "symbol", label: "Shape", kind: "select", default: "circle", options: SHAPES },
    { group: "Data points", key: "symbolSize", label: "Size", kind: "number", default: 4, min: 1, max: 24, step: 0.5 },
    // Volcano forces every whole-series marker to a solid zone fill (open/clear can't
    // override the significance colour); only solid + two-tone actually render. Hide the
    // dead open/clear options at whole-series scope — per-point still offers all four.
    { group: "Data points", key: "symbolFill", label: "Fill", kind: "select", default: fillDefault, options: kind === "volcano" && !perPoint ? SYMBOL_FILLS.filter(([v]) => v === "solid" || v === "twotone") : SYMBOL_FILLS },
    { group: "Data points", key: "symbolOpacity", label: "Opacity", kind: "range", default: 1, min: 0, max: 1, step: 0.05 },
    // For hollow markers only: choose the interior fill colour (a light tint of the
    // outline gives the two-tone marker look). Sits above the shape colour.
    { group: "Data points", key: "symbolFillColor", label: "Fill colour", kind: "color", default: lightTint(effective), show: (v) => v.symbolFill === "open" },
    { group: "Data points", key: "symbolFillColor", label: "Fill palette", kind: "swatches", default: lightTint(effective), swatches: SWATCHES, show: (v) => v.symbolFill === "open" },
    // Two-tone derives the interior fill + darker outline from the Colour below; the
    // sliders set how far each goes. The Fill/Outline colour pickers hide (derived).
    // Note: on a bar these write the points' own tint/shade. The identically-named sliders in
    // the Fill group are the bar's; if both wrote `twoToneTint`/`twoToneShade`, dragging either
    // would move both marks at once. Separate controls have to tune apart.
    // Hidden while "Match the bar" is on, where the bar's values are deliberately in charge.
    // A bar series drawn as points has no bar: its dots read the plain two-tone values (the link resolves to the
    // series' own style), so the sliders write those and are never hidden behind a link to a bar that is not there.
    { group: "Data points", key: barLike && !pointsOnly ? "symbolTwoToneTint" : "twoToneTint", label: "Fill lightness", kind: "range", default: 0.7, min: 0, max: 0.95, step: 0.05, show: (v) => v.symbolFill === "twotone" && !(barLike && !pointsOnly && v.linkPointsToBar === true) },
    { group: "Data points", key: barLike && !pointsOnly ? "symbolTwoToneShade" : "twoToneShade", label: "Edge darkness", kind: "range", default: 0.35, min: 0, max: 0.9, step: 0.05, show: (v) => v.symbolFill === "twotone" && !(barLike && !pointsOnly && v.linkPointsToBar === true) },
    // The link: ticked (the default) the points take the bar's colour + two-tone look, so a
    // dot reads as part of the bar it sits on. Untick it to give them their own colour and
    // their own tint/shade sliders — which reappear above as soon as it is unticked.
    ...(kind === "bar" && !pointsOnly
      ? [{ group: "Data points", key: "linkPointsToBar", label: "Match the bar", kind: "checkbox", default: true } as Field]
      : []),
    // Colour right under the opacity slider — full picker + the palette (the logical spot).
    // Volcano paints each point by significance zone, so a whole-series colour does nothing
    // (the zone wins). Hide it at whole-series scope; per-point recolour still shows it.
    // Likewise when every point carries its own colour: the series colour reaches no dot (the note below says so).
    { group: "Data points", key: "color", label: "Colour", kind: "color", default: effective, show: () => !(kind === "volcano" && !perPoint) && !(everyPointOwnColour && !perPoint) },
    { group: "Data points", key: "color", label: "Palette", kind: "swatches", default: effective, swatches: SWATCHES, show: () => !(kind === "volcano" && !perPoint) && !(everyPointOwnColour && !perPoint) },
    // The same link switch as in the Line section — keeps the line colour tied to the
    // point colour (default) or lets them diverge. Only meaningful when a line is drawn.
    // Only meaningful where points are joined by a connecting line whose colour can
    // track the point colour (xy / area / before-after). Lollipops, bars, boxes, etc.
    // have no connecting line, so the checkbox would do nothing there — hide it.
    { group: "Data points", key: "linkLineColor", label: "Match line colour", kind: "checkbox", default: true, show: () => kind === "xy" || kind === "area" || kind === "beforeafter" },
    // Note: on a bar or histogram this writes `symbolBorderWidth`, not `borderWidth`. Everywhere
    // else the marker is the series and `borderWidth` is its outline; on a bar that same field
    // is the bar's contour width, so writing it here would make this control and "Contour width"
    // under Fill two names for one number — thickening a bar's outline would thicken every dot on it.
    // A histogram draws both bars and markers and gets both groups, so it needs the same split:
    // `symbolBorderWidth` moves its markers' outline independently. Hence `barLike`.
    { group: "Data points", key: barLike ? "symbolBorderWidth" : "borderWidth", label: "Outline width", kind: "number", default: 1.5, min: 0, max: 10, step: 0.25 },
    // Volcano forces a var(--bg) outline on its solid zone markers, so the whole-series
    // Outline colour is dead there — hide it at whole-series scope (per-point still works).
    { group: "Data points", key: "symbolOutline", label: "Outline colour", kind: "color", default: effective, show: (v) => v.symbolFill !== "twotone" && !(kind === "volcano" && !perPoint) },
    { group: "Data points", key: "symbolOutline", label: "Outline palette", kind: "swatches", default: effective, swatches: SWATCHES, show: (v) => v.symbolFill !== "twotone" && !(kind === "volcano" && !perPoint) },
    ...axisField,
    ...dataDrivenFields,
  ];
  const lineFields: Field[] = [
    { group: "Line", key: "connect", label: "Connect", kind: "select", default: "straight", options: CONNECTS },
    { group: "Line", key: "lineTension", label: "Smoothness", kind: "range", default: 0.5, min: 0, max: 1, step: 0.05, show: (v) => v.connect === "cardinal" },
    { group: "Line", key: "lineWidth", label: "Thickness", kind: "number", default: 2, min: 0.25, max: 12, step: 0.25 },
    { group: "Line", key: "lineDash", label: "Pattern", kind: "select", default: "solid", options: DASHES },
  ];
  // Fill + contour (bar / box / violin / raincloud). Box/violin/raincloud default to a light fill; bars to a solid one.
  const lightFill = kind === "box" || kind === "violin" || kind === "raincloud";
  const isPattern = (v: Record<string, unknown>) => v.fillType === "pattern";
  /**
   * The series' base colour — distinct from the Fill row, which writes `fillColor`.
   *
   * `color` is what the legend swatch, the default fill and the derived two-tone shades come
   * from, and every fill-based kind honours it: box, floatingbar, histogram, pyramid and violin
   * all move when it changes, as does raincloud. One definition of the two rows serves all six.
   */
  const baseColourFields: Field[] = [
    { group: "Colour", key: "color", label: "Colour", kind: "color", default: effective },
    { group: "Colour", key: "color", label: "Palette", kind: "swatches", default: effective, swatches: SWATCHES },
  ];
  const fillFields: Field[] = [
    { group: "Fill", key: "fillType", label: "Style", kind: "select", default: "solid", options: FILL_TYPES },
    // base colour drives solid / pattern background-relative / gradient start; metallic ignores it
    { group: "Fill", key: "fillColor", label: "Fill", kind: "color", default: effective, show: (v) => v.fillType !== "metallic" && v.fillType !== "special" },
    { group: "Fill", key: "fillOpacity", label: "Opacity", kind: "range", default: lightFill ? 0.18 : 0.9, min: 0, max: 1, step: 0.05 },
    // palette directly under the opacity slider (the logical spot)
    { group: "Fill", key: "fillColor", label: "Palette", kind: "swatches", default: effective, swatches: SWATCHES, show: (v) => v.fillType !== "metallic" && v.fillType !== "special" && v.fillType !== "graduated" },
    // Two-tone derives the fill + contour from the Fill colour above; the sliders set how
    // far the fill lightens and the edge darkens. The Contour pickers are hidden (derived).
    { group: "Fill", key: "twoToneTint", label: "Fill lightness", kind: "range", default: 0.7, min: 0, max: 0.95, step: 0.05, show: (v) => v.fillType === "twotone" },
    { group: "Fill", key: "twoToneShade", label: "Edge darkness", kind: "range", default: 0.35, min: 0, max: 0.9, step: 0.05, show: (v) => v.fillType === "twotone" },
    { group: "Fill", key: "pattern", label: "Pattern", kind: "select", default: "hatch", options: PATTERNS, show: isPattern },
    { group: "Fill", key: "patternScale", label: "Density", kind: "range", default: 1, min: 0.5, max: 3, step: 0.1, show: isPattern },
    { group: "Fill", key: "patternColor", label: "Ink", kind: "color", default: effective, show: isPattern },
    { group: "Fill", key: "patternBg", label: "Background", kind: "select", default: "none", options: PATTERN_BGS, show: isPattern },
    { group: "Fill", key: "gradientTo", label: "Gradient → to", kind: "color", default: "#ffffff", show: (v) => v.fillType === "gradient" },
    { group: "Fill", key: "gradientAngle", label: "Angle", kind: "range", default: 90, min: 0, max: 360, step: 15, show: (v) => v.fillType === "gradient" },
    { group: "Fill", key: "metallic", label: "Metal", kind: "select", default: "silver", options: METALLICS, show: (v) => v.fillType === "metallic" },
    { group: "Fill", key: "special", label: "Theme", kind: "select", default: "facets", options: SPECIALS, unlistedAsDefault: true, show: (v) => v.fillType === "special" },
    { group: "Fill", key: "gradRamp", label: "Ramp", kind: "select", default: "lightness", options: rampOpts(GRAD_RAMPS), show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradMap", label: "Map by", kind: "select", default: "value", options: GRAD_MAPS, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradReversed", label: "Reverse", kind: "checkbox", default: false, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradTo", label: "High colour", kind: "color", default: "#1a1a1a", show: (v) => v.fillType === "graduated" && v.gradRamp === "twocolor" },
    // The graduated ramp's manual bounds. The builder honours these
    // (`paintGraduated` in buildScene.ts: `style.gradMin ?? min(data)`); the dead-style-field check requires
    // a control for them. Blank = auto, which
    // is why they are `optnumber`: a plain number field cannot express "unset".
    { group: "Fill", key: "gradMin", label: "Scale min", kind: "optnumber", default: undefined, step: 0.5, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradMax", label: "Scale max", kind: "optnumber", default: undefined, step: 0.5, show: (v) => v.fillType === "graduated" },
    // The colour-SHAPING knobs (RampShapeRows renders the same four for the chart-wide ramps).
    { group: "Fill", key: "gradMidpoint", label: "Centre at", kind: "optnumber", default: undefined, step: 0.5, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradGamma", label: "Detail bias", kind: "optnumber", default: undefined, step: 0.1, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradSteps", label: "Colour steps", kind: "optnumber", default: undefined, step: 1, show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "gradSpace", label: "Blend", kind: "select", default: "rgb", options: [["rgb", "Straight (RGB)"], ["hsl", "Vivid (HSL)"], ["lab", "Perceptual (Lab)"]], show: (v) => v.fillType === "graduated" },
    { group: "Fill", key: "borderColor", label: "Contour", kind: "color", default: s.fillColor ?? effective, show: (v) => v.fillType !== "twotone" },
    { group: "Fill", key: "borderColor", label: "Contour palette", kind: "swatches", default: s.fillColor ?? effective, swatches: SWATCHES, show: (v) => v.fillType !== "twotone" },
    { group: "Fill", key: "borderWidth", label: "Contour width", kind: "number", default: 1.5, min: 0, max: 10, step: 0.25 },
  ];
  // Width slider: box width, violin silhouette width, or scatter swarm spread.
  const boxFields: Field[] = [
    { group: "Width", key: "boxWidth", label: "Width", kind: "range", default: 0.5, min: 0.1, max: 0.9, step: 0.05 },
  ];
  // Floating bar's defining feature: the centre line (mean/median). The renderer reads
  // series.medianColor/medianWidth; the box fill/contour/opacity come from fillFields.
  const centreLineFields: Field[] = [
    { group: "Centre line", key: "medianColor", label: "Colour", kind: "color", default: s.borderColor ?? effective },
    { group: "Centre line", key: "medianWidth", label: "Thickness", kind: "number", default: (s.borderWidth ?? 1.5) + 0.8, min: 0, max: 12, step: 0.25 },
  ];
  // Violin-only: silhouette smoothness (KDE bandwidth) + the inner quartile box.
  const showInnerBox = (v: Record<string, unknown>) => v.violinShowBox !== false;
  const violinFields: Field[] = [
    { group: "Silhouette", key: "violinBandwidth", label: "Smoothness", kind: "range", default: 1, min: 0.4, max: 3, step: 0.1 },
    { group: "Inner box", key: "violinShowBox", label: "Show", kind: "checkbox", default: true },
    { group: "Inner box", key: "violinBoxWidth", label: "Box width", kind: "range", default: 0.34, min: 0.1, max: 1, step: 0.02, show: showInnerBox },
    // The inner box fill + its width's "contour" follow the Fill group's Contour colour / width above.
  ];
  // Box-only: whiskers (the "error bars"), median line, outlier dots — all tunable.
  const showOut = (v: Record<string, unknown>) => v.showOutliers !== false;
  const boxWhiskerFields: Field[] = [
    { group: "Whiskers", key: "whiskerSides", label: "Show", kind: "select", default: "both", options: WHISKER_SIDES },
    { group: "Whiskers", key: "whiskerColor", label: "Colour", kind: "color", default: s.borderColor ?? effective },
    { group: "Whiskers", key: "whiskerWidth", label: "Thickness", kind: "number", default: s.borderWidth ?? 1.5, min: 0, max: 10, step: 0.25 },
    { group: "Whiskers", key: "whiskerCaps", label: "End caps", kind: "checkbox", default: true },
    { group: "Whiskers", key: "whiskerCapWidth", label: "Cap width", kind: "range", default: 0.28, min: 0, max: 0.5, step: 0.02, show: (v) => v.whiskerCaps !== false },
    { group: "Median", key: "medianColor", label: "Colour", kind: "color", default: s.borderColor ?? effective },
    { group: "Median", key: "medianWidth", label: "Thickness", kind: "number", default: (s.borderWidth ?? 1.5) + 0.8, min: 0, max: 12, step: 0.25 },
    // Not on a floating bar (its box is a range, not quartiles) nor with mean-centred whiskers (the box shows the mean):
    // there is no median box to notch — the builder refuses and says so. Hidden with a violin's inner box, which it notches.
    ...(kind !== "floatingbar" && plot.boxWhisker !== "sd" && plot.boxWhisker !== "sem" && plot.boxWhisker !== "ci95"
      ? [{
          group: "Median", key: "boxNotch", label: "Notch", kind: "checkbox" as const, default: false,
          hint: "Approximate 95% CI of the median (McGill): median ± 1.58·IQR/√n. Where two groups' notches do not overlap, their medians likely differ.",
          show: (v: Record<string, unknown>) => v.violinShowBox !== false,
        }]
      : []),
    { group: "Outliers", key: "showOutliers", label: "Show points", kind: "checkbox", default: true },
    { group: "Outliers", key: "outlierSize", label: "Size", kind: "number", default: 2.4, min: 0, max: 10, step: 0.5, show: showOut },
  ];
  // Column scatter draws a centre line + error caps over the swarm; colour + thickness are
  // editable (the cap span follows the swarm width). Default colour == the contour. The
  // centre + spread (mean/median with SD/SEM/CI/IQR/range) is the plot-level "Summary"
  // dropdown (one coherent pair, no invalid median±SD) — these fields only style the overlay.
  const scatterMeanFields: Field[] = [
    { group: "Centre & error", key: "errorColor", label: "Colour", kind: "color", default: s.borderColor ?? effective },
    { group: "Centre & error", key: "errorColor", label: "Palette", kind: "swatches", default: s.borderColor ?? effective, swatches: SWATCHES },
    { group: "Centre & error", key: "errorWidth", label: "Thickness", kind: "number", default: 1.5, min: 0.5, max: 8, step: 0.25 },
    // The SD caps' width, alongside their colour and thickness; the drawing honours it
    // (on histogram and ridgeline
    // the same field only resizes the invisible clip margin, so they get no control).
    { group: "Centre & error", key: "errorCapWidth", label: "Cap width", kind: "number", default: 4, min: 0, max: 16, step: 0.5 },
  ];
  // Raincloud = cloud (half-violin) + inner box + rain (swarm points), all from one
  // series style. Expose every part: base colour, silhouette/box fill + contour, width,
  // KDE smoothness + inner-box, whisker/median/outlier styling, and the rain markers.
  const raincloudFields: Field[] = [
    ...baseColourFields,
    ...fillFields,
    ...boxFields,
    ...violinFields,
    ...boxWhiskerFields,
    // In the Whiskers group, not a group of its own. A raincloud's error bars are its whiskers,
    // and `Inspector.editability.test.tsx` forbids an "Error bars" heading here on purpose — that
    // heading is the tell that the panel fell back to the borrowed xy marker editor. It also has
    // to sit adjacent to the other Whiskers rows or SchemaForm emits the heading twice.
    { group: "Whiskers", key: "errorColor", label: "Error-bar colour", kind: "color", default: effective },
    // Rain points are treated like data points, size and colour included: without their own
    // colour they would inherit the series colour, which is the violin body right beside them.
    { group: "Rain points", key: "pointColor", label: "Colour", kind: "color", default: effective },
    { group: "Rain points", key: "symbol", label: "Shape", kind: "select", default: "circle", options: SHAPES },
    { group: "Rain points", key: "symbolSize", label: "Size", kind: "number", default: 4, min: 1, max: 24, step: 0.5 },
    { group: "Rain points", key: "symbolOpacity", label: "Opacity", kind: "range", default: 1, min: 0, max: 1, step: 0.05 },
    // The rain's fill mode: the builder honours it on every rain point.
    { group: "Rain points", key: "symbolFill", label: "Marker fill", kind: "select", default: fillDefault, options: SYMBOL_FILLS },
  ];
  const showErr = (v: Record<string, unknown>) => v.errorBars !== "none";
  /** An error ribbon needs a curve to follow — XY and area draw one; a volcano/bubble cloud
   *  does not. Matches `bandKinds` in the builder; the drawing refuses elsewhere and warns. */
  const bandKind = kind === "xy" || kind === "area" || kind === undefined;
  // Forest CI whiskers are drawn unconditionally from the lower/upper columns, so the
  // Type dropdown (none/SD/SEM/CI) is decorative there — hide it — while the whisker
  // Direction/Caps/Colour/Width controls stay reachable even though Type reads "none".
  /**
   * …and the Difference's whisker is always drawn, so its colour/thickness/cap width must
   * always be reachable. Gating them on `errorBars !== "none"` alone would hide them, because
   * `errDefault` resolves to "none" for a synthetic series that is not a table dataset — the
   * panel would offer the one dead row (Type) and hide the three live ones. Same reason forest is here.
   */
  const showErrX = (v: Record<string, unknown>) => showErr(v) || kind === "forest" || isEstimationDiff;
  /**
   * The Difference's whisker is a bootstrap CI, not a replicate summary.
   *
   * On `est-diff`, `errorBars` / `errorDir` / `errorCaps` move nothing —
   * `buildEstimationScene` computes the interval from the resampled distribution and hard-codes
   * both-ways with caps. "Mean ± SEM" on a bootstrap CI would be misleading even if it worked. The
   * three rows that do work there (colour, thickness, cap width) stay. Same shape as the forest
   * summary's Type row, which is hidden for the same reason one line above.
   */
  const errorShape = (v: Record<string, unknown>) => showErrX(v) && !isEstimationDiff;
  /**
   * Gate the Type menu to the intervals this dataset's stored columns can actually draw — never
   * offer "95% CI" when only SD, no N, was entered (it would draw a blank).
   *
   * Applies to every entry mode, not only summary-entered datasets: a plain one-value-per-row
   * Y column is neither summary-entered nor replicate-bearing, and without the gate it would be
   * offered all six interval types (SD / SEM / 95% CI / Range / Geometric SD / IQR), none of
   * which draws anything. `drawableErrorTypes` answers the question for every entry mode (it
   * returns all six for ≥2 replicates), so replicate data keeps every choice and a column
   * with nothing to draw offers none.
   *
   * A saved-but-undrawable current value stays listed so the control never goes blank; the
   * builder warns for it too.
   */
  /** What this dataset's own columns declare. Empty = nothing to draw — or a chart that pools
   *  the raw rows, which only the drawing can tell (`errorBarsReachDrawing`). */
  const declaredErrorTypes = ds ? drawableErrorTypes(ds) : [];
  const pooledErrorBars = declaredErrorTypes.length === 0 && errorBarsReachDrawing(table, plot, colId);
  const errorTypeOptions: ReadonlyArray<[string, string]> = (() => {
    if (!ds || pooledErrorBars) return ERROR_TYPES;
    const labelled = new Map<string, string>([...ERROR_TYPES, ["asymmetric", "As entered (± / limits)"]]);
    const allowed = new Set<string>(["none", ...declaredErrorTypes]);
    const order = [...ERROR_TYPES.map(([v]) => v), "asymmetric"];
    const opts = order.filter((v) => allowed.has(v)).map((v) => [v, labelled.get(v) ?? v] as [string, string]);
    const cur = s.errorBars;
    if (cur && !opts.some(([v]) => v === cur)) opts.push([cur, `${labelled.get(cur) ?? cur} (needs more data)`]);
    return opts;
  })();
  /**
   * The section refuses rather than vanishing — and it never offers what it cannot deliver.
   *
   * When this dataset can draw no interval at all, the rows go and the sentence says what the
   * data would have to carry. Not applied to forest or the estimation Difference: their whiskers
   * are drawn unconditionally from stored columns / a bootstrap CI, so the colour, thickness and
   * cap-width rows there are live even while Type reads "none" (see `showErrX`).
   */
  const errorRefusal: string | undefined =
    kind !== "forest" && !isForestSummary && !isEstimationDiff
      && declaredErrorTypes.length === 0 && !pooledErrorBars
      && !(s.errorBars && s.errorBars !== "none")
      ? "This series has no error bar to style — the chart draws none for it. Error bars need replicates (a grouped datasheet) or an entered SD / SEM / CI with N."
      : undefined;
  const errorFields: Field[] = [
    { group: "Error bars", key: "errorBars", label: "Type", kind: "select", default: errDefault, options: errorTypeOptions, show: () => kind !== "forest" && !isEstimationDiff },
    { group: "Error bars", key: "errorDir", label: "Direction", kind: "select", default: "both", options: ERROR_DIRS, show: errorShape },
    { group: "Error bars", key: "errorCaps", label: "Caps", kind: "checkbox", default: true, show: errorShape },
    { group: "Error bars", key: "errorColor", label: "Colour", kind: "color", default: effective, show: showErrX },
    { group: "Error bars", key: "errorColor", label: "Palette", kind: "swatches", default: effective, swatches: SWATCHES, show: showErrX },
    { group: "Error bars", key: "errorWidth", label: "Thickness", kind: "number", default: 1.5, min: 0.5, max: 8, step: 0.25, show: showErrX },
    { group: "Error bars", key: "errorCapWidth", label: "Cap width", kind: "number", default: 4, min: 0, max: 16, step: 0.5, show: showErrX },
    /*
     * The interval as a ribbon: the error / SEM drawn as a shaded band around the curve.
     *
     * Note: presentation only — the numbers are whatever `Type` above says, so switching to a
     * band cannot change what the graph claims. And it is gated on the two kinds that draw a
     * curve for it to follow: on a volcano or a bubble cloud there is no left-to-right order,
     * so a ribbon between the error reaches would be a shape with no meaning.
     */
    { group: "Error bars", key: "errorDisplay", label: "Show as", kind: "select", default: "bars", options: ERROR_DISPLAYS, show: (v) => showErr(v) && bandKind },
    { group: "Error bars", key: "bandColor", label: "Band colour", kind: "color", default: effective, show: (v) => showErr(v) && bandKind && v.errorDisplay !== undefined && v.errorDisplay !== "bars" },
    { group: "Error bars", key: "bandOpacity", label: "Band opacity", kind: "range", default: 0.18, min: 0, max: 1, step: 0.02, show: (v) => showErr(v) && bandKind && v.errorDisplay !== undefined && v.errorDisplay !== "bars" },
    { group: "Error bars", key: "bandEdgeWidth", label: "Band edge", kind: "number", default: 0, min: 0, max: 8, step: 0.25, show: (v) => showErr(v) && bandKind && v.errorDisplay !== undefined && v.errorDisplay !== "bars" },
    { group: "Error bars", key: "bandEdgeColor", label: "Edge colour", kind: "color", default: effective, show: (v) => showErr(v) && bandKind && v.errorDisplay !== undefined && v.errorDisplay !== "bars" && !!v.bandEdgeWidth },
    { group: "Error bars", key: "bandEdgeDash", label: "Edge dashes", kind: "select", default: "solid", options: DASHES, show: (v) => showErr(v) && bandKind && v.errorDisplay !== undefined && v.errorDisplay !== "bars" && !!v.bandEdgeWidth },
  ];
  // Line colour + the link toggle (the same `linkLineColor` switch lives in both the
  // Line and Data-points sections). Linked (default) → the line colour follows the
  // data-point/series colour, so the colour picker edits `color` (moving both); unlinked
  // → the line gets its own `lineColor`. Renders in the "Line" group, under the controls.
  const colourLinked = s.linkLineColor !== false;
  const lineColorKey = colourLinked ? "color" : "lineColor";
  const lineColorDefault = colourLinked ? effective : (s.lineColor ?? effective);
  const colourFields: Field[] = [
    { group: "Line", key: lineColorKey, label: "Colour", kind: "color", default: lineColorDefault },
    { group: "Line", key: lineColorKey, label: "Palette", kind: "swatches", default: lineColorDefault, swatches: SWATCHES },
    { group: "Line", key: "linkLineColor", label: "Match data-point colour", kind: "checkbox", default: true },
  ];
  // Area-fill controls (the filled region under the line): colour · opacity · the
  // full fill suite (solid / two-tone / pattern / gradient — all render via fillSpec).
  const areaFillFields: Field[] = [
    // `metallic` and `special` are in this select because the builder honours both on area
    // and ridgeline: with `fillType` set, swapping either the metal or the special theme changes
    // the drawing. Their own rows below appear only when the Style select offers the mode.
    { group: "Area fill", key: "fillType", label: "Style", kind: "select", default: "solid", options: [["solid", "Solid"], ["twotone", "Two-tone"], ["pattern", "Pattern"], ["gradient", "Gradient"], ["metallic", "Metallic"], ["special", "Special"]] },
    { group: "Area fill", key: "fillColor", label: "Fill", kind: "color", default: effective },
    // The rendered default fill opacity is 0.85 for a stacked/percent area and 0.22 when
    // overlaid (buildScene seriesExtras), so the unset slider must reflect that.
    { group: "Area fill", key: "fillOpacity", label: "Opacity", kind: "range", default: kind === "area" && (plot.areaStack ?? "none") !== "none" ? 0.85 : 0.22, min: 0, max: 1, step: 0.05 },
    { group: "Area fill", key: "twoToneTint", label: "Fill lightness", kind: "range", default: 0.7, min: 0, max: 0.95, step: 0.05, show: (v) => v.fillType === "twotone" },
    { group: "Area fill", key: "pattern", label: "Pattern", kind: "select", default: "hatch", options: PATTERNS, show: (v) => v.fillType === "pattern" },
    { group: "Area fill", key: "patternScale", label: "Density", kind: "range", default: 1, min: 0.5, max: 3, step: 0.1, show: (v) => v.fillType === "pattern" },
    { group: "Area fill", key: "patternColor", label: "Ink", kind: "color", default: effective, show: (v) => v.fillType === "pattern" },
    { group: "Area fill", key: "patternBg", label: "Background", kind: "select", default: "none", options: PATTERN_BGS, show: (v) => v.fillType === "pattern" },
    { group: "Area fill", key: "gradientTo", label: "Gradient → to", kind: "color", default: "#ffffff", show: (v) => v.fillType === "gradient" },
    { group: "Area fill", key: "gradientAngle", label: "Angle", kind: "range", default: 90, min: 0, max: 360, step: 15, show: (v) => v.fillType === "gradient" },
    { group: "Area fill", key: "metallic", label: "Metal", kind: "select", default: "silver", options: METALLICS, show: (v) => v.fillType === "metallic" },
    { group: "Area fill", key: "special", label: "Theme", kind: "select", default: "facets", options: SPECIALS, unlistedAsDefault: true, show: (v) => v.fillType === "special" },
  ];
  const isArea = kind === "area";
  // Radar polygon: outline (line colour/width) + fill colour + fill transparency.
  //
  // No per-series vertex-dot colour, and no per-series dot size — both would be misleading
  // controls, given how the builder draws radar dots:
  //  • Size is plot-wide. `radar.dotSize` (the Radar section's own "Dot size") wins, and under it
  //    `plotMarkerDefault` takes the first series that names a `symbolSize` and applies it to the
  //    whole chart — so a per-series box does nothing once any other series has set one.
  //  • The dot's colours come from `resolveSymbol`, whose two-tone branch — the house default —
  //    discards an explicit `symbolFillColor` and derives the fill/edge from the series hue. So a
  //    "Dot fill" swatch would do nothing under the default look, and the mode that would make it
  //    take effect ("open") cannot be offered either: radar's scene carries no `filled` flag, so an
  //    "Open (hollow)" vertex renders identically to a solid one.
  // Per-vertex styling on radar is a matter for the builder's vertex model, not for a control.
  const radarFields: Field[] = [
    { group: "Outline", key: "color", label: "Line colour", kind: "color", default: effective },
    { group: "Outline", key: "color", label: "Palette", kind: "swatches", default: effective, swatches: SWATCHES },
    { group: "Outline", key: "lineWidth", label: "Line width", kind: "number", default: 2, min: 0, max: 10, step: 0.5 },
    { group: "Fill", key: "fillColor", label: "Fill", kind: "color", default: effective },
    { group: "Fill", key: "fillOpacity", label: "Transparency", kind: "range", default: 0.18, min: 0, max: 1, step: 0.05 },
    { group: "Colour", key: "color", label: "Swatch", kind: "swatches", default: effective, swatches: SWATCHES },
    // Fill controls for the vertex markers: symbolFill, twoToneTint and twoToneShade each move
    // a radar's drawing.
    // `symbolSize` is deliberately not here. With `radar.dotSize` already set, it
    // changes nothing: the plot-wide dot size wins, so a per-series row would do nothing.
    { group: "Vertices", key: "symbolFill", label: "Marker fill", kind: "select", default: fillDefault, options: SYMBOL_FILLS },
    { group: "Vertices", key: "twoToneTint", label: "Fill lightness", kind: "range", default: 0.7, min: 0, max: 0.95, step: 0.05, show: (v) => v.symbolFill === "twotone" },
    { group: "Vertices", key: "twoToneShade", label: "Edge darkness", kind: "range", default: 0.35, min: 0, max: 0.9, step: 0.05, show: (v) => v.symbolFill === "twotone" },
  ];
  // Context-scoped panel: clicking a point/bar shows its design + the data source;
  // clicking the connecting curve shows the line options (+ area fill on area charts).
  const part = selection.part;
  // Fill-based charts (bar/box/violin) use the explicit Fill + Contour colours —
  // not the generic series-colour swatch (which would change both at once + confuse).
  // Colour first (the most-used control), then symbols/error bars — so the working
  // colour picker is never buried below error bars.
  // Composite (bars + line): let a bar-chart series render as a line over the bars.
  // Only for vertical bars — the horizontal-bar builder draws neither the line overlay
  // nor a secondary (X2) value axis, so these controls would be dead there.
  // Points / Area (composite graphs) are refused by the builder on stacked/percent layouts (a
  // segment has no value of its own to place), so the select does not offer them there.
  const stackedLayout = plot.barLayout === "stacked" || plot.barLayout === "percent";
  const renderAsOptions: [string, string][] = [
    ["bars", "Bars"],
    ["line", "Line (over bars)"],
    ...(stackedLayout ? [] : ([["points", "Points"], ["area", "Area"]] as [string, string][])),
  ];
  const renderAsField: Field = { group: "Plot as", key: "plotAs", label: "Render as", kind: "select", default: "bars", options: renderAsOptions };
  // The histogram honours only Bars / Line (its bins carry no swarm, and an area under bin
  // tops is not a histogram) — a two-option select.
  const histogramRenderAsField: Field = { ...renderAsField, options: [["bars", "Bars"], ["line", "Line (over bars)"]] };
  // XY "Render as": the coarse choice — beats Connect / Shape. Absent = auto
  // (markers + a connecting line). Area = this series filled down to the baseline.
  const xyRenderAsFields: Field[] = kind === "xy"
    ? [{ group: "Plot as", key: "plotAs", label: "Render as", kind: "select", default: "auto", options: [["auto", "Auto (markers + line)"], ["line", "Line only"], ["points", "Points only"], ["area", "Area"]] }]
    : [];
  // "Render as" works in both orientations (the horizontal builder draws the
  // transposed line / points / area). "Value axis" stays vertical-only: the horizontal builder
  // draws no second value axis, and it says so in a warning if a saved style asks.
  const plotAsFields: Field[] = [
    renderAsField,
    // A horizontal bar's second axis runs along the top — its values run left
    // to right — so the row reads Bottom / Top there, Left / Right on a vertical bar.
    { group: "Plot as", key: "axis", label: "Value axis", kind: "select", default: "y",
      options: isTransposedPlot(plot) ? [["y", "Bottom"], ["y2", "Top (2nd axis)"]] : [["y", "Left"], ["y2", "Right (2nd axis)"]] } as Field,
  ];
  // A histogram is drawn as bars and honours `plotAs:"line"` too: the overlay line
  // replaces the bins' rects, exactly as on a bar chart.
  // Only the "Render as" row comes across. The "Value axis" row does not: a histogram draws
  // no second value axis, so `axis:"y2"` there rescales the bins against an axis nobody sees.
  // The horizontal builder draws the line overlay too, so the histogram's "Render as" needs no
  // orientation gate (composite-horizontal.test proves both orientations).
  const histogramPlotAsFields: Field[] = [histogramRenderAsField];
  // Kinds whose builders emit no error-bar geometry (their marks carry no errLow/errHigh):
  // paireddot/ROC/Bland-Altman/scatter3d/ridgeline/parallel/floatingbar. Showing the Error-bars
  // group there is a dead, misleading control — gate it off. (Lollipop is not here: it draws
  // an opt-in mean±error whisker on the dot — default "none", see errDefault above.)
  const noErrorBars =
    kind === "paireddot" || kind === "roc" || kind === "blandaltman" || kind === "scatter3d" || kind === "ridgeline" || kind === "floatingbar" || kind === "parallel"
    // The pooled summary's interval is its shape (the diamond spans the CI, the marker form
    // draws it as a whisker). An Error-bars group here would style geometry it does not own.
    || isForestSummary;
  /**
   * The summary's own panel. Same vocabulary as a data point — colour, fill, opacity, outline,
   * size — under a heading that says whose it is, plus the two rows only it has.
   *
   * Clicking the summary shape opens a clearly labelled panel of its own with every option a
   * data point has. A tick box, on by default, links the summary's style to the data points';
   * unticked, the summary is tuned on its own.
   *
   * While the link is on every appearance row is hidden, not merely ignored. Leaving them
   * visible would be a panel full of controls that change nothing.
   */
  /** Note: every "spans the CI" entry really does reach both ends — the label is a promise about
   *  the geometry, and a summary that stopped spanning would stop reporting the interval. */
  const SUMMARY_SHAPES: ReadonlyArray<[string, string]> = [
    ["diamond", "Diamond (spans the CI)"],
    ["bar", "Bar (spans the CI)"],
    ["roundbar", "Rounded bar (spans the CI)"],
    ["lens", "Lens (spans the CI)"],
    ["bowtie", "Bowtie (spans the CI)"],
    ["ellipse", "Ellipse (spans the CI)"],
    ["marker", "Marker + whisker"],
  ];
  const summaryFields: Field[] = isForestSummary
    ? [
        { group: "Summary series", key: "summaryShape", label: "Summary shape", kind: "select", default: "diamond", options: SUMMARY_SHAPES },
        { group: "Summary series", key: "linkSummaryToStudies", label: "Match the studies", kind: "checkbox", default: summaryLinkDefault },
      ]
    : [];
  /** Re-home a data-point row onto the summary panel, and hide it while the link is on. */
  const asSummaryField = (f: Field): Field => ({
    ...f,
    group: "Summary series",
    show: (v) => {
      // Shape is exempt from the link. The link carries colours; the glyph is form, and the
      // builder reads it from the summary's own style whether linked or not. Hiding it here
      // would make "Marker + whisker" half-reachable: the form could be picked but the glyph
      // could not be chosen without also unlinking. The test covers the linked case for this reason.
      if (f.key === "symbol") return (v.summaryShape ?? "diamond") === "marker";
      if (summaryLinked) return false;
      return f.show ? f.show(v) : true;
    },
  });
  const pointFields: Field[] =
    isForestSummary
      ? [...summaryFields, ...symbolFields.map(asSummaryField)]
      : isEstimationDiff
      ? // The marker (the effect size) + its CI whisker + the bootstrap distribution behind it.
        // `fillColor` / `fillOpacity` drive that half-violin and `seriesExtras` honours them,
        // so the distribution can differ from the point estimate's colour.
        // Note: `errorFields` is in the list. Without it (`[...symbolFields, ...fillFields]`)
        // the whisker's colour/thickness/cap width would be lost. Its dead rows (Type/Direction/
        // Caps) are gated off individually above, which hides a row without losing the group.
        [...symbolFields, ...errorFields, ...fillFields]
      : kind === "radar"
      ? radarFields
      : kind === "box"
      ? [...baseColourFields, ...fillFields, ...boxFields, ...boxWhiskerFields, ...axisField]
      : kind === "floatingbar"
      ? // A min→max bar with a centre line — box Fill/Contour/Opacity + Width + centre line.
        // Not the xy marker/error fields (the box has no markers/whiskers).
        [...baseColourFields, ...fillFields, ...boxFields, ...boxWhiskerFields, ...centreLineFields]
      : kind === "violin"
      ? [...baseColourFields, ...fillFields, ...boxFields, ...boxWhiskerFields, ...violinFields, ...axisField]
      : kind === "raincloud"
      ? raincloudFields
      : kind === "scatter"
        ? [...symbolFields, ...scatterMeanFields]
        : kind === "bar"
          ? // With "Show all points" on, a bar carries a real point swarm — so the marker
            // controls (shape / size / fill / opacity / colour) must be reachable, exactly as
            // on any other point kind. Hidden again when the overlay is off, where they would
            // style nothing.
            // Note: `?? true` — the overlay is on by default, so the marker controls must be
            // present by default too. Plain truthiness would leave every bar chart showing
            // points with no way to style them.
            // A `plotAs:"points"` series is its markers, so it keeps the marker controls even
            // with the chart-wide overlay off.
            // A series drawn as points draws no bar, so the bar Fill group would style nothing.
            [...plotAsFields, ...(pointsOnly ? [] : fillFields), ...errorFields, ...((plot.showBarPoints ?? true) || s.plotAs === "points" ? symbolFields : [])]
          : kind === "histogram"
          ? // A histogram draws individual data markers as well as its bars: symbol, symbolSize,
            // symbolOpacity, symbolFill and symbolBorderWidth all change the drawing here.
            // (symbolFillColor / symbolOutline only apply to a hollow marker — a prerequisite,
            // not a dead control, and `symbolFields` already gates them on `symbolFill`.)
            [...histogramPlotAsFields, ...baseColourFields, ...fillFields, ...symbolFields]
          : kind === "pyramid"
          ? // A population pyramid draws back-to-back bars and no markers at all, so it must not
            // fall through to the "other point kinds" default and get `symbolFields`: shape,
            // size, opacity, fill, fill colour, outline and border width are all dead on this
            // kind, while fillColor / fillOpacity / fillType / borderWidth / color all move the
            // drawing.
            [...baseColourFields, ...fillFields, ...(noErrorBars ? [] : errorFields)]
          : kind === "beforeafter"
          ? // A paired/before-after trajectory = markers + a connector; each subject is
            // its own series (click a line to edit just that subject). No error bars.
            [...symbolFields, ...lineFields, ...colourFields]
          : isArea
            ? [...symbolFields, ...areaFillFields, ...errorFields]
            : kind === "xy"
              ? // xy = markers + a connecting line. Expose the Line controls in the point
                // editor too, so Connect (incl. "None") stays reachable: with Connect="None"
                // there is no line to click, so the line panel would otherwise be unreachable.
                // "Render as" is the coarse choice: a points series has no line
                // to style and a line series no markers, so those groups are hidden rather
                // than left dead; an area series gains the fill group.
                s.plotAs === "points"
                  ? [...xyRenderAsFields, ...symbolFields, ...errorFields]
                  : s.plotAs === "line"
                    ? [...xyRenderAsFields, ...lineFields, ...colourFields, ...errorFields]
                    : [...xyRenderAsFields, ...symbolFields, ...lineFields, ...(s.plotAs === "area" ? areaFillFields : []), ...errorFields]
              : NO_MARKER_KINDS[kind]
                ? // This kind draws no point markers, so the marker rows would style
                  // nothing. Colour stays; the note says where the rest lives.
                  [...baseColourFields]
                : [...symbolFields, ...(noErrorBars ? [] : errorFields)]; // other point kinds

  // Clicking the curve shows the line options + (area fill) + error bars, so the
  // error-bar controls are reachable whether you click a point or the connecting line.
  // Leader lines: wherever this series can draw one — its name, with the legend replaced by direct
  // labels, or its value labels — and in its line panel, which is what a click on a leader opens.
  const leaderFields: Field[] =
    (DIRECT_LABEL_KINDS.has(kind) && plot.legend?.position === "direct") || (s.pointLabels !== undefined && s.pointLabels !== "none")
      ? [
          { group: "Leader line", key: "leaderShow", label: "Show", kind: "checkbox", default: true,
            hint: "The thin line from a name or value label back to its point, drawn when the label sits away from it." },
          { group: "Leader line", key: "leaderColor", label: "Colour", kind: "color", default: effective, show: (v) => v.leaderShow !== false },
          { group: "Leader line", key: "leaderWidth", label: "Width", kind: "number", default: 0.75, min: 0.25, max: 6, step: 0.25, show: (v) => v.leaderShow !== false },
        ]
      : [];
  const fields: Field[] =
    part === "line"
      ? [...xyRenderAsFields, ...lineFields, ...colourFields, ...(isArea || kind === "ridgeline" || (kind === "xy" && s.plotAs === "area") ? areaFillFields : []), ...(kind === "beforeafter" || noErrorBars ? [] : errorFields), ...axisField, ...leaderFields]
      : [...pointFields, ...leaderFields];

  return (
    <>
      {/* One row per series: show/hide + colour + name; click a name to edit that series.
          Bubble lists only the position series — the 2nd Y is the size encoding, not a series. */}
      <SeriesVisibilityList datasets={kind === "bubble" ? datasets.slice(0, 1) : datasets} plot={plot} onSetSeriesStyle={onSetSeriesStyle} foreign={foreignSeries} selectedId={colId} onSelect={onSelect} noHide={kind === "forest" || kind === "funnel" || kind === "ternary" || kind === "qq" || kind === "manhattan" || kind === "sunburst" || kind === "chord" || kind === "oncoprint" ? true : kind === "swimmer" ? swimmerNoHide(table) : false} />
      {/* Scope of a style edit: whole graph (every series) ▸ whole series ▸ single point.
          Note: radar gets the whole-graph row only. Fanning a style to every polygon changes the
          drawing, so that row is offered — but radar reads no `pointStyles` for
          its vertices (the one lookup in `buildRadarScene` is a spoke label drag offset), so the
          whole-series row, whose off state means "just the point you clicked", has nothing to
          govern there. */}
      {/* The summary says what it is, so its panel cannot be mistaken for a study's. */}
      {isForestSummary && (
        <div className="insphd" style={{ fontSize: 11, marginTop: 6 }} data-summary-head>
          Summary series — the pooled estimate
        </div>
      )}
      {isForestSummary && (
        <p className="hint" style={{ margin: "2px 0 6px" }}>
          {summaryLinked
            ? "Matching the studies: colour, fill, outline, opacity and size follow the study markers. Untick below to tune this shape on its own."
            : "Tuned on its own — these settings apply to the pooled summary only, not to the studies."}
        </p>
      )}
      {/* The Difference says what it is, for the same reason the summary does — without a
          heading its panel reads as an ordinary data point. */}
      {isEstimationDiff && (
        <div className="insphd" style={{ fontSize: 11, marginTop: 6 }} data-diff-head>
          Difference — the effect size
        </div>
      )}
      {isEstimationDiff && (
        <p className="hint" style={{ margin: "2px 0 6px" }}>
          The mean difference with its bootstrap confidence interval. <strong>Data points</strong>
          {" "}styles the estimate marker and its CI whisker; <strong>Fill</strong> styles the
          bootstrap distribution behind it. Its position is computed from the two groups, so it
          cannot be dragged — change the resamples, seed or CI level in the Chart panel.
        </p>
      )}
      {/* No scope toggles for the summary or the Difference: each is one synthetic series, and
          both toggles enumerate the table's datasets — so "apply to whole graph" here would
          quietly restyle the studies / the raw groups instead of the thing that was clicked
          (on estimation, a colour set on the Difference would give both groups its two-tone tint). */}
      {part !== "line" && !isForestSummary && !isEstimationDiff && (
        <>
          {/* Whole-graph master toggle — restyles every series/group at once.
              Note: `ppoint` marks "a scope row"; the second class identifies which. With only
              `ppoint`, `querySelector(".ppoint")` would silently return this one when a test
              means the series row. Keep the two names distinct. */}
          <div className="frow ppoint ppoint-graph" style={{ marginBottom: 4, alignItems: "flex-start" }}>
            <span>Apply to whole graph</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <input
                type="checkbox"
                checked={wholeGraph.value}
                title="On: every change restyles all series / groups on the graph at once (colours, error bars, widths, fills…). Off: changes target the selected series (or point)."
                onChange={(e) => wholeGraph.set(e.target.checked)}
              />
              {wholeGraph.value && (isBeforeAfter ? table.rows.length > 1 : datasets.length > 1) && (
                <span className="note" style={{ fontSize: 10.5, textAlign: "right", maxWidth: 150 }}>
                  → all {isBeforeAfter ? table.rows.length : datasets.length} {isBeforeAfter ? "subjects" : "series"}
                </span>
              )}
            </span>
          </div>
          {/* Per-point highlighting: on = whole series; off + a selected point = that
              point only. Always shown (greyed out while whole-graph is on) so the user
              can never get trapped — toggling whole-graph off restores it verbatim.
              Hidden for before-after: a "series" is one subject with no per-point split. */}
          {!isBeforeAfter && kind !== "radar" && (
          <div className="frow ppoint ppoint-series" style={{ marginBottom: 4, alignItems: "flex-start", opacity: wholeGraph.value ? 0.45 : 1 }}>
            <span>Apply to whole series</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end" }}>
              <input
                type="checkbox"
                checked={wholeSeries.value}
                disabled={wholeGraph.value}
                title={isViolin
                  ? "On: changes restyle every violin. Off: changes affect only the selected violin."
                  : isRaincloud
                  ? "On: changes restyle every raincloud. Off: colour/fill changes affect only the part you clicked — click the cloud or the inner box to give them different fills."
                  : "On: changes restyle every point. Off: colour/marker changes affect only the point you clicked (highlight)."}
                onChange={(e) => wholeSeries.set(e.target.checked)}
              />
              {wholeGraph.value ? (
                <span className="note" style={{ fontSize: 10.5, textAlign: "right", maxWidth: 150 }}>
                  overridden by whole graph
                </span>
              ) : !wholeSeries.value && (
                <span className="note" style={{ fontSize: 10.5, textAlign: "right", maxWidth: 150 }}>
                  {/* Name the part, because for a raincloud the answer differs per click:
                      the cloud and the inner box take their own fill, the rain does not. A row
                      that said "this raincloud only" while the write hit one part would be
                      describing the wrong thing. */}
                  {isViolin
                    ? "→ this violin only"
                    : raincloudPart === "cloud"
                      ? "→ this cloud only"
                      : raincloudPart === "box"
                        ? "→ this inner box only"
                        : isRaincloud
                          ? "→ this raincloud only"
                          : rowId ? "→ this point only" : "click a point to target it"}
                </span>
              )}
            </span>
          </div>
          )}
        </>
      )}
      {everyPointOwnColour && !perPoint && (
        <p className="note" style={{ fontSize: 11 }}>
          Each point on this series has its own colour — click a point to change it.
        </p>
      )}
      <SchemaForm
        fields={fields}
        refusals={{
          ...(errorRefusal ? { "Error bars": errorRefusal } : {}),
          /* This kind draws no point markers (`deadControls.ts`). The registry's
             sentence is rendered in place of the rows, so the group refuses rather than
             silently disappearing. */
          ...(NO_MARKER_KINDS[kind] ? { "Data points": NO_MARKER_KINDS[kind]! } : {}),
        }}
        value={
          perPoint && rowId
            ? (() => {
                const ps = plot.pointStyles?.[`${colId}:${rowId}`] ?? {};
                return { ...s, errorBars: s.errorBars ?? errDefault, ...ps, color: ps.color ?? effective };
              })()
            : { ...s, color: effective, errorBars: s.errorBars ?? errDefault }
        }
        onChange={(delta) => {
          // "Edit / new gradient…" is a menu entry, never a value: intercept it here rather than
          // writing the sentinel into the document (the ramp would resolve to nothing and the
          // series would silently go viridis).
          const d = delta as Record<string, unknown>;
          for (const key of ["gradRamp", "colorFromRamp"] as const) {
            if (d[key] === EDIT_RAMP) {
              const current = String((s as Record<string, unknown>)[key] ?? (key === "gradRamp" ? "lightness" : "viridis"));
              setGradEdit({
                gradient: gradientToEdit(current, gradients, gradientOps?.nextId() ?? `grad_${Date.now().toString(36)}`),
                apply: (ref) => applyStyle({ [key]: ref } as unknown as SeriesStyle),
              });
              return;
            }
          }
          applyStyle(delta as SeriesStyle);
        }}
      />
      {/* Point spread — only where this series draws a swarm of its data points. */}
      {(kind === "scatter" ||
        kind === "estimation" ||
        ((kind === "box" || kind === "violin") && plot.showBoxPoints === true) ||
        (kind === "bar" &&
          ((plot.showBarPoints ?? true) || s.plotAs === "points") &&
          !((plot.barLayout === "stacked" || plot.barLayout === "percent") && table.kind !== "column"))) && (
        <>
          <div className="inspsub">Point spread</div>
          <PointSpreadRow
            value={pointSpreadShown(plot, s, kind)}
            whole={{ checked: wholeGraph.value || spreadWhole, locked: wholeGraph.value, onToggle: setSpreadWhole }}
            onChange={(n) => {
              if (wholeGraph.value || spreadWhole) onSetPlotOptions(pointSpreadWholeGraph(plot, n));
              else onSetSeriesStyle(colId, { pointSpread: n });
            }}
          />
        </>
      )}
      {/* Bar width — every bar, or this series' own. Only where this series draws a bar. */}
      {kind === "bar" && s.plotAs !== "points" && s.plotAs !== "line" && (() => {
        const whole = wholeGraph.value || barWhole;
        return (
          <>
            <div className="inspsub">Bar width</div>
            <WholeGraphSliderRow
              label="Bar width"
              title={whole
                ? "Ticked: the share of each category the bars fill — every bar on the graph."
                : "This series' bars, as a share of their own place in the group — 100% fills it. The bar keeps its centre."}
              min={0.1}
              max={1}
              step={0.02}
              value={barWidthShown(plot, colId, whole)}
              shown={`${Math.round(barWidthShown(plot, colId, whole) * 100)}%`}
              whole={{ checked: whole, locked: wholeGraph.value, onToggle: setBarWhole }}
              wholeTitle="Ticked: every bar on the graph. Unticked: only the series you clicked. Dragging a bar's edge follows this box."
              onChange={(n) => {
                if (whole) onSetPlotOptions(barWidthWholeGraph(plot, n));
                else onSetSeriesStyle(colId, { barWidth: n });
              }}
            />
          </>
        );
      })()}
      {/* Two-tone edge override — sets the marker's edge (line) colour even
          for a two-tone fill (the interior still derives from the hue). Enable/override
          tickbox: off = automatic derived edge; on = a custom colour. Uses the dedicated
          `twoToneEdge` field (never seeded by a preset), so it can't stale-pin the
          derivation. Shown for two-tone markers of any kind (fill charts use fillType,
          so their symbolFill is undefined → hidden). */}
      {(() => {
        const pp = perPoint && rowId ? (plot.pointStyles?.[`${colId}:${rowId}`] ?? {}) : {};
        const curFill = pp.symbolFill ?? s.symbolFill;
        if (curFill !== "twotone") return null;
        // This block sits outside the SchemaForm, so `asSummaryField`'s hide-while-linked
        // gate does not reach it — without this check a linked summary would show a "Custom
        // edge colour" row writing `twoToneEdge` on a style the builder is not reading.
        if (summaryLinked) return null;
        const curEdge = pp.twoToneEdge ?? s.twoToneEdge;
        const custom = curEdge !== undefined;
        return (
          <div style={{ marginTop: 4 }}>
            <label className="frow">
              <span>Custom edge colour</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={custom}
                  title="Off: automatic (derived) two-tone edge. On: pick a custom edge/line colour."
                  onChange={(e) => applyStyle({ twoToneEdge: e.target.checked ? (curEdge ?? effective) : undefined })}
                />
                {custom && (
                  <ColorInput className="colorin" value={curEdge as string} aria-label="Two-tone edge colour" onChange={(c) => applyStyle({ twoToneEdge: c })} />
                )}
              </span>
            </label>
            {custom && <ColourSwatches value={curEdge} onPick={(c) => applyStyle({ twoToneEdge: c })} />}
          </div>
        );
      })()}
      {/* Lollipop stem line — surfaced here (next to the dots) because that is where
          a lollipop is edited. The stem is a chart-wide property, so it
          routes to plot.lollipop (not the series style). Enable/override toggle:
          off = automatic stem colour; on = a custom colour. */}
      {kind === "lollipop" && (() => {
        const l = plot.lollipop ?? {};
        const setL = (patch: Partial<NonNullable<Plot["lollipop"]>>) => onSetPlotOptions({ lollipop: { ...l, ...patch } });
        const linked = l.stemLinkColor ?? false;
        return (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--line-2)", paddingTop: 6 }}>
            <div className="insphd" style={{ fontSize: 11 }}>Stem line</div>
            <label className="frow">
              <span>Link colour to data</span>
              <input
                type="checkbox"
                checked={linked}
                title="On: the stem colour follows the data-point colour. Off: set the stem colour below."
                onChange={(e) => setL({ stemLinkColor: e.target.checked })}
              />
            </label>
            {!linked && (
              <>
                <label className="frow">
                  <span>Stem colour</span>
                  <ColorInput className="colorin" value={l.stemColor ?? "#8b8792"} aria-label="Stem colour" onChange={(c) => setL({ stemColor: c })} />
                </label>
                <ColourSwatches value={l.stemColor} onPick={(c) => setL({ stemColor: c })} />
              </>
            )}
            <label className="frow">
              <span>Stem width</span>
              <input type="number" className="numin" min={0.5} max={12} step={0.25} value={l.stemWidth ?? 2} onChange={(e) => setL({ stemWidth: Number(e.target.value) })} />
            </label>
          </div>
        );
      })()}
      {/* Surgical single-point reset (shown when the selected point carries an override). */}
      {perPoint && rowId && plot.pointStyles?.[`${colId}:${rowId}`] && (
        <button
          type="button"
          className="btn-mini"
          style={{ marginTop: 6 }}
          title="Remove this point's highlight (back to the series style)"
          onClick={() => {
            const cur = plot.pointStyles?.[`${colId}:${rowId}`] ?? {};
            const cleared: SeriesStyle = {};
            for (const k of Object.keys(cur) as (keyof SeriesStyle)[]) (cleared as Record<string, unknown>)[k] = undefined;
            onSetPointStyle(colId, rowId, cleared);
          }}
        >
          Reset this point
        </button>
      )}
      {pointCount > 0 && (
        <button
          type="button"
          className="btn-mini"
          style={{ marginTop: 6 }}
          title="Remove every per-point highlight on this series (back to the series style)"
          onClick={() => onClearPointStyles(colId)}
        >
          Reset {pointCount} point highlight{pointCount === 1 ? "" : "s"}
        </button>
      )}
      <div className="frow" style={{ marginTop: 6 }}>
        <span>Replicates</span>
        <span className="note" style={{ fontSize: 11 }}>
          {replicateCount} subcolumn{replicateCount === 1 ? "" : "s"}
        </span>
      </div>
      {/* Error-bar footnote — suppressed for kinds that draw no error bars (noErrorBars). */}
      {(kind === "box" || kind === "violin" || kind === "scatter" || !noErrorBars) && (
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          {kind === "box" ? (
            <>Box summarises this dataset's pooled values (median, quartiles, whiskers). Whisker type is set in the graph's <strong>Chart type</strong> panel (click the background).</>
          ) : kind === "violin" ? (
            <>Violin shows the pooled values' kernel-density shape (Gaussian KDE, Silverman bandwidth) around a slim quartile box. Whisker range is set in the <strong>Chart type</strong> panel.</>
          ) : kind === "scatter" ? (
            <>Column scatter plots every replicate as a swarmed dot, with a mean ± SD overlay. Spread the dots wider with the <strong>Width</strong> slider.</>
          ) : (
            <>Error bars need ≥2 replicates (mean ± SD/SEM/CI). Set the replicate count in the data grid (the <strong>Replicates</strong> control) and enter values side-by-side. 95% CI uses the t-distribution.</>
          )}
        </p>
      )}
    </>
  );
}

/**
 * Unified style-preset panel — built-in presets and the user's saved custom presets
 * in one list. Click a card to restyle the graph; ★ sets a preset as the default for
 * new graphs; the "Save this graph as a preset" box captures the current look (and
 * "★ Set this graph as the default" saves + makes it the default in one step).
 *
 * "Include this graph type's own settings" (ticked to start with) also saves the open graph's
 * type-specific settings — bar width, the pie labels, the heatmap block — as that type's
 * section of the preset; unticked, only the look every type shares is saved. The saved cards
 * are the shared `UserPresetList`, which Settings shows too. Note: the built-in cards stay first:
 * the guided tour clicks the first card in this section.
 */
export function StylePresetPanel({
  userPresets,
  profileDefault,
  plotKind,
  canAddKind,
  onApplyPreset,
  onApplyUserPreset,
  onSaveUserPreset,
  onAddPresetKind,
  onDeleteUserPreset,
  onRenameUserPreset,
  onDuplicateUserPreset,
  onRemovePresetKind,
  onReorderUserPresets,
  onSetProfileDefault,
  onUserLibraryImported,
}: {
  userPresets: UserPreset[];
  profileDefault: ProfileDefault;
  /** The open graph's type, for "+ type" on a saved preset's card. */
  plotKind?: PlotKind | undefined;
  /** False when the open graph has no type-specific setting to add. */
  canAddKind?: boolean | undefined;
  onApplyPreset: (preset: StylePreset) => void;
  onApplyUserPreset: (preset: UserPreset) => void;
  onSaveUserPreset: (name: string, includeKind: boolean) => UserPreset | null;
  onAddPresetKind?: ((id: NodeId) => void) | undefined;
  onDeleteUserPreset: (id: NodeId) => void;
  /** Preset management: rename, duplicate (returns a refusal to show, or null), drop a type's section, reorder. */
  onRenameUserPreset?: ((id: NodeId, name: string) => void) | undefined;
  onDuplicateUserPreset?: ((id: NodeId) => string | null) | undefined;
  onRemovePresetKind?: ((id: NodeId, kind: PlotKind) => void) | undefined;
  onReorderUserPresets?: ((ids: string[]) => void) | undefined;
  onSetProfileDefault: (d: ProfileDefault) => void;
  onUserLibraryImported?: (() => void) | undefined;
}) {
  const [name, setName] = useState("");
  const [includeKind, setIncludeKind] = useState(true);
  const [libMsg, setLibMsg] = useState("");
  // The simple view is the default; "Manage…" above your presets shows the management row on
  // each card (handle, the open type, the types chip, the ⋯ menu) until "Done".
  const [manage, setManage] = useState(false);
  const exportLibrary = (): void => {
    void exportUserLibrary().then((r) => {
      setLibMsg(r.ok ? "Exported your style library." : r.canceled ? "" : `Export failed: ${r.error ?? "unknown error"}`);
    });
  };
  const importLibrary = (): void => {
    void importUserLibrary().then((r) => {
      if (r.ok) {
        onUserLibraryImported?.();
        setLibMsg("Imported — your presets were merged in.");
      } else {
        setLibMsg(r.canceled ? "" : `Import failed: ${r.error ?? "unknown error"}`);
      }
    });
  };
  /** One preset to a file of the user's choosing (a colleague's copy). */
  const exportPreset = (p: UserPreset): void => {
    void exportPresetFile(p).then((r) => {
      setLibMsg(r.ok ? `Exported "${p.name}".` : r.canceled ? "" : `Export failed: ${r.error ?? "unknown error"}`);
    });
  };
  /** One or more preset files in: each gets a fresh id and a free name; the rest is reported. */
  const importPresets = (): void => {
    void importPresetFiles().then((r) => {
      if (r.ok && r.added.length) onUserLibraryImported?.();
      setLibMsg(importSummary(r));
    });
  };
  const isBuiltinDefault = (n: string): boolean => profileDefault?.kind === "builtin" && profileDefault.name === n;
  const star = (active: boolean, onToggle: () => void, label: string): ReactNode => (
    <button
      type="button"
      className="swbtn pc-star"
      title={active ? "Default for new graphs (click to clear)" : `Set "${label}" as the default for new graphs`}
      aria-pressed={active}
      onClick={onToggle}
    >
      {active ? "★" : "☆"}
    </button>
  );
  const save = (): void => {
    const nm = name.trim();
    if (!nm) return;
    onSaveUserPreset(nm, includeKind);
    setName("");
  };
  const saveAsDefault = (): void => {
    const rec = onSaveUserPreset(name.trim() || "My style", includeKind);
    if (rec) onSetProfileDefault({ kind: "user", id: rec.id });
    setName("");
  };
  const defaultLabel =
    profileDefault === null
      ? "None"
      : profileDefault.kind === "builtin"
        ? profileDefault.name
        : userPresets.find((p) => p.id === profileDefault.id)?.name ?? "a saved preset";
  return (
    <>
      <p className="pc-hint" style={{ marginTop: 0 }}>
        One click restyles the whole graph — fonts, axis thickness, grid, and palette. ★ makes a preset the default for new graphs.
      </p>
      {templateMigrationReport().refused.length > 0 && (
        <p className="pc-hint">
          {templateMigrationReport().refused.length} saved template{templateMigrationReport().refused.length === 1 ? " was" : "s were"} not turned into
          presets because the list is full. Delete a preset and restart MadY to convert the rest.
        </p>
      )}
      <div className="pc-list">
        {STYLE_PRESETS.map((preset) => (
          <div key={preset.name} className="pc-row">
            <button type="button" className="btn-mini presetcard" title={preset.description} onClick={() => onApplyPreset(preset)}>
              <span className="pc-name">{preset.name}</span>
              <PaletteSwatches palette={preset.palette} />
              <span className="pc-desc">{preset.description}</span>
            </button>
            {star(isBuiltinDefault(preset.name), () => onSetProfileDefault(isBuiltinDefault(preset.name) ? null : { kind: "builtin", name: preset.name }), preset.name)}
          </div>
        ))}
        {/* `.pc-mine` = your presets and their Manage… row, as one box the manual can photograph. */}
        <div className="pc-mine">
        {userPresets.length > 0 && (
          <div className="pc-manage-row">
            <span className="pc-manage-h">My presets</span>
            <button
              type="button"
              className="btn-mini"
              aria-pressed={manage}
              aria-label="Manage presets"
              title={manage ? "Back to the simple view" : "Show the management controls on your presets: rename, duplicate, the types each holds, order, export, delete"}
              onClick={() => setManage((m) => !m)}
            >
              {manage ? "Done" : "Manage…"}
            </button>
          </div>
        )}
        <UserPresetList
          variant="inspector"
          manage={manage}
          presets={userPresets}
          profileDefault={profileDefault}
          activeKind={plotKind}
          canAddKind={canAddKind}
          onApply={onApplyUserPreset}
          onAddKind={onAddPresetKind}
          onDelete={onDeleteUserPreset}
          onRename={onRenameUserPreset}
          onDuplicate={onDuplicateUserPreset ? (id) => setLibMsg(onDuplicateUserPreset(id) ?? "") : undefined}
          onRemoveKind={onRemovePresetKind}
          onReorder={onReorderUserPresets}
          onSetProfileDefault={onSetProfileDefault}
          onExport={exportPreset}
        />
        </div>
      </div>
      <div className="pc-save">
        <div className="inspsub" style={{ marginTop: 0 }}>Save this graph as a preset</div>
        <div className="frow">
          <input
            type="text"
            className="numin"
            value={name}
            aria-label="Preset name"
            placeholder="Name this style"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          />
          <button type="button" className="btn-mini" title="Save this graph's look as a reusable preset" onClick={save}>Save</button>
        </div>
        <label
          className="frow"
          title="Also saves the settings only this graph type has, such as bar width or pie labels. They are used when this preset is applied to another graph of the same type and ignored on other types. Untick to save only the look every graph type shares: fonts, axes, grid, legend, colours."
        >
          <span>Include this graph type's own settings</span>
          <input type="checkbox" checked={includeKind} aria-label="Include this graph type's own settings" onChange={(e) => setIncludeKind(e.target.checked)} />
        </label>
        <button type="button" className="btn-mini pc-default" title="Save this look and make it the default for every new graph" onClick={saveAsDefault}>★ Set this graph as the default</button>
        <p className="pc-hint">
          New graphs start from <strong>{defaultLabel}</strong>. Click a ★ to change it, or the filled ★ again to clear it.
        </p>
      </div>
      <div className="inspsub">Back up &amp; transfer</div>
      <div className="frow pc-transfer">
        <button type="button" className="btn-mini pc-wide" title="Add one or more preset files (.mady-preset.json) someone exported. Each gets a fresh id; a name you already have gets (2)." onClick={importPresets}>Import preset…</button>
        <button type="button" className="btn-mini" title="Export your presets & defaults to a portable .json file (a backup, or to move to another computer)" onClick={exportLibrary}>Export library…</button>
        <button type="button" className="btn-mini" title="Import a previously exported style library (adds to your presets, never deletes)" onClick={importLibrary}>Import library…</button>
      </div>
      {libMsg && <p className="pc-msg">{libMsg}</p>}
      <p className="pc-hint">
        Export… on a preset card hands that one preset to someone else. The library buttons back up or move everything at once. Presets are saved automatically and survive updates.
      </p>
    </>
  );
}


/** Suggest a single axis cut when one big empty band dominates the data range
 *  (e.g. a cluster near 0 plus a far outlier). Returns the gap [from,to] to omit,
 *  or null when no single gap dominates (so a well-spread axis gets no suggestion). */
function suggestCut(values: number[]): { from: number; to: number } | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 4) return null;
  const span = v[v.length - 1]! - v[0]!;
  if (span <= 0) return null;
  let gi = -1;
  let gMax = 0;
  for (let i = 1; i < v.length; i++) {
    const g = v[i]! - v[i - 1]!;
    if (g > gMax) {
      gMax = g;
      gi = i;
    }
  }
  // Only worthwhile when the empty band dominates (≥ 40 % of the whole range) and
  // there is real data on both sides of it.
  if (gi < 1 || gMax < span * 0.4) return null;
  const lo = v[gi - 1]!;
  const hi = v[gi]!;
  const margin = gMax * 0.1; // keep the gap edges off the nearest data points
  const from = lo + margin;
  const to = hi - margin;
  return to > from ? { from: Number(from.toPrecision(4)), to: Number(to.toPrecision(4)) } : null;
}

/**
 * The 3-D scatter's axis panel — one projected cube edge at a time (X / Y / Z picker).
 *
 * The 3-D scatter's axes have an Axis tab and can be edited: ticks, numbers, a range and a
 * scale. All three axes reuse the standard `AxisSpec` (Z lives on
 * `plot.zAxis`), so range/scale/format/fonts behave exactly like every 2-D axis.
 *
 * Smaller than AxisPanel on purpose. Axis length, breaks, bands, tick rotation and category
 * grouping have no faithful drawing on a slanted, orbiting edge — they are refused in the note at
 * the bottom rather than shown as controls that would do nothing or misreport.
 */
/**
 * Axis tab ▸ Title direction — for an axis that runs up the figure (Y, Y2, Y3):
 * the title written level, or at any angle, beside the axis or level above it. Quick buttons for the
 * angles the grip on the graph snaps to; a box for any other; "Above the axis" only while the title is level
 * (the builder refuses it otherwise, with a warning). The axis's own default turn is stored as "no choice".
 * Angles are degrees turned anticlockwise from level: 90 = the usual left title, 270 = a right one.
 */
export function TitleDirectionRows({ spec, side, set }: { spec: AxisSpec; side: "left" | "right"; set: (patch: Partial<AxisSpec>) => void }) {
  const def = defaultTitleAngle(side);
  const angle = spec.titleAngle != null && Number.isFinite(spec.titleAngle) ? normalizeAngle(spec.titleAngle) : def;
  const choose = (a: number): void => {
    const n = normalizeAngle(a);
    set({ titleAngle: n === def ? undefined : n, ...(n !== 0 ? { titleAbove: undefined } : {}) });
  };
  const quick = side === "left" ? [0, 45, 90, 135, 180] : [0, 45, 135, 180, 270];
  return (
    <>
      <div className="frow" title="Which way the axis title reads. 90° is the usual turned title; 0° writes it level. On the graph, select the axis and drag the round grip at the end of its title — it holds at every 45°.">
        <span>Title direction</span>
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          {quick.map((a) => (
            <button key={a} type="button" className={"btn-mini" + (angle === a ? " on" : "")} aria-pressed={angle === a} onClick={() => choose(a)}>
              {a === 0 ? "Level" : `${a}°`}
            </button>
          ))}
          <input
            type="number"
            className="numin"
            aria-label="Title angle (degrees)"
            min={0}
            max={359}
            step={1}
            style={{ width: 52 }}
            value={angle}
            onChange={(e) => {
              const t = e.target.value.trim();
              if (t === "") { set({ titleAngle: undefined }); return; }
              const n = Number(t);
              if (Number.isFinite(n)) choose(n); // half-typed ("-") keeps the last good value
            }}
          />
        </span>
      </div>
      {angle === 0 && (
        <label className="frow" title="Write the level title over the top end of the axis instead of beside it — it takes no width from the plot.">
          <span>Above the axis</span>
          <input type="checkbox" checked={spec.titleAbove === true} onChange={(e) => set({ titleAbove: e.target.checked ? true : undefined })} />
        </label>
      )}
    </>
  );
}

/**
 * Prefix · Suffix · Thousands · Decimal mark for an axis's tick numbers. One definition, used by
 * the 2-D axis panel's Numbering section and by the 3-D scatter's edge panel — the 3-D builder
 * formats its ladders through the same `tickFormat(spec)` and honours all four.
 */
function TickAffixRows({ spec, set }: { spec: AxisSpec; set: (patch: Partial<AxisSpec>) => void }) {
  return (
    <>
      <label className="frow">
        <span>Prefix</span>
        <input type="text" className="numin" value={spec.prefix ?? ""} placeholder="e.g. $" onChange={(e) => set({ prefix: e.target.value === "" ? undefined : e.target.value })} />
      </label>
      <label className="frow">
        <span>Suffix</span>
        <input type="text" className="numin" value={spec.suffix ?? ""} placeholder="e.g. %" onChange={(e) => set({ suffix: e.target.value === "" ? undefined : e.target.value })} />
      </label>
      <label className="frow" title="Digit-grouping separator for large tick numbers (e.g. 1,000,000).">
        <span>Thousands</span>
        <select
          className="selin"
          value={spec.thousands ?? "none"}
          onChange={(e) => set({ thousands: e.target.value === "none" ? undefined : (e.target.value as ThousandsSeparator) })}
        >
          <option value="none">None</option>
          <option value="comma">Comma (1,000)</option>
          <option value="period">Period (1.000)</option>
          <option value="space">Space (1 000)</option>
          <option value="apostrophe">Apostrophe (1’000)</option>
        </select>
      </label>
      <label className="frow" title="Decimal mark for tick numbers. Pair Period-thousands + Comma-decimal for the European 1.234,5 style.">
        <span>Decimal mark</span>
        <select
          className="selin"
          value={spec.decimalSep ?? "point"}
          onChange={(e) => set({ decimalSep: e.target.value === "point" ? undefined : (e.target.value as DecimalSeparator) })}
        >
          <option value="point">Point (3.14)</option>
          <option value="comma">Comma (3,14)</option>
        </select>
      </label>
    </>
  );
}

function Scatter3DAxisPanel({
  axis,
  plot,
  table,
  onSelect,
  onSetAxis,
  onSetPlotFont,
}: {
  axis: "x" | "y" | "z";
  plot: Plot;
  table: DataTable;
  onSelect: (sel: GraphSelection) => void;
  onSetAxis: (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;
  onSetPlotFont: SetPlotFont;
}) {
  const spec = (axis === "x" ? plot.xAxis : axis === "y" ? plot.yAxis : plot.zAxis) ?? {};
  const set = (patch: Partial<AxisSpec>): void => onSetAxis(axis, patch);
  const col = table.columns[axis === "x" ? 0 : axis === "y" ? 1 : 2];
  // A Z title may also be stored in the older `scatter3d.zTitle`; show it so the
  // box reflects what is drawn, but every write goes to zAxis.title.
  const title = spec.title ?? (axis === "z" ? plot.scatter3d?.zTitle : undefined) ?? "";
  const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
  return (
    <>
      <div className="insphd">3-D axes</div>
      <div className="frow" style={{ gap: 4 }}>
        <button type="button" className={"btn-mini" + (axis === "x" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "x" })}>X</button>
        <button type="button" className={"btn-mini" + (axis === "y" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "y" })}>Y</button>
        <button type="button" className={"btn-mini" + (axis === "z" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "z" })}>Z</button>
      </div>
      <label className="frow" title="The name drawn at this axis's end. Blank = the source column's name.">
        <span>Title</span>
        <input
          type="text" className="numin" style={{ width: 130 }}
          value={title}
          placeholder={col?.name ?? ""}
          onChange={(e) => set({ title: e.target.value || undefined })}
        />
      </label>
      <div className="inspsub">Range</div>
      <label className="frow" title="Manual lower bound. Blank = fit the data. Points outside the range are not drawn (the graph says how many).">
        <span>Min</span>
        <input type="number" className="numin" value={spec.min ?? ""} placeholder="auto" onChange={(e) => set({ min: num(e.target.value) })} />
      </label>
      <label className="frow" title="Manual upper bound. Blank = fit the data.">
        <span>Max</span>
        <input type="number" className="numin" value={spec.max ?? ""} placeholder="auto" onChange={(e) => set({ max: num(e.target.value) })} />
      </label>
      <label className="frow" title="Log needs positive values — with data at or below 0 the axis says so and draws linear.">
        <span>Scale</span>
        <select className="selin" value={spec.scale ?? "linear"} onChange={(e) => set({ scale: e.target.value === "linear" ? undefined : (e.target.value as AxisScale) })}>
          <option value="linear">Linear</option>
          <option value="log10">Log (base 10)</option>
          <option value="log2">Log (base 2)</option>
          <option value="ln">Log (natural)</option>
        </select>
      </label>
      <div className="inspsub">Ticks</div>
      <label className="frow" title="Spacing between tick numbers, in data units. Blank = automatic (a 'nice' interval).">
        <span>Tick interval</span>
        <input type="number" className="numin" value={spec.majorStep ?? ""} placeholder="auto" min={0} onChange={(e) => set({ majorStep: num(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Show ticks</span>
        <input type="checkbox" checked={!spec.hideTicks} onChange={(e) => set({ hideTicks: e.target.checked ? undefined : true })} />
      </label>
      <label className="frow" title="Length of each tick mark, px.">
        <span>Tick length</span>
        <input type="number" className="numin" min={1} max={16} value={spec.tickLen ?? 4} onChange={(e) => { const v = Number(e.target.value); set({ tickLen: Number.isFinite(v) && v !== 4 ? v : undefined }); }} />
      </label>
      <label className="frow">
        <span>Number format</span>
        <select className="selin" value={spec.format ?? "auto"} onChange={(e) => set({ format: e.target.value === "auto" ? undefined : (e.target.value as NumberFormat) })}>
          <option value="auto">Auto</option>
          {NUMBER_FORMAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <label className="frow" title="Fixed decimal places. Blank = trim trailing zeros.">
        <span>Decimals</span>
        <input type="number" className="numin" min={0} max={6} value={spec.decimals ?? ""} placeholder="auto" onChange={(e) => set({ decimals: num(e.target.value) })} />
      </label>
      <TickAffixRows spec={spec} set={set} />
      <div className="inspsub">Line</div>
      <label className="frow" title="This edge's own colour. The other two keep theirs.">
        <span>Colour</span>
        <ColorInput className="colorin" value={spec.lineColor ?? "#7a7580"} aria-label={`${axis.toUpperCase()} axis colour`} onChange={(c) => set({ lineColor: c })} />
      </label>
      <label className="frow">
        <span>Thickness</span>
        <input type="number" className="numin" min={0.25} max={8} step={0.25} value={spec.lineWidth ?? 1.25} onChange={(e) => { const v = Number(e.target.value); set({ lineWidth: Number.isFinite(v) ? v : undefined }); }} />
      </label>
      <label className="frow" title="Hide this edge — line, ticks, numbers and name — while the data mapping stays.">
        <span>Hide axis</span>
        <input type="checkbox" checked={spec.hidden === true} onChange={(e) => set({ hidden: e.target.checked ? true : undefined })} />
      </label>
      <SubSection title="Spacing" open={false}>
        <label className="frow" title="Gap between the tick numbers and the axis line — the same 'Labels ↔ axis' control the 2-D axes use. Raise it to lift the numbers off the axis.">
          <span>Labels ↔ axis</span>
          <input type="number" className="numin" min={0} max={60} value={spec.tickLabelGap ?? ""} placeholder="auto" onChange={(e) => set({ tickLabelGap: num(e.target.value) })} />
        </label>
        <label className="frow" title="Gap between the axis title and the tick numbers — the same 'Title ↔ labels' control the 2-D axes use.">
          <span>Title ↔ labels</span>
          <input type="number" className="numin" min={0} max={60} value={spec.titleGap ?? ""} placeholder="auto" onChange={(e) => set({ titleGap: num(e.target.value) })} />
        </label>
        <label className="frow" title="Which side of the edge the tick marks + numbers sit on. Flip if they collide with the data or another axis.">
          <span>Label side</span>
          <select className="selin" value={spec.labelSide ?? "auto"} onChange={(e) => set({ labelSide: e.target.value === "flip" ? "flip" : undefined })}>
            <option value="auto">Outside (auto)</option>
            <option value="flip">Flip to other side</option>
          </select>
        </label>
      </SubSection>
      <SubSection title="Fonts" open>
        <FontControls
          label="Title font"
          element="axisTitle"
          spec={spec.titleFont ?? plot.fonts?.axisTitle}
          defaultSize={15}
          onSetPlotFont={onSetPlotFont}
          onSet={(patch) => set({ titleFont: { ...(spec.titleFont ?? {}), ...patch } })}
        />
        <FontControls
          label="Tick number font"
          element="tick"
          spec={spec.tickFont ?? plot.fonts?.tick}
          defaultSize={13}
          onSetPlotFont={onSetPlotFont}
          onSet={(patch) => set({ tickFont: { ...(spec.tickFont ?? {}), ...patch } })}
        />
      </SubSection>
      <label className="frow" style={{ marginTop: 6 }}>
        <span>Reset</span>
        <button type="button" className="swbtn" title="Clear this axis's overrides — back to auto range, linear scale and the shared styling"
          onClick={() => set({ min: undefined, max: undefined, scale: undefined, majorStep: undefined, hideTicks: undefined, tickLen: undefined, format: undefined, decimals: undefined, prefix: undefined, suffix: undefined, thousands: undefined, decimalSep: undefined, lineColor: undefined, lineWidth: undefined, hidden: undefined, title: undefined, titleGap: undefined, tickLabelGap: undefined, labelSide: undefined })}>Clear</button>
      </label>
      <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
        These are projected cube edges, so some 2-D axis tools don&rsquo;t exist here: an <strong>axis
        break</strong> drawn into a slanted edge reads as damage, not a gap; <strong>length</strong>,
        <strong> bands</strong> and <strong>label rotation</strong> have no meaningful drawing either.
        The floor grid and the orbit live in <strong>Chart &rarr; 3-D scatter</strong>.
      </p>
    </>
  );
}

/**
 * Group by ▸ By hand: put one category in a group, or take it out of every group with an empty name.
 *
 * The name is stored exactly as typed — the box commits on every keystroke, so trimming here would eat the
 * space in "Early life" the moment it was typed. The builder trims when it reads the list, so
 * " Early " and "Early" are one group. An emptied list stays as `{}`: that is what keeps By hand
 * chosen while the user has not typed anything yet.
 */
export function setManualCategoryGroup(cg: CategoryGroupSpec, category: string, group: string): CategoryGroupSpec {
  const map = { ...(cg.map ?? {}) };
  if (group.trim() === "") delete map[category];
  else map[category] = group;
  return { ...cg, map };
}

/** The Group by value for a hand-made list — not a column id (ids never contain spaces). */
const GROUP_BY_HAND = "by hand";

/** The Axis tab — the per-axis panel, one axis at a time. */
function AxisPanel({
  selection,
  plot,
  table,
  docVersion,
  onSelect,
  onSetAxis,
  onSetAxisLength,
  onSetSeriesStyle,
  onSetPlotFont,
  onSetAxisTitleFont,
  onSetPlotOptions,
}: {
  selection: { axis: "x" | "y" | "y2" | "y3"; focus?: "labels" | "numbers" };
  plot: Plot;
  table: DataTable;
  /** See `Inspector` — bumps on every edit; every list below that reads the rows keys on it. */
  docVersion?: number | undefined;
  onSelect: (sel: GraphSelection) => void;
  onSetAxis: (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;
  onSetAxisLength: (axis: "x" | "y", length: number | null) => void;
  onSetSeriesStyle: (columnId: NodeId, delta: SeriesStyle) => void;
  onSetPlotFont: SetPlotFont;
  onSetAxisTitleFont: (axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>) => void;
  onSetPlotOptions: (patch: Partial<Plot>) => void;
}) {
  const axis = selection.axis;
  // visual axis (`axis`) = the axis as drawn / clicked. `dataAxis` = the AxisSpec
  // that governs it: on a flipped (horizontal) categorical chart the value spec
  // (yAxis) is drawn on X and the category spec (xAxis) on Y, so they swap. Spec
  // content (title / scale / range / numbering / axis line) reads & writes through
  // `dataAxis`, and so does the axis title font; pure visual properties (length, the tick-label font) stay on `axis`.
  const dataAxis = dataAxisOf(plot, axis);
  // X / Y (/ Y2 / Y3) switcher so the "Axis" rail tab can move between axes without
  // having to click the graph. Only the right-hand axes this kind's drawing has.
  const rightAxes = rightValueAxes(plot);
  const supportsY2 = rightAxes.includes("y2");
  const axisSwitch = (
    <div className="frow" style={{ marginBottom: 4 }}>
      <span>Axis</span>
      <span style={{ display: "flex", gap: 6 }}>
        <button type="button" className={"btn-mini" + (axis === "x" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "x" })}>X</button>
        <button type="button" className={"btn-mini" + (axis === "y" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "y" })}>Y</button>
        {(supportsY2 || axis === "y2") && (
          // A horizontal bar chart's second axis runs along the top and its values along X, so the
          // button names it X2 there; the selection underneath is the same "y2" setting.
          <button type="button" className={"btn-mini" + (axis === "y2" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "y2" })}>{secondAxisOnTop(plot) ? "X2" : "Y2"}</button>
        )}
        {(rightAxes.includes("y3") || axis === "y3") && (
          <button type="button" className={"btn-mini" + (axis === "y3" ? " on" : "")} onClick={() => onSelect({ kind: "axis", axis: "y3" })}>Y3</button>
        )}
      </span>
    </div>
  );
  // Which series live on this value axis — a direct picker so the user can move a
  // series onto the right (Y2) axis (or back to the left) with one click, instead
  // of hunting for the per-series "Plot on" control. The Y2 axis draws as soon as
  // at least one series is ticked here.
  const valueAxis: "y" | "y2" | "y3" = axis === "y2" ? "y2" : axis === "y3" ? "y3" : "y";
  // Untick semantics: from the primary Y → move to Y2 (the existing affordance); from a
  // right axis (Y2/Y3) → back to the primary Y.
  const offAxis: "y" | "y2" = valueAxis === "y" ? "y2" : "y";
  const anyOnThis = tableDatasets(table).some((d) => (plot.seriesStyles?.[d.id]?.axis ?? "y") === valueAxis);
  // On a horizontal bar chart the second axis runs along the top (X2) and the main value axis is
  // the bottom one (visual X) — `dataAxis` names the value axes in either orientation.
  const topSecond = secondAxisOnTop(plot);
  const rightLabel = axis === "y3" ? "Y3" : topSecond ? "X2" : "Y2";
  // The picker belongs on the value axis and the second axis, never on the category axis. A horizontal lollipop's
  // value spec is `xAxis` (it is not transposed), so there the category axis is Y.
  const categoryDataAxis = plot.kind === "lollipop" && topSecond ? "y" : "x";
  const seriesAxisPicker = supportsY2 && dataAxis !== categoryDataAxis ? (
    <SubSection title="Series on this axis" open={axis === "y2" || axis === "y3"}>
      {tableDatasets(table).map((d, i) => {
        const on = (plot.seriesStyles?.[d.id]?.axis ?? "y") === valueAxis;
        return (
          /* `seriesaxis-row`: this row's visible label is the series' own name, so
             `function-matrix.test.tsx` cannot name it in a rule — it identifies the row by this class instead. */
          <label className="frow seriesaxis-row" key={d.id}>
            <span>{d.name || `Series ${i + 1}`}</span>
            <input
              type="checkbox"
              checked={on}
              onChange={(e) => onSetSeriesStyle(d.id, { axis: e.target.checked ? valueAxis : offAxis })}
            />
          </label>
        );
      })}
      <p className="note" style={{ fontSize: 11 }}>
        {axis === "y2" || axis === "y3"
          ? `Tick a series to plot it on the ${topSecond ? "top" : "right"} (${rightLabel}) axis — it appears once at least one is on it.`
          : `Untick a series to move it to the ${topSecond ? "top (X2)" : "right (Y2)"} axis.`}
      </p>
    </SubSection>
  ) : null;
  const y2EmptyNote = (axis === "y2" || axis === "y3") && !anyOnThis ? (
    <p className="note" style={{ fontSize: 11, margin: "2px 0 6px" }}>
      Nothing is on the {topSecond ? "top" : "right"} axis yet — tick a series below to plot it here.
    </p>
  ) : null;
  // Y2 reuses the left-Y length + title font (it shares the plot height); only its
  // own AxisSpec (scale/range/title/breaks) is independent.
  const baseAxis: "x" | "y" = axis === "x" ? "x" : "y";
  // When the user clicked the tick labels (not the axis line), jump the panel to
  // the Fonts section so the label font controls are right there. A value axis's
  // numbers jump to Numbering instead, opened — how the numbers are written lives there.
  const fontsRef = useRef<HTMLDivElement>(null);
  const numberingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selection.focus === "labels") fontsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (selection.focus === "numbers") numberingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selection.focus, axis]);
  const [brkFrom, setBrkFrom] = useState("");
  const [brkTo, setBrkTo] = useState("");
  const [tickVal, setTickVal] = useState("");
  const [tickLbl, setTickLbl] = useState("");
  const [bandFrom, setBandFrom] = useState("");
  const [bandTo, setBandTo] = useState("");
  const [bandColor, setBandColor] = useState("#3b82f6");
  const spec: AxisSpec = (dataAxis === "x" ? plot.xAxis : dataAxis === "y2" ? plot.y2Axis : dataAxis === "y3" ? plot.y3Axis : plot.yAxis) ?? {};
  // Values feeding this axis (X column for x; the axis-matched data columns for y/y2)
  // — used to auto-suggest a cut when one outlier dominates the range.
  const axisValues = useMemo(() => {
    const out: number[] = [];
    const xc = xColumn(table);
    const num = (c: unknown): number => (typeof c === "number" ? c : Number(c));
    for (const col of table.columns) {
      const isX = col === xc;
      if (dataAxis === "x" ? !isX : isX) continue;
      // On a Y axis, only count columns assigned to this value axis (y vs y2).
      if (dataAxis !== "x") {
        const colAxis = plot.seriesStyles?.[col.id]?.axis ?? "y";
        if (colAxis !== dataAxis) continue;
      }
      for (const r of table.rows) {
        const v = num(r.cells[col.id]);
        if (Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  }, [dataAxis, table, plot.seriesStyles, docVersion]);
  const cutSuggestion = useMemo(() => suggestCut(axisValues), [axisValues]);
  // Category groups. Candidate grouping columns = anything but the category-label
  // column itself whose cells are non-numeric (a numeric column names no groups).
  const cg = spec.categoryGroups ?? {};
  const groupColumns = useMemo(() => {
    const xc = xColumn(table);
    return table.columns.filter((c) => {
      if (c === xc || table.rows.length === 0) return false;
      let sawText = false;
      for (const r of table.rows) {
        const v = r.cells[c.id];
        if (v == null || String(v).trim() === "") continue;
        if (Number.isFinite(typeof v === "number" ? v : Number(v))) return false;
        sawText = true;
      }
      return sawText;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  }, [table, docVersion]);
  // Distinct group names in data order — the same order buildScene assigns the
  // palette from, so the swatches here match what the figure draws.
  const groupNames = useMemo(() => {
    const col = cg.column;
    const out: string[] = [];
    if (cg.map) {
      for (const g of Object.values(cg.map)) if (g?.trim() && !out.includes(g.trim())) out.push(g.trim());
      return out;
    }
    if (!col) return out;
    for (const r of table.rows) {
      const g = String(r.cells[col] ?? "").trim();
      if (g !== "" && !out.includes(g)) out.push(g);
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  }, [cg.column, cg.map, table, docVersion]);
  // By hand: one box per category, named exactly as the drawing names them — the builder matches
  // the list against the same `categoryTicks`, so a box can never name a category it does not
  // draw. Built only while By hand is chosen.
  const manualCategories = useMemo(() => {
    if (!cg.map) return [];
    const s = buildPlotScene(table, plot, { width: 620, height: 420 });
    return categoryTicks(axis === "y" ? s.y : s.x).map(tickCategoryName);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `docVersion` is the edit signal (the rows change in place)
  }, [cg.map, table, plot, axis, docVersion]);
  const legacyScale = dataAxis === "x" ? plot.xScale : dataAxis === "y2" || dataAxis === "y3" ? undefined : plot.yScale;
  const scale = spec.scale ?? legacyScale ?? "auto";
  const fmt = spec.format ?? "auto";
  const set = (patch: Partial<AxisSpec>): void => onSetAxis(dataAxis, patch);
  const yCols = table.columns.slice(1);
  const colTitle =
    dataAxis === "x" ? (table.columns[0]?.name ?? "X") : yCols.length === 1 ? yCols[0]!.name : "value";
  // A band (categorical) axis: bar/box/violin/scatter/before-after carry their
  // categories on the data x spec (drawn on Y when the chart is flipped). XY, area,
  // survival have a continuous X (scale/range/numbering apply).
  /**
   * Which data spec carries the categories — taken from the scene's own `band` flag on every
   * gallery kind. `axis-category-panel.test.tsx` derives both lists the same way
   * and fails if either drifts.
   *
   * A kind missing from these lists would get the continuous panel — scale, number format,
   * manual range — for an axis carrying names, and none of the category rows (label rotation,
   * hide-axis, spacing, groups). A lollipop, forest, paired-dot, pyramid or ridgeline bands down Y.
   */
  const CATEGORICAL_X = ["bar", "box", "violin", "scatter", "beforeafter", "raincloud", "floatingbar", "dendrogram", "histogram",
    // upset: the intersection columns band along X (labelled by the membership matrix)
    "upset"];
  const CATEGORICAL_Y = ["forest", "pyramid", "ridgeline", "lollipop", "paireddot",
    // swimmer: subject bands down Y, labelled by the lead column
    "swimmer",
    // tracks: the track names band down Y (one strip each), labelled like any category axis
    "tracks"];
  // A lollipop is horizontal by default (names down Y), but its vertical form carries the names
  // along X — and keeps them on the X spec. Listing it only under Y would give a vertical lollipop
  // the numbers panel on its names axis and a dead Category groups section on its values axis
  // (guarded by the flipped-chart check in `Inspector.categoryaxis.test.tsx`).
  const verticalLollipop = plot.kind === "lollipop" && plot.barOrientation === "vertical";
  const bandX =
    (dataAxis === "x" && (CATEGORICAL_X.includes(plot.kind ?? "xy") || verticalLollipop))
    || (dataAxis === "y" && CATEGORICAL_Y.includes(plot.kind ?? "xy") && !verticalLollipop);
  /**
   * Banded is the same condition as "honours groups" — on every gallery kind, both axes,
   * the two agree. So there is no second list: if the axis bands, it can be grouped.
   *
   * Caution: measure this with an explicit `map` that merges two categories, not with
   * `categoryGroups: { column }`. On box/violin/scatter/raincloud/floatingbar/histogram/
   * before-after the first column is the category column, so grouping by it makes one group per
   * category — a no-op that would suggest only six kinds honour groups. Merging two categories
   * moves every banded kind. `Inspector.categoryaxis.test.tsx` uses the merging fixture.
   */
  // upset bands along X but its categories are computed intersections — no table column
  // can group them, so offering Category groups there would be a dead control. (The swimmer
  // keeps the section: the central axis pass draws its subject groups like any banded axis.)
  // A horizontal bar chart is offered it too: its category names live on `xAxis` (`dataAxisOf`),
  // not `yAxis`, and groups written to that spec draw there (the test writes via dataAxisOf).
  const hasCategoryGroups = bandX && plot.kind !== "upset";
  // The axis line/tick appearance — applies to every axis (band or continuous).
  const axisLength = axis === "x" ? plot.xAxisLength : plot.yAxisLength;
  const axisLengthGroup = (
      <SubSection title="Axis length" open={false}>
        <label className="frow">
          <span>Length (px)</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              className="numin"
              min={40}
              max={2000}
              step={10}
              style={{ width: 118 }}
              value={axisLength ?? ""}
              placeholder="auto (fit figure)"
              onChange={(e) => {
                const t = e.target.value.trim();
                onSetAxisLength(baseAxis, t === "" ? null : Number(t));
              }}
            />
            <button type="button" className="swbtn" title="Auto (fit the figure)" onClick={() => onSetAxisLength(baseAxis, null)}>
              ⨯
            </button>
          </span>
        </label>
        <p className="note" style={{ fontSize: 11 }}>
          The {axis === "x" ? "width" : "height"} of the plotting area. Or drag the {axis === "x" ? "right end of the X" : "top of the Y"} axis on the graph.
        </p>
      </SubSection>
  );
  const axisLineSection = (
      <SubSection title="Axis line" open>
        <label className="frow">
          <span>Colour</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ColorInput
              className="colorin"
              value={spec.lineColor ?? "#888780"}
              aria-label="Axis line colour"
              onChange={(c) => set({ lineColor: c })}
            />
            <button type="button" className="swbtn" title="Default colour" onClick={() => set({ lineColor: undefined })}>
              ⨯
            </button>
          </span>
        </label>
        {/* Same preset palette as data points (consistency between axis & series colours). */}
        <ColourSwatches value={spec.lineColor} onPick={(c) => set({ lineColor: c })} />
        <label className="frow">
          <span>Thickness</span>
          <input
            type="number"
            className="numin"
            min={0.25}
            max={8}
            step={0.25}
            value={spec.lineWidth ?? ""}
            placeholder="1.25"
            onChange={(e) => {
              const t = e.target.value.trim();
              set({ lineWidth: t === "" ? undefined : Number(t) });
            }}
          />
        </label>
        <label className="frow" title="When on, the tick marks always match the axis line thickness.">
          <span>Link ticks to axis</span>
          <input
            type="checkbox"
            checked={spec.tickWidth == null}
            onChange={(e) => set({ tickWidth: e.target.checked ? undefined : (spec.lineWidth ?? 1.25) })}
          />
        </label>
        <label className="frow">
          <span>Tick thickness</span>
          <input
            type="number"
            className="numin"
            min={0.25}
            max={8}
            step={0.25}
            style={{ width: 92 }}
            value={spec.tickWidth ?? ""}
            placeholder="match axis"
            disabled={spec.tickWidth == null}
            title={spec.tickWidth == null ? "Linked to the axis thickness — uncheck “Link ticks to axis” to set separately." : "Tick-mark thickness (independent of the axis line)."}
            onChange={(e) => {
              const t = e.target.value.trim();
              set({ tickWidth: t === "" ? undefined : Number(t) });
            }}
          />
        </label>
        <label className="frow" title="Show or hide this axis's tick marks (the number labels stay).">
          <span>Show ticks</span>
          <input type="checkbox" checked={!spec.hideTicks} onChange={(e) => set({ hideTicks: e.target.checked ? undefined : true })} />
        </label>
        <label className="frow">
          <span>Tick length</span>
          <input
            type="number"
            className="numin"
            min={0}
            max={30}
            step={1}
            value={spec.tickLen ?? ""}
            placeholder="5"
            disabled={!!spec.hideTicks}
            title={spec.hideTicks ? "Ticks are hidden — turn “Show ticks” on to set the length." : "Tick-mark length in px (this axis)."}
            onChange={(e) => {
              const t = e.target.value.trim();
              set({ tickLen: t === "" ? undefined : Number(t) });
            }}
          />
        </label>
      </SubSection>
  );

  /**
   * A numeric field where blank = "auto" (clears the override); finite numbers set it.
   *
   * Caution: this fires on every keystroke, so a half-typed value would reach the document —
   * and three kinds of value crash or blank the figure:
   *  • `Number("-")` / `Number(".")` / `Number("1e")` are NaN, which makes the axis domain
   *    [NaN, NaN]: zero ticks, zero finite marks, the whole figure blank mid-keystroke.
   *  • a minimum of `0` on a log axis is undefined (log 0 = -∞) and spins the decade loop
   *    forever, exhausting the heap and killing the renderer process — unrecoverable, since
   *    an OOM cannot be caught by an ErrorBoundary. Typing the leading `0` of `0.5` is enough.
   *  • an out-of-range `minorCount` does the same (the HTML `max` is advisory only).
   * A rejected keystroke leaves the stored value untouched, so typing continues normally and
   * the value commits as soon as it is valid. `scale.ts` also clamps, as a second guard.
   */
  const isLogScale = scale === "log10" || scale === "log2" || scale === "ln";
  const numProps = (key: "min" | "max" | "decimals" | "majorStep" | "minorCount" | "tickLabelGap" | "titleGap") => ({
    type: "number" as const,
    className: "numin",
    value: spec[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>): void => {
      const t = e.target.value.trim();
      if (t === "") {
        set({ [key]: undefined } as Partial<AxisSpec>);
        return;
      }
      const n = Number(t);
      if (!Number.isFinite(n)) return; // half-typed ("-", ".", "1e") — keep the last good value
      if (isLogScale && (key === "min" || key === "max") && n <= 0) return; // log is undefined at/below 0
      if (key === "minorCount" && (n < 0 || n > 20)) return; // matches this field's own max
      set({ [key]: n } as Partial<AxisSpec>);
    },
  });
  const textProps = (key: "prefix" | "suffix" | "title") => ({
    type: "text" as const,
    // A title is words ("Treatment") and needs a wider box than the number-box width, which would
    // cut it to "Treatme"; a prefix or suffix ("$", " mg") stays short.
    className: key === "title" ? "numin textin-wide" : "numin",
    value: spec[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>): void =>
      set({ [key]: e.target.value === "" ? undefined : e.target.value } as Partial<AxisSpec>),
  });

  /**
   * Rotating the category names and hiding the axis — both honoured by every categorical
   * builder, and both offered on category axes as well as on axes that carry numbers.
   *
   * Label rotation's own tooltip says "for long category labels", so a category axis must offer
   * it; it is the same control as the continuous panel's, so it lives here once and is rendered
   * by both branches rather than copied into each.
   */
  /** Title direction — only on an axis drawn up the figure; a top second axis runs across it. */
  const titleSide: "left" | "right" | null = axis === "y" ? "left" : axis === "y3" || (axis === "y2" && !topSecond) ? "right" : null;
  const titleDirection = titleSide ? <TitleDirectionRows spec={spec} side={titleSide} set={set} /> : null;
  const labelRotationRow = (
    <label className="frow" title="Rotate the tick labels (e.g. 45° or 90° for long category labels).">
      <span>Label rotation</span>
      <select className="selin" value={String(spec.tickRotation ?? 0)} onChange={(e) => set({ tickRotation: Number(e.target.value) || undefined })}>
        <option value="0">Horizontal</option>
        <option value="45">45°</option>
        <option value="90">90°</option>
        <option value="-45">−45°</option>
        <option value="-90">−90°</option>
      </select>
    </label>
  );
  /** One behaviour, two hints: a numeric axis pairs `hidden` with a scale bar, a category axis
   *  has no scale bar to point at, so the guidance differs even though the write is identical. */
  const hideAxisRow = (hint: string) => (
    <label className="frow">
      <span>Hide axis</span>
      <input
        type="checkbox"
        checked={spec.hidden ?? false}
        title={hint}
        onChange={(e) => set({ hidden: e.target.checked || undefined })}
      />
    </label>
  );

  /**
   * Category groups — the "traits grouped by domain" device. It belongs to the category spec
   * (`dataAxis === "x"`, which is the visual Y on a flipped chart), so the section follows the
   * axis the groups actually belong to rather than the one that happens to be drawn across.
   *
   * Defined once and rendered by both branches, so it reaches the kinds whose X actually bands
   * and is not offered on the kinds whose X is numeric, where `categoryGroups` is documented as
   * ignored.
   */
  /**
   * Gap between the tick labels and the axis, and between the axis title and the labels.
   *
   * Defined once and rendered by both branches, like `categoryGroupsSection` above: the builder
   * honours `tickLabelGap` / `titleGap` on every axis, including the five kinds whose X bands
   * (bar, box, violin, scatter, before-after).
   */
  const spacingSection = (
    <SubSection title="Spacing" open={false}>
      <label className="frow" title="Gap between the tick numbers and the axis line">
        <span>Labels ↔ axis</span>
        <input {...numProps("tickLabelGap")} min={0} max={60} placeholder={axis === "x" ? "6" : "8"} />
      </label>
      <label className="frow" title="Gap between the axis title and the tick numbers">
        <span>Title ↔ labels</span>
        <input {...numProps("titleGap")} min={0} max={60} placeholder="6" />
      </label>
    </SubSection>
  );

  const categoryGroupsSection = (
    <SubSection title="Category groups" open={false}>
      <label className="frow">
        <span>Group by</span>
        <select
          className="selin"
          value={cg.map ? GROUP_BY_HAND : (cg.column ?? "")}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) { set({ categoryGroups: undefined }); return; }
            // Switching drops the other source. The builder lets a list win over a column, so a
            // list left behind would silently ignore the column the user just picked.
            const { column: _column, map: _map, ...rest } = cg;
            if (v === GROUP_BY_HAND) set({ categoryGroups: { ...rest, map: cg.map ?? {} } });
            else set({ categoryGroups: { ...rest, column: v as NodeId } });
          }}
        >
          <option value="">None</option>
          {groupColumns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value={GROUP_BY_HAND}>By hand</option>
        </select>
      </label>
      {groupColumns.length === 0 && !cg.map && (
        <p className="note" style={{ fontSize: 11 }}>
          No column to group by. Pick By hand to type each category’s group, or add a text
          column naming each row’s group (e.g. “Domain”) and it will appear here.
        </p>
      )}
      {cg.map && (
        <>
          <datalist id={`cg-names-${plot.id}-${axis}`}>
            {groupNames.map((g) => <option key={g} value={g} />)}
          </datalist>
          {manualCategories.map((c, i) => (
            <label className="frow" key={`${i}:${c}`}>
              <span>{c}</span>
              <input
                type="text"
                className="numin textin-wide"
                list={`cg-names-${plot.id}-${axis}`}
                value={cg.map?.[c] ?? ""}
                placeholder="no group"
                aria-label={`Group for ${c}`}
                onChange={(e) => set({ categoryGroups: setManualCategoryGroup(cg, c, e.target.value) })}
              />
            </label>
          ))}
          <p className="note" style={{ fontSize: 11 }}>
            Type a group name beside each category. The same name in two boxes puts them in one
            block; an empty box leaves that category out of every group.
          </p>
        </>
      )}
      {spec.categoryGroups && (
        <>
          <label className="frow">
            <span>Colour labels</span>
            <input type="checkbox" checked={cg.labelColor ?? true} onChange={(e) => set({ categoryGroups: { ...cg, labelColor: e.target.checked ? undefined : false } })} />
          </label>
          <label className="frow">
            <span>Separators</span>
            <input type="checkbox" checked={cg.separators ?? true} onChange={(e) => set({ categoryGroups: { ...cg, separators: e.target.checked ? undefined : false } })} />
          </label>
          <label className="frow">
            <span>Group names</span>
            <input type="checkbox" checked={cg.names ?? true} onChange={(e) => set({ categoryGroups: { ...cg, names: e.target.checked ? undefined : false } })} />
          </label>
          <label className="frow">
            <span>Block tint</span>
            <input type="checkbox" checked={cg.tint ?? false} onChange={(e) => set({ categoryGroups: { ...cg, tint: e.target.checked || undefined } })} />
          </label>
          {cg.tint && (
            <label className="frow">
              <span>Tint strength</span>
              <input
                type="range"
                min={0.02}
                max={0.3}
                step={0.02}
                value={cg.tintOpacity ?? 0.06}
                onChange={(e) => set({ categoryGroups: { ...cg, tintOpacity: Number(e.target.value) } })}
              />
            </label>
          )}
          {groupNames.map((g, i) => (
            <label className="frow" key={g}>
              <span>{g}</span>
              <ColorInput
                className="colorin"
                value={cg.colors?.[g] ?? seriesColor(i, OKABE_ITO)}
                aria-label={`Colour for group ${g}`}
                onChange={(c) => set({ categoryGroups: { ...cg, colors: { ...(cg.colors ?? {}), [g]: c } } })}
              />
            </label>
          ))}
          <p className="note" style={{ fontSize: 11 }}>
            States the grouping several ways at once — coloured category labels, a rule
            between groups, the group’s name alongside the axis, and an optional block
            tint. Drag a group name to reposition it.{" "}
            {cg.map
              ? "To rename a group, change its name in the boxes above."
              : "Its TEXT comes from the column, so rename it in the datasheet."}
          </p>
        </>
      )}
    </SubSection>
  );

  // The clicked axis's tick labels are drawn with that on-screen axis's own font (`fonts.yTick` is
  // `plot.yAxis.tickFont` whichever way the chart faces), and the controls below read and write there, not the
  // swapped data axis's font (`spec`), which on a horizontal bar would show the numbers' size in the names' Size box.
  // Every font box below shows the axis's own font over the chart-wide one, field by field (`mergeFontSpec`, as the
  // builder draws it), so a house style's 22px titles do not show as the grey built-in "15". Edits merge into the
  // axis's own font only, so the chart-wide size is never baked into it.
  const tickFontSpec = (axis === "x" ? plot.xAxis : axis === "y2" ? plot.y2Axis : axis === "y3" ? plot.y3Axis : plot.yAxis)?.tickFont;

  if (bandX) {
    return (
      <>
        <div className="insphd">{axis === "x" ? "X" : "Y"} axis (categories)</div>
        {axisSwitch}
        <label className="frow">
          <span>Title</span>
          <input {...textProps("title")} placeholder={colTitle} />
        </label>
        {titleDirection}
        {axisLengthGroup}
        {axisLineSection}
        {/* Label rotation, hide axis and spacing, all honoured by the builder on a category
            axis. Rotation and Hide are the same rows the continuous panel renders. */}
        <SubSection title="Category labels" open>
          {labelRotationRow}
          {hideAxisRow("Hide this axis's ticks, category labels, and title (keeps the data mapping). Pair with frame 'None' for a clean, axis-free look.")}
        </SubSection>
        {spacingSection}
        {hasCategoryGroups && categoryGroupsSection}
        {/* Note: the category axis includes the Fonts section, so clicking the axis carrying
            the category names — the obvious place to look — offers the size and font of those
            names directly. */}
        <div ref={fontsRef}>
          <SubSection key={selection.focus === "labels" ? "fonts-labels" : "fonts"} title="Fonts" open>
            <FontControls
              label={`${axis === "x" ? "X" : "Y"}-axis title font`}
              element="axisTitle"
              spec={axisTitleFontSpec(plot, dataAxis)}
              defaultSize={15}
              onSetPlotFont={onSetPlotFont}
              onSet={(patch) => onSetAxisTitleFont(dataAxis, patch)}
            />
            {/* Named for what it is on this axis — these are your category names, not tick
                numbers — and sized independently of the value axis via `AxisSpec.tickFont`.
                Most bar figures want the names larger than the numbers, which one shared
                size could not express. */}
            <FontControls
              label="Category label font"
              element="tick"
              spec={mergeFontSpec(plot.fonts?.tick, tickFontSpec)}
              defaultSize={13}
              onSetPlotFont={onSetPlotFont}
              onSet={(patch) => onSetAxis(axis, { tickFont: { ...(tickFontSpec ?? {}), ...patch } })}
            />
          </SubSection>
        </div>
        <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
          This is a category axis — each tick is a dataset or row, so scale / range / number
          formatting live on the <strong>value ({axis === "x" ? "Y" : "X"}) axis</strong> (click it).
        </p>
      </>
    );
  }

  return (
    <>
      <div className="insphd">{axis === "x" ? "X axis" : axis === "y2" ? (topSecond ? "X2 axis (top)" : "Y2 axis (right)") : axis === "y3" ? "Y3 axis (right)" : "Y axis"}</div>
      {axisSwitch}
      {y2EmptyNote}
      {seriesAxisPicker}
      <label className="frow">
        <span>Title</span>
        <input {...textProps("title")} placeholder={colTitle} />
      </label>
      {titleDirection}

      <SubSection title="Scale">
        {/* A bar chart's right (Y2) axis is drawn linear — the builder refuses any other scale
            with a warning, so the row that would ask for one is withheld here. */}
        {!(plot.kind === "bar" && dataAxis === "y2") && (
        <label className="frow">
          <span>Type</span>
          <select
            className="selin"
            value={scale}
            onChange={(e) =>
              set({ scale: e.target.value === "auto" ? undefined : (e.target.value as AxisScale) })
            }
          >
            <option value="auto">Auto</option>
            <option value="linear">Linear</option>
            <option value="log10">Log₁₀</option>
            <option value="log2">Log₂</option>
            <option value="ln">Ln (natural)</option>
            <option value="probit">Probability (probit)</option>
          </select>
        </label>
        )}
        <label className="frow">
          <span>Reversed</span>
          <input
            type="checkbox"
            checked={spec.reversed ?? false}
            onChange={(e) => set({ reversed: e.target.checked || undefined })}
          />
        </label>
        {EQUAL_ASPECT_KINDS.has(plot.kind ?? "xy") && (axis === "x" || axis === "y") && (
          <label
            className="frow"
            title="Make one data unit the same number of pixels on X as on Y, so a distance on the graph means the same thing in both directions. MadY widens whichever axis is packed too tightly — it never shrinks the plot, so nothing goes out of view. Zooming keeps the 1:1 scale: the axis you window stays put and the other follows. Needs two linear axes without breaks; an axis range you set by hand is left alone."
          >
            <span>Equal aspect (1:1)</span>
            <input
              type="checkbox"
              aria-label="Equal aspect (same scale on both axes)"
              checked={plot.equalAspect === true}
              onChange={(e) => onSetPlotOptions({ equalAspect: e.target.checked })}
            />
          </label>
        )}
        {hideAxisRow("Hide this axis's ticks, numbers, and title (keeps the data mapping). Pair with a scale bar (and frame 'None') for the clean imaging look.")}
        <label className="frow">
          <span>Scale bar</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              className="numin"
              style={{ width: 70 }}
              placeholder="length"
              min={0}
              value={spec.scaleBar?.length ?? ""}
              title="Draw a corner scale bar of this many data units instead of a numbered axis."
              onChange={(e) => {
                const n = Number(e.target.value);
                set({ scaleBar: e.target.value !== "" && n > 0 ? { length: n, ...(spec.scaleBar?.label ? { label: spec.scaleBar.label } : {}) } : undefined });
              }}
            />
            <input
              type="text"
              className="numin"
              style={{ width: 70 }}
              placeholder="label"
              value={spec.scaleBar?.label ?? ""}
              disabled={!spec.scaleBar}
              onChange={(e) => spec.scaleBar && set({ scaleBar: { length: spec.scaleBar.length, ...(e.target.value ? { label: e.target.value } : {}) } })}
            />
          </span>
        </label>
      </SubSection>

      <SubSection title="Range">
        <label className="frow">
          <span>Min / Max</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input {...numProps("min")} placeholder="auto" style={{ width: 58 }} />
            <input {...numProps("max")} placeholder="auto" style={{ width: 58 }} />
          </span>
        </label>
      </SubSection>

      {/* Order: Fonts → Spacing → Axis line → Numbering, right under Range. */}
      <div ref={fontsRef}>
      <SubSection key={selection.focus === "labels" ? "fonts-labels" : "fonts"} title="Fonts" open>
      <FontControls
        label={`${axis === "x" ? "X" : axis === "y2" || axis === "y3" ? rightLabel : "Y"}-axis title font`}
        element="axisTitle"
        spec={axisTitleFontSpec(plot, dataAxis)}
        defaultSize={15}
        onSetPlotFont={onSetPlotFont}
        onSet={(patch) => onSetAxisTitleFont(dataAxis, patch)}
      />
      {/* Per-axis (`AxisSpec.tickFont`), not plot-wide: the value axis's numbers size
          independently of a category axis's names. Falls back to the shared `fonts.tick`
          when this axis has no override, so an untouched figure is unchanged. */}
      <FontControls
        label="Tick label font"
        element="tick"
        spec={mergeFontSpec(plot.fonts?.tick, tickFontSpec)}
        defaultSize={13}
        onSetPlotFont={onSetPlotFont}
        onSet={(patch) => onSetAxis(axis, { tickFont: { ...(tickFontSpec ?? {}), ...patch } })}
      />
      </SubSection>
      </div>

      {spacingSection}

      {axisLineSection}

      <SubSection title="Ticks">
        <label className="frow">
          <span>Tick interval</span>
          <input {...numProps("majorStep")} min={0} placeholder="auto" />
        </label>
        <label className="frow">
          <span>Minor ticks</span>
          <input {...numProps("minorCount")} min={0} max={20} step={1} placeholder="none" />
        </label>
      </SubSection>

      <div ref={numberingRef}>
      <SubSection key={selection.focus === "numbers" ? "numbering-open" : "numbering"} title="Numbering" open={selection.focus === "numbers"}>
        <label className="frow">
          <span>Format</span>
          <select
            className="selin"
            value={fmt}
            onChange={(e) =>
              set({ format: e.target.value === "auto" ? undefined : (e.target.value as NumberFormat) })
            }
          >
            <option value="auto">Auto</option>
            {NUMBER_FORMAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="frow">
          <span>Decimals</span>
          <input {...numProps("decimals")} min={0} max={10} placeholder="auto" />
        </label>
        {labelRotationRow}
        <TickAffixRows spec={spec} set={set} />
      </SubSection>
      </div>

      <SubSection title="Breaks (cuts)" open={false}>
        {(spec.breaks ?? []).map((b, i) => (
          <label className="frow" key={i}>
            <span>{b.from} – {b.to}</span>
            <button
              type="button"
              className="swbtn"
              title="Remove this break"
              onClick={() => {
                const next = (spec.breaks ?? []).filter((_, j) => j !== i);
                set({ breaks: next.length ? next : undefined });
              }}
            >
              ⨯
            </button>
          </label>
        ))}
        <div className="frow" style={{ gap: 6 }}>
          <input type="number" className="numin" style={{ width: 70 }} aria-label="Break start" placeholder="from" value={brkFrom} onChange={(e) => setBrkFrom(e.target.value)} />
          <input type="number" className="numin" style={{ width: 70 }} aria-label="Break end" placeholder="to" value={brkTo} onChange={(e) => setBrkTo(e.target.value)} />
          <button
            type="button"
            className="btn-mini"
            onClick={() => {
              const from = Number(brkFrom);
              const to = Number(brkTo);
              if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
              const lo = Math.min(from, to);
              const hi = Math.max(from, to);
              set({ breaks: [...(spec.breaks ?? []), { from: lo, to: hi }] });
              setBrkFrom("");
              setBrkTo("");
            }}
          >
            Add cut
          </button>
        </div>
        <div className="frow" style={{ gap: 6 }}>
          <button
            type="button"
            className="btn-mini"
            disabled={!cutSuggestion}
            title={cutSuggestion ? `Suggest a cut at ${cutSuggestion.from} – ${cutSuggestion.to}` : "No single empty band dominates this axis"}
            onClick={() => {
              if (!cutSuggestion) return;
              setBrkFrom(String(cutSuggestion.from));
              setBrkTo(String(cutSuggestion.to));
            }}
          >
            Suggest cut
          </button>
          {cutSuggestion && <span className="note" style={{ fontSize: 11 }}>outlier gap {cutSuggestion.from} – {cutSuggestion.to}</span>}
        </div>
        {(spec.breaks?.length ?? 0) > 0 && (
          <label className="frow">
            <span>Break mark</span>
            <select className="selin" value={spec.breakStyle ?? "slash"} onChange={(e) => set({ breakStyle: e.target.value === "slash" ? undefined : (e.target.value as "slash" | "zigzag" | "gap") })}>
              <option value="slash">Slash ∕∕</option>
              <option value="zigzag">Zigzag</option>
              <option value="gap">Gap (no mark)</option>
            </select>
          </label>
        )}
        <p className="note" style={{ fontSize: 11 }}>
          Compress a data range out of the axis (a broken axis). Works on linear and log
          axes; add several cuts. “Suggest cut” proposes one when a far outlier leaves a big gap.
        </p>
      </SubSection>

      <SubSection title="Custom ticks" open={false}>
        {(spec.extraTicks ?? []).map((t, i) => (
          <label className="frow" key={i}>
            <span>{t.value}{t.label ? ` · ${t.label}` : ""}</span>
            <button type="button" className="swbtn" title="Remove this tick" onClick={() => {
              const next = (spec.extraTicks ?? []).filter((_, j) => j !== i);
              set({ extraTicks: next.length ? next : undefined });
            }}>⨯</button>
          </label>
        ))}
        <div className="frow" style={{ gap: 6 }}>
          <input type="number" className="numin" style={{ width: 64 }} aria-label="New tick value" placeholder="value" value={tickVal} onChange={(e) => setTickVal(e.target.value)} />
          <input type="text" className="numin" style={{ width: 80 }} aria-label="New tick label" placeholder="label (opt)" value={tickLbl} onChange={(e) => setTickLbl(e.target.value)} />
          <button type="button" className="btn-mini" onClick={() => {
            const v = Number(tickVal);
            if (!Number.isFinite(v)) return;
            set({ extraTicks: [...(spec.extraTicks ?? []), { value: v, ...(tickLbl.trim() ? { label: tickLbl.trim() } : {}) }] });
            setTickVal(""); setTickLbl("");
          }}>Add tick</button>
        </div>
        <p className="note" style={{ fontSize: 11 }}>Extra labelled ticks + gridlines at exact values (e.g. a threshold). Blank label = the formatted number.</p>
      </SubSection>

      <SubSection title="Shaded bands" open={false}>
        {(spec.bands ?? []).map((b, i) => (
          <label className="frow" key={i}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 11, height: 11, borderRadius: 2, background: b.color ?? "#3b82f6", display: "inline-block" }} />
              {b.from} – {b.to}{b.label ? ` · ${b.label}` : ""}
            </span>
            <button type="button" className="swbtn" title="Remove this band" onClick={() => {
              const next = (spec.bands ?? []).filter((_, j) => j !== i);
              set({ bands: next.length ? next : undefined });
            }}>⨯</button>
          </label>
        ))}
        <div className="frow" style={{ gap: 6 }}>
          <input type="number" className="numin" style={{ width: 60 }} aria-label="Band start" placeholder="from" value={bandFrom} onChange={(e) => setBandFrom(e.target.value)} />
          <input type="number" className="numin" style={{ width: 60 }} aria-label="Band end" placeholder="to" value={bandTo} onChange={(e) => setBandTo(e.target.value)} />
          <ColorInput className="colorin" value={bandColor} aria-label="Band colour" onChange={(c) => setBandColor(c)} />
          <button type="button" className="btn-mini" onClick={() => {
            const from = Number(bandFrom); const to = Number(bandTo);
            if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
            set({ bands: [...(spec.bands ?? []), { from: Math.min(from, to), to: Math.max(from, to), color: bandColor }] });
            setBandFrom(""); setBandTo("");
          }}>Add band</button>
        </div>
        <p className="note" style={{ fontSize: 11 }}>Shade the plot between two axis values (a “normal range” strip that moves with the scale).</p>
      </SubSection>

      {/* No category-groups section here. This is the continuous branch — it renders only when
          the axis is not banded — and on an xy, area, bubble, volcano, PCA or Bland-Altman chart a
          grouping control would have no categories to group. Banded and "honours
          categoryGroups" are the same condition, so a continuous axis never has one. */}

      {axisLengthGroup}

      <p className="note" style={{ fontSize: 11, marginTop: 8 }}>
        Leave range or decimals blank for auto. The title overrides the column name. The
        <strong> {axis === "x" ? "X" : "Y"}-axis title font</strong> is independent of the other axis;
        leave a field blank to inherit the shared axis-title font. Tick fonts apply to both axes.
      </p>
    </>
  );
}

const ERROR_TYPES: ReadonlyArray<[string, string]> = [
  ["none", "None"],
  ["sd", "Mean ± SD"],
  ["sem", "Mean ± SEM"],
  ["ci95", "Mean ± 95% CI"],
  ["range", "Mean + range"],
  ["geoSd", "Geometric (×/÷ SD)"],
  // The median lives here, not in a separate "centre" switch. The line can trace the median
  // or the mean — but a centre × interval grid would offer "median ± SD", which is
  // not a statistic anybody means. Each entry names its own centre, so every choice is one
  // somebody would defend in a methods section.
  ["iqr", "Median + IQR (Q1–Q3)"],
];

/** How the chosen interval is drawn. Not what it is — that is `ERROR_TYPES` above. */
const ERROR_DISPLAYS: ReadonlyArray<[string, string]> = [
  ["bars", "Error bars"],
  ["band", "Shaded band"],
  ["both", "Both"],
];

const ERROR_DIRS: ReadonlyArray<[string, string]> = [
  ["both", "Both (above + below)"],
  ["up", "Above only"],
  ["down", "Below only"],
];

const WHISKER_SIDES: ReadonlyArray<[string, string]> = [
  ["both", "Both (upper + lower)"],
  ["upper", "Upper only"],
  ["lower", "Lower only"],
];

/** One-click "overall layout" presets — reposition the title + legend together
 *  (Format → Layout). Size/fonts/colours are untouched; this is pure placement. */
const LAYOUT_PRESETS: ReadonlyArray<{
  label: string;
  hint: string;
  titleAlign: NonNullable<Plot["titleAlign"]>;
  legend: Partial<NonNullable<Plot["legend"]>>;
  frame: FrameStyle;
}> = [
  { label: "Default", hint: "Centred title, legend outside on the right", titleAlign: "center", legend: { position: "right", orientation: "vertical", border: false, background: false }, frame: "lshape" },
  { label: "Compact", hint: "Legend tucked inside the top-right corner to save space", titleAlign: "center", legend: { position: "topright", orientation: "vertical", border: true, background: true }, frame: "box" },
  { label: "Manuscript", hint: "Left-aligned (editorial) title, legend inside top-left, clean frame", titleAlign: "left", legend: { position: "topleft", orientation: "vertical", border: false, background: false }, frame: "lshape" },
  { label: "Banner", hint: "Wide horizontal legend along the bottom-right", titleAlign: "center", legend: { position: "bottomright", orientation: "horizontal", border: false, background: false }, frame: "lshape" },
];

const PIE_LABELS: ReadonlyArray<[string, string]> = [
  ["percent", "Percentage"],
  ["value", "Value"],
  ["label", "Category"],
  ["label-percent", "Category + %"],
  ["label-value", "Category + value"],
  ["none", "None"],
];

/**
 * The colour-shaping block — one control, every ramp in the program.
 *
 * Four knobs that turn a ramp (any built-in, or a user-built gradient) into the mapping this
 * particular dataset needs: where its middle sits, how the detail is spread, whether it is
 * continuous or a set of classes, and which colour space it blends through. Rendered directly
 * under whichever ramp dropdown the user is already looking at — heatmap, parallel coordinates,
 * timeline tracks, ridgeline spectrum — and mirrored as four rows in the per-series matrix for
 * graduated fills and colour-by-a-column. Setting none of them leaves the ramp exactly as the
 * default drawing.
 */
export function RampShapeRows(props: {
  midpoint: number | undefined;
  gamma: number | undefined;
  steps: number | undefined;
  space: "rgb" | "hsl" | "lab" | undefined;
  onChange: (patch: { midpoint?: number | undefined; gamma?: number | undefined; steps?: number | undefined; space?: "rgb" | "hsl" | "lab" | undefined }) => void;
}): ReactNode {
  const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));
  return (
    <>
      <label className="frow" title="The data value that takes the middle colour of the ramp. Pin it to 0 and a blue–white–red map reads correctly. Blank = the centre of the data.">
        <span>Centre at</span>
        <input
          type="number" className="numin" placeholder="auto" aria-label="Centre the colour ramp at this value"
          value={props.midpoint ?? ""} onChange={(e) => props.onChange({ midpoint: num(e.target.value) })}
        />
      </label>
      <label className="frow" title="Bends the ramp toward the low end (above 1) or the high end (below 1) without moving the end colours — useful when most of the data is bunched at one end. Blank = even.">
        <span>Detail bias</span>
        <input
          type="number" className="numin" placeholder="even" step={0.1} min={0.2} max={5} aria-label="Colour detail bias"
          value={props.gamma ?? ""} onChange={(e) => props.onChange({ gamma: num(e.target.value) })}
        />
      </label>
      <label className="frow" title="Draw the ramp as this many discrete colour classes instead of a smooth sweep (the classic 5-class map). Blank = smooth.">
        <span>Colour steps</span>
        <input
          type="number" className="numin" placeholder="off" step={1} min={2} max={24} aria-label="Number of discrete colour steps"
          value={props.steps ?? ""} onChange={(e) => props.onChange({ steps: num(e.target.value) })}
        />
      </label>
      <label className="frow" title="How colours are blended between the ramp's stops. Straight blends the colours directly and is the default; Vivid keeps a rainbow saturated instead of passing through grey; Perceptual makes equal steps look equal.">
        <span>Blend</span>
        <select className="selin" aria-label="Colour blending space" value={props.space ?? "rgb"} onChange={(e) => props.onChange({ space: e.target.value as "rgb" | "hsl" | "lab" })}>
          <option value="rgb">Straight (RGB)</option>
          <option value="hsl">Vivid (HSL)</option>
          <option value="lab">Perceptual (Lab)</option>
        </select>
      </label>
    </>
  );
}

/**
 * The ramp pickers' shared tail.
 *
 * Every ramp dropdown in the program ends the same way: the built-ins, then the project's own
 * gradients, then "Edit / new gradient…". Built here so a new picker cannot forget the tail —
 * and so the editor is reachable from wherever the user already is, rather than from a panel
 * they have to go and find.
 */
export const EDIT_RAMP = "__edit_gradient__";

export function rampOptions(
  base: ReadonlyArray<readonly [string, string]>,
  gradients: readonly Gradient[],
  offerEditor = true,
): [string, string][] {
  return [
    ...base.map(([v, l]) => [v, l] as [string, string]),
    ...gradients.map((g) => [`custom:${g.id}`, `${g.name} (mine)`] as [string, string]),
    ...(offerEditor ? [[EDIT_RAMP, "Edit / new gradient…"] as [string, string]] : []),
  ];
}

/**
 * The gradient the editor should open on when the user picks "Edit / new gradient…" from a row
 * currently showing `ref`.
 *
 * Editing a built-in never mutates it: the 17 built-ins are what every gallery card, guide
 * screenshot and saved figure is drawn with. Picking "Edit" on viridis hands back a copy, named
 * for its source, with viridis's real stops already on the bar, so editing a built-in ramp
 * starts from that ramp.
 */
export function gradientToEdit(ref: string, gradients: readonly Gradient[], newId: string): Gradient {
  const existing = gradients.find((g) => `custom:${g.id}` === ref);
  if (existing) return existing;
  const label = String(ref).replace(/^custom:/, "");
  const stops = makeRamp(resolveBuiltinRamp(ref as GradRamp), "#2266cc", "#1a1a1a", false);
  return {
    id: newId,
    name: `${label.charAt(0).toUpperCase()}${label.slice(1)} (custom)`,
    mode: "stops",
    stops: Array.from({ length: 9 }, (_v, i) => ({ pos: i / 8, color: stops(i / 8).color })),
  };
}

/** The built-in colour ramps — the heatmap's Colormap list, also the gallery's Colour ramp control. */
export const HEATMAP_COLORMAPS: ReadonlyArray<[string, string]> = [
  ["viridis", "Viridis"],
  ["magma", "Magma"],
  ["plasma", "Plasma"],
  ["inferno", "Inferno"],
  ["cividis", "Cividis"],
  ["turbo", "Turbo"],
  ["coolwarm", "Cool–warm (diverging)"],
  ["spectral", "Spectral (diverging)"],
  ["blues", "Blues"],
  ["reds", "Reds"],
  ["greens", "Greens"],
  ["rainbow", "Rainbow"],
  ["grayscale", "Grayscale"],
];

/** The marker-shape dropdown — held to the `SymbolShape` union by marker-shapes-own.test. */
export const SHAPES: ReadonlyArray<[string, string]> = [
  ["circle", "Circle"],
  ["square", "Square"],
  ["triangle", "Triangle ▲"],
  ["triangle-down", "Triangle ▼"],
  ["diamond", "Diamond"],
  ["pentagon", "Pentagon"],
  ["hexagon", "Hexagon"],
  ["octagon", "Octagon"],
  ["star", "Star"],
  ["plus", "Plus"],
  ["cross", "Cross ✕"],
  ["ring", "Ring ◎"],
  ["squircle", "Squircle"],
  ["oval", "Oval"],
  ["waffle", "Waffle ▦"],
  ["none", "None"],
];

const SYMBOL_FILLS: ReadonlyArray<[string, string]> = [
  ["solid", "Solid"],
  ["open", "Open (hollow)"],
  ["twotone", "Two-tone (light fill + dark edge)"],
  ["clear", "Clear (see-through)"],
];

const FILL_TYPES: ReadonlyArray<[string, string]> = [
  ["solid", "Solid colour"],
  ["twotone", "Two-tone (light fill + dark edge)"],
  ["pattern", "Pattern"],
  ["gradient", "Gradient"],
  ["graduated", "Value-graduated"],
  ["metallic", "Metallic ✨"],
  ["special", "Themed ✦"],
];

const GRAD_MAPS: ReadonlyArray<[string, string]> = [
  ["value", "Bar / box value"],
  ["x", "X position"],
  ["order", "Order (left→right)"],
];

const GRAD_RAMPS: ReadonlyArray<[string, string]> = [
  ["lightness", "Lightness (light→dark)"],
  ["transparency", "Transparency (faint→opaque)"],
  ["lightness-transparency", "Lightness + transparency"],
  ["twocolor", "Two-colour"],
  ["viridis", "Viridis"],
  ["magma", "Magma"],
  ["plasma", "Plasma"],
  ["inferno", "Inferno"],
  ["cividis", "Cividis"],
  ["turbo", "Turbo"],
  ["grayscale", "Grayscale"],
  ["rainbow", "Rainbow"],
  ["blues", "Blues"],
  ["reds", "Reds"],
  ["greens", "Greens"],
  ["spectral", "Spectral"],
  ["coolwarm", "Cool–warm"],
];

const PATTERNS: ReadonlyArray<[string, string]> = [
  ["hatch", "Diagonal hatch"],
  ["hatch-cross", "Cross-hatch"],
  ["horizontal", "Horizontal lines"],
  ["vertical", "Vertical lines"],
  ["grid", "Grid"],
  ["dots", "Polka dots"],
  ["dots-lg", "Big dots"],
  ["rings", "Rings"],
  ["checker", "Checker"],
  ["squares", "Squares"],
  ["zigzag", "Zigzag"],
  ["chevron", "Chevron"],
  ["waves", "Waves"],
  ["scales", "Fish scales"],
  ["triangles", "Triangles"],
  ["diamond", "Diamond lattice"],
  ["herringbone", "Herringbone"],
  ["basketweave", "Basket weave"],
  ["brick", "Brick"],
  ["plus", "Plus signs"],
  ["crosses", "Crosses"],
  ["stipple", "Stipple"],
];

const METALLICS: ReadonlyArray<[string, string]> = [
  ["silver", "Silver"],
  ["gold", "Gold"],
  ["bronze", "Bronze"],
  ["copper", "Copper"],
  ["chrome", "Chrome"],
  ["rosegold", "Rose gold"],
  ["platinum", "Platinum"],
  ["gunmetal", "Gunmetal"],
  ["brass", "Brass"],
  ["pearl", "Pearl"],
  ["oilslick", "Oil slick"],
  ["holographic", "Holographic"],
];

const SPECIALS: ReadonlyArray<[string, string]> = [
  ["facets", "Rainbow facets"],
  ["cards", "Card back"],
  ["night", "Night sky"],
  ["stars", "Stars"],
  ["galaxy", "Galaxy"],
  ["ocean", "Ocean"],
  ["sunset", "Sunset"],
  ["carbon", "Carbon fibre"],
  ["honeycomb", "Honeycomb"],
  ["bubbles", "Bubbles"],
  ["confetti", "Confetti"],
  ["camo", "Camouflage"],
];

const PATTERN_BGS: ReadonlyArray<[string, string]> = [
  ["none", "Transparent"],
  ["#ffffff", "White"],
  ["#000000", "Black"],
  ["#e8e8e8", "Light grey"],
];

const CONNECTS: ReadonlyArray<[string, string]> = [
  ["none", "None"],
  ["straight", "Straight"],
  ["step", "Step (centre)"],
  ["stepBefore", "Step (before)"],
  ["stepAfter", "Step (after)"],
  ["smooth", "Smooth (monotone)"],
  ["cardinal", "Cardinal (tension)"],
  ["catmullRom", "Catmull–Rom"],
  ["basis", "B-spline"],
  ["natural", "Natural"],
];

const DASHES: ReadonlyArray<[string, string]> = [
  ["solid", "Solid"],
  ["dashed", "Dashed"],
  ["longdash", "Long dash"],
  ["dotted", "Dotted"],
  ["dashdot", "Dash-dot"],
];

/**
 * Curated colour-picker palette — a tight, diverse 14-swatch set, sized to fit on one
 * row at the standard panel width. Keeps the essentials
 * (blue · green · red · orange · yellow · purple · grey · black) plus a few extra hues
 * for variety. Mostly Okabe-Ito (colourblind-safe) with a true red, grey + purple added.
 */
const SWATCHES: readonly string[] = [
  "#0072B2", // blue
  "#56B4E9", // sky blue
  "#17BECF", // cyan
  "#009E73", // green
  "#F0E442", // yellow
  "#E69F00", // orange
  "#D55E00", // vermillion
  "#D62728", // red
  "#CC79A7", // pink
  "#9467BD", // purple
  "#E377C2", // magenta
  "#8C564B", // brown
  "#7F7F7F", // grey
  "#000000", // black
];
