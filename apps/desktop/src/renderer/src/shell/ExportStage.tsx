/**
 * The off-screen stage Export all draws on: one graph or one figure at a time, drawn exactly as
 * its own tab draws it (`graphSceneOptions`, the read-only `LayoutPane`), so each file is what the Export dialog would
 * write for it. Hidden with `visibility: hidden` and parked off screen — never `display: none`, which gives no layout,
 * and every reader measures (getBBox, bounding boxes, the laid-out panel positions). Mounted only during a run.
 */
import { useEffect, useRef } from "react";
import type { Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { LayoutPane, graphSceneOptions } from "./panes";
import type { BatchItem } from "./batchExport";

export function ExportStage({ project, item, onReady }: {
  project: Project;
  /** The graph / figure to draw now; null = nothing (the stage draws empty). */
  item: BatchItem | null;
  /** Called once the item is drawn and laid out (two frames after mounting), with the stage to read from. */
  onReady: (root: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    let second = 0;
    // Two frames: the first commits the drawing, the second lets the layout (fonts, sizes) settle before reading.
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => { if (!cancelled && ref.current) ready.current(ref.current); });
    });
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [item]);

  let body: React.ReactNode = null;
  if (item?.kind === "graph") {
    const plot = project.plots.find((p) => p.id === item.id);
    const table = plot ? project.tables.find((t) => t.id === plot.source) : undefined;
    if (plot && table) body = <PlotFigure scene={buildPlotScene(table, plot, graphSceneOptions(project, plot))} />;
  } else if (item?.kind === "figure") {
    body = <LayoutPane project={project} layoutId={item.id} onRemovePanel={() => {}} onOpenPlot={() => {}} />;
  }
  return (
    <div
      ref={ref}
      className="export-stage"
      aria-hidden="true"
      data-export-stage=""
      style={{ position: "fixed", left: -20000, top: 0, width: 1600, visibility: "hidden", pointerEvents: "none" }}
    >
      {body}
    </div>
  );
}
