import type { SaveResponse } from "../../../preload";

/** The shared shape of every main-process IPC result: success, a user cancel, or a real error. */
type IoResult = { ok: boolean; canceled?: boolean; error?: string };

/**
 * Human-facing message for a project-save result, or `null` when nothing should
 * be shown — a successful save, or the user cancelling the native Save dialog.
 *
 * Splitting "canceled" from a real write error is the whole point: the main
 * process returns `{ok:false, error}` when `atomicWrite` throws (permission
 * denied, disk full, read-only volume); a renderer that discarded that result
 * would continue as if the save succeeded, and the user would believe their work
 * was on disk when no file existed. A cancel is
 * a deliberate no-op and stays silent; a failure must be surfaced loudly.
 */
export function saveErrorMessage(res: SaveResponse): string | null {
  if (res.ok || res.canceled) return null;
  return `Couldn't save the project — ${res.error ?? "unknown error"}. Your work has NOT been saved.`;
}

/**
 * Message for a failed export write, or `null` for success / user-cancel. Like the
 * save path, the main process returns `{ok:false, error}` when the write throws;
 * discarding it would close the dialog as if the file was written.
 */
export function exportErrorMessage(res: IoResult): string | null {
  if (res.ok || res.canceled) return null;
  return `Couldn't export the file — ${res.error ?? "unknown error"}.`;
}

/**
 * Message for an Export all run: `null` when every file was written, else how many were not and why, one
 * file per line — a batch never fails silently, and one refused file never hides the others.
 */
export function exportManyErrorMessage(res: { written: string[]; failed: { name: string; error: string }[] }): string | null {
  if (res.failed.length === 0) return null;
  const n = res.failed.length;
  const head = `${n} of ${n + res.written.length} file${n + res.written.length === 1 ? "" : "s"} ${n === 1 ? "was" : "were"} not written:`;
  return [head, ...res.failed.map((f) => `${f.name} — ${f.error}`)].join("\n");
}

/**
 * Message for a failed Open/Import read, or `null` for success / user-cancel.
 * Splitting a real read error from a cancel is the point: a corrupt or unreadable
 * file must not look the same as pressing Cancel.
 */
export function readErrorMessage(res: IoResult): string | null {
  if (res.ok || res.canceled) return null;
  return `Couldn't read that file — ${res.error ?? "unknown error"}.`;
}

/** Consecutive autosave-write failures before a persistent warning is shown. */
export const AUTOSAVE_FAIL_THRESHOLD = 3;

/**
 * Running count of consecutive autosave failures: a success resets to 0, a failure
 * increments. The caller shows a persistent indicator once the count reaches
 * AUTOSAVE_FAIL_THRESHOLD, so autosave that has been silently failing (the slot's
 * disk is full / read-only / gone) becomes visible instead of failing forever in
 * silence.
 */
export function nextAutosaveFailures(prev: number, ok: boolean): number {
  return ok ? 0 : prev + 1;
}
