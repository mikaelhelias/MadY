import type { PlotScene } from "@mady/graphics";

/**
 * Every legend key looks like the mark it names — the check itself, for one drawing: no line in the legend when the
 * graph draws none, and two-tone legend dots where the graph's dots are two-tone.
 *
 * Shared by `legend-keys-match.test.tsx` and `new-data-redraw.test.tsx`, so both run the same check on every chart,
 * including reshaped ones. Read off the drawing: a row's marks are the elements whose hover text
 * names the row, the visible mark centred on each (hover text sits on invisible hit circles), everything in the same
 * series group, a radar polygon's corner dots, and the stems / connectors ending at its dots. Then: the key draws a
 * line only if the marks do, a dot only if they do, and the dot / block carries their fill, edge and (when the dots
 * share one size) their size.
 */

const norm = (c: string | null | undefined): string => (c ?? "").toLowerCase();
/** An edge in the page colour is the gap between cells, not an outline of the mark. */
const pageEdge = (c: string): boolean => ["", "none", "var(--bg)", "#ffffff", "#fff", "white"].includes(norm(c));
const most = (xs: string[]): string => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
};
const nums = (s: string): number[] => [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
/** The centre of a drawn element (circle, rect, polygon, small path). */
function centre(e: Element): [number, number] | null {
  const t = e.tagName.toLowerCase();
  if (t === "circle") return [Number(e.getAttribute("cx")), Number(e.getAttribute("cy"))];
  if (t === "rect") return [Number(e.getAttribute("x")) + Number(e.getAttribute("width")) / 2, Number(e.getAttribute("y")) + Number(e.getAttribute("height")) / 2];
  const n = nums(t === "polygon" ? e.getAttribute("points") ?? "" : e.getAttribute("d") ?? "");
  if (n.length < 4) return null;
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
const visible = (e: Element): boolean => {
  const f = e.getAttribute("fill");
  return !!f && f !== "none" && f !== "transparent";
};
const isDot = (e: Element): boolean => {
  const t = e.tagName.toLowerCase();
  if (t === "circle") return true;
  if (t === "rect") return Number(e.getAttribute("width")) < 30 && Math.abs(Number(e.getAttribute("width")) - Number(e.getAttribute("height"))) < 0.5;
  const n = nums(t === "polygon" ? e.getAttribute("points") ?? "" : e.getAttribute("d") ?? "");
  if (n.length < 4 || n.length > 40) return false;
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return Math.max(...xs) - Math.min(...xs) < 30 && Math.max(...ys) - Math.min(...ys) < 30;
};

/** Chart types whose marks do not carry their legend row's name in their hover text — checked one by one elsewhere. */
export const UNNAMED_LEGEND_KINDS: ReadonlySet<string> = new Set(["ridgeline", "rose", "treemap", "sunburst", "parallel", "network", "tracks", "volcano", "oncoprint"]);

export interface LegendKeyResult {
  /** Keys that do not match their marks. */
  bad: string[];
  /** A vertical legend whose keys are not on one centre line. */
  misaligned: string[];
  /** Rows compared. */
  checked: number;
  /** Rows that could not be compared (no mark names them). */
  unchecked: number;
}

/** Check one rendered figure (`container` holds the `svg.gfx-figure` drawn from `scene`); `tag` prefixes every finding. */
export function checkLegendKeys(scene: PlotScene, container: Element, tag0: string): LegendKeyResult {
  const out: LegendKeyResult = { bad: [], misaligned: [], checked: 0, unchecked: 0 };
  const figure = container.querySelector("svg.gfx-figure");
  if (!figure) return out;
  const all = [...figure.querySelectorAll("circle, rect, polygon, path")].filter((e) => !e.closest("[data-mady-legend-row], .gfx-annhandle, .gfx-draghit, defs, clipPath, pattern"));
  const tipped = all.filter((e) => e.hasAttribute("data-mady-tip"));
  // Aligned keys: every key of a vertical legend sits on one centre line.
  const centres = [...container.querySelectorAll("[data-mady-legend-row]")].map((row) => {
    const k = row.querySelector(".gfx-legbar, circle, polygon, line");
    if (!k) return null;
    const t = k.tagName.toLowerCase();
    if (t === "line") return (Number(k.getAttribute("x1")) + Number(k.getAttribute("x2"))) / 2;
    if (t === "circle") return Number(k.getAttribute("cx"));
    if (t === "rect") return Number(k.getAttribute("x")) + Number(k.getAttribute("width")) / 2;
    const xs = nums(t === "polygon" ? k.getAttribute("points") ?? "" : k.getAttribute("d") ?? "").filter((_, i) => i % 2 === 0);
    return xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : null;
  }).filter((x): x is number => x != null);
  const vertical = scene.legendLayout.orientation !== "horizontal" && scene.legendLayout.position !== "top";
  if (vertical && centres.length > 1 && Math.max(...centres) - Math.min(...centres) > 1) out.misaligned.push(`${tag0} | ${scene.kind} | key centres ${centres.map((x) => x.toFixed(1)).join(" / ")}`);
  for (const row of container.querySelectorAll("[data-mady-legend-row]")) {
    const label = row.querySelector("text")?.textContent?.trim() ?? "";
    let named = tipped.filter((e) => (e.getAttribute("data-mady-tip") ?? "").split("\n").some((l) => l.trim() === label));
    // Two rows with the same name (two series a user named alike — e.g. on "Two sheets, one graph", a dotted
    // "High dose" and a line-only "High dose"): the name cannot tell their marks apart, so each row keeps only the
    // marks inside its own series group (the row carries the series id it points at).
    const rowSeries = row.getAttribute("data-mady-series");
    const sameName = [...container.querySelectorAll("[data-mady-legend-row]")].filter((r) => (r.querySelector("text")?.textContent?.trim() ?? "") === label).length > 1;
    if (sameName && rowSeries) {
      const own = [...figure.querySelectorAll("g.gfx-series")].find((g) => g.getAttribute("data-mady-series") === rowSeries);
      if (own) named = named.filter((e) => own.contains(e));
    }
    // A data-driven row (points coloured from a column) is compared by its colour: the name can collide with a column's.
    const isDD = scene.legend.find((e) => e.label === label)?.dataDriven === true;
    if (isDD) {
      const key = row.querySelector("circle, polygon, path, rect:not([fill='transparent'])");
      const fills = new Set(all.filter(visible).map((e) => norm(e.getAttribute("fill"))));
      out.checked++;
      if (!key || !fills.has(norm(key.getAttribute("fill")))) out.bad.push(`${tag0} | ${scene.kind} | "${label}" | data-driven key colour ${key?.getAttribute("fill")} is drawn nowhere`);
      continue;
    }
    if (!label || named.length === 0) { out.unchecked++; continue; }
    const mine = new Set<Element>(named);
    for (const n of named) {
      const cN = n.tagName.toLowerCase() === "circle" || n.tagName.toLowerCase() === "rect" ? centre(n) : null;
      // A visible mark centred on the row's hit target is the row's own mark — unless it sits in another series' group:
      // a fitted curve drawn through the measured points has its hit targets exactly on the other series' dots
      // (e.g. on "Two sheets, one graph", where the curve's key would otherwise read as missing a dot).
      const grp = n.closest("g.gfx-series");
      if (cN) for (const e of all) {
        const ce = centre(e);
        const eg = e.closest("g.gfx-series");
        if (ce && visible(e) && Math.hypot(ce[0] - cN[0], ce[1] - cN[1]) < 0.6 && !(grp && eg && eg !== grp)) mine.add(e);
      }
      if (grp) for (const e of grp.querySelectorAll("circle, rect, polygon, path")) mine.add(e);
      if (scene.radar && n.tagName.toLowerCase() === "polygon") {
        const v = nums(n.getAttribute("points") ?? "");
        for (let i = 0; i + 1 < v.length; i += 2) for (const e of all) if (e.tagName.toLowerCase() === "circle" && Math.hypot(Number(e.getAttribute("cx")) - v[i]!, Number(e.getAttribute("cy")) - v[i + 1]!) < 0.6) mine.add(e);
      }
    }
    out.checked++;
    const tag = `${tag0} | ${scene.kind} | "${label}"`;
    const block = row.querySelector(".gfx-legbar");
    const keyLine = row.querySelector("line");
    const keyDot = row.querySelector("circle, polygon, path:not(.gfx-legbar)") ?? row.querySelector("rect:not(.gfx-legbar):not([fill='transparent'])");
    const m = [...mine];
    const lines = m.filter((e) => e.tagName.toLowerCase() === "path" && e.getAttribute("fill") === "none" && (e.getAttribute("stroke") ?? "transparent") !== "transparent");
    const radarEdge = !!scene.radar && m.some((e) => e.tagName.toLowerCase() === "polygon" && (e.getAttribute("stroke") ?? "none") !== "none");
    const dots = m.filter((e) => visible(e) && isDot(e));
    const areas = m.filter((e) => visible(e) && !isDot(e));
    const drawnFill = dots.length ? most(dots.map((e) => e.getAttribute("fill")!)) : most(areas.map((e) => e.getAttribute("fill")!));
    const drawnEdge = dots.length ? most(dots.map((e) => e.getAttribute("stroke") ?? "")) : most(areas.map((e) => e.getAttribute("stroke") ?? ""));
    // Stems / connectors (<line>) that end at one of this row's dots (lollipop, paired dot).
    const dotCentres = m.filter((e) => e.tagName.toLowerCase() === "circle").map(centre).filter((c): c is [number, number] => !!c);
    // Only a line in the row's own colour is its line: a dumbbell's grey connector joins two series and belongs to neither.
    const rowColour = norm(scene.legend.find((e) => e.label === label)?.color);
    const stems = [...figure.querySelectorAll("line")].filter((l) => !l.closest("[data-mady-legend-row]") && norm(l.getAttribute("stroke")) === rowColour && dotCentres.some(([x, y]) => [[+l.getAttribute("x1")!, +l.getAttribute("y1")!], [+l.getAttribute("x2")!, +l.getAttribute("y2")!]].some(([a, b]) => Math.hypot(a! - x, b! - y) < 1)));
    // …and any curve stroked in the row's own colour — a fitted curve carries no series id, only its colour.
    const curves = [...figure.querySelectorAll("path")].filter((p) => !p.closest("[data-mady-legend-row]") && p.getAttribute("fill") === "none" && norm(p.getAttribute("stroke")) === rowColour && (p.getAttribute("d") ?? "").length > 20);
    const hasLine = lines.length > 0 || radarEdge || stems.length > 0 || curves.length > 0;
    if (block) {
      if (norm(block.getAttribute("fill")) !== norm(drawnFill) || (!pageEdge(drawnEdge) && norm(block.getAttribute("stroke")) !== norm(drawnEdge))) out.bad.push(`${tag} | BLOCK key fill=${block.getAttribute("fill")} edge=${block.getAttribute("stroke")} vs drawn fill=${drawnFill} edge=${drawnEdge}`);
      continue;
    }
    if (!!keyLine !== hasLine) out.bad.push(`${tag} | key ${keyLine ? "HAS" : "has NO"} line; chart ${hasLine ? "draws" : "draws NO"} line`);
    if (!!keyDot !== dots.length > 0) out.bad.push(`${tag} | key ${keyDot ? "HAS" : "has NO"} dot; chart ${dots.length ? "draws" : "draws NO"} dots`);
    if (keyDot && dots.length) {
      const kf = keyDot.getAttribute("fill"), ks = keyDot.getAttribute("stroke");
      if (norm(kf) !== norm(drawnFill) || (!pageEdge(drawnEdge) && norm(ks) !== norm(drawnEdge))) out.bad.push(`${tag} | dot key fill=${kf} edge=${ks} vs drawn fill=${drawnFill} edge=${drawnEdge}`);
      const kr = Number(keyDot.getAttribute("r") ?? NaN);
      const dr = Number(most(dots.map((e) => e.getAttribute("r") ?? "")));
      const sized = new Set(dots.map((e) => e.getAttribute("r"))).size > 1; // dots sized by a variable: no one size to match
      if (!sized && dr && Number.isFinite(kr) && Math.abs(kr - dr) > 0.6) out.bad.push(`${tag} | dot key r=${kr.toFixed(1)} vs drawn r=${dr.toFixed(1)}`);
    }
  }
  return out;
}
