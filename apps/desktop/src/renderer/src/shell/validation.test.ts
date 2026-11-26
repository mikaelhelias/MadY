import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { methodValidation, validationStatement } from "./validation";

// The engine and the independent battery, read as source: the badge must describe them,
// not a hand-kept list that falls behind as methods and cross-checks are added.
const pyDir = new URL("../../../../../../engines/py/", import.meta.url);
const engineSrc = readFileSync(fileURLToPath(new URL("engine.py", pyDir)), "utf8");
const crosscheckSrc = readFileSync(fileURLToPath(new URL("crosscheck.py", pyDir)), "utf8");

/** Every method the engine dispatches, minus the health check and the one-way alias. */
function engineMethods(): string[] {
  const block = /^METHODS = \{([\s\S]*?)^\}/m.exec(engineSrc);
  if (!block) throw new Error("METHODS table not found in engine.py");
  const keys = [...block[1]!.matchAll(/^\s+"([a-z0-9]+)":/gm)].map((m) => m[1]!);
  return keys.filter((k) => k !== "ping" && k !== "anova1");
}

/** A method is in the battery when crosscheck.py calls it (anova is dispatched as anova1 too). */
function inBattery(method: string): boolean {
  const ids = method === "anova" ? ["anova", "anova1"] : [method];
  return ids.some((id) => crosscheckSrc.includes(`M["${id}"]`));
}

describe("methodValidation — accurate per-method metadata", () => {
  it("the engine table parses (a guard that reads nothing proves nothing)", () => {
    expect(engineMethods().length).toBeGreaterThan(40);
    expect(engineMethods()).toContain("varpart");
  });

  it("every engine method carries a badge", () => {
    const missing = engineMethods().filter((m) => !methodValidation(m));
    expect(missing).toEqual([]);
    expect(methodValidation("not_a_method")).toBeUndefined();
  });

  it("crossChecked says exactly what the independent battery does", () => {
    const wrong = engineMethods().filter((m) => methodValidation(m) && methodValidation(m)!.crossChecked !== inBattery(m));
    expect(wrong).toEqual([]);
  });

  it("two-way ANOVA is MadY's own closed form, not statsmodels", () => {
    // engine.py's twoway never calls statsmodels anova_lm, so the badge must not say it does.
    expect(methodValidation("twoway")!.computedWith).toBe(false);
  });

  it("every entry carries at least one reference + a non-empty basis", () => {
    for (const m of engineMethods()) {
      const v = methodValidation(m)!;
      expect(v.references.length).toBeGreaterThan(0);
      expect(v.basis.length).toBeGreaterThan(0);
    }
  });
});

describe("validationStatement — a citeable sentence", () => {
  it("names the title + references; the 'independent cross-check' clause tracks crossChecked", () => {
    const t = validationStatement("Unpaired t test", methodValidation("ttest")!);
    expect(t).toContain("Unpaired t test");
    expect(t).toContain("SciPy");
    expect(t).toContain("independently cross-checked"); // ttest is in the battery
    // A method without an independent cross-check gets the other wording, which has to read right too.
    const c = validationStatement("Clustering", { computedWith: false, references: ["k-means"], crossChecked: false, basis: "x" });
    expect(c).not.toContain("independently cross-checked");
    expect(c).toContain("test suite");
  });
});
