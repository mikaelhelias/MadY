/**
 * The gradient editor — build a colour ramp by hand, or generate one and then fix it by hand.
 *
 * Opened from the "Edit / new gradient…" entry at the bottom of every ramp picker in the
 * program. Two ways to author the same thing, and they interconvert:
 *
 *  • Stops — an editable list of colours at positions. Any built-in can be opened this way,
 *    pre-filled with its real stops: opening the rainbow puts its seven stops on the bar, and
 *    every one can be moved, recoloured, added to or deleted.
 *  • Sweep — generated from hue parameters (the parametric rainbow): where the hue starts and
 *    ends, which way round the wheel, how many times round, and the saturation / lightness it
 *    travels at. "Convert to stops" freezes it so a single bad green can be fixed by hand.
 *
 * A built-in is never mutated. Editing `rainbow` makes a copy called "Rainbow (custom)";
 * the built-ins keep their colours, so nothing already drawn moves.
 *
 * The advice never refuses. The preview says what a colour-blind reader (and a greyscale
 * printer) will be able to tell apart; a rainbow is a legitimate choice and stays available.
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Gradient, GradSpace, GradStepMode, GradStop } from "@mady/core";
import {
  gradientAdvice, gradientStops, makeRamp, resolveGradient, simulateVision, type ColorVision,
} from "@mady/graphics";
import { ColorInput } from "./SchemaForm";
import { GuideHelp } from "./guideLink";

const BAR_W = 460;
const BAR_H = 34;
const SAMPLES = 96;

/** The gradient sampled into `n` flat swatches — how every preview here is drawn (a real SVG
 *  gradient could not show a colour-vision simulation, and would smooth away discrete steps). */
function swatches(g: Gradient, n = SAMPLES): string[] {
  const paint = makeRamp(resolveGradient(g), "#2266cc", "#1a1a1a", false);
  return Array.from({ length: n }, (_v, i) => paint(i / (n - 1)).color);
}

function PreviewBar(props: { g: Gradient; vision?: ColorVision | undefined; label: string; h?: number }): ReactNode {
  const cols = swatches(props.g);
  const h = props.h ?? 18;
  const w = BAR_W / cols.length;
  return (
    <div className="grad-prevrow">
      <span className="grad-prevlab">{props.label}</span>
      <svg width={BAR_W} height={h} role="img" aria-label={`${props.label} preview`} className="grad-prevbar">
        {cols.map((c, i) => (
          <rect key={i} x={i * w} y={0} width={w + 0.6} height={h} fill={props.vision ? simulateVision(c, props.vision) : c} />
        ))}
      </svg>
    </div>
  );
}

export interface GradientEditorProps {
  /** The gradient being edited (a working copy — nothing is written until Done). */
  gradient: Gradient;
  /** Names of the graphs still painting with it; a used gradient cannot be deleted. */
  usedBy: string[];
  /** Already on the user's cross-project shelf? (changes the Save button's wording) */
  inLibrary: boolean;
  onDone: (g: Gradient) => void;
  onCancel: () => void;
  onSaveToLibrary: (g: Gradient) => void;
  /** Absent when the gradient is not in the project yet (nothing to delete). */
  onDelete?: (() => void) | undefined;
}

export function GradientEditor(props: GradientEditorProps): ReactNode {
  const [g, setG] = useState<Gradient>(props.gradient);
  const [sel, setSel] = useState(0);
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const barRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<number | null>(null);

  const patch = (p: Partial<Gradient>): void => setG((cur) => ({ ...cur, ...p }));
  const stops = useMemo(() => [...g.stops].sort((a, b) => a.pos - b.pos), [g.stops]);
  const advice = useMemo(() => gradientAdvice(resolveGradient(g)), [g]);
  const isSweep = g.mode === "sweep";

  const setStops = (next: GradStop[]): void => {
    const sorted = [...next].sort((a, b) => a.pos - b.pos);
    setG((cur) => ({ ...cur, stops: sorted }));
  };

  const posFromEvent = (e: { clientX: number }): number => {
    const box = barRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return 0;
    return Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
  };

  const addStopAt = (pos: number): void => {
    const paint = makeRamp(resolveGradient(g), "#2266cc", "#1a1a1a", false);
    const next = [...stops, { pos, color: paint(pos).color }].sort((a, b) => a.pos - b.pos);
    setStops(next);
    setSel(next.findIndex((s) => s.pos === pos));
  };

  const cols = swatches(g);
  const swatchW = BAR_W / cols.length;
  const selected = stops[Math.min(sel, stops.length - 1)];

  return (
    <div className="modalov" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div className="modal modal-gradient" role="dialog" aria-label="Gradient editor">
        <div className="modalh-row">
          <h2 className="modalh">Gradient</h2>
          <GuideHelp target={{ entry: "insp:colour-scheme" }} what="Colours and gradients" />
        </div>

        <label className="frow">
          <span>Name</span>
          <input
            className="numin grad-name" aria-label="Gradient name" type="text" value={g.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>

        {/* ---- the bar + its stop handles ------------------------------------------ */}
        <svg
          ref={barRef}
          className="grad-bar" width={BAR_W} height={BAR_H} role="group" aria-label="Gradient bar"
          onPointerDown={(e) => {
            if (isSweep) return; // a generated sweep has no hand-placed stops to move
            if ((e.target as Element).getAttribute("data-stop") === null) addStopAt(posFromEvent(e));
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const i = drag.current;
            const next = stops.map((s, k) => (k === i ? { ...s, pos: posFromEvent(e) } : s));
            setStops(next);
          }}
          onPointerUp={() => { drag.current = null; }}
        >
          {cols.map((c, i) => (
            <rect key={i} x={i * swatchW} y={0} width={swatchW + 0.6} height={BAR_H - 10} fill={c} />
          ))}
          {!isSweep && stops.map((s, i) => (
            <g key={i} data-stop={i}>
              <rect
                data-stop={i} x={s.pos * BAR_W - 5} y={BAR_H - 12} width={10} height={12} rx={2}
                fill={s.color} stroke={i === sel ? "#111" : "#888"} strokeWidth={i === sel ? 2 : 1}
                style={{ cursor: "ew-resize" }}
                aria-label={`Stop ${i + 1}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel(i);
                  drag.current = i;
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                }}
              />
            </g>
          ))}
        </svg>

        {/* ---- mode ---------------------------------------------------------------- */}
        <label className="frow">
          <span>Built from</span>
          <select
            className="selin" aria-label="How the gradient is built" value={g.mode}
            onChange={(e) => {
              const mode = e.target.value as Gradient["mode"];
              if (mode === "sweep" && !g.sweep) patch({ mode, sweep: { hueFrom: 0, hueTo: 280, sweepStops: 33 } });
              else patch({ mode });
            }}
          >
            <option value="stops">Colour stops (placed by hand)</option>
            <option value="sweep">A hue sweep (generated)</option>
          </select>
        </label>

        {isSweep ? (
          <>
            <p className="hint">A generated rainbow. Freeze it to stops when you want to fix one colour by hand.</p>
            <SweepRows g={g} onChange={patch} />
            <div className="modalbtns" style={{ justifyContent: "flex-start", marginTop: 6 }}>
              <button
                type="button" className="btn"
                onClick={() => setG((cur) => ({ ...cur, mode: "stops", stops: gradientStops(cur) }))}
              >
                Convert to stops
              </button>
            </div>
          </>
        ) : (
          <>
            {selected && (
              <div className="grad-stoprow">
                <span className="grad-prevlab">Stop {Math.min(sel, stops.length - 1) + 1} of {stops.length}</span>
                <ColorInput
                  className="colorin" aria-label="Stop colour" value={selected.color}
                  onChange={(c) => setStops(stops.map((s, k) => (k === sel ? { ...s, color: c } : s)))}
                />
                <input
                  type="number" className="numin" aria-label="Stop position" min={0} max={1} step={0.01}
                  value={Number(selected.pos.toFixed(3))}
                  onChange={(e) => setStops(stops.map((s, k) => (k === sel ? { ...s, pos: Math.max(0, Math.min(1, Number(e.target.value))) } : s)))}
                />
                <button
                  type="button" className="btn" aria-label="Delete this stop"
                  disabled={stops.length <= 2}
                  title={stops.length <= 2 ? "A gradient needs at least two stops" : "Remove this stop"}
                  onClick={() => { setStops(stops.filter((_s, k) => k !== sel)); setSel(0); }}
                >
                  Remove
                </button>
              </div>
            )}
            <p className="hint">Click the bar to add a stop, drag a handle to move it.</p>
            <details className="grad-paste">
              <summary>Paste a list of colours</summary>
              <textarea
                aria-label="Paste colours" rows={3} value={paste}
                placeholder="#ff0000, #ff8000, #ffff00 …"
                onChange={(e) => setPaste(e.target.value)}
              />
              <button
                type="button" className="btn"
                onClick={() => {
                  const hexes = [...paste.matchAll(/#[0-9a-f]{3}(?:[0-9a-f]{3})?/gi)].map((m) => m[0]);
                  if (hexes.length < 2) { setPasteErr("Paste at least two colours (#rrggbb)."); return; }
                  setPasteErr("");
                  setStops(hexes.map((color, i) => ({ pos: i / (hexes.length - 1), color: color.toLowerCase() })));
                  setSel(0);
                }}
              >
                Use these
              </button>
              {pasteErr && <p className="hint">{pasteErr}</p>}
            </details>
          </>
        )}

        {/* ---- shaping stored ON the gradient -------------------------------------- */}
        <h3 className="inspsub">Built into this gradient</h3>
        <p className="hint">A graph can still override any of these for itself.</p>
        <label className="frow">
          <span>Blend</span>
          <select
            className="selin" aria-label="Gradient blend space" value={g.space ?? "rgb"}
            onChange={(e) => patch({ space: e.target.value as GradSpace })}
          >
            <option value="rgb">Straight (RGB)</option>
            <option value="hsl">Vivid (HSL)</option>
            <option value="lab">Perceptual (Lab)</option>
          </select>
        </label>
        <label className="frow" title="Where the middle colour sits along the ramp, 0 to 1. A graph's own 'Centre at' is a data value and wins over this.">
          <span>Middle at</span>
          <input
            type="number" className="numin" aria-label="Gradient midpoint fraction" min={0} max={1} step={0.05}
            placeholder="mid" value={g.midpoint ?? ""}
            onChange={(e) => patch({ midpoint: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="frow">
          <span>Detail bias</span>
          <input
            type="number" className="numin" aria-label="Gradient detail bias" min={0.2} max={5} step={0.1}
            placeholder="even" value={g.gamma ?? ""}
            onChange={(e) => patch({ gamma: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="frow">
          <span>Colour steps</span>
          <input
            type="number" className="numin" aria-label="Gradient colour steps" min={2} max={24} step={1}
            placeholder="off" value={g.steps ?? ""}
            onChange={(e) => patch({ steps: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        {(g.steps ?? 0) >= 2 && (
          <>
            <label className="frow" title="Equal intervals cut the range into equal slices. Equal counts (quantile) put the same number of values in each class — on skewed data, equal intervals put nearly everything in one class and the picture goes flat. Own values lets you type the cuts.">
              <span>Class edges</span>
              <select
                className="selin" aria-label="How the classes are cut" value={g.stepMode ?? "equal"}
                onChange={(e) => patch({ stepMode: e.target.value as GradStepMode })}
              >
                <option value="equal">Equal intervals</option>
                <option value="quantile">Equal counts (quantile)</option>
                <option value="breaks">My own values</option>
              </select>
            </label>
            {g.stepMode === "breaks" && (
              <label className="frow" title="The cut values, in your data's own units, separated by commas. You need one fewer than the number of classes.">
                <span>Cut at</span>
                <input
                  className="numin grad-name" type="text" aria-label="Class break values"
                  placeholder={`${(g.steps ?? 2) - 1} value${(g.steps ?? 2) - 1 === 1 ? "" : "s"}`}
                  value={(g.breaks ?? []).join(", ")}
                  onChange={(e) => {
                    const nums = e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
                    patch({ breaks: nums.length ? nums : undefined });
                  }}
                />
              </label>
            )}
          </>
        )}
        <label className="frow" title="Colour for values below a pinned scale minimum. Without one they take the ramp's first colour, so a clipped scale reads as a flat band instead of as clipped. Only visible when you pin Scale min on the graph.">
          <span>Below the scale</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ColorInput className="colorin" aria-label="Under colour" value={g.underColor ?? "#3b3b3b"} onChange={(c) => patch({ underColor: c })} />
            <button type="button" className="swbtn" title="No below-scale colour (clamp to the ramp's first colour)" aria-label="Clear the below-scale colour" onClick={() => patch({ underColor: undefined })}>⨯</button>
          </span>
        </label>
        <label className="frow" title="Colour for values above a pinned scale maximum.">
          <span>Above the scale</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <ColorInput className="colorin" aria-label="Over colour" value={g.overColor ?? "#c0392b"} onChange={(c) => patch({ overColor: c })} />
            <button type="button" className="swbtn" title="No above-scale colour (clamp to the ramp's last colour)" aria-label="Clear the above-scale colour" onClick={() => patch({ overColor: undefined })}>⨯</button>
          </span>
        </label>

        {/* ---- how it will be read ------------------------------------------------- */}
        <h3 className="inspsub">How it will be read</h3>
        <PreviewBar g={g} label="As drawn" h={20} />
        <PreviewBar g={g} vision="deuteranopia" label="Deuteranopia" />
        <PreviewBar g={g} vision="protanopia" label="Protanopia" />
        <PreviewBar g={g} vision="grayscale" label="Greyscale" />
        {advice.length > 0 && (
          <ul className="scene-warnings grad-advice">
            {advice.map((a) => <li key={a}>{a}</li>)}
          </ul>
        )}

        <div className="modalbtns">
          {props.onDelete && (
            <button
              type="button" className="btn"
              style={{ marginRight: "auto" }}
              disabled={props.usedBy.length > 0}
              title={props.usedBy.length > 0
                ? `Still used by ${props.usedBy.join(", ")} — change those graphs first.`
                : "Delete this gradient"}
              onClick={props.onDelete}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={() => props.onSaveToLibrary(g)}>
            {props.inLibrary ? "Update in my library" : "Save to my library"}
          </button>
          <button type="button" className="btn-ghost" onClick={props.onCancel}>Cancel</button>
          <button type="button" className="btn" onClick={() => props.onDone(g)}>Done</button>
        </div>
      </div>
    </div>
  );
}

function SweepRows(props: { g: Gradient; onChange: (p: Partial<Gradient>) => void }): ReactNode {
  const s = props.g.sweep ?? { hueFrom: 0, hueTo: 280 };
  const set = (p: Partial<NonNullable<Gradient["sweep"]>>): void => props.onChange({ sweep: { ...s, ...p } });
  const pairVal = (v: number | [number, number] | undefined, dflt: number): number =>
    v === undefined ? dflt : typeof v === "number" ? v : v[0];
  return (
    <>
      <label className="frow">
        <span>Hue from</span>
        <input type="number" className="numin" aria-label="Hue from" min={0} max={360} step={5}
          value={s.hueFrom} onChange={(e) => set({ hueFrom: Number(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Hue to</span>
        <input type="number" className="numin" aria-label="Hue to" min={0} max={360} step={5}
          value={s.hueTo} onChange={(e) => set({ hueTo: Number(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Round the wheel</span>
        <select className="selin" aria-label="Hue direction" value={s.hueDirection ?? "cw"}
          onChange={(e) => set({ hueDirection: e.target.value as "cw" | "ccw" })}>
          <option value="cw">The short way (clockwise)</option>
          <option value="ccw">The other way</option>
        </select>
      </label>
      <label className="frow" title="More than one lap makes a repeating ramp — for angles, phases and other cyclic data.">
        <span>Laps</span>
        <input type="number" className="numin" aria-label="Hue cycles" min={1} max={4} step={1}
          value={s.hueCycles ?? 1} onChange={(e) => set({ hueCycles: Number(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Saturation</span>
        <input type="number" className="numin" aria-label="Sweep saturation" min={0} max={1} step={0.05}
          value={pairVal(s.saturation, 1)} onChange={(e) => set({ saturation: Number(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Lightness</span>
        <input type="number" className="numin" aria-label="Sweep lightness" min={0} max={1} step={0.05}
          value={pairVal(s.lightness, 0.5)} onChange={(e) => set({ lightness: Number(e.target.value) })} />
      </label>
      <label className="frow">
        <span>Colours</span>
        <input type="number" className="numin" aria-label="Sweep stop count" min={5} max={256} step={2}
          value={s.sweepStops ?? 33} onChange={(e) => set({ sweepStops: Number(e.target.value) })} />
      </label>
    </>
  );
}
