/**
 * Reproducible-analysis script export. Turns the project's
 * analyses into a standalone **Python** script that reconstructs each analysis's
 * input arrays and calls the same scipy/numpy primitives the engine uses — so a
 * reviewer can re-run the numbers without MadY. Pure + unit-tested; the data
 * arrays come straight from `buildAnalysisData` (the exact engine payload).
 */
import type { AnalysisParams, Project } from "@mady/core";
import { DISPLAY_ONLY_EQUATIONS, FIT_MODEL_EQUATION } from "@mady/core";
import { buildAnalysisData } from "./analysis";
import { methodLabel, VARIANTS } from "./AnalyzeDialog";

/** Format a JS number for Python (finite → literal; NaN → float('nan')). */
function pyNum(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "float('nan')";
}

/** A flat numeric array → a Python list literal. */
function pyList(xs: unknown): string {
  const arr = Array.isArray(xs) ? xs : [];
  return "[" + arr.map(pyNum).join(", ") + "]";
}

/** A 2-D numeric array → a Python list-of-lists (one row per line). */
function pyMatrix(rows: unknown): string {
  const rs = Array.isArray(rows) ? rows : [];
  return "[\n" + rs.map((r) => "    " + pyList(r) + ",").join("\n") + "\n]";
}

/** A 3-D numeric array (cells[A][B] = replicates) → a Python nested literal. */
function pyCells(cells: unknown): string {
  const rs = Array.isArray(cells) ? cells : [];
  const row = (r: unknown): string => "[" + (Array.isArray(r) ? r : []).map(pyList).join(", ") + "]";
  return "[" + rs.map(row).join(", ") + "]";
}

/** A single categorical/mixed cell value as a Python literal (str / number / None). */
function pyValue(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "float('nan')";
  return JSON.stringify(String(v)); // double-quoted → valid Python str
}

/** A list of categorical/mixed values → a Python list literal. */
function pyValueList(xs: unknown): string {
  return "[" + (Array.isArray(xs) ? xs : []).map(pyValue).join(", ") + "]";
}

/** Python expression for a regression weighting scheme's per-point sigma (weight ∝ 1/sigma²),
 *  mirroring the engine's `_nl_weights`. null = a scheme this script can't reproduce from x/y
 *  alone (e.g. 1/SD² needs per-point SD) → the caller emits the unweighted fit with a note. */
function pyRegressionSigma(scheme: string): string | null {
  switch (scheme) {
    case "1/Y2": case "1/YY": case "poisson": return "np.abs(y) + 1e-9";
    case "1/Y": return "np.sqrt(np.abs(y) + 1e-9)";
    case "1/X2": return "np.abs(x) + 1e-9";
    case "1/X": return "np.sqrt(np.abs(x) + 1e-9)";
    default: return null;
  }
}

/** Identifiers that are not fit parameters (the variable + numpy/math functions). */
const PY_NONPARAMS = new Set(["x", "np", "exp", "log", "ln", "log10", "sqrt", "sin", "cos", "tan", "pi", "abs"]);

/** The fit-parameter names of a Python model expression, in order of first appearance. */
function pyParams(expr: string): string[] {
  const out: string[] = [];
  for (const m of expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const id = m[0];
    if (!PY_NONPARAMS.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Translate a `FIT_MODEL_EQUATION` display form ("Y = Vmax·X / (KM + X)") to a Python
 *  expression in `x` + the fit parameters. The display forms are validated against the
 *  engine models (fitEquation tests), so the reproduction fits the same curve. */
function displayEqToPython(eq: string): string {
  return eq
    .replace(/^Y\s*=\s*/, "")
    .replace(/²/g, "**2") // ²
    .replace(/³/g, "**3") // ³
    .replace(/\^/g, "**")
    .replace(/·/g, "*") // ·
    .replace(/−/g, "-") // − (true minus)
    .replace(/\bexp\(/g, "np.exp(")
    .replace(/√/g, "np.sqrt") // √(…) — morrison_ki
    .replace(/\bX\b/g, "x");
}

/** Translate a user's custom equation ("A*X^2 + B") to a Python expression in `x`. */
function customEqToPython(eq: string): string {
  return eq
    .replace(/\^/g, "**")
    .replace(/\bexp\(/g, "np.exp(")
    .replace(/\bln\(/g, "np.log(")
    .replace(/\blog\(/g, "np.log10(")
    .replace(/\bsqrt\(/g, "np.sqrt(")
    .replace(/\bsin\(/g, "np.sin(")
    .replace(/\bcos\(/g, "np.cos(")
    .replace(/\btan\(/g, "np.tan(")
    .replace(/−/g, "-")
    .replace(/\bX\b/g, "x");
}

/** The curve_fit reproduction lines for a nonlinear model expression in `x`. */
function curveFitLines(xy: string[], expr: string, note: string): string[] {
  const params = pyParams(expr);
  if (params.length === 0) return [...xy, `# could not identify the fit parameters to reproduce this model.`];
  return [
    ...xy,
    `from scipy.optimize import curve_fit`,
    note,
    `def model(x, ${params.join(", ")}):`,
    `    return ${expr}`,
    `# p0 defaults to 1 per parameter; set p0=[…] if the fit does not converge.`,
    `popt, _ = curve_fit(model, x, y, maxfev=100000)`,
    `print(dict(zip(${JSON.stringify(params)}, popt)))`,
  ];
}

/** The scipy/numpy call(s) reproducing one analysis, given its engine payload. */
function emitBody(method: string, variant: string | undefined, data: Record<string, unknown>): string[] {
  const v = variant ?? "";
  switch (method) {
    case "describe":
      return [`vals = np.array(${pyList(data["values"])})`, `print(stats.describe(vals), "sd=", np.std(vals, ddof=1))`];
    case "normality":
      return [`vals = np.array(${pyList(data["values"])})`, `print("Shapiro-Wilk:", stats.shapiro(vals))`];
    case "ttest": {
      const a = `a = np.array(${pyList(data["a"])})`;
      if (v === "one-sample") return [a, `print(stats.ttest_1samp(a, ${pyNum(data["mu"])}))`];
      const b = `b = np.array(${pyList(data["b"])})`;
      if (v === "welch") return [a, b, `print(stats.ttest_ind(a, b, equal_var=False))`];
      if (v === "paired") return [a, b, `print(stats.ttest_rel(a, b))`];
      if (v === "mann-whitney") return [a, b, `print(stats.mannwhitneyu(a, b))`];
      if (v === "wilcoxon") return [a, b, `print(stats.wilcoxon(a, b))`];
      return [a, b, `print(stats.ttest_ind(a, b))  # Student (equal variance)`];
    }
    case "anova": {
      const groups = (data["groups"] as unknown[]) ?? [];
      const decl = `groups = [${groups.map((g) => "np.array(" + pyList(g) + ")").join(", ")}]`;
      if (v === "kruskal") return [decl, `print(stats.kruskal(*groups))`];
      return [decl, `print("F, p:", stats.f_oneway(*groups))`, `print(stats.tukey_hsd(*groups))  # post-hoc`];
    }
    case "correlation": {
      const ab = [`a = np.array(${pyList(data["a"])})`, `b = np.array(${pyList(data["b"])})`];
      return v === "spearman" ? [...ab, `print(stats.spearmanr(a, b))`] : [...ab, `print(stats.pearsonr(a, b))`];
    }
    case "regression": {
      const xy = [`x = np.array(${pyList(data["x"])})`, `y = np.array(${pyList(data["y"])})`];
      const origin = data["variant"] === "origin";
      const tp = data["throughPoint"] as { x?: number; y?: number } | undefined;
      const through = origin || (tp != null && typeof tp === "object");
      const scheme = typeof data["weighting"] === "string" ? (data["weighting"] as string) : "";
      const sigma = scheme && scheme !== "none" ? pyRegressionSigma(scheme) : null;
      const weighted = sigma !== null;
      // Plain OLS (no forced point, no weighting): linregress gives slope/intercept/r/p/stderr.
      if (!through && !weighted) return [...xy, `print(stats.linregress(x, y))`];
      const lines = [...xy];
      if (scheme && scheme !== "none" && sigma === null) {
        lines.push(`# NOTE: weighting '${scheme}' needs per-point SD not exported here — showing the unweighted fit.`);
      }
      lines.push(weighted ? `w = 1.0 / np.maximum(${sigma}, 1e-300)**2  # MadY weighting '${scheme}' (weight ∝ 1/sigma²)` : `w = np.ones_like(x)`);
      if (through) {
        // Force the line through a fixed point (origin, or an explicit (x0, y0)): only the
        // slope is fitted. Plain OLS here would give a different slope (by up to ~50% on typical data).
        lines.push(
          `x0, y0 = ${origin ? "0.0, 0.0" : `${pyNum(tp?.x ?? 0)}, ${pyNum(tp?.y ?? 0)}`}  # ${origin ? "force through the origin" : "force through the fixed point"}`,
          `xs, ys = x - x0, y - y0`,
          `slope = np.sum(w*xs*ys) / np.sum(w*xs*xs)`,
          `intercept = y0 - slope*x0`,
        );
      } else {
        // Weighted least squares with a free intercept (weighted normal equations).
        lines.push(
          `Sw, Swx, Swy = w.sum(), np.sum(w*x), np.sum(w*y)`,
          `Swxx, Swxy = np.sum(w*x*x), np.sum(w*x*y)`,
          `slope = (Sw*Swxy - Swx*Swy) / (Sw*Swxx - Swx*Swx)`,
          `intercept = (Swy - slope*Swx) / Sw`,
        );
      }
      lines.push(`print("slope:", slope, "intercept:", intercept)`);
      return lines;
    }
    case "contingency":
      return [`table = np.array(${pyMatrix(data["table"])})`, `print(stats.chi2_contingency(table, correction=False))`];
    case "twoway":
      return [
        `# Two-way ANOVA (needs: pip install pandas statsmodels)`,
        `import pandas as pd, statsmodels.formula.api as smf`,
        `from statsmodels.stats.anova import anova_lm`,
        `cells = ${pyCells(data["cells"])}  # cells[A][B] = replicate values`,
        `recs = [(i, j, v) for i, row in enumerate(cells) for j, cell in enumerate(row) for v in cell]`,
        `df = pd.DataFrame(recs, columns=["A", "B", "y"])`,
        `print(anova_lm(smf.ols("y ~ C(A) + C(B) + C(A):C(B)", data=df).fit(), typ=2))`,
      ];
    case "rmanova":
      return [
        `# Repeated-measures ANOVA (needs: pip install pandas statsmodels)`,
        `import pandas as pd`,
        `from statsmodels.stats.anova import AnovaRM`,
        `Y = ${pyMatrix(data["data"])}  # rows = subjects, cols = conditions`,
        `recs = [(s, c, v) for s, row in enumerate(Y) for c, v in enumerate(row)]`,
        `df = pd.DataFrame(recs, columns=["subj", "cond", "y"])`,
        `print(AnovaRM(df, "y", "subj", within=["cond"]).fit().anova_table)`,
      ];
    case "mixedanova":
      // Written out in numpy, not a library call: a library routine that weights the time means by group size and
      // takes its sphericity factor from the whole-sample covariance prints different numbers on unequal groups from
      // MadY's (Type III, pooled within-group covariance).
      return [
        `# Mixed (split-plot) ANOVA: groups (between) x time (within) (needs: pip install numpy scipy)`,
        `import numpy as np`,
        `from scipy import stats`,
        `groups = ${JSON.stringify(((data["groups"] as Array<{ subjects: (number | null)[][] }>) ?? []).map((g) => g.subjects.filter((s) => s.every((v) => v !== null))))}  # [group][subject][time]`,
        `mats = [np.asarray(g, float) for g in groups]`,
        `G, k = len(mats), mats[0].shape[1]`,
        `Ns = [m.shape[0] for m in mats]; N = sum(Ns)`,
        `grand = np.vstack(mats).mean()`,
        `subj = [m.mean(1) for m in mats]; gm = [s.mean() for s in subj]`,
        `ss_g = k * sum(n * (x - grand) ** 2 for n, x in zip(Ns, gm)); ss_sg = k * sum(((s - x) ** 2).sum() for s, x in zip(subj, gm))`,
        `C = np.linalg.qr(np.column_stack([np.ones(k), np.eye(k)[:, :k - 1]]))[0][:, 1:]  # orthonormal time contrasts`,
        `Z = [m @ C for m in mats]; zb = [z.mean(0) for z in Z]`,
        `L = np.mean(zb, 0); ss_t = (L ** 2).sum() / sum(1 / (G * G * n) for n in Ns)  # Type III`,
        `za = np.vstack(Z).mean(0); ss_gt = sum(n * ((b - za) ** 2).sum() for n, b in zip(Ns, zb))`,
        `E = sum((z - b).T @ (z - b) for z, b in zip(Z, zb)); ss_e = np.trace(E)`,
        `df_g, df_sg, df_t, df_gt, df_e = G - 1, N - G, k - 1, (G - 1) * (k - 1), (N - G) * (k - 1)`,
        `S = E / df_sg; eps = min(1, max(1 / (k - 1), np.trace(S) ** 2 / ((k - 1) * np.trace(S @ S))))  # Greenhouse-Geisser`,
        `F_g = (ss_g / df_g) / (ss_sg / df_sg); F_t = (ss_t / df_t) / (ss_e / df_e); F_gt = (ss_gt / df_gt) / (ss_e / df_e)`,
        `print("groups:      F(%d, %d) = %.4g, p = %.4g" % (df_g, df_sg, F_g, stats.f.sf(F_g, df_g, df_sg)))`,
        `print("time:        F(%d, %d) = %.4g, p = %.4g, GG p = %.4g (eps = %.3f)" % (df_t, df_e, F_t, stats.f.sf(F_t, df_t, df_e), stats.f.sf(F_t, df_t * eps, df_e * eps), eps))`,
        `print("groups x time: F(%d, %d) = %.4g, p = %.4g, GG p = %.4g" % (df_gt, df_e, F_gt, stats.f.sf(F_gt, df_gt, df_e), stats.f.sf(F_gt, df_gt * eps, df_e * eps)))`,
      ];
    case "survival": {
      const groups = (data["groups"] as Array<Record<string, unknown>>) ?? [];
      const lines = [
        `# Survival — Kaplan-Meier + log-rank (needs: pip install lifelines)`,
        `from lifelines import KaplanMeierFitter`,
        `from lifelines.statistics import multivariate_logrank_test`,
        `groups = {`,
        ...groups.map(
          (g) => `    ${JSON.stringify(String(g["label"] ?? "Group"))}: (${pyList(g["time"])}, ${pyList(g["event"])}),`,
        ),
        `}`,
        `kmf = KaplanMeierFitter()`,
        `for label, (t, e) in groups.items():`,
        `    kmf.fit(t, e, label=label); print(label, "median:", kmf.median_survival_time_)`,
        `T = [v for (t, _) in groups.values() for v in t]`,
        `E = [v for (_, e) in groups.values() for v in e]`,
        `G = [g for g, (t, _) in groups.items() for _ in t]`,
        `print(multivariate_logrank_test(T, G, E).summary)`,
      ];
      return lines;
    }
    case "roc":
      return [
        `scores = np.array(${pyList(data["scores"])})`,
        `labels = np.array(${pyList(data["labels"])})`,
        `pos = sorted(set(labels))[-1]; y = (labels == pos).astype(int)`,
        `npos, nneg = int(y.sum()), int((1 - y).sum())`,
        `U = stats.rankdata(scores)[y == 1].sum() - npos * (npos + 1) / 2`,
        `print("AUC:", U / (npos * nneg))`,
      ];
    case "curvefit": {
      const model = String(data["model"] ?? variant ?? "").trim();
      // The model's name as the Analyze dialog shows it (its id when it has none).
      const modelName = VARIANTS["curvefit"]?.find((v) => v.id === model)?.label ?? model;
      const xy = [`x = np.array(${pyList(data["x"])})`, `y = np.array(${pyList(data["y"])})`];
      // A user-defined custom equation — reproduce it verbatim.
      if (model === "custom" && typeof data["equation"] === "string") {
        const eq = data["equation"];
        return curveFitLines(xy, customEqToPython(eq), `# custom user equation: Y = ${eq}`);
      }
      // A templated model — fit its exact form (not a one-size-fits-all 4PL).
      // Display-only equations (implicit in Y, or carrying a per-dataset constant) must
      // not be mechanically reproduced — a naive translation fits the wrong model.
      const disp = DISPLAY_ONLY_EQUATIONS.has(model) ? undefined : FIT_MODEL_EQUATION[model];
      if (disp) return curveFitLines(xy, displayEqToPython(disp), `# ${modelName} model — ${disp}`);
      // Smoother / advanced model with no closed form — say so rather than emit a wrong fit.
      return [
        ...xy,
        `# '${modelName || "curve"}' fit has no closed-form template to reproduce here;`,
        `# open the project in MadY for this model's fitted parameters + curve.`,
      ];
    }
    case "deming":
      return [
        `x = np.array(${pyList(data["x"])})`,
        `y = np.array(${pyList(data["y"])})`,
        `m = np.isfinite(x) & np.isfinite(y); x, y = x[m], y[m]`,
        `# Deming regression (both axes have error); lambda = error-variance ratio (MadY default 1).`,
        `lam = 1.0; mx, my = x.mean(), y.mean()`,
        `sxx = np.sum((x-mx)**2); syy = np.sum((y-my)**2); sxy = np.sum((x-mx)*(y-my))`,
        `slope = (syy - lam*sxx + np.sqrt((syy - lam*sxx)**2 + 4*lam*sxy**2)) / (2*sxy)`,
        `print("Deming slope:", slope, "intercept:", my - slope*mx)`,
      ];
    case "passingbablok":
      return [
        `x = np.array(${pyList(data["x"])})`,
        `y = np.array(${pyList(data["y"])})`,
        `m = np.isfinite(x) & np.isfinite(y); x, y = x[m], y[m]; n = x.size`,
        `# Passing-Bablok: slope = shifted median of pairwise slopes (offset K = #slopes < -1).`,
        `slopes = []`,
        `for i in range(n):`,
        `    dx, dy = x[i+1:] - x[i], y[i+1:] - y[i]`,
        `    s = np.full(dx.size, np.nan); nz = dx != 0`,
        `    s[nz] = dy[nz] / dx[nz]`,
        `    s[(~nz) & (dy > 0)] = np.inf; s[(~nz) & (dy < 0)] = -np.inf`,
        `    s = s[~(np.isnan(s) | (s == -1.0))]`,
        `    slopes.extend(float(v) for v in s)`,
        `slopes = np.sort(np.asarray(slopes)); N = slopes.size; K = int(np.sum(slopes < -1))`,
        `def shifted(off):`,
        `    if N % 2: return slopes[int(np.clip((N-1)//2 + off, 0, N-1))]`,
        `    return 0.5*(slopes[int(np.clip(N//2-1+off, 0, N-1))] + slopes[int(np.clip(N//2+off, 0, N-1))])`,
        `b1 = shifted(K); print("Passing-Bablok slope:", b1, "intercept:", np.median(y - b1*x))`,
      ];
    case "blandaltman": {
      const percent = data["percent"] === true;
      const k = typeof data["agreementK"] === "number" ? data["agreementK"] : 1.96;
      return [
        `x = np.array(${pyList(data["x"])})`,
        `y = np.array(${pyList(data["y"])})`,
        `m = np.isfinite(x) & np.isfinite(y); x, y = x[m], y[m]`,
        `means = (x + y) / 2`,
        percent ? `diffs = 100.0 * (x - y) / means  # percent of mean` : `diffs = x - y`,
        `bias = diffs.mean(); sd = diffs.std(ddof=1); k = ${k}`,
        `print("bias:", bias, "SD of diffs:", sd, "limits of agreement:", bias - k*sd, bias + k*sd)`,
      ];
    }
    case "ancova": {
      const groups = (data["groups"] as Array<Record<string, unknown>>) ?? [];
      return [
        `# ANCOVA — compare group means adjusting for a covariate (needs: pip install pandas statsmodels)`,
        `import pandas as pd, statsmodels.formula.api as smf`,
        `from statsmodels.stats.anova import anova_lm`,
        `groups = {`,
        ...groups.map((g) => `    ${JSON.stringify(String(g["label"] ?? "Group"))}: (${pyList(g["x"])}, ${pyList(g["y"])}),`),
        `}`,
        `recs = [(g, xv, yv) for g, (xs, ys) in groups.items() for xv, yv in zip(xs, ys)]`,
        `df = pd.DataFrame(recs, columns=["group", "x", "y"]).dropna()`,
        `print(anova_lm(smf.ols("y ~ C(group) + x", data=df).fit(), typ=2))`,
      ];
    }
    case "logistic":
    case "multipleregression":
    case "poisson": {
      const preds = (data["predictors"] as unknown[]) ?? [];
      const labels = (data["labels"] as string[]) ?? [];
      const cols = preds.map((_, i) => `x${i + 1}`);
      const fit = method === "logistic" ? "smf.logit" : method === "poisson" ? "smf.poisson" : "smf.ols";
      const title = method === "logistic" ? "Logistic regression" : method === "poisson" ? "Poisson regression" : "Multiple linear regression";
      return [
        `# ${title} (needs: pip install pandas statsmodels)`,
        `import pandas as pd, statsmodels.formula.api as smf`,
        `y = np.array(${pyList(data["y"])})`,
        ...preds.map((p, i) => `x${i + 1} = np.array(${pyList(p)})  # ${labels[i] ?? ""}`),
        `df = pd.DataFrame({"y": y${cols.map((c) => `, "${c}": ${c}`).join("")}}).dropna()`,
        `print(${fit}("y ~ ${cols.join(" + ") || "1"}", data=df).fit().summary())`,
      ];
    }
    case "mixedmodel": {
      const fixed = (data["fixed"] as unknown[]) ?? [];
      const flabels = (data["fixedLabels"] as string[]) ?? [];
      const fcols = fixed.map((_, i) => `f${i + 1}`);
      const reml = data["reml"] !== false;
      const rhs = fcols.length ? fcols.map((c) => `C(${c})`).join(" + ") : "1";
      return [
        `# Linear mixed-effects model — random intercept per group (needs: pip install pandas statsmodels)`,
        `import pandas as pd, statsmodels.formula.api as smf`,
        `y = np.array(${pyList(data["value"])})`,
        `grp = ${pyValueList(data["group"])}`,
        ...fixed.map((f, i) => `f${i + 1} = ${pyValueList(f)}  # ${flabels[i] ?? ""}`),
        `df = pd.DataFrame({"y": y, "grp": grp${fcols.map((c) => `, "${c}": ${c}`).join("")}}).dropna()`,
        `print(smf.mixedlm("y ~ ${rhs}", df, groups=df["grp"]).fit(reml=${reml ? "True" : "False"}).summary())`,
      ];
    }
    case "pca": {
      const standardize = data["standardize"] !== false;
      return [
        `# PCA via SVD on the ${standardize ? "correlation" : "covariance"} structure`,
        `cols = ${pyMatrix(data["columns"])}  # one row per variable`,
        `X = np.array(cols, float).T  # rows = cases, cols = variables`,
        `X = X[~np.isnan(X).any(axis=1)]  # complete cases`,
        `Xc = X - X.mean(0)`,
        ...(standardize ? [`Xc = Xc / X.std(0, ddof=1)`] : []),
        `U, S, Vt = np.linalg.svd(Xc, full_matrices=False)`,
        `evr = S**2 / np.sum(S**2)`,
        `print("explained variance ratio:", np.round(evr, 4))`,
        `print("PC1 loadings:", np.round(Vt[0], 4))`,
      ];
    }
    // Ordination. Both are written out as the procedure, not a library call: neither
    // scipy nor sklearn ships the ecology conventions (Bray-Curtis + the transformations for
    // PCoA, Kruskal stress-1 with restarts for NMDS), and a script that quietly used a
    // different convention would not reproduce the figure it claims to.
    case "rda": {
      const perms = typeof data["permutations"] === "number" ? data["permutations"] : 999;
      return [
        `# Redundancy analysis — ordinate the fitted values, then test by permutation`,
        `cols = ${pyMatrix(data["columns"])}  # one row per response variable`,
        `Y = np.array(cols, float).T`,
        `Y = Y - Y.mean(0)  # centred response`,
        `X = np.array(${pyMatrix(data["explanatory"])}, float).T  # explanatory columns`,
        `X = (X - X.mean(0)) / X.std(0, ddof=1)`,
        `def spectrum(A): return np.linalg.svd(A / np.sqrt(len(A) - 1), compute_uv=False)**2`,
        `def partition(Y, X):`,
        `    fit = X @ np.linalg.lstsq(X, Y, rcond=None)[0]`,
        `    return spectrum(fit), spectrum(Y - fit)`,
        `con, unc = partition(Y, X)`,
        `n, q = Y.shape[0], X.shape[1]`,
        `F = (con.sum() / q) / (unc.sum() / (n - q - 1))`,
        `rng = np.random.default_rng(${typeof data["seed"] === "number" ? data["seed"] : 20240704})`,
        `ge = 0`,
        `for _ in range(${perms}):`,
        `    c2, u2 = partition(Y[rng.permutation(n)], X)`,
        `    ge += ((c2.sum() / q) / (u2.sum() / (n - q - 1))) >= F`,
        `print("R2:", round(float(con.sum() / (con.sum() + unc.sum())), 4), " F:", round(float(F), 3), " p:", (ge + 1) / ${perms + 1})`,
      ];
    }
    case "varpart": {
      const perms = typeof data["permutations"] === "number" ? data["permutations"] : 999;
      const b2 = data["explanatory2"];
      const b3 = data["explanatory3"];
      return [
        `# Variance partitioning — adjusted R2 of every combination of the blocks, then the`,
        `# differences. Adjusted, not raw: a raw R2 rises with each column, so raw fractions`,
        `# would reward the widest block rather than the most informative one.`,
        `cols = ${pyMatrix(data["columns"])}  # one row per response variable`,
        `Y = np.array(cols, float).T; Y = Y - Y.mean(0)`,
        `blocks = [np.array(b, float).T for b in [`,
        `    ${pyMatrix(data["explanatory"])},`,
        `    ${pyMatrix(b2)},`,
        ...(Array.isArray(b3) && b3.length ? [`    ${pyMatrix(b3)},`] : []),
        `]]`,
        `blocks = [(X - X.mean(0)) / X.std(0, ddof=1) for X in blocks]`,
        `n = Y.shape[0]`,
        `def adj(idxs):`,
        `    if not idxs: return 0.0`,
        `    X = np.column_stack([blocks[i] for i in idxs])`,
        `    fit = X @ np.linalg.lstsq(X, Y, rcond=None)[0]`,
        `    ss = lambda A: float((A**2).sum())`,
        `    r2 = ss(fit) / ss(Y)`,
        `    q = np.linalg.matrix_rank(X)`,
        `    return 1 - (1 - r2) * (n - 1) / (n - q - 1)`,
        ...(Array.isArray(b3) && b3.length
          ? [
            `A, B, C = adj([0]), adj([1]), adj([2])`,
            `AB, AC, BC, ABC = adj([0,1]), adj([0,2]), adj([1,2]), adj([0,1,2])`,
            `print("unique:", [round(v, 4) for v in (ABC-BC, ABC-AC, ABC-AB)])`,
            `print("shared:", [round(v, 4) for v in (AC+BC-C-ABC, AB+AC-A-ABC, AB+BC-B-ABC, A+B+C-AB-AC-BC+ABC)])`,
            `print("explained:", round(ABC, 4), " residual:", round(1 - ABC, 4))`,
          ]
          : [
            `A, B, AB = adj([0]), adj([1]), adj([0,1])`,
            `print("A alone:", round(AB - B, 4), " shared:", round(A + B - AB, 4), " B alone:", round(AB - A, 4))`,
            `print("explained:", round(AB, 4), " residual:", round(1 - AB, 4))`,
          ]),
        `# The unique fractions are testable by partial RDA (${perms} permutations in MadY);`,
        `# a shared fraction is a difference between two models, so it has no test.`,
      ];
    }
    case "cca": {
      const perms = typeof data["permutations"] === "number" ? data["permutations"] : 999;
      return [
        `# Canonical correspondence analysis — CA's chi-square geometry, constrained by X.`,
        `# The row masses are the whole difference from an RDA: both matrices below carry`,
        `# sqrt(mass), so an ordinary least-squares fit here IS the weighted fit.`,
        `cols = ${pyMatrix(data["columns"])}  # one row per response variable`,
        `M = np.array(cols, float).T  # rows = cases, cols = variables`,
        `P = M / M.sum()`,
        `r = P.sum(1); c = P.sum(0)  # row (case) and column (variable) masses`,
        `Q = (P - np.outer(r, c)) / np.sqrt(np.outer(r, c))  # CA's standardized residuals`,
        `X = np.array(${pyMatrix(data["explanatory"])}, float).T  # explanatory columns`,
        `Xc = X - r @ X`,
        `Xc = Xc / np.sqrt(r @ Xc**2)  # weighted centring and scaling`,
        `Xw = np.sqrt(r)[:, None] * Xc`,
        `def partition(Q, Xw):`,
        `    fit = Xw @ np.linalg.lstsq(Xw, Q, rcond=None)[0]`,
        `    return np.linalg.svd(fit, compute_uv=False)**2, np.linalg.svd(Q - fit, compute_uv=False)**2`,
        `con, unc = partition(Q, Xw)`,
        `n, q = M.shape[0], X.shape[1]`,
        `F = (con.sum() / q) / (unc.sum() / (n - q - 1))`,
        `rng = np.random.default_rng(${typeof data["seed"] === "number" ? data["seed"] : 20240704})`,
        `ge = 0`,
        `for _ in range(${perms}):`,
        `    Xp = X[rng.permutation(n)]`,
        `    Xp = (Xp - r @ Xp); Xp = Xp / np.sqrt(r @ Xp**2)`,
        `    c2, u2 = partition(Q, np.sqrt(r)[:, None] * Xp)`,
        `    ge += ((c2.sum() / q) / (u2.sum() / (n - q - 1))) >= F`,
        `print("inertia:", round(float(con.sum() + unc.sum()), 4), " constrained:", round(float(con.sum() / (con.sum() + unc.sum())), 4), " F:", round(float(F), 3), " p:", (ge + 1) / ${perms + 1})`,
      ];
    }
    case "dbrda": {
      const perms = typeof data["permutations"] === "number" ? data["permutations"] : 999;
      const metric = String(data["metric"] ?? "braycurtis");
      return [
        `# Distance-based RDA — PCoA on a ${metric} distance, then RDA on those coordinates.`,
        `from scipy.spatial.distance import pdist, squareform`,
        `cols = ${pyMatrix(data["columns"])}  # one row per response variable`,
        `W = np.array(cols, float).T  # rows = cases, cols = variables`,
        `D = squareform(pdist(W, metric=${JSON.stringify(metric === "bray" ? "braycurtis" : metric)}))`,
        `n = D.shape[0]`,
        `J = np.eye(n) - np.ones((n, n)) / n`,
        `G = J @ (-0.5 * D**2) @ J; G = (G + G.T) / 2`,
        `vals, vecs = np.linalg.eigh(G)`,
        `o = np.argsort(vals)[::-1]; vals, vecs = vals[o], vecs[:, o]`,
        `pos = vals > max(1e-9, np.max(np.abs(vals)) * 1e-12)  # negative axes cannot be regressed on`,
        `Y = vecs[:, pos] * np.sqrt(vals[pos])  # principal coordinates (already centred)`,
        `X = np.array(${pyMatrix(data["explanatory"])}, float).T  # explanatory columns`,
        `X = (X - X.mean(0)) / X.std(0, ddof=1)`,
        `def spectrum(A): return np.linalg.svd(A / np.sqrt(len(A) - 1), compute_uv=False)**2`,
        `def partition(Y, X):`,
        `    fit = X @ np.linalg.lstsq(X, Y, rcond=None)[0]`,
        `    return spectrum(fit), spectrum(Y - fit)`,
        `con, unc = partition(Y, X)`,
        `q = X.shape[1]`,
        `F = (con.sum() / q) / (unc.sum() / (n - q - 1))`,
        `rng = np.random.default_rng(${typeof data["seed"] === "number" ? data["seed"] : 20240704})`,
        `ge = 0`,
        `for _ in range(${perms}):`,
        `    c2, u2 = partition(Y[rng.permutation(n)], X)`,
        `    ge += ((c2.sum() / q) / (u2.sum() / (n - q - 1))) >= F`,
        `print("negative axes dropped:", int((vals < -1e-9).sum()))`,
        `print("R2:", round(float(con.sum() / (con.sum() + unc.sum())), 4), " F:", round(float(F), 3), " p:", (ge + 1) / ${perms + 1})`,
      ];
    }
    case "ca": {
      const scaling = String(data["scaling"] ?? "symmetric");
      return [
        `# Correspondence analysis — SVD of the standardized residuals (scaling: ${scaling})`,
        `cols = ${pyMatrix(data["columns"])}  # one row per variable`,
        `X = np.array(cols, float).T  # rows = cases, cols = variables`,
        `X = X[~np.isnan(X).any(axis=1)]  # complete cases`,
        `P = X / X.sum()`,
        `r = P.sum(1); c = P.sum(0)  # row and column masses`,
        `S = (P - np.outer(r, c)) / np.sqrt(np.outer(r, c))`,
        `U, sv, Vt = np.linalg.svd(S, full_matrices=False)`,
        `eig = sv**2  # inertia per axis; total = chi2 / N`,
        `rowStd = U / np.sqrt(r)[:, None]; colStd = Vt.T / np.sqrt(c)[:, None]`,
        ...(scaling === "sites"
          ? [`rows, cols_ = rowStd * sv, colStd  # sites in principal coordinates`]
          : scaling === "species"
            ? [`rows, cols_ = rowStd, colStd * sv  # species in principal coordinates`]
            : [`rows, cols_ = rowStd * np.sqrt(sv), colStd * np.sqrt(sv)  # symmetric`]),
        `print("inertia:", np.round(eig, 4), " total:", round(float(eig.sum()), 4))`,
      ];
    }
    case "pcoa": {
      const metric = String(data["metric"] ?? "braycurtis");
      const transform = String(data["transform"] ?? "none");
      return [
        `# PCoA (principal coordinates) — classical scaling of a ${metric} distance matrix`,
        `from scipy.spatial.distance import pdist, squareform`,
        `cols = ${pyMatrix(data["columns"])}  # one row per variable`,
        `X = np.array(cols, float).T  # rows = cases, cols = variables`,
        `X = X[~np.isnan(X).any(axis=1)]  # complete cases`,
        ...(transform === "hellinger" ? [`X = np.sqrt(X / X.sum(1, keepdims=True))  # Hellinger`] : []),
        ...(transform === "total" ? [`X = X / X.sum(1, keepdims=True)  # relative abundance`] : []),
        ...(transform === "sqrt" ? [`X = np.sqrt(X)`] : []),
        ...(transform === "log1p" ? [`X = np.log1p(X)`] : []),
        `D = squareform(pdist(X, metric=${JSON.stringify(metric === "manhattan" ? "cityblock" : metric)}))`,
        `n = D.shape[0]`,
        `J = np.eye(n) - np.ones((n, n)) / n`,
        `G = J @ (-0.5 * D**2) @ J  # double-centred`,
        `vals, vecs = np.linalg.eigh((G + G.T) / 2)`,
        `o = np.argsort(vals)[::-1]`,
        `coords = vecs[:, o] * np.sqrt(np.clip(vals[o], 0, None))`,
        `print("eigenvalues:", np.round(vals[o][:5], 4))`,
        `print("negative eigenvalues:", int((vals < -1e-9).sum()))`,
      ];
    }
    case "nmds": {
      const metric = String(data["metric"] ?? "braycurtis");
      const dims = typeof data["dimensions"] === "number" ? data["dimensions"] : 2;
      const seed = typeof data["seed"] === "number" ? data["seed"] : 20240704;
      return [
        `# NMDS — monotone regression (PAVA) alternated with a Guttman (SMACOF) step,`,
        `# restarted and the lowest Kruskal stress-1 kept. Stress = sqrt(sum (d-dhat)^2 / sum d^2).`,
        `from scipy.spatial.distance import pdist, squareform`,
        `from sklearn.isotonic import IsotonicRegression`,
        `cols = ${pyMatrix(data["columns"])}  # one row per variable`,
        `X = np.array(cols, float).T`,
        `X = X[~np.isnan(X).any(axis=1)]`,
        `diss = pdist(X, metric=${JSON.stringify(metric === "manhattan" ? "cityblock" : metric)})`,
        `n = X.shape[0]; k = ${dims}; rng = np.random.default_rng(${seed})`,
        `iu = np.triu_indices(n, 1); order = np.argsort(diss, kind="mergesort")`,
        `C = rng.standard_normal((n, k)) * diss.mean()`,
        `for _ in range(300):`,
        `    dist = np.linalg.norm(C[iu[0]] - C[iu[1]], axis=1)`,
        `    dhat = np.empty_like(dist)`,
        `    dhat[order] = IsotonicRegression().fit_transform(np.arange(dist.size), dist[order])`,
        `    B = np.zeros((n, n)); ratio = -dhat / np.maximum(dist, 1e-12)`,
        `    B[iu] = ratio; B[(iu[1], iu[0])] = ratio; np.fill_diagonal(B, -B.sum(1))`,
        `    C = (B @ C) / n`,
        `stress = np.sqrt(((dist - dhat)**2).sum() / (dist**2).sum())`,
        `print("stress-1:", round(float(stress), 4))`,
      ];
    }
    case "cluster": {
      const variant = String(data["variant"] ?? "kmeans");
      const k = typeof data["k"] === "number" ? data["k"] : 3;
      const standardize = data["standardize"] !== false;
      const seed = typeof data["seed"] === "number" ? data["seed"] : 0;
      const lk = String(data["linkage"] ?? "ward");
      const mt = lk === "ward" ? "euclidean" : String(data["metric"] ?? "euclidean");
      const pre = [
        `# Cluster analysis — the procedure (exact labels depend on the implementation)`,
        `cols = ${pyMatrix(data["columns"])}  # one row per variable`,
        `X = np.array(cols, float).T`,
        `X = X[~np.isnan(X).any(axis=1)]`,
        ...(standardize ? [`X = (X - X.mean(0)) / X.std(0, ddof=1)`] : []),
      ];
      if (variant === "kmeans") {
        return [
          ...pre,
          `from scipy.cluster.vq import kmeans2`,
          `np.random.seed(${seed})`,
          `_, labels = kmeans2(X, ${k}, seed=${seed}, minit="++")`,
          `print("cluster sizes:", np.bincount(labels, minlength=${k}))`,
        ];
      }
      return [
        ...pre,
        `from scipy.cluster.hierarchy import linkage, fcluster`,
        `Z = linkage(X, method=${JSON.stringify(lk)}, metric=${JSON.stringify(mt)})`,
        `labels = fcluster(Z, ${k}, criterion="maxclust")`,
        `print("cluster sizes:", np.bincount(labels)[1:])`,
      ];
    }
    case "corrmatrix": {
      const spearman = data["variant"] === "spearman";
      return [
        `# ${spearman ? "Spearman" : "Pearson"} correlation matrix (pairwise-complete)`,
        `cols = [np.array(c, float) for c in ${pyMatrix(data["columns"])}]`,
        `labels = ${pyValueList(data["labels"])}`,
        `from scipy.stats import ${spearman ? "spearmanr" : "pearsonr"} as corr`,
        `for i in range(len(cols)):`,
        `    for j in range(i + 1, len(cols)):`,
        `        a, b = cols[i], cols[j]; m = np.isfinite(a) & np.isfinite(b)`,
        `        print(labels[i], "vs", labels[j], "r =", round(float(corr(a[m], b[m])[0]), 4))`,
      ];
    }
    case "multifactor": {
      const factors = (data["factors"] as unknown[]) ?? [];
      const flabels = (data["factorLabels"] as string[]) ?? [];
      const fcols = factors.map((_, i) => `f${i + 1}`);
      const formula = "y ~ " + (fcols.length ? fcols.map((c) => `C(${c})`).join("*") : "1");
      return [
        `# N-way factorial ANOVA (needs: pip install pandas statsmodels)`,
        `import pandas as pd, statsmodels.formula.api as smf`,
        `from statsmodels.stats.anova import anova_lm`,
        `y = np.array(${pyList(data["value"])})`,
        ...factors.map((f, i) => `f${i + 1} = ${pyValueList(f)}  # ${flabels[i] ?? ""}`),
        `df = pd.DataFrame({"y": y${fcols.map((c) => `, "${c}": ${c}`).join("")}}).dropna()`,
        `print(anova_lm(smf.ols(${JSON.stringify(formula)}, data=df).fit(), typ=2))`,
      ];
    }
    case "cox": {
      const preds = (data["predictors"] as unknown[]) ?? [];
      const names = (data["names"] as string[]) ?? [];
      const cols = preds.map((_, i) => `x${i + 1}`);
      return [
        `# Cox proportional-hazards regression (Efron ties) — matches MadY's PHReg (needs: pip install statsmodels)`,
        `from statsmodels.duration.hazard_regression import PHReg`,
        `time = np.array(${pyList(data["time"])})`,
        `event = np.array(${pyList(data["event"])})`,
        ...preds.map((pr, i) => `x${i + 1} = np.array(${pyList(pr)})  # ${names[i] ?? ""}`),
        `X = np.column_stack([${cols.join(", ")}])`,
        `m = np.isfinite(time) & np.isfinite(event) & (time > 0) & np.isfinite(X).all(axis=1)`,
        `print(PHReg(time[m], X[m], status=event[m], ties="efron").fit().summary())`,
      ];
    }
    case "nested": {
      const groups = (data["groups"] as Array<Record<string, unknown>>) ?? [];
      return [
        `# Nested (hierarchical) ANOVA — the group effect is tested against the among-subgroup MS.`,
        `groups = [`,
        ...groups.map((g) => `    (${JSON.stringify(String(g["label"] ?? "Group"))}, [${((g["subgroups"] as unknown[]) ?? []).map(pyList).join(", ")}]),`),
        `]`,
        `all_obs = [v for _, subs in groups for s in subs for v in s]`,
        `grand = np.mean(all_obs); N = len(all_obs)`,
        `a = len(groups); n_sub = sum(len(subs) for _, subs in groups)`,
        `ssg = sss = ssw = 0.0`,
        `for _, subs in groups:`,
        `    g_obs = [v for s in subs for v in s]; gm = np.mean(g_obs)`,
        `    ssg += len(g_obs) * (gm - grand)**2`,
        `    for s in subs:`,
        `        sm = np.mean(s); sss += len(s) * (sm - gm)**2`,
        `        ssw += sum((v - sm)**2 for v in s)`,
        `dfg, dfs, dfw = a - 1, n_sub - a, N - n_sub`,
        `Fg = (ssg/dfg) / (sss/dfs); Fs = (sss/dfs) / (ssw/dfw)`,
        `print("Groups:    F(%d,%d) = %.4f  p = %.4g" % (dfg, dfs, Fg, stats.f.sf(Fg, dfg, dfs)))`,
        `print("Subgroups: F(%d,%d) = %.4f  p = %.4g" % (dfs, dfw, Fs, stats.f.sf(Fs, dfs, dfw)))`,
      ];
    }
    case "goodnessoffit": {
      const obs = data["observed"];
      const k = Array.isArray(obs) ? obs.length : 0;
      const lines = [
        `# Chi-square goodness-of-fit vs a uniform expected distribution`,
        `observed = np.array(${pyList(obs)})`,
        `chi2, p = stats.chisquare(observed)  # f_exp defaults to uniform (equal expected)`,
        `print("chi-square:", chi2, "df:", observed.size - 1, "p:", p)`,
      ];
      if (k === 2) {
        lines.push(
          `print("exact binomial p:", stats.binomtest(int(round(observed[0])), int(round(observed.sum())), 0.5).pvalue)`,
        );
      }
      return lines;
    }
    default:
      return [`# (no script template for ${methodLabel(method)})`];
  }
}

/**
 * Build a runnable Python script reproducing every analysis in the project.
 * Returns a `# no analyses` stub when the project has none.
 */
export function buildPythonScript(project: Project): string {
  const head = [
    "#!/usr/bin/env python3",
    '"""Reproducible analysis script generated by MadY.',
    "Re-runs each analysis from its source data in Python (NumPy, SciPy and the libraries named below).",
    'Requires: pip install numpy scipy (some methods also need pandas, statsmodels, lifelines or scikit-learn)"""',
    "import numpy as np",
    "from scipy import stats",
    "",
  ];
  const analyses = project.analyses ?? [];
  if (analyses.length === 0) {
    return [...head, "# This project has no analyses yet.", ""].join("\n");
  }
  const blocks: string[] = [];
  for (const a of analyses) {
    const table = project.tables.find((t) => t.id === a.source);
    if (!table) continue;
    const params: AnalysisParams = a.params;
    let body: string[];
    try {
      body = emitBody(a.method, params.variant, buildAnalysisData(a.method, params, table));
    } catch {
      body = [`# (could not rebuild data for '${a.name}')`];
    }
    // The method and variant by the names the Analyze dialog shows, not their ids.
    const variantName = params.variant
      ? VARIANTS[a.method]?.find((v) => v.id === params.variant)?.label ?? params.variant
      : "";
    blocks.push([`# === ${a.name} (${methodLabel(a.method)}${variantName ? ", " + variantName : ""}) ===`, ...body].join("\n"));
  }
  return [...head, blocks.join("\n\n"), ""].join("\n");
}
