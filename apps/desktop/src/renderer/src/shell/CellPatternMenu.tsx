import { useState } from "react";
import { Grid2x2 } from "lucide-react";
import type { CellPattern } from "@mady/core";
import { ColorInput } from "./SchemaForm";
import { CURATED_CELL_PATTERNS, cellPatternBackground } from "./cellPatterns";

/**
 * Datasheet "Pattern" control — a swatch palette of hatch/dot/grid tiles, on the datasheet
 * toolbar next to "Fill". Mirrors {@link CellFillMenu}: a click applies a pattern to the
 * selected cells (drawn over any fill colour); "No pattern" clears them. A colour picker at
 * the top sets the pattern's foreground colour. The pattern swatches
 * are the shared `patternTile` geometry, so a cell pattern matches the graph's series fills.
 */

const DEFAULT_PATTERN_COLOR = "#555555";

export function CellPatternMenu({ disabled, onPick }: { disabled: boolean; onPick: (pattern: CellPattern | null) => void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(DEFAULT_PATTERN_COLOR);
  const choose = (pattern: CellPattern | null): void => {
    setOpen(false);
    onPick(pattern);
  };
  return (
    <span className="antb-menuwrap">
      <button
        type="button"
        className="railbtn"
        disabled={disabled}
        aria-label="Cell pattern"
        title={disabled ? "Select one or more cells to pattern them" : "Pattern the selected cells (a background overlay — does not change the data)"}
        onClick={() => setOpen((v) => !v)}
      >
        <Grid2x2 size={13} /> Pattern
      </button>
      {open && !disabled && (
        <div className="antb-menupanel cellpattern-panel" role="menu" onMouseLeave={() => setOpen(false)}>
          <label className="cellpattern-color" title="Pattern colour (also lets you sample one from the screen)">
            Colour
            <ColorInput aria-label="Pattern colour" value={color} onChange={setColor} />
          </label>
          <div className="cellpattern-swatches">
            {CURATED_CELL_PATTERNS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="cellpattern-swatch"
                role="menuitemradio"
                aria-checked={false}
                aria-label={`Pattern ${kind}`}
                title={kind}
                style={cellPatternBackground({ kind, color })}
                onClick={() => choose({ kind, color })}
              />
            ))}
          </div>
          <button type="button" className="antb-menuitem cellpattern-none" role="menuitem" onClick={() => choose(null)}>
            <span className="cellpattern-none-x" aria-hidden="true" /> No pattern
          </button>
        </div>
      )}
    </span>
  );
}
