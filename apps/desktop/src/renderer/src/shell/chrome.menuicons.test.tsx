// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MenuBar, MENU_ICONS, SUBMENU_ICONS, iconFor } from "./chrome";
import { buildActions } from "./actions";
import type { ActionHandlers, AppAction } from "./actions";

afterEach(cleanup);

// A universal handler stub: every property resolves to a no-op function (truthy, so gated
// actions read as enabled) — we only need the action LIST, not real behaviour.
const H = new Proxy({}, { get: () => () => {} }) as unknown as ActionHandlers;
const ACTIONS = buildActions(H);

describe("per-item menu icons", () => {
  it("EVERY menu command has a leading icon — a new action added without one fails here", () => {
    const missing = ACTIONS.filter((a) => iconFor(a) == null).map((a) => a.id);
    expect(missing, "these actions have no dropdown icon (add one to MENU_ICONS)").toEqual([]);
  });

  it("every submenu PARENT (New table / Common analyses) has an icon", () => {
    const labels = [...new Set(ACTIONS.filter((a) => a.submenu).map((a) => a.submenu!))];
    expect(labels.length, "no submenu parents found — the probe is aimed wrong").toBeGreaterThan(0);
    for (const label of labels) expect(SUBMENU_ICONS[label], `submenu "${label}" has no icon`).toBeTruthy();
  });

  it("the icon map only references real action ids (no stale keys after a rename)", () => {
    const ids = new Set(ACTIONS.map((a) => a.id));
    const stale = Object.keys(MENU_ICONS).filter((id) => !ids.has(id));
    expect(stale, "MENU_ICONS keys with no matching action (rename left a dangling entry)").toEqual([]);
  });

  it("renders the icon as an <svg> WITHOUT changing a row's text (name lookups still match)", () => {
    const acts: AppAction[] = buildActions(H).filter((a) => a.menu === "Edit");
    const { container } = render(
      <MenuBar actions={acts} recents={[]} onOpenRecent={() => {}} theme="light" onToggleTheme={() => {}} onSettings={() => {}} />,
    );
    fireEvent.click([...container.querySelectorAll(".menu")].find((m) => m.textContent === "Edit")!);
    // The label text lives in .dropitem-label (the button also holds a .kbd shortcut span).
    const copy = [...container.querySelectorAll(".dropitem")].find((b) => b.querySelector(".dropitem-label")?.textContent === "Copy")!;
    expect(copy, "no Copy row found").toBeTruthy();
    // The label still reads exactly "Copy" (icon is an svg with no text) AND carries an icon slot.
    expect(copy.querySelector(".dropitem-label")!.textContent).toBe("Copy");
    expect(copy.querySelector(".dropitem-ico svg"), "no icon rendered on the Copy row").toBeTruthy();
  });
});
