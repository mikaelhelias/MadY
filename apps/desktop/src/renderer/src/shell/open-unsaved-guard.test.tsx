// @vitest-environment jsdom
/**
 * Opening a project replaces the one that is open, and Undo cannot bring it back. So the
 * program asks first, everywhere: with unsaved changes, every way of opening a project —
 * File ▸ Open, a recent file, a dropped file, a double-clicked `.mady` — asks Save / Don't Save
 * / Cancel first, so none of the four replaces unsaved work without a word.
 *
 * Also here: a double-clicked `.mady` reaches the renderer (the file MadY was started with, and
 * one sent to a MadY already open), and it waits for the crash-recovery question.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import { AppShell } from "./AppShell";

const W = window as unknown as { mady?: Record<string, unknown> };
afterEach(() => {
  cleanup();
  delete W.mady;
  globalThis.localStorage?.clear();
  vi.restoreAllMocks();
});

/** A saved project whose sheet name appears nowhere else, so "was it opened" is one text check. */
function savedProject(): string {
  const doc = new MadyDocument();
  const t = doc.addTable("Opened-From-Disk", "xy", ["X", "Y"]);
  doc.addRow(t.id, [1, 2]);
  return JSON.stringify(doc.toJSON());
}
const PROJECT = { ok: true, kind: "project", path: "C:\\d\\other.mady", json: savedProject() };

type Choice = "save" | "discard" | "cancel";
function install(choice: Choice, extra: Record<string, unknown> = {}) {
  const bridge = {
    openFile: vi.fn(() => Promise.resolve(PROJECT)),
    openPath: vi.fn(() => Promise.resolve(PROJECT)),
    askUnsaved: vi.fn(() => Promise.resolve(choice)),
    saveProject: vi.fn(() => Promise.resolve({ ok: true, path: "C:\\d\\mine.mady" })),
    ...extra,
  };
  W.mady = bridge;
  return bridge;
}

const opened = (c: HTMLElement): boolean => (c.textContent ?? "").includes("Opened-From-Disk");

/** A real edit: Insert ▸ New datasheet (XY) adds a datasheet of the user's own. Only work of the
 *  user's own counts as unsaved; changes to the demo project MadY opens with do not. */
async function edit(c: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Insert")); });
  await act(async () => { fireEvent.click(within(c.querySelector(".dropdown") as HTMLElement).getByText("New datasheet (XY)")); });
}
async function pressOpen(c: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(within(c).getByTitle(/^Open a project/)); });
}

describe("opening a project over unsaved work asks first", () => {
  it("nothing unsaved: opens straight away, no question", async () => {
    const m = install("cancel");
    const { container: c } = render(<AppShell />);
    await pressOpen(c);
    expect(m.askUnsaved).not.toHaveBeenCalled();
    expect(opened(c)).toBe(true);
  });

  it("unsaved + Cancel: the open project stays, the other is not opened", async () => {
    const m = install("cancel");
    const { container: c } = render(<AppShell />);
    await edit(c);
    const before = c.querySelector(".tree")?.textContent ?? c.textContent;
    await pressOpen(c);
    expect(m.askUnsaved).toHaveBeenCalledTimes(1);
    expect(opened(c)).toBe(false);
    expect(c.querySelector(".tree")?.textContent ?? c.textContent).toBe(before);
  });

  it("unsaved + Don't Save: the other project opens, nothing is saved", async () => {
    const m = install("discard");
    const { container: c } = render(<AppShell />);
    await edit(c);
    await pressOpen(c);
    expect(m.askUnsaved).toHaveBeenCalledTimes(1);
    expect(m.saveProject).not.toHaveBeenCalled();
    expect(opened(c)).toBe(true);
  });

  it("unsaved + Save: the open project is saved first, then the other opens", async () => {
    const order: string[] = [];
    const m = install("save", {
      saveProject: vi.fn(() => { order.push("save"); return Promise.resolve({ ok: true, path: "C:\\d\\mine.mady" }); }),
    });
    const { container: c } = render(<AppShell />);
    await edit(c);
    await pressOpen(c);
    await waitFor(() => expect(opened(c)).toBe(true));
    expect(m.saveProject).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["save"]);
  });

  it("unsaved + Save, then the Save dialog is cancelled: nothing is replaced", async () => {
    install("save", { saveProject: vi.fn(() => Promise.resolve({ ok: false, canceled: true })) });
    const { container: c } = render(<AppShell />);
    await edit(c);
    await pressOpen(c);
    expect(opened(c)).toBe(false);
  });

  it("a recent file goes through the same question", async () => {
    const m = install("cancel", { recentFiles: () => Promise.resolve([{ path: "C:\\d\\other.mady", name: "other.mady" }]) });
    const { container: c } = render(<AppShell />);
    await edit(c);
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("File"));
    const recent = await within(c).findByTitle("C:\\d\\other.mady");
    await act(async () => { fireEvent.click(recent); });
    expect(m.openPath).toHaveBeenCalledWith("C:\\d\\other.mady");
    expect(m.askUnsaved).toHaveBeenCalledTimes(1);
    expect(opened(c)).toBe(false);
  });

  it("a file dropped on the window goes through the same question", async () => {
    const m = install("cancel", { getPathForFile: () => "C:\\d\\other.mady" });
    const { container: c } = render(<AppShell />);
    await edit(c);
    await act(async () => {
      fireEvent.drop(c.querySelector(".app") as Element, { dataTransfer: { files: [new File(["{}"], "other.mady")] } });
    });
    expect(m.openPath).toHaveBeenCalledWith("C:\\d\\other.mady");
    expect(m.askUnsaved).toHaveBeenCalledTimes(1);
    expect(opened(c)).toBe(false);
  });

  it("a data file imports into the open project: no question, the unsaved work stays", async () => {
    const m = install("cancel", {
      openFile: vi.fn(() => Promise.resolve({ ok: true, kind: "import", source: "text", name: "t", path: "C:\\t.csv", text: "a,b\n1,2\n" })),
    });
    const { container: c } = render(<AppShell />);
    await edit(c);
    await pressOpen(c);
    expect(m.askUnsaved).not.toHaveBeenCalled();
  });

  it("a file that is not a valid project never asks about the open one", async () => {
    const m = install("discard", { openFile: vi.fn(() => Promise.resolve({ ok: true, kind: "project", path: "x.mady", json: "not json" })) });
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container: c } = render(<AppShell />);
    await edit(c);
    await pressOpen(c);
    expect(m.askUnsaved).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledTimes(1);
  });
});

describe("a double-clicked .mady reaches the renderer", () => {
  it("MadY started by the double-click opens that file", async () => {
    const launchFile = vi.fn(() => Promise.resolve("C:\\d\\other.mady"));
    const m = install("cancel", { launchFile });
    const { container: c } = render(<AppShell />);
    await waitFor(() => expect(opened(c)).toBe(true));
    expect(m.openPath).toHaveBeenCalledWith("C:\\d\\other.mady");
    expect(launchFile).toHaveBeenCalledTimes(1);
  });

  it("MadY already open: the file it is sent opens, after the unsaved question", async () => {
    let send: ((p: string) => void) | undefined;
    const m = install("discard", {
      onLaunchOpen: (cb: (p: string) => void) => { send = cb; return () => {}; },
    });
    const { container: c } = render(<AppShell />);
    await edit(c);
    expect(send, "the renderer never listened for a file sent to it").toBeTruthy();
    await act(async () => { send!("C:\\d\\other.mady"); });
    await waitFor(() => expect(opened(c)).toBe(true));
    expect(m.askUnsaved).toHaveBeenCalledTimes(1);
  });

  it("a file arriving while the crash-recovery question is up waits for the answer", async () => {
    let send: ((p: string) => void) | undefined;
    // A crash copy of the user's own work (a datasheet): a copy holding nothing of theirs is not offered.
    const crashed = new MadyDocument();
    crashed.addTable("My crashed data", "xy", ["X", "Y"]);
    const snap = { savedAt: new Date().toISOString(), json: JSON.stringify(crashed.toJSON()) };
    const m = install("discard", {
      autosaveRecovered: () => Promise.resolve(snap),
      autosaveClear: vi.fn(() => Promise.resolve({ ok: true })),
      onLaunchOpen: (cb: (p: string) => void) => { send = cb; return () => {}; },
    });
    const { container: c } = render(<AppShell />);
    await waitFor(() => expect(c.ownerDocument.body.textContent).toMatch(/recover/i));
    await act(async () => { send!("C:\\d\\other.mady"); });
    expect(m.openPath, "opened under the recovery question").not.toHaveBeenCalled();
    expect(opened(c)).toBe(false);
    // Answer it: Discard.
    const discard = within(c.ownerDocument.body).getAllByRole("button").find((b) => /discard/i.test(b.textContent ?? ""));
    expect(discard, "fixture: the recovery question has a Discard button").toBeTruthy();
    await act(async () => { fireEvent.click(discard!); });
    await waitFor(() => expect(opened(c)).toBe(true));
    expect(m.openPath).toHaveBeenCalledWith("C:\\d\\other.mady");
  });
});
