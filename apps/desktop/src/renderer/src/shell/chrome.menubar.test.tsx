// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MenuBar } from "./chrome";
import type { AppAction } from "./actions";

afterEach(cleanup);

/**
 * MenuBar submenu rendering. A `submenu` on an action must collapse every action
 * sharing that label into ONE parent row that opens a nested panel, so a long menu
 * (Analyze) stays short. The parent row is not itself a command.
 */
const act = (over: Partial<AppAction> & Pick<AppAction, "id" | "label" | "menu">): AppAction => ({
  run: vi.fn(),
  ...over,
});

const ACTIONS: AppAction[] = [
  act({ id: "analyze", label: "Analyze…", menu: "Analyze", group: 0 }),
  act({ id: "doseresponse", label: "Dose-response…", menu: "Analyze", submenu: "Common analyses", group: 0 }),
  act({ id: "binding", label: "Receptor binding…", menu: "Analyze", submenu: "Common analyses", group: 0 }),
  act({ id: "power", label: "Sample size & power…", menu: "Analyze", group: 1 }),
];

function setup(actions: AppAction[] = ACTIONS) {
  const props = {
    actions,
    recents: [],
    onOpenRecent: vi.fn(),
    theme: "light" as const,
    onToggleTheme: vi.fn(),
    onSettings: vi.fn(),
  };
  return { ...render(<MenuBar {...props} />), ...props };
}

const openMenu = (container: HTMLElement, name: string): void => {
  const tab = [...container.querySelectorAll(".menu")].find((m) => m.textContent === name);
  fireEvent.click(tab!);
};

describe("MenuBar submenus", () => {
  it("collapses actions sharing a submenu into one parent row", () => {
    const { container } = setup();
    openMenu(container, "Analyze");
    // One direct child <div> per visible row (a separator, when present, lives
    // INSIDE that div — so this counts rows, not rules).
    const labels = [...container.querySelectorAll(".dropdown > div")].map((d) => d.querySelector(".dropitem")?.textContent);
    // 4 actions → 3 visible rows: the two doors merged into one parent.
    expect(labels).toEqual(["Analyze…", "Common analyses", "Sample size & power…"]);
    expect(container.querySelectorAll(".dropsub")).toHaveLength(1);
  });

  it("does not run anything when the parent row is clicked — it opens the nested panel", () => {
    const { container } = setup();
    openMenu(container, "Analyze");
    const parent = container.querySelector(".dropsub")!;
    expect(parent.getAttribute("aria-haspopup")).toBe("true");
    expect(container.querySelector(".subdrop")).toBeNull();
    fireEvent.click(parent);
    const sub = container.querySelector(".subdrop");
    expect(sub).not.toBeNull();
    expect([...sub!.querySelectorAll(".dropitem")].map((b) => b.textContent)).toEqual(["Dose-response…", "Receptor binding…"]);
    // The parent row itself is not a command — no child action fired.
    for (const a of ACTIONS) expect(a.run).not.toHaveBeenCalled();
  });

  it("running a nested item fires that action and closes the whole menu", () => {
    const { container } = setup();
    openMenu(container, "Analyze");
    fireEvent.click(container.querySelector(".dropsub")!);
    const items = [...container.querySelectorAll(".subdrop .dropitem")];
    fireEvent.click(items.find((b) => b.textContent === "Receptor binding…")!);
    expect(ACTIONS.find((a) => a.id === "binding")!.run).toHaveBeenCalledOnce();
    expect(container.querySelector(".dropdown")).toBeNull();
  });

  it("separates groups by the parent row's group, not the children's", () => {
    const { container } = setup();
    openMenu(container, "Analyze");
    // group 0 (Analyze… + Common analyses) | group 1 (power) → exactly one separator.
    expect(container.querySelectorAll(".dropdown .dropsep")).toHaveLength(1);
  });

  it("leaves menus without submenus rendering flat", () => {
    const flat: AppAction[] = [
      act({ id: "open", label: "Open…", menu: "File", group: 0 }),
      act({ id: "save", label: "Save…", menu: "File", group: 0 }),
    ];
    const { container } = setup(flat);
    openMenu(container, "File");
    expect(container.querySelectorAll(".dropsub")).toHaveLength(0);
    expect(container.querySelectorAll(".dropdown .dropitem")).toHaveLength(2);
  });
});
