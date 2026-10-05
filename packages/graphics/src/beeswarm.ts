/**
 * Beeswarm — the sideways offsets that let a group's dots sit side by side instead of on top of each other.
 *
 * On the bar / column-bar / column-scatter charts the points are spread slightly sideways so each can be seen. The
 * spacing follows each dot's real diameter: a fixed offset sized for small dots would barely move the 12–17 px dots
 * these charts draw, and a column of them would still overlap.
 *
 * Each dot, taken in value order, goes to the free sideways position nearest the centre line: clear of every dot already
 * placed by its real diameter plus `gap`, alternating sides on a tie so the swarm stays symmetric. `maxHalf` caps the
 * spread (the bar's half-width, the box's, the Width control's); a dot that finds no room inside the cap is set at the
 * cap on its side (it overlaps, but never leaves its group). Pure and deterministic — no random jitter — so a figure
 * exports the same every time.
 *
 * @param vpos    each dot's position along the value axis, px (any order)
 * @param radius  the dot radius, px — the size the renderer draws
 * @param maxHalf the widest a dot may sit from the centre line, px
 * @param spread  spacing multiplier (the Width control's ratio; 1 = neighbouring dots exactly `gap` px apart)
 * @param gap     clear space between neighbouring dots, px
 * @param limits  optional per-dot cap, px, in the input order — tighter than `maxHalf` where the group's own shape is
 *                narrower (a violin's outline at that dot's value). Undefined entries use `maxHalf`.
 * @returns       each dot's sideways offset from the centre line, px, in the input order
 */
export function beeswarmOffsets(vpos: readonly number[], radius: number, maxHalf: number, spread = 1, gap = 1, limits?: readonly (number | undefined)[]): number[] {
  const D = Math.max(0.5, (2 * radius + gap) * Math.max(0.1, spread));
  const order = vpos.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v)).sort((a, b) => a.v - b.v || a.i - b.i);
  const out = vpos.map(() => 0);
  const placed: { v: number; o: number }[] = [];
  let start = 0; // placed[] is in value order: skip the dots already more than D below
  let flip = 1;
  for (const p of order) {
    while (start < placed.length && p.v - placed[start]!.v >= D) start++;
    const near = placed.slice(start);
    // Sideways positions each nearby dot rules out: (o - w, o + w), w = the chord at this value distance.
    const blocked = near.map((q) => {
      const w = Math.sqrt(Math.max(0, D * D - (p.v - q.v) ** 2));
      return [q.o - w, q.o + w] as const;
    });
    const free = (o: number): boolean => blocked.every(([lo, hi]) => o <= lo + 1e-6 || o >= hi - 1e-6);
    const candidates = [0, ...blocked.flatMap(([lo, hi]) => [lo, hi])].filter(free);
    let best = candidates.length ? candidates.reduce((a, b) => (Math.abs(b) < Math.abs(a) - 1e-6 ? b : a)) : maxHalf * flip;
    // A tie between the two sides goes to them in turn, so the swarm grows symmetrically.
    const mirror = candidates.find((c) => Math.abs(c + best) < 1e-6 && Math.abs(c) > 1e-6);
    if (mirror !== undefined && Math.sign(best) !== flip) best = mirror;
    if (Math.abs(best) > 1e-6) flip = -Math.sign(best) as 1 | -1;
    const cap = Math.min(maxHalf, limits?.[p.i] ?? Infinity);
    if (Math.abs(best) > cap) best = Math.sign(best) * Math.max(0, cap);
    out[p.i] = best;
    // Keep placed[] in value order (values arrive in order, so this is an append).
    placed.push({ v: p.v, o: best });
  }
  return out;
}
