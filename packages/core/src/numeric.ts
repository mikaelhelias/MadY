/**
 * The one place a cell becomes a number. Lives in its own module so both the payload
 * mapper (`analysisData`) and the row-group resolver (`rowGroups`) can use it without
 * importing each other — `analysisData` re-exports it, so it can be imported from either
 * module.
 */
import type { CellValue } from "./model";

/** Parse a cell to a finite number, or null (blank / non-numeric). */
export function numericCell(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
