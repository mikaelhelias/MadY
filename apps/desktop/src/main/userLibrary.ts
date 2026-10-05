import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { basename } from "node:path";
import { join } from "node:path";
import { atomicWrite } from "./atomicWrite";

/**
 * Durable user style library, so the user's own presets and templates are not lost.
 *
 * Custom style presets, saved templates and the default-preset profile live in
 * the renderer's `localStorage`, which is fragile: it is wiped by "clear site
 * data", and the packaged (`file://`) app is a *different origin* from the dev
 * (`http://localhost`) app, so each starts blank. To stop the user ever losing
 * their presets we mirror those keys to a single JSON file in `userData` — the
 * same durable location as the crash-recovery autosave, and not tied to any
 * web origin. On launch the renderer reconciles the file with localStorage.
 *
 * The bundle stores each localStorage key's raw string value, so this layer is
 * agnostic to the shape/version of what's inside (presets/templates/profile all
 * own their own schema + migrations).
 */
export interface UserLibrary {
  /** Envelope version (distinct from the per-key payload schemas). */
  v: 1;
  /** Epoch ms the bundle was written (newest-wins reconciliation aid). */
  savedAt: number;
  /** localStorage key → its raw JSON string value. */
  data: Record<string, string>;
}

export function userLibraryPath(dir: string): string {
  return join(dir, "user-library.json");
}

/** Validate/normalise a parsed bundle; returns null if it isn't a library. */
export function coerceLibrary(parsed: unknown): UserLibrary | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<UserLibrary>;
  if (p.v !== 1 || !p.data || typeof p.data !== "object") return null;
  const data: Record<string, string> = {};
  for (const [k, val] of Object.entries(p.data as Record<string, unknown>)) {
    if (typeof val === "string") data[k] = val;
  }
  return { v: 1, savedAt: typeof p.savedAt === "number" ? p.savedAt : 0, data };
}

let corruptCounter = 0;

/**
 * Read the userData slot. Returns the library if present and well-formed, else null.
 * It tells an absent file from one that exists but is corrupt: an unreadable or malformed
 * slot is moved aside (renamed to a .corrupt sidecar) before null is returned, so the
 * next writeLibrary can't silently overwrite the user's only preset backup with
 * whatever localStorage happens to hold — possibly nothing.
 */
export async function readLibrary(dir: string): Promise<UserLibrary | null> {
  const path = userLibraryPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null; // genuinely absent (or fs-unreadable) — nothing to preserve
  }
  let lib: UserLibrary | null = null;
  try {
    lib = coerceLibrary(JSON.parse(raw));
  } catch {
    lib = null;
  }
  if (lib) return lib;
  // The file exists but is corrupt/not a library — move it aside, best-effort.
  const dest = `${path}.corrupt-${Date.now()}-${corruptCounter++}`;
  try {
    await rename(path, dest);
    console.warn(`[userLibrary] unreadable style library quarantined → ${dest}`);
  } catch {
    // If we can't even move it, don't crash the read.
  }
  return null;
}

/** Read a library bundle from an arbitrary path (used for Import too). */
export async function readLibraryFile(path: string): Promise<UserLibrary | null> {
  try {
    return coerceLibrary(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null; // missing / unreadable / malformed
  }
}

/** One file the user picked for a preset import: its text, or why it could not be read. */
export type PickedTextFile = { name: string; text: string } | { name: string; error: string };

/**
 * Read user-picked text files for the renderer to parse (one-preset import). Main reads bytes
 * and nothing more: the format check lives in the renderer, where it is a pure function with
 * its own tests. A file over `capBytes` is refused by name rather than read — a preset is a
 * few kilobytes, and an accidental pick of something huge must not be swallowed whole.
 */
export async function readTextFiles(paths: string[], capBytes: number): Promise<PickedTextFile[]> {
  const out: PickedTextFile[] = [];
  for (const path of paths) {
    const name = basename(path);
    try {
      const size = (await stat(path)).size;
      if (size > capBytes) {
        out.push({ name, error: `larger than ${Math.round(capBytes / 1024 / 1024)} MB (${Math.round(size / 1024)} KB)` });
        continue;
      }
      out.push({ name, text: await readFile(path, "utf8") });
    } catch (error) {
      out.push({ name, error: `could not be read: ${String(error)}` });
    }
  }
  return out;
}

/** Replace the userData slot atomically (temp + rename, EXDEV-safe). */
export async function writeLibrary(dir: string, lib: UserLibrary): Promise<void> {
  await mkdir(dir, { recursive: true }).catch(() => {});
  await atomicWrite(userLibraryPath(dir), JSON.stringify(lib));
}
