// @vitest-environment jsdom
/**
 * A figure open in front with no panel picked: File ▸ Print hands over the whole figure, every panel, not the graph
 * whose tab was open behind the figure page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  delete (window as unknown as { mady?: unknown }).mady;
});

const xyTable = (n: number) => ({
  id: `tbl_${n}`, kind: "xy", name: `Data ${n}`,
  columns: [{ id: `x${n}`, name: "X", role: "x" }, { id: `y${n}`, name: "Y", role: "y" }],
  rows: [1, 2, 3, 4].map((v) => ({ id: `r${n}_${v}`, cells: { [`x${n}`]: v, [`y${n}`]: v * n } })),
});
const xyPlot = (n: number, title: string) => ({ id: `plt_${n}`, name: `Graph ${n}`, source: `tbl_${n}`, status: "ok", styleOverrides: {}, kind: "xy", title });
const PROJECT = {
  schemaVersion: 5,
  tables: [xyTable(1), xyTable(2)],
  plots: [xyPlot(1, "Alpha panel"), xyPlot(2, "Beta panel")],
  analyses: [], log: [],
  layouts: [{ id: "lay_1", name: "Two panels", panels: ["plt_1", "plt_2"], columns: 2, showPanelTitles: true }],
  workspace: { folders: [], loose: [{ kind: "table", id: "tbl_1" }, { kind: "table", id: "tbl_2" }, { kind: "plot", id: "plt_1" }, { kind: "plot", id: "plt_2" }, { kind: "layout", id: "lay_1" }] },
};

const menu = (container: HTMLElement, name: string, item: RegExp): void => {
  const top = within(container.querySelector(".menubar") as HTMLElement).getByText(name);
  fireEvent.click(top);
  // A click on a menu that is already open closes it: open it again.
  if (!container.ownerDocument.querySelector(".dropdown")) fireEvent.click(top);
  const dd = container.ownerDocument.querySelector<HTMLElement>(".dropdown");
  if (!dd) throw new Error(`no ${name} menu opened; menubar: ${container.querySelector(".menubar")?.outerHTML.slice(0, 600)}`);
  fireEvent.click(within(dd).getByText(item));
};
const openInTree = async (container: HTMLElement, label: string): Promise<void> => {
  const btn = await waitFor(() => {
    const b = [...container.querySelectorAll<HTMLElement>("button.navlabelbtn")].find((x) => x.textContent?.trim() === label);
    expect(b, `no "${label}" in the project tree`).toBeTruthy();
    return b!;
  });
  fireEvent.click(btn);
};

describe("File ▸ Print with a figure in front", () => {
  it("prints the figure with both panels, not the graph whose tab sits behind it", async () => {
    const printFigure = vi.fn(async () => ({ ok: true }));
    (window as unknown as { mady: unknown }).mady = {
      setDirty: vi.fn(), autosaveWrite: vi.fn(async () => ({ ok: true })), autosaveRecovered: vi.fn(async () => null), autosaveClear: vi.fn(async () => ({ ok: true })),
      listRecents: vi.fn(async () => []),
      openFile: vi.fn(async () => ({ ok: true, kind: "project", path: "C:/x/fig.mady", json: JSON.stringify(PROJECT) })),
      printFigure,
    };
    const { container } = render(<AppShell />);
    const mady = (window as unknown as { mady: { autosaveRecovered: ReturnType<typeof vi.fn> } }).mady;
    await waitFor(() => expect(mady.autosaveRecovered).toHaveBeenCalled());
    menu(container, "File", /^Open…/);
    // A graph tab first, then the figure over it — the order a user works in.
    await openInTree(container, "Graph 1");
    await waitFor(() => expect(container.querySelector("svg.gfx-figure")).toBeTruthy());
    await openInTree(container, "Two panels");
    const arrange = await waitFor(() => {
      const t = [...container.querySelectorAll<HTMLElement>(".layoutview-tab")].find((x) => x.textContent?.trim() === "Arrange");
      expect(t, "the figure page did not open").toBeTruthy();
      return t!;
    });
    fireEvent.click(arrange);
    await waitFor(() => expect(container.querySelectorAll(".laygrid svg.gfx-figure, .laycanvas svg.gfx-figure").length).toBe(2));
    menu(container, "File", /^Print/);
    await waitFor(() => expect(printFigure).toHaveBeenCalled());
    const printed = (printFigure.mock.calls[0] as unknown as [{ svg?: string }])[0].svg ?? "";
    expect(printed, "the first panel is in the print").toContain("Alpha panel");
    expect(printed, "the second panel is in the print — not only the graph behind the figure").toContain("Beta panel");
  }, 60_000);
});
