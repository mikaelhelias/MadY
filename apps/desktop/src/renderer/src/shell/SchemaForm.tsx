import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { FIELD_HINTS } from "./fieldHints";

/**
 * SchemaForm — auto-generates inspector controls from a field schema, so adding
 * a new tunable is one schema entry instead of hand-built UI. Controls write a single-key delta back via
 * onChange. Values come from `value[key] ?? field.default`. Fields are bucketed
 * by `group` into **collapsible** sections (state persisted) so the inspector
 * stays compact — collapse the groups you aren't using.
 */

const COLLAPSE_KEY = "mady.inspector.collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

// --- recently-used custom colours (shared across every colour control) ---------
const RECENT_KEY = "mady.recentColors";
const isHex = (c: string): boolean => /^#[0-9a-fA-F]{6}$/.test(c);
export function recentColors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c) => typeof c === "string" && isHex(c)) : [];
  } catch {
    return [];
  }
}
export function pushRecentColor(c: string): void {
  if (!isHex(c)) return;
  const lc = c.toLowerCase();
  const next = [lc, ...recentColors().filter((x) => x.toLowerCase() !== lc)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota/availability */
  }
}
// Debounced variant: a colour input fires onChange continuously while the user drags
// the spectrum, so record only the colour they settle on (after dragging pauses) —
// avoids flooding Recent with every hovered colour. A plain timer, so it never touches
// the input element / native picker (no extra click).
let recentTimer: ReturnType<typeof setTimeout> | undefined;
export function pushRecentColorDebounced(c: string): void {
  if (recentTimer) clearTimeout(recentTimer);
  recentTimer = setTimeout(() => pushRecentColor(c), 450);
}

// --- screen colour pipette --------------------------------------
// The Electron/Chromium runtime ships the EyeDropper API, which samples any pixel on
// the whole screen — including other applications, not just MadY. We feature-detect it
// so the "pick from screen" button only appears where it actually works (jsdom / older
// runtimes have no EyeDropper → no dead button). Local API, no network — offline-safe.
interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperInstance {
  open(opts?: { signal?: AbortSignal }): Promise<EyeDropperResult>;
}
interface EyeDropperCtor {
  new (): EyeDropperInstance;
}
function getEyeDropper(): EyeDropperCtor | undefined {
  const ed = (globalThis as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return typeof ed === "function" ? ed : undefined;
}
export function eyeDropperSupported(): boolean {
  return getEyeDropper() !== undefined;
}
/** Open the OS eyedropper and resolve to the picked `#rrggbb`, or undefined if the API is
 *  absent, the user cancels (Escape → AbortError), or it returns something non-hex. */
export async function pickScreenColor(): Promise<string | undefined> {
  const ED = getEyeDropper();
  if (!ED) return undefined;
  try {
    const res = await new ED().open();
    const c = res?.sRGBHex;
    return typeof c === "string" && isHex(c) ? c.toLowerCase() : undefined;
  } catch {
    return undefined; // user pressed Escape (AbortError) or the pick failed
  }
}

/** Eyedropper glyph — a small inline SVG (Unicode has no clean eyedropper). */
function PipetteIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14l.6-2.4 6-6" />
      <path d="M8.2 5l2.8 2.8" />
      <path d="M10.7 2.4a1.9 1.9 0 0 1 2.9 2.9L11.4 7.5 8.5 4.6z" />
    </svg>
  );
}

/**
 * Native colour input. Plain controlled input + onChange, which keeps the single-click
 * flow. Records to Recent on the same onChange. (onBlur, a native `change` listener and an
 * uncontrolled defaultValue each break the single-click flow.)
 *
 * When the runtime supports the EyeDropper API we append a small "pick from screen"
 * pipette so any colour on the desktop can be sampled — feature-gated
 * so it is never a dead button.
 */
export function ColorInput({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (c: string) => void;
  className?: string;
  "aria-label"?: string;
}): ReactElement {
  const input = (
    <input
      type="color"
      className={className}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        pushRecentColorDebounced(e.target.value);
      }}
    />
  );
  if (!eyeDropperSupported()) return input;
  return (
    <span className="colorwrap">
      {input}
      <button
        type="button"
        className="pipette"
        title="Pick a colour from anywhere on screen"
        aria-label="Pick colour from screen"
        onClick={() => {
          void pickScreenColor().then((c) => {
            if (c) {
              onChange(c);
              pushRecentColor(c);
            }
          });
        }}
      >
        <PipetteIcon />
      </button>
    </span>
  );
}

/** `optnumber` = a number whose empty state is meaningful ("auto"), written as undefined.
 *  Plain `number` coerces through Number() and drops anything non-finite, so it cannot
 *  express "unset" — fields such as the graduated-fill bounds (SeriesStyle.gradMin/gradMax)
 *  need this kind to be reachable at all. */
/** `names` = a list of names typed or pasted into a box (one per line, or separated by commas / semicolons / tabs),
 *  stored as a string[]; an empty box is written as undefined. */
export type FieldKind = "select" | "number" | "optnumber" | "checkbox" | "color" | "range" | "swatches" | "names";

/** Split typed or pasted text into names: one per line, or separated by commas, semicolons or tabs (a column pasted
 *  from a spreadsheet arrives one per line). Spaces around a name are dropped, empty entries skipped, repeats kept once
 *  (case ignored, the first spelling kept). */
export function splitNames(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\r\n,;\t]+/)) {
    const n = raw.trim();
    if (n === "" || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/** The `names` box: edits stay local while typing and are written when the box is left, so a half-typed name is never
 *  split mid-word or re-flowed under the cursor. A change from outside (undo, another control) refreshes the text. */
function NamesInput({ value, label, onChange }: { value: string[]; label: string; onChange: (v: string[] | undefined) => void }) {
  const joined = value.join("\n");
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <textarea
      className="numin"
      aria-label={label}
      rows={3}
      style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }}
      placeholder="One name per line, or paste a column"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const names = splitNames(text);
        onChange(names.length ? names : undefined);
      }}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Val = any;

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  /** Subsection heading; a new group emits an `.inspsub` divider. */
  group?: string;
  default: Val;
  /** select options as [value, label]. */
  options?: ReadonlyArray<readonly [string, string]>;
  /** select: a stored value the options do not list is shown as `default`. Only for a field whose
   *  builder draws such a value as the default too, so the control shows what is drawn. */
  unlistedAsDefault?: boolean | undefined;
  min?: number;
  max?: number;
  step?: number;
  /** swatches / palette colours. */
  swatches?: readonly string[];
  /**
   * Hover tooltip for the whole row — what the control does, in one short line.
   *
   * Note: optional on purpose, and it should stay that way. A `hint` on "Opacity" or "Width"
   * restates the label and trains people that hovering here teaches them nothing; the value
   * is entirely in the rows whose label is ambiguous ("Two-tone", "Tension"), whose effect is
   * invisible until you try it, or that only apply in a condition worth naming. Write one
   * where it earns its place and leave the obvious rows bare.
   */
  hint?: string;
  /** Show this field only when the predicate holds (against resolved values). */
  show?: (resolved: Record<string, Val>) => boolean;
}

/** The value a field shows: the stored one, else its default — and, for an `unlistedAsDefault`
 *  select, the default also when the stored value is not among its options. */
export function resolveField(f: Field, stored: Val): Val {
  if (stored === undefined || stored === null) return f.default;
  if (f.kind === "select" && f.unlistedAsDefault && !(f.options ?? []).some(([o]) => o === String(stored))) return f.default;
  return stored;
}

export function SchemaForm({
  fields,
  value,
  onChange,
  refusals,
}: {
  fields: Field[];
  value: Record<string, Val>;
  onChange: (delta: Record<string, Val>) => void;
  /**
   * Groups this panel refuses on this chart / this data, keyed by group name, each with the
   * sentence shown in place of its rows.
   *
   * A section that simply vanishes between chart types reads as a bug in the program, and a
   * permanently-disabled control is worse (`toolbar.no-dead-buttons.test.ts` forbids shipping
   * `disabled: true`). The house answer is the Legend section's: the heading stays, the rows go,
   * and the refusal is stated. `deadControls.ts` carries those sentences; this renders them.
   */
  refusals?: Record<string, string> | undefined;
}) {
  const resolved: Record<string, Val> = {};
  for (const f of fields) resolved[f.key] = resolveField(f, value[f.key]);
  const shown = fields.filter((f) => !f.show || f.show(resolved));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed);
  const toggle = (g: string): void =>
    setCollapsed((prev) => {
      const next = { ...prev, [g]: !prev[g] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota/availability errors */
      }
      return next;
    });

  // Bucket consecutive fields by group (schemas author groups contiguously).
  const groups: { name: string; fields: Field[] }[] = [];
  for (const f of shown) {
    const name = f.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else groups.push({ name, fields: [f] });
  }

  /** A refused group whose rows this schema does not carry at all still gets its heading. */
  const orphanRefusals = Object.entries(refusals ?? {}).filter(([name]) => !groups.some((g) => g.name === name));

  const refusal = (name: string, why: string, key: string) => (
    <div className="inspgroup" key={key}>
      <div className="inspsub">{name}</div>
      <p className="hint" style={{ margin: "2px 0" }} data-refusal={name}>{why}</p>
    </div>
  );

  return (
    <>
      {groups.map((g, gi) => {
        const why = g.name ? refusals?.[g.name] : undefined;
        if (why) return refusal(g.name, why, `refused:${g.name}`);
        const isCollapsed = Boolean(g.name) && collapsed[g.name];
        return (
          <div className="inspgroup" key={`${g.name}:${g.fields[0]?.key ?? gi}`}>
            {g.name ? (
              <button
                type="button"
                className="inspsub inspsub-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(g.name)}
              >
                <span className={"chev" + (isCollapsed ? " closed" : "")} aria-hidden>
                  ▾
                </span>
                {g.name}
              </button>
            ) : null}
            {!isCollapsed &&
              g.fields.map((f, i) => (
                <Control
                  key={`${f.key}:${i}`}
                  field={f}
                  value={resolved[f.key]}
                  onChange={(v) => onChange({ [f.key]: v })}
                />
              ))}
          </div>
        );
      })}
      {orphanRefusals.map(([name, why]) => refusal(name, why, `refused:${name}`))}
    </>
  );
}

function Control({ field, value, onChange }: { field: Field; value: Val; onChange: (v: Val) => void }) {
  const f = field;

  if (f.kind === "swatches") {
    const sel = String(value).toLowerCase();
    const recents = recentColors();
    const swatchBtn = (c: string, key: string): ReactElement => (
      <button
        key={key}
        className={"swbtn" + (sel === c.toLowerCase() ? " on" : "")}
        style={{ background: c }}
        title={c}
        aria-label={`${f.label || "Colour"} ${c}`}
        onClick={() => onChange(c)}
      />
    );
    return (
      <div className="swcol">
        <div className="swatches swsm">{(f.swatches ?? []).map((c) => swatchBtn(c, c))}</div>
        {recents.length > 0 && (
          <div className="swatches swsm swrecent" title="Recently used colours">
            <span className="swrecent-l">Recent</span>
            {recents.map((c, i) => swatchBtn(c, `r${i}-${c}`))}
          </div>
        )}
      </div>
    );
  }

  let control: ReactElement;
  if (f.kind === "names") {
    control = <NamesInput value={Array.isArray(value) ? (value as string[]) : []} label={f.label} onChange={onChange} />;
  } else if (f.kind === "select") {
    control = (
      <select className="selin" value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    );
  } else if (f.kind === "checkbox") {
    control = <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  } else if (f.kind === "color") {
    control = (
      <ColorInput className="colorin" value={toHex(String(value))} onChange={(c) => onChange(c)} />
    );
  } else if (f.kind === "range") {
    control = (
      <input
        type="range"
        className="rangein"
        min={f.min}
        max={f.max}
        step={f.step}
        value={Number(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
  } else if (f.kind === "optnumber") {
    // A number that can be unset: blank → undefined ("auto"), matching the hand-rolled
    // `placeholder="auto"` + numOrAuto rows elsewhere in the Inspector.
    const min = f.min ?? -Infinity;
    const max = f.max ?? Infinity;
    control = (
      <input
        type="number"
        className="numin"
        placeholder="auto"
        value={value === undefined || value === null ? "" : String(value)}
        min={f.min}
        max={f.max}
        step={f.step}
        onChange={(e) => {
          const t = e.target.value.trim();
          if (t === "") {
            onChange(undefined); // back to auto
            return;
          }
          const n = Number(t);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    );
  } else {
    // number
    const min = f.min ?? -Infinity;
    const max = f.max ?? Infinity;
    control = (
      <input
        type="number"
        className="numin"
        value={Number(value)}
        min={f.min}
        max={f.max}
        step={f.step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    );
  }

  // The hint goes on the row, not the input: the label is what the eye rests on, and a
  // tooltip that only appears over a 20px slider thumb is one nobody finds.
  // A schema's own `hint` wins over the shared table, for a control that means something
  // different in one chart kind than in another.
  const hint = f.hint ?? FIELD_HINTS[f.key];
  return (
    <label className="frow" {...(hint ? { title: hint } : {})}>
      <span>{f.label}</span>
      {control}
    </label>
  );
}

/** Coerce a colour to a 6-digit hex for the native colour input (fallback black). */
function toHex(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000";
}
