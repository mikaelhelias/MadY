/**
 * The radius a swarm dot is drawn at — the replicate dots of a column scatter, and the dots a bar, box
 * or violin shows alongside its body — from the series' symbol size.
 *
 * One formula. The renderer (`ScatterGlyph` in PlotFigure.tsx) draws the dots with it, and the layout's
 * obstacle list (`markObstacles` in buildScene.ts) keeps labels off them. Sharing it keeps the obstacle
 * list from picturing a bar's dot as an XY marker of the full symbol size at the bar's end — a disc
 * larger than the dot drawn — which would move labels such as a waterfall zone name off free space.
 */
export function swarmDotRadius(symbolSize: number | undefined): number {
  return Math.max(2, (symbolSize ?? 4) * 0.6);
}
