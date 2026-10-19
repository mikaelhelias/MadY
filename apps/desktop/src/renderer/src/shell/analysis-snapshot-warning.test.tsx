// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createSampleDocument } from "@mady/core";
import { GraphPane } from "./panes";
afterEach(cleanup);

it("keeps the graph warning visible after the analysis is current but its snapshot is old", () => {
  const doc = createSampleDocument();
  const plot = doc.toJSON().plots[0]!;
  const a = doc.addAnalysis("Snapshot", "describe", plot.source, { columns: [] });
  doc.setAnalysisResult(a.id, { method: "describe", title: "Snapshot", glance: {}, summary: "Old", terms: [] });
  doc.setPlotOptions(plot.id, { analysisSource: a.id });
  doc.setAnalysisResult(a.id, { method: "describe", title: "Snapshot", glance: {}, summary: "New", terms: [{ term: "new" }] });
  doc.refreshPlotStatus();
  expect(a.status).toBe("ok");
  const { container } = render(<GraphPane project={doc.toJSON()} plotId={plot.id} />);
  expect(container.querySelector(".stalenote")?.textContent).toMatch(/recreate.*updated analysis/i);
});
