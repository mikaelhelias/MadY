/**
 * Where a Kaplan–Meier curve stops. The estimate only steps at events, but subjects are followed
 * until their censoring time, so a curve runs flat to the last follow-up time — the last censor
 * tick when someone is censored after the final event, otherwise the final step itself.
 */
export function followUpEnd(times: readonly number[], censor: readonly number[] | undefined): number {
  let end = 0;
  for (const t of times) if (Number.isFinite(t) && t > end) end = t;
  for (const t of censor ?? []) if (Number.isFinite(t) && t > end) end = t;
  return end;
}

/**
 * Carry a step curve's last level flat to `end`. A curve that already reaches `end` (or an empty
 * one) is returned unchanged; the input is never modified.
 */
export function holdToEnd<P extends { t: number }>(pts: readonly P[], end: number): P[] {
  const last = pts[pts.length - 1];
  if (!last || !(end > last.t)) return [...pts];
  return [...pts, { ...last, t: end }];
}
