import { expect, test } from "@playwright/test";
import { MadyApp } from "./app";

/**
 * Replicates and data entry are offered for sample data too. They must be present,
 * seeded from the example's own shape (not a blank sheet's defaults, or merely ticking the box
 * would promise to bolt empty sub-columns on), and a change must really restructure the created
 * datasheet while keeping its values.
 */
test("Data entry + Replicates apply to sample data, and reshape the example without losing it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const app = new MadyApp(page);
  await app.open();
  await app.menu("Graph", "New graph…");
  await page.locator(".ng-segbtn", { hasText: "Graph + datasheet" }).click();
  await app.settle();
  await page.locator('[data-genre="xy"]').click();
  await app.settle();
  await page.locator('input[aria-label="Start with sample data"]').check();
  await app.settle();

  const present = await page.evaluate(() => {
    const cfg = document.querySelector(".ng-config")!;
    const de = cfg.querySelector<HTMLSelectElement>('select[aria-label="Data entry"]');
    const rp = cfg.querySelector<HTMLInputElement>('input[aria-label="Replicates"]');
    return { dataEntry: de?.value ?? null, replicates: rp?.value ?? null,
             rows: [...cfg.children].map((e) => (e.querySelector("span")?.textContent ?? "").trim()).filter(Boolean) };
  });
  console.log("@@@ controls " + JSON.stringify(present));
  expect(present.dataEntry, "Data entry missing with sample data on").toBe("replicates");
  expect(present.replicates, "Replicates missing / not seeded from the sample").toBe("1");

  await page.locator('input[aria-label="Replicates"]').fill("4");
  await app.settle();
  await page.locator(".modalbtns .btn").click();
  await app.settle();
  await page.waitForTimeout(700);

  const proj = await app.project();
  const tables = (proj.tables ?? []) as Array<Record<string, any>>;
  const t = tables[tables.length - 1]!;
  const filledRows = t.rows.filter((r: any) => Object.values(r.cells ?? {}).some((v: any) => v !== "" && v != null)).length;
  console.log("created table cols=" + t.columns.length + " rows=" + t.rows.length + " filledRows=" + filledRows);
  expect(t.columns.length, "the replicate pick did not reshape the created sample").toBeGreaterThan(3);
  expect(filledRows, "the worked example lost its data").toBeGreaterThan(0);
  expect(await app.consoleErrors()).toEqual([]);
});
