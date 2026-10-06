import { useState } from "react";
import { clampZoom, ZOOM_MAX, ZOOM_MIN, zoomLabel } from "./zoom";
import { GuideHelp } from "./guideLink";

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * ZoomDialog — set the active pane's view zoom to an exact level (View → Set zoom
 * level…). Quick presets + a custom percentage; complements Ctrl±/0, Ctrl+wheel,
 * and the status-bar control.
 */
export function ZoomDialog({
  zoom,
  onApply,
  onClose,
}: {
  zoom: number;
  onApply: (z: number) => void;
  onClose: () => void;
}) {
  const [pct, setPct] = useState(Math.round(zoom * 100));
  const current = Math.round(zoom * 100);

  return (
    <div className="modalov" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Set zoom" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Zoom level</h3>
          <GuideHelp target={{ entry: "action:set-zoom" }} what="Zoom level" />
        </div>
        <div className="zoompresets">
          {PRESETS.map((p) => (
            <button
              key={p}
              className={"zchip" + (current === Math.round(p * 100) ? " on" : "")}
              onClick={() => onApply(p)}
            >
              {zoomLabel(p)}
            </button>
          ))}
        </div>
        <label className="exprow" style={{ marginTop: 12 }}>
          Custom{" "}
          <input
            type="number"
            min={Math.round(ZOOM_MIN * 100)}
            max={Math.round(ZOOM_MAX * 100)}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value) || 0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onApply(clampZoom(pct / 100));
            }}
          />
          %
        </label>
        <div className="modalbtns">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={() => onApply(clampZoom(pct / 100))}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
