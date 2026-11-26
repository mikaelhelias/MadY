import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";
import type { Project } from "../packages/core/src/model";

test("late analysis cannot overwrite edited data; rerun refreshes fitted drawing and keeps style", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();
  await page.evaluate(() => {
    const w = window as any;
    w.pendingAnalysis = [];
    w.mady = { ...w.mady, runAnalysis: (method: string, data: unknown) => new Promise(resolve => {
      w.pendingAnalysis.push({ method, data, resolve });
    }) };
  });
  const initial = await app.project() as unknown as Project;
  const graph = initial.plots.find(p => p.name === "Dose-response")!;
  const table = initial.tables.find(t => t.id === graph.source)!;
  await page.locator('button[title^="Analyze"]').click();
  await app.analyzeRun({ method: "regression", columns: table.columns.slice(0, 2).map(c => c.id), variant: "ols" });
  const finish = async (ys: number[]) => {
    await expect.poll(() => page.evaluate(() => (window as any).pendingAnalysis.length)).toBe(1);
    await page.evaluate(ys => {
      (window as any).pendingAnalysis.shift().resolve({ ok: true, results: {
        method: "regression", title: "Line fit", terms: [], glance: {}, summary: "A fitted line.",
        extra: { curve: { x: [1, 3], y: ys, ciLow: ys.map(y => y - 1), ciHigh: ys.map(y => y + 1) } },
      } });
    }, ys);
    await app.settle();
  };
  await finish([2, 6]);
  const fitted = await app.project() as unknown as Project;
  const plot = fitted.plots.find(p => p.id === graph.id)!;
  expect(plot.fit?.points).toEqual([[1, 2], [3, 6]]);
  const id = plot.fit!.analysisSource!;
  expect(id).toBeTruthy();
  const version = plot.fit!.analysisResultVersion;
  await app.openGraph(graph.name);
  await app.setPlotOptions({ fitStyle: { color: "#932b59", width: 4 } });
  await app.analysisAction("rerun", id);
  await app.analysisAction("edit", table.id, 543);
  await finish([99, 999]);
  const rejected = await app.project() as unknown as Project;
  expect(rejected.analyses.find(a => a.id === id)?.status).toBe("stale");
  expect(rejected.plots.find(p => p.id === graph.id)?.fit?.analysisResultVersion).toBe(version);
  expect(rejected.plots.find(p => p.id === graph.id)?.fit?.points).toEqual([[1, 2], [3, 6]]);
  await expect(page.locator(".stalenote")).toBeVisible();
  await app.analysisAction("rerun", id);
  await finish([4, 12]);
  const updated = await app.project() as unknown as Project;
  const current = updated.plots.find(p => p.id === graph.id)!;
  expect(current.status).toBe("ok");
  expect(current.fit?.points).toEqual([[1, 4], [3, 12]]);
  expect(current.fit?.analysisResultVersion).not.toBe(version);
  expect(current.fitStyle).toEqual({ color: "#932b59", width: 4 });
  await expect(page.locator(".stalenote")).toHaveCount(0);
  expect(await app.consoleErrors()).toEqual([]);
});
