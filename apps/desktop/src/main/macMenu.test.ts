import { describe, expect, it } from "vitest";
import { nativeMenuTemplate } from "./macMenu";

/** Every role in a menu template, submenus included. */
const roles = (items: readonly { role?: string; submenu?: unknown }[]): string[] =>
  items.flatMap((i) => [...(i.role ? [i.role] : []), ...(Array.isArray(i.submenu) ? roles(i.submenu as { role?: string }[]) : [])]);

describe("the native menu", () => {
  it("Windows and Linux: none — MadY draws its own menu bar in the window", () => {
    expect(nativeMenuTemplate("win32")).toBeNull();
    expect(nativeMenuTemplate("linux")).toBeNull();
  });

  it("macOS: the app menu (About, Hide, Quit) and Cut / Copy / Paste, which text boxes need there", () => {
    const r = roles(nativeMenuTemplate("darwin")!);
    for (const role of ["about", "hide", "quit", "cut", "copy", "paste"]) expect(r, role).toContain(role);
  });

  it("macOS: no menu item takes a key MadY handles itself (its own Undo, Redo and the datasheet's Select All)", () => {
    const r = roles(nativeMenuTemplate("darwin")!);
    for (const role of ["undo", "redo", "selectAll", "editMenu", "appMenu", "fileMenu"]) expect(r, role).not.toContain(role);
  });
});
