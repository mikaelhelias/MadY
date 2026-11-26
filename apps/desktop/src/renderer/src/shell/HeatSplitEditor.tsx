/**
 * Splits — the breaks that cut a heatmap into blocks.
 *
 * The whole control system, in one place: any number of breaks on either axis, each placed
 * at a chosen position, and each drawn as a space, a rule, or a rule inside a space. Which
 * number is tunable follows that choice — a space has a width, a rule has a thickness — so
 * the panel never shows a knob that cannot move anything.
 *
 * All, or just this one. Every look field on a split is optional: left alone it follows the
 * chart-wide default above the list, so changing that one row restyles every break at once.
 * Set a field on a split and that split alone departs from the default; the ⨯ beside it puts it
 * back under the default's control. This is the same field-by-field fallback the per-axis title
 * fonts use, and it means there is no "apply to all" button to forget to press.
 *
 * Positions are shown 1-based and as "after row 3", because that is how a person reads a
 * matrix; the model stores the 0-based index the split sits after.
 */
import type { ReactNode } from "react";
import type { HeatSplit, HeatSplitStyle, LineDash } from "@mady/core";
import { ColorInput } from "./SchemaForm";

export interface SplitDefaults {
  style: HeatSplitStyle;
  gap: number;
  lineWidth: number;
  color: string;
}

const STYLE_LABEL: Record<HeatSplitStyle, string> = {
  gap: "Space",
  line: "Rule",
  both: "Space + rule",
};

export function HeatSplitEditor(props: {
  axis: "row" | "col";
  /** How many rows / columns the matrix has — a split must fall between two of them. */
  count: number;
  splits: readonly HeatSplit[];
  defaults: SplitDefaults;
  /** The break the user clicked on the graph — its row is marked and scrolled to. */
  selectedAt?: number | undefined;
  onChange: (next: HeatSplit[]) => void;
}): ReactNode {
  const { axis, count, splits, defaults } = props;
  const noun = axis === "row" ? "row" : "column";
  const list = [...splits].sort((a, b) => a.at - b.at);
  const set = (i: number, patch: Partial<HeatSplit>): void =>
    props.onChange(list.map((sp, k) => (k === i ? { ...sp, ...patch } : sp)));
  const remove = (i: number): void => props.onChange(list.filter((_sp, k) => k !== i));

  /** The first free position, so "Add" always lands somewhere that can actually draw. */
  const nextFree = (): number => {
    for (let at = 0; at < count - 1; at++) if (!list.some((sp) => sp.at === at)) return at;
    return -1;
  };
  const free = nextFree();

  return (
    <>
      <div className="frow splitadd">
        <span>{axis === "row" ? "Row splits" : "Column splits"}</span>
        <button
          type="button" className="btn-mini" aria-label={`Add a ${noun} split`}
          disabled={free < 0}
          title={free < 0
            ? `Every gap between ${noun}s already has a split`
            : `Add a break after ${noun} ${free + 1}`}
          onClick={() => props.onChange([...list, { at: free }])}
        >
          + Add
        </button>
      </div>
      {list.length === 0 && (
        <p className="hint">No breaks — the {noun}s run together. Add one to hold blocks apart.</p>
      )}
      {list.map((sp, i) => {
        const style = sp.style ?? defaults.style;
        const overridden = sp.style !== undefined || sp.gap !== undefined || sp.lineWidth !== undefined || sp.color !== undefined || sp.dash !== undefined;
        const isSel = props.selectedAt === sp.at;
        return (
          <div
            className={"splitrow" + (isSel ? " on" : "")}
            key={`${axis}-${i}`}
            data-split-row={`${axis}-${sp.at}`}
            ref={isSel ? (el) => el?.scrollIntoView?.({ block: "nearest" }) : undefined}
          >
            <label className="splitcell">
              <span>after {noun}</span>
              <input
                type="number" className="numin splitnum" min={1} max={Math.max(1, count - 1)} step={1}
                aria-label={`${noun} split ${i + 1} position`}
                value={sp.at + 1}
                onChange={(e) => set(i, { at: Math.max(0, Math.round(Number(e.target.value)) - 1) })}
              />
            </label>
            <select
              className="selin" aria-label={`${noun} split ${i + 1} style`}
              value={sp.style ?? ""}
              onChange={(e) => set(i, { style: (e.target.value || undefined) as HeatSplitStyle | undefined })}
            >
              <option value="">Same as all ({STYLE_LABEL[defaults.style]})</option>
              <option value="gap">{STYLE_LABEL.gap}</option>
              <option value="line">{STYLE_LABEL.line}</option>
              <option value="both">{STYLE_LABEL.both}</option>
            </select>
            {style !== "line" && (
              <label className="splitcell" title="How wide the space is, in pixels. Blank follows the setting above.">
                <span>space</span>
                <input
                  type="number" className="numin splitnum" min={0} max={80} step={1}
                  aria-label={`${noun} split ${i + 1} space`}
                  placeholder={String(defaults.gap)} value={sp.gap ?? ""}
                  onChange={(e) => set(i, { gap: e.target.value === "" ? undefined : Number(e.target.value) })}
                />
              </label>
            )}
            {style !== "gap" && (
              <>
                <label className="splitcell" title="How thick the rule is, in pixels. Blank follows the setting above.">
                  <span>rule</span>
                  <input
                    type="number" className="numin splitnum" min={0} max={12} step={0.5}
                    aria-label={`${noun} split ${i + 1} rule thickness`}
                    placeholder={String(defaults.lineWidth)} value={sp.lineWidth ?? ""}
                    onChange={(e) => set(i, { lineWidth: e.target.value === "" ? undefined : Number(e.target.value) })}
                  />
                </label>
                <ColorInput
                  className="colorin" aria-label={`${noun} split ${i + 1} rule colour`}
                  value={sp.color ?? "#333333"} onChange={(c) => set(i, { color: c })}
                />
                <select
                  className="selin" aria-label={`${noun} split ${i + 1} rule dash`}
                  value={sp.dash ?? ""}
                  onChange={(e) => set(i, { dash: (e.target.value || undefined) as LineDash | undefined })}
                >
                  <option value="">Same as all</option>
                  <option value="solid">Solid</option>
                  <option value="dashed">Dashed</option>
                  <option value="dotted">Dotted</option>
                  <option value="dashdot">Dash-dot</option>
                  <option value="longdash">Long dash</option>
                </select>
              </>
            )}
            <input
              type="text" className="numin splitlab" aria-label={`${noun} split ${i + 1} block label`}
              placeholder="label" value={sp.label ?? ""}
              onChange={(e) => set(i, { label: e.target.value || undefined })}
            />
            <button
              type="button" className="swbtn" aria-label={`Put ${noun} split ${i + 1} back under the shared setting`}
              disabled={!overridden}
              title={overridden ? "Follow the shared setting again" : "Already following the shared setting"}
              onClick={() => set(i, { style: undefined, gap: undefined, lineWidth: undefined, color: undefined, dash: undefined })}
            >
              ⨯
            </button>
            <button
              type="button" className="swbtn" aria-label={`Remove ${noun} split ${i + 1}`}
              title="Remove this break" onClick={() => remove(i)}
            >
              −
            </button>
          </div>
        );
      })}
    </>
  );
}
