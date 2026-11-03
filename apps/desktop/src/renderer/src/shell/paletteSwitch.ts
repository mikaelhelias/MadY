import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { PALETTES } from "@mady/graphics";

/**
 * The plot patch for Colour scheme ▸ Palette.
 *
 * A style preset writes each dataset's colour into its series style (`palette[i % length]`), so after a preset every
 * series carries a colour and a newly chosen palette would never show. Choosing a palette therefore also takes away
 * the colours that are exactly what the outgoing palette gives that dataset's slot - the ones a preset (or the
 * palette itself) wrote. A colour picked by hand for a series is any other colour, and it stays: the panel's note says
 * a colour set on an individual series still wins.
 */
export function paletteSwitchPatch(plot: Plot, table: DataTable, key: string | undefined): Partial<Plot> {
  const keys = Object.keys(PALETTES);
  const outgoing = plot.paletteColors?.length
    ? plot.paletteColors
    : PALETTES[plot.palette && PALETTES[plot.palette] ? plot.palette : keys[0]!] ?? [];
  const patch: Partial<Plot> = { palette: key, paletteColors: undefined };
  if (!outgoing.length || !plot.seriesStyles) return patch;
  const styles: Record<string, SeriesStyle> = { ...plot.seriesStyles };
  let changed = false;
  tableDatasets(table).forEach((d, i) => {
    const st = styles[d.id];
    const slot = outgoing[i % outgoing.length]!;
    if (st?.color && st.color.toLowerCase() === slot.toLowerCase()) {
      const { color: _c, ...rest } = st;
      styles[d.id] = rest;
      changed = true;
    }
  });
  return changed ? { ...patch, seriesStyles: styles } : patch;
}
