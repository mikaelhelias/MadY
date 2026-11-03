import { describe, expect, it } from "vitest";
import { EngineClient, resolveEngine } from "./engineClient";
import { MadySession } from "./session";

describe("resolveEngine", () => {
  it("prefers a frozen engine binary when MADY_ENGINE_EXE is set", () => {
    const r = resolveEngine({ MADY_ENGINE_EXE: "/opt/mady/mady-engine" } as NodeJS.ProcessEnv);
    expect(r).toEqual({ command: "/opt/mady/mady-engine", args: [] });
  });

  it("honours MADY_ENGINE_CMD + MADY_ENGINE_SCRIPT", () => {
    const r = resolveEngine({ MADY_ENGINE_CMD: "python3.12", MADY_ENGINE_SCRIPT: "/x/engine.py" } as NodeJS.ProcessEnv);
    expect(r).toEqual({ command: "python3.12", args: ["/x/engine.py"] });
  });

  it("falls back to finding engines/py/engine.py in the repo", () => {
    const r = resolveEngine({} as NodeJS.ProcessEnv);
    expect(r.args).toHaveLength(process.platform === "win32" ? 2 : 1);
    if (process.platform === "win32") expect(r.args[0], "the Windows launcher is told the version").toBe("-3");
    expect(r.args.at(-1)!.replace(/\\/g, "/")).toMatch(/engines\/py\/engine\.py$/);
  });
});

// Real-engine integration — mirrors apps/desktop engine.test.ts (spawns `py engine.py`).
// Requires a local Python with numpy/scipy, exactly as the desktop dev engine does.
describe("EngineClient (real stats engine)", () => {
  it("computes describe end-to-end", async () => {
    const client = new EngineClient(resolveEngine());
    try {
      const r = await client.request("describe", { values: [1, 2, 3, 4], conf: 0.95 });
      // The tidy contract carries a numeric mean somewhere in its terms/summary.
      expect(r).toBeTruthy();
      expect(JSON.stringify(r)).toContain("2.5");
    } finally {
      await client.stop();
    }
  }, 30_000);

  it("session.compute runs a configured analysis against the real engine and stores it", async () => {
    const session = new MadySession();
    try {
      session.exec({ op: "createTable", name: "T", columns: ["v"], rows: [[1], [2], [3], [4]] });
      const table = session.document.toJSON().tables[0]!;
      const analysis = session.exec({
        op: "runAnalysis",
        name: "Describe",
        method: "describe",
        table: table.id,
        params: { columns: [table.columns[0]!.id], conf: 0.95 },
      }) as { ok: true; value: { id: string } };

      const res = await session.compute({ analysisId: analysis.value.id });
      expect(res.ok).toBe(true);
      expect(res.stored).toBe(true);
      expect(session.document.toJSON().analyses[0]!.status).toBe("ok");
    } finally {
      await session.close();
    }
  }, 30_000);
});
