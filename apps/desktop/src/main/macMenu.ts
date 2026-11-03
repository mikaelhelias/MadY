import type { MenuItemConstructorOptions } from "electron";

/**
 * The native application menu, or null for none.
 *
 * Windows and Linux: none. MadY draws its own menu bar in the window (renderer `chrome.tsx`, built from
 * `actions.ts`); a native one would add a second File/Edit row above it.
 *
 * macOS: the menu bar is at the top of the screen, and in an Electron app the text-editing keys only
 * work through it — without Cut / Copy / Paste there, Cmd+X / Cmd+C / Cmd+V do nothing in a text box.
 * So a Mac gets the app menu (About, Hide, Quit with Cmd+Q) and those three. Copying and pasting cells
 * still works: the datasheet listens for the copy and paste events these items send. The menu holds no
 * key MadY handles itself — Undo (Cmd+Z), Redo and the datasheet's Select All stay with MadY's own
 * shortcuts, because a menu item's key is taken before the window sees it.
 */
export function nativeMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] | null {
  if (platform !== "darwin") return null;
  return [
    {
      label: "MadY",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }] },
  ];
}
