#!/usr/bin/env python3
"""Systematic per-format validation: for each MadY table format, feed a
synthetic dataset with a known answer to the real engine method that format
unlocks, and compare the engine's output against an independent reference
(scipy / statsmodels, or a hand-derived exact value). Prints a PASS/FAIL line
per check. Run: `py -3 validate_datatypes.py`."""
import math
import sys
import engine
import numpy as np
from scipy import stats as sp

# Results print maths signs a Windows console's default code page cannot encode.
sys.stdout.reconfigure(encoding="utf-8")

FAILS = []
def check(label, got, ref, tol=1e-4):
    ok = (got is not None and ref is not None and abs(float(got) - float(ref)) <= tol)
    if not ok:
        FAILS.append(label)
    print(f"   [{'PASS' if ok else 'FAIL'}] {label}: engine={got}  ref={ref}")

def term(res, name, key="estimate"):
    for t in res["terms"]:
        if t["term"] == name:
            return t.get(key)
    return None

def section(n, title):
    print(f"\n{'='*70}\n{n}. {title}\n{'='*70}")

# 1 ─ XY ──────────────────────────────────────────────────────────────────────
section(1, "XY  →  linear regression  (graph: scatter / line)")
x = [1, 2, 3, 4, 5, 6, 7, 8]
y = [2 * v + 1 for v in x]               # y = 2x + 1 exactly  → slope 2, int 1, R²=1
r = engine.regression({"x": x, "y": y})
g = r["glance"]
lr = sp.linregress(x, y)
print(f"   data: y = 2x+1 exact, n={len(x)}")
check("slope = 2", g["slope"], 2.0)
check("intercept = 1", g["intercept"], 1.0)
check("R² = 1", g["r_sq"], 1.0)
check("slope vs scipy.linregress", g["slope"], lr.slope)

# 2 ─ Column  →  one-way ANOVA + unpaired t ───────────────────────────────────
section(2, "Column  →  one-way ANOVA / t test  (graph: bar / box / violin)")
g1 = [2, 3, 4, 5, 6]; g2 = [4, 5, 6, 7, 8]; g3 = [6, 7, 8, 9, 10]   # means 4,6,8
a = engine.anova1({"groups": [g1, g2, g3], "labels": ["Ctrl", "A", "B"]})
F, p = sp.f_oneway(g1, g2, g3)
print(f"   data: 3 groups, means 4/6/8, equal spread")
check("ANOVA F vs scipy.f_oneway", term(a, "Between groups", "statistic")
      or a["glance"].get("F"), F)
check("ANOVA p vs scipy", a["glance"].get("p"), p)
t = engine.ttest({"variant": "unpaired", "a": g1, "b": g3})
tt = sp.ttest_ind(g1, g3)
check("unpaired t vs scipy.ttest_ind", t["glance"]["t"], tt.statistic)
check("unpaired p vs scipy", t["glance"]["p"], tt.pvalue)

# 3 ─ Grouped  →  two-way ANOVA ───────────────────────────────────────────────
section(3, "Grouped  →  two-way ANOVA  (graph: grouped bars)")
# 2 (rows: Low/High) × 2 (cols: Ctrl/Drug) × 3 reps, balanced.
cells = [
    [[10, 11, 9], [12, 13, 11]],     # Low : Ctrl, Drug
    [[20, 21, 19], [24, 25, 23]],    # High: Ctrl, Drug
]
tw = engine.twoway({"cells": cells, "rowLabels": ["Low", "High"], "colLabels": ["Ctrl", "Drug"]})
# Reference: statsmodels OLS two-way ANOVA (Type-I == balanced).
import pandas as pd, statsmodels.api as sm
from statsmodels.formula.api import ols
rows = []
for ri, rl in enumerate(["Low", "High"]):
    for ci, cl in enumerate(["Ctrl", "Drug"]):
        for v in cells[ri][ci]:
            rows.append({"A": rl, "B": cl, "y": v})
df = pd.DataFrame(rows)
mdl = ols("y ~ C(A) + C(B) + C(A):C(B)", df).fit()
aov = sm.stats.anova_lm(mdl, typ=2)
print("   data: 2×2×3 balanced, strong row (Low/High) effect")
check("Factor-A F vs statsmodels", tw["glance"]["F_a"], aov.loc["C(A)", "F"], tol=1e-2)
check("Factor-B F vs statsmodels", tw["glance"]["F_b"], aov.loc["C(B)", "F"], tol=1e-2)
check("Interaction F vs statsmodels", tw["glance"]["F_ab"], aov.loc["C(A):C(B)", "F"], tol=1e-2)

# 4 ─ Contingency  →  chi-square / Fisher ─────────────────────────────────────
section(4, "Contingency  →  chi-square + Fisher  (graph: grouped count bars)")
tbl = [[30, 10], [15, 45]]
c = engine.contingency({"table": tbl})
chi2, pchi, dof, _ = sp.chi2_contingency(tbl, correction=False)
odds, pf = sp.fisher_exact(tbl)
print(f"   data: 2×2 [[30,10],[15,45]] (strong association)")
check("chi-square vs scipy.chi2_contingency", c["glance"]["chi_sq"], chi2)
check("Fisher p vs scipy.fisher_exact", c["glance"]["fisher_p"], pf, tol=1e-4)
check("odds ratio vs scipy.fisher_exact", c["glance"]["odds_ratio"], odds, tol=1e-3)

# 5 ─ Survival  →  Kaplan-Meier + log-rank ────────────────────────────────────
section(5, "Survival  →  Kaplan-Meier + log-rank  (graph: KM staircase)")
# Two groups; group B clearly worse (earlier events).
gA = {"label": "A", "time": [6, 7, 10, 15, 19, 25, 25, 28, 30, 32],
      "event": [1, 1, 1, 1, 1, 0, 1, 1, 0, 1]}
gB = {"label": "B", "time": [3, 4, 5, 8, 9, 11, 12, 14, 16, 18],
      "event": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]}
s = engine.survival({"groups": [gA, gB]})
# Reference: statsmodels log-rank (survdiff).
import statsmodels.duration.hazard_regression  # noqa
from statsmodels.duration.survfunc import survdiff
allt = np.array(gA["time"] + gB["time"], float)
alle = np.array(gA["event"] + gB["event"], float)
grp = np.array([0]*len(gA["time"]) + [1]*len(gB["time"]))
chisq, pln = survdiff(allt, alle, grp)
print("   data: 2 groups, B worse; 1 censored in A")
check("log-rank χ² vs statsmodels.survdiff", s["glance"].get("logrank_chi2")
      or term(s, "Log-rank (Mantel-Cox)", "statistic"), chisq, tol=1e-2)
check("log-rank p vs statsmodels", s["glance"].get("p")
      or term(s, "Log-rank (Mantel-Cox)", "p"), pln, tol=1e-3)

# 6 ─ Parts of whole  →  fractions (descriptive) ──────────────────────────────
section(6, "Parts of whole  →  goodness-of-fit (χ²) + pie  (graph: pie / doughnut)")
slices = [30, 50, 20]                      # one whole = 100
total = sum(slices)
fracs = [v / total for v in slices]
print(f"   data: slices {slices}; fractions {[round(f,3) for f in fracs]}")
check("fractions sum to 1", sum(fracs), 1.0)
check("largest slice = 50%", max(fracs) * 100, 50.0)
gof = engine.goodnessoffit({"observed": slices, "labels": ["Alpha", "Beta", "Gamma"]})
chi2_g, p_g = sp.chisquare(slices)         # uniform expected
check("goodness-of-fit χ² vs scipy.chisquare", gof["glance"]["chi_sq"], chi2_g)
check("goodness-of-fit p vs scipy", gof["glance"]["p"], p_g)
gof2 = engine.goodnessoffit({"observed": [8, 12]})
check("two-category exact binomial vs scipy.binomtest", gof2["glance"]["binom_p"],
      sp.binomtest(8, 20, 0.5).pvalue, tol=1e-5)

# 7 ─ Multiple variables  →  multiple regression + PCA ────────────────────────
section(7, "Multiple variables  →  multiple regression / PCA  (graph: bubble / heatmap)")
x1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
x2 = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9]
yv = [5 + 2 * a - 3 * b for a, b in zip(x1, x2)]   # y = 5 + 2x1 − 3x2 exactly
mr = engine.multipleregression({"y": yv, "predictors": [x1, x2], "labels": ["x1", "x2"]})
print("   data: y = 5 + 2·x1 − 3·x2 exact")
check("intercept = 5", term(mr, "Intercept"), 5.0, tol=1e-3)
check("β(x1) = 2", term(mr, "x1"), 2.0, tol=1e-3)
check("β(x2) = −3", term(mr, "x2"), -3.0, tol=1e-3)
check("R² = 1", mr["glance"]["r_sq"], 1.0, tol=1e-6)
pc = engine.pca({"columns": [x1, x2, yv], "labels": ["x1", "x2", "y"], "standardize": True})
ev = pc["extra"]["pca"]["explained"]
print(f"   PCA explained variance: {[round(e,4) for e in ev]} (sums to 1)")
check("PCA variance sums to 1", sum(ev), 1.0, tol=1e-6)

# 8 ─ Nested  →  nested ANOVA (engine.nested) ─────────────────────────────────
section(8, "Nested  →  nested ANOVA / nested t  (graph: nested scatter / box)")
# 2 groups × 3 subgroups × 4 reps; subgroup base = groupBase + 0.5·si, reps [-1,0,1,2].
groups = [{"label": "G%g" % gb,
           "subgroups": [[gb + 0.5 * si + v for v in (-1, 0, 1, 2)] for si in range(3)]}
          for gb in (10.0, 16.0)]
nst = engine.nested({"groups": groups})
# Independent pandas-groupby SS partition (different code path than the engine).
import pandas as _pd
_rows = [{"g": gi, "s": (gi, si), "y": gb + 0.5 * si + v}
         for gi, gb in enumerate((10.0, 16.0)) for si in range(3) for v in (-1, 0, 1, 2)]
_df = _pd.DataFrame(_rows); _grand = _df.y.mean()
_gm = _df.groupby("g").y.transform("mean"); _sm = _df.groupby("s").y.transform("mean")
ss_g = float(((_gm - _grand) ** 2).sum()); ss_s = float(((_sm - _gm) ** 2).sum()); ss_w = float(((_df.y - _sm) ** 2).sum())
by = {t["term"]: t for t in nst["terms"]}
print("   data: 2 groups × 3 subgroups × 4 reps (hierarchical)")
check("SS groups vs pandas-groupby", by["Groups"]["estimate"], ss_g)
check("SS subgroups-within vs pandas-groupby", by["Subgroups within groups"]["estimate"], ss_s)
check("SS residual vs pandas-groupby", by["Residual (within subgroups)"]["estimate"], ss_w)
# Nested F tests groups against the subgroup mean square (not the within MS).
check("nested F = MS_groups/MS_subgroups", nst["glance"]["f_groups"],
      (ss_g / 1) / (ss_s / 4))

print(f"\n{'='*70}")
print("Summary:", "all checks passed ✔" if not FAILS else f"{len(FAILS)} failed: {FAILS}")
print('='*70)
