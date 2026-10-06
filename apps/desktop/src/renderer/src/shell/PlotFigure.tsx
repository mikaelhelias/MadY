import { Fragment, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactElement, ReactNode } from "react";
import type { PlotScene, MarkScene, SeriesScene, FillSpec, ResolvedFont, AnnotationScene, AxisScene } from "@mady/graphics";
import { DATA_DRIVEN_KINDS, legendBoxWidth, legendLabelText, swarmDotRadius, xTickLabelPlacement, yTickLabelPlacement, ZONE_KEY_PAD, ZONE_KEY_GAP, ZONE_KEY_ROW } from "@mady/graphics";
import type { MetallicKind, PatternKind, SpecialKind } from "@mady/core";
import { isReferenceLine } from "@mady/core";
import type { GraphSelection } from "./AppShell";
import { BOX_SELECT_KINDS, pointsInBox } from "./boxSelect";
import { axisTicksAreNumbers } from "./axisNumbers";
import { captionCentre, keyDash, LEGEND_DOCK_REACH, LEGEND_UNDOCK_REACH, LegendDockContext, legendDropBox, nearBox } from "./legendDock";
import type { LegendDock } from "./legendDock";
import type { LegendRowTarget } from "./legendRename";
import type { PickedPoint } from "./boxSelect";
import type { GraphView } from "./DocumentArea";
import { fromS, toS, valueAtPx } from "./axisValue";

/**
 * `useState` for live drag-preview state, but the setter is coalesced to at most one update per
 * animation frame. A pointer-move fires far faster than the screen refreshes (100–240/s vs ~60),
 * and each drag-preview change re-renders the whole figure (every mark) — so an un-coalesced
 * drag would redraw ~2,800 points several times per displayed frame and become sluggish.
 *
 * This changes only how often the figure re-renders, never what it draws: the value applied is
 * always the latest one set, so the drag looks identical (smoother, if anything). The drag
 * handlers all compute from a captured start-ref + the current pointer, never from this state, so
 * a coalesced (briefly-stale) value cannot corrupt a drag. The end-of-drag `null` coalesces too:
 * for the one frame before it lands, the preview value equals the just-committed value, so there
 * is no flicker.
 */
function useRafState<T>(initial: T): [T, (v: T) => void] {
  const [state, setState] = useState<T>(initial);
  const raf = useRef<number | null>(null);
  const pending = useRef<T>(initial);
  useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);
  const set = useCallback((v: T): void => {
    pending.current = v;
    if (raf.current == null) {
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        setState(pending.current);
      });
    }
  }, []);
  return [state, set];
}

/**
 * A text element editable in place on the canvas (double-click → inline overlay
 * editor). `title`/`subtitle`/`axisTitle` reuse the existing plot commands;
 * `annotation` edits a text-box body.
 */
export type TextTarget =
  | { kind: "title" }
  | { kind: "subtitle" }
  /** `y2` / `y3`: the second and third value axes' titles, editable in place. */
  | { kind: "axisTitle"; axis: "x" | "y" | "y2" | "y3" }
  | { kind: "scatter3dZTitle" }
  | { kind: "annotation"; id: string }
  | { kind: "value"; columnId: string; rowId: string }
  | { kind: "bubbleLegendTitle" }
  | { kind: "heatSplitLabel"; axis: "row" | "col"; at: number }
  | { kind: "heatTrackName"; axis: "row" | "col"; index: number }
  | { kind: "heatTrackRunLabel"; axis: "row" | "col"; index: number; value: string }
  /** `ids` = the datasets/rows this label actually names (the drawn order is not the table
   *  order); `groupValue` is set when the label names a collapsed group. */
  | { kind: "heatmapColLabel"; col: number; ids?: string[]; groupValue?: string; trackIndex?: number }
  | { kind: "heatmapRowLabel"; row: number; ids?: string[]; groupValue?: string; groupColumn?: string }
  | { kind: "corrColLabel"; col: number }
  | { kind: "corrRowLabel"; row: number }
  | { kind: "radarSpokeLabel"; rowId: string }
  | { kind: "colorbarTitle" }
  /** The count waffle's caption under the grid ("1 icon = 3 patients"). */
  | { kind: "waffleCaption" }
  | { kind: "treemapCellLabel"; rowId: string }
  | { kind: "networkNodeLabel"; nodeId: string }
  /** A Venn set's label — editing it renames the set's source column (the heatmap rule). */
  | { kind: "vennSetLabel"; datasetId: string }
  /** An UpSet matrix set label — same rename-the-column rule, its own target because the
   *  matrix row is its own element. */
  | { kind: "upsetSetLabel"; datasetId: string }
  /** A ternary edge title (= a composition column's name) — editing renames the column. */
  | { kind: "ternaryAxisTitle"; datasetId: string }
  /** A polar histogram's compass letter, by its default words ("N", "45°"…). */
  | { kind: "roseDirection"; key: string }
  /** An oncoprint gene / sample name (it IS the data: a rename edits its cells). */
  | { kind: "oncoprintLabel"; axis: "gene" | "sample"; name: string }
  /** A direct label — the series' name printed beside its own data in place of a legend row.
   *  Editing it renames the source column, the same rule the Venn/UpSet/ternary labels follow:
   *  the label is the header, so changing it anywhere changes it everywhere. */
  | { kind: "directLabel"; datasetId: string }
  /** A legend row's words — renamed per what the row names (legendRename.ts). */
  | LegendRowTarget
  /** Lines of the single fit's parameter block, by statistic key: one key when a line is edited on
   *  its own, every shown key (in order) when the block moves together and is edited whole. */
  | { kind: "fitParams"; keys: string[] };

/** Live inline-editor state: which element, its seed text + screen rect (relative to the figure wrapper). */
interface TextEdit {
  target: TextTarget;
  value: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  anchor: "start" | "middle" | "end";
  multiline: boolean;
  /** Source text's resolved style, so the inline editor matches it exactly. */
  fontWeight?: string | undefined;
  fontFamily?: string | undefined;
  fontStyle?: string | undefined;
  color?: string | undefined;
}


/** Soft-lock band: how close (as a fraction of the home span) snaps back to home. */
const SNAP = 0.04;

/**
 * What backs a figure: the paper fill plus the opt-in decorative backdrop (gradient +
 * wave bands), drawn before all content.
 *
 * Note: one component serves every figure (the main one and each bespoke one) on purpose. A
 * separate `<rect>` per figure would mean several pieces of code deciding the same thing
 * independently, which is how figure-geometry defects arise. Add anything that backs a figure here, never at a call site.
 */
/**
 * Axis-anchored shaded bands (Axis tab ▸ Bands) — behind everything, purely visual.
 *
 * One renderer, used by every figure that draws an axis, including the lollipop and paired-dot
 * charts, which draw their own components. Without it the builder would produce the band and
 * nothing would render it, leaving "Bands" without effect on those charts.
 */
function AxisBands({ scene }: { scene: PlotScene }): ReactNode {
  if (!scene.axisBands?.length) return null;
  return (
    <>
      {scene.axisBands.map((b, i) => (
        <g key={`axband-${i}`} pointerEvents="none">
          <rect x={b.x} y={b.y} width={Math.max(0, b.w)} height={Math.max(0, b.h)} fill={b.color} fillOpacity={b.opacity} />
          {b.label && (
            <text x={b.labelX} y={b.labelY} {...fontAttrs(scene.fonts.legend, b.color)} fill={b.color} opacity={0.85}>{b.label}</text>
          )}
        </g>
      ))}
    </>
  );
}

function FigureBackdrop({ scene }: { scene: PlotScene }): ReactNode {
  const uid = useId();
  const bd = scene.backdrop;
  if (!scene.background && !bd) return null;
  // Def ids must be unique per figure instance — panel assembly renders many at once.
  const gradId = `${uid}-bd`.replace(/:/g, "");
  return (
    <>
      {scene.background && <rect x={0} y={0} width={scene.width} height={scene.height} fill={scene.background} />}
      {bd && (
        <g pointerEvents="none" opacity={bd.opacity}>
          <defs>
            <linearGradient id={gradId} x1={bd.x1} y1={bd.y1} x2={bd.x2} y2={bd.y2}>
              {bd.stops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={scene.width} height={scene.height} fill={`url(#${gradId})`} />
          {bd.waves.map((w, i) => (
            <path key={i} d={w.d} fill={w.fill} fillOpacity={w.opacity} />
          ))}
          {/* legibility scrim — over the decoration, under all content, so the figure's
              own near-black text stays readable on a dark palette */}
          {bd.scrim && (
            <rect x={0} y={0} width={scene.width} height={scene.height} fill={bd.scrim.color} fillOpacity={bd.scrim.opacity} />
          )}
        </g>
      )}
    </>
  );
}

/** Compact number for scale labels (≤2 decimals, no float noise). */
function round2(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** SVG path for a bar with only the two corners at its value end rounded (round-top bars).
 *  Vertical bars round the top (y) corners; horizontal bars round the right (max-x) corners,
 *  since the value end of a horizontal bar is its far edge, not its top. */
export function roundTopPath(b: { x: number; y: number; w: number; h: number }, horizontal?: boolean): string {
  const { x, y, w, h } = b;
  if (horizontal) {
    const r = Math.max(0, Math.min(h / 2, w, 7));
    // bottom-left → across the bottom → rounded bottom-right → up the right edge →
    // rounded top-right → back along the top to the (square) top-left.
    return `M${x},${y + h} L${x + w - r},${y + h} Q${x + w},${y + h} ${x + w},${y + h - r} L${x + w},${y + r} Q${x + w},${y} ${x + w - r},${y} L${x},${y} Z`;
  }
  const r = Math.max(0, Math.min(w / 2, h, 7));
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/** SVG text props for a resolved font (family/weight/italic/colour); `fallback`
 *  is the theme fill used when the element has no explicit colour. */
/** What a canvas drag emits for one annotation. Mirrors the inline shape the shell and
 *  the panes declare; named here for the shared annotation layer. */
export type AnnotationMovePatch = {
  value?: number;
  x?: number;
  y?: number;
  bracketY?: number;
  bracketShift?: number;
  x2?: number;
  y2?: number;
  w?: number;
  h?: number;
  rotation?: number;
  /** The values a data-anchored point was dragged to (`toAnchoredPatch`). */
  anchorX?: number;
  anchorY?: number;
};

/**
 * A drag or nudge of an annotation whose point is pinned to data values (scene `anchored`) also writes those
 * values: the builder draws a pinned point from them, so the plot fraction alone would change nothing on screen. The
 * fraction is kept as well, so going back to a plot position never jumps. The pinned point is a text's point, else the
 * end of a callout / arrow / line. Where the builder drew the Y anchor across (`anchorAcross`), `anchorY` reads X.
 */
export function toAnchoredPatch(
  a: AnnotationScene,
  patch: AnnotationMovePatch,
  scene: Pick<PlotScene, "plot" | "x" | "y">,
): AnnotationMovePatch {
  if (!a.anchored) return patch;
  const fx = a.kind === "text" ? patch.x : patch.x2;
  const fy = a.kind === "text" ? patch.y : patch.y2;
  const p = scene.plot;
  const px = fx != null ? p.x + fx * p.width : undefined;
  const py = fy != null ? p.y + fy * p.height : undefined;
  const across = a.anchorAcross === true;
  const out: AnnotationMovePatch = { ...patch };
  if ((a.anchored === "x" || a.anchored === "xy") && !across && px != null) out.anchorX = valueAtPx(scene.x, p, px, "x");
  if (a.anchored === "y" || a.anchored === "xy") {
    if (across && px != null) out.anchorY = valueAtPx(scene.x, p, px, "x");
    else if (!across && py != null) out.anchorY = valueAtPx(scene.y, p, py, "y");
  }
  return out;
}

/** How close (scene px) a dragged significance bracket has to come to the centre of the
 *  pair it spans before the magnet takes it — the same feel as the title's centre detent,
 *  which uses 7. Slightly wider here because the bracket is the thing being aimed AT the
 *  gap between two bars, and that is the position a user wants nine times in ten. */
const BRACKET_SNAP_PX = 8;

function fontAttrs(f: ResolvedFont, fallback: string): {
  fontSize: number;
  fontFamily?: string;
  fontWeight: number;
  fontStyle?: "italic";
  fill: string;
} {
  return {
    fontSize: f.size,
    ...(f.family ? { fontFamily: f.family } : {}),
    fontWeight: f.weight,
    ...(f.italic ? { fontStyle: "italic" as const } : {}),
    fill: f.color ?? fallback,
  };
}

/** Format a bar's value label: fixed decimals when set, else trimmed to ~6 sig digits. */
function fmtValueLabel(v: number, decimals?: number | undefined): string {
  if (!Number.isFinite(v)) return "";
  return decimals != null ? v.toFixed(decimals) : String(Number(v.toFixed(6)));
}

/**
 * Where a bar's value label rests (before any per-label nudge), by `plot.valuePlacement`:
 *   above      — just past the bar's end (the default placement);
 *   insideEnd  — inside the bar, tucked under its end;
 *   insideBase — inside the bar at its foot, just off the axis (at the bottom of the
 *                bar, still inside, and not colliding with the X axis).
 * A bar too short to hold the text (inside placements) falls back to "above" — a number that
 * would sit half outside a stub, or on the axis line, is worse than the default position. For the
 * inside placements a negative bar mirrors: its end is the low edge, its foot the axis edge.
 * Exported for the guard test; pure.
 */
export function valueLabelPlace(
  scene: { barHorizontal?: boolean | undefined; valueLabels?: { dy: number; placement?: "above" | "insideEnd" | "insideBase" | undefined } | undefined; fonts: { valueLabel: { size: number } } },
  bar: { x: number; y: number; w: number; h: number },
  value: number,
  text: string,
): { anchor: "start" | "middle" | "end"; baseX: number; baseY: number; placement: "above" | "insideEnd" | "insideBase" } {
  const size = scene.fonts.valueLabel.size;
  const nudge = scene.valueLabels?.dy ?? 0;
  const want = scene.valueLabels?.placement ?? "above";
  const neg = value < 0;
  if (scene.barHorizontal) {
    // Horizontal bars: the end is the right edge (left for negatives), the foot is the axis edge.
    const textW = text.length * size * 0.6 + 8;
    const fits = bar.w >= textW;
    const placement = want !== "above" && !fits ? "above" : want;
    const midY = bar.y + bar.h / 2 + size * 0.34 + nudge;
    if (placement === "insideEnd") return neg ? { anchor: "start", baseX: bar.x + 4, baseY: midY, placement } : { anchor: "end", baseX: bar.x + bar.w - 4, baseY: midY, placement };
    if (placement === "insideBase") return neg ? { anchor: "end", baseX: bar.x + bar.w - 4, baseY: midY, placement } : { anchor: "start", baseX: bar.x + 4, baseY: midY, placement };
    // "above" ignores the value's sign: the label always sits past the right edge.
    return { anchor: "start", baseX: bar.x + bar.w + 4, baseY: midY, placement: "above" };
  }
  const fits = bar.h >= size + 8;
  const placement = want !== "above" && !fits ? "above" : want;
  const cx = bar.x + bar.w / 2;
  if (placement === "insideEnd") return { anchor: "middle", baseX: cx, baseY: (neg ? bar.y + bar.h - 4 : bar.y + size + 2) + nudge, placement };
  if (placement === "insideBase") return { anchor: "middle", baseX: cx, baseY: (neg ? bar.y + size + 2 : bar.y + bar.h - 4) + nudge, placement };
  // "above" ignores the value's sign: the label always sits just above the bar's top edge.
  return { anchor: "middle", baseX: cx, baseY: bar.y - 4 + nudge, placement: "above" };
}

/** One run of label text with a baseline shift (rich-text super/subscript). */
interface RichSeg {
  text: string;
  shift: "normal" | "super" | "sub";
  /** Word-level style runs: `*{…}` bold, `/{…}` italic, `#{colour|…}` colour. Present only when set. */
  bold?: true;
  italic?: true;
  color?: string;
}

/** A colour a `#{colour|…}` run may name: hex (with or without `#`, 3 / 6 / 8 digits) or a CSS colour name (letters
 *  only). Anything else → the whole run stays literal text. */
function markupColour(c: string): string | null {
  if (/^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c.startsWith("#") ? c : `#${c}`;
  return /^[a-z]+$/i.test(c) ? c : null;
}

/**
 * Parse inline rich-text markup for super/subscripts: only the braced forms `^{…}`
 * and `_{…}` — so users write "cm^{2}", "x_{2}", "10^{-3}".
 *
 * A bare `^` or `_` is literal. There is no single-char shorthand (`^2`, `_2`): it would
 * silently turn data labels with underscores
 * — "asv_1000", gene/sample IDs — into subscripts ("asv₁000") on every tick. Braces
 * are the opt-in; anything else passes through untouched. The editor's ² / ₂ toolbar
 * buttons already wrap the selection in braces, so real subscripts stay one click away.
 */
export function parseRich(s: string): RichSeg[] {
  const out: RichSeg[] = [];
  let i = 0;
  let buf = "";
  const flush = (): void => {
    if (buf) {
      out.push({ text: buf, shift: "normal" });
      buf = "";
    }
  };
  while (i < s.length) {
    const c = s[i]!;
    // Only a `^{` / `_{` opens a shift run; a bare `^`/`_` (or one with no closing
    // brace) falls through as a literal character.
    if ((c === "^" || c === "_") && s[i + 1] === "{") {
      const shift = c === "^" ? "super" : "sub";
      const end = s.indexOf("}", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ text: s.slice(i + 2, end), shift });
        i = end + 1;
        continue;
      }
    }
    // Word-level style runs, the same braced opt-in: `*{…}` bold, `/{…}` italic, `#{colour|…}` colour. A bare
    // `*`, `/` or `#` — "mg/L", "** p<0.01", "#1" — or one with no closing brace (or no valid colour) stays literal.
    if ((c === "*" || c === "/") && s[i + 1] === "{") {
      const end = s.indexOf("}", i + 2);
      if (end > i + 1) {
        flush();
        out.push(c === "*" ? { text: s.slice(i + 2, end), shift: "normal", bold: true } : { text: s.slice(i + 2, end), shift: "normal", italic: true });
        i = end + 1;
        continue;
      }
    }
    if (c === "#" && s[i + 1] === "{") {
      const end = s.indexOf("}", i + 2);
      const inner = end > i + 1 ? s.slice(i + 2, end) : "";
      const bar = inner.indexOf("|");
      const col = bar > 0 ? markupColour(inner.slice(0, bar).trim()) : null;
      if (col) {
        flush();
        out.push({ text: inner.slice(bar + 1), shift: "normal", color: col });
        i = end + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** One line's content: raw text when unmarked, else super/subscript and bold / italic / colour tspans. */
function richLine(text: string): ReactNode {
  const segs = parseRich(text);
  const plain = (sg: RichSeg): boolean => sg.shift === "normal" && !sg.bold && !sg.italic && !sg.color;
  if (segs.length === 1 && plain(segs[0]!)) return text;
  return segs.map((sg, i) =>
    sg.shift === "normal" ? (
      <tspan key={i} {...(sg.bold ? { fontWeight: 700 } : {})} {...(sg.italic ? { fontStyle: "italic" } : {})} {...(sg.color ? { fill: sg.color } : {})}>{sg.text}</tspan>
    ) : (
      <tspan key={i} baselineShift={sg.shift} fontSize="0.72em">
        {sg.text}
      </tspan>
    ),
  );
}

/**
 * Render a label with super/subscript runs (`^{}`/`_{}`) and multi-line (`\n`)
 * support, as SVG tspans (export-clean — no foreignObject). For multi-line each
 * line is a `<tspan>` re-anchored at `x` (pass the parent `<text>`'s x so wrapped
 * lines stack instead of running on) advancing one `lineHeight` per line.
 */
/** Exported for the assembler's merged legend and the fit-parameter block, so their labels
 *  honour the same rich-text markup as every other label in the app: `^{…}` superscript,
 *  `_{…}` subscript and `\n` line breaks, and the `*{bold}`, `/{italic}` and `#{colour|…}` word runs. */
/** Where a selected text's delete handle sits: the top-right corner of its box, or just past the end of its words
 *  (the longest wrapped line, when it wraps). Estimated like the legend frame (`len × size × 0.55`). */
function labelDeleteSpot(a: AnnotationScene, fs: number): { cx: number; cy: number } {
  const tb = a.textBox;
  if (tb?.box) return { cx: tb.box.x + tb.box.w, cy: tb.box.y };
  const words = tb ? tb.lines : [a.label ?? "    "];
  const approxW = Math.max(...words.map((l) => l.length)) * fs * 0.55;
  const anchor = tb ? tb.anchor : a.labelAnchor ?? "start";
  const x = tb ? tb.x : a.labelX ?? 0;
  const rightX = x + (anchor === "middle" ? approxW / 2 : anchor === "end" ? 0 : approxW);
  return { cx: rightX + 11, cy: (a.labelY ?? 0) - fs };
}

/** A text box's background + border: the one `<rect>` the main figure, the annotation layer (and so the
 *  figure canvas) and the callout all paint behind their words. */
function TextBoxRect({ box, rotate, style, onPointerDown }: {
  box: NonNullable<NonNullable<AnnotationScene["textBox"]>["box"]>;
  rotate?: string | undefined;
  style?: React.CSSProperties | undefined;
  onPointerDown?: ((e: React.PointerEvent<SVGRectElement>) => void) | undefined;
}): ReactNode {
  return (
    <rect
      data-text-box=""
      x={box.x} y={box.y} width={box.w} height={box.h} rx={box.rx}
      fill={box.fill ?? "none"}
      fillOpacity={box.fill ? box.fillOpacity : undefined}
      stroke={box.stroke ?? "none"}
      strokeWidth={box.stroke ? box.strokeWidth : undefined}
      {...(box.stroke && box.dash ? { strokeDasharray: box.dash } : {})}
      {...(rotate ? { transform: rotate } : {})}
      {...(style ? { style } : {})}
      {...(onPointerDown ? { onPointerDown } : { pointerEvents: "none" as const })}
    />
  );
}

export function RichText({ text, x, lineHeight = "1.2em" }: { text: string; x?: number | undefined; lineHeight?: number | string | undefined }): ReactNode {
  const lines = text.split("\n");
  if (lines.length <= 1) return richLine(text);
  return (
    <>
      {lines.map((line, li) => (
        <tspan key={li} {...(x !== undefined ? { x } : {})} dy={li === 0 ? 0 : lineHeight}>
          {line === "" ? " " : richLine(line)}
        </tspan>
      ))}
    </>
  );
}

/** True when a domain sits within the soft-lock band of the home (auto) domain. */
function nearHome(d: [number, number], home: [number, number], type: string): boolean {
  const h0 = toS(home[0], type);
  const h1 = toS(home[1], type);
  const span = Math.abs(h1 - h0) || 1;
  return Math.abs(toS(d[0], type) - h0) < SNAP * span && Math.abs(toS(d[1], type) - h1) < SNAP * span;
}

/**
 * Does this kind draw band glyphs (bar / box / violin) rather than lines + markers?
 *
 * XY/area/survival/before-after draw lines + markers, not bar/box glyphs; the first three are
 * continuous, before-after sits on a band X but renders the same way. Bubble is XY with
 * per-mark-sized markers — the same continuous marker path.
 *
 * Exported because it gates the width-drag edge handles, and a test has to be able to ask the
 * same question the renderer asks. A copy of the list in a test would drift from this one, and
 * the invariant it guards ("no handle without a width command") holds only if both sides read
 * the same definition.
 */
/**
 * Draw order for composite (bars + line / points / area) series: an area fill goes first so
 * it never hides the bars, bars keep their own order, and a line or a points-only series
 * paints last so it always rides on top — in overlay/diverging mode the bars are full-width
 * and would otherwise cover a trace from an earlier series. Every other kind gets equal
 * ranks, so the stable sort leaves it exactly as built.
 */
function compositeRank(s: SeriesScene): number {
  if (s.areaPath) return -1;
  if (s.overlayLine) return 1;
  const noBars = s.marks.length > 0 && s.marks.every((m) => !m.bar);
  if (noBars && s.marks.some((m) => m.points)) return 1;
  return 0;
}

/** Does this axis print numbers the Numbering tab can reformat? Not a category axis, and every label
 *  reads as a number — a linear axis can still be lettered with names (the scree's PC1 | PC2, the
 *  Manhattan's chromosomes) or dates, which no number format reaches. */
function printsNumbers(ax: AxisScene | undefined): boolean {
  return !!ax && !ax.band && axisTicksAreNumbers(ax);
}

/** What a click on an axis's tick text means: names (→ the Fonts section) or numbers (→ the
 *  Numbering section). */
export function tickFocus(ax: AxisScene | undefined): "labels" | "numbers" {
  return printsNumbers(ax) ? "numbers" : "labels";
}

/** Marks a value axis's tick numbers with the visual axis they belong to, so the graph's
 *  right-click menu can offer that axis's number formats. Names get no mark. */
export function numbersAttr(axis: "x" | "y" | "y2" | "y3", ax: AxisScene | undefined): { "data-axis-numbers"?: string } {
  return printsNumbers(ax) ? { "data-axis-numbers": axis } : {};
}

export function isCategoryKind(kind: PlotScene["kind"]): boolean {
  return !(
    kind === "xy" ||
    kind === "area" ||
    kind === "bubble" ||
    kind === "volcano" ||
    kind === "survival" ||
    kind === "roc" ||
    kind === "beforeafter" ||
    kind === "ridgeline" ||
    kind === "forest" ||
    kind === "funnel" ||
    // swimmer: pure marker series (the event glyphs) on banded subject rows — the forest's
    // shape exactly; the bars are the scene.swimmer layer, not category glyph marks
    kind === "swimmer" ||
    // ternary: pure marker series (the composition points); the triangle is chrome
    kind === "ternary" ||
    // qq: pure marker scatter (observed vs expected −log10 p); the y=x line is chrome
    kind === "qq" ||
    // manhattan: pure marker scatter (−log10 p along the genome); the ruler + threshold lines
    // are chrome, points carry a per-mark fill (per-chromosome shading)
    kind === "manhattan" ||
    kind === "blandaltman" ||
    kind === "pcascore" ||
    kind === "pcaload" ||
    kind === "pcabiplot" ||
    // triplot: pure marker series (cases · response variables · factor centroids); the
    // explanatory arrows are chrome (annotations), exactly as the biplot's loadings are.
    // A kind missing from this list has its marks laid out and never drawn — labels and
    // arrows over an empty plot — so check the rendered gallery card when editing this list.
    kind === "triplot" ||
    kind === "scree" ||
    kind === "dendrogram"
  );
}

/**
 * PlotFigure — the SVG view of a PlotScene (the rendered grammar-of-graphics).
 *
 * The scene geometry is computed upstream by `@mady/graphics` (pure, tested);
 * this component only maps it to SVG. Renders every series (one per Y column)
 * with a colourblind-safe legend and hover tooltips. Elements are
 * **selectable** (click a series or an axis → the inspector edits it); the
 * selected element is highlighted. No `foreignObject`/`filter` — keeps
 * the SVG export-clean.
 */
/**
 * The one wheel gate every wheel handler in this file consults (the 2-D axis zoom, the
 * `useWheelZoom` sub-figures, the 3-D camera). Set from `PlotFigure`'s `wheelZoom` prop on each
 * render. A module flag rather than a prop threaded through a dozen sub-figure signatures: one
 * graph is interactive at a time, and a gate that has to be forwarded by hand is easily
 * forgotten by the next sub-figure, which would then lose scroll-to-zoom.
 */
let wheelZoomEnabled = false;

/**
 * The figure. `legendDock` = the lines the user drew and the writer that lists them in the legend (see legendDock.ts);
 * it rides a context to every legend and caption, whichever figure family draws them. Absent = a read-only drawing.
 */
export function PlotFigure({ legendDock, ...props }: Parameters<typeof PlotFigureBody>[0] & {
  legendDock?: {
    lines: ReadonlySet<string>;
    set: LegendDock;
    /** Loose legend rows: pull a row out of the block, move it, or put it back (`null`) — `Plot.legendLoose`. */
    onLegendLoose?: ((key: string, at: { x: number; y: number } | null) => void) | undefined;
  } | undefined;
}): ReactElement {
  const [near, setNear] = useState(false);
  const [looseSlot, setLooseSlot] = useState<number | null>(null);
  return (
    <LegendDockContext.Provider value={{ lines: legendDock?.lines, set: legendDock?.set, near, setNear, onLegendLoose: legendDock?.onLegendLoose, looseSlot, setLooseSlot }}>
      <PlotFigureBody {...props} />
    </LegendDockContext.Provider>
  );
}

function PlotFigureBody({
  scene,
  selected = null,
  onSelect,
  onBoxAction,
  boxHighlightBlocked,
  wheelZoom = false,
  onViewChange,
  onResetView,
  onWidthResize,
  onFigureResize,
  onMoveAnnotation,
  onMoveRefLineLabel,
  onEditText,
  onCreateTextBox,
  onDeleteAnnotation,
  onReorderAnnotation,
  onDuplicateAnnotation,
  onAxisResize,
  onMoveTitle,
  onMoveSubtitle,
  onMoveLegend,
  onMoveSignificanceCaption,
  onMoveColorbar,
  onMoveWaffleCaption,
  onMoveFitLabel,
  onMoveFitParams,
  onMoveFitParamLine,
  onMoveHeatmapLabels,
  onMoveHeatSplitLabel,
  onMoveHeatTrackName,
  onMoveHeatTrackRunLabel,
  onMoveHeatTrackKey,
  onMoveCorrLabels,
  onMoveCorrLegend,
  onMoveAxisTitle,
  onRotateAxisTitle,
  onMoveDirectLabel,
  onMoveValueLabel,
  onMoveTreemapRegionLabel,
  onMoveNetworkNode,
  onMoveVennSetLabel,
  onMoveUpsetSetLabel,
  onMoveTernaryAxisLabel,
  onMoveRoseDirectionLabel,
  onMoveOncoprintLabel,
  onMoveSectionLabel,
  onMoveCategoryGroupName,
  onParallelEdit,
  onCamera3D,
  onTextFocus,
  zoom = 1,
}: {
  scene: PlotScene;
  selected?: GraphSelection;
  onSelect?: ((selection: GraphSelection) => void) | undefined;
  /** Shift-drag box selection (xy / bubble / volcano): the action picked from the menu, with the points inside the box. */
  onBoxAction?: ((action: "exclude" | "highlight" | "copy", points: PickedPoint[]) => void) | undefined;
  /** Why "Highlight by name" cannot run on this chart (its sheet has no column of names); undefined = it can. */
  boxHighlightBlocked?: string | undefined;
  /** Drag the end of a selected axis to set its length (plot width for X / height for Y), in px. Coalesced to one undo. */
  onAxisResize?: ((axis: "x" | "y", lengthPx: number) => void) | undefined;
  /** Commit an in-place text edit (title/subtitle/axis-title/text-box body) — one undoable step. */
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  /** Fired when a text editor opens — lets the ribbon target that text's font role. */
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  /** Create a text-box annotation at a fractional plot position; returns its id so the editor can open on it. */
  onCreateTextBox?: ((xFrac: number, yFrac: number) => string | void) | undefined;
  /**
   * Let the mouse wheel zoom the graph. Default false: when the wheel zooms a graph's axes,
   * a page cannot be scrolled past a figure without the figure capturing the gesture. Off,
   * the wheel scrolls the page and every other zoom route (drag,
   * double-click reset, Ctrl+wheel magnifier, the 3-D orbit) still works. Only the wheel
   * gesture is gated — the ribbon's "Wheel zoom" tickbox drives it.
   */
  wheelZoom?: boolean | undefined;
  /** Emit a new data-domain window as the user pans/zooms ({} resets to auto). */
  onViewChange?: ((view: GraphView) => void) | undefined;
  /** Full "reset view" (zoom back to 100% and pan back to the full data) — used by
   *  the double-click gesture. Falls back to a data-view reset when absent. */
  onResetView?: (() => void) | undefined;
  /** Live drag-resize of a bar/box width (fraction of its band). The shell coalesces the drag to one undo. */
  onWidthResize?: ((seriesId: string, fraction: number) => void) | undefined;
  /** Live drag-resize of the whole figure (width/height px) from an on-canvas handle (coalesced to one undo). */
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  /** Drag-to-move/resize an annotation (the shell coalesces the drag to one undo). */
  onMoveAnnotation?: ((id: string, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number; anchorX?: number; anchorY?: number }) => void) | undefined;
  /** Nudge a builder-owned reference line's caption (absolute px offset). Only the words
   *  move — the line stays welded to the statistic it marks. */
  onMoveRefLineLabel?: ((id: string, dx: number, dy: number) => void) | undefined;
  /** Delete an annotation (× handle on a selected annotation, or the Delete key). */
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  /** Change an annotation's draw order (right-click → bring to front / send to back). */
  onReorderAnnotation?: ((id: string, to: "front" | "back") => void) | undefined;
  /** Duplicate an annotation (right-click → duplicate). */
  onDuplicateAnnotation?: ((id: string) => void) | undefined;
  /** Drag the whole heading block (the subtitle rides along); magnetic snap to centre.
   *  Coalesced to one undo by the shell. */
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  /** Drag the subtitle alone (its offset stacks on the title's, so dragging the title
   *  still moves the whole heading block). Coalesced to one undo by the shell. */
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  /** Drag the legend block to any position. Coalesced to one undo by the shell. */
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  /** Drag the significance threshold key (the `* p<0.05; ** p<0.01` caption) off its
   *  centred anchor. Coalesced to one undo by the shell. */
  onMoveSignificanceCaption?: ((dx: number, dy: number) => void) | undefined;
  /** Drag the heatmap colour-scale bar to any position. */
  onMoveColorbar?: ((dx: number, dy: number) => void) | undefined;
  /** Count waffle: the caption under the grid was dragged. */
  onMoveWaffleCaption?: ((dx: number, dy: number) => void) | undefined;
  /** Persist the curve-fit potency/equation label's free-drag offset. `fitIndex` names
   *  a per-series fit (`plot.fits[i]` -> `plot.fitsOffsets[i].label`); absent = the single fit. */
  onMoveFitLabel?: ((dx: number, dy: number, fitIndex?: number) => void) | undefined;
  /** Drag the fitted-parameter block; persists plot.fitParams.offset (or `fitsOffsets[i].params`). */
  onMoveFitParams?: ((dx: number, dy: number, fitIndex?: number) => void) | undefined;
  /** Drag one line of the single fit's parameter block (its key = `PlotFit.paramKeys`); persists
   *  `plot.fitParams.lines[key].offset`, measured from the line's place in the block. */
  onMoveFitParamLine?: ((key: string, dx: number, dy: number) => void) | undefined;
  /** Drag an individual heatmap row / column label (by index) to any position. */
  onMoveHeatmapLabels?: ((which: "row" | "col", index: number, dx: number, dy: number) => void) | undefined;
  /** Drag a heatmap split's block name / an annotation strip's name (every text on a graph
   *  can be moved). */
  onMoveHeatSplitLabel?: ((axis: "row" | "col", at: number, dx: number, dy: number) => void) | undefined;
  onMoveHeatTrackName?: ((axis: "row" | "col", index: number, dx: number, dy: number) => void) | undefined;
  /** Drag one word drawn on a strip (keyed by the value it names). */
  onMoveHeatTrackRunLabel?: ((axis: "row" | "col", index: number, value: string, dx: number, dy: number) => void) | undefined;
  /** Move a numeric strip's key (its little colour bar, caption and end numbers, as one block). */
  onMoveHeatTrackKey?: ((axis: "row" | "col", index: number, dx: number, dy: number) => void) | undefined;
  onMoveCorrLabels?: ((which: "row" | "col", index: number, dx: number, dy: number) => void) | undefined;
  onMoveCorrLegend?: ((dx: number, dy: number) => void) | undefined;
  /** Drag an axis title to any position. Coalesced to one undo by the shell. */
  /** `y2` / `y3` are the second and third value axes' titles (both draggable). */
  onMoveAxisTitle?: ((axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number) => void) | undefined;
  /** Turn a vertical axis's title from its rotation grip (Axis tab ▸ Title direction), anticlockwise degrees. One undo. */
  onRotateAxisTitle?: RotateAxisTitle;
  /** Drag a single bar's value label to a new offset (scene px). One undo per drag. */
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
  /** Drag a series' direct label (its name printed beside its own data in place of a legend
   *  row). Writes `SeriesStyle.directLabelOffset` — a nudge from where the placement rule put
   *  it, not an absolute pixel, so the name keeps following its own series. */
  onMoveDirectLabel?: ((seriesId: string, dx: number, dy: number) => void) | undefined;
  /** Drag a treemap region (group) heading to a new offset (scene px). One undo per drag. */
  onMoveTreemapRegionLabel?: ((group: string, dx: number, dy: number) => void) | undefined;
  /** Drag a network node to a manual position (fractional plot-rect coords). One undo per drag. */
  onMoveNetworkNode?: ((nodeId: string, x: number, y: number) => void) | undefined;
  /** Drag one Venn set label (dx/dy from its computed anchor → `venn.labelOffsets`). One undo per drag. */
  onMoveVennSetLabel?: ((datasetId: string, dx: number, dy: number) => void) | undefined;
  /** Drag one UpSet matrix set label (cumulative dx/dy → `upset.labelOffsets`). One undo per drag. */
  onMoveUpsetSetLabel?: ((datasetId: string, dx: number, dy: number) => void) | undefined;
  /** Drag one ternary edge title (cumulative dx/dy → `ternary.axisLabelOff`). One undo per drag. */
  onMoveTernaryAxisLabel?: ((datasetId: string, dx: number, dy: number) => void) | undefined;
  /** A polar histogram's compass letter dragged: its default words + its offset. */
  onMoveRoseDirectionLabel?: ((key: string, dx: number, dy: number) => void) | undefined;
  /** An oncoprint gene / sample name dragged: which axis, the name, its offset. */
  onMoveOncoprintLabel?: ((axis: "gene" | "sample", name: string, dx: number, dy: number) => void) | undefined;
  /** Drag a paired-dot section heading to a new offset (scene px). One undo per drag. */
  onMoveSectionLabel?: ((section: string, dx: number, dy: number) => void) | undefined;
  /** Drag a category-group name to a new offset (scene px), keyed by the visual axis it
   *  sits on + the group name. One undo per drag. The name's text is data (a column
   *  value) and is renamed in the datasheet, so there is no edit callback here. */
  onMoveCategoryGroupName?: ((axis: "x" | "y", group: string, dx: number, dy: number) => void) | undefined;
  /** Parallel-coordinates direct manipulation: brush an axis (filter) + reorder axes. */
  onParallelEdit?: ((patch: { brushes?: Record<string, [number, number]>; axisOrder?: string[] }) => void) | undefined;
  /** Orbit / zoom the 3-D scatter camera (drag to rotate, scroll to zoom). `gesture`
   *  coalesces a whole drag/zoom into one undo. */
  onCamera3D?: ((patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string) => void) | undefined;
  /** View zoom — scales the rendered SVG (no CSS `zoom`, so event coords stay sane). */
  zoom?: number;
}) {
  wheelZoomEnabled = wheelZoom; // see the flag's note — one gate for every wheel handler below
  const [hover, setHover] = useState<{ mark: MarkScene; series: SeriesScene } | null>(null);
  // The group a moved on-data label is drawn in — a sibling of the clipped plot layer, so the
  // plot's edge cannot cut it (see `gfx-textlayer` below). Null on the very first render, one
  // frame before the ref callback fills it in.
  const [textLayer, setTextLayer] = useState<SVGGElement | null>(null);
  // Live title-drag preview offset + whether it's snapped to centre (shows a guide).
  const [titleDrag, setTitleDrag] = useRafState<{ dx: number; dy: number; snapped: boolean } | null>(null);
  const titleDragRef = useRef<{ x0: number; y0: number; dx0: number; dy0: number } | null>(null);
  // Did the last title gesture actually move (a drag), so the click that follows must not also
  // open the inline editor? Single-click editing opens the editor on a plain click;
  // a drag sets this so its trailing click is swallowed instead.
  const titleDraggedRef = useRef(false);
  // Live per-bar value-label drag (preview offset for one label; key = `${columnId}:${rowId}`).
  const [valueLabelDrag, setValueLabelDrag] = useRafState<{ key: string; dx: number; dy: number; guideX?: number; guideY?: number } | null>(null);
  const valueLabelDragRef = useRef<{ columnId: string; rowId: string; x0: number; y0: number; dx0: number; dy0: number } | null>(null);
  /**
   * Magnetic alignment for value labels: while one label is dragged, its
   * position snaps to any other value label's resting position within `VL_SNAP` px (same y on a
   * vertical-bar chart, same x on a horizontal one), and a dashed guide is drawn through the
   * line it snapped to. The map is rebuilt every render from the labels actually drawn.
   */
  const vlAnchorsRef = useRef<Map<string, { baseX: number; baseY: number; x: number; y: number }>>(new Map());
  vlAnchorsRef.current = new Map();
  /** The last snapped drag delta, so the drop persists what the eye saw, not the raw pointer. */
  const valueLabelLastRef = useRef<{ key: string; dx: number; dy: number } | null>(null);
  // Set on pointer-up, consumed by the value label's onClick: a plain click selects the point the
  // label names; a drag-release does not. Both stop the click from reaching the whole-plot
  // background (the same single-click handling as the title).
  const valueLabelClickRef = useRef<{ columnId: string; rowId: string; moved: boolean } | null>(null);
  const valueLabelClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const c = valueLabelClickRef.current;
    valueLabelClickRef.current = null;
    if (c && !c.moved) onSelect?.({ kind: "series", columnId: c.columnId, part: "points", rowId: c.rowId });
  };
  /**
   * The same click, landing on the section that sizes the label: clicking a label opens
   * its size. For labels whose own series panel has no size row — the swimmer's end numbers, UpSet's
   * counts, the point labels of a chart outside DATA_DRIVEN_KINDS (the Ranked-dots card) — the size is
   * Text ▸ Title & legend ▸ Value label font; the series panel would offer no way to change it.
   */
  const valueLabelClickToSection = (section: GraphSelection) => (e: React.MouseEvent): void => {
    e.stopPropagation();
    const c = valueLabelClickRef.current;
    valueLabelClickRef.current = null;
    if (c && !c.moved) onSelect?.(section);
  };

  // Per-axis tick sizes. Label baselines are computed from these, so a mismatched pair
  // would draw a larger label at a smaller label's offset — text sitting on the axis line.
  const xTickFont = scene.fonts.xTick.size;
  const yTickFont = scene.fonts.yTick.size;
  const y3TickFont = scene.fonts.y3Tick.size;

  const { frame, tickDir, tickLen } = scene.axisStyle;
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const draggedRef = useRef(false);
  // Lines in the legend (legendDock.ts): the lines the user drew, and the writer that lists them.
  const dock = useContext(LegendDockContext);
  /** The magnet on a drawn line's caption: within reach of the legend block the block lights up, and letting go
   *  there lists the line in the legend instead of moving the words. Offered only while a writer is wired. */
  const captionDock = (a: AnnotationScene) =>
    dock.set
      ? {
          dockAt: (dx: number, dy: number, svg: SVGSVGElement | null): boolean => {
            const c = captionCentre(a, a.fontSize ?? scene.fonts.legend.size, dx, dy);
            return nearBox(legendDropBox(svg), c.x, c.y, LEGEND_DOCK_REACH);
          },
          onNear: dock.setNear,
          onDock: () => dock.set?.({ kind: "annotation", id: a.id }, true),
        }
      : {};
  // Which number-at-risk row the pointer went down on (survival): the row's KM curve id,
  // or null for the header. Read by the table's click-to-select.
  const atRiskRowRef = useRef<string | null>(null);
  const panRef = useRef<{ ux: number; uy: number; sx: [number, number]; sy: [number, number] } | null>(null);
  // Active width-resize drag (box: per-series; bar: plot-wide group fill).
  const resizeRef = useRef<{ seriesId: string; cx: number; bandW: number; m: number } | null>(null);
  // Active whole-figure resize drag (from the right / bottom / corner handle).
  const figResizeRef = useRef<"w" | "h" | "wh" | null>(null);
  // Active axis-length drag (X = plot width, Y = plot height). Delta-based: records
  // the grab point + the length at grab so resizing is relative to where you grabbed
  // (grabbing the top and not moving must leave the axis length unchanged).
  const axisResizeRef = useRef<{ axis: "x" | "y"; start: number; origLen: number } | null>(null);
  // --- in-place text editing (double-click → HTML overlay over the figure) ---
  const wrapRef = useRef<HTMLDivElement>(null);
  const { edit, openEditorEl, beginEdit, editingText, overlay } = useInlineTextEditor({
    onEditText,
    wrapRef,
    svgRef,
    sceneWidth: scene.width,
    zoom,
    onTextFocus,
    fonts: scene.fonts,
    y2OnTop: scene.y2?.side === "top",
  });
  // Alignment guides shown while dragging an annotation near a snap line.
  const [dragGuides, setDragGuides] = useRafState<{ vx?: number | undefined; hy?: number | undefined } | null>(null);
  // Right-click context menu for an annotation (positioned in the figwrap).
  const [annMenu, setAnnMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  // Box selection (Shift-drag): the corner the drag started from, the box while dragging, and — once
  // released — the picked points and where their menu opens (in the figwrap, like the annotation menu).
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const boxRectRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [boxRect, setBoxRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [boxSel, setBoxSel] = useState<{ points: PickedPoint[]; left: number; top: number } | null>(null);
  const boxEnabled = !!onBoxAction && BOX_SELECT_KINDS.has(scene.kind);
  const openAnnMenu = (e: React.MouseEvent, id: string): void => {
    if (!onDeleteAnnotation && !onReorderAnnotation && !onDuplicateAnnotation) return;
    e.preventDefault();
    e.stopPropagation();
    const wr = wrapRef.current?.getBoundingClientRect();
    if (!wr) return;
    onSelect?.({ kind: "annotation", id });
    setAnnMenu({ id, left: e.clientX - wr.left, top: e.clientY - wr.top });
  };
  // After creating a text box we wait for the new annotation to land in the scene,
  // then open its editor (so the box is "immediately editable").
  const awaitNewTextRef = useRef(false);
  const prevAnnIdsRef = useRef<Set<string>>(new Set());
  // Which axes can pan/zoom, and the `GraphView` key each reports through — read from
  // the scene, never from a list of kinds here.
  //
  // A hand-kept list of kinds here would drift from the builders: leaving out a kind whose
  // builder honours a value-domain override (bar / box / violin / scatter / raincloud /
  // floating bar / histogram / ridgeline) loses scroll-to-zoom there, and naming a kind
  // whose builder ignores the override gives a gesture that changes the view state and
  // never moves the picture.
  const zoomAxes = onViewChange ? scene.zoomable ?? [] : [];
  const zoomX = zoomAxes.find((z) => z.visual === "x");
  const zoomY = zoomAxes.find((z) => z.visual === "y");
  const interactive = zoomAxes.length > 0;
  // A chart with one zoomable axis is a categorical one: the other axis bands the
  // groups. Drag-to-pan stays asleep there until the view is actually zoomed, because
  // a pan swallows the click that selects a bar (>4px of travel suppresses it) — and
  // an un-zoomed category chart has nowhere to pan TO. Once zoomed, dragging the value
  // axis is the only way back out to the part of the data now off-screen.
  const valueOnly = zoomAxes.length === 1;
  const zoomedIn =
    (!!zoomX && (scene.x.domain[0] !== scene.auto.x[0] || scene.x.domain[1] !== scene.auto.x[1])) ||
    (!!zoomY && (scene.y.domain[0] !== scene.auto.y[0] || scene.y.domain[1] !== scene.auto.y[1]));
  const panEnabled = interactive && (!valueOnly || zoomedIn);
  const isCat = isCategoryKind(scene.kind);
  // Band width = plot width / number of categories (datasets for box; rows for bar). For
  // histogram the "categories" are the bins (marks of the single series), so the width-drag
  // fraction maps to per-bin slot fill, not the whole plot. UpSet likewise: one slot per
  // intersection — counting its one series would make a still edge-press shrink the bars to a sliver.
  const numCats =
    scene.kind === "bar" || scene.kind === "histogram" || scene.kind === "upset" ? scene.series[0]?.marks.length ?? 1 : scene.series.length || 1;
  const bandW = scene.plot.width / Math.max(1, numCats);

  // Map a screen point (event clientX/Y) to SVG user/viewBox coords via the live
  // CTM. This is transform-correct (handles the view-zoom scaling) and consistent
  // with real pointer/wheel events — unlike manual getBoundingClientRect math,
  // which CSS `zoom` would skew at non-100% zoom.
  const clientToUser = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const select = (sel: GraphSelection, e: React.MouseEvent) => {
    e.stopPropagation();
    if (draggedRef.current) return; // ignore the click that ends a pan-drag
    // The ROC chance diagonal is drawn through the series layer (it needs a line path) but
    // it is a reference line; routing it to the Data panel would offer a Shape / Fill /
    // Opacity menu for something with no markers, every edit of which would be written to
    // `seriesStyles["roc-diag"]` and read by nothing. Re-route by id, at the one funnel every
    // series click already passes through.
    if (sel && sel.kind === "series" && isReferenceLine(sel.columnId)) {
      onSelect?.({ kind: "refline", id: sel.columnId });
      return;
    }
    // UpSet: the intersection bars are a synthesised series, not a table column — routing
    // their clicks to the Data panel would open controls over a phantom dataset. They open the
    // section holding the UpSet rows (bar styling and the one-bar highlight among them).
    // That section is "Chart type"; the title must match an existing section exactly, or the
    // click hides every section and leaves an empty panel.
    if (sel && sel.kind === "series" && scene.kind === "upset") {
      onSelect?.({ kind: "chart-section", title: "Chart type" });
      return;
    }
    onSelect?.(sel);
  };

  // --- multi-object annotation selection (shift-click → Arrange toolbar) ---
  /** Is this annotation part of the current selection (single OR multi)? */
  const annIsSelected = (id: string): boolean =>
    selected?.kind === "annotation" ? selected.id === id
      : selected?.kind === "annotations" ? selected.ids.includes(id)
        : false;
  /** Select an annotation. Plain click = single-select; shift-click toggles it in/out
   *  of a multi-selection (the set the Arrange toolbar acts on). Computed here from the
   *  live `selected` so no extra plumbing is needed — it just emits via `onSelect`. */
  const pickAnn = (id: string, e: { shiftKey?: boolean }): void => {
    if (!onSelect) return;
    // A builder-made reference line is not an annotation and must not be routed like one —
    // and it cannot join a multi-select either, since Arrange only moves things that move.
    if (isReferenceLine(id)) { onSelect({ kind: "refline", id }); return; }
    if (!e.shiftKey) { onSelect({ kind: "annotation", id }); return; }
    const cur =
      selected?.kind === "annotations" ? selected.ids
        : selected?.kind === "annotation" ? [selected.id]
          : [];
    const ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (ids.length === 0) onSelect({ kind: "plot" });
    else if (ids.length === 1) onSelect({ kind: "annotation", id: ids[0]! });
    else onSelect({ kind: "annotations", ids });
  };

  // Current domains in scale space (value space for linear, log10 space for log).
  const domS = () => ({
    sx: [toS(scene.x.domain[0], scene.x.type), toS(scene.x.domain[1], scene.x.type)] as [number, number],
    sy: [toS(scene.y.domain[0], scene.y.type), toS(scene.y.domain[1], scene.y.type)] as [number, number],
  });
  /**
   * Report a new window for whichever axes are zoomable — through the key the builder
   * reads, which is not always the axis the user dragged. A flipped bar chart is
   * dragged along X and reported as `yDomain`; report it as `xDomain` and the drag is
   * accepted, stored, and silently ignored.
   *
   * An axis that is not in `scene.zoomable` is left out of the emitted view entirely —
   * an undefined domain means "auto extent", so a category band never gets pinned to a
   * window nothing would honour anyway.
   */
  const emit = (sx: [number, number], sy: [number, number]): void => {
    const view: GraphView = {};
    const put = (
      z: { visual: "x" | "y"; key: "x" | "y" } | undefined,
      s: [number, number],
      axis: AxisScene,
      home: [number, number],
    ): void => {
      if (!z) return;
      const d: [number, number] = [fromS(s[0], axis.type), fromS(s[1], axis.type)];
      // Soft lock: snap back to the natural "home" extent when the window lands within
      // the band (a gentle magnetic detent at the default view).
      if (nearHome(d, home, axis.type)) return;
      if (z.key === "x") view.xDomain = d;
      else view.yDomain = d;
    };
    put(zoomX, sx, scene.x, scene.auto.x);
    put(zoomY, sy, scene.y, scene.auto.y);
    onViewChange?.(view);
  };

  // --- annotation drag-to-move (data coords via the inverse of the axis scales) ---
  /** The annotation being dragged, plus where the pointer went down and the lateral
   *  shift the bracket already carried — a sideways bracket drag is a delta.
   *  `map0` freezes the pointer→value mapping at pointer-down: a dragged bracket height
   *  is folded back into the value domain (significance headroom), so mapping through
   *  the live scale would make every frame's error feed the next — the axis would inflate
   *  under the cursor and the bracket run away. Frozen, the value is a pure function of the
   *  cursor: the axis may re-fit once, but nothing compounds and the drag reverses
   *  along the same path. */
  const annDragRef = useRef<{
    id: string;
    ux0: number;
    uy0: number;
    /** A TEXT's point at pointer-down: the drag moves it by the pointer's travel, so a text whose words sit away from
     *  its point (aligned inside a box) never jumps to the pointer. */
    lx0?: number | undefined;
    ly0?: number | undefined;
    shift0: number;
    /** The bracket's rail pixel on the value axis at pointer-down — the drag moves this
     *  by the pointer's delta, so grabbing the star (or any off-rail pixel) never jumps. */
    vpx0: number;
    map0: { sx: [number, number]; sy: [number, number]; px: number; py: number; pw: number; ph: number };
    /** A bracket drag's patch, held until pointer-up. Committing per frame would fold the new
     *  height into the value domain, so near the edges the axis would re-fit in nice-number
     *  steps under the cursor and throw the bracket back by a whole step each time. The gesture is a
     *  pure visual translate; the document sees one patch on release, so the graph makes its
     *  room exactly once — after the pointer is released. */
    pending?: AnnotationMovePatch | undefined;
  } | null>(null);
  /** The live visual offset of the bracket being dragged (whole-figure translate of its
   *  group). null = no bracket gesture in flight. */
  const [bracketDragXY, setBracketDragXY] = useRafState<{ id: string; dx: number; dy: number } | null>(null);
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  /**
   * Y runs downward. `scene.y.domain[0]` sits at the bottom pixel (the range is
   * [plotY + height, plotY]), so the top of the plot is `domain[1]`. Mapping `domain[0]`
   * to the top would mirror every vertical value drag — bracket heights and reference lines
   * would move opposite the pointer, and on a bracket the significance headroom would fold
   * each wrong height back into the domain, compounding per frame until the bracket ran away
   * and the axis grew with it. A reversed
   * axis stores its domain pre-flipped, so this form is right for it too. X needs no flip —
   * its pixels ascend with its values.
   */
  const dataYAt = (uy: number): number => valueAtPx(scene.y, scene.plot, uy, "y");
  const dataXAt = (ux: number): number => valueAtPx(scene.x, scene.plot, ux, "x");
  /** Every move of an annotation on this figure goes through here: a point pinned to data values also gets its new
   *  values (`toAnchoredPatch`); anything else passes through untouched. */
  const moveAnn = (id: string, patch: AnnotationMovePatch): void => {
    if (!onMoveAnnotation) return;
    const a = scene.annotations.find((x) => x.id === id);
    onMoveAnnotation(id, a ? toAnchoredPatch(a, patch, scene) : patch);
  };
  /** A filled distribution (a ridge) with no data points: its name and where its peak sits on X —
   *  the highest corner of its outline. Hover text of the interactive HTML export. */
  const peakTip = (name: string, d: string | undefined): string[] => {
    const top = pathCorners(d ?? "", 400).reduce<[number, number] | null>((best, p) => (best === null || p[1] < best[1] ? p : best), null);
    return top ? [name, `peak at ${scene.axisLabels.x || "X"}: ${tipRead(dataXAt(top[0]))}`] : [name];
  };
  /** Live magnet state for a bracket drag: the id snapped back to its home lane, plus
   *  where to draw the dashed detent guide. Cleared on pointer-up. */
  const [bracketSnap, setBracketSnap] = useState<{ id: string; x1: number; x2: number; y1: number; y2: number } | null>(null);
  /** A freeform bracket's end being dragged (its round handle). Separate from the
   *  whole-bracket drag: the handle stops propagation, so only one of the two runs. */
  const bracketEndRef = useRef<{ id: string; end: 1 | 2 } | null>(null);
  /** The dashed detent guide for a bracket that has just snapped home: a line through
   *  the centre of the pair it spans, across the plot. Read from the bracket's own
   *  endpoints, which are exactly the home position at the moment it snaps. */
  const bracketHomeGuide = (a: AnnotationScene): { id: string; x1: number; x2: number; y1: number; y2: number } => {
    const p = scene.plot;
    if (scene.valueAxis === "x") {
      const cy = ((a.y1 ?? p.y) + (a.y2 ?? p.y)) / 2;
      return { id: a.id, x1: p.x, x2: p.x + p.width, y1: cy, y2: cy };
    }
    const cx = ((a.x1 ?? p.x) + (a.x2 ?? p.x)) / 2;
    return { id: a.id, x1: cx, x2: cx, y1: p.y, y2: p.y + p.height };
  };
  /** Map a pointer to the move-patch for one annotation (by its resolved geometry).
   *  `start` = where the pointer went down and what the bracket's lateral shift was
   *  then, so a sideways drag is a delta (grab it anywhere and it follows the cursor)
   *  rather than a jump to the pointer. */
  const annPatch = (
    a: AnnotationScene,
    ux: number,
    uy: number,
    start?: NonNullable<typeof annDragRef.current> | undefined,
  ): { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number } => {
    if (a.kind === "text") {
      const px = start?.lx0 != null ? start.lx0 + (ux - start.ux0) : ux;
      const py = start?.ly0 != null ? start.ly0 + (uy - start.uy0) : uy;
      return { x: clamp01((px - scene.plot.x) / scene.plot.width), y: clamp01((py - scene.plot.y) / scene.plot.height) };
    }
    // A bracket's height is a value, so it has to be read off whichever axis carries
    // values. Reading `dataYAt` unconditionally would be wrong on every transposed
    // chart — dragging a bracket on a horizontal bar or a lollipop would move it
    // along the category axis instead of raising it.
    //
    // The other axis is the category one: the bracket slides freely along it too,
    // with a magnetic detent at the centred home position (shift 0).
    if (a.kind === "bracket") {
      const onX = scene.valueAxis === "x";
      // Delta from the bracket's own rail, through the frozen start-of-drag mapping
      // (annDragRef.map0) — two rules:
      //  • frozen, because the height being written re-derives the value domain each
      //    frame (significance headroom); mapping through the live scale would compound
      //    the error until the bracket ran away;
      //  • a delta, because "the value under the cursor" would teleport the rail to the
      //    pointer on the first frame — grabbing the star (drawn above the rail) or any
      //    off-rail pixel of the hit target would jump the bracket upward before the drag
      //    had moved at all.
      const m = start?.map0;
      const railPx = start ? start.vpx0 + (onX ? ux - start.ux0 : uy - start.uy0) : onX ? ux : uy;
      const value = onX
        ? m
          ? fromS(m.sx[0] + ((railPx - m.px) / m.pw) * (m.sx[1] - m.sx[0]), scene.x.type)
          : dataXAt(railPx)
        : m
          ? fromS(m.sy[1] + ((railPx - m.py) / m.ph) * (m.sy[0] - m.sy[1]), scene.y.type)
          : dataYAt(railPx);
      if (!start) return { bracketY: value };
      const extent = onX ? scene.plot.height : scene.plot.width;
      const moved = onX ? uy - start.uy0 : ux - start.ux0;
      const raw = start.shift0 + (extent ? moved / extent : 0);
      const snapped = Math.abs(raw * extent) < BRACKET_SNAP_PX;
      return { bracketY: value, bracketShift: snapped ? 0 : raw };
    }
    const vertical = Math.abs((a.x1 ?? 0) - (a.x2 ?? 0)) < 0.5; // vline vs hline
    return { value: vertical ? dataXAt(ux) : dataYAt(uy) };
  };

  /** Shift a selected annotation by a fractional plot delta (arrow-key nudge).
   *  Moves the whole annotation — both endpoints for lines — keeping size/shape. */
  const nudgePatch = (
    a: AnnotationScene,
    dx: number,
    dy: number,
  ): { x?: number; y?: number; x2?: number; y2?: number } | null => {
    const p = scene.plot;
    const fx = (v: number): number => (v - p.x) / p.width;
    const fy = (v: number): number => (v - p.y) / p.height;
    if (a.kind === "text") return { x: clamp01(fx(a.labelX ?? p.x) + dx), y: clamp01(fy(a.labelY ?? p.y) + dy) };
    if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image")
      return { x: fx(Math.min(a.x1 ?? 0, a.x2 ?? 0)) + dx, y: fy(Math.min(a.y1 ?? 0, a.y2 ?? 0)) + dy };
    if (a.kind === "arrow" || a.kind === "segment" || a.kind === "callout")
      return { x: fx(a.x1 ?? 0) + dx, y: fy(a.y1 ?? 0) + dy, x2: fx(a.x2 ?? 0) + dx, y2: fy(a.y2 ?? 0) + dy };
    if (a.kind === "band") {
      const isVband = (a.y2 ?? 0) - (a.y1 ?? 0) >= p.height - 1;
      return isVband ? { x: fx(a.x1 ?? 0) + dx } : { y: fy(a.y1 ?? 0) + dy };
    }
    return null; // reference lines / brackets are axis-locked — no free nudge
  };

  // --- drag-snap alignment guides (snap a dragged anchor to the plot's left / centre
  //     / right and top / middle / bottom and to every other object's edges/centres,
  //     with a dashed guide line, like a design tool's smart guides) ---
  /** The fractional x/y guide lines of every annotation except `excludeId`: text uses
   *  its anchor; boxes their left/centre/right + top/middle/bottom; lines their ends. */
  const objectGuides = (excludeId: string): { xs: number[]; ys: number[] } => {
    const p = scene.plot;
    const xs: number[] = [];
    const ys: number[] = [];
    const fxOf = (px: number): number => (px - p.x) / p.width;
    const fyOf = (py: number): number => (py - p.y) / p.height;
    for (const a of scene.annotations ?? []) {
      if (a.id === excludeId) continue;
      if (a.kind === "text" || a.kind === "callout") {
        if (a.labelX != null) xs.push(fxOf(a.labelX));
        if (a.labelY != null) ys.push(fyOf(a.labelY));
      } else if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image") {
        if (a.x1 != null && a.x2 != null) xs.push(fxOf(a.x1), fxOf((a.x1 + a.x2) / 2), fxOf(a.x2));
        if (a.y1 != null && a.y2 != null) ys.push(fyOf(a.y1), fyOf((a.y1 + a.y2) / 2), fyOf(a.y2));
      } else if (a.kind === "arrow" || a.kind === "segment" || a.kind === "line") {
        if (a.x1 != null) xs.push(fxOf(a.x1));
        if (a.x2 != null) xs.push(fxOf(a.x2));
        if (a.y1 != null) ys.push(fyOf(a.y1));
        if (a.y2 != null) ys.push(fyOf(a.y2));
      }
    }
    return { xs: xs.filter((v) => Number.isFinite(v)), ys: ys.filter((v) => Number.isFinite(v)) };
  };
  /** Snap a fractional anchor to the centre/edge + other-object guides + draw the line(s). */
  const snapFrac = (fx: number, fy: number, excludeId = ""): { fx: number; fy: number } => {
    const r = snapToGuides(fx, fy, scene.plot, 6, objectGuides(excludeId));
    setDragGuides(r.vx !== undefined || r.hy !== undefined ? { vx: r.vx, hy: r.hy } : null);
    return { fx: r.fx, fy: r.fy };
  };
  const clearGuides = (): void => setDragGuides(null);

  // --- in-place text editing helpers ---
  // The editor engine (state + overlay + beginEdit/commit/editingText) lives in
  // `useInlineTextEditor` (shared with the bespoke figures); `renderScale` stays
  // local because the drag handlers below also use it.
  /** Rendered px per scene unit (the SVG scales responsively), so the overlay font matches. */
  const renderScale = (): number => {
    // Per viewBox unit: the graph view can grow the viewBox past the figure (figureGrowth.ts).
    const w = svgRef.current?.getBoundingClientRect().width;
    const vbW = svgRef.current?.viewBox.baseVal.width || scene.width;
    return w ? w / vbW : zoom;
  };
  // --- title drag (magnetic centre snap) ---
  const startTitleDrag = (e: React.PointerEvent): void => {
    if (!onMoveTitle) return;
    e.stopPropagation();
    titleDraggedRef.current = false;
    const cur = scene.titleOffset ?? { dx: 0, dy: 0 };
    titleDragRef.current = { x0: e.clientX, y0: e.clientY, dx0: cur.dx, dy0: cur.dy };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const moveTitleDrag = (e: React.PointerEvent): void => {
    const d = titleDragRef.current;
    if (!d || !onMoveTitle) return;
    if (Math.abs(e.clientX - d.x0) >= 3 || Math.abs(e.clientY - d.y0) >= 3) titleDraggedRef.current = true;
    const s = renderScale();
    let dx = d.dx0 + (e.clientX - d.x0) / s;
    const dy = d.dy0 + (e.clientY - d.y0) / s;
    const snapped = Math.abs(dx) < 7; // magnetic centre detent (scene px)
    if (snapped) dx = 0;
    setTitleDrag({ dx, dy, snapped });
  };
  const endTitleDrag = (e: React.PointerEvent): void => {
    const d = titleDragRef.current;
    titleDragRef.current = null;
    setTitleDrag(null);
    if (!d || !onMoveTitle) return;
    if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return; // a click, not a drag
    const s = renderScale();
    let dx = d.dx0 + (e.clientX - d.x0) / s;
    const dy = d.dy0 + (e.clientY - d.y0) / s;
    if (Math.abs(dx) < 7) dx = 0;
    onMoveTitle(Math.round(dx), Math.round(dy));
  };
  const titleOff = titleDrag ?? scene.titleOffset ?? { dx: 0, dy: 0 };
  // --- axis-title drag (free placement of the X / Y axis title text) ---
  // A magnetic detent snaps the title back to its default spot (offset 0,0) when
  // dragged near it — with a transparent guide cross — so re-centring is easy.
  const SNAP = 7; // scene px
  const [axisTitleDrag, setAxisTitleDrag] = useRafState<{ axis: "x" | "y"; dx: number; dy: number; snapped: boolean } | null>(null);
  const axisTitleDragRef = useRef<{ axis: "x" | "y"; x0: number; y0: number; dx0: number; dy0: number } | null>(null);
  /** Did the last pointer-up on an axis title end a drag? The click that follows must then not
   *  also select the axis — see `axisTitleDragProps`. */
  const axisTitleDraggedRef = useRef(false);
  const startAxisTitleDrag = (axis: "x" | "y") => (e: React.PointerEvent): void => {
    if (!onMoveAxisTitle) return;
    e.stopPropagation();
    axisTitleDraggedRef.current = false;
    const cur = (axis === "x" ? scene.x.titleOffset : scene.y.titleOffset) ?? { dx: 0, dy: 0 };
    axisTitleDragRef.current = { axis, x0: e.clientX, y0: e.clientY, dx0: cur.dx, dy0: cur.dy };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const snapAxisOffset = (dx: number, dy: number): { dx: number; dy: number; snapped: boolean } => {
    const snapped = Math.abs(dx) < SNAP && Math.abs(dy) < SNAP; // near the default spot
    return snapped ? { dx: 0, dy: 0, snapped: true } : { dx, dy, snapped: false };
  };
  const moveAxisTitleDrag = (e: React.PointerEvent): void => {
    const d = axisTitleDragRef.current;
    if (!d) return;
    const s = renderScale();
    const snap = snapAxisOffset(d.dx0 + (e.clientX - d.x0) / s, d.dy0 + (e.clientY - d.y0) / s);
    setAxisTitleDrag({ axis: d.axis, ...snap });
  };
  const endAxisTitleDrag = (e: React.PointerEvent): void => {
    const d = axisTitleDragRef.current;
    axisTitleDragRef.current = null;
    setAxisTitleDrag(null);
    if (!d || !onMoveAxisTitle) return;
    axisTitleDraggedRef.current = Math.abs(e.clientX - d.x0) >= 3 || Math.abs(e.clientY - d.y0) >= 3;
    if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return; // a click, not a drag
    const s = renderScale();
    const snap = snapAxisOffset(d.dx0 + (e.clientX - d.x0) / s, d.dy0 + (e.clientY - d.y0) / s);
    onMoveAxisTitle(d.axis, Math.round(snap.dx), Math.round(snap.dy));
  };
  const axisTitleOff = (axis: "x" | "y"): { dx: number; dy: number } =>
    (axisTitleDrag?.axis === axis ? axisTitleDrag : undefined) ?? (axis === "x" ? scene.x.titleOffset : scene.y.titleOffset) ?? { dx: 0, dy: 0 };
  /**
   * Clicking an axis title selects its axis, as the axis line and its tick labels do. The
   * title is what a user aims at to rename or restyle an axis; without this handler the click
   * would fall through to the <svg> root and select the whole plot, opening the graph
   * Title / Subtitle / footer fields instead.
   *
   * The click is swallowed after a real drag (the title is also draggable), so repositioning a
   * title does not change the selection.
   */
  const axisTitleDragProps = (axis: "x" | "y") => ({
    ...(onMoveAxisTitle
      ? { onPointerDown: startAxisTitleDrag(axis), onPointerMove: moveAxisTitleDrag, onPointerUp: endAxisTitleDrag, style: { cursor: "move" as const } }
      : { style: onEditText ? { cursor: "text" as const } : undefined }),
    ...(onSelect
      ? {
          onClick: (e: React.MouseEvent): void => {
            if (axisTitleDraggedRef.current) { axisTitleDraggedRef.current = false; e.stopPropagation(); return; }
            select({ kind: "axis", axis }, e);
          },
        }
      : {}),
  });
  // --- per-bar value-label drag (reposition one value label freely) ---
  const startValueLabelDrag = (columnId: string, rowId: string, dx0: number, dy0: number) => (e: React.PointerEvent): void => {
    if (!onMoveValueLabel) return;
    e.stopPropagation();
    valueLabelDragRef.current = { columnId, rowId, x0: e.clientX, y0: e.clientY, dx0, dy0 };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const VL_SNAP = 6;
  const moveValueLabelDrag = (e: React.PointerEvent): void => {
    const d = valueLabelDragRef.current;
    if (!d) return;
    const s = renderScale();
    const key = `${d.columnId}:${d.rowId}`;
    let dx = d.dx0 + (e.clientX - d.x0) / s;
    let dy = d.dy0 + (e.clientY - d.y0) / s;
    let guideX: number | undefined;
    let guideY: number | undefined;
    // Magnetic alignment: snap to the nearest other label's resting line, one axis each.
    const own = vlAnchorsRef.current.get(key);
    if (own) {
      const cx = own.baseX + dx;
      const cy = own.baseY + dy;
      let bestY: { y: number; dist: number } | null = null;
      let bestX: { x: number; dist: number } | null = null;
      for (const [k, a] of vlAnchorsRef.current) {
        if (k === key) continue;
        const ddy = Math.abs(a.y - cy);
        if (ddy <= VL_SNAP && (!bestY || ddy < bestY.dist)) bestY = { y: a.y, dist: ddy };
        const ddx = Math.abs(a.x - cx);
        if (ddx <= VL_SNAP && (!bestX || ddx < bestX.dist)) bestX = { x: a.x, dist: ddx };
      }
      // Vertical bars align along a common height (y); horizontal bars along a common x.
      if (scene.barHorizontal) { if (bestX) { dx = bestX.x - own.baseX; guideX = bestX.x; } }
      else if (bestY) { dy = bestY.y - own.baseY; guideY = bestY.y; }
    }
    valueLabelLastRef.current = { key, dx, dy };
    setValueLabelDrag({ key, dx, dy, ...(guideX !== undefined ? { guideX } : {}), ...(guideY !== undefined ? { guideY } : {}) });
  };
  const endValueLabelDrag = (e: React.PointerEvent): void => {
    const d = valueLabelDragRef.current;
    valueLabelDragRef.current = null;
    setValueLabelDrag(null);
    const last = valueLabelLastRef.current;
    valueLabelLastRef.current = null;
    if (!d) return;
    const moved = !(Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3);
    // Hand the click to `valueLabelClick` (which fires just after): select the point on a plain
    // click, and either way keep the click off the whole-plot background.
    valueLabelClickRef.current = { columnId: d.columnId, rowId: d.rowId, moved };
    if (!moved || !onMoveValueLabel) return; // a click, not a drag — no position to persist
    const s = renderScale();
    // Persist the snapped delta when the last move snapped; else the raw pointer delta.
    const key = `${d.columnId}:${d.rowId}`;
    const dx = last?.key === key ? last.dx : d.dx0 + (e.clientX - d.x0) / s;
    const dy = last?.key === key ? last.dy : d.dy0 + (e.clientY - d.y0) / s;
    onMoveValueLabel(d.columnId, d.rowId, Math.round(dx), Math.round(dy));
  };
  // Height the footer/source band reserves at the very bottom (matches buildScene).
  const footerBandH = scene.footer ? Math.round(scene.fonts.legend.size * 0.9) + 12 : 0;
  // ...and the significance-key band just above it. Read from the caption's own resolved
  // size (buildScene grows the canvas by the same number) — assuming the legend font here
  // would put a resized key on top of the X-axis title.
  const sigCapSize = scene.significanceCaptionStyle?.size ?? scene.fonts.legend.size;
  const sigBandH = scene.significanceCaption ? sigCapSize + 10 : 0;
  // Baseline x of the (rotated) Y-axis title. The builder anchors it to the axis's own tick
  // labels (`titlePos`), so the clearance is a constant `titleGap` at any font size. The
  // canvas-edge formula below is only a fallback for scenes without `titlePos`: its reserve and
  // the title's own offset grow at different rates, so past ~30px the title meets the tick numbers.
  const yTitleX = scene.y.titlePos ?? Math.max(14, Math.round(scene.fonts.yAxisTitle.size * 1.08));

  // --- band move / resize (drag the shaded vband/hband with the mouse) ---
  const bandDragRef = useRef<
    | { id: string; mode: "move" | "l" | "r" | "t" | "b"; ux0: number; uy0: number; fx: number; fw: number; fy: number; fh: number }
    | null
  >(null);
  const startBandDrag = (e: React.PointerEvent, a: AnnotationScene, mode: "move" | "l" | "r" | "t" | "b"): void => {
    if (!onMoveAnnotation) return;
    e.stopPropagation();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const p = scene.plot;
    bandDragRef.current = {
      id: a.id,
      mode,
      ux0: u.x,
      uy0: u.y,
      fx: ((a.x1 ?? p.x) - p.x) / p.width,
      fw: ((a.x2 ?? p.x) - (a.x1 ?? p.x)) / p.width,
      fy: ((a.y1 ?? p.y) - p.y) / p.height,
      fh: ((a.y2 ?? p.y) - (a.y1 ?? p.y)) / p.height,
    };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
    onSelect?.({ kind: "annotation", id: a.id });
  };
  const moveBandDrag = (e: React.PointerEvent): void => {
    const d = bandDragRef.current;
    if (!d || !onMoveAnnotation) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const p = scene.plot;
    const dfx = (u.x - d.ux0) / p.width;
    const dfy = (u.y - d.uy0) / p.height;
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const isVband = d.fh > 0.999; // full-height ⇒ vertical band (moves/resizes in X)
    if (d.mode === "move") {
      if (isVband) onMoveAnnotation(d.id, { x: clamp(d.fx + dfx, 0, 1 - d.fw) });
      else onMoveAnnotation(d.id, { y: clamp(d.fy + dfy, 0, 1 - d.fh) });
    } else if (d.mode === "l") {
      const nx = clamp(d.fx + dfx, 0, d.fx + d.fw - 0.02);
      onMoveAnnotation(d.id, { x: nx, w: d.fx + d.fw - nx });
    } else if (d.mode === "r") {
      onMoveAnnotation(d.id, { w: clamp(d.fw + dfx, 0.02, 1 - d.fx) });
    } else if (d.mode === "t") {
      const ny = clamp(d.fy + dfy, 0, d.fy + d.fh - 0.02);
      onMoveAnnotation(d.id, { y: ny, h: d.fy + d.fh - ny });
    } else if (d.mode === "b") {
      onMoveAnnotation(d.id, { h: clamp(d.fh + dfy, 0.02, 1 - d.fy) });
    }
  };
  const endBandDrag = (e: React.PointerEvent): void => {
    bandDragRef.current = null;
    (e.currentTarget as SVGGraphicsElement).releasePointerCapture?.(e.pointerId);
  };

  // Keyboard for the selected annotation: Delete/Backspace removes it; arrow keys
  // nudge it 1px (Shift = 10px) for precise placement. Suppressed while an inline
  // editor is open or the user is typing in a field elsewhere. Mouse users get the
  // × handle + drag.
  useEffect(() => {
    // One or many selected annotations (multi = the Arrange selection).
    const annIds: string[] =
      selected?.kind === "annotation" ? [selected.id]
        : selected?.kind === "annotations" ? selected.ids
          : [];
    if (annIds.length === 0) return;
    const single = annIds.length === 1 ? annIds[0]! : null;
    const ARROWS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const handler = (e: KeyboardEvent): void => {
      if (edit) return; // inline text editor open → it owns the keyboard
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && onDeleteAnnotation) {
        // Builder-owned labels are skipped, not silently swallowed: the document refuses them
        // (they're regenerated each rebuild), so Delete on one alone would do nothing.
        // Selecting a mix still deletes everything that can go.
        const removable = annIds.filter((id) => scene.annotations.find((a) => a.id === id)?.deletable !== false);
        if (removable.length === 0) return; // nothing deletable → leave the key to the browser
        e.preventDefault();
        for (const id of removable) onDeleteAnnotation(id);
        return;
      }
      if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey) && onDuplicateAnnotation) {
        e.preventDefault(); // Ctrl/Cmd+D would otherwise bookmark
        for (const id of annIds) onDuplicateAnnotation(id);
        return;
      }
      if (e.key === "Escape" && !annMenu) {
        onSelect?.(null); // deselect (no handles / × shown)
        return;
      }
      // Arrow-nudge is single-selection only (multi-nudge → use the Arrange toolbar).
      const dir = single ? ARROWS[e.key] : undefined;
      if (single && dir && onMoveAnnotation) {
        const a = scene.annotations.find((x) => x.id === single);
        if (!a) return;
        const step = e.shiftKey ? 10 : 1;
        const patch = nudgePatch(a, (dir[0] * step) / scene.plot.width, (dir[1] * step) / scene.plot.height);
        if (patch) {
          e.preventDefault();
          moveAnn(single, patch);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDeleteAnnotation, onMoveAnnotation, onDuplicateAnnotation, onSelect, selected, edit, scene, annMenu]);

  // Close the box-selection menu the same way as the annotation menu: an outside click, Escape, or window blur.
  useEffect(() => {
    if (!boxSel) return;
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest(".gfx-boxmenu")) setBoxSel(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setBoxSel(null);
    };
    const onBlur = (): void => setBoxSel(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [boxSel]);

  // Close the annotation context menu on an outside click, Escape, or window blur.
  useEffect(() => {
    if (!annMenu) return;
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest(".gfx-annmenu")) setAnnMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setAnnMenu(null);
    };
    const onBlur = (): void => setAnnMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [annMenu]);

  // After onCreateTextBox, open the editor on the newly-added text annotation once it lands in the scene.
  useEffect(() => {
    const ids = new Set(scene.annotations.map((a) => a.id));
    if (awaitNewTextRef.current) {
      const created = scene.annotations.find((a) => a.kind === "text" && !prevAnnIdsRef.current.has(a.id));
      if (created) {
        awaitNewTextRef.current = false;
        const el = svgRef.current?.querySelector<SVGGraphicsElement>(`[data-ann-text="${created.id}"]`);
        openEditorEl(el ?? null, { kind: "annotation", id: created.id }, created.label ?? "", {
          baseSize: created.fontSize ?? scene.fonts.legend.size,
          anchor: created.labelAnchor ?? "middle",
          multiline: true,
        });
      }
    }
    prevAnnIdsRef.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  /** Double-click on empty plot interior → create a text box at that fractional position, then edit it. */
  const createTextAt = (e: React.MouseEvent): void => {
    if (!onCreateTextBox) return;
    e.stopPropagation();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const fx = clamp01((u.x - scene.plot.x) / scene.plot.width);
    const fy = clamp01((u.y - scene.plot.y) / scene.plot.height);
    awaitNewTextRef.current = true;
    onCreateTextBox(fx, fy);
  };

  // Wheel = zoom the zoomable axes around the cursor (non-passive so preventDefault
  // works; Ctrl+wheel is left to the canvas for view zoom). On a categorical chart only
  // the value axis scales — the other one bands the groups, and "zooming" a band would
  // mean showing half a category.
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return;
      if (!wheelZoomEnabled) return; // wheel scrolls the page unless the ribbon's "Wheel zoom" is on
      e.preventDefault();
      const u = clientToUser(e.clientX, e.clientY);
      if (!u) return;
      const fx = (u.x - scene.plot.x) / scene.plot.width;
      const fy = (u.y - scene.plot.y) / scene.plot.height;
      const { sx, sy } = domS();
      const cxs = sx[0] * (1 - fx) + sx[1] * fx;
      const cys = sy[1] * (1 - fy) + sy[0] * fy; // top = max
      const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      // A non-zoomable axis is handed back unchanged; `emit` drops it either way, but
      // scaling a band domain first would put a meaningless number through `fromS`.
      emit(
        zoomX ? [cxs + (sx[0] - cxs) * k, cxs + (sx[1] - cxs) * k] : sx,
        zoomY ? [cys + (sy[0] - cys) * k, cys + (sy[1] - cys) * k] : sy,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, scene]);

  const onPointerDown = (e: React.PointerEvent): void => {
    // Shift-drag draws a selection box instead of panning (a Shift-click still reaches annotations: no drag, no box).
    if (e.shiftKey && e.button === 0 && boxEnabled) {
      const u0 = clientToUser(e.clientX, e.clientY);
      if (!u0) return;
      boxStartRef.current = u0;
      draggedRef.current = false;
      setBoxSel(null);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (!panEnabled || e.button !== 0) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const { sx, sy } = domS();
    panRef.current = { ux: u.x, uy: u.y, sx, sy };
    draggedRef.current = false;
  };
  // Start a width-resize drag from a box/bar edge handle.
  const startResize = (e: React.PointerEvent, seriesId: string, cx: number): void => {
    e.stopPropagation();
    // Bars-per-band is the resize divisor: a colMode / stacked / overlay bar is one-per-band, so
    // using series.length would over-scale the width to the max and the edge handle could never narrow it.
    resizeRef.current = { seriesId, cx, bandW, m: (scene.barsPerBand ?? scene.series.length) || 1 };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort (some pointers/environments reject it) */
    }
  };
  // Start a whole-figure resize drag from a corner/edge handle.
  const startFigResize = (e: React.PointerEvent, mode: "w" | "h" | "wh"): void => {
    e.stopPropagation();
    e.preventDefault();
    figResizeRef.current = mode;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
  };
  // Start an axis-length drag — capture the grab point + current length (delta-based).
  const startAxisResize = (e: React.PointerEvent, axis: "x" | "y"): void => {
    e.stopPropagation();
    e.preventDefault();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    axisResizeRef.current = {
      axis,
      start: axis === "x" ? u.x : u.y,
      origLen: axis === "x" ? scene.plot.width : scene.plot.height,
    };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const bs = boxStartRef.current;
    if (bs) {
      const u = clientToUser(e.clientX, e.clientY);
      if (!u) return;
      if (!draggedRef.current && Math.abs(u.x - bs.x) + Math.abs(u.y - bs.y) < 4) return; // below the drag threshold
      draggedRef.current = true;
      boxRectRef.current = { x0: bs.x, y0: bs.y, x1: u.x, y1: u.y };
      setBoxRect(boxRectRef.current);
      return;
    }
    const ar = axisResizeRef.current;
    if (ar) {
      const u = clientToUser(e.clientX, e.clientY);
      if (!u) return;
      draggedRef.current = true;
      // Delta from the grab point: drag right/down lengthens, left/up shortens —
      // relative to where you grabbed, so the grab point itself stays put.
      const cur = ar.axis === "x" ? u.x : u.y;
      const newLen = ar.origLen + (cur - ar.start);
      onAxisResize?.(ar.axis, Math.max(40, Math.round(newLen)));
      return;
    }
    const fr = figResizeRef.current;
    if (fr) {
      const u = clientToUser(e.clientX, e.clientY);
      if (!u) return;
      draggedRef.current = true; // suppress the click-to-select that ends the drag
      // u.x / u.y are figure (viewBox) pixels — the new width/height directly.
      const patch: { figureWidth?: number; figureHeight?: number } = {};
      if (fr === "w" || fr === "wh") patch.figureWidth = Math.round(u.x);
      if (fr === "h" || fr === "wh") patch.figureHeight = Math.round(u.y);
      onFigureResize?.(patch);
      return;
    }
    const r = resizeRef.current;
    if (r) {
      const u = clientToUser(e.clientX, e.clientY);
      if (!u) return;
      draggedRef.current = true; // suppress the click-to-select that ends the drag
      const half = Math.abs(u.x - r.cx);
      // box: width = 2·half; bar: that is one bar of m, so the band fill = ·m.
      const fraction = scene.kind === "bar" ? (2 * half * r.m) / r.bandW : (2 * half) / r.bandW;
      onWidthResize?.(r.seriesId, fraction);
      return;
    }
    const p = panRef.current;
    if (!p) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    // Drag distance in SVG user units (zoom-correct via the CTM).
    const dux = u.x - p.ux;
    const duy = u.y - p.uy;
    if (!draggedRef.current && Math.abs(dux) + Math.abs(duy) < 4) return; // below the drag threshold
    draggedRef.current = true;
    const spanX = p.sx[1] - p.sx[0];
    const spanY = p.sy[1] - p.sy[0];
    const shiftX = -(dux / scene.plot.width) * spanX; // drag right → pan view left
    const shiftY = (duy / scene.plot.height) * spanY; // drag down → reveal higher values
    // Same rule as the wheel: a banded axis is handed back untouched.
    emit(
      zoomX ? [p.sx[0] + shiftX, p.sx[1] + shiftX] : p.sx,
      zoomY ? [p.sy[0] + shiftY, p.sy[1] + shiftY] : p.sy,
    );
  };
  const endPan = (e?: React.PointerEvent): void => {
    if (boxStartRef.current) {
      // Released: pick the points inside and open the menu where the drag ended. A cancelled pointer (no event)
      // or a click that never became a drag picks nothing.
      boxStartRef.current = null;
      const rect = boxRectRef.current;
      boxRectRef.current = null;
      setBoxRect(null);
      const wr = wrapRef.current?.getBoundingClientRect();
      if (e && rect && draggedRef.current && wr) {
        setBoxSel({ points: pointsInBox(scene, { x: rect.x0, y: rect.y0 }, { x: rect.x1, y: rect.y1 }), left: e.clientX - wr.left, top: e.clientY - wr.top });
      }
    }
    panRef.current = null;
    resizeRef.current = null;
    figResizeRef.current = null;
    axisResizeRef.current = null;
    if (dragGuides) setDragGuides(null); // safety net: clear snap guides on any pointer-up
  };
  const selX = selected?.kind === "axis" && selected.axis === "x";
  const selY = selected?.kind === "axis" && selected.axis === "y";
  const selY2 = selected?.kind === "axis" && selected.axis === "y2";
  const selY3 = selected?.kind === "axis" && selected.axis === "y3";
  const accent = "var(--accent)";
  const px = scene.plot.x;
  const py = scene.plot.y;
  const pw = scene.plot.width;
  const ph = scene.plot.height;
  // Expand the data clip beyond the frame by the largest marker / error-cap
  // extent so an edge data point (one sitting on an axis, e.g. the left-most or
  // right-most point) renders whole instead of being sliced by the frame. Panned-
  // away content still clips, just a marker-width past the edge.
  const clipPad = Math.ceil(
    Math.max(
      6,
      ...scene.series.map((s) => {
        // Bubbles size each mark by data (mark.symbolSize = the radius), far larger than the
        // series symbolSize — so the clip must clear the biggest per-mark radius, not just the
        // series default, else an edge bubble's outer ring is sliced by the plot-area clip.
        const rad = Math.max(s.symbolSize, ...s.marks.map((m) => m.symbolSize ?? 0));
        return Math.max(rad * 1.5 + s.borderWidth, s.errorCapWidth + s.errorWidth) + 2;
      }),
    ),
  );
  /**
   * Is a label's resting spot inside the plot's clip — i.e. is the label visible now?
   *
   * This decides which side of the clip an on-data label is drawn on (see `OnDataText`). It reads
   * the resting anchor, never the dragged position, on purpose: the answer must not change during
   * a drag, because moving a label across the boundary would re-parent its DOM element, and
   * re-parenting an element mid-drag destroys the pointer capture the drag runs on. Switching on
   * "pointer is down" instead would stop labels such as the UpSet count from moving at all.
   */
  const inClip = (x: number, y: number): boolean =>
    x >= px - clipPad && x <= px + pw + clipPad && y >= py - clipPad && y <= py + ph + clipPad;
  // Advanced fills (pattern / gradient / metallic) render as <defs> referenced by
  // url(); a solid fill is just its colour. Def ids are figure-unique via `clipId`.
  const fillId = (sid: string): string => `${clipId}-f-${sid}`;
  const fillPaint = (s: SeriesScene): string =>
    s.fillSpec.type === "solid" ? s.fillSpec.color : `url(#${fillId(s.id)})`;
  // A single bar can carry its own fill shape ("Format this bar"); its spec wins
  // over the flat per-mark colour and the series paint.
  const markFillId = (sid: string, rowId: string): string => `${clipId}-mf-${sid}-${rowId}`;
  const markFillPaint = (s: SeriesScene, m: MarkScene): string =>
    m.fillSpec ? (m.fillSpec.type === "solid" ? m.fillSpec.color : `url(#${markFillId(s.id, m.rowId)})`) : (m.fill ?? fillPaint(s));

  if (scene.kind === "image") return <ImageFigure scene={scene} zoom={zoom} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onFigureResize={onFigureResize} />;
  if (scene.kind === "venn") return <VennFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onFigureResize={onFigureResize} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onMoveVennSetLabel={onMoveVennSetLabel} />;
  if (scene.kind === "pie") return <PieFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveLegend={onMoveLegend} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveValueLabel={onMoveValueLabel} onMoveWaffleCaption={onMoveWaffleCaption} />;
  if (scene.kind === "treemap") return <TreemapFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveLegend={onMoveLegend} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveValueLabel={onMoveValueLabel} onMoveTreemapRegionLabel={onMoveTreemapRegionLabel} />;
  if (scene.kind === "parallel") return <ParallelFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveLegend={onMoveLegend} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveColorbar={onMoveColorbar} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveValueLabel={onMoveValueLabel} onParallelEdit={onParallelEdit} />;
  if (scene.kind === "heatmap") return <HeatmapFigure scene={scene} zoom={zoom} selected={selected} onRotateAxisTitle={onRotateAxisTitle} onSelect={onSelect} onViewChange={onViewChange} onResetView={onResetView} onAxisResize={onAxisResize} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveAxisTitle={onMoveAxisTitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveColorbar={onMoveColorbar} onMoveHeatmapLabels={onMoveHeatmapLabels} onMoveHeatSplitLabel={onMoveHeatSplitLabel} onMoveHeatTrackName={onMoveHeatTrackName} onMoveHeatTrackRunLabel={onMoveHeatTrackRunLabel} onMoveHeatTrackKey={onMoveHeatTrackKey} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} />;
  if (scene.kind === "corrmatrix") return <CorrMatrixFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveCorrLabels={onMoveCorrLabels} onMoveCorrLegend={onMoveCorrLegend} />;
  if (scene.kind === "alluvial") return <AlluvialFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveValueLabel={onMoveValueLabel} />;
  if (scene.kind === "network") return <NetworkFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveLegend={onMoveLegend} onMoveColorbar={onMoveColorbar} onMoveNetworkNode={onMoveNetworkNode} onEditText={onEditText} onTextFocus={onTextFocus} onFigureResize={onFigureResize} />;
  if (scene.kind === "radar") return <RadarFigure scene={scene} zoom={zoom} selected={selected} onSelect={onSelect} onMoveLegend={onMoveLegend} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} onMoveValueLabel={onMoveValueLabel} />;
  if (scene.kind === "scatter3d") return <Scatter3DFigure scene={scene} zoom={zoom} onSelect={onSelect} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveAxisTitle={onMoveAxisTitle} onCamera3D={onCamera3D} onEditText={onEditText} onTextFocus={onTextFocus} selected={selected} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} />;
  if (scene.kind === "lollipop") return <LollipopFigure scene={scene} zoom={zoom} selected={selected} onRotateAxisTitle={onRotateAxisTitle} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName}onViewChange={onViewChange} onResetView={onResetView} onAxisResize={onAxisResize} onMoveLegend={onMoveLegend} onMoveSignificanceCaption={onMoveSignificanceCaption} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveAxisTitle={onMoveAxisTitle} onMoveValueLabel={onMoveValueLabel} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} />;
  if (scene.kind === "paireddot") return <PairedDotFigure scene={scene} zoom={zoom} selected={selected} onRotateAxisTitle={onRotateAxisTitle} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName}onViewChange={onViewChange} onResetView={onResetView} onAxisResize={onAxisResize} onMoveLegend={onMoveLegend} onMoveSignificanceCaption={onMoveSignificanceCaption} onMoveTitle={onMoveTitle} onMoveSubtitle={onMoveSubtitle} onMoveAxisTitle={onMoveAxisTitle} onMoveValueLabel={onMoveValueLabel} onMoveSectionLabel={onMoveSectionLabel} onEditText={onEditText} onTextFocus={onTextFocus} onMoveAnnotation={onMoveAnnotation} onDeleteAnnotation={onDeleteAnnotation} onFigureResize={onFigureResize} />;

  return (
    <div ref={wrapRef} className="gfx-figwrap" style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={{ ...figSizeStyle(zoom), ...(panEnabled ? { cursor: "grab" } : {}) }}
      role="img"
      aria-label={`${scene.title}: ${scene.axisLabels.y} versus ${scene.axisLabels.x}`}
      onMouseLeave={() => setHover(null)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={() => endPan()}
      onDoubleClick={() => (onResetView ? onResetView() : onViewChange?.({}))}
      onClick={() => {
        if (draggedRef.current) {
          draggedRef.current = false;
          return;
        }
        onSelect?.({ kind: "plot" });
      }}
    >
      {/* clip the data layer to the plot area so axis pan/zoom can't spill points out */}
      <defs>
        <clipPath id={clipId}>
          <rect x={px - clipPad} y={py - clipPad} width={pw + 2 * clipPad} height={ph + 2 * clipPad} />
        </clipPath>
        <FillDefs series={scene.series} idFor={fillId} markIdFor={markFillId} />
      </defs>
      {/* figure (paper) background — drawn first so all content sits on top */}
      <FigureBackdrop scene={scene} />
      <AxisBands scene={scene} />
      {/* category-group block tint (Axis tab → Category groups) — behind the data. */}
      <CategoryGroupTints scene={scene} />
      {/* shaded bands (vband/hband) — drawn behind the gridlines + series for the
          background-highlight look. Purely visual (pointer-events none): the data
          layer is on top, so the grab/move surface is a separate on-top layer below
          (see "band interaction layer"). */}
      {/* Funnel plot: pseudo-CI triangle / zero-centred significance contours — behind
          everything else, like the shaded bands below (the dots must stay readable). */}
      {scene.funnel && (
        <g className="gfx-funnelregion">
          {/* Behind the dots, but clickable where the triangle shows — routes to the Funnel
              controls. The data layer sits on top, so a click on a dot still
              reaches the dot. */}
          {scene.funnel.contours?.map((c) => (
            <path key={c.p} d={c.path} fill={c.fill} opacity={c.opacity}
              style={onSelect ? { cursor: "pointer" } : undefined}
              onClick={onSelect ? (e) => select({ kind: "chart-section", title: "Chart type" }, e) : undefined} />
          ))}
          {scene.funnel.region && <path d={scene.funnel.region.path} fill="#8a8a8a" opacity={scene.funnel.region.opacity}
            style={onSelect ? { cursor: "pointer" } : undefined}
            onClick={onSelect ? (e) => select({ kind: "chart-section", title: "Chart type" }, e) : undefined} />}
        </g>
      )}
      {scene.annotations.filter((a) => a.kind === "band").map((a) => {
        const sel = selected?.kind === "annotation" && selected.id === a.id;
        return (
          <rect
            key={`band-${a.id}`}
            x={a.x1}
            y={a.y1}
            width={(a.x2 ?? 0) - (a.x1 ?? 0)}
            height={(a.y2 ?? 0) - (a.y1 ?? 0)}
            fill={a.fill ?? "#888888"}
            fillOpacity={a.fillOpacity ?? 0.14}
            stroke={sel ? "var(--accent)" : a.color ?? "none"}
            strokeWidth={sel ? 1.5 : a.color ? a.width || 1 : 0}
            pointerEvents="none"
          />
        );
      })}
      {/* background gridlines (configurable: show / colour / width / minor) */}
      {scene.grid.show && (
        <g className="gfx-grid">
          {(scene.x.band ? [] : scene.x.ticks)
            .filter((t) => scene.grid.minor || !t.minor)
            .map((t) => (
              <line
                key={`gx-${t.value}`}
                x1={t.pos}
                x2={t.pos}
                y1={py}
                y2={py + ph}
                stroke={scene.grid.color ?? "var(--line)"}
                strokeWidth={scene.grid.width}
                strokeDasharray={scene.grid.dash ?? undefined}
                opacity={t.minor ? 0.5 : 1}
              />
            ))}
          {(scene.y.band ? [] : scene.y.ticks)
            .filter((t) => scene.grid.minor || !t.minor)
            .map((t) => (
              <line
                key={`gy-${t.value}`}
                x1={px}
                x2={px + pw}
                y1={t.pos}
                y2={t.pos}
                stroke={scene.grid.color ?? "var(--line)"}
                strokeWidth={scene.grid.width}
                strokeDasharray={scene.grid.dash ?? undefined}
                opacity={t.minor ? 0.5 : 1}
              />
            ))}
        </g>
      )}

      {/* frame + axes (X/Y lines clickable to select; box adds top+right, offset gaps the corner) */}
      <g className="gfx-axes">
        {frame === "box" && (
          // The closing top + right edges mirror their parallel axis (top ← X, right ←
          // Y) so a "box" frame reads as one consistent rectangle, not thin grey edges
          // around thick black axes.
          <>
            <line x1={px} x2={px + pw} y1={py} y2={py} stroke={scene.x.lineColor ?? "var(--line-2)"} strokeWidth={scene.x.lineWidth ?? 1.25} strokeLinecap="square" />
            <line x1={px + pw} x2={px + pw} y1={py} y2={py + ph} stroke={scene.y.lineColor ?? "var(--line-2)"} strokeWidth={scene.y.lineWidth ?? 1.25} strokeLinecap="square" />
          </>
        )}
        {frame !== "none" && (
          // `strokeLinecap="square"` extends each axis by half its width at the ends so the X
          // and Y strokes overlap at the corner — no "empty square" hole when the axis is thick,
          // and the end ticks meet a squared axis end cleanly. (offset frame gaps the corner on
          // purpose, so the tiny cap extension there is harmless.)
          <>
            <line
              x1={frame === "offset" ? px + 8 : px}
              x2={px + pw}
              y1={py + ph}
              y2={py + ph}
              stroke={selX ? accent : scene.x.lineColor ?? "var(--line-2)"}
              strokeWidth={selX ? 2.5 : scene.x.lineWidth ?? 1.25}
              strokeLinecap="square"
              style={onSelect ? { cursor: "pointer" } : undefined}
              {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "x" }, e) } : {})}
            />
            <line
              x1={px}
              x2={px}
              y1={py}
              y2={frame === "offset" ? py + ph - 8 : py + ph}
              stroke={selY ? accent : scene.y.lineColor ?? "var(--line-2)"}
              strokeWidth={selY ? 2.5 : scene.y.lineWidth ?? 1.25}
              strokeLinecap="square"
              style={onSelect ? { cursor: "pointer" } : undefined}
              {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y" }, e) } : {})}
            />
            {scene.y2 && (
              // A second value axis runs down the right edge — or along the top edge on a
              // horizontal bar chart, whose values run left to right (`side: "top"`).
              <line
                x1={scene.y2.side === "top" ? px : px + pw}
                x2={px + pw}
                y1={py}
                y2={scene.y2.side === "top" ? py : py + ph}
                stroke={selY2 ? accent : scene.y2.lineColor ?? "var(--line-2)"}
                strokeWidth={selY2 ? 2.5 : scene.y2.lineWidth ?? 1.25}
                strokeLinecap="square"
                style={onSelect ? { cursor: "pointer" } : undefined}
                {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y2" }, e) } : {})}
              />
            )}
            {scene.y3 && (
              <line
                x1={scene.y3.axisX ?? px + pw}
                x2={scene.y3.axisX ?? px + pw}
                y1={py}
                y2={py + ph}
                stroke={selY3 ? accent : scene.y3.lineColor ?? "var(--line-2)"}
                strokeWidth={selY3 ? 2.5 : scene.y3.lineWidth ?? 1.25}
                strokeLinecap="square"
                style={onSelect ? { cursor: "pointer" } : undefined}
                {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y3" }, e) } : {})}
              />
            )}
          </>
        )}
      </g>
      {/* axis hit areas (tick-label gutters) */}
      {onSelect && (
        <g>
          <rect
            x={px}
            y={py + ph}
            width={pw}
            height={26}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={(e) => select({ kind: "axis", axis: "x" }, e)}
          />
          <rect
            x={Math.max(0, px - 46)}
            y={py}
            width={46}
            height={ph}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={(e) => select({ kind: "axis", axis: "y" }, e)}
          />
          {/* The top second axis (a horizontal bar chart) gets the same tick-number gutter the bottom axis has. */}
          {scene.y2?.side === "top" && (
            <rect
              x={px}
              y={Math.max(0, py - 26)}
              width={pw}
              height={Math.min(26, py)}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onClick={(e) => select({ kind: "axis", axis: "y2" }, e)}
            />
          )}
        </g>
      )}

      {/* x ticks + labels — the X axis's own tick font (category names may be larger). */}
      <g {...fontAttrs(scene.fonts.xTick, "var(--muted)")}>
        {scene.x.ticks.map((t) => {
          const y0 = scene.plot.y + scene.plot.height;
          const xTickLen = scene.x.tickLen ?? tickLen; // per-axis length override
          // Extend by half the axis-line width so the visible tick (the part beyond the
          // axis line's edge) stays the set length even as the axis thickens.
          const len = (t.minor ? xTickLen * 0.6 : xTickLen) + (scene.x.lineWidth ?? 1.25) / 2;
          const up = tickDir === "in" || tickDir === "both" ? len : 0; // in = into the plot
          const down = tickDir === "out" || tickDir === "both" ? len : 0;
          const showTick = tickDir !== "none" && !scene.x.hideTicks;
          return (
            <g key={`tx-${t.value}`}>
              {showTick && <line x1={t.pos} x2={t.pos} y1={y0 - up} y2={y0 + down} stroke={scene.x.lineColor ?? "var(--line-2)"} strokeWidth={scene.x.tickWidth ?? scene.x.lineWidth ?? 1.25} />}
              {!t.minor && t.label && (() => {
                const rot = scene.x.tickRotation ?? 0;
                // The builder made room below the axis with this same placement — a turned label hangs below it either way.
                const lbl = xTickLabelPlacement(t.pos, y0, xTickFont, scene.axisGaps?.xTick ?? 6, rot);
                return (
                <text
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.anchor}
                  {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})}
                  {...(t.color ? { fill: t.color } : {})}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...numbersAttr("x", scene.x)}
                  {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "x", focus: tickFocus(scene.x) }, e) } : {})}
                >
                  <RichText text={t.label} />
                </text>
                );
              })()}
            </g>
          );
        })}
      </g>

      {/* Three-way outer group labels (below the category ticks) — one per cluster per band. */}
      {scene.barGroupLabels?.length ? (
        <g {...fontAttrs(scene.fonts.xTick, "var(--ink)")}>
          {scene.barGroupLabels.map((g, i) => (
            <text key={`bgl-${i}`} x={g.x} y={g.y} textAnchor={g.anchor}>{g.text}</text>
          ))}
        </g>
      ) : null}

      {/* y ticks + labels — the Y axis's own tick font. */}
      <g {...fontAttrs(scene.fonts.yTick, "var(--muted)")}>
        {scene.y.ticks.map((t) => {
          const yTickLen = scene.y.tickLen ?? tickLen; // per-axis length override
          const len = (t.minor ? yTickLen * 0.6 : yTickLen) + (scene.y.lineWidth ?? 1.25) / 2;
          const left = tickDir === "out" || tickDir === "both" ? len : 0; // out = away from the plot
          const right = tickDir === "in" || tickDir === "both" ? len : 0;
          const showTick = tickDir !== "none" && !scene.y.hideTicks;
          return (
            <g key={`ty-${t.value}`}>
              {showTick && (
                <line x1={scene.plot.x - left} x2={scene.plot.x + right} y1={t.pos} y2={t.pos} stroke={scene.y.lineColor ?? "var(--line-2)"} strokeWidth={scene.y.tickWidth ?? scene.y.lineWidth ?? 1.25} />
              )}
              {!t.minor && (() => {
                const rot = scene.y.tickRotation ?? 0;
                // Left of the axis however it turns — the placement the layout made room for.
                const lbl = yTickLabelPlacement(t.pos, scene.plot.x, yTickFont, scene.axisGaps?.yTick ?? 8, rot);
                return (
                <text
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.anchor}
                  {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})}
                  {...(t.color ? { fill: t.color } : {})}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...numbersAttr("y", scene.y)}
                  {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y", focus: tickFocus(scene.y) }, e) } : {})}
                >
                  <RichText text={t.label} />
                </text>
                );
              })()}
            </g>
          );
        })}
      </g>

      <SecondValueAxis scene={scene} select={select} onSelect={onSelect} onMoveAxisTitle={onMoveAxisTitle} canEdit={!!onEditText} beginEdit={beginEdit} editingText={editingText} selected={selected} onRotateAxisTitle={onRotateAxisTitle} />

      {/* y3 ticks + labels + axis title — a second right axis, drawn at scene.y3.axisX (outside y2) */}
      {scene.y3 && (() => {
        const y3x = scene.y3.axisX ?? px + pw;
        return (
          <g {...fontAttrs(scene.fonts.y3Tick, "var(--muted)")}>
            {scene.y3!.ticks.map((t) => {
              const y3len = scene.y3!.tickLen ?? tickLen;
              const len = (t.minor ? y3len * 0.6 : y3len) + (scene.y3!.lineWidth ?? 1.25) / 2;
              const out = tickDir === "out" || tickDir === "both" ? len : 0;
              const into = tickDir === "in" || tickDir === "both" ? len : 0;
              return (
                <g key={`ty3-${t.value}`}>
                  {tickDir !== "none" && !scene.y3!.hideTicks && (
                    <line x1={y3x - into} x2={y3x + out} y1={t.pos} y2={t.pos} stroke={scene.y3!.lineColor ?? "var(--line-2)"} strokeWidth={scene.y3!.tickWidth ?? scene.y3!.lineWidth ?? 1.25} />
                  )}
                  {!t.minor && (() => {
                    const rot = scene.y3!.tickRotation ?? 0;
                    const lbl = yTickLabelPlacement(t.pos, y3x, y3TickFont, scene.axisGaps?.yTick ?? 8, rot, 0, "right");
                    return (
                    <text
                      x={lbl.x}
                      y={lbl.y}
                      textAnchor={lbl.anchor}
                      {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})}
                      style={onSelect ? { cursor: "pointer" } : undefined}
                      {...numbersAttr("y3", scene.y3)}
                      {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y3", focus: tickFocus(scene.y3) }, e) } : {})}
                    >
                      <RichText text={t.label} />
                    </text>
                    );
                  })()}
                </g>
              );
            })}
            {/* Every text on the figure can be dragged, the Y3 title included. */}
            {scene.y3!.title && (
              <DraggableTitle
                {...verticalTitle(scene.y3!, scene.y3!.titleX ?? scene.width - 7, py + ph / 2, 270)}
                rotateGrip={titleGrip(selected, "y3", scene.y3, 270, onRotateAxisTitle, scene)}
                font={scene.fonts.y3AxisTitle ?? scene.fonts.yAxisTitle}
                offset={scene.y3!.titleOffset}
                onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y3", dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y3" }, scene.y3!.title ?? "", (scene.fonts.y3AxisTitle ?? scene.fonts.yAxisTitle).size, "middle", true) : undefined}
                editing={editingText({ kind: "axisTitle", axis: "y3" })}
                onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y3" }) : undefined}
                centerY={py + ph / 2}
                guideLeft={px}
                guideRight={px + pw}
              />
            )}
          </g>
        );
      })()}

      {/* axis-break marks (cuts) — a white-backed glyph across the axis. Style:
          "slash" = ∕∕ double slash · "zigzag" = a wave · "gap" = a clean erased gap. */}
      {scene.x.breakMarks?.map((bx, i) => {
        const y0 = scene.plot.y + scene.plot.height;
        const style = scene.x.breakStyle ?? "slash";
        return (
          <g key={`xbrk-${i}`} pointerEvents="none">
            <rect x={bx - 5} y={y0 - 7} width={10} height={14} fill="var(--bg)" />
            {style === "slash" && (
              <>
                <line x1={bx - 5} y1={y0 + 5} x2={bx} y2={y0 - 5} stroke="var(--ink)" strokeWidth={1.2} />
                <line x1={bx} y1={y0 + 5} x2={bx + 5} y2={y0 - 5} stroke="var(--ink)" strokeWidth={1.2} />
              </>
            )}
            {style === "zigzag" && (
              <polyline points={`${bx - 6},${y0 + 4} ${bx - 3},${y0 - 4} ${bx},${y0 + 4} ${bx + 3},${y0 - 4} ${bx + 6},${y0 + 4}`} fill="none" stroke="var(--ink)" strokeWidth={1.2} />
            )}
          </g>
        );
      })}
      {scene.y.breakMarks?.map((by, i) => {
        const x0 = scene.plot.x;
        const style = scene.y.breakStyle ?? "slash";
        return (
          <g key={`ybrk-${i}`} pointerEvents="none">
            <rect x={x0 - 7} y={by - 5} width={14} height={10} fill="var(--bg)" />
            {style === "slash" && (
              <>
                <line x1={x0 - 5} y1={by + 5} x2={x0 + 5} y2={by} stroke="var(--ink)" strokeWidth={1.2} />
                <line x1={x0 - 5} y1={by} x2={x0 + 5} y2={by - 5} stroke="var(--ink)" strokeWidth={1.2} />
              </>
            )}
            {style === "zigzag" && (
              <polyline points={`${x0 - 4},${by - 6} ${x0 + 4},${by - 3} ${x0 - 4},${by} ${x0 + 4},${by + 3} ${x0 - 4},${by + 6}`} fill="none" stroke="var(--ink)" strokeWidth={1.2} />
            )}
          </g>
        );
      })}

      {/* magnetic centre guide — shown while dragging the title and snapped to centre */}
      {titleDrag?.snapped && (
        <line
          x1={scene.width / 2}
          x2={scene.width / 2}
          y1={2}
          y2={scene.plot.y}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {/* graph title + subtitle (heading band above the plot) — drag to move (magnetic centre), double-click to edit.
          titleAlign anchors the block left/centre/right (left = the editorial house style, flush with the plot area). */}
      {(() => {
        const align = scene.titleAlign ?? "center";
        const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const baseX =
          align === "left" ? scene.plot.x : align === "right" ? scene.plot.x + scene.plot.width : scene.width / 2;
        const tx = baseX + titleOff.dx;
        return (
          <>
            {scene.title && (
              <text
                x={tx}
                y={8 + scene.fonts.title.size * 0.85 + titleOff.dy}
                textAnchor={anchor}
                data-tour="plot-title"
                {...fontAttrs(scene.fonts.title, "var(--ink)")}
                opacity={editingText({ kind: "title" }) ? 0 : undefined}
                style={{ cursor: onMoveTitle ? "move" : onEditText ? "text" : undefined }}
                onPointerDown={startTitleDrag}
                onPointerMove={moveTitleDrag}
                onPointerUp={endTitleDrag}
                // Single-click opens the inline editor. A drag sets titleDraggedRef, so its
                // trailing click is swallowed and only moves the title. Double-click still edits too.
                onClick={(e) => {
                  if (titleDraggedRef.current) { titleDraggedRef.current = false; return; }
                  beginEdit(e, { kind: "title" }, scene.title, scene.fonts.title.size, anchor, true);
                }}
                onDoubleClick={(e) => beginEdit(e, { kind: "title" }, scene.title, scene.fonts.title.size, anchor, true)}
              >
                <RichText text={scene.title} x={tx} />
              </text>
            )}
            {scene.subtitle && (
              // Its own drag, stacked on the title's: dragging the title still moves the whole
              // heading block (the subtitle rides along via titleOff), and the subtitle can also
              // be nudged alone. Sharing startTitleDrag would let it move only together with
              // the title.
              <DraggableTitle
                text={scene.subtitle}
                x={tx}
                y={(scene.title ? 8 + scene.fonts.title.size * (1 + (scene.title.split("\n").length - 1) * 1.2) + 4 : 8) + scene.fonts.subtitle.size * 0.85 + titleOff.dy}
                anchor={anchor}
                font={scene.fonts.subtitle}
                color="var(--muted)"
                offset={scene.subtitleOffset}
                onMove={onMoveSubtitle}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle, scene.fonts.subtitle.size, anchor, true) : undefined}
                editing={editingText({ kind: "subtitle" })}
                centerX={scene.width / 2}
                guideTop={2}
                guideBottom={scene.plot.y}
              />
            )}
          </>
        );
      })()}

      {/* recentre guide — a dashed accent cross at the axis title's default spot,
          shown while a drag is snapped back to it (the magnetic detent). */}
      {axisTitleDrag?.snapped && (() => {
        // A Y title turned by Title direction has its home where the builder put it (`titleTurn`).
        const cx = axisTitleDrag.axis === "x" ? scene.plot.x + scene.plot.width / 2 : scene.y.titleTurn?.x ?? yTitleX;
        const cy = axisTitleDrag.axis === "x"
          ? scene.height - 7 - sigBandH - footerBandH
          : scene.y.titleTurn?.y ?? scene.plot.y + scene.plot.height / 2;
        return (
          <g pointerEvents="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7}>
            <line x1={cx - 14} x2={cx + 14} y1={cy} y2={cy} />
            <line x1={cx} x2={cx} y1={cy - 14} y2={cy + 14} />
          </g>
        );
      })()}
      {/* category-group separators + names (Axis tab → Category groups). */}
      <CategoryGroupMarks scene={scene} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName} />
      {/* axis titles — double-click to edit in place. The X title sits above the
          significance-legend band and the footer band (both add height at the very bottom). */}
      <text
        x={(scene.x.titleCenter ?? scene.plot.x + scene.plot.width / 2) + axisTitleOff("x").dx}
        y={(scene.x.titlePos ?? scene.height - 7 - sigBandH - footerBandH) + axisTitleOff("x").dy}
        textAnchor="middle"
        {...fontAttrs(scene.fonts.xAxisTitle, "var(--ink)")}
        {...(scene.x.titleFont ? { fontSize: scene.x.titleFont } : {})}
        opacity={editingText({ kind: "axisTitle", axis: "x" }) ? 0 : undefined}
        {...axisTitleDragProps("x")}
        onDoubleClick={(e) => beginEdit(e, { kind: "axisTitle", axis: "x" }, scene.x.title, scene.fonts.xAxisTitle.size, "middle", true)}
      >
        <RichText text={scene.x.title} x={(scene.x.titleCenter ?? scene.plot.x + scene.plot.width / 2) + axisTitleOff("x").dx} />
      </text>
      {scene.y.title && (
        <text
          transform={scene.y.titleTurn
            ? `translate(${scene.y.titleTurn.x + axisTitleOff("y").dx} ${scene.y.titleTurn.y + axisTitleOff("y").dy})${svgTurn(scene.y.titleTurn.angle) ? ` rotate(${svgTurn(scene.y.titleTurn.angle)})` : ""}`
            : `translate(${yTitleX + axisTitleOff("y").dx} ${(scene.y.titleCenter ?? scene.plot.y + scene.plot.height / 2) + axisTitleOff("y").dy}) rotate(-90)`}
          textAnchor={scene.y.titleTurn?.anchor ?? "middle"}
          {...fontAttrs(scene.fonts.yAxisTitle, "var(--ink)")}
          {...(scene.y.titleFont ? { fontSize: scene.y.titleFont } : {})}
          opacity={editingText({ kind: "axisTitle", axis: "y" }) ? 0 : undefined}
          {...axisTitleDragProps("y")}
          onDoubleClick={(e) => beginEdit(e, { kind: "axisTitle", axis: "y" }, scene.y.title, scene.fonts.yAxisTitle.size, "middle", true)}
        >
          <RichText text={scene.y.titleTurn?.text ?? scene.y.title} x={0} />
        </text>
      )}
      {(() => {
        // Title direction: the rotation grip, while the Y axis is selected.
        const g = titleGrip(selected, "y", scene.y, 90, onRotateAxisTitle, scene);
        if (!g) return null;
        const t = scene.y.titleTurn;
        const o = axisTitleOff("y");
        const geo = titleGripGeometry((t?.x ?? yTitleX) + o.dx, (t?.y ?? scene.y.titleCenter ?? scene.plot.y + scene.plot.height / 2) + o.dy, t?.anchor ?? "middle", g.angle, scene.y.titleFont ?? scene.fonts.yAxisTitle.size, t?.text ?? scene.y.title);
        return <TitleRotateGrip cx={geo.cx} cy={geo.cy} angle={g.angle} reach={geo.reach} bounds={g.bounds} onRotate={g.onRotate} />;
      })()}
      <SignificanceKey scene={scene} footerBandH={footerBandH} onMove={onMoveSignificanceCaption} />
      {/* footer / source mark — the bottom-most band, flush with the plot area edges */}
      {scene.footer && (
        <>
          {scene.footer.left && (
            <text
              x={scene.plot.x}
              y={scene.height - 6}
              textAnchor="start"
              {...fontAttrs({ ...scene.fonts.legend, size: Math.round(scene.fonts.legend.size * 0.9) }, "var(--faint)")}
            >
              {scene.footer.left}
            </text>
          )}
          {scene.footer.right && (
            <text
              x={scene.plot.x + scene.plot.width}
              y={scene.height - 6}
              textAnchor="end"
              {...fontAttrs({ ...scene.fonts.legend, size: Math.round(scene.fonts.legend.size * 0.9) }, "var(--faint)")}
            >
              {scene.footer.right}
            </text>
          )}
        </>
      )}

      {/* plot-interior catcher: double-click empty space to drop an editable text box.
          Sits below the series so data clicks win; single clicks bubble to select the plot.
          It stops short of the two axis lines' ink. An axis line is centred on the plot's edge, so half its
          thickness lies inside the plot — and this rect, drawn after the axes, would cover that half: a click on the
          line's own ink would select the plot, with no pointer cursor. At the 1.6× window fit a 2.5 px line would
          lose 2 px that way, and a click dead-centre on the Y line would no longer select the axis. */}
      {onCreateTextBox && (() => {
        const yInk = scene.y.hidden || frame === "none" ? 0 : (scene.y.lineWidth ?? 1.25) / 2;
        const xInk = scene.x.hidden || frame === "none" ? 0 : (scene.x.lineWidth ?? 1.25) / 2;
        return (
          <rect
            x={px + yInk}
            y={py}
            width={Math.max(0, pw - yInk)}
            height={Math.max(0, ph - xInk)}
            fill="transparent"
            onDoubleClick={createTextAt}
          />
        );
      })()}

      {/* Number-at-risk table — rendered outside the plot clip: it sits in the
          bottom margin below the plot rect, so the clip would hide it entirely.
          Draggable as a block (the offset reuses `colorbarOffset` — a survival plot has no
          colour bar, so there's no collision) and each row selects its KM curve. */}
      {scene.atRisk && (() => {
        const at = scene.atRisk;
        const atFont = at.font ?? scene.fonts.tick;
        // A click selects the row the pointer went down on; DraggableGroup's own guard
        // swallows the click that ends a drag, so grabbing a row to move the table
        // doesn't also select it.
        const rowX0 = at.labelX - 4;
        const rowX1 = Math.max(rowX0, ...at.cols) + 14;
        return (
          <DraggableGroup
            offset={scene.colorbarOffset}
            onMove={onMoveColorbar}
            // A row selects its curve; the heading opens the table's size (Survival ▸ Number-at-risk font).
            onSelect={onSelect ? () => { const id = atRiskRowRef.current; onSelect(id ? { kind: "series", columnId: id } : { kind: "chart-section", title: "Survival (Kaplan-Meier)" }); } : undefined}
            title="Drag to move the number-at-risk table · click a row to select its curve"
          >
            <text
              x={at.labelX}
              y={at.top}
              {...fontAttrs(atFont, "var(--ink)")}
              fontWeight={600}
              onPointerDown={() => { atRiskRowRef.current = null; }}
            >
              Number at risk
            </text>
            {at.rows.map((r, i) => {
              const y = at.top + (i + 1) * at.rowH;
              return (
                <g
                  key={`atrisk-${i}`}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  // The row name opens the table's size like the heading does; the counts keep selecting the row's curve.
                  onPointerDown={(e) => { atRiskRowRef.current = (e.target as Element).hasAttribute("data-atrisk-name") ? null : r.seriesId; }}
                >
                  {/* transparent hit-row so the whole line (not just the glyphs) is clickable */}
                  <rect x={rowX0} y={y - at.rowH * 0.75} width={rowX1 - rowX0} height={at.rowH} fill="transparent" />
                  <text data-atrisk-name="" x={at.labelX} y={y} {...fontAttrs(atFont, r.color)} fill={r.color}>
                    {r.label}
                  </text>
                  {r.atRisk.map((v, j) => (
                    <text key={j} x={at.cols[j]} y={y} textAnchor="middle" {...fontAttrs(atFont, r.color)} fill={r.color}>
                      {v}
                    </text>
                  ))}
                </g>
              );
            })}
          </DraggableGroup>
        );
      })()}

      {/* UpSet membership matrix + set-size bars — outside the plot clip like the at-risk
          table: the matrix band sits in the bottom margin, the size bars in the left one.
          Dots/connectors are the drawing; the size bars + row labels are the set's
          click-targets (upset-set → its colour panel); labels drag + rename their column. */}
      {/* Polar histogram / wind rose — rings (the count ladder), stacked wedges (bins:
          clicking one selects the chart-section) and the direction labels (the angular
          axis's ticks). The whole drawing lives here: a rose has no series marks. */}
      {scene.rose && (() => {
        const ro = scene.rose;
        const tickFont = scene.fonts.tick;
        return (
          <g className="gfx-rose">
            {ro.rings.map((rg) => (
              <g key={rg.count}>
                {/* A ring line: its own look (Chart type ▸ Polar histogram), and a click opens those settings. A wide
                    invisible stroke is the click target. */}
                {(ro.ringStyle?.show ?? true) && (
                  <>
                    <circle className="rosering" cx={ro.cx} cy={ro.cy} r={rg.r} fill="none" stroke={ro.ringStyle?.color ?? "var(--line)"}
                      strokeWidth={ro.ringStyle?.width ?? 1} strokeDasharray={ro.ringStyle?.dash ?? undefined} pointerEvents="none" />
                    <circle className="rosering-hit" cx={ro.cx} cy={ro.cy} r={rg.r} fill="none" stroke="transparent" strokeWidth={8}
                      pointerEvents="stroke" style={onSelect ? { cursor: "pointer" } : undefined}
                      onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)} />
                  </>
                )}
                {/* A ring number opens its font (Title & legend ▸ Compass & ring label font). */}
                <text x={rg.labelX} y={rg.labelY} textAnchor="start" {...fontAttrs(tickFont, "var(--muted-ink, var(--ink))")}
                  style={onSelect ? { cursor: "pointer" } : undefined} onClick={(e) => select(LEGEND_TEXT_SECTION, e)}>
                  {rg.count}
                </text>
              </g>
            ))}
            {ro.wedges.flatMap((w) =>
              w.segments.map((s) => (
                <path
                  key={`w${w.index}-b${s.band}`}
                  className="rosewedge"
                  d={s.path}
                  fill={s.color}
                  stroke="var(--bg)"
                  strokeWidth={0.75}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
                >
                  <title>{`${w.count} in this sector${s.band != null && ro.bandRanges.length > 1 ? ` (${s.count} in this band)` : ""}`}</title>
                </path>
              )),
            )}
            {/* Compass letters: each drags on its own and double-click renames it; a click
                opens their font (Title & legend ▸ Compass & ring label font). Keyed by their default words, so a rename stays on its direction. */}
            {ro.directionLabels.map((d) => {
              const key = d.key ?? d.text;
              return (
                <DraggableTitle
                  key={key}
                  text={d.text}
                  x={d.x}
                  y={d.y + tickFont.size * 0.34}
                  anchor="middle"
                  font={tickFont}
                  offset={d.off}
                  onMove={onMoveRoseDirectionLabel ? (dx, dy) => onMoveRoseDirectionLabel(key, dx, dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "roseDirection", key }, d.text, tickFont.size, "middle", false) : undefined}
                  editing={editingText({ kind: "roseDirection", key })}
                  onSelect={onSelect ? () => onSelect(LEGEND_TEXT_SECTION) : undefined}
                />
              );
            })}
          </g>
        );
      })()}

      {scene.sunburst && (() => {
        const su = scene.sunburst;
        return (
          <g className="gfx-sunburst">
            {su.segments.map((s) => (
              <path
                key={s.key}
                className="sunseg"
                d={s.path}
                fill={s.color}
                fillOpacity={su.fillOpacity}
                stroke={su.stroke}
                strokeWidth={su.strokeWidth}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
              >
                <title>{`${s.label}: ${s.value} (${(s.frac * 100).toFixed(1)}%)`}</title>
              </path>
            ))}
            {su.segments.filter((s) => s.showLabel).map((s) => (
              <text
                key={`l-${s.key}`}
                x={s.labelX}
                y={s.labelY}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${s.labelAngle.toFixed(1)} ${s.labelX.toFixed(1)} ${s.labelY.toFixed(1)})`}
                // at the size the builder fitted them at (its Label size, else the tick size) — drawing the tick font
                // would make Label size ineffective and let fitted labels collide ("Bacteria" × "Clostridia")
                {...fontAttrs({ ...scene.fonts.tick, size: su.labelSize ?? scene.fonts.tick.size }, "var(--ink)")}
                pointerEvents="none"
              >
                {su.showValues ? `${s.label} ${(s.frac * 100).toFixed(0)}%` : s.label}
              </text>
            ))}
            {su.centerLabel && (
              <text x={su.centerLabel.x} y={su.centerLabel.y} textAnchor="middle" dominantBaseline="central" {...fontAttrs(scene.fonts.legend, "var(--ink)")} pointerEvents="none">
                {su.centerLabel.text}
              </text>
            )}
          </g>
        );
      })()}

      {scene.chord && (() => {
        const ch = scene.chord;
        return (
          <g className="gfx-chord">
            {/* Ribbons first (behind the arcs). */}
            {ch.ribbons.map((rb, i) => (
              <path
                key={`rb-${rb.source}-${rb.target}-${i}`}
                className="chordribbon"
                d={rb.path}
                fill={rb.color}
                fillOpacity={ch.ribbonOpacity}
                stroke={rb.color}
                strokeOpacity={Math.min(1, ch.ribbonOpacity + 0.15)}
                strokeWidth={0.5}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
              >
                <title>{`${rb.source} ↔ ${rb.target}: ${rb.value}`}</title>
              </path>
            ))}
            {ch.arcs.map((arc) => (
              <path
                key={`arc-${arc.name}`}
                className="chordarc"
                d={arc.path}
                fill={arc.color}
                stroke="var(--bg)"
                strokeWidth={0.75}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
              >
                <title>{`${arc.name}: ${arc.value}`}</title>
              </path>
            ))}
            {ch.arcs.filter((a) => a.showLabel).map((arc) => (
              <text
                key={`cl-${arc.name}`}
                x={arc.labelX}
                y={arc.labelY}
                textAnchor={arc.labelAnchor}
                dominantBaseline="central"
                transform={`rotate(${arc.labelAngle.toFixed(1)} ${arc.labelX.toFixed(1)} ${arc.labelY.toFixed(1)})`}
                {...fontAttrs({ ...scene.fonts.tick, size: ch.labelSize }, "var(--ink)")}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
              >
                {arc.name}
              </text>
            ))}
          </g>
        );
      })()}

      {scene.oncoprint && (() => {
        const op = scene.oncoprint;
        const lf = { ...scene.fonts.tick, size: op.labelSize };
        return (
          <g className="gfx-oncoprint">
            {/* The gap colour (Chart type ▸ Gap colour): behind the tiles, so it shows only in the gaps. A click on a gap
                opens those settings. */}
            {op.gap && (
              <rect className="oncogap" x={op.gap.x} y={op.gap.y} width={op.gap.w} height={op.gap.h} fill={op.gap.color}
                style={onSelect ? { cursor: "pointer" } : undefined}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)} />
            )}
            {op.tiles.map((t) => (
              <g key={`${t.gene}-${t.sample}`}>
                <rect
                  x={t.x}
                  y={t.y}
                  width={t.w}
                  height={t.h}
                  fill={op.emptyColor}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
                >
                  <title>{`${t.gene} · ${t.sample}${t.empty ? "" : ` — ${t.bands.length} alteration${t.bands.length > 1 ? "s" : ""}`}`}</title>
                </rect>
                {t.bands.map((b, k) => (
                  <rect key={k} x={t.x} y={b.y} width={t.w} height={b.h} fill={b.color} pointerEvents="none" />
                ))}
              </g>
            ))}
            {/* Gene names: each drags on its own and double-click renames it — a name is the data, so the rename edits
                its cells. A click opens Chart type. */}
            {op.geneLabels.map((g) => (
              <DraggableTitle
                key={`g-${g.text}`}
                text={g.text}
                x={g.x}
                y={g.y}
                anchor="end"
                baseline="middle"
                font={lf}
                offset={g.off}
                onMove={onMoveOncoprintLabel ? (dx, dy) => onMoveOncoprintLabel("gene", g.text, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "oncoprintLabel", axis: "gene", name: g.text }, g.text, lf.size, "end", false) : undefined}
                editing={editingText({ kind: "oncoprintLabel", axis: "gene", name: g.text })}
                onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Chart type" }) : undefined}
              />
            ))}
            {/* The % numbers get their own group: they are computed counts that stay put, and as siblings of the
                draggable gene names a gesture on the group would be credited to them (the radar ring-scale rule). */}
            <g className="oncopct">
              {op.percentLabels.map((p) => (
                // A % label opens Chart type, where "Show %" is.
                <text key={`p-${p.text}-${p.y}`} x={p.x} y={p.y} textAnchor="end" dominantBaseline="central" {...fontAttrs(lf, "var(--muted-ink, var(--ink))")}
                  style={onSelect ? { cursor: "pointer" } : undefined} onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}>
                  {p.text}
                </text>
              ))}
            </g>
            {/* Sample names (Sample labels on): the same — drag, double-click rename (edits the sample cells), click. */}
            {op.sampleLabels.map((s) => (
              <DraggableTitle
                key={`s-${s.text}`}
                text={s.text}
                x={s.x}
                y={s.y}
                anchor="end"
                rotate={s.angle}
                font={lf}
                offset={s.off}
                onMove={onMoveOncoprintLabel ? (dx, dy) => onMoveOncoprintLabel("sample", s.text, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "oncoprintLabel", axis: "sample", name: s.text }, s.text, lf.size, "end", false) : undefined}
                editing={editingText({ kind: "oncoprintLabel", axis: "sample", name: s.text })}
                onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Chart type" }) : undefined}
              />
            ))}
          </g>
        );
      })()}

      {/* Ternary triangle furniture — edges, ticks, the triangular grid and the three
          edge titles (= composition column names; click → that column's Data panel,
          double-click renames it, drag stores ternary.axisLabelOff). The POINTS are
          ordinary series marks rendered by the generic marker branch on top. */}
      {scene.ternary && (() => {
        const t = scene.ternary;
        const [A, B, C] = t.corners;
        const tickFont = scene.fonts.tick;
        const titleFont = scene.fonts.xAxisTitle;
        return (
          <g className="gfx-ternary">
            <g className="terngrid">
              {t.gridLines.map((l, i) => (
                <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={t.gridStyle.color} strokeWidth={t.gridStyle.width} strokeDasharray={t.gridStyle.dash ?? undefined} pointerEvents="none" />
              ))}
            </g>
            <path d={`M${A.x},${A.y} L${B.x},${B.y} L${C.x},${C.y} Z`} fill="none" stroke="var(--ink)" strokeWidth={1.5} pointerEvents="none" />
            {t.ticks.map((tk, i) => (
              <g key={i} pointerEvents="none">
                <line x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} stroke="var(--ink)" strokeWidth={1} />
                {tk.label !== "" && (
                  <text x={tk.lx} y={tk.ly} textAnchor={tk.anchor} {...fontAttrs(tickFont, "var(--ink)")}>
                    {tk.label}
                  </text>
                )}
              </g>
            ))}
            {t.axisTitles.map((at) => (
              <DraggableTitle
                key={at.datasetId}
                text={at.text}
                x={at.x}
                y={at.y}
                anchor="middle"
                font={titleFont}
                rotate={at.angle !== 0 ? at.angle : undefined}
                offset={at.off}
                onMove={onMoveTernaryAxisLabel ? (dx, dy) => onMoveTernaryAxisLabel(at.datasetId, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "ternaryAxisTitle", datasetId: at.datasetId }, at.text, titleFont.size, "middle", false) : undefined}
                editing={editingText({ kind: "ternaryAxisTitle", datasetId: at.datasetId })}
                // An edge name opens its size: Chart type ▸ Edge name font. (The point panel of the column it names
                // has no control for that font.)
                onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Chart type" }) : undefined}
              />
            ))}
          </g>
        );
      })()}

      {scene.upset && (() => {
        const u = scene.upset;
        const rowFont = scene.fonts.xTick;
        return (
          <g className="upsetmatrix">
            {u.sets.map((s, i) =>
              i % 2 === 1 ? (
                <rect key={`stripe-${s.setId}`} x={px} y={u.matrix.top + i * u.matrix.rowH} width={pw} height={u.matrix.rowH} fill="var(--ink)" opacity={0.05} pointerEvents="none" />
              ) : null,
            )}
            {u.columns.filter((c) => c.members.length > 1).map((c) => (
              <line
                key={`link-${c.key}`}
                className="upsetlink"
                x1={c.cx}
                y1={u.sets[Math.min(...c.members)]!.rowCy}
                x2={c.cx}
                y2={u.sets[Math.max(...c.members)]!.rowCy}
                stroke={u.dotColor}
                strokeWidth={Math.max(1.5, u.matrix.dotR * 0.45)}
                pointerEvents="none"
              />
            ))}
            {u.sets.map((s, i) =>
              u.columns.map((c) => {
                const on = c.members.includes(i);
                return (
                  <circle
                    key={`dot-${s.setId}-${c.key}`}
                    className={on ? "upsetdot on" : "upsetdot"}
                    cx={c.cx}
                    cy={s.rowCy}
                    r={u.matrix.dotR}
                    fill={on ? s.color : u.dotColor}
                    opacity={on ? 1 : 0.18}
                    pointerEvents="none"
                  />
                );
              }),
            )}
            {u.sets.map((s) =>
              s.bar ? (
                <g key={`szbar-${s.setId}`}>
                  <rect
                    className="upsetsetbar"
                    x={s.bar.x}
                    y={s.bar.y}
                    width={s.bar.w}
                    height={s.bar.h}
                    fill={s.color}
                    style={onSelect ? { cursor: "pointer" } : undefined}
                    onClick={(e) => select({ kind: "upset-set", datasetId: s.setId }, e)}
                  />
                  <text
                    x={s.bar.x - 4}
                    y={s.rowCy + rowFont.size * 0.34}
                    textAnchor="end"
                    {...fontAttrs(rowFont, "var(--ink)")}
                    style={onSelect ? { cursor: "pointer" } : undefined}
                    onClick={onSelect ? (e) => select({ kind: "upset-set", datasetId: s.setId }, e) : undefined}
                  >
                    {s.total}
                  </text>
                </g>
              ) : null,
            )}
            {u.sets.map((s) => (
              <DraggableTitle
                key={`lbl-${s.setId}`}
                text={s.label}
                x={s.labelX}
                y={s.labelY}
                anchor="end"
                font={rowFont}
                offset={s.labelOff}
                onMove={onMoveUpsetSetLabel ? (dx, dy) => onMoveUpsetSetLabel(s.setId, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "upsetSetLabel", datasetId: s.setId }, s.label, rowFont.size, "end", false) : undefined}
                editing={editingText({ kind: "upsetSetLabel", datasetId: s.setId })}
                // The label's size is the category label font of the X axis (the matrix rows are its categories);
                // the set's colour / hide stays one click away on its swatch bar.
                onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "x", focus: "labels" }) : undefined}
              />
            ))}
          </g>
        );
      })()}

      {/* Swimmer timeline bars + response overlays — under the event-glyph series (which
          are rendered later, in the clipped group). Drawn outside the clip so the ongoing
          arrows and duration labels can sit past the bar end in the reserved right margin;
          the bar rectangles are clamped to the plot rect by hand instead (pan/zoom safe).
          A bar click selects the Start dataset's per-row point (its colour panel); in
          survival-date mode there is no Start dataset, so the bar selects the chart. */}
      {scene.swimmer && (() => {
        const sw = scene.swimmer;
        const inX = (x: number): boolean => x >= px - 0.5 && x <= px + pw + 0.5;
        const clampRect = (x1: number, x2: number): { x: number; w: number } | null => {
          const a = Math.max(px, Math.min(x1, x2));
          const b = Math.min(px + pw, Math.max(x1, x2));
          return b - a > 0 ? { x: a, w: Math.max(1, b - a) } : null;
        };
        return (
          <g className="swimlayer">
            {sw.rows.map((r) => {
              const bar = clampRect(r.barX1, r.barX2);
              const resp = r.response ? clampRect(r.response.x1, r.response.x2) : null;
              return (
                <g key={r.rowId}>
                  {bar && (
                    <rect
                      className="swimbar"
                      x={bar.x}
                      y={r.cy - r.barH / 2}
                      width={bar.w}
                      height={r.barH}
                      rx={Math.min(3, r.barH / 3)}
                      fill={r.color}
                      style={onSelect ? { cursor: "pointer" } : undefined}
                      onClick={(e) =>
                        select(
                          sw.startId
                            ? { kind: "series", columnId: sw.startId, part: "points", rowId: r.rowId }
                            : { kind: "chart-section", title: "Chart type" }, // the swimmer rows live in Chart type
                          e,
                        )
                      }
                    />
                  )}
                  {resp && (
                    <rect
                      className="swimresp"
                      x={resp.x}
                      y={r.cy - r.barH * 0.22}
                      width={resp.w}
                      height={r.barH * 0.44}
                      rx={2}
                      fill={sw.responseFill}
                      fillOpacity={sw.responseOpacity}
                      pointerEvents="none"
                    />
                  )}
                  {r.ongoing && inX(r.barX2) && (
                    <path
                      className="swimarrow"
                      d={`M ${r.barX2 + 1} ${r.cy - r.barH * 0.45} L ${r.barX2 + 1 + Math.max(8, r.barH * 0.6)} ${r.cy} L ${r.barX2 + 1} ${r.cy + r.barH * 0.45} Z`}
                      fill={r.color}
                      pointerEvents="none"
                    />
                  )}
                  {r.label && inX(r.barX2) && sw.startId && (() => {
                    const cid = sw.startId!;
                    const vlKey = `${cid}:${r.rowId}`;
                    const drag = valueLabelDrag?.key === vlKey ? valueLabelDrag : null;
                    const offDx = drag ? drag.dx : r.label!.dx ?? 0;
                    const offDy = drag ? drag.dy : r.label!.dy ?? 0;
                    vlAnchorsRef.current.set(vlKey, { baseX: r.label!.x, baseY: r.label!.y, x: r.label!.x + (r.label!.dx ?? 0), y: r.label!.y + (r.label!.dy ?? 0) });
                    const vlTarget = { kind: "value" as const, columnId: cid, rowId: r.rowId };
                    const interactive = !!(onMoveValueLabel || onEditText);
                    return (
                      <text
                        className="swimdur"
                        x={r.label!.x + offDx}
                        y={r.label!.y + offDy}
                        {...fontAttrs(scene.fonts.valueLabel, "var(--ink)")}
                        opacity={editingText(vlTarget) ? 0 : undefined}
                        style={interactive ? { cursor: onMoveValueLabel ? "move" : "text" } : undefined}
                        pointerEvents={interactive ? undefined : "none"}
                        {...(onMoveValueLabel
                          ? {
                              onPointerDown: startValueLabelDrag(cid, r.rowId, r.label!.dx ?? 0, r.label!.dy ?? 0),
                              onPointerMove: moveValueLabelDrag,
                              onPointerUp: endValueLabelDrag,
                              onClick: valueLabelClickToSection(LEGEND_TEXT_SECTION),
                            }
                          : {})}
                        {...(onEditText ? { onDoubleClick: (e: React.MouseEvent) => beginEdit(e, vlTarget, r.label!.text, scene.fonts.valueLabel.size, "start", false) } : {})}
                      >
                        {r.label!.text}
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </g>
        );
      })()}

      {scene.tracks && (() => {
        const tr = scene.tracks;
        const fmtBar = (v: number): string => (Number.isInteger(v) ? String(v) : Number(v.toFixed(2)).toString());
        const clampTile = (x: number, w: number): { x: number; w: number } | null => {
          const a = Math.max(px, x);
          const b = Math.min(px + pw, x + w);
          return b - a > 0.25 ? { x: a, w: b - a } : null;
        };
        return (
          <g className="tracklayer">
            {tr.strips.map((s) => (
              <g key={s.id}>
                {s.tiles.map((t, ti) => {
                  const c = clampTile(t.x, t.w);
                  if (!c) return null;
                  return (
                    <rect
                      key={ti}
                      className="tracktile"
                      x={c.x}
                      y={s.y}
                      width={c.w}
                      height={s.h}
                      fill={t.color}
                      shapeRendering="crispEdges"
                      style={onSelect ? { cursor: "pointer" } : undefined}
                      // A numeric track's own colour ramp lives in its series editor ("Colour by
                      // data"), so its tiles select the track's column; a categorical track's
                      // palette lives in the Chart-type section.
                      onClick={(e) => select(s.numeric ? { kind: "series", columnId: s.id } : { kind: "chart-section", title: "Chart type" }, e)}
                    >
                      {(t.label || t.value != null) && <title>{t.label || fmtBar(t.value as number)}</title>}
                    </rect>
                  );
                })}
                {s.colorbar && (() => {
                  const cb = s.colorbar;
                  const segs = cb.stops.length - 1;
                  return (
                    <g className="trackbar" style={onSelect ? { cursor: "pointer" } : undefined}
                      onClick={onSelect ? (e) => select({ kind: "series", columnId: s.id }, e) : undefined}>
                      {cb.stops.slice(0, segs).map((st, k) => {
                        const y0 = cb.y + cb.h * (1 - cb.stops[k + 1]!.offset);
                        const y1 = cb.y + cb.h * (1 - st.offset);
                        // A stepped bar carries two stops at each class edge (same offset), so
                        // the segment between them has no height — drawing it as a 0.5px sliver
                        // would paint the next class's colour along every boundary.
                        if (y1 - y0 < 0.25) return null;
                        return <rect key={k} x={cb.x} y={y0} width={cb.w} height={y1 - y0} fill={cb.stops[k + 1]!.color} />;
                      })}
                      <rect x={cb.x} y={cb.y} width={cb.w} height={cb.h} fill="none" stroke="var(--ink)" strokeOpacity={0.3} strokeWidth={0.75} />
                      <text x={cb.x + cb.w + 3} y={cb.y + 4} {...fontAttrs(scene.fonts.legend, "var(--ink)")} pointerEvents="none">{fmtBar(cb.max)}</text>
                      <text x={cb.x + cb.w + 3} y={cb.y + cb.h - scene.fonts.legend.size * 0.3} {...fontAttrs(scene.fonts.legend, "var(--ink)")} pointerEvents="none">{fmtBar(cb.min)}</text>
                    </g>
                  );
                })()}
              </g>
            ))}
          </g>
        );
      })()}

      {/* series + fitted curve, clipped to the plot area */}
      <g clipPath={`url(#${clipId})`}>
      {/* cross-series spread band + dotted mean line (drawn behind everything) */}
      {scene.spreadBand && (
        <g pointerEvents="none">
          <path d={scene.spreadBand.bandPath} fill={scene.spreadBand.color} fillOpacity={scene.spreadBand.opacity} stroke="none" />
          {scene.spreadBand.meanPath && (
            <path
              d={scene.spreadBand.meanPath}
              fill="none"
              stroke={scene.spreadBand.meanColor ?? "#7a7a85"}
              strokeWidth={2}
              strokeDasharray="2 3"
              strokeLinecap="round"
            />
          )}
          {scene.spreadBand.meanLabel && (
            <text
              x={scene.spreadBand.meanLabel.x + 6}
              y={scene.spreadBand.meanLabel.y}
              {...fontAttrs(scene.fonts.legend, scene.spreadBand.meanLabel.color)}
              fontWeight={600}
              dominantBaseline="middle"
            >
              {scene.spreadBand.meanLabel.text}
            </text>
          )}
        </g>
      )}
      {/* confidence / data ellipses (drawn behind the points). Clickable: a click pins the
          "Confidence ellipse" section open (every element clicks through to its own
          controls). Markers render after these, so a click on a point still hits the point;
          only the ellipse's own interior/border reaches this handler. */}
      {scene.ellipses?.map((e) => (
        <ellipse
          key={`ell-${e.id}`}
          className="gfx-conf-ellipse"
          cx={e.cx}
          cy={e.cy}
          rx={e.rx}
          ry={e.ry}
          transform={`rotate(${e.angle} ${e.cx} ${e.cy})`}
          fill={e.color}
          fillOpacity={e.fillOpacity}
          stroke={e.color}
          strokeWidth={e.borderWidth}
          cursor={onSelect ? "pointer" : undefined}
          onClick={onSelect ? (ev) => select({ kind: "chart-section", title: "Confidence ellipse" }, ev) : undefined}
        >
          <title>Confidence ellipse — click to edit</title>
        </ellipse>
      ))}
      {scene.fit && (
        <>
          <FitOverlay fit={scene.fit} onSelect={onSelect ? (sel, ev) => select(sel, ev) : undefined} />
          {scene.fit.marker && (
            <FitMarker marker={scene.fit.marker} onSelect={onSelect ? (sel, ev) => select(sel, ev) : undefined} />
          )}
        </>
      )}
      {/* Per-dataset global-fit curves, each colour-matched to its series. Their parameter
          blocks and potency labels are drawn AFTER the clip closes (below). */}
      {scene.fits?.map((f, i) => (
        <g key={`gfit-${i}`} className="gfx-globalfit">
          <FitOverlay fit={f} onSelect={onSelect ? (sel, ev) => select(sel, ev) : undefined} />
          {f.marker && <FitMarker marker={f.marker} onSelect={onSelect ? (sel, ev) => select(sel, ev) : undefined} />}
        </g>
      ))}
      {/* Funnel trim-and-fill: the imputed (mirrored) studies as hollow dots — chrome,
          not series marks (no table row exists to click); above the region shading,
          just under the real study dots. Colour follows the study-dot series. */}
      {scene.funnel?.imputed && (
        <g className="gfx-tfimputed" pointerEvents="none">
          {scene.funnel.imputed.map((d, i) => (
            <circle key={i} cx={d.cx} cy={d.cy} r={d.r} fill="none" stroke={scene.series[0]?.color ?? "var(--ink)"} strokeWidth={1.5} />
          ))}
        </g>
      )}
      {/* Draw bar series first, then composite trace (plotAs:"line") series last, so an
          overlaid line always paints ON TOP of every bar — in overlay/diverging mode the
          bars are full-width and would otherwise hide a trace from an earlier series.
          A stable sort keeps each group's relative order (bar z-order unchanged). */}
      {[...scene.series]
        .sort((a, b) => compositeRank(a) - compositeRank(b))
        .map((series) => {
        const isSel = selected?.kind === "series" && selected.columnId === series.id;
        return (
          <g className="gfx-series" key={series.id} data-mady-series={series.id}>
            {/* area fill (area charts) — honours the series fill colour/opacity/gradient */}
            {series.areaPath && (
              <path
                d={series.areaPath}
                fill={fillPaint(series)}
                fillOpacity={series.fillOpacity}
                stroke="transparent"
                strokeWidth={10}
                style={{ cursor: "pointer" }}
                {...(series.marks.length === 0 ? madyTip(peakTip(series.name, series.areaPath)) : {})}
                onClick={(e) => select({ kind: "series", columnId: series.id, part: "line" }, e)}
              />
            )}
            {/* nested level bands (ridgeline `bands`) — the banded fill replaces areaPath;
                drawn shallow→deep so each level sits on the one below. A band click opens
                the Chart type section — the rose-wedge / volcano-zone rule: the fill is a
                plot-wide ramp (Level bands · Fold origin · Band colours all live there), and
                the series line panel has no controls that affect it. */}
            {series.levelBands?.map((lb, k) => (
              <path
                key={`lvl-${series.id}-${k}`}
                className="gfx-levelband"
                d={lb.path}
                fill={lb.color}
                fillOpacity={series.fillOpacity ?? 1}
                /* a page-colour hairline on every slice draws a pale contour seam
                   between nested levels */
                stroke="var(--bg)"
                strokeWidth={1}
                strokeLinejoin="round"
                style={{ cursor: "pointer" }}
                {...madyTip(peakTip(series.name, series.areaPath || lb.path))}
                onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
              />
            ))}
            {/* bars (categorical charts) — drawn behind the error bars. The bar always
                shows its real fill + contour; selection is a separate accent outline so it
                never masks the colours being edited. */}
            {isCat &&
              series.marks.map((m) =>
                m.bar ? (
                  <g key={`bar-${series.id}-${m.rowId}`}>
                    {scene.barShape === "roundtop" ? (
                      <path
                        id={`mark-${series.id}-${m.rowId}`}
                        d={roundTopPath(m.bar, scene.barHorizontal)}
                        fill={markFillPaint(series, m)}
                        fillOpacity={m.fillOpacity ?? series.fillOpacity}
                        stroke={m.borderColor ?? series.borderColor}
                        strokeWidth={m.borderWidth ?? series.borderWidth}
                        strokeLinejoin="round"
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHover({ mark: m, series })}
                        {...madyTip(markTipLines(scene, m, series))}
                        onClick={(e) => select({ kind: "series", columnId: series.id, part: "points", rowId: m.rowId }, e)}
                      />
                    ) : (
                      <rect
                        id={`mark-${series.id}-${m.rowId}`}
                        x={m.bar.x}
                        y={m.bar.y}
                        width={m.bar.w}
                        height={m.bar.h}
                        rx={scene.barShape === "rounded" ? Math.min(m.bar.w / 2, m.bar.h, 7) : 0}
                        fill={markFillPaint(series, m)}
                        fillOpacity={m.fillOpacity ?? series.fillOpacity}
                        stroke={m.borderColor ?? series.borderColor}
                        strokeWidth={m.borderWidth ?? series.borderWidth}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => setHover({ mark: m, series })}
                        {...madyTip(markTipLines(scene, m, series))}
                        onClick={(e) => select({ kind: "series", columnId: series.id, part: "points", rowId: m.rowId }, e)}
                      />
                    )}
                    {isSel && (
                      /* Selection frame — UI chrome, not part of the figure.
                       *
                       * Note: it deliberately does not take the X-axis colour and width (in
                       * the house default, pure black at 2.5px). On a two-tone bar (2px
                       * coloured contour) that would put a heavier black ring right against
                       * the edge being edited, reading as a second outline belonging to the
                       * artwork. It uses the UI accent instead, thinner than any plausible
                       * bar contour, and sits far enough out to clear it — so the real
                       * colours can be judged while the bar is selected.
                       */
                      <rect
                        x={m.bar.x - 4}
                        y={m.bar.y - 4}
                        width={m.bar.w + 8}
                        height={m.bar.h + 8}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                    )}
                    {scene.valueLabels?.show && Number.isFinite(m.dy) && (() => {
                      const bar = m.bar!;
                      const vlKey = `${series.id}:${m.rowId}`;
                      const drag = valueLabelDrag?.key === vlKey ? valueLabelDrag : null;
                      const offDx = drag ? drag.dx : m.valueDx ?? 0;
                      const offDy = drag ? drag.dy : m.valueDy ?? 0;
                      const labelText = m.valueText ?? fmtValueLabel(m.dy, scene.valueLabels!.decimals);
                      const vlp = valueLabelPlace(scene, bar, m.dy, labelText);
                      const { anchor, baseX, baseY } = vlp;
                      // Register this label's resting position for the magnetic drag of any other.
                      vlAnchorsRef.current.set(vlKey, { baseX, baseY, x: baseX + (m.valueDx ?? 0), y: baseY + (m.valueDy ?? 0) });
                      const target = { kind: "value" as const, columnId: series.id, rowId: m.rowId };
                      const interactive = !!(onMoveValueLabel || onEditText);
                      return (
                        <OnDataText out={inClip(baseX, baseY)} layer={textLayer}>
                        <text
                          x={baseX + offDx}
                          y={baseY + offDy}
                          textAnchor={anchor}
                          {...fontAttrs(scene.fonts.valueLabel, "var(--ink)")}
                          opacity={editingText(target) ? 0 : undefined}
                          style={interactive ? { cursor: onMoveValueLabel ? "move" : "text" } : undefined}
                          pointerEvents={interactive ? undefined : "none"}
                          {...(onMoveValueLabel
                            ? {
                                onPointerDown: startValueLabelDrag(series.id, m.rowId, m.valueDx ?? 0, m.valueDy ?? 0),
                                onPointerMove: moveValueLabelDrag,
                                onPointerUp: endValueLabelDrag,
                                // UpSet's counts: its series is the synthetic `__upsetn__`, whose panel has no size.
                                onClick: scene.kind === "upset" ? valueLabelClickToSection(LEGEND_TEXT_SECTION) : valueLabelClick,
                              }
                            : {})}
                          {...(onEditText
                            ? { onDoubleClick: (e: React.MouseEvent) => beginEdit(e, target, labelText, scene.fonts.valueLabel.size, anchor, false) }
                            : {})}
                        >
                          {labelText}
                        </text>
                        </OnDataText>
                      );
                    })()}
                  </g>
                ) : null,
              )}
            {/* box / violin / scatter glyphs (categorical charts) */}
            {isCat &&
              series.marks.map((m) => {
                const props = {
                  mark: m,
                  series,
                  selected: isSel,
                  accent,
                  fillPaint: fillPaint(series),
                  horizontal: !!scene.distHorizontal,
                  onHover: () => setHover({ mark: m, series }),
                  tip: madyTip(markTipLines(scene, m, series)),
                  onClick: (e: React.MouseEvent) => select({ kind: "series", columnId: series.id, part: "points", rowId: m.rowId }, e),
                };
                // A mark may carry more than one glyph (box/violin + a points overlay
                // when "show all points" is on) — compose them, body first, points on top.
                const glyphs = [
                  m.violin ? <ViolinGlyph key={`vl-${series.id}-${m.rowId}`} {...props} /> : null,
                  m.box ? <BoxGlyph key={`box-${series.id}-${m.rowId}`} {...props} /> : null,
                  m.points ? <ScatterGlyph key={`sc-${series.id}-${m.rowId}`} {...props} /> : null,
                ].filter(Boolean);
                if (glyphs.length === 0) return null;
                if (glyphs.length === 1) return glyphs[0];
                return <g key={`grp-${series.id}-${m.rowId}`}>{glyphs}</g>;
              })}
            {/* edge handles for mouse-resizing box / violin / bar width
                (vertical only; horizontal distribution uses the inspector slider) */}
            {isCat &&
              onWidthResize &&
              !scene.distHorizontal &&
              series.marks.map((m) => {
                if (m.violin) {
                  return (
                    <EdgeHandles
                      key={`rz-${series.id}-${m.rowId}`}
                      edges={[m.violin.cx - m.violin.halfWidth, m.violin.cx + m.violin.halfWidth]}
                      y={Math.min(m.box?.whiskerHigh ?? m.cy, m.box?.whiskerLow ?? m.cy)}
                      h={Math.abs((m.box?.whiskerLow ?? m.cy) - (m.box?.whiskerHigh ?? m.cy))}
                      onStart={(e) => startResize(e, series.id, m.violin!.cx)}
                    />
                  );
                }
                if (m.box) {
                  const yTop = Math.min(m.box.q1, m.box.q3);
                  return (
                    <EdgeHandles
                      key={`rz-${series.id}-${m.rowId}`}
                      edges={[m.box.x, m.box.x + m.box.w]}
                      y={yTop}
                      h={Math.abs(m.box.q1 - m.box.q3)}
                      onStart={(e) => startResize(e, series.id, m.box!.x + m.box!.w / 2)}
                    />
                  );
                }
                if (m.bar && !scene.barHorizontal) {
                  // (width drag is for vertical bars; horizontal uses the inspector slider)
                  return (
                    <EdgeHandles
                      key={`rz-${series.id}-${m.rowId}`}
                      edges={[m.bar.x, m.bar.x + m.bar.w]}
                      y={m.bar.y}
                      h={m.bar.h}
                      onStart={(e) => startResize(e, series.id, m.cx)}
                    />
                  );
                }
                return null;
              })}
            {/* The band behind the line: a survival CI, or an XY/area error interval drawn as
                a ribbon (`errorDisplay`). Same path, same layer — a band is a band. */}
            {series.bandPath && (
              <path
                d={series.bandPath}
                fill={series.bandColor ?? series.lineColor ?? series.color}
                fillOpacity={series.bandOpacity ?? 0.15}
                /* The outline traces the same closed path as the fill — one geometry, so the
                   edge is exactly the interval's boundary and cannot drift from it. Full
                   opacity deliberately: a faint fill with a crisp edge is the point. */
                stroke={series.bandEdgeWidth ? (series.bandEdgeColor ?? series.bandColor ?? series.color) : "none"}
                strokeWidth={series.bandEdgeWidth ?? 0}
                strokeDasharray={series.bandEdgeDash ?? undefined}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            {!isCat && series.linePath && (
              <>
                {/* wide transparent hit-stroke so the thin line is easy to click — and, hovered
                    between the value spots (or where another curve lies over them), it names
                    its curve in the interactive HTML export */}
                <path
                  d={series.linePath}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "pointer" }}
                  {...madyTip([series.name])}
                  onClick={(e) => select({ kind: "series", columnId: series.id, part: "line" }, e)}
                />
                {/* A curve with no data points (survival steps, an ROC curve, dendrogram
                    branches): invisible hover spots at its corners, each reading its own
                    X and Y back off the axes — the hover values of the interactive HTML export.
                    A click on one is a click on the line. */}
                {series.marks.length === 0 &&
                  pathCorners(series.linePath, 80).map(([vx, vy], vi) => (
                    <circle
                      key={`tip-${series.id}-${vi}`}
                      cx={vx}
                      cy={vy}
                      r={5}
                      fill="transparent"
                      style={{ cursor: "pointer" }}
                      {...madyTip([series.name, `${scene.axisLabels.x || "X"}: ${tipRead(dataXAt(vx))}`, `${scene.axisLabels.y || "Y"}: ${tipRead(dataYAt(vy))}`])}
                      onClick={(e) => select({ kind: "series", columnId: series.id, part: "line" }, e)}
                    />
                  ))}
                <path
                  d={series.linePath}
                  fill="none"
                  stroke={series.lineColor ?? series.color}
                  strokeWidth={series.lineWidth + (isSel ? 1.2 : 0)}
                  strokeDasharray={series.dash ?? undefined}
                  strokeLinecap={series.dash ? "round" : undefined}
                  pointerEvents="none"
                />
                {/* censoring ticks — a small vertical mark on the step line */}
                {series.censorTicks?.map((tk, ti) => (
                  <line key={`cens-${series.id}-${ti}`} x1={tk.x} y1={tk.y - 5} x2={tk.x} y2={tk.y + 5} stroke={series.lineColor ?? series.color} strokeWidth={Math.max(1.2, series.lineWidth)} pointerEvents="none" />
                ))}
              </>
            )}
            {/* Composite bars+line: an overlaid connecting line for a plotAs:"line"
                series on a categorical (bar) chart — drawn OVER the bars. */}
            {series.overlayLine && (
              <>
                <path
                  d={series.overlayLine}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => select({ kind: "series", columnId: series.id, part: "line" }, e)}
                />
                <path
                  d={series.overlayLine}
                  fill="none"
                  stroke={series.lineColor ?? series.color}
                  strokeWidth={series.lineWidth + (isSel ? 1.2 : 0)}
                  strokeDasharray={series.dash ?? undefined}
                  strokeLinecap={series.dash ? "round" : undefined}
                  pointerEvents="none"
                />
              </>
            )}
            {/* error bars (drawn behind the markers, by default)

                Caution: the `-${i}` on every key in this block is load-bearing. `rowId` is unique
                within a series on most kinds, but before–after makes each subject (row) its own
                series and stamps every one of that subject's condition marks with the same
                `rowId` — so `${series.id}-${m.rowId}` alone would collide across the whole plot
                (`g-ba-r0-g-ba-r0`) and React would reconcile siblings it cannot
                tell apart. The element `id` deliberately does not get the suffix: `e2e/app.ts`
                parses `mark-<seriesId>-<rowId>` and would read the index as part of the row id. */}
            {series.marks.map((m, i) => {
              // `showErrorBars === false` = the interval is drawn as a ribbon instead; the
              // marks still carry it (domain, tooltip, export), only the T-bars stand down.
              const primary = series.showErrorBars === false ? false : scene.barHorizontal
                ? m.errLowCx !== undefined || m.errHighCx !== undefined
                : m.errLowCy !== undefined || m.errHighCy !== undefined;
              // On a non-transposed plot the X-error subcolumn adds horizontal caps
              // that coexist with the vertical (Y) error bar — the XY ± cross.
              const xErr = !scene.barHorizontal && (m.errLowCx !== undefined || m.errHighCx !== undefined);
              return (
                <Fragment key={`err-${series.id}-${m.rowId}-${i}`}>
                  {primary && <ErrorBar mark={m} series={series} horizontal={!!scene.barHorizontal} />}
                  {xErr && <ErrorBar mark={m} series={series} horizontal symmetric />}
                </Fragment>
              );
            })}
            {!isCat &&
              series.marks.map((m, i) => {
                const hot = hover?.series.id === series.id && hover?.mark.rowId === m.rowId;
                return (
                  <g key={`mark-${series.id}-${m.rowId}-${i}`} id={`mark-${series.id}-${m.rowId}`}>
                    <Marker
                      shape={m.symbol ?? series.symbol}
                      cx={m.cx}
                      cy={m.cy}
                      size={(m.symbolSize ?? series.symbolSize) + (hot ? 1.6 : isSel ? 1 : 0)}
                      color={m.fill ?? series.color}
                      fill={m.symbolFill ?? series.symbolFill}
                      fillColor={m.symbolFillColor ?? series.symbolFillColor}
                      opacity={m.symbolOpacity ?? m.fillOpacity ?? series.symbolOpacity}
                      outline={m.symbolOutline ?? series.symbolOutline}
                      // Note: `symbolBorderWidth` wins: on a bar, `borderWidth` is the bar's own
                      // contour, and the two must not move together. Undefined on every other
                      // kind, where the marker is the series and inheriting is correct.
                      borderWidth={series.symbolBorderWidth ?? series.borderWidth}
                    />
                  </g>
                );
              })}
            {/* data-driven point labels — a small value/column text beside each marker,
                individually draggable via the shared value-label nudge (valueDx/valueDy). */}
            {series.marks.map((m, i) => {
                if (!m.pointLabel) return null;
                // A category kind labels only a mark drawn as a point — a bar rendered as dots with
                // Show values on; a bar keeps the bar value label drawn above. Skipping category
                // kinds entirely here would leave that option drawing nothing.
                if (isCat && m.bar) return null;
                const vlKey = `${series.id}:${m.rowId}`;
                const drag = valueLabelDrag?.key === vlKey ? valueLabelDrag : null;
                const offDx = drag ? drag.dx : m.valueDx ?? 0;
                const offDy = drag ? drag.dy : m.valueDy ?? 0;
                // The builder's placement rule may have moved this label clear of the marks,
                // the line and the legend (`pointLabelDx/Dy`); without it, beside the marker as
                // always. The user's drag (valueDx/valueDy) is added on top of either.
                const baseX = m.pointLabelDx != null ? m.cx + m.pointLabelDx : m.cx + (m.symbolSize ?? series.symbolSize) + 3;
                const baseY = (m.pointLabelDy != null ? m.cy + m.pointLabelDy : m.cy) + (series.pointLabelSize ?? scene.fonts.valueLabel.size) * 0.34;
                vlAnchorsRef.current.set(vlKey, { baseX, baseY, x: baseX + (m.valueDx ?? 0), y: baseY + (m.valueDy ?? 0) });
                // A per-point text override (double-click edit) wins over the data-driven label.
                const labelText = m.valueText != null && m.valueText !== "" ? m.valueText : m.pointLabel;
                const vlTarget = { kind: "value" as const, columnId: series.id, rowId: m.rowId };
                return (
                  <OnDataText key={`plabelg-${series.id}-${m.rowId}-${i}`} out={inClip(baseX, baseY)} layer={textLayer}>
                  <g>
                  {/* The leader: only present when the placement rule moved the label far
                      enough that which point it names would otherwise be a guess. */}
                  {m.pointLabelLeader && (
                    // (x1, y1) is on the point, (x2, y2) at the label: only the label's end follows its drag.
                    <line
                      data-point-leader={`${series.id}:${m.rowId}`}
                      x1={m.pointLabelLeader.x1} y1={m.pointLabelLeader.y1}
                      x2={m.pointLabelLeader.x2 + offDx} y2={m.pointLabelLeader.y2 + offDy}
                      // The series' own leader look (Data tab ▸ Leader line); its own colour draws at full strength.
                      stroke={m.pointLabelLeader.color ?? series.pointLabelColor ?? series.color} strokeWidth={m.pointLabelLeader.width ?? 0.75}
                      opacity={m.pointLabelLeader.color ? 1 : 0.6}
                      pointerEvents="none"
                    />
                  )}
                  <text
                    key={`plabel-${series.id}-${m.rowId}-${i}`}
                    x={baseX + offDx}
                    y={baseY + offDy}
                    textAnchor={m.pointLabelAnchor ?? "start"}
                    {...fontAttrs(scene.fonts.valueLabel, series.pointLabelColor ?? series.color)}
                    {...(series.pointLabelSize ? { fontSize: series.pointLabelSize } : {})}
                    opacity={editingText(vlTarget) ? 0 : undefined}
                    style={onMoveValueLabel || onEditText ? { cursor: "move" } : undefined}
                    pointerEvents={onMoveValueLabel || onEditText ? undefined : "none"}
                    {...(onMoveValueLabel
                      ? {
                          onPointerDown: startValueLabelDrag(series.id, m.rowId, m.valueDx ?? 0, m.valueDy ?? 0),
                          onPointerMove: moveValueLabelDrag,
                          onPointerUp: endValueLabelDrag,
                          // The series panel offers "Label size" only on DATA_DRIVEN_KINDS; elsewhere the size is the
                          // chart-wide Value label font.
                          onClick: DATA_DRIVEN_KINDS.has(scene.kind) ? valueLabelClick : valueLabelClickToSection(LEGEND_TEXT_SECTION),
                        }
                      : {})}
                    {...(onEditText ? { onDoubleClick: (e: React.MouseEvent) => beginEdit(e, vlTarget, labelText, series.pointLabelSize ?? scene.fonts.valueLabel.size, "start", false) } : {})}
                  >
                    {labelText}
                  </text>
                  </g>
                  </OnDataText>
                );
              })}
            {/* Direct label — this series named on the drawing, instead of a legend row
                (`legend.position` = "direct"). Placed by the builder clear of the data; the
                user's drag rides on top, exactly as it does for a point label. */}
            {series.directLabel && (
              <OnDataText
                key={`dlabel-${series.id}`}
                out={inClip(series.directLabel.x, series.directLabel.y)}
                layer={textLayer}
              >
              <g>
                {series.directLabel.leader && (() => {
                  // (x1, y1) sits on the point, (x2, y2) at the name: only the name's end follows a drag of the name.
                  // Moving both ends would pull the line off the point it names.
                  const ld = series.directLabel.leader;
                  const x2 = ld.x2 + (series.directLabel.offset?.dx ?? 0);
                  const y2 = ld.y2 + (series.directLabel.offset?.dy ?? 0);
                  return (
                    <>
                      {/* The series' own leader look (Data tab ▸ Leader line); its own colour draws at full strength. */}
                      <line data-leader={series.id} x1={ld.x1} y1={ld.y1} x2={x2} y2={y2} stroke={ld.color ?? series.color} strokeWidth={ld.width ?? 0.75}
                        opacity={ld.color ? 1 : 0.6} pointerEvents="none" />
                      {/* Its click target: the line belongs to the series, so it opens the series. */}
                      {onSelect && (
                        <line data-leader-hit={series.id} x1={ld.x1} y1={ld.y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={8}
                          style={{ cursor: "pointer" }} onClick={(e) => select({ kind: "series", columnId: series.id, part: "line" }, e)} />
                      )}
                    </>
                  );
                })()}
                <DraggableTitle
                  text={series.directLabel.text}
                  x={series.directLabel.x}
                  y={series.directLabel.y + scene.fonts.legend.size * 0.34}
                  anchor={series.directLabel.anchor}
                  font={scene.fonts.legend}
                  color={series.color}
                  offset={series.directLabel.offset}
                  onMove={onMoveDirectLabel ? (dx, dy) => onMoveDirectLabel(series.id, dx, dy) : undefined}
                  /* The editor is seeded with the series' name, not the drawn text. On a ROC
                     the drawn text is "Biomarker (AUC 0.860…)" and the editable identity behind
                     it is the column called "Biomarker" — seeding with the drawn string would
                     write the AUC into the column header as soon as Enter is pressed. */
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "directLabel", datasetId: series.id }, series.name, scene.fonts.legend.size, series.directLabel!.anchor, false) : undefined}
                  editing={editingText({ kind: "directLabel", datasetId: series.id })}
                  // A direct label is the legend drawn beside its line, lettered with the legend font — so, like a
                  // legend label, its click opens Text ▸ Title & legend, where that size is. The
                  // line and its points still select the series.
                  onSelect={onSelect ? () => onSelect(LEGEND_TEXT_SECTION) : undefined}
                />
              </g>
              </OnDataText>
            )}
            {!isCat &&
              series.marks.map((m, i) => (
                <circle
                  key={`hit-${series.id}-${m.rowId}-${i}`}
                  cx={m.cx}
                  cy={m.cy}
                  r={10}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ mark: m, series })}
                  {...madyTip(markTipLines(scene, m, series))}
                  onClick={(e) => select({ kind: "series", columnId: series.id, part: "points", rowId: m.rowId }, e)}
                />
              ))}
          </g>
        );
      })}
      {/* Histogram distribution-curve overlays (normal / density) — drawn last inside the clip so
          they ride over the bars. A transparent hit-stroke routes a click to the Chart-type block
          where the curves are toggled + styled (every element reaches its own tab). */}
      {/* Pareto cumulative-% line — a readout of the bars on the Y2 axis; a click opens the
          bar Chart-type block where it is toggled + recoloured. Small dots mark each category's
          running total so the eye can read the share off the right axis. */}
      {scene.paretoLine && (
        <g className="gfx-pareto-g">
          <path
            className="gfx-pareto-hit"
            d={scene.paretoLine.path}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ cursor: "pointer" }}
            onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
          />
          <path
            className="gfx-pareto"
            d={scene.paretoLine.path}
            fill="none"
            stroke={scene.paretoLine.color}
            strokeWidth={scene.paretoLine.width}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
          {scene.paretoLine.points.map((p, i) => (
            <circle key={`pareto-pt-${i}`} className="gfx-pareto-pt" cx={p.cx} cy={p.cy} r={3} fill={scene.paretoLine!.color} pointerEvents="none" />
          ))}
        </g>
      )}
      {scene.distributionCurves?.map((c, i) => (
        <g key={`distcurve-${c.label}-${i}`}>
          <path
            className="gfx-distcurve-hit"
            d={c.path}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            style={{ cursor: "pointer" }}
            onClick={(e) => select({ kind: "chart-section", title: "Chart type" }, e)}
          />
          <path
            className="gfx-distcurve"
            d={c.path}
            fill="none"
            stroke={c.color}
            strokeWidth={c.width}
            strokeDasharray={c.dash ?? undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents="none"
          />
        </g>
      ))}
      </g>
      {/* The text layer — after the plot's clip closes. A label that sits on the data (a value
          number, a point's name, a series' direct label) is drawn inside the clip, so moving it
          off the plot would cut it there, long before the figure's own edge (the UpSet counts,
          the volcano's gene names, the ranked-dots numbers, the time-course direct labels).
          Text must be able to be dragged around without being cut. A label that has been
          moved is drawn in here instead; one left where the app put it stays clipped, so a point
          zoomed out of view does not leave its name floating in the margin. */}
      <g className="gfx-textlayer" ref={setTextLayer} />
      {/* Fit texts — the parameter block and the potency label, for the single fit and each
          per-series fit — sit outside the plot's clip. Inside it, a block dragged off the plot
          to clear a busy graph would be cut at the axes or vanish. The curve, bands
          and crosshair above stay clipped. The block is the convention journal kinetics panels
          follow, typeset through RichText so "K_{M}"
          prints a real subscript. A per-series fit's texts wear its colour (two blocks need
          saying which is whose) and a drag lands on that fit's offsets (`fitsOffsets[i]`). */}
      {[...(scene.fit ? [{ f: scene.fit, i: undefined as number | undefined }] : []), ...(scene.fits ?? []).map((f, i) => ({ f, i: i as number | undefined }))].map(({ f, i }) => (
        <g key={i === undefined ? "fit-texts" : `gfit-texts-${i}`} className="gfx-fit-texts">
          {f.params && (() => {
            const p = f.params;
            const bo = p.offset ?? { dx: 0, dy: 0 };
            const font = { ...scene.fonts.legend, size: p.size };
            const selectBlock = onSelect ? () => onSelect(FIT_PARAMS_SECTION) : undefined;
            // One block: a per-series fit, a block set to move together, or a scene with no items.
            if (i !== undefined || p.together || !p.items) {
              const keys = (p.items ?? []).map((it) => it.key);
              const target: TextTarget = { kind: "fitParams", keys };
              return (
                <DraggableTitle
                  text={p.lines.join("\n")}
                  x={p.x}
                  y={p.y}
                  anchor={p.anchor}
                  font={font}
                  {...(i !== undefined ? { color: f.color } : {})}
                  halo="var(--bg)"
                  offset={p.offset}
                  onMove={onMoveFitParams ? (dx, dy) => (i === undefined ? onMoveFitParams(dx, dy) : onMoveFitParams(dx, dy, i)) : undefined}
                  onEdit={onEditText && i === undefined && keys.length > 0 ? (e) => beginEdit(e, target, p.lines.join("\n"), p.size, p.anchor, true) : undefined}
                  editing={i === undefined && editingText(target)}
                  onSelect={selectBlock}
                />
              );
            }
            // Each line its own text: dragged, edited and selected on its own.
            // Its place = the block's place + one line step (RichText's 1.2em) + its own offset.
            return p.items.map((it, k) => {
              const lo = it.offset ?? { dx: 0, dy: 0 };
              const target: TextTarget = { kind: "fitParams", keys: [it.key] };
              return (
                <DraggableTitle
                  key={`fitline-${it.key}`}
                  text={it.text}
                  x={p.x}
                  y={p.y + k * p.size * 1.2}
                  anchor={p.anchor}
                  font={font}
                  halo="var(--bg)"
                  offset={{ dx: bo.dx + lo.dx, dy: bo.dy + lo.dy }}
                  onMove={onMoveFitParamLine ? (dx, dy) => onMoveFitParamLine(it.key, dx - bo.dx, dy - bo.dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, target, it.text, p.size, p.anchor, false) : undefined}
                  editing={editingText(target)}
                  onSelect={selectBlock}
                />
              );
            });
          })()}
          {f.marker && (
            <DraggableTitle
              text={f.marker.label}
              x={f.marker.labelX}
              y={f.marker.labelY}
              anchor={f.marker.labelAnchor ?? "start"}
              // The tick font's size and family, not its colour: the curve's colour says which fit it is.
              font={f.marker.labelFont ?? { ...scene.fonts.tick, color: null }}
              weight={600}
              color={f.marker.color}
              halo="var(--bg)"
              offset={f.marker.labelOffset}
              onMove={onMoveFitLabel ? (dx, dy) => (i === undefined ? onMoveFitLabel(dx, dy) : onMoveFitLabel(dx, dy, i)) : undefined}
              onSelect={onSelect ? () => onSelect({ kind: "refline", id: "fit-marker" }) : undefined}
            />
          )}
        </g>
      ))}
      {/* Magnetic-alignment guide: the line the dragged value label snapped to. */}
      {valueLabelDrag?.guideY !== undefined && (
        <line className="gfx-vl-guide" x1={scene.plot.x} x2={scene.plot.x + scene.plot.width} y1={valueLabelDrag.guideY} y2={valueLabelDrag.guideY} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
      )}
      {valueLabelDrag?.guideX !== undefined && (
        <line className="gfx-vl-guide" x1={valueLabelDrag.guideX} x2={valueLabelDrag.guideX} y1={scene.plot.y} y2={scene.plot.y + scene.plot.height} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
      )}

      {/* Forest-plot pooled summary — three forms, chosen in the builder.
          Note: every appearance value is resolved there from seriesStyles["forest-summary"]
          (including whether it follows the study style); this reads them and does no lookup of
          its own, so stroke, width and shape all stay tunable.
          Clickable, so selecting it opens its own controls — the same gesture as clicking any
          other mark. */}
      {scene.forestSummary && (() => {
        const f = scene.forestSummary;
        const pick = (e: React.MouseEvent): void => {
          e.stopPropagation();
          onSelect?.({ kind: "series", columnId: "forest-summary", part: "points" });
        };
        const hit = { className: "gfx-forest-summary", style: { cursor: onSelect ? "pointer" : "default" }, onClick: pick };
        const paint = { fill: f.color, fillOpacity: f.fillOpacity, stroke: f.outline, strokeWidth: f.outlineWidth };
        if (f.shape === "marker") {
          // The CI is the whisker here, not the body of the shape — so it is still drawn, and
          // the summary still reports its interval. Dropping it would turn the pooled estimate
          // into a bare dot that claims no precision at all.
          return (
            <g {...hit}>
              <title>Pooled summary</title>
              <line x1={f.xLo} y1={f.cy} x2={f.xHi} y2={f.cy} stroke={f.outline} strokeWidth={Math.max(1, f.outlineWidth)} />
              <line x1={f.xLo} y1={f.cy - f.halfH * 0.5} x2={f.xLo} y2={f.cy + f.halfH * 0.5} stroke={f.outline} strokeWidth={Math.max(1, f.outlineWidth)} />
              <line x1={f.xHi} y1={f.cy - f.halfH * 0.5} x2={f.xHi} y2={f.cy + f.halfH * 0.5} stroke={f.outline} strokeWidth={Math.max(1, f.outlineWidth)} />
              <Marker
                shape={f.symbol}
                cx={f.cx}
                cy={f.cy}
                size={f.symbolSize}
                color={f.color === "none" ? f.outline : f.color}
                fill={f.symbolFill}
                {...(f.color === "none" ? {} : { fillColor: f.color })}
                outline={f.outline}
                borderWidth={f.outlineWidth}
                opacity={f.fillOpacity}
              />
            </g>
          );
        }
        /**
         * Every shape below spans xLo…xHi. There are more summary shapes than the diamond
         * and the box. The horizontal extent is the pooled confidence interval, so
         * a new shape may change what the outline looks like and nothing else — one that did
         * not reach both ends would stop reporting the interval, which is the only reason the
         * summary exists. `x0`/`x1` are used everywhere for that reason, never a fixed width.
         */
        const x0 = Math.min(f.xLo, f.xHi);
        const x1 = Math.max(f.xLo, f.xHi);
        const w = x1 - x0;
        if (f.shape === "bar" || f.shape === "roundbar") {
          return (
            <rect
              {...hit}
              {...paint}
              x={x0}
              y={f.cy - f.halfH}
              width={w}
              height={f.halfH * 2}
              // Rounded to a stadium: capped at half the height so a short CI cannot round
              // itself into a circle and read as a marker rather than an interval.
              {...(f.shape === "roundbar" ? { rx: Math.min(f.halfH, w / 2), ry: f.halfH } : {})}
            >
              <title>Pooled summary</title>
            </rect>
          );
        }
        if (f.shape === "lens") {
          // A pointed oval: two quadratic arcs meeting at the CI ends. Reads like a diamond
          // with softened flanks, which is the usual "lens" in a meta-analysis figure.
          return (
            <path
              {...hit}
              {...paint}
              d={`M${x0},${f.cy} Q${f.cx},${f.cy - f.halfH * 1.35} ${x1},${f.cy} Q${f.cx},${f.cy + f.halfH * 1.35} ${x0},${f.cy} Z`}
              strokeLinejoin="round"
            >
              <title>Pooled summary</title>
            </path>
          );
        }
        if (f.shape === "ellipse") {
          // A smooth oval with rounded ends — the lens's pointed tips, softened. Cubic arcs
          // whose control points sit at the CI ends give vertical tangents there, so the
          // geometry still reaches x0 and x1 exactly (the span guard reads those pairs).
          const k = f.halfH * 1.33;
          return (
            <path
              {...hit}
              {...paint}
              d={`M${x0},${f.cy} C${x0},${f.cy - k} ${x1},${f.cy - k} ${x1},${f.cy} C${x1},${f.cy + k} ${x0},${f.cy + k} ${x0},${f.cy} Z`}
              strokeLinejoin="round"
            >
              <title>Pooled summary</title>
            </path>
          );
        }
        if (f.shape === "bowtie") {
          // Narrow at the pooled estimate, flaring to the interval's ends — the emphasis is
          // reversed from a diamond, so the eye is pulled to the precision rather than the
          // point. Pinched at `cx`, which is the estimate, not the midpoint of the CI.
          return (
            <polygon
              {...hit}
              {...paint}
              points={`${x0},${f.cy - f.halfH} ${f.cx},${f.cy} ${x1},${f.cy - f.halfH} ${x1},${f.cy + f.halfH} ${f.cx},${f.cy} ${x0},${f.cy + f.halfH}`}
              strokeLinejoin="round"
            >
              <title>Pooled summary</title>
            </polygon>
          );
        }
        return (
          <polygon
            {...hit}
            {...paint}
            points={`${f.xLo},${f.cy} ${f.cx},${f.cy - f.halfH} ${f.xHi},${f.cy} ${f.cx},${f.cy + f.halfH}`}
            strokeLinejoin="round"
          >
            <title>Pooled summary</title>
          </polygon>
        );
      })()}

      {/* corner scale bars (hide-axis + scale bar) — a short segment of known data length + label */}
      {scene.scaleBars?.map((b, i) => (
        <g key={`scalebar-${i}`} pointerEvents="none">
          <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={b.color} strokeWidth={2.5} strokeLinecap="butt" />
          <text
            x={b.labelX}
            y={b.labelY}
            textAnchor={b.vertical ? "start" : "middle"}
            {...fontAttrs(scene.fonts.tick, b.color)}
            {...(b.vertical ? { dominantBaseline: "middle" as const } : {})}
          >
            {b.label}
          </text>
        </g>
      ))}

      {/* annotation layer (reference lines / labels / brackets / drawing shapes) — clickable to select + edit */}
      {scene.annotations.map((a) => {
        const annSel = annIsSelected(a.id);
        // Band rects are drawn behind (above); here render only the band's caption on top.
        if (a.kind === "band") {
          return a.label ? (
            <text
              key={`bandlbl-${a.id}`}
              data-ann-text={a.id}
              x={a.labelX}
              y={a.labelY}
              textAnchor={a.labelAnchor ?? "middle"}
              fontSize={a.fontSize ?? scene.fonts.legend.size}
              fill={annSel ? "var(--accent)" : a.color ?? "var(--muted)"}
              opacity={editingText({ kind: "annotation", id: a.id }) ? 0 : undefined}
              style={onEditText ? { cursor: "text" } : undefined}
              onClick={(e) => { e.stopPropagation(); pickAnn(a.id, e); }}
              onDoubleClick={(e) => beginEdit(e, { kind: "annotation", id: a.id }, a.label ?? "", a.fontSize ?? scene.fonts.legend.size, "middle", true)}
            >
              <RichText text={a.label} x={a.labelX} />
            </text>
          ) : null;
        }
        if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image" || a.kind === "arrow" || a.kind === "segment" || a.kind === "callout") {
          // A locked shape (user-locked, or a builder-owned one whose position is data —
          // a PCA loading arrow) offers no move/resize/delete: the document layer would
          // refuse them, so showing the affordance would be misleading. Selection still works.
          const canMove = onMoveAnnotation && !a.locked;
          return (
            <ShapeAnnotation
              key={a.id}
              a={a}
              selected={annSel}
              accent={accent}
              plot={scene.plot}
              legendFont={scene.fonts.legend.size}
              clientToUser={clientToUser}
              onSelect={onSelect}
              onPick={pickAnn}
              onMove={canMove ? (patch) => moveAnn(a.id, patch) : undefined}
              // Keyed on `deletable`, not `locked`: locking an object guards it against an
              // accidental drag, and the model is explicit that deletion still works. Only a
              // builder-owned shape (which removeAnnotation refuses) loses its ×.
              onDelete={onDeleteAnnotation && a.deletable !== false ? () => onDeleteAnnotation(a.id) : undefined}
              onContextMenu={(e) => openAnnMenu(e, a.id)}
              snap={canMove ? (fx: number, fy: number) => snapFrac(fx, fy, a.id) : undefined}
              onSnapEnd={clearGuides}
              caption={dock.lines?.has(a.id) && onMoveRefLineLabel && !a.locked ? {
                onMove: (dx, dy) => onMoveRefLineLabel(a.id, dx, dy),
                onSelect: () => pickAnn(a.id, {}),
                title: dock.set ? "Drag to move this label — drop it on the legend to list the line there" : "Drag to move this label",
                dock: captionDock(a),
              } : undefined}
            />
          );
        }
        // Same locked rule as the shapes above: a line/text whose position is fixed (user
        // locked it, or the builder owns it — a Bland-Altman bias/LoA line sits at a
        // computed statistic) must not advertise a drag the document layer will refuse.
        const canDragAnn = onMoveAnnotation && !a.locked;
        return (
          <g
            key={a.id}
            // The id on the element, so a guard can ask "is this shape draggable?" of the
            // drawing rather than of the scene object it was built from. Without it the
            // locked-line check below could only select nothing and pass.
            data-ann={a.id}
            // The in-flight bracket gesture is a pure translate of this group; the
            // document is untouched until release, so the axis cannot re-fit mid-drag.
            {...(bracketDragXY?.id === a.id ? { transform: `translate(${bracketDragXY.dx} ${bracketDragXY.dy})` } : {})}
            style={{ cursor: canDragAnn ? "move" : "pointer", userSelect: "none" }}
            onClick={(e) => {
              e.stopPropagation();
              pickAnn(a.id, e);
            }}
            // A significance bracket carries a `<text>` symbol (★, the p-label). Pressing on
            // that text and dragging makes Chromium start a native text drag-and-drop, which
            // fires `pointercancel` and ends the gesture after one move, so a drag that grabs
            // the star would commit nothing. Refuse the native drag so the pointer stream
            // stays with this handler. (`userSelect: none` above stops the text selection
            // that seeds it.)
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => openAnnMenu(e, a.id)}
            onPointerDown={(e) => {
              if (!canDragAnn) return;
              e.stopPropagation();
              if (e.shiftKey) return; // shift = multi-select (handled on click), never a drag
              const d = clientToUser(e.clientX, e.clientY);
              const extent = scene.valueAxis === "x" ? scene.plot.height : scene.plot.width;
              const s = domS();
              annDragRef.current = {
                id: a.id,
                ux0: d?.x ?? 0,
                uy0: d?.y ?? 0,
                ...(a.kind === "text" ? { lx0: a.labelX, ly0: a.labelY } : {}),
                // px → fraction, matching the builder: the scene reports the shift it
                // baked in, so the drag continues from where the bracket really is.
                shift0: extent ? (a.shift ?? 0) / extent : 0,
                // The rail's value-axis pixel: y1 carries it on an upright chart, x1 on a
                // transposed one (the other pair holds the category ends).
                vpx0: (scene.valueAxis === "x" ? a.x1 : a.y1) ?? (scene.valueAxis === "x" ? d?.x ?? 0 : d?.y ?? 0),
                map0: { sx: s.sx, sy: s.sy, px: scene.plot.x, py: scene.plot.y, pw: scene.plot.width, ph: scene.plot.height },
              };
              onSelect?.({ kind: "annotation", id: a.id });
              // Drive the drag from window listeners — not this `<g>`'s own onPointerMove/Up
              // under SVG pointer capture. A bracket commits its height only on release (it is
              // visual-only while held), so its `<g>` re-renders every frame; once that node has
              // been reconciled by an earlier render (i.e. any re-drag of an already-placed
              // bracket), capturing the pointer on it makes Chromium fire `pointercancel` on the
              // first in-drag re-render and silently drop the capture — move+up never arrive and
              // the new height is lost (only a first drag, on a fresh node, would work).
              // Window listeners receive every move regardless of how the figure reconciles.
              const onMove = (ev: PointerEvent): void => {
                const st = annDragRef.current;
                if (st?.id !== a.id) return;
                const u = clientToUser(ev.clientX, ev.clientY);
                if (!u) return;
                const patch = annPatch(a, u.x, u.y, st);
                if (a.kind === "text" && patch.x != null && patch.y != null) {
                  const sn = snapFrac(patch.x, patch.y, a.id);
                  moveAnn(a.id, { x: sn.fx, y: sn.fy });
                } else if (a.kind === "bracket") {
                  // Magnetic detent: show the home lane while a bracket is snapped back to
                  // the pair it spans, so the pause in following reads as intended, not as a stuck drag.
                  setBracketSnap(patch.bracketShift === 0 ? bracketHomeGuide(a) : null);
                  // Visual-only while held (see `pending`): translate the group, commit on
                  // release. Sideways follows the snapped shift, not the raw pointer, so the
                  // magnet is visible during the gesture exactly as it will land.
                  st.pending = patch;
                  const onX = scene.valueAxis === "x";
                  const shiftDelta = (patch.bracketShift ?? st.shift0) * (onX ? scene.plot.height : scene.plot.width) - (a.shift ?? 0);
                  setBracketDragXY({
                    id: a.id,
                    dx: onX ? u.x - st.ux0 : shiftDelta,
                    dy: onX ? shiftDelta : u.y - st.uy0,
                  });
                } else {
                  moveAnn(a.id, patch);
                }
              };
              const onUp = (): void => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                const st = annDragRef.current;
                if (st?.id === a.id && st.pending) moveAnn(a.id, st.pending);
                annDragRef.current = null;
                setBracketDragXY(null);
                setBracketSnap(null);
                clearGuides();
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          >
            {a.kind === "line" && (
              <>
                <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={12} />
                <line
                  x1={a.x1}
                  y1={a.y1}
                  x2={a.x2}
                  y2={a.y2}
                  stroke={annSel ? "var(--accent)" : a.color ?? "var(--ink)"}
                  strokeWidth={a.width + (annSel ? 1 : 0)}
                  {...(a.dash ? { strokeDasharray: a.dash } : {})}
                />
              </>
            )}
            {a.kind === "bracket" && a.path && (
              <>
                <path d={a.path} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={a.path}
                  fill="none"
                  stroke={annSel ? "var(--accent)" : a.color ?? "var(--ink)"}
                  strokeWidth={a.width + (annSel ? 1 : 0)}
                  {...(a.round ? { strokeLinecap: "round" as const, strokeLinejoin: "round" as const } : {})}
                />
                {/* Free position & size: the ticked bracket grows round
                    handles on its two ends. Dragging one commits that end as a plot-rect
                    fraction (x / x2) along the category axis; the other end stays put. The
                    handle stops propagation so the whole-bracket drag never competes. */}
                {annSel && a.freeform && canDragAnn &&
                  ([1, 2] as const).map((end) => (
                    <circle
                      key={end}
                      className="gfx-annhandle"
                      data-bracket-end={`${a.id}:${end}`}
                      cx={end === 1 ? a.x1 : a.x2}
                      cy={end === 1 ? a.y1 : a.y2}
                      r={5}
                      fill="var(--panel, #fff)"
                      stroke={accent}
                      strokeWidth={1.5}
                      style={{ cursor: scene.valueAxis === "x" ? "ns-resize" : "ew-resize" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        (e.currentTarget as SVGCircleElement).setPointerCapture?.(e.pointerId);
                        bracketEndRef.current = { id: a.id, end };
                      }}
                      onPointerMove={(e) => {
                        if (bracketEndRef.current?.id !== a.id || bracketEndRef.current.end !== end) return;
                        const u = clientToUser(e.clientX, e.clientY);
                        if (!u) return;
                        // Store the unshifted fraction: the builder re-applies bracketShift.
                        const frac =
                          scene.valueAxis === "x"
                            ? clamp01((u.y - scene.plot.y - (a.shift ?? 0)) / scene.plot.height)
                            : clamp01((u.x - scene.plot.x - (a.shift ?? 0)) / scene.plot.width);
                        onMoveAnnotation(a.id, end === 1 ? { x: frac } : { x2: frac });
                      }}
                      onPointerUp={(e) => {
                        bracketEndRef.current = null;
                        (e.currentTarget as SVGCircleElement).releasePointerCapture?.(e.pointerId);
                      }}
                    />
                  ))}
              </>
            )}
            {a.label && (() => {
              const labelText = (
                <>
                {a.textBox?.box && <TextBoxRect box={a.textBox.box} rotate={a.rotation ? `rotate(${a.rotation} ${a.labelX} ${a.labelY})` : undefined} />}
                <text
                  data-ann-text={a.id}
                  x={a.textBox?.x ?? a.labelX}
                  y={a.labelY}
                  textAnchor={a.textBox?.anchor ?? a.labelAnchor ?? "start"}
                  fontSize={a.fontSize ?? scene.fonts.legend.size}
                  {...(a.fontFamily ? { fontFamily: a.fontFamily } : {})}
                  {...(a.italic ? { fontStyle: "italic" as const } : {})}
                  // `labelColor` splits the symbol's ink from the bracket's; absent, they
                  // stay one colour.
                  fill={annSel ? "var(--accent)" : a.labelColor ?? a.color ?? "var(--ink)"}
                  fontWeight={a.bold ? 700 : annSel ? 600 : undefined}
                  opacity={editingText({ kind: "annotation", id: a.id }) ? 0 : undefined}
                  {...(a.rotation ? { transform: `rotate(${a.rotation} ${a.labelX} ${a.labelY})` } : {})}
                  style={onEditText ? { cursor: "text" } : undefined}
                  onDoubleClick={(e) =>
                    beginEdit(
                      e,
                      { kind: "annotation", id: a.id },
                      a.label ?? "",
                      a.fontSize ?? scene.fonts.legend.size,
                      a.labelAnchor ?? "start",
                      true,
                    )
                  }
                >
                  <RichText text={a.textBox ? a.textBox.lines.join("\n") : a.label} x={a.textBox?.x ?? a.labelX} />
                </text>
                </>
              );
              // A caption the builder says may be nudged (`labelOffset`) drags on its own,
              // independently of the shape. The shape here is `locked` — a Bland-Altman bias
              // line sits at the mean difference — so the enclosing <g> offers no drag at all;
              // without this the readout is stranded on top of the data it describes.
              // A line the user drew: its caption drags on its own as well, and drops
              // onto the legend block to list the line there (legendDock.ts).
              const own = dock.lines?.has(a.id) === true;
              if (!a.labelOffset && !own) return labelText;
              const capOff = a.labelOffset ?? { dx: 0, dy: 0 };
              // The committed offset is drawn whether or not the drag is wired. Applying it
              // only inside the draggable wrapper would make every read-only render — the
              // SVG/PNG export, the interactive HTML export, a panel thumbnail, a gallery
              // card — put the caption back at the edge, so the move would survive only on screen.
              if (!onMoveRefLineLabel || (own && a.locked)) {
                return capOff.dx || capOff.dy ? (
                  <g transform={`translate(${capOff.dx} ${capOff.dy})`}>{labelText}</g>
                ) : (
                  labelText
                );
              }
              return (
                <DraggableGroup
                  offset={capOff}
                  {...(own ? captionDock(a) : {})}
                  onMove={(dx, dy) => onMoveRefLineLabel(a.id, dx, dy)}
                  /* Through `pickAnn`, which knows a builder-made line is not an annotation.
                     Selecting `{kind:"annotation"}` here would send the label of a computed line
                     to the annotation editor, which looks it up in `plot.annotations`, cannot find
                     it and prints "This annotation was removed." Routing through `pickAnn` sends
                     the caption to the reference-line panel, as the line itself is — so clicking
                     Bland-Altman's "Bias 0.12", a pyramid value or a PCA loading name opens the
                     controls for that line. */
                  onSelect={() => pickAnn(a.id, {})}
                  title={own ? (dock.set ? "Drag to move this label — drop it on the legend to list the line there" : "Drag to move this label") : "Drag to move this label — the line stays at its computed value"}
                >
                  {labelText}
                </DraggableGroup>
              );
            })()}
            {/* on-canvas delete (× handle) for a selected text / line / bracket */}
            {/* No x on a builder-owned label: removeAnnotation refuses it (it is regenerated
                from the data each rebuild), so offering one would be misleading. It stays
                movable + renamable — only its existence is controlled by the builder. */}
            {annSel && onDeleteAnnotation && a.deletable !== false && (() => {
              const fs = a.fontSize ?? scene.fonts.legend.size;
              const hasLabel = Boolean(a.label);
              const spot = hasLabel ? labelDeleteSpot(a, fs) : { cx: ((a.x1 ?? 0) + (a.x2 ?? 0)) / 2, cy: ((a.y1 ?? 0) + (a.y2 ?? 0)) / 2 - 12 };
              return <DeleteHandle cx={spot.cx} cy={spot.cy} onDelete={() => onDeleteAnnotation(a.id)} />;
            })()}
          </g>
        );
      })}

      {/* magnetic detent guide — a dashed accent line down the centre of the pair a
          dragged bracket spans, shown while the drag is snapped back to it. */}
      {bracketSnap && (
        <line
          x1={bracketSnap.x1}
          y1={bracketSnap.y1}
          x2={bracketSnap.x2}
          y2={bracketSnap.y2}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.7}
          pointerEvents="none"
        />
      )}

      {/* selected band — move/resize overlay (drag body to move, edges to resize).
          Drawn on top only while selected, so the data stays interactive otherwise. */}
      {onMoveAnnotation && scene.annotations
        .filter((a) => a.kind === "band")
        .map((a) => {
          const sel = selected?.kind === "annotation" && selected.id === a.id;
          const x1 = a.x1 ?? 0, y1 = a.y1 ?? 0, x2 = a.x2 ?? 0, y2 = a.y2 ?? 0;
          const isVband = y2 - y1 >= scene.plot.height - 1;
          const hh = 6; // handle half-thickness
          // A locked band has no free geometry to drag: it is either user-locked, or its
          // position is an axis value (data-anchored) and is edited by value in the Inspector.
          // Offering a move cursor + resize handles the document layer would refuse is a dead
          // affordance (same rule as the shapes/lines above, `canMove = !a.locked`).
          const canEdit = !a.locked;
          return (
            <g key={`bandui-${a.id}`}>
              {/* move surface — grabbable only when editable; always clickable to select.
                  Outline only when selected. */}
              <rect
                x={x1} y={y1} width={x2 - x1} height={y2 - y1}
                fill="transparent"
                {...(sel ? { stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "4 3" } : {})}
                style={{ cursor: canEdit ? "move" : "default" }}
                {...(canEdit ? { onPointerDown: (e: React.PointerEvent) => startBandDrag(e, a, "move"), onPointerMove: moveBandDrag, onPointerUp: endBandDrag } : {})}
                onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "annotation", id: a.id }); }}
                onContextMenu={(e) => openAnnMenu(e, a.id)}
              >
                <title>{canEdit ? "Drag to move this band; drag its edges to resize" : "This band is pinned to the axis — edit its range in the Inspector"}</title>
              </rect>
              {/* edge resize handles + accent outline — only while selected and editable */}
              {sel && canEdit && (isVband ? (
                <>
                  <rect x={x1 - hh} y={y1} width={2 * hh} height={y2 - y1} fill="transparent" style={{ cursor: "ew-resize" }}
                    onPointerDown={(e) => startBandDrag(e, a, "l")} onPointerMove={moveBandDrag} onPointerUp={endBandDrag} />
                  <rect x={x2 - hh} y={y1} width={2 * hh} height={y2 - y1} fill="transparent" style={{ cursor: "ew-resize" }}
                    onPointerDown={(e) => startBandDrag(e, a, "r")} onPointerMove={moveBandDrag} onPointerUp={endBandDrag} />
                  <line x1={x1} y1={y1} x2={x1} y2={y2} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
                  <line x1={x2} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
                </>
              ) : (
                <>
                  <rect x={x1} y={y1 - hh} width={x2 - x1} height={2 * hh} fill="transparent" style={{ cursor: "ns-resize" }}
                    onPointerDown={(e) => startBandDrag(e, a, "t")} onPointerMove={moveBandDrag} onPointerUp={endBandDrag} />
                  <rect x={x1} y={y2 - hh} width={x2 - x1} height={2 * hh} fill="transparent" style={{ cursor: "ns-resize" }}
                    onPointerDown={(e) => startBandDrag(e, a, "b")} onPointerMove={moveBandDrag} onPointerUp={endBandDrag} />
                  <line x1={x1} y1={y1} x2={x2} y2={y1} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
                  <line x1={x1} y1={y2} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
                </>
              ))}
              {sel && onDeleteAnnotation && (
                <DeleteHandle cx={(x1 + x2) / 2} cy={y1 + 13} onDelete={() => onDeleteAnnotation(a.id)} />
              )}
            </g>
          );
        })}

      {/* alignment guides — dashed accent lines while a dragged annotation snaps to
          the plot's centre / edges (design-tool feel) */}
      {dragGuides && (
        <g className="gfx-snapguides" pointerEvents="none">
          {dragGuides.vx !== undefined && (
            <line x1={dragGuides.vx} x2={dragGuides.vx} y1={scene.plot.y} y2={scene.plot.y + scene.plot.height} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          )}
          {dragGuides.hy !== undefined && (
            <line x1={scene.plot.x} x2={scene.plot.x + scene.plot.width} y1={dragGuides.hy} y2={dragGuides.hy} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          )}
        </g>
      )}

      {/* continuous colour-scale bar (data-driven colour-by-column) — a gradient in the right margin */}
      {scene.colorbar && (() => {
        const cb = scene.colorbar;
        const bf = scene.fonts.legend;
        return (
          <g className="gfx-colorbar" pointerEvents="none">
            <defs>
              <linearGradient id="gfx-colorbar-grad" x1="0" y1="1" x2="0" y2="0">
                {cb.stops.map((s, i) => (
                  <stop key={i} offset={s.offset} stopColor={s.color} />
                ))}
              </linearGradient>
            </defs>
            <rect x={cb.bar.x} y={cb.bar.y} width={cb.bar.w} height={cb.bar.h} fill="url(#gfx-colorbar-grad)" stroke="var(--line)" strokeWidth={0.5} />
            <g {...fontAttrs(bf, "var(--muted)")}>
              <text x={cb.bar.x + cb.bar.w + 4} y={cb.bar.y + bf.size * 0.4}>{round2(cb.max)}</text>
              <text x={cb.bar.x + cb.bar.w + 4} y={cb.bar.y + cb.bar.h - bf.size * 0.3}>{round2(cb.min)}</text>
            </g>
            {cb.title && (
              <text
                transform={`translate(${cb.bar.x + cb.bar.w + 34} ${cb.bar.y + cb.bar.h / 2}) rotate(-90)`}
                textAnchor="middle"
                {...fontAttrs(bf, "var(--ink)")}
              >
                {cb.title}
              </text>
            )}
          </g>
        );
      })()}
      {/* legend — placement / orientation / framing per scene.legendLayout */}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
      {/* bubble size legend (right, vertical) — reuses the colour-bar drag offset */}
      {scene.bubbleLegend && (
        <BubbleSizeLegend
          scene={scene}
          onMove={onMoveColorbar}
          onSelect={onSelect}
          onEditTitle={onEditText ? (e) => beginEdit(e, { kind: "bubbleLegendTitle" }, scene.bubbleLegend?.title ?? "", scene.fonts.legend.size, "start", true) : undefined}
          editingTitle={editingText({ kind: "bubbleLegendTitle" })}
        />
      )}
      {/* zone key — a small legend for the shaded zone bands, overlaid in the chosen plot corner
          (scene.zoneLegend). Geometry (x/y/w/h) is measured by the builder; rows here reuse the
          same PAD/GAP/ROW constants so the frame fits. Non-interactive: edited via the bands +
          the Annotations panel "Zone key" select. */}
      {scene.zoneLegend && scene.zoneLegend.entries.length > 0 && (() => {
        const zl = scene.zoneLegend;
        const size = scene.fonts.legend.size;
        const rowH = Math.round(size * ZONE_KEY_ROW);
        const sw = size;
        return (
          <g className="gfx-zonekey" pointerEvents="none">
            <rect x={zl.x} y={zl.y} width={zl.w} height={zl.h} rx={4} fill="var(--bg-2)" fillOpacity={0.94} stroke="var(--faint)" strokeWidth={1} />
            {zl.entries.map((e, i) => {
              const ry = zl.y + ZONE_KEY_PAD + i * rowH;
              return (
                <g key={i}>
                  <rect x={zl.x + ZONE_KEY_PAD} y={ry + (rowH - sw) / 2} width={sw} height={sw} rx={2} fill={e.color} />
                  <text x={zl.x + ZONE_KEY_PAD + sw + ZONE_KEY_GAP} y={ry + rowH / 2} dominantBaseline="central" {...fontAttrs(scene.fonts.legend, "var(--ink)")}>{e.label}</text>
                </g>
              );
            })}
          </g>
        );
      })()}

      {hover && <Tooltip scene={scene} hover={hover} />}

      {/* axis-length drag — when an axis is selected, the whole axis is grabbable
          (wide transparent hit-line, resize cursor) and a big handle marks its end.
          Drag along the axis to set its length (plot width for X / height for Y). */}
      {onAxisResize && selX && (
        <g style={{ cursor: "ew-resize" }} onPointerDown={(e) => startAxisResize(e, "x")}>
          <line x1={px} y1={py + ph} x2={px + pw} y2={py + ph} stroke="transparent" strokeWidth={18} />
          <line x1={px} y1={py + ph} x2={px + pw} y2={py + ph} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px + pw} cy={py + ph} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the X-axis length</title>
        </g>
      )}
      {onAxisResize && selY && (
        <g style={{ cursor: "ns-resize" }} onPointerDown={(e) => startAxisResize(e, "y")}>
          <line x1={px} y1={py} x2={px} y2={py + ph} stroke="transparent" strokeWidth={18} />
          <line x1={px} y1={py} x2={px} y2={py + ph} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px} cy={py + ph} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the Y-axis length (drag down to lengthen)</title>
        </g>
      )}

      {/* on-canvas drag handles to resize the whole figure (right / bottom / corner) */}
      {onFigureResize && (
        <FigureResizeHandles
          width={scene.width}
          height={scene.height}
          accent={accent}
          onStart={startFigResize}
        />
      )}
      {boxRect && (
        <rect
          className="gfx-boxselect"
          x={Math.min(boxRect.x0, boxRect.x1)}
          y={Math.min(boxRect.y0, boxRect.y1)}
          width={Math.abs(boxRect.x1 - boxRect.x0)}
          height={Math.abs(boxRect.y1 - boxRect.y0)}
          fill={accent}
          fillOpacity={0.08}
          stroke={accent}
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {boxSel && (() => {
        const at = new Map(scene.series.flatMap((s) => s.marks.map((m) => [`${s.id}\u0000${m.rowId}`, m] as const)));
        return boxSel.points.map((p) => {
          const m = at.get(`${p.columnId}\u0000${p.rowId}`);
          return m ? <circle key={`${p.columnId}:${p.rowId}`} className="gfx-boxpick" cx={m.cx} cy={m.cy} r={7} fill="none" stroke={accent} strokeWidth={1.5} pointerEvents="none" /> : null;
        });
      })()}
    </svg>
    {overlay}
    {boxSel && onBoxAction && (() => {
      const n = boxSel.points.length;
      const act = (a: "exclude" | "highlight" | "copy") => () => { onBoxAction(a, boxSel.points); setBoxSel(null); };
      return (
        <div className="gfx-annmenu gfx-boxmenu" role="menu" aria-label="Selected points" style={{ left: boxSel.left, top: boxSel.top }} onContextMenu={(e) => e.preventDefault()}>
          <div style={{ padding: "4px 10px", fontSize: 12, color: "var(--muted)", lineHeight: 1.3 }}>
            {n === 0 ? "No data points in the box." : `${n} point${n === 1 ? "" : "s"} selected`}
          </div>
          {n > 0 && <button className="gfx-annmenu-i" onClick={act("exclude")}>Exclude from analyses</button>}
          {n > 0 && (
            <button className="gfx-annmenu-i" disabled={!!boxHighlightBlocked} title={boxHighlightBlocked ?? "Add their names to this series' Find & highlight list"} onClick={act("highlight")}>
              Highlight by name
            </button>
          )}
          {n > 0 && <button className="gfx-annmenu-i" onClick={act("copy")}>Copy to a new sheet</button>}
          <button className="gfx-annmenu-i" onClick={() => setBoxSel(null)}>{n === 0 ? "Close" : "Cancel"}</button>
        </div>
      );
    })()}
    {annMenu && (() => {
      const a = scene.annotations.find((x) => x.id === annMenu.id);
      if (!a) return null;
      const act = (fn: () => void) => () => { fn(); setAnnMenu(null); };
      return (
        <div className="gfx-annmenu" style={{ left: annMenu.left, top: annMenu.top }} onContextMenu={(e) => e.preventDefault()}>
          {onDuplicateAnnotation && <button className="gfx-annmenu-i" onClick={act(() => onDuplicateAnnotation(a.id))}>Duplicate</button>}
          {onReorderAnnotation && <button className="gfx-annmenu-i" onClick={act(() => onReorderAnnotation(a.id, "front"))}>Bring to front</button>}
          {onReorderAnnotation && <button className="gfx-annmenu-i" onClick={act(() => onReorderAnnotation(a.id, "back"))}>Send to back</button>}
          {onDeleteAnnotation && <button className="gfx-annmenu-i gfx-annmenu-del" onClick={act(() => onDeleteAnnotation(a.id))}>Delete</button>}
        </div>
      );
    })()}
    </div>
  );
}

/**
 * Inline text editor — an absolutely-positioned HTML input/textarea over the
 * figure wrapper, seeded from a text element's screen rect. Lives outside the
 * SVG (no foreignObject) so the exported SVG stays clean. Enter / blur commits,
 * Esc cancels.
 */
function TextEditOverlay({
  edit,
  onChange,
  onCommit,
  onCancel,
  onErase,
}: {
  edit: TextEdit;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Offered for graph/axis titles: one click empties the text (the ✕ beside the editor). */
  onErase?: (() => void) | undefined;
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      // Place the caret at the end (no select-all): with everything selected, a stray
      // super/subscript or symbol click would wrap/replace the whole title. Ctrl+A
      // still selects all when the user actually wants to retype.
      const n = el.value.length;
      el.setSelectionRange(n, n);
    }
  }, []);
  // The underlying SVG text is hidden while editing, so the editor can be fully
  // chrome-less — transparent, no border/box/shadow — and simply be the text in
  // place (matching weight/family/style/colour/size), with just a blinking caret
  // and a faint accent underline to signal edit mode. No "box" feel. The math/
  // symbol toolbox lives permanently in the graph ribbon (works for axis
  // titles too), so there is no per-edit popup.
  const style: React.CSSProperties = {
    position: "absolute",
    left: Math.max(0, edit.left - 2),
    top: Math.max(0, edit.top - 1),
    minWidth: edit.width + 6,
    width: edit.multiline ? edit.width + 40 : undefined,
    fontSize: edit.fontSize,
    fontWeight: edit.fontWeight ?? "inherit",
    fontStyle: edit.fontStyle ?? "normal",
    fontFamily: edit.fontFamily ?? "inherit",
    lineHeight: 1.2,
    textAlign: edit.anchor === "middle" ? "center" : edit.anchor === "end" ? "right" : "left",
    padding: "0 1px",
    margin: 0,
    border: "none",
    borderBottom: "1.5px solid color-mix(in srgb, var(--accent) 55%, transparent)",
    outline: "none",
    background: "transparent",
    color: edit.color ?? "var(--ink)",
    caretColor: "var(--accent)",
    zIndex: 20,
    resize: edit.multiline ? "both" : "none",
    boxShadow: "none",
  };
  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && !edit.multiline) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onCommit();
    }
  };
  const editor = edit.multiline ? (
    <textarea
      // Named so a test can address the inline editor rather than the last text box on the
      // page — an unnamed one could match an Inspector field instead.
      className="gfx-textedit"
      aria-label="Edit text"
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      value={edit.value}
      rows={Math.max(1, edit.value.split("\n").length)}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
    />
  ) : (
    <input
      className="gfx-textedit"
      aria-label="Edit text"
      ref={ref as React.RefObject<HTMLInputElement>}
      type="text"
      value={edit.value}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={onKeyDown}
    />
  );
  return (
    <>
      {editor}
      {onErase && (
        <button
          type="button"
          className="texterase"
          title="Remove this text — restore it any time from the toolbar's Text control"
          aria-label="Remove this text"
          style={{ position: "absolute", left: edit.left + Math.max(edit.width, 44) + 12, top: edit.top - 4, zIndex: 21 }}
          // preventDefault on pointerdown, or the editor blurs first and commits the
          // current text before the erase lands — two commands where one was requested.
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={onErase}
        >
          ✕
        </button>
      )}
    </>
  );
}

/**
 * Shared in-place text-editing engine (so the bespoke figures —
 * heatmap / pie / radar / lollipop / 3D — get the same double-click-to-edit
 * titles/axis-titles as the main figure, not just the main path). Owns the
 * `edit` state, seeds the overlay from a text element's screen rect, and
 * renders the chrome-less HTML overlay. Pass the wrapper + svg refs so the
 * overlay positions correctly and the font scales with the responsive SVG.
 */
/** Map an editable text target to the ribbon's font-role name (null = no role). */
function textRoleOf(t: TextTarget): "title" | "subtitle" | "axisTitle" | null {
  return t.kind === "title" ? "title" : t.kind === "subtitle" ? "subtitle" : t.kind === "axisTitle" || t.kind === "scatter3dZTitle" ? "axisTitle" : null;
}

function useInlineTextEditor(opts: {
  onEditText: ((target: TextTarget, value: string) => void) | undefined;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  sceneWidth: number;
  zoom: number;
  /** Notified when an editor opens, so the ribbon's font controls target this text. */
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  /** Resolved scene fonts — lets the overlay reflect live font changes (size/bold/
   *  italic/family) made via the ribbon while the editor is open. */
  fonts?: PlotScene["fonts"] | undefined;
  /** The Y2 axis is drawn along the top (a horizontal chart), so its title falls back to the X-title font - as the renderer does. */
  y2OnTop?: boolean | undefined;
}): {
  edit: TextEdit | null;
  setEdit: React.Dispatch<React.SetStateAction<TextEdit | null>>;
  openEditorEl: (
    el: SVGGraphicsElement | null,
    target: TextTarget,
    value: string,
    o: { baseSize: number; anchor: "start" | "middle" | "end"; multiline?: boolean },
  ) => void;
  beginEdit: (
    e: React.MouseEvent,
    target: TextTarget,
    value: string,
    baseSize: number,
    anchor: "start" | "middle" | "end",
    multiline?: boolean,
  ) => void;
  commitEdit: () => void;
  editingText: (t: TextTarget) => boolean;
  overlay: ReactElement | null;
} {
  const { onEditText, wrapRef, svgRef, sceneWidth, zoom, onTextFocus, fonts, y2OnTop } = opts;
  const [edit, setEdit] = useState<TextEdit | null>(null);
  /** Rendered px per scene unit (the SVG scales responsively), so the overlay font matches. */
  const renderScale = (): number => {
    // Per viewBox unit: the graph view can grow the viewBox past the figure (figureGrowth.ts).
    const w = svgRef.current?.getBoundingClientRect().width;
    const vbW = svgRef.current?.viewBox.baseVal.width || sceneWidth;
    return w ? w / vbW : zoom;
  };
  /** Open the overlay editor over an existing text element (positioned from its screen rect). */
  const openEditorEl = (
    el: SVGGraphicsElement | null,
    target: TextTarget,
    value: string,
    o: { baseSize: number; anchor: "start" | "middle" | "end"; multiline?: boolean },
  ): void => {
    const wrap = wrapRef.current;
    if (!wrap || !el) return;
    const wr = wrap.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    const scale = renderScale();
    const cs = window.getComputedStyle(el as unknown as Element);
    setEdit({
      target,
      value,
      left: er.left - wr.left,
      top: er.top - wr.top,
      width: Math.max(er.width, 44),
      height: Math.max(er.height, o.baseSize * scale),
      fontSize: Math.max(9, o.baseSize * scale),
      anchor: o.anchor,
      multiline: o.multiline ?? false,
      fontWeight: cs.fontWeight || undefined,
      fontFamily: cs.fontFamily || undefined,
      fontStyle: cs.fontStyle || undefined,
      color: cs.fill && cs.fill !== "none" ? cs.fill : cs.color || undefined,
    });
  };
  const beginEdit = (
    e: React.MouseEvent,
    target: TextTarget,
    value: string,
    baseSize: number,
    anchor: "start" | "middle" | "end",
    multiline = false,
  ): void => {
    if (!onEditText) return;
    e.stopPropagation();
    e.preventDefault();
    openEditorEl(e.currentTarget as unknown as SVGGraphicsElement, target, value, { baseSize, anchor, multiline });
    const role = textRoleOf(target); // point the ribbon's font controls at this text
    if (role) onTextFocus?.(role);
  };
  const commitEdit = (): void => {
    setEdit((cur) => {
      if (cur) onEditText?.(cur.target, cur.value);
      return null;
    });
  };
  /** While editing, the underlying SVG text is hidden so the overlay reads AS the text. */
  const editingText = (t: TextTarget): boolean => {
    const e = edit?.target;
    if (!e || e.kind !== t.kind) return false;
    if (e.kind === "axisTitle" && t.kind === "axisTitle") return e.axis === t.axis;
    if (e.kind === "annotation" && t.kind === "annotation") return e.id === t.id;
    if (e.kind === "value" && t.kind === "value") return e.columnId === t.columnId && e.rowId === t.rowId;
    if (e.kind === "fitParams" && t.kind === "fitParams") return e.keys.join("\n") === t.keys.join("\n");
    return e.kind === t.kind;
  };
  // Reflect live font edits (ribbon B / I / size / family) in the open overlay, so
  // the user sees the change immediately instead of only after committing.
  const liveEdit = ((): TextEdit | null => {
    if (!edit || !fonts) return edit;
    const t = edit.target;
    const f = t.kind === "title" ? fonts.title
      : t.kind === "subtitle" ? fonts.subtitle
      : t.kind === "axisTitle"
        ? t.axis === "y2" ? (fonts.y2AxisTitle ?? (y2OnTop ? fonts.xAxisTitle : fonts.yAxisTitle))
          : t.axis === "y3" ? (fonts.y3AxisTitle ?? fonts.yAxisTitle)
          : t.axis === "y" ? fonts.yAxisTitle : fonts.xAxisTitle
      : null;
    if (!f) return edit;
    return {
      ...edit,
      fontSize: Math.max(9, f.size * renderScale()),
      fontWeight: String(f.weight),
      fontStyle: f.italic ? "italic" : "normal",
      fontFamily: f.family ?? edit.fontFamily,
    };
  })();
  /**
   * The ✕ beside the editor: one click deletes the text. A delete cross appears on
   * axis titles and graph titles on every graph type. Living on the shared editor overlay covers every
   * kind's titles in one place — every title opens this editor. Offered only for the
   * title family: emptying a category name or a node label is a rename, not a delete.
   */
  const ERASABLE = new Set<TextTarget["kind"]>(["title", "subtitle", "axisTitle", "scatter3dZTitle"]);
  const eraseEdit = (): void => {
    setEdit((cur) => {
      if (cur) onEditText?.(cur.target, "");
      return null;
    });
  };
  const overlay = liveEdit ? (
    <TextEditOverlay
      edit={liveEdit}
      onChange={(v) => setEdit((cur) => (cur ? { ...cur, value: v } : cur))}
      onCommit={commitEdit}
      onCancel={() => setEdit(null)}
      onErase={ERASABLE.has(liveEdit.target.kind) ? eraseEdit : undefined}
    />
  ) : null;
  return { edit, setEdit, openEditorEl, beginEdit, commitEdit, editingText, overlay };
}

/** The single-click home of every heatmap row/column label — the section holding
 *  "Row/column label font" + rotation. The labels carry a drag + a rename; without this
 *  select the click would fall through to the background and leave the label font size
 *  on both axes unreachable. */
const HEAT_SECTION = { kind: "chart-section", title: "Heatmap" } as const;

/** Heatmap — coloured cell grid + row/column labels + a colour-scale bar. */
function HeatmapFigure(props: Parameters<typeof HeatmapFigureContent>[0]) {
  if (!props.scene.heatmap) return null;
  return <HeatmapFigureContent {...props} />;
}

function HeatmapFigureContent({ scene, zoom, selected, onRotateAxisTitle, onSelect, onViewChange, onResetView, onAxisResize, onMoveTitle, onMoveSubtitle, onMoveAxisTitle, onEditText, onMoveAnnotation, onDeleteAnnotation, onMoveColorbar, onMoveHeatmapLabels, onMoveHeatSplitLabel, onMoveHeatTrackName, onMoveHeatTrackRunLabel, onMoveHeatTrackKey, onTextFocus, onFigureResize }: { scene: PlotScene; onRotateAxisTitle?: RotateAxisTitle; zoom: number; selected?: GraphSelection; onSelect?: ((s: GraphSelection) => void) | undefined; onViewChange?: ((view: GraphView) => void) | undefined; onResetView?: (() => void) | undefined; onAxisResize?: ((axis: "x" | "y", lengthPx: number) => void) | undefined; onMoveTitle?: ((dx: number, dy: number) => void) | undefined; onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined; onMoveAxisTitle?: ((axis: "x" | "y" | "z", dx: number, dy: number) => void) | undefined; onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined; onMoveColorbar?: ((dx: number, dy: number) => void) | undefined; onMoveHeatmapLabels?: ((which: "row" | "col", index: number, dx: number, dy: number) => void) | undefined; onMoveHeatSplitLabel?: ((axis: "row" | "col", at: number, dx: number, dy: number) => void) | undefined; onMoveHeatTrackName?: ((axis: "row" | "col", index: number, dx: number, dy: number) => void) | undefined; onMoveHeatTrackRunLabel?: ((axis: "row" | "col", index: number, value: string, dx: number, dy: number) => void) | undefined; onMoveHeatTrackKey?: ((axis: "row" | "col", index: number, dx: number, dy: number) => void) | undefined; onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined; onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined }) {
  const hm = scene.heatmap!;
  const gradId = useId();
  const tick = scene.fonts.tick.size;
  // Row/column labels sit in tight gutters (one per cell), so a large tick font (e.g.
  // the house style's) makes adjacent column labels collide — cap them to a compact size.
  const hmLabel = Math.min(tick, 12);
  const pt = hm.pointMode;
  const px0 = scene.plot.x;
  const py0 = scene.plot.y;
  const pw0 = scene.plot.width;
  const ph0 = scene.plot.height;
  const frame = scene.axisStyle.frame;
  // Y-title baseline x, from its font size so a big title never clips the left edge.
  const yTitleX = scene.y.titlePos ?? Math.max(14, Math.round(scene.fonts.yAxisTitle.size * 1.08));
  const accent = "var(--accent)";
  const selX = selected?.kind === "axis" && selected.axis === "x";
  const selY = selected?.kind === "axis" && selected.axis === "y";
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const hmTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  // Density/hexbin mode declares real zoomable axes (matrix mode declares none, so this
  // wires nothing there); without this hook the axes would be declared zoomable and nothing
  // would offer the gesture. Caution: composed into the <svg>'s own handlers below, never
  // spread over them — a spread would let one handler silently replace another (see `PlotFigure.zoom.test.tsx`).
  const { viewProps } = useWheelZoom(svgRef, scene, onViewChange, onResetView);
  // Point-mode (density/hexbin) has real continuous axes → clicking one opens its
  // panel, and (when selected) its end can be dragged to resize the plot — same as
  // every other chart. stopPropagation keeps the svg-root "select plot" from firing.
  const selectAxis = (axis: "x" | "y", focus?: "labels" | "numbers") => (e: React.MouseEvent) => { e.stopPropagation(); onSelect?.(focus ? { kind: "axis", axis, focus } : { kind: "axis", axis }); };
  const axisResizeRef = useRef<{ axis: "x" | "y"; start: number; origLen: number } | null>(null);
  const draggedRef = useRef(false);
  const clientToUser = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const startAxisResize = (e: React.PointerEvent, axis: "x" | "y"): void => {
    e.stopPropagation(); e.preventDefault();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    axisResizeRef.current = { axis, start: axis === "x" ? u.x : u.y, origLen: axis === "x" ? pw0 : ph0 };
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
  };
  const onAxisPointerMove = (e: React.PointerEvent): void => {
    const ar = axisResizeRef.current;
    if (!ar) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    draggedRef.current = true;
    const cur = ar.axis === "x" ? u.x : u.y;
    onAxisResize?.(ar.axis, Math.max(40, Math.round(ar.origLen + (cur - ar.start))));
  };
  const onAxisPointerUp = (e: React.PointerEvent): void => {
    if (!axisResizeRef.current) return;
    try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* best-effort */ }
    axisResizeRef.current = null;
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      role="img"
      aria-label={`Heatmap${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } onSelect?.({ kind: "plot" }); }}
      onPointerDown={(e) => { draggedRef.current = false; viewProps.onPointerDown(e); }}
      onPointerMove={(e) => {
        figResize.onMove(e);
        onAxisPointerMove(e);
        viewProps.onPointerMove(e);
        // A zoomed-in pan drag must not end as a background click that steals the
        // selection; `viewProps.style` is only set while panning is possible.
        if (e.buttons === 1 && viewProps.style) draggedRef.current = true;
      }}
      onPointerUp={(e) => { figResize.onUp(e); onAxisPointerUp(e); viewProps.onPointerUp(); }}
      onDoubleClick={viewProps.onDoubleClick}
      style={{ ...figSizeStyle(zoom), ...(viewProps.style ?? {}) }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
          {/* Note: keyed by index, not offset: a stepped bar is a staircase and deliberately
              carries two stops at each class edge (same offset, different colour). */}
          {hm.scaleStops.map((s, i) => (
            <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} />
          ))}
        </linearGradient>
      </defs>
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          x={hmTitle.baseX}
          y={8 + scene.fonts.title.size * 0.85}
          anchor={hmTitle.anchor}
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, hmTitle.anchor, true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={scene.width / 2}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        <SubtitleText
          scene={scene}
          baseX={hmTitle.baseX}
          anchor={hmTitle.anchor}
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, hmTitle.anchor, true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {/* point-data modes (density2d / hexbin): gridlines behind the marks */}
      {pt && scene.grid.show && (
        <g className="gfx-grid">
          {scene.x.ticks.filter((t) => scene.grid.minor || !t.minor).map((t) => (
            <line key={`gx-${t.value}`} x1={t.pos} x2={t.pos} y1={py0} y2={py0 + ph0} stroke={scene.grid.color ?? "var(--line)"} strokeWidth={scene.grid.width} strokeDasharray={scene.grid.dash ?? undefined} opacity={t.minor ? 0.5 : 1} />
          ))}
          {scene.y.ticks.filter((t) => scene.grid.minor || !t.minor).map((t) => (
            <line key={`gy-${t.value}`} x1={px0} x2={px0 + pw0} y1={t.pos} y2={t.pos} stroke={scene.grid.color ?? "var(--line)"} strokeWidth={scene.grid.width} strokeDasharray={scene.grid.dash ?? undefined} opacity={t.minor ? 0.5 : 1} />
          ))}
        </g>
      )}
      {/* hexbin polygons (hexbin mode) */}
      {hm.hexes?.map((h, i) => (
        <path key={`hex-${i}`} d={h.path} fill={h.color} stroke={heatBorderStroke(hm.border)} strokeWidth={hm.border.width} pointerEvents="none">
          <title>{`n = ${h.count}`}</title>
        </path>
      ))}
      {/* Empty point-mode state: a matrix heatmap has no (x,y) cloud, so density2d/hexbin
          draws nothing. Say so in the plot (export-clean SVG text) rather than leaving a
          blank canvas. Split at sentence breaks into centred lines. */}
      {hm.notice && (() => {
        const lines = hm.notice.split(/(?<=\.) +/).filter(Boolean);
        const size = Math.max(11, Math.min(scene.fonts.tick.size, 14));
        const lh = size * 1.35;
        const cy = py0 + ph0 / 2 - ((lines.length - 1) * lh) / 2;
        return (
          <text className="heat-empty-notice" x={px0 + pw0 / 2} y={cy} textAnchor="middle" fontSize={size} fill="var(--muted)" pointerEvents="none">
            {lines.map((ln, i) => (
              <tspan key={i} x={px0 + pw0 / 2} dy={i === 0 ? 0 : lh}>{ln}</tspan>
            ))}
          </text>
        );
      })()}
      {/* attached clustering dendrograms (row tree at the left, column tree on top) */}
      {hm.dendrograms?.row && (
        <path d={hm.dendrograms.row} fill="none" stroke={hm.dendrograms.color} strokeWidth={1} pointerEvents="none" />
      )}
      {hm.dendrograms?.col && (
        <path d={hm.dendrograms.col} fill="none" stroke={hm.dendrograms.color} strokeWidth={1} pointerEvents="none" />
      )}
      {hm.cells.map((c, i) => {
        const isSel = selected?.kind === "heatmap-cell" && selected.row === c.row && selected.col === c.col;
        // Bubble grid: the value draws as a centred, area-scaled dot in the
        // ramp colour; the cell rect goes transparent but stays — it is the click target
        // and carries the gridlines. A missing value draws nothing (blank cell).
        const bubble = c.r != null || (c.value == null && hm.cells.some((o) => o.r != null));
        return (
          <g key={i}>
            {c.r != null && (
              <circle className="heatbubble" cx={c.x + c.w / 2} cy={c.y + c.h / 2} r={c.r} fill={c.color} pointerEvents="none" />
            )}
            <rect
              data-heatcell={`${c.row}-${c.col}`}
              x={c.x}
              y={c.y}
              width={c.w + (hm.border.width ? 0 : 0.5)}
              height={c.h + (hm.border.width ? 0 : 0.5)}
              fill={bubble ? "transparent" : c.color}
              stroke={heatBorderStroke(hm.border)}
              strokeWidth={hm.border.width}
              style={pt ? undefined : { cursor: "pointer" }}
              pointerEvents={pt ? "none" : undefined}
              {...(pt ? {} : madyTip([[hm.rowLabels[c.row]?.label, hm.colLabels[c.col]?.label].filter(Boolean).join(" · "), c.value == null ? "no value" : tipNum(c.value)]))}
              onClick={pt ? undefined : (e) => {
                // Clicking a cell selects that cell (highlight + value read-out in the
                // Inspector); cell colours are colormap-driven, so the chart-wide edit
                // options live on the background (click it) / the Colour-bar.
                e.stopPropagation();
                onSelect?.({ kind: "heatmap-cell", row: c.row, col: c.col });
              }}
            />
            {c.label && (
              // family/weight/italic follow the (matchable) tick font; keep the auto-contrast fill.
              <text x={c.x + c.w / 2} y={c.y + c.h / 2 + tick * 0.34} textAnchor="middle" {...fontAttrs(scene.fonts.tick, c.labelColor)} fill={c.labelColor} pointerEvents="none">
                {c.label}
              </text>
            )}
            {isSel && (
              <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />
            )}
          </g>
        );
      })}
      {/* Annotation strips — what each row / column is. Drawn before the split rules so a rule
          crossing the band still reads as one break through the whole figure. Each strip is one
          rect per row/column (so a click can find its own row later) plus one label per run of
          equal values, which is what a reader needs: five "Treated" rows want one word. */}
      {hm.tracks?.map((tr, ti) => {
        const trIndex = hm.tracks!.filter((o) => o.axis === tr.axis).indexOf(tr);
        const trSel: GraphSelection = { kind: "heatmap-track", axis: tr.axis, index: trIndex };
        const trIsSel = selected?.kind === "heatmap-track" && selected.axis === tr.axis && selected.index === trIndex;
        return (
        <g key={`tr${ti}`} className={"gfx-heattrack" + (trIsSel ? " on" : "")} data-heattrack={`${tr.axis}-${trIndex}`}>
          {/* Clickable: a strip is an object the user made, so clicking it opens the row that
              edits it. The blocks carry the click; the runs' words and the
              name sit on top with their own gestures. */}
          {tr.blocks.map((b, i) => (
            <rect
              key={i} className="gfx-heatblock"
              x={b.x} y={b.y} width={b.w + 0.5} height={b.h + 0.5} fill={b.color}
              stroke={trIsSel ? "var(--accent)" : "none"} strokeWidth={trIsSel ? 1.5 : 0}
              style={onSelect ? { cursor: "pointer" } : undefined}
              onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(trSel); } : undefined}
            >
              {b.value && <title>{tr.name ? `${tr.name}: ${b.value}` : b.value}</title>}
            </rect>
          ))}
          <g className="gfx-heattrack-words">
            {tr.runs.map((r, i) =>
              r.label ? (
                // A row strip's word runs along the strip (rotated −90°, like the strip's own
                // name): the builder measured its length down the rows, and drawn level it would
                // be clipped by a 14-px band. Rotated, the glyph body sits left of the
                // baseline, so the half-line nudge moves to x. A column run is wide and stays level.
                <DraggableTitle
                  key={`r${i}`}
                  text={r.label}
                  x={tr.axis === "row" ? r.x + r.w / 2 + (hm.trackFont?.size ?? 10) * 0.35 : r.x + r.w / 2}
                  y={tr.axis === "row" ? r.y + r.h / 2 : r.y + r.h / 2 + (hm.trackFont?.size ?? 10) * 0.35}
                  anchor="middle"
                  {...(tr.axis === "row" ? { rotate: -90 } : {})}
                  font={hm.trackFont ?? hm.labelFont ?? scene.fonts.tick}
                  color="var(--bg)"
                  offset={r.off}
                  onMove={onMoveHeatTrackRunLabel ? (dx, dy) => onMoveHeatTrackRunLabel(tr.axis, trIndex, r.value, dx, dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "heatTrackRunLabel", axis: tr.axis, index: trIndex, value: r.value }, r.label, hm.trackFont?.size ?? 10, "middle", true) : undefined}
                  editing={editingText({ kind: "heatTrackRunLabel", axis: tr.axis, index: trIndex, value: r.value })}
                  onSelect={onSelect ? () => onSelect(trSel) : undefined}
                />
              ) : null,
            )}
          </g>
          {tr.name && (() => {
            // A row strip's name reads bottom-to-top under its band: the band is ~16px wide, so
            // two horizontal names would print through each other. Rotated, the glyph body sits to
            // the left of the baseline, so the same half-line nudge that centres a horizontal name
            // vertically centres this one across the band.
            const nfs = hm.trackFont?.size ?? 10;
            const rot = tr.nameAngle ?? 0;
            return (
            <DraggableTitle
              text={tr.name}
              x={rot ? tr.nameX + nfs * 0.35 : tr.nameX}
              y={rot ? tr.nameY : tr.nameY + nfs * 0.35}
              anchor={rot ? "end" : (tr.axis === "row" ? "middle" : "end")}
              {...(rot ? { rotate: rot } : {})}
              font={hm.trackFont ?? hm.labelFont ?? scene.fonts.tick}
              color="var(--muted)"
              offset={tr.nameOff}
              onMove={onMoveHeatTrackName ? (dx, dy) => onMoveHeatTrackName(tr.axis, trIndex, dx, dy) : undefined}
              onEdit={onEditText ? (e) => beginEdit(e, { kind: "heatTrackName", axis: tr.axis, index: trIndex }, tr.name, hm.trackFont?.size ?? 10, tr.axis === "row" ? "middle" : "end", true) : undefined}
              editing={editingText({ kind: "heatTrackName", axis: tr.axis, index: trIndex })}
              onSelect={onSelect ? () => onSelect(trSel) : undefined}
            />
            );
          })()}
          {/* The key (numeric strips only). A categorical strip carries its words; a numeric
              one shades through a ramp and, without this, the reader sees that a row is darker
              and never learns what that means.
              Painted as a staircase like the main colour bar and the `tracks` kind's strip bar:
              a stepped ramp holds two stops at each class edge, and one blended gradient would
              promise colours the strip never paints. The block moves as one; its caption edits
              the strip's name; a click anywhere on it opens the strip's own editor. */}
          {tr.key && (() => {
            const k = tr.key!;
            const kf = hm.trackFont ?? hm.labelFont ?? scene.fonts.tick;
            const segs = k.stops.length - 1;
            return (
              <DraggableGroup
                offset={k.off}
                onMove={onMoveHeatTrackKey ? (dx, dy) => onMoveHeatTrackKey(tr.axis, trIndex, dx, dy) : undefined}
                onSelect={onSelect ? () => onSelect(trSel) : undefined}
                title="Drag to move · click to edit the strip"
              >
                <g className="gfx-heattrack-key" data-heattrackkey={`${tr.axis}-${trIndex}`}>
                  {k.stops.slice(0, segs).map((st, si) => {
                    const y0 = k.bar.y + k.bar.h * (1 - k.stops[si + 1]!.offset);
                    const y1 = k.bar.y + k.bar.h * (1 - st.offset);
                    // A stepped bar carries two stops at one offset, so this segment has no
                    // height — drawn anyway it would paint the next class along every boundary.
                    if (y1 - y0 < 0.25) return null;
                    return <rect key={si} x={k.bar.x} y={y0} width={k.bar.w} height={y1 - y0} fill={k.stops[si + 1]!.color} />;
                  })}
                  <rect x={k.bar.x} y={k.bar.y} width={k.bar.w} height={k.bar.h} fill="none" stroke="var(--ink)" strokeOpacity={0.3} strokeWidth={0.75} />
                  <g {...fontAttrs(kf, "var(--muted)")}>
                    <text x={k.bar.x + k.bar.w + 3} y={k.bar.y + kf.size * 0.4}>{round2(k.max)}</text>
                    <text x={k.bar.x + k.bar.w + 3} y={k.bar.y + k.bar.h}>{round2(k.min)}</text>
                  </g>
                  {k.caption && (
                    <text
                      x={k.nameX}
                      y={k.nameY}
                      textAnchor="start"
                      {...fontAttrs(kf, "var(--ink)")}
                      opacity={editingText({ kind: "heatTrackName", axis: tr.axis, index: trIndex }) ? 0 : undefined}
                      style={onEditText ? { cursor: "text" } : undefined}
                      onDoubleClick={onEditText ? (e) => { e.stopPropagation(); beginEdit(e, { kind: "heatTrackName", axis: tr.axis, index: trIndex }, k.caption, kf.size, "start", true); } : undefined}
                    >
                      {k.caption}
                    </text>
                  )}
                </g>
              </DraggableGroup>
            );
          })()}
        </g>
        );
      })}
      {/* Split rules — drawn over the cells, so a rule reads as a break in the matrix rather
          than as a cell border. A split that is a pure space draws nothing here: its whole
          effect is the room it already took out of the geometry. */}
      {hm.splits?.map((sp, i) => {
        const spSel: GraphSelection = { kind: "heatmap-split", axis: sp.axis, at: sp.at };
        const spIsSel = selected?.kind === "heatmap-split" && selected.axis === sp.axis && selected.at === sp.at;
        // Every break is clickable, including a pure space — it is an object the user placed,
        // and it must open the row that edits it. A space draws no rule, so the click lives on an
        // invisible band across the break (at least 8px, so it can be hit with a mouse).
        const band = Math.max(8, sp.gap, sp.lineWidth + 6);
        return (
          <g key={`sp${i}`}>
            {sp.lineWidth > 0 && (
              <line
                className="gfx-heatsplit"
                data-heatsplit={`${sp.axis}-${sp.at}`}
                x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2}
                stroke={spIsSel ? "var(--accent)" : sp.color} strokeWidth={sp.lineWidth}
                {...(sp.dash ? { strokeDasharray: sp.dash } : {})}
                strokeLinecap="butt" pointerEvents="none"
              />
            )}
            <line
              className="gfx-heatsplit-hit"
              data-heatsplit-hit={`${sp.axis}-${sp.at}`}
              x1={sp.x1} y1={sp.y1} x2={sp.x2} y2={sp.y2}
              stroke={spIsSel ? "var(--accent)" : "transparent"} strokeOpacity={spIsSel ? 0.25 : 1}
              strokeWidth={band}
              style={onSelect ? { cursor: "pointer" } : undefined}
              onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(spSel); } : undefined}
            >
              <title>{`Break after ${sp.axis === "row" ? "row" : "column"} ${sp.at + 1}`}</title>
            </line>
          </g>
        );
      })}
      {hm.splits?.map((sp, i) =>
        sp.label ? (
          <DraggableTitle
            key={`spl${i}`}
            text={sp.label}
            x={sp.axis === "row" ? sp.x2 + 5 : sp.x1}
            y={sp.axis === "row" ? sp.y1 + (hm.splitLabelFont?.size ?? 10) * 0.35 : sp.y1 - 4}
            anchor={sp.axis === "row" ? "start" : "middle"}
            font={hm.splitLabelFont ?? hm.labelFont ?? scene.fonts.tick}
            color="var(--muted)"
            offset={sp.labelOff}
            onMove={onMoveHeatSplitLabel ? (dx, dy) => onMoveHeatSplitLabel(sp.axis, sp.at, dx, dy) : undefined}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "heatSplitLabel", axis: sp.axis, at: sp.at }, sp.label, hm.splitLabelFont?.size ?? 10, sp.axis === "row" ? "start" : "middle", true) : undefined}
            editing={editingText({ kind: "heatSplitLabel", axis: sp.axis, at: sp.at })}
            onSelect={onSelect ? () => onSelect({ kind: "heatmap-split", axis: sp.axis, at: sp.at }) : undefined}
          />
        ) : null,
      )}
      {(() => {
        // Row/column labels: their own font (else the capped tick font) + optional
        // column rotation. Each label moves individually (its own drag offset) and is
        // double-click editable (renames the column / row) — via the shared DraggableTitle.
        const lf = hm.labelFont;
        const lsize = lf?.size ?? hmLabel;
        const rot = hm.labelRotation ?? 0;
        // No bespoke label font → inherit the (matchable) tick font's family/weight/italic/
        // colour, keeping the ≤12 size cap so labels don't collide. Inheriting is what lets
        // "Match panels → Fonts" reach the heatmap's row/column labels.
        const font: PlotScene["fonts"]["title"] = lf ?? { ...scene.fonts.tick, size: hmLabel };
        return (
          <g>
            {hm.colLabels.map((c, i) => {
              // The lift comes from the builder, not from a constant here. A tilted label starts at
              // the top of its own column and rises up-right, so it touches its column whatever its
              // length (pinned at its end and lifted by the longest name, a short name would float
              // far above the grid). The builder reserves the band above for the tallest.
              const cy = scene.plot.y - (hm.colLabelLift ?? 5) - (hm.labelInset?.top ?? 0);
              return (
                <DraggableTitle
                  key={`c${i}`}
                  text={c.label}
                  x={c.x}
                  y={cy}
                  anchor={rot ? "start" : "middle"}
                  font={font}
                  color="var(--muted)"
                  {...(rot ? { rotate: -rot } : {})}
                  offset={c.dx != null ? { dx: c.dx, dy: c.dy ?? 0 } : undefined}
                  onMove={onMoveHeatmapLabels ? (dx, dy) => onMoveHeatmapLabels("col", i, dx, dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "heatmapColLabel", col: i, ...(c.ids ? { ids: c.ids } : {}), ...(c.groupValue !== undefined ? { groupValue: c.groupValue, trackIndex: c.trackIndex } : {}) }, c.groupValue ?? c.label, lsize, rot ? "start" : "middle", true) : undefined}
                  editing={editingText({ kind: "heatmapColLabel", col: i })}
                  onSelect={onSelect ? () => onSelect(HEAT_SECTION) : undefined}
                />
              );
            })}
            {hm.rowLabels.map((rrow, i) => (
              <DraggableTitle
                key={`r${i}`}
                text={rrow.label}
                x={scene.plot.x - 6 - (hm.labelInset?.left ?? 0)}
                y={rrow.y + lsize * 0.34}
                anchor="end"
                font={font}
                color="var(--muted)"
                offset={rrow.dx != null ? { dx: rrow.dx, dy: rrow.dy ?? 0 } : undefined}
                onMove={onMoveHeatmapLabels ? (dx, dy) => onMoveHeatmapLabels("row", i, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "heatmapRowLabel", row: i, ...(rrow.ids ? { ids: rrow.ids } : {}), ...(rrow.groupValue !== undefined ? { groupValue: rrow.groupValue, groupColumn: rrow.groupColumn } : {}) }, rrow.groupValue ?? rrow.label, lsize, "end", true) : undefined}
                editing={editingText({ kind: "heatmapRowLabel", row: i })}
                onSelect={onSelect ? () => onSelect(HEAT_SECTION) : undefined}
              />
            ))}
          </g>
        );
      })()}
      {/* matrix-mode axis titles — draggable + double-click editable (columns = X, rows = Y). */}
      {!pt && scene.x.title && (
        <DraggableTitle
          text={scene.x.title}
          x={px0 + pw0 / 2}
          y={scene.height - 7}
          anchor="middle"
          font={scene.fonts.xAxisTitle}
          offset={scene.x.titleOffset}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("x", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "x" }, scene.x.title ?? "", scene.fonts.xAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "x" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "x" }) : undefined}
          centerX={px0 + pw0 / 2}
          guideTop={py0}
          guideBottom={py0 + ph0}
        />
      )}
      {!pt && scene.y.title && (
        <DraggableTitle
          {...verticalTitle(scene.y, yTitleX, scene.y.titleCenter ?? py0 + ph0 / 2, 90)}
          font={scene.y.titleFont ? { ...scene.fonts.yAxisTitle, size: scene.y.titleFont } : scene.fonts.yAxisTitle}
          offset={scene.y.titleOffset}
          rotateGrip={titleGrip(selected, "y", scene.y, 90, onRotateAxisTitle, scene)}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y" }, scene.y.title ?? "", scene.fonts.yAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "y" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y" }) : undefined}
          centerY={py0 + ph0 / 2}
          guideLeft={px0}
          guideRight={px0 + pw0}
        />
      )}
      {/* point-data modes: continuous X/Y axes — frame, tick marks + labels, titles */}
      {pt && (
        <>
          {frame !== "none" && (
            <g>
              <line x1={frame === "offset" ? px0 + 8 : px0} x2={px0 + pw0} y1={py0 + ph0} y2={py0 + ph0} stroke="var(--line-2)" strokeWidth={1.25} />
              <line x1={px0} x2={px0} y1={py0} y2={frame === "offset" ? py0 + ph0 - 8 : py0 + ph0} stroke="var(--line-2)" strokeWidth={1.25} />
              {frame === "box" && (
                <>
                  <line x1={px0} x2={px0 + pw0} y1={py0} y2={py0} stroke="var(--line-2)" strokeWidth={1.25} />
                  <line x1={px0 + pw0} x2={px0 + pw0} y1={py0} y2={py0 + ph0} stroke="var(--line-2)" strokeWidth={1.25} />
                </>
              )}
            </g>
          )}
          {/* fontAttrs, not a bare fontSize: family/weight/italic from fonts.tick must reach
              these labels too, or "Match panels → Fonts" would silently skip the density
              heatmap. */}
          <g {...fontAttrs(scene.fonts.tick, "var(--muted)")}>
            {scene.x.ticks.filter((t) => !t.minor && t.label).map((t) => {
              const rot = scene.x.tickRotation ?? 0;
              const lbl = xTickLabelPlacement(t.pos, py0 + ph0, tick, scene.axisGaps?.xTick ?? 6, rot);
              return (
              <g key={`tx-${t.value}`}>
                {!scene.x.hideTicks && <line x1={t.pos} x2={t.pos} y1={py0 + ph0} y2={py0 + ph0 + (scene.x.tickLen ?? scene.axisStyle.tickLen) + (scene.x.lineWidth ?? 1.25) / 2} stroke={scene.x.lineColor ?? "var(--line-2)"} strokeWidth={scene.x.tickWidth ?? scene.x.lineWidth ?? 1.25} />}
                <text x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} {...numbersAttr("x", scene.x)} {...(onSelect ? { style: { cursor: "pointer" as const }, onClick: selectAxis("x", tickFocus(scene.x)) } : {})}>{t.label}</text>
              </g>
              );
            })}
            {scene.y.ticks.filter((t) => !t.minor).map((t) => {
              const rot = scene.y.tickRotation ?? 0;
              const lbl = yTickLabelPlacement(t.pos, px0, tick, scene.axisGaps?.yTick ?? 8, rot);
              return (
              <g key={`ty-${t.value}`}>
                {!scene.y.hideTicks && <line x1={px0 - (scene.y.tickLen ?? scene.axisStyle.tickLen) - (scene.y.lineWidth ?? 1.25) / 2} x2={px0} y1={t.pos} y2={t.pos} stroke={scene.y.lineColor ?? "var(--line-2)"} strokeWidth={scene.y.tickWidth ?? scene.y.lineWidth ?? 1.25} />}
                <text x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} {...numbersAttr("y", scene.y)} {...(onSelect ? { style: { cursor: "pointer" as const }, onClick: selectAxis("y", tickFocus(scene.y)) } : {})}>{t.label}</text>
              </g>
              );
            })}
          </g>
          {/* transparent hit-lines so clicking an axis selects it (→ its panel + resize handle) */}
          {onSelect && (
            <>
              <line x1={px0} x2={px0 + pw0} y1={py0 + ph0} y2={py0 + ph0} stroke="transparent" strokeWidth={14} style={{ cursor: "pointer" }} onClick={selectAxis("x")} />
              <line x1={px0} x2={px0} y1={py0} y2={py0 + ph0} stroke="transparent" strokeWidth={14} style={{ cursor: "pointer" }} onClick={selectAxis("y")} />
            </>
          )}
          {/* axis titles — draggable + double-click to edit (same as every other chart) */}
          {scene.x.title && (
            <DraggableTitle
              text={scene.x.title}
              x={px0 + pw0 / 2}
              y={scene.height - 7}
              anchor="middle"
              font={scene.fonts.xAxisTitle}
              offset={scene.x.titleOffset}
              onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("x", dx, dy) : undefined}
              onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "x" }, scene.x.title ?? "", scene.fonts.xAxisTitle.size, "middle", true) : undefined}
              editing={editingText({ kind: "axisTitle", axis: "x" })}
              onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "x" }) : undefined}
              centerX={px0 + pw0 / 2}
              guideTop={py0}
              guideBottom={py0 + ph0}
            />
          )}
          {scene.y.title && (
            <DraggableTitle
              {...verticalTitle(scene.y, yTitleX, scene.y.titleCenter ?? py0 + ph0 / 2, 90)}
              font={scene.y.titleFont ? { ...scene.fonts.yAxisTitle, size: scene.y.titleFont } : scene.fonts.yAxisTitle}
              offset={scene.y.titleOffset}
              rotateGrip={titleGrip(selected, "y", scene.y, 90, onRotateAxisTitle, scene)}
              onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y", dx, dy) : undefined}
              onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y" }, scene.y.title ?? "", scene.fonts.yAxisTitle.size, "middle", true) : undefined}
              editing={editingText({ kind: "axisTitle", axis: "y" })}
              onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y" }) : undefined}
              centerY={py0 + ph0 / 2}
              guideLeft={px0}
              guideRight={px0 + pw0}
            />
          )}
          {/* axis-length drag — grab a selected axis end to resize the plot (mirrors every chart) */}
          {onAxisResize && selX && (
            <g style={{ cursor: "ew-resize" }} onPointerDown={(e) => startAxisResize(e, "x")}>
              <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
              <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
              <circle cx={px0 + pw0} cy={py0 + ph0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
              <title>Drag to set the X-axis length</title>
            </g>
          )}
          {onAxisResize && selY && (
            <g style={{ cursor: "ns-resize" }} onPointerDown={(e) => startAxisResize(e, "y")}>
              <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
              <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
              <circle cx={px0} cy={py0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
              <title>Drag to set the Y-axis length</title>
            </g>
          )}
        </>
      )}
      {/* colour-scale bar — draggable ("move the rainbow"); optional title + interior ticks */}
      {hm.showColorbar && (() => {
        const bf = hm.barFont ?? scene.fonts.legend; // distinct colorbar font, else the legend font
        return (
        <DraggableGroup offset={scene.colorbarOffset} onMove={onMoveColorbar} onSelect={onSelect ? () => onSelect({ kind: "colorbar" }) : undefined} title="Drag to move · click to edit the colour scale">
          <rect x={hm.bar.x} y={hm.bar.y} width={hm.bar.w} height={hm.bar.h} fill={`url(#${gradId})`} stroke="var(--line)" strokeWidth={0.5} />
          <g {...fontAttrs(bf, "var(--muted)")}>
            {/* auto min/max labels — dropped when the user typed explicit values (they'd clash) */}
            {!hm.colorbarCustom && <text x={hm.bar.x + hm.bar.w + 4} y={hm.bar.y + bf.size * 0.4}>{round2(hm.max)}</text>}
            {/* the min label's baseline is lifted by its descent: on the bar's bottom edge it would hang below the figure */}
            {!hm.colorbarCustom && <text x={hm.bar.x + hm.bar.w + 4} y={hm.bar.y + hm.bar.h - bf.size * 0.3}>{round2(hm.min)}</text>}
            {/* interior ticks: a short tick line + value label */}
            {hm.colorbarTicks?.map((t, i) => (
              <g key={`cbt-${i}`}>
                <line x1={hm.bar.x + hm.bar.w} x2={hm.bar.x + hm.bar.w + 3} y1={t.y} y2={t.y} stroke="var(--line)" strokeWidth={0.75} />
                <text x={hm.bar.x + hm.bar.w + 4} y={t.y + bf.size * 0.34}>{round2(t.value)}</text>
              </g>
            ))}
          </g>
          {/* rotated colour-bar title to the right of the labels — double-click to edit */}
          {hm.colorbarTitle && (
            <text
              transform={`translate(${hm.bar.x + hm.bar.w + 34} ${hm.bar.y + hm.bar.h / 2}) rotate(-90)`}
              textAnchor="middle"
              {...fontAttrs(bf, "var(--ink)")}
              opacity={editingText({ kind: "colorbarTitle" }) ? 0 : undefined}
              style={onEditText ? { cursor: "text" } : undefined}
              onDoubleClick={onEditText ? (e) => { e.stopPropagation(); beginEdit(e, { kind: "colorbarTitle" }, hm.colorbarTitle ?? "", bf.size, "middle", false); } : undefined}
            >
              <RichText text={hm.colorbarTitle} x={0} />
            </text>
          )}
        </DraggableGroup>
        );
      })()}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/** Pie chart — slices + labels + legend; axis-free (its own SVG shell). Each
 *  slice is individually selectable + styleable (colour, explode, border, label). */
/**
 * An image panel: a picture as a figure panel, with the same heading, resize handles and
 * inline title editing every other figure has — so it behaves like a panel, not a foreign
 * object dropped into the layout.
 *
 * `preserveAspectRatio` carries the fit: "contain" letterboxes (never crops or distorts),
 * "cover" fills and crops, "fill" stretches. "contain" is the default because silently
 * cropping or stretching a micrograph would misrepresent what it shows.
 *
 * Crop + rotate window the source: the image draws at its natural pixel
 * size inside a nested `<svg>` whose viewBox selects the cropped region of the displayed
 * (post-rotation) orientation, so the fit semantics apply to the window at its true aspect.
 * Needs the source's natural size — stored on the panel at add time, measured at runtime for
 * panels saved before the fields existed (drawn uncropped until the measure lands).
 */
/**
 * Venn / Euler diagram: 2–3 translucent discs (one per set column), exclusive-zone counts,
 * and per-set labels. Every disc is a click-target selecting its set (`venn-set` → the set's
 * colour panel); set labels drag (offsets) and double-click-rename their source column; zone
 * counts are computed data — never editable. Annotations ride the shared fractional layer.
 */
function VennFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveTitle,
  onMoveSubtitle,
  onEditText,
  onTextFocus,
  onFigureResize,
  onMoveAnnotation,
  onDeleteAnnotation,
  onMoveVennSetLabel,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection | undefined;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onMoveVennSetLabel?: ((datasetId: string, dx: number, dy: number) => void) | undefined;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus });
  const place = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  const annClientToUser = clientToUserOf(svgRef);
  const v = scene.venn;
  if (!v) return null;
  const countFont = scene.fonts.legend;
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
      <svg
        ref={svgRef}
        className="gfx-figure"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={scene.width * zoom}
        height={scene.height * zoom}
        style={figSizeStyle(zoom)}
        role="img"
        aria-label={scene.title ? `Venn diagram: ${scene.title}` : "Venn diagram"}
        onPointerMove={figResize.onMove}
        onPointerUp={figResize.onUp}
        onClick={() => onSelect?.({ kind: "chart-section", title: "Chart type" })} // the Venn rows live in Chart type
      >
        <FigureBackdrop scene={scene} />
        {v.circles.map((c, ci) => {
          const sel = selected?.kind === "venn-set" && selected.datasetId === c.setId;
          // A set's total: every exclusive zone whose letters include this set's letter.
          const letter = String.fromCharCode(65 + ci);
          const setTotal = v.zones.filter((z) => z.key.includes(letter)).reduce((a, z) => a + z.count, 0);
          return (
            <circle
              key={c.setId}
              className="vennset"
              cx={c.cx}
              cy={c.cy}
              r={c.r}
              fill={c.color}
              fillOpacity={c.fillOpacity}
              stroke={sel ? "var(--accent)" : c.outline}
              strokeWidth={sel ? Math.max(2.5, c.outlineWidth) : c.outlineWidth}
              style={{ cursor: "pointer" }}
              {...madyTip([c.label, `${setTotal} in this set`])}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.({ kind: "venn-set", datasetId: c.setId });
              }}
            />
          );
        })}
        {v.zones.filter((z) => z.text !== "").map((z) => (
          <text
            key={z.key}
            className="vennzone"
            {...madyTip([`${z.key.split("").map((l) => v.circles[l.charCodeAt(0) - 65]?.label ?? l).join(" ∩ ")}${z.key.length < v.circles.length ? " only" : ""}`, `${z.count}`])}
            x={z.labelX}
            y={z.labelY + countFont.size * 0.34}
            textAnchor="middle"
            {...fontAttrs(countFont, "var(--ink)")}
            style={onSelect ? { cursor: "pointer" } : undefined}
            onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Chart type" }); } : undefined}
          >
            {z.text}
          </text>
        ))}
        {v.circles.map((c) => (
          <DraggableTitle
            key={`lbl-${c.setId}`}
            text={c.label}
            x={c.labelX}
            y={c.labelY}
            anchor="middle"
            font={countFont}
            color={c.color}
            offset={c.labelOff}
            onMove={onMoveVennSetLabel ? (dx, dy) => onMoveVennSetLabel(c.setId, dx, dy) : undefined}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "vennSetLabel", datasetId: c.setId }, c.label, countFont.size, "middle", false) : undefined}
            editing={editingText({ kind: "vennSetLabel", datasetId: c.setId })}
            // The set name opens its size (Text ▸ Title & legend ▸ Legend font); the disc keeps the set panel.
            onSelect={onSelect ? () => onSelect(LEGEND_TEXT_SECTION) : undefined}
          />
        ))}
        {scene.title && (
          <DraggableTitle
            text={scene.title}
            x={place.baseX}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={place.anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, place.anchor, false) : undefined}
            editing={editingText({ kind: "title" })}
          />
        )}
        {scene.subtitle && (
          <SubtitleText
            scene={scene}
            baseX={place.baseX}
            anchor={place.anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, place.anchor, false) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        )}
        <FractionalAnnotations
          scene={scene}
          selected={selected}
          accent="var(--accent)"
          onSelect={onSelect}
          onMoveAnnotation={onMoveAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
          clientToUser={annClientToUser}
          beginEdit={beginEdit}
          editingText={editingText}
          onEditText={onEditText}
        />
        {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
      </svg>
      {overlay}
    </div>
  );
}

/** Measure an image source's natural pixel size (fallback for a panel saved without its image's stored size). */
function useNaturalSize(src: string | null): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const im = new Image();
    im.onload = () => { if (alive && im.naturalWidth && im.naturalHeight) setSize({ w: im.naturalWidth, h: im.naturalHeight }); };
    im.src = src;
    return () => { alive = false; };
  }, [src]);
  return src ? size : null;
}

function ImageFigure({
  scene,
  zoom,
  onMoveTitle,
  onMoveSubtitle,
  onEditText,
  onTextFocus,
  onFigureResize,
}: {
  scene: PlotScene;
  zoom: number;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus });
  const place = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  const img = scene.image;
  const par = img?.fit === "fill" ? "none" : img?.fit === "cover" ? "xMidYMid slice" : "xMidYMid meet";
  const rot = img?.rotate ?? 0;
  const crop = img?.crop;
  const stored = img?.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  const measured = useNaturalSize(!stored && (rot || crop) ? img?.src ?? null : null);
  const nat = stored ?? measured;
  const windowed = Boolean(img?.src && (rot || crop) && nat);
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
      <svg
        ref={svgRef}
        className="gfx-figure"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={scene.width * zoom}
        height={scene.height * zoom}
        style={figSizeStyle(zoom)}
        role="img"
        aria-label={img?.alt || `Image panel${scene.title ? `: ${scene.title}` : ""}`}
        onPointerMove={figResize.onMove}
        onPointerUp={figResize.onUp}
      >
        <FigureBackdrop scene={scene} />
        {img?.src && windowed ? (() => {
          const nw = nat!.w;
          const nh = nat!.h;
          // Displayed frame of the rotated source (quarter turns swap the sides).
          const dw = rot === 90 || rot === 270 ? nh : nw;
          const dh = rot === 90 || rot === 270 ? nw : nh;
          const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
          const vb = `${c.x * dw} ${c.y * dh} ${Math.max(1e-6, c.w * dw)} ${Math.max(1e-6, c.h * dh)}`;
          // Map the source bitmap into the displayed (rotated) space: rotate about the
          // origin, then pre-translate so the frame lands at [0,dw]×[0,dh].
          const tf = rot ? `rotate(${rot}) translate(${rot === 180 || rot === 270 ? -nw : 0}, ${rot === 90 || rot === 180 ? -nh : 0})` : undefined;
          return (
            <svg
              x={scene.plot.x}
              y={scene.plot.y}
              width={scene.plot.width}
              height={scene.plot.height}
              viewBox={vb}
              preserveAspectRatio={par}
            >
              <g {...(tf ? { transform: tf } : {})}>
                <image href={img.src} width={nw} height={nh} preserveAspectRatio="none" />
              </g>
            </svg>
          );
        })() : img?.src ? (
          <image
            href={img.src}
            x={scene.plot.x}
            y={scene.plot.y}
            width={scene.plot.width}
            height={scene.plot.height}
            preserveAspectRatio={par}
          />
        ) : (
          // No picture chosen yet — say so rather than rendering an invisible panel.
          <>
            <rect
              x={scene.plot.x}
              y={scene.plot.y}
              width={scene.plot.width}
              height={scene.plot.height}
              fill="none"
              stroke="var(--line)"
              strokeDasharray="6 4"
            />
            <text
              x={scene.plot.x + scene.plot.width / 2}
              y={scene.plot.y + scene.plot.height / 2}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize={scene.fonts.legend.size}
            >
              No image chosen
            </text>
          </>
        )}
        {scene.title && (
          <DraggableTitle
            text={scene.title}
            x={place.baseX}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={place.anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, place.anchor, false) : undefined}
            editing={editingText({ kind: "title" })}
          />
        )}
        {scene.subtitle && (
          <SubtitleText
            scene={scene}
            baseX={place.baseX}
            anchor={place.anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, place.anchor, false) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        )}
        {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
      </svg>
      {overlay}
    </div>
  );
}

function PieFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveLegend,
  onMoveTitle,
  onMoveSubtitle,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveValueLabel,
  onMoveWaffleCaption,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
  onMoveWaffleCaption?: ((dx: number, dy: number) => void) | undefined;
}) {
  const pie = scene.pie;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const pieTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={figSizeStyle(zoom)}
      role="img"
      aria-label={`Pie chart${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => onSelect?.({ kind: "plot" })}
      onPointerMove={figResize.onMove}
      onPointerUp={figResize.onUp}
    >
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          x={pieTitle.baseX}
          y={8 + scene.fonts.title.size * 0.85}
          anchor={pieTitle.anchor}
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, pieTitle.anchor, true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={scene.width / 2}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        <SubtitleText
          scene={scene}
          baseX={pieTitle.baseX}
          anchor={pieTitle.anchor}
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, pieTitle.anchor, true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {/* Small-multiple panel titles (the value-column names) above each pie. */}
      {pie?.panels?.map((pan, pi) => (
        <text
          key={`pan-title-${pi}`}
          x={pan.titleX}
          y={pan.titleY}
          textAnchor="middle"
          fontSize={scene.fonts.legend.size}
          fontFamily={scene.fonts.legend.family ?? undefined}
          fill="var(--ink)"
          style={onSelect ? { cursor: "pointer" } : undefined}
          onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Chart type" }); } : undefined}
        >
          {pan.title}
        </text>
      ))}
      {/* Waffle / square-grid display: unit cells coloured by category, drawn instead of the arc
          slices. Each cell keeps the slice-category id, so clicking any cell selects that category
          exactly like clicking a wedge — same `pie-slice` target as the legend. */}
      {pie?.cells?.map((cell, i) => {
        // What the whole category totals, from its slice (a cell alone is one unit of it).
        const cellTip = (id: string, label: string) => { const sl = pie.slices.find((x) => x.id === id); return sl ? [label, `${tipNum(sl.value)} (${tipNum(Math.round(sl.fraction * 1000) / 10)}%)`] : [label]; };
        const isSel = selected?.kind === "pie-slice" && selected.datasetId === cell.id;
        // Icon array: the category's shape, centred and kept inside the cell (the widest shapes
        // reach 1.35 × their size), over a see-through square that stays the click target.
        const icon = cell.shape ? (
          <Marker
            shape={cell.shape}
            cx={cell.x + cell.w / 2}
            cy={cell.y + cell.h / 2}
            size={cell.w / 2 / 1.35}
            color={cell.color}
            fill="solid"
            opacity={1}
            outline={cell.outline ?? cell.color}
            borderWidth={cell.outline ? Math.max(1, cell.w * 0.06) : 1}
          />
        ) : null;
        const square = (
          <rect
            key={`cell-${i}`}
            x={cell.x}
            y={cell.y}
            width={cell.w}
            height={cell.h}
            rx={1}
            fill={icon ? "transparent" : cell.color}
            {...madyTip(cellTip(cell.id, cell.label))}
            // A two-tone category's square carries its darker edge (`outline`), drawn inside the cell gap.
            stroke={isSel ? "var(--accent)" : icon ? "none" : cell.outline ?? "var(--bg)"}
            strokeWidth={isSel ? 2 : !icon && cell.outline ? Math.max(1, cell.w * 0.06) : 0.75}
            style={{ cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: "pie-slice", datasetId: cell.id });
            }}
          >
            <title>{cell.label}</title>
          </rect>
        );
        return icon ? <g key={`cell-${i}`}>{icon}{square}</g> : square;
      })}
      {/* Count waffle: what one cell stands for, under the grid. Drags, edits in place, and a click
          opens the Pie chart section, where its unit word and font are set. */}
      {pie?.caption && (
        <DraggableTitle
          text={pie.caption.text}
          x={pie.caption.x}
          y={pie.caption.y}
          anchor="middle"
          font={scene.fonts.legend}
          offset={pie.caption.offset}
          onMove={onMoveWaffleCaption}
          onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Pie chart" }) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "waffleCaption" }, pie.caption!.text, scene.fonts.legend.size, "middle", false) : undefined}
          editing={editingText({ kind: "waffleCaption" })}
        />
      )}
      {/* Slices: a small-multiples pie draws every panel; a single pie draws its own slices. Each
          panel carries its own centre, and slices share row ids across panels (one colour + one
          selection target per category), so the map is (panelCentre × slices). Skipped in waffle mode. */}
      {!pie?.cells?.length && (pie?.panels
        ? pie.panels.flatMap((pan) => pan.slices.map((sl) => ({ sl, cx: pan.cx, cy: pan.cy, scale: pan.scale })))
        : (pie?.slices ?? []).map((sl) => ({ sl, cx: pie!.cx, cy: pie!.cy, scale: pie!.scale }))
      ).map(({ sl, cx: pcx, cy: pcy, scale }, i) => {
        const isSel = selected?.kind === "pie-slice" && selected.datasetId === sl.id;
        const xform = `translate(${pcx + sl.ox} ${pcy + sl.oy})${scale ? ` scale(${scale.sx} ${scale.sy})` : ""}`;
        return (
          <g key={`${sl.id}-${i}`}>
            {/* The slice keeps its own border colour/width even while selected; the
                selection is shown by a separate dashed accent overlay (below), so
                editing the border colour is always visible. */}
            <path
              d={sl.path}
              transform={xform}
              fill={sl.color}
              stroke={sl.strokeColor ?? "var(--bg)"}
              strokeWidth={sl.strokeWidth}
              style={{ cursor: "pointer" }}
              {...madyTip([sl.label, `${tipNum(sl.value)} (${tipNum(Math.round(sl.fraction * 1000) / 10)}%)`])}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.({ kind: "pie-slice", datasetId: sl.id });
              }}
            />
            {isSel && (
              <path
                d={sl.path}
                transform={xform}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={Math.max(2, sl.strokeWidth + 1)}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            {sl.labelText && (
              <DraggableTitle
                text={sl.labelText}
                x={sl.labelX}
                y={sl.labelY + (sl.labelFont ?? scene.fonts.sliceLabel).size * 0.34}
                anchor="middle"
                font={sl.labelFont ?? scene.fonts.sliceLabel}
                color={sl.labelInside ? (sl.labelInk ?? "#fff") : "var(--ink)"}
                offset={{ dx: sl.labelDx ?? 0, dy: sl.labelDy ?? 0 }}
                onMove={onMoveValueLabel ? (dx, dy) => onMoveValueLabel(sl.id, sl.id, dx, dy) : undefined}
                onSelect={() => onSelect?.({ kind: "pie-slice", datasetId: sl.id })}
                // A slice label is draggable and editable. The edit rides the same per-point
                // override the drag already uses (keyed "<slice>:<slice>"), so a rename is
                // the same call — blank restores the generated label/percent/value readout.
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "value", columnId: sl.id, rowId: sl.id }, sl.labelText ?? "", (sl.labelFont ?? scene.fonts.sliceLabel).size, "middle", false) : undefined}
              />
            )}
          </g>
        );
      })}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/**
 * Where a correlation matrix's own furniture is edited: the row/column label fonts and angle,
 * the scale legend, the palette, the grid and the domain blocks are all in this one Inspector
 * section. Its labels and its legend open it, because none of them is a selectable object
 * — the same answer a legend row naming a group gets.
 */
const CORR_SECTION = { kind: "chart-section", title: "Correlation matrix" } as const;

/** Where any legend's type is edited — "Legend font" lives in this one section, and
 *  `tabForSection` puts it on the Text tab. */
const LEGEND_TEXT_SECTION = { kind: "chart-section", title: "Title & legend" } as const;

/** Correlation matrix: an N×N grid of glyphs (pie/circle/square/number) encoding pairwise r,
 *  blue⁺/red⁻ saturating with |r|, with an optional scale legend + domain-block dividers. */
function CorrMatrixFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveTitle,
  onMoveSubtitle,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveCorrLabels,
  onMoveCorrLegend,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveCorrLabels?: ((which: "row" | "col", index: number, dx: number, dy: number) => void) | undefined;
  onMoveCorrLegend?: ((dx: number, dy: number) => void) | undefined;
}) {
  const cm = scene.corrmatrix;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const cmTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  // The matrix's own label font (already merged over the tick font by the builder) when it has one, in full -
  // keeping only its size would leave Bold / Colour / Family / Italic without effect.
  const labelFont = cm?.labelFont ? { ...cm.labelFont, size: cm.labelSize } : { ...scene.fonts.tick, size: cm?.labelSize ?? scene.fonts.tick.size };
  const legendFont = { ...scene.fonts.legend };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
      <svg
        ref={svgRef}
        className="gfx-figure"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={scene.width * zoom}
        height={scene.height * zoom}
        style={figSizeStyle(zoom)}
        role="img"
        aria-label={`Correlation matrix${scene.title ? `: ${scene.title}` : ""}`}
        onClick={() => onSelect?.({ kind: "plot" })}
        onPointerMove={figResize.onMove}
        onPointerUp={figResize.onUp}
      >
        <FigureBackdrop scene={scene} />
        {scene.title && (
          <DraggableTitle
            text={scene.title}
            x={cmTitle.baseX}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={cmTitle.anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, cmTitle.anchor, true) : undefined}
            editing={editingText({ kind: "title" })}
            centerX={scene.width / 2}
            guideTop={2}
            guideBottom={scene.plot.y}
          />
        )}
        {scene.subtitle && (
          <SubtitleText
            scene={scene}
            baseX={cmTitle.baseX}
            anchor={cmTitle.anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, cmTitle.anchor, true) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        )}
        {cm && (
          <>
            {/* faint tint on the diagonal domain-blocks (behind the cells) */}
            {cm.blockTints?.map((t, i) => (
              <rect key={`bt${i}`} x={t.x} y={t.y} width={t.w} height={t.h} fill={t.color} opacity={0.05} pointerEvents="none" />
            ))}
            {/* cells: optional border · glyph outline · glyph · value label */}
            {cm.cells.map((c) => {
              const cellSel = selected?.kind === "corr-cell" && selected.row === c.row && selected.col === c.col;
              return (
              <g key={`${c.row}-${c.col}`}>
                {cm.border && <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke={cm.border} strokeWidth={1} pointerEvents="none" />}
                {c.outlinePath && <path d={c.outlinePath} fill="#ffffff" stroke="#c8c8c8" strokeWidth={0.75} pointerEvents="none" />}
                {c.glyphPath && <path d={c.glyphPath} fill={c.color} stroke="#00000022" strokeWidth={0.5} pointerEvents="none" />}
                {c.label && (
                  <text x={c.labelX} y={c.labelY + labelFont.size * 0.34} textAnchor="middle" {...fontAttrs(labelFont, c.labelColor)} pointerEvents="none">
                    {c.label}
                  </text>
                )}
                {/* Transparent hit-target: click a cell to recolour just that glyph, and
                    the hover value of the interactive HTML export. */}
                <rect
                  x={c.x} y={c.y} width={c.w} height={c.h}
                  fill="transparent"
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...madyTip([[cm.rowLabels[c.row]?.label, cm.colLabels[c.col]?.label].filter(Boolean).join(" · "), c.r == null ? "no value" : `r = ${tipNum(Math.round(c.r * 1000) / 1000)}`])}
                  onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "corr-cell", row: c.row, col: c.col }); } : undefined}
                />

                {cellSel && <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="none" stroke="var(--accent)" strokeWidth={2} pointerEvents="none" />}
              </g>
              );
            })}
            {/* dashed domain-block dividers (over the cells) */}
            {cm.blockDividers?.map((d, i) => (
              <line key={`bd${i}`} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} stroke="#8a6d3b" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
            ))}
            {/* column labels (rotated) + row labels — draggable + double-click editable (rename the variable) */}
            {cm.colLabels.map((cl, j) => {
              // Lift the pivot by the builder's own reserve. A rotated label is anchored at its
              // end, so it hangs down-left by width × sin(angle); a font-scaled constant would be
              // far smaller than that drop, letting the tail fall into the first row of cells and
              // onto that row's label.
              const y = cm.grid.y - cm.colLabelLift;
              return (
                <DraggableTitle
                  key={`cl${j}`}
                  text={cl.label}
                  x={cl.x}
                  y={y}
                  anchor={cl.angle ? "end" : "middle"}
                  font={labelFont}
                  color="var(--ink)"
                  {...(cl.angle ? { rotate: -cl.angle } : {})}
                  offset={cl.dx != null ? { dx: cl.dx, dy: cl.dy ?? 0 } : undefined}
                  onMove={onMoveCorrLabels ? (dx, dy) => onMoveCorrLabels("col", j, dx, dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "corrColLabel", col: j }, cl.label, labelFont.size, cl.angle ? "end" : "middle", true) : undefined}
                  editing={editingText({ kind: "corrColLabel", col: j })}
                  onSelect={onSelect ? () => onSelect(CORR_SECTION) : undefined}
                />
              );
            })}
            {cm.rowLabels.map((rl, i) => (
              <DraggableTitle
                key={`rl${i}`}
                text={rl.label}
                x={cm.grid.x - 6}
                y={rl.y + labelFont.size * 0.34}
                anchor="end"
                font={labelFont}
                color="var(--ink)"
                offset={rl.dx != null ? { dx: rl.dx, dy: rl.dy ?? 0 } : undefined}
                onMove={onMoveCorrLabels ? (dx, dy) => onMoveCorrLabels("row", i, dx, dy) : undefined}
                onEdit={onEditText ? (e) => beginEdit(e, { kind: "corrRowLabel", row: i }, rl.label, labelFont.size, "end", true) : undefined}
                editing={editingText({ kind: "corrRowLabel", row: i })}
                onSelect={onSelect ? () => onSelect(CORR_SECTION) : undefined}
              />
            ))}
            {/* correlation-scale legend (pie glyphs +1 … −1) — draggable, and clickable */}
            {cm.scaleLegend && (
              <DraggableGroup
                offset={cm.scaleLegend.offset}
                onMove={onMoveCorrLegend}
                title="Drag to move the correlation scale — click to edit it"
                /**
                 * A click opens the scale legend's own settings ("Scale legend", the palette, the
                 * label font); without it they would be reachable only by clicking the chart
                 * background, and a click on the legend would show nothing in the side panel.
                 *
                 * Caution: not `{kind:"colorbar"}` — that pins a section called "Colour bar", which a
                 * correlation matrix does not have, and pinning a section that does not exist
                 * hides every section instead: a blank panel. Its settings live in the
                 * "Correlation matrix" section, so that is what it opens.
                 */
                onSelect={onSelect ? () => onSelect(CORR_SECTION) : undefined}
              >
                {/**
                  * The legend's text opens where its font is, which is not this legend's own
                  * section. The scale legend is drawn with `fonts.legend`, and the only control
                  * for that is "Legend font" in Title & legend (the correlation matrix keeps it
                  * for exactly this reason — see `LEGEND_FONT_ONLY`). The surrounding group still
                  * opens the Correlation matrix section, which owns whether the legend is shown
                  * and the +/− palette: the swatches are that legend, the words are type.
                  * Both its symbol size and its font must be editable.
                  */}
                <text
                  x={cm.scaleLegend.titleX}
                  y={cm.scaleLegend.titleY}
                  textAnchor="start"
                  {...fontAttrs(legendFont, "var(--ink)")}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...(onSelect ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(LEGEND_TEXT_SECTION); } } : {})}
                >
                  {cm.scaleLegend.title}
                </text>
                {cm.scaleLegend.items.map((it, k) => (
                  <g key={`lg${k}`}>
                    <path d={it.outlinePath} fill="#ffffff" stroke="#c8c8c8" strokeWidth={0.75} />
                    <path d={it.glyphPath} fill={it.color} stroke="#00000022" strokeWidth={0.5} />
                    <text
                      x={it.labelX}
                      y={it.labelY}
                      textAnchor="start"
                      {...fontAttrs(legendFont, "var(--ink)")}
                      style={onSelect ? { cursor: "pointer" } : undefined}
                      {...(onSelect ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(LEGEND_TEXT_SECTION); } } : {})}
                    >
                      {it.label}
                    </text>
                  </g>
                ))}
              </DraggableGroup>
            )}
          </>
        )}
        {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
      </svg>
      {overlay}
    </div>
  );
}

/** Alluvial / parallel-sets: N categorical axes of stacked nodes + ribbons between them. */
function AlluvialFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveTitle,
  onMoveSubtitle,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveValueLabel,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  /** Persist a label nudge into `pointStyles["<colId>:<rowId>"].valueDx/valueDy` — the same
   *  store the pie slice and parallel-coordinates axis labels use. */
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
}) {
  const al = scene.alluvial;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const alTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
      <svg
        ref={svgRef}
        className="gfx-figure"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={scene.width * zoom}
        height={scene.height * zoom}
        style={figSizeStyle(zoom)}
        role="img"
        aria-label={`Alluvial diagram${scene.title ? `: ${scene.title}` : ""}`}
        onClick={() => onSelect?.({ kind: "plot" })}
        onPointerMove={figResize.onMove}
        onPointerUp={figResize.onUp}
      >
        <FigureBackdrop scene={scene} />
        {scene.title && (
          <DraggableTitle
            text={scene.title}
            x={alTitle.baseX}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={alTitle.anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, alTitle.anchor, true) : undefined}
            editing={editingText({ kind: "title" })}
            centerX={scene.width / 2}
            guideTop={2}
            guideBottom={scene.plot.y}
          />
        )}
        {scene.subtitle && (
          <SubtitleText
            scene={scene}
            baseX={alTitle.baseX}
            anchor={alTitle.anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, alTitle.anchor, true) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        )}
        {al && (
          <>
            {/*
              Ribbons behind the nodes — and clickable. The flows are the whole visual mass of
              the chart and what "the data" means here; with `pointerEvents="none"` every click
              would pass straight through to the figure background and select the whole graph,
              leaving only the 16px node bars as targets for changing a colour.
              Note: a ribbon has no colour of its own: `nodeColors` is keyed by node, and a node on
              the colour axis recolours every flow it originates. So it selects that node, whose
              swatch is the one control that moves this band — `rb.select`, stated by the builder.
            */}
            {al.ribbons.map((rb, i) => {
              const rbSel = selected?.kind === "alluvial-node" && selected.axis === rb.select.axis && selected.category === rb.select.category;
              return (
                <path
                  key={`rb${i}`}
                  d={rb.path}
                  fill={rb.color}
                  /* Selection reads as the flows lifting, not as a recolour — the swatch about
                     to be edited must keep showing its real colour. */
                  fillOpacity={rbSel ? Math.min(1, rb.opacity + 0.28) : rb.opacity}
                  stroke="none"
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...madyTip([al.axisLabels[rb.select.axis]?.label ? `${al.axisLabels[rb.select.axis]!.label}: ${rb.select.category}` : rb.select.category, `flow of ${tipNum(rb.count)}`])}
                  {...(onSelect
                    ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect({ kind: "alluvial-node", axis: rb.select.axis, category: rb.select.category }); } }
                    : { pointerEvents: "none" as const })}
                />
              );
            })}
            {/* category nodes — click to select + recolour the block (and the flows it
                originates when it's on the colour axis). */}
            {al.nodes.map((nd, i) => {
              const isSel = selected?.kind === "alluvial-node" && selected.axis === nd.axis && selected.category === nd.category;
              return (
                <rect
                  key={`nd${i}`}
                  x={nd.x}
                  y={nd.y}
                  width={nd.w}
                  height={nd.h}
                  fill={nd.color}
                  stroke={isSel ? "var(--accent)" : al.nodeStroke}
                  strokeWidth={isSel ? 2 : 0.5}
                  strokeDasharray={isSel ? "3 2" : undefined}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...madyTip([al.axisLabels[nd.axis]?.label ? `${al.axisLabels[nd.axis]!.label}: ${nd.label}` : nd.label, tipNum(nd.count)])}
                  onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "alluvial-node", axis: nd.axis, category: nd.category }); } : undefined}
                />
              );
            })}
            {/*
              Node labels (on top of ribbons) + axis headers — both clickable.
              • A node label names a node, so it selects that node — the same target as its block,
                which is where its colour lives. (Clicking the words names the thing they name:
                the same rule as a legend row.)
              • An axis header names a column, and everything about it — which columns are axes,
                the label font — is decided in the Alluvial section, so it opens that.
            */}
            {al.nodes.map((nd, i) =>
              nd.label ? (
                <DraggableTitle
                  key={`nl${i}`}
                  text={nd.label}
                  x={nd.labelX}
                  y={nd.labelY}
                  anchor={nd.labelAnchor}
                  font={scene.fonts.tick}
                  color="var(--ink)"
                  offset={{ dx: nd.labelDx ?? 0, dy: nd.labelDy ?? 0 }}
                  {...(onMoveValueLabel && nd.colId
                    ? { onMove: (dx: number, dy: number) => onMoveValueLabel(nd.colId!, nd.category, dx, dy) }
                    : {})}
                  {...(onSelect ? { onSelect: () => onSelect({ kind: "alluvial-node", axis: nd.axis, category: nd.category }) } : {})}
                />
              ) : null,
            )}
            {al.axisLabels.map((a, i) => (
              <DraggableTitle
                key={`ax${i}`}
                text={a.label}
                x={a.x}
                y={a.y}
                anchor="middle"
                font={scene.fonts.legend}
                color="var(--ink)"
                offset={{ dx: a.dx ?? 0, dy: a.dy ?? 0 }}
                {...(onMoveValueLabel && a.colId
                  ? { onMove: (dx: number, dy: number) => onMoveValueLabel(a.colId!, a.colId!, dx, dy) }
                  : {})}
                {...(onSelect
                  /* The section's exact heading. Pinning matches by substring, so "Alluvial"
                     would also have worked — but a title that is merely a prefix is one rename
                     away from matching nothing, and a pinned section that matches nothing hides
                     every section instead of showing one: a blank panel. */
                  ? { onSelect: () => onSelect({ kind: "chart-section", title: "Alluvial / parallel sets" }) }
                  : {})}
              />
            ))}
          </>
        )}
        {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
      </svg>
      {overlay}
    </div>
  );
}

/** Node-link network graph: weighted edges + coloured/sized nodes with labels.
 *  Draws edges behind the nodes; optional diverging value-colour legend. No axes. */
function NetworkFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveTitle,
  onMoveSubtitle,
  onMoveLegend,
  onMoveColorbar,
  onMoveNetworkNode,
  onEditText,
  onTextFocus,
  onFigureResize,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  onMoveColorbar?: ((dx: number, dy: number) => void) | undefined;
  onMoveNetworkNode?: ((nodeId: string, x: number, y: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
}) {
  const nw = scene.network;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const nTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  const tick = scene.fonts.tick.size;
  // Node labels use the size the builder de-conflicted with, never the tick font.
  const lbl = nw?.labelSize ?? tick;
  const labelFont = { ...scene.fonts.tick, size: lbl };
  // Node drag: track the node being dragged + its live pixel delta. On release we
  // commit a fractional plot-rect position (the rebuild re-routes its edges).
  const [nodeDrag, setNodeDrag] = useRafState<{ id: string; dx: number; dy: number } | null>(null);
  const nodeDragRef = useRef<{ id: string; x0: number; y0: number; scale: number; dx: number; dy: number; moved: boolean } | null>(null);
  const nodeScale = (e: React.PointerEvent): number => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const w = svg?.getBoundingClientRect().width;
    const vb = svg?.viewBox.baseVal.width || 1;
    return w && vb ? w / vb : 1;
  };
  const nodeDown = (e: React.PointerEvent, id: string): void => {
    if (!onMoveNetworkNode && !onSelect) return;
    e.stopPropagation();
    nodeDragRef.current = { id, x0: e.clientX, y0: e.clientY, scale: nodeScale(e), dx: 0, dy: 0, moved: false };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const nodeMove = (e: React.PointerEvent): void => {
    const d = nodeDragRef.current;
    if (!d) return;
    d.dx = (e.clientX - d.x0) / d.scale;
    d.dy = (e.clientY - d.y0) / d.scale;
    if (Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3) d.moved = true;
    setNodeDrag({ id: d.id, dx: d.dx, dy: d.dy });
  };
  const nodeUp = (_e: React.PointerEvent, cx: number, cy: number): void => {
    const d = nodeDragRef.current;
    nodeDragRef.current = null;
    setNodeDrag(null);
    if (!d) return;
    if (!d.moved) { onSelect?.({ kind: "network-node", nodeId: d.id }); return; }
    if (!onMoveNetworkNode) return;
    const nx = (cx + d.dx - scene.plot.x) / scene.plot.width;
    const ny = (cy + d.dy - scene.plot.y) / scene.plot.height;
    onMoveNetworkNode(d.id, Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
      <svg
        ref={svgRef}
        className="gfx-figure"
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={scene.width * zoom}
        height={scene.height * zoom}
        style={figSizeStyle(zoom)}
        role="img"
        aria-label={`Network graph${scene.title ? `: ${scene.title}` : ""}`}
        onClick={() => onSelect?.({ kind: "plot" })}
        onPointerMove={figResize.onMove}
        onPointerUp={figResize.onUp}
      >
        <FigureBackdrop scene={scene} />
        {scene.title && (
          <DraggableTitle
            text={scene.title}
            x={nTitle.baseX}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={nTitle.anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, nTitle.anchor, true) : undefined}
            editing={editingText({ kind: "title" })}
            centerX={scene.width / 2}
            guideTop={2}
            guideBottom={scene.plot.y}
          />
        )}
        {scene.subtitle && (
          <SubtitleText
            scene={scene}
            baseX={nTitle.baseX}
            anchor={nTitle.anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, nTitle.anchor, true) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        )}
        {nw && (
          <>
            {/* edges behind the nodes — click one to select it (style that link alone, or
                push the style to every link, in the Inspector). A link is only ~1px wide, so
                each gets a fat transparent hit-line on top of it (same trick as the arrow
                annotations); the nodes are drawn after, so they still win a shared hit. */}
            <g>
              {nw.edges.map((e, i) => {
                const isSel = selected?.kind === "network-edge" && selected.edgeId === e.id;
                const d = e.cx !== undefined ? `M ${e.x1} ${e.y1} Q ${e.cx} ${e.cy} ${e.x2} ${e.y2}` : `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`;
                const pick = onSelect ? (ev: React.MouseEvent) => { ev.stopPropagation(); onSelect({ kind: "network-edge", edgeId: e.id }); } : undefined;
                return (
                  <g key={`e${i}`} data-edge-id={e.id}>
                    {/* selection glow sits behind the link so it haloes rather than hides it */}
                    {isSel && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={e.width + 4} strokeOpacity={0.35} pointerEvents="none" />}
                    <path d={d} fill="none" stroke={e.color} strokeWidth={e.width} strokeOpacity={isSel ? 1 : e.opacity} pointerEvents="none" />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(10, e.width + 8)}
                      style={onSelect ? { cursor: "pointer" } : undefined}
                      onClick={pick}
                    >
                      <title>{`${e.sourceId} → ${e.targetId}`}</title>
                    </path>
                  </g>
                );
              })}
            </g>
            {/* nodes + labels — click a node to select it (recolour in the Inspector),
                drag it to reposition, double-click its label to rename it. */}
            {nw.nodes.map((nd) => {
              const isSel = selected?.kind === "network-node" && selected.nodeId === nd.id;
              const live = nodeDrag?.id === nd.id ? nodeDrag : null;
              return (
                <g key={`n-${nd.id}`} transform={live ? `translate(${live.dx} ${live.dy})` : undefined}>
                  {/* A two-tone node is just a solid fill with a darker outline (derived in
                      the scene builder); nothing special to draw here. */}
                  <circle
                    cx={nd.cx}
                    cy={nd.cy}
                    r={nd.r}
                    fill={nd.color}
                    stroke={nd.stroke ?? "var(--bg)"}
                    strokeWidth={nd.strokeWidth ?? 1}
                    style={{ cursor: onMoveNetworkNode ? "grab" : "pointer" }}
                    onPointerDown={(e) => nodeDown(e, nd.id)}
                    onPointerMove={nodeMove}
                    onPointerUp={(e) => { e.stopPropagation(); nodeUp(e, nd.cx, nd.cy); }}
                    // A node selects on pointerup, but the browser then fires a `click`
                    // that bubbles to the <svg>'s "background → select the plot" handler
                    // and would overwrite the selection, so the node editor would never open.
                    // Stopping pointerup is not enough — the click is a separate event.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>{`${nd.id} · degree ${nd.degree}${nd.value !== undefined ? ` · ${nd.value}` : ""}`}</title>
                  </circle>
                  {isSel && (
                    <circle cx={nd.cx} cy={nd.cy} r={nd.r + 3} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="3 2" pointerEvents="none" />
                  )}
                  {nd.label && nd.labelLeader && (
                    /* Only when the placement rule had to move the name away from its node. */
                    <line
                      x1={nd.labelLeader.x1} y1={nd.labelLeader.y1}
                      x2={nd.labelLeader.x2} y2={nd.labelLeader.y2}
                      stroke="var(--ink)" strokeWidth={0.75} opacity={0.6} pointerEvents="none"
                    />
                  )}
                  {nd.label && (
                    <text
                      /* The builder's placement rule may put the label anywhere around the node
                         (`labelDx`/`labelDy`, so it can dodge an edge or a neighbour); without
                         them it hangs beside the node. */
                      x={nd.labelDx != null ? nd.cx + nd.labelDx : nd.cx + (nd.labelAnchor === "end" ? -(nd.r + 3) : nd.r + 3)}
                      y={(nd.labelDy != null ? nd.cy + nd.labelDy : nd.cy) + lbl * 0.34}
                      textAnchor={nd.labelAnchor ?? "start"}
                      {...fontAttrs(labelFont, "var(--ink)")}
                      opacity={editingText({ kind: "networkNodeLabel", nodeId: nd.id }) ? 0 : undefined}
                      style={onEditText ? { cursor: "text" } : undefined}
                      onDoubleClick={onEditText ? (e) => beginEdit(e, { kind: "networkNodeLabel", nodeId: nd.id }, nd.label, lbl, "start", true) : undefined}
                      /**
                       * A single click on the words opens the label's own settings — its font,
                       * its size, its colour — not the node's fill.
                       *
                       * With only `onDoubleClick` (rename), one click would fall through to the
                       * figure background and select the whole graph. Selecting the node instead
                       * would not help either: the node editor has a fill and an outline and no
                       * type controls at all.
                       *
                       * The Network graph section owns "Show labels", "Label size", "Label min
                       * degree" and the label Font / Style / Colour, so that is what it opens.
                       * The node is still selected by clicking its disc — the shape for the
                       * object, the words for their type. Double-click still renames.
                       */
                      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Network graph" }); } : undefined}
                    >
                      {nd.label}
                    </text>
                  )}
                </g>
              );
            })}
            {/* diverging value-colour legend — a vertical bar in the left margin (the builder
                reserved that column and measured these exact label strings), high value at the
                top. Still draggable anywhere via the colorbar offset. */}
            {nw.valueLegend && (() => {
              const lg = nw.valueLegend;
              const barW = 8;
              const x1 = scene.plot.x - 6; // bar right edge; labels right-align to it too
              const x0 = x1 - barW;
              const yTop = scene.plot.y + lbl + 4;
              const h = Math.max(24, Math.min(120, scene.plot.height - 2 * (lbl + 6)));
              const seg = lg.ramp.length;
              return (
                <DraggableGroup
                  offset={scene.colorbarOffset}
                  onMove={onMoveColorbar}
                  title="Drag to move the value legend — click to edit it"
                  /**
                   * A click opens the value legend's own settings (the two ramp colours, the
                   * label size), which live in the Network graph section; without it they would
                   * be reachable only by opening that section by hand.
                   *
                   * Caution: not `{kind:"colorbar"}` — that pins a "Colour bar" section, which belongs
                   * to the heatmap and does not exist on a network graph; pinning a missing
                   * section hides every section instead, i.e. a blank panel.
                   */
                  onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Network graph" }) : undefined}
                >
                  {/* ramp[] runs low→high, so segment i sits (seg−1−i) slots from the top */}
                  {lg.ramp.map((c, i) => (
                    <rect key={`lg${i}`} x={x0} y={yTop + ((seg - 1 - i) * h) / seg} width={barW} height={h / seg + 0.5} fill={c} />
                  ))}
                  <text x={x1} y={yTop - 4} textAnchor="end" {...fontAttrs(labelFont, "var(--muted)")}>{lg.maxLabel}</text>
                  <text x={x1} y={yTop + h + lbl} textAnchor="end" {...fontAttrs(labelFont, "var(--muted)")}>{lg.minLabel}</text>
                </DraggableGroup>
              );
            })()}
          </>
        )}
        {/* group + edge-sign legend — the standard legend block, so
            position/orientation/font controls and dragging all behave as everywhere else */}
        {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
        {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
      </svg>
      {overlay}
    </div>
  );
}

/** Voronoi treemap: one area-proportional convex cell per row, tiling the boundary. */
function TreemapFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveLegend,
  onMoveTitle,
  onMoveSubtitle,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveValueLabel,
  onMoveTreemapRegionLabel,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
  onMoveTreemapRegionLabel?: ((group: string, dx: number, dy: number) => void) | undefined;
}) {
  const tm = scene.treemap;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const tmTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={figSizeStyle(zoom)}
      role="img"
      aria-label={`Treemap${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => onSelect?.({ kind: "plot" })}
      onPointerMove={figResize.onMove}
      onPointerUp={figResize.onUp}
    >
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          x={tmTitle.baseX}
          y={8 + scene.fonts.title.size * 0.85}
          anchor={tmTitle.anchor}
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, tmTitle.anchor, true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={scene.width / 2}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        <SubtitleText
          scene={scene}
          baseX={tmTitle.baseX}
          anchor={tmTitle.anchor}
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, tmTitle.anchor, true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {tm &&
        tm.cells.map((c) => {
          if (c.points.length < 3) return null;
          const pts = c.points.map((p) => `${p.x},${p.y}`).join(" ");
          // Value labels are driven by showValues (the builder only sets valueLabel then), so
          // they must not require showLabels — a values-only treemap is valid.
          const hasVal = c.valueLabel !== "";
          const isSel = selected?.kind === "treemap-cell" && selected.cellId === c.id;
          const tmTotal = tm.cells.reduce((a, k) => a + k.value, 0);
          return (
            <g key={c.id}>
              {/* The cell keeps its own fill/border even when selected; selection is a
                  separate dashed accent overlay so editing the colour stays visible. */}
              <polygon
                points={pts}
                fill={c.fill}
                fillOpacity={c.fillOpacity}
                stroke={c.stroke ?? tm.stroke}
                strokeWidth={c.strokeWidth ?? tm.strokeWidth}
                strokeLinejoin="round"
                style={{ cursor: "pointer" }}
                {...madyTip([c.label, tipNum(c.value), tmTotal > 0 ? `${tipNum(Math.round((c.value / tmTotal) * 1000) / 10)}% of the whole` : null])}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.({ kind: "treemap-cell", cellId: c.id });
                }}
              />
              {isSel && (
                <polygon points={pts} fill="none" stroke="var(--accent)" strokeWidth={Math.max(2, tm.strokeWidth + 1)} strokeDasharray="4 3" strokeLinejoin="round" pointerEvents="none" />
              )}
              {tm.showLabels && (
                <DraggableTitle
                  text={c.label}
                  x={c.labelX}
                  y={c.labelY + (hasVal ? -c.labelSize * 0.05 : c.labelSize * 0.34)}
                  anchor="middle"
                  font={{ ...scene.fonts.tick, size: c.labelSize }}
                  color={c.labelColor}
                  offset={c.labelDx != null || c.labelDy != null ? { dx: c.labelDx ?? 0, dy: c.labelDy ?? 0 } : undefined}
                  onMove={onMoveValueLabel ? (dx, dy) => onMoveValueLabel(c.id, c.id, dx, dy) : undefined}
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "treemapCellLabel", rowId: c.id }, c.label, c.labelSize, "middle", true) : undefined}
                  editing={editingText({ kind: "treemapCellLabel", rowId: c.id })}
                  /**
                   * A cell label opens the section that sizes it. With `onMove` and `onEdit`
                   * alone, a single click would fall through to the figure background and
                   * select the whole graph, landing on whichever tab was last open, with no
                   * way to reach the label's font.
                   *
                   * The Treemap section is where its label font, Label size and value readout
                   * live, so that is what it opens. The cell itself is still selected by clicking
                   * its polygon — click the shape for the object, the words for their type.
                   */
                  {...(onSelect ? { onSelect: () => onSelect({ kind: "chart-section", title: "Treemap" }) } : {})}
                />
              )}
              {hasVal && (
                <text
                  x={c.labelX + (c.labelDx ?? 0)}
                  y={c.labelY + (tm.showLabels ? c.labelSize * 1.05 : c.labelSize * 0.34) + (c.labelDy ?? 0)}
                  textAnchor="middle"
                  {...fontAttrs({ ...scene.fonts.tick, size: c.labelSize * 0.85 }, c.labelColor)}
                  /* The value under the label is clickable too. It is drawn by the same Treemap
                     settings, so it opens the same section. */
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...(onSelect
                    ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Treemap" }); } }
                    : { pointerEvents: "none" as const })}
                >
                  {c.valueLabel}
                </text>
              )}
              {c.icon && (
                <text
                  x={c.labelX + (c.labelDx ?? 0)}
                  // Do not recompute the lift here. The builder owns it (`iconY`) and
                  // places the icon so its box clears the label's; another copy of the
                  // hard-coded offset here would let the icon graze its own cell name.
                  y={(tm.showLabels && c.iconY != null ? c.iconY : c.labelY - c.labelSize * 0.2) + (c.labelDy ?? 0)}
                  textAnchor="middle"
                  fontSize={c.labelSize * 1.35}
                  pointerEvents="none"
                >
                  {c.icon}
                </text>
              )}
            </g>
          );
        })}
      {tm?.groupLabels?.map((g, i) => (
        <DraggableTitle
          key={`gl-${i}`}
          text={g.text.toUpperCase()}
          x={g.x}
          y={g.y}
          anchor="middle"
          baseline="middle"
          rotate={g.angle}
          font={{ ...scene.fonts.tick, size: g.fontSize }}
          color={g.color}
          weight={700}
          letterSpacing="0.08em"
          offset={g.dx != null || g.dy != null ? { dx: g.dx ?? 0, dy: g.dy ?? 0 } : undefined}
          onMove={onMoveTreemapRegionLabel ? (dx, dy) => onMoveTreemapRegionLabel(g.text, dx, dy) : undefined}
          onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Treemap" }) : undefined}
        />
      ))}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/** Parallel-coordinates plot: N vertical axes (one per variable) + one polyline per row. */
function ParallelFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveLegend,
  onMoveTitle,
  onMoveSubtitle,
  onMoveColorbar,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveValueLabel,
  onParallelEdit,
}: {
  scene: PlotScene;
  zoom: number;
  /** Needed to emphasise the selected data line (parallel has per-line selection). */
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveColorbar?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
  onParallelEdit?: ((patch: { brushes?: Record<string, [number, number]>; axisOrder?: string[] }) => void) | undefined;
}) {
  const pc = scene.parallel;
  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const pcTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  // Direct manipulation: drag on an axis to brush (filter) a value range; drag a variable
  // label horizontally to reorder the axes. Both commit via onParallelEdit.
  // Drag data lives in a ref (read synchronously in move/up, like the title drag); the
  // parallel state only mirrors it to re-render the live preview rect / label offset.
  const brushRef = useRef<{ colId: string; y0: number; y1: number } | null>(null);
  /** `dx`/`dy` are this gesture's delta (the reorder needs the travel); `dx0`/`dy0` are the
   *  label's already-stored free-drag offset, so a nudge accumulates instead of resetting. */
  const labelRef = useRef<{ colId: string; x0: number; y0: number; dx: number; dy: number; dx0: number; dy0: number } | null>(null);
  const [brushDrag, setBrushDrag] = useRafState<{ colId: string; y0: number; y1: number } | null>(null);
  const [labelDrag, setLabelDrag] = useRafState<{ colId: string; x0: number; y0: number; dx: number; dy: number; dx0: number; dy0: number } | null>(null);
  const suppressClick = useRef(false);
  const interactive = !!onParallelEdit && !!pc;
  const toScene = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  /**
   * Interpolate between the axis's own endpoints. Never re-derive "which end is low" from
   * topY/botY here — the builder already decided it (a reversed axis swaps yAtMin/yAtMax), and
   * if these two sides disagree a brush selects the inverse of what was dragged over,
   * on that one axis, with nothing anywhere reporting an error. Reading the endpoints makes
   * the disagreement impossible rather than merely tested-against.
   */
  type PcAxis = { yAtMin: number; yAtMax: number; min: number; max: number };
  const axisValueAt = (ax: PcAxis, yPx: number): number => {
    const span = ax.yAtMax - ax.yAtMin || 1;
    const t = Math.max(0, Math.min(1, (yPx - ax.yAtMin) / span));
    return ax.min + t * (ax.max - ax.min);
  };
  const axisPxAt = (ax: PcAxis, v: number): number =>
    ax.yAtMin + ((v - ax.min) / (ax.max - ax.min || 1)) * (ax.yAtMax - ax.yAtMin);
  const currentBrushes = (): Record<string, [number, number]> => {
    const b: Record<string, [number, number]> = {};
    pc?.axes.forEach((a) => { if (a.brush && a.colId) b[a.colId] = a.brush; });
    return b;
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    figResize.onMove(e);
    if (brushRef.current) { const s = toScene(e.clientX, e.clientY); if (s) { brushRef.current = { ...brushRef.current, y1: s.y }; setBrushDrag(brushRef.current); } }
    else if (labelRef.current) { const s = toScene(e.clientX, e.clientY); if (s) { labelRef.current = { ...labelRef.current, dx: s.x - labelRef.current.x0, dy: s.y - labelRef.current.y0 }; setLabelDrag(labelRef.current); } }
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    figResize.onUp(e);
    const bd = brushRef.current;
    const ld = labelRef.current;
    if (bd && pc && onParallelEdit) {
      const ax = pc.axes.find((a) => a.colId === bd.colId);
      if (ax) {
        const brushes = currentBrushes();
        if (Math.abs(bd.y1 - bd.y0) < 4) delete brushes[bd.colId]; // a click → clear this axis
        else brushes[bd.colId] = [axisValueAt(ax, Math.max(bd.y0, bd.y1)), axisValueAt(ax, Math.min(bd.y0, bd.y1))];
        onParallelEdit({ brushes });
        suppressClick.current = true;
      }
      brushRef.current = null;
      setBrushDrag(null);
    } else if (ld && pc && onParallelEdit) {
      /**
       * Every outcome of this gesture must commit something. With reorder as the only outcome,
       * a drag that did not travel far enough to reach the next axis would fall through and
       * the label snap back, so a label advertising `grab` could be dragged without ever
       * changing the document.
       * Cross an axis → reorder; anything else that moved → nudge the label, which is the
       * same free-drag every other figure's labels have and which the builder already reads
       * back (`pointStyles[colId:colId].valueDx/Dy` → `ParallelAxisScene.labelDx/labelDy`).
       */
      const moved = Math.abs(ld.dx) > 3 || Math.abs(ld.dy) > 3;
      let reordered = false;
      if (Math.abs(ld.dx) > 6) {
        const order = pc.axes.map((a) => a.colId!).filter(Boolean);
        const from = order.indexOf(ld.colId);
        const draggedX = (pc.axes.find((a) => a.colId === ld.colId)?.x ?? 0) + ld.dx;
        let target = 0;
        let best = Infinity;
        pc.axes.forEach((a, i) => { const d = Math.abs(a.x - draggedX); if (d < best) { best = d; target = i; } });
        if (from >= 0 && target !== from) { order.splice(from, 1); order.splice(target, 0, ld.colId); onParallelEdit({ axisOrder: order }); reordered = true; }
        suppressClick.current = true;
      }
      if (!reordered && moved && onMoveValueLabel) {
        // Accumulate onto the stored offset (what DraggableTitle does), so repeated nudges add up.
        onMoveValueLabel(ld.colId, ld.colId, Math.round(ld.dx0 + ld.dx), Math.round(ld.dy0 + ld.dy));
        suppressClick.current = true;
      } else if (!reordered && !moved && onSelect) {
        /**
         * A press-and-release that never moved is a click on the variable name → select that
         * axis, which is where its own tick settings live.
         *
         * Note: it has to happen here, not in an `onClick` on the label. The drag captures the
         * pointer on the SVG (`setPointerCapture`), so the browser retargets the subsequent
         * click to the SVG and the label's own handler never runs — the selection would land
         * on `{kind:"plot"}` instead. `suppressClick` then stops the SVG's click from
         * overwriting the selection just made.
         */
        onSelect({ kind: "parallel-axis", colId: ld.colId });
        suppressClick.current = true;
      }
      labelRef.current = null;
      setLabelDrag(null);
    }
  };
  const linePath = (pts: { x: number; y: number }[]): string => {
    if (pts.length === 0) return "";
    if (!pc?.curved || pts.length < 2) return `M${pts.map((p) => `${p.x},${p.y}`).join("L")}`;
    let d = `M${pts[0]!.x},${pts[0]!.y}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const mx = (a.x + b.x) / 2;
      d += `C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
    }
    return d;
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={figSizeStyle(zoom)}
      role="img"
      aria-label={`Parallel-coordinates plot${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect?.({ kind: "plot" }); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          x={pcTitle.baseX}
          y={8 + scene.fonts.title.size * 0.85}
          anchor={pcTitle.anchor}
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, pcTitle.anchor, true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={scene.width / 2}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        <SubtitleText
          scene={scene}
          baseX={pcTitle.baseX}
          anchor={pcTitle.anchor}
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, pcTitle.anchor, true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {pc && (
        <>
          {/* Data polylines (dimmed if filtered out by a brush). Click one to select that
              row's line and recolour it — pulling a single case out of the bundle. The line
              itself is ~1px, so each gets a fat transparent hit-path on top (the same trick
              the arrow annotations and the network links use). */}
          {pc.lines.map((ln) => {
            const isSel = selected?.kind === "parallel-line" && selected.rowId === ln.id;
            const d = linePath(ln.points);
            // Per-line overrides win over the scene-wide values, so one trace can be pulled
            // out of the bundle by thickness/opacity and not just colour.
            const lw = ln.width ?? pc.lineWidth;
            const lo = ln.opacity ?? pc.lineOpacity;
            const faint = ln.dim ? Math.min(lo, 0.07) : lo;
            return (
              <g key={ln.id} data-line-id={ln.id}>
                {/* selection halo behind the line, so it reads as emphasis not a repaint */}
                {isSel && <path d={d} fill="none" stroke="var(--accent)" strokeWidth={lw + 4} strokeOpacity={0.35} strokeLinejoin="round" pointerEvents="none" />}
                <path d={d} fill="none" stroke={ln.color} strokeWidth={isSel ? lw + 0.8 : lw} strokeOpacity={isSel ? 1 : faint} strokeLinejoin="round" pointerEvents="none" />
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(9, lw + 7)}
                  strokeLinejoin="round"
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  // Each crossing read back off its axis (interpolated between the axis's min and max pixels).
                  {...madyTip(pc.axes.map((ax, ai) => {
                    const p = ln.points[ai];
                    if (!p || ax.yAtMax === ax.yAtMin) return null;
                    return `${ax.label}: ${tipRead(ax.min + ((p.y - ax.yAtMin) / (ax.yAtMax - ax.yAtMin)) * (ax.max - ax.min))}`;
                  }))}
                  onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "parallel-line", rowId: ln.id }); } : undefined}
                />
              </g>
            );
          })}
          {/* vertical axes + ticks + brush selection + variable label */}
          {pc.axes.map((ax) => {
            const dragging = brushDrag?.colId === ax.colId;
            const brushTop = dragging ? Math.min(brushDrag!.y0, brushDrag!.y1) : ax.brush ? axisPxAt(ax, ax.brush[1]) : null;
            const brushBot = dragging ? Math.max(brushDrag!.y0, brushDrag!.y1) : ax.brush ? axisPxAt(ax, ax.brush[0]) : null;
            return (
              <g key={ax.colId ?? ax.label}>
                {/* Selected axis: an accent halo behind the rule, so it reads as emphasis and
                    not as a recoloured axis (the same trick the selected data line uses). */}
                {selected?.kind === "parallel-axis" && selected.colId === ax.colId && (
                  <line x1={ax.x} y1={ax.topY} x2={ax.x} y2={ax.botY} stroke="var(--accent)" strokeWidth={5} strokeOpacity={0.3} pointerEvents="none" />
                )}
                <line x1={ax.x} y1={ax.topY} x2={ax.x} y2={ax.botY} stroke={pc.axisColor ?? "var(--line-2)"} strokeWidth={1} />
                {/* The value-tick ladder. Its labels sit inside the data field — there is no
                    gutter between axes to put them in — so each is knocked out of the lines
                    behind it with a page-colour outline. `paintOrder="stroke"` draws that
                    stroke under the glyph, which is what makes it a halo and not a smear. */}
                {pc.showTicks && ax.ticks.map((t) => (
                  <g key={t.value}>
                    {/* A minor tick is a shorter mark carrying no label — that difference is
                        what makes it read as a subdivision rather than a second scale.
                        Note: not much shorter, and not faded. At half length and 60% opacity they
                        would be 3.5px marks lost in a field of crossing data lines, so switching
                        them on would change nothing visible. Three-quarters length at full
                        strength still reads as subordinate to a major, and remains visible. */}
                    <line
                      x1={ax.x - (t.minor ? pc.tickLen * 0.75 : pc.tickLen)}
                      y1={t.y}
                      x2={ax.x}
                      y2={t.y}
                      stroke={pc.axisColor ?? "var(--line-2)"}
                      strokeWidth={1}
                    />
                    {t.label !== "" && (
                      <text
                        x={ax.x - pc.tickLen - 3}
                        y={t.y + scene.fonts.tick.size * 0.35}
                        textAnchor="end"
                        {...fontAttrs(scene.fonts.tick, "var(--faint)")}
                        paintOrder="stroke"
                        stroke="var(--bg)"
                        strokeWidth={3.2}
                        strokeLinejoin="round"
                        /**
                         * A tick number selects its axis, exactly as on every other chart.
                         *
                         * Without a handler here (none on the text, none on any ancestor), a click
                         * would fall through to the figure background and select the whole graph,
                         * landing on whichever tab was last open. The variable name selects the
                         * axis from the pointer-up path above, but the numbers are the obvious
                         * target for changing a tick interval or a number format.
                         *
                         * Note: `stopPropagation` matters: the SVG's own click clears to `{kind:
                         * "plot"}`, which is precisely the whole-graph selection to avoid.
                         */
                        style={onSelect && ax.colId ? { cursor: "pointer" } : undefined}
                        onClick={onSelect && ax.colId ? (ev) => { ev.stopPropagation(); onSelect({ kind: "parallel-axis", colId: ax.colId! }); } : undefined}
                      >
                        {t.label}
                      </text>
                    )}
                  </g>
                ))}
                {brushTop != null && brushBot != null && brushBot > brushTop && (
                  <rect x={ax.x - 5} y={brushTop} width={10} height={brushBot - brushTop} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeWidth={0.75} pointerEvents="none" />
                )}
                {interactive && ax.colId && (
                  <rect
                    x={ax.x - 7}
                    y={ax.topY}
                    width={14}
                    height={Math.max(1, ax.botY - ax.topY)}
                    fill="transparent"
                    style={{ cursor: "ns-resize" }}
                    onPointerDown={(e) => { e.stopPropagation(); const s = toScene(e.clientX, e.clientY); if (s) { brushRef.current = { colId: ax.colId!, y0: s.y, y1: s.y }; setBrushDrag(brushRef.current); try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* no active pointer */ } } }}
                  />
                )}
                {interactive && ax.colId ? (
                  <text
                    x={ax.labelX}
                    y={ax.labelY}
                    textAnchor="middle"
                    {...fontAttrs(pc.nameFont, "var(--ink)")}
                    // While reorder-dragging → the live horizontal delta; otherwise honour the
                    // label's stored free-drag offset (labelDx/labelDy) so it isn't lost in the
                    // interactive brushing/reorder mode.
                    // The live preview adds the gesture delta on top of the stored offset —
                    // replacing it would make an already-nudged label jump back to its anchor
                    // as soon as it is touched, and would not show vertical travel at all.
                    transform={
                      labelDrag?.colId === ax.colId
                        ? `translate(${labelDrag.dx0 + labelDrag.dx} ${labelDrag.dy0 + labelDrag.dy})`
                        : (ax.labelDx ?? 0) || (ax.labelDy ?? 0)
                          ? `translate(${ax.labelDx ?? 0} ${ax.labelDy ?? 0})`
                          : undefined
                    }
                    opacity={labelDrag?.colId === ax.colId ? 0.7 : undefined}
                    style={{ cursor: "grab" }}
                    onPointerDown={(e) => { e.stopPropagation(); const s = toScene(e.clientX, e.clientY); if (s) { labelRef.current = { colId: ax.colId!, x0: s.x, y0: s.y, dx: 0, dy: 0, dx0: ax.labelDx ?? 0, dy0: ax.labelDy ?? 0 }; setLabelDrag(labelRef.current); try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* no active pointer */ } } }}
                  >
                    {ax.label}
                  </text>
                ) : (
                  <DraggableTitle
                    text={ax.label}
                    x={ax.labelX}
                    y={ax.labelY}
                    anchor="middle"
                    font={pc.nameFont}
                    offset={{ dx: ax.labelDx ?? 0, dy: ax.labelDy ?? 0 }}
                    onMove={onMoveValueLabel && ax.colId ? (dx, dy) => onMoveValueLabel(ax.colId!, ax.colId!, dx, dy) : undefined}
                  />
                )}
              </g>
            );
          })}
        </>
      )}
      {scene.colorbar && (() => {
        const cb = scene.colorbar;
        return (
          // Click → select the bar (the Inspector jumps to its Colour bar section), exactly
          // as the heatmap's does; drag alone would leave its title unreachable.
          <DraggableGroup
            offset={scene.colorbarOffset}
            onMove={onMoveColorbar}
            onSelect={onSelect ? () => onSelect({ kind: "colorbar" }) : undefined}
            title="Drag to move · click to edit the colour scale"
          >
            <g className="gfx-colorbar">
              <defs>
                <linearGradient id="gfx-pc-colorbar-grad" x1="0" y1="1" x2="0" y2="0">
                  {cb.stops.map((s, i) => (
                    <stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} />
                  ))}
                </linearGradient>
              </defs>
              <rect x={cb.bar.x} y={cb.bar.y} width={cb.bar.w} height={cb.bar.h} fill="url(#gfx-pc-colorbar-grad)" stroke="var(--line)" strokeWidth={0.5} />
              <text x={cb.bar.x + cb.bar.w + 4} y={cb.bar.y + scene.fonts.tick.size * 0.75} {...fontAttrs(scene.fonts.tick, "var(--muted)")}>{fmt(cb.max)}</text>
              <text x={cb.bar.x + cb.bar.w + 4} y={cb.bar.y + cb.bar.h - scene.fonts.tick.size * 0.3} {...fontAttrs(scene.fonts.tick, "var(--muted)")}>{fmt(cb.min)}</text>
              {cb.title && (
                <text
                  transform={`translate(${cb.bar.x + cb.bar.w + 34} ${cb.bar.y + cb.bar.h / 2}) rotate(90)`}
                  textAnchor="middle"
                  {...fontAttrs(scene.fonts.legend, "var(--ink)")}
                  opacity={editingText({ kind: "colorbarTitle" }) ? 0 : undefined}
                  style={onEditText ? { cursor: "text" } : undefined}
                  onDoubleClick={onEditText ? (e) => { e.stopPropagation(); beginEdit(e, { kind: "colorbarTitle" }, cb.title ?? "", scene.fonts.legend.size, "middle", false); } : undefined}
                >
                  <RichText text={cb.title} x={0} />
                </text>
              )}
            </g>
          </DraggableGroup>
        );
      })()}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/** Radar / spider chart: concentric rings + spokes (one per row) + a polygon per series. */
function RadarFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveLegend,
  onMoveTitle,
  onMoveSubtitle,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
  onMoveValueLabel,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveLegend?: ((dx: number, dy: number) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
  onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined;
}) {
  const radar = scene.radar;
  /** Click anything in the spider web — a ring, a spoke, a tick, an edge label — and open the
   *  Radar chart section, which owns all of their colour / thickness / dashes / ticks / font. */
  const webPick = onSelect
    ? { style: { cursor: "pointer" }, onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Radar chart" }); } }
    : {};
  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const radarTitle = titlePlacement(scene);
  const figResize = useFigureResize(svgRef, onFigureResize);
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={figSizeStyle(zoom)}
      role="img"
      aria-label={`Radar chart${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => onSelect?.({ kind: "plot" })}
      onPointerMove={figResize.onMove}
      onPointerUp={figResize.onUp}
    >
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          x={radarTitle.baseX}
          y={8 + scene.fonts.title.size * 0.85}
          anchor={radarTitle.anchor}
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, radarTitle.anchor, true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={scene.width / 2}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        <SubtitleText
          scene={scene}
          baseX={radarTitle.baseX}
          anchor={radarTitle.anchor}
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, radarTitle.anchor, true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {radar && (
        <>
          {/* concentric grid rings (polygons through the spokes) + radial tick labels */}
          {radar.rings.map((ring, ri) => {
            const pts = radar.spokes
              .map((sp) => {
                const fx = radar.cx + ((sp.x - radar.cx) * ring.radius) / radar.r;
                const fy = radar.cy + ((sp.y - radar.cy) * ring.radius) / radar.r;
                return `${fx},${fy}`;
              })
              .join(" ");
            return (
              <g key={`ring-${ri}`}>
                <polygon
                  points={pts}
                  fill="none"
                  stroke={radar.gridColor ?? "var(--line)"}
                  strokeWidth={radar.gridWidth ?? 1}
                  strokeDasharray={radar.gridDash ?? undefined}
                  /* Rings, spokes and the edge labels are selectable, opening the side-panel
                     options for colour, thickness, dashes and tick marks; without a handler a
                     click would fall through to the background and select the whole graph.
                     A ring is not an object with a life of its own — they are one family,
                     styled together — so it opens the section that owns them, the same
                     answer a treemap region gets. */
                  {...webPick}
                />

              </g>
            );
          })}
          {/* tick marks on the vertical axis, at each labelled ring */}
          {radar.ticks?.map((t, ti) => (
            <line
              key={`rtick-${ti}`}
              className="radartick"
              x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={radar.tickColor ?? radar.gridColor ?? "var(--line)"}
              strokeWidth={radar.gridWidth ?? 1}
              {...webPick}
            />
          ))}
          {/* spokes + category labels */}
          {radar.spokes.map((sp, si) => (
            <g key={`spoke-${si}`}>
              <line
                x1={radar.cx} y1={radar.cy} x2={sp.x} y2={sp.y}
                stroke={radar.spokeColor ?? "var(--line-2)"}
                strokeWidth={radar.spokeWidth ?? 1}
                strokeDasharray={radar.spokeDash ?? undefined}
                {...webPick}
              />
              {/* Note: the label keeps its own drag + double-click-to-rename; the click that
                  selects is added around it, so styling the labels is reachable without
                  taking away either gesture. */}
              <g {...webPick}>
                <DraggableTitle
                  text={sp.label}
                  x={sp.labelX}
                  y={sp.labelY}
                  anchor={sp.labelAnchor}
                  font={radar.labelFont ?? scene.fonts.tick}
                  offset={{ dx: sp.labelDx ?? 0, dy: sp.labelDy ?? 0 }}
                  onMove={onMoveValueLabel && sp.rowId ? (dx, dy) => onMoveValueLabel(sp.rowId!, sp.rowId!, dx, dy) : undefined}
                  onEdit={onEditText && sp.rowId ? (e) => beginEdit(e, { kind: "radarSpokeLabel", rowId: sp.rowId! }, sp.label, (radar.labelFont ?? scene.fonts.tick).size, sp.labelAnchor, true) : undefined}
                  editing={sp.rowId ? editingText({ kind: "radarSpokeLabel", rowId: sp.rowId }) : false}
                  // Without an onSelect a DraggableTitle with onEdit opens its inline editor on the single click and
                  // stops the click — the section route on the wrapping <g> would never fire, so a click would reach no size.
                  onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Radar chart" }) : undefined}
                />
              </g>
            </g>
          ))}
          {/* spread bands (behind the series): the area between each series' low + high polygon,
              shaded with an even-odd path so the interior fill shows the mean polygon over it. */}
          {radar.errorBands?.map((b) => {
            const ring = (pts: { x: number; y: number }[]): string => "M " + pts.map((p) => `${p.x} ${p.y}`).join(" L ") + " Z";
            return (
              <path
                key={`radarband-${b.id}`}
                d={`${ring(b.hi)} ${ring([...b.lo].reverse())}`}
                fill={b.fill}
                fillOpacity={b.fillOpacity}
                fillRule="evenodd"
                stroke="none"
                pointerEvents="none"
              />
            );
          })}
          {/* one filled polygon per series — outline keeps its own colour/width even
              when selected; selection is a separate dashed accent overlay. */}
          {radar.polygons.map((poly) => {
            const isSel = selected?.kind === "series" && selected.columnId === poly.id;
            // A vertex's distance from the centre, read back through the ring scale (two rings fix it).
            const rings = [...radar.rings].sort((a, b) => a.radius - b.radius);
            const lo = rings[0], hi = rings[rings.length - 1];
            const radarValueAt = (dist: number): number | null => (lo && hi && hi.radius !== lo.radius ? lo.value + ((dist - lo.radius) * (hi.value - lo.value)) / (hi.radius - lo.radius) : null);
            const pts = poly.points.map((p) => `${p.x},${p.y}`).join(" ");
            return (
              <Fragment key={poly.id}>
              <polygon
                points={pts}
                fill={poly.fill}
                fillOpacity={poly.fillOpacity}
                stroke={poly.color}
                strokeWidth={poly.lineWidth ?? 2}
                strokeLinejoin="round"
                style={{ cursor: "pointer" }}
                {...madyTip([poly.name, ...poly.points.map((p, pi) => { const v = radarValueAt(Math.hypot(p.x - radar.cx, p.y - radar.cy)); return v === null ? null : `${radar.spokes[pi]?.label ?? pi + 1}: ${tipRead(v)}`; })])}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.({ kind: "series", columnId: poly.id, part: "points" });
                }}
              />
              {isSel && <polygon points={pts} fill="none" stroke="var(--accent)" strokeWidth={(poly.lineWidth ?? 2) + 1.5} strokeDasharray="4 3" strokeLinejoin="round" pointerEvents="none" />}
              </Fragment>
            );
          })}
          {/* spread whiskers: a radial error bar at each vertex (low→high along the spoke) with
              small perpendicular end caps, in the series colour. Drawn over the polygons. */}
          {radar.errorBars?.map((eb) => (
            <g key={`radarerr-${eb.id}`} pointerEvents="none" stroke={eb.color} strokeWidth={eb.width} strokeLinecap="round">
              {eb.segments.map((s, si) => {
                const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
                const len = Math.hypot(dx, dy) || 1;
                const px = (-dy / len) * 3.5, py = (dx / len) * 3.5; // perpendicular cap
                return (
                  <g key={si}>
                    <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
                    <line x1={s.x1 - px} y1={s.y1 - py} x2={s.x1 + px} y2={s.y1 + py} />
                    <line x1={s.x2 - px} y1={s.y2 - py} x2={s.x2 + px} y2={s.y2 + py} />
                  </g>
                );
              })}
            </g>
          ))}
          {/* The ring numbers are drawn last, on purpose. Inside the ring loop they would sit
              under every series polygon, so a mouse click on "25" would hit the polygon and
              open the Data panel, which has no font control. Drawn here, the click reaches
              `webPick`, which opens the Radar section that owns "Ring value font". Painting
              them above the web also stops a filled series hiding the scale it is measured on.
              Their own <g>, not loose in the chart's: a <g> groups one visual unit — the check
              that every text is draggable credits a text with its siblings' drags on that contract, and loose ring
              numbers next to the draggable spoke labels read as draggable when they are not. */}
          <g>
            {radar.rings.map((ring, ri) => ring.labelled !== false && (
              <text
                key={`ringlab-${ri}`}
                x={radar.cx + 3}
                y={radar.cy - ring.radius + (radar.ringFont ?? scene.fonts.tick).size * 0.34}
                {...fontAttrs(radar.ringFont ?? scene.fonts.tick, "var(--faint)")}
                {...webPick}
              >
                {fmt(ring.value)}
              </text>
            ))}
          </g>
          {/* vertices */}
          {radar.showDots !== false && radar.polygons.map((poly) =>
            poly.points.map((p, pi) => (
              <circle
                key={`${poly.id}-${pi}`}
                cx={p.x}
                cy={p.y}
                r={radar.dotSize ?? 2.5}
                fill={poly.vertexFill ?? poly.color}
                stroke={poly.vertexOutline ?? "none"}
                strokeWidth={poly.vertexOutline ? 1.5 : 0}
                pointerEvents="none"
              />
            )),
          )}
        </>
      )}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/** Isometric 3-D scatter: floor grid + 3 labelled axis edges + painter-sorted points. */
function Scatter3DFigure({
  scene,
  zoom,
  selected,
  onSelect,
  onMoveTitle,
  onMoveSubtitle,
  onMoveAxisTitle,
  onCamera3D,
  onEditText, onMoveAnnotation, onDeleteAnnotation,
  onTextFocus,
  onFigureResize,
}: {
  scene: PlotScene;
  zoom: number;
  selected?: GraphSelection | undefined;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveTitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined;
  onMoveAxisTitle?: ((axis: "x" | "y" | "z", dx: number, dy: number) => void) | undefined;
  onCamera3D?: ((patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string) => void) | undefined;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined;
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined;
}) {
  const s3 = scene.scatter3d;
  const s3col = s3?.seriesId;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const annClientToUser = clientToUserOf(svgRef);
  const figResize = useFigureResize(svgRef, onFigureResize);
  // --- orbit: drag to rotate the camera (azimuth/elevation), scroll to zoom ---
  const gestureRef = useRef(0);
  const dragRef = useRef<{ x0: number; y0: number; az0: number; el0: number; gesture: string } | null>(null);
  const draggedRef = useRef(false);
  const scaleOf = (): number => {
    const w = svgRef.current?.getBoundingClientRect().width;
    const vb = svgRef.current?.viewBox.baseVal.width || 1;
    return w && vb ? w / vb : 1;
  };
  const startOrbit = (e: React.PointerEvent): void => {
    if (!onCamera3D || !s3 || e.button !== 0) return;
    // Don't hijack a drag that started on an editable text element (title etc.).
    if ((e.target as Element).tagName === "text") return;
    e.preventDefault();
    draggedRef.current = false;
    dragRef.current = { x0: e.clientX, y0: e.clientY, az0: s3.cam.az, el0: s3.cam.el, gesture: `rot${++gestureRef.current}` };
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const moveOrbit = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d || !onCamera3D) return;
    const sc = scaleOf() || 1;
    const dx = (e.clientX - d.x0) / sc;
    const dy = (e.clientY - d.y0) / sc;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) draggedRef.current = true;
    // ~0.0095 rad/px ≈ 0.55°/px; drag up tilts the camera up.
    onCamera3D({ azimuth: d.az0 + dx * 0.0095, elevation: d.el0 - dy * 0.0095 }, d.gesture);
  };
  const endOrbit = (e: React.PointerEvent): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* best-effort */ }
  };
  const wheelZoom = (e: React.WheelEvent): void => {
    if (!onCamera3D || !s3) return;
    if (!wheelZoomEnabled) return; // same gate as every other wheel handler — orbit-drag still works
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015); // up = zoom in
    onCamera3D({ zoom: s3.cam.zoom * factor }, "zoom");
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={{ ...figSizeStyle(zoom), ...(onCamera3D ? { cursor: "grab" } : {}), touchAction: "none" }}
      role="img"
      aria-label={`3-D scatter${scene.title ? `: ${scene.title}` : ""}`}
      onPointerDown={startOrbit}
      onPointerMove={(e) => { figResize.onMove(e); moveOrbit(e); }}
      onPointerUp={(e) => { figResize.onUp(e); endOrbit(e); }}
      onWheel={onCamera3D ? wheelZoom : undefined}
      onClick={() => { if (draggedRef.current) { draggedRef.current = false; return; } onSelect?.({ kind: "plot" }); }}
    >
      <FigureBackdrop scene={scene} />
      {scene.title && (
        <DraggableTitle
          text={scene.title}
          /* Left-aligned: a centred title collides with the top isometric axis label. */
          x={10}
          y={8 + scene.fonts.title.size * 0.85}
          anchor="start"
          font={scene.fonts.title}
          offset={scene.titleOffset}
          onMove={onMoveTitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, "start", true) : undefined}
          editing={editingText({ kind: "title" })}
          centerX={10}
          guideTop={2}
          guideBottom={scene.plot.y}
        />
      )}
      {scene.subtitle && (
        // Left-anchored at a fixed x (this figure's heading is not centre-aligned). It still
        // tracks the title's drag and takes its own offset on top.
        <SubtitleText
          scene={scene}
          baseX={10}
          anchor="start"
          onMove={onMoveSubtitle}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, "start", true) : undefined}
          editing={editingText({ kind: "subtitle" })}
        />
      )}
      {s3 && (() => {
        /**
         * Clicking an axis or the floor grid opens the controls that edit them.
         *
         * Note: X/Y/Z titles, axis colour, axis thickness, Floor grid on/off and Grid colour
         * all live in the **3-D scatter** section. This figure has no Axis rail tab (`hasAxes`
         * excludes it, because its axes are a projection, not editable AxisSpecs), so without
         * this handler clicking an axis would select the whole plot and land in the
         * graph-title fields.
         *
         * It selects a `chart-section`, the same selection a volcano legend row uses to open the
         * section that owns its colours, so no Axis tab is shown with controls that do not apply
         * to a projected axis.
         */
        const openControls = onSelect
          ? (e: React.MouseEvent): void => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } onSelect({ kind: "chart-section", title: "3-D scatter" }); }
          : undefined;
        /**
         * Each cube edge is a real axis (range/scale/ticks on `plot.zAxis` and the standard
         * x/y specs), so clicking one selects that axis and lights the Axis tab —
         * the same contract as every 2-D chart. The floor grid keeps opening the 3-D section,
         * which is where its colour/on-off live.
         */
        const pickAxis = (ai: number) => (onSelect
          ? (e: React.MouseEvent): void => {
              e.stopPropagation();
              if (draggedRef.current) { draggedRef.current = false; return; }
              onSelect({ kind: "axis", axis: (["x", "y", "z"] as const)[ai] ?? "x" });
            }
          : undefined);
        // Pressing an axis/tick element clears the orbit's `draggedRef` so the click that
        // follows always selects the axis (→ opens the Axis tab). Without this, the first click on
        // an axis right after an orbit-drag would be swallowed by the stale flag, and the Axis tab
        // would not open. stopPropagation keeps the press off the <svg> orbit handler.
        const grab = onSelect ? { onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); draggedRef.current = false; }, style: { cursor: "pointer" as const } } : {};
        return (
        <>
          {s3.showGrid !== false && s3.floor.map((l, i) => (
            <line key={`fl-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={s3.gridColor ?? "var(--line)"} strokeWidth={1}
              strokeLinecap="round" onClick={openControls} {...grab} />
          ))}
          {s3.axes.map((a, i) => a.hidden ? null : (
            <g key={`ax-${i}`}>
              <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color ?? s3.axisColor} strokeWidth={a.width ?? s3.axisWidth}
                onClick={pickAxis(i)} {...grab} />
              {(() => {
                // Each axis label (X/Y/Z, in build order) is double-click editable: X/Y route
                // to their axis-spec title, Z to scatter3d.zTitle.
                //
                // They are also draggable, like all text on a figure. The offset is applied
                // after projection, so a drag
                // survives an orbit instead of fighting it: the label keeps its nudge relative
                // to wherever its axis end has swung to.
                const target: TextTarget = i === 0 ? { kind: "axisTitle", axis: "x" } : i === 1 ? { kind: "axisTitle", axis: "y" } : { kind: "scatter3dZTitle" };
                const axisOf = (["x", "y", "z"] as const)[i] ?? "z";
                const off = s3.labelOffsets?.[i] ?? { dx: 0, dy: 0 };
                return (
                  <DraggableTitle
                    text={a.label}
                    x={a.lx}
                    y={a.ly}
                    anchor="middle"
                    font={a.titleSize ? { ...scene.fonts.axisTitle, size: a.titleSize } : scene.fonts.axisTitle}
                    offset={off}
                    onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle(axisOf, dx, dy) : undefined}
                    // A click (not a drag) selects this axis — same target as its line/ticks.
                    onSelect={onSelect ? () => onSelect({ kind: "axis", axis: axisOf }) : undefined}
                    onEdit={onEditText ? (e) => { e.stopPropagation(); beginEdit(e, target, a.label, scene.fonts.axisTitle.size, "middle", true); } : undefined}
                    editing={editingText(target)}
                  />
                );
              })()}
            </g>
          ))}
          {s3.points.map((p, i) => (
            <circle
              key={`p-${p.rowId}-${i}`}
              cx={p.x}
              cy={p.y}
              r={p.r}
              fill={p.overrideFill ?? s3.marker.fill}
              fillOpacity={s3.marker.opacity}
              /* Depth cue: a per-point opacity factor fades the whole dot (fill + stroke) toward
                 the back of the cloud. Absent (undefined) when depth shading is off. */
              {...(p.alpha != null ? { opacity: p.alpha } : {})}
              stroke={p.overrideFill ? "var(--bg)" : s3.marker.stroke}
              strokeWidth={s3.marker.width}
              style={onSelect ? { cursor: "pointer" } : undefined}
              {...(p.value ? madyTip([`${s3.axes[0]?.label || "X"}: ${tipNum(p.value.x)}`, `${s3.axes[1]?.label || "Y"}: ${tipNum(p.value.y)}`, `${s3.axes[2]?.label || "Z"}: ${tipNum(p.value.z)}`]) : {})}
              /**
               * A click on a point must not start an orbit. `startOrbit` is on the <svg>, and
               * 3px of movement sets `draggedRef` — so an ordinary click, which often jitters a
               * pixel or two, would be read as a camera drag and the selection below dropped
               * (a click with 3px or 8px of travel would select nothing).
               *
               * Stopping the event here means the orbit never begins on a point, so the click is
               * a click. Dragging the background still orbits, which is what that gesture is for.
               */
              onPointerDown={onSelect && s3col ? (e) => e.stopPropagation() : undefined}
              onClick={onSelect && s3col ? (e) => { e.stopPropagation(); if (draggedRef.current) { draggedRef.current = false; return; } onSelect({ kind: "series", columnId: s3col, rowId: p.rowId, part: "points" }); } : undefined}
            />
          ))}
          {/* The scale paints above the cloud. Drawn with the edges, under the points, a data
              point sitting on a number would swallow its click and open the point's panel,
              where nothing sizes the text. The positions come from the builder (outward is
              recomputed per rebuild so the ladder survives an orbit); one <g> per axis keeps
              the rule that a group is one draggable unit. */}
          {s3.axes.map((a, i) => a.hidden ? null : (
            <g key={`axtk-${i}`}>
              {(a.ticks ?? []).map((t, ti) => (
                <g key={`tk-${i}-${ti}`}>
                  <line x1={t.tx1} y1={t.ty1} x2={t.tx2} y2={t.ty2} stroke={a.color ?? s3.axisColor} strokeWidth={a.width ?? s3.axisWidth} onClick={pickAxis(i)} {...grab} />
                  {t.label && (
                    <text x={t.lx} y={t.ly} textAnchor="middle" {...fontAttrs(a.tickFont ?? scene.fonts.tick, "var(--muted)")} onClick={pickAxis(i)} {...grab}>
                      {t.label}
                    </text>
                  )}
                </g>
              ))}
            </g>
          ))}
        </>
        );
      })()}
      {/* Annotations. Fractional positions over this figure's plot rect — see
          `FractionalAnnotations`. Drawn last so a label sits above the marks. */}
      <FractionalAnnotations
        scene={scene}
        selected={selected}
        accent="var(--accent)"
        onSelect={onSelect}
        onMoveAnnotation={onMoveAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        clientToUser={annClientToUser}
        beginEdit={beginEdit}
        editingText={editingText}
        onEditText={onEditText}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/**
 * Shared annotation overlay for the bespoke figures (lollipop, paired dot and others) — renders
 * reference lines / brackets / text / shaded bands / shape annotations from
 * `scene.annotations`, each selectable, pointer-draggable, inline-editable and
 * removable via an on-canvas × handle. The main figure body keeps its own richer
 * inline copy (band edge-resize + keyboard nudge + right-click menu); this covers
 * the core add/move/edit/delete experience so a bespoke figure's annotations are
 * live, not inert. `patch` maps a dragged pixel back to the annotation's data
 * value (built by the caller from its own axis scenes).
 */
export function AnnotationsLayer({
  annotations,
  selected,
  plot,
  legendFont,
  accent,
  onSelect,
  onMoveAnnotation,
  onDeleteAnnotation,
  clientToUser,
  patch,
  valueOnX,
  beginEdit,
  editingText,
  onEditText,
  anchorAxes,
}: {
  annotations: AnnotationScene[];
  selected?: GraphSelection | undefined;
  plot: { x: number; y: number; width: number; height: number };
  /** The figure's axes, when it has any: a drag of a point pinned to data values is turned into values
   *  through them (`toAnchoredPatch`), as on the main figure. Absent (the figure canvas) = no pinned points. */
  anchorAxes?: Pick<PlotScene, "x" | "y"> | undefined;
  legendFont: number;
  accent: string;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  clientToUser: (cx: number, cy: number) => { x: number; y: number } | null;
  patch: (
    a: AnnotationScene,
    ux: number,
    uy: number,
    start?: { ux0: number; uy0: number; shift0: number } | undefined,
  ) => AnnotationMovePatch;
  /** Which visual axis carries values on this bespoke figure — the other one is the
   *  category axis a bracket slides along. */
  valueOnX?: boolean | undefined;
  beginEdit: (e: React.MouseEvent, target: TextTarget, value: string, size: number, anchor: "start" | "middle" | "end", multiline?: boolean) => void;
  editingText: (target: TextTarget) => boolean;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
}): ReactNode {
  // Where the pointer went down + the lateral shift the bracket already carried, so a
  // sideways bracket drag is a delta here too (the bespoke figures share this layer).
  // `lx0`/`ly0`: a text's point at pointer-down, moved by the pointer's travel (no jump when its words sit away from it).
  const dragRef = useRef<{ id: string; ux0: number; uy0: number; shift0: number; lx0?: number | undefined; ly0?: number | undefined } | null>(null);
  const moveOne = (a: AnnotationScene, p: AnnotationMovePatch): void => {
    onMoveAnnotation?.(a.id, anchorAxes ? toAnchoredPatch(a, p, { plot, x: anchorAxes.x, y: anchorAxes.y }) : p);
  };
  const dragMove = (a: AnnotationScene) => (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d?.id !== a.id || !onMoveAnnotation) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const ux = d.lx0 != null ? d.lx0 + (u.x - d.ux0) : u.x;
    const uy = d.ly0 != null ? d.ly0 + (u.y - d.uy0) : u.y;
    moveOne(a, patch(a, ux, uy, d));
  };
  // No pointer capture on press. A captured press sends the next click / double-click to the capturing
  // group, never to the `<text>` under it, so a text here (heatmap-style charts, every text object on the figure
  // canvas) could not be double-clicked to edit in a browser. The drag follows the pointer through window listeners
  // instead (as the legend does). Guarded by annotation-layer-dblclick.test.tsx.
  const dragDown = (a: AnnotationScene) => (e: React.PointerEvent) => {
    if (!onMoveAnnotation) return;
    e.stopPropagation();
    const d = clientToUser(e.clientX, e.clientY);
    const extent = valueOnX ? plot.height : plot.width;
    dragRef.current = { id: a.id, ux0: d?.x ?? 0, uy0: d?.y ?? 0, shift0: extent ? (a.shift ?? 0) / extent : 0, ...(a.kind === "text" ? { lx0: a.labelX, ly0: a.labelY } : {}) };
    onSelect?.({ kind: "annotation", id: a.id });
    const move = dragMove(a);
    const onWinMove = (ev: PointerEvent): void => move(ev as unknown as React.PointerEvent);
    const onWinUp = (): void => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
    };
    window.addEventListener("pointermove", onWinMove);
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
  };
  return (
    <>
      {/* Shaded bands, behind the reference lines/text (translucent → data shows through). */}
      {annotations.filter((a) => a.kind === "band").map((a) => {
        const sel = selected?.kind === "annotation" && selected.id === a.id;
        return (
          <rect
            key={`band-${a.id}`}
            x={a.x1} y={a.y1}
            width={(a.x2 ?? 0) - (a.x1 ?? 0)} height={(a.y2 ?? 0) - (a.y1 ?? 0)}
            fill={a.fill ?? "#888888"} fillOpacity={a.fillOpacity ?? 0.14}
            stroke={sel ? accent : a.color ?? "none"} strokeWidth={sel ? 1.5 : a.color ? a.width || 1 : 0}
            style={{ cursor: onMoveAnnotation ? "move" : "pointer" }}
            onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "annotation", id: a.id }); }}
            onPointerDown={dragDown(a)}
          />
        );
      })}
      {annotations.map((a) => {
        const annSel = selected?.kind === "annotation" && selected.id === a.id;
        if (a.kind === "band") {
          return a.label ? (
            <text
              key={`bandlbl-${a.id}`}
              data-ann-text={a.id}
              x={a.labelX} y={a.labelY}
              textAnchor={a.labelAnchor ?? "middle"}
              fontSize={a.fontSize ?? legendFont}
              fill={annSel ? accent : a.color ?? "var(--muted)"}
              opacity={editingText({ kind: "annotation", id: a.id }) ? 0 : undefined}
              style={onEditText ? { cursor: "text" } : undefined}
              onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "annotation", id: a.id }); }}
              onDoubleClick={(e) => beginEdit(e, { kind: "annotation", id: a.id }, a.label ?? "", a.fontSize ?? legendFont, "middle", true)}
            >
              <RichText text={a.label} x={a.labelX} />
            </text>
          ) : null;
        }
        if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image" || a.kind === "arrow" || a.kind === "segment" || a.kind === "callout") {
          return (
            <ShapeAnnotation
              key={a.id}
              a={a}
              selected={annSel}
              accent={accent}
              plot={plot}
              legendFont={legendFont}
              clientToUser={clientToUser}
              onSelect={onSelect}
              onMove={onMoveAnnotation ? (p) => moveOne(a, p) : undefined}
              onDelete={onDeleteAnnotation ? () => onDeleteAnnotation(a.id) : undefined}
            />
          );
        }
        return (
          <g
            key={a.id}
            // No text selection and no native text drag from a press here (the main figure's rule): without pointer
            // capture, a drag that starts on the words would otherwise select the page's text as it goes.
            style={{ cursor: onMoveAnnotation ? "move" : "pointer", userSelect: "none" }}
            onDragStart={(e) => e.preventDefault()}
            onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "annotation", id: a.id }); }}
            onPointerDown={dragDown(a)}
          >
            {a.kind === "line" && (
              <>
                <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={12} />
                <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={annSel ? accent : a.color ?? "var(--ink)"} strokeWidth={a.width + (annSel ? 1 : 0)} {...(a.dash ? { strokeDasharray: a.dash } : {})} />
              </>
            )}
            {a.kind === "bracket" && a.path && (
              <>
                <path d={a.path} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={a.path}
                  fill="none"
                  stroke={annSel ? accent : a.color ?? "var(--ink)"}
                  strokeWidth={a.width + (annSel ? 1 : 0)}
                  {...(a.round ? { strokeLinecap: "round" as const, strokeLinejoin: "round" as const } : {})}
                />
              </>
            )}
            {a.label && (
              // A caption moved off its line (`labelOffset`) is drawn where it was moved, here as in the main figure.
              <g {...(a.labelOffset && (a.labelOffset.dx || a.labelOffset.dy) ? { transform: `translate(${a.labelOffset.dx} ${a.labelOffset.dy})` } : {})}>
              {a.textBox?.box && <TextBoxRect box={a.textBox.box} rotate={a.rotation ? `rotate(${a.rotation} ${a.labelX} ${a.labelY})` : undefined} />}
              <text
                data-ann-text={a.id}
                x={a.textBox?.x ?? a.labelX} y={a.labelY}
                textAnchor={a.textBox?.anchor ?? a.labelAnchor ?? "start"}
                fontSize={a.fontSize ?? legendFont}
                {...(a.fontFamily ? { fontFamily: a.fontFamily } : {})}
                {...(a.italic ? { fontStyle: "italic" as const } : {})}
                fill={annSel ? accent : a.labelColor ?? a.color ?? "var(--ink)"}
                fontWeight={a.bold ? 700 : annSel ? 600 : undefined}
                opacity={editingText({ kind: "annotation", id: a.id }) ? 0 : undefined}
                {...(a.rotation ? { transform: `rotate(${a.rotation} ${a.labelX} ${a.labelY})` } : {})}
                style={onEditText ? { cursor: "text" } : undefined}
                onDoubleClick={(e) => beginEdit(e, { kind: "annotation", id: a.id }, a.label ?? "", a.fontSize ?? legendFont, a.labelAnchor ?? "start", true)}
              >
                <RichText text={a.textBox ? a.textBox.lines.join("\n") : a.label} x={a.textBox?.x ?? a.labelX} />
              </text>
              </g>
            )}
            {annSel && onDeleteAnnotation && (() => {
              const fs = a.fontSize ?? legendFont;
              const hasLabel = Boolean(a.label);
              const spot = hasLabel ? labelDeleteSpot(a, fs) : { cx: ((a.x1 ?? 0) + (a.x2 ?? 0)) / 2, cy: ((a.y1 ?? 0) + (a.y2 ?? 0)) / 2 - 12 };
              return <DeleteHandle cx={spot.cx} cy={spot.cy} onDelete={() => onDeleteAnnotation(a.id)} />;
            })()}
          </g>
        );
      })}
    </>
  );
}

/**
 * Screen point → this figure's SVG user coordinates.
 *
 * Note: `typeof` rather than a plain call: jsdom's SVG element has no `getScreenCTM` at all, so
 * invoking it would throw before the null-check could bow out — and only once a pointer-down
 * reads coordinates, so it would look like a drag bug rather than a missing API.
 */
export function clientToUserOf(
  svgRef: React.RefObject<SVGSVGElement | null>,
): (clientX: number, clientY: number) => { x: number; y: number } | null {
  return (clientX, clientY) => {
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
}

/**
 * The annotation overlay for the axis-less figures — heatmap · corr-matrix · alluvial · radar ·
 * parallel · pie · treemap · 3-D scatter.
 *
 * Their builders resolve annotations through `fractionalAnnotations`, so every position is a
 * fraction of the plot rect and the drag maths is identical on all eight. That is why this exists
 * once instead of eight times, and why `AnnotationsLayer` is given a `patch` that knows nothing
 * about axes: there are none to invert through.
 *
 * Every one of these figures must mount this component: a kind that resolves annotations into
 * `scene.annotations` without rendering them would silently lose every label the user places.
 * Shapes (rect / ellipse / image / arrow / segment / callout) carry their own move+resize inside
 * `ShapeAnnotation`, so `patch` only has to answer for text and bands.
 */
function FractionalAnnotations({
  scene, selected, accent, onSelect, onMoveAnnotation, onDeleteAnnotation, clientToUser,
  beginEdit, editingText, onEditText,
}: {
  scene: PlotScene;
  selected?: GraphSelection | undefined;
  accent: string;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveAnnotation?: ((id: string, patch: AnnotationMovePatch) => void) | undefined;
  onDeleteAnnotation?: ((id: string) => void) | undefined;
  clientToUser: (cx: number, cy: number) => { x: number; y: number } | null;
  beginEdit: (e: React.MouseEvent, target: TextTarget, value: string, size: number, anchor: "start" | "middle" | "end", multiline?: boolean) => void;
  editingText: (target: TextTarget) => boolean;
  onEditText?: ((target: TextTarget, value: string) => void) | undefined;
}): ReactNode {
  if (!scene.annotations.length) return null;
  const p = scene.plot;
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const patch = (a: AnnotationScene, ux: number, uy: number): AnnotationMovePatch => {
    const fx = clamp01((ux - p.x) / (p.width || 1));
    const fy = clamp01((uy - p.y) / (p.height || 1));
    // A band spanning the full height is vertical, so it slides in X only (and vice versa) —
    // the same test the main figure uses, read off the resolved geometry rather than a flag.
    if (a.kind === "band") {
      const fullHeight = Math.abs(((a.y2 ?? 0) - (a.y1 ?? 0)) - p.height) < 1;
      return fullHeight ? { x: fx } : { y: fy };
    }
    return { x: fx, y: fy };
  };
  return (
    <AnnotationsLayer
      anchorAxes={scene}
      annotations={scene.annotations}
      selected={selected}
      plot={p}
      legendFont={scene.fonts.legend.size}
      accent={accent}
      onSelect={onSelect}
      onMoveAnnotation={onMoveAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      clientToUser={clientToUser}
      patch={patch}
      beginEdit={beginEdit}
      editingText={editingText}
      onEditText={onEditText}
    />
  );
}

/**
 * Category groups (Axis tab ▸ Category groups): the faint block tint behind each group's
 * categories. Purely visual; a group's selectable surface is its name.
 *
 * Shared by every figure that draws a category axis, including the lollipop and paired dot
 * figures, which draw their own axes. `category-groups-drawn.test.tsx` renders every card and
 * reads the groups back, guarding against a figure that resolves groups but never draws them.
 */
function CategoryGroupTints({ scene }: { scene: PlotScene }) {
  return (
    <>
      {scene.categoryGroups?.map((g, i) => g.tint && (
        <rect
          key={`cgtint-${i}`}
          x={g.tint.x}
          y={g.tint.y}
          width={Math.max(0, g.tint.w)}
          height={Math.max(0, g.tint.h)}
          fill={g.color}
          fillOpacity={g.tint.opacity}
          pointerEvents="none"
        />
      ))}
    </>
  );
}

/**
 * Category groups: the dashed rule between adjacent groups (read over the data as structure, thin
 * and dashed) and each group's name. The name is draggable, and clicking it selects the axis that
 * owns the grouping. Its text is never edited on canvas: it is a column value (renamed in the
 * datasheet) or, with Group by ▸ By hand, typed in the Axis tab's boxes. Shared — see above.
 */
function CategoryGroupMarks({ scene, onSelect, onMoveCategoryGroupName }: {
  scene: PlotScene;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveCategoryGroupName?: ((axis: "x" | "y", group: string, dx: number, dy: number) => void) | undefined;
}) {
  return (
    <>
      {scene.categoryGroups?.map((g, i) => g.separator && (
        <line
          key={`cgsep-${i}`}
          x1={g.separator.x1}
          y1={g.separator.y1}
          x2={g.separator.x2}
          y2={g.separator.y2}
          stroke={g.color}
          strokeWidth={1}
          strokeOpacity={0.55}
          {...(g.separator.dash ? { strokeDasharray: g.separator.dash } : {})}
          pointerEvents="none"
        />
      ))}
      {scene.categoryGroups?.map((g, i) => g.name && (
        <DraggableTitle
          key={`cgname-${i}`}
          text={g.label}
          x={g.name.x}
          y={g.name.y}
          anchor="middle"
          rotate={g.name.angle || undefined}
          font={scene.fonts.legend}
          color={g.color}
          weight={600}
          offset={g.name.dx != null || g.name.dy != null ? { dx: g.name.dx ?? 0, dy: g.name.dy ?? 0 } : undefined}
          onMove={onMoveCategoryGroupName ? (dx, dy) => onMoveCategoryGroupName(g.axis, g.label, dx, dy) : undefined}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: g.axis }) : undefined}
        />
      ))}
    </>
  );
}

/**
 * The second value axis's ticks, numbers and title - down the right edge, or along the top on a horizontal chart
 * (`side: "top"`). One renderer for every figure that draws one: the main figure and the lollipop figure,
 * which draws its own axes and would otherwise have no second axis. The axis line stays with each
 * figure's frame.
 */
function SecondValueAxis({ scene, select, onSelect, onMoveAxisTitle, canEdit, beginEdit, editingText, selected, onRotateAxisTitle }: {
  scene: PlotScene;
  selected?: GraphSelection | undefined;
  onRotateAxisTitle?: RotateAxisTitle;
  /** Select from a click (each figure's own handler: stop the click, then select). */
  select: (sel: GraphSelection, e: React.MouseEvent) => void;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onMoveAxisTitle?: ((axis: "y2", dx: number, dy: number) => void) | undefined;
  canEdit: boolean;
  beginEdit: (e: React.MouseEvent, target: TextTarget, value: string, size: number, anchor: "start" | "middle" | "end", multiline?: boolean) => void;
  editingText: (t: TextTarget) => boolean;
}) {
  const { tickDir, tickLen } = scene.axisStyle;
  const { x: px, y: py, width: pw, height: ph } = scene.plot;
  const y2TickFont = scene.fonts.y2Tick.size;
  if (!scene.y2) return null;
  return (
    <>
    {/* y2 ticks + labels + axis title along the top edge — the second value axis of a horizontal
        bar chart, whose values run left to right (`side: "top"`). Mirrors the
        bottom X axis: ticks point up out of the plot, numbers above them, the title above those. */}
    {scene.y2 && scene.y2.side === "top" && (
      <g {...fontAttrs(scene.fonts.y2Tick, "var(--muted)")}>
        {scene.y2.ticks.map((t) => {
          const topLen = scene.y2!.tickLen ?? tickLen;
          const len = (t.minor ? topLen * 0.6 : topLen) + (scene.y2!.lineWidth ?? 1.25) / 2;
          const out = tickDir === "out" || tickDir === "both" ? len : 0; // out = away (upwards)
          const into = tickDir === "in" || tickDir === "both" ? len : 0;
          return (
            <g key={`tx2-${t.value}`}>
              {tickDir !== "none" && !scene.y2!.hideTicks && (
                <line x1={t.pos} x2={t.pos} y1={py + into} y2={py - out} stroke={scene.y2!.lineColor ?? "var(--line-2)"} strokeWidth={scene.y2!.tickWidth ?? scene.y2!.lineWidth ?? 1.25} />
              )}
              {!t.minor && t.label && (() => {
                const rot = scene.y2!.tickRotation ?? 0;
                // Above the axis however it turns — the placement the layout made room for.
                const lbl = xTickLabelPlacement(t.pos, py - out, y2TickFont, scene.axisGaps?.xTick ?? 6, rot, 0, "top");
                return (
                <text
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.anchor}
                  {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})}
                  {...(t.color ? { fill: t.color } : {})}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...numbersAttr("y2", scene.y2)}
                  {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y2", focus: tickFocus(scene.y2) }, e) } : {})}
                >
                  <RichText text={t.label} />
                </text>
                );
              })()}
            </g>
          );
        })}
        {/* Every text on the figure drags and edits in place, the Y2 title (along the top on a horizontal
            chart) included. Its offset rides on the data axis (plot.y2Axis.titleOffset).
            Guard: second-axis-title-drag.test.tsx. */}
        {scene.y2.title && (
          <DraggableTitle
            text={scene.y2.title}
            x={scene.y2.titleCenter ?? px + pw / 2}
            y={scene.y2.titlePos ?? py - 30}
            anchor="middle"
            font={scene.fonts.y2AxisTitle ?? scene.fonts.xAxisTitle}
            offset={scene.y2.titleOffset}
            onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y2", dx, dy) : undefined}
            onEdit={canEdit ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y2" }, scene.y2!.title ?? "", (scene.fonts.y2AxisTitle ?? scene.fonts.xAxisTitle).size, "middle", true) : undefined}
            editing={editingText({ kind: "axisTitle", axis: "y2" })}
            onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y2" }) : undefined}
            centerX={px + pw / 2}
            guideTop={py}
            guideBottom={py + ph}
          />
        )}
      </g>
    )}

    {/* y2 ticks + labels (right side) + axis title */}
    {scene.y2 && scene.y2.side !== "top" && (
      <g {...fontAttrs(scene.fonts.y2Tick, "var(--muted)")}>
        {scene.y2.ticks.map((t) => {
          const y2len = scene.y2!.tickLen ?? tickLen;
          const len = (t.minor ? y2len * 0.6 : y2len) + (scene.y2!.lineWidth ?? 1.25) / 2;
          const out = tickDir === "out" || tickDir === "both" ? len : 0; // out = away (to the right)
          const into = tickDir === "in" || tickDir === "both" ? len : 0;
          return (
            <g key={`ty2-${t.value}`}>
              {tickDir !== "none" && !scene.y2!.hideTicks && (
                <line x1={px + pw - into} x2={px + pw + out} y1={t.pos} y2={t.pos} stroke={scene.y2!.lineColor ?? "var(--line-2)"} strokeWidth={scene.y2!.tickWidth ?? scene.y2!.lineWidth ?? 1.25} />
              )}
              {!t.minor && (() => {
                const rot = scene.y2!.tickRotation ?? 0;
                // Right of the axis however it turns — the placement the layout made room for.
                const lbl = yTickLabelPlacement(t.pos, px + pw, y2TickFont, scene.axisGaps?.yTick ?? 8, rot, 0, "right");
                return (
                <text
                  x={lbl.x}
                  y={lbl.y}
                  textAnchor={lbl.anchor}
                  {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})}
                  style={onSelect ? { cursor: "pointer" } : undefined}
                  {...numbersAttr("y2", scene.y2)}
                  {...(onSelect ? { onClick: (e: React.MouseEvent) => select({ kind: "axis", axis: "y2", focus: tickFocus(scene.y2) }, e) } : {})}
                >
                  <RichText text={t.label} />
                </text>
                );
              })()}
            </g>
          );
        })}
        {/* Every text on the figure can be dragged, the Y2 title down the right included. */}
        {scene.y2.title && (
          <DraggableTitle
            {...verticalTitle(scene.y2, scene.y2.titleX ?? scene.width - 7, py + ph / 2, 270)}
            rotateGrip={titleGrip(selected, "y2", scene.y2, 270, onRotateAxisTitle, scene)}
            font={scene.fonts.y2AxisTitle ?? scene.fonts.yAxisTitle}
            offset={scene.y2.titleOffset}
            onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y2", dx, dy) : undefined}
            onEdit={canEdit ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y2" }, scene.y2!.title ?? "", (scene.fonts.y2AxisTitle ?? scene.fonts.yAxisTitle).size, "middle", true) : undefined}
            editing={editingText({ kind: "axisTitle", axis: "y2" })}
            onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y2" }) : undefined}
            centerY={py + ph / 2}
            guideLeft={px}
            guideRight={px + pw}
          />
        )}
      </g>
    )}
    </>
  );
}

/** Lollipop / dumbbell — category rows with a stem + value dot(s), an optional
 *  index reference line, bold value labels and a green Δ% at the value end. Draws
 *  its own continuous value axis + category band axis (its own SVG shell). */
function LollipopFigure(props: Parameters<typeof LollipopFigureContent>[0]) {
  if (!props.scene.lollipop) return null;
  return <LollipopFigureContent {...props} />;
}

function LollipopFigureContent({ scene, zoom, selected, onRotateAxisTitle, onSelect, onViewChange, onResetView, onAxisResize, onMoveLegend, onMoveSignificanceCaption, onMoveTitle, onMoveSubtitle, onMoveAxisTitle, onMoveValueLabel, onEditText, onTextFocus, onMoveAnnotation, onDeleteAnnotation, onFigureResize, onMoveCategoryGroupName }: { scene: PlotScene; onRotateAxisTitle?: RotateAxisTitle; onMoveCategoryGroupName?: ((axis: "x" | "y", group: string, dx: number, dy: number) => void) | undefined; onViewChange?: ((view: GraphView) => void) | undefined; onResetView?: (() => void) | undefined; zoom: number; selected?: GraphSelection; onSelect?: ((s: GraphSelection) => void) | undefined; onAxisResize?: ((axis: "x" | "y", lengthPx: number) => void) | undefined; onMoveLegend?: ((dx: number, dy: number) => void) | undefined; onMoveSignificanceCaption?: ((dx: number, dy: number) => void) | undefined; onMoveTitle?: ((dx: number, dy: number) => void) | undefined; onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined; onMoveAxisTitle?: ((axis: "x" | "y" | "z" | "y2", dx: number, dy: number) => void) | undefined; onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined; onEditText?: ((target: TextTarget, value: string) => void) | undefined; onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined; onMoveAnnotation?: ((id: string, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number }) => void) | undefined; onDeleteAnnotation?: ((id: string) => void) | undefined; onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined }) {
  const lp = scene.lollipop!;
  /** The category names and the value numbers carry their own axis fonts. Drawing both
   *  from the shared `scene.fonts.tick` would leave "Category label font → Size" and "Tick
   *  label font → Size" without effect on this kind. `xTick`/`yTick` fall back to the shared
   *  font, so an untouched figure draws with the shared tick font. */
  const valFont = lp.horizontal ? scene.fonts.xTick : scene.fonts.yTick;
  const catFont = lp.horizontal ? scene.fonts.yTick : scene.fonts.xTick;
  const tick = valFont.size;
  const catTick = catFont.size;
  // Fixed dot→label gap. Deliberately not tied to lp.dotSize: anchoring the value
  // label to the dot size would make the "Dot size" slider reflow every label (labels
  // sliding up as dots grow), coupling the two controls. A constant keeps the label
  // put; the user positions it by dragging (valueDx/valueDy). 9 = the default dotSize
  // 5 + 4, so the default look has the same gap.
  const DOT_LABEL_GAP = 9;
  // Y-title baseline x, derived from its font size so big titles don't clip.
  const yTitleX = scene.y.titlePos ?? Math.max(14, Math.round(scene.fonts.yAxisTitle.size * 1.08));
  const px0 = scene.plot.x;
  const py0 = scene.plot.y;
  const pw0 = scene.plot.width;
  const ph0 = scene.plot.height;
  const frame = scene.axisStyle.frame;
  const valAxis = lp.horizontal ? scene.x : scene.y; // continuous value axis
  const accent = "var(--accent)";
  const selX = selected?.kind === "axis" && selected.axis === "x";
  const selY = selected?.kind === "axis" && selected.axis === "y";
  const selY2 = selected?.kind === "axis" && selected.axis === "y2";
  // Click an axis (line, tick-gutter or labels) to open its panel — mirrors the
  // main figure so the value/category axes are editable here too. stopPropagation
  // keeps the svg-root "select plot" handler from also firing.
  const selectAxis = (axis: "x" | "y", focus?: "labels" | "numbers") => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(focus ? { kind: "axis", axis, focus } : { kind: "axis", axis });
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts, y2OnTop: scene.y2?.side === "top" });
  const { viewProps } = useWheelZoom(svgRef, scene, onViewChange, onResetView);
  const figResize = useFigureResize(svgRef, onFigureResize); // whole-figure resize grips
  // Note: keyboard delete / duplicate / nudge for a selected annotation is handled by the
  // parent PlotFigure's window keydown effect (its hooks run before it early-returns this
  // bespoke figure), so there's no second listener here — it would double-fire.
  // --- axis-length drag (drag the selected axis end to set the plot width/height) ---
  const axisResizeRef = useRef<{ axis: "x" | "y"; start: number; origLen: number } | null>(null);
  const draggedRef = useRef(false); // a drag just ended → swallow the click that would deselect
  const clientToUser = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const startAxisResize = (e: React.PointerEvent, axis: "x" | "y"): void => {
    e.stopPropagation();
    e.preventDefault();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    axisResizeRef.current = { axis, start: axis === "x" ? u.x : u.y, origLen: axis === "x" ? pw0 : ph0 };
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
  };
  const onAxisPointerMove = (e: React.PointerEvent): void => {
    const ar = axisResizeRef.current;
    if (!ar) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    draggedRef.current = true;
    const cur = ar.axis === "x" ? u.x : u.y;
    onAxisResize?.(ar.axis, Math.max(40, Math.round(ar.origLen + (cur - ar.start))));
  };
  const onAxisPointerUp = (e: React.PointerEvent): void => {
    if (!axisResizeRef.current) return;
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* best-effort */
    }
    axisResizeRef.current = null;
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={{ ...figSizeStyle(zoom), ...viewProps.style }}
      onDoubleClick={viewProps.onDoubleClick}
      role="img"
      aria-label={`Lollipop chart${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => {
        if (draggedRef.current) { draggedRef.current = false; return; } // ignore the click that ends an axis-resize drag
        onSelect?.({ kind: "plot" });
      }}
      // Composed, never spread. This <svg> declares its own pointer handlers, so a
      // `{...viewProps}` spread above them would be silently overridden — the pan would
      // exist and never fire. The same trap the `figResize` note below names.
      onPointerDown={(e) => { draggedRef.current = false; viewProps.onPointerDown(e); }}
      // `figResize` first, and never drop it: this figure draws FigureResizeHandles, and
      // wiring only the axis handlers would let the grip start a drag that can never commit.
      // Both no-op unless their own gesture is active, so composing is safe.
      onPointerMove={(e) => { figResize.onMove(e); onAxisPointerMove(e); viewProps.onPointerMove(e); }}
      onPointerUp={(e) => { figResize.onUp(e); onAxisPointerUp(e); viewProps.onPointerUp(); }}
    >
      <FigureBackdrop scene={scene} />
      <AxisBands scene={scene} />
      {scene.title && (() => {
        // Honour titleAlign (the Editorial preset is left-aligned, flush with the
        // plot area), the same as the main figure path.
        const align = scene.titleAlign ?? "center";
        const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const tx = align === "left" ? px0 : align === "right" ? px0 + pw0 : scene.width / 2;
        return (
          <DraggableTitle
            text={scene.title}
            x={tx}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, anchor, true) : undefined}
            editing={editingText({ kind: "title" })}
            centerX={scene.width / 2}
            guideTop={2}
            guideBottom={py0}
          />
        );
      })()}
      {scene.subtitle && (() => {
        const align = scene.titleAlign ?? "center";
        const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const tx = align === "left" ? px0 : align === "right" ? px0 + pw0 : scene.width / 2;
        return (
          <SubtitleText
            scene={scene}
            baseX={tx}
            anchor={anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, anchor, true) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        );
      })()}
      {/* gridlines along the value axis */}
      {scene.grid.show && (
        <g className="gfx-grid">
          {valAxis.ticks.filter((t) => scene.grid.minor || !t.minor).map((t) => (
            lp.horizontal ? (
              <line key={`g-${t.value}`} x1={t.pos} x2={t.pos} y1={py0} y2={py0 + ph0} stroke={scene.grid.color ?? "var(--line)"} strokeWidth={scene.grid.width} strokeDasharray={scene.grid.dash ?? undefined} opacity={t.minor ? 0.5 : 1} />
            ) : (
              <line key={`g-${t.value}`} x1={px0} x2={px0 + pw0} y1={t.pos} y2={t.pos} stroke={scene.grid.color ?? "var(--line)"} strokeWidth={scene.grid.width} strokeDasharray={scene.grid.dash ?? undefined} opacity={t.minor ? 0.5 : 1} />
            )
          ))}
        </g>
      )}
      {/* category-group block tint (Axis tab ▸ Category groups) — behind the stems and dots */}
      <CategoryGroupTints scene={scene} />
      {/* index / baseline reference line (single-series). Clickable → the lollipop controls (its
          "Baseline / index" value + stem look live in the Chart type section); a line with no
          click route reads as "not editable". */}
      {lp.baseline && (
        <line x1={lp.baseline.x1} y1={lp.baseline.y1} x2={lp.baseline.x2} y2={lp.baseline.y2} stroke="var(--line-2)" strokeWidth={1.25} strokeDasharray="4 3"
          style={onSelect ? { cursor: "pointer" } : undefined}
          onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Chart type" }); } : undefined} />
      )}
      {/* Stems first — drawn before the frame so a stem that starts at the baseline (which sits
          on the value axis, e.g. baseline 0) is behind the axis line, never on top of it. The
          dots + labels are drawn later (after the axes) so they always stay on top. Each stem is
          clickable → the Stem controls (the paireddot-stem precedent). */}
      <g>
        {lp.rows.map((r) => (
          <line key={`stem-${r.rowId}`} x1={r.stem.x1} y1={r.stem.y1} x2={r.stem.x2} y2={r.stem.y2} stroke={r.stemColor ?? lp.stemColor ?? "var(--line-2)"} strokeWidth={lp.stemWidth} strokeLinecap="round"
            style={onSelect ? { cursor: "pointer" } : undefined}
            onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Chart type" }); } : undefined} />
        ))}
      </g>
      {/* frame — the bottom (X) and left (Y) lines are clickable to select that axis.
          `strokeLinecap="square"` closes the thick-axis corner (see the XY figure). */}
      {frame !== "none" && (
        <g>
          <line
            x1={frame === "offset" ? px0 + 8 : px0}
            x2={px0 + pw0}
            y1={py0 + ph0}
            y2={py0 + ph0}
            stroke={selX ? accent : scene.x.lineColor ?? "var(--line-2)"}
            strokeWidth={selX ? 2.5 : scene.x.lineWidth ?? 1.25}
            strokeLinecap="square"
            style={onSelect ? { cursor: "pointer" } : undefined}
            {...(onSelect ? { onClick: selectAxis("x") } : {})}
          />
          <line
            x1={px0}
            x2={px0}
            y1={py0}
            y2={frame === "offset" ? py0 + ph0 - 8 : py0 + ph0}
            stroke={selY ? accent : scene.y.lineColor ?? "var(--line-2)"}
            strokeWidth={selY ? 2.5 : scene.y.lineWidth ?? 1.25}
            strokeLinecap="square"
            style={onSelect ? { cursor: "pointer" } : undefined}
            {...(onSelect ? { onClick: selectAxis("y") } : {})}
          />
          {frame === "box" && (
            <>
              <line x1={px0} x2={px0 + pw0} y1={py0} y2={py0} stroke={scene.x.lineColor ?? "var(--line-2)"} strokeWidth={scene.x.lineWidth ?? 1.25} strokeLinecap="square" />
              <line x1={px0 + pw0} x2={px0 + pw0} y1={py0} y2={py0 + ph0} stroke={scene.y.lineColor ?? "var(--line-2)"} strokeWidth={scene.y.lineWidth ?? 1.25} strokeLinecap="square" />
            </>
          )}
        </g>
      )}
      {/* axis hit areas (tick-label gutters) — selectable even when the frame is hidden */}
      {onSelect && (
        <g>
          <rect x={px0} y={py0 + ph0} width={pw0} height={26} fill="transparent" style={{ cursor: "pointer" }} onClick={selectAxis("x")} />
          <rect x={Math.max(0, px0 - 46)} y={py0} width={46} height={ph0} fill="transparent" style={{ cursor: "pointer" }} onClick={selectAxis("y")} />
        </g>
      )}
      {/* value-axis ticks + labels — family/weight/italic follow the matchable tick font */}
      <g {...fontAttrs(valFont, "var(--muted)")}>
        {lp.horizontal
          ? valAxis.ticks.filter((t) => !t.minor && t.label).map((t) => {
              // Axis tab ▸ Label rotation — placed as the builder made room for it (`xTickLabelPlacement`).
              const rot = valAxis.tickRotation ?? 0;
              const lbl = xTickLabelPlacement(t.pos, py0 + ph0, tick, scene.axisGaps?.xTick ?? 6, rot);
              return (
              <g key={`vt-${t.value}`}>
                <TickMark side="bottom" pos={t.pos} edge={py0 + ph0} ax={valAxis} style={scene.axisStyle} kind="value" />
                <text x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...numbersAttr("x", valAxis)} {...(onSelect ? { onClick: selectAxis("x", tickFocus(valAxis)) } : {})}>{t.label}</text>
              </g>
              );
            })
          : valAxis.ticks.filter((t) => !t.minor).map((t) => (
              <g key={`vt-${t.value}`}>
                <TickMark side="left" pos={t.pos} edge={px0} ax={valAxis} style={scene.axisStyle} kind="value" />
                {(() => {
                  // A vertical lollipop's numbers run up Y: Label rotation turns them like any Y axis.
                  const rot = scene.y.tickRotation ?? 0;
                  const lbl = yTickLabelPlacement(t.pos, px0, tick, scene.axisGaps?.yTick ?? 8, rot);
                  return <text x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...numbersAttr("y", valAxis)} {...(onSelect ? { onClick: selectAxis("y", tickFocus(valAxis)) } : {})}>{t.label}</text>;
                })()}
              </g>
            ))}
      </g>
      {/* The second value axis: its line here, its ticks, numbers and title from the shared
          renderer - down the right on a vertical lollipop, along the top on a horizontal one. */}
      {scene.y2 && (
        <line
          x1={scene.y2.side === "top" ? px0 : px0 + pw0}
          x2={px0 + pw0}
          y1={py0}
          y2={scene.y2.side === "top" ? py0 : py0 + ph0}
          stroke={selY2 ? accent : scene.y2.lineColor ?? "var(--line-2)"}
          strokeWidth={selY2 ? 2.5 : scene.y2.lineWidth ?? 1.25}
          strokeLinecap="square"
          style={onSelect ? { cursor: "pointer" } : undefined}
          {...(onSelect ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect({ kind: "axis", axis: "y2" }); } } : {})}
        />
      )}
      <SecondValueAxis scene={scene} select={(sel, e) => { e.stopPropagation(); onSelect?.(sel); }} onSelect={onSelect} onMoveAxisTitle={onMoveAxisTitle} canEdit={!!onEditText} beginEdit={beginEdit} editingText={editingText} selected={selected} onRotateAxisTitle={onRotateAxisTitle} />
      {/* category tick marks — one per row, by the chart's Tick direction, like every other axis. */}
      {lp.rows.map((r) => (lp.horizontal
        ? <TickMark key={`ct-${r.rowId}`} side="left" pos={r.stem.y1} edge={px0} ax={scene.y} style={scene.axisStyle} kind="category" />
        : <TickMark key={`ct-${r.rowId}`} side="bottom" pos={r.stem.x1} edge={py0 + ph0} ax={scene.x} style={scene.axisStyle} kind="category" />))}
      {/* category labels (band axis) — family/weight/italic follow the matchable tick font; a
          grouped category takes its group's colour (Category groups ▸ Colour labels) */}
      {(() => {
        // Rows and band ticks are built from the same rows in the same order, so row i takes tick
        // i's group colour — by position, never by label text, which a narrow figure may shorten.
        const catTicks = (lp.horizontal ? scene.y : scene.x).ticks;
        return (
          <g {...fontAttrs(catFont, "var(--muted)")}>
            {lp.rows.map((r, i) => {
              const fill = catTicks[i]?.color;
              return lp.horizontal ? (
                (() => {
                  // A horizontal lollipop's names run down Y: Label rotation turns them like any category axis.
                  const rot = scene.y.tickRotation ?? 0;
                  const lbl = yTickLabelPlacement(r.stem.y1, px0, catTick, scene.axisGaps?.yTick ?? 8, rot);
                  return <text key={`cl-${r.rowId}`} x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} {...(fill ? { fill } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...(onSelect ? { onClick: selectAxis("y", "labels") } : {})}>{r.label}</text>;
                })()
              ) : (() => {
                // A name the builder thinned (it would land on its neighbour) is not drawn - the box chart's rule.
                if (catTicks[i] && catTicks[i]!.label === "" && catTicks[i]!.suppressedLabel) return null;
                // A vertical lollipop's names run along X: Label rotation turns them like any category axis.
                const rot = scene.x.tickRotation ?? 0;
                const lbl = xTickLabelPlacement(r.stem.x1, py0 + ph0, catTick, scene.axisGaps?.xTick ?? 6, rot);
                return (
                <text key={`cl-${r.rowId}`} x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} {...(fill ? { fill } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...(onSelect ? { onClick: selectAxis("x", "labels") } : {})}>{r.label}</text>
                );
              })();
            })}
          </g>
        );
      })()}
      {/* category-group dividing lines + names (Axis tab ▸ Category groups) */}
      <CategoryGroupMarks scene={scene} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName} />
      {/* dots + value/Δ labels (stems were drawn earlier, behind the axes) */}
      {lp.rows.map((r) => {
        const sel = selected?.kind === "series" && r.dots.some((d) => d.id === selected.columnId);
        return (
          <g key={`row-${r.rowId}`}>
            {r.dots.map((d, di) => (
              Number.isFinite(d.value) && (
                <g key={`dot-${r.rowId}-${di}`}>
                  {/* Mean±error whisker along the value axis, drawn behind the dot so the dot
                      caps it. Honours direction (both/above/below), caps and cap width. Absent
                      unless the series opted in to an error type (default "none" on this kind). */}
                  {d.error && (() => {
                    const e = d.error;
                    const cap = e.caps ? e.capWidth : 0;
                    const centerPx = lp.horizontal ? d.cx : d.cy;
                    const a = e.dir === "up" ? centerPx : e.lowPx; // span start (value-low end, or the dot for "above only")
                    const b = e.dir === "down" ? centerPx : e.highPx; // span end (value-high end, or the dot for "below only")
                    const capLow = e.dir !== "up"; // no low cap when only the upper half is drawn
                    const capHigh = e.dir !== "down";
                    return lp.horizontal ? (
                      <g pointerEvents="none">
                        <line x1={a} y1={d.cy} x2={b} y2={d.cy} stroke={e.color} strokeWidth={e.width} />
                        {cap > 0 && capLow && <line x1={e.lowPx} y1={d.cy - cap} x2={e.lowPx} y2={d.cy + cap} stroke={e.color} strokeWidth={e.width} />}
                        {cap > 0 && capHigh && <line x1={e.highPx} y1={d.cy - cap} x2={e.highPx} y2={d.cy + cap} stroke={e.color} strokeWidth={e.width} />}
                      </g>
                    ) : (
                      <g pointerEvents="none">
                        <line x1={d.cx} y1={a} x2={d.cx} y2={b} stroke={e.color} strokeWidth={e.width} />
                        {cap > 0 && capLow && <line x1={d.cx - cap} y1={e.lowPx} x2={d.cx + cap} y2={e.lowPx} stroke={e.color} strokeWidth={e.width} />}
                        {cap > 0 && capHigh && <line x1={d.cx - cap} y1={e.highPx} x2={d.cx + cap} y2={e.highPx} stroke={e.color} strokeWidth={e.width} />}
                      </g>
                    );
                  })()}
                  {/* Dot rendered through the shared Marker so per-point / per-series
                      overrides (shape · size · fill · opacity · outline) all apply;
                      undefined fields fall back to the lollipop default look. */}
                  <Marker
                    shape={d.symbol ?? "circle"}
                    cx={d.cx}
                    cy={d.cy}
                    size={d.size ?? lp.dotSize}
                    color={d.color}
                    fill={d.symbolFill ?? "solid"}
                    fillColor={d.symbolFillColor}
                    opacity={d.symbolOpacity ?? 1}
                    outline={d.symbolOutline ?? "var(--bg)"}
                    borderWidth={d.borderWidth ?? 1.5}
                  />
                  {/* Selection highlight = an accent ring drawn around the dot, not a size
                      bump. Growing the dot on select would make it look as if moving the
                      value label changed the dot size: the label sits over the dot's hit
                      target, so grabbing it can select the dot. A ring marks the selection
                      without ever touching the dot's rendered size. */}
                  {sel && (
                    <circle cx={d.cx} cy={d.cy} r={(d.size ?? lp.dotSize) + 3.5} fill="none" stroke="var(--accent)" strokeWidth={1.5} pointerEvents="none" />
                  )}
                  {/* Transparent hit target (the Marker itself is pointer-events:none). */}
                  <circle
                    cx={d.cx}
                    cy={d.cy}
                    r={Math.max(9, (d.size ?? lp.dotSize) + 4)}
                    fill="transparent"
                    {...madyTip([r.label, legendNameOf(scene, d.id), tipNum(d.value), d.error ? `[${tipNum(d.error.low)}, ${tipNum(d.error.high)}]` : null])}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "series", columnId: d.id, part: "points", rowId: r.rowId }); }}
                  />
                  {d.label && (
                    onMoveValueLabel ? (
                      <DraggableTitle
                        text={d.label}
                        x={lp.horizontal ? d.cx : d.cx + DOT_LABEL_GAP}
                        y={lp.horizontal ? d.cy - DOT_LABEL_GAP : d.cy + tick * 0.34}
                        anchor={lp.horizontal ? "middle" : "start"}
                        font={scene.fonts.valueLabel}
                        offset={{ dx: d.valueDx ?? 0, dy: d.valueDy ?? 0 }}
                        onMove={(dx, dy) => onMoveValueLabel(d.id, r.rowId, dx, dy)}
                        onEdit={onEditText ? (e) => beginEdit(e, { kind: "value", columnId: d.id, rowId: r.rowId }, d.label ?? "", scene.fonts.valueLabel.size, lp.horizontal ? "middle" : "start", false) : undefined}
                      />
                    ) : (
                      <text
                        x={(lp.horizontal ? d.cx : d.cx + DOT_LABEL_GAP) + (d.valueDx ?? 0)}
                        y={(lp.horizontal ? d.cy - DOT_LABEL_GAP : d.cy + tick * 0.34) + (d.valueDy ?? 0)}
                        textAnchor={lp.horizontal ? "middle" : "start"}
                        {...fontAttrs(scene.fonts.valueLabel, "var(--ink)")}
                        pointerEvents="none"
                      >
                        {d.label}
                      </text>
                    )
                  )}
                </g>
              )
            ))}
            {r.delta && (
              onMoveValueLabel ? (
                <DraggableTitle
                  text={r.delta.text}
                  x={r.delta.x}
                  y={r.delta.y}
                  anchor={r.delta.anchor}
                  font={scene.fonts.valueLabel}
                  color={r.delta.color}
                  offset={{ dx: r.delta.dx ?? 0, dy: r.delta.dy ?? 0 }}
                  onMove={(dx, dy) => onMoveValueLabel("__delta__", r.rowId, dx, dy)}
                  // The Δ label is draggable and editable, like the dot labels right above
                  // it. The edit rides the same per-point override (keyed "__delta__:<row>"),
                  // so it is the same call — blank restores the computed Δ%.
                  onEdit={onEditText ? (e) => beginEdit(e, { kind: "value", columnId: "__delta__", rowId: r.rowId }, r.delta!.text, scene.fonts.valueLabel.size, r.delta!.anchor, false) : undefined}
                />
              ) : (
                <text x={r.delta.x + (r.delta.dx ?? 0)} y={r.delta.y + (r.delta.dy ?? 0)} textAnchor={r.delta.anchor} {...fontAttrs(scene.fonts.valueLabel, r.delta.color)} pointerEvents="none">
                  {r.delta.text}
                </text>
              )
            )}
          </g>
        );
      })}
      {/* axis titles — draggable + double-click to edit */}
      {scene.x.title && (
        <DraggableTitle
          text={scene.x.title}
          x={px0 + pw0 / 2}
          y={scene.height - 7}
          anchor="middle"
          font={scene.fonts.xAxisTitle}
          offset={scene.x.titleOffset}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("x", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "x" }, scene.x.title ?? "", scene.fonts.xAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "x" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "x" }) : undefined}
          centerX={px0 + pw0 / 2}
          guideTop={py0}
          guideBottom={py0 + ph0}
        />
      )}
      {scene.y.title && (
        <DraggableTitle
          {...verticalTitle(scene.y, yTitleX, scene.y.titleCenter ?? py0 + ph0 / 2, 90)}
          font={scene.y.titleFont ? { ...scene.fonts.yAxisTitle, size: scene.y.titleFont } : scene.fonts.yAxisTitle}
          offset={scene.y.titleOffset}
          rotateGrip={titleGrip(selected, "y", scene.y, 90, onRotateAxisTitle, scene)}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y" }, scene.y.title ?? "", scene.fonts.yAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "y" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y" }) : undefined}
          centerY={py0 + ph0 / 2}
          guideLeft={px0}
          guideRight={px0 + pw0}
        />
      )}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}

      {/* Annotations (Annotate tab) — reference lines / text / bands / brackets, live
          on the lollipop too.
          `patch` inverts the value axis (X when horizontal, Y when vertical) so a
          dragged reference line / bracket reports its new data value. */}
      {scene.annotations.length > 0 && (() => {
        const inv = (ax: { domain: [number, number]; range: [number, number] }, px: number): number => {
          const [d0, d1] = ax.domain;
          const [p0, p1] = ax.range;
          return p1 === p0 ? d0 : d0 + ((px - p0) * (d1 - d0)) / (p1 - p0);
        };
        const patch = (
          a: AnnotationScene,
          ux: number,
          uy: number,
          start?: { ux0: number; uy0: number; shift0: number } | undefined,
        ): AnnotationMovePatch => {
          if (a.kind === "text") return { x: Math.max(0, Math.min(1, (ux - px0) / pw0)), y: Math.max(0, Math.min(1, (uy - py0) / ph0)) };
          if (a.kind === "bracket") {
            const value = lp.horizontal ? inv(scene.x, ux) : inv(scene.y, uy);
            if (!start) return { bracketY: value };
            // The category axis is whichever one is not carrying values.
            const extent = lp.horizontal ? ph0 : pw0;
            const moved = lp.horizontal ? uy - start.uy0 : ux - start.ux0;
            const raw = start.shift0 + (extent ? moved / extent : 0);
            return { bracketY: value, bracketShift: Math.abs(raw * extent) < BRACKET_SNAP_PX ? 0 : raw };
          }
          const vertical = Math.abs((a.x1 ?? 0) - (a.x2 ?? 0)) < 0.5;
          return { value: vertical ? inv(scene.x, ux) : inv(scene.y, uy) };
        };
        return (
          <AnnotationsLayer
            anchorAxes={scene}
            annotations={scene.annotations}
            selected={selected}
            plot={{ x: px0, y: py0, width: pw0, height: ph0 }}
            legendFont={scene.fonts.legend.size}
            accent={accent}
            onSelect={onSelect}
            onMoveAnnotation={onMoveAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            clientToUser={clientToUser}
            patch={patch}
            valueOnX={lp.horizontal}
            beginEdit={beginEdit}
            editingText={editingText}
            onEditText={onEditText}
          />
        );
      })()}

      {/* axis-length drag — when an axis is selected, grab the whole axis line and
          drag along it to set the plot width (X) / height (Y). Mirrors the main figure. */}
      {onAxisResize && selX && (
        <g style={{ cursor: "ew-resize" }} onPointerDown={(e) => startAxisResize(e, "x")}>
          <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
          <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px0 + pw0} cy={py0 + ph0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the X-axis length</title>
        </g>
      )}
      {onAxisResize && selY && (
        <g style={{ cursor: "ns-resize" }} onPointerDown={(e) => startAxisResize(e, "y")}>
          <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
          <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px0} cy={py0 + ph0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the Y-axis length (drag down to lengthen)</title>
        </g>
      )}
      {/* significance threshold key — buildPlotScene reserves the band for every kind,
          so a bespoke figure that draws brackets must draw the key too, or turning the
          legend on here adds blank paper and nothing else. */}
      <SignificanceKey
        scene={scene}
        footerBandH={scene.footer ? Math.round(scene.fonts.legend.size * 0.9) + 12 : 0}
        onMove={onMoveSignificanceCaption}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/** Paired / grouped Cleveland dot plot — horizontal category rows, one marker per
 *  numeric series; a `toZero` stem to each dot (double lollipop) or a dumbbell
 *  connector; optional dashed section dividers with a rotated section label on the
 *  right. Draws its own continuous value (X) axis + category band (Y) axis. */
function PairedDotFigure(props: Parameters<typeof PairedDotFigureContent>[0]) {
  if (!props.scene.paireddot) return null;
  return <PairedDotFigureContent {...props} />;
}

function PairedDotFigureContent({ scene, zoom, selected, onRotateAxisTitle, onSelect, onViewChange, onResetView, onAxisResize, onMoveLegend, onMoveSignificanceCaption, onMoveTitle, onMoveSubtitle, onMoveAxisTitle, onMoveValueLabel, onMoveSectionLabel, onEditText, onTextFocus, onMoveAnnotation, onDeleteAnnotation, onFigureResize, onMoveCategoryGroupName }: { scene: PlotScene; onRotateAxisTitle?: RotateAxisTitle; onMoveCategoryGroupName?: ((axis: "x" | "y", group: string, dx: number, dy: number) => void) | undefined; onViewChange?: ((view: GraphView) => void) | undefined; onResetView?: (() => void) | undefined; zoom: number; selected?: GraphSelection; onSelect?: ((s: GraphSelection) => void) | undefined; onAxisResize?: ((axis: "x" | "y", lengthPx: number) => void) | undefined; onMoveLegend?: ((dx: number, dy: number) => void) | undefined; onMoveSignificanceCaption?: ((dx: number, dy: number) => void) | undefined; onMoveTitle?: ((dx: number, dy: number) => void) | undefined; onMoveSubtitle?: ((dx: number, dy: number) => void) | undefined; onMoveAxisTitle?: ((axis: "x" | "y" | "z", dx: number, dy: number) => void) | undefined; onMoveValueLabel?: ((columnId: string, rowId: string, dx: number, dy: number) => void) | undefined; onMoveSectionLabel?: ((section: string, dx: number, dy: number) => void) | undefined; onEditText?: ((target: TextTarget, value: string) => void) | undefined; onTextFocus?: ((role: "title" | "subtitle" | "axisTitle") => void) | undefined; onMoveAnnotation?: ((id: string, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number }) => void) | undefined; onDeleteAnnotation?: ((id: string) => void) | undefined; onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined }) {
  const pd = scene.paireddot!;
  const tick = scene.fonts.tick.size;
  const DOT_LABEL_GAP = 9;
  const yTitleX = scene.y.titlePos ?? Math.max(14, Math.round(scene.fonts.yAxisTitle.size * 1.08));
  const px0 = scene.plot.x;
  const py0 = scene.plot.y;
  const pw0 = scene.plot.width;
  const ph0 = scene.plot.height;
  const frame = scene.axisStyle.frame;
  const valAxis = scene.x; // continuous value axis (horizontal — value on X)
  const accent = "var(--accent)";
  const sectionColor = pd.sectionColor ?? "var(--muted)";
  const selX = selected?.kind === "axis" && selected.axis === "x";
  const selY = selected?.kind === "axis" && selected.axis === "y";
  const selectAxis = (axis: "x" | "y", focus?: "labels" | "numbers") => (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(focus ? { kind: "axis", axis, focus } : { kind: "axis", axis });
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const { beginEdit, editingText, overlay } = useInlineTextEditor({ onEditText, wrapRef, svgRef, sceneWidth: scene.width, zoom, onTextFocus, fonts: scene.fonts });
  const { viewProps } = useWheelZoom(svgRef, scene, onViewChange, onResetView);
  const figResize = useFigureResize(svgRef, onFigureResize);
  const axisResizeRef = useRef<{ axis: "x" | "y"; start: number; origLen: number } | null>(null);
  const draggedRef = useRef(false);
  const clientToUser = (clientX: number, clientY: number): { x: number; y: number } | null => {
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const startAxisResize = (e: React.PointerEvent, axis: "x" | "y"): void => {
    e.stopPropagation();
    e.preventDefault();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    axisResizeRef.current = { axis, start: axis === "x" ? u.x : u.y, origLen: axis === "x" ? pw0 : ph0 };
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* best-effort */ }
  };
  const onAxisPointerMove = (e: React.PointerEvent): void => {
    const ar = axisResizeRef.current;
    if (!ar) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    draggedRef.current = true;
    const cur = ar.axis === "x" ? u.x : u.y;
    onAxisResize?.(ar.axis, Math.max(40, Math.round(ar.origLen + (cur - ar.start))));
  };
  const onAxisPointerUp = (e: React.PointerEvent): void => {
    if (!axisResizeRef.current) return;
    try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* best-effort */ }
    axisResizeRef.current = null;
  };
  return (
    <div ref={wrapRef} style={figWrapStyle(zoom)}>
    <svg
      ref={svgRef}
      className="gfx-figure"
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      width={scene.width * zoom}
      height={scene.height * zoom}
      style={{ ...figSizeStyle(zoom), ...viewProps.style }}
      onDoubleClick={viewProps.onDoubleClick}
      role="img"
      aria-label={`Paired dot plot${scene.title ? `: ${scene.title}` : ""}`}
      onClick={() => {
        if (draggedRef.current) { draggedRef.current = false; return; }
        onSelect?.({ kind: "plot" });
      }}
      // Composed, never spread. This <svg> declares its own pointer handlers, so a
      // `{...viewProps}` spread above them would be silently overridden — the pan would
      // exist and never fire. The same trap the `figResize` note below names.
      onPointerDown={(e) => { draggedRef.current = false; viewProps.onPointerDown(e); }}
      // See the lollipop figure: the resize grip needs `figResize.onMove` here to commit.
      onPointerMove={(e) => { figResize.onMove(e); onAxisPointerMove(e); viewProps.onPointerMove(e); }}
      onPointerUp={(e) => { figResize.onUp(e); onAxisPointerUp(e); viewProps.onPointerUp(); }}
    >
      <FigureBackdrop scene={scene} />
      <AxisBands scene={scene} />
      {scene.title && (() => {
        const align = scene.titleAlign ?? "center";
        const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const tx = align === "left" ? px0 : align === "right" ? px0 + pw0 : scene.width / 2;
        return (
          <DraggableTitle
            text={scene.title}
            x={tx}
            y={8 + scene.fonts.title.size * 0.85}
            anchor={anchor}
            font={scene.fonts.title}
            offset={scene.titleOffset}
            onMove={onMoveTitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "title" }, scene.title ?? "", scene.fonts.title.size, anchor, true) : undefined}
            editing={editingText({ kind: "title" })}
            centerX={scene.width / 2}
            guideTop={2}
            guideBottom={py0}
          />
        );
      })()}
      {scene.subtitle && (() => {
        const align = scene.titleAlign ?? "center";
        const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
        const tx = align === "left" ? px0 : align === "right" ? px0 + pw0 : scene.width / 2;
        return (
          <SubtitleText
            scene={scene}
            baseX={tx}
            anchor={anchor}
            onMove={onMoveSubtitle}
            onEdit={onEditText ? (e) => beginEdit(e, { kind: "subtitle" }, scene.subtitle!, scene.fonts.subtitle.size, anchor, true) : undefined}
            editing={editingText({ kind: "subtitle" })}
          />
        );
      })()}
      {/* gridlines along the value axis */}
      {scene.grid.show && (
        <g className="gfx-grid">
          {valAxis.ticks.filter((t) => scene.grid.minor || !t.minor).map((t) => (
            <line key={`g-${t.value}`} x1={t.pos} x2={t.pos} y1={py0} y2={py0 + ph0} stroke={scene.grid.color ?? "var(--line)"} strokeWidth={scene.grid.width} strokeDasharray={scene.grid.dash ?? undefined} opacity={t.minor ? 0.5 : 1} />
          ))}
        </g>
      )}
      {/* category-group block tint (Axis tab ▸ Category groups) — behind the dividers and marks */}
      <CategoryGroupTints scene={scene} />
      {/* Section dividers — drawn behind the marks. They are this chart's reference line —
          one style for all of them, and a click opens the reference-line panel. The invisible
          fat line is the hit target: a 1px dashed rule is close to unclickable at any zoom. */}
      {pd.sections.map((s, si) => s.divider && (
        <g key={`sd-${si}`} style={onSelect ? { cursor: "pointer" } : undefined}
          onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "refline", id: "pd-section" }); } : undefined}>
          {onSelect && (
            <line x1={s.divider.x1} y1={s.divider.y1} x2={s.divider.x2} y2={s.divider.y2} stroke="transparent" strokeWidth={Math.max(8, pd.sectionWidth + 6)} />
          )}
          <line x1={s.divider.x1} y1={s.divider.y1} x2={s.divider.x2} y2={s.divider.y2} stroke={sectionColor} strokeWidth={pd.sectionWidth} strokeDasharray={pd.sectionDash ?? undefined} opacity={0.8} pointerEvents="none" />
        </g>
      ))}
      {/* stems (toZero) + dumbbell connectors — behind the frame so a stem starting at
          the baseline sits under the axis line. Dots/labels draw after the axes.
          Clickable: their Stem width / Stem colour controls live under Chart → Chart type,
          and a line with no click route reads as "not editable". Each visible line gets a
          fat transparent hit twin, like the divider's. */}
      <g
        style={onSelect ? { cursor: "pointer" } : undefined}
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect({ kind: "chart-section", title: "Chart type" }); } : undefined}
      >
        {pd.rows.map((r) => (
          <g key={`stem-${r.rowId}`}>
            {r.marks.map((mk, mi) => mk.stem && (
              <g key={`st-${mi}`}>
                {onSelect && (
                  <line x1={mk.stem.x1} y1={mk.stem.y1} x2={mk.stem.x2} y2={mk.stem.y2} stroke="transparent" strokeWidth={Math.max(8, pd.stemWidth + 6)} />
                )}
                <line x1={mk.stem.x1} y1={mk.stem.y1} x2={mk.stem.x2} y2={mk.stem.y2} stroke={pd.stemColor ?? mk.color} strokeWidth={pd.stemWidth} strokeLinecap="round" />
              </g>
            ))}
            {r.connector && (
              <g>
                {onSelect && (
                  <line x1={r.connector.x1} y1={r.connector.y1} x2={r.connector.x2} y2={r.connector.y2} stroke="transparent" strokeWidth={Math.max(8, pd.stemWidth + 6)} />
                )}
                <line x1={r.connector.x1} y1={r.connector.y1} x2={r.connector.x2} y2={r.connector.y2} stroke={r.connector.color} strokeWidth={pd.stemWidth} strokeLinecap="round" />
              </g>
            )}
          </g>
        ))}
      </g>
      {/* frame — bottom (X) + left (Y) lines are clickable to select that axis. */}
      {frame !== "none" && (
        <g>
          <line
            x1={frame === "offset" ? px0 + 8 : px0}
            x2={px0 + pw0}
            y1={py0 + ph0}
            y2={py0 + ph0}
            stroke={selX ? accent : scene.x.lineColor ?? "var(--line-2)"}
            strokeWidth={selX ? 2.5 : scene.x.lineWidth ?? 1.25}
            strokeLinecap="square"
            style={onSelect ? { cursor: "pointer" } : undefined}
            {...(onSelect ? { onClick: selectAxis("x") } : {})}
          />
          <line
            x1={px0}
            x2={px0}
            y1={py0}
            y2={frame === "offset" ? py0 + ph0 - 8 : py0 + ph0}
            stroke={selY ? accent : scene.y.lineColor ?? "var(--line-2)"}
            strokeWidth={selY ? 2.5 : scene.y.lineWidth ?? 1.25}
            strokeLinecap="square"
            style={onSelect ? { cursor: "pointer" } : undefined}
            {...(onSelect ? { onClick: selectAxis("y") } : {})}
          />
          {frame === "box" && (
            <>
              <line x1={px0} x2={px0 + pw0} y1={py0} y2={py0} stroke={scene.x.lineColor ?? "var(--line-2)"} strokeWidth={scene.x.lineWidth ?? 1.25} strokeLinecap="square" />
              <line x1={px0 + pw0} x2={px0 + pw0} y1={py0} y2={py0 + ph0} stroke={scene.y.lineColor ?? "var(--line-2)"} strokeWidth={scene.y.lineWidth ?? 1.25} strokeLinecap="square" />
            </>
          )}
        </g>
      )}
      {/* axis hit areas (tick-label gutters) */}
      {onSelect && (
        <g>
          <rect x={px0} y={py0 + ph0} width={pw0} height={26} fill="transparent" style={{ cursor: "pointer" }} onClick={selectAxis("x")} />
          <rect x={Math.max(0, px0 - 46)} y={py0} width={46} height={ph0} fill="transparent" style={{ cursor: "pointer" }} onClick={selectAxis("y")} />
        </g>
      )}
      {/* value-axis ticks + labels — the X axis's own font (see the builder's `valFont`) */}
      <g {...fontAttrs(scene.fonts.xTick, "var(--muted)")}>
        {valAxis.ticks.filter((t) => !t.minor && t.label).map((t) => {
          // Axis tab ▸ Label rotation — placed as the builder made room for it (`xTickLabelPlacement`).
          const rot = valAxis.tickRotation ?? 0;
          const lbl = xTickLabelPlacement(t.pos, py0 + ph0, tick, scene.axisGaps?.xTick ?? 6, rot);
          return (
          <g key={`vt-${t.value}`}>
            <TickMark side="bottom" pos={t.pos} edge={py0 + ph0} ax={valAxis} style={scene.axisStyle} kind="value" />
            <text x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...numbersAttr("x", valAxis)} {...(onSelect ? { onClick: selectAxis("x", tickFocus(valAxis)) } : {})}>{t.label}</text>
          </g>
          );
        })}
      </g>
      {/* category tick marks — one per row, by the chart's Tick direction */}
      {pd.rows.map((r) => <TickMark key={`ct-${r.rowId}`} side="left" pos={r.cy} edge={px0} ax={scene.y} style={scene.axisStyle} kind="category" />)}
      {/* category labels (band axis) — drawn at the builder's fitted size, which is capped so
          stacked row labels cannot collide when the rows are tight (PairedDotScene.labelFont).
          The baseline nudge follows that same size, not the tick font. */}
      {(() => {
        // A grouped category takes its group's colour (Category groups ▸ Colour labels). Row i takes
        // tick i's colour — by position: a narrow figure shortens the label, so its text is not the
        // category's name.
        const catTicks = scene.y.ticks;
        return (
          <g {...fontAttrs(scene.fonts.yTick, "var(--muted)")} fontSize={pd.labelFont}>
            {pd.rows.map((r, i) => {
              const fill = catTicks[i]?.color;
              return (
                (() => {
                  // The row names run down Y: Label rotation turns them like any category axis.
                  const rot = scene.y.tickRotation ?? 0;
                  const lbl = yTickLabelPlacement(r.cy, px0, pd.labelFont, scene.axisGaps?.yTick ?? 8, rot);
                  return <text key={`cl-${r.rowId}`} x={lbl.x} y={lbl.y} textAnchor={lbl.anchor} {...(lbl.pivot ? { transform: `rotate(${rot} ${lbl.pivot.x} ${lbl.pivot.y})` } : {})} {...(fill ? { fill } : {})} style={onSelect ? { cursor: "pointer" } : undefined} {...(onSelect ? { onClick: selectAxis("y", "labels") } : {})}>{r.label}</text>;
                })()
              );
            })}
          </g>
        );
      })()}
      {/* category-group dividing lines + names (Axis tab ▸ Category groups) */}
      <CategoryGroupMarks scene={scene} onSelect={onSelect} onMoveCategoryGroupName={onMoveCategoryGroupName} />
      {/* rotated section labels on the right — draggable (offset persists per section) */}
      {pd.sections.map((s, si) => (
        <DraggableTitle
          key={`sl-${si}`}
          text={s.display ?? s.label}
          x={s.labelX}
          y={s.labelY}
          anchor="middle"
          rotate={90}
          font={scene.fonts.legend}
          color={sectionColor}
          weight={600}
          offset={s.dx != null || s.dy != null ? { dx: s.dx ?? 0, dy: s.dy ?? 0 } : undefined}
          onMove={onMoveSectionLabel ? (dx, dy) => onMoveSectionLabel(s.label, dx, dy) : undefined}
          onSelect={onSelect ? () => onSelect({ kind: "chart-section", title: "Chart type" }) : undefined}
        />
      ))}
      {/* dots + value labels (stems were drawn earlier, behind the axes) */}
      {pd.rows.map((r) => {
        const sel = selected?.kind === "series" && r.marks.some((mk) => mk.id === selected.columnId);
        return (
          <g key={`row-${r.rowId}`}>
            {r.marks.map((d, di) => (
              Number.isFinite(d.value) && (
                <g key={`dot-${r.rowId}-${di}`}>
                  <Marker
                    shape={d.symbol ?? "circle"}
                    cx={d.cx}
                    cy={d.cy}
                    size={d.size ?? pd.dotSize}
                    color={d.color}
                    fill={d.symbolFill ?? "solid"}
                    fillColor={d.symbolFillColor}
                    opacity={d.symbolOpacity ?? 1}
                    outline={d.symbolOutline ?? "var(--bg)"}
                    borderWidth={d.borderWidth ?? 1.5}
                  />
                  {sel && (
                    <circle cx={d.cx} cy={d.cy} r={(d.size ?? pd.dotSize) + 3.5} fill="none" stroke="var(--accent)" strokeWidth={1.5} pointerEvents="none" />
                  )}
                  <circle
                    cx={d.cx}
                    cy={d.cy}
                    r={Math.max(9, (d.size ?? pd.dotSize) + 4)}
                    fill="transparent"
                    {...madyTip([r.label, legendNameOf(scene, d.id), tipNum(d.value)])}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); onSelect?.({ kind: "series", columnId: d.id, part: "points", rowId: r.rowId }); }}
                  />
                  {d.label && (
                    onMoveValueLabel ? (
                      <DraggableTitle
                        text={d.label}
                        x={d.cx}
                        y={d.cy - DOT_LABEL_GAP}
                        anchor="middle"
                        font={scene.fonts.valueLabel}
                        offset={{ dx: d.valueDx ?? 0, dy: d.valueDy ?? 0 }}
                        onMove={(dx, dy) => onMoveValueLabel(d.id, r.rowId, dx, dy)}
                        onEdit={onEditText ? (e) => beginEdit(e, { kind: "value", columnId: d.id, rowId: r.rowId }, d.label ?? "", scene.fonts.valueLabel.size, "middle", false) : undefined}
                      />
                    ) : (
                      <text
                        x={d.cx + (d.valueDx ?? 0)}
                        y={d.cy - DOT_LABEL_GAP + (d.valueDy ?? 0)}
                        textAnchor="middle"
                        {...fontAttrs(scene.fonts.valueLabel, "var(--ink)")}
                        pointerEvents="none"
                      >
                        {d.label}
                      </text>
                    )
                  )}
                </g>
              )
            ))}
          </g>
        );
      })}
      {/* axis titles — draggable + double-click to edit */}
      {scene.x.title && (
        <DraggableTitle
          text={scene.x.title}
          x={px0 + pw0 / 2}
          y={scene.height - 7}
          anchor="middle"
          font={scene.fonts.xAxisTitle}
          offset={scene.x.titleOffset}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("x", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "x" }, scene.x.title ?? "", scene.fonts.xAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "x" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "x" }) : undefined}
          centerX={px0 + pw0 / 2}
          guideTop={py0}
          guideBottom={py0 + ph0}
        />
      )}
      {scene.y.title && (
        <DraggableTitle
          {...verticalTitle(scene.y, yTitleX, scene.y.titleCenter ?? py0 + ph0 / 2, 90)}
          font={scene.y.titleFont ? { ...scene.fonts.yAxisTitle, size: scene.y.titleFont } : scene.fonts.yAxisTitle}
          offset={scene.y.titleOffset}
          rotateGrip={titleGrip(selected, "y", scene.y, 90, onRotateAxisTitle, scene)}
          onMove={onMoveAxisTitle ? (dx, dy) => onMoveAxisTitle("y", dx, dy) : undefined}
          onEdit={onEditText ? (e) => beginEdit(e, { kind: "axisTitle", axis: "y" }, scene.y.title ?? "", scene.fonts.yAxisTitle.size, "middle", true) : undefined}
          editing={editingText({ kind: "axisTitle", axis: "y" })}
          onSelect={onSelect ? () => onSelect({ kind: "axis", axis: "y" }) : undefined}
          centerY={py0 + ph0 / 2}
          guideLeft={px0}
          guideRight={px0 + pw0}
        />
      )}
      {(scene.legend.length > 0 || (scene.legendLayout.looseEntries?.length ?? 0) > 0) && <Legend scene={scene} onMove={onMoveLegend} onSelect={onSelect} onEditRow={onEditText ? (ev, t, text) => beginEdit(ev, t, text, scene.fonts.legend.size, "start") : undefined} editingRow={editingText} />}

      {scene.annotations.length > 0 && (() => {
        const inv = (ax: { domain: [number, number]; range: [number, number] }, px: number): number => {
          const [d0, d1] = ax.domain;
          const [p0, p1] = ax.range;
          return p1 === p0 ? d0 : d0 + ((px - p0) * (d1 - d0)) / (p1 - p0);
        };
        const patch = (
          a: AnnotationScene,
          ux: number,
          uy: number,
          start?: { ux0: number; uy0: number; shift0: number } | undefined,
        ): AnnotationMovePatch => {
          if (a.kind === "text") return { x: Math.max(0, Math.min(1, (ux - px0) / pw0)), y: Math.max(0, Math.min(1, (uy - py0) / ph0)) };
          if (a.kind === "bracket") {
            // A paired-dot figure always carries values on X, so the category axis is Y.
            const value = inv(scene.x, ux);
            if (!start) return { bracketY: value };
            const raw = start.shift0 + (ph0 ? (uy - start.uy0) / ph0 : 0);
            return { bracketY: value, bracketShift: Math.abs(raw * ph0) < BRACKET_SNAP_PX ? 0 : raw };
          }
          const vertical = Math.abs((a.x1 ?? 0) - (a.x2 ?? 0)) < 0.5;
          return { value: vertical ? inv(scene.x, ux) : inv(scene.y, uy) };
        };
        return (
          <AnnotationsLayer
            anchorAxes={scene}
            annotations={scene.annotations}
            selected={selected}
            plot={{ x: px0, y: py0, width: pw0, height: ph0 }}
            legendFont={scene.fonts.legend.size}
            accent={accent}
            onSelect={onSelect}
            onMoveAnnotation={onMoveAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            clientToUser={clientToUser}
            patch={patch}
            valueOnX
            beginEdit={beginEdit}
            editingText={editingText}
            onEditText={onEditText}
          />
        );
      })()}

      {onAxisResize && selX && (
        <g style={{ cursor: "ew-resize" }} onPointerDown={(e) => startAxisResize(e, "x")}>
          <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
          <line x1={px0} y1={py0 + ph0} x2={px0 + pw0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px0 + pw0} cy={py0 + ph0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the X-axis length</title>
        </g>
      )}
      {onAxisResize && selY && (
        <g style={{ cursor: "ns-resize" }} onPointerDown={(e) => startAxisResize(e, "y")}>
          <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke="transparent" strokeWidth={18} />
          <line x1={px0} y1={py0} x2={px0} y2={py0 + ph0} stroke={accent} strokeWidth={3} strokeOpacity={0.55} pointerEvents="none" />
          <circle cx={px0} cy={py0 + ph0} r={6.5} fill={accent} stroke="#fff" strokeWidth={1.5} pointerEvents="none" />
          <title>Drag to set the Y-axis length (drag down to lengthen)</title>
        </g>
      )}
      {/* significance threshold key — buildPlotScene reserves the band for every kind,
          so a bespoke figure that draws brackets must draw the key too, or turning the
          legend on here adds blank paper and nothing else. */}
      <SignificanceKey
        scene={scene}
        footerBandH={scene.footer ? Math.round(scene.fonts.legend.size * 0.9) + 12 : 0}
        onMove={onMoveSignificanceCaption}
      />
      {onFigureResize && <FigureResizeHandles width={scene.width} height={scene.height} accent="var(--accent)" onStart={figResize.start} />}
    </svg>
    {overlay}
    </div>
  );
}

/**
 * A draggable (and optionally double-click-editable) piece of figure text — the
 * graph title or an axis title — for the bespoke chart figures (lollipop / heatmap
 * / 3D / pie / radar) that don't go through the main figure's interaction layer.
 * Drag commits a px offset via `onMove`; the offset persists in the model so the
 * text stays put. `rotate` handles the vertical Y-axis title.
 */
/** Title anchor + baseline x from scene.titleAlign, shared by the bespoke figures
 *  (pie / radar / heatmap), so their titles follow titleAlign too. left = flush
 *  with the plot area's left edge (editorial house style), right = flush with its
 *  right edge, center (default) = figure centre. */
function titlePlacement(scene: PlotScene): { anchor: "start" | "middle" | "end"; baseX: number } {
  const align = scene.titleAlign ?? "center";
  return {
    anchor: align === "left" ? "start" : align === "right" ? "end" : "middle",
    baseX: align === "left" ? scene.plot.x : align === "right" ? scene.plot.x + scene.plot.width : scene.width / 2,
  };
}

/**
 * The subtitle line under a graph title.
 *
 * Draggable on its own — its offset stacks on the title's, so dragging the title still moves
 * the whole heading block while the subtitle can also be nudged alone.
 *
 * Shared by every bespoke figure, so none of them keeps its own copy of a plain `<text>`
 * that could only follow the title.
 */
function SubtitleText({
  scene,
  baseX,
  anchor,
  onMove,
  onEdit,
  editing,
}: {
  scene: PlotScene;
  /** The heading's un-offset X (each figure computes its own from titleAlign). */
  baseX: number;
  anchor: "start" | "middle" | "end";
  onMove?: ((dx: number, dy: number) => void) | undefined;
  onEdit?: ((e: React.MouseEvent) => void) | undefined;
  editing?: boolean;
}) {
  return (
    <DraggableTitle
      text={scene.subtitle ?? ""}
      x={baseX + (scene.titleOffset?.dx ?? 0)}
      y={
        (scene.title ? 8 + scene.fonts.title.size * (1 + (scene.title.split("\n").length - 1) * 1.2) + 4 : 8) +
        scene.fonts.subtitle.size * 0.85 +
        (scene.titleOffset?.dy ?? 0)
      }
      anchor={anchor}
      font={scene.fonts.subtitle}
      color="var(--muted)"
      offset={scene.subtitleOffset}
      onMove={onMove}
      onEdit={onEdit}
      editing={editing}
      centerX={scene.width / 2}
      guideTop={2}
      guideBottom={scene.plot.y}
    />
  );
}

/** The Inspector section that owns the fitted curve + its bands (Annotate tab). */
const FIT_SECTION = { kind: "chart-section", title: "Fitted curve" } as const;
/** A click on the parameter block opens its own controls (show / lines / size), not the curve's. */
const FIT_PARAMS_SECTION = { kind: "chart-section", title: "Fit parameters" } as const;

/**
 * A fitted curve with its confidence / prediction bands — from a curve-fit / regression /
 * global-fit analysis. Every part is clickable and opens the "Fitted curve" section, where
 * its colour, thickness, dashes, opacity and the band fills are set (fit
 * results are selectable and styled like other lines and bands).
 *
 * The curve is a thin stroke, so a transparent 12px hit line sits under it — the same
 * trick the reference lines use — or a 2px curve could not be hit at all.
 */
function FitOverlay({ fit, onSelect }: {
  fit: NonNullable<PlotScene["fit"]>;
  onSelect?: ((sel: GraphSelection, e: React.MouseEvent) => void) | undefined;
}) {
  const click = onSelect ? (e: React.MouseEvent) => onSelect(FIT_SECTION, e) : undefined;
  const cursor = onSelect ? "pointer" : undefined;
  return (
    <g className="gfx-fit">
      {/* prediction band (widest, faintest) then confidence band, behind the line */}
      {fit.predictionBandPath && (
        <path d={fit.predictionBandPath} fill={fit.piColor} fillOpacity={fit.piOpacity} stroke="none" cursor={cursor} onClick={click}>
          <title>{fit.label} — 95% prediction band{onSelect ? " — click to edit" : ""}</title>
        </path>
      )}
      {fit.confidenceBandPath && (
        <path d={fit.confidenceBandPath} fill={fit.ciColor} fillOpacity={fit.ciOpacity} stroke="none" cursor={cursor} onClick={click}>
          <title>{fit.label} — 95% confidence band{onSelect ? " — click to edit" : ""}</title>
        </path>
      )}
      {fit.showCurve && (
        <>
          <path
            d={fit.path}
            fill="none"
            stroke={fit.color}
            strokeWidth={fit.width}
            strokeOpacity={fit.opacity}
            strokeDasharray={fit.dash ?? undefined}
            pointerEvents="none"
          >
            <title>{fit.label}</title>
          </path>
          {onSelect && (
            <path d={fit.path} fill="none" stroke="transparent" strokeWidth={Math.max(12, fit.width + 8)} cursor="pointer" onClick={click}>
              <title>{fit.label} — click to edit</title>
            </path>
          )}
        </>
      )}
    </g>
  );
}

/**
 * The EC50 / IC50 potency crosshair — a reference line (registry id `fit-marker`): clicking
 * either leg opens the reference-line panel, exactly like a Bland-Altman limit or the ROC
 * chance diagonal. Colour / thickness / dash come resolved from the builder.
 */
function FitMarker({ marker, onSelect }: {
  marker: NonNullable<NonNullable<PlotScene["fit"]>["marker"]>;
  onSelect?: ((sel: GraphSelection, e: React.MouseEvent) => void) | undefined;
}) {
  const click = onSelect ? (e: React.MouseEvent) => onSelect({ kind: "refline", id: "fit-marker" }, e) : undefined;
  const cursor = onSelect ? "pointer" : undefined;
  const dash = marker.dash ?? undefined;
  const hitW = Math.max(12, marker.width + 8);
  return (
    <g className="gfx-fit-marker">
      {/* response level: from the Y-axis to the curve point (dashed, faint) */}
      <line x1={marker.leftX} y1={marker.cy} x2={marker.vx} y2={marker.cy} stroke={marker.color} strokeWidth={marker.width} strokeDasharray={dash} strokeOpacity={0.6} pointerEvents="none" />
      {/* dose indicator: from the curve point down to the X-axis (marks the EC50/IC50 dose) */}
      <line x1={marker.vx} y1={marker.cy} x2={marker.vx} y2={marker.baseY} stroke={marker.color} strokeWidth={marker.width} strokeDasharray={dash} pointerEvents="none">
        <title>{marker.label}</title>
      </line>
      <circle cx={marker.vx} cy={marker.cy} r={3} fill={marker.color} pointerEvents="none" />
      {onSelect && (
        <>
          <line x1={marker.leftX} y1={marker.cy} x2={marker.vx} y2={marker.cy} stroke="transparent" strokeWidth={hitW} cursor={cursor} onClick={click}>
            <title>{marker.label} — click to edit</title>
          </line>
          <line x1={marker.vx} y1={marker.cy} x2={marker.vx} y2={marker.baseY} stroke="transparent" strokeWidth={hitW} cursor={cursor} onClick={click}>
            <title>{marker.label} — click to edit</title>
          </line>
        </>
      )}
    </g>
  );
}

/**
 * A label that sits on the data — a value number, a point's name, a series' direct label.
 *
 * Drawn where it stands, inside the plot's clip, so a point zoomed out of view takes its label
 * with it. But once the label is moved — dragged now, or dropped somewhere earlier — it is
 * drawn in the figure's `gfx-textlayer` instead, which is a sibling of the clip: the plot's edge
 * cannot cut it, and the figure grows to take it in on release (`figureGrowth.ts`). Text
 * can be dragged around without being cut.
 *
 * The children are unchanged either way — same element, same handlers, different parent — so
 * nothing about a label's look or behaviour depends on which side of the clip it is on.
 */
function OnDataText({ out, layer, children }: { out: boolean; layer: SVGGElement | null; children: ReactNode }): ReactNode {
  return out && layer ? createPortal(children, layer) : children;
}

function DraggableTitle({
  text,
  x,
  y,
  anchor,
  font,
  color = "var(--ink)",
  weight,
  offset,
  rotate,
  halo,
  letterSpacing,
  baseline,
  onMove,
  onEdit,
  onSelect,
  editing,
  centerX,
  guideTop,
  guideBottom,
  centerY,
  guideLeft,
  guideRight,
  rotateGrip,
}: {
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  font: PlotScene["fonts"]["title"];
  color?: string;
  /** Optional readability halo colour drawn behind the glyphs (paint-order stroke). */
  halo?: string | undefined;
  /** Optional font-weight override (e.g. a tracked-out treemap region label, a paired-dot section
   *  name). Not for value labels: a weight passed here beats the resolved font, which would
   *  leave the "Bold" box without effect. A weight that a user can control belongs in the
   *  font's resolved default, not here. */
  weight?: number | undefined;
  /** Optional CSS letter-spacing (e.g. tracked-out region labels). */
  letterSpacing?: string | undefined;
  /** Optional dominant-baseline (e.g. "middle" for a centred rotated label). */
  baseline?: "middle" | undefined;
  offset?: { dx: number; dy: number } | undefined;
  rotate?: number | undefined;
  onMove?: ((dx: number, dy: number) => void) | undefined;
  onEdit?: ((e: React.MouseEvent) => void) | undefined;
  /** Fired on a click (no drag) — lets a draggable label also select its element. */
  onSelect?: (() => void) | undefined;
  /** Hidden (opacity 0) while its inline editor overlay is open, so the text reads once. */
  editing?: boolean | undefined;
  /** Figure horizontal centre (px). When set, dragging the title near it snaps to
   *  centre (a magnetic detent) and shows a dashed centre guide — same as the main figure. */
  centerX?: number | undefined;
  guideTop?: number | undefined;
  guideBottom?: number | undefined;
  /** Vertical centre (px) — the magnetic detent for a rotated (Y-axis) title. When
   *  set, snaps the title's y near it and shows a horizontal dashed guide. */
  centerY?: number | undefined;
  guideLeft?: number | undefined;
  guideRight?: number | undefined;
  /** A vertical axis's title while its axis is selected: show the rotation grip (Title direction). `angle` is
   *  the title's turn, anticlockwise — the negative of `rotate`. */
  rotateGrip?: { angle: number; onRotate: (deg: number) => void; bounds: { width: number; height: number } } | undefined;
}): ReactElement {
  const SNAP = 7; // scene px — magnetic centre detent
  const [drag, setDrag] = useRafState<{ dx: number; dy: number; snapped: boolean } | null>(null);
  const ref = useRef<{ x0: number; y0: number; dx0: number; dy0: number; scale: number } | null>(null);
  // Did this gesture move (a drag)? Its trailing click must then not open the inline editor.
  const movedRef = useRef(false);
  // Click feedback (otherwise nothing shows the click worked): selecting a label
  // pulses a highlight at the label itself, so the click visibly landed even though the
  // Inspector opens off to the side. Cleared on unmount so no timer outlives the figure.
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimer.current != null) window.clearTimeout(flashTimer.current); }, []);
  const base = offset ?? { dx: 0, dy: 0 };
  const off = drag ?? { ...base, snapped: false };
  const scaleOf = (e: React.PointerEvent): number => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const w = svg?.getBoundingClientRect().width;
    const vb = svg?.viewBox.baseVal.width || 1;
    return w && vb ? w / vb : 1;
  };
  // Apply the magnetic centre detent: if the title's effective x (or y, for a
  // rotated axis title) lands within SNAP of the plot centre, lock that offset so
  // it's exactly centred. X and Y snap independently.
  const snap = (dx: number, dy: number): { dx: number; dy: number; snappedX: boolean; snappedY: boolean } => {
    let sx = false;
    let sy = false;
    if (centerX != null && Math.abs(x + dx - centerX) < SNAP) { dx = centerX - x; sx = true; }
    if (centerY != null && Math.abs(y + dy - centerY) < SNAP) { dy = centerY - y; sy = true; }
    return { dx, dy, snappedX: sx, snappedY: sy };
  };
  const down = (e: React.PointerEvent): void => {
    if (!onMove && !onSelect) return;
    e.stopPropagation();
    movedRef.current = false;
    ref.current = { x0: e.clientX, y0: e.clientY, dx0: base.dx, dy0: base.dy, scale: scaleOf(e) };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    const d = ref.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) >= 3 || Math.abs(e.clientY - d.y0) >= 3) movedRef.current = true;
    const s = snap(d.dx0 + (e.clientX - d.x0) / d.scale, d.dy0 + (e.clientY - d.y0) / d.scale);
    setDrag({ dx: s.dx, dy: s.dy, snapped: s.snappedX || s.snappedY });
  };
  const up = (e: React.PointerEvent): void => {
    const d = ref.current;
    ref.current = null;
    setDrag(null);
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) {
      // a click, not a drag (edit-on-click for a title is handled by onClick below)
      if (onSelect) {
        onSelect();
        setFlash(true); // visible "it landed" pulse at the label
        if (flashTimer.current != null) window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlash(false), 900);
      }
      return;
    }
    if (!onMove) return;
    const s = snap(d.dx0 + (e.clientX - d.x0) / d.scale, d.dy0 + (e.clientY - d.y0) / d.scale);
    onMove(Math.round(s.dx), Math.round(s.dy));
  };
  const transform = [
    off.dx || off.dy ? `translate(${off.dx} ${off.dy})` : "",
    rotate ? `rotate(${rotate} ${x} ${y})` : "",
  ].filter(Boolean).join(" ");
  return (
    <>
      {/* magnetic centre guides — shown while dragging the title snapped to centre.
          Vertical line for an X (horizontal) centre, horizontal line for a Y centre. */}
      {drag && centerX != null && Math.abs(x + off.dx - centerX) < 0.5 && (
        <line
          x1={centerX}
          x2={centerX}
          y1={guideTop ?? 2}
          y2={guideBottom ?? y}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {drag && centerY != null && Math.abs(y + off.dy - centerY) < 0.5 && (
        <line
          x1={guideLeft ?? 2}
          x2={guideRight ?? x}
          y1={centerY}
          y2={centerY}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
      {(() => {
        // Padded hit box behind the glyphs (bare text is a thin, hard target).
        // Estimated, not measured: a click target needs no pixel precision, and an estimate
        // renders identically in jsdom and on the very first frame. RichText markers stripped.
        const plain = text.replace(/[\^_]\{([^}]*)\}/g, "$1");
        const estW = Math.max(10, plain.length * font.size * 0.6);
        const estH = font.size * 1.3;
        const PAD = 4;
        const hx = anchor === "start" ? x : anchor === "middle" ? x - estW / 2 : x - estW;
        const hy = baseline === "middle" ? y - estH / 2 : y - font.size;
        const interactive = !!(onMove || onSelect || onEdit);
        return (
          <g
            className={`gfx-dragtext${flash ? " gfx-dragtext-flash" : ""}`}
            style={onMove ? { cursor: "move" } : onEdit ? { cursor: "text" } : onSelect ? { cursor: "pointer" } : undefined}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            /**
             * Swallow the click that follows the press, or the selection does not survive.
             *
             * `up` above is what selects (this label owns a drag, so it cannot wait for `click`).
             * The browser then fires a `click` anyway — every real mouse does — and it would bubble
             * to the figure background's "select the plot" handler, overwriting the selection a
             * millisecond after it was made, so clicking the label would appear to do nothing.
             *
             * Caution: a test that dispatches pointerdown + pointerup without a click does not
             * reproduce what a mouse does and cannot catch this. With a real click, press-only
             * lands on (for example) the Correlation matrix section, while press-then-click
             * without this handler would snap straight back to the whole graph.
             *
             * `DraggableGroup` does not need this — it selects from a real `onClick` that stops
             * propagation itself. Double-click is unaffected: `dblclick` is a separate event.
             */
            // A selectable label selects on `up` (above), so its click only needs swallowing. A title
            // (onEdit, no onSelect) opens its inline editor on the single click. Double-click
            // still edits too. A drag sets no click (pointer moved), so this never fires mid-drag.
            onClick={onSelect ? (e) => e.stopPropagation() : onEdit ? (e) => { e.stopPropagation(); if (movedRef.current) { movedRef.current = false; return; } onEdit(e); } : undefined}
            onDoubleClick={onEdit ? (e) => { e.stopPropagation(); onEdit(e); } : undefined}
          >
            {/* stripped from every export (EXPORT_CHROME_SELECTOR) — editing chrome only.
                Shares the text's transform (not a group transform) so guards that read the
                label's own transform/rotation keep measuring the real element. */}
            {interactive && (
              <rect className="gfx-draghit" x={hx - PAD} y={hy - PAD} width={estW + 2 * PAD} height={estH + 2 * PAD} rx={4} fill="transparent" transform={transform || undefined} />
            )}
            <text
              x={x}
              y={y}
              textAnchor={anchor}
              {...fontAttrs(font, color)}
              {...(weight != null ? { fontWeight: weight } : {})}
              {...(baseline ? { dominantBaseline: baseline } : {})}
              {...(halo ? { stroke: halo, strokeWidth: 3, strokeLinejoin: "round" as const } : {})}
              transform={transform || undefined}
              opacity={editing ? 0 : undefined}
              // cursor kept on the text as well as the group: the glyphs themselves must
              // advertise draggability (several guards select labels by exactly this).
              style={{ ...(halo ? { paintOrder: "stroke" as const } : {}), ...(letterSpacing ? { letterSpacing } : {}), ...(onMove ? { cursor: "move" } : onEdit ? { cursor: "text" } : onSelect ? { cursor: "pointer" } : {}) }}
            >
              <RichText text={text} x={x} />
            </text>
          </g>
        );
      })()}
      {rotateGrip && (() => {
        const g = titleGripGeometry(x + off.dx, y + off.dy, anchor, rotateGrip.angle, font.size, text);
        return <TitleRotateGrip cx={g.cx} cy={g.cy} angle={rotateGrip.angle} reach={g.reach} bounds={rotateGrip.bounds} onRotate={rotateGrip.onRotate} />;
      })()}
    </>
  );
}

/**
 * The significance threshold key (`* p<0.05; ** p<0.01`) in its reserved band at the
 * figure bottom, above any footer.
 *
 * Shared rather than inlined because `buildPlotScene` reserves the band for every kind,
 * so the bespoke figures that draw brackets (lollipop, paired dot) must draw the key too —
 * otherwise switching the legend on there adds a strip of blank paper and nothing else, a
 * silent no-op.
 *
 * Draggable like every other caption on the figure, with the same magnetic detent back
 * to centre. Its text is derived from the ladder, so there is deliberately no inline
 * editor: the symbols are edited in the Significance panel, where the p-values live.
 */
function SignificanceKey({
  scene,
  footerBandH,
  onMove,
}: {
  scene: PlotScene;
  /** Height of the footer band below it, so the key sits above the source mark. */
  footerBandH: number;
  onMove?: ((dx: number, dy: number) => void) | undefined;
}): ReactElement | null {
  if (!scene.significanceCaption) return null;
  const st = scene.significanceCaptionStyle;
  return (
    <DraggableTitle
      text={scene.significanceCaption}
      x={scene.width / 2}
      y={scene.height - 4 - footerBandH}
      anchor="middle"
      font={{
        ...scene.fonts.legend,
        size: st?.size ?? scene.fonts.legend.size,
        // Each override beats the figure-wide legend font, including colour: fontAttrs
        // resolves `font.color` first, so leaving it in place would silently ignore the
        // caption's own colour on any figure with a legend-font colour set.
        ...(st?.family ? { family: st.family } : {}),
        ...(st?.bold ? { weight: 700 } : {}),
        ...(st?.italic ? { italic: true } : {}),
        ...(st?.color ? { color: st.color } : {}),
      }}
      color="var(--muted)"
      offset={st?.offset}
      onMove={onMove}
      centerX={scene.width / 2}
      guideTop={scene.plot.y + scene.plot.height}
      guideBottom={scene.height}
    />
  );
}

/** A draggable `<g>` wrapper — drag commits a px offset via `onMove` (persisted in
 *  the model). Used for the heatmap colour-scale bar. Children render at their
 *  normal coords; the group is translated by the (live or committed) offset. */
function DraggableGroup({
  offset,
  onMove,
  onSelect,
  title,
  children,
  dockAt,
  onNear,
  onDock,
}: {
  offset?: { dx: number; dy: number } | undefined;
  onMove?: ((dx: number, dy: number) => void) | undefined;
  /** A click (not a drag) on the group selects it (e.g. jump the inspector to its editor). */
  onSelect?: (() => void) | undefined;
  title?: string | undefined;
  children: ReactNode;
  /** The magnet: asked on every move whether the group, at this offset, is within reach of a drop target (the
   *  legend block). While it is, `onNear(true)` lights the target; releasing there calls `onDock` instead of `onMove`. */
  dockAt?: ((dx: number, dy: number, svg: SVGSVGElement | null) => boolean) | undefined;
  onNear?: ((near: boolean) => void) | undefined;
  onDock?: (() => void) | undefined;
}): ReactElement {
  const [drag, setDrag] = useRafState<{ dx: number; dy: number } | null>(null);
  const ref = useRef<{ x0: number; y0: number; dx0: number; dy0: number; scale: number; svg: SVGSVGElement | null } | null>(null);
  const draggedRef = useRef(false);
  const nearRef = useRef(false);
  const base = offset ?? { dx: 0, dy: 0 };
  const off = drag ?? base;
  const scaleOf = (e: React.PointerEvent): number => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const w = svg?.getBoundingClientRect().width;
    const vb = svg?.viewBox.baseVal.width || 1;
    return w && vb ? w / vb : 1;
  };
  const down = (e: React.PointerEvent): void => {
    draggedRef.current = false;
    if (!onMove) return;
    e.stopPropagation();
    ref.current = { x0: e.clientX, y0: e.clientY, dx0: base.dx, dy0: base.dy, scale: scaleOf(e), svg: (e.currentTarget as SVGGraphicsElement).ownerSVGElement };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const setNear = (near: boolean): void => {
    if (near === nearRef.current) return;
    nearRef.current = near;
    onNear?.(near);
  };
  const move = (e: React.PointerEvent): void => {
    const d = ref.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3) draggedRef.current = true;
    const next = { dx: d.dx0 + (e.clientX - d.x0) / d.scale, dy: d.dy0 + (e.clientY - d.y0) / d.scale };
    setDrag(next);
    if (dockAt && draggedRef.current) setNear(dockAt(next.dx, next.dy, d.svg));
  };
  const up = (e: React.PointerEvent): void => {
    const d = ref.current;
    ref.current = null;
    setDrag(null);
    const docking = nearRef.current && !!onDock;
    setNear(false);
    if (!d || !onMove) return;
    if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    if (docking) { onDock!(); return; }
    onMove(Math.round(d.dx0 + (e.clientX - d.x0) / d.scale), Math.round(d.dy0 + (e.clientY - d.y0) / d.scale));
  };
  // A click without a drag selects the group (stopPropagation so the root svg's
  // "select the plot" click doesn't override it — same guard as the bubble legend).
  const onClick = onSelect
    ? (e: React.MouseEvent): void => { if (draggedRef.current) { draggedRef.current = false; return; } e.stopPropagation(); onSelect(); }
    : undefined;
  return (
    <g
      transform={off.dx || off.dy ? `translate(${off.dx} ${off.dy})` : undefined}
      style={onMove || onSelect ? { cursor: "move" } : undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onClick={onClick}
    >
      {title && <title>{title}</title>}
      {children}
    </g>
  );
}

/** The legend box — entries laid out per scene.legendLayout (position / orientation
 *  / border / background). Label widths are estimated (the box is decorative).
 *  When `onMove` is given the whole block is draggable to any spot (free placement),
 *  on top of the anchored position; the offset persists in `plot.legendOffset`. */
function Legend({ scene, onMove, onSelect, onEditRow, editingRow, at, loose }: {
  scene: PlotScene;
  /** A loose row's own block: drawn with its top-left here instead of where the legend sits. */
  at?: { x: number; y: number } | undefined;
  /** This block is one loose row: its key (label as built) and its slot in the full order. */
  loose?: { key: string; index: number } | undefined;
  onMove?: ((dx: number, dy: number) => void) | undefined;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  /** Open the in-place editor on a row's words (double-click) — its figure's own editor. Absent = read-only. */
  onEditRow?: ((e: React.MouseEvent, target: LegendRowTarget, text: string) => void) | undefined;
  /** Is this row's editor open (its drawn words hide under the editor)? */
  editingRow?: ((t: TextTarget) => boolean) | undefined;
}) {
  const [drag, setDrag] = useRafState<{ dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ x0: number; y0: number; dx0: number; dy0: number; scale: number } | null>(null);
  const draggedRef = useRef(false);
  // Lines in the legend (legendDock.ts): a listed line's row drags out of the block to take the line back out; the
  // block lights up while a caption is held within reach of it.
  const dock = useContext(LegendDockContext);
  const [rowDrag, setRowDrag] = useRafState<{ i: number; dx: number; dy: number } | null>(null);
  // Loose rows: a click picks a row (outline); only a picked row tears off when dragged — dragging a row
  // that is not picked moves the whole legend. A press anywhere else drops the pick.
  const canTear = !!dock.onLegendLoose && !loose;
  const [picked, setPicked] = useState<string | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);
  // Loose rows sit over the data, so they are drawn last in the figure's own <svg> — above every layer a figure family
  // paints after its legend (otherwise an overlay such as the ordination's would catch every press on a loose row).
  const anchorRef = useRef<SVGGElement | null>(null);
  const [topLayer, setTopLayer] = useState<SVGSVGElement | null>(null);
  useLayoutEffect(() => {
    if (!loose) setTopLayer(anchorRef.current?.ownerSVGElement ?? null);
  }, [loose]);
  useEffect(() => {
    if (!picked) return;
    const drop = (ev: PointerEvent): void => {
      const t = ev.target as Element | null;
      if (t?.closest?.("[data-legend-picked-row]")?.getAttribute("data-legend-picked-row") !== picked) setPicked(null);
    };
    window.addEventListener("pointerdown", drop, true);
    return () => window.removeEventListener("pointerdown", drop, true);
  }, [picked]);
  const off = drag ?? scene.legendOffset ?? { dx: 0, dy: 0 };
  // Map a legend row back to its series (by the label = series name) so clicking a row
  // selects that series — the legend is a primary way to reach a series to recolour it.
  const seriesIdFor = (label: string): string | undefined => scene.series.find((s) => s.name === label)?.id;
  const scaleOf = (e: React.PointerEvent): number => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const w = svg?.getBoundingClientRect().width;
    const vbW = svg?.viewBox.baseVal.width || scene.width;
    return w && vbW ? w / vbW : 1;
  };
  const onDown = (e: React.PointerEvent): void => {
    draggedRef.current = false;
    if (loose) {
      looseDown(e);
      return;
    }
    if (!onMove) return;
    e.stopPropagation();
    const d = { x0: e.clientX, y0: e.clientY, dx0: off.dx, dy0: off.dy, scale: scaleOf(e) };
    dragRef.current = d;
    // The drag follows window listeners, never a pointer capture. Captured on the press, every click and double-click
    // that follows would go to the legend block instead of the row's words, so double-clicking a row to rename it would
    // do nothing in the browser. Captured only once the press moved, a drag whose first move left the block (down off its
    // bottom edge) would be lost. Window listeners see every move wherever the pointer goes and leave clicks where they
    // land — the bracket drag's rule (jsdom has no capture, so only the built app shows either problem).
    const move = (m: PointerEvent): void => {
      if (dragRef.current !== d) return;
      if (Math.abs(m.clientX - d.x0) > 3 || Math.abs(m.clientY - d.y0) > 3) draggedRef.current = true;
      if (draggedRef.current) setDrag({ dx: d.dx0 + (m.clientX - d.x0) / d.scale, dy: d.dy0 + (m.clientY - d.y0) / d.scale });
    };
    const up = (u: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragRef.current !== d) return;
      dragRef.current = null;
      setDrag(null);
      if (Math.abs(u.clientX - d.x0) < 3 && Math.abs(u.clientY - d.y0) < 3) return;
      onMove?.(Math.round(d.dx0 + (u.clientX - d.x0) / d.scale), Math.round(d.dy0 + (u.clientY - d.y0) / d.scale));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const L = scene.legendLayout;
  const entries = scene.legend;
  const fs = scene.fonts.legend.size;
  // The symbols scale with the legend: fixed constants would let a larger legend font grow
  // the words and leave the swatch behind, with nothing able to resize it. Everything
  // scales off the font (13px gives marker 4, dot r3 and a 12×2.4 line stub in an 18px
  // column), then off `symbolScale`. Note: `swatchWidth` comes from the builder, which
  // reserved the outside-right margin with the same number — computing it here again
  // would let the two drift.
  // The point-symbol (marker + dot) is a 1:1 key to the data point: its radius follows the
  // series' point size × the symbol-size slider, and does not inflate with the legend font
  // (set point size 6 and the legend symbol is 6). Rows without a size
  // keep the default look (marker 4 / dot 3). The line stub stays coupled to the font — it is
  // decorative chrome beside the text, not a data point.
  const symMul = scene.legendLayout.symbolScale ?? 1; // the slider, for the point-symbol
  const symScale = symMul * (fs / 13); // font-coupled, for the line stub
  // A legend row is a key: its marker must be the same marker the series draws — size,
  // shape, colour, fill (two-tone / hollow), outline and opacity. Read the resolved series and
  // copy it. `symbolSize` is the series' resolved radius (default 4), so the swatch matches the
  // data point exactly, always.
  const seriesById = new Map(scene.series.map((s) => [s.id, s] as const));
  // A renamed row (`labelKey`) is still matched to its series by the name it was built with.
  const serOf = (e: (typeof entries)[number]): SeriesScene | undefined =>
    e.select?.as === "series" ? seriesById.get(e.select.id) : e.select ? undefined : seriesById.get(seriesIdFor(e.labelKey ?? e.label) ?? "");
  // A "bar" swatch row keys the bar with a font-sized fill block — it must not follow the
  // series' symbolSize (that is the swarm-dot radius; following it would draw a giant dot
  // keying points a stacked bar doesn't even draw).
  const isBarRow = (e: (typeof entries)[number]): boolean => e.swatch === "bar";
  const baseR = (e: (typeof entries)[number]): number =>
    isBarRow(e) ? 4 : serOf(e)?.symbolSize ?? e.symbolSize ?? 4; // radius, pre-slider
  const maxSym = Math.max(4, ...entries.map(baseR));
  // The bar block: a mini bar beside the label, sized by the legend font (key chrome, like
  // the line stub) and scaled by the symbol-size slider.
  const barBlockW = 1.0 * fs * symMul;
  const barBlockH = 1.25 * fs * symMul;
  const rowH = Math.max(fs + 6, 2 * maxSym * symMul + 6, entries.some(isBarRow) ? barBlockH + 6 : 0);
  const swatchW = scene.legendLayout.swatchWidth ?? 18;
  // The line must show past the dot. A points+line series draws a line stub with its marker
  // on it; once the dot follows the (bigger) point size it can cover the whole stub and the
  // legend loses its line. Make the stub ≥ 3× the biggest dot radius, so the line always
  // sticks out ~half a radius on each side of the dot — while still coupling to the font for
  // small-point series (12px at the default dot).
  const dotRadii = entries.filter((e) => !e.symbol && e.marker !== false && !isBarRow(e)).map((e) => baseR(e) * symMul);
  const maxDotR = dotRadii.length ? Math.max(...dotRadii) : 4 * symMul;
  const stubW = Math.max(12 * symScale, 3 * maxDotR); // the line swatch's length
  const stubStroke = 2.4 * symScale;
  // Where the words start: a fixed gap past the stub the row draws (the builder reserves the room by the
  // same rule). Measured from what is drawn here, not from the builder's column: where the two disagree
  // about a dot's size (a synthesised series, a pyramid whose series draw no dots) the label would
  // otherwise land on the dot or drift away from it. Rows without a stub keep the builder's column.
  const textGap = 6 * symScale;
  /**
   * One key column when no row of the legend draws a line (every key is a dot, a block or a shape — a scatter, a swimmer,
   * an ordination): every key is centred on the same x and every label starts one fixed gap past the widest key, so
   * line-less dots and blocks line up. A legend that has a line keeps its line
   * column; its line-less dots sit on the line's middle, where its other dots are.
   */
  const lineRow = (e: (typeof entries)[number]): boolean => !e.symbol && e.swatch !== "bar" && e.line !== false;
  const keyColumn = !entries.some(lineRow) && entries.some((e) => e.line === false);
  const keyWidth = (e: (typeof entries)[number]): number =>
    e.swatch === "bar" ? (e.keyShape ? barBlockH : barBlockW)
      : e.marker === false ? 0
      : 2 * (e.dot ? e.dot.size : serOf(e)?.symbolSize ?? e.symbolSize ?? 4) * symMul;
  const keyColW = keyColumn ? Math.max(0, ...entries.map(keyWidth)) : 0;
  const textOff = keyColumn ? keyColW + textGap : entries.some((e) => !e.symbol && e.swatch !== "bar") ? stubW + textGap : swatchW;
  /**
   * Padding between the frame and the rows. 6 is the fallback for a legend that sets none.
   *
   * Note: it feeds the box size and the frame inset and (in the builder) the outside-right margin
   * reservation — all three read the same number, or a bigger pad just pushes the rows out of
   * the room reserved for them.
   */
  const pad = L.padding ?? 6;
  const inset = L.inset ?? 8; // padding from the plot corner for inside legends
  const outGap = L.gap ?? 12; // distance from the plot for the outside column
  const gap = 14; // between items in a horizontal row
  const estW = (s: string): number => s.length * fs * 0.6;
  const horizontal = L.orientation === "horizontal";

  const itemW = (e: { label: string }): number => swatchW + estW(e.label);
  // The rows of a horizontal legend. An outside-top legend wraps into the rows the builder
  // decided (`topRows`) — it reserved the band above the plot for exactly those rows, with its
  // own text measure, so wrapping again here with `estW` could disagree by a row and land the
  // legend on the title. Every other horizontal legend is one row.
  const rows: number[][] = !horizontal ? [] : L.position === "top" && L.topRows ? L.topRows : [entries.map((_, i) => i)];
  const rowWidth = (r: readonly number[]): number => r.reduce((w, i) => w + itemW(entries[i]!), 0) + Math.max(0, r.length - 1) * gap;
  const boxW = horizontal
    ? Math.max(0, ...rows.map(rowWidth)) + pad * 2
    // One formula with what must clear the box (category-group names down the right edge).
    // A key column wider than the builder's swatch column (big dots) widens the box by the difference.
    : legendBoxWidth(L, entries.map(legendLabelText), fs) + Math.max(0, textOff - swatchW);
  // A label the builder broke onto several lines (too long for the right-hand column) makes its row taller by one line
  // height per extra line; its key sits at the middle of the text. A one-line row keeps the standard row height.
  const lineH = fs * 1.2;
  const extraLines = (e: (typeof entries)[number]): number => Math.max(0, (e.lines?.length ?? 1) - 1);
  const rowTops: number[] = [];
  entries.reduce((top, e, i) => ((rowTops[i] = top), top + rowH + extraLines(e) * lineH), 0);
  const boxH = (horizontal ? rows.length * rowH : entries.reduce((h, e) => h + rowH + extraLines(e) * lineH, 0)) + pad * 2;

  const { x: px, y: py, width: pw, height: ph } = scene.plot;
  let bx: number;
  let by: number;
  switch (L.position) {
    // Outside, above the plot: the frame's bottom edge sits `outGap` above the plot rect, the
    // block is centred on the plot, and each row is centred in the block.
    case "top": bx = px + pw / 2 - boxW / 2 + pad; by = py - outGap - boxH + pad; break;
    case "topleft": bx = px + inset; by = py + inset; break;
    case "topright": bx = px + pw - boxW - inset + pad; by = py + inset; break;
    case "bottomleft": bx = px + inset; by = py + ph - boxH - inset + pad; break;
    case "bottomright": bx = px + pw - boxW - inset + pad; by = py + ph - boxH - inset + pad; break;
    case "right":
    default: bx = px + pw + outGap + (L.outsidePad ?? 0); by = py + 8; break;
  }
  // A loose row's own block sits where it was dropped (its top-left).
  if (at) {
    bx = at.x;
    by = at.y;
  }
  /**
   * The slot a held loose row will take. Held within reach, the block opens a gap at the row's own place in the full
   * order: the rows from there move down one row and a dashed slot fills the gap (upright legends; a horizontal one just
   * lights up). `looseSlot` is the full-order index; the block holds the other rows, so the gap sits after every block
   * row that came before it.
   */
  const slotAt = !loose && !horizontal && dock.looseSlot != null
    ? dock.looseSlot - (L.looseEntries ?? []).filter((le) => le.index < dock.looseSlot!).length
    : null;
  const slotH = slotAt != null ? rowH : 0;
  const shiftFor = (i: number): number => (slotAt != null && i >= slotAt ? rowH : 0);
  // An empty block (every row loose) keeps a drop target where it lives, one row tall, so a row can still come home.
  const boxWD = entries.length > 0 ? boxW : Math.max(boxW, 60);
  const boxHD = (entries.length > 0 ? boxH : rowH + pad * 2) + slotH;
  /** A loose row's drag: it moves on its own; within reach of the block it lights the block and opens its slot; let go
   *  there it goes home, anywhere else it stays where it was dropped. Window listeners, never a capture (see below). */
  const looseDown = (e: React.PointerEvent): void => {
    if (!loose || !at || !dock.onLegendLoose) return;
    e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, scale = scaleOf(e);
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    // The row's own box: its edge, not its key, meets the block's edge — so it can come home from any side without
    // having to sit on the rows. The block is re-read on every move: once its slot is open, the slot is part of it.
    const rowW = textOff + Math.max(...entries.map((x) => estW(x.label)));
    let last = { dx: 0, dy: 0 };
    let near = false;
    const move = (m: PointerEvent): void => {
      last = { dx: (m.clientX - x0) / scale, dy: (m.clientY - y0) / scale };
      if (Math.abs(m.clientX - x0) > 3 || Math.abs(m.clientY - y0) > 3) draggedRef.current = true;
      if (!draggedRef.current) return;
      setDrag(last);
      const b = legendDropBox(svg);
      const r = { x: at.x + last.dx, y: at.y + last.dy, w: rowW, h: rowH };
      const R = LEGEND_DOCK_REACH;
      // Measured against the block as it will be with the slot open (one row taller): the rows that move down to open it
      // must not land on the row being brought home. Open, the drawn block already includes the slot.
      const bh = b ? b.h + (near ? 0 : rowH) : 0;
      const n = !!b && r.x < b.x + b.w + R && r.x + r.w > b.x - R && r.y < b.y + bh + R && r.y + r.h > b.y - R;
      if (n !== near) {
        near = n;
        dock.setLooseSlot?.(n ? loose.index : null);
      }
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      dock.setLooseSlot?.(null);
      if (!draggedRef.current) return;
      dock.onLegendLoose?.(loose.key, near ? null : { x: at.x + last.dx, y: at.y + last.dy });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Where each entry of a horizontal legend sits: rows stack down from `by`; a row of the
  // outside-top legend is centred on the plot, the single row of an inside legend starts at `bx`.
  const rowSlots = new Map<number, { lx: number; ly: number }>();
  rows.forEach((r, ri) => {
    let x = L.position === "top" ? px + pw / 2 - rowWidth(r) / 2 : bx;
    for (const i of r) {
      rowSlots.set(i, { lx: x, ly: by + ri * rowH + fs * 0.5 });
      x += itemW(entries[i]!) + gap;
    }
  });
  const block = (
    <g
      ref={rootRef}
      className="gfx-legend"
      {...(loose ? { "data-legend-loose": loose.key } : {})}
      {...fontAttrs(scene.fonts.legend, "var(--ink)")}
      transform={off.dx || off.dy ? `translate(${off.dx} ${off.dy})` : undefined}
      style={onMove || (loose && dock.onLegendLoose) ? { cursor: "move" } : undefined}
      onPointerDown={onDown}
      /**
       * The legend itself — its box, its border, the padding around the rows — opens the
       * section that decides how the legend looks: its font size and the symbol-size slider.
       *
       * Without this handler a click there would bubble to the figure background and select
       * the whole graph, landing on whichever tab was last open (such as the Style tab, where
       * the legend's size and font cannot be edited).
       *
       * Note: the rows keep selecting their series — they stopPropagation, so they win, and two
       * guards in `legend-click-and-symbol.test.tsx` assert that for both the label and the
       * swatch. Clicking the words names a series; clicking the legend names the legend.
       *
       * Note: a row with no target does not stop the event, so it lands here too — better than
       * falling through to the whole-graph selection.
       */
      onClick={onSelect ? (ev) => { if (draggedRef.current) return; ev.stopPropagation(); onSelect({ kind: "chart-section", title: "Title & legend" }); } : undefined}
    >
      {/*
       * Invisible hit-area: the whole legend block (not just the glyphs) is grabbable — and,
       * since a <g> has no hit area of its own and only painted children are hit-tested, it is
       * also what gives the click above anything to land on. Hence `onSelect` as well as
       * `onMove`: without it the legend is selectable only where it happens to have a border.
       */}
      {/* `data-legend-box`: where a dragged caption reads the block from, to know when it is within reach. */}
      {!loose && (onMove || onSelect || dock.set) && <rect data-legend-box="1" x={Math.min(bx - pad, bx) - 2} y={by - pad - 2} width={boxWD + 4} height={boxHD + 4} fill="transparent" />}
      {/* The magnet, made visible: a caption held within reach lights the block up — letting go lists its line here.
          `gfx-annhandle`: editing chrome, which the exporter strips. */}
      {!loose && (dock.near || slotAt != null || (dock.looseSlot != null && horizontal)) && (
        <rect className="gfx-annhandle" data-legend-dock="1" x={bx - pad - 3} y={by - pad - 3} width={boxWD + 6} height={boxHD + 6} rx={6}
          fill="var(--accent)" fillOpacity={0.08} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
      )}
      {/* The frame. Its colour, thickness, radius and fill each come from the matching
          `LegendSpec` field, with a fixed fallback for an unset legend. */}
      {/* The dashed slot a held loose row will take. Editing chrome (`gfx-annhandle`), stripped on export. */}
      {slotAt != null && (
        <rect className="gfx-annhandle" data-legend-slot={slotAt} x={bx - 2} y={by + (entries.length > 0 ? (slotAt < entries.length ? rowTops[slotAt]! : boxH - pad * 2) : 0)}
          width={boxWD - pad * 2 + 4} height={rowH} rx={4} fill="var(--accent)" fillOpacity={0.12} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 4" pointerEvents="none" />
      )}
      {entries.length > 0 && !loose && (L.border || L.background) && (
        <rect
          x={bx - pad}
          y={by - pad}
          width={boxW}
          height={boxH + slotH}
          rx={L.borderRadius ?? 4}
          fill={L.background ? L.backgroundColor ?? "var(--bg)" : "none"}
          stroke={L.border ? L.borderColor ?? "var(--line)" : "none"}
          strokeWidth={L.borderWidth ?? 1}
        />
      )}
      {entries.map((e, i) => {
        let lx: number;
        let ly: number;
        if (horizontal) {
          const at = rowSlots.get(i) ?? { lx: bx, ly: by + fs * 0.5 };
          lx = at.lx;
          ly = at.ly;
        } else {
          lx = bx;
          ly = by + rowTops[i]! + fs * 0.5 + (extraLines(e) * lineH) / 2 + shiftFor(i);
        }
        /**
         * What this row points at. The builder says, via `e.select`; a row without one is
         * matched by its label against `scene.series`.
         *
         * Matching by label cannot serve every kind — some draw outside the series layer so there
         * is nothing to match, volcano's rows are categories, and ROC's read
         * "Biomarker (AUC 0.860)" against a series named "Biomarker" — so those builders set `e.select`.
         *
         * Note: `data-mady-series` carries the series id and only that: the interactive-HTML
         * export keys its legend-toggle off it, and pointing it at a slice or a section id
         * would silently break that export while every visible thing kept working.
         */
        const seriesId = e.select?.as === "series" ? e.select.id : e.select ? undefined : seriesIdFor(e.labelKey ?? e.label);
        // What a rename of this row's words changes (legendRename.ts): its column, its line, or its display name.
        const renameTarget: LegendRowTarget = {
          kind: "legendRow",
          label: e.labelKey ?? e.label,
          ...(seriesId ? { seriesId } : {}),
          ...(e.select?.as === "annotation" ? { annotationId: e.select.id } : {}),
        };
        // The legend swatch is a key — its marker must be the same marker the series draws
        // (two-tone fill, hollow/open, outline, shape), not a flat solid dot.
        // Look the series up and copy its resolved style; a row with no series (section / slice)
        // keeps the plain colour swatch below.
        const ser = seriesId ? scene.series.find((s) => s.id === seriesId) : undefined;
        const target: GraphSelection =
          !onSelect ? null
          : e.select?.as === "pie-slice" ? { kind: "pie-slice", datasetId: e.select.id }
          : e.select?.as === "treemap-cell" ? { kind: "treemap-cell", cellId: e.select.id }
          : e.select?.as === "section" ? { kind: "chart-section", title: e.select.id }
          : e.select?.as === "annotation" ? { kind: "annotation", id: e.select.id }
          : e.select?.as === "fit" ? FIT_SECTION
          : seriesId ? { kind: "series", columnId: seriesId }
          : null;
        // A listed line's row: drag it out of the block to take the line back out of the legend.
        const lineTarget = e.select?.as === "annotation" ? { kind: "annotation" as const, id: e.select.id } : e.select?.as === "fit" ? { kind: "fit" as const } : null;
        const undock = lineTarget && dock.set
          ? (ev: React.PointerEvent): void => {
              ev.stopPropagation(); // the row, not the whole block
              draggedRef.current = false;
              const x0 = ev.clientX;
              const y0 = ev.clientY;
              const scale = scaleOf(ev);
              const box = { x: bx - pad, y: by - pad, w: boxW, h: boxH };
              const home = { x: lx + textOff / 2, y: ly };
              let last = { dx: 0, dy: 0 };
              const move = (m: PointerEvent): void => {
                last = { dx: (m.clientX - x0) / scale, dy: (m.clientY - y0) / scale };
                if (Math.abs(m.clientX - x0) > 3 || Math.abs(m.clientY - y0) > 3) draggedRef.current = true;
                if (draggedRef.current) setRowDrag({ i, ...last });
              };
              const up = (): void => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                setRowDrag(null);
                if (draggedRef.current && !nearBox(box, home.x + last.dx, home.y + last.dy, LEGEND_UNDOCK_REACH)) dock.set?.(lineTarget, false);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }
          : undefined;
        // Loose rows: a picked row — not a listed line's, which has its own rule above — tears off when dragged
        // out of the block and stays where it is dropped; let go inside, it stays in the block.
        const rowKey = e.labelKey ?? e.label;
        const isPicked = canTear && !lineTarget && picked === rowKey;
        const rowTopY = ly - fs * 0.5 - (extraLines(e) * lineH) / 2;
        const tear = isPicked
          ? (ev: React.PointerEvent): void => {
              ev.stopPropagation(); // this row, not the whole block
              draggedRef.current = false;
              const x0 = ev.clientX;
              const y0 = ev.clientY;
              const scale = scaleOf(ev);
              const box = { x: bx - pad, y: by - pad, w: boxW, h: boxH };
              const home = { x: lx + textOff / 2, y: ly };
              let last = { dx: 0, dy: 0 };
              const move = (m: PointerEvent): void => {
                last = { dx: (m.clientX - x0) / scale, dy: (m.clientY - y0) / scale };
                if (Math.abs(m.clientX - x0) > 3 || Math.abs(m.clientY - y0) > 3) draggedRef.current = true;
                if (draggedRef.current) setRowDrag({ i, ...last });
              };
              const up = (): void => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                setRowDrag(null);
                if (!draggedRef.current || nearBox(box, home.x + last.dx, home.y + last.dy, LEGEND_UNDOCK_REACH)) return;
                setPicked(null);
                dock.onLegendLoose?.(rowKey, { x: lx + off.dx + last.dx, y: rowTopY + off.dy + last.dy });
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }
          : undefined;
        const held = rowDrag?.i === i ? rowDrag : null;

        /** Where the key's dot goes: on the line's middle, or — a key with no line — right-aligned to where the line
         *  would end, so its label keeps the same fixed gap past the dot's edge at every dot size. */
        // In a key column every key is centred on the column; otherwise a dot sits on the line's middle.
        const keyCx = lx + keyColW / 2;
        const dotX = (_r: number): number => (keyColumn ? keyCx : lx + stubW / 2);
        return (
          <g
            key={`${e.label}-${i}`}
            data-mady-series={seriesId}
            data-mady-legend={seriesId ? "1" : undefined}
            /* Every row, whatever it points at. `data-mady-legend` above stays series-only
               because the interactive-HTML export keys its show/hide toggle off it. */
            data-mady-legend-row="1"
            {...(lineTarget ? { "data-legend-line": lineTarget.kind === "fit" ? "fit" : lineTarget.id } : {})}
            {...(held ? { transform: `translate(${held.dx} ${held.dy})` } : {})}
            {...(undock ? { onPointerDown: undock } : tear ? { onPointerDown: tear } : {})}
            {...(isPicked ? { "data-legend-picked-row": rowKey } : {})}
            style={undock || tear ? { cursor: "move" } : target ? { cursor: "pointer" } : undefined}
            /**
             * The click lives on the row, not on the transparent rect below.
             *
             * That rect is a sibling, painted first, so the text draws on top of it. With the
             * handler on the rect, clicking a letter of the label would hit the <text> (which
             * has no handler) and bubble past the <g> to the figure background, selecting the
             * whole graph and landing on whichever Inspector tab was last open; only the gaps
             * between letters would reach the rect.
             *
             * On the <g> every part of the row — swatch, glyphs, gaps — selects the series.
             */
            onClick={target ? (ev) => { if (draggedRef.current) return; ev.stopPropagation(); if (canTear && !lineTarget) setPicked(rowKey); onSelect?.(target); } : undefined}
          >
            {/* The picked row's outline — drag it now and it comes out of the block. Editing chrome, stripped on export. */}
            {isPicked && (
              <rect className="gfx-annhandle" data-legend-picked={rowKey} x={lx - 4} y={rowTopY - 2} rx={4}
                width={textOff + Math.max(...legendLabelText(e).split("\n").map(estW)) + 8} height={rowH + extraLines(e) * lineH}
                fill="none" stroke="var(--accent)" strokeWidth={1.5} pointerEvents="none" />
            )}
            {/* The row's fill: makes the empty space between swatch and label solid to the
                pointer. It carries no handler of its own — the <g> above owns the click. */}
            {target && (
              <rect
                x={lx - 2}
                y={ly - rowH / 2 - (extraLines(e) * lineH) / 2}
                width={textOff + Math.max(...legendLabelText(e).split("\n").map(estW)) + 4}
                height={rowH + extraLines(e) * lineH}
                fill="transparent"
              />
            )}
            {/* A bar series' key is the bar itself: a small block carrying the series'
                resolved fill + contour (two-tone resolves to its tint colour in `fillSpec`;
                pattern/gradient fills fall back to the flat fill colour — the legend cannot
                reference the figure's def ids). Font-sized: the key is chrome, and following
                the swarm-dot size would draw an oversized dot. */}
            {e.swatch === "bar" && e.keyShape === "wedge" ? (
              // A pie's key is a slice: a quarter wedge filling the block's height, point at the lower left.
              (() => {
                // Flush at the start of the column: the builder reserved the key's width + the label gap after it.
                const r = barBlockH;
                const ax = keyColumn ? keyCx - r / 2 : lx;
                const ay = ly + r / 2;
                return (
                  <path
                    className="gfx-legbar"
                    d={`M${ax},${ay} L${ax},${ay - r} A${r},${r} 0 0 1 ${ax + r},${ay} Z`}
                    fill={e.color}
                    stroke={e.outline ?? e.color}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                );
              })()
            ) : e.swatch === "bar" && e.keyShape === "square" ? (
              // A waffle's key is one of its cells: a square as tall as the bar block.
              <rect
                className="gfx-legbar"
                x={keyColumn ? keyCx - barBlockH / 2 : lx}
                y={ly - barBlockH / 2}
                width={barBlockH}
                height={barBlockH}
                rx={1}
                fill={e.color}
                stroke={e.outline ?? e.color}
                strokeWidth={1.5}
              />
            ) : e.swatch === "bar" ? (
              <rect
                className="gfx-legbar"
                // Centred on the line's middle when the legend has lines (bars + a line), so every key shares one centre.
                x={keyColumn ? keyCx - barBlockW / 2 : entries.some(lineRow) ? lx + stubW / 2 - barBlockW / 2 : lx + Math.max(0, (swatchW - 6 - barBlockW) / 2)}
                y={ly - barBlockH / 2}
                width={barBlockW}
                height={barBlockH}
                rx={1}
                fill={ser?.fillSpec?.type === "solid" ? ser.fillSpec.color : ser?.fillColor ?? e.color}
                // A key with no series behind it (a waffle category) is drawn as its cells are: opaque, own edge.
                fillOpacity={ser ? (ser.fillOpacity ?? 0.9) : 1}
                // A row's own edge wins: an area drawn without points is keyed edgeless, as its fill is drawn.
                stroke={e.outline ?? ser?.borderColor ?? e.color}
                strokeWidth={Math.min(2, ser?.borderWidth ?? 1.5)}
              />
            ) : e.symbol ? (
              // Data-driven row: the mapped shape, but the series' resolved fill/outline so a
              // two-tone or hollow marker reads the same as on the plot.
              <Marker shape={e.symbol} cx={keyColumn ? keyCx : lx + swatchW / 3} cy={ly} size={(ser?.symbolSize ?? e.symbolSize ?? 4) * symMul} color={e.color} fill={(e.dataDriven || (ser && e.color !== ser.color)) ? "solid" : ser?.symbolFill ?? "solid"} fillColor={(e.dataDriven || (ser && e.color !== ser.color)) ? e.color : ser?.symbolFillColor} opacity={ser?.symbolOpacity ?? 1} outline={(e.dataDriven || (ser && e.color !== ser.color)) ? e.color : ser?.symbolOutline ?? e.outline ?? e.color} borderWidth={(ser?.symbolBorderWidth ?? ser?.borderWidth ?? 1.2) * symMul} />
            ) : (
              <>
                {/* `e.outline`: a key with no series behind it that carries its own edge (a two-tone pie slice).
                    `e.line === false`: the series draws no line, so neither does its key (legendKeys.ts). */}
                {/* A listed line / fitted curve keys as itself: its own dash and thickness (`e.dash`, `e.lineWidth`). */}
                {e.line !== false && <line x1={lx} x2={lx + stubW} y1={ly} y2={ly} stroke={ser?.lineColor ?? e.outline ?? e.color} strokeWidth={e.lineWidth != null ? e.lineWidth * symScale : stubStroke} {...(e.dash ? { strokeDasharray: keyDash(e.dash, stubW) } : {})} />}
                {undock && <title>Drag out of the legend to show this label on the graph again</title>}
                {/* dot omitted for a line-only trace (ROC / Kaplan-Meier) so the legend
                    doesn't imply data points the curve never draws. The dot is the series'
                    own marker (shape + two-tone/outline), not a flat filled circle — or, for a chart
                    that draws its own dots (radar, lollipop, paired dot), the dot it draws (`e.dot`). */}
                {e.marker !== false && e.dot && (
                  <Marker shape={e.dot.shape ?? "circle"} cx={dotX(e.dot.size * symMul)} cy={ly} size={e.dot.size * symMul} color={e.dot.color} fill={e.dot.fill} fillColor={e.dot.fillColor} opacity={e.dot.opacity ?? 1} outline={e.dot.outline} borderWidth={e.dot.borderWidth * symMul} />
                )}
                {e.marker !== false && !e.dot && (
                  <Marker shape={ser?.symbol ?? "circle"} cx={dotX((ser?.symbolSize ?? e.symbolSize ?? 4) * symMul)} cy={ly} size={(ser?.symbolSize ?? e.symbolSize ?? 4) * symMul} color={e.color} fill={(e.dataDriven || (ser && e.color !== ser.color)) ? "solid" : ser?.symbolFill ?? "solid"} fillColor={(e.dataDriven || (ser && e.color !== ser.color)) ? e.color : ser?.symbolFillColor} opacity={ser?.symbolOpacity ?? 1} outline={(e.dataDriven || (ser && e.color !== ser.color)) ? e.color : ser?.symbolOutline ?? e.outline ?? e.color} borderWidth={(ser?.symbolBorderWidth ?? ser?.borderWidth ?? 1.2) * symMul} />
                )}
              </>
            )}
            {/* The words open their own type. The whole row selects what it points at (the
                series, the slice, the section) — right for the swatch, wrong for the label: on a
                bar chart the Data panel sizes the marker, not the words, so the label's font
                would be unreachable. The swatch and the gaps still select the series. */}
            <text
              x={lx + textOff}
              y={ly + fs * 0.34 - (extraLines(e) * lineH) / 2}
              data-legend-text={renameTarget.label}
              opacity={editingRow?.(renameTarget) ? 0 : undefined}
              {...(onSelect ? { onClick: (ev: React.MouseEvent) => { if (draggedRef.current) return; ev.stopPropagation(); if (canTear && !lineTarget) setPicked(rowKey); onSelect(LEGEND_TEXT_SECTION); } } : {})}
              // Double-click renames the row (every text on a graph is editable): its column, its line, or its name.
              {...(onEditRow ? { onDoubleClick: (ev: React.MouseEvent) => { ev.stopPropagation(); onEditRow(ev, renameTarget, e.label); } } : {})}
            >
              <RichText text={legendLabelText(e)} x={lx + textOff} lineHeight={lineH} />
            </text>
          </g>
        );
      })}
    </g>
  );
  // Loose rows: each drawn by this same component, one row, at its own place — so its key and words are the
  // block's exactly. They are the block's rows, so the block draws them (not each figure that shows a legend, one by one).
  const looseRows = !loose
    ? (L.looseEntries ?? []).map((le) => (
        <Legend
          key={`loose-${le.entry.labelKey ?? le.entry.label}`}
          scene={{ ...scene, legend: [le.entry], legendOffset: undefined, legendLayout: { ...L, looseEntries: undefined, border: false, background: false, orientation: "vertical", position: "right" } }}
          at={{ x: le.x, y: le.y }}
          loose={{ key: le.entry.labelKey ?? le.entry.label, index: le.index }}
          onSelect={onSelect}
          onEditRow={onEditRow}
          editingRow={editingRow}
        />
      ))
    : null;
  // An empty block (every row loose) draws nothing but its drop target, and only while something can come home.
  const showBlock = entries.length > 0 || (!loose && !!dock.onLegendLoose && (L.looseEntries?.length ?? 0) > 0);
  return (
    <>
      {showBlock && block}
      {!loose && <g ref={anchorRef} />}
      {looseRows && looseRows.length > 0 && (topLayer ? createPortal(<g className="gfx-legend-loose-layer">{looseRows}</g>, topLayer) : looseRows)}
    </>
  );
}

/** Bubble size legend — a vertical stack of representative bubbles (largest at the
 *  top) with value labels, on the right of the plot. Draggable (reuses the colour-
 *  bar offset, since a heatmap and a bubble never share a plot). */
function BubbleSizeLegend({ scene, onMove, onSelect, onEditTitle, editingTitle }: {
  scene: PlotScene;
  onMove?: ((dx: number, dy: number) => void) | undefined;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  onEditTitle?: ((e: React.MouseEvent) => void) | undefined;
  editingTitle?: boolean | undefined;
}) {
  const bl = scene.bubbleLegend;
  const [drag, setDrag] = useRafState<{ dx: number; dy: number } | null>(null);
  const draggedRef = useRef(false);
  const dragRef = useRef<{ x0: number; y0: number; dx0: number; dy0: number; scale: number } | null>(null);
  if (!bl || bl.items.length === 0) return null;
  const off = drag ?? bl.offset ?? { dx: 0, dy: 0 };
  const scaleOf = (e: React.PointerEvent): number => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    const w = svg?.getBoundingClientRect().width;
    const vbW = svg?.viewBox.baseVal.width || scene.width;
    return w && vbW ? w / vbW : 1;
  };
  const onDown = (e: React.PointerEvent): void => {
    draggedRef.current = false;
    if (!onMove) return;
    e.stopPropagation();
    dragRef.current = { x0: e.clientX, y0: e.clientY, dx0: off.dx, dy0: off.dy, scale: scaleOf(e) };
    (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
  };
  const onMoveP = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3) draggedRef.current = true;
    setDrag({ dx: d.dx0 + (e.clientX - d.x0) / d.scale, dy: d.dy0 + (e.clientY - d.y0) / d.scale });
  };
  const onUp = (e: React.PointerEvent): void => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || !onMove) return;
    if (Math.abs(e.clientX - d.x0) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
    onMove(Math.round(d.dx0 + (e.clientX - d.x0) / d.scale), Math.round(d.dy0 + (e.clientY - d.y0) / d.scale));
  };
  // A click (not a drag) selects the legend + jumps the inspector to the bubble editor.
  // stopPropagation is essential: the root <svg> onClick selects { kind: "plot" }, so
  // without it the event bubbles up and immediately overrides our bubble-legend select.
  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (draggedRef.current) { draggedRef.current = false; return; }
    onSelect?.({ kind: "bubble-legend" });
  };
  const { x: px, y: py, width: pw } = scene.plot;
  const fs = scene.fonts.legend.size;
  const maxR = Math.max(...bl.items.map((i) => i.radius));
  const cxb = px + pw + (bl.inset ?? 16) + maxR; // centre of the bubble column
  const labelX = cxb + maxR + 8;
  const titleY = py + fs;
  // Stack bubbles largest → smallest below the title; each labelled to the right.
  let cy = titleY + 12 + bl.items[0]!.radius;
  const rows = bl.items.map((it, i) => {
    const y = cy;
    const next = bl.items[i + 1];
    cy += it.radius + (next ? next.radius + 12 : 0);
    return { y, r: it.radius, label: it.label };
  });
  const bottom = rows.length ? rows[rows.length - 1]!.y + rows[rows.length - 1]!.r : titleY;
  return (
    <g
      className="gfx-size-legend"
      transform={off.dx || off.dy ? `translate(${off.dx} ${off.dy})` : undefined}
      style={onMove ? { cursor: "move" } : undefined}
      onPointerDown={onDown}
      onPointerMove={onMoveP}
      onPointerUp={onUp}
      onClick={onSelect ? onClick : undefined}
    >
      {(onMove || onSelect) && <rect x={cxb - maxR - 6} y={py - 2} width={maxR * 2 + 90} height={bottom - py + 10} fill="transparent" />}
      <text
        x={cxb - maxR}
        y={titleY}
        {...fontAttrs(scene.fonts.legend, "var(--ink)")}
        fontWeight={600}
        opacity={editingTitle ? 0 : undefined}
        style={onEditTitle ? { cursor: "text" } : undefined}
        onDoubleClick={onEditTitle ? (e) => { e.stopPropagation(); onEditTitle(e); } : undefined}
      >
        <RichText text={bl.title} />
      </text>
      {rows.map((r, i) => (
        <g key={i}>
          {/* Same Marker as the plotted bubbles → identical shape / colour / fill / opacity. */}
          <Marker
            shape={bl.marker.symbol}
            cx={cxb}
            cy={r.y}
            size={r.r}
            color={bl.marker.color}
            fill={bl.marker.symbolFill}
            fillColor={bl.marker.symbolFillColor}
            opacity={bl.marker.symbolOpacity}
            outline={bl.marker.symbolOutline}
            borderWidth={bl.marker.borderWidth}
          />
          <line x1={cxb} x2={labelX - 3} y1={r.y - r.r} y2={r.y - r.r} stroke="var(--line)" strokeWidth={0.75} />
          <text x={labelX} y={r.y - r.r + fs * 0.34} {...fontAttrs(scene.fonts.legend, "var(--muted)")}>
            {r.label}
          </text>
        </g>
      ))}
    </g>
  );
}

/** One error bar (stem + caps) for a mark, honouring direction + caps. Decorative.
 *  `symmetric` forces both ends (the shared X-error subcolumn, which has no up/down). */
function ErrorBar({ mark, series, horizontal, symmetric }: { mark: MarkScene; series: SeriesScene; horizontal?: boolean; symmetric?: boolean }) {
  const { errorDir, errorCaps, errorColor: color } = series;
  const stroke = series.errorWidth;
  const cap = errorCaps ? series.errorCapWidth : 0;
  if (horizontal) {
    // Value runs along X: high = right (errHighCx), low = left (errLowCx).
    const hi = !symmetric && errorDir === "down" ? mark.cx : mark.errHighCx ?? mark.cx;
    const lo = !symmetric && errorDir === "up" ? mark.cx : mark.errLowCx ?? mark.cx;
    const capHi = (symmetric || errorDir !== "down") && mark.errHighCx !== undefined;
    const capLo = (symmetric || errorDir !== "up") && mark.errLowCx !== undefined;
    return (
      <g pointerEvents="none" stroke={color} strokeWidth={stroke}>
        <line x1={lo} x2={hi} y1={mark.cy} y2={mark.cy} />
        {capHi && <line x1={hi} x2={hi} y1={mark.cy - cap} y2={mark.cy + cap} />}
        {capLo && <line x1={lo} x2={lo} y1={mark.cy - cap} y2={mark.cy + cap} />}
      </g>
    );
  }
  // errHighCy = higher value = smaller y (top); errLowCy = lower value (bottom).
  const top = errorDir === "down" ? mark.cy : mark.errHighCy ?? mark.cy;
  const bot = errorDir === "up" ? mark.cy : mark.errLowCy ?? mark.cy;
  // Caps only at ends that actually represent an error reach (not the centre).
  const capTop = errorDir !== "down" && mark.errHighCy !== undefined;
  const capBot = errorDir !== "up" && mark.errLowCy !== undefined;
  return (
    <g pointerEvents="none" stroke={color} strokeWidth={stroke}>
      <line x1={mark.cx} x2={mark.cx} y1={top} y2={bot} />
      {capTop && <line x1={mark.cx - cap} x2={mark.cx + cap} y1={top} y2={top} />}
      {capBot && <line x1={mark.cx - cap} x2={mark.cx + cap} y1={bot} y2={bot} />}
    </g>
  );
}

/**
 * On-canvas grips to drag-resize the whole figure: a right-edge grip (width), a
 * bottom-edge grip (height), and a bottom-right corner grip (both). Positioned at
 * the figure (viewBox) bounds; each starts a coalesced figure-resize drag.
 */
/** On-canvas figure-resize for the bespoke figures (pie / radar / heatmap / 3-D),
 *  which don't flow through the main body's resize path. Returns a `start` for the
 *  FigureResizeHandles grips + pointer move/up handlers to compose onto the <svg>.
 *  Both no-op unless a grip drag is active, so they're safe to call alongside a
 *  figure's own pointer handlers (orbit, axis-resize). Coalesced to one undo by the
 *  shell (same as the main body). */
function useFigureResize(
  svgRef: React.RefObject<SVGSVGElement | null>,
  onFigureResize?: ((patch: { figureWidth?: number; figureHeight?: number }) => void) | undefined,
): {
  start: (e: React.PointerEvent, mode: "w" | "h" | "wh") => void;
  onMove: (e: React.PointerEvent) => void;
  onUp: (e: React.PointerEvent) => void;
} {
  const modeRef = useRef<null | "w" | "h" | "wh">(null);
  const start = (e: React.PointerEvent, mode: "w" | "h" | "wh"): void => {
    if (!onFigureResize) return;
    e.stopPropagation();
    e.preventDefault();
    modeRef.current = mode;
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent): void => {
    const m = modeRef.current;
    if (!m || !onFigureResize) return;
    // `typeof` rather than a plain call: jsdom's SVG element has no getScreenCTM at
    // all, so invoking it would throw before the null-check below could bow out (a
    // pointer-down reads coordinates through here).
    const ctm = typeof svgRef.current?.getScreenCTM === "function" ? svgRef.current.getScreenCTM() : null;
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const patch: { figureWidth?: number; figureHeight?: number } = {};
    if (m === "w" || m === "wh") patch.figureWidth = Math.max(120, Math.round(p.x));
    if (m === "h" || m === "wh") patch.figureHeight = Math.max(120, Math.round(p.y));
    onFigureResize(patch);
  };
  const onUp = (e: React.PointerEvent): void => {
    if (modeRef.current) {
      modeRef.current = null;
      try { svgRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* best-effort */ }
    }
  };
  return { start, onMove, onUp };
}

function FigureResizeHandles({
  width,
  height,
  accent,
  onStart,
}: {
  width: number;
  height: number;
  accent: string;
  onStart: (e: React.PointerEvent, mode: "w" | "h" | "wh") => void;
}) {
  const grip = 14; // visible grip length
  const t = 4; // grip thickness
  const pad = 1.5;
  return (
    <g className="gfx-figresize">
      {/* right edge → width */}
      <rect
        x={width - t - pad}
        y={height / 2 - grip / 2}
        width={t}
        height={grip}
        rx={2}
        fill={accent}
        fillOpacity={0.5}
        style={{ cursor: "ew-resize" }}
        onPointerDown={(e) => onStart(e, "w")}
      >
        <title>Drag to resize width</title>
      </rect>
      {/* bottom edge → height. Sits at ~72% width (clear of the centred X-axis title). */}
      <rect
        x={width * 0.72 - grip / 2}
        y={height - t - pad}
        width={grip}
        height={t}
        rx={2}
        fill={accent}
        fillOpacity={0.5}
        style={{ cursor: "ns-resize" }}
        onPointerDown={(e) => onStart(e, "h")}
      >
        <title>Drag to resize height</title>
      </rect>
      {/* bottom-right corner → both */}
      <rect
        x={width - grip - pad}
        y={height - grip - pad}
        width={grip}
        height={grip}
        rx={2}
        fill={accent}
        fillOpacity={0.65}
        style={{ cursor: "nwse-resize" }}
        onPointerDown={(e) => onStart(e, "wh")}
      >
        <title>Drag to resize the graph</title>
      </rect>
    </g>
  );
}

/** Transparent ew-resize handles straddling the left/right edges of a box/bar. */
/**
 * One axis tick mark for the charts that draw their own axes (lollipop, paired dot), by the main renderer's rule: the
 * chart's Tick direction (out = away from the plot, in = into it, both, none) and the axis' own length, thickness,
 * colour and "Show ticks", on both the category and the value axis. `edge` = the axis line's position across the mark;
 * `side` = where the axis sits.
 */
function TickMark({ side, pos, edge, ax, style, kind }: {
  side: "bottom" | "left";
  pos: number;
  edge: number;
  ax: AxisScene;
  style: PlotScene["axisStyle"];
  kind: "value" | "category";
}): ReactElement | null {
  if (style.tickDir === "none" || ax.hideTicks) return null;
  const len = (ax.tickLen ?? style.tickLen) + (ax.lineWidth ?? 1.25) / 2;
  const out = style.tickDir === "out" || style.tickDir === "both" ? len : 0;
  const into = style.tickDir === "in" || style.tickDir === "both" ? len : 0;
  const paint = { stroke: ax.lineColor ?? "var(--line-2)", strokeWidth: ax.tickWidth ?? ax.lineWidth ?? 1.25, "data-tick-mark": kind };
  // Bottom axis: out = down (+y). Left axis: out = left (−x).
  return side === "bottom"
    ? <line x1={pos} x2={pos} y1={edge - into} y2={edge + out} {...paint} />
    : <line x1={edge - out} x2={edge + into} y1={pos} y2={pos} {...paint} />;
}

function EdgeHandles({
  edges,
  y,
  h,
  onStart,
}: {
  edges: number[];
  y: number;
  h: number;
  onStart: (e: React.PointerEvent) => void;
}) {
  return (
    <>
      {edges.map((ex, i) => (
        <rect
          key={i}
          x={ex - 3.5}
          y={y}
          width={7}
          height={Math.max(3, h)}
          fill="transparent"
          style={{ cursor: "ew-resize" }}
          onPointerDown={onStart}
        />
      ))}
    </>
  );
}

/** How close (degrees) a rotation has to get before the magnet takes it to 0/45/90/135/180.
 *  Small enough that a deliberate 40° stays 40°; big enough that "square" is easy to hit. */
const ROTATE_SNAP = 5;

/**
 * A rotation, with the magnet applied — pure, and exported so a test can drive the angles
 * directly instead of through a pointer drag jsdom cannot perform.
 *
 * The angle snaps near the key angles 0, 45, 90, 135 and 180: within
 * `ROTATE_SNAP` of a multiple of 45 the angle holds there; `free` (Shift held) releases it, so
 * a deliberate 37° is still reachable. Always returns a whole degree in [0, 360).
 */
export function snapRotation(deg: number, free = false): number {
  let d = deg;
  if (!free) {
    const near = Math.round(d / 45) * 45;
    if (Math.abs(d - near) <= ROTATE_SNAP) d = near;
  }
  return Math.round(((d % 360) + 360) % 360);
}

/**
 * The angle a title's rotation grip gives when the pointer is at (ux, uy) and the title's centre at (cx, cy):
 * degrees turned anticlockwise from level (Axis tab ▸ Title direction), through the same magnet as a text
 * box's grip — within `ROTATE_SNAP` of 0 / 45 / 90 / 135 / 180 … it holds there; `free` (Shift) releases it.
 */
export function titleGripAngle(cx: number, cy: number, ux: number, uy: number, free = false): number {
  // Screen y runs down, so pointing up (uy < cy) is +90.
  return snapRotation((Math.atan2(cy - uy, ux - cx) * 180) / Math.PI, free);
}

/**
 * Where a vertical axis's title sits, for its rotation grip: the centre of its glyphs and how far its end
 * reaches from there. `anchor` / (x, y) are the text's own; `angle` its turn (anticlockwise). Estimated width,
 * like `DraggableTitle`'s hit box — a grip needs no pixel precision.
 */
export function titleGripGeometry(x: number, y: number, anchor: "start" | "middle" | "end", angle: number, size: number, text: string): { cx: number; cy: number; reach: number } {
  const lines = text.split("\n");
  const len = Math.max(10, ...lines.map((l) => l.replace(/[\^_]\{([^}]*)\}/g, "$1").length * size * 0.6));
  const r = (angle * Math.PI) / 180;
  const along = anchor === "start" ? len / 2 : anchor === "end" ? -len / 2 : 0;
  // The glyphs' middle sits this far above the first baseline; further lines run down (1.2 em each).
  const m = 0.4 * size - ((lines.length - 1) * 1.2 * size) / 2;
  return { cx: x + Math.cos(r) * along - Math.sin(r) * m, cy: y - Math.sin(r) * along - Math.cos(r) * m, reach: len / 2 + 14 };
}

/**
 * Where the title's rotation grip is drawn: `reach` px from the title's centre along `angle` — shortened
 * (never below 10 px) so the grip stays inside the figure. The figure clips what it draws, so a grip pointing
 * off its edge (a left title turned towards 135° or 180°) could not be grabbed at all. The angle itself comes
 * from the pointer's direction, so a shorter stem changes nothing.
 */
export function titleGripPoint(cx: number, cy: number, angle: number, reach: number, bounds: { width: number; height: number }): { x: number; y: number } {
  const r = (angle * Math.PI) / 180;
  const ux = Math.cos(r);
  const uy = -Math.sin(r);
  const M = 7; // the grip's radius and a little air
  let t = reach;
  if (ux < -1e-9) t = Math.min(t, (cx - M) / -ux);
  if (ux > 1e-9) t = Math.min(t, (bounds.width - M - cx) / ux);
  if (uy < -1e-9) t = Math.min(t, (cy - M) / -uy);
  if (uy > 1e-9) t = Math.min(t, (bounds.height - M - cy) / uy);
  t = Math.max(10, t);
  return { x: cx + ux * t, y: cy + uy * t };
}

/** Rotate a vertical axis's title from its grip (Title direction). `angle` is anticlockwise degrees. */
type RotateAxisTitle = ((axis: "y" | "y2" | "y3", angle: number) => void) | undefined;

/**
 * How a vertical axis's title is drawn: where the builder placed it when Title direction turned it
 * (`titleTurn`), else the caller's usual spot at the axis's default turn (90 on the left, 270 on the right).
 * One helper for every figure that draws a Y / Y2 / Y3 title, so every one of them draws the turn Title direction chose.
 */
function verticalTitle(ax: AxisScene, x: number, y: number, defaultAngle: 90 | 270): { text: string; x: number; y: number; anchor: "start" | "middle" | "end"; rotate: number | undefined } {
  const t = ax.titleTurn;
  if (!t) return { text: ax.title, x, y, anchor: "middle", rotate: defaultAngle === 90 ? -90 : 90 };
  // `text` = the title broken into lines to fit beside the axis (the builder's), else as typed.
  return { text: t.text ?? ax.title, x: t.x, y: t.y, anchor: t.anchor, rotate: svgTurn(t.angle) };
}

/** An anticlockwise angle as SVG's clockwise `rotate()`, in (-180, 180]; undefined for level. */
function svgTurn(angle: number): number | undefined {
  const r = -angle;
  const s = r <= -180 ? r + 360 : r;
  return s === 0 ? undefined : s;
}

/** The rotation grip for a vertical axis's title — only while that axis is selected and the shell can store it. */
function titleGrip(selected: GraphSelection | undefined, which: "y" | "y2" | "y3", ax: AxisScene | undefined, defaultAngle: 90 | 270, onRotate: RotateAxisTitle, bounds: { width: number; height: number }): { angle: number; onRotate: (deg: number) => void; bounds: { width: number; height: number } } | undefined {
  if (!onRotate || !ax?.title || ax.hidden || selected?.kind !== "axis" || selected.axis !== which) return undefined;
  return { angle: ax.titleTurn?.angle ?? defaultAngle, onRotate: (deg) => onRotate(which, deg), bounds };
}

/**
 * Axis tab ▸ Title direction, on the graph, with a magnetic anchor at 45, 90, 135 and
 * 180 degrees. A round grip at the reading end of a selected vertical axis's title; drag it round the title
 * and the angle holds at every 45° (`titleGripAngle`), with a badge showing the degrees, filled while the
 * magnet has it — the text box grip's look. The builder lays the title out again for its new angle, so the
 * drag shows a guide line and the title is re-drawn when the grip is let go (one undo step).
 */
function TitleRotateGrip({ cx, cy, angle, reach, bounds, onRotate }: { cx: number; cy: number; angle: number; reach: number; bounds: { width: number; height: number }; onRotate: (deg: number) => void }): ReactElement {
  const [live, setLive] = useState<{ deg: number; snapped: boolean } | null>(null);
  const shown = live?.deg ?? angle;
  const { x: gx, y: gy } = titleGripPoint(cx, cy, shown, reach, bounds);
  const toUser = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = e.currentTarget as SVGGraphicsElement;
    const ctm = typeof el.getScreenCTM === "function" ? el.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const at = (e: React.PointerEvent): { deg: number; snapped: boolean } | null => {
    const u = toUser(e);
    if (!u) return null;
    const deg = titleGripAngle(cx, cy, u.x, u.y, e.shiftKey);
    return { deg, snapped: !e.shiftKey && deg % 45 === 0 };
  };
  return (
    // The stem starts at the title's end, not its centre — from the centre it would run through the words like a
    // strike-through. The turn is still measured about the centre (data-cx/cy).
    <g className="gfx-annhandle" data-title-grip data-cx={cx} data-cy={cy}>
      {(() => {
        const dist = Math.hypot(gx - cx, gy - cy);
        const s = Math.max(0, Math.min(reach - 14, dist - 6));
        const ux = dist > 0 ? (gx - cx) / dist : 0;
        const uy = dist > 0 ? (gy - cy) / dist : 0;
        return <line x1={cx + ux * s} y1={cy + uy * s} x2={gx} y2={gy} stroke="var(--accent)" strokeWidth={1} strokeDasharray={live ? "4 3" : undefined} pointerEvents="none" />;
      })()}
      <circle
        cx={gx}
        cy={gy}
        r={5}
        fill={live?.snapped ? "var(--accent)" : "var(--bg)"}
        stroke="var(--accent)"
        strokeWidth={1.5}
        style={{ cursor: "grab" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.currentTarget as SVGGraphicsElement).setPointerCapture?.(e.pointerId);
          setLive({ deg: angle, snapped: angle % 45 === 0 });
        }}
        onPointerMove={(e) => {
          if (!live) return;
          const next = at(e);
          if (next) setLive(next);
        }}
        onPointerUp={(e) => {
          if (!live) return;
          e.stopPropagation();
          const next = at(e) ?? live;
          setLive(null);
          if (next.deg !== angle) onRotate(next.deg);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <title>Drag to turn the title — it holds at 0°, 45°, 90°, 135°, 180° (Shift: any angle)</title>
      </circle>
      {live && (
        <g data-rot-badge data-rot-snapped={live.snapped} pointerEvents="none">
          <rect x={gx - 19} y={gy - 28} width={38} height={16} rx={3} fill={live.snapped ? "var(--accent)" : "var(--bg)"} stroke="var(--accent)" strokeWidth={1} />
          <text x={gx} y={gy - 17} textAnchor="middle" fontSize={11} fontWeight={live.snapped ? 600 : 400} fill={live.snapped ? "var(--bg)" : "var(--ink)"}>{live.deg}°</text>
        </g>
      )}
    </g>
  );
}

/**
 * Scroll-to-zoom for a figure component that draws its own SVG.
 *
 * The main `PlotFigure` has this inline alongside drag-to-pan; the bespoke components
 * (`LollipopFigure`, `PairedDotFigure`) draw their own root, and without this hook their
 * builders would honour a window that no gesture could produce. `zoomable` says which axes
 * are live and which `GraphView` key each reports through; this only wires the event.
 *
 * Note: non-passive, so `preventDefault` works. Ctrl+wheel is left alone — that is the whole-view
 * magnifier, handled up at the canvas.
 */
function useWheelZoom(
  svgRef: React.RefObject<SVGSVGElement | null>,
  scene: PlotScene,
  onViewChange?: ((view: GraphView) => void) | undefined,
  onResetView?: (() => void) | undefined,
): {
  /** Spread onto the <svg>: drag-to-pan, and double-click to snap back to the home view. */
  viewProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onDoubleClick: () => void;
    style: { cursor: string } | undefined;
  };
} {
  useEffect(() => {
    const el = svgRef.current;
    const axes = onViewChange ? scene.zoomable ?? [] : [];
    if (!el || axes.length === 0) return;
    const zx = axes.find((z) => z.visual === "x");
    const zy = axes.find((z) => z.visual === "y");
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey) return;
      if (!wheelZoomEnabled) return; // the ribbon's "Wheel zoom" gate — see the flag at the top
      const ctm = typeof el.getScreenCTM === "function" ? el.getScreenCTM() : null;
      if (!ctm) return;
      e.preventDefault();
      const u = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      const k = e.deltaY < 0 ? 0.85 : 1 / 0.85;
      const view: GraphView = {};
      const put = (z: { visual: "x" | "y"; key: "x" | "y" } | undefined, ax: AxisScene, frac: number, home: [number, number]): void => {
        if (!z) return;
        const s0 = toS(ax.domain[0], ax.type);
        const s1 = toS(ax.domain[1], ax.type);
        // Anchor the zoom on the pointer, so the value under the cursor stays put.
        const c = z.visual === "x" ? s0 * (1 - frac) + s1 * frac : s1 * (1 - frac) + s0 * frac;
        const d: [number, number] = [fromS(c + (s0 - c) * k, ax.type), fromS(c + (s1 - c) * k, ax.type)];
        if (nearHome(d, home, ax.type)) return; // soft-lock detent at the natural extent
        if (z.key === "x") view.xDomain = d;
        else view.yDomain = d;
      };
      put(zx, scene.x, (u.x - scene.plot.x) / scene.plot.width, scene.auto.x);
      put(zy, scene.y, (u.y - scene.plot.y) / scene.plot.height, scene.auto.y);
      onViewChange?.(view);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [svgRef, scene, onViewChange]);

  /**
   * The ways back. Zooming in is of little use without them: drag-to-pan, double-click
   * reset, a grab cursor, and — as on the XY graphs — a magnetic feel for returning to the
   * original position.
   *
   * Pan stays inactive until the chart is actually zoomed — the same rule the main figure
   * follows. A pan swallows the click that selects a mark (>4px of travel suppresses it), and
   * an un-zoomed chart has nowhere to pan to.
   *
   * The magnet is `nearHome` inside the emit: pan back toward the original extent and the
   * last stretch snaps to it, so "put it back where it was" is a gesture rather than a
   * pixel-hunt. Double-click resets the view from anywhere.
   */
  const axes = onViewChange ? scene.zoomable ?? [] : [];
  const zx = axes.find((z) => z.visual === "x");
  const zy = axes.find((z) => z.visual === "y");
  const zoomedIn =
    (!!zx && (scene.x.domain[0] !== scene.auto.x[0] || scene.x.domain[1] !== scene.auto.x[1])) ||
    (!!zy && (scene.y.domain[0] !== scene.auto.y[0] || scene.y.domain[1] !== scene.auto.y[1]));
  const canPan = axes.length > 0 && zoomedIn;
  const pan = useRef<{ ux: number; uy: number; x: [number, number]; y: [number, number] } | null>(null);
  const toUser = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = svgRef.current;
    const ctm = typeof el?.getScreenCTM === "function" ? el.getScreenCTM() : null;
    if (!ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const viewProps = {
    onPointerDown: (e: React.PointerEvent): void => {
      if (!canPan || e.button !== 0) return;
      const u = toUser(e);
      if (!u) return;
      pan.current = { ux: u.x, uy: u.y, x: [...scene.x.domain] as [number, number], y: [...scene.y.domain] as [number, number] };
    },
    onPointerMove: (e: React.PointerEvent): void => {
      const d = pan.current;
      if (!d || !onViewChange) return;
      const u = toUser(e);
      if (!u) return;
      const view: GraphView = {};
      const shift = (
        z: { visual: "x" | "y"; key: "x" | "y" } | undefined,
        ax: AxisScene,
        from: [number, number],
        px: number,
        extent: number,
        home: [number, number],
        invert: boolean,
      ): void => {
        if (!z) return;
        const s0 = toS(from[0], ax.type);
        const s1 = toS(from[1], ax.type);
        const by = ((invert ? px : -px) / extent) * (s1 - s0);
        const nd: [number, number] = [fromS(s0 + by, ax.type), fromS(s1 + by, ax.type)];
        if (nearHome(nd, home, ax.type)) return; // the magnet
        if (z.key === "x") view.xDomain = nd;
        else view.yDomain = nd;
      };
      shift(zx, scene.x, d.x, u.x - d.ux, scene.plot.width, scene.auto.x, false);
      shift(zy, scene.y, d.y, u.y - d.uy, scene.plot.height, scene.auto.y, true);
      onViewChange(view);
    },
    onPointerUp: (): void => {
      pan.current = null;
    },
    // Prefer the full reset (axes and the 100% magnifier) so a double-click means the same
    // thing here as it does on an XY chart.
    onDoubleClick: (): void => (onResetView ? onResetView() : onViewChange?.({})),
    ...(canPan ? { style: { cursor: "grab" } } : { style: undefined }),
  };
  return { viewProps };
}

/**
 * The figure's own size rules — shared by every figure component so they cannot drift.
 *
 * `maxWidth: "100%"` is what makes a figure fit its pane at 100%, but applied at every zoom it
 * would stop the magnifier working: past the zoom at which the figure fills the pane, the
 * width attribute keeps growing while the drawn figure stays at the pane's width, so every
 * press would move the number and not the picture.
 *
 * Zoomed in, the clamp comes off, and the surrounding pane — already `overflow: auto` — scrolls.
 * That is what a magnifier is for. At or below 100% the clamp stays, so the responsive
 * fit-to-pane behaviour is untouched.
 *
 * Note: both the <svg> and its wrapper <div> carry it. Releasing one alone changes nothing: the
 * wrapper is `display:inline-block`, so its own max-width clamps the SVG inside it.
 */
const figSizeStyle = (zoom: number) => ({
  maxWidth: zoom > 1 ? "none" : "100%",
  height: "auto",
  display: "block",
}) as const;

const figWrapStyle = (zoom: number) => ({
  position: "relative",
  display: "inline-block",
  lineHeight: 0,
  maxWidth: zoom > 1 ? "none" : "100%",
}) as const;

/** Patch from a shape drag/resize — fractional plot-space geometry. */
type ShapePatch = { x?: number; y?: number; w?: number; h?: number; x2?: number; y2?: number; rotation?: number };

/**
 * Snap a fractional anchor (fx, fy in 0..1 of the plot) to the nearest alignment
 * guide — the plot's left/centre/right (0, 0.5, 1) and top/middle/bottom — when
 * within `thresholdPx`. Returns the (possibly snapped) anchor plus the pixel
 * positions of any active guide lines. Pure + exported for unit tests.
 */
export function snapToGuides(
  fx: number,
  fy: number,
  plot: { x: number; y: number; width: number; height: number },
  thresholdPx = 6,
  objects: { xs: number[]; ys: number[] } = { xs: [], ys: [] },
): { fx: number; fy: number; vx?: number | undefined; hy?: number | undefined } {
  // Candidate guides: the plot's left/centre/right + top/middle/bottom, plus the
  // fractional edge/centre lines of every other object (magnetic snap to objects).
  // Nearest-within-threshold wins on each axis, so a dense field still snaps cleanly.
  const xCands = [0, 0.5, 1, ...objects.xs];
  const yCands = [0, 0.5, 1, ...objects.ys];
  let sx = fx, sy = fy;
  let vx: number | undefined;
  let hy: number | undefined;
  let bestX = thresholdPx, bestY = thresholdPx;
  for (const t of xCands) {
    const d = Math.abs((fx - t) * plot.width);
    if (d <= bestX) { bestX = d; sx = t; vx = plot.x + t * plot.width; }
  }
  for (const t of yCands) {
    const d = Math.abs((fy - t) * plot.height);
    if (d <= bestY) { bestY = d; sy = t; hy = plot.y + t * plot.height; }
  }
  return { fx: sx, fy: sy, vx, hy };
}

/** Triangle points for an arrowhead at (x2,y2), pointing along (x1,y1)→(x2,y2). */
function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const a1 = ang + Math.PI - 0.42;
  const a2 = ang + Math.PI + 0.42;
  const p = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return `${p(x2, y2)} ${p(x2 + size * Math.cos(a1), y2 + size * Math.sin(a1))} ${p(x2 + size * Math.cos(a2), y2 + size * Math.sin(a2))}`;
}

/** A small ×-in-a-circle handle that deletes the selected annotation on click.
 *  pointerdown is swallowed so it never starts a move/resize drag. */
function DeleteHandle({ cx, cy, onDelete }: { cx: number; cy: number; onDelete: () => void }): ReactNode {
  return (
    <g
      className="gfx-anndelete"
      style={{ cursor: "pointer" }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
    >
      <title>Delete</title>
      <circle cx={cx} cy={cy} r={7.5} fill="#c9c9ce" stroke="#fff" strokeWidth={1.5} />
      <line x1={cx - 3.2} y1={cy - 3.2} x2={cx + 3.2} y2={cy + 3.2} stroke="#555" strokeWidth={1.6} />
      <line x1={cx - 3.2} y1={cy + 3.2} x2={cx + 3.2} y2={cy - 3.2} stroke="#555" strokeWidth={1.6} />
    </g>
  );
}

/**
 * A drawing-shape annotation (rect / ellipse / arrow / segment / callout).
 * Renders the resolved pixel geometry, is click-to-select, drag-to-move, and (when
 * selected) resizable via corner / endpoint handles + (rect/ellipse) a rotation
 * grip. All edits go through `onMove` as fractional plot-space patches (coalesced to
 * one undo by the shell). Rotation is applied visually about the shape centre; the
 * resize handles track the un-rotated bounding box.
 */
function ShapeAnnotation({
  a,
  selected,
  accent,
  plot,
  legendFont,
  clientToUser,
  onSelect,
  onPick,
  onMove,
  onDelete,
  onContextMenu,
  snap,
  onSnapEnd,
  caption,
}: {
  a: AnnotationScene;
  /** A segment / arrow's caption drag (and its legend magnet) — a line the user drew. Absent = the words stay put. */
  caption?: {
    onMove: (dx: number, dy: number) => void;
    onSelect: () => void;
    title: string;
    dock: { dockAt?: (dx: number, dy: number, svg: SVGSVGElement | null) => boolean; onNear?: (near: boolean) => void; onDock?: () => void };
  } | undefined;
  selected: boolean;
  accent: string;
  plot: { x: number; y: number; width: number; height: number };
  legendFont: number;
  clientToUser: (cx: number, cy: number) => { x: number; y: number } | null;
  onSelect?: ((s: GraphSelection) => void) | undefined;
  /** Shift-aware selection (multi-object Arrange). Falls back to onSelect when absent. */
  onPick?: ((id: string, e: { shiftKey?: boolean }) => void) | undefined;
  onMove?: ((patch: ShapePatch) => void) | undefined;
  onDelete?: (() => void) | undefined;
  onContextMenu?: ((e: React.MouseEvent) => void) | undefined;
  /** Snap a fractional anchor to alignment guides (returns the snapped anchor). */
  snap?: ((fx: number, fy: number) => { fx: number; fy: number }) | undefined;
  /** Clear any alignment guides when a drag ends. */
  onSnapEnd?: (() => void) | undefined;
}) {
  const gRef = useRef<SVGGElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; o: ShapeOrig; cx?: number | undefined; cy?: number | undefined } | null>(null);
  // Live readout during a rotate-grip drag: the committed angle + whether the magnet has it.
  // The snap itself is silent (the value just holds at a key angle); this makes the assist
  // visible — a badge shows the degrees, and the grip lights up when it locks to 0/45/90/…
  const [liveRot, setLiveRot] = useState<{ deg: number; snapped: boolean } | null>(null);
  const { x: px, y: py, width: pw, height: ph } = plot;
  const clampF = (v: number): number => Math.max(-0.2, Math.min(1.2, v));
  const isBox = a.kind === "rect" || a.kind === "ellipse" || a.kind === "image";
  const stroke = selected ? accent : a.color ?? "var(--ink)";
  const strokeWidth = a.width + (selected ? 0.75 : 0);
  // Recover the original fractional geometry from the pixel scene coords.
  const frac = (): ShapeOrig => {
    if (isBox) {
      const x1 = Math.min(a.x1 ?? 0, a.x2 ?? 0);
      const y1 = Math.min(a.y1 ?? 0, a.y2 ?? 0);
      return { x: (x1 - px) / pw, y: (y1 - py) / ph, w: Math.abs((a.x2 ?? 0) - (a.x1 ?? 0)) / pw, h: Math.abs((a.y2 ?? 0) - (a.y1 ?? 0)) / ph, x2: 0, y2: 0 };
    }
    return { x: ((a.x1 ?? 0) - px) / pw, y: ((a.y1 ?? 0) - py) / ph, w: 0, h: 0, x2: ((a.x2 ?? 0) - px) / pw, y2: ((a.y2 ?? 0) - py) / ph };
  };
  const start = (e: React.PointerEvent, mode: string, centre?: { cx: number; cy: number }): void => {
    // Shift-click the shape body is a multi-select toggle — handled on the <g> onClick
    // below so it fires exactly once; here we neither select nor begin a drag.
    if (mode === "move" && e.shiftKey && onPick) {
      e.stopPropagation();
      return;
    }
    if (onPick) onPick(a.id, e);
    else onSelect?.({ kind: "annotation", id: a.id });
    if (!onMove) return;
    e.stopPropagation();
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    drag.current = { mode, sx: u.x, sy: u.y, o: frac(), cx: centre?.cx, cy: centre?.cy };
    gRef.current?.setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d || !onMove) return;
    const u = clientToUser(e.clientX, e.clientY);
    if (!u) return;
    const dfx = (u.x - d.sx) / pw;
    const dfy = (u.y - d.sy) / ph;
    const o = d.o;
    const min = 0.02;
    const patch: ShapePatch = {};
    if (d.mode === "rotate") {
      /**
       * Angle from the shape centre to the pointer; the grip sits "above" centre, so pointing
       * straight up reads as 0°.
       *
       * By default, rotating a line or object snaps near the key angles 0, 45, 90, 135 and
       * 180: within ROTATE_SNAP° of a multiple of 45 the angle holds there, so upright, square
       * and diagonal are easy to hit.
       *
       * Shift releases the magnet for fine work, matching how the free-drag detents
       * elsewhere in this file behave, so any angle remains reachable.
       */
      if (d.cx != null && d.cy != null) {
        const deg = (Math.atan2(u.y - d.cy, u.x - d.cx) * 180) / Math.PI + 90;
        const rot = snapRotation(deg, e.shiftKey);
        patch.rotation = rot;
        // The magnet is engaged whenever the result landed on a key angle and Shift isn't
        // releasing it — snapRotation only returns a 45° multiple when the raw was within band.
        setLiveRot({ deg: rot, snapped: !e.shiftKey && rot % 45 === 0 });
        onMove(patch);
      }
      return;
    }
    switch (d.mode) {
      case "move":
        patch.x = clampF(o.x + dfx);
        patch.y = clampF(o.y + dfy);
        if (isBox && snap) {
          // Snap a box's top-left anchor to the alignment guides.
          const s = snap(patch.x, patch.y);
          patch.x = s.fx;
          patch.y = s.fy;
        }
        if (!isBox) {
          patch.x2 = clampF(o.x2 + dfx);
          patch.y2 = clampF(o.y2 + dfy);
          /**
           * A dragged line also snaps to the axes when it comes near one, and it moves
           * rigidly when it does. The guides are the plot's own edges and centre lines (0 / 0.5 / 1),
           * so a leader line parks flush against an axis instead of one pixel off it.
           *
           * Both ends take the same correction. Snapping each end to its own nearest guide
           * would shear the line, changing its length during the drag.
           */
          if (snap) {
            const sn = snap(patch.x, patch.y);
            const cx = sn.fx - patch.x;
            const cy = sn.fy - patch.y;
            patch.x = sn.fx;
            patch.y = sn.fy;
            patch.x2 = clampF(patch.x2 + cx);
            patch.y2 = clampF(patch.y2 + cy);
          }
        }
        break;
      case "se":
        patch.w = Math.max(min, o.w + dfx);
        patch.h = Math.max(min, o.h + dfy);
        break;
      case "ne":
        patch.y = clampF(o.y + dfy);
        patch.w = Math.max(min, o.w + dfx);
        patch.h = Math.max(min, o.h - dfy);
        break;
      case "sw":
        patch.x = clampF(o.x + dfx);
        patch.w = Math.max(min, o.w - dfx);
        patch.h = Math.max(min, o.h + dfy);
        break;
      case "nw":
        patch.x = clampF(o.x + dfx);
        patch.y = clampF(o.y + dfy);
        patch.w = Math.max(min, o.w - dfx);
        patch.h = Math.max(min, o.h - dfy);
        break;
      case "p1": {
        patch.x = clampF(o.x + dfx);
        patch.y = clampF(o.y + dfy);
        // One end of a line, dragged alone: it snaps to the axes on its own — the other end
        // stays where it is, which is the whole point of dragging just this one.
        if (snap) {
          const sn = snap(patch.x, patch.y);
          patch.x = sn.fx;
          patch.y = sn.fy;
        }
        break;
      }
      case "p2": {
        patch.x2 = clampF(o.x2 + dfx);
        patch.y2 = clampF(o.y2 + dfy);
        if (snap) {
          const sn = snap(patch.x2, patch.y2);
          patch.x2 = sn.fx;
          patch.y2 = sn.fy;
        }
        break;
      }
    }
    onMove(patch);
  };
  const end = (e: React.PointerEvent): void => {
    drag.current = null;
    setLiveRot(null); // drop the rotation badge the moment the grip is released
    onSnapEnd?.();
    gRef.current?.releasePointerCapture?.(e.pointerId);
  };
  const handle = (cx: number, cy: number, mode: string, cursor: string): ReactNode => (
    <rect
      // `gfx-annhandle` is what keeps a selection grip out of an exported file — the
      // export strips this class, and an object is selected the moment it is created,
      // so without it "add a marker, then export" bakes the handles into the figure.
      className="gfx-annhandle"
      x={cx - 4}
      y={cy - 4}
      width={8}
      height={8}
      fill="var(--bg)"
      stroke={accent}
      strokeWidth={1.5}
      style={{ cursor }}
      onPointerDown={(e) => start(e, mode)}
    />
  );

  const x1 = a.x1 ?? 0;
  const y1 = a.y1 ?? 0;
  const x2 = a.x2 ?? 0;
  const y2 = a.y2 ?? 0;
  const fill = a.fill ?? "transparent";
  const fillOpacity = a.fill ? a.fillOpacity ?? 1 : 1;
  const dashArr = a.dash ?? undefined;
  const moveCursor = onMove ? "move" : "pointer";

  let body: ReactNode = null;
  if (a.kind === "rect" || a.kind === "ellipse" || a.kind === "image") {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    const rot = a.rotation ? `rotate(${a.rotation} ${cx} ${cy})` : undefined;
    const shape =
      a.kind === "image" ? (
        // The box is the image rect (preserveAspectRatio="none" → WYSIWYG resize);
        // `color`/`width` add an optional border; a dashed accent outline marks selection.
        <>
          <image href={a.href ?? ""} x={rx} y={ry} width={rw} height={rh} preserveAspectRatio="none" opacity={a.fillOpacity ?? 1} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "move")} />
          {a.color && a.width > 0 && (
            <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke={a.color} strokeWidth={a.width} strokeDasharray={dashArr} pointerEvents="none" />
          )}
          {selected && <rect x={rx} y={ry} width={rw} height={rh} fill="none" stroke={accent} strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />}
        </>
      ) : a.kind === "rect" ? (
        <rect x={rx} y={ry} width={rw} height={rh} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArr} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "move")} />
      ) : (
        <ellipse cx={cx} cy={cy} rx={rw / 2} ry={rh / 2} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArr} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "move")} />
      );
    body = (
      <>
        {rot ? <g transform={rot}>{shape}</g> : shape}
        {a.label && (
          <text x={a.labelX} y={a.labelY} textAnchor="middle" fontSize={a.fontSize ?? legendFont} fill={stroke} pointerEvents="none">
            <RichText text={a.label} x={a.labelX} />
          </text>
        )}
        {selected && onMove && (
          <>
            {handle(rx, ry, "nw", "nwse-resize")}
            {handle(rx + rw, ry, "ne", "nesw-resize")}
            {handle(rx, ry + rh, "sw", "nesw-resize")}
            {handle(rx + rw, ry + rh, "se", "nwse-resize")}
            {/* rotation grip — a stem rising from the top edge to a round handle. The handle
                fills solid while the magnet has the angle, so a lock to 0/45/90/… is visible,
                not just felt. */}
            <line className="gfx-annhandle" x1={cx} y1={ry} x2={cx} y2={ry - 22} stroke={accent} strokeWidth={1} pointerEvents="none" />
            <circle
              className="gfx-annhandle"
              cx={cx}
              cy={ry - 22}
              r={5}
              fill={liveRot?.snapped ? accent : "var(--bg)"}
              stroke={accent}
              strokeWidth={1.5}
              style={{ cursor: "grab" }}
              onPointerDown={(e) => start(e, "rotate", { cx, cy })}
            >
              <title>Drag to rotate</title>
            </circle>
            {/* live angle readout — the visible half of the assist. Marked gfx-annhandle so the
                exporter strips it (a drag can't outlive an export, but stay consistent). */}
            {liveRot && (
              <g className="gfx-annhandle" data-rot-badge data-rot-snapped={liveRot.snapped} pointerEvents="none">
                <rect x={cx - 19} y={ry - 48} width={38} height={16} rx={3} fill={liveRot.snapped ? accent : "var(--bg)"} stroke={accent} strokeWidth={1} />
                <text x={cx} y={ry - 37} textAnchor="middle" fontSize={11} fontWeight={liveRot.snapped ? 600 : 400} fill={liveRot.snapped ? "var(--bg)" : "var(--ink)"}>{liveRot.deg}°</text>
              </g>
            )}
            {onDelete && <DeleteHandle cx={rx + rw + 12} cy={ry - 12} onDelete={onDelete} />}
          </>
        )}
      </>
    );
  } else {
    // arrow / segment / callout — a line (optionally to a callout text) + arrowheads.
    const headSize = Math.max(7, a.width * 3 + 4);
    const showEnd = a.arrowHead === "end" || a.arrowHead === "both";
    const showStart = a.arrowHead === "both";
    body = (
      <>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={14} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "move")} />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashArr} strokeLinecap="round" pointerEvents="none" />
        {showEnd && <polygon points={arrowHeadPoints(x1, y1, x2, y2, headSize)} fill={stroke} pointerEvents="none" />}
        {showStart && <polygon points={arrowHeadPoints(x2, y2, x1, y1, headSize)} fill={stroke} pointerEvents="none" />}
        {a.kind === "callout" && a.label && a.textBox?.box && (
          // The box behind the callout's words (background + border, `layoutTextBox` in the builder), painted
          // before the text so the words stay on top (callout-fill.test.tsx). Grabbing it drags the label.
          <TextBoxRect box={a.textBox.box} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "p1")} />
        )}
        {a.kind === "callout" && a.label && (
          <text x={a.textBox?.x ?? x1} y={y1} textAnchor={a.textBox?.anchor ?? "middle"} fontSize={a.fontSize ?? legendFont} fill={stroke} style={{ cursor: moveCursor }} onPointerDown={(e) => start(e, "p1")}>
            <RichText text={a.textBox ? a.textBox.lines.join("\n") : a.label} x={a.textBox?.x ?? x1} />
          </text>
        )}
        {a.kind !== "callout" && a.label && (() => {
          // A segment / arrow the user drew: its caption drags on its own and drops onto the legend (legendDock.ts).
          // Its committed offset is drawn in every render, read-only ones included.
          const words = (
            <text x={a.labelX} y={a.labelY} textAnchor={a.labelAnchor ?? "middle"} fontSize={a.fontSize ?? legendFont} fill={stroke} {...(caption ? {} : { pointerEvents: "none" as const })}>
              <RichText text={a.label} x={a.labelX} />
            </text>
          );
          const off = a.labelOffset ?? { dx: 0, dy: 0 };
          if (!caption) return off.dx || off.dy ? <g transform={`translate(${off.dx} ${off.dy})`}>{words}</g> : words;
          return (
            <DraggableGroup offset={off} onMove={caption.onMove} onSelect={caption.onSelect} title={caption.title} {...caption.dock}>
              {words}
            </DraggableGroup>
          );
        })()}
        {selected && onMove && (
          <>
            {handle(x1, y1, "p1", "move")}
            {handle(x2, y2, "p2", "move")}
            {onDelete && <DeleteHandle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2 - 13} onDelete={onDelete} />}
          </>
        )}
      </>
    );
  }

  return (
    <g
      ref={gRef}
      data-ann-shape={a.id}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => {
        e.stopPropagation();
        if (onPick) onPick(a.id, e);
        else onSelect?.({ kind: "annotation", id: a.id });
      }}
      onContextMenu={onContextMenu}
    >
      {body}
    </g>
  );
}

/** Original fractional geometry captured at the start of a shape drag. */
interface ShapeOrig {
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
}

/** The group-mean "+" glyph overlaid on box / violin plots (Plot.showBoxMean). A small
 *  plus centred on (cx, cy); a distinct shape from the median line so it reads clearly
 *  even when it shares the contour colour. */
function MeanCross({ cx, cy, arm, color, width }: { cx: number; cy: number; arm: number; color: string; width: number }) {
  return (
    <g stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" pointerEvents="none">
      <line x1={cx - arm} x2={cx + arm} y1={cy} y2={cy} />
      <line x1={cx} x2={cx} y1={cy - arm} y2={cy + arm} />
    </g>
  );
}

/** The notch cuts in by a quarter of the box's width on each side (ggplot2's default notch width). */
const NOTCH_INDENT = 0.25;

/**
 * A notched box outline (`box.notch`): straight from each quartile to the notch's end, in to the median at a quarter of the
 * box width, and out again. A notch that reaches past a quartile folds the outline back on itself — drawn as asked (the
 * builder warns). `horizontal`: the value runs along X and `x/w` hold the band on Y.
 */
function notchedBoxPath(b: NonNullable<MarkScene["box"]>, horizontal: boolean | undefined): string {
  const n = b.notch!;
  const k = b.w * NOTCH_INDENT;
  const qa = Math.min(b.q1, b.q3), qb = Math.max(b.q1, b.q3);
  const na = Math.min(n.low, n.high), nb = Math.max(n.low, n.high);
  const mid = b.median ?? (na + nb) / 2;
  const s0 = b.x, s1 = b.x + b.w;
  // Walk the outline with (value, side) pairs, then write them in the chart's orientation.
  const pts: [number, number][] = [
    [qa, s0], [qa, s1], [na, s1], [mid, s1 - k], [nb, s1], [qb, s1], [qb, s0], [nb, s0], [mid, s0 + k], [na, s0],
  ];
  return "M" + pts.map(([v, s]) => (horizontal ? `${v.toFixed(2)},${s.toFixed(2)}` : `${s.toFixed(2)},${v.toFixed(2)}`)).join("L") + "Z";
}

/** A box-and-whisker glyph: whiskers (capped) + box (q1–q3) + median + outlier dots. */
function BoxGlyph({ mark, series, selected, accent, fillPaint, horizontal, onHover, onClick, tip }: GlyphProps) {
  const b = mark.box!;
  const line = series.borderColor;
  const stroke = series.borderWidth;
  // Mean "+" size scales with the box thickness (b.w), capped so it stays a small marker.
  const meanArm = Math.max(4, Math.min(b.w * 0.3, 7));
  const meanW = Math.max(1.3, stroke);
  // Whisker / median / outlier styling (fall back to the box contour).
  const wColor = series.whiskerColor ?? line;
  const wWidth = series.whiskerWidth ?? stroke;
  const sides = series.whiskerSides ?? "both";
  const caps = series.whiskerCaps ?? true;
  const mColor = series.medianColor ?? line;
  const mWidth = series.medianWidth ?? stroke + 0.8;
  const showOut = series.showOutliers ?? true;
  const oSize = series.outlierSize ?? 2.4;
  const drawUpper = sides === "both" || sides === "upper";
  const drawLower = sides === "both" || sides === "lower";
  if (horizontal) {
    // Transposed: x/w hold the Y band; q/whisker/median/outliers hold X pixels.
    const cy = b.x + b.w / 2; // band centre on Y
    const cap = b.w * (series.whiskerCapWidth ?? 0.28);
    const boxLeft = Math.min(b.q1, b.q3);
    return (
      <g onMouseEnter={onHover} onClick={onClick} style={{ cursor: "pointer" }} {...tip}>
        {/* whiskers + caps + box — hidden for a mean-only glyph (inner box off, Show mean on) */}
        {!b.meanOnly && (
          <>
            <g stroke={wColor} strokeWidth={wWidth} fill="none">
              {drawUpper && <line x1={b.q3} x2={b.whiskerHigh} y1={cy} y2={cy} />}
              {drawLower && <line x1={b.whiskerLow} x2={b.q1} y1={cy} y2={cy} />}
              {caps && drawUpper && <line x1={b.whiskerHigh} x2={b.whiskerHigh} y1={cy - cap} y2={cy + cap} />}
              {caps && drawLower && <line x1={b.whiskerLow} x2={b.whiskerLow} y1={cy - cap} y2={cy + cap} />}
            </g>
            {b.notch ? (
              <path d={notchedBoxPath(b, true)} fill={mark.fill ?? fillPaint} fillOpacity={mark.fillOpacity ?? series.fillOpacity} stroke={line} strokeWidth={stroke} strokeLinejoin="round" />
            ) : (
              <rect
                x={boxLeft}
                y={b.x}
                width={Math.abs(b.q1 - b.q3)}
                height={b.w}
                fill={mark.fill ?? fillPaint}
                fillOpacity={mark.fillOpacity ?? series.fillOpacity}
                stroke={line}
                strokeWidth={stroke}
              />
            )}
          </>
        )}
        {/* median (null = suppressed, e.g. floating-bar "Line = None"); across the notch's waist when notched */}
        {b.median != null && (() => {
          const k = b.notch ? b.w * NOTCH_INDENT : 0;
          return <line x1={b.median} x2={b.median} y1={b.x + k} y2={b.x + b.w - k} stroke={mColor} strokeWidth={mWidth} />;
        })()}
        {/* outliers */}
        {showOut &&
          b.outliers.map((ox, i) => (
            <circle key={i} cx={ox} cy={cy} r={oSize} fill={series.fillColor} stroke="var(--bg)" strokeWidth={0.5} />
          ))}
        {/* mean "+" (value runs along X in horizontal mode) */}
        {b.mean !== undefined && <MeanCross cx={b.mean} cy={cy} arm={meanArm} color={line} width={meanW} />}
        {selected && (
          <rect
            x={boxLeft - 1.5}
            y={b.x - 1.5}
            width={Math.abs(b.q1 - b.q3) + 3}
            height={b.w + 3}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            strokeDasharray="3 2"
            pointerEvents="none"
          />
        )}
      </g>
    );
  }
  const cx = b.x + b.w / 2;
  const cap = b.w * (series.whiskerCapWidth ?? 0.28);
  return (
    <g onMouseEnter={onHover} onClick={onClick} style={{ cursor: "pointer" }} {...tip}>
      {/* whiskers + caps + box — hidden for a mean-only glyph (inner box off, Show mean on) */}
      {!b.meanOnly && (
        <>
          <g stroke={wColor} strokeWidth={wWidth} fill="none">
            {drawUpper && <line x1={cx} x2={cx} y1={b.whiskerHigh} y2={b.q3} />}
            {drawLower && <line x1={cx} x2={cx} y1={b.q1} y2={b.whiskerLow} />}
            {caps && drawUpper && <line x1={cx - cap} x2={cx + cap} y1={b.whiskerHigh} y2={b.whiskerHigh} />}
            {caps && drawLower && <line x1={cx - cap} x2={cx + cap} y1={b.whiskerLow} y2={b.whiskerLow} />}
          </g>
          {b.notch ? (
            <path d={notchedBoxPath(b, false)} fill={mark.fill ?? fillPaint} fillOpacity={mark.fillOpacity ?? series.fillOpacity} stroke={line} strokeWidth={stroke} strokeLinejoin="round" />
          ) : (
            <rect
              x={b.x}
              y={Math.min(b.q1, b.q3)}
              width={b.w}
              height={Math.abs(b.q1 - b.q3)}
              fill={mark.fill ?? fillPaint}
              fillOpacity={mark.fillOpacity ?? series.fillOpacity}
              stroke={line}
              strokeWidth={stroke}
            />
          )}
        </>
      )}
      {/* median (null = suppressed, e.g. floating-bar "Line = None"); across the notch's waist when notched */}
      {b.median != null && (() => {
        const k = b.notch ? b.w * NOTCH_INDENT : 0;
        return <line x1={b.x + k} x2={b.x + b.w - k} y1={b.median} y2={b.median} stroke={mColor} strokeWidth={mWidth} />;
      })()}
      {/* outliers */}
      {showOut &&
        b.outliers.map((oy, i) => (
          <circle key={i} cx={cx} cy={oy} r={oSize} fill={series.fillColor} stroke="var(--bg)" strokeWidth={0.5} />
        ))}
      {/* mean "+" at the group mean */}
      {b.mean !== undefined && <MeanCross cx={cx} cy={b.mean} arm={meanArm} color={line} width={meanW} />}
      {selected && (
        <rect
          x={b.x - 1.5}
          y={Math.min(b.q1, b.q3) - 1.5}
          width={b.w + 3}
          height={Math.abs(b.q1 - b.q3) + 3}
          fill="none"
          stroke={accent}
          strokeWidth={1.5}
          strokeDasharray="3 2"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

interface GlyphProps {
  mark: MarkScene;
  series: SeriesScene;
  selected: boolean;
  accent: string;
  /** Resolved fill paint (solid colour or a url(#…) pattern/gradient/metallic). */
  fillPaint: string;
  /** Transposed layout: value axis on X, category bands on Y (orientation flip). */
  horizontal?: boolean;
  onHover: () => void;
  onClick: (e: React.MouseEvent) => void;
  /** Hover text for the interactive HTML export (`madyTip`). */
  tip?: { "data-mady-tip": string } | undefined;
}

/** Violin: the KDE silhouette + a slim box/median/spread "stick" inside it. */
function ViolinGlyph({ mark, series, selected, accent, fillPaint, horizontal, onHover, onClick, tip }: GlyphProps) {
  const v = mark.violin!;
  const b = mark.box; // slim quartile box (may be absent on degenerate data)
  const line = series.borderColor;
  const stroke = series.borderWidth;
  // In horizontal mode v.cx is the band centre Y; the box q-fields are X pixels.
  return (
    <g onMouseEnter={onHover} onClick={onClick} style={{ cursor: "pointer" }} {...tip}>
      <path
        d={v.path}
        fill={mark.fill ?? fillPaint}
        fillOpacity={mark.fillOpacity ?? series.fillOpacity}
        stroke={line}
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
      {selected && <path d={v.path} fill="none" stroke={accent} strokeWidth={1.5} strokeDasharray="3 2" strokeLinejoin="round" pointerEvents="none" />}
      {b && !horizontal && (
        <>
          {/* spread stick (whisker range) + quartile box + median tick */}
          <line x1={v.cx} x2={v.cx} y1={b.whiskerHigh} y2={b.whiskerLow} stroke={line} strokeWidth={1} />
          {b.notch ? <path d={notchedBoxPath(b, false)} fill={line} /> : <rect x={b.x} y={Math.min(b.q1, b.q3)} width={b.w} height={Math.abs(b.q1 - b.q3)} fill={line} />}
          {b.median != null && <line x1={b.x + (b.notch ? b.w * NOTCH_INDENT : 0)} x2={b.x + b.w - (b.notch ? b.w * NOTCH_INDENT : 0)} y1={b.median} y2={b.median} stroke="var(--bg)" strokeWidth={1.4} />}
          {/* mean "+" — drawn in the bg colour so it reads on the dark inner box (like the median) */}
          {b.mean !== undefined && <MeanCross cx={v.cx} cy={b.mean} arm={5} color="var(--bg)" width={1.6} />}
        </>
      )}
      {b && horizontal && (
        <>
          <line x1={b.whiskerLow} x2={b.whiskerHigh} y1={v.cx} y2={v.cx} stroke={line} strokeWidth={1} />
          {b.notch ? <path d={notchedBoxPath(b, true)} fill={line} /> : <rect x={Math.min(b.q1, b.q3)} y={b.x} width={Math.abs(b.q1 - b.q3)} height={b.w} fill={line} />}
          {b.median != null && <line x1={b.median} x2={b.median} y1={b.x + (b.notch ? b.w * NOTCH_INDENT : 0)} y2={b.x + b.w - (b.notch ? b.w * NOTCH_INDENT : 0)} stroke="var(--bg)" strokeWidth={1.4} />}
          {b.mean !== undefined && <MeanCross cx={b.mean} cy={v.cx} arm={5} color="var(--bg)" width={1.6} />}
        </>
      )}
    </g>
  );
}

/** Column scatter: every replicate as a swarmed dot + a mean ± SD overlay. */
function ScatterGlyph({ mark, series, selected, accent, horizontal, onHover, onClick, tip }: GlyphProps) {
  const pts = mark.points ?? [];
  const line = series.borderColor;
  // A bar's own "this point only" marker settings win over the series' for the dots drawn over it — the
  // same `m.x ?? series.x` precedence the XY markers use. Without it, Shape / Size / Fill / Opacity /
  // Outline set for one bar would reach its mark and never its dots.
  // Bars only. The same drawer paints a raincloud's rain, whose per-part fill is deliberately not
  // targetable (Inspector.raincloud.test.tsx measures it) — reading every mark's fields would let a per-part
  // fill move the rain while its panel routes that row to the series.
  const own_ = mark.bar ? mark : undefined;
  const r = swarmDotRadius(own_?.symbolSize ?? series.symbolSize); // the layout keeps labels off dots of the series size
  // Mean line + SD caps honour the series' error-bar colour / thickness (editable in
  // the inspector's "Mean ± SD" group); the default colour is the contour colour.
  const meanColor = selected ? accent : (series.errorColor ?? line);
  const errW = series.errorWidth ?? 1.5;
  // When this swarm is the "show all points" overlay on a box/violin (the same mark also
  // carries a box/violin glyph), the body already draws the centre/median line — so the
  // scatter's own full-width mean line would double up. Suppress it for overlays.
  // ...and on a bar, where the bar already shows the centre and carries its own error
  // bars. The points are drawn alongside the error bars, so the swarm must not add a
  // second mean line + SD caps on top of them.
  const isOverlay = !!(mark.box || mark.violin || mark.bar);
  // …and through a lone dot: the mean of one value is that value, so the line would only strike
  // through it (on the ranked dots, a bar through every row).
  const noMean = isOverlay || pts.length < 2;
  // A per-point `pointColor` override (the per-mark twin of the series' own `pointColor`) colours
  // this mark's dots, as used by the "Ranked dots vs a reference" gallery card. Keyed on that field
  // alone: a per-part `color`/`fill` must leave a swarm untouched — the raincloud's rain is
  // deliberately not targetable that way (its guard measures it).
  const own = mark.pointColor;
  // Reuse the shared Marker so the swarm dots honour the series' Shape (square/triangle/…),
  // open/two-tone interior fill (symbolFillColor) and outline, rather than a fixed filled
  // circle that would ignore all three.
  const dots = pts.map((p, i) => (
    <Marker
      key={i}
      shape={own_?.symbol ?? series.symbol}
      cx={p.cx}
      cy={p.cy}
      size={r}
      /**
       * The swarm's own colour when it has one. A raincloud's rain sits beside the violin it
       * shares `color` with, so without its own colour the dots could not be made to read
       * against the cloud.
       *
       * Note: it has to drive the outline and clear the two-tone interior as well, not just
       * `color`. The house rain is an open/two-tone marker, whose fill is a light tint of the
       * series hue and whose stroke is a dark one — so setting `color` alone would change
       * nothing visible (a guard checks this).
       */
      color={own ?? series.pointColor ?? series.color}
      fill={own_?.symbolFill ?? series.symbolFill}
      // A dot with its own colour and no bar under it (a bar series drawn as points — the ranked dots): the builder
      // works out that dot's two-tone interior and edge from its own colour (`mark.symbolFillColor` / `symbolOutline`).
      // Dropping them would draw hollow rings for a series set to two-tone.
      fillColor={own_?.symbolFillColor ?? (own ? mark.symbolFillColor : series.pointColor ? undefined : series.symbolFillColor)}
      opacity={own_?.symbolOpacity ?? series.symbolOpacity}
      outline={own && !own_ ? (mark.symbolOutline ?? own) : own ?? own_?.symbolOutline ?? series.pointColor ?? series.symbolOutline}
      // Note: `symbolBorderWidth` wins. This is the swarm drawn over a bar, and `borderWidth`
      // there is the bar's own contour width — sharing it would mean thickening a bar's outline
      // thickens every dot on it. Undefined for box/violin/scatter swarms, where the
      // marker is the series and inheriting `borderWidth` is correct.
      borderWidth={series.symbolBorderWidth ?? series.borderWidth}
    />
  ));
  /**
   * Without these, no swarm dot can be clicked at all.
   *
   * `Marker` is `pointer-events: none` (a label sitting over a dot must not be blocked by
   * it), and a `<g>` has no hit area of its own: only its painted children are hit-tested.
   * So the `onClick` on the wrapping group would be reachable only by the mean line (a 2.4px
   * stroke) and the SD caps. The non-categorical kinds draw an r=10 transparent hit circle
   * per mark for exactly this reason, but that block is gated `{!isCat && …}` — which
   * excludes every kind that swarms: column scatter, a raincloud's rain, the estimation
   * swarm, and the "show all points" overlay on a bar/box/violin.
   *
   * Without these circles, `document.elementFromPoint` at the centre of a dot returns the
   * plot background `<rect>`, which has no handler, so clicking a point would select
   * nothing — no Data tab, no Shape/Size/Colour.
   *
   * Caution: do not "fix" this by making `Marker` hit-testable: it is also drawn under value labels
   * and selection rings, which must stay click-through.
   */
  const hits = pts.map((p, i) => (
    <circle key={`hit-${i}`} cx={p.cx} cy={p.cy} r={Math.max(7, r + 3)} fill="transparent" />
  ));
  if (horizontal) {
    // Value runs along X; the swarm spreads vertically about the band centre cy.
    const half = Math.max(9, ...pts.map((p) => Math.abs(p.cy - mark.cy)));
    return (
      <g onMouseEnter={onHover} onClick={onClick} style={{ cursor: "pointer" }} {...tip}>
        {dots}
        {hits}
        {mark.errLowCx !== undefined && mark.errHighCx !== undefined && (
          <g stroke={meanColor} strokeWidth={errW} fill="none">
            <line x1={mark.errLowCx} x2={mark.errHighCx} y1={mark.cy} y2={mark.cy} />
            <line x1={mark.errHighCx} x2={mark.errHighCx} y1={mark.cy - half * 0.45} y2={mark.cy + half * 0.45} />
            <line x1={mark.errLowCx} x2={mark.errLowCx} y1={mark.cy - half * 0.45} y2={mark.cy + half * 0.45} />
          </g>
        )}
        {/* mean line (vertical, drawn last) — omitted when this is a box/violin overlay */}
        {!noMean && (
          <line className="gfx-scatter-mean" x1={mark.cx} x2={mark.cx} y1={mark.cy - half} y2={mark.cy + half} stroke={meanColor} strokeWidth={2.4} />
        )}
      </g>
    );
  }
  // Mean line / SD caps span the swarm's own width (min 9px each side).
  const half = Math.max(9, ...pts.map((p) => Math.abs(p.cx - mark.cx)));
  return (
    <g onMouseEnter={onHover} onClick={onClick} style={{ cursor: "pointer" }} {...tip}>
      {dots}
      {hits}
      {mark.errLowCy !== undefined && mark.errHighCy !== undefined && (
        <g stroke={meanColor} strokeWidth={errW} fill="none">
          <line x1={mark.cx} x2={mark.cx} y1={mark.errHighCy} y2={mark.errLowCy} />
          <line x1={mark.cx - half * 0.45} x2={mark.cx + half * 0.45} y1={mark.errHighCy} y2={mark.errHighCy} />
          <line x1={mark.cx - half * 0.45} x2={mark.cx + half * 0.45} y1={mark.errLowCy} y2={mark.errLowCy} />
        </g>
      )}
      {/* mean line (drawn last, on top) — omitted when this is a box/violin overlay */}
      {!noMean && (
        <line className="gfx-scatter-mean" x1={mark.cx - half} x2={mark.cx + half} y1={mark.cy} y2={mark.cy} stroke={meanColor} strokeWidth={2.4} />
      )}
    </g>
  );
}

// --- advanced fills (pattern / gradient / metallic) — the advanced fill suite ---

/** Multi-stop sheen presets for metallic / iridescent fills (objectBoundingBox gradients). */
const METALLIC_STOPS: Record<MetallicKind, string[]> = {
  gold: ["#7a5c00", "#d4af37", "#fff4c2", "#d4af37", "#9e7b14"],
  silver: ["#6b6b6b", "#cfcfcf", "#ffffff", "#bdbdbd", "#5a5a5a"],
  chrome: ["#3f4a52", "#b8c2cc", "#ffffff", "#8a97a3", "#2f3740"],
  bronze: ["#5a3a16", "#a9712f", "#e8c79a", "#a9712f", "#4d3214"],
  copper: ["#5a2d12", "#b87333", "#f1c9a5", "#b87333", "#5a2d12"],
  rosegold: ["#7d4b45", "#e8b4a8", "#fff0eb", "#e0a899", "#a86b66"],
  platinum: ["#8a8f94", "#dfe4e8", "#ffffff", "#c4cace", "#7d8388"],
  gunmetal: ["#23282e", "#5a6470", "#9aa6b3", "#4a525c", "#1c2025"],
  brass: ["#6b5618", "#b89b3e", "#f0e0a0", "#b89b3e", "#7a6320"],
  pearl: ["#d8cfe0", "#fbf6ff", "#ffffff", "#ede4f0", "#cfc4dd"],
  oilslick: ["#1a1030", "#3a1f6b", "#0f5f6b", "#6b1f5a", "#1a1030"],
  holographic: ["#ff4db8", "#7a5cff", "#3ad1ff", "#3affb0", "#ffe34d", "#ff4db8"],
};

/** Emit an SVG def per non-solid series fill, referenced by `url(#id)`. */
/** One <defs> entry for a non-solid FillSpec (pattern / gradient / metallic / special). */
function fillDef(f: FillSpec, id: string): ReactElement | null {
  if (f.type === "solid") return null;
  if (f.type === "pattern") {
    return <PatternDef key={id} id={id} pattern={f.pattern} color={f.color} bg={f.bg} scale={f.scale} />;
  }
  if (f.type === "gradient") {
    return (
      <linearGradient key={id} id={id} gradientUnits="objectBoundingBox" gradientTransform={`rotate(${f.angle} 0.5 0.5)`}>
        <stop offset="0%" stopColor={f.from} />
        <stop offset="100%" stopColor={f.to} />
      </linearGradient>
    );
  }
  if (f.type === "axisGradient") {
    // userSpaceOnUse + shared plot-x endpoints → every ridge samples the same axis-wide spectrum.
    return (
      <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={f.x1} y1={0} x2={f.x2} y2={0}>
        {f.stops.map((s, i) => (
          <stop key={i} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} />
        ))}
      </linearGradient>
    );
  }
  if (f.type === "special") return <SpecialDef key={id} id={id} kind={f.kind} />;
  const stops = METALLIC_STOPS[f.kind];
  return (
    <linearGradient key={id} id={id} gradientUnits="objectBoundingBox" gradientTransform="rotate(105 0.5 0.5)">
      {stops.map((c, i) => (
        <stop key={i} offset={`${(i / (stops.length - 1)) * 100}%`} stopColor={c} />
      ))}
    </linearGradient>
  );
}

function FillDefs({ series, idFor, markIdFor }: { series: SeriesScene[]; idFor: (sid: string) => string; markIdFor?: (sid: string, rowId: string) => string }) {
  return (
    <>
      {series.map((s) => fillDef(s.fillSpec, idFor(s.id)))}
      {/* per-mark fill shapes ("Format this bar") */}
      {markIdFor &&
        series.flatMap((s) =>
          s.marks.filter((m) => m.fillSpec).map((m) => fillDef(m.fillSpec!, markIdFor(s.id, m.rowId))),
        )}
    </>
  );
}

function PatternDef({
  id,
  pattern,
  color,
  bg,
  scale,
}: {
  id: string;
  pattern: PatternKind;
  color: string;
  bg: string | null;
  scale: number;
}) {
  const t = patternTile(pattern, color);
  return (
    <pattern id={id} width={t.w} height={t.h} patternUnits="userSpaceOnUse" patternTransform={`scale(${scale})`}>
      {bg ? <rect x={-1} y={-1} width={t.w + 2} height={t.h + 2} fill={bg} /> : null}
      {t.content}
    </pattern>
  );
}

/** Seamless tile geometry per pattern kind (foreground in `color`; density via patternTransform). */
export function patternTile(kind: PatternKind, color: string): { w: number; h: number; content: ReactNode } {
  const s = { stroke: color, strokeWidth: 1.4, fill: "none" as const };
  const f = { fill: color };
  switch (kind) {
    case "hatch":
      return { w: 8, h: 8, content: <path d="M0,8 L8,0 M-2,2 L2,-2 M6,10 L10,6" {...s} /> };
    case "hatch-cross":
      return {
        w: 8,
        h: 8,
        content: <path d="M0,8 L8,0 M-2,2 L2,-2 M6,10 L10,6 M0,0 L8,8 M-2,6 L2,10 M6,-2 L10,2" {...s} />,
      };
    case "horizontal":
      return { w: 8, h: 8, content: <path d="M0,2 H8 M0,6 H8" {...s} /> };
    case "vertical":
      return { w: 8, h: 8, content: <path d="M2,0 V8 M6,0 V8" {...s} /> };
    case "grid":
      return { w: 8, h: 8, content: <path d="M0,2 H8 M0,6 H8 M2,0 V8 M6,0 V8" {...s} /> };
    case "dots":
      return { w: 8, h: 8, content: <circle cx={4} cy={4} r={1.5} {...f} /> };
    case "dots-lg":
      return { w: 12, h: 12, content: <circle cx={6} cy={6} r={2.8} {...f} /> };
    case "rings":
      return { w: 12, h: 12, content: <circle cx={6} cy={6} r={3.5} {...s} /> };
    case "checker":
      return {
        w: 8,
        h: 8,
        content: (
          <>
            <rect width={4} height={4} {...f} />
            <rect x={4} y={4} width={4} height={4} {...f} />
          </>
        ),
      };
    case "squares":
      return { w: 8, h: 8, content: <rect x={2} y={2} width={4} height={4} {...f} /> };
    case "zigzag":
      return { w: 8, h: 8, content: <path d="M0,7 L4,1 L8,7" {...s} /> };
    case "chevron":
      return { w: 12, h: 8, content: <path d="M0,8 L6,2 L12,8" {...s} /> };
    case "waves":
      return { w: 12, h: 8, content: <path d="M0,4 Q3,0 6,4 T12,4" {...s} /> };
    case "scales":
      return { w: 12, h: 6, content: <path d="M0,6 A6,6 0 0 1 12,6 M-6,6 A6,6 0 0 1 6,6 M6,6 A6,6 0 0 1 18,6" {...s} /> };
    case "triangles":
      return { w: 8, h: 8, content: <path d="M4,1 L7,7 L1,7 Z" {...f} /> };
    case "diamond":
      return { w: 8, h: 8, content: <path d="M4,0 L8,4 L4,8 L0,4 Z" {...s} /> };
    case "herringbone":
      return { w: 8, h: 8, content: <path d="M0,0 L4,4 M4,0 L8,4 M0,4 L4,8 M4,4 L8,8" {...s} /> };
    case "basketweave":
      return {
        w: 8,
        h: 8,
        content: (
          <>
            <rect x={0.5} y={0.5} width={3} height={7} {...s} />
            <rect x={4.5} y={0.5} width={3} height={3} {...s} />
            <rect x={4.5} y={4.5} width={3} height={3} {...s} />
          </>
        ),
      };
    case "brick":
      return { w: 16, h: 8, content: <path d="M0,0 H16 M0,4 H16 M0,8 H16 M8,0 V4 M0,4 V8 M16,4 V8" {...s} /> };
    case "plus":
      return { w: 10, h: 10, content: <path d="M5,2 V8 M2,5 H8" {...s} /> };
    case "crosses":
      return { w: 10, h: 10, content: <path d="M2,2 L8,8 M8,2 L2,8" {...s} /> };
    case "stipple":
      return {
        w: 12,
        h: 12,
        content: (
          <g {...f}>
            <circle cx={2} cy={3} r={1} />
            <circle cx={8} cy={2} r={1} />
            <circle cx={5} cy={7} r={1} />
            <circle cx={10} cy={9} r={1} />
            <circle cx={3} cy={10} r={1} />
          </g>
        ),
      };
  }
}

/** Themed / special-effect fill defs (composites of gradient bg + decorative pattern). */
function SpecialDef({ id, kind }: { id: string; kind: SpecialKind }) {
  const g = `${id}-g`; // paired gradient id for composites
  switch (kind) {
    case "sunset":
      return (
        <linearGradient id={id} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
          {["#2b1055", "#7f1d6b", "#ff5e62", "#ffb347"].map((c, i, a) => (
            <stop key={i} offset={`${(i / (a.length - 1)) * 100}%`} stopColor={c} />
          ))}
        </linearGradient>
      );
    case "facets":
      return (
        <pattern id={id} width={16} height={16} patternUnits="userSpaceOnUse">
          <polygon points="0,0 16,0 8,8" fill="#f94d6a" />
          <polygon points="16,0 16,16 8,8" fill="#ffb54d" />
          <polygon points="16,16 0,16 8,8" fill="#4dd0a0" />
          <polygon points="0,16 0,0 8,8" fill="#5d8cff" />
        </pattern>
      );
    case "cards":
      return (
        <pattern id={id} width={16} height={16} patternUnits="userSpaceOnUse">
          <rect width={16} height={16} fill="#f6efe0" />
          <path d="M8,0 L16,8 L8,16 L0,8 Z" fill="none" stroke="#9c2b2b" strokeWidth={1.1} />
          <path d="M0,0 L4,4 M16,0 L12,4 M0,16 L4,12 M16,16 L12,12" stroke="#9c2b2b" strokeWidth={1.1} />
          <circle cx={8} cy={8} r={1.3} fill="#9c2b2b" />
        </pattern>
      );
    case "night":
      return (
        <>
          <linearGradient id={g} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a1230" />
            <stop offset="100%" stopColor="#02040d" />
          </linearGradient>
          <pattern id={id} width={22} height={22} patternUnits="userSpaceOnUse">
            <rect width={22} height={22} fill={`url(#${g})`} />
            <g fill="#ffffff">
              <circle cx={4} cy={5} r={0.8} />
              <circle cx={15} cy={3} r={1.1} opacity={0.9} />
              <circle cx={19} cy={12} r={0.7} />
              <circle cx={9} cy={14} r={0.9} />
              <circle cx={3} cy={18} r={0.6} opacity={0.8} />
              <circle cx={13} cy={19} r={0.8} />
            </g>
            <path d="M17,8 l0.6,1.4 1.4,0.6 -1.4,0.6 -0.6,1.4 -0.6,-1.4 -1.4,-0.6 1.4,-0.6 Z" fill="#fff7d6" />
          </pattern>
        </>
      );
    case "stars":
      return (
        <pattern id={id} width={26} height={26} patternUnits="userSpaceOnUse">
          <rect width={26} height={26} fill="#121a33" />
          <polygon points={starPoints(7, 7, 4, 1.7, 5)} fill="#ffd24d" />
          <polygon points={starPoints(19, 14, 3, 1.3, 5)} fill="#ffffff" />
          <polygon points={starPoints(12, 21, 2.6, 1.1, 5)} fill="#9ad0ff" />
        </pattern>
      );
    case "galaxy":
      return (
        <>
          <linearGradient id={g} gradientUnits="objectBoundingBox" gradientTransform="rotate(40 0.5 0.5)">
            <stop offset="0%" stopColor="#1a0440" />
            <stop offset="50%" stopColor="#5e1b8c" />
            <stop offset="100%" stopColor="#0a0420" />
          </linearGradient>
          <pattern id={id} width={30} height={30} patternUnits="userSpaceOnUse">
            <rect width={30} height={30} fill={`url(#${g})`} />
            <circle cx={10} cy={9} r={7} fill="#c64bd6" opacity={0.22} />
            <circle cx={22} cy={20} r={6} fill="#4b8fd6" opacity={0.22} />
            <g fill="#ffffff">
              <circle cx={5} cy={5} r={0.8} />
              <circle cx={17} cy={4} r={0.6} />
              <circle cx={26} cy={11} r={0.9} />
              <circle cx={13} cy={16} r={0.6} />
              <circle cx={8} cy={24} r={0.8} />
              <circle cx={24} cy={27} r={0.7} />
            </g>
          </pattern>
        </>
      );
    case "ocean":
      return (
        <>
          <linearGradient id={g} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a4d8c" />
            <stop offset="100%" stopColor="#3aa0d0" />
          </linearGradient>
          <pattern id={id} width={16} height={10} patternUnits="userSpaceOnUse">
            <rect width={16} height={10} fill={`url(#${g})`} />
            <path d="M0,5 Q4,1 8,5 T16,5" fill="none" stroke="#dff3ff" strokeWidth={1.1} opacity={0.55} />
          </pattern>
        </>
      );
    case "carbon":
      return (
        <pattern id={id} width={8} height={8} patternUnits="userSpaceOnUse">
          <rect width={8} height={8} fill="#1b1b1b" />
          <rect x={0} y={0} width={4} height={4} fill="#2c2c2c" />
          <rect x={4} y={4} width={4} height={4} fill="#2c2c2c" />
          <path d="M0,4 L4,0 M4,8 L8,4" stroke="#3c3c3c" strokeWidth={1} fill="none" />
        </pattern>
      );
    case "honeycomb":
      return (
        <pattern id={id} width={24} height={14} patternUnits="userSpaceOnUse">
          <rect width={24} height={14} fill="#fff8e1" />
          <g fill="none" stroke="#e0a92e" strokeWidth={1.3}>
            <path d="M6,0 L2,3.5 L2,10.5 L6,14 M6,0 L10,3.5 L10,10.5 L6,14" />
            <path d="M18,0 L14,3.5 L14,10.5 L18,14 M18,0 L22,3.5 L22,10.5 L18,14" />
            <path d="M10,3.5 L14,3.5 M10,10.5 L14,10.5 M2,3.5 L-2,3.5 M22,3.5 L26,3.5" />
          </g>
        </pattern>
      );
    case "bubbles":
      return (
        <pattern id={id} width={24} height={24} patternUnits="userSpaceOnUse">
          <rect width={24} height={24} fill="#e6f7ff" />
          <g fill="none" stroke="#6fc8ec" strokeWidth={1.2}>
            <circle cx={6} cy={7} r={4} />
            <circle cx={17} cy={14} r={5.5} />
            <circle cx={20} cy={4} r={2.5} />
            <circle cx={8} cy={19} r={3} />
          </g>
          <circle cx={4.5} cy={5.5} r={1} fill="#ffffff" />
          <circle cx={15} cy={11.5} r={1.3} fill="#ffffff" />
        </pattern>
      );
    case "confetti":
      return (
        <pattern id={id} width={26} height={26} patternUnits="userSpaceOnUse">
          <rect width={26} height={26} fill="#ffffff" />
          <rect x={3} y={4} width={4} height={2.5} fill="#ff5d8f" transform="rotate(25 5 5)" />
          <rect x={16} y={3} width={4} height={2.5} fill="#ffd24d" transform="rotate(-20 18 4)" />
          <rect x={20} y={15} width={4} height={2.5} fill="#5dd6a0" transform="rotate(40 22 16)" />
          <rect x={8} y={18} width={4} height={2.5} fill="#5d9eff" transform="rotate(-35 10 19)" />
          <circle cx={13} cy={12} r={1.6} fill="#b07cff" />
          <circle cx={23} cy={23} r={1.4} fill="#ff5d8f" />
        </pattern>
      );
    case "camo":
      return (
        <pattern id={id} width={28} height={28} patternUnits="userSpaceOnUse">
          <rect width={28} height={28} fill="#9a8f6a" />
          <path d="M0,4 q6,-4 12,0 q4,5 -2,9 q-8,2 -10,-3 Z" fill="#5f6b3c" />
          <path d="M16,2 q8,0 10,6 q-2,6 -8,5 q-6,-3 -2,-11 Z" fill="#6e5a3a" />
          <path d="M4,18 q7,-2 11,3 q1,6 -7,6 q-7,-1 -4,-9 Z" fill="#3f4a2a" />
          <path d="M20,18 q6,1 7,6 q-4,4 -9,1 q-3,-5 2,-7 Z" fill="#5f6b3c" />
        </pattern>
      );
  }
}

/** Render one datapoint marker by shape (solid / open / clear · opacity · outline). Decorative — no pointer events. */
/** Exported so the figure assembler's merged legend draws the exact same marker shapes as
 *  the per-panel legends it replaces. */
export function Marker({
  shape,
  cx,
  cy,
  size,
  color,
  fill: fillMode,
  fillColor,
  opacity,
  outline,
  borderWidth,
}: {
  shape: SeriesScene["symbol"];
  cx: number;
  cy: number;
  size: number;
  color: string;
  fill: SeriesScene["symbolFill"];
  /** Interior fill for an open marker; undefined = page colour (the hollow look). */
  fillColor?: string | undefined;
  opacity: number;
  outline: string;
  borderWidth: number;
}) {
  if (shape === "none") return null;
  // solid → series colour; open → a chosen fill colour or the page colour (hides
  // behind — the two-tone look when fillColor is lighter than the outline);
  // clear → transparent (see-through).
  const fill = fillMode === "solid" ? color : fillMode === "open" ? (fillColor ?? "var(--bg)") : "none";
  // A visible outline reads at the symbol's border thickness; solid keeps a hairline if equal-coloured.
  const sw = fillMode === "solid" ? Math.max(0.75, borderWidth * 0.67) : borderWidth;
  const common = {
    fill,
    fillOpacity: opacity,
    stroke: outline,
    strokeOpacity: opacity,
    strokeWidth: sw,
    pointerEvents: "none" as const,
  };
  if (shape === "circle") return <circle cx={cx} cy={cy} r={size} {...common} />;
  if (shape === "square") {
    return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} {...common} />;
  }
  if (shape === "diamond") {
    const s = size * 1.3;
    return <polygon points={`${cx},${cy - s} ${cx + s * 0.85},${cy} ${cx},${cy + s} ${cx - s * 0.85},${cy}`} {...common} />;
  }
  if (shape === "triangle") return <polygon points={regularPoints(cx, cy, size * 1.3, 3, 0)} {...common} />;
  if (shape === "triangle-down") {
    return <polygon points={regularPoints(cx, cy, size * 1.3, 3, Math.PI)} {...common} />;
  }
  if (shape === "pentagon") return <polygon points={regularPoints(cx, cy, size * 1.2, 5, 0)} {...common} />;
  if (shape === "hexagon") return <polygon points={regularPoints(cx, cy, size * 1.15, 6, 0)} {...common} />;
  // Turned an eighth of a side so it sits flat on top and bottom, like a stop sign: standing on
  // a point, eight corners read as a circle at point size.
  if (shape === "octagon") return <polygon points={regularPoints(cx, cy, size * 1.15, 8, Math.PI / 8)} {...common} />;
  if (shape === "star") return <polygon points={starPoints(cx, cy, size * 1.35, size * 0.55, 5)} {...common} />;
  // ── Four further shapes: each distinguishable from the ten above without colour. ──
  if (shape === "ring") {
    // An annulus: outer edge + a hole of ~45 % — two edges read at 5 px where a disc reads as
    // a circle. Even-odd fill so the hole is really open (page shows through), in every fill mode.
    const R = size * 1.15, r = size * 0.5;
    const d = `M${cx - R},${cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 Z M${cx - r},${cy} a${r},${r} 0 1,0 ${2 * r},0 a${r},${r} 0 1,0 ${-2 * r},0 Z`;
    return <path d={d} fillRule="evenodd" {...common} />;
  }
  if (shape === "squircle") {
    // A superellipse |x|⁴ + |y|⁴ = 1 standing on a corner: rounder than a diamond, flatter-sided
    // than a circle, and unlike a rounded rect its
    // curvature never goes to zero — 32 samples is smooth at any size.
    const R = size * 1.3;
    const pts = Array.from({ length: 32 }, (_, k) => {
      const t = (k * 2 * Math.PI) / 32;
      const c = Math.cos(t), sn = Math.sin(t);
      const x = R * Math.sign(c) * Math.sqrt(Math.abs(c)), y = R * Math.sign(sn) * Math.sqrt(Math.abs(sn));
      const q = Math.SQRT1_2; // rotate 45°
      return `${(cx + (x - y) * q).toFixed(2)},${(cy + (x + y) * q).toFixed(2)}`;
    }).join(" ");
    return <polygon points={pts} {...common} />;
  }
  if (shape === "oval") {
    // Leaning 40° to the right — an upright oval reads as a squashed
    // circle at 5 px; the lean is what makes it a different shape.
    return <ellipse cx={cx} cy={cy} rx={size * 1.45} ry={size * 0.8} transform={`rotate(-40 ${cx} ${cy})`} {...common} />;
  }
  if (shape === "waffle") {
    // A square with four small square windows (2 × 2): even-odd holes,
    // so the page shows through them in every fill mode and their edges are stroked like the
    // outer edge. (A checkerboard is not the same shape.)
    const s = size * 1.1, h = size * 0.24, o = size * 0.46;
    const sq = (x: number, y: number, r: number) => `M${x - r},${y - r} h${2 * r} v${2 * r} h${-2 * r} Z`;
    const outer = sq(cx, cy, s);
    const windows = sq(cx - o, cy - o, h) + sq(cx + o, cy - o, h) + sq(cx - o, cy + o, h) + sq(cx + o, cy + o, h);
    // Each edge gets its own line width, capped to the shape: at 3 px a window is ~1.4 px wide,
    // so the full outline would fill it in and the outer line would meet the window lines,
    // making an open 3 px waffle read as a dark square with a white cross. The caps keep every window mostly
    // open and the band inside the outer edge visible; from ~5 px up the outer line is unchanged.
    const outerSw = Math.min(common.strokeWidth, s * 0.28);
    const windowSw = Math.min(common.strokeWidth, 2 * h * 0.35);
    return (
      <g pointerEvents="none">
        <path d={outer + windows} fillRule="evenodd" {...common} stroke="none" />
        <path d={outer} {...common} fill="none" strokeWidth={outerSw} />
        <path d={windows} {...common} fill="none" strokeWidth={windowSw} />
      </g>
    );
  }
  // plus / cross — stroked glyphs (no fill); use the symbol colour, not the outline override.
  const w = Math.max(1.6, borderWidth);
  const d =
    shape === "plus"
      ? `M${cx - size * 1.2},${cy} H${cx + size * 1.2} M${cx},${cy - size * 1.2} V${cy + size * 1.2}`
      : `M${cx - size},${cy - size} L${cx + size},${cy + size} M${cx - size},${cy + size} L${cx + size},${cy - size}`;
  return (
    <path d={d} stroke={color} strokeOpacity={opacity} strokeWidth={w} fill="none" strokeLinecap="round" pointerEvents="none" />
  );
}

/**
 * A heatmap cell/mark edge. A width with no chosen colour is a gap in the page colour — the neutral
 * line between tiles that keeps each colour from being judged against its neighbours. So the width
 * slider takes effect even before a colour is picked.
 */
function heatBorderStroke(border: { color: string | null; width: number }): string {
  return border.color ?? (border.width > 0 ? "var(--bg)" : "none");
}

/** Vertices of a regular n-gon (point up at angle a0), as an SVG points string. */
function regularPoints(cx: number, cy: number, r: number, n: number, a0: number): string {
  return Array.from({ length: n }, (_, k) => {
    const a = a0 + (k * 2 * Math.PI) / n;
    return `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  }).join(" ");
}

/** Vertices of an m-point star (alternating outer/inner radii). */
function starPoints(cx: number, cy: number, outer: number, inner: number, m: number): string {
  return Array.from({ length: m * 2 }, (_, k) => {
    const a = (k * Math.PI) / m;
    const r = k % 2 === 0 ? outer : inner;
    return `${(cx + r * Math.sin(a)).toFixed(2)},${(cy - r * Math.cos(a)).toFixed(2)}`;
  }).join(" ");
}

/** A number as a hover shows it: six significant figures, no trailing zeros. */
export const tipNum = (n: number): string => Number(n.toPrecision(6)).toString();
/** A value read back off pixels (a curve corner, a radar vertex, a parallel crossing): four
 *  significant figures — the pixel grid cannot carry more, and more prints noise ("8.0002"). */
export const tipRead = (n: number): string => Number(n.toPrecision(4)).toString();

/**
 * What hovering a series mark says — the in-app hover box and the interactive HTML export read
 * this one list, so the two can never disagree.
 */
export function markTipLines(scene: PlotScene, mark: MarkScene, series: SeriesScene): string[] {
  const n = mark.n ?? 1;
  const lines = [
    series.name,
    `${scene.axisLabels.x}: ${mark.label ?? tipNum(mark.dx)}`,
    `${n > 1 ? "mean" : series.name}: ${tipNum(mark.dy)}`,
  ];
  if (n > 1) lines.push(`n = ${n}`);
  if (mark.errLow !== undefined && mark.errHigh !== undefined) {
    lines.push(`[${tipNum(mark.errLow)}, ${tipNum(mark.errHigh)}]`);
  }
  // A series borrowed from another datasheet names that sheet — "row 2" alone would send the
  // reader to the wrong table.
  lines.push(series.from ? `row ${mark.rowNumber} of ${series.from.name}` : `row ${mark.rowNumber}`);
  return lines;
}

/**
 * The corners of an SVG path (absolute M / L / H / V, and the end point of C / S / Q / T), at
 * most `max` of them, evenly thinned. Hover spots only — not a general path parser.
 */
export function pathCorners(d: string, max: number): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  const re = /([MLHVCSQTZ])([^MLHVCSQTZmlhvcsqtz]*)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    const nums = (m[2]!.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const cmd = m[1]!;
    if (cmd === "H") { for (const n of nums) { x = n; out.push([x, y]); } continue; }
    if (cmd === "V") { for (const n of nums) { y = n; out.push([x, y]); } continue; }
    if (cmd === "Z") continue;
    const step = cmd === "C" ? 6 : cmd === "S" || cmd === "Q" ? 4 : 2;
    for (let i = 0; i + step <= nums.length; i += step) {
      x = nums[i + step - 2]!;
      y = nums[i + step - 1]!;
      out.push([x, y]);
    }
  }
  if (out.length <= max) return out;
  const every = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.min(out.length - 1, Math.round(i * every))]!);
}

/** The legend's name for a series id, when a legend row names it (hover text only). */
function legendNameOf(scene: PlotScene, id: string): string | undefined {
  return scene.legend.find((e) => e.select?.id === id)?.label;
}

/**
 * Hover text for the interactive HTML export: the element carries it as `data-mady-tip` and the
 * exported page shows it as a tooltip, one line per entry. No effect in the app. Put it on an
 * element the mouse can reach — a tip on a group whose children all ignore the pointer is never
 * hovered (`hover-values.test.tsx`).
 */
export function madyTip(lines: ReadonlyArray<string | number | null | undefined | false>): { "data-mady-tip": string } {
  return { "data-mady-tip": lines.filter((l) => l !== null && l !== undefined && l !== false && l !== "").map(String).join("\n") };
}

function Tooltip({
  scene,
  hover,
}: {
  scene: PlotScene;
  hover: { mark: MarkScene; series: SeriesScene };
}) {
  const { mark, series } = hover;
  const lines = markTipLines(scene, mark, series);
  const padX = 8;
  const lineH = 15;
  const w = Math.max(...lines.map((l) => l.length)) * 6.3 + padX * 2;
  const h = lines.length * lineH + 8;
  const left = mark.cx + 12 + w > scene.width ? mark.cx - 12 - w : mark.cx + 12;
  const top = Math.min(Math.max(mark.cy - h / 2, 2), scene.height - h - 2);

  return (
    /* `gfx-tooltip` names it in the DOM: this is transient hover UI, not part of the figure, and
       anything reading the drawing's text has to be able to tell the difference. Without it a
       check that every text is editable would pick the readout up mid-hover and report "a text that cannot be
       edited" — for a block that only exists while the pointer is over a mark. */
    <g className="gfx-tooltip" pointerEvents="none">
      <rect x={left} y={top} width={w} height={h} rx={5} fill="var(--bg-3)" stroke="var(--line-2)" />
      <text x={left + padX} y={top + 16} fontSize={11} fill="var(--ink)">
        {lines.map((l, i) => (
          <tspan key={i} x={left + padX} dy={i === 0 ? 0 : lineH} fontWeight={i === 0 ? 600 : 400}>
            {l}
          </tspan>
        ))}
      </text>
    </g>
  );
}
