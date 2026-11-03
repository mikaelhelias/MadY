import { join } from "node:path";

/**
 * The window / taskbar / Alt-Tab icon — the purple "Y" in `renderer/public/icon.png`.
 *
 * Two homes, because the file is reached two different ways:
 *  • Packaged: electron-builder ships `out/**` only (`build/` is not in the asar), and
 *    `renderer/public/` is copied verbatim into `out/renderer`, so the icon is
 *    `<out/main>/../renderer/icon.png` — real inside the installed .exe.
 *  • Dev (`npm run dev`): electron-vite serves the renderer from memory and never writes
 *    `out/renderer`, so that same path only exists if a full build happened to run in this
 *    checkout earlier. A fresh clone or worktree has no `out/renderer` at all, and Electron
 *    then falls back — silently — to its own default icon. In dev the icon is therefore read
 *    straight from the source tree.
 */
export function windowIconPath(opts: { isPackaged: boolean; mainDir: string; appPath: string }): string {
  return opts.isPackaged
    ? join(opts.mainDir, "../renderer/icon.png")
    : join(opts.appPath, "src", "renderer", "public", "icon.png");
}
