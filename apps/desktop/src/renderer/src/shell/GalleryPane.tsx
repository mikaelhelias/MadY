/**
 * GalleryPane — the Chart-gallery tab. Two jobs:
 *
 *  1. **Live style preview.** A shared style panel (palette / line width / marker
 *     size / font) re-renders all cards at once, so a style change shows across
 *     every chart family in one glance.
 *  2. **Card → editable graph.** Clicking a card materialises that chart type —
 *     with the current gallery styling baked in — as a real dataset + graph in
 *     the document (via `onOpen`), where the full inspector takes over.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { buildPlotScene, ddColorMode, PALETTES, parallelColoursByValue } from "@mady/graphics";
import type { DataTable, FontElement, GradRamp, Plot, SeriesStyle } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { measureText } from "./textMeasure";
import { FIGURE_DEFAULT_H, FIGURE_DEFAULT_W } from "./figureFit";
import { GALLERY_FAMILIES, galleryItems, galleryLookup, type GalleryItem } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { HEATMAP_COLORMAPS } from "./Inspector";

const FONTS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Default (system)", value: "" },
  { label: "Sans (Arial)", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif (Georgia)", value: 'Georgia, "Times New Roman", serif' },
  { label: "Mono", value: '"Courier New", ui-monospace, monospace' },
];
const FONT_ELEMENTS: FontElement[] = ["title", "subtitle", "axisTitle", "tick", "legend"];

export interface GalleryStyle {
  /** Key into PALETTES, or "" = leave every card its own default palette. */
  palette: string;
  /**
   * A built-in colour ramp (the heatmap's Colormap list), or "" = leave every card its own.
   * A palette is separate colours and cannot reach a continuous ramp — heatmaps, numeric tracks,
   * colour-by-value — so the ramp has its own control.
   */
  ramp: string;
  /** 0 = leave every series its own line width. Anything else overrides all of them. */
  lineWidth: number;
  /** 0 = leave every kind its own default (see below). Anything else overrides all of them. */
  markerSize: number;
  fontFamily: string;
}
/**
 * Every control starts at default = pass-through, and that is the point.
 *
 * `markerSize: 0`: a fixed override (e.g. 9px) would be baked into every preview, so the card
 * would be wrong about the one thing it exists to show.
 *
 * `palette` and `lineWidth` likewise: a forced palette or line width would draw every card's
 * traces and bars differently from a real new graph of the same kind. Untouched style controls
 * must change nothing; guarded by the pass-through case in `one-default-look.test.ts`.
 */
export const DEFAULT_STYLE: GalleryStyle = {
  palette: "",
  ramp: "",
  lineWidth: 0,
  markerSize: 0,
  fontFamily: "",
};

/** Lead Y datasets of a gallery table (role "y", not a replicate subcolumn). */
function leadYColumns(table: DataTable): string[] {
  return table.columns.filter((c) => c.role === "y" && !c.group).map((c) => c.id);
}

/** Clone a card's plot with the gallery style applied (so the card and the graph
 * it becomes share one look). Each control overrides only once moved off "Default" —
 * untouched controls return the plot untouched, so the card draws the true
 * default (see DEFAULT_STYLE above). */
export function styledPlot(item: GalleryItem, style: GalleryStyle): Plot {
  const palette = style.palette ? PALETTES[style.palette] : undefined;
  const ramp = (style.ramp || undefined) as GradRamp | undefined;
  if (!palette && !ramp && style.lineWidth <= 0 && style.markerSize <= 0 && !style.fontFamily) return item.plot;
  const seriesStyles: Record<string, SeriesStyle> = { ...(item.plot.seriesStyles ?? {}) };
  leadYColumns(item.table).forEach((id, i) => {
    seriesStyles[id] = {
      ...(seriesStyles[id] ?? {}),
      ...(palette ? { color: palette[i % palette.length]! } : {}),
      ...(style.lineWidth > 0 ? { lineWidth: style.lineWidth } : {}),
      ...(style.markerSize > 0 ? { symbolSize: style.markerSize } : {}),
    };
  });
  const fonts = style.fontFamily
    ? (Object.fromEntries(FONT_ELEMENTS.map((el) => [el, { family: style.fontFamily }])) as Plot["fonts"])
    : item.plot.fonts;
  const out: Plot = { ...item.plot, seriesStyles, ...(fonts ? { fonts } : {}) };
  return ramp ? withRamp(out, item.table, ramp) : out;
}

/** Ramps derived from a series' own colour (lighter / fainter shades) — the palette drives those. */
const DERIVED_RAMPS = new Set(["lightness", "transparency", "lightness-transparency", "twocolor"]);

/**
 * Every continuous colour ramp a plot draws, set to `ramp` — each named here, so the gallery
 * control reaches exactly these and nothing else (`gallery-ramp-control.test.ts` checks both on
 * the drawing): heatmap cells and their numeric annotation strips, numeric tracks, colour-by-value
 * on any series, graduated fills that use a named ramp, parallel coordinates' value colouring, and
 * the ridgeline's spectrum fill when it is on.
 */
function withRamp(plot: Plot, table: DataTable, ramp: GradRamp): Plot {
  const out: Plot = { ...plot };
  // By kind as well as by setting: a card drawn on its defaults has no settings object to find.
  if (plot.heatmap || plot.kind === "heatmap") {
    const h = plot.heatmap ?? {};
    out.heatmap = {
      ...h,
      colormap: ramp,
      ...(h.rowTracks ? { rowTracks: h.rowTracks.map((t) => ({ ...t, ramp })) } : {}),
      ...(h.colTracks ? { colTracks: h.colTracks.map((t) => ({ ...t, ramp })) } : {}),
    };
  }
  if (plot.tracks || plot.kind === "tracks") out.tracks = { ...(plot.tracks ?? {}), colormap: ramp };
  // The builder's own rules decide where a ramp is drawn — a category colouring has none to set.
  if (plot.parallel && parallelColoursByValue(table, plot)) out.parallel = { ...plot.parallel, colorRamp: ramp };
  if (plot.ridgeline?.spectrum) out.ridgeline = { ...plot.ridgeline, spectrumMap: ramp };
  if (out.seriesStyles) {
    out.seriesStyles = Object.fromEntries(
      Object.entries(out.seriesStyles).map(([id, st]) => {
        const next: SeriesStyle = { ...st };
        const byValue = st.colorFromColumn ? ddColorMode(st, table, st.colorFromColumn) === "continuous" : Boolean(st.colorFromRamp);
        if (byValue) next.colorFromRamp = ramp;
        if (st.gradRamp && !DERIVED_RAMPS.has(st.gradRamp)) next.gradRamp = ramp;
        return [id, next];
      }),
    );
  }
  return out;
}

export function GalleryPane({
  onOpen,
  figureFit,
}: {
  /** Materialise a gallery card as a real dataset + graph. */
  onOpen?: (table: DataTable, plot: Plot, title: string, extraTables?: DataTable[]) => void;
  /**
   * The size an unsized figure is drawn at in this window (`fitFigureSize`), or null for the
   * renderer's own default. The card is built at exactly that size and then scaled down by the
   * SVG's viewBox — see below.
   */
  figureFit?: { width: number; height: number } | null | undefined;
}) {
  const items = galleryItems();
  /**
   * The card is built at the final figure size, not at card size, and the browser scales it
   * down. Building at card size is not a simple resize: the proportions change, so the card would
   * not show the exact final style of the graph. The difference is large: building at a card size such as
   * 360×250 while the real figure is 580×380 leaves every margin, tick font and title band at its fixed
   * pixel size, so they take roughly twice the share of a card that they take of a figure.
   * The plot area would take a much smaller share of the card than of the real figure, its
   * shape would be off on many kinds, and `paireddot` would collapse to a one-pixel plot area.
   *
   * Building at the real size makes the card the real figure: `PlotFigure` already gives every
   * <svg> `viewBox="0 0 w h"` with `max-width:100%; height:auto`, so the card slot shrinks it
   * uniformly — every proportion is exactly the final one because it is the final one. The cost
   * is unavoidable: at a ~330px card the type renders at ~0.57×.
   *
   * The default size and not the window fit: the fit is a uniform scale of the graph, never a bigger
   * layout, so a new graph is laid out at 580 × 380 like this card — and the card
   * slot's own shrink is the same uniform scale.
   */
  void figureFit;
  const figureSize = { width: FIGURE_DEFAULT_W, height: FIGURE_DEFAULT_H };
  const [style, setStyle] = useState<GalleryStyle>(DEFAULT_STYLE);
  const set = <K extends keyof GalleryStyle>(k: K, v: GalleryStyle[K]) =>
    setStyle((s) => ({ ...s, [k]: v }));

  return (
    <div>
      <h2 className="h" style={{ margin: "0 0 4px" }}>
        Chart gallery
      </h2>
      <p className="note" style={{ fontSize: 12, margin: "0 0 12px" }}>
        One synthetic example per chart type — {items.length} cards in {GALLERY_FAMILIES.length} groups. Adjust the style
        controls below to see a change on <em>every</em> type at once — then click a card to open it as
        a real, editable graph.
      </p>

      <div className="gallerybar">
        <label>
          Palette{" "}
          <select aria-label="Palette" value={style.palette} onChange={(e) => set("palette", e.target.value)}>
            <option value="">Default (each card's own)</option>
            {Object.keys(PALETTES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Colour ramp{" "}
          <select aria-label="Colour ramp" value={style.ramp} onChange={(e) => set("ramp", e.target.value)}>
            <option value="">Default (each card's own)</option>
            {HEATMAP_COLORMAPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Line width <span className="galleryval">{style.lineWidth > 0 ? style.lineWidth.toFixed(1) : "Default"}</span>
          <input
            type="range"
            aria-label="Line width"
            // 0 is a mode, not a width — "leave each series its own", same as Marker size.
            min={0}
            max={5}
            step={0.5}
            value={style.lineWidth}
            onChange={(e) => set("lineWidth", Number(e.target.value))}
          />
        </label>
        <label>
          Marker size <span className="galleryval">{style.markerSize > 0 ? style.markerSize : "Default"}</span>
          <input
            type="range"
            aria-label="Marker size"
            // 0 is a mode, not a size — it sits below the usable range and means "leave each
            // kind its own". Dragging off it engages the override for every card at once.
            min={0}
            // 24 = the Inspector's own symbolSize ceiling, so the slider can represent every
            // size a card can have (the house bar default is 14); a lower maximum would pin the
            // thumb and clamp those cards on the first touch.
            max={24}
            step={1}
            value={style.markerSize}
            onChange={(e) => set("markerSize", Number(e.target.value))}
          />
        </label>
        <label>
          Font{" "}
          <select aria-label="Font" value={style.fontFamily} onChange={(e) => set("fontFamily", e.target.value)}>
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn-ghost" onClick={() => setStyle(DEFAULT_STYLE)}>
          Reset style
        </button>
      </div>

      {/* One section per family, in GALLERY_FAMILIES order; the cards inside keep GALLERY_ORDER. */}
      {GALLERY_FAMILIES.map((family) => {
        const group = items.filter((it) => it.family === family);
        if (group.length === 0) return null;
        return (
          <section key={family} className="gallerysection" aria-label={family}>
            <h3 className="gallerysection-h">
              {family} <span className="gallerysection-n">{group.length}</span>
            </h3>
            <div className="gallerygrid">{group.map(renderCard)}</div>
          </section>
        );
      })}
    </div>
  );

  function renderCard(it: GalleryItem): ReactElement {
          const plot = styledPlot(it, style);
          const scene = buildPlotScene(it.table, plot, {
            measure: measureText,
            // A card that ships a second sheet (its plot borrows a series from it) resolves
            // that sheet here, so the card shows the composite it promises.
            tables: galleryLookup(it),
            // A plot's own size wins over the fit — the same rule the real graph pane applies
            // (`panes.tsx`). Without it a card that declares a size (the paired dot needs a
            // wide figure for its twelve long row labels) previewed at a size it never gets.
            width: plot.figureWidth ?? figureSize.width,
            height: plot.figureHeight ?? figureSize.height,
            // Same rule as the real graph pane: the gallery's control wins when moved,
            // else the plot's own palette resolution (preset colours > named choice).
            ...(style.palette && PALETTES[style.palette]
              ? { palette: PALETTES[style.palette]! }
              : scenePaletteOpt(plot)),
          });
          return (
            <button
              key={it.key}
              type="button"
              className="gallerycard"
              title="Open as an editable graph"
              onClick={() => onOpen?.(it.table, plot, it.title, it.extraTables)}
            >
              <div className="gallerycard-h">{it.title}</div>
              <div className="note" style={{ fontSize: 11, marginBottom: 8 }}>
                {it.note}
              </div>
              {/* The figure is a preview only: disable its own pan/zoom/select
                  handlers so every click anywhere on the card reaches the button. */}
              <div className="gallerycard-fig">
                <PlotFigure scene={scene} />
              </div>
              <div className="gallerycard-cta">Open as editable graph →</div>
            </button>
          );
  }
}
