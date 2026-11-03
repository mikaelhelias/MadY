/**
 * The Inspector's style handlers: each one is a single undoable document method on the open graph.
 * AppShell wires the Inspector with these, and the option sweep drives the Inspector through them,
 * so a control is tested through exactly the wiring the app uses.
 */
import type { MadyDocument, NodeId } from "@mady/core";

export type Mutate = (fn: (d: MadyDocument) => void) => void;
type Args<K extends keyof MadyDocument> = MadyDocument[K] extends (id: NodeId, ...rest: infer R) => unknown ? R : never;

export function inspectorDocOps(mutate: Mutate, plotId: () => NodeId | undefined) {
  const on = (fn: (d: MadyDocument, id: NodeId) => void): void => {
    const id = plotId();
    if (id) mutate((d) => fn(d, id));
  };
  return {
    setAxis: (...a: Args<"setPlotAxis">): void => on((d, id) => d.setPlotAxis(id, ...a)),
    /** Set/clear an axis's length (plot-area width for X / height for Y), in px. */
    setAxisLength: (...a: Args<"setAxisLength">): void => on((d, id) => d.setAxisLength(id, ...a)),
    /** Set the per-axis title font (X, Y, Y2 or Y3 independently). */
    setAxisTitleFont: (...a: Args<"setAxisTitleFont">): void => on((d, id) => d.setAxisTitleFont(id, ...a)),
    setSeriesStyle: (...a: Args<"setSeriesStyle">): void => on((d, id) => d.setSeriesStyle(id, ...a)),
    /** Apply a style delta to every listed series in one undo. */
    setSeriesStyleAll: (...a: Args<"setSeriesStyleAll">): void => on((d, id) => d.setSeriesStyleAll(id, ...a)),
    setPointStyle: (...a: Args<"setPointStyle">): void => on((d, id) => d.setPointStyle(id, ...a)),
    clearPointStyles: (...a: Args<"clearPointStyles">): void => on((d, id) => d.clearPointStyles(id, ...a)),
    setGrid: (...a: Args<"setGridStyle">): void => on((d, id) => d.setGridStyle(id, ...a)),
    setFrame: (...a: Args<"setPlotFrame">): void => on((d, id) => d.setPlotFrame(id, ...a)),
    setBarLayout: (...a: Args<"setBarLayout">): void => on((d, id) => d.setBarLayout(id, ...a)),
    setBarShape: (...a: Args<"setBarShape">): void => on((d, id) => d.setBarShape(id, a[0] === "square" ? undefined : a[0])),
    setBoxWhisker: (...a: Args<"setBoxWhisker">): void => on((d, id) => d.setBoxWhisker(id, ...a)),
    /** Patch presentation-only plot fields (pie / heatmap options), one undoable step. */
    setPlotOptions: (...a: Args<"setPlotOptions">): void => on((d, id) => d.setPlotOptions(id, ...a)),
    setGraphTitle: (...a: Args<"setGraphTitle">): void => on((d, id) => d.setGraphTitle(id, ...a)),
    setPlotFont: (...a: Args<"setPlotFont">): void => on((d, id) => d.setPlotFont(id, ...a)),
    setLegend: (...a: Args<"setLegend">): void => on((d, id) => d.setLegend(id, ...a)),
    /** The significance style alone; AppShell re-plans analysis brackets after it. */
    setSignificance: (...a: Args<"setSignificance">): void => on((d, id) => d.setSignificance(id, ...a)),
  };
}
