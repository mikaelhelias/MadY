// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

// Faithful stand-ins for the SVG composers whose returned size depends on the exact
// options passed. Guards against the dialog sizing the raster canvas from a
// composeFigureSvg call with different options (no user margin, no free-drag `places`)
// than the serialize() call that actually produces the exported SVG. These mocks
// return a different size for each set of options, so the test can assert the two agree.
const pngCalls: Array<{ svg: string; width: number; height: number }> = [];
/** Every composeFigureSvg options object, so tests can assert what the dialog passed. */
const composeCalls: Array<{ margin?: number; places?: unknown; gap?: number; letters?: unknown }> = [];

// Note: the format registry (`EXPORT_FORMAT_LABEL` and the two offered lists) is data, not a
// rendering call, so it comes through from the real module — mocking it would let the dropdown
// pass a test while offering formats the app does not have.
vi.mock("./exporters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exporters")>()),
  // Figure composer: the auto-grid box is wide; the free-drag (places) box is tall.
  // Margin is folded into the returned size, exactly like the real functions.
  composeFigureSvg: (panels: unknown[], opts: { margin?: number; places?: unknown; gap?: number; letters?: unknown } = {}) => {
    composeCalls.push(opts);
    if (!panels.length) return null;
    const m = opts.margin ?? 12; // real default is 12; the margin has to match it
    const hasPlaces = !!opts.places;
    const width = 100 + 2 * m + (hasPlaces ? 0 : 400);
    const height = 100 + 2 * m + (hasPlaces ? 400 : 0);
    return { svg: `<svg data-w="${width}" data-h="${height}"/>`, width, height };
  },
  // Single-graph serializer: the getBBox-unioned box is wider than the raw viewBox
  // (a legend/axis title overflows), and margin is folded in.
  serializeGraphSvg: (svg: { getAttribute?: (n: string) => string | null }, opts: { margin?: number } = {}) => {
    const m = opts.margin ?? 0;
    const width = 600 + 2 * m;
    const height = 100 + 2 * m;
    const mark = svg?.getAttribute?.("data-mark") ?? ""; // echo which SVG was chosen
    return { svg: `<svg data-w="${width}" data-h="${height}" data-mark="${mark}"/>`, width, height };
  },
  svgToPngBase64: (svg: string, width: number, height: number) => {
    pngCalls.push({ svg, width, height });
    return Promise.resolve("PNGBASE64");
  },
  svgToJpegBase64: () => Promise.resolve("JPG"),
  svgToTiffBase64: () => Promise.resolve("TIFF"),
  svgToCmykTiffBase64: () => Promise.resolve("CMYK"),
  svgToEpsText: () => Promise.resolve("EPS"),
  htmlWrap: (svg: string) => svg,
  tableToCsv: () => "",
  tableToGrid: () => ({ columnNames: [], rows: [] }),
  tableToJson: () => "",
}));

const { ExportDialog } = await import("./ExportDialog");

/** Parse the emitted-SVG dimensions the mock encoded into its output string. */
function emittedSize(svg: string): { w: number; h: number } {
  const w = Number(/data-w="(\d+)"/.exec(svg)?.[1]);
  const h = Number(/data-h="(\d+)"/.exec(svg)?.[1]);
  return { w, h };
}

afterEach(cleanup);
beforeEach(() => {
  pngCalls.length = 0;
  composeCalls.length = 0;
  document.body.innerHTML = "";
});

function panelSvg(): SVGSVGElement {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "gfx-figure");
  s.setAttribute("viewBox", "0 0 380 260");
  return s;
}

/** Build the figure-assembler DOM the dialog reads: an absolute canvas + N panels. */
function mountFigureDom(n: number): void {
  const canvas = document.createElement("div");
  // Faithful to production: the absolute container carries both classes (`laygrid laycanvas`).
  // Setting only `laycanvas` would not match the real DOM.
  canvas.className = "laygrid laycanvas";
  canvas.setAttribute("data-abs", "1"); // free-drag / auto-align → figurePanelPlaces() is non-null
  for (let i = 0; i < n; i++) {
    const panel = document.createElement("div");
    panel.className = "laypanel";
    panel.appendChild(panelSvg());
    canvas.appendChild(panel);
  }
  document.body.appendChild(canvas);
}

async function clickExport(container: HTMLElement): Promise<void> {
  const btn = container.querySelector(".btn") as HTMLButtonElement;
  fireEvent.click(btn);
  // handleExport → buildPayload is async (awaits svgToPngBase64, then payloadForFormat); let every pending microtask
  // drain. A fixed number of `await Promise.resolve()` turns would count the hops of one implementation, and one
  // more hop would make the test read the previous file. A macrotask turn waits for all of them, however many there are.
  await new Promise((r) => setTimeout(r, 0));
}

describe("ExportDialog — raster canvas matches the exported SVG", () => {
  it("a free-drag figure exports at the same aspect ratio as the SVG it rasterizes", async () => {
    mountFigureDom(2);
    const { container } = render(
      <ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    await clickExport(container);

    expect(pngCalls).toHaveLength(1);
    const { svg, width, height } = pngCalls[0]!;
    const emitted = emittedSize(svg);
    // The mock's free-drag box is 100×500 (tall); the auto-grid box is ~524×124 (wide), so
    // sizing the raster from it would be a >20× aspect error. The canvas must track the
    // emitted SVG within a rounding pixel.
    const rasterAspect = width / height;
    const svgAspect = emitted.w / emitted.h;
    expect(svgAspect).toBeCloseTo(0.2, 5); // 100/500 — proves we serialized the free-drag box
    expect(rasterAspect).toBeCloseTo(svgAspect, 2);
  });

  it("adding a margin keeps the raster proportional to the emitted SVG", async () => {
    mountFigureDom(2);
    const { container } = render(
      <ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    const marginInput = Array.from(container.querySelectorAll("input[type=number]")).find(
      (el) => (el as HTMLInputElement).max === "200",
    ) as HTMLInputElement;
    fireEvent.change(marginInput, { target: { value: "50" } });
    await clickExport(container);

    const { svg, width, height } = pngCalls[0]!;
    const emitted = emittedSize(svg);
    expect(emitted).toEqual({ w: 200, h: 600 }); // 100+2*50 × 500+2*50 — margin reached the composer
    expect(width / height).toBeCloseTo(emitted.w / emitted.h, 2);
  });

  it("targets the plot's own panel, not the document's first .gfx-figure", async () => {
    // Two figure-builder panels; the selected one is B (the second), so exporting must
    // not grab panel A just because it is the first .gfx-figure in the DOM.
    for (const [pid, mark] of [["plotA", "A"], ["plotB", "B"]] as const) {
      const wrap = document.createElement("div");
      wrap.className = "laypanel";
      wrap.setAttribute("data-pid", pid);
      const svg = panelSvg();
      svg.setAttribute("data-mark", mark);
      wrap.appendChild(svg);
      document.body.appendChild(wrap);
    }
    const { container } = render(
      <ExportDialog kind="plot" source="graph" plotId="plotB" suggestedName="g" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    await clickExport(container);
    expect(pngCalls[0]!.svg).toContain('data-mark="B"');
  });

  it("a single graph rasterizes at the getBBox-unioned size, not the raw viewBox", async () => {
    document.body.appendChild(panelSvg()); // a lone .gfx-figure
    const { container } = render(
      <ExportDialog kind="plot" source="graph" suggestedName="g" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    await clickExport(container);

    const { svg, width, height } = pngCalls[0]!;
    const emitted = emittedSize(svg);
    // The mock's unioned box is 600×100 (aspect 6). The raw viewBox was 380×260 (aspect ~1.46);
    // sizing from that would squash the wide legend. Raster must track the emitted box.
    expect(emitted).toEqual({ w: 600, h: 100 });
    expect(width / height).toBeCloseTo(6, 1);
  });
});

describe("ExportDialog — format-specific controls", () => {
  function renderGraph() {
    document.body.appendChild(panelSvg());
    return render(
      <ExportDialog kind="plot" source="graph" suggestedName="g" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
  }
  const pickFormat = (c: HTMLElement, f: string) =>
    fireEvent.change(c.querySelector('select[aria-label="Format"]') as HTMLSelectElement, { target: { value: f } });
  const marginInput = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("input[type=number]")).find((el) => (el as HTMLInputElement).max === "200");
  const transparentBtn = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("button")).find((b) => b.title === "Transparent");

  it("HTML export exposes Margin and Background", () => {
    const { container } = renderGraph();
    pickFormat(container, "html");
    expect(marginInput(container)).toBeTruthy();
    expect(container.querySelector('[aria-label="Background"]')).toBeTruthy();
  });

  it("TIFF export does not offer a Transparent background it cannot produce", () => {
    const { container } = renderGraph();
    pickFormat(container, "tiff");
    expect(transparentBtn(container)).toBeUndefined();
  });

  it("PNG still offers Transparent (control-reachability sanity)", () => {
    const { container } = renderGraph(); // png is the default format
    expect(transparentBtn(container)).toBeTruthy();
  });
});

describe("ExportDialog — print sizing in physical units", () => {
  const renderGraph = () => {
    const s = panelSvg();
    document.body.appendChild(s);
    return render(
      <ExportDialog kind="plot" suggestedName="g" onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
  };
  const printSel = (c: HTMLElement) => c.querySelector('select[aria-label="Print width"]') as HTMLSelectElement;
  const dpiSel = (c: HTMLElement) => c.querySelector('select[aria-label="DPI"]') as HTMLSelectElement;
  const mmInput = (c: HTMLElement) => c.querySelector('input[aria-label="Print width in millimetres"]') as HTMLInputElement;
  const widthInput = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("input[type=number]")).find((el) => (el as HTMLInputElement).min === "16") as HTMLInputElement;

  it("defaults to sizing in pixels — the mm field only appears once a print width is chosen", () => {
    const { container } = renderGraph();
    expect(printSel(container).value).toBe("px");
    expect(mmInput(container)).toBeNull();
  });

  it("choosing a column width sets the pixel size for that width at the chosen DPI", () => {
    const { container } = renderGraph();
    expect(dpiSel(container).value).toBe("300");
    fireEvent.change(printSel(container), { target: { value: "85" } });
    // 85 mm at 300 DPI = 85/25.4*300 = 1004 px
    expect(Number(widthInput(container).value)).toBe(1004);
    expect(mmInput(container).value).toBe("85");
  });

  it("raising the DPI holds the physical width and adds pixels", () => {
    const { container } = renderGraph();
    fireEvent.change(printSel(container), { target: { value: "174" } });
    const at300 = Number(widthInput(container).value);
    fireEvent.change(dpiSel(container), { target: { value: "600" } });
    const at600 = Number(widthInput(container).value);
    expect(at600).toBe(at300 * 2); // same millimetres, twice the pixels
    expect(mmInput(container).value).toBe("174"); // physical width unchanged
  });

  it("an exact millimetre value can be typed for a journal that wants one", () => {
    const { container } = renderGraph();
    fireEvent.change(printSel(container), { target: { value: "85" } });
    fireEvent.change(mmInput(container), { target: { value: "120" } });
    expect(Number(widthInput(container).value)).toBe(Math.round(120 / 25.4 * 300));
  });

  it("typing a raw pixel width hands control back to pixels", () => {
    const { container } = renderGraph();
    fireEvent.change(printSel(container), { target: { value: "85" } });
    fireEvent.change(dpiSel(container), { target: { value: "custom" } });
    fireEvent.change(widthInput(container), { target: { value: "900" } });
    expect(printSel(container).value).toBe("px");
    expect(mmInput(container)).toBeNull();
  });

  it("reports the resulting print size in mm so the target is checkable", () => {
    const { container } = renderGraph();
    fireEvent.change(printSel(container), { target: { value: "85" } });
    const note = Array.from(container.querySelectorAll(".note")).find((n) => /in print/.test(n.textContent ?? ""));
    // the physical width the user asked for, and the DPI that width actually achieves —
    // not the CSS-relative figure, which answers a different question
    expect(note?.textContent).toMatch(/85\.0 × \d+\.\d mm in print \(300 DPI\)/);
  });
});

describe("ExportDialog — every figure exports at its on-screen geometry", () => {
  // A plain CSS-grid figure (free-drag off, no alignment) must not fall through to the
  // composer's own grid branch, which defaults to 2 columns and is not told the figure's
  // actual `columns` — a 3-column figure would export as 2, and a column span could not be
  // represented at all. Reading the laid-out DOM makes columns, gutter and spans free.
  it("passes on-screen positions for a plain CSS-grid figure, not just the absolute one", () => {
    const grid = document.createElement("div");
    grid.className = "laygrid";
    grid.style.rowGap = "24px";
    for (let i = 0; i < 2; i++) {
      const panel = document.createElement("div");
      panel.className = "laypanel";
      panel.appendChild(panelSvg());
      grid.appendChild(panel);
    }
    document.body.appendChild(grid);
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    const opts = composeCalls.at(-1)!;
    // the composer is driven by real positions — one entry per panel — so it never has to
    // re-derive a grid it does not know the shape of
    expect(Array.isArray(opts.places)).toBe(true);
    expect((opts.places as unknown[]).length).toBe(2);
    // the gutter still rides along as a fallback for when no container can be measured
    expect(opts.gap).toBe(24);
  });

  it("uses neither places nor a gap when there is no figure container to read", () => {
    const s = panelSvg();
    document.body.appendChild(s);
    render(<ExportDialog kind="plot" suggestedName="g" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    expect(composeCalls.at(-1)).toBeUndefined(); // single graph → composer not used at all
  });
});

describe("ExportDialog — the merged figure legend is part of the exported figure", () => {
  /** Panels plus a merged legend, as the assembler renders them. */
  function mountFigureWithLegend(): void {
    const canvas = document.createElement("div");
    canvas.className = "laygrid laycanvas";
    canvas.setAttribute("data-abs", "1");
    for (let i = 0; i < 2; i++) {
      const panel = document.createElement("div");
      panel.className = "laypanel";
      const letter = document.createElement("span");
      letter.className = "laypanel-letter";
      letter.textContent = i === 0 ? "A" : "B";
      panel.appendChild(letter);
      panel.appendChild(panelSvg());
      canvas.appendChild(panel);
    }
    document.body.appendChild(canvas);
    const legend = document.createElement("div");
    legend.className = "layfiglegend";
    legend.appendChild(panelSvg());
    document.body.appendChild(legend);
  }

  it("composes the legend alongside the panels", () => {
    mountFigureWithLegend();
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    const opts = composeCalls.at(-1)!;
    // 2 panels + 1 legend — the legend is not silently dropped from the export
    expect((opts.places as unknown[]).length).toBe(3);
    expect((opts.letters as unknown[]).length).toBe(3);
  });

  it("gives the legend NO panel letter, so lettering stays A/B", () => {
    mountFigureWithLegend();
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    const letters = composeCalls.at(-1)!.letters as Array<{ text: string } | null>;
    expect(letters[0]?.text).toBe("A");
    expect(letters[1]?.text).toBe("B");
    expect(letters[2]).toBeNull(); // the legend is a part, not a panel
  });

  it("keeps svgs / places / letters index-aligned (the composer pairs them by index)", () => {
    mountFigureWithLegend();
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    const opts = composeCalls.at(-1)!;
    const n = (opts.places as unknown[]).length;
    expect((opts.letters as unknown[]).length).toBe(n);
    // and the panel count the composer was handed matches too
    expect(document.querySelectorAll(".laypanel, .layfiglegend")).toHaveLength(n);
  });

  it("a figure with no merged legend is unaffected", () => {
    mountFigureDom(2);
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    expect((composeCalls.at(-1)!.places as unknown[]).length).toBe(2);
  });
});

describe("ExportDialog — hover values in the interactive HTML page", () => {
  const renderGraph = (onExport: (p: { format: string; text?: string }) => Promise<void>) => {
    document.body.appendChild(panelSvg());
    return render(<ExportDialog kind="plot" source="graph" suggestedName="g" onExport={onExport as never} onCancel={() => {}} />);
  };
  const pickHtml = (c: HTMLElement) =>
    fireEvent.change(c.querySelector('select[aria-label="Format"]') as HTMLSelectElement, { target: { value: "html" } });
  const hoverBox = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("label")).find((l) => /Show values on hover/.test(l.textContent ?? ""))?.querySelector("input") as HTMLInputElement | undefined;

  it("offers 'Show values on hover' with an interactive HTML page only, on by default, and it reaches the file", async () => {
    const got: string[] = [];
    const { container } = renderGraph(async (p) => { got.push(p.text ?? ""); });
    expect(hoverBox(container), "offered before HTML is chosen").toBeUndefined();
    pickHtml(container);
    const box = hoverBox(container);
    expect(box, "no 'Show values on hover' box").toBeTruthy();
    expect(box!.checked).toBe(true);
    await clickExport(container);
    expect(got.at(-1)).toContain("mady-fig");
    expect(got.at(-1)).not.toContain('data-mady-hover="off"');
    fireEvent.click(box!);
    await clickExport(container);
    expect(got.at(-1)).toContain('data-mady-hover="off"');
    // Unticking Interactive takes the hover box with it (a static page has no hover at all).
    const interactive = Array.from(container.querySelectorAll("label")).find((l) => /Interactive/.test(l.textContent ?? ""))!.querySelector("input")!;
    fireEvent.click(interactive);
    expect(hoverBox(container)).toBeUndefined();
  });

  it("starts from the Settings choice", async () => {
    const { setAppDefaults } = await import("./profile");
    setAppDefaults({ exportHoverValues: false });
    const { container } = renderGraph(async () => {});
    pickHtml(container);
    expect(hoverBox(container)!.checked).toBe(false);
    setAppDefaults({ exportHoverValues: undefined });
  });
});

describe("ExportDialog — starts from the graph's print size", () => {
  const renderWith = (printWidthMm: number | undefined) => {
    document.body.appendChild(panelSvg());
    return render(<ExportDialog kind="plot" source="graph" suggestedName="g" printWidthMm={printWidthMm} onExport={() => Promise.resolve()} onCancel={() => {}} />);
  };
  const printSel = (c: HTMLElement) => c.querySelector('select[aria-label="Print width"]') as HTMLSelectElement | null;

  it("a graph set to 1 column opens at 85 mm, 1004 px wide at 300 DPI — the whole drawing scaled", () => {
    const { container } = renderWith(85);
    expect(printSel(container)?.value).toBe("85");
    const mm = container.querySelector('input[aria-label="Print width in millimetres"]') as HTMLInputElement;
    expect(mm.value).toBe("85");
    expect(container.textContent).toContain("1004");
  });

  it("a page width that is not a column width is offered as the graph's own print size", () => {
    const { container } = renderWith(154);
    const sel = printSel(container)!;
    expect(sel.value).toBe("154");
    expect(Array.from(sel.options).find((o) => o.value === "154")?.textContent).toMatch(/154 mm/);
  });

  it("no print size: pixels", () => {
    expect(printSel(renderWith(undefined).container)?.value).toBe("px");
  });
});

// A figure laid out on a page exports as the page. The assembler
// stamps the page (canvas px) on the canvas; the dialog must hand it to the composer — and pass no
// `page` key at all without one, so a figure with no page composes as a plain figure.
describe("ExportDialog — the figure's page", () => {
  it("passes the page stamped on the canvas", () => {
    mountFigureDom(2);
    const cv = document.querySelector(".laycanvas") as HTMLElement;
    cv.dataset.pageW = "794";
    cv.dataset.pageH = "1123";
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    expect((composeCalls.at(-1) as { page?: unknown }).page).toEqual({ w: 794, h: 1123 });
  });
  it("passes no page key without one", () => {
    mountFigureDom(2);
    render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={() => {}} />);
    expect("page" in composeCalls.at(-1)!).toBe(false);
  });
  it("a figure's page width that is not a column is offered by name", () => {
    mountFigureDom(2);
    const { container } = render(<ExportDialog kind="plot" source="figure" suggestedName="fig" printWidthMm={210} onExport={() => Promise.resolve()} onCancel={() => {}} />);
    const sel = container.querySelector('select[aria-label="Print width"]') as HTMLSelectElement;
    expect(sel.value).toBe("210");
    expect(Array.from(sel.options).find((o) => o.value === "210")?.textContent).toBe("This figure's page width — 210 mm");
  });
});
