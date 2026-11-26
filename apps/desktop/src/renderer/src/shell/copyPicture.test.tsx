// @vitest-environment jsdom
// Graph ▸ Copy as picture — the usual way to put a graph on a slide or in a document, reachable from the Graph
// menu, Ctrl+Shift+C and the graph's right-click menu, as well as from the two copy buttons
// inside the Export dialog.
//
// Three things must hold: the command exists and its shortcut resolves (and Ctrl+C alone still
// belongs to the spreadsheet); the copy puts the same picture on the clipboard the Export dialog
// would start with; and the graph's right-click menu never steals a right-click that an
// annotation's own menu owns.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createSampleDocument } from "@mady/core";
import { buildActions, catalogueHandlers, matchShortcut } from "./actions";
import { copyAsPicture, copyAsSvg } from "./copyPicture";
import { defaultExportSize } from "./exportSize";
import { GraphPane } from "./panes";

afterEach(cleanup);

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "", target: null, ...over }) as KeyboardEvent;

describe("the command", () => {
  it("sits in the Graph menu, resolves Ctrl+Shift+C, and leaves Ctrl+C to the spreadsheet", () => {
    const actions = buildActions(catalogueHandlers());
    const copy = actions.find((a) => a.id === "copy-picture");
    expect(copy?.menu).toBe("Graph");
    expect(copy?.shortcut).toBe("Ctrl+Shift+C");
    expect(matchShortcut(actions, ev({ ctrlKey: true, shiftKey: true, key: "C" }))?.id).toBe("copy-picture");
    expect(matchShortcut(actions, ev({ ctrlKey: true, key: "c" }))).toBeUndefined();
    expect(actions.find((a) => a.id === "copy-svg")?.menu).toBe("Graph");
  });
  it("is disabled when nothing is in front", () => {
    const actions = buildActions({ ...catalogueHandlers(), canCopyPicture: false });
    expect(actions.find((a) => a.id === "copy-picture")?.enabled).toBe(false);
    expect(actions.find((a) => a.id === "copy-svg")?.enabled).toBe(false);
    expect(matchShortcut(actions, ev({ ctrlKey: true, shiftKey: true, key: "C" }))).toBeUndefined();
  });
});

describe("the copy", () => {
  const source = { svg: "<svg/>", width: 600, height: 100 };
  it("rasterizes at the Export dialog's starting size onto a white page and hands the PNG to the clipboard", async () => {
    const raster = vi.fn(() => Promise.resolve("PNG64"));
    const put = vi.fn();
    const r = await copyAsPicture({ source, displayScale: 0.5, bridge: { copyImageToClipboard: put }, raster });
    expect(r).toBe("copied");
    const { width, height } = defaultExportSize({ w: 600, h: 100, displayScale: 0.5, dpi: 300 });
    expect(raster).toHaveBeenCalledWith("<svg/>", width, height, "white");
    expect(put).toHaveBeenCalledWith("PNG64");
  });
  it("honours the graph's own print width", async () => {
    const raster = vi.fn(() => Promise.resolve("PNG64"));
    await copyAsPicture({ source, printWidthMm: 85, bridge: { copyImageToClipboard: vi.fn() }, raster });
    const { width, height } = defaultExportSize({ w: 600, h: 100, printWidthMm: 85, dpi: 300 });
    expect(raster).toHaveBeenCalledWith("<svg/>", width, height, "white");
  });
  it("says why when it cannot copy — no drawing, or no clipboard bridge (the preview)", async () => {
    const raster = vi.fn(() => Promise.resolve("PNG64"));
    expect(await copyAsPicture({ source: null, bridge: { copyImageToClipboard: vi.fn() }, raster })).toBe("no-source");
    expect(await copyAsPicture({ source, bridge: undefined, raster })).toBe("no-bridge");
    expect(raster).not.toHaveBeenCalled();
  });
  it("Copy as SVG hands the markup itself to the clipboard", () => {
    const put = vi.fn();
    expect(copyAsSvg({ source, bridge: { copyTextToClipboard: put } })).toBe("copied");
    expect(put).toHaveBeenCalledWith("<svg/>");
    expect(copyAsSvg({ source, bridge: {} })).toBe("no-bridge");
  });
});

describe("the graph's right-click menu", () => {
  const pane = (extra: Record<string, unknown> = {}) => {
    const doc = createSampleDocument();
    const plot = doc.toJSON().plots[0]!;
    doc.addAnnotation(plot.id, { kind: "text", label: "Note", x: 0.5, y: 0.2 });
    const onCopyPicture = vi.fn();
    const onCopySvg = vi.fn();
    const onExport = vi.fn();
    const r = render(<GraphPane project={doc.toJSON()} plotId={plot.id} onCopyPicture={onCopyPicture} onCopySvg={onCopySvg} onExport={onExport} {...extra} />);
    return { ...r, onCopyPicture, onCopySvg, onExport };
  };
  const graphMenu = (c: HTMLElement) => c.querySelector('[role="menu"][aria-label="Graph"]');

  it("opens on a right-click on the graph and runs the copy", () => {
    const { container, onCopyPicture } = pane();
    expect(graphMenu(container)).toBeNull();
    fireEvent.contextMenu(container.querySelector(".graphzoom")!);
    const menu = graphMenu(container);
    expect(menu).not.toBeNull();
    const item = [...menu!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Copy as picture");
    expect(item).toBeDefined();
    fireEvent.click(item!);
    expect(onCopyPicture).toHaveBeenCalledTimes(1);
    expect(graphMenu(container)).toBeNull();
  });

  it("offers Copy as SVG and Export…", () => {
    const { container, onCopySvg, onExport } = pane();
    fireEvent.contextMenu(container.querySelector(".graphzoom")!);
    const labels = [...graphMenu(container)!.querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Copy as picture", "Copy as SVG", "Export…"]);
    fireEvent.click([...graphMenu(container)!.querySelectorAll("button")][1]!);
    expect(onCopySvg).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(container.querySelector(".graphzoom")!);
    fireEvent.click([...graphMenu(container)!.querySelectorAll("button")][2]!);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { container } = pane();
    fireEvent.contextMenu(container.querySelector(".graphzoom")!);
    expect(graphMenu(container)).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(graphMenu(container)).toBeNull();
  });

  it("an annotation's own right-click menu keeps winning", () => {
    const { container } = pane({ onDeleteAnnotation: vi.fn() });
    const text = container.querySelector("[data-ann-text]");
    expect(text, "the sample plot draws no text annotation").not.toBeNull();
    fireEvent.contextMenu(text!);
    expect(container.querySelector(".gfx-annmenu-del"), "the annotation menu did not open").not.toBeNull();
    expect(graphMenu(container)).toBeNull();
  });

  it("does nothing without a handler to run", () => {
    const doc = createSampleDocument();
    const plot = doc.toJSON().plots[0]!;
    const { container } = render(<GraphPane project={doc.toJSON()} plotId={plot.id} />);
    fireEvent.contextMenu(container.querySelector(".graphzoom")!);
    expect(graphMenu(container)).toBeNull();
  });
});
