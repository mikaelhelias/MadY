// @vitest-environment jsdom
/**
 * The demo project MadY opens with is there to look around in. Looking around (a gallery card
 * opened) must not read as unsaved work — no "Save changes?" on closing, no crash copy kept for a
 * recovery prompt — while anything of the user's own (a new datasheet) does.
 * Read off what the app tells main (`setDirty`) and whether it writes the crash copy (`autosaveWrite`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { createSampleDocument } from "@mady/core";
import type { MadyDocument } from "@mady/core";
import { AppShell } from "./AppShell";

type Mady = { setDirty: ReturnType<typeof vi.fn>; autosaveWrite: ReturnType<typeof vi.fn>; autosaveRecovered: ReturnType<typeof vi.fn>; autosaveClear: ReturnType<typeof vi.fn> };
const install = (recovered: unknown = null): Mady => {
  const mady: Mady = {
    setDirty: vi.fn(),
    autosaveWrite: vi.fn(async () => ({ ok: true })),
    autosaveRecovered: vi.fn(async () => recovered),
    autosaveClear: vi.fn(async () => ({ ok: true })),
  };
  (window as unknown as { mady: unknown }).mady = mady;
  return mady;
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { mady?: unknown }).mady;
});

const menu = (container: HTMLElement, name: string, item: string | RegExp): void => {
  fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText(name));
  fireEvent.click(within(container.querySelector(".dropdown") as HTMLElement).getByText(item));
};
const lastDirty = (m: Mady): boolean => m.setDirty.mock.calls.at(-1)![0] as boolean;
/** Long enough for the debounced crash copy to have been written, had it been due. */
const pastAutosave = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 1800)); }); };

/** A crash copy as main hands it back at launch. */
const snapshot = (doc: MadyDocument) => ({ v: 1, savedAt: Date.now(), name: "Recovered project", json: JSON.stringify(doc.toJSON()) });
const RECOVERY = '[role="dialog"][aria-label="Recover unsaved work"]';

describe("at launch, a crash copy is offered back only when it holds the user's own work", () => {
  it("a copy of the demo alone: no recovery question, and the copy is removed", async () => {
    const mady = install(snapshot(createSampleDocument()));
    const { container } = render(<AppShell />);
    await waitFor(() => expect(mady.autosaveClear, "the demo copy is removed").toHaveBeenCalled());
    expect(container.ownerDocument.querySelector(RECOVERY), "the demo is not offered back").toBeNull();
  });

  it("a copy holding the user's own datasheet: the recovery question comes up, and Recover brings it back", async () => {
    const doc = createSampleDocument();
    doc.addTable("My crashed data", "xy", ["X", "Y"]);
    const mady = install(snapshot(doc));
    const { container } = render(<AppShell />);
    const dialog = await waitFor(() => { const d = container.ownerDocument.querySelector<HTMLElement>(RECOVERY); expect(d, "the user's work is offered back").toBeTruthy(); return d!; });
    expect(mady.autosaveClear, "the user's copy is kept until answered").not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Recover/ }));
    await waitFor(() => expect(container.textContent).toContain("My crashed data"));
  });
});

describe("the demo project is not unsaved work; the user's own is", () => {
  it("opening a gallery card in the demo: not dirty, no crash copy", async () => {
    const mady = install();
    const { container } = render(<AppShell />);
    await waitFor(() => expect(mady.autosaveRecovered).toHaveBeenCalled());
    menu(container, "Graph", /^Chart gallery/);
    const card = await waitFor(() => { const c = container.querySelector<HTMLElement>(".gallerycard"); expect(c).toBeTruthy(); return c!; });
    fireEvent.click(card);
    await waitFor(() => expect(container.querySelector("svg.gfx-figure")).toBeTruthy());
    await pastAutosave();
    expect(mady.setDirty).toHaveBeenCalled();
    expect(lastDirty(mady), "a gallery card opened in the demo must not ask to be saved").toBe(false);
    expect(mady.autosaveWrite, "no crash copy of the demo").not.toHaveBeenCalled();
  }, 30_000);

  it("a new datasheet of the user's own: dirty, and a crash copy is kept", async () => {
    const mady = install();
    const { container } = render(<AppShell />);
    await waitFor(() => expect(mady.autosaveRecovered).toHaveBeenCalled());
    menu(container, "Insert", "New datasheet (XY)");
    await waitFor(() => expect(lastDirty(mady), "the user's own datasheet must be protected").toBe(true));
    await pastAutosave();
    expect(mady.autosaveWrite, "the user's work gets its crash copy").toHaveBeenCalled();
  }, 30_000);
});

describe("a project opened from its file is clean until it is changed", () => {
  it("File ▸ Open of a saved project: nothing to save", async () => {
    const mady = install();
    // The project on disk: the demo plus a datasheet of the user's own, as a save writes it.
    const { createSampleDocument } = await import("@mady/core");
    const d = createSampleDocument();
    d.addTable("My data", "xy", ["X", "Y"]);
    const json = JSON.stringify(d.toJSON());
    Object.assign(mady, {
      openFile: vi.fn(async () => ({ ok: true, kind: "project", path: "C:/x/mine.mady", json })),
      listRecents: vi.fn(async () => []),
      runAnalysis: vi.fn(async (method: string) => ({ ok: true, results: { method, title: method, terms: [], glance: { p: 0.5 }, summary: "s" } })),
    });
    const { container } = render(<AppShell />);
    await waitFor(() => expect(mady.autosaveRecovered).toHaveBeenCalled());
    menu(container, "File", /^Open…/);
    await waitFor(() => expect((mady as unknown as { openFile: ReturnType<typeof vi.fn> }).openFile).toHaveBeenCalled());
    await pastAutosave();
    expect(lastDirty(mady), "a project just opened, unchanged, must not ask to be saved").toBe(false);
    expect(container.querySelector(".savedot"), "nor show the unsaved dot").toBeNull();
  }, 30_000);
});

describe("open, look, save everything: the unsaved dot clears", () => {
  it("after the save, nothing reads as unsaved", async () => {
    const mady = install();
    const { createSampleDocument } = await import("@mady/core");
    const d = createSampleDocument();
    d.addTable("My data", "xy", ["X", "Y"]);
    const json = JSON.stringify(d.toJSON());
    const saveProject = vi.fn(async () => ({ ok: true, path: "C:/x/mine.mady" }));
    Object.assign(mady, {
      openFile: vi.fn(async () => ({ ok: true, kind: "project", path: "C:/x/mine.mady", json })),
      listRecents: vi.fn(async () => []),
      saveProject,
      runAnalysis: vi.fn(async (method: string) => ({ ok: true, results: { method, title: method, terms: [], glance: { p: 0.5 }, summary: "s" } })),
    });
    const { container } = render(<AppShell />);
    await waitFor(() => expect(mady.autosaveRecovered).toHaveBeenCalled());
    menu(container, "File", /^Open…/);
    await pastAutosave();
    menu(container, "File", /^Save…/);
    const dlg = await waitFor(() => { const x = container.querySelector('[role="dialog"][aria-label="Save project"]'); expect(x).toBeTruthy(); return x as HTMLElement; });
    for (const box of [...dlg.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]) if (!box.checked) fireEvent.click(box);
    const btn = dlg.querySelector<HTMLButtonElement>(".modalbtns button.btn")!;
    expect(btn.textContent).toMatch(/Save everything/);
    fireEvent.click(btn);
    await waitFor(() => expect(saveProject).toHaveBeenCalled());
    await pastAutosave();
    expect(lastDirty(mady), "saved: main must hear clean").toBe(false);
    expect(container.querySelector(".savedot"), "saved: no unsaved dot").toBeNull();
  }, 30_000);
});
