import { useState } from "react";
import { PaintBucket } from "lucide-react";
import { ColorInput } from "./SchemaForm";

/**
 * Datasheet "Fill colour" control — a swatch palette button on the
 * datasheet's toolbar. A click applies one of a curated set of light
 * background colours to the selected cells (dark cell text stays readable); "No fill" clears them.
 * A small "Custom" picker is offered as a secondary option for any other colour — the
 * presets are the obvious path, precision is there only if wanted.
 */

/** Curated light fill colours — legible behind the datasheet's dark text. */
export const CELL_FILL_PRESETS: readonly string[] = [
  "#fff3b0", "#ffe0b2", "#ffcdd2", "#f8bbd0", "#e1bee7", "#c5cae9", "#bbdefb",
  "#b2ebf2", "#c8e6c9", "#dcedc8", "#f0f4c3", "#ffecb3", "#e0e0e0", "#cfd8dc",
];

export function CellFillMenu({ disabled, onPick }: { disabled: boolean; onPick: (color: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const choose = (color: string | null): void => {
    setOpen(false);
    onPick(color);
  };
  return (
    <span className="antb-menuwrap">
      <button
        type="button"
        className="railbtn"
        disabled={disabled}
        aria-label="Fill colour"
        title={disabled ? "Select one or more cells to colour them" : "Colour the selected cells (a background highlight — does not change the data)"}
        onClick={() => setOpen((v) => !v)}
      >
        <PaintBucket size={13} /> Fill
      </button>
      {open && !disabled && (
        <div className="antb-menupanel cellfill-panel" role="menu" onMouseLeave={() => setOpen(false)}>
          <div className="cellfill-swatches">
            {CELL_FILL_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className="cellfill-swatch"
                role="menuitemradio"
                aria-checked={false}
                aria-label={`Fill ${c}`}
                title={c}
                style={{ background: c }}
                onClick={() => choose(c)}
              />
            ))}
          </div>
          <button type="button" className="antb-menuitem cellfill-none" role="menuitem" onClick={() => choose(null)}>
            <span className="cellfill-none-x" aria-hidden="true" /> No fill
          </button>
          <label className="cellfill-custom" title="Pick any colour (also lets you sample one from the screen)">
            Custom
            <ColorInput aria-label="Custom fill colour" value={CELL_FILL_PRESETS[0]!} onChange={(c) => choose(c)} />
          </label>
        </div>
      )}
    </span>
  );
}
