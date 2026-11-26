import type { NodeId } from "./model";

/**
 * Per-document id factory with per-prefix monotonic counters, so ids are
 * deterministic within a fresh document (e.g. `tbl_1`, `col_1`, `row_1`) —
 * which keeps golden-file serialization tests stable.
 */
export class IdFactory {
  private readonly counters = new Map<string, number>();

  next(prefix = "n"): NodeId {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }

  /**
   * Advance counters so future ids never collide with already-used ones — call
   * when loading a document so `next("tbl")` continues past the loaded `tbl_*`.
   * Ids are `${prefix}_${n}`; anything else is ignored.
   */
  seed(ids: Iterable<NodeId>): void {
    for (const id of ids) {
      const m = /^(.+)_(\d+)$/.exec(id);
      if (!m) continue;
      const prefix = m[1]!;
      const n = Number(m[2]);
      if (Number.isFinite(n) && n > (this.counters.get(prefix) ?? 0)) this.counters.set(prefix, n);
    }
  }
}
