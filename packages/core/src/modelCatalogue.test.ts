/**
 * The model catalogue — the Gemma 4 variants MadY offers, with the sizes the dialog states and
 * the rule that picks one for this computer without asking. Shared by main (status/pick) and
 * the renderer (the dialog), so the two cannot disagree about a tag or a number.
 */
import { describe, expect, it } from "vitest";
import { GiB, MODEL_CATALOGUE, MEASURED_MODEL, modelByTag, pickModelForMemory } from "./modelCatalogue";

describe("the catalogue", () => {
  it("uses Ollama's real tags (gemma4:<size>), never a dashed spelling such as gemma-4-e2b", () => {
    for (const m of MODEL_CATALOGUE) {
      expect(m.tag).toMatch(/^gemma4:(e2b|e4b|12b)$/);
    }
    expect(MODEL_CATALOGUE.map((m) => m.tag)).toEqual(["gemma4:e2b", "gemma4:e4b", "gemma4:12b"]);
  });

  it("every entry states its expected download in bytes (from the registry manifest) and a one-sentence blurb", () => {
    for (const m of MODEL_CATALOGUE) {
      expect(m.expectedBytes).toBeGreaterThan(5 * GiB);
      expect(m.expectedBytes).toBeLessThan(10 * GiB);
      expect(m.blurb.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
      expect(m.blurb.toLowerCase()).not.toContain("small");
      expect(m.parameters).toMatch(/^\d+(\.\d+)?B$/);
    }
  });

  it("the measured model is in the catalogue and is the 12B", () => {
    expect(MEASURED_MODEL).toBe("gemma4:12b");
    expect(modelByTag(MEASURED_MODEL)?.measured).toBe(true);
    expect(MODEL_CATALOGUE.filter((m) => m.measured).length).toBe(1);
  });

  it("modelByTag finds by exact tag and returns undefined otherwise", () => {
    expect(modelByTag("gemma4:e2b")?.parameters).toBe("5.1B");
    expect(modelByTag("gemma-4-e2b")).toBeUndefined();
  });
});

describe("pickModelForMemory — the measured model whenever it fits, the smaller one when only it fits, else a clear refusal", () => {
  it("a 16 GiB machine gets the 12B", () => {
    const p = pickModelForMemory(16 * GiB);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.model.tag).toBe("gemma4:12b");
      expect(p.reason).toMatch(/16/);
    }
  });

  it("a 32 GiB machine still gets the 12B — bigger memory is not a reason to pick the unmeasured E4B", () => {
    const p = pickModelForMemory(32 * GiB);
    expect(p.ok && p.model.tag).toBe("gemma4:12b");
  });

  it("just under the 12B's need but over the E2B's, the E2B is picked", () => {
    const e2b = modelByTag("gemma4:e2b")!;
    const b12 = modelByTag("gemma4:12b")!;
    const mem = (e2b.expectedBytes + b12.expectedBytes) / 2 + 3 * GiB; // between the two needs
    const p = pickModelForMemory(mem);
    expect(p.ok && p.model.tag).toBe("gemma4:e2b");
  });

  it("an 8 GiB machine gets a refusal that names the machine's memory and the smallest need — never a model that cannot load", () => {
    const p = pickModelForMemory(8 * GiB);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.reason).toMatch(/8(\.0)? GiB/);
      expect(p.reason).toMatch(/needs about/);
    }
  });

  it("the need is the download plus headroom for the OS and the working memory — never the bare file size", () => {
    const b12 = modelByTag("gemma4:12b")!;
    // Exactly the file size of memory: cannot run.
    expect(pickModelForMemory(b12.expectedBytes).ok).toBe(false);
    // File size + the stated headroom: can.
    expect(pickModelForMemory(b12.expectedBytes + b12.headroomBytes).ok).toBe(true);
  });
});
