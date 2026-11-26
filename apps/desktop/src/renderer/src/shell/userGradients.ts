/**
 * The user's own colour gradients, kept per-machine so they are available in EVERY project.
 *
 * A gradient lives in two places on purpose, and the difference matters:
 *  • `Project.gradients` — travels with the .mady file, so a colleague who opens it sees the
 *    same colours. This is where a graph's `custom:<id>` reference resolves.
 *  • this library — the user's own shelf, across projects. Picking one from the shelf COPIES it
 *    into the project (`adoptGradient` in the Inspector), so a shared file can never open with
 *    its colours missing.
 *
 * Same durable storage as the style presets: localStorage mirrored to the userData file, so a
 * "clear site data" or the dev↔packaged origin split cannot lose them (see `durableStore`).
 */
import type { Gradient } from "@mady/core";
import { dGet, dSet } from "./durableStore";

const KEY = "mady.userGradients.v1";
const MAX = 60;

function readAll(): Gradient[] {
  try {
    const raw = dGet(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    // Defensive: this file is user-editable on disk, and a malformed entry must not take the
    // colour picker down with it.
    return Array.isArray(list) ? (list as Gradient[]).filter((g) => g && typeof g.id === "string" && Array.isArray(g.stops)) : [];
  } catch {
    return [];
  }
}

function writeAll(list: Gradient[]): void {
  dSet(KEY, JSON.stringify(list));
}

/** Every saved gradient, in the order they were saved. */
export function listUserGradients(): Gradient[] {
  return readAll();
}

/** One saved gradient by id. */
export function findUserGradient(id: string): Gradient | undefined {
  return readAll().find((g) => g.id === id);
}

/** Save (or replace by id) a gradient on the user's shelf. */
export function saveUserGradient(gradient: Gradient): Gradient {
  const all = readAll();
  const kept = [...all.filter((g) => g.id !== gradient.id), gradient].slice(-MAX);
  writeAll(kept);
  return gradient;
}

/** Remove one from the shelf. Does NOT touch any project that already copied it. */
export function removeUserGradient(id: string): void {
  writeAll(readAll().filter((g) => g.id !== id));
}
