import { extname } from "node:path";

/**
 * The project file Windows hands MadY when a `.mady` file is double-clicked.
 *
 * Windows starts the program as `MadY.exe "C:\…\file.mady"` (the installer registers that
 * command), so the path is one of the command-line arguments. The same list arrives in a
 * running MadY's `second-instance` event when a second copy is started. The list also
 * carries the program itself, in development the app folder (`.`), and switches Chromium
 * adds (`--allow-file-access-from-files`, …) — none of which may be taken for a file.
 *
 * Returns the first argument that is not a switch and ends in one of `extensions`
 * (case-insensitive), or null. Whether the file exists is left to the reader, which
 * reports a missing file in words instead of dropping it.
 */
export function projectPathFromArgv(argv: readonly string[], extensions: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith("-")) continue;
    if (extensions.includes(extname(arg).slice(1).toLowerCase())) return arg;
  }
  return null;
}

/**
 * The project file macOS hands MadY. A Mac does not put a double-clicked document on the command
 * line: it sends the app an `open-file` event with the path, both when the double-click starts MadY
 * and when MadY is already running (and for a file dropped on the Dock icon). The path is taken only
 * if it ends in one of `extensions` (case-insensitive); otherwise null.
 */
export function projectPathFromOpenFile(path: string, extensions: readonly string[]): string | null {
  return path && extensions.includes(extname(path).slice(1).toLowerCase()) ? path : null;
}
