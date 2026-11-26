import type { Page } from "@playwright/test";

/**
 * Page-side driver for the MadY renderer.
 *
 * Everything that reaches into React internals lives here, in one file, so a React upgrade
 * breaks one place instead of every spec. The renderer exposes no test hook (deliberately —
 * the preview serves the real production bundle, and a test-only API in it would misrepresent
 * what ships), so the driver reaches the document through React itself: it walks the fiber
 * for the props that hold it.
 *
 * Caution: React batches updates. After any action that sets state, the fiber still holds the
 * old value in the same tick, so reading it immediately reports a false "nothing happened".
 * Every read here is a separate `page.evaluate` and `settle()` yields a frame first. Skipping
 * this makes a working control read as unresponsive (a selectable element as unselectable,
 * a working button as broken); do not remove the awaits.
 */

/** Injected into the page: find the React fiber root. */
const FIBER_HELPERS = `
  const __root = () => document.getElementById('root');
  const __fiber = () => {
    const r = __root();
    const k = r && Object.keys(r).find((x) => x.startsWith('__reactContainer'));
    if (!k) return null;
    const attached = r[k];
    // Caution: walk stateNode.current, not the captured pointer.
    //
    // r[__reactContainer$…] is the HostRoot fiber React attached at mount. React double-
    // buffers: every commit swaps \`current\` between two alternate trees, so that one fixed
    // pointer is the up-to-date tree on even commits and one commit stale on odd ones. Reads
    // through it alternate between right and wrong, which looks like flakiness. For example,
    // after clicking a series mark the captured pointer reports no selection, and after
    // clicking the background to deselect it reports the series that was just cleared.
    // \`settle()\` cannot help; it is not a timing problem. stateNode is the FiberRoot and its
    // \`.current\` is, by definition, the tree React last committed.
    return attached && attached.stateNode && attached.stateNode.current ? attached.stateNode.current : attached;
  };
  const __walk = (pred) => {
    const seen = new Set();
    let hit = null;
    const go = (n, d) => {
      if (!n || d > 120 || hit || seen.has(n)) return;
      seen.add(n);
      const p = n.memoizedProps;
      if (p && typeof p === 'object') { const v = pred(p); if (v !== undefined && v !== null) { hit = v; return; } }
      go(n.child, d + 1); go(n.sibling, d);
    };
    go(__fiber(), 0);
    return hit;
  };
`;

/** The graph `open()` leaves on screen, the starting point every spec assumes. */
const LAUNCH_GRAPH = "Dose-response";

export class MadyApp {
  constructor(readonly page: Page) {}

  /**
   * Load the app and land on a figure.
   *
   * Note: the launch tab is not a graph. The app opens on the Welcome page, with the demo
   * project present but folded shut in the Navigator, so waiting for `svg.gfx-figure` on the
   * launch tab times out every spec.
   *
   * So this unfolds the tree and opens `LAUNCH_GRAPH`, leaving the page where every spec
   * expects it to be.
   */
  async open(): Promise<void> {
    await this.page.goto("/");
    await this.page.waitForSelector(".nav", { timeout: 30_000 });
    await this.openGraph(LAUNCH_GRAPH);
  }

  /**
   * Expand every collapsed Navigator folder/experiment, so the graph buttons exist in the DOM.
   *
   * Only rows showing a chevron-right are clicked: `button.twist` is a toggle, so clicking
   * indiscriminately would fold shut whatever was already open. Loops because the experiments
   * inside a folder only mount once that folder is open — one pass reaches the folders, the
   * next their contents.
   */
  async expandTree(): Promise<void> {
    for (let pass = 0; pass < 6; pass++) {
      const opened = (await this.page.evaluate(() => {
        const collapsed = [...document.querySelectorAll("button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
        collapsed.forEach((t) => (t as HTMLButtonElement).click());
        return collapsed.length;
      })) as number;
      if (opened === 0) return;
      await this.settle();
    }
  }

  /** Yield a frame so React has committed + the SVG re-rendered. */
  async settle(): Promise<void> {
    await this.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  }

  /** The whole project document, as plain JSON (the oracle for "did anything change?"). */
  async project(): Promise<Record<string, unknown>> {
    return this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const proj = __walk((p) => (p.project && Array.isArray(p.project.plots) ? p.project : null));
      return JSON.parse(JSON.stringify(proj));
    })()`) as Promise<Record<string, unknown>>;
  }

  /**
   * One axis of the scene that draws `svg.gfx-figure`: its domain and the values of its major ticks.
   *
   * Reads the axis, not the picture. Collecting tick numbers off the drawing by position
   * ("X ticks are in the bottom 40%") also picks up the other axis's labels and reference-line captions: on
   * Bland-Altman such an X probe reads −1.5 (a Y label) and produces a probe value of 6.8 for an axis whose
   * domain is 9–17. A value outside the domain is correctly a no-op, so working controls would be reported dead.
   */
  async sceneAxis(which: "x" | "y"): Promise<{ domain: [number, number]; ticks: number[] } | null> {
    return this.page.evaluate((w: string) => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement | null;
      if (!svg) return null;
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      const root = document.getElementById("root");
      if (!root) return null;
      const key = Object.keys(root).find((k) => k.startsWith("__reactContainer"));
      if (!key) return null;
      const anchor = (root as unknown as Record<string, { stateNode?: { current?: unknown } }>)[key]!;
      type Ax = { domain: number[]; ticks: { value: number; minor?: boolean; label: string }[] };
      type Sc = { width: number; height: number; x: Ax; y: Ax };
      type Fiber = { child?: Fiber; sibling?: Fiber; memoizedProps?: { scene?: Sc } };
      const scenes: Sc[] = [];
      const seen = new Set<Fiber>();
      const go = (n: Fiber | undefined, d: number): void => {
        if (!n || d > 200 || seen.has(n)) return;
        seen.add(n);
        const s = n.memoizedProps?.scene;
        if (s && s.x && s.y && Array.isArray(s.x.ticks)) scenes.push(s);
        go(n.child, d + 1);
        go(n.sibling, d);
      };
      go((anchor.stateNode?.current ?? anchor) as Fiber, 0);
      const scene = scenes.find((s) => Math.abs(s.width - fw) < 1 && Math.abs(s.height - fh) < 1);
      if (!scene) return null;
      const ax = w === "x" ? scene.x : scene.y;
      const lo = Math.min(ax.domain[0]!, ax.domain[1]!);
      const hi = Math.max(ax.domain[0]!, ax.domain[1]!);
      const ticks = [...new Set(ax.ticks.filter((t) => !t.minor && Number.isFinite(t.value)).map((t) => t.value))].sort((p, q) => p - q);
      return { domain: [lo, hi] as [number, number], ticks };
    }, which);
  }

  /** The active plot's stored state, by id. */
  async plot(plotId: string): Promise<Record<string, unknown> | undefined> {
    const proj = (await this.project()) as { plots?: { id: string }[] };
    return (proj.plots ?? []).find((p) => p.id === plotId) as Record<string, unknown> | undefined;
  }

  /**
   * Patch the active plot through the app's own handler (the Inspector's onSetPlotOptions),
   * i.e. the real mutate() path — so the scene rebuilds exactly as it would for a user.
   * Used to put a graph into the kind/shape a spec needs without clicking through dialogs.
   */
  async setPlotOptions(patch: Record<string, unknown>): Promise<void> {
    const ok = await this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const fn = __walk((p) => (typeof p.onSetPlotOptions === 'function' ? p.onSetPlotOptions : null));
      if (!fn) return false;
      fn(${JSON.stringify(patch)});
      return true;
    })()`);
    if (!ok) throw new Error("setPlotOptions: no onSetPlotOptions handler on the fiber (is a graph tab open?)");
    await this.settle();
  }

  /** The current graph selection ({kind:...} | null). Read in its own tick — see the note above. */
  async selection(): Promise<Record<string, unknown> | null> {
    return this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const sel = __walk((p) => ('selected' in p && p.selected ? p.selected : null));
      return sel ? JSON.parse(JSON.stringify(sel)) : null;
    })()`) as Promise<Record<string, unknown> | null>;
  }

  /** Open a graph by its navigator label (the full label — a dataset and its graph have
   *  near-identical names, e.g. "Heritability" vs "Heritability dot plot"). */
  async openGraph(label: string): Promise<void> {
    // The tree is folded shut at launch, so the graph buttons do not exist yet. Idempotent,
    // so specs that call this after `open()` pay nothing.
    await this.expandTree();
    const ok = await this.page.evaluate((wanted) => {
      const btns = [...document.querySelectorAll("button.navlabelbtn")];
      // A gallery card makes a data table and a graph with the same name; the first match is the table, which draws
      // no graph, so the wait below would hang. Only a graph's row offers "double-click to rename" — prefer it.
      const named = btns.filter((b) => (b.textContent ?? "").trim() === wanted);
      const t = named.find((b) => (b.getAttribute("title") ?? "").includes("double-click to rename")) ?? named[0];
      if (!t) return false;
      const k = Object.keys(t).find((x) => x.startsWith("__reactProps"));
      // The .navrow div has no handler — the button's onClick is the real one.
      (t as unknown as Record<string, { onClick?: (e: unknown) => void }>)[k!]!.onClick?.({ stopPropagation() {}, preventDefault() {} });
      return true;
    }, label);
    if (!ok) throw new Error(`openGraph: no navigator entry labelled exactly "${label}"`);
    await this.page.waitForSelector("svg.gfx-figure");
    await this.settle();
  }

  /** The figure layout being edited, straight from the document (the arrange-view oracle). */
  async layout(): Promise<Record<string, unknown> | undefined> {
    const proj = (await this.project()) as { layouts?: Record<string, unknown>[] };
    return (proj.layouts ?? [])[0];
  }

  /**
   * Build a figure: Insert → New layout, tick the named graphs, then Build / Arrange.
   * Leaves the arrange view mounted with one `.laypanel` per graph.
   *
   * Menu items and the graph cards are driven through their React onClick (same reason as
   * `openGraph`: the visible row is a wrapper, the handler lives on the inner control).
   */
  async newFigure(graphNames: readonly string[]): Promise<void> {
    // Driven through the real menu bar (same path `menu()` guards). A leaf-element text probe
    // does not work here: dropdown items carry icons, and an item with an <svg> inside is not
    // childless.
    await this.menu("Insert", "New layout");
    await this.page.waitForSelector(".laycard");
    await this.settle();

    const picked = await this.page.evaluate((wanted: string[]) => {
      const cards = [...document.querySelectorAll(".laycard")];
      let n = 0;
      for (const c of cards) {
        const name = c.querySelector(".laycard-name")?.textContent?.trim();
        if (name && wanted.includes(name)) { (c as HTMLElement).click(); n++; }
      }
      return n;
    }, [...graphNames]);
    if (picked !== graphNames.length) {
      throw new Error(`newFigure: picked ${picked} of ${graphNames.length} graphs (name mismatch?)`);
    }
    await this.settle();
    await this.page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Build \/ Arrange/.test(x.textContent ?? ""));
      if (!b) throw new Error("newFigure: no Build / Arrange button");
      b.click();
    });
    await this.page.waitForSelector(".laypanel");
    await this.settle();
  }

  /** Click a named control in the arrange ribbon (chip / segmented button), by exact label. */
  async ribbonClick(label: string): Promise<void> {
    const press = (openMenusFirst: boolean) => this.page.evaluate(([wanted, open]: [string, boolean]) => {
      // Ribbon labels use &nbsp; to keep their words together ("Shared&nbsp;axes"), so an
      // exact match on the raw textContent misses them — normalise before comparing.
      const norm = (s: string): string => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
      // A control may sit inside Align ▾ / Line up ▾ / Insert ▾ / Style ▾ — open them as a user
      // would to reach it (a click never dispatches the press that closes a menu, so they open side by side). React
      // draws the opened menus a moment later, so the second attempt looks in a later call.
      if (open) {
        for (const m of document.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")) {
          if (!m.disabled && m.getAttribute("aria-expanded") !== "true") m.click();
        }
        return false;
      }
      const b = [...document.querySelectorAll(".layseg-btn, .laychip, button")].find(
        (x) => norm(x.textContent ?? "") === norm(wanted),
      );
      if (!b) return false;
      // A chip is a <label> wrapping a checkbox; clicking the label alone can double-toggle
      // in some browsers, so drive the input directly when there is one.
      const input = (b as HTMLElement).querySelector("input");
      (input ?? (b as HTMLElement)).click();
      return true;
    }, [label, openMenusFirst] as [string, boolean]);
    let ok = await press(false);
    if (!ok) {
      await press(true);
      await this.settle();
      ok = await press(false);
      // …and close them again, as a user does: an open menu sits over the canvas and takes the next click.
      await this.page.evaluate(() => {
        for (const m of document.querySelectorAll<HTMLButtonElement>("button.laymenu-btn[aria-expanded=\"true\"]")) m.click();
      });
    }
    if (!ok) throw new Error(`ribbonClick: no arrange-ribbon control labelled "${label}"`);
    await this.settle();
  }

  /** Set the arrange ribbon's Gutter field through React's own onChange. */
  async setGutter(px: number): Promise<void> {
    const ok = await this.page.evaluate((v: number) => {
      const el = [...document.querySelectorAll("input[type=number]")].find((i) =>
        i.closest("label")?.textContent?.includes("Gutter"),
      ) as HTMLInputElement | undefined;
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, px);
    if (!ok) throw new Error("setGutter: no Gutter field (is the arrange view mounted?)");
    await this.settle();
  }

  /** Set the arrange ribbon's Columns select through React's own onChange. */
  async setColumns(n: number): Promise<void> {
    const ok = await this.page.evaluate((v: number) => {
      const el = [...document.querySelectorAll("select")].find((s) =>
        s.closest("label")?.textContent?.includes("Columns"),
      ) as HTMLSelectElement | undefined;
      if (!el) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
      set.call(el, String(v));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, n);
    if (!ok) throw new Error("setColumns: no Columns select (is the arrange view mounted?)");
    await this.settle();
  }

  /** A real mouse drag from one point to another, in steps (so drag handlers see moves). */
  async dragBy(from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(from.x + dx * 0.4, from.y + dy * 0.4, { steps: 4 });
    await this.page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
    await this.page.mouse.up();
    await this.settle();
  }

  /** Console errors collected since the page opened (a re-render crash shows up here). */
  async consoleErrors(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __e2eErrors?: string[] }).__e2eErrors ?? []);
  }

  /** Id of the plot currently being edited. */
  async activePlotId(): Promise<string> {
    const id = await this.page.evaluate(`(() => { ${FIBER_HELPERS}
      return __walk((p) => (typeof p.plotId === 'string' ? p.plotId : null));
    })()`);
    if (!id) throw new Error("activePlotId: no plot tab open");
    return id as string;
  }

  /**
   * Click the first data mark so the Inspector shows the series panel.
   *
   * Note: this does not target `[id^="mark-"]`: only the xy/bar paths give marks an id. A box
   * renders its geometry with no id at all, so an id selector silently times out on a box
   * chart. It targets the clickable element instead — what a user actually hits.
   */
  async clickFirstSeriesMark(): Promise<void> {
    // `force` because series glyphs legitimately overlap (a violin's median line sits on its
    // body, both clickable and both selecting the same series). Playwright's actionability
    // check calls that an interception and retries forever; here it is just the chart working.
    await this.page.locator('svg.gfx-figure .gfx-series [style*="cursor: pointer"]').first().click({ force: true });
    await this.settle();
  }

  /**
   * Set a font size through the real Inspector control — the "Size" number input under a named
   * font block ("Axis title font", "Tick label font (all axes)", …).
   *
   * Prefer this over `setPlotFont`: calling the handler off the fiber updates the document but
   * can leave the figure showing a memoised scene, which makes a geometry test measure the old
   * picture and pass for the wrong reason. A real change event goes through React the way a
   * user's typing does.
   */
  async setFontSizeViaUI(blockLabel: string, size: number): Promise<boolean> {
    return this.page.evaluate(
      ([label, px]) => {
        const blocks = Array.from(document.querySelectorAll<HTMLElement>(".inspsub"));
        const head = blocks.find((b) => (b.textContent ?? "").trim().toLowerCase().includes(String(label).toLowerCase()));
        if (!head) return false;
        // The Size row is a sibling that follows the block heading.
        let n: Element | null = head.nextElementSibling;
        while (n) {
          const span = n.querySelector(":scope > span");
          if (span && (span.textContent ?? "").trim() === "Size") {
            const input = n.querySelector<HTMLInputElement>('input[type="number"]');
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
            setter.call(input, String(px));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          if (n.classList.contains("inspsub")) return false; // reached the next font block
          n = n.nextElementSibling;
        }
        return false;
      },
      [blockLabel, size] as const,
    );
  }

  /**
   * Set an Inspector control by its visible row label, exactly as a user would — through React's
   * native value setter + input/change, so the app's `mutate` runs and the figure re-renders.
   * Returns "missing" when no such control is on screen, which is itself an assertable fact
   * (a control that is legitimately inert should be absent, not present-and-dead).
   */
  async setControl(label: string, value: string | number | boolean, nth = 0): Promise<"set" | "missing"> {
    return this.page.evaluate(
      ([lbl, val, index]) => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>("label.frow, div.frow"));
        const matches = rows.filter((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === String(lbl));
        const row = matches[Number(index)];
        const el = row?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
        if (!el) return "missing" as const;
        if (el.tagName === "SELECT") {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
          setter.call(el, String(val));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if ((el as HTMLInputElement).type === "checkbox") {
          (el as HTMLInputElement).click();
        } else {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
          setter.call(el, String(val));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
        return "set" as const;
      },
      [label, value, nth] as const,
    );
  }

  /**
   * The column id of the first drawn series, read from the rendered `data-mady-series` group.
   * `seriesStyles` is keyed by column id, so a series-level check needs a live id — there is no
   * way to synthesise one from the schema.
   */
  async firstSeriesId(): Promise<string | null> {
    return this.page.evaluate(() => {
      const g = document.querySelector("svg.gfx-figure [data-mady-series]");
      return g?.getAttribute("data-mady-series") ?? null;
    });
  }

  /**
   * Series-style keys with no `data-mady-series` group.
   *
   * The forest pooled summary is styled through `seriesStyles["forest-summary"]` but is drawn as
   * its own scene element, not a series — so `firstSeriesId` can only return a study. A check
   * that writes only to that key reports every summary-only field (`summaryShape`,
   * `linkSummaryToStudies`) as having no effect although they work. `optionEffects.ts` handles it the same
   * way: write under the synthetic key as well.
   *
   * Read off the drawing, so a kind that does not draw one contributes nothing.
   */
  async syntheticSeriesIds(): Promise<string[]> {
    return this.page.evaluate(() =>
      document.querySelector("svg.gfx-figure .gfx-forest-summary") ? ["forest-summary"] : [],
    );
  }

  /**
   * The first drawn mark's series + row id, parsed from its `mark-<seriesId>-<rowId>` element id.
   * `plot.pointStyles` is keyed by `${seriesId}:${rowId}`, so a per-point check needs both live
   * ids — neither can be synthesised from the schema.
   */
  async firstMarkKey(): Promise<{ seriesId: string; rowId: string } | null> {
    return this.page.evaluate(() => {
      const el = document.querySelector('svg.gfx-figure [id^="mark-"]');
      const id = el?.getAttribute("id");
      if (!id) return null;
      const parts = id.split("-"); // mark-<seriesId>-<rowId>
      if (parts.length < 3) return null;
      return { seriesId: parts[1]!, rowId: parts.slice(2).join("-") };
    });
  }

  /**
   * A fingerprint of what the figure actually draws, bucketed by the dimension a control
   * claims to own. Comparing these before/after a control change is the only way to prove the
   * control does anything — the document holding the new value proves nothing.
   */
  async renderFingerprint(): Promise<Record<string, string>> {
    return this.page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure");
      if (!svg) return { missing: "1" };
      const uniq = (xs: (string | null)[]): string => [...new Set(xs.map((x) => x ?? ""))].sort().join(",");
      const circles = Array.from(svg.querySelectorAll("circle"));
      const strokedPaths = Array.from(svg.querySelectorAll("path")).filter(
        (p) => p.getAttribute("stroke") && p.getAttribute("stroke") !== "transparent",
      );
      const texts = Array.from(svg.querySelectorAll("text"));
      return {
        nodeFill: uniq(circles.map((c) => c.getAttribute("fill"))),
        nodeRadius: uniq(circles.map((c) => c.getAttribute("r"))),
        nodePos: circles.map((c) => `${c.getAttribute("cx")},${c.getAttribute("cy")}`).join("|"),
        edgeStroke: uniq(strokedPaths.map((p) => p.getAttribute("stroke"))),
        edgeWidth: uniq(strokedPaths.map((p) => p.getAttribute("stroke-width"))),
        edgeOpacity: uniq(strokedPaths.map((p) => p.getAttribute("stroke-opacity"))),
        // Path command letters, not a prefix of `d`. A prefix does not work here: coordinates are
        // long enough that "M 442.74277343750003 " fills 20 chars, so a straight line and a
        // quadratic would look identical and working curved edges would be reported dead.
        edgeShape: strokedPaths.map((p) => (p.getAttribute("d") ?? "").replace(/[^A-Za-z]/g, "")).join("|"),
        // Axis rules are <line>s (parallel axes, chart frames) — a separate dimension from edges.
        axisStroke: uniq(Array.from(svg.querySelectorAll("line")).map((l) => l.getAttribute("stroke"))),
        // Ordered per-path widths, so a change to a single trace is visible (the uniq sets above
        // can miss it when another trace already carries that width).
        perPathWidth: strokedPaths.map((p) => p.getAttribute("stroke-width") ?? "").join("|"),
        perPathOpacity: strokedPaths.map((p) => p.getAttribute("stroke-opacity") ?? "").join("|"),
        labelSize: uniq(texts.map((t) => t.getAttribute("font-size"))),
        labelCount: String(texts.length),
        labelFamily: uniq(texts.map((t) => t.getAttribute("font-family"))),
        // Broad digest — every drawable element's visual attributes. The keyed dimensions
        // above sample circles/stroked-paths/text/lines only, so whole kinds are invisible to
        // them: a heatmap draws <rect> cells, a treemap draws fill-only <path>s. A field sweep
        // asking "did anything change?" has to look at everything, or it reports entire kinds
        // as dead.
        digest: // Note: `g` is in this list deliberately. SVG inherits presentation attributes, and the
        // renderer sets stroke/stroke-width on a group for whole clusters (box whiskers are
        // `<g stroke={wColor} strokeWidth={wWidth}>` around bare <line>s). Sampling only leaf
        // elements makes every group-level style, such as whiskerColor and whiskerWidth, look
        // inert.
        Array.from(svg.querySelectorAll("g,rect,circle,path,line,polygon,polyline,text,stop,image,pattern,linearGradient,radialGradient"))
          .map((e) =>
            [
              e.tagName,
              e.getAttribute("fill"),
              e.getAttribute("stroke"),
              e.getAttribute("stroke-width"),
              e.getAttribute("stroke-opacity"),
              e.getAttribute("fill-opacity"),
              e.getAttribute("stroke-dasharray"),
              e.getAttribute("opacity"),
              e.getAttribute("font-size"),
              e.getAttribute("transform"),
              e.getAttribute("d") ?? e.getAttribute("points"),
              e.getAttribute("x"), e.getAttribute("y"),
              e.getAttribute("width"), e.getAttribute("height"),
              e.getAttribute("cx"), e.getAttribute("cy"), e.getAttribute("r"),
              e.getAttribute("x1"), e.getAttribute("y1"), e.getAttribute("x2"), e.getAttribute("y2"),
              e.getAttribute("offset"), e.getAttribute("stop-color"),
              // pattern/gradient defs carry the style on themselves — patternScale changes a
              // <pattern>'s size, gradientAngle changes a <linearGradient>'s vector. Sampling
              // only their children would make both look inert.
              e.getAttribute("patternTransform"), e.getAttribute("gradientTransform"),
              e.getAttribute("patternUnits"), e.getAttribute("gradientUnits"),
              e.textContent,
            ].join("~"),
          )
          .join("|"),
      };
    });
  }

  /** Set a plot-wide font role (tick / axisTitle / title / legend …) through the app's handler. */
  async setPlotFont(element: string, patch: Record<string, unknown>): Promise<void> {
    const ok = await this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const fn = __walk((p) => (typeof p.onSetPlotFont === 'function' ? p.onSetPlotFont : null));
      if (!fn) return false;
      fn(${JSON.stringify(element)}, ${JSON.stringify(patch)});
      return true;
    })()`);
    if (!ok) throw new Error("setPlotFont: no onSetPlotFont handler on the fiber");
    await this.settle();
  }

  /**
   * Gap (px) between each axis title and the nearest tick label on its own axis, plus how much
   * canvas is left beyond the title. Negative clearance = the title is sitting on the numbers;
   * negative margin = it has run off the canvas. `AxisScene.titlePos` is what prevents both.
   */
  async axisTitleClearance(): Promise<{ x: number | null; y: number | null; xMargin: number | null; yMargin: number | null }> {
    return this.page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement | null;
      if (!svg) return { x: null, y: null, xMargin: null, yMargin: null };
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      // Element → figure units. In Chromium, getCTM() includes the <svg>'s own viewBox scale and shift,
      // so it reads figure units only at scale 1 with an unshifted viewBox.
      const userCTM = (el: SVGGraphicsElement): DOMMatrix | null => {
        const root = (svg as SVGSVGElement).getScreenCTM();
        const own = el.getScreenCTM();
        return root && own ? root.inverse().multiply(own) : null;
      };
      const box = (el: SVGGraphicsElement) => {
        const b = el.getBBox();
        const m = userCTM(el);
        if (!m) return null;
        const corners: [number, number][] = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]];
        const pts = corners.map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
      };
      const texts = Array.from(svg.querySelectorAll("text"))
        .filter((t) => (t.textContent ?? "").trim())
        .map((t) => ({ el: t, txt: (t.textContent ?? "").trim(), rot: (t.getAttribute("transform") ?? "").includes("rotate(-90"), g: box(t) }))
        .filter((o) => o.g);
      // Tick labels are the numeric runs; the titles are the non-numeric ones nearest each edge.
      const nums = texts.filter((o) => /^-?[\d.,]+%?$/.test(o.txt));
      const yTitle = texts.filter((o) => o.rot).sort((a, b) => a.g!.x - b.g!.x)[0];
      const xTitle = texts.filter((o) => !o.rot && !/^-?[\d.,]+%?$/.test(o.txt)).sort((a, b) => b.g!.b - a.g!.b)[0];
      const below = xTitle ? nums.filter((o) => o.g!.b <= xTitle.g!.y + 40 && o.g!.b > xTitle.g!.y - 90) : [];
      const leftOf = yTitle ? nums.filter((o) => o.g!.x >= yTitle.g!.r - 2) : [];
      return {
        x: xTitle && below.length ? Math.round((xTitle.g!.y - Math.max(...below.map((o) => o.g!.b))) * 10) / 10 : null,
        y: yTitle && leftOf.length ? Math.round((Math.min(...leftOf.map((o) => o.g!.x)) - yTitle.g!.r) * 10) / 10 : null,
        xMargin: xTitle ? Math.round((fh - xTitle.g!.b) * 10) / 10 : null,
        yMargin: yTitle ? Math.round(yTitle.g!.x * 10) / 10 : null,
      };
    });
  }

  /** Click the first colour swatch in the Inspector — a style edit that flows through applyStyle. */
  async clickFirstSwatch(): Promise<void> {
    await this.page.locator("button.swbtn").first().click();
    await this.settle();
  }

  /** Clear the selection the way a user does — Escape (`PlotFigure` → `onSelect(null)`). */
  async deselect(): Promise<void> {
    await this.page.locator("svg.gfx-figure").press("Escape");
    await this.settle();
  }

  /** Read a scope checkbox ("Apply to whole graph" / "Apply to whole series") in the Inspector. */
  async scopeState(label: string): Promise<boolean | null> {
    return this.page.evaluate((lbl) => {
      const span = Array.from(document.querySelectorAll(".frow > span")).find((s) => s.textContent === lbl);
      const box = span?.parentElement?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      return box ? box.checked : null;
    }, label);
  }

  /** Set a scope checkbox, by label, through a real click. */
  async setScope(label: string, on: boolean): Promise<void> {
    const current = await this.scopeState(label);
    if (current === null) throw new Error(`setScope: no "${label}" toggle is shown for this selection`);
    if (current === on) return;
    await this.page.locator(".frow", { hasText: label }).locator('input[type="checkbox"]').first().click();
    await this.settle();
  }

  /**
   * Open a top menu (File / Edit / Graph / …) and click one of its items by exact
   * label. Items nested under a submenu row (e.g. Analyze → "Common analyses" →
   * "Dose-response…") are found too: if the label is not on the open panel, each
   * submenu parent is opened until it is.
   */
  async menu(menu: string, item: string): Promise<void> {
    await this.page.locator(".menubar .menu", { hasText: new RegExp(`^${menu}$`) }).click();
    const target = this.page.locator(".dropdown .dropitem", { hasText: new RegExp(`^${item}`) });
    if ((await target.count()) === 0) {
      const parents = this.page.locator(".dropdown .dropsub");
      for (let i = 0; i < (await parents.count()); i++) {
        await parents.nth(i).click();
        if ((await target.count()) > 0) break;
      }
    }
    await target.first().click();
    await this.settle();
  }

  /**
   * Commit the open Analyze dialog through its own onRun — the real confirmAnalyze path
   * (create + file + open the analysis tab, then the engine call). In the browser preview
   * the engine is absent, so the analysis records an error — the record and its tab still
   * exist, which is all a context/filing spec needs. The dialog must already be open.
   */
  async analyzeRun(spec: Record<string, unknown>): Promise<void> {
    const ok = await this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const fn = __walk((p) => (typeof p.onRun === 'function' && p.table ? p.onRun : null));
      if (!fn) return false;
      fn(${JSON.stringify(spec)});
      return true;
    })()`);
    if (!ok) throw new Error("analyzeRun: no open Analyze dialog (no onRun+table props on the fiber)");
    await this.settle();
  }

  /** Drive the document pane's real analysis and table-edit handlers. */
  async analysisAction(action: "rerun" | "edit", id: string, value?: number): Promise<void> {
    const ok = await this.page.evaluate(`(() => { ${FIBER_HELPERS}
      const p = __walk((p) => typeof p.onRerunAnalysis === 'function' && p.tableOps ? p : null);
      if (!p) return false;
      if (${JSON.stringify(action)} === 'rerun') p.onRerunAnalysis(${JSON.stringify(id)});
      else p.tableOps.editCell(${JSON.stringify(id)}, 0, 1, ${JSON.stringify(value ?? 0)});
      return true;
    })()`);
    if (!ok) throw new Error("analysisAction: document pane handlers not found");
    await this.settle();
  }

  /** The name of the table the open Analyze dialog is acting on (its `table` prop). */
  async analyzeDialogTableName(): Promise<string | null> {
    return this.page.evaluate(`(() => { ${FIBER_HELPERS}
      return __walk((p) => (typeof p.onRun === 'function' && p.table ? p.table.name : null));
    })()`) as Promise<string | null>;
  }

  /** Open the Chart gallery tab and return every card's title, in display order. */
  async openGallery(): Promise<string[]> {
    await this.menu("Graph", "Chart gallery");
    await this.page.waitForSelector(".gallerycard", { timeout: 30_000 });
    await this.settle();
    return this.page.locator(".gallerycard .gallerycard-h").allTextContents();
  }

  /** Open one gallery card as a real, full-size editable graph. */
  async openGalleryCard(title: string): Promise<void> {
    // Fail fast on a card that is not there. A click on a locator with no match waits out the
    // whole test timeout (many minutes in a sweep) and then reports the time, not the cause.
    // Name the missing card and the cards that exist instead.
    // Match the heading exactly. `hasText` is a case-insensitive substring over the whole card, so
    // "Dendrogram" would open the split-heatmap card that comes first and mentions a dendrogram in
    // its note — and the axis sweep would then report every Y-axis field of the dendrogram as dead.
    const card = this.page.locator(".gallerycard", { has: this.page.getByText(title, { exact: true }) }).first();
    if ((await card.count()) === 0) {
      const titles = await this.page.locator(".gallerycard .gallerycard-h").allTextContents();
      throw new Error(`openGalleryCard: no gallery card titled "${title}". Cards: ${titles.join(" | ")}`);
    }
    await card.click({ timeout: 15_000 });
    await this.page.waitForSelector("svg.gfx-figure", { timeout: 30_000 });
    await this.settle();
  }

  /**
   * Geometry of every visible text run in the current figure, plus the collisions between
   * them — the layer no other suite covers.
   *
   * Note: coordinates are composed to root svg space via `getCTM()`. A raw `getBBox()` is in the
   * element's own space, so any text inside a transformed `<g>` reads as if it were at the
   * origin, which would report a crowded network as clean.
   * Note: this can only run in a real browser: jsdom has no text metrics, so `getBBox()` there is
   * all zeros and every figure looks free of overlaps.
   */
  async figureGeometry(): Promise<FigureGeometry> {
    return this.page.evaluate(() => {
      const svg = document.querySelector("svg.gfx-figure") as SVGSVGElement | null;
      if (!svg) return { canvas: { w: 0, h: 0 }, texts: 0, textArea: 0, fontSizes: [], overlaps: [], clipped: [] };
      const vb = svg.viewBox.baseVal;
      // The figure's size, not the visible area: the graph view grows its viewBox to take in anything
      // drawn past the edge (figureGrowth.ts) — measured against that, run-off text would read as inside.
      const fw = Number(svg.getAttribute("data-figure-w")) || vb.width;
      const fh = Number(svg.getAttribute("data-figure-h")) || vb.height;
      // Element → figure units. In Chromium, getCTM() includes the <svg>'s own viewBox scale and shift,
      // so it reads figure units only at scale 1 with an unshifted viewBox.
      const userCTM = (el: SVGGraphicsElement): DOMMatrix | null => {
        const root = (svg as SVGSVGElement).getScreenCTM();
        const own = el.getScreenCTM();
        return root && own ? root.inverse().multiply(own) : null;
      };
      const visible = (el: Element): boolean => {
        for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
          if (n.getAttribute("opacity") === "0") return false;
        }
        return true;
      };
      type Box = { txt: string; x: number; y: number; w: number; h: number; quad: { x: number; y: number }[] };
      const boxes: Box[] = [];
      for (const t of Array.from(svg.querySelectorAll("text"))) {
        const txt = (t.textContent ?? "").trim();
        if (!txt || !visible(t)) continue;
        // The hover tooltip (`.gfx-tooltip`) is transient UI over the figure, not the figure: the
        // pointer rests where the card was clicked, so its box would be measured as an overlap on
        // the waterfall and the volcano ("Best change from baseline" over the zone label).
        if (t.closest(".gfx-tooltip")) continue;
        let b: DOMRect;
        let m: DOMMatrix | null;
        try { b = t.getBBox(); m = userCTM(t); } catch { continue; }
        if (!m || b.width === 0 || b.height === 0) continue;
        const corners: [number, number][] = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]];
        const pts = corners.map(([x, y]) => ({ x: m!.a * x + m!.c * y + m!.e, y: m!.b * x + m!.d * y + m!.f }));
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const r2 = (n: number): number => Math.round(n * 10) / 10;
        // The rotated quad rides along: two diagonal labels' upright boxes overlap long before
        // their glyphs do (for example the chord's "Endothelial" × "B cell").
        boxes.push({ txt: txt.slice(0, 24), x: r2(Math.min(...xs)), y: r2(Math.min(...ys)), w: r2(Math.max(...xs) - Math.min(...xs)), h: r2(Math.max(...ys) - Math.min(...ys)), quad: [pts[0]!, pts[1]!, pts[3]!, pts[2]!] });
      }
      // A collision needs real overlap in both axes — glyph bboxes routinely share an edge.
      const TOL = 1.5;
      // …and, for rotated text, real overlap of the rotated rectangles themselves (separating
      // axis test over both quads' edge normals). The upright box of a diagonal label is mostly
      // empty corner; two of them crossing is not two labels touching.
      const quadsTouch = (qa: { x: number; y: number }[], qb: { x: number; y: number }[]): boolean => {
        for (const q of [qa, qb]) {
          for (let k = 0; k < 4; k++) {
            const p1 = q[k]!; const p2 = q[(k + 1) % 4]!;
            const nx = -(p2.y - p1.y); const ny = p2.x - p1.x;
            const len = Math.hypot(nx, ny) || 1;
            const proj = (pts: { x: number; y: number }[]) => pts.map((p) => (p.x * nx + p.y * ny) / len);
            const pa = proj(qa); const pb = proj(qb);
            const depth = Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
            if (depth <= TOL) return false;
          }
        }
        return true;
      };
      const overlaps: FigureGeometry["overlaps"] = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ox > TOL && oy > TOL && quadsTouch(a.quad, b.quad)) overlaps.push({ a: a.txt, b: b.txt, ox: Math.round(ox * 10) / 10, oy: Math.round(oy * 10) / 10 });
        }
      }
      const clipped = boxes
        .filter((t) => t.x < -TOL || t.y < -TOL || t.x + t.w > fw + TOL || t.y + t.h > fh + TOL)
        .map((t) => ({ txt: t.txt, x: t.x, y: t.y, right: Math.round((t.x + t.w) * 10) / 10, bottom: Math.round((t.y + t.h) * 10) / 10 }));
      const area = boxes.reduce((s, b) => s + b.w * b.h, 0);
      // The distinct font sizes actually rendered — the ground truth for "did a font change
      // reach the picture?", independent of any layout reflow.
      const sizes = [...new Set(Array.from(svg.querySelectorAll("text"))
        .filter((t) => (t.textContent ?? "").trim())
        .map((t) => Math.round(parseFloat(getComputedStyle(t).fontSize) || 0))
        .filter((n) => n > 0))].sort((a, b) => a - b);
      return { canvas: { w: fw, h: fh }, texts: boxes.length, textArea: Math.round(area), fontSizes: sizes, overlaps, clipped };
    });
  }
}

/** Text-geometry report for one figure — see `MadyApp.figureGeometry`. */
export interface FigureGeometry {
  canvas: { w: number; h: number };
  texts: number;
  /** Total inked area of all text runs. Sensitive to any font-size change, unlike a max —
   *  a tick going 13→20 does not exceed a 25px title, so "tallest" would not detect it. */
  textArea: number;
  /** Distinct rendered font sizes (px), ascending — ground truth for "did the font change land?" */
  fontSizes: number[];
  overlaps: { a: string; b: string; ox: number; oy: number }[];
  clipped: { txt: string; x: number; y: number; right: number; bottom: number }[];
}

/** Attach an error collector before the app boots. */
export async function collectErrors(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __e2eErrors: string[] };
    w.__e2eErrors = [];
    window.addEventListener("error", (e) => w.__e2eErrors.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => w.__e2eErrors.push(String((e as PromiseRejectionEvent).reason)));
    const err = console.error.bind(console);
    console.error = (...a: unknown[]) => { w.__e2eErrors.push(a.map(String).join(" ")); err(...a); };
  });
}
