// @vitest-environment jsdom
/**
 * Undo that removes a sheet (a Data dialog made it) closes that sheet's tab and goes back to the tab you were on.
 *
 * A tab whose sheet is gone has nothing to show: left open, it was titled "Data" and drew another sheet of the
 * project in its place, so after Undo the user looked at a sheet they had not opened. The same holds for a graph
 * removed by Undo, and for Back to a tab whose sheet is gone.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import { AppShell } from "./AppShell";

const W = window as unknown as { mady?: Record<string, unknown> };
afterEach(() => {
  cleanup();
  delete W.mady;
  globalThis.localStorage?.clear();
});

function project(): string {
  const doc = new MadyDocument();
  const t = doc.addTable("Mine", "xy", ["X", "Y"]);
  for (let i = 1; i <= 6; i++) doc.addRow(t.id, [i, i * 3]);
  const o = doc.addTable("Other", "xy", ["X", "Y"]);
  doc.addRow(o.id, [1, 1]);
  return JSON.stringify(doc.toJSON());
}

const tabs = (c: HTMLElement): string[] => [...c.querySelectorAll(".tab[title*='to close']")].map((t) => t.textContent?.trim() ?? "");
const front = (c: HTMLElement): string | undefined => c.querySelector(".tab.on[title*='to close']")?.textContent?.trim();

describe("Undo of a Data dialog that made a sheet", () => {
  it("closes the new sheet's tab and shows the sheet the dialog was opened on", async () => {
    W.mady = { openFile: () => Promise.resolve({ ok: true, kind: "project", path: "p.mady", json: project() }) };
    const { container: c } = render(<AppShell />);
    await act(async () => { fireEvent.click(within(c).getByTitle(/^Open a project/)); });
    expect(front(c), "fixture: the project opens on its first sheet").toMatch(/^Mine/);

    const before = new Set([...c.querySelectorAll("[role=dialog]")]);
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Data"));
    fireEvent.click(within(c).getByText("Transform values…"));
    const dialog = [...c.querySelectorAll("[role=dialog]")].find((d) => !before.has(d)) as HTMLElement;
    fireEvent.click(within(dialog).getByText("Create dataset"));
    expect(front(c), "fixture: the new sheet opens in front").toMatch(/^Mine \(/);

    (document.activeElement as HTMLElement | null)?.blur?.();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(c.querySelector(".tab.on"), "fixture: Ctrl+Z did nothing").toBeTruthy();
    expect(tabs(c).some((t) => /^Mine \(/.test(t)), "the removed sheet's tab is still open").toBe(false);
    expect(tabs(c).some((t) => /^Data/.test(t)), "a tab with no sheet is left open").toBe(false);
    expect(front(c)).toMatch(/^Mine/);

    // Back steps over the removed sheet instead of reopening its tab.
    for (let k = 0; k < 3; k++) fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    expect(tabs(c).some((t) => /^Data|^Mine \(/.test(t)), "Back reopened the removed sheet's tab").toBe(false);
  });
});
