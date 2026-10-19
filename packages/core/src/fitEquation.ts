/**
 * Build a human-readable best-fit equation for a curve fit / regression, from the
 * fitted parameters the engine reports in `glance` (keyed by its normalised param
 * names, e.g. "logec50", "hill_slope") + the model id (`params.variant` for a
 * curvefit). Returns the equation as plain math text (·, ^, exp()) — the on-graph
 * "Show fit equation" label — or `null` when there's no closed form to show
 * (model-free smoothers, or a model without a template; the caller then falls back
 * to the fit's parameter-value summary).
 *
 * Covers the common regression + nonlinear families (linear, Michaelis-Menten,
 * one-site binding, 3/4/5-parameter dose-response, one-phase exponential decay).
 * Every returned equation is written in the raw-X form and validated in the tests
 * by evaluating it (via `formula.ts`) back onto the fitted model — so a template
 * typo can't ship silently. Adding a family = one `case` here.
 */

/** The `glance` scalar bag (numbers keyed by normalised param name). */
export type FitGlance = Record<string, number | string | null | undefined>;

/** Format a coefficient for display: 4 significant figures, no trailing cruft. */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return "?";
  return String(Number(v.toPrecision(4)));
}

/** A sign-aware additive term: " + 3" or " − 3" (uses a true minus sign). */
function addTerm(v: number): string {
  return v < 0 ? ` − ${fmt(-v)}` : ` + ${fmt(v)}`;
}

/** Read a numeric glance value, or undefined when absent / non-numeric. */
function num(g: FitGlance, key: string): number | undefined {
  const v = g[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * The best-fit equation string, or null if the model has no closed-form template.
 * `method` = the analysis method ("regression" | "curvefit" | …); `model` = the
 * nonlinear model id for a curvefit (from `params.variant`); `glance` = the fitted
 * parameter values.
 */
export function fitEquation(method: string, model: string | undefined, glance: FitGlance): string | null {
  const g = glance ?? {};

  // Linear: a linear regression, or a "linear" curve fit — both report slope + intercept.
  if (method === "regression" || (method === "curvefit" && model === "linear")) {
    const a = num(g, "slope");
    const b = num(g, "intercept");
    if (a === undefined || b === undefined) return null;
    return `Y = ${fmt(a)}·X${addTerm(b)}`;
  }

  if (method !== "curvefit") return null;

  switch (model) {
    case "mm": {
      // Michaelis-Menten enzyme kinetics.
      const vmax = num(g, "vmax");
      const km = num(g, "km");
      return vmax !== undefined && km !== undefined ? `Y = ${fmt(vmax)}·X / (${fmt(km)} + X)` : null;
    }
    case "onesite": {
      // One-site specific binding (saturation isotherm).
      const bmax = num(g, "bmax");
      const kd = num(g, "kd");
      return bmax !== undefined && kd !== undefined ? `Y = ${fmt(bmax)}·X / (${fmt(kd)} + X)` : null;
    }
    case "3pl":
    case "4pl":
    case "5pl": {
      // Dose-response logistic, written in raw concentration: EC50 = 10^logEC50, so
      // 10^((logEC50 − log₁₀X)·h) = (EC50/X)^h. 3PL fixes the Hill slope at 1.
      const bottom = num(g, "bottom");
      const top = num(g, "top");
      const logec50 = num(g, "logec50");
      if (bottom === undefined || top === undefined || logec50 === undefined) return null;
      const ec50 = Math.pow(10, logec50);
      const hill = model === "3pl" ? 1 : num(g, "hill_slope");
      if (hill === undefined) return null;
      const core = hill === 1 ? `${fmt(ec50)}/X` : `(${fmt(ec50)}/X)^${fmt(hill)}`;
      const span = `(${fmt(top)} − ${fmt(bottom)})`;
      if (model === "5pl") {
        const s = num(g, "asymmetry");
        if (s === undefined) return null;
        return `Y = ${fmt(bottom)} + ${span} / (1 + ${core})^${fmt(s)}`;
      }
      return `Y = ${fmt(bottom)} + ${span} / (1 + ${core})`;
    }
    case "exp_decay": {
      // One-phase exponential decay to a plateau.
      const y0 = num(g, "y0");
      const plateau = num(g, "plateau");
      const k = num(g, "k");
      if (y0 === undefined || plateau === undefined || k === undefined) return null;
      return `Y = ${fmt(plateau)} + (${fmt(y0)} − ${fmt(plateau)})·exp(−${fmt(k)}·X)`;
    }
    default:
      return null;
  }
}

/**
 * Symbolic model templates for the common curve-fit / regression equations —
 * parameter names, not fitted values — so the fit-config panel can show the
 * equation *before* it is run (unlike `fitEquation`, which needs the fitted
 * `glance` and returns null pre-fit). Written in the same raw-X display form
 * `fitEquation` prints once fitted, so the preview and the eventual best-fit
 * equation read consistently. A model without a template shows no preview (the
 * caller hides it). Every template is validated in the tests by substituting
 * concrete values and reproducing the engine model (`engine.py` `_nl_models`).
 *
 * Note the two dose-response directions: activation uses (EC50/X) — Y rises to
 * Top; inhibition uses (X/IC50) — Y falls to Bottom.
 */
export const FIT_MODEL_EQUATION: Record<string, string> = {
  // ── Lines ──
  linear: "Y = Slope·X + Intercept",
  line_origin: "Y = Slope·X",
  // ── Enzyme kinetics ──
  mm: "Y = Vmax·X / (KM + X)",
  kcat: "Y = Et·kcat·X / (KM + X)",
  allosteric: "Y = Vmax·X^h / (Khalf^h + X^h)",
  substrate_inhibition: "Y = Vmax·X / (KM + X·(1 + X/Ki))",
  morrison_ki: "Y = V0·(1 − ((Et + X + Ki) − √((Et + X + Ki)² − 4·Et·X)) / (2·Et))",
  // Integrated Michaelis-Menten (product vs time, with substrate depletion). This one is
  // implicit in Y — the engine solves it via Lambert-W — so it is display-only.
  enzyme_progress: "Vmax·X = KM·ln(S0 / (S0 − Y)) + Y",
  // ── Enzyme mechanism inhibition (global fit only) ──
  // I = [inhibitor], a per-dataset constant, not a fitted parameter — one curve per [I].
  // Fitting a single curve confounds KM with Ki, so these are display-only.
  competitive_inhibition: "Y = Vmax·X / (KM·(1 + I/Ki) + X)",
  noncompetitive_inhibition: "Y = Vmax·X / ((KM + X)·(1 + I/Ki))",
  uncompetitive_inhibition: "Y = Vmax·X / (KM + X·(1 + I/Ki))",
  mixed_inhibition: "Y = Vmax·X / (KM·(1 + I/Ki) + X·(1 + I/(Alpha·Ki)))",
  // ── Binding ──
  onesite: "Y = Bmax·X / (Kd + X)",
  hill_binding: "Y = Bmax·X^h / (Kd^h + X^h)",
  twosite: "Y = Bmax1·X / (Kd1 + X) + Bmax2·X / (Kd2 + X)",
  onesite_ns: "Y = Bmax·X / (Kd + X) + NS·X",
  hyperbola_offset: "Y = Background + Bmax·X / (Kd + X)",
  // ── Dose-response — activation (EC50) ──
  "3pl": "Y = Bottom + (Top − Bottom) / (1 + EC50/X)",
  "4pl": "Y = Bottom + (Top − Bottom) / (1 + (EC50/X)^HillSlope)",
  "5pl": "Y = Bottom + (Top − Bottom) / (1 + (EC50/X)^HillSlope)^Asymmetry",
  dr_3pl_conc: "Y = Bottom + (Top − Bottom) / (1 + EC50/X)",
  dr_4pl_conc: "Y = Bottom + (Top − Bottom) / (1 + (EC50/X)^HillSlope)",
  dr_5pl_conc: "Y = Bottom + (Top − Bottom) / (1 + (EC50/X)^HillSlope)^Asymmetry",
  // Dose-response - normalized
  dr_norm_3pl: "Y = 100 / (1 + EC50/X)",
  dr_norm_4pl: "Y = 100 / (1 + (EC50/X)^HillSlope)",
  dr_norm_3pl_conc: "Y = 100*X / (EC50 + X)",
  dr_norm_4pl_conc: "Y = 100*X^HillSlope / (EC50^HillSlope + X^HillSlope)",
  // ── Dose-response — inhibition (IC50) ──
  ic50_3pl_log: "Y = Bottom + (Top − Bottom) / (1 + X/IC50)",
  ic50_4pl_log: "Y = Bottom + (Top − Bottom) / (1 + (X/IC50)^HillSlope)",
  ic50_3pl_conc: "Y = Bottom + (Top − Bottom) / (1 + X/IC50)",
  ic50_4pl_conc: "Y = Bottom + (Top − Bottom) / (1 + (X/IC50)^HillSlope)",
  ic50_norm_3pl: "Y = 100 / (1 + X/IC50)",
  ic50_norm_4pl: "Y = 100 / (1 + (X/IC50)^HillSlope)",
  // Dose-response - flexible shapes
  biphasic_dr: "Y = Bottom + (Top - Bottom)*(Frac/(1 + (EC50_1/X)^nH1) + (1 - Frac)/(1 + (EC50_2/X)^nH2))",
  biphasic_dr_conc: "Y = Bottom + (Top - Bottom)*(Frac/(1 + (EC50_1/X)^nH1) + (1 - Frac)/(1 + (EC50_2/X)^nH2))",
  bell_dr: "Y = Base + Amplitude/(1 + (EC50_up/X)^nH_up)/(1 + (X/EC50_down)^nH_down)",
  bell_dr_conc: "Y = Base + Amplitude/(1 + (EC50_up/X)^nH_up)/(1 + (X/EC50_down)^nH_down)",
  hormesis_bc: "Y = Bottom + (Top - Bottom + f*X) / (1 + (EC50/X)^Slope)",
  probit_dr: "Y = Bottom + (Top - Bottom)*Phi((X - Mu)/Sigma)",
  weibull_sigmoid: "Y = Bottom + (Top - Bottom)*(1 - exp(-(X/Scale)^Shape))",
  richards_dr: "Y = Bottom + (Top - Bottom) / (1 + nu*exp(-Rate*(X - Midpoint)))^(1/nu)",
  // ── Exponential ──
  exp_decay: "Y = Plateau + (Y0 − Plateau)·exp(−K·X)",
  exp_assoc: "Y = Y0 + (Plateau − Y0)·(1 − exp(−K·X))",
  exp_growth: "Y = Y0·exp(K·X)",
  exp_decay2: "Y = Plateau + SpanFast·exp(−Kfast·X) + SpanSlow·exp(−Kslow·X)",
  // ── Growth / sigmoidal ──
  gompertz: "Y = Asymptote·exp(−Displacement·exp(−Rate·X))",
  logistic_growth: "Y = Capacity / (1 + exp(−Rate·(X − Midpoint)))",
  boltzmann: "Y = Bottom + (Top − Bottom) / (1 + exp((V50 − X)/Slope))",
  // ── Peaks ──
  gaussian: "Y = Amplitude·exp(−0.5·((X − Mean)/SD)²)",
  lorentzian: "Y = Amplitude / (1 + ((X − Center)/Width)²)",
  // ── Polynomial / power ──
  poly2: "Y = B0 + B1·X + B2·X²",
  poly3: "Y = B0 + B1·X + B2·X² + B3·X³",
  power: "Y = A·X^B",
  power_offset: "Y = A·X^B + C",
};

/**
 * Models whose `FIT_MODEL_EQUATION` entry is for display only — it must not be
 * mechanically translated into a single-curve `curve_fit` reproduction (script export).
 * Two reasons, both of which would otherwise emit a script that fits the wrong model:
 *  · `enzyme_progress` is implicit in Y (solved via Lambert-W), so it is not an
 *    expression in X at all.
 *  · the four mechanism-inhibition equations carry `I` = [inhibitor], a per-dataset
 *    constant. A naive translation reads `I` as a fittable parameter and produces a
 *    single-curve fit in which KM and Ki are confounded — what the global-fit-only rule
 *    exists to prevent.
 */
export const DISPLAY_ONLY_EQUATIONS: ReadonlySet<string> = new Set([
  "enzyme_progress",
  "competitive_inhibition",
  "noncompetitive_inhibition",
  "uncompetitive_inhibition",
  "mixed_inhibition",
]);

/**
 * The symbolic equation preview for a curve-fit / interpolate / compare / global-fit
 * model, shown before it is fitted (parameter names, not values) — or null when there
 * is no template (custom user equations, model-free smoothers, or an untemplated
 * model), so the caller hides the preview. `linear` is shared with regression's form.
 */
export function fitModelTemplate(method: string, model: string | undefined): string | null {
  if (method !== "curvefit" && method !== "interpolate" && method !== "comparefits" && method !== "globalfit")
    return null;
  if (!model) return null;
  return FIT_MODEL_EQUATION[model] ?? null;
}
