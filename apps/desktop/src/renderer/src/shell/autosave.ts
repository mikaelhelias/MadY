import type { Project } from "@mady/core";
import type { AutosaveSnapshot } from "../../../preload";

/**
 * How long the renderer waits after the last edit before writing a recovery
 * snapshot. Short enough that little work is at risk, long enough that a burst
 * of edits (typing, pasting, dragging) coalesces into one write.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * Resolve the effective autosave cadence from the app defaults (pure — the caller
 * supplies the persisted values). `enabled` is true unless explicitly disabled;
 * `ms` is the saved interval when it's a positive finite number, else the built-in
 * debounce. Keeps this module free of any storage/localStorage dependency.
 */
export function resolveAutosave(app: { autosaveMs?: number | undefined; autosaveEnabled?: boolean | undefined }): {
  enabled: boolean;
  ms: number;
} {
  const enabled = app.autosaveEnabled !== false;
  const ms = typeof app.autosaveMs === "number" && Number.isFinite(app.autosaveMs) && app.autosaveMs > 0
    ? app.autosaveMs
    : AUTOSAVE_DEBOUNCE_MS;
  return { enabled, ms };
}

/** A human label for the recovery prompt — the first project folder, or a fallback. */
export function projectName(project: Project): string {
  return project.workspace.folders[0]?.name ?? "Untitled project";
}

/** Build the snapshot envelope written to the autosave slot. Pure (clock injected). */
export function buildSnapshot(name: string, project: Project, now: number): AutosaveSnapshot {
  return { v: 1, savedAt: now, name, json: JSON.stringify(project) };
}

/** Coarse "from N ago" phrasing for the recovery prompt (age in ms). */
export function formatAge(ageMs: number): string {
  const ms = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
