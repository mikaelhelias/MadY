// @vitest-environment jsdom
/**
 * The figure page's control census: every control on the figure (panel assembly) page, and the document change it
 * makes. It checks that moving controls between the toolbar, the menus and the right panel loses none.
 *
 * A regrouping moves controls (into menus, into the right panel); it must not lose one, and every one must still make
 * exactly the change it made before. So this presses every control it can find — read off the rendered page, never a
 * hand list — in each situation that shows different controls, records what reached the document, and compares that
 * with the recorded baseline `figure-controls.census.json`:
 *
 *   • a document change recorded before and missing now    → a control was lost (or now writes something else)
 *   • a document change that is new                        → a control makes a change it did not make before
 *   • a control that changes nothing (a view control: zoom, a menu that only opens) → it must still exist by name
 *
 * Where a control lives (toolbar, a menu, the right panel) is deliberately not compared, since that is the part a
 * regrouping changes. What it does is compared.
 *
 * Record again only on purpose: `CENSUS_WRITE=1 npx vitest run <this file>`, and say in the commit what changed and why.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Annotation, DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { LayoutPane } from "./panes";
import { saveFigureTemplate } from "./figureTemplates";

const cleanPage = (): void => { cleanup(); document.body.innerHTML = ""; };
afterEach(cleanPage);
/** Let the timers an unmounted panel queued run; left pending, they keep memory alive across cases (see function-matrix.test). */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Vitest runs from the repo root (vitest.config.ts); jsdom gives `import.meta.url` a web address, not a file. */
const BASELINE = join(process.cwd(), "apps/desktop/src/renderer/src/shell/figure-controls.census.json");

// ── The figure: three panels (distribute needs 3), a page, and one text / box / arrow on the canvas ─────────────
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
};
const plot = (id: string, name: string): Plot => ({ id, name, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });
const ANNS: Annotation[] = [
  { id: "fa-t", kind: "text", label: "Note", x: 200, y: 40 },
  { id: "fa-r", kind: "rect", x: 100, y: 60, w: 120, h: 80 },
  { id: "fa-a", kind: "arrow", x: 20, y: 20, x2: 160, y2: 20 },
];
const layout: FigureLayout = {
  id: "L", name: "Figure 1", panels: ["A", "B", "C"], freeform: true, showGrid: true, showRuler: true,
  page: { wMm: 210, hMm: 297 }, figureAnnotations: ANNS,
  // Out of reading order (C left of B left of A), so Renumber has something to re-letter.
  panelPositions: { A: { x: 520, y: 0 }, B: { x: 260, y: 0 }, C: { x: 0, y: 0 } },
} as FigureLayout;
const project: Project = {
  schemaVersion: 5,
  tables: [table],
  plots: [plot("A", "Alpha"), plot("B", "Beta"), plot("C", "Gamma"), plot("D", "Delta")],
  analyses: [], layouts: [layout], log: [], workspace: { folders: [], loose: [] },
} as unknown as Project;

// ── Every handler the page can call, spied ─────────────────────────────────────────────────────────────────────
function spies() {
  const top = {
    onRemovePanel: vi.fn(), onOpenPlot: vi.fn(), onSetLayoutOptions: vi.fn(), onMatchStyles: vi.fn(), onPatchPanels: vi.fn(),
    onApplyPanelPreset: vi.fn(), onAddImagePanel: vi.fn(), onExport: vi.fn(), onAddPanel: vi.fn(),
    onDuplicatePanel: vi.fn(), onSetLinked: vi.fn(), onMoveFigureAnnotation: vi.fn(), onUpdateFigureAnnotation: vi.fn(),
    onRemoveFigureAnnotation: vi.fn(),
    // Insert hands back an object that is already on the figure, so the page selects it exactly as after a real insert.
    onAddFigureAnnotation: vi.fn((a: Omit<Annotation, "id">): Annotation | undefined => {
      const hit = ANNS.find((x) => x.kind === a.kind);
      return hit ? { ...hit } : undefined;
    }),
  };
  const editing = {
    selection: { kind: "plot" as const }, selectedPlot: null as string | null,
    onSelectPanel: vi.fn(), onClearPanel: vi.fn(), onSelect: vi.fn(), onWidthResize: vi.fn(),
    onMoveAnnotation: vi.fn(), onMoveRefLineLabel: vi.fn(), onDeleteAnnotation: vi.fn(), onReorderAnnotation: vi.fn(), onDuplicateAnnotation: vi.fn(),
    onFigureResize: vi.fn(), onEditText: vi.fn(), onCreateTextBox: vi.fn(), onAxisResize: vi.fn(),
    onMoveTitle: vi.fn(), onMoveLegend: vi.fn(), onMoveColorbar: vi.fn(), onMoveAxisTitle: vi.fn(),
  };
  return { top, editing };
}
type Spies = ReturnType<typeof spies>;
/** Selecting and navigating are not document changes. */
const NOT_A_CHANGE = new Set(["onSelectPanel", "onClearPanel", "onSelect", "onOpenPlot"]);

/** What reached the document: every spied call, in order, as text. */
function changes(s: Spies): string[] {
  const out: string[] = [];
  const all: [string, ReturnType<typeof vi.fn>][] = [...Object.entries(s.top), ...Object.entries(s.editing).filter(([, v]) => typeof v === "function")] as never;
  for (const [name, fn] of all) {
    if (NOT_A_CHANGE.has(name)) continue;
    for (const args of fn.mock.calls) out.push(`${name}(${JSON.stringify(args, (_k, v) => {
      if (typeof v === "number") return Math.round(v * 1000) / 1000;
      if (typeof v === "function") return "fn";
      // A handler handed the click itself (onClick={onExport}): what matters is that it was called.
      if (v && typeof v === "object" && ("nativeEvent" in v || v instanceof Event)) return "<event>";
      if (v instanceof Node) return "<element>";
      return v;
    })})`);
  }
  return out.sort();
}
function clear(s: Spies): void {
  for (const fn of Object.values(s.top)) fn.mockClear();
  for (const v of Object.values(s.editing)) if (typeof v === "function") (v as ReturnType<typeof vi.fn>).mockClear();
}

// ── The situations that show different controls ────────────────────────────────────────────────────────────────
interface Situation { name: string; setup: (root: HTMLElement, s: Spies) => void; selectedPlot?: string }
const pressInsert = (root: HTMLElement, label: string): void => {
  // The object buttons are inside the toolbar's Insert ▾ — open it first, as a user does.
  const menu = [...root.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")].find((x) => /^Insert/.test(x.textContent ?? ""));
  if (menu) fireEvent.click(menu);
  const b = [...root.querySelectorAll<HTMLButtonElement>("button")].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no Insert ▸ ${label} — the census cannot reach the ${label} settings`);
  fireEvent.click(b);
};
const SITUATIONS: Situation[] = [
  { name: "nothing selected", setup: () => {} },
  { name: "a text selected", setup: (r) => pressInsert(r, "Text") },
  { name: "a box selected", setup: (r) => pressInsert(r, "Box") },
  { name: "an arrow selected", setup: (r) => pressInsert(r, "Arrow") },
  { name: "one panel selected", setup: () => {}, selectedPlot: "A" },
  {
    name: "three panels selected",
    setup: (r) => { for (const p of [...r.querySelectorAll<HTMLElement>(".laypanel")]) fireEvent.mouseDown(p, { shiftKey: true }); },
  },
];

// ── Finding and pressing controls ──────────────────────────────────────────────────────────────────────────────
const norm = (t: string | null | undefined): string => (t ?? "").replace(/\s+/g, " ").trim();
/** The controls on the page outside the panels' own drawings (their graphs are a different census). */
function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, input, select, textarea")].filter(
    (el) => !el.closest(".laypanel, svg") && (el as HTMLInputElement).type !== "file" && !(el as HTMLInputElement).disabled,
  );
}
/** A name a person would recognise: the control's own label (separate elements in it read as separate words), else its row's, else its tooltip. */
function nameOf(el: HTMLElement): string {
  const own = el.getAttribute("aria-label") ?? (el.tagName === "BUTTON" ? norm([...el.childNodes].map((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : ` ${n.textContent} `)).join("")) : "");
  if (own) return own;
  const lab = el.closest("label");
  const labText = lab ? norm([...lab.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE || (n as Element).tagName === "SPAN").map((n) => n.textContent).join(" ")) : "";
  return labText || clipAtWord(norm(el.getAttribute("title")), 60) || `<${el.tagName.toLowerCase()}>`;
}

/** `text` cut to at most `max` characters at a word boundary, with "…" when it was cut. */
export function clipAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const lastSpace = head.search(/\s\S*$/);
  return (lastSpace > 0 ? head.slice(0, lastSpace).trimEnd() : text.slice(0, max)) + "…";
}
/** Stable key within one render: the name plus which of the same-named controls it is. */
function keyed(root: HTMLElement): { key: string; el: HTMLElement }[] {
  const seen = new Map<string, number>();
  return controls(root).map((el) => {
    const base = `${nameOf(el)} <${el.tagName.toLowerCase()}${(el as HTMLInputElement).type && el.tagName === "INPUT" ? `:${(el as HTMLInputElement).type}` : ""}>`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { key: n > 1 ? `${base} #${n}` : base, el };
  });
}
/** Every way to press a control once: a select gives one press per other option. */
function presses(el: HTMLElement): { label: string; run: () => void }[] {
  if (el instanceof HTMLSelectElement) {
    return [...el.options].filter((o) => o.value !== el.value && !o.disabled).map((o) => ({
      label: `= ${o.value}`,
      run: () => { fireEvent.change(el, { target: { value: o.value } }); },
    }));
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return [{ label: "tick", run: () => { fireEvent.click(el); } }];
    if (el.type === "color") return [{ label: "= #123456", run: () => { fireEvent.change(el, { target: { value: "#123456" } }); fireEvent.blur(el); } }];
    // X / Y / W / H are text boxes holding a number (NumField): pressing them with "zz" would measure a typo, not the field.
    const numeric = el.type === "number" || el.type === "range" || (el.type === "text" && el.value.trim() !== "" && Number.isFinite(Number(el.value)));
    if (numeric) {
      // An empty box shows its hint ("none", "6"): start from the hint when it is a number, else the minimum, else 100.
      const seed = [el.value, el.placeholder, el.min].map((v) => (v ?? "").trim()).find((v) => v !== "" && Number.isFinite(Number(v)));
      const cur = seed === undefined ? 100 : Number(seed);
      const step = el.step === "" || el.step === "any" ? 1 : Number(el.step);
      const max = el.max === "" ? Infinity : Number(el.max);
      const next = cur + step <= max ? cur + step : cur - step;
      return [{ label: `= ${next}`, run: () => { fireEvent.change(el, { target: { value: String(next) } }); fireEvent.blur(el); } }];
    }
    return [{ label: "= zz", run: () => { fireEvent.change(el, { target: { value: "zz" } }); fireEvent.keyDown(el, { key: "Enter" }); fireEvent.blur(el); } }];
  }
  if (el instanceof HTMLTextAreaElement) return [{ label: "= zz", run: () => { fireEvent.change(el, { target: { value: "zz" } }); fireEvent.blur(el); } }];
  return [{ label: "click", run: () => { fireEvent.click(el); } }];
}

export interface CensusRow { situation: string; control: string; does: string }

/** Render the page in a situation, then follow `path` (controls pressed first, e.g. a menu that opens). */
function stage(sit: Situation, path: { key: string; press: string }[]): { root: HTMLElement; s: Spies } {
  // Save as template… really saves (browser storage): without a reset, a template saved while pressing one situation's
  // controls turns up in the next situation's Apply list, and the record depends on the order things run.
  try { localStorage.clear(); } catch { /* jsdom */ }
  saveFigureTemplate("House", { gutter: 24 }); // so "Apply a saved figure template" is on the page
  const s = spies();
  if (sit.selectedPlot) s.editing.selectedPlot = sit.selectedPlot;
  // As in the app: the selection's settings are drawn into the Inspector's slot, so the census reads the whole
  // page — the figure and that slot.
  const slot = document.createElement("div");
  slot.className = "figinsp";
  document.body.appendChild(slot);
  render(<LayoutPane project={project} layoutId="L" {...s.top} editing={s.editing as never} inspectorSlot={slot} />);
  const container = document.body;
  sit.setup(container, s);
  for (const step of path) {
    const hit = keyed(container).find((k) => k.key === step.key);
    if (!hit) throw new Error(`census path lost: ${step.key}`);
    presses(hit.el).find((p) => p.label === step.press)!.run();
  }
  clear(s);
  return { root: container, s };
}

/** What is on screen, control by control (names and values): a press that changed it needs a fresh page after. */
function screen(root: HTMLElement): string {
  return keyed(root).map(({ key, el }) => `${key}=${(el as HTMLInputElement).type === "checkbox" ? String((el as HTMLInputElement).checked) : (el as HTMLInputElement).value ?? ""}`).join("|");
}

async function census(): Promise<CensusRow[]> {
  const rows: CensusRow[] = [];
  const explore = async (sit: Situation, path: { key: string; press: string }[], known: Set<string>): Promise<void> => {
    // One page per situation, re-drawn only when a press changed what is on screen (a draft field opened, a local
    // toggle flipped). Every handler is a stand-in, so the document never changes and most presses leave the page as
    // it was — re-drawing before every press would make this take minutes.
    let st = stage(sit, path);
    let shown = screen(st.root);
    const here = keyed(st.root).map((k) => k.key).filter((k) => !known.has(k));
    const all = new Set([...known, ...keyed(st.root).map((k) => k.key)]);
    const deeper: { key: string; press: string }[] = [];
    const fresh = async (): Promise<void> => { cleanPage(); await settle(); st = stage(sit, path); shown = screen(st.root); };
    for (const key of here) {
      if (screen(st.root) !== shown) await fresh();
      const options = presses(keyed(st.root).find((k) => k.key === key)!.el).map((p) => p.label);
      for (const press of options) {
        if (screen(st.root) !== shown) await fresh();
        const el = keyed(st.root).find((k) => k.key === key)!.el;
        const before = new Set(keyed(st.root).map((k) => k.key));
        presses(el).find((p) => p.label === press)!.run();
        const did = changes(st.s);
        clear(st.s);
        const opened = keyed(st.root).map((k) => k.key).filter((k) => !before.has(k));
        const where = [...path.map((p) => `${p.key} ${p.press}`), `${key} ${press}`].join(" → ");
        rows.push({ situation: sit.name, control: where, does: did.length ? did.join(" + ") : "(no document change)" });
        // A control that only opens something (a menu, a draft field): press what it opened, one level down.
        if (!did.length && opened.length && path.length < 2) deeper.push({ key, press });
      }
    }
    cleanPage();
    await settle();
    for (const d of deeper) await explore(sit, [...path, d], all);
  };
  for (const sit of SITUATIONS) await explore(sit, [], new Set());
  return rows.sort((a, b) => (a.situation + a.control).localeCompare(b.situation + b.control));
}

describe("figure page — every control still does what it did (census)", () => {
  it("presses every control in every situation and matches the recorded census", { timeout: 300_000 }, async () => {
    window.confirm = () => true;
    // The caption draft's Copy button writes to the clipboard, which jsdom does not have.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.resolve() } });
    const rows = await census();
    expect(rows.length, "the census found almost nothing — the page did not render its controls").toBeGreaterThan(150);

    if (process.env["CENSUS_WRITE"] === "1" || !existsSync(BASELINE)) {
      writeFileSync(BASELINE, JSON.stringify(rows, null, 1) + "\n");
      if (process.env["CENSUS_WRITE"] !== "1") throw new Error("no recorded census yet — recorded one; check it and commit it");
      return;
    }
    const recorded = JSON.parse(readFileSync(BASELINE, "utf8")) as CensusRow[];
    const changeSet = (rs: CensusRow[]) => new Set(rs.filter((r) => r.does !== "(no document change)").map((r) => `${r.situation} :: ${r.does}`));
    // A view control is known by its own name — the last step of its path. Its path names the menu it sits in
    // ("Style ▾ click → Save as template… click"); where it lives is not compared, that it still exists is.
    const viewSet = (rs: CensusRow[]) => new Set(rs.filter((r) => r.does === "(no document change)").map((r) => `${r.situation} :: ${r.control.split(" → ").pop()}`));
    const was = changeSet(recorded), now = changeSet(rows);
    // The figure's own settings live in the Inspector's Figure view, shown while nothing is picked, not while an
    // object or a panel is. A change of this list may leave the "something picked" situations only if it is still
    // made with nothing picked; any other change, or one missing from the Figure view too, counts as lost. Rows
    // matched this way are printed, never hidden.
    const FIGURE_VIEW_KEYS = new Set(["lettering", "letterFont", "letterSize", "letterBold", "letterColor", "panels", "showPanelTitles", "showPanelNames", "panelFontScale", "sharedAxisLabels", "mergedLegend"]);
    const PICKED = new Set(["a text selected", "a box selected", "an arrow selected", "one panel selected"]);
    const figureWide = (does: string): boolean => {
      const m = /^onSetLayoutOptions\(\[(\{.*\})\]\)$/.exec(does);
      if (!m) return false;
      const keys = Object.keys(JSON.parse(m[1]!) as object);
      return keys.length > 0 && keys.every((k) => FIGURE_VIEW_KEYS.has(k));
    };
    const moved: string[] = [];
    const lost = [...was].filter((x) => {
      if (now.has(x)) return false;
      const [situation, does] = x.split(" :: ") as [string, string];
      if (PICKED.has(situation) && figureWide(does) && now.has(`nothing selected :: ${does}`)) { moved.push(x); return false; }
      // A recorded "← Choose graphs" press is matched to the page's Choose graphs tab (PanelBuilderView, outside what
      // this census renders); the tab is the way back, held by LayoutPane.test "the local tabs switch back and forth".
      if (does.startsWith("onChooseGraphs(")) { moved.push(`${x}   → the Choose graphs tab`); return false; }
      return true;
    }).map((x) => `${x}   (was: ${recorded.find((r) => `${r.situation} :: ${r.does}` === x)!.control})`);
    if (moved.length) console.info(`moved to the Figure view or the Choose graphs tab: ${moved.length} rows\n  ${moved.join("\n  ")}`);
    const gained = [...now].filter((x) => !was.has(x)).map((x) => `${x}   (by: ${rows.find((r) => `${r.situation} :: ${r.does}` === x)!.control})`);
    const viewNow = viewSet(rows);
    const viewLost = [...viewSet(recorded)].filter((x) => !viewNow.has(x));
    // One report with all three lists: a change that breaks several things names all of them at once.
    expect({
      "Lost — a document change no control makes any more (a control was lost, or now does something else)": lost,
      "Gained — a document change no control made before (a control makes a new change)": gained,
      "Gone — a view control (changes nothing in the document) that is no longer on the page": viewLost,
    }).toEqual({
      "Lost — a document change no control makes any more (a control was lost, or now does something else)": [],
      "Gained — a document change no control made before (a control makes a new change)": [],
      "Gone — a view control (changes nothing in the document) that is no longer on the page": [],
    });
  });
});

describe("clipAtWord: a long tooltip used as a control's name", () => {
  it("leaves a short text as it is", () => {
    expect(clipAtWord("Align X-axes", 60)).toBe("Align X-axes");
  });

  it("cuts a long text at a word boundary and marks the cut", () => {
    const tip = "Choose which panel the others copy from — any panel, not just the first one";
    expect(clipAtWord(tip, 60)).toBe("Choose which panel the others copy from — any panel, not…");
  });

  it("cuts a text with no spaces at the limit", () => {
    expect(clipAtWord("x".repeat(70), 60)).toBe("x".repeat(60) + "…");
  });
});
