import { fireEvent } from "@testing-library/react";

/**
 * Open every figure-toolbar menu — Align ▾, Line up ▾, Insert ▾, Style ▾ — the way a user would, so a test reaches the
 * controls inside them. Those controls live in menus; a test changes only where it finds a control, never what it
 * checks.
 *
 * A disabled menu stays shut (Line up ▾ has nothing to do until panels are picked): call it again after picking them.
 * A click never dispatches the pointerdown a ToolbarMenu closes on, so opening one menu does not close another.
 */
export function openFigureMenus(root: ParentNode = document): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>("button.laymenu-btn")) {
    if (!b.disabled && b.getAttribute("aria-expanded") !== "true") fireEvent.click(b);
  }
}
