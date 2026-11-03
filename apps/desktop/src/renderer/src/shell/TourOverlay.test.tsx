// @vitest-environment jsdom
/**
 * The tour's light: dim only, follows the first anchor that is laid out, advances on the
 * document and never on entry, and the card's buttons do what they say.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` is mocked on the anchors that matter — the
 * test is of the choice (which anchor, where the card goes), not of pixels. The real geometry
 * is proven in `e2e/guided-tour.spec.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { findAnchors, labelOf, measureAnchor, placeCard, TourOverlay } from "./TourOverlay";
import type { TourState, TourStep } from "./tour";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const S0: TourState = { tables: 1, plots: 1, analyses: 0, importOpen: false, newGraphOpen: false, exportOpen: false, analyzeOpen: false, selectionKind: null, workingTableKind: null, sigMarkers: 0, sheetInFront: false, sheet: null, dataSelection: false, activePlot: null, figureOpen: false, figure: null };

const STEPS: TourStep[] = [
  { id: "a", anchors: [], mode: "look", title: "Look here", text: "A look step with nothing to detect, so it shows Next.", offerSample: true },
  { id: "b", anchors: ['[data-tour="cmd:paste-data"]', '[data-tour="menu:File"]'], mode: "action", title: "Paste", text: "Do the paste, and the tour notices the preview opening.", done: (n, s) => n.importOpen && !s.importOpen },
  { id: "c", anchors: [], mode: "look", title: "Done", text: "The last card, whose Next reads Finish and ends the tour." },
];

function laidOut(el: HTMLElement, r: { x: number; y: number; w: number; h: number }): void {
  el.getBoundingClientRect = () => ({ left: r.x, top: r.y, width: r.w, height: r.h, right: r.x + r.w, bottom: r.y + r.h, x: r.x, y: r.y, toJSON: () => ({}) }) as DOMRect;
}

describe("measureAnchor", () => {
  it("lights the first anchor that is on screen — the menu item once the menu is open, the menu title before", () => {
    const title = document.createElement("span");
    title.dataset.tour = "menu:File";
    laidOut(title, { x: 10, y: 4, w: 30, h: 20 });
    document.body.append(title);
    expect(measureAnchor(STEPS[1]!.anchors)).toEqual({ x: 10, y: 4, w: 30, h: 20 });

    const item = document.createElement("button");
    item.dataset.tour = "cmd:paste-data";
    laidOut(item, { x: 12, y: 60, w: 200, h: 24 });
    document.body.append(item);
    expect(measureAnchor(STEPS[1]!.anchors)).toEqual({ x: 12, y: 60, w: 200, h: 24 });
  });

  it("skips an anchor that exists but is not laid out (a hidden dock), and reports null when none is", () => {
    const ghost = document.createElement("button");
    ghost.dataset.tour = "cmd:paste-data"; // jsdom: zero-size
    document.body.append(ghost);
    const title = document.createElement("span");
    title.dataset.tour = "menu:File";
    laidOut(title, { x: 1, y: 2, w: 3, h: 4 });
    document.body.append(title);
    expect(measureAnchor(STEPS[1]!.anchors)).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(measureAnchor(['[data-tour="nothing"]'])).toBeNull();
  });
});

describe("anchors named by their words (`css :: label`)", () => {
  it("an Inspector row is known by its first span, a tab or heading by its own text — glyphs drawn by CSS do not count", () => {
    document.body.innerHTML = `
      <div class="insp">
        <button class="inspcat">Axis</button><button class="inspcat on">Data</button>
        <details class="inspsub2"><summary>Ticks<button class="guidehelp"></button></summary>
          <label class="frow"><span>Tick interval</span><input></label>
          <label class="frow"><span>Tick interval fine</span><input></label>
          <label class="frow"><span>Minor ticks</span><input></label>
        </details>
        <label class="grbtog"><input type="checkbox"> Grid</label>
      </div>`;
    expect(labelOf(document.querySelector(".frow")!)).toBe("Tick interval");
    expect(labelOf(document.querySelector("summary")!)).toBe("Ticks");
    expect(labelOf(document.querySelector(".grbtog")!)).toBe("Grid");
    expect(findAnchors(".frow :: Tick interval").map(labelOf)).toEqual(["Tick interval"]); // exact, not "Tick interval fine"
    expect(findAnchors(".frow :: Minor ticks")).toHaveLength(1);
    expect(findAnchors(".inspcat :: Data").map((e) => e.className)).toEqual(["inspcat on"]);
    expect(findAnchors(".inspsub2 > summary :: Ticks")).toHaveLength(1);
    expect(findAnchors(".grbtog :: Grid")).toHaveLength(1);
    expect(findAnchors(".frow :: Nothing here")).toEqual([]);
    expect(findAnchors(".frow")).toHaveLength(3); // a plain selector still works
  });

  it("a label wrapping a select is known by its own words, not by every option's", () => {
    document.body.innerHTML = `<label class="grbsel">Frame<select><option>L-shape</option><option>Box</option></select></label>
      <div class="frow"><input><button>Add cut</button></div>`;
    expect(labelOf(document.querySelector(".grbsel")!)).toBe("Frame");
    expect(findAnchors(".grbsel :: Frame")).toHaveLength(1);
    expect(labelOf(document.querySelector(".frow")!), "a row with no words of its own falls back to everything in it").toBe("Add cut");
  });

  it("a row inside a closed group is not on screen even when the browser gives it a box — the heading is lit instead", () => {
    // Chromium keeps layout boxes for a closed <details>' hidden content, so without this rule the
    // ring would land on the invisible Paper row under the Background heading. The summary itself
    // still counts.
    document.body.innerHTML = `<details class="inspsec"><summary class="insphd">Background</summary><div><div class="frow"><span>Paper</span></div></div></details>`;
    laidOut(document.querySelector(".frow")!, { x: 1151, y: 368, w: 282, h: 27 });
    laidOut(document.querySelector("summary")!, { x: 1151, y: 335, w: 282, h: 33 });
    const anchors = [".frow :: Paper", ".insphd :: Background"];
    expect(measureAnchor(anchors)).toEqual({ x: 1151, y: 335, w: 282, h: 33 });
    document.querySelector("details")!.setAttribute("open", "");
    expect(measureAnchor(anchors)).toEqual({ x: 1151, y: 368, w: 282, h: 27 });
  });

  it("a heading followed by a count badge still matches its title", () => {
    document.body.innerHTML = `<details><summary>Series 3</summary></details>`;
    expect(findAnchors("summary :: Series")).toHaveLength(1);
    expect(findAnchors("summary :: Ser")).toHaveLength(0); // never a prefix of a word
  });

  it("the light falls back from a row that is not laid out to its heading, then its tab", () => {
    document.body.innerHTML = `<button class="inspcat">Axis</button><summary>Ticks</summary><label class="frow"><span>Tick interval</span></label>`;
    laidOut(document.querySelector(".inspcat")!, { x: 1, y: 1, w: 40, h: 20 });
    const anchors = [".frow :: Tick interval", "summary :: Ticks", ".inspcat :: Axis"];
    expect(measureAnchor(anchors)).toEqual({ x: 1, y: 1, w: 40, h: 20 }); // only the tab is laid out
    laidOut(document.querySelector("summary")!, { x: 2, y: 2, w: 50, h: 20 });
    expect(measureAnchor(anchors)).toEqual({ x: 2, y: 2, w: 50, h: 20 }); // the heading now exists
    laidOut(document.querySelector(".frow")!, { x: 3, y: 3, w: 60, h: 20 });
    expect(measureAnchor(anchors)).toEqual({ x: 3, y: 3, w: 60, h: 20 }); // the row wins
  });
});

describe("placeCard", () => {
  const card = { w: 340, h: 160 };
  const view = { w: 1400, h: 900 };
  it("goes below the ring when there is room, above when there is not, centred when there is no ring", () => {
    expect(placeCard({ x: 500, y: 30, w: 40, h: 20 }, card, view)).toEqual({ left: 500 + 20 - 170, top: 30 + 20 + 14 });
    expect(placeCard({ x: 500, y: 800, w: 40, h: 60 }, card, view)).toEqual({ left: 500 + 20 - 170, top: 800 - 14 - 160 });
    expect(placeCard(null, card, view), "nothing lit → the bottom-right corner, never the middle").toEqual({ left: 1400 - 340 - 24, top: 900 - 160 - 24 });
  });
  it("a ring in the right-hand panel puts the card beside it, not under it, where it would cover the next controls", () => {
    // The Inspector's Style tab at x≈1150 of 1400: the card must sit to its left, level with it.
    const p = placeCard({ x: 1150, y: 240, w: 60, h: 24 }, card, view);
    expect(p.left + card.w).toBeLessThanOrEqual(1150 - 14);
    expect(p.top).toBeLessThanOrEqual(240);
    expect(p.top + card.h).toBeGreaterThanOrEqual(264);
    // …and a ring in the Project tree on the left puts it to the right.
    const q = placeCard({ x: 20, y: 300, w: 200, h: 400 }, card, view);
    expect(q.left).toBeGreaterThanOrEqual(220 + 14);
  });

  it("stays inside the window — a ring at the left edge does not push the card off screen", () => {
    const p = placeCard({ x: 0, y: 30, w: 40, h: 20 }, card, view);
    expect(p.left).toBeGreaterThanOrEqual(8);
    const q = placeCard({ x: 1390, y: 30, w: 10, h: 20 }, card, view);
    expect(q.left + card.w).toBeLessThanOrEqual(view.w - 8);
  });
});

describe("TourOverlay", () => {
  it("a card for an Inspector row or heading carries the discreet scroll hint; a menu or figure card does not", () => {
    const hint = (step: TourStep) => {
      const r = render(<TourOverlay steps={[step, STEPS[2]!]} state={S0} onQuit={() => {}} onFinish={() => {}} />);
      const el = r.container.querySelector(".tour-hint");
      const text = el?.textContent ?? null;
      r.unmount();
      return text;
    };
    const row: TourStep = { id: "range", anchors: [".frow :: Range", ".insphd :: Range", ".inspcat :: Axis"], mode: "action", title: "Set the range", text: "Type a range." };
    const heading: TourStep = { id: "grid", anchors: [".inspsub2 > summary :: Grid"], mode: "action", title: "Grid", text: "Open the group." };
    expect(hint(row)).toBe("If the option is not in view, scroll the Inspector up or down (mouse wheel).");
    expect(hint(heading)).toBe("If the option is not in view, scroll the Inspector up or down (mouse wheel).");
    expect(hint(STEPS[1]!), "a menu step has nothing to scroll").toBeNull();
    expect(hint({ id: "pick", anchors: [".laycards"], mode: "action", title: "Pick", text: "Pick two." }), "a figure-builder step is not in the Inspector").toBeNull();
    expect(hint(STEPS[2]!), "a look step with no anchor").toBeNull();
  });

  it("Next on an undone action step makes the program DO it, then moves on once the document changed — and never before", () => {
    const onPerform = vi.fn((_step: TourStep, _now: TourState) => true);
    const withSheet = (columns: number): TourState => ({ ...S0, sheetInFront: true, sheet: { id: "t1", columns, excluded: 0, fingerprint: String(columns) } });
    const steps: TourStep[] = [
      { id: "add-column", anchors: [], mode: "action", needs: "sheet", title: "Add a column", text: "Press + Column above the grid to add a column to the sheet in front.", done: (n, s) => (n.sheet?.columns ?? 0) > (s.sheet?.columns ?? 0) },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={withSheet(3)} onQuit={() => {}} onFinish={() => {}} onPerform={onPerform} />);
    expect(r.container.querySelector(".tour-skip")).toBeNull();
    fireEvent.click(r.getByText("Next"));
    expect(onPerform).toHaveBeenCalledTimes(1);
    expect(onPerform.mock.calls[0]![0].id).toBe("add-column");
    // Still on the step, busy, until the document shows the column.
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Add a column");
    expect(r.container.querySelector(".tour-busy")!.textContent).toBe("Doing it for you…");
    act(() => { r.rerender(<TourOverlay steps={steps} state={withSheet(4)} onQuit={() => {}} onFinish={() => {}} onPerform={onPerform} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });

  it("Next on an action step whose state is already there moves on without performing anything", () => {
    const onPerform = vi.fn(() => true);
    const s3: TourState = { ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded: 0, fingerprint: "3" } };
    const s4: TourState = { ...s3, sheet: { id: "t1", columns: 4, excluded: 0, fingerprint: "4" } };
    const steps: TourStep[] = [
      { id: "add-column", anchors: [], mode: "action", needs: "sheet", title: "Add a column", text: "Press + Column above the grid to add a column to the sheet in front.", done: (n, s) => (n.sheet?.columns ?? 0) > (s.sheet?.columns ?? 0) },
      STEPS[2]!,
    ];
    // (The reader adds the column themselves → the step completes on its own; Next was never needed.)
    const r = render(<TourOverlay steps={steps} state={s3} onQuit={() => {}} onFinish={() => {}} onPerform={onPerform} />);
    act(() => { r.rerender(<TourOverlay steps={steps} state={s4} onQuit={() => {}} onFinish={() => {}} onPerform={onPerform} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
    expect(onPerform).not.toHaveBeenCalled();
  });

  it("Next on a look step whose view is not in front brings it in front first, then moves on when it arrives", () => {
    const onReach = vi.fn();
    const withSheet: TourState = { ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded: 0, fingerprint: "a" } };
    const steps: TourStep[] = [
      { id: "format", anchors: [], mode: "look", needs: "sheet", title: "The format chip", text: "The chip above the grid says the sheet's format; click it to change the format if it guessed wrong." },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />);
    // The tour started on the sheet; the reader wandered to Welcome, then presses Next.
    act(() => { r.rerender(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    fireEvent.click(r.getByText("Next"));
    expect(onReach).toHaveBeenCalledWith("sheet", { preferId: "t1" });
    expect(r.container.querySelector(".tour-card-title")!.textContent, "moved on before the sheet was back").toBe("The format chip");
    act(() => { r.rerender(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });

  it("the sample button shows a busy sign at once and clears when the sample arrives; the clipboard button moves on to pasting", () => {
    const onReach = vi.fn();
    const onCopySample = vi.fn();
    const withSheet: TourState = { ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded: 0, fingerprint: "a" } };
    const steps: TourStep[] = [
      { id: "copy", anchors: [], mode: "action", offerSample: true, needs: "sheet", choose: true, title: "Copy your numbers", text: "Copy a block of numbers, or take the sample; the tour continues once a sheet is in front.", done: (n, s) => n.sheetInFront && !s.sheetInFront },
      { id: "paste", anchors: [], mode: "action", title: "Paste", text: "File ▸ Paste data as new datasheet… opens the import preview on what you copied.", done: (n, s) => n.importOpen && !s.importOpen },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} onCopySample={onCopySample} />);
    expect(r.container.querySelector(".tour-next"), "a choose step has no Next: the sample button IS the way on").toBeNull();
    fireEvent.click(r.getByText("Use a sample datasheet"));
    expect(onReach).toHaveBeenCalledWith("sheet", { generate: true });
    expect(r.container.querySelector(".tour-busy")!.textContent).toBe("Making the sample…");
    act(() => { r.rerender(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} onCopySample={onCopySample} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Paste");
    expect(r.container.querySelector(".tour-busy")).toBeNull();
    // Clipboard path: the button copies and moves straight to the paste step.
    const r2 = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} onCopySample={onCopySample} />);
    fireEvent.click(r2.getByText("Put sample numbers on the clipboard"));
    expect(onCopySample).toHaveBeenCalledOnce();
    expect(r2.container.querySelector(".tour-card-title")!.textContent).toBe("Paste");
  });

  it("dims only: the dark layer and the ring take no clicks, and the card is the one thing that does", () => {
    const { container } = render(<TourOverlay steps={STEPS} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    const dim = container.querySelector<HTMLElement>(".tour-dim");
    expect(dim, "no dim layer on a step without an anchor").toBeTruthy();
    expect(dim!.style.pointerEvents).toBe("none");
    expect(container.querySelector(".tour-card")).toBeTruthy();
  });

  it("a look step shows Next and advances on it; the last card reads Finish and calls onFinish", () => {
    const onFinish = vi.fn();
    const { container, getByText } = render(<TourOverlay steps={[STEPS[0]!, STEPS[2]!]} state={S0} onQuit={() => {}} onFinish={onFinish} />);
    expect(container.querySelector(".tour-card-title")!.textContent).toBe("Look here");
    fireEvent.click(getByText("Next"));
    expect(container.querySelector(".tour-card-title")!.textContent).toBe("Done");
    fireEvent.click(getByText("Finish"));
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it("an action step advances when the document changes, never on the state it was entered in", () => {
    const steps = [STEPS[1]!, STEPS[2]!];
    // Entered with the preview already open: must stay put (the check is relative).
    const open = { ...S0, importOpen: true };
    const r1 = render(<TourOverlay steps={steps} state={open} onQuit={() => {}} onFinish={() => {}} />);
    expect(r1.container.querySelector(".tour-card-title")!.textContent).toBe("Paste");
    r1.unmount();

    const r2 = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    expect(r2.container.querySelector(".tour-card-title")!.textContent).toBe("Paste");
    expect(r2.container.querySelector(".tour-skip"), "there is no Skip: nothing advances without its state").toBeNull();
    expect(r2.container.querySelector(".tour-next"), "an action step has Next (verify or do)").toBeTruthy();
    act(() => {
      r2.rerender(<TourOverlay steps={steps} state={{ ...S0, exportOpen: true }} onQuit={() => {}} onFinish={() => {}} />);
    });
    expect(r2.container.querySelector(".tour-card-title")!.textContent, "advanced on an unrelated change").toBe("Paste");
    act(() => {
      r2.rerender(<TourOverlay steps={steps} state={{ ...S0, importOpen: true }} onQuit={() => {}} onFinish={() => {}} />);
    });
    expect(r2.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });

  it("the ring sits round the anchor with pointer-events none, and moves to the item when the menu drops", () => {
    vi.useFakeTimers();
    const title = document.createElement("span");
    title.dataset.tour = "menu:File";
    laidOut(title, { x: 10, y: 4, w: 30, h: 20 });
    document.body.append(title);
    const { container } = render(<TourOverlay steps={[STEPS[1]!, STEPS[2]!]} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    const ring = container.querySelector<HTMLElement>(".tour-ring");
    expect(ring, "no ring round a laid-out anchor").toBeTruthy();
    expect(ring!.style.pointerEvents).toBe("none");
    expect(ring!.style.left).toBe("4px"); // 10 - PAD
    expect(ring!.style.width).toBe("42px"); // 30 + 2·PAD

    const item = document.createElement("button");
    item.dataset.tour = "cmd:paste-data";
    laidOut(item, { x: 12, y: 60, w: 200, h: 24 });
    document.body.append(item);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector<HTMLElement>(".tour-ring")!.style.top).toBe("54px"); // 60 - PAD
  });

  it("a step whose anchors match nothing clears the previous step's ring — the light never lingers on the wrong control", () => {
    vi.useFakeTimers();
    const title = document.createElement("span");
    title.dataset.tour = "menu:File";
    laidOut(title, { x: 10, y: 4, w: 30, h: 20 });
    document.body.append(title);
    const steps: TourStep[] = [STEPS[1]!, { id: "z", anchors: ['[data-tour="nowhere"]'], mode: "look", title: "Nowhere", text: "A step whose control is not on screen: the whole window dims instead." }];
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    expect(r.container.querySelector(".tour-ring")).toBeTruthy();
    act(() => {
      r.rerender(<TourOverlay steps={steps} state={{ ...S0, importOpen: true }} onQuit={() => {}} onFinish={() => {}} />);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Nowhere");
    expect(r.container.querySelector(".tour-ring"), "the File ring survived into a step that does not light File").toBeNull();
    expect(r.container.querySelector(".tour-dim")).toBeTruthy();
  });

  it("the close button leaves the tour; the sample button is offered only where the step asks for it", () => {
    const onQuit = vi.fn();
    const onCopySample = vi.fn();
    const { container, getByLabelText, getByText, rerender } = render(<TourOverlay steps={STEPS} state={S0} onQuit={onQuit} onFinish={() => {}} onCopySample={onCopySample} />);
    fireEvent.click(getByText("Put sample numbers on the clipboard"));
    expect(onCopySample).toHaveBeenCalledOnce();
    fireEvent.click(getByText("Next"));
    expect(container.querySelector(".tour-sample"), "the sample button leaked onto a step that did not ask for it").toBeNull();
    fireEvent.click(getByLabelText("Leave the tour"));
    expect(onQuit).toHaveBeenCalledOnce();
    // Without a clipboard handler the button is not shown at all — a button that does nothing is a defect.
    rerender(<TourOverlay steps={STEPS} state={S0} onQuit={onQuit} onFinish={() => {}} />);
  });
  it("a step already satisfied on entry is skipped without being shown", () => {
    const steps: TourStep[] = [
      { id: "open", anchors: [], mode: "action", title: "Open a graph", text: "Open a graph so the next steps have something to style.", skipIf: (s) => s.plots > 0, done: (n, s) => n.plots > s.plots },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={{ ...S0, plots: 0 }} onQuit={() => {}} onFinish={() => {}} />);
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Open a graph"); // plots = 0: shown
    r.unmount();
    const r2 = render(<TourOverlay steps={steps} state={{ ...S0, plots: 1 }} onQuit={() => {}} onFinish={() => {}} />);
    expect(r2.container.querySelector(".tour-card-title")!.textContent).toBe("Done"); // plots = 1: skipped
    expect(r2.container.querySelector(".tour-card-n")!.textContent).toBe("Step 2 of 2");
  });
  it("compares against the plot as it was at entry, even though the document mutates in place", () => {
    // The shell hands the overlay the live plot object. If the entering state kept that same
    // object, mutating it would change "start" too and a facet check could never fire.
    const live = { id: "p1", name: "G", yAxis: {} } as unknown as NonNullable<TourState["activePlot"]>["plot"];
    const stateFor = (): TourState => ({ ...S0, activePlot: { title: "G", fingerprint: JSON.stringify(live), plot: live } });
    const steps: TourStep[] = [
      {
        id: "min", anchors: [], mode: "action", title: "Set a minimum", text: "Type a minimum into the Range group and the axis follows it.",
        done: (n, s) => JSON.stringify(n.activePlot?.plot.yAxis?.min) !== JSON.stringify(s.activePlot?.plot.yAxis?.min),
      },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={stateFor()} onQuit={() => {}} onFinish={() => {}} />);
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Set a minimum");
    (live as { yAxis: { min?: number } }).yAxis.min = 3; // the document changed in place
    act(() => {
      r.rerender(<TourOverlay steps={steps} state={stateFor()} onQuit={() => {}} onFinish={() => {}} />);
    });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });
  it("a step entered with NO graph in front adopts the graph that appears, then fires on a change to it", () => {
    // The compare tour's last step starts on the analysis tab. Comparing "now" with an entering
    // state that had no graph could never fire; the entering state must rebase on the graph.
    const P = (sig: unknown) => ({ id: "p1", name: "G", significance: sig }) as unknown as NonNullable<TourState["activePlot"]>["plot"];
    const withP = (sig: unknown): TourState => ({ ...S0, activePlot: { title: "G", fingerprint: JSON.stringify(P(sig)), plot: P(sig) } });
    const steps: TourStep[] = [
      {
        id: "sig", anchors: [], mode: "action", title: "Bracket shape", text: "Change how the significance brackets are drawn on the graph in front.",
        done: (n, s) => n.activePlot !== null && s.activePlot !== null && JSON.stringify(n.activePlot.plot.significance ?? null) !== JSON.stringify(s.activePlot.plot.significance ?? null),
      },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} />); // no graph
    act(() => { r.rerender(<TourOverlay steps={steps} state={withP(undefined)} onQuit={() => {}} onFinish={() => {}} />); }); // a graph appears
    expect(r.container.querySelector(".tour-card-title")!.textContent, "a graph merely appearing is not the change").toBe("Bracket shape");
    act(() => { r.rerender(<TourOverlay steps={steps} state={withP({ shape: "rounded" })} onQuit={() => {}} onFinish={() => {}} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });
  it("…but a step waiting for a graph to appear still fires when one does (the check runs before the rebase)", () => {
    const P = { id: "p1", name: "G" } as unknown as NonNullable<TourState["activePlot"]>["plot"];
    const steps: TourStep[] = [
      { id: "open", anchors: [], mode: "action", title: "Open a graph", text: "Open any graph so the following steps have one to work on.", done: (n, s) => n.activePlot !== null && s.activePlot === null },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    act(() => { r.rerender(<TourOverlay steps={steps} state={{ ...S0, activePlot: { title: "G", fingerprint: JSON.stringify(P), plot: P } }} onQuit={() => {}} onFinish={() => {}} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });
  it("entering a step whose view is not in front reaches it once; a choose step offers a button instead; a met need does nothing", () => {
    const onReach = vi.fn();
    const withSheet: TourState = { ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded: 0, fingerprint: "a" } };
    const steps: TourStep[] = [
      { id: "pick", anchors: [], mode: "action", needs: "sheet", choose: true, title: "Open a datasheet", text: "Open one of yours, or press the button for a sample datasheet to practise on.", done: (n, s) => n.sheetInFront && !s.sheetInFront },
      { id: "look", anchors: [], mode: "look", title: "Look at the graph", text: "A look step in between: the reader may wander off to a graph here." },
      { id: "edit", anchors: [], mode: "action", needs: "sheet", title: "Add a column", text: "Press + Column above the grid to add one to the sheet in front.", done: (n, s) => (n.sheet?.columns ?? 0) > (s.sheet?.columns ?? 0) },
      STEPS[2]!,
    ];
    // Step 1 is a choice: no automatic reach, a button offering the sample.
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />);
    expect(onReach).not.toHaveBeenCalled();
    const btn = r.container.querySelector(".tour-reach");
    expect(btn?.textContent).toBe("Use a sample datasheet");
    fireEvent.click(btn!);
    expect(onReach).toHaveBeenCalledWith("sheet", { generate: true }); // the button means "make me one"
    // The sheet arrives → step 1 done → the look step (no need).
    act(() => { r.rerender(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Look at the graph");
    // The reader wanders to a graph, then presses Next: the edit step needs the sheet → reached at once.
    act(() => { r.rerender(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    onReach.mockClear();
    fireEvent.click(r.getByText("Next"));
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Add a column");
    expect(onReach).toHaveBeenCalledTimes(1);
    expect(onReach).toHaveBeenCalledWith("sheet", { preferId: "t1" }); // back to the sheet the tour was on
    // Re-renders on the same step do not reach again (the shell is already bringing it).
    act(() => { r.rerender(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(onReach).toHaveBeenCalledTimes(1);
    // With the sheet in front, no button is offered on a non-choose step either.
    act(() => { r.rerender(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-reach")).toBeNull();
  });

  it("a met need on entry does not reach", () => {
    const onReach = vi.fn();
    const withSheet: TourState = { ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded: 0, fingerprint: "a" } };
    const steps: TourStep[] = [
      { id: "edit", anchors: [], mode: "action", needs: "sheet", title: "Add a column", text: "Press + Column above the grid to add one to the sheet in front.", done: (n, s) => (n.sheet?.columns ?? 0) > (s.sheet?.columns ?? 0) },
      STEPS[2]!,
    ];
    render(<TourOverlay steps={steps} state={withSheet} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />);
    expect(onReach).not.toHaveBeenCalled();
  });
  it("the card can be dragged by its header out of the way of what it covers, and snaps back on the next step", () => {
    const steps: TourStep[] = [STEPS[0]!, STEPS[2]!];
    const { container, getByText } = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} />);
    const card = container.querySelector<HTMLElement>(".tour-card")!;
    const head = container.querySelector<HTMLElement>(".tour-card-head")!;
    const left0 = parseFloat(card.style.left);
    const top0 = parseFloat(card.style.top);
    fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: 160, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(head, { clientX: 160, clientY: 130, pointerId: 1 });
    expect(parseFloat(card.style.left)).toBe(left0 + 60);
    expect(parseFloat(card.style.top)).toBe(top0 + 30);
    // A press that starts on the close button is a click, not a drag.
    fireEvent.pointerDown(container.querySelector(".tour-x")!, { clientX: 0, clientY: 0, pointerId: 2 });
    fireEvent.pointerMove(head, { clientX: 50, clientY: 50, pointerId: 2 });
    expect(parseFloat(card.style.left)).toBe(left0 + 60);
    // Next step: placed afresh, the offset is gone.
    fireEvent.click(getByText("Next"));
    expect(parseFloat(card.style.left)).toBe(left0);
  });
  it("a step entered with NO sheet in front adopts the sheet that comes back, then fires on a change to it", () => {
    // The datasheet tour's include step: entered from the graph the previous card sent the reader
    // to look at; the sheet returns only when the step reaches it, with values still excluded.
    const sheetWith = (excluded: number): TourState => ({ ...S0, sheetInFront: true, sheet: { id: "t1", columns: 3, excluded, fingerprint: "s" } });
    const steps: TourStep[] = [
      { id: "include", anchors: [], mode: "action", needs: "sheet", title: "Bring them back", text: "Select the excluded cells again and press Include to put them back into every graph.", done: (n, s) => n.sheet !== null && s.sheet !== null && n.sheet.excluded < s.sheet.excluded },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={S0} onQuit={() => {}} onFinish={() => {}} onReach={() => {}} />); // a graph, no sheet
    act(() => { r.rerender(<TourOverlay steps={steps} state={sheetWith(1)} onQuit={() => {}} onFinish={() => {}} onReach={() => {}} />); }); // the sheet is back
    expect(r.container.querySelector(".tour-card-title")!.textContent, "the sheet merely returning is not the change").toBe("Bring them back");
    act(() => { r.rerender(<TourOverlay steps={steps} state={sheetWith(0)} onQuit={() => {}} onFinish={() => {}} onReach={() => {}} />); }); // Include pressed
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });
  it("'needs a sheet' means the very sheet the tour is on: another sheet in front is reached away from, back to the right one", () => {
    const onReach = vi.fn();
    const on = (id: string): TourState => ({ ...S0, sheetInFront: true, sheet: { id, columns: 3, excluded: 1, fingerprint: id } });
    const steps: TourStep[] = [
      { id: "exclude", anchors: [], mode: "action", needs: "sheet", title: "Exclude them", text: "Press Exclude with the values to leave out selected; they stay in the sheet but leave every graph.", done: (n, s) => (n.sheet?.excluded ?? 0) > (s.sheet?.excluded ?? 0) },
      { id: "look", anchors: [], mode: "look", title: "What changed", text: "Look at a graph of this sheet: the excluded values are gone from it, nothing is deleted." },
      { id: "include", anchors: [], mode: "action", needs: "sheet", title: "Bring them back", text: "Select the excluded cells again and press Include; they rejoin every graph and analysis.", done: (n, s) => (n.sheet?.excluded ?? 0) < (s.sheet?.excluded ?? 0) },
      STEPS[2]!,
    ];
    const r = render(<TourOverlay steps={steps} state={on("mine")} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />);
    expect(onReach).not.toHaveBeenCalled(); // the right sheet is in front
    act(() => { r.rerender(<TourOverlay steps={steps} state={{ ...on("mine"), sheet: { id: "mine", columns: 3, excluded: 2, fingerprint: "x" } }} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("What changed");
    // The reader switches to another sheet, then presses Next.
    act(() => { r.rerender(<TourOverlay steps={steps} state={on("other")} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    fireEvent.click(r.getByText("Next"));
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Bring them back");
    expect(onReach).toHaveBeenCalledWith("sheet", { preferId: "mine" }); // back to "mine", not "any sheet will do"
    expect(r.container.querySelector(".tour-reach"), "the card offers the sample button while the wrong sheet is in front").toBeTruthy();
    // The right sheet returns: no button, and Include on it completes the step.
    act(() => { r.rerender(<TourOverlay steps={steps} state={{ ...on("mine"), sheet: { id: "mine", columns: 3, excluded: 2, fingerprint: "y" } }} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-reach")).toBeNull();
    act(() => { r.rerender(<TourOverlay steps={steps} state={{ ...on("mine"), sheet: { id: "mine", columns: 3, excluded: 0, fingerprint: "z" } }} onQuit={() => {}} onFinish={() => {}} onReach={onReach} />); });
    expect(r.container.querySelector(".tour-card-title")!.textContent).toBe("Done");
  });
});
