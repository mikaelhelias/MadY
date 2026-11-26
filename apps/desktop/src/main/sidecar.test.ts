import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SidecarError, SidecarSupervisor } from "./sidecar";

const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const pythonCommand = process.platform === "win32" ? "py" : "python3";
// `py -3` rather than `py`: given a script and no version, the Windows launcher follows the
// script's `#!` line and can pick another Python found on PATH, one without the packages.
const pyArgs = process.platform === "win32" ? ["-3"] : [];

function makeSupervisor(): SidecarSupervisor {
  return new SidecarSupervisor({ command: pythonCommand, args: [...pyArgs, enginePath], startTimeoutMs: 30_000 });
}

describe("SidecarSupervisor (real Python engine)", () => {
  // Transport + crash tests use the dependency-free `ping` so they hold even where
  // NumPy/SciPy is absent; numeric validation lives in engine.test.ts (scipy-guarded).
  it("round-trips a request end-to-end", async () => {
    const sup = makeSupervisor();
    try {
      const results = await sup.request("ping", { echo: 42 });
      expect(results["pong"]).toBe(true);
      expect(results["echo"]).toBe(42);
    } finally {
      await sup.stop();
    }
  }, 20_000);

  it("surfaces a typed engine_crash and transparently respawns on the next request", async () => {
    const sup = makeSupervisor();
    try {
      await sup.request("ping"); // initial start
      await expect(sup.request("crash")).rejects.toMatchObject({ code: "engine_crash" });
      // engine crashed; a fresh request must transparently start a new engine
      const results = await sup.request("ping", { echo: "ok" });
      expect(results["echo"]).toBe("ok");
    } finally {
      await sup.stop();
    }
  }, 20_000);

  it("returns a typed error for an unknown method", async () => {
    const sup = makeSupervisor();
    try {
      await expect(sup.request("does_not_exist")).rejects.toBeInstanceOf(SidecarError);
      await expect(sup.request("does_not_exist")).rejects.toMatchObject({
        code: "unsupported_method",
      });
    } finally {
      await sup.stop();
    }
  }, 20_000);
});
