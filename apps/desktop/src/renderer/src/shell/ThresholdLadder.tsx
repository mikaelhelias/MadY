import { FACTORY_SIGNIFICANCE_THRESHOLDS, formatSignificance, resolveThresholds } from "@mady/core";
import type { SignificanceDisplay, SignificanceThreshold } from "@mady/core";

/**
 * The significance threshold ladder editor — what counts as significant on this figure,
 * and what gets printed for it.
 *
 * Controlled and store-free, so the same component serves the per-graph Inspector panel
 * and the application-wide default in Settings. `value === undefined` means "inherit",
 * which is a real state and not the same as a copy of the factory rows: Reset emits
 * `undefined` so a graph goes back to following the default rather than freezing today's
 * default into the document.
 *
 * The preview strip renders through the same `formatSignificance` the renderer uses, so
 * what the user sees here cannot drift from what the figure draws — it is not a mock-up
 * of the formatter, it is the formatter itself.
 */
/** A ready-made vocabulary for the whole ladder.
 *  - `mark` repeats one glyph, so the strictest rung carries the most of them (`*`/`**`/`***`).
 *  - `letters` spends one distinct glyph per rung, loosest first (a / b / c).
 *  - `fromP` spells each rung's own cut-off out (`p<0.05`), so it tracks edited numbers. */
type SymbolFamily = { label: string; preview: string; mark?: string; letters?: string[]; fromP?: boolean };

/** The families offered above the ladder. Deliberately short: these are the conventions
 *  that actually appear in journals, not every glyph that exists. */
const SYMBOL_FAMILIES: SymbolFamily[] = [
  { label: "Asterisks", preview: "∗∗∗", mark: "*" },
  { label: "Solid stars", preview: "★★★", mark: "★" },
  { label: "Hashes", preview: "###", mark: "#" },
  { label: "Daggers", preview: "†††", mark: "†" },
  { label: "Letters", preview: "abc", letters: ["a", "b", "c", "d", "e", "f"] },
  { label: "Cut-offs", preview: "p<…", fromP: true },
];

export function ThresholdLadder({
  value,
  display = "stars",
  nsSymbol,
  hideNs,
  scope,
  onChange,
  onChangeNs,
  onChangeHideNs,
}: {
  value: SignificanceThreshold[] | undefined;
  display?: SignificanceDisplay | undefined;
  nsSymbol: string | undefined;
  hideNs: boolean | undefined;
  /** "graph" = this figure only; "settings" = the default for new graphs. */
  scope: "graph" | "settings";
  onChange: (next: SignificanceThreshold[] | undefined) => void;
  onChangeNs: (next: string | undefined) => void;
  onChangeHideNs: (next: boolean | undefined) => void;
}) {
  const rows = resolveThresholds(value, display);
  const custom = value !== undefined;
  const ns = nsSymbol ?? "ns";

  const commit = (next: SignificanceThreshold[]): void => onChange(next.length ? next : []);
  const setRow = (i: number, patch: Partial<SignificanceThreshold>): void =>
    commit(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  /** Restamp every rung with one family's glyphs, keeping the cut-offs as they are:
   *  the strictest rung gets the most marks, exactly as the star convention works.
   *  Typing a symbol by hand still wins — this only fills the column in one move. */
  const applyFamily = (fam: SymbolFamily): void => {
    // `rows` is ascending by p, i.e. strictest first — rung i is the (n−1−i)th loosest.
    if (fam.fromP) {
      commit(rows.map((r) => ({ ...r, symbol: `p<${r.p}` })));
      return;
    }
    if (fam.letters) {
      const ls = fam.letters;
      commit(rows.map((r, i) => ({ ...r, symbol: ls[Math.min(rows.length - 1 - i, ls.length - 1)]! })));
      return;
    }
    const mark = fam.mark ?? "*";
    commit(rows.map((r, i) => ({ ...r, symbol: mark.repeat(Math.max(1, rows.length - i)) })));
  };

  return (
    <div className="sigladder">
      <p className="note" style={{ fontSize: 11 }}>
        {custom
          ? scope === "graph"
            ? "Custom for this graph."
            : "Custom default."
          : scope === "graph"
            ? "Using the default from Settings."
            : "Using the built-in thresholds."}{" "}
        A p-value below a cut-off prints that symbol; the strictest one it clears wins.
      </p>

      {/* Symbol family — one click restamps the whole column. The per-rung text boxes
          below stay authoritative, so a lab's own convention is still typeable. */}
      <div className="frow" style={{ alignItems: "flex-start" }}>
        <span>Symbol</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {/* btn-mini, not swbtn: swbtn is a fixed 22×22 swatch square, and these carry
              text — inside it, "p<…" and friends would overflow the box and the box would
              overflow the panel, clipping the ladder's right edge in both hosts. */}
          {SYMBOL_FAMILIES.map((f) => (
            <button
              key={f.label}
              type="button"
              className="btn-mini"
              title={`Use ${f.label.toLowerCase()} for every threshold`}
              aria-label={`Symbol family: ${f.label}`}
              onClick={() => applyFamily(f)}
            >
              {f.preview}
            </button>
          ))}
        </span>
      </div>

      {rows.map((r, i) => (
        <div className="frow sigladder-row" key={`${r.p}-${i}`}>
          <span>p &lt;</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number"
              className="numin"
              step="any"
              min={0}
              max={1}
              aria-label={`Cut-off ${i + 1}`}
              defaultValue={r.p}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n > 0 && n <= 1 && n !== r.p) setRow(i, { p: n });
                else e.target.value = String(r.p);
              }}
            />
            <input
              type="text"
              className="numin"
              style={{ width: 64 }}
              aria-label={`Symbol ${i + 1}`}
              defaultValue={r.symbol}
              onBlur={(e) => {
                const v = e.target.value;
                if (v !== "" && v !== r.symbol) setRow(i, { symbol: v });
                else e.target.value = r.symbol;
              }}
            />
            <button
              type="button"
              className="swbtn"
              title="Remove this threshold"
              aria-label={`Remove threshold ${i + 1}`}
              onClick={() => commit(rows.filter((_, k) => k !== i))}
            >
              ×
            </button>
          </span>
        </div>
      ))}

      <div className="frow">
        <span>otherwise</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            className="numin"
            style={{ width: 64 }}
            aria-label="Not-significant label"
            defaultValue={ns}
            onBlur={(e) => onChangeNs(e.target.value === "" || e.target.value === "ns" ? undefined : e.target.value)}
          />
          <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 11 }} title="Draw nothing at all for a comparison that clears no threshold — a bracket with no label says nothing and still takes up room. On by default. Untick it to show every comparison, the ones that missed the cut-off labelled ns: brackets added from an analysis then cover all the groups, not only the significant ones.">
            {/* Unticking must store an explicit `false`: `undefined` means "follow the
                default", and the default is to hide. */}
            <input type="checkbox" checked={hideNs ?? true} onChange={(e) => onChangeHideNs(e.target.checked ? undefined : false)} />
            hide
          </label>
        </span>
      </div>

      <div className="frow">
        <span />
        <span style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn-mini"
            onClick={() => commit([...rows, { p: rows.length ? Math.min(1, rows[rows.length - 1]!.p * 10) : 0.05, symbol: "*" }])}
          >
            + Add threshold
          </button>
          <button
            type="button"
            className="btn-mini"
            title={scope === "graph" ? "Follow the Settings default again" : "Back to the built-in thresholds"}
            disabled={!custom}
            onClick={() => onChange(undefined)}
          >
            Reset
          </button>
        </span>
      </div>

      {/* Live preview — the same formatter the figure uses, so this cannot lie. */}
      <div className="frow" style={{ alignItems: "flex-start" }}>
        <span>Preview</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 11 }}>
          {[0.5, 0.04, 0.004, 0.0004, 0.00004].map((p) => {
            // A p that clears no rung is not drawn at all while `hide` is on — the preview
            // has to say so, or it promises a label the figure will never show.
            const dropped = (hideNs ?? true) && !rows.some((r) => p < r.p);
            return (
              <span key={p} style={{ opacity: 0.85 }}>
                {p} →{" "}
                {dropped ? (
                  <em style={{ opacity: 0.7 }} title="Hidden: this comparison is not drawn at all">
                    not drawn
                  </em>
                ) : (
                  <strong>{formatSignificance(p, display, 3, false, { thresholds: value, nsSymbol }) || "—"}</strong>
                )}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

/** True when a ladder is the built-in one — used to keep untouched documents clean. */
export function isFactoryLadder(list: SignificanceThreshold[] | undefined): boolean {
  if (list === undefined) return true;
  const f = FACTORY_SIGNIFICANCE_THRESHOLDS;
  return list.length === f.length && list.every((r, i) => r.p === f[i]!.p && r.symbol === f[i]!.symbol);
}
