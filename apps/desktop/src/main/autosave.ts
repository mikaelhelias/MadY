import { unlinkSync } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite } from "./atomicWrite";

/**
 * Crash-recovery autosave (data safety).
 *
 * The renderer periodically writes the latest in-memory project to a single
 * slot in `userData` — **separate from the user's `.mady` file**, which we
 * never touch. On a clean quit the slot is removed; if it survives to the next
 * launch the previous session crashed, so we offer to recover it.
 */
export interface AutosaveSnapshot {
  /** Envelope version (distinct from the Project schemaVersion inside `json`). */
  v: 1;
  /** Epoch ms the snapshot was taken (for the "from N minutes ago" prompt). */
  savedAt: number;
  /** Display name for the recovery prompt. */
  name: string;
  /** The serialized `Project` (already at the current schema). */
  json: string;
}

export function autosavePath(dir: string): string {
  return join(dir, "autosave.json");
}

/**
 * Replace the autosave slot as atomically as the filesystem allows (temp +
 * rename → never half-written), with a copy+replace fallback for redirected
 * drives where the rename fails with `EXDEV`. See {@link atomicWrite}.
 */
export async function writeSnapshot(dir: string, snapshot: AutosaveSnapshot): Promise<void> {
  await mkdir(dir, { recursive: true }).catch(() => {});
  await atomicWrite(autosavePath(dir), JSON.stringify(snapshot));
}

/** Read the slot if present and well-formed; otherwise `null` (nothing to recover). */
export async function readSnapshot(dir: string): Promise<AutosaveSnapshot | null> {
  try {
    const parsed = JSON.parse(await readFile(autosavePath(dir), "utf8")) as Partial<AutosaveSnapshot>;
    if (parsed?.v === 1 && typeof parsed.json === "string" && typeof parsed.savedAt === "number") {
      return {
        v: 1,
        savedAt: parsed.savedAt,
        name: typeof parsed.name === "string" ? parsed.name : "Recovered project",
        json: parsed.json,
      };
    }
    return null;
  } catch {
    return null; // missing / unreadable / malformed → nothing to recover
  }
}

/** Discard the slot (after recover/discard). Missing file is fine. */
export async function clearSnapshot(dir: string): Promise<void> {
  await unlink(autosavePath(dir)).catch(() => {});
}

/**
 * Synchronous clear for the quit path: `will-quit` can't reliably await a
 * promise before the process exits, so we delete the slot inline. A normal
 * exit therefore leaves nothing to recover; a crash skips this entirely.
 */
export function clearSnapshotSync(dir: string): void {
  try {
    unlinkSync(autosavePath(dir));
  } catch {
    /* missing → already clean */
  }
}
