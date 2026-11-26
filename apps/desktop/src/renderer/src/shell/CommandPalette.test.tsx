// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import type { AppAction } from "./actions";

afterEach(cleanup);

/**
 * The palette is the safety valve that makes nested menus and short labels safe:
 * every command stays flat and findable here. Matching is therefore
 * order-independent across menu / submenu / label / keywords — "Contingency table"
 * under the parent row "New table" is found by "new contingency" as well as by
 * "contingency new".
 */
const ACTIONS: AppAction[] = [
  { id: "new-table-contingency", label: "Contingency table", menu: "Insert", submenu: "New table", keywords: "new create datasheet", run: vi.fn() },
  { id: "frequency", label: "Frequency distribution…", menu: "Data", keywords: "histogram bins", run: vi.fn() },
  { id: "doseresponse", label: "Dose-response…", menu: "Analyze", submenu: "Common analyses", keywords: "EC50 IC50", run: vi.fn() },
  { id: "save", label: "Save…", menu: "File", shortcut: "Ctrl+S", run: vi.fn() },
  { id: "off", label: "Disabled thing", menu: "File", enabled: false, run: vi.fn() },
];

function setup() {
  const onClose = vi.fn();
  const onOpenGuide = vi.fn();
  const r = render(<CommandPalette actions={ACTIONS} onClose={onClose} onOpenGuide={onOpenGuide} />);
  const type = (q: string): void => {
    fireEvent.change(r.container.querySelector(".palette-input")!, { target: { value: q } });
  };
  // Note: action rows only. The palette also lists what the manual can answer, under its own
  // heading and with the same label class, so a bare `.palette-label` here would stop meaning
  // "the commands that matched" — which is what every assertion below is about.
  const labels = (): (string | null)[] =>
    [...r.container.querySelectorAll(".palette-item:not(.palette-guide) .palette-label")].map((x) => x.textContent);
  const guide = (): (string | null)[] =>
    [...r.container.querySelectorAll(".palette-guide .palette-label")].map((x) => x.textContent);
  return { ...r, onClose, onOpenGuide, type, labels, guide };
}

describe("CommandPalette", () => {
  it("matches words in any order and across label + keywords", () => {
    const { type, labels } = setup();
    // Words split across the parent row ("New table") and the label.
    type("new contingency");
    expect(labels()).toEqual(["Contingency table"]);
    // Reversed order still matches.
    type("contingency new");
    expect(labels()).toEqual(["Contingency table"]);
  });

  it("finds a command by jargon that only lives in keywords", () => {
    const { type, labels } = setup();
    type("histogram");
    expect(labels()).toEqual(["Frequency distribution…"]);
    type("ec50");
    expect(labels()).toEqual(["Dose-response…"]);
  });

  it("still narrows — an unrelated query matches nothing", () => {
    const { type, container, labels } = setup();
    type("kaplan meier zzz");
    expect(labels()).toEqual([]);
    expect(container.querySelector(".palette-empty")).not.toBeNull();
  });

  it("omits disabled actions", () => {
    const { labels } = setup();
    expect(labels()).not.toContain("Disabled thing");
  });

  it("runs the chosen action and closes", () => {
    const { type, container, onClose } = setup();
    type("histogram");
    fireEvent.click(container.querySelector(".palette-item")!);
    expect(ACTIONS.find((a) => a.id === "frequency")!.run).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * The "In the manual" group.
 *
 * Half of what people type into Ctrl+K is a question, not a command — "log scale", "dpi",
 * "transparent background". Those have no action to run; they have a control somewhere and a
 * chapter that explains it. The palette also shows what the manual can answer, from the same
 * `searchGuide` the Documentation tab uses.
 *
 * The rules this block holds: below the actions, never above; at most five; and the
 * arrow keys walk straight from the last action into them, because a boundary the reader cannot
 * see is a boundary they will hit.
 */
describe("CommandPalette — what the manual can answer", () => {
  it("shows nothing from the manual until there is something to search for", () => {
    const { type, guide } = setup();
    expect(guide()).toEqual([]);
    type("a"); // one character is a keystroke, not a question
    expect(guide()).toEqual([]);
  });

  it("answers a question that has no command at all", () => {
    // The point of the whole group: "transparent background" runs nothing, and without the
    // group the palette would answer it with "No matching actions".
    const { type, labels, guide } = setup();
    type("transparent background");
    expect(labels(), "no action matches this — that is why the group exists").toEqual([]);
    expect(guide().length).toBeGreaterThan(0);
    expect(guide()[0]).toBe("Background");
  });

  it("never pushes the commands off the top, and never shows more than five", () => {
    const { container, type } = setup();
    type("data");
    const rows = [...container.querySelectorAll(".palette-item")];
    const firstGuide = rows.findIndex((r) => r.classList.contains("palette-guide"));
    const lastAction = rows.map((r) => !r.classList.contains("palette-guide")).lastIndexOf(true);
    if (firstGuide >= 0) expect(firstGuide, "a manual hit is sitting above a command").toBeGreaterThan(lastAction);
    expect(container.querySelectorAll(".palette-guide").length).toBeLessThanOrEqual(5);
  });

  it("the group is announced, so the two lists are not read as one", () => {
    const { container, type } = setup();
    type("transparent background");
    expect(container.querySelector(".palette-group")?.textContent).toBe("In the manual");
  });

  it("opening one closes the palette and asks for that entry", () => {
    const { container, type, onOpenGuide, onClose } = setup();
    type("transparent background");
    fireEvent.click(container.querySelector(".palette-guide")!);
    expect(onClose).toHaveBeenCalled();
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
    const target = onOpenGuide.mock.calls[0]![0] as { entry?: string; section?: string };
    expect(target.entry ?? target.section, "opened the manual at nothing").toBeTruthy();
  });

  it("the arrow keys walk from the last command into the manual's answers", () => {
    // The seam is the whole reason `active` indexes both lists: stopping at the last action
    // would look like the list had ended.
    const { container, type } = setup();
    type("data");
    const input = container.querySelector(".palette-input")!;
    const actions = container.querySelectorAll(".palette-item:not(.palette-guide)").length;
    expect(actions, "this query must match some commands, or the test proves nothing").toBeGreaterThan(0);
    expect(container.querySelectorAll(".palette-guide").length, "…and some manual hits").toBeGreaterThan(0);
    for (let i = 0; i < actions; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(
      container.querySelector(".palette-item.active")?.classList.contains("palette-guide"),
      "arrowing past the last command did not reach the manual",
    ).toBe(true);
  });

  it("Enter on a manual row opens the manual instead of running a command", () => {
    const { container, type, onOpenGuide } = setup();
    type("transparent background");
    const input = container.querySelector(".palette-input")!;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenGuide).toHaveBeenCalledTimes(1);
  });
});
