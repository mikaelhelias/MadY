// @vitest-environment jsdom
// Word-level bold / italic / colour: `*{bold}`, `/{italic}`, `#{colour|words}`, the same
// braced rule as `^{…}` — a marker counts only when `{` follows and a `}` closes it, otherwise every character is literal
// (data labels like "mg/L", "asv_1000", "** p<0.01" must never change). Flat: no nesting.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure, RichText, parseRich } from "./PlotFigure";
import { WordStyleButtons } from "./panes";
import { galleryItems } from "./gallery";

afterEach(cleanup);

describe("parseRich: bold, italic and colour markers", () => {
  it("*{…} bold, /{…} italic, #{colour|…} colour", () => {
    expect(parseRich("a *{bold} b")).toEqual([
      { text: "a ", shift: "normal" },
      { text: "bold", shift: "normal", bold: true },
      { text: " b", shift: "normal" },
    ]);
    expect(parseRich("/{it}")).toEqual([{ text: "it", shift: "normal", italic: true }]);
    expect(parseRich("#{c0392b|red words}")).toEqual([{ text: "red words", shift: "normal", color: "#c0392b" }]);
    expect(parseRich("#{#00f|x}")).toEqual([{ text: "x", shift: "normal", color: "#00f" }]);
    expect(parseRich("#{red|x}")).toEqual([{ text: "x", shift: "normal", color: "red" }]);
  });
  it("mixes with super / subscript", () => {
    expect(parseRich("cm^{2} *{n}")).toEqual([
      { text: "cm", shift: "normal" },
      { text: "2", shift: "super" },
      { text: " ", shift: "normal" },
      { text: "n", shift: "normal", bold: true },
    ]);
  });
  it("everything else stays literal, character for character", () => {
    for (const s of ["***", "** p<0.01", "mg/L", "10^3", "asv_1000", "*{ dangling", "#{no pipe}", "#{not a colour!|x}", "a/b/c", "#hashtag", "x*y"]) {
      expect(parseRich(s), s).toEqual([{ text: s, shift: "normal" }]);
    }
  });
});

describe("the drawing", () => {
  const svg = (text: string): string => renderToStaticMarkup(createElement("svg", null, createElement("text", null, createElement(RichText, { text }))));
  it("a bold / italic / coloured run is a <tspan> carrying its style", () => {
    const m = svg("p *{< 0.01} in /{E. coli} #{c0392b|up}");
    expect(m).toMatch(/<tspan font-weight="700">&lt; 0.01<\/tspan>/);
    expect(m).toMatch(/<tspan font-style="italic">E. coli<\/tspan>/);
    expect(m).toMatch(/<tspan fill="#c0392b">up<\/tspan>/);
  });
  it("text without markers is the plain string (no <tspan>)", () => {
    expect(svg("Dose (uM)")).toBe("<svg><text>Dose (uM)</text></svg>");
  });

  const SIZE = { width: 620, height: 420 };
  const bar = (): { plot: Plot; table: DataTable } => {
    const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "bar")!;
    return { plot: g.plot as Plot, table: g.table as DataTable };
  };
  const draw = (plot: Plot, table: DataTable): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, plot, SIZE) }));
  it("reaches the graph title, a category name, a text, a box label, an arrow caption and a callout", () => {
    const { plot, table } = bar();
    const catCol = table.columns.find((c) => c.role === "x")!.id;
    const t2: DataTable = { ...table, rows: table.rows.map((r, i) => (i === 0 ? { ...r, cells: { ...r.cells, [catCol]: `*{${String(r.cells[catCol])}}` } } : r)) };
    const anns = [
      { id: "t", kind: "text", label: "a /{text}", x: 0.5, y: 0.2 },
      { id: "b", kind: "rect", label: "a #{c0392b|box}", x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      { id: "ar", kind: "arrow", label: "an *{arrow}", x: 0.2, y: 0.8, x2: 0.6, y2: 0.8 },
      { id: "c", kind: "callout", label: "a /{callout}", x: 0.2, y: 0.3, x2: 0.5, y2: 0.5 },
    ] as Annotation[];
    const m = draw({ ...plot, title: "Title *{bold}", annotations: anns } as Plot, t2);
    expect(m).toMatch(/<tspan font-weight="700">bold<\/tspan>/); // title
    expect(m).toMatch(/<tspan font-weight="700">[^<]+<\/tspan>[\s\S]*font-style="italic">text</); // a category name, then the text
    expect(m).toMatch(/<tspan fill="#c0392b">box<\/tspan>/);
    expect(m).toMatch(/<tspan font-weight="700">arrow<\/tspan>/);
    expect(m).toMatch(/<tspan font-style="italic">callout<\/tspan>/);
  });
  it("a plain box label, arrow caption and callout draw no <tspan>", () => {
    const { plot, table } = bar();
    const anns = [
      { id: "b", kind: "rect", label: "plain box", x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      { id: "ar", kind: "arrow", label: "plain arrow", x: 0.2, y: 0.8, x2: 0.6, y2: 0.8 },
      { id: "c", kind: "callout", label: "plain callout", x: 0.2, y: 0.3, x2: 0.5, y2: 0.5 },
    ] as Annotation[];
    const m = draw({ ...plot, annotations: anns } as Plot, table);
    for (const w of ["plain box", "plain arrow", "plain callout"]) expect(m, w).toMatch(new RegExp(`>${w}</text>`));
  });
});

describe("the ribbon's word buttons wrap the selected words of the text being edited", () => {
  const editing = (value: string, s: number, e: number): HTMLTextAreaElement => {
    const wrap = document.createElement("div");
    wrap.className = "gfx-figwrap";
    const ta = document.createElement("textarea");
    ta.value = value;
    wrap.appendChild(ta);
    document.body.appendChild(wrap);
    ta.focus();
    ta.setSelectionRange(s, e);
    return ta;
  };
  afterEach(() => { document.body.innerHTML = ""; });
  it("Bold words", () => {
    const ta = editing("p < 0.01 here", 0, 8);
    const { container } = render(<WordStyleButtons />);
    fireEvent.click(container.querySelector('button[title^="Bold the selected words"]')!);
    expect(ta.value).toBe("*{p < 0.01} here");
  });
  it("Italic words", () => {
    const ta = editing("in E. coli cells", 3, 10);
    const { container } = render(<WordStyleButtons />);
    fireEvent.click(container.querySelector('button[title^="Italicise the selected words"]')!);
    expect(ta.value).toBe("in /{E. coli} cells");
  });
  it("Colour words: a swatch wraps them in that colour", () => {
    const ta = editing("up and down", 0, 2);
    const { container } = render(<WordStyleButtons />);
    fireEvent.click(container.querySelector('button[title^="Colour the selected words"]')!);
    const swatches = [...container.querySelectorAll<HTMLButtonElement>("button[data-word-colour]")].map((b) => b.dataset.wordColour);
    expect(new Set(swatches).size, "a colour is offered twice").toBe(swatches.length);
    const sw = container.querySelector<HTMLButtonElement>("button[data-word-colour]")!;
    fireEvent.click(sw);
    expect(ta.value).toBe(`#{${sw.dataset.wordColour}|up} and down`);
  });
});
