import { describe, expect, it } from "vitest";
import { DISPLAY_ONLY_EQUATIONS, fitEquation, fitModelTemplate, FIT_MODEL_EQUATION } from "./fitEquation";
import { compileFormula } from "./formula";

/** Evaluate a display equation ("Y = …") at a given X via the formula engine —
 *  the same parser the app uses — after mapping the display glyphs (·, −, ², ³) to
 *  its ASCII operators. `X` is column index 23 in a FormulaEnv row. */
function evalAt(displayEq: string, x: number): number | null {
  const src = displayEq
    .replace(/^Y\s*=\s*/, "")
    .replace(/·/g, "*")
    .replace(/−/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/√/g, "SQRT");
  const c = compileFormula(src);
  if (!c.ok) throw new Error(`compile failed for "${src}": ${c.error}`);
  const row: (number | null)[] = [];
  row[23] = x;
  return c.eval({ row, colVals: [] });
}

describe("fitEquation — exact display strings", () => {
  it("linear regression: Y = a·X + b (sign-aware intercept)", () => {
    expect(fitEquation("regression", undefined, { slope: 2, intercept: 3 })).toBe("Y = 2·X + 3");
    expect(fitEquation("regression", undefined, { slope: 1.5, intercept: -0.5 })).toBe("Y = 1.5·X − 0.5");
    // a "linear" curve fit takes the same branch.
    expect(fitEquation("curvefit", "linear", { slope: 2, intercept: 3 })).toBe("Y = 2·X + 3");
  });

  it("Michaelis-Menten + one-site binding (rectangular hyperbola)", () => {
    expect(fitEquation("curvefit", "mm", { vmax: 100, km: 10 })).toBe("Y = 100·X / (10 + X)");
    expect(fitEquation("curvefit", "onesite", { bmax: 200, kd: 5 })).toBe("Y = 200·X / (5 + X)");
  });

  it("dose-response 3PL / 4PL / 5PL in raw concentration (EC50 = 10^logEC50)", () => {
    expect(fitEquation("curvefit", "3pl", { bottom: 10, top: 110, logec50: 2 })).toBe("Y = 10 + (110 − 10) / (1 + 100/X)");
    expect(fitEquation("curvefit", "4pl", { bottom: 0, top: 100, logec50: 1, hill_slope: 2 })).toBe("Y = 0 + (100 − 0) / (1 + (10/X)^2)");
    expect(fitEquation("curvefit", "5pl", { bottom: 0, top: 100, logec50: 1, hill_slope: 1, asymmetry: 2 })).toBe("Y = 0 + (100 − 0) / (1 + 10/X)^2");
  });

  it("one-phase exponential decay", () => {
    expect(fitEquation("curvefit", "exp_decay", { y0: 100, plateau: 0, k: 1 })).toBe("Y = 0 + (100 − 0)·exp(−1·X)");
  });

  it("returns null for model-free / untemplated models, non-fit methods, and missing params", () => {
    expect(fitEquation("curvefit", "lowess", { n: 20 })).toBeNull();
    expect(fitEquation("curvefit", "spline", { n: 20 })).toBeNull();
    expect(fitEquation("curvefit", "gaussian", { bottom: 0 })).toBeNull(); // no template → fall back to summary
    expect(fitEquation("ttest", undefined, { p: 0.01 })).toBeNull();
    expect(fitEquation("regression", undefined, { slope: 2 })).toBeNull(); // intercept missing
    expect(fitEquation("curvefit", "mm", { vmax: 100 })).toBeNull(); // km missing
  });
});

describe("fitEquation — self-validation (the generated equation reproduces the model)", () => {
  const XS = [0.5, 1, 2, 5, 10, 50];
  const check = (eq: string, model: (x: number) => number): void => {
    for (const x of XS) {
      const got = evalAt(eq, x);
      expect(got).not.toBeNull();
      expect(got!).toBeCloseTo(model(x), 6);
    }
  };

  it("linear", () => {
    check(fitEquation("regression", undefined, { slope: 2, intercept: 3 })!, (x) => 2 * x + 3);
    check(fitEquation("regression", undefined, { slope: 1.5, intercept: -0.5 })!, (x) => 1.5 * x - 0.5);
  });
  it("Michaelis-Menten & one-site binding", () => {
    check(fitEquation("curvefit", "mm", { vmax: 100, km: 10 })!, (x) => (100 * x) / (10 + x));
    check(fitEquation("curvefit", "onesite", { bmax: 200, kd: 5 })!, (x) => (200 * x) / (5 + x));
  });
  it("dose-response 3PL / 4PL / 5PL (raw-X form)", () => {
    check(fitEquation("curvefit", "3pl", { bottom: 10, top: 110, logec50: 2 })!, (x) => 10 + (110 - 10) / (1 + 100 / x));
    check(fitEquation("curvefit", "4pl", { bottom: 0, top: 100, logec50: 1, hill_slope: 2 })!, (x) => 0 + (100 - 0) / (1 + (10 / x) ** 2));
    check(
      fitEquation("curvefit", "5pl", { bottom: 0, top: 100, logec50: 1, hill_slope: 1, asymmetry: 2 })!,
      (x) => 0 + (100 - 0) / (1 + (10 / x) ** 1) ** 2,
    );
  });
  it("one-phase exponential decay", () => {
    check(fitEquation("curvefit", "exp_decay", { y0: 100, plateau: 0, k: 1 })!, (x) => 0 + (100 - 0) * Math.exp(-1 * x));
  });
});

describe("fitModelTemplate — symbolic previews reproduce the engine model", () => {
  const XS = [0.5, 1, 2, 5, 10, 50];
  // Every model whose template we've substitution-validated below — so a newly added
  // FIT_MODEL_EQUATION entry can't ship without a check (asserted at the end).
  const validated = new Set<string>();

  // Substitute concrete values for the parameter NAMES in a template (longest name
  // first, whole-word) then evaluate the resulting numeric equation and compare to an
  // INDEPENDENT re-derivation of the model (transcribed from engine.py `_nl_models`).
  const check = (model: string, vals: Record<string, number>, fn: (x: number) => number): void => {
    validated.add(model);
    const tpl = fitModelTemplate("curvefit", model);
    expect(tpl, `no template for ${model}`).toBeTruthy();
    let src = tpl!.replace(/^Y\s*=\s*/, "");
    for (const name of Object.keys(vals).sort((a, b) => b.length - a.length)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      src = src.replace(new RegExp(`\\b${esc}\\b`, "g"), `(${vals[name]})`);
    }
    for (const x of XS) {
      const got = evalAt(`Y = ${src}`, x);
      expect(got, `${model}: token left unsubstituted in "${src}"`).not.toBeNull();
      expect(got!, `${model} at X=${x}`).toBeCloseTo(fn(x), 6);
    }
  };

  it("lines", () => {
    check("linear", { Slope: 2, Intercept: 3 }, (x) => 2 * x + 3);
    check("line_origin", { Slope: 2 }, (x) => 2 * x);
  });
  it("enzyme kinetics", () => {
    check("mm", { Vmax: 100, KM: 10 }, (x) => (100 * x) / (10 + x));
    check("kcat", { Et: 2, kcat: 50, KM: 10 }, (x) => (2 * 50 * x) / (10 + x));
    check("allosteric", { Vmax: 100, Khalf: 10, h: 2 }, (x) => (100 * x ** 2) / (10 ** 2 + x ** 2));
    check("substrate_inhibition", { Vmax: 100, KM: 10, Ki: 50 }, (x) => (100 * x) / (10 + x * (1 + x / 50)));
    // Morrison tight-binding Ki — the quadratic root branch. With Et=5/Ki=2 the
    // discriminant (X² − 6X + 49) is positive for every X, so no clamping is in play.
    check("morrison_ki", { V0: 100, Et: 5, Ki: 2 }, (x) =>
      100 * (1 - (5 + x + 2 - Math.sqrt((5 + x + 2) ** 2 - 4 * 5 * x)) / (2 * 5)));
  });

  it("enzyme mechanism inhibition (global fit — I is a per-dataset constant)", () => {
    // I = [inhibitor] is substituted like a parameter here purely to evaluate the form;
    // in the engine it is a per-dataset CONSTANT, which is why these are display-only.
    check("competitive_inhibition", { Vmax: 100, KM: 10, Ki: 4, I: 8 }, (x) => (100 * x) / (10 * (1 + 8 / 4) + x));
    check("noncompetitive_inhibition", { Vmax: 100, KM: 10, Ki: 4, I: 8 }, (x) => (100 * x) / ((10 + x) * (1 + 8 / 4)));
    check("uncompetitive_inhibition", { Vmax: 100, KM: 10, Ki: 4, I: 8 }, (x) => (100 * x) / (10 + x * (1 + 8 / 4)));
    check("mixed_inhibition", { Vmax: 100, KM: 10, Ki: 4, Alpha: 3, I: 8 }, (x) =>
      (100 * x) / (10 * (1 + 8 / 4) + x * (1 + 8 / (3 * 4))));
  });

  it("integrated MM progress curve is displayed in its implicit form", () => {
    // Implicit in Y (the engine solves it via Lambert-W), so there is no "Y = f(X)" to
    // substitute and evaluate — assert the form directly, as probit_dr does for Phi.
    const tpl = fitModelTemplate("curvefit", "enzyme_progress")!;
    expect(tpl).toBe("Vmax·X = KM·ln(S0 / (S0 − Y)) + Y");
    validated.add("enzyme_progress");
  });
  it("binding", () => {
    check("onesite", { Bmax: 200, Kd: 5 }, (x) => (200 * x) / (5 + x));
    check("hill_binding", { Bmax: 200, Kd: 5, h: 2 }, (x) => (200 * x ** 2) / (5 ** 2 + x ** 2));
    check("twosite", { Bmax1: 60, Kd1: 3, Bmax2: 40, Kd2: 30 }, (x) => (60 * x) / (3 + x) + (40 * x) / (30 + x));
    check("onesite_ns", { Bmax: 200, Kd: 5, NS: 0.5 }, (x) => (200 * x) / (5 + x) + 0.5 * x);
    check("hyperbola_offset", { Background: 10, Bmax: 200, Kd: 5 }, (x) => 10 + (200 * x) / (5 + x));
  });
  it("dose-response — activation (EC50)", () => {
    const dr = (b: number, t: number, ec: number, h: number) => (x: number) => b + (t - b) / (1 + (ec / x) ** h);
    check("3pl", { Bottom: 10, Top: 110, EC50: 100 }, dr(10, 110, 100, 1));
    check("4pl", { Bottom: 0, Top: 100, EC50: 10, HillSlope: 2 }, dr(0, 100, 10, 2));
    check("5pl", { Bottom: 0, Top: 100, EC50: 10, HillSlope: 1, Asymmetry: 2 }, (x) => 0 + (100 - 0) / (1 + (10 / x) ** 1) ** 2);
    // concentration-X forms (engine writes these as Hill hyperbolas — algebraically the same)
    check("dr_3pl_conc", { Bottom: 10, Top: 110, EC50: 100 }, (x) => 10 + ((110 - 10) * x) / (100 + x));
    check("dr_4pl_conc", { Bottom: 0, Top: 100, EC50: 10, HillSlope: 2 }, (x) => 0 + ((100 - 0) * x ** 2) / (10 ** 2 + x ** 2));
    check("dr_5pl_conc", { Bottom: 0, Top: 100, EC50: 10, HillSlope: 1, Asymmetry: 2 }, (x) => 0 + (100 - 0) / (1 + (10 / x) ** 1) ** 2);
  });
  it("dose-response - normalized and flexible models", () => {
    check("dr_norm_3pl", { EC50: 10 }, (x) => 100 / (1 + 10 / x));
    check("dr_norm_4pl", { EC50: 10, HillSlope: 2 }, (x) => 100 / (1 + (10 / x) ** 2));
    check("dr_norm_3pl_conc", { EC50: 10 }, (x) => (100 * x) / (10 + x));
    check("dr_norm_4pl_conc", { EC50: 10, HillSlope: 2 }, (x) => (100 * x ** 2) / (10 ** 2 + x ** 2));
    check("ic50_norm_3pl", { IC50: 10 }, (x) => 100 / (1 + x / 10));
    check("ic50_norm_4pl", { IC50: 10, HillSlope: 2 }, (x) => 100 / (1 + (x / 10) ** 2));
    check("biphasic_dr", { Bottom: 0, Top: 100, Frac: 0.4, EC50_1: 2, nH1: 1, EC50_2: 20, nH2: 2 }, (x) => 100 * (0.4 / (1 + (2 / x)) + 0.6 / (1 + (20 / x) ** 2)));
    check("biphasic_dr_conc", { Bottom: 0, Top: 100, Frac: 0.4, EC50_1: 2, nH1: 1, EC50_2: 20, nH2: 2 }, (x) => 100 * (0.4 / (1 + (2 / x)) + 0.6 / (1 + (20 / x) ** 2)));
    check("bell_dr", { Base: 1, Amplitude: 10, EC50_up: 2, nH_up: 1, EC50_down: 20, nH_down: 2 }, (x) => 1 + 10 / (1 + 2 / x) / (1 + (x / 20) ** 2));
    check("bell_dr_conc", { Base: 1, Amplitude: 10, EC50_up: 2, nH_up: 1, EC50_down: 20, nH_down: 2 }, (x) => 1 + 10 / (1 + 2 / x) / (1 + (x / 20) ** 2));
    check("hormesis_bc", { Bottom: 0, Top: 100, f: 0.1, EC50: 10, Slope: 1.5 }, (x) => (100 + 0.1 * x) / (1 + (10 / x) ** 1.5));
    check("weibull_sigmoid", { Bottom: 0, Top: 100, Scale: 10, Shape: 2 }, (x) => 100 * (1 - Math.exp(-((x / 10) ** 2))));
    check("richards_dr", { Bottom: 0, Top: 100, nu: 1.2, Rate: 0.5, Midpoint: 5 }, (x) => 100 / (1 + 1.2 * Math.exp(-0.5 * (x - 5))) ** (1 / 1.2));
    expect(fitModelTemplate("curvefit", "probit_dr")).toContain("Phi");
    // Phi is a display-only special function not implemented by the formula-column parser.
    validated.add("probit_dr");
  });
  it("dose-response — inhibition (IC50)", () => {
    const inh = (b: number, t: number, ic: number, h: number) => (x: number) => b + (t - b) / (1 + (x / ic) ** h);
    check("ic50_3pl_log", { Bottom: 0, Top: 100, IC50: 10 }, inh(0, 100, 10, 1));
    check("ic50_4pl_log", { Bottom: 0, Top: 100, IC50: 10, HillSlope: 2 }, inh(0, 100, 10, 2));
    check("ic50_3pl_conc", { Bottom: 0, Top: 100, IC50: 10 }, inh(0, 100, 10, 1));
    check("ic50_4pl_conc", { Bottom: 0, Top: 100, IC50: 10, HillSlope: 2 }, inh(0, 100, 10, 2));
  });
  it("exponential", () => {
    check("exp_decay", { Y0: 100, Plateau: 0, K: 1 }, (x) => 0 + (100 - 0) * Math.exp(-1 * x));
    check("exp_assoc", { Y0: 0, Plateau: 100, K: 1 }, (x) => 0 + (100 - 0) * (1 - Math.exp(-1 * x)));
    check("exp_growth", { Y0: 5, K: 0.1 }, (x) => 5 * Math.exp(0.1 * x));
    check("exp_decay2", { Plateau: 0, SpanFast: 80, Kfast: 1, SpanSlow: 20, Kslow: 0.1 }, (x) => 0 + 80 * Math.exp(-1 * x) + 20 * Math.exp(-0.1 * x));
  });
  it("growth / sigmoidal", () => {
    check("gompertz", { Asymptote: 100, Displacement: 2, Rate: 0.5 }, (x) => 100 * Math.exp(-2 * Math.exp(-0.5 * x)));
    check("logistic_growth", { Capacity: 100, Rate: 1, Midpoint: 5 }, (x) => 100 / (1 + Math.exp(-1 * (x - 5))));
    check("boltzmann", { Bottom: 0, Top: 100, V50: 5, Slope: 2 }, (x) => 0 + (100 - 0) / (1 + Math.exp((5 - x) / 2)));
  });
  it("peaks", () => {
    check("gaussian", { Amplitude: 5, Mean: 3, SD: 2 }, (x) => 5 * Math.exp(-0.5 * ((x - 3) / 2) ** 2));
    check("lorentzian", { Amplitude: 5, Center: 3, Width: 2 }, (x) => 5 / (1 + ((x - 3) / 2) ** 2));
  });
  it("polynomial / power", () => {
    check("poly2", { B0: 1, B1: 2, B2: 3 }, (x) => 1 + 2 * x + 3 * x ** 2);
    check("poly3", { B0: 1, B1: 2, B2: 3, B3: 0.5 }, (x) => 1 + 2 * x + 3 * x ** 2 + 0.5 * x ** 3);
    check("power", { A: 2, B: 1.5 }, (x) => 2 * x ** 1.5);
    check("power_offset", { A: 2, B: 1.5, C: 3 }, (x) => 2 * x ** 1.5 + 3);
  });

  it("every FIT_MODEL_EQUATION template is validated above (no un-checked template ships)", () => {
    for (const m of Object.keys(FIT_MODEL_EQUATION)) expect(validated.has(m), `template "${m}" is not validated`).toBe(true);
  });

  it("display-only equations are exactly those not reproducible as a single-curve fit", () => {
    // Guards script export: an equation that is implicit in Y, or that carries a symbol
    // which is NOT a fitted parameter, must be flagged — otherwise scriptExport emits a
    // curve_fit that silently fits the wrong model.
    for (const m of DISPLAY_ONLY_EQUATIONS) {
      expect(FIT_MODEL_EQUATION[m], `display-only "${m}" has no equation`).toBeTruthy();
    }
    // Every entry carrying a bare "I" (per-dataset [inhibitor]) must be display-only.
    for (const [m, eq] of Object.entries(FIT_MODEL_EQUATION)) {
      if (/\bI\b/.test(eq.replace(/^Y\s*=\s*/, ""))) {
        expect(DISPLAY_ONLY_EQUATIONS.has(m), `"${m}" carries [I] but is not display-only`).toBe(true);
      }
    }
    // …and every entry that is not of the form "Y = …" is implicit, so display-only.
    for (const [m, eq] of Object.entries(FIT_MODEL_EQUATION)) {
      if (!/^Y\s*=/.test(eq)) expect(DISPLAY_ONLY_EQUATIONS.has(m), `implicit "${m}" is not display-only`).toBe(true);
    }
  });

  it("gates to fit methods; hides custom / smoothers / untemplated / regression", () => {
    expect(fitModelTemplate("curvefit", "mm")).toBe("Y = Vmax·X / (KM + X)");
    expect(fitModelTemplate("interpolate", "4pl")).toContain("EC50");
    expect(fitModelTemplate("globalfit", "mm")).toBeTruthy();
    expect(fitModelTemplate("comparefits", "3pl")).toBeTruthy();
    expect(fitModelTemplate("curvefit", "custom")).toBeNull();
    expect(fitModelTemplate("curvefit", "lowess")).toBeNull();
    expect(fitModelTemplate("curvefit", undefined)).toBeNull();
    expect(fitModelTemplate("ttest", "mm")).toBeNull();
    expect(fitModelTemplate("regression", "linear")).toBeNull();
  });
});
