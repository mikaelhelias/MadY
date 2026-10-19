// @vitest-environment jsdom
/**
 * The function matrix — every control, on every chart kind, under every scope.
 *
 * The list of what MadY can do is generated from code here, not written by hand, and
 * every entry it generates is then driven and asserted. A hand-maintained list lets defects
 * survive: covering the scope through a single colour swatch leaves every other path (e.g.
 * the width control) untested.
 *
 * Enumerated from:
 *   • chart kinds        → `galleryItems()` (every gallery card, each a curated example)
 *   • selectable targets → the selection kinds each kind's Inspector actually accepts
 *   • controls           → whatever the rendered panel contains (never a hard-coded list)
 *   • scope              → whole-graph on · whole-series on · both off
 *
 * Invariants asserted per entry:
 *   1. Commits      — touching a control reaches the document (no inert control)
 *   2. Cardinality  — the edit hits the set the active scope promises
 *   3. Reachable    — the control is enabled for that kind
 *
 * Limit: this forces every exemption to be written down with a reason; it cannot check that the
 * reason is right. Every EXPECTED_INERT reason is a maintainer's claim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";
import { galleryItems } from "./gallery";
import { SCATTER_SUMMARY_OPTS, scatterSummaryPair } from "./columnScatterSummary";

afterEach(cleanup);

/**
 * Let queued timers run after each unmount. Opening a <details> section (the Inspector's collapsible sections) queues its
 * "toggle" event on a timer; these loops render thousands of panels without ever yielding, so without this every one of
 * those timers stays pending and holds its whole unmounted panel, and the file grows past the 4 GB worker limit inside
 * the full suite.
 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Every mutation handler the Inspector can call, spied. */
function handlers() {
  return {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
}
type H = ReturnType<typeof handlers>;

/** Reset every spy so the next control starts from a clean slate. */
function clearSpies(h: H): void {
  for (const [k, v] of Object.entries(h)) {
    if (k === "annotationOps") continue;
    (v as ReturnType<typeof vi.fn>).mockClear?.();
  }
  for (const f of Object.values(h.annotationOps)) f.mockClear();
}

/** Did any document-mutating handler fire? (onSelect is navigation, not a mutation.) */
function commits(h: H): boolean {
  for (const [k, v] of Object.entries(h)) {
    if (k === "onSelect" || k === "annotationOps") continue;
    if ((v as ReturnType<typeof vi.fn>).mock?.calls.length) return true;
  }
  return Object.values(h.annotationOps).some((f) => f.mock.calls.length > 0);
}

/** A stable, human-readable name for a control, for the failure report. A second control on a row that names itself
 *  "<row>: <part>" (the "Bar width: whole graph" tick box beside the Bar width slider) is reported under that name —
 *  under the row's name alone, excusing one would excuse the other. */
function labelOf(el: HTMLElement): string {
  const row = el.closest(".frow");
  const span = row?.querySelector(":scope > span");
  const own = el.getAttribute("aria-label")?.trim();
  if (span && own && own.startsWith(`${(span.textContent ?? "").trim()}: `)) return own;
  const text = (span?.textContent ?? el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "").trim();
  return text || `<${el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? ` type=${(el as HTMLInputElement).type}` : ""}>`;
}

/** Drive one control the way a user would. Returns false if we don't know how. */
function drive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    const other = [...sel.options].find((o) => o.value !== sel.value && !o.disabled);
    if (!other) return false; // single-option select — nothing a user could change
    fireEvent.change(sel, { target: { value: other.value } });
    return true;
  }
  if (tag === "button") {
    fireEvent.click(el);
    return true;
  }
  const inp = el as HTMLInputElement;
  if (inp.type === "checkbox" || inp.type === "radio") {
    fireEvent.click(inp);
    return true;
  }
  if (inp.type === "color") {
    fireEvent.change(inp, { target: { value: "#123456" } });
    fireEvent.blur(inp);
    return true;
  }
  if (inp.type === "number" || inp.type === "range") {
    const cur = Number(inp.value);
    const min = inp.min === "" ? -1e6 : Number(inp.min);
    const max = inp.max === "" ? 1e6 : Number(inp.max);
    const step = inp.step === "" || inp.step === "any" ? 1 : Number(inp.step);
    const next = Number.isFinite(cur) ? Math.min(max, Math.max(min, cur + step)) : min;
    if (next === cur) return false;
    fireEvent.change(inp, { target: { value: String(next) } });
    fireEvent.blur(inp);
    return true;
  }
  if (inp.type === "text" || inp.type === "") {
    fireEvent.change(inp, { target: { value: "zz" } });
    fireEvent.blur(inp);
    return true;
  }
  return false;
}

/**
 * Controls that legitimately ignore the whole-graph scope, with the reason. Kept separate from
 * EXPECTED_INERT because these do commit — they just commit to one target on purpose.
 */
const SCOPE_EXEMPT: { match: RegExp; reason: string }[] = [
  {
    match: /^Show \/ hide this series/i,
    reason:
      "one row of the per-series list, where every series has its own checkbox. The scope toggle " +
      "governs the style editor below the list, not the list itself — fanning this out would hide " +
      "every series at once and blank the chart, which no user ticking 'apply to whole graph' is asking for.",
  },
];

/**
 * Controls that legitimately do not mutate the document when touched, with the reason.
 * Anything else that fails to commit is reported as a defect.
 */
const EXPECTED_INERT: { match: RegExp; reason: string }[] = [
  { match: /^Find an option/i, reason: "the panel's own search box — filters the UI, touches no document state" },
  {
    match: /^The EC50 \/ IC50 crosshair is a reference line/,
    reason:
      "the \"EC50 / IC50 marker →\" button in the Fit panel, which opens the fit-marker reference " +
      "line's own panel (a selection change, like the `Open … (reference line)` rows below). " +
      "Reachable since the XY card carries a fitted curve with a potency marker.",
  },
  {
    match: /^Open .+ \(reference line\)$/,
    reason:
      "the name of a row in the Chart tab's reference-line list, which is a button that opens " +
      "that line's panel. It changes the selection and nothing else, and `commits()` ignores " +
      "onSelect on purpose (a selection is not a document edit). What this stops measuring " +
      "is measured harder in `refline-panel.test.tsx` — 'the Chart tab's list' asserts each " +
      "row's button emits {kind:\"refline\", id} for the right id, which is stricter than " +
      "'something was called'. The regex can only match this aria-label, and the Show switch " +
      "on the same row is named 'Show <line>' and stays measured here: the row deliberately " +
      "carries no leading <span>, because with one both controls would report under the row " +
      "name and this exemption would have silenced the switch too.",
  },
  { match: /^Preset$|^Template$|^Save as|^Delete preset/i, reason: "preset/template pickers need a chosen name before they apply" },
  { match: /^Apply to whole (graph|series)$/i, reason: "the scope toggles themselves — they steer the next edit rather than being one" },
  {
    match: /^(Point spread|Bar width): whole graph$/,
    reason:
      "the 'whole graph' tick box beside a slider: it chooses where the slider's next " +
      "change goes (every series or the clicked one) — a scope toggle like the two above. The slider on " +
      "the same row commits and stays measured here under the row's own name; which target each tick " +
      "state writes is measured in `point-spread.test.tsx` and `bar-width-per-series.test.tsx`.",
  },
  {
    match: /^Include this graph type's own settings$/,
    reason:
      "the Save-as-preset option: ticked, the next Save also carries the graph type's own " +
      "settings as a section of the preset; it steers that save rather than being an edit, " +
      "exactly like the scope toggles above. The Save button beside it is what commits, and " +
      "`Inspector.presets.test.tsx` asserts the tick's state reaches it (true / false).",
  },
  { match: /^Import|^Export/i, reason: "file I/O, not a document mutation" },
  {
    match: /^Manage presets$/,
    reason:
      "a view toggle: it shows or hides the management row on your preset cards (handle, the " +
      "open type, the types chip, the ⋯ menu) and edits nothing. What it reveals is measured " +
      "in `UserPresetList.test.tsx` (every control there calls its store function) and the " +
      "toggle itself in `Inspector.presets.test.tsx` (simple by default, pressed reveals, Done hides).",
  },
  {
    match: /^(Band (start|end|colour)|Break (start|end)|New tick (value|label))$/i,
    reason:
      "a draft field of a composer (shaded bands · axis breaks · extra ticks). It holds local " +
      "state until its own Add button is pressed — that button is the control that commits. " +
      "Writing on every keystroke would add a band the moment the first digit of its start " +
      "value was typed, and there is no partial band to add. These carry an `aria-label` " +
      "precisely so this exemption can name them: matching them by their generic " +
      "`<input type=number>` fallback would blanket-exempt every unlabelled number box in the " +
      "Inspector, and hide a control that really does nothing behind the same regex.",
  },
  {
    match: /^(Preset|Template) name$/i,
    reason:
      "the name box of Save-as-preset / Save-as-template — the Save button beside it is what " +
      "commits, and it needs the typed name to exist first. Same composer shape as the band and " +
      "tick adders above.",
  },
];

function inertReason(label: string): string | undefined {
  return EXPECTED_INERT.find((e) => e.match.test(label))?.reason;
}

/**
 * Is the Axis rail tab live for this kind? Read off the rendered rail rather than a hand-kept
 * list: a kind whose Axis tab is greyed (matrix heatmap, network) has no axis panel a user can
 * open, so driving one would be coverage of a surface that does not exist.
 */
function axisTabLive(plot: Plot, table: DataTable): boolean {
  const { container } = render(<Panel plot={plot} table={table} selection={{ kind: "plot" }} h={handlers()} />);
  const btn = [...container.querySelectorAll<HTMLButtonElement>("button.inspcat")]
    .find((b) => (b.textContent ?? "").trim() === "Axis");
  const live = !!btn && !btn.classList.contains("disabled");
  cleanup();
  return live;
}

/**
 * Selections worth driving per kind: the plot itself (whose five reachable rail tabs
 * `eachControlIn` walks), its first series, and each axis.
 *
 * The axis targets are not optional garnish — the axis panel is ~90 controls per axis and the
 * rail's own "Axis" button only re-selects, so without them roughly half of the surface of every
 * kind with axes is unreachable from this suite no matter how the rail is driven.
 */
function targetsFor(table: DataTable, plot: Plot): { name: string; selection: GraphSelection }[] {
  const ds = tableDatasets(table);
  const out: { name: string; selection: GraphSelection }[] = [{ name: "plot", selection: { kind: "plot" } }];
  if (ds[0]) out.push({ name: "series", selection: { kind: "series", columnId: ds[0].id, part: "points" } });
  if (axisTabLive(plot, table)) {
    out.push({ name: "axis:x", selection: { kind: "axis", axis: "x" } });
    out.push({ name: "axis:y", selection: { kind: "axis", axis: "y" } });
  }
  return out;
}

interface Finding { kind: string; target: string; control: string; problem: string }

describe("function matrix — every control on every chart kind must do something", () => {
  const items = galleryItems();

  it("enumerates a non-trivial matrix (a shrinking matrix means coverage silently vanished)", () => {
    expect(items.length).toBeGreaterThanOrEqual(30);
  });

  it("no control anywhere is inert", { timeout: 300_000 }, async () => {
    const findings: Finding[] = [];
    let driven = 0;

    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      for (const t of targetsFor(item.table, item.plot)) {
        // One render per (kind, target), then drive each control with the spies cleared in
        // between. Safe because every handler here is a spy: the plot prop never actually
        // changes, so the panel's contents are stable across the loop. (Re-rendering per
        // control would be correct but quadratic in time.)
        const h = handlers();
        const { container } = render(<Panel plot={item.plot} table={item.table} selection={t.selection} h={h} />);
        eachControlIn(container, t.name, (el) => {
          const label = labelOf(el);
          if ((el as HTMLInputElement).disabled || inertReason(label)) return;
          clearSpies(h);
          if (!drive(el)) return;
          driven += 1;
          if (!commits(h)) findings.push({ kind, target: t.name, control: label, problem: "changing it mutates nothing" });
        });
        cleanup();
        await settle();
      }
    }

    // The floor sits just under the real number of driven controls, so that losing a rail
    // tab, a target, or the axis panel fails instead of quietly shrinking the coverage. A low
    // floor (a few hundred) would pass on a tiny fraction of the controls.
    expect(driven, "the matrix drove far too few controls — the harness is broken, not the app").toBeGreaterThan(10_000);
    const report = findings.map((f) => `${f.kind} / ${f.target} / "${f.control}" — ${f.problem}`).sort();
    expect(
      report,
      `Controls that change nothing (${report.length} of ${driven} driven). Each is either a control to fix, ` +
        `or a deliberate no-op that must be added to EXPECTED_INERT with a reason:\n  - ` + report.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});

describe("function matrix — scope: an edit must hit the set the toggle promises", () => {
  const items = galleryItems();

  /**
   * With "Apply to whole graph" on, a per-series style edit must fan out to every series
   * (`onSetSeriesStyleAll`) and must not write a single series or a single point. Checked for
   * every series-level control on every chart kind, not only through a colour swatch: a width
   * control that wrote one series would otherwise go unseen.
   */
  it("whole-graph on: no series-level control writes a single series", { timeout: 300_000 }, async () => {
    const findings: Finding[] = [];
    let driven = 0;

    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      const ds = tableDatasets(item.table);
      if (ds.length < 2) continue; // scope is meaningless with one series
      const sel: GraphSelection = { kind: "series", columnId: ds[0]!.id, part: "points" };

      const h = handlers();
      const { container } = render(
        <Inspector activeSection="graphs" selection={sel} plot={item.plot} table={item.table}
          userPresets={[]} profileDefault={null} wholeGraph onSetWholeGraph={() => {}} {...h} />,
      );
      eachControlIn(container, "series", (el) => {
        const label = labelOf(el);
        if ((el as HTMLInputElement).disabled || inertReason(label)) return;
        if (SCOPE_EXEMPT.some((e) => e.match.test(label))) return;
        clearSpies(h);
        if (!drive(el)) return;
        // Only judge controls that took the per-series route at all; plot-wide options
        // (onSetPlotOptions et al.) are already graph-wide by construction.
        const one = h.onSetSeriesStyle.mock.calls.length;
        const point = h.onSetPointStyle.mock.calls.length;
        const all = h.onSetSeriesStyleAll.mock.calls.length;
        if (one + point + all === 0) return;
        driven += 1;
        if (one > 0) findings.push({ kind, target: "series", control: label, problem: "wrote one series while whole-graph was on" });
        else if (point > 0) findings.push({ kind, target: "series", control: label, problem: "wrote one point while whole-graph was on" });
      });
      cleanup();
      await settle();
    }

    expect(driven, "no series-level control was exercised — the harness is broken").toBeGreaterThan(50);
    const report = [...new Set(findings.map((f) => `${f.kind} / "${f.control}" — ${f.problem}`))].sort();
    expect(
      report,
      `Scope leaks (${report.length} distinct, of ${driven} series-level edits driven). With "Apply to ` +
        `whole graph" ticked these still changed one thing:\n  - ` + report.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});

/** Every leaf value carried by any mutation call — what actually reached the document. */
function writtenLeaves(h: H): unknown[] {
  const out: unknown[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") { for (const x of Object.values(v as object)) walk(x, depth + 1); return; }
    out.push(v);
  };
  for (const [k, v] of Object.entries(h)) {
    if (k === "onSelect" || k === "annotationOps") continue;
    for (const call of (v as ReturnType<typeof vi.fn>).mock?.calls ?? []) walk(call, 0);
  }
  for (const f of Object.values(h.annotationOps)) for (const call of f.mock.calls) walk(call, 0);
  return out;
}

/**
 * Was `set` — the value the user just put into the control — actually written?
 *
 * Accepts the legitimate re-expressions this codebase uses, and nothing else:
 *  • a percent control stored as a fraction (70 → 0.7) and the reverse,
 *  • a colour echoed in any case,
 *  • a boolean stored as its inverse (a "Hide X" checkbox backing a `show` field).
 */
function valueReached(set: string | number | boolean, leaves: unknown[]): boolean {
  if (typeof set === "boolean") return leaves.some((l) => l === set || l === !set);
  const numeric = (v: string | number): number => (typeof v === "number" ? v : Number(v));
  const asNum = numeric(set);
  if (Number.isFinite(asNum) && !(typeof set === "string" && set.trim() === "")) {
    // A <select>'s value is always a string; the model stores the number. "2" and 2 are the
    // same answer, and treating them as different would report working controls as broken.
    const hit = leaves.some((l) => {
      const n = typeof l === "number" ? l : typeof l === "string" ? Number(l) : NaN;
      if (!Number.isFinite(n)) return false;
      return Math.abs(n - asNum) < 1e-6 || Math.abs(n - asNum / 100) < 1e-6 || Math.abs(n - asNum * 100) < 1e-6;
    });
    if (hit) return true;
    if (typeof set === "number") return false;
  }
  const want = String(set).toLowerCase();
  return leaves.some((l) => typeof l === "string" && l.toLowerCase() === want);
}

/**
 * Controls whose written value cannot be checked generically, with the reason. Each still has
 * to commit — that is the commit check's job; only the value check is waived here.
 */
const VALUE_UNCHECKABLE: { match?: RegExp; within?: string; reason: string }[] = [
  {
    match: /^Link ticks to axis$/i,
    reason:
      "an enable/override toggle whose stored value is a width: unticking writes `tickWidth` = the " +
      "axis line's current thickness (so the two can then diverge), ticking writes undefined (= follow " +
      "the axis). Boolean control, numeric field — the same different-vocabulary case as 'Custom edge " +
      "colour'. That the derived width lands is checked by the commit test (\"no control anywhere is inert\").",
  },
  {
    within: ".legend-show-row",
    reason:
      "the legend's three-state Show (Auto / Always / Hidden) backing an optional boolean: 'auto' → " +
      "undefined, 'on' → true, 'off' → false. Scoped by class, not by /^Show$/: two other controls " +
      "are also labelled 'Show' (fit parameters, corr-matrix triangle) and both are checkable, so " +
      "a label regex would silently stop checking two working controls to excuse this one.",
  },
  {
    within: ".seriesaxis-row",
    reason:
      "the 'Series on this axis' picker — a checkbox editing membership, so unticking writes the other " +
      "axis's id (\"y2\"), never a boolean. Scoped by class because its label is the series' own name " +
      "(\"Drug A\", \"Signal\"), which no regex can enumerate.",
  },
  {
    match: /^(Font|Cell icon|Colour by group|Group by|Icon column)$/i,
    reason:
      "a picker whose blank option means inherit/none, i.e. writes `undefined`. An undefined leaf " +
      "is indistinguishable from 'nothing was written', so only the commit test can judge these.",
  },
  {
    match: /^(Axes|Levels|Grid lines|Design)$/i,
    reason:
      "the control's value and the stored value are different vocabularies — a checkbox backing an " +
      "enum ('Grid lines' off → \"none\"), a select backing a boolean ('Design' paired → true), or a " +
      "toggle editing membership of a list ('Axes' = alluvial axes, 'Levels' = sunburst level " +
      "columns). Verifying these needs per-control knowledge, so they are named here rather than " +
      "silently passed.",
  },
  {
    match: /^Custom edge colour$/i,
    reason:
      "an enable/override toggle shown only for two-tone markers: ticking it writes a derived edge " +
      "colour (twoToneEdge = the hue's contour), un-ticking writes undefined — a boolean control whose " +
      "stored value is a colour, the same different-vocabulary case as 'Design' / 'Grid lines'. It " +
      "is visible on every kind because two-tone is the house-default marker; the commit check " +
      "(which checks the derived colour actually lands) covers it.",
  },
  {
    match: /^Pin to$/,
    reason:
      "a mode select (Plot position / Data value) whose stored value is a pair of data values: 'Data value' " +
      "writes `anchorX` / `anchorY` = the values the text or tip sits at now (a category id and a number on a " +
      "bar chart), 'Plot position' clears both. The same different-vocabulary case as 'Custom edge colour'. " +
      "Measured harder in `annotation-anchor.test.tsx`: Data value pins the axes the builder can resolve at " +
      "where the text sits, Plot position clears both, a bar chart / estimation offer Y only.",
  },
];

/**
 * Is this control's written value un-checkable generically, and why? An entry may name the
 * control by label, or — when the label is user data or is shared with controls that are
 * checkable — by the structure it sits in. An entry with neither would exempt everything, so
 * both forms are required to narrow.
 */
function valueUncheckable(el: HTMLElement, label: string): string | undefined {
  return VALUE_UNCHECKABLE.find(
    (e) =>
      (e.match || e.within) &&
      (e.match ? e.match.test(label) : true) &&
      (e.within ? !!el.closest(e.within) : true),
  )?.reason;
}

/** Drive a control and report the value that was set, so the write can be checked. */
function driveWithValue(el: HTMLElement): string | number | boolean | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    const other = [...sel.options].find((o) => o.value !== sel.value && !o.disabled);
    if (!other) return null;
    fireEvent.change(sel, { target: { value: other.value } });
    return other.value;
  }
  if (tag === "button") return null; // a swatch's value is implicit — covered by the commit test
  const inp = el as HTMLInputElement;
  if (inp.type === "checkbox" || inp.type === "radio") {
    const next = !inp.checked;
    fireEvent.click(inp);
    return next;
  }
  if (inp.type === "color") {
    fireEvent.change(inp, { target: { value: "#123456" } });
    fireEvent.blur(inp);
    return "#123456";
  }
  if (inp.type === "number" || inp.type === "range") {
    const cur = Number(inp.value);
    const min = inp.min === "" ? -1e6 : Number(inp.min);
    const max = inp.max === "" ? 1e6 : Number(inp.max);
    const step = inp.step === "" || inp.step === "any" ? 1 : Number(inp.step);
    const next = Number.isFinite(cur) ? Math.min(max, Math.max(min, cur + step)) : min;
    if (next === cur) return null;
    fireEvent.change(inp, { target: { value: String(next) } });
    fireEvent.blur(inp);
    return next;
  }
  return null;
}

/**
 * The column-scatter "Summary" select — identified by its exact option-key set, not by label
 * or value (its keys "sd"/"sem"/"ci95" collide with the bar family's error-bar type values).
 * It is the one control that maps a single coherent key to a (centre, error) pair, so its
 * write is checked against the decoded pair, not the literal key. Returns null for any other
 * control (which then goes through the generic `valueReached`).
 */
function isScatterSummarySelect(el: HTMLElement): boolean {
  if (el.tagName.toLowerCase() !== "select") return false;
  const vals = [...(el as HTMLSelectElement).options].map((o) => o.value).sort();
  const keys = SCATTER_SUMMARY_OPTS.map((o) => o.key).sort();
  return vals.length === keys.length && vals.every((v, i) => v === keys[i]);
}

describe("function matrix — value: the document must receive what the control was set to", () => {
  const items = galleryItems();

  it("no control writes a value other than the one it was given", { timeout: 300_000 }, async () => {
    const findings: Finding[] = [];
    let checked = 0;

    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      for (const t of targetsFor(item.table, item.plot)) {
        const h = handlers();
        const { container } = render(<Panel plot={item.plot} table={item.table} selection={t.selection} h={h} />);
        eachControlIn(container, t.name, (el) => {
          const label = labelOf(el);
          if ((el as HTMLInputElement).disabled || inertReason(label)) return;
          if (valueUncheckable(el, label)) return;
          clearSpies(h);
          const set = driveWithValue(el);
          if (set === null || set === "") return; // blank = "inherit / none" → writes undefined
          const leaves = writtenLeaves(h);
          if (leaves.length === 0) return; // a control that writes nothing is the commit test's finding
          checked += 1;
          // The "Summary" pair-control lands as both its centre and its spread; a dropped or
          // mis-decoded half still fails here (the check stays live, it is not exempted).
          //
          // A clearing select option writes undefined (Axis ▸ Scale "auto" clears `scale`;
          // a band's Anchor "frac" clears `bandLo`/`bandHi`), and writtenLeaves drops
          // null/undefined by design, so the cleared value is invisible here. Accept only the
          // named sentinels below, and only when none of the select's other option values were
          // written — a control that writes "linear" when told "auto" is still a mismatch.
          // (A select that stores the sentinel as a real value, like Colour-by Mapping's
          // "auto", passes valueReached first and never reaches this branch.) Add a sentinel
          // here only with the control named beside it.
          const CLEARING_SENTINELS = new Set(["auto" /* Axis ▸ Scale ▸ Type */, "tile" /* Heatmap ▸ Cells — clears `cellShape`, the tile default */, "frac" /* Annotation band ▸ Anchor */, "density" /* Ridgeline ▸ Rows show (clears `source`; reachable because the card wears the profile fold) */]);
          const clearedToAuto =
            typeof set === "string" &&
            CLEARING_SENTINELS.has(set) &&
            el.tagName === "SELECT" &&
            !leaves.some((l) => typeof l === "string" && l !== set && [...(el as HTMLSelectElement).options].some((o) => o.value === l));
          // Resize = uniform scale: the "Width N" / "Height N" sliders set only
          // `Plot.displayScale`, never the layout size. Set to M they must store the scale M / N — N being the
          // size the slider shows, which is the layout size on a card at scale 1. Checked exactly, not waived:
          // a slider that stored the wrong scale (or changed the layout size instead of the scale) still fails.
          const sizeSlider = /^(Width|Height) (\d+(?:\.\d+)?)$/.exec(label);
          if (sizeSlider && (item.plot as { displayScale?: number }).displayScale !== undefined) {
            throw new Error(`${kind}: the card is not at scale 1, so "${label}" no longer names its layout size — measure it another way`);
          }
          const ok = isScatterSummarySelect(el)
            ? (() => { const p = scatterSummaryPair(String(set)); return leaves.includes(p.center) && leaves.includes(p.error); })()
            : sizeSlider && typeof set === "number"
              ? leaves.some((l) => typeof l === "number" && Math.abs(l - set / Number(sizeSlider[2])) < 1e-9)
              : valueReached(set, leaves) || clearedToAuto;
          if (!ok) {
            findings.push({ kind, target: t.name, control: label, problem: `set to ${JSON.stringify(set)} but wrote ${JSON.stringify(leaves.slice(0, 4))}` });
          }
        });
        cleanup();
        await settle();
      }
    }

    // Well under `driven` above: only controls that wrote something reach the value check.
    expect(checked, "far too few values were checked — the harness is broken").toBeGreaterThan(3_500);
    const report = [...new Set(findings.map((f) => `${f.kind} / ${f.target} / "${f.control}" — ${f.problem}`))].sort();
    expect(
      report,
      `Value mismatches (${report.length} distinct, of ${checked} checked). The control said one thing ` +
        `and the document got another:\n  - ` + report.join("\n  - ") + "\n",
    ).toEqual([]);
  });
});

/**
 * Controls a user can actually touch in the rendered panel.
 *
 * Note: the `hidden` walk is load-bearing and must stay: the plot panel splits its sections across
 * the category rail (`inspcats` in `Inspector.tsx`), and every section belonging to a tab other than the
 * active one is given `el.hidden = true`. Dropping the filter would drive sections the user
 * cannot reach at all — including the ones deliberately disabled for a kind (a heatmap's Axis/Data
 * tabs, a network's Annotate tab), which is coverage of a surface that does not exist.
 *
 * The right answer is to change tabs instead, which is what `eachControlIn` does.
 */
function controlsIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("input, select, button.swbtn")]
    .filter((el) => !el.closest(".inspcat"))
    .filter((el) => {
      for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.hidden) return false;
      return true;
    });
}

/**
 * The rail tabs the plot panel's sections are split across, in rail order.
 *
 * Only these five are reachable by clicking: "Axis" and "Data" re-select instead (they route
 * through `onSelect`, whose selection this suite controls), so they are covered by the `axis:x` /
 * `axis:y` / `series` targets rather than by a click here.
 *
 * Driving every tab matters: one render shows one tab, so without it each kind would offer only
 * the few controls of its first tab, and a low floor on the number of driven controls would
 * still pass while most of the panel went untested.
 */
const PLOT_RAIL_TABS = ["Chart", "Frame", "Text", "Annotate", "Style"];

/**
 * Every control this target can reach, driving the rail so no tab is left out. A disabled
 * rail tab is skipped on purpose — its sections are inert for this kind by design.
 */
function eachControlIn(container: HTMLElement, target: string, fn: (el: HTMLElement) => void): void {
  if (target !== "plot") {
    for (const el of controlsIn(container)) fn(el);
    return;
  }
  for (const label of PLOT_RAIL_TABS) {
    const btn = [...container.querySelectorAll<HTMLButtonElement>("button.inspcat")]
      .find((b) => (b.textContent ?? "").trim() === label);
    if (!btn || btn.classList.contains("disabled")) continue;
    fireEvent.click(btn);
    for (const el of controlsIn(container)) fn(el);
  }
}

function Panel({ plot, table, selection, h }: { plot: Plot; table: DataTable; selection: GraphSelection; h: H }) {
  return (
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...h} />
  );
}
