// @vitest-environment jsdom
/**
 * The Data-menu dialogs' previews follow a linked datasheet that refreshes while they are open.
 *
 * A linked-file refresh rewrites the datasheet object in place, so a list memoised on that
 * object would keep showing the old numbers; the previews must read the live sheet. The
 * dialogs are modal: a linked file re-saved on disk is the one way the data changes under them.
 * (Create is unaffected: every confirm rebuilds the new sheet from the live original.)
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

const BEFORE = "X,Y\n1,2\n2,4\n3,6\n4,8\n5,10\n6,12\n";
const AFTER = "X,Y\n1,31\n2,47\n3,59\n4,73\n5,89\n6,97\n";

function linkedProject(): string {
  const doc = new MadyDocument();
  const t = doc.addTable("Linked", "xy", ["X", "Y"]);
  for (const line of BEFORE.trim().split("\n").slice(1)) doc.addRow(t.id, line.split(",").map(Number));
  const p = doc.toJSON();
  p.tables[0]!.linkedSource = { path: "C:\\data.csv", delimiter: ",", header: true };
  return JSON.stringify(p);
}

const DIALOGS = [
  "Transform values…",
  "Row statistics…",
  "Frequency distribution…",
  "Normal probability (QQ) plot…",
  "Remove baseline & column math…",
  "Prune rows…",
  "Extract & rearrange columns…",
  "Transpose rows and columns…",
  "Reshape data (wide ↔ long)…",
];

describe("Data dialogs follow a linked sheet that refreshes while they are open", () => {
  it.each(DIALOGS)("%s", async (item) => {
    let fire: ((path: string) => void) | undefined;
    let fileText = BEFORE;
    W.mady = {
      openFile: () => Promise.resolve({ ok: true, kind: "project", path: "p.mady", json: linkedProject() }),
      onLinkedChanged: (cb: (path: string) => void) => { fire = cb; return () => {}; },
      readLinked: () => Promise.resolve({ ok: true, text: fileText }),
      watchLinked: () => Promise.resolve({ ok: true }),
      unwatchLinked: () => Promise.resolve({ ok: true }),
    };
    const { container: c } = render(<AppShell />);
    await act(async () => { fireEvent.click(within(c).getByTitle(/^Open a project/)); });
    expect(c.querySelector(".canvas .dg"), "the linked sheet did not open").toBeTruthy();

    const before = new Set([...c.querySelectorAll("[role=dialog]")]);
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Data"));
    fireEvent.click(within(c).getByText(item));
    const dialog = [...c.querySelectorAll("[role=dialog]")].find((d) => !before.has(d)) as HTMLElement | undefined;
    expect(dialog, `${item} did not open a dialog`).toBeTruthy();
    const shown = dialog!.textContent ?? "";
    expect(shown, "fixture: the dialog must not already show the new numbers").not.toMatch(/97|89|73/);

    fileText = AFTER;
    await act(async () => { fire!("C:\\data.csv"); await Promise.resolve(); });
    expect(dialog!.isConnected, "the dialog closed").toBe(true);
    expect(dialog!.textContent, "the preview did not change after the linked file changed").not.toBe(shown);
  });
});
