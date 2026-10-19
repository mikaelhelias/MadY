/**
 * Opt-in skip: skipped in every ordinary run because it needs an installed local model (`MADY_REAL_MODEL`, e.g. gemma4:12b). The default
 *    build has no language model (only `MADY_LLM=1` does), and a test run never downloads anything.
 *
 * Opt-in: prints what the real local model does with ordinary requests on the demo project.
 *
 *     MADY_REAL_MODEL=gemma4:12b npx vitest run modelCompile.real
 *
 * Prints route · time · result for each line, then executes the commands on the demo document
 * so a command the document refuses is visible too.
 */
import { describe, expect, it } from "vitest";
import { createSampleDocument, executeAgentBatch, type NLContext } from "@mady/core";
import { compileLine } from "./modelCompile";

const MODEL = process.env.MADY_REAL_MODEL;
const LINES = [
  "change the y axis title to Response (%)",
  "make the points red",
  "add the title Dose response curve",
  "log scale on the x axis",
  "make it a bar chart",
  "hide the legend",
  "make all the text bigger",
  "fit a dose-response curve to the data",
  "set the y axis from 0 to 120",
  "make the line thicker",
  "show the grid",
  "use the viridis colour scheme",
  "run a t-test between the first two columns",
  "turn the markers into squares",
  "make the graph wider",
  "remove the error bars",
];

describe.skipIf(!MODEL)("the real model on the demo project (opt-in)", () => {
  it("answers every line and prints what each one did", async () => {
    const doc = createSampleDocument();
    const p = doc.toJSON();
    const plot = p.plots.find((x) => x.name === "Dose-response")!;
    const ctx: NLContext = {
      tables: p.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns.map((c) => ({ id: c.id, name: c.name })) })),
      activeTableId: plot.source,
      activeGraphId: plot.id,
    };
    const rows: string[] = [];
    for (const line of LINES) {
      const t0 = Date.now();
      const r = await compileLine(line, ctx, { url: "http://127.0.0.1:11434", model: MODEL!, timeoutMs: 120_000 });
      const ms = Date.now() - t0;
      if (!r.ok) {
        rows.push(`${String(ms).padStart(6)} ms | REFUSED | ${line} => ${r.error}`);
        continue;
      }
      const route = r.note ? "model " : "parser";
      const results = executeAgentBatch(doc, r.commands);
      const applied = results.map((x) => (x.ok ? "ok" : `FAIL(${x.error})`)).join(", ");
      rows.push(`${String(ms).padStart(6)} ms | ${route} | ${line} => ${JSON.stringify(r.commands).slice(0, 220)} :: ${applied}`);
    }
    console.log("\n" + rows.join("\n") + "\n");
    expect(rows.length).toBe(LINES.length);
  }, 600_000);
});
