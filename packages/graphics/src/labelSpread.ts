/**
 * Where to put the value labels of one row so they do not print over each other.
 *
 * A paired dot chart centres each value label above its dot. Two values closer than a label is wide then collide:
 * "52.8" over "53.2" reads as neither. Labels that collide are sent outward: the lowest value's label ends at its dot
 * and the highest value's starts at its dot, the way the numbers of a dumbbell are usually set; a label between them
 * (three or more series) is raised a line of its own. Labels that do not collide are left exactly where they were.
 *
 * `x` is the dot's centre, `w` the label's width (0 = no label), `r` the dot's radius. `gap` is the clearance kept
 * between two labels, `lineH` the height of a line of label text. A label the user has dragged keeps its place in the
 * spread: the drawing adds the user's nudge to this position, so a drag stays continuous.
 */
export interface SpreadItem {
  x: number;
  w: number;
  r: number;
}

/** `dx` is added to the label's anchor point, `dy` to its baseline (negative = up). */
export interface Spread {
  anchor: "start" | "middle" | "end";
  dx: number;
  dy: number;
}

export function spreadRowLabels(items: SpreadItem[], gap: number, lineH: number): Spread[] {
  const out: Spread[] = items.map(() => ({ anchor: "middle", dx: 0, dy: 0 }));
  const order = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.w > 0)
    .sort((a, b) => a.it.x - b.it.x || a.i - b.i);
  const spread = (group: Array<{ it: SpreadItem; i: number }>): void => {
    if (group.length < 2) return;
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const mid = (first.it.x + last.it.x) / 2;
    out[first.i] = { anchor: "end", dx: Math.min(first.it.x + first.it.r, mid - gap / 2) - first.it.x, dy: 0 };
    out[last.i] = { anchor: "start", dx: Math.max(last.it.x - last.it.r, mid + gap / 2) - last.it.x, dy: 0 };
    for (let m = 1; m < group.length - 1; m++) out[group[m]!.i] = { anchor: "middle", dx: 0, dy: -m * lineH };
  };
  let group: Array<{ it: SpreadItem; i: number }> = [];
  for (const cur of order) {
    const prev = group[group.length - 1];
    if (prev && cur.it.x - prev.it.x < (prev.it.w + cur.it.w) / 2 + gap) group.push(cur);
    else {
      spread(group);
      group = [cur];
    }
  }
  spread(group);
  return out;
}
