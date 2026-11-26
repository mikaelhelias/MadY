import { expect, test } from "@playwright/test";
import { collectErrors, MadyApp } from "./app";

/**
 * Where a gallery card lands. Opening a card copies its synthetic dataset + graph into the
 * demo project — but into its own "Gallery" experiment, never into the sample's
 * "Experiment 1": a synthetic gallery copy filed between the demo measurements is
 * indistinguishable from them in the tree. Filing into the folder's first experiment would do
 * exactly that, because the sample's first experiment is the demo data.
 */

interface Ws {
  workspace: {
    folders: { name: string; experiments: { name: string; members: { kind: string; id: string }[] }[] }[];
    loose: unknown[];
  };
  plots: { id: string; name: string }[];
  tables: { id: string; name: string }[];
}

const DEMO = "Demo Project";
const demoOf = (p: Ws) => p.workspace.folders.find((f) => f.name === DEMO)!;

test("a gallery card lands in a 'Gallery' experiment, and the demo experiments are untouched", async ({ page }) => {
  await collectErrors(page);
  const app = new MadyApp(page);
  await app.open();

  const before = (await app.project()) as unknown as Ws;
  const membersBefore = new Map(demoOf(before).experiments.map((e) => [e.name, e.members.length]));
  expect(membersBefore.has("Experiment 1"), "the sample lost its Experiment 1 — this spec's premise is gone").toBe(true);

  await app.openGallery();
  await app.openGalleryCard("Bland-Altman");

  const after = (await app.project()) as unknown as Ws;
  const gallery = demoOf(after).experiments.find((e) => e.name === "Gallery");
  expect(gallery, "no 'Gallery' experiment was created in the demo project").toBeTruthy();

  // The card's copied graph and its datasheet are both filed there.
  const plot = after.plots.find((p) => p.name === "Bland-Altman")!;
  const table = after.tables.find((t) => t.name === "Bland-Altman")!;
  const filed = new Set(gallery!.members.map((m) => m.id));
  expect(filed.has(plot.id), "the card's graph is not in the Gallery experiment").toBe(true);
  expect(filed.has(table.id), "the card's datasheet is not in the Gallery experiment").toBe(true);

  // Every experiment that existed before the click has exactly the members it had.
  for (const e of demoOf(after).experiments.filter((x) => x.name !== "Gallery")) {
    expect(e.members.length, `"${e.name}" changed size from a gallery click`).toBe(membersBefore.get(e.name));
  }

  // A second card joins the same experiment — no experiment-per-card litter.
  await app.openGallery();
  await app.openGalleryCard("Population pyramid");
  const third = (await app.project()) as unknown as Ws;
  const galleries = demoOf(third).experiments.filter((e) => e.name === "Gallery");
  expect(galleries.length, "a second click grew a second Gallery experiment").toBe(1);
  expect(galleries[0]!.members.length, "the second card's table+graph did not join the Gallery experiment").toBe(4);

  expect(await app.consoleErrors()).toEqual([]);
});
