import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";
import { galleryItems } from "../apps/desktop/src/renderer/src/shell/gallery";

/**
 * Dead-affordance sweep — "if it says you can drag it, dragging it must do something."
 *
 * This test catches direct-manipulation defects mechanically: it never needs to know what an
 * element is. For each graph it finds every element the renderer marks with a drag cursor
 * (`move` / `grab` / `*-resize`), performs a real mouse drag on it, and asserts the document
 * changed. An element that advertises a drag and then does nothing misleads the user.
 *
 * Why it must live here and not in jsdom: the commit path runs through `getScreenCTM()`,
 * which jsdom does not implement. In jsdom the drag cannot commit, so those tests can only
 * assert the cursor and the handler — which a dead drag target can still have.
 *
 * The oracle is the document JSON, not a screenshot: a drag that moves a title, a legend, a
 * node, a colour bar or an axis all persist somewhere in the plot's state. That makes this
 * indifferent to layout and immune to pixel flake.
 *
 * Default-deny: elements are discovered from the DOM, so a new draggable element is swept the
 * moment it exists. There is no list to keep up to date. If a drag legitimately shouldn't
 * mutate, the renderer should not be advertising a drag cursor on it.
 */

/**
 * Every gallery card, read from `galleryItems()` itself.
 *
 * Not a hand-kept list: a hand-kept list covers the graphs someone remembered, and every kind
 * left off it goes unchecked. `gallery.ts` is pure (it imports only `@mady/core`), so Playwright
 * can read the titles at collection time and declare one test per kind. Add a chart kind with a
 * gallery card and it is checked from that moment, with no list to remember.
 */
const GALLERY_CARDS = galleryItems().map((g) => g.title);

/** Graphs in the startup sample document (real user-facing data, no fixture drift). */
const GRAPHS = [
  "Dose-response",
  "Gene expression heatmap",
  "Treatment bar chart",
  "Dose-group violin",
  "Quarterly lollipop",
  "GDP treemap",
  "Signaling network",
  "Heritability dot plot",
];

/** An element that claims to be draggable, with a key stable across re-renders. */
interface Target {
  /** `<tag> label #n` — re-findable after the figure has moved/redrawn. */
  key: string;
  cursor: string;
  x: number;
  y: number;
}

/**
 * Find every element whose inline cursor advertises a drag, with its current position.
 *
 * Inline, not computed: `cursor` is an inherited CSS property, so a computed read reports
 * every descendant of a draggable group as draggable too. The renderer sets these inline.
 *
 * Note: re-run this before every drag. Coordinates go stale the moment anything moves —
 * locating all targets once lets earlier drags shift the later ones, so working resize grips
 * would be reported "dead". A sweep that raises false alarms is worse than no sweep.
 */
/**
 * Put the pointer over the figure before enumerating.
 *
 * This prevents a measurement fault. The figure-resize grips are hover-gated on purpose —
 * `.gfx-figresize { opacity: 0; pointer-events: none }`, lit only by `svg.gfx-figure:hover`, so
 * they do not clutter every figure. Their inline cursor is set regardless, so `dragTargets`
 * always enumerates them; whether `hitPoint` can reach them depends on where the mouse was left
 * by the previous drag. Unhovered, they are unreachable, and a working grip would be reported as
 * dead. Hovered, all three grips commit a real resize.
 *
 * Hovering first is what a user does, and it makes the sweep able to drive more elements, not
 * fewer. Cheap and harmless: a move with no button down commits nothing.
 */
async function hoverFigure(page: import("@playwright/test").Page): Promise<void> {
  // Note: `evaluate`, not a locator: this runs before every enumeration (four rungs x two calls
  // per target), and a locator auto-waits. That waiting pushes the ordination card's sweep
  // past the 90 s budget, against 17 s on its own.
  const box = await page.evaluate(() => {
    const r = document.querySelector("svg.gfx-figure")?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (box) await page.mouse.move(box.x, box.y);
}

async function dragTargets(page: import("@playwright/test").Page): Promise<Target[]> {
  await hoverFigure(page);
  return page.evaluate(() => {
    const svg = document.querySelector("svg.gfx-figure");
    if (!svg) return [];
    const out: { key: string; cursor: string; x: number; y: number }[] = [];
    const seen = new Map<string, number>();
    /**
     * A point that actually hits this element (or a descendant, which inherits its handlers).
     * A `<g>`'s bbox centre is usually a hole — the gap between a colour-bar's title and its
     * strip — so pressing there lands on the bare svg and the drag never starts, and a working
     * colour bar would be reported as dead. A check that reports working elements as broken
     * cannot be trusted, so hit test first and only drive a point that resolves back into the
     * element.
     */
    const hitPoint = (el: Element): { x: number; y: number } | null => {
      const cands: Element[] = [el, ...el.querySelectorAll("*")];
      for (const c of cands) {
        const cb = c.getBoundingClientRect();
        if (cb.width < 2 || cb.height < 2) continue;
        const px = cb.x + cb.width / 2;
        const py = cb.y + cb.height / 2;
        const at = document.elementFromPoint(px, py);
        if (at && (at === el || el.contains(at))) return { x: px, y: py };
      }
      return null;
    };
    for (const el of [...svg.querySelectorAll<SVGElement>("*")]) {
      const cur = el.style?.cursor ?? "";
      if (!/^(move|grab|(ew|ns|nwse|nesw)-resize)$/.test(cur)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue; // invisible / degenerate
      if (b.x < 0 || b.y < 0 || b.right > window.innerWidth || b.bottom > window.innerHeight) continue; // off-screen
      const pt = hitPoint(el);
      if (!pt) continue; // nothing grabbable in it (fully occluded) — not a drag claim we can test
      const label =
        el.getAttribute("data-ann-shape") ||
        el.getAttribute("data-ann-text") ||
        el.getAttribute("data-edge-id") ||
        el.querySelector(":scope > title")?.textContent ||
        el.parentElement?.querySelector(":scope > title")?.textContent ||
        (el.textContent ?? "").trim().slice(0, 24) ||
        "(unlabelled)";
      const base = `<${el.tagName}> ${label} [cursor:${cur}]`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      out.push({ key: `${base} #${n}`, cursor: cur, x: pt.x, y: pt.y });
    }
    return out;
  });
}

/** Analysis-fed kinds that no startup graph uses. They are reached by morphing the first
 *  graph, which is exactly how a user gets them (an analysis writes the same fields). They
 *  carry drag targets no startup graph has, so they are checked here too. */
const MORPHS: { label: string; patch: Record<string, unknown> }[] = [
  {
    // The triplot's three families: the arrows are the ones that have to commit — a locked
    // arrow must offer no drag affordance at all, and its label must actually move.
    label: "triplot",
    patch: {
      kind: "triplot",
      pca: {
        varLabels: ["Alpha", "Beta", "Gamma"], pcLabels: ["RDA1", "RDA2"],
        explained: [0.62, 0.24], eigenvalues: [1.8, 0.7],
        loadings: [],
        scores: [[-1, 0.4], [1, -0.3], [0.2, 0.9], [-0.6, -0.8]],
        lcScores: [[-1, 0.4], [1, -0.3], [0.2, 0.9], [-0.6, -0.8]],
        waScores: [[-1.2, 0.5], [1.1, -0.4], [0.3, 1.0], [-0.7, -0.9]],
        speciesScores: [[0.8, 0.2], [-0.5, 0.6], [0.3, -0.7]],
        speciesLabels: ["Alpha", "Beta", "Gamma"],
        envScores: [[0.7, 0.1], [-0.4, 0.6]],
        envLabels: ["Temp", "Depth"],
        envIsFactor: [false, false],
      },
    },
  },
  {
    label: "pcabiplot",
    patch: {
      kind: "pcabiplot",
      pca: {
        varLabels: ["Alpha", "Beta", "Gamma"], pcLabels: ["PC1", "PC2"],
        explained: [0.62, 0.24], eigenvalues: [1.8, 0.7],
        loadings: [[0.8, 0.2], [-0.5, 0.6], [0.3, -0.7]],
        scores: [[-1, 0.4], [1, -0.3], [0.2, 0.9], [-0.6, -0.8]],
      },
    },
  },
  {
    label: "pcaload",
    patch: {
      kind: "pcaload",
      pca: {
        varLabels: ["Alpha", "Beta", "Gamma"], pcLabels: ["PC1", "PC2"],
        explained: [0.62, 0.24], eigenvalues: [1.8, 0.7],
        loadings: [[0.8, 0.2], [-0.5, 0.6], [0.3, -0.7]],
        scores: [[-1, 0.4], [1, -0.3]],
      },
    },
  },
  // Bland-Altman: its bias / limits-of-agreement lines must be draggable.
  { label: "blandaltman", patch: { kind: "blandaltman" } },
  {
    label: "survival",
    patch: {
      kind: "survival",
      survival: [
        { label: "Treated", times: [0, 2, 4, 6, 8], surv: [1, 0.92, 0.78, 0.66, 0.55] },
        { label: "Control", times: [0, 2, 4, 6, 8], surv: [1, 0.8, 0.55, 0.36, 0.22] },
      ],
      survivalAtRisk: { times: [0, 2, 4, 6, 8], rows: [{ label: "Treated", atRisk: [40, 37, 31, 26, 22] }, { label: "Control", atRisk: [40, 32, 22, 14, 9] }] },
    },
  },
  {
    label: "roc",
    patch: {
      kind: "roc",
      roc: [{ label: "Test", points: [{ fpr: 0, tpr: 0 }, { fpr: 0.2, tpr: 0.6 }, { fpr: 0.5, tpr: 0.85 }, { fpr: 1, tpr: 1 }], auc: 0.79 }],
    },
  },
];

/** Drive every drag affordance on whatever graph is currently open. */
async function sweep(app: MadyApp, page: import("@playwright/test").Page, label: string): Promise<void> {
  const keys = (await dragTargets(page)).map((t) => t.key);
  // Guard the check itself: a kind that suddenly exposes no draggable element means the
  // discovery broke (or the figure lost its draggable elements), not that the graph is perfect.
  expect(keys.length, `${label}: no draggable elements found at all — discovery is broken`).toBeGreaterThan(0);

  const dead: string[] = [];
  const missing: string[] = [];
  /** Advertised a drag, but could never be located to drive — reported on its own, never as
   *  "dead": an element the harness cannot reach says nothing about whether the app honours it. */
  const unreachable: string[] = [];
  for (const key of keys) {
    // Re-locate now: earlier drags in this loop have moved things (and a figure resize moves
    // everything). Never reuse the coordinates from the initial enumeration.
    const t = (await dragTargets(page)).find((x) => x.key === key);
    if (!t) { missing.push(key); continue; } // vanished after an earlier drag — report, don't guess
    /**
     * Caution: escalate before calling it dead — both directions and a bigger distance.
     *
     * One fixed +34px gesture is not evidence of a dead control. Width handles write a clamped field
     * (`boxWidth` 0.1–0.9, `barWidth` 0.1–1, and on bar it is plot-wide), and every target is
     * driven in the same direction, so the earlier drags in this very loop pin the value at
     * its limit. Also, the committed fraction is derived from the distance to the glyph's
     * centre — once a box is squeezed to its 0.1 minimum, that centre is ~9px from the handle
     * and a 34px drag cannot recompute a value outside the clamp. Bar and raincloud would be
     * reported dead that way although each commits fine when driven alone on a fresh document;
     * raincloud's needs ~140px to escape the clamp once squeezed.
     *
     * A genuinely dead affordance moves nothing at any distance in any direction, so the
     * ladder only costs gestures on targets that are about to be reported anyway.
     */
    const LADDER: { dx: number; dy: number }[] = [
      { dx: 34, dy: 22 },
      { dx: -34, dy: -22 },
      { dx: 140, dy: 0 },
      { dx: -140, dy: 0 },
    ];
    /**
     * "moved" = the document changed · "same" = driven and nothing changed · "gone" = could not
     * be located to drive at all.
     *
     * The third state is the point. Returning `false` for both "same" and "gone" would report a
     * target that had merely drifted out of reach as a misleading affordance, which is the
     * opposite of what this suite is for.
     */
    const dragOnce = async (dx: number, dy: number): Promise<"moved" | "same" | "gone"> => {
      // Re-locate each time: a previous rung may have moved it even without committing.
      const cur = (await dragTargets(page)).find((x) => x.key === key);
      if (!cur) return "gone";
      const before = JSON.stringify(await app.project());
      await page.mouse.move(cur.x, cur.y);
      await page.mouse.down();
      // Several handlers ignore sub-3px jitter; move in steps so pointermove actually fires.
      await page.mouse.move(cur.x + dx, cur.y + dy, { steps: 8 });
      await page.mouse.up();
      await app.settle();
      return JSON.stringify(await app.project()) !== before ? "moved" : "same";
    };
    let committed = false;
    let everDriven = false;
    for (const rung of LADDER) {
      const r = await dragOnce(rung.dx, rung.dy);
      if (r !== "gone") everDriven = true;
      if (r === "moved") { committed = true; break; }
    }
    if (committed) continue;
    // Driven at least once and never moved → a genuine dead affordance. Never driven at all →
    // unreachable, which is a different finding and gets its own failure below.
    if (everDriven) dead.push(t.key);
    else unreachable.push(t.key);
  }
  // Surfaced rather than silently skipped — a vanishing target is itself a finding.
  if (missing.length) console.warn(`${label}: ${missing.length} target(s) disappeared mid-sweep and were not driven:\n  - ${missing.join("\n  - ")}`);

  expect(
    dead,
    `${label}: these elements show a drag cursor but dragging them changed nothing in the document — ` +
      `either wire the drag through to a document mutation, or stop advertising it:\n  - ${dead.join("\n  - ")}\n`,
  ).toEqual([]);

  expect(
    unreachable,
    `${label}: these elements advertise a drag but the sweep could never get hold of them to try — ` +
      `that is a test-harness reach problem, not proof the app is wrong, and it must be fixed here rather ` +
      `than reported as a dead affordance:\n  - ${unreachable.join("\n  - ")}\n`,
  ).toEqual([]);

  expect(await app.consoleErrors(), `${label}: dragging produced console errors`).toEqual([]);
}

test.describe("dead-affordance sweep — every drag cursor must actually drag", () => {
  for (const graph of GRAPHS) {
    test(`${graph}: nothing advertises a drag it can't perform`, async ({ page }) => {
      await collectErrors(page);
      const app = new MadyApp(page);
      await app.open();
      await app.openGraph(graph);
      await sweep(app, page, graph);
    });
  }

  // Every chart kind, via its gallery card. The sample-document sweep above keeps testing real
  // user data; this one exists for coverage — one test per card so a failure names the card
  // rather than collapsing every card into one red line.
  for (const card of GALLERY_CARDS) {
    test(`gallery — ${card}: nothing advertises a drag it can't perform`, async ({ page }) => {
      await collectErrors(page);
      const app = new MadyApp(page);
      await app.open();
      await app.openGallery();
      await app.openGalleryCard(card);
      await sweep(app, page, `gallery/${card}`);
    });
  }

  for (const { label, patch } of MORPHS) {
    test(`${label}: nothing advertises a drag it can't perform`, async ({ page }) => {
      await collectErrors(page);
      const app = new MadyApp(page);
      await app.open();
      await app.openGraph(GRAPHS[0]!);
      await app.setPlotOptions(patch);
      await sweep(app, page, label);
    });
  }
});
