import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Graph ▸ Split into small graphs in the real app (built bundle): the command makes one small
 * graph per series on a new figure page; a change to the original reaches every small graph; a
 * change made on a small graph that is not a position is refused with a message, and a
 * moved legend on a small graph stays.
 */
type P = { id: string; name: string; splitFrom?: { plot: string; series: string }; yAxis?: { title?: string }; legendOffset?: unknown; barWidth?: number };

const SHOTS = process.env.SPLIT_SHOTS; // folder for screenshots of each step, when set

test("split into small graphs: made, followed, refused with a message, positions kept", async ({ page }) => {
  const app = new MadyApp(page);
  await app.open();
  await app.openGraph("Dose-group violin");
  const before = (await app.project()) as { plots: P[] };
  const original = before.plots.find((p) => p.name === "Dose-group violin")!;

  await app.menu("Graph", "Split into small graphs");
  await page.waitForSelector(".laypanel");
  await app.settle();
  let proj = (await app.project()) as { plots: P[]; layouts?: { panels: string[] }[] };
  const copies = proj.plots.filter((p) => p.splitFrom?.plot === original.id);
  expect(copies.length).toBeGreaterThanOrEqual(2);
  expect(proj.layouts?.at(-1)?.panels).toEqual(copies.map((c) => c.id));
  expect(await page.locator(".laypanel").count()).toBe(copies.length);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/split-figure.png` });

  // A change on the original reaches every small graph.
  await app.openGraph("Dose-group violin");
  await app.setPlotOptions({ yAxis: { title: "Response (split test)" } });
  proj = (await app.project()) as typeof proj;
  for (const c of copies) expect(proj.plots.find((p) => p.id === c.id)?.yAxis?.title).toBe("Response (split test)");

  // On a small graph: a style change is refused with a message; a moved legend is kept.
  await app.openGraph(copies[0]!.name);
  await expect(page.locator(".smallgraph-notice")).toContainText("Dose-group violin");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/split-small-graph.png` });
  const messages: string[] = [];
  page.on("dialog", (d) => { messages.push(d.message()); void d.dismiss(); });
  await app.setPlotOptions({ yAxis: { title: "Edited on the copy" } });
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/small graph made from "Dose-group violin"/);
  proj = (await app.project()) as typeof proj;
  expect(proj.plots.find((p) => p.id === copies[0]!.id)?.yAxis?.title).toBe("Response (split test)");
  await app.setPlotOptions({ legendOffset: { dx: 30, dy: 20 } });
  expect(messages).toHaveLength(1);
  proj = (await app.project()) as typeof proj;
  expect(proj.plots.find((p) => p.id === copies[0]!.id)?.legendOffset).toEqual({ dx: 30, dy: 20 });
});
