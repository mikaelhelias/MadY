// @vitest-environment jsdom
/**
 * The Analyze dialog's recommendations follow the data while the dialog is open.
 *
 * The list cannot be memoised on `doc.toJSON()`, which is the same object after every
 * edit. The dialog is modal, so the one way the data changes under it is a datasheet linked to a
 * file on disk: the file is re-saved elsewhere and the sheet refreshes by itself. Here the file
 * goes from evenly spaced X to log-spaced dose-like X; the dose-response advice must appear.
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

const LINEAR = "X,Y\n1,2\n2,4\n3,6\n4,8\n5,10\n6,12\n";
const DOSE = "X,Y\n0.001,2\n0.01,5\n0.1,20\n1,60\n10,90\n100,98\n";

function linkedProject(): string {
  const doc = new MadyDocument();
  const t = doc.addTable("Linked", "xy", ["X", "Y"]);
  for (const line of LINEAR.trim().split("\n").slice(1)) doc.addRow(t.id, line.split(",").map(Number));
  doc.addPlot("Linked graph", t.id);
  const p = doc.toJSON();
  p.tables[0]!.linkedSource = { path: "C:\\data.csv", delimiter: ",", header: true };
  return JSON.stringify(p);
}

describe("Analyze dialog recommendations", () => {
  it("refresh when a linked datasheet changes while the dialog is open", async () => {
    let fire: ((path: string) => void) | undefined;
    let fileText = LINEAR;
    W.mady = {
      openFile: () => Promise.resolve({ ok: true, kind: "project", path: "p.mady", json: linkedProject() }),
      onLinkedChanged: (cb: (path: string) => void) => { fire = cb; return () => {}; },
      readLinked: () => Promise.resolve({ ok: true, text: fileText }),
      watchLinked: () => Promise.resolve({ ok: true }),
      unwatchLinked: () => Promise.resolve({ ok: true }),
      saveProject: () => Promise.resolve({ ok: true, path: "x" }),
    };
    const { container: c } = render(<AppShell />);
    await act(async () => { fireEvent.click(within(c).getByTitle(/^Open a project/)); });
    expect(c.querySelector(".canvas svg.gfx-figure"), "the linked project did not open on its graph").toBeTruthy();

    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Analyze"));
    fireEvent.click(within(c).getByText("Analyze…"));
    const dialog = () => c.querySelector('[role="dialog"][aria-label="Analyze"]') as HTMLElement;
    expect(dialog()).toBeTruthy();
    const DOSE_ADVICE = /dose-response fit may be useful/;
    expect(dialog().textContent, "fixture: evenly spaced X must not already get dose-response advice").not.toMatch(DOSE_ADVICE);

    fileText = DOSE;
    await act(async () => { fire!("C:\\data.csv"); await Promise.resolve(); });
    expect(dialog(), "the dialog closed").toBeTruthy();
    expect(dialog().textContent, "the recommendations did not refresh after the linked file changed").toMatch(DOSE_ADVICE);
  });
});
