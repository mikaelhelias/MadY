/**
 * Figure layout presets — the table-format-style picker's catalog: the layout is
 * selectable by the user, the way one chooses a table format.
 *
 * A preset is a pure shape: a column count plus per-slot column/row spans, where slot i
 * is the i-th panel in the figure's `panels` order (the A/B/C lettering order — the same
 * order the aligned grid packs by). Graphs are never reassigned; the shape is.
 *
 * `packGrid` is the occupancy packing algorithm — the aligned grid in panes.tsx and the
 * picker thumbnails both call it, so a thumbnail can never promise a tiling the grid
 * won't produce.
 */

export interface LayoutPresetCell {
  c: number;
  r: number;
  cs: number;
  rs: number;
}

export interface LayoutPreset {
  /** Short display name ("Tall left"). Unique within one catalog. */
  name: string;
  columns: number;
  /** Per-slot COLUMN spans (index = position in `panels` order); missing/1 = plain cell. */
  span?: number[];
  /** Per-slot ROW spans; same indexing. */
  rowSpan?: number[];
  /** The resolved tiling (grid units), one cell per slot — drives the thumbnail. */
  cells: LayoutPresetCell[];
}

/**
 * Rowspan-aware occupancy packing (like an HTML table): each item takes the first free
 * cell in reading order that can hold its colSpan×rowSpan footprint and marks that
 * footprint occupied. With every item 1×1 this reduces exactly to `index % cols`.
 */
export function packGrid(items: { cs: number; rs: number }[], cols: number): { c: number; r: number }[] {
  const occupied = new Set<string>();
  const free = (c0: number, r0: number, cs: number, rs: number): boolean => {
    for (let dc = 0; dc < cs; dc++) for (let dr = 0; dr < rs; dr++) if (occupied.has(`${c0 + dc},${r0 + dr}`)) return false;
    return true;
  };
  return items.map(({ cs, rs }) => {
    const w = Math.min(Math.max(1, cs), cols);
    const h = Math.max(1, rs);
    for (let r = 0; ; r++) {
      for (let c = 0; c + w <= cols; c++) {
        if (!free(c, r, w, h)) continue;
        for (let dc = 0; dc < w; dc++) for (let dr = 0; dr < h; dr++) occupied.add(`${c + dc},${r + dr}`);
        return { c, r };
      }
    }
  });
}

/** The preset catalog for a figure of `n` panels. Empty below 2 panels. */
export function layoutPresets(n: number): LayoutPreset[] {
  if (n < 2) return [];
  const out: LayoutPreset[] = [];
  const seen = new Set<string>();
  const add = (name: string, columns: number, span?: number[], rowSpan?: number[]): void => {
    const items = Array.from({ length: n }, (_, i) => ({
      cs: Math.min(span?.[i] ?? 1, columns),
      rs: rowSpan?.[i] ?? 1,
    }));
    const pos = packGrid(items, columns);
    const cells = pos.map((p, i) => ({ c: p.c, r: p.r, cs: items[i]!.cs, rs: items[i]!.rs }));
    // two recipes can resolve to the same tiling (a 2-panel "row" is the 2-column grid) —
    // keep the first, so the picker never shows twins
    const key = JSON.stringify(cells);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, columns, ...(span ? { span } : {}), ...(rowSpan ? { rowSpan } : {}), cells });
  };

  if (n <= 6) add("Row", n);
  add("Column", 1);
  for (const c of [2, 3]) if (n > c) add(`${c}-column grid`, c);
  // Wide top: the first panel spans the full first row; the rest tile beneath. Offered for
  // each column count that the remaining panels fill exactly (no ragged hole).
  for (const c of [2, 3]) if ((n - 1) % c === 0 && n - 1 >= c) add(`Wide top (${c} under)`, c, [c]);
  // Tall left: the first panel owns the whole left column; the rest stack on the right.
  // Row spans cap at 4 (the grid's own cap).
  if (n - 1 >= 2 && n - 1 <= 4) add("Tall left", 2, undefined, [n - 1]);
  return out;
}
