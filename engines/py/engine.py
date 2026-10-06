#!/usr/bin/env python3
"""MadY stats engine — framed JSON-over-stdio.

Statistics computed with NumPy, SciPy and statsmodels. The ``METHODS`` table at the
end of this file lists every method (descriptives, normality, t tests, ANOVA,
regression, curve fitting, survival, ordination and more); ``crosscheck.py``
recomputes the results independently.
Every method returns the **tidy contract** (method/title/terms/glance/summary/
assumptions/cite) the document model stores.

NumPy/SciPy are imported **lazily** inside the methods, so the engine still
starts (and ``describe`` of the transport test runs) even where SciPy is absent;
a missing dependency surfaces as a typed ``numerical`` error. The frozen build
(PyInstaller) bundles SciPy. Transport: 4-byte big-endian length prefix + UTF-8 JSON
body on stdio. Every message has a ``type``; requests/results correlate by ``id``.
"""
import json
import math
import os
import struct
import sys
import warnings

CONTRACT_VERSION = 1


def _library_versions():
    """Versions of the interpreter + numeric libraries actually loaded here.

    Reported in the ``hello`` frame so the app can cite what really computed a
    result instead of naming libraries it assumes are present. Imported defensively
    and one at a time: the engine must still start when SciPy is missing (that is a
    typed error at method time, not a startup crash), so an absent library is simply
    omitted rather than fatal.
    """
    out = {"python": "%d.%d.%d" % sys.version_info[:3]}
    for name, module in (("numpy", "numpy"), ("scipy", "scipy"), ("statsmodels", "statsmodels")):
        try:
            out[name] = __import__(module).__version__
        except Exception:
            pass
    return out


def _np_sp():
    """Lazy NumPy + scipy.stats (clear typed error if the dependency is absent)."""
    try:
        import numpy as np
        from scipy import stats
        return np, stats
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise StatsError("numerical", "NumPy/SciPy unavailable: %s" % exc)


class StatsError(Exception):
    """A typed engine error (code maps to the wire ErrorCode)."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _num(values):
    """Coerce to a list of finite floats (drop null/blank/NaN)."""
    out = []
    for v in values or []:
        if v is None or v == "":
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if f == f and f not in (float("inf"), float("-inf")):  # drop NaN/inf
            out.append(f)
    return out


def _aligned(*cols):
    """Complete cases across columns that are paired by row, keeping the rows together.

    Use this, not `_num`, whenever two columns describe the same rows.

    `_num` compacts: dropping a blank slides every later value up one row. Two columns
    cleaned independently therefore stop describing the same rows, and truncating to the
    shorter one hides it. Cleaning [1, blank, 3, 4] against [10, 20, 30, 40] that way
    pairs 3 with 20 and 4 with 30, so a correlation would be computed on pairs the
    user never had — silently, with a plausible r.

    Position is preserved by testing each row as a unit: a row is kept only when every
    column has a usable number in it. That is the pairwise-complete rule `corrmatrix`
    uses, generalised to any number of columns.

    Wrong for independent samples (an unpaired t test's two groups, ANOVA groups):
    there a blank in one group would drop an unrelated value from the other. Clean those
    per column with `_num`.
    """
    rows = min((len(c or []) for c in cols), default=0)
    out = [[] for _ in cols]
    for r in range(rows):
        vals = [_num1((c or [])[r]) for c in cols]
        if any(v is None for v in vals):
            continue
        for i, v in enumerate(vals):
            out[i].append(v)
    return out


def _num1(v):
    """Coerce a single cell to a finite float, or None (null/blank/NaN/inf)."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if (f == f and f not in (float("inf"), float("-inf"))) else None


def _r(x, places=6):
    """Round for display, preserving None. Emits at least `places` decimal places
    and at least 6 significant figures, whichever is finer — so small-magnitude
    headline values (molar EC50/IC50/Kd/Ki, tiny p-values) keep their precision
    instead of collapsing to 0.0 under a fixed 6-decimal round. Never less precise
    than `places` decimals, so |x| >= 0.1 rounds to exactly `places` decimals
    (log10 >= -1 → the 6-sig-fig term is <= 6)."""
    if x is None:
        return None
    f = float(x)
    # A non-finite statistic is not a number the contract can carry: JSON has no
    # Infinity/NaN, so emitting one would produce a frame the renderer cannot parse, and
    # the supervisor would kill the engine over it — an ordinary 2x2 with a zero
    # cell would come back as "stats engine crashed". `None` is the tidy contract's
    # "not available", which every consumer already renders as a blank.
    if math.isnan(f) or math.isinf(f):
        return None
    if f == 0.0:
        return f
    dec = max(places, 5 - math.floor(math.log10(abs(f))))
    return round(f, dec)


def _flt(v):
    """Best-effort float — non-numeric → NaN (keeps row alignment for matrices)."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _p_words(p, alpha=0.05):
    # An absent p is not a non-significant one. Reading "the difference is not statistically
    # significant" off a test that could not be computed states a finding the data cannot
    # support — the mirror image of reporting p = 0.
    if p is None:
        return "not determinable from these data"
    return "statistically significant" if p < alpha else "not statistically significant"


def _read_exact(stream, n):
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def read_frame(stream):
    header = _read_exact(stream, 4)
    if header is None:
        return None
    (length,) = struct.unpack(">I", header)
    body = _read_exact(stream, length)
    if body is None:
        return None
    return json.loads(body.decode("utf-8"))


def _jsonable(o):
    """Replace every non-finite float with None, recursively.

    The backstop for the whole contract. `_r` maps non-finite values at the source,
    but not every number reaches the wire through it, and one that does not would
    kill the engine: Python's `json.dumps` emits the bare literals `Infinity` / `NaN`,
    which `JSON.parse` rejects, so the supervisor would log "malformed JSON" and SIGTERM
    the child. Making the frame safe here means no method can cause that failure by
    forgetting `_r`.
    """
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    return o


def write_frame(stream, message):
    # allow_nan=False turns "emitted an unparseable frame" into a normal Python
    # exception, which main() answers with a typed error frame. Without it a miss is
    # silent here and fatal downstream.
    body = json.dumps(_jsonable(message), allow_nan=False).encode("utf-8")
    stream.write(struct.pack(">I", len(body)))
    stream.write(body)
    stream.flush()


def describe(data):
    """Full descriptives: centre, spread, shape, and a t-based CI.

    Reports a full set of descriptive metrics — arithmetic/geometric/
    harmonic/quadratic (RMS) means, SD/SEM/variance/%CV, median + quartiles +
    IQR, range, sum, bias-corrected skewness & (excess) kurtosis, and a 10%
    trimmed + Winsorized mean. Metrics that are undefined for the data (e.g.
    geometric mean with a non-positive value, skewness with n < 3) report blank
    rather than erroring, by convention.
    """
    np, stats = _np_sp()
    x = _num((data or {}).get("values", []))
    n = len(x)
    if n == 0:
        raise StatsError("bad_request", "no numeric values to describe")
    a = np.asarray(x, dtype=float)
    mean = float(a.mean())
    sd = float(a.std(ddof=1)) if n > 1 else None
    var = (sd * sd) if sd is not None else None
    sem = (sd / (n ** 0.5)) if sd is not None else None
    conf = float((data or {}).get("conf", 0.95))
    if sem and n > 1:
        tcrit = float(stats.t.ppf(0.5 + conf / 2, n - 1))
        ci_lo, ci_hi = mean - tcrit * sem, mean + tcrit * sem
    else:
        ci_lo = ci_hi = None
    amin, amax = float(a.min()), float(a.max())
    median = float(np.median(a))
    # Distribution-free CI of the median from order statistics (the sign-test interval):
    # [X_(k), X_(n+1−k)] with coverage 1 − 2·P(Bin(n,0.5) ≤ k−1); k = the largest index whose
    # lower-tail binomial mass is ≤ α/2. Needs enough points to reach the requested coverage.
    asort = np.sort(a)
    med_lo = med_hi = None
    if n >= 6:
        kbest = 0
        for kk in range(1, n // 2 + 1):
            if float(stats.binom.cdf(kk - 1, n, 0.5)) <= (1.0 - conf) / 2.0:
                kbest = kk
            else:
                break
        if kbest >= 1:
            med_lo, med_hi = float(asort[kbest - 1]), float(asort[n - kbest])
    p25 = float(np.percentile(a, 25))
    p75 = float(np.percentile(a, 75))
    iqr = p75 - p25
    rng = amax - amin
    total = float(a.sum())
    cv = (100.0 * sd / mean) if (sd is not None and mean != 0) else None
    # Geometric & harmonic means require strictly positive data.
    all_pos = bool(np.all(a > 0))
    if all_pos:
        logs = np.log(a)
        geo_mean = float(np.exp(logs.mean()))
        geo_sd_factor = float(np.exp(logs.std(ddof=1))) if n > 1 else None
        harm_mean = float(n / np.sum(1.0 / a))
        # CI of the geometric mean = exp of the t-interval on the log scale.
        if n > 1:
            log_se = float(logs.std(ddof=1)) / (n ** 0.5)
            tcg = float(stats.t.ppf(0.5 + conf / 2, n - 1))
            geo_lo = float(np.exp(logs.mean() - tcg * log_se))
            geo_hi = float(np.exp(logs.mean() + tcg * log_se))
        else:
            geo_lo = geo_hi = None
    else:
        geo_mean = geo_sd_factor = harm_mean = geo_lo = geo_hi = None
    # Quadratic mean (root-mean-square) is always defined.
    rms = float(np.sqrt(np.mean(a * a)))
    # Bias-corrected (Fisher-Pearson G1 / excess G2), by the conventional definition.
    skew = float(stats.skew(a, bias=False)) if n >= 3 else None
    kurt = float(stats.kurtosis(a, fisher=True, bias=False)) if n >= 4 else None
    # Robust centres (10% each tail). Winsorize replaces tails; then average.
    if n >= 5:
        trimmed = float(stats.trim_mean(a, 0.1))
        wins = float(np.asarray(stats.mstats.winsorize(a, limits=0.1)).mean())
    else:
        trimmed = wins = None
    terms = [
        {"term": "n", "estimate": n},
        {"term": "Mean", "estimate": _r(mean), "ciLow": _r(ci_lo), "ciHigh": _r(ci_hi)},
        {"term": "Median", "estimate": _r(median), "ciLow": _r(med_lo), "ciHigh": _r(med_hi)},
        {"term": "Geometric mean", "estimate": _r(geo_mean), "ciLow": _r(geo_lo), "ciHigh": _r(geo_hi)},
        {"term": "Harmonic mean", "estimate": _r(harm_mean)},
        {"term": "Quadratic mean (RMS)", "estimate": _r(rms)},
        {"term": "Trimmed mean (10%)", "estimate": _r(trimmed)},
        {"term": "Winsorized mean (10%)", "estimate": _r(wins)},
        {"term": "SD", "estimate": _r(sd)},
        {"term": "Variance", "estimate": _r(var)},
        {"term": "SEM", "estimate": _r(sem)},
        {"term": "Geometric SD factor", "estimate": _r(geo_sd_factor)},
        {"term": "Coefficient of variation (%CV)", "estimate": _r(cv)},
        {"term": "Skewness", "estimate": _r(skew)},
        {"term": "Kurtosis (excess)", "estimate": _r(kurt)},
        {"term": "Min", "estimate": _r(amin)},
        {"term": "25th percentile", "estimate": _r(p25)},
        {"term": "75th percentile", "estimate": _r(p75)},
        {"term": "Max", "estimate": _r(amax)},
        {"term": "Range", "estimate": _r(rng)},
        {"term": "Interquartile range", "estimate": _r(iqr)},
        {"term": "Sum", "estimate": _r(total)},
    ]
    ci_txt = (" (%g%% CI %.4g to %.4g)" % (conf * 100, ci_lo, ci_hi)) if ci_lo is not None else ""
    return {
        "method": "describe",
        "title": "Descriptive statistics",
        "terms": terms,
        "glance": {"n": n, "mean": _r(mean), "sd": _r(sd)},
        "summary": "n = %d. Mean = %.4g%s; SD = %s; median = %.4g."
        % (n, mean, ci_txt, ("%.4g" % sd) if sd is not None else "—", median),
        "cite": "Descriptive statistics: means (arithmetic/"
        "geometric/harmonic/RMS), SD/SEM/variance/%%CV, quartiles/IQR, skewness & "
        "excess kurtosis (bias-corrected); the mean's CI is t-based at the chosen level.",
    }


def _anderson_p(a2, n):
    """Approximate p-value for the Anderson-Darling A² statistic (normal, params
    estimated) — D'Agostino & Stephens (1986) small-sample adjustment + the
    standard piecewise fit."""
    z = a2 * (1.0 + 0.75 / n + 2.25 / (n * n))  # finite-sample correction
    import math
    if z >= 0.6:
        p = math.exp(1.2937 - 5.709 * z + 0.0186 * z * z)
    elif z >= 0.34:
        p = math.exp(0.9177 - 4.279 * z - 1.38 * z * z)
    elif z >= 0.2:
        p = 1.0 - math.exp(-8.318 + 42.796 * z - 59.938 * z * z)
    else:
        p = 1.0 - math.exp(-13.436 + 101.14 * z - 223.73 * z * z)
    return min(1.0, max(0.0, p))


def normality(data):
    """Normality battery: Shapiro-Wilk + D'Agostino-Pearson + Anderson-Darling +
    Kolmogorov-Smirnov/Lilliefors (α = 0.05). Each test asks whether the sample
    plausibly comes from a normal distribution; small p ⇒ departs from normality."""
    np, stats = _np_sp()
    x = _num((data or {}).get("values", []))
    n = len(x)
    if n < 3:
        raise StatsError("bad_request", "need at least 3 values for a normality test")
    a = np.asarray(x, dtype=float)
    terms = []
    assumptions = []
    w, sh_p = stats.shapiro(a)
    terms.append({"term": "Shapiro-Wilk", "statistic": _r(float(w)), "p": _r(float(sh_p)), "df": n})
    if n >= 8:
        k2, dp = stats.normaltest(a)
        terms.append({"term": "D'Agostino-Pearson", "statistic": _r(float(k2)), "p": _r(float(dp))})
    else:
        assumptions.append("D'Agostino-Pearson skipped (needs n ≥ 8).")
    # Anderson-Darling (parameters estimated) + approximate p.
    try:
        ad = stats.anderson(a, dist="norm")
        a2 = float(ad.statistic)
        terms.append({"term": "Anderson-Darling", "statistic": _r(a2), "p": _r(_anderson_p(a2, n))})
    except Exception:  # pragma: no cover
        pass
    # Lilliefors (KS with estimated mean/SD — the correct KS-for-normality).
    try:
        from statsmodels.stats.diagnostic import lilliefors
        ks_d, ks_p = lilliefors(a, dist="norm")
        terms.append({"term": "Kolmogorov-Smirnov (Lilliefors)", "statistic": _r(float(ks_d)), "p": _r(float(ks_p))})
    except Exception:  # pragma: no cover - statsmodels absent
        sd = float(a.std(ddof=1)) if n > 1 else 0.0
        if sd > 0:
            ks = stats.kstest(a, "norm", args=(float(a.mean()), sd))
            terms.append({"term": "Kolmogorov-Smirnov", "statistic": _r(float(ks.statistic)), "p": _r(float(ks.pvalue))})
            assumptions.append("KS p is approximate (parameters estimated; install statsmodels for the Lilliefors correction).")
    alpha = 1.0 - float((data or {}).get("conf", 0.95))
    # Lognormality: which distribution the sample is more consistent with — an MLE normal
    # vs an MLE lognormal fit, compared by AIC (both have k = 2 parameters, so the AIC
    # difference reduces to twice the log-likelihood difference). Needs strictly positive
    # data (lognormal support).
    ln_pref = None
    ln_prob = None
    if bool(np.all(a > 0)):
        la = np.log(a)
        mu, sig = float(a.mean()), float(a.std(ddof=0))
        mul, sigl = float(la.mean()), float(la.std(ddof=0))
        if sig > 0 and sigl > 0:
            ll_norm = float(np.sum(stats.norm.logpdf(a, mu, sig)))
            # lognormal log-density at x = normal log-density at ln(x), minus the ln(x) Jacobian.
            ll_lnorm = float(np.sum(stats.norm.logpdf(la, mul, sigl)) - np.sum(la))
            diff = ll_lnorm - ll_norm  # > 0 ⇒ lognormal is the better fit
            ln_pref = "lognormal" if diff > 0 else "normal"
            ln_prob = 1.0 / (1.0 + float(np.exp(-abs(diff))))  # Akaike weight of the preferred model
            terms.append({"term": "More consistent with", "estimate": ln_pref})
            terms.append({"term": "P(preferred, by AIC)", "estimate": _r(ln_prob)})
    else:
        assumptions.append("Lognormality not tested (needs all values > 0).")
    passes = sh_p is not None and sh_p >= alpha
    ln_txt = (" Distribution: more consistent with %s (P ≈ %.1f%%)." % (ln_pref, 100.0 * ln_prob)) if ln_pref else ""
    return {
        "method": "normality",
        "title": "Normality & lognormality",
        "terms": terms,
        "glance": {"n": n, "shapiro_W": _r(float(w)), "shapiro_p": _r(float(sh_p)),
                   "prefers": ln_pref, "lognormal_prob": _r(ln_prob)},
        "summary": "Shapiro-Wilk p = %.4g — the data are %s normal at α = %.3g (plus D'Agostino, Anderson-Darling, KS/Lilliefors).%s"
        % (sh_p, "consistent with" if passes else "not consistent with", alpha, ln_txt),
        "assumptions": assumptions,
        "cite": "Shapiro-Wilk (1965); D'Agostino-Pearson (1973); Anderson-Darling (1952) + Stephens p; Lilliefors (1967) KS; normal-vs-lognormal by AIC.",
    }


def _cohens_d_pooled(np, a, b):
    na, nb = len(a), len(b)
    sa2, sb2 = a.var(ddof=1), b.var(ddof=1)
    sp = (((na - 1) * sa2 + (nb - 1) * sb2) / (na + nb - 2)) ** 0.5
    return (a.mean() - b.mean()) / sp if sp else None, sp


def _hedges_g(d, df):
    """Hedges' g = Cohen's d × the small-sample bias correction J = 1 − 3/(4·df − 1)
    (Hedges 1981). df = pooled n−2 for two groups, n−1 for one-sample/paired."""
    if d is None or df is None or df <= 0:
        return None
    return d * (1.0 - 3.0 / (4.0 * df - 1.0))


def _d_ci(stats, d, df, n_eff, conf=0.95):
    """Exact CI for Cohen's d via the noncentral-t distribution (the standard
    method): the observed t at the point estimate is t = d·√n_eff, so invert
    nct.cdf(t; df, ncp) (monotone-decreasing in ncp) by bisection for the ncp
    bounds, then divide by √n_eff. n_eff = n (one-sample/paired) or n₁n₂/(n₁+n₂)
    (two groups). Returns (lo, hi), or (None, None) if undefined."""
    if d is None or df <= 0 or n_eff <= 0:
        return None, None
    root = n_eff ** 0.5
    tobs = d * root
    alpha = 1.0 - conf
    span = 20.0 * (1.0 + abs(tobs))

    def solve(target):
        lo, hi = tobs - span, tobs + span
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if float(stats.nct.cdf(tobs, df, mid)) > target:
                lo = mid  # need a larger ncp to push the cdf down to target
            else:
                hi = mid
        return 0.5 * (lo + hi)

    ncp_lo = solve(1.0 - alpha / 2.0)  # lower d bound (large cdf → small ncp)
    ncp_hi = solve(alpha / 2.0)        # upper d bound
    return ncp_lo / root, ncp_hi / root


_TAIL_LABEL = {"two-sided": "two-tailed", "greater": "one-tailed (greater)", "less": "one-tailed (less)"}


def ttest(data):
    """t tests: one-sample / unpaired (Student & Welch) / paired + nonparametric."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "unpaired")
    # A paired comparison reads the same rows from both columns, so they must be
    # cleaned together (`_aligned`); an independent-samples variant must not be, or a
    # blank in one group would drop an unrelated value from the other.
    if variant in ("paired", "wilcoxon"):
        _pa, _pb = _aligned(d.get("a"), d.get("b"))
        a = np.asarray(_pa, dtype=float)
        b = np.asarray(_pb, dtype=float)
    else:
        a = np.asarray(_num(d.get("a", [])), dtype=float)
        b = np.asarray(_num(d.get("b", [])), dtype=float)
    conf = float(d.get("conf", 0.95))
    # Tail / direction: two-sided (default) or one-sided ("greater" / "less"), mapped
    # straight to scipy's `alternative=`. A one-tailed test reports a one-sided CI in
    # the direction of the alternative (by convention).
    tail = d.get("tail", "two-sided")
    if tail not in ("two-sided", "greater", "less"):
        tail = "two-sided"
    # Residual arrays for the diagnostic graphs, filled by the parametric variants
    # (the nonparametric ones assume no normal residuals, so they leave it None).
    resid_extra = None

    def ci_of(mean, se, df):
        """Confidence interval for an effect estimate, honouring `tail`. Two-sided →
        both bounds; one-sided → an interval open on the far side (None = ±∞)."""
        if se is None or se <= 0 or df <= 0:
            return None, None
        if tail == "two-sided":
            tc = float(stats.t.ppf(0.5 + conf / 2, df))
            return mean - tc * se, mean + tc * se
        tc = float(stats.t.ppf(conf, df))  # one-sided critical value
        if tail == "greater":
            return mean - tc * se, None    # lower confidence bound only
        return None, mean + tc * se        # tail == "less": upper bound only

    if variant == "one-sample":
        if a.size < 2:
            raise StatsError("bad_request", "one-sample t needs ≥ 2 values")
        mu = float(d.get("mu", 0.0))
        t, p = stats.ttest_1samp(a, mu, alternative=tail)
        df = a.size - 1
        sd = float(a.std(ddof=1))
        se = sd / (a.size ** 0.5)
        mean = float(a.mean())
        lo, hi = ci_of(mean - mu, se, df)
        dval = (mean - mu) / sd if sd else None
        dlo, dhi = _d_ci(stats, dval, df, a.size, conf)
        # Residuals = deviations from the sample mean (fitted = the constant mean).
        resid_extra = {"fitted": [_r(mean)] * a.size, "resid": [_r(float(v - mean)) for v in a]}
        terms = [
            {"term": "Sample mean", "estimate": _r(mean), "df": df},
            {"term": "Difference vs %g" % mu, "estimate": _r(mean - mu), "ciLow": _r(lo), "ciHigh": _r(hi),
             "statistic": _r(float(t)), "df": df, "p": _r(float(p))},
            {"term": "Cohen's d", "estimate": _r(dval), "ciLow": _r(dlo), "ciHigh": _r(dhi)},
            {"term": "Hedges' g", "estimate": _r(_hedges_g(dval, df)),
             "ciLow": _r(_hedges_g(dlo, df)), "ciHigh": _r(_hedges_g(dhi, df))},
        ]
        # Diagnostic: the one-sample t assumes the sample is normal — test it.
        if a.size >= 3:
            sws, swsp = stats.shapiro(a)
            terms.append({"term": "Sample normality (Shapiro-Wilk)", "statistic": _r(float(sws)), "p": _r(float(swsp))})
        title = "One-sample t test"
        glance = {"t": _r(float(t)), "df": df, "p": _r(float(p)), "cohens_d": _r(dval),
                  "hedges_g": _r(_hedges_g(dval, df)), "n": a.size}
        assumptions = ["Assumes the sample is approximately normal (independent observations) — check with a normality test."]
    elif variant in ("unpaired", "welch"):
        if a.size < 2 or b.size < 2:
            raise StatsError("bad_request", "unpaired t needs ≥ 2 values per group")
        welch = variant == "welch"
        t, p = stats.ttest_ind(a, b, equal_var=not welch, alternative=tail)
        ma, mb = float(a.mean()), float(b.mean())
        diff = ma - mb
        if welch:
            sa2, sb2 = a.var(ddof=1), b.var(ddof=1)
            se = (sa2 / a.size + sb2 / b.size) ** 0.5
            df = (sa2 / a.size + sb2 / b.size) ** 2 / (
                (sa2 / a.size) ** 2 / (a.size - 1) + (sb2 / b.size) ** 2 / (b.size - 1)
            )
            dval, _ = _cohens_d_pooled(np, a, b)
        else:
            dval, sp = _cohens_d_pooled(np, a, b)
            se = sp * (1 / a.size + 1 / b.size) ** 0.5
            df = a.size + b.size - 2
        lo, hi = ci_of(diff, se, df)
        # Hedges' g uses the pooled df (n_A+n_B−2) even for Welch (g corrects the pooled-SD d).
        df_pool = a.size + b.size - 2
        gval = _hedges_g(dval, df_pool)
        # Glass's Δ standardises the mean difference by the control group's SD (group B by convention).
        sd_b = float(b.std(ddof=1))
        glass = diff / sd_b if sd_b else None
        # Noncentral-t CI for d (pooled df + harmonic n_eff), propagated to g via the J factor.
        n_eff = a.size * b.size / (a.size + b.size)
        dlo, dhi = _d_ci(stats, dval, df_pool, n_eff, conf)
        # Diagnostics: F test for equal variances (informs Student vs Welch) + residual normality.
        va, vb = float(a.var(ddof=1)), float(b.var(ddof=1))
        if min(va, vb) > 0:
            f_ratio = max(va, vb) / min(va, vb)  # ≥ 1
            dfn, dfd = ((a.size - 1, b.size - 1) if va >= vb else (b.size - 1, a.size - 1))
            f_p = min(1.0, 2.0 * float(stats.f.sf(f_ratio, dfn, dfd)))
        else:
            f_ratio = f_p = None
        resid = np.concatenate([a - a.mean(), b - b.mean()])
        sw, swp = stats.shapiro(resid) if resid.size >= 3 else (None, None)
        # Residuals = within-group deviations; each obs's fitted value is its group mean.
        resid_extra = {"fitted": [_r(ma)] * a.size + [_r(mb)] * b.size,
                       "resid": [_r(float(v)) for v in resid]}
        terms = [
            {"term": "Group A mean", "estimate": _r(ma)},
            {"term": "Group B mean", "estimate": _r(mb)},
            {"term": "Difference (A − B)", "estimate": _r(diff), "ciLow": _r(lo), "ciHigh": _r(hi),
             "statistic": _r(float(t)), "df": _r(float(df)), "p": _r(float(p))},
            {"term": "Cohen's d", "estimate": _r(dval), "ciLow": _r(dlo), "ciHigh": _r(dhi)},
            {"term": "Hedges' g", "estimate": _r(gval), "ciLow": _r(_hedges_g(dlo, df_pool)), "ciHigh": _r(_hedges_g(dhi, df_pool))},
            {"term": "Glass's Δ (vs Group B SD)", "estimate": _r(glass)},
            {"term": "Equal variances (F test)", "statistic": _r(f_ratio), "p": _r(f_p)},
            {"term": "Residual normality (Shapiro-Wilk)",
             "statistic": _r(float(sw) if sw is not None else None), "p": _r(float(swp) if swp is not None else None)},
        ]
        title = "Unpaired t test (Welch)" if welch else "Unpaired t test (Student)"
        glance = {"t": _r(float(t)), "df": _r(float(df)), "p": _r(float(p)), "cohens_d": _r(dval),
                  "hedges_g": _r(gval), "glass_delta": _r(glass), "n_A": a.size, "n_B": b.size}
        assumptions = ["Assumes both groups are approximately normal, with independent observations."]
        assumptions.append("Welch's t does not assume equal variances." if welch
                           else "Student's t assumes equal variances — use Welch if unsure.")
    elif variant == "paired":
        if a.size != b.size or a.size < 2:
            raise StatsError("bad_request", "paired t needs equal-length groups (≥ 2)")
        t, p = stats.ttest_rel(a, b, alternative=tail)
        diffs = a - b
        df = a.size - 1
        md = float(diffs.mean())
        sd = float(diffs.std(ddof=1))
        se = sd / (a.size ** 0.5)
        lo, hi = ci_of(md, se, df)
        # Residuals of the paired differences about their mean (the paired t fits one mean).
        resid_extra = {"fitted": [_r(md)] * diffs.size, "resid": [_r(float(v - md)) for v in diffs]}
        dval = md / sd if sd else None
        dlo, dhi = _d_ci(stats, dval, df, a.size, conf)
        terms = [
            {"term": "Mean difference (A − B)", "estimate": _r(md), "ciLow": _r(lo), "ciHigh": _r(hi),
             "statistic": _r(float(t)), "df": df, "p": _r(float(p))},
            {"term": "Cohen's d", "estimate": _r(dval), "ciLow": _r(dlo), "ciHigh": _r(dhi)},
            {"term": "Hedges' g", "estimate": _r(_hedges_g(dval, df)),
             "ciLow": _r(_hedges_g(dlo, df)), "ciHigh": _r(_hedges_g(dhi, df))},
        ]
        # Diagnostic: the paired t assumes the differences are normal — test them.
        if diffs.size >= 3:
            swd, swdp = stats.shapiro(diffs)
            terms.append({"term": "Difference normality (Shapiro-Wilk)", "statistic": _r(float(swd)), "p": _r(float(swdp))})
        title = "Paired t test"
        glance = {"t": _r(float(t)), "df": df, "p": _r(float(p)), "cohens_d": _r(dval),
                  "hedges_g": _r(_hedges_g(dval, df)), "pairs": a.size}
        assumptions = ["Assumes the paired differences are approximately normal."]
    elif variant == "mann-whitney":
        if a.size < 1 or b.size < 1:
            raise StatsError("bad_request", "Mann-Whitney needs values in both groups")
        u, p = stats.mannwhitneyu(a, b, alternative=tail)
        # Rank-biserial correlation, Kerby's simple-difference form: P(a > b) − P(a < b).
        # scipy's `u` is U for the first sample (the a>b pair count), so the mapping is
        # 2U/(nA·nB) − 1. The form `1 − 2U/(nA·nB)` has the same magnitude with the sign
        # inverted: a group entirely below the other would report +1 beside
        # Median A < Median B.
        rbc = 2 * float(u) / (a.size * b.size) - 1
        terms = [
            {"term": "Median A", "estimate": _r(float(np.median(a)))},
            {"term": "Median B", "estimate": _r(float(np.median(b)))},
            {"term": "Mann-Whitney U", "statistic": _r(float(u)), "p": _r(float(p))},
        ]
        title = "Mann-Whitney U (nonparametric)"
        glance = {"U": _r(float(u)), "p": _r(float(p)), "rank_biserial": _r(rbc), "n_A": a.size, "n_B": b.size}
        assumptions = [
            "Distribution-free; compares ranks (no normality assumption), independent samples.",
            "Tests a difference in medians only when the two distributions have the same shape; otherwise "
            "it tests stochastic dominance (whether values in one group tend to exceed the other).",
        ]
    elif variant == "wilcoxon":
        if a.size != b.size or a.size < 1:
            raise StatsError("bad_request", "Wilcoxon needs equal-length paired groups")
        w, p = stats.wilcoxon(a, b, alternative=tail)
        terms = [
            {"term": "Median difference", "estimate": _r(float(np.median(a - b)))},
            {"term": "Wilcoxon W", "statistic": _r(float(w)), "p": _r(float(p))},
        ]
        title = "Wilcoxon signed-rank (nonparametric)"
        glance = {"W": _r(float(w)), "p": _r(float(p)), "pairs": a.size}
        assumptions = ["Distribution-free paired test (no normality assumption)."]
    elif variant == "wilcoxon-1samp":
        if a.size < 1:
            raise StatsError("bad_request", "one-sample Wilcoxon needs ≥ 1 value")
        mu = float(d.get("mu", 0.0))
        diff = a - mu
        if bool(np.all(diff == 0)):
            raise StatsError("bad_request", "one-sample Wilcoxon: every value equals μ (no signed ranks)")
        w, p = stats.wilcoxon(diff, alternative=tail)
        med = float(np.median(a))
        terms = [
            {"term": "Median", "estimate": _r(med)},
            {"term": "Median − %g" % mu, "estimate": _r(med - mu)},
            {"term": "Wilcoxon W", "statistic": _r(float(w)), "p": _r(float(p))},
        ]
        title = "One-sample Wilcoxon signed-rank"
        glance = {"W": _r(float(w)), "p": _r(float(p)), "n": a.size}
        assumptions = [
            "Distribution-free test that the median equals %g (independent observations)." % mu,
            "Assumes the distribution of (value − μ) is roughly symmetric; zero-differences are dropped.",
        ]
    elif variant == "ks":
        if a.size < 1 or b.size < 1:
            raise StatsError("bad_request", "Kolmogorov-Smirnov needs values in both groups")
        dstat, p = stats.ks_2samp(a, b, alternative=tail)
        terms = [
            {"term": "Median A", "estimate": _r(float(np.median(a)))},
            {"term": "Median B", "estimate": _r(float(np.median(b)))},
            {"term": "Kolmogorov-Smirnov D", "statistic": _r(float(dstat)), "p": _r(float(p))},
        ]
        title = "Two-sample Kolmogorov-Smirnov"
        glance = {"D": _r(float(dstat)), "p": _r(float(p)), "n_A": a.size, "n_B": b.size}
        assumptions = [
            "Distribution-free; compares the whole empirical distributions (location and shape).",
            "Low power for a pure shift in location — use Mann-Whitney or a t test for that; the p-value is "
            "only approximate with ties / discrete data. Assumes independent samples.",
        ]
    elif variant == "ratio-paired":
        if a.size != b.size or a.size < 2:
            raise StatsError("bad_request", "ratio paired t needs equal-length groups (≥ 2)")
        if bool(np.any(a <= 0)) or bool(np.any(b <= 0)):
            raise StatsError("bad_request", "ratio t needs all-positive values (it works on log ratios)")
        logr = np.log(a / b)
        t, p = stats.ttest_1samp(logr, 0.0, alternative=tail)
        df = a.size - 1
        gmr = float(np.exp(logr.mean()))  # geometric mean of the A/B ratios
        se = float(logr.std(ddof=1)) / (a.size ** 0.5)
        lo, hi = ci_of(float(logr.mean()), se, df)
        rlo = float(np.exp(lo)) if lo is not None else None
        rhi = float(np.exp(hi)) if hi is not None else None
        terms = [
            {"term": "Geometric mean ratio (A / B)", "estimate": _r(gmr), "ciLow": _r(rlo), "ciHigh": _r(rhi)},
            {"term": "log(ratio) vs 0", "statistic": _r(float(t)), "df": df, "p": _r(float(p))},
        ]
        title = "Ratio paired t test"
        glance = {"t": _r(float(t)), "df": df, "p": _r(float(p)), "geo_mean_ratio": _r(gmr), "pairs": a.size}
        assumptions = [
            "Needs all-positive paired values; works on log(A/B), assuming the log-ratios are approximately "
            "normal (lognormal / multiplicative data).",
            "Tests whether the geometric-mean ratio = 1 (a constant fold-change), not a constant additive difference.",
        ]
    else:
        raise StatsError("bad_request", "unknown t-test variant: %s" % variant)

    # If the test statistic is unavailable — zero variance makes it 0/0 or x/0 — then so
    # is the P value. scipy hands back p = 0.0 there, so a t test on two constant groups
    # would claim a maximally significant difference from data that cannot support any;
    # the ANOVA path applies the same rule. `"t" in glance` scopes this to the
    # parametric variants: the nonparametric ones report U/W and are computable regardless.
    if "t" in glance and glance["t"] is None and glance.get("p") is not None:
        glance["p"] = None
        for row in terms:
            if row.get("statistic") is None and row.get("p") is not None:
                row["p"] = None
        assumptions = assumptions + [ZERO_VARIANCE_NOTE]

    p_val = glance.get("p")
    return {
        "method": "ttest",
        "title": title,
        "terms": terms,
        "glance": glance,
        **({"extra": {"residuals": resid_extra}} if resid_extra else {}),
        "summary": "%s (%s): the difference is %s (p = %s)." % (
            title, _TAIL_LABEL[tail], _p_words(p_val), ("%.4g" % p_val) if p_val is not None else "—"),
        "assumptions": assumptions + ([] if tail == "two-sided" else [
            "One-tailed test (alternative: the effect is %s) — only use a one-tailed test when the "
            "direction was predicted in advance; the confidence interval is reported one-sided." % (
                "greater" if tail == "greater" else "less")]),
        "cite": "%s at α = %.3g; %s." % (_TAIL_LABEL[tail].capitalize(), 1.0 - conf, title),
    }


def equivalence(data):
    """TOST — two one-sided tests for equivalence.

    A non-significant t test does not show two groups are the same; it shows the data
    could not distinguish them, which is a different (and much weaker) claim. TOST asks
    the question people usually mean: is the difference small enough to not matter?

    The user supplies an equivalence bound Δ — the smallest difference that would matter.
    Two one-sided tests run against the bounds:
        H01: difference ≤ −Δ   (tested against the upper alternative)
        H02: difference ≥ +Δ   (tested against the lower alternative)
    Both must be rejected to conclude equivalence, so p_TOST = max(p1, p2). Equivalently
    — and this is what makes it readable — the (1 − 2α) CI must lie entirely inside
    [−Δ, +Δ]. That 90% interval (at α = 0.05) is reported alongside the bounds.

    Bounds may be given in raw data units, in pooled-SD units (Cohen's d), or as a
    percentage of the reference mean; the resolved raw bounds are always reported so the
    reader never has to reconstruct them.
    """
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "unpaired")
    # A paired comparison reads the same rows from both columns, so they must be
    # cleaned together (`_aligned`); an independent-samples variant must not be, or a
    # blank in one group would drop an unrelated value from the other.
    if variant == "paired":
        _pa, _pb = _aligned(d.get("a"), d.get("b"))
        a = np.asarray(_pa, dtype=float)
        b = np.asarray(_pb, dtype=float)
    else:
        a = np.asarray(_num(d.get("a", [])), dtype=float)
        b = np.asarray(_num(d.get("b", [])), dtype=float)
    alpha = float(d.get("alpha", 0.05))
    if not (0 < alpha < 0.5):
        raise StatsError("bad_request", "alpha must be between 0 and 0.5")

    # ── the difference, its SE and df — one row per design ────────────────────
    if variant == "one-sample":
        if a.size < 2:
            raise StatsError("bad_request", "one-sample equivalence needs ≥ 2 values")
        mu = float(d.get("mu", 0.0))
        diff = float(a.mean()) - mu
        sd_ref = float(a.std(ddof=1))
        se = sd_ref / (a.size ** 0.5)
        df = a.size - 1
        n_desc, ref_mean, title = "n = %d" % a.size, float(a.mean()), "Equivalence (TOST) — one sample"
    elif variant == "paired":
        n = min(a.size, b.size)
        if n < 2:
            raise StatsError("bad_request", "paired equivalence needs ≥ 2 pairs")
        dif = a[:n] - b[:n]
        diff = float(dif.mean())
        sd_ref = float(dif.std(ddof=1))
        se = sd_ref / (n ** 0.5)
        df = n - 1
        n_desc, ref_mean, title = "%d pairs" % n, float(b[:n].mean()), "Equivalence (TOST) — paired"
    else:  # unpaired — Welch by default (does not assume equal variances)
        if a.size < 2 or b.size < 2:
            raise StatsError("bad_request", "unpaired equivalence needs ≥ 2 values per group")
        va, vb = float(a.var(ddof=1)), float(b.var(ddof=1))
        na, nb = a.size, b.size
        diff = float(a.mean()) - float(b.mean())
        # Pooled SD is the reference for d-scaled bounds even under Welch: the bound is a
        # statement about effect size, not about the test's variance assumption.
        sd_ref = (((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)) ** 0.5 if na + nb > 2 else float("nan")
        if d.get("pooled"):
            se = sd_ref * (1.0 / na + 1.0 / nb) ** 0.5
            df = na + nb - 2
        else:
            se = (va / na + vb / nb) ** 0.5
            df = ((va / na + vb / nb) ** 2 /
                  ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))) if se > 0 else 0.0
        n_desc, ref_mean = "n = %d vs %d" % (na, nb), float(b.mean())
        title = "Equivalence (TOST) — unpaired"

    # ── resolve the equivalence bounds to raw data units ──────────────────────
    mode = d.get("boundMode", "absolute")
    if mode == "sd":
        if not (sd_ref > 0):
            raise StatsError("bad_request", "cannot scale the bound by SD: the SD is zero or undefined")
        lo_b = -abs(float(d.get("bound", 0.5))) * sd_ref
        hi_b = abs(float(d.get("boundHigh", d.get("bound", 0.5)))) * sd_ref
    elif mode == "percent":
        if not abs(ref_mean) > 0:
            raise StatsError("bad_request", "cannot scale the bound by percent: the reference mean is zero")
        lo_b = -abs(float(d.get("bound", 10.0))) / 100.0 * abs(ref_mean)
        hi_b = abs(float(d.get("boundHigh", d.get("bound", 10.0)))) / 100.0 * abs(ref_mean)
    else:
        # Explicit asymmetric bounds are allowed; a single `bound` is taken as ±bound.
        if d.get("boundLow") is not None or d.get("boundHigh") is not None:
            lo_b = float(d.get("boundLow", -abs(float(d.get("bound", 0.0)))))
            hi_b = float(d.get("boundHigh", abs(float(d.get("bound", 0.0)))))
        else:
            lo_b = -abs(float(d.get("bound", 0.0)))
            hi_b = abs(float(d.get("bound", 0.0)))
    if not (lo_b < hi_b):
        raise StatsError("bad_request", "the equivalence bounds must straddle zero (low < high)")
    if not (se > 0) or not (df > 0):
        raise StatsError("bad_request", "cannot run TOST: the standard error or df is zero")

    # ── the two one-sided tests ───────────────────────────────────────────────
    # t1 tests H01 (diff ≤ lo) — reject when the difference is comfortably above lo.
    # t2 tests H02 (diff ≥ hi) — reject when the difference is comfortably below hi.
    t1 = (diff - lo_b) / se
    t2 = (diff - hi_b) / se
    p1 = float(stats.t.sf(t1, df))   # P(T > t1) — upper tail
    p2 = float(stats.t.cdf(t2, df))  # P(T < t2) — lower tail
    p_tost = max(p1, p2)
    # The CI whose containment is exactly equivalent to the TOST decision is (1 − 2α).
    tc = float(stats.t.ppf(1.0 - alpha, df))
    ci_lo, ci_hi = diff - tc * se, diff + tc * se
    equivalent = bool(p_tost < alpha)
    # The two questions are independent: a difference can be statistically significant and
    # practically equivalent (a precisely-measured trivial difference), or non-significant
    # and inconclusive. Reporting both is what stops "p > 0.05" being read as "the same".
    p_diff = float(stats.t.sf(abs(diff / se), df) * 2)
    conf_pct = 100.0 * (1.0 - 2.0 * alpha)

    terms = [
        {"term": "Difference", "estimate": _r(diff), "ciLow": _r(ci_lo), "ciHigh": _r(ci_hi),
         "df": _r(df), "note": "%.0f%% CI (the interval TOST decides on)" % conf_pct},
        {"term": "Equivalence bound (low)", "estimate": _r(lo_b)},
        {"term": "Equivalence bound (high)", "estimate": _r(hi_b)},
        {"term": "TOST lower (H0: difference ≤ low bound)", "statistic": _r(t1), "df": _r(df), "p": _r(p1)},
        {"term": "TOST upper (H0: difference ≥ high bound)", "statistic": _r(t2), "df": _r(df), "p": _r(p2)},
        {"term": "TOST p (the larger of the two)", "p": _r(p_tost)},
        {"term": "Equivalent at α = %g" % alpha, "estimate": "yes" if equivalent else "no"},
        {"term": "Difference test (two-sided, for contrast)", "p": _r(p_diff)},
    ]
    if sd_ref > 0:
        terms.append({"term": "Bounds in SD units (Cohen's d)", "estimate": _r(lo_b / sd_ref),
                      "note": "high bound = %.4g" % (hi_b / sd_ref)})

    # Four distinct outcomes, not two — the whole point of running both tests.
    if equivalent and p_diff < alpha:
        verdict = ("statistically different but practically equivalent — the difference is real and "
                   "smaller than the bound")
    elif equivalent:
        verdict = "equivalent — the difference is within the bound"
    elif p_diff < alpha:
        verdict = "different — and not shown to be within the bound"
    else:
        verdict = ("inconclusive — neither different nor shown equivalent; the data cannot rule out a "
                   "difference larger than the bound")

    return {
        "method": "equivalence", "title": title,
        "terms": terms,
        "glance": {"difference": _r(diff), "ci_low": _r(ci_lo), "ci_high": _r(ci_hi),
                   "bound_low": _r(lo_b), "bound_high": _r(hi_b), "t1": _r(t1), "t2": _r(t2),
                   "p1": _r(p1), "p2": _r(p2), "p": _r(p_tost), "p_difference": _r(p_diff),
                   "equivalent": equivalent, "df": _r(df), "alpha": alpha},
        "summary": "%s (%s): difference %.4g, %.0f%% CI %.4g to %.4g, bounds %.4g to %.4g — %s (TOST p = %.4g)." % (
            title, n_desc, diff, conf_pct, ci_lo, ci_hi, lo_b, hi_b, verdict, p_tost),
        "assumptions": [
            "The equivalence bound is a scientific judgement you must justify — it is the smallest "
            "difference that would matter, chosen before seeing the data.",
            "Equivalence is declared only when the whole %.0f%% CI lies inside the bounds." % conf_pct,
            "Assumes approximately normal data (as the t test does); TOST inherits every t-test assumption.",
        ],
        "warnings": ([] if equivalent or p_diff < alpha else [
            "Neither test rejected: this is an inconclusive result, not evidence of equivalence. "
            "A wider bound or a larger sample is needed to decide."]),
        "cite": "Two one-sided tests (TOST) for equivalence; Schuirmann (1987). Equivalent to checking "
                "the %.0f%% CI against the bounds." % conf_pct,
    }


def permutation(data):
    """Permutation (randomization) test — a p-value built from the data's own arrangement.

    Instead of assuming a null distribution (normal, t, …), the null is constructed by
    rearranging the data the way the null hypothesis says is irrelevant, and recomputing
    the statistic every time. Nothing is assumed about the shape of the distribution.

    Two regimes, chosen automatically and always reported:
      · Exact — when every rearrangement can be enumerated, the p-value is exact and
        fully reproducible with no random seed involved.
      · Monte Carlo — otherwise, sample `nResamples` rearrangements from a seeded
        generator, so the run is still reproducible.

    Two details that are easy to get wrong and are handled explicitly here:
      1. The observed arrangement is itself a valid rearrangement, so it is counted. A
         permutation p-value can therefore never be 0 — reporting 0 would be a claim no
         permutation test can make. Exact uses count/total (count ≥ 1); Monte Carlo uses
         (count + 1)/(N + 1), the Davison-Hinkley correction.
      2. A Monte Carlo p is an estimate, so its own uncertainty is reported as a
         binomial CI. Without it, p = 0.001 from 1000 resamples looks far more precise
         than it is.
    """
    np, stats = _np_sp()
    from math import comb
    d = data or {}
    variant = d.get("variant", "unpaired")
    # A paired comparison reads the same rows from both columns, so they must be
    # cleaned together (`_aligned`); an independent-samples variant must not be, or a
    # blank in one group would drop an unrelated value from the other.
    if variant == "paired":
        _pa, _pb = _aligned(d.get("a"), d.get("b"))
        a = np.asarray(_pa, dtype=float)
        b = np.asarray(_pb, dtype=float)
    else:
        a = np.asarray(_num(d.get("a", [])), dtype=float)
        b = np.asarray(_num(d.get("b", [])), dtype=float)
    tail = d.get("tail", "two-sided")
    if tail not in ("two-sided", "greater", "less"):
        tail = "two-sided"
    n_resamples = max(99, int(d.get("nResamples", 10000) or 10000))
    seed = int(d.get("seed", 12345))
    stat_kind = d.get("statistic", "mean")
    # Enumerating beyond this many rearrangements is slower than sampling and buys nothing.
    max_exact = max(1, int(d.get("maxExact", 100000) or 100000))
    rng = np.random.default_rng(seed)

    # ── per-design: observed statistic, an exact enumerator, and a sampler ────
    if variant in ("paired", "one-sample"):
        if variant == "paired":
            n = min(a.size, b.size)
            if n < 2:
                raise StatsError("bad_request", "paired permutation needs ≥ 2 pairs")
            diffs = a[:n] - b[:n]
            label, title = "Mean of paired differences", "Permutation test — paired"
        else:
            if a.size < 2:
                raise StatsError("bad_request", "one-sample permutation needs ≥ 2 values")
            mu = float(d.get("mu", 0.0))
            diffs = a - mu
            label, title = "Mean difference vs %g" % mu, "Permutation test — one sample"
            n = a.size
        # Under the null the sign of each difference is arbitrary → 2^n sign flips.
        obs = float(np.mean(diffs))
        total = 2 ** n
        if total <= max_exact:
            def enumerate_stats():
                for mask in range(total):
                    signs = np.array([1.0 if (mask >> i) & 1 == 0 else -1.0 for i in range(n)])
                    yield float(np.mean(diffs * signs))
            gen, exact = enumerate_stats, True
        else:
            def sample_stats():
                for _ in range(n_resamples):
                    signs = rng.choice([-1.0, 1.0], size=n)
                    yield float(np.mean(diffs * signs))
            gen, exact = sample_stats, False
        n_desc = "%d %s" % (n, "pairs" if variant == "paired" else "values")

    elif variant == "correlation":
        n = min(a.size, b.size)
        if n < 3:
            raise StatsError("bad_request", "correlation permutation needs ≥ 3 pairs")
        xa, yb = a[:n], b[:n]
        # Under the null X and Y are unrelated → any pairing of Y against X is equally likely.
        obs = float(np.corrcoef(xa, yb)[0, 1])
        total = 1
        for i in range(2, n + 1):
            total *= i
            if total > max_exact:
                break
        if total <= max_exact:
            from itertools import permutations as _perms
            def enumerate_stats():
                for perm in _perms(range(n)):
                    yield float(np.corrcoef(xa, yb[list(perm)])[0, 1])
            gen, exact = enumerate_stats, True
        else:
            def sample_stats():
                for _ in range(n_resamples):
                    yield float(np.corrcoef(xa, rng.permutation(yb))[0, 1])
            gen, exact = sample_stats, False
        label, title, n_desc = "Pearson r", "Permutation test — correlation", "n = %d" % n

    else:  # unpaired — permute the group labels across the pooled values
        na, nb = a.size, b.size
        if na < 2 or nb < 2:
            raise StatsError("bad_request", "unpaired permutation needs ≥ 2 values per group")
        pool = np.concatenate([a, b])

        def stat_of(ga, gb):
            if stat_kind == "median":
                return float(np.median(ga) - np.median(gb))
            if stat_kind == "t":
                va, vb = float(np.var(ga, ddof=1)), float(np.var(gb, ddof=1))
                se = (va / ga.size + vb / gb.size) ** 0.5
                return float((np.mean(ga) - np.mean(gb)) / se) if se > 0 else 0.0
            return float(np.mean(ga) - np.mean(gb))

        obs = stat_of(a, b)
        total = comb(na + nb, na)
        if total <= max_exact:
            from itertools import combinations as _combs
            idx_all = np.arange(na + nb)
            def enumerate_stats():
                for pick in _combs(range(na + nb), na):
                    m = np.zeros(na + nb, dtype=bool)
                    m[list(pick)] = True
                    yield stat_of(pool[m], pool[~m])
            gen, exact = enumerate_stats, True
        else:
            def sample_stats():
                for _ in range(n_resamples):
                    sh = rng.permutation(pool)
                    yield stat_of(sh[:na], sh[na:])
            gen, exact = sample_stats, False
        label = {"median": "Difference in medians", "t": "Welch t"}.get(stat_kind, "Difference in means")
        title, n_desc = "Permutation test — unpaired", "n = %d vs %d" % (na, nb)

    # ── count the rearrangements at least as extreme as the observed one ──────
    null_vals = []
    count = 0
    for s in gen():
        null_vals.append(s)
        if tail == "two-sided":
            if abs(s) >= abs(obs) - 1e-12:
                count += 1
        elif tail == "greater":
            if s >= obs - 1e-12:
                count += 1
        else:
            if s <= obs + 1e-12:
                count += 1
    n_perm = len(null_vals)
    if exact:
        # The observed arrangement is among those enumerated, so count ≥ 1 already.
        p = count / n_perm
        p_lo = p_hi = None
    else:
        # +1 to numerator and denominator: the observed arrangement is a legitimate draw
        # from the null, so it is counted. This is what stops p from ever being 0.
        p = (count + 1.0) / (n_perm + 1.0)
        # Wilson interval on the sampling error of p itself (Monte Carlo error only —
        # it says nothing about the statistical uncertainty of the effect).
        z = 1.959963984540054
        den = 1.0 + z * z / n_perm
        centre = (p + z * z / (2 * n_perm)) / den
        half = z * ((p * (1 - p) / n_perm + z * z / (4 * n_perm * n_perm)) ** 0.5) / den
        p_lo, p_hi = max(0.0, centre - half), min(1.0, centre + half)

    method_note = ("exact — all %d rearrangements enumerated" % n_perm if exact
                   else "Monte Carlo — %d random rearrangements (seed %d)" % (n_perm, seed))
    terms = [
        {"term": label + " (observed)", "estimate": _r(obs)},
        {"term": "p (permutation)", "p": _r(p),
         **({"ciLow": _r(p_lo), "ciHigh": _r(p_hi), "note": "95% CI = Monte Carlo error in p"} if p_lo is not None else
            {"note": "exact"})},
        {"term": "Rearrangements at least as extreme", "estimate": count},
        {"term": "Rearrangements evaluated", "estimate": n_perm},
        {"term": "Method", "estimate": "exact" if exact else "Monte Carlo"},
    ]
    if not exact:
        terms.append({"term": "Smallest p this run could report", "estimate": _r(1.0 / (n_perm + 1.0)),
                      "note": "raise the resample count to resolve smaller p-values"})
    null_arr = np.asarray(null_vals, dtype=float)
    terms.append({"term": "Null distribution mean", "estimate": _r(float(null_arr.mean()))})
    terms.append({"term": "Null distribution SD", "estimate": _r(float(null_arr.std(ddof=1))) if n_perm > 1 else None})

    assumptions = [
        "Assumes only exchangeability under the null — the rearrangement used must be one the "
        "null hypothesis says is irrelevant. No distributional shape is assumed.",
        ("Unpaired: group labels are permuted, so the null is that the two samples come from the "
         "same distribution." if variant not in ("paired", "one-sample", "correlation") else
         "Correlation: Y is re-paired against X, so the null is that the two variables are unrelated."
         if variant == "correlation" else
         "Paired / one-sample: the sign of each difference is flipped, so the null is that the "
         "differences are symmetric about zero."),
    ]
    if exact:
        assumptions.append("Exact: every rearrangement was evaluated, so this p-value is reproducible without a seed.")
    else:
        assumptions.append("Monte Carlo: the p-value is an estimate; re-running with the same seed reproduces it exactly.")

    return {
        "method": "permutation", "title": title,
        "terms": terms,
        "glance": {"statistic": _r(obs), "p": _r(p), "count": count, "n_permutations": n_perm,
                   "exact": exact, "seed": None if exact else seed,
                   **({"p_ci_low": _r(p_lo), "p_ci_high": _r(p_hi)} if p_lo is not None else {})},
        "summary": "%s (%s): %s = %.6g, p = %.4g (%s)." % (title, n_desc, label, obs, p, method_note),
        "extra": {"nullDistribution": {
            # Capped so a 100k-permutation exact run does not ship a vast payload; a
            # histogram of 5000 draws is indistinguishable at any plottable resolution.
            "values": [round(float(v), 6) for v in (null_arr if n_perm <= 5000 else rng.choice(null_arr, 5000, replace=False))],
            "observed": _r(obs), "truncated": n_perm > 5000, "total": n_perm,
        }},
        "assumptions": assumptions,
        "cite": "Permutation (randomization) test, %s; two-sided p counts |statistic| ≥ |observed|." % method_note,
    }


# Cauchy prior scales on the effect size δ, following the convention the Bayes-factor
# literature settled on. The scale is the prior's half-width: r = 0.707 says "before
# seeing data, I think |δ| is about as likely to be under 0.707 as over it".
_BF_RSCALES = {"medium": 2 ** 0.5 / 2, "wide": 1.0, "ultrawide": 2 ** 0.5}


def _jzs_bf10(np, t, nu, n_eff, r):
    """JZS Bayes factor BF10 for a t statistic (Rouder et al. 2009, eq. 1).

    The alternative places a Cauchy(0, r) prior on the effect size δ; writing that
    Cauchy as a scale mixture of normals turns the two-dimensional marginal likelihood
    into a single integral over the mixing variable g, which is what is evaluated here.
    `n_eff` is n for one-sample/paired and the harmonic-style n1·n2/(n1+n2) for two
    independent groups; `nu` is the matching degrees of freedom.
    """
    from scipy.integrate import quad
    import math
    ig_const = (r / math.sqrt(2.0)) / math.sqrt(math.pi)

    def integrand(g):
        if g <= 0:
            return 0.0
        # inverse-gamma(1/2, r²/2) density for the mixing variable
        prior = ig_const * g ** -1.5 * math.exp(-r * r / (2.0 * g))
        return ((1.0 + n_eff * g) ** -0.5
                * (1.0 + t * t / ((1.0 + n_eff * g) * nu)) ** (-(nu + 1) / 2.0)
                * prior)

    num, _err = quad(integrand, 0.0, np.inf, limit=500)
    den = (1.0 + t * t / nu) ** (-(nu + 1) / 2.0)
    if not (den > 0) or not np.isfinite(num):
        return float("nan")
    return float(num / den)


def bayesfactor(data):
    """Bayes factor for a t test (JZS / Cauchy prior on the effect size).

    A p-value can only ever reject; it cannot support a null. A Bayes factor compares
    the two hypotheses directly, so it can come out either way: BF10 = 3 means the data
    are three times more likely under "there is an effect", BF10 = 1/3 means three times
    more likely under "there is none". That symmetry is the whole reason to use it.

    The alternative hypothesis has to be made concrete before the comparison means
    anything — here as a Cauchy(0, r) prior on the standardised effect size. The answer
    depends on that choice, so this reports the Bayes factor at all three conventional
    scales rather than only the default: if they disagree, the reader needs to know the
    conclusion is prior-sensitive, and hiding that behind one number would be the easiest
    way to mislead with this test.
    """
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "unpaired")
    # A paired comparison reads the same rows from both columns, so they must be
    # cleaned together (`_aligned`); an independent-samples variant must not be, or a
    # blank in one group would drop an unrelated value from the other.
    if variant == "paired":
        _pa, _pb = _aligned(d.get("a"), d.get("b"))
        a = np.asarray(_pa, dtype=float)
        b = np.asarray(_pb, dtype=float)
    else:
        a = np.asarray(_num(d.get("a", [])), dtype=float)
        b = np.asarray(_num(d.get("b", [])), dtype=float)

    rs = d.get("rscale", "medium")
    if isinstance(rs, str):
        if rs not in _BF_RSCALES:
            raise StatsError("bad_request", "unknown prior scale: %s (use medium / wide / ultrawide, or a number)" % rs)
        r = _BF_RSCALES[rs]
        r_label = "%s (r = %.4g)" % (rs, r)
    else:
        r = float(rs)
        if not (r > 0):
            raise StatsError("bad_request", "the prior scale r must be positive")
        r_label = "custom (r = %.4g)" % r

    if variant == "one-sample":
        if a.size < 2:
            raise StatsError("bad_request", "one-sample Bayes factor needs ≥ 2 values")
        mu = float(d.get("mu", 0.0))
        t_stat, _p = stats.ttest_1samp(a, mu)
        nu, n_eff = a.size - 1, float(a.size)
        title, n_desc = "Bayes factor — one sample", "n = %d" % a.size
        eff = (float(a.mean()) - mu) / float(a.std(ddof=1)) if float(a.std(ddof=1)) > 0 else float("nan")
    elif variant == "paired":
        n = min(a.size, b.size)
        if n < 2:
            raise StatsError("bad_request", "paired Bayes factor needs ≥ 2 pairs")
        t_stat, _p = stats.ttest_rel(a[:n], b[:n])
        nu, n_eff = n - 1, float(n)
        dif = a[:n] - b[:n]
        sd = float(dif.std(ddof=1))
        eff = float(dif.mean()) / sd if sd > 0 else float("nan")
        title, n_desc = "Bayes factor — paired", "%d pairs" % n
    else:
        if a.size < 2 or b.size < 2:
            raise StatsError("bad_request", "unpaired Bayes factor needs ≥ 2 values per group")
        # The JZS two-sample factor is defined for the pooled-variance t.
        t_stat, _p = stats.ttest_ind(a, b, equal_var=True)
        na, nb = a.size, b.size
        nu, n_eff = na + nb - 2, float(na * nb) / float(na + nb)
        sp = (((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2)) ** 0.5
        eff = float((a.mean() - b.mean()) / sp) if sp > 0 else float("nan")
        title, n_desc = "Bayes factor — unpaired", "n = %d vs %d" % (na, nb)
    t_stat = float(t_stat)

    bf10 = _jzs_bf10(np, t_stat, nu, n_eff, r)
    if not np.isfinite(bf10) or bf10 <= 0:
        raise StatsError("bad_request", "the Bayes factor could not be evaluated for this data")
    bf01 = 1.0 / bf10

    # Jeffreys' descriptive labels. Deliberately worded as strength of evidence, never as
    # a decision — a Bayes factor is a continuous measure and has no 0.05-style threshold.
    def label_of(bf):
        x = bf if bf >= 1 else 1.0 / bf
        side = "for H1 (an effect)" if bf >= 1 else "for H0 (no effect)"
        if x < 1.5:  word = "barely worth mentioning"
        elif x < 3:  word = "anecdotal"
        elif x < 10: word = "moderate"
        elif x < 30: word = "strong"
        elif x < 100: word = "very strong"
        else: word = "extreme"
        return "%s evidence %s" % (word, side)

    verdict = label_of(bf10)
    # Prior sensitivity across the three conventional scales — the robustness check.
    sensitivity = [(name, _jzs_bf10(np, t_stat, nu, n_eff, rv)) for name, rv in _BF_RSCALES.items()]
    finite = [v for _n, v in sensitivity if np.isfinite(v) and v > 0]
    # "Qualitatively stable" = every scale lands on the same side of 1 and in the same
    # Jeffreys band, so the sentence a reader would write does not change with the prior.
    same_side = all((v >= 1) == (bf10 >= 1) for v in finite)
    same_band = len({label_of(v) for v in finite}) == 1
    stable = bool(same_side and same_band)

    terms = [
        {"term": "BF10 (evidence for an effect)", "estimate": _r(bf10)},
        {"term": "BF01 (evidence for no effect)", "estimate": _r(bf01)},
        {"term": "log10(BF10)", "estimate": _r(float(np.log10(bf10)))},
        {"term": "Interpretation", "estimate": verdict},
        {"term": "t", "statistic": _r(t_stat), "df": _r(nu)},
        {"term": "Standardized effect size (Cohen's d)", "estimate": _r(eff)},
        {"term": "Prior scale", "estimate": r_label},
    ]
    for name, v in sensitivity:
        terms.append({"term": "  BF10 at the %s prior (r = %.4g)" % (name, _BF_RSCALES[name]),
                      "estimate": _r(v) if np.isfinite(v) else None,
                      "note": "prior-sensitivity check"})
    terms.append({"term": "Conclusion stable across the three priors", "estimate": "yes" if stable else "no"})

    warnings = [
        "A Bayes factor is evidence, not a decision: it has no 0.05-style cutoff, and the "
        "labels (anecdotal / moderate / strong) are descriptive conventions, not thresholds.",
    ]
    if not stable:
        warnings.append(
            "The conclusion changes with the prior scale — the three conventional priors do not "
            "agree on the strength (or the direction) of the evidence. Report the prior you used "
            "and treat this result as provisional.")
    if abs(bf10 - 1.0) < 0.5 and bf10 < 3 and bf10 > 1 / 3:
        warnings.append("A Bayes factor near 1 means the data barely discriminate between the "
                        "two hypotheses — that is 'not informative', not 'no effect'.")

    return {
        "method": "bayesfactor", "title": title,
        "terms": terms,
        "glance": {"bf10": _r(bf10), "bf01": _r(bf01), "log10_bf10": _r(float(np.log10(bf10))),
                   "t": _r(t_stat), "df": _r(nu), "n_eff": _r(n_eff), "rscale": _r(r),
                   "cohens_d": _r(eff), "stable": stable},
        "summary": "%s (%s): BF10 = %.4g (BF01 = %.4g) — %s, with a %s Cauchy prior on the effect size%s." % (
            title, n_desc, bf10, bf01, verdict, r_label,
            "" if stable else "; note the conclusion is prior-sensitive"),
        "assumptions": [
            "The alternative hypothesis is a Cauchy(0, r) prior on the standardized effect size — "
            "the Bayes factor is a comparison against that alternative, not against every possible one.",
            "The same normality / independence assumptions as the corresponding t test.",
        ],
        "warnings": warnings,
        "cite": "JZS Bayes factor for a t test with a Cauchy(0, %.4g) prior on effect size; "
                "Rouder, Speckman, Sun, Morey & Iverson (2009)." % r,
    }


def _comparison_pairs(k, scheme, control, selected=None):
    """The (i, j) index pairs to compare: all-pairs, each group vs control, or a
    user-chosen subset (selected-pairs; `selected` = a list of [i, j] index pairs).
    Selected pairs are validated (in-range, i≠j) and de-duplicated by unordered
    identity, keeping the user's orientation so the mean-difference sign matches."""
    if scheme == "selected-pairs":
        out, seen = [], set()
        for pair in (selected or []):
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                continue
            i, j = int(pair[0]), int(pair[1])
            if not (0 <= i < k and 0 <= j < k) or i == j:
                continue
            key = (i, j) if i < j else (j, i)
            if key in seen:
                continue
            seen.add(key)
            out.append((i, j))
        return out
    if scheme == "vs-control":
        return [(i, control) for i in range(k) if i != control]
    return [(i, j) for i in range(k) for j in range(i + 1, k)]


def _sidak(p, m):
    return 1.0 - (1.0 - p) ** m


ZERO_VARIANCE_NOTE = (
    "The data have zero variance where this test needs it — every value being compared is "
    "identical. The test statistic is then 0/0 (or x/0), so no P value exists and it is reported "
    "as unavailable rather than as a certainty. The means/medians above are exact. If replicates "
    "were expected here, check whether summary values were entered where the individual "
    "measurements belong."
)


def _all_constant(np, groups):
    """True when every group is constant, i.e. the pooled within-group variance is zero.

    That makes F (or t) undefined. scipy answers p = 0.0, which reads as "maximally
    significant" — and the result would contradict itself, reporting p = 0 beside
    post-hoc comparisons of p = 1.0. Detected from the data rather than from
    a computed sum of squares, which can cancel to a small non-zero float.
    """
    return all(g.size > 0 and float(np.var(g)) == 0.0 for g in groups)


def _usable_p(p):
    """A p-value that can actually be adjusted, else None (blank / NaN / non-finite).

    A comparison that could not be computed must never come out of a multiplicity
    correction as a number: a NaN carried through Holm-Šídák's running maximum can come
    out as a small, "statistically significant" p for a comparison that does not exist.
    Every corrector below routes through this, so an uncomputable
    input stays `None` (rendered as a blank) all the way out.
    """
    if p is None:
        return None
    try:
        f = float(p)
    except (TypeError, ValueError):
        return None
    return f if (f == f and not math.isinf(f)) else None


def _adjust_computable(pvals, adjust):
    """Apply `adjust` to the computable p-values only, putting None back where the input
    was not computable. The multiplicity `m` passed to `adjust` still counts the
    uncomputable comparisons — dropping them would weaken the correction on the rest,
    and a failed comparison is not licence to make its neighbours look more significant.
    """
    usable = [_usable_p(p) for p in pvals]
    idx = [i for i, p in enumerate(usable) if p is not None]
    if not idx:
        return [None] * len(pvals)
    adjusted = adjust([usable[i] for i in idx], len(pvals))
    out = [None] * len(pvals)
    for slot, value in zip(idx, adjusted):
        out[slot] = value
    return out


def _holm_sidak(pvals):
    """Step-down Holm-Šídák adjusted p-values (input order preserved)."""
    def _run(vals, m):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        adj = [0.0] * len(vals)
        running = 0.0
        for rank, idx in enumerate(order):
            a = _sidak(vals[idx], m - rank)
            running = max(running, a)  # enforce monotone non-decreasing
            adj[idx] = min(1.0, running)
        return adj
    return _adjust_computable(pvals, _run)


def _pairwise_adjust(pvals, method):
    """Multiplicity-adjust a set of pairwise p-values (input order preserved):
    Holm-Šídák (step-down, default), Bonferroni, single-step Šídák, or 'none' (raw)."""
    m = len(pvals)
    if m == 0:
        return []
    # An uncomputable comparison stays None through every method — see `_usable_p`.
    if method == "bonferroni":
        return _adjust_computable(pvals, lambda vals, mm: [min(1.0, v * mm) for v in vals])
    if method == "sidak":
        return _adjust_computable(pvals, lambda vals, mm: [_sidak(v, mm) for v in vals])
    if method == "none":
        return [_usable_p(p) for p in pvals]
    return _holm_sidak(pvals)


def _bh_fdr(pvals):
    """Benjamini-Hochberg FDR-adjusted p-values (q-values), input order preserved.
    Step-up: q_(i) = min_{k≥i} ( p_(k)·m/k ), enforced monotone non-decreasing.
    An uncomputable input stays None rather than being ranked among real p-values."""
    def _run(vals, m):
        order = sorted(range(len(vals)), key=lambda i: vals[i])
        adj = [0.0] * len(vals)
        prev = 1.0
        for rank in range(len(vals) - 1, -1, -1):  # walk largest p → smallest
            idx = order[rank]
            val = min(1.0, vals[idx] * m / (rank + 1))
            prev = min(prev, val)
            adj[idx] = prev
        return adj
    return _adjust_computable(pvals, _run)


def _posthoc(np, stats, groups, labels, scheme, control, method, mse, df_within, conf=0.95, selected=None):
    """Pairwise post-hoc comparisons → tidy "A vs B" rows (estimate = mean diff,
    `ciLow`/`ciHigh` = simultaneous CI of the difference at `conf`, p = multiplicity-
    adjusted). `method` ∈ tukey/bonferroni/sidak/holm-sidak/dunnett; `scheme` ∈
    all-pairs/vs-control/selected-pairs (dunnett forces vs-control). Holm-Šídák is a
    step-down method with no simple simultaneous CI, so it reports adjusted P only.
    For `selected-pairs` the multiplicity m is the number of chosen comparisons, so
    Bonferroni/Šídák/etc. correct only for the pairs the user asked about (the
    "compare selected pairs" design)."""
    k = len(groups)
    means = [float(g.mean()) for g in groups]
    rows = []

    # Selected-pairs is a t-based / SMM family (the correction adapts to the chosen
    # count). Tukey's studentized range, Dunnett's vs-control, and Games-Howell's
    # k-group studentized range are all-pairs / vs-control designs — not selected pairs.
    if scheme == "selected-pairs":
        if method in ("tukey", "dunnett", "games-howell"):
            raise StatsError("bad_request",
                             "%s applies to all pairs or vs-control; for selected pairs use "
                             "Bonferroni, Šídák, Holm-Šídák, FDR, or Tamhane T3."
                             % _POSTHOC_LABEL.get(method, method))
        if not _comparison_pairs(k, scheme, control, selected):
            raise StatsError("bad_request", "select at least one valid pair of groups to compare.")

    if method == "dunnett":
        others = [g for i, g in enumerate(groups) if i != control]
        # Seeded. Dunnett's simultaneous confidence interval has no closed form — SciPy gets it
        # by Monte-Carlo integration over the multivariate t, so an unseeded call returns a
        # slightly different interval every time it is asked about the same data (a wobble in
        # the third decimal of each limit). That is small, but re-running an analysis would then
        # change a published number, which contradicts the promise the reproducibility bundle
        # makes, and tests of the interval would fail at random.
        # Every other random routine in this engine is seeded the same way.
        res = stats.dunnett(*others, control=groups[control], random_state=np.random.default_rng(0))
        pv = list(res.pvalue)
        ci = res.confidence_interval(confidence_level=conf)
        lo, hi = list(ci.low), list(ci.high)
        oi = 0
        for i in range(k):
            if i == control:
                continue
            rows.append({"term": "%s vs %s" % (labels[i], labels[control]),
                         "estimate": _r(means[i] - means[control]),
                         "ciLow": _r(float(lo[oi])), "ciHigh": _r(float(hi[oi])), "p": _r(float(pv[oi]))})
            oi += 1
        return rows

    if method == "tukey":
        tuk = stats.tukey_hsd(*groups)
        ci = tuk.confidence_interval(confidence_level=conf)
        for (i, j) in _comparison_pairs(k, scheme, control, selected):
            rows.append({"term": "%s vs %s" % (labels[i], labels[j]),
                         "estimate": _r(means[i] - means[j]),
                         "ciLow": _r(float(ci.low[i][j])), "ciHigh": _r(float(ci.high[i][j])),
                         "p": _r(float(tuk.pvalue[i][j]))})
        return rows

    if method == "games-howell":
        # Unequal-variance pairwise (does not pool): each pair uses its own variances +
        # a Welch-Satterthwaite df, compared on the studentized-range distribution.
        from scipy.stats import studentized_range
        variances = [float(g.var(ddof=1)) for g in groups]
        ns = [g.size for g in groups]
        for (i, j) in _comparison_pairs(k, scheme, control, selected):
            vi, vj = variances[i] / ns[i], variances[j] / ns[j]
            se = (vi + vj) ** 0.5
            diff = means[i] - means[j]
            df = ((vi + vj) ** 2 / (vi * vi / (ns[i] - 1) + vj * vj / (ns[j] - 1))
                  if (ns[i] > 1 and ns[j] > 1 and (vi + vj) > 0) else 1.0)
            q = abs(diff) / se * (2.0 ** 0.5) if se > 0 else 0.0
            p = float(studentized_range.sf(q, k, df))
            qcrit = float(studentized_range.ppf(conf, k, df))
            margin = qcrit / (2.0 ** 0.5) * se
            rows.append({"term": "%s vs %s" % (labels[i], labels[j]), "estimate": _r(diff),
                         "ciLow": _r(diff - margin), "ciHigh": _r(diff + margin), "p": _r(min(1.0, p))})
        return rows

    if method == "tamhane":
        # Tamhane's T3 / Dunnett's T3 — unequal-variance pairwise like Games-Howell
        # (own variances + Welch-Satterthwaite df), but the multiplicity comes from the
        # studentized maximum-modulus distribution, which under independence is the
        # Šídák form: P(max|t| ≤ u) = (2·F_t(u,ν) − 1)^m. So the adjusted p is
        # 1 − (1 − p_raw)^m and the critical t is the Šídák-t at each pair's df.
        variances = [float(g.var(ddof=1)) for g in groups]
        ns = [g.size for g in groups]
        pairs = _comparison_pairs(k, scheme, control, selected)
        m = len(pairs)
        alpha = 1.0 - conf
        for (i, j) in pairs:
            vi, vj = variances[i] / ns[i], variances[j] / ns[j]
            se = (vi + vj) ** 0.5
            diff = means[i] - means[j]
            df = ((vi + vj) ** 2 / (vi * vi / (ns[i] - 1) + vj * vj / (ns[j] - 1))
                  if (ns[i] > 1 and ns[j] > 1 and (vi + vj) > 0) else 1.0)
            t = abs(diff) / se if se > 0 else 0.0
            p_raw = min(1.0, 2.0 * float(stats.t.sf(t, df)))
            p_adj = 1.0 - (1.0 - p_raw) ** m  # studentized maximum modulus (Šídák)
            tcrit = float(stats.t.ppf((1.0 + (1.0 - alpha) ** (1.0 / m)) / 2.0, df)) if df > 0 else 0.0
            margin = tcrit * se
            rows.append({"term": "%s vs %s" % (labels[i], labels[j]), "estimate": _r(diff),
                         "ciLow": _r(diff - margin), "ciHigh": _r(diff + margin), "p": _r(min(1.0, p_adj))})
        return rows

    # t-based families on the pooled within-group variance (MSE from the ANOVA).
    pairs = _comparison_pairs(k, scheme, control, selected)
    raw, ses = [], []
    for (i, j) in pairs:
        se = (mse * (1.0 / groups[i].size + 1.0 / groups[j].size)) ** 0.5
        ses.append(se)
        t = (means[i] - means[j]) / se if se > 0 else 0.0
        raw.append(2.0 * float(stats.t.sf(abs(t), df_within)))
    m = len(pairs)
    alpha = 1.0 - conf
    tcrit = None  # single-step simultaneous critical t (None for step-down Holm)
    if method == "bonferroni":
        adj = [min(1.0, p * m) for p in raw]
        tcrit = float(stats.t.ppf(1.0 - (alpha / m) / 2.0, df_within)) if df_within > 0 else None
    elif method == "sidak":
        adj = [min(1.0, _sidak(p, m)) for p in raw]
        a_adj = 1.0 - (1.0 - alpha) ** (1.0 / m)
        tcrit = float(stats.t.ppf(1.0 - a_adj / 2.0, df_within)) if df_within > 0 else None
    elif method == "holm-sidak":
        adj = _holm_sidak(raw)
    elif method == "fdr":
        adj = _bh_fdr(raw)  # Benjamini-Hochberg q-values (no simple simultaneous CI)
    else:
        raise StatsError("bad_request", "unknown post-hoc: %s" % method)
    for idx, ((i, j), p) in enumerate(zip(pairs, adj)):
        row = {"term": "%s vs %s" % (labels[i], labels[j]), "estimate": _r(means[i] - means[j]), "p": _r(p)}
        if tcrit is not None:
            diff = means[i] - means[j]
            row["ciLow"] = _r(diff - tcrit * ses[idx])
            row["ciHigh"] = _r(diff + tcrit * ses[idx])
        rows.append(row)
    return rows


_POSTHOC_LABEL = {
    "tukey": "Tukey HSD", "bonferroni": "Bonferroni", "sidak": "Šídák",
    "holm-sidak": "Holm-Šídák", "dunnett": "Dunnett",
    "games-howell": "Games-Howell (unequal variance)", "fdr": "Benjamini-Hochberg FDR",
    "tamhane": "Tamhane T3 (unequal variance)",
}


def _tukey_pooled(stats, means, ns, labels, mse, df, pairs, conf):
    """Tukey-Kramer HSD using a supplied pooled error (MS_residual, df) instead of
    recomputing it from the groups — needed for two-way post-hoc, where the error
    term is the full model's residual (more power + df than a per-strip one-way).
    q = |diff| / √(MSE·½·(1/nᵢ+1/nⱼ)) on the studentized-range with k = #means."""
    from scipy.stats import studentized_range
    k = len(means)
    qcrit = float(studentized_range.ppf(conf, k, df)) if df > 0 and k >= 2 else 0.0
    rows = []
    for (i, j) in pairs:
        diff = means[i] - means[j]
        se = (mse * 0.5 * (1.0 / ns[i] + 1.0 / ns[j])) ** 0.5
        q = abs(diff) / se if se > 0 else 0.0
        p = float(studentized_range.sf(q, k, df)) if df > 0 else 1.0
        margin = qcrit * se
        rows.append({"term": "%s vs %s" % (labels[i], labels[j]), "estimate": _r(diff),
                     "ciLow": _r(diff - margin), "ciHigh": _r(diff + margin), "p": _r(min(1.0, p))})
    return rows


def anova1(data):
    """One-way ANOVA (+ post-hoc) or Kruskal-Wallis (nonparametric)."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "anova")
    sent = [np.asarray(_num(g), dtype=float) for g in d.get("groups", [])]
    sent_labels = list(d.get("labels") or ["Group %d" % (i + 1) for i in range(len(sent))])
    # Empty groups are dropped, and their labels are dropped with them. Filtering the
    # data alone would re-index every label against the wrong column: with [[], A, B, C] the
    # "Vehicle" row would report Drug A's mean, "Drug A" Drug B's, and Drug C would
    # vanish entirely — a wrong number under the user's own group name.
    # `kept` maps surviving position → position as sent, and everything else that
    # addresses a group by index (the control, the selected pairs) is remapped through it.
    kept = [i for i, g in enumerate(sent) if g.size > 0]
    groups = [sent[i] for i in kept]
    labels = [sent_labels[i] if i < len(sent_labels) else "Group %d" % (i + 1) for i in kept]
    k = len(groups)
    if k < 2:
        raise StatsError("bad_request", "need at least 2 groups")
    n = sum(g.size for g in groups)

    def _group_name(i):
        return sent_labels[i] if i < len(sent_labels) else "group %d" % (i + 1)

    if variant == "kruskal":
        h, p = stats.kruskal(*groups)
        terms = [{"term": labels[i], "estimate": _r(float(np.median(groups[i])))} for i in range(k)]
        terms.append({"term": "Kruskal-Wallis", "statistic": _r(float(h)), "df": k - 1, "p": _r(float(p))})
        return {
            "method": "anova1", "title": "Kruskal-Wallis (nonparametric)", "terms": terms,
            "glance": {"H": _r(float(h)), "df": k - 1, "p": _r(float(p)), "groups": k},
            "summary": "Kruskal-Wallis H = %.4g, p = %s — group medians %s." % (
                h, "%.4g" % p, _p_words(p)),
            "assumptions": ["Distribution-free; compares ranks across independent groups."],
            "cite": "Kruskal-Wallis one-way ANOVA on ranks.",
        }

    if variant in ("welch", "brown-forsythe"):
        if any(g.size < 2 for g in groups):
            raise StatsError("bad_request", "Welch/Brown-Forsythe ANOVA needs ≥ 2 values per group")
        means = [float(g.mean()) for g in groups]
        terms = [{"term": labels[i], "estimate": _r(means[i]), "df": groups[i].size - 1} for i in range(k)]
        if variant == "welch":
            # Welch's heteroscedastic ANOVA — weights w_i = n_i/s_i², Welch-Satterthwaite df2.
            nn = np.array([g.size for g in groups], float)
            mm = np.array(means, float)
            vv = np.array([g.var(ddof=1) for g in groups], float)
            w = nn / vv
            W = float(w.sum())
            mbar = float((w * mm).sum() / W)
            A = float((w * (mm - mbar) ** 2).sum()) / (k - 1)
            tmp = float(((1 - w / W) ** 2 / (nn - 1)).sum())
            B = 2.0 * (k - 2) / (k * k - 1) * tmp
            F = A / (1 + B)
            df1, df2 = float(k - 1), (k * k - 1) / (3 * tmp)
            p = float(stats.f.sf(F, df1, df2))
            title = "Welch's ANOVA (unequal variances)"
            note = ("Welch's correction relaxes the equal-SD assumption, but still assumes roughly normal "
                    "groups and independent observations — use Kruskal-Wallis if the data are strongly non-normal.")
            cite = "Welch (1951) heteroscedastic one-way ANOVA."
        else:
            try:
                from statsmodels.stats.oneway import anova_oneway
            except Exception:
                raise StatsError("unavailable", "Brown-Forsythe ANOVA needs statsmodels installed")
            res = anova_oneway(groups, use_var="bf")
            F, df1, df2, p = float(res.statistic), float(res.df[0]), float(res.df[1]), float(res.pvalue)
            title = "Brown-Forsythe ANOVA (compare means, unequal variances)"
            note = ("Brown-Forsythe F* compares group means when SDs differ — this is the means test, not the "
                    "Brown-Forsythe variance (Levene-type) test. Still assumes roughly normal, independent groups.")
            cite = "Brown & Forsythe (1974) heteroscedastic one-way ANOVA (means comparison)."
        terms.append({"term": "Between groups", "statistic": _r(F), "df": _r(df1), "p": _r(p)})
        return {
            "method": "anova1", "title": title, "terms": terms,
            "glance": {"F": _r(F), "df_between": _r(df1), "df_within": _r(df2), "p": _r(p), "groups": k},
            "summary": "%s: F(%.3g, %.3g) = %.4g, p = %s — group means %s." % (
                title, df1, df2, F, "%.4g" % p, _p_words(p)),
            "assumptions": ["Assumes approximately normal residuals. " + note],
            "cite": cite,
        }

    f, p = stats.f_oneway(*groups)
    grand = float(np.concatenate(groups).mean())
    ss_between = sum(g.size * (float(g.mean()) - grand) ** 2 for g in groups)
    ss_total = float(((np.concatenate(groups) - grand) ** 2).sum())
    ss_within = ss_total - ss_between
    eta2 = ss_between / ss_total if ss_total else None
    df1, df2 = k - 1, n - k
    mse = ss_within / df2 if df2 > 0 else 0.0
    # Zero within-group variance → F is undefined, so there is no P value. scipy hands
    # back p = 0.0, which would assert "the group means differ significantly" while every
    # post-hoc comparison beside it reports p = 1.0. Return early
    # with the means (which are exact) and nothing claimed about significance; the
    # post-hocs are skipped for the same reason, since they all divide by that variance.
    if _all_constant(np, groups):
        terms = [{"term": labels[i], "estimate": _r(float(groups[i].mean())), "df": groups[i].size - 1} for i in range(k)]
        terms.append({"term": "Between groups", "statistic": None, "df": df1, "p": None})
        return {
            "method": "anova1", "title": "One-way ANOVA", "terms": terms,
            "glance": {"F": None, "df_between": df1, "df_within": df2, "p": None, "eta_sq": _r(eta2)},
            "summary": "The within-group variance is zero (every value in each group is identical), "
                       "so F and its P value are undefined. The group means are reported as entered.",
            "assumptions": [ZERO_VARIANCE_NOTE],
            "cite": "One-way ANOVA — not computable: zero within-group variance.",
        }
    terms = [{"term": labels[i], "estimate": _r(float(groups[i].mean())), "df": groups[i].size - 1} for i in range(k)]
    terms.append({"term": "Between groups", "statistic": _r(float(f)), "df": df1, "p": _r(float(p))})
    # Post-hoc pairwise comparisons (Tukey default; Bonferroni/Šídák/Holm-Šídák/
    # Dunnett selectable). Dunnett is inherently vs-a-control.
    method = d.get("posthoc", "tukey")
    scheme = "vs-control" if method == "dunnett" else d.get("scheme", "all-pairs")
    conf = float(d.get("conf", 0.95))
    # `control` and `pairs` are indices into the groups as sent, so they are remapped
    # through `kept`. An unusable control is refused, never clamped to group 0:
    # that would answer a different question than the user asked and label the answer as
    # theirs — silently comparing against Drug A while the row still reads "vs Vehicle".
    # Validated only when the scheme actually uses it, so a stale index on an all-pairs
    # run stays harmless.
    control = 0
    if scheme == "vs-control":
        sent_control = int(d.get("control", 0))
        if sent_control in kept:
            control = kept.index(sent_control)
        elif 0 <= sent_control < len(sent):
            raise StatsError("bad_request",
                             "the control group (%s) has no data — pick a control that has values, "
                             "or remove the empty group" % _group_name(sent_control))
        else:
            raise StatsError("bad_request",
                             "control group %d is out of range (%d group(s) supplied)"
                             % (sent_control + 1, len(sent)))
    # Selected pairs address the groups as sent too; a pair naming an empty group cannot
    # be computed, so it is dropped here rather than silently sliding onto its neighbour.
    selected_pairs = d.get("pairs")
    if selected_pairs is not None:
        remapped = []
        for pair in selected_pairs:
            if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                continue
            i, j = int(pair[0]), int(pair[1])
            if i in kept and j in kept:
                remapped.append([kept.index(i), kept.index(j)])
        selected_pairs = remapped
    posthoc_note = "%s correction" % _POSTHOC_LABEL.get(method, method)
    try:
        terms.extend(_posthoc(np, stats, groups, labels, scheme, control, method, mse, df2, conf, selected_pairs))
    except StatsError:
        raise
    except Exception:  # pragma: no cover - older scipy (e.g. no stats.dunnett)
        try:
            tuk = stats.tukey_hsd(*groups)
            for i in range(k):
                for j in range(i + 1, k):
                    terms.append({"term": "%s vs %s" % (labels[i], labels[j]),
                                  "estimate": _r(float(groups[i].mean() - groups[j].mean())),
                                  "p": _r(float(tuk.pvalue[i][j]))})
            posthoc_note = "Tukey HSD correction (post-hoc fallback)"
        except Exception:  # pragma: no cover
            pass
    # Residual diagnostics — the two ANOVA assumptions, as runnable tests so the user
    # can see when to switch to Welch (unequal variances) or Kruskal-Wallis (non-normal):
    # normality of the pooled within-group residuals + homoscedasticity (Bartlett, plus
    # the median-centred Levene = Brown-Forsythe robust test).
    resid = np.concatenate([g - g.mean() for g in groups])
    if resid.size >= 3:
        sw, swp = stats.shapiro(resid)
        terms.append({"term": "Residual normality (Shapiro-Wilk)", "statistic": _r(float(sw)), "p": _r(float(swp))})
    if all(g.size >= 2 for g in groups):
        bt, bp = stats.bartlett(*groups)
        lv, lp = stats.levene(*groups, center="median")
        terms.append({"term": "Equal variances (Bartlett)", "statistic": _r(float(bt)), "p": _r(float(bp))})
        terms.append({"term": "Equal variances (Brown-Forsythe)", "statistic": _r(float(lv)), "p": _r(float(lp))})
    # Residual arrays for the diagnostic graphs: each observation's fitted value is
    # its group mean, so residual = value − group mean (already pooled in `resid`).
    fitted_arr = np.concatenate([np.full(g.size, float(g.mean())) for g in groups])
    residuals_extra = {"fitted": [_r(float(v)) for v in fitted_arr],
                       "resid": [_r(float(v)) for v in resid]}
    scheme_txt = ("each group vs %s" % labels[control] if scheme == "vs-control"
                  else "selected pairs" if scheme == "selected-pairs" else "all pairs")
    assumptions = ["Assumes independent observations, normal residuals + equal variances; %s for multiple comparisons." % posthoc_note]
    if method == "holm-sidak":
        assumptions.append("Holm-Šídák is a step-down method with no simultaneous confidence interval, so each "
                           "comparison reports a multiplicity-adjusted P only (no CI of the difference).")
    return {
        "method": "anova1", "title": "One-way ANOVA", "terms": terms,
        "extra": {"residuals": residuals_extra},
        "glance": {"F": _r(float(f)), "df_between": df1, "df_within": df2, "p": _r(float(p)), "eta_sq": _r(eta2)},
        "summary": "F(%d, %d) = %.4g, p = %s — the group means differ %s (η² = %s); post-hoc: %s, %s." % (
            df1, df2, f, "%.4g" % p, "significantly" if p < 0.05 else "non-significantly",
            ("%.3g" % eta2) if eta2 is not None else "—", _POSTHOC_LABEL.get(method, method), scheme_txt),
        "assumptions": assumptions,
        "cite": "One-way ANOVA with %s post-hoc; η² effect size." % _POSTHOC_LABEL.get(method, method),
    }


def corrmatrix(data):
    """Correlation matrix across many variables:
    the full K×K Pearson or Spearman r matrix + p-values, using pairwise-complete
    observations. Emits the matrix (for an R² heatmap) plus tidy upper-triangle
    rows (each pair's r, R², p)."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "pearson")
    cols = d.get("columns", [])
    k = len(cols)
    if k < 2:
        raise StatsError("bad_request", "correlation matrix needs ≥ 2 variables")
    labels = d.get("labels") or ["Var %d" % (i + 1) for i in range(k)]
    arrs = [np.asarray([np.nan if (v is None or v == "") else _flt(v) for v in c], dtype=float) for c in cols]

    rmat = [[None] * k for _ in range(k)]
    r2mat = [[None] * k for _ in range(k)]
    terms = []
    min_n = None
    for i in range(k):
        rmat[i][i] = 1.0
        r2mat[i][i] = 1.0
        for j in range(i + 1, k):
            a, b = arrs[i], arrs[j]
            mask = ~np.isnan(a) & ~np.isnan(b)
            ai, bj = a[mask], b[mask]
            npair = int(ai.size)
            if npair < 3 or float(np.std(ai)) == 0 or float(np.std(bj)) == 0:
                r = p = None
            else:
                res = stats.spearmanr(ai, bj) if variant == "spearman" else stats.pearsonr(ai, bj)
                r, p = float(res.statistic), float(res.pvalue)
            rmat[i][j] = rmat[j][i] = _r(r)
            r2 = (r * r) if r is not None else None
            r2mat[i][j] = r2mat[j][i] = _r(r2)
            terms.append({"term": "%s vs %s" % (labels[i], labels[j]), "estimate": _r(r),
                          "p": _r(p), "df": (npair - 2) if npair >= 2 else None, "r2": _r(r2), "n": npair})
            min_n = npair if min_n is None else min(min_n, npair)
    coef = "Spearman ρ" if variant == "spearman" else "Pearson r"
    # strongest off-diagonal pair, for the summary line
    best = max((t for t in terms if t["estimate"] is not None), key=lambda t: abs(t["estimate"]), default=None)
    return {
        "method": "corrmatrix", "title": "Correlation matrix (%s)" % coef, "terms": terms,
        "glance": {"variables": k, "pairs": len(terms), "n_min": min_n},
        "extra": {"matrix": {"labels": labels, "r": rmat, "r2": r2mat}},
        "summary": "%d variables, %d pairwise %s correlations%s." % (
            k, len(terms), coef,
            ("; strongest: %s (%s = %.3g)" % (best["term"], "ρ" if variant == "spearman" else "r", best["estimate"])) if best else ""),
        "assumptions": ["Pairwise-complete observations; %s." % (
            "rank-based, monotonic" if variant == "spearman" else "linear + roughly normal")],
        "cite": "%s correlation matrix, two-tailed, pairwise-complete." % coef,
    }


def _design_matrix(np, y_raw, predictors, plabels):
    """Build a complete-case (listwise) design matrix from a raw outcome column and
    a list of raw predictor columns (row-aligned, may contain blanks/non-numeric).
    Returns (y, X_no_const, labels, n_total, n_used) with X columns in `plabels`
    order. Raises a typed error if too few complete rows remain."""
    k = len(predictors)
    n_total = len(y_raw)
    yc = np.asarray([np.nan if (v is None or v == "") else _flt(v) for v in y_raw], dtype=float)
    pcols = [np.asarray([np.nan if (v is None or v == "") else _flt(v) for v in c], dtype=float)
             for c in predictors]
    # Align lengths (pad short columns with NaN).
    rows = max([n_total] + [c.size for c in pcols]) if (pcols or n_total) else 0
    def _pad(a):
        if a.size == rows:
            return a
        out = np.full(rows, np.nan)
        out[:a.size] = a
        return out
    yc = _pad(yc)
    pcols = [_pad(c) for c in pcols]
    X = np.column_stack(pcols) if pcols else np.empty((rows, 0))
    mask = ~np.isnan(yc)
    for j in range(k):
        mask &= ~np.isnan(X[:, j])
    yu, Xu = yc[mask], X[mask, :]
    n_used = int(yu.size)
    return yu, Xu, list(plabels), rows, n_used


def multipleregression(data):
    """Multiple linear regression (OLS) — outcome Y modelled on ≥ 1 predictors via
    statsmodels. Reports each coefficient (estimate, SE, t, two-tailed p, CI), the
    standardized β and the variance-inflation factor per predictor, plus model fit
    (R², adjusted R², the overall F-test, and Sy.x). Complete-case (listwise)."""
    np, stats = _np_sp()
    try:
        import statsmodels.api as sm
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise StatsError("numerical", "statsmodels unavailable: %s" % exc)
    d = data or {}
    predictors = d.get("predictors", [])
    k = len(predictors)
    if k < 1:
        raise StatsError("bad_request", "multiple regression needs ≥ 1 predictor")
    plabels = d.get("labels") or ["X%d" % (i + 1) for i in range(k)]
    ylabel = d.get("outcomeLabel", "Y")
    conf = float(d.get("conf", 0.95))
    alpha = 1.0 - conf
    y, X, plabels, n_total, n = _design_matrix(np, d.get("y", []), predictors, plabels)
    if n < k + 2:
        raise StatsError("bad_request",
                         "need ≥ %d complete rows for %d predictors (have %d)" % (k + 2, k, n))
    # Guard: a constant predictor (or one collinear column) makes the fit singular.
    for j in range(k):
        if float(np.std(X[:, j])) == 0:
            raise StatsError("bad_request", "predictor \"%s\" is constant" % plabels[j])

    Xc = sm.add_constant(X, has_constant="add")
    model = sm.OLS(y, Xc).fit()
    ci = model.conf_int(alpha=alpha)
    names = ["Intercept"] + plabels
    # Standardized β (per-SD), computed from a z-scored fit; intercept → 0.
    sy = float(np.std(y, ddof=1))
    sx = [float(np.std(X[:, j], ddof=1)) for j in range(k)]
    # Variance-inflation factors (intercept-adjusted): VIF_j = 1/(1−R²_j).
    vif = [None] * k
    if k >= 2:
        from statsmodels.stats.outliers_influence import variance_inflation_factor
        for j in range(k):
            try:
                vif[j] = _r(float(variance_inflation_factor(Xc, j + 1)))
            except Exception:  # pragma: no cover
                vif[j] = None

    terms = []
    for i, name in enumerate(names):
        coef = float(model.params[i])
        row = {"term": name, "estimate": _r(coef), "se": _r(float(model.bse[i])),
               "statistic": _r(float(model.tvalues[i])), "p": _r(float(model.pvalues[i])),
               "df": int(model.df_resid), "ciLow": _r(float(ci[i][0])), "ciHigh": _r(float(ci[i][1]))}
        if i >= 1:
            j = i - 1
            row["beta"] = _r(coef * sx[j] / sy) if sy > 0 else None
            row["vif"] = vif[j]
        terms.append(row)

    r2, adj = float(model.rsquared), float(model.rsquared_adj)
    fstat, fp = float(model.fvalue), float(model.f_pvalue)
    syx = float(np.sqrt(model.mse_resid)) if model.df_resid > 0 else None
    terms.append({"term": "R²", "estimate": _r(r2)})
    terms.append({"term": "Adjusted R²", "estimate": _r(adj)})
    terms.append({"term": "F (%d, %d)" % (int(model.df_model), int(model.df_resid)),
                  "estimate": _r(fstat), "p": _r(fp), "df": int(model.df_model)})
    if syx is not None:
        terms.append({"term": "Sy.x (RMSE)", "estimate": _r(syx)})

    fitted = np.asarray(model.fittedvalues, dtype=float)
    resid = np.asarray(model.resid, dtype=float)
    residuals = {"fitted": [_r(float(v)) for v in fitted], "resid": [_r(float(v)) for v in resid]}
    omitted = n_total - n
    return {
        "method": "multipleregression",
        "title": "Multiple linear regression",
        "terms": terms,
        "extra": {"residuals": residuals},
        "glance": {"r_sq": _r(r2), "adj_r_sq": _r(adj), "f": _r(fstat), "p": _r(fp),
                   "n": n, "k": k},
        "summary": "%s ~ %d predictors; R² = %.4g (adjusted %.4g), F(%d, %d) = %.4g, p = %s (%s)%s." % (
            ylabel, k, r2, adj, int(model.df_model), int(model.df_resid), fstat, "%.4g" % fp,
            _p_words(fp), ("; %d row(s) dropped (incomplete)" % omitted) if omitted else ""),
        "assumptions": [
            "OLS: linear in the predictors, independent observations, homoscedastic + normal residuals.",
            "Multicollinearity inflates SEs — a VIF above ~5–10 flags a redundant predictor.",
            "Complete-case: rows with any missing outcome/predictor are dropped." if omitted else
            "Complete-case analysis (no missing values present).",
        ],
        "cite": "Ordinary least-squares multiple regression (statsmodels OLS); %.3g%% CIs; "
                "two-tailed Wald tests; VIF for collinearity." % (conf * 100),
    }


def _logit_separated(np, Xc, y):
    """Is a binary outcome (quasi-)completely separated by the design? Then no finite maximum-likelihood logistic fit
    exists. Decided by linear programming, independent of any fit (Konis 2007): look for coefficients b, each in
    [-1, 1], with s_i * (x_i . b) >= 0 for every row (s = +1 for an event, -1 otherwise) and the sum of those margins
    above zero. Only b = 0 satisfies the constraints when the data are not separated, so a positive optimum is a
    separating (or touching) hyperplane. Columns are scaled to unit max so the tolerance means the same on any units."""
    from scipy.optimize import linprog
    Xs = np.asarray(Xc, dtype=float)
    scale = np.max(np.abs(Xs), axis=0)
    scale[scale == 0] = 1.0
    Z = (Xs / scale) * np.where(np.asarray(y) > 0.5, 1.0, -1.0)[:, None]
    res = linprog(-Z.sum(axis=0), A_ub=-Z, b_ub=np.zeros(Z.shape[0]), bounds=[(-1.0, 1.0)] * Z.shape[1], method="highs")
    return bool(res.status == 0 and -res.fun > 1e-7 * Z.shape[0])


def logistic(data):
    """Binary logistic regression (simple/multiple) via
    statsmodels Logit. Reports each coefficient (log-odds) with its SE, Wald z, p,
    and CI, plus the **odds ratio** exp(β) with its CI; four pseudo-R² (McFadden,
    Cox-Snell, Nagelkerke, Tjur), overall model significance (likelihood-ratio χ²),
    and the classification accuracy at p = 0.5. Complete-case (listwise)."""
    np, stats = _np_sp()
    try:
        import statsmodels.api as sm
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise StatsError("numerical", "statsmodels unavailable: %s" % exc)
    d = data or {}
    predictors = d.get("predictors", [])
    k = len(predictors)
    if k < 1:
        raise StatsError("bad_request", "logistic regression needs ≥ 1 predictor")
    plabels = d.get("labels") or ["X%d" % (i + 1) for i in range(k)]
    ylabel = d.get("outcomeLabel", "Y")
    conf = float(d.get("conf", 0.95))
    alpha = 1.0 - conf
    yraw, X, plabels, n_total, n = _design_matrix(np, d.get("y", []), predictors, plabels)
    if n < k + 2:
        raise StatsError("bad_request",
                         "need ≥ %d complete rows for %d predictors (have %d)" % (k + 2, k, n))
    # Outcome must be binary. Accept {0,1}; otherwise map the two distinct levels
    # (lower → 0 = reference, higher → 1 = event) and report the coding.
    levels = sorted(set(float(v) for v in yraw))
    if len(levels) != 2:
        raise StatsError("bad_request",
                         "logistic regression needs a binary outcome (found %d distinct values)" % len(levels))
    lo, hi = levels
    y = np.where(yraw == hi, 1.0, 0.0)
    coding = None if levels == [0.0, 1.0] else "%g → 1 (event), %g → 0 (reference)" % (hi, lo)
    for j in range(k):
        if float(np.std(X[:, j])) == 0:
            raise StatsError("bad_request", "predictor \"%s\" is constant" % plabels[j])

    Xc = sm.add_constant(X, has_constant="add")
    # Asked of the data before any fit: the checks after the fit rely on statsmodels flagging it or on
    # the optimiser running all the way out, and neither is guaranteed - two predictors separating the outcome can
    # come back with only a ConvergenceWarning and fitted probabilities that stop short of the 1e-8 test below.
    if _logit_separated(np, Xc, y):
        raise StatsError(
            "numerical",
            "the outcome is perfectly separated by the predictor(s) (a line puts every event on one side), so the "
            "maximum-likelihood fit does not exist — the coefficients diverge and their P values are meaningless. Use "
            "a penalised method (Firth logistic or exact logistic regression), or combine sparse categories.")
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            model = sm.Logit(y, Xc).fit(disp=0, maxiter=100)
        warned_separation = any("PerfectSeparation" in type(w.message).__name__ for w in caught)
    except Exception as exc:  # perfect separation / non-convergence
        raise StatsError("numerical",
                         "logistic fit failed (likely perfect separation or non-convergence): %s" % exc)
    # statsmodels only warns on (quasi-)complete separation, so the fit "succeeds" and,
    # unchecked, would be reported as valid: a huge coefficient with p ≈ 1, McFadden R² = 1 and
    # 100% accuracy — while the assumptions list would claim "no perfect separation" without
    # checking it. The MLE does not exist here: those coefficients are
    # merely where the optimiser stopped, and the p ≈ 1 (the Hauck-Donner effect) invites
    # precisely the wrong reading — "this predictor doesn't matter" — from data it predicts
    # perfectly. Refused, the way a constant predictor already is a few lines above.
    # The probability test is the version-independent backstop: under separation every
    # fitted probability collapses onto 0 or 1 to machine precision.
    fitted = np.asarray(model.predict(Xc), dtype=float)
    if warned_separation or bool(np.all(np.minimum(fitted, 1.0 - fitted) < 1e-8)):
        raise StatsError(
            "numerical",
            "the outcome is perfectly separated by the predictor(s), so the maximum-likelihood fit "
            "does not exist — the coefficients diverge and their P values are meaningless. Use a "
            "penalised method (Firth logistic or exact logistic regression), or combine sparse "
            "categories.")
    ci = np.asarray(model.conf_int(alpha=alpha), dtype=float)
    names = ["Intercept"] + plabels
    terms = []
    for i, name in enumerate(names):
        beta = float(model.params[i])
        clo, chi = float(ci[i][0]), float(ci[i][1])
        row = {"term": name, "estimate": _r(beta), "se": _r(float(model.bse[i])),
               "statistic": _r(float(model.tvalues[i])), "p": _r(float(model.pvalues[i])),
               "ciLow": _r(clo), "ciHigh": _r(chi)}
        if i >= 1:  # odds ratio (exp of the log-odds coefficient) + its CI
            row["oddsRatio"] = _r(float(np.exp(beta)))
            row["orLow"] = _r(float(np.exp(clo)))
            row["orHigh"] = _r(float(np.exp(chi)))
        terms.append(row)

    # Pseudo-R² family + Tjur's coefficient of discrimination.
    llf, lln = float(model.llf), float(model.llnull)
    mcfadden = float(model.prsquared)
    cox = 1.0 - np.exp((2.0 / n) * (lln - llf))
    nagel = cox / (1.0 - np.exp((2.0 / n) * lln)) if (1.0 - np.exp((2.0 / n) * lln)) != 0 else None
    p_hat = np.asarray(model.predict(Xc), dtype=float)
    tjur = float(np.mean(p_hat[y == 1]) - np.mean(p_hat[y == 0]))
    lr_chi2, lr_p, lr_df = float(model.llr), float(model.llr_pvalue), int(model.df_model)
    pred = (p_hat >= 0.5).astype(float)
    acc = float(np.mean(pred == y))
    terms.append({"term": "McFadden R²", "estimate": _r(mcfadden)})
    terms.append({"term": "Nagelkerke R²", "estimate": _r(nagel)})
    terms.append({"term": "Tjur R²", "estimate": _r(tjur)})
    terms.append({"term": "LR χ² (model)", "estimate": _r(lr_chi2), "p": _r(lr_p), "df": lr_df})
    terms.append({"term": "Accuracy (p≥0.5)", "estimate": _r(acc)})

    omitted = n_total - n
    assum = [
        # "No perfect separation" is stated as checked because it is — the fit above
        # refuses a separated design rather than listing this as an unverified caveat.
        "Logit: log-odds linear in the predictors; independent observations. Perfect separation is "
        "checked for and refused (the fit would not exist).",
        "Odds ratio exp(β) is the multiplicative change in odds per unit predictor (holding others fixed).",
    ]
    if coding:
        assum.append("Outcome coded: %s." % coding)
    if omitted:
        assum.append("Complete-case: %d row(s) with a missing value were dropped." % omitted)
    return {
        "method": "logistic",
        "title": "Logistic regression",
        "terms": terms,
        "glance": {"mcfadden_r_sq": _r(mcfadden), "nagelkerke_r_sq": _r(nagel), "tjur_r_sq": _r(tjur),
                   "accuracy": _r(acc), "lr_chi2": _r(lr_chi2), "p": _r(lr_p), "n": n, "k": k},
        "summary": "%s ~ %d predictor(s); LR χ²(%d) = %.4g, p = %s (%s); McFadden R² = %.4g, "
                   "accuracy = %.1f%%%s." % (
            ylabel, k, lr_df, lr_chi2, "%.4g" % lr_p, _p_words(lr_p), mcfadden, acc * 100,
            ("; %d row(s) dropped" % omitted) if omitted else ""),
        "assumptions": assum,
        "cite": "Binary logistic regression (statsmodels Logit, MLE); %.3g%% Wald CIs; "
                "odds ratios exp(β); McFadden/Nagelkerke/Tjur pseudo-R²." % (conf * 100),
    }


def poisson(data):
    """Poisson regression (log-link GLM) for count outcomes via statsmodels. Reports each
    coefficient (log-rate) with SE/Wald z/p/CI and the rate ratio exp(β) + CI; McFadden
    pseudo-R², a likelihood-ratio χ² vs the intercept-only model, the deviance, and a
    dispersion check (Pearson χ²/df ≫ 1 ⇒ overdispersion). Complete-case (listwise)."""
    np, stats = _np_sp()
    try:
        import statsmodels.api as sm
    except Exception as exc:  # pragma: no cover - environment-dependent
        raise StatsError("numerical", "statsmodels unavailable: %s" % exc)
    d = data or {}
    predictors = d.get("predictors", [])
    k = len(predictors)
    if k < 1:
        raise StatsError("bad_request", "Poisson regression needs ≥ 1 predictor")
    plabels = d.get("labels") or ["X%d" % (i + 1) for i in range(k)]
    ylabel = d.get("outcomeLabel", "Y")
    conf = float(d.get("conf", 0.95))
    alpha = 1.0 - conf
    y, X, plabels, n_total, n = _design_matrix(np, d.get("y", []), predictors, plabels)
    if n < k + 2:
        raise StatsError("bad_request",
                         "need ≥ %d complete rows for %d predictors (have %d)" % (k + 2, k, n))
    if np.any(y < 0) or np.any(y != np.floor(y)):
        raise StatsError("bad_request", "Poisson regression needs non-negative integer counts as the outcome")
    for j in range(k):
        if float(np.std(X[:, j])) == 0:
            raise StatsError("bad_request", "predictor \"%s\" is constant" % plabels[j])

    Xc = sm.add_constant(X, has_constant="add")
    try:
        model = sm.GLM(y, Xc, family=sm.families.Poisson()).fit()
        null = sm.GLM(y, np.ones((n, 1)), family=sm.families.Poisson()).fit()
    except Exception as exc:  # pragma: no cover
        raise StatsError("numerical", "Poisson fit failed: %s" % exc)
    ci = np.asarray(model.conf_int(alpha=alpha), dtype=float)
    names = ["Intercept"] + plabels
    terms = []
    for i, name in enumerate(names):
        beta = float(model.params[i])
        clo, chi = float(ci[i][0]), float(ci[i][1])
        row = {"term": name, "estimate": _r(beta), "se": _r(float(model.bse[i])),
               "statistic": _r(float(model.tvalues[i])), "p": _r(float(model.pvalues[i])),
               "ciLow": _r(clo), "ciHigh": _r(chi)}
        if i >= 1:  # rate ratio exp(β) + its CI
            row["rateRatio"] = _r(float(np.exp(beta)))
            row["rrLow"] = _r(float(np.exp(clo)))
            row["rrHigh"] = _r(float(np.exp(chi)))
        terms.append(row)

    dev = float(model.deviance)
    pear = float(model.pearson_chi2)
    dfr = int(model.df_resid)
    disp = pear / dfr if dfr > 0 else None
    llf, lln = float(model.llf), float(null.llf)
    mcf = 1.0 - llf / lln if lln != 0 else None
    lr = 2.0 * (llf - lln)
    lr_df = k
    lr_p = float(stats.chi2.sf(lr, lr_df))
    terms.append({"term": "McFadden R²", "estimate": _r(mcf)})
    terms.append({"term": "LR χ² (model)", "estimate": _r(lr), "p": _r(lr_p), "df": lr_df})
    terms.append({"term": "Deviance", "estimate": _r(dev), "df": dfr})
    terms.append({"term": "Dispersion (Pearson χ²/df)", "estimate": _r(disp)})

    fitted = np.asarray(model.fittedvalues, dtype=float)
    resid = np.asarray(model.resid_response, dtype=float)
    residuals = {"fitted": [_r(float(v)) for v in fitted], "resid": [_r(float(v)) for v in resid]}
    omitted = n_total - n
    assum = [
        "Poisson GLM (log link): count outcome, independent observations, mean = variance.",
        "Rate ratio exp(β) = multiplicative change in the expected count per unit predictor.",
        "Dispersion ≫ 1 ⇒ overdispersion (SEs understated — consider negative-binomial).",
    ]
    if omitted:
        assum.append("Complete-case: %d row(s) with a missing value were dropped." % omitted)
    return {
        "method": "poisson", "title": "Poisson regression", "terms": terms,
        "extra": {"residuals": residuals},
        "glance": {"mcfadden_r_sq": _r(mcf), "lr_chi2": _r(lr), "p": _r(lr_p), "deviance": _r(dev),
                   "dispersion": _r(disp), "n": n, "k": k},
        "summary": "%s ~ %d predictor(s); LR χ²(%d) = %.4g, p = %s (%s); dispersion = %.3g." % (
            ylabel, k, lr_df, lr, "%.4g" % lr_p, _p_words(lr_p), disp if disp is not None else float("nan")),
        "assumptions": assum,
        "cite": "Poisson regression (statsmodels GLM, log link); %.3g%% Wald CIs; rate ratios exp(β)." % (conf * 100),
    }


def deming(data):
    """Deming (errors-in-variables) regression for method comparison — both X and Y are
    measured with error, in the ratio λ = σ²_error(Y)/σ²_error(X) (default 1 = orthogonal).
    Closed-form slope/intercept with jackknife (leave-one-out) SEs + CIs (Linnet's method).
    Slope CI containing 1 and intercept CI containing 0 ⇒ the two methods agree."""
    np, stats = _np_sp()
    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    x, y = x[:n], y[:n]
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    n = int(x.size)
    if n < 3:
        raise StatsError("bad_request", "Deming regression needs ≥ 3 paired points")
    # Default λ = 1 when absent/blank, but an explicit non-positive λ must reach the guard
    # below — `x or 1.0` would silently coerce a user-supplied 0 to 1.0 (0 is falsy).
    lam_raw = d.get("lambda")
    lam = 1.0 if lam_raw in (None, "") else float(lam_raw)
    if lam <= 0:
        raise StatsError("bad_request", "the error-variance ratio λ must be > 0")
    conf = float(d.get("conf", 0.95))

    def fit(xx, yy):
        mx, my = float(np.mean(xx)), float(np.mean(yy))
        sxx = float(np.sum((xx - mx) ** 2))
        syy = float(np.sum((yy - my) ** 2))
        sxy = float(np.sum((xx - mx) * (yy - my)))
        if sxy == 0:
            return None
        b1 = ((syy - lam * sxx) + np.sqrt((syy - lam * sxx) ** 2 + 4 * lam * sxy ** 2)) / (2 * sxy)
        return float(my - b1 * mx), float(b1)

    f = fit(x, y)
    if f is None:
        raise StatsError("numerical", "Deming fit undefined (no X–Y covariance)")
    b0, b1 = f
    # Jackknife (leave-one-out) SEs (Linnet).
    idx = np.arange(n)
    b0s, b1s = [], []
    for i in idx:
        fi = fit(x[idx != i], y[idx != i])
        if fi is not None:
            b0s.append(fi[0])
            b1s.append(fi[1])
    b0s, b1s = np.asarray(b0s), np.asarray(b1s)
    m2 = b1s.size

    def jack_se(vals):
        dot = float(np.mean(vals))
        return float(np.sqrt((m2 - 1) / m2 * np.sum((vals - dot) ** 2)))

    se1, se0 = jack_se(b1s), jack_se(b0s)
    tc = float(stats.t.ppf((1 + conf) / 2, n - 2))
    s_lo, s_hi = b1 - tc * se1, b1 + tc * se1
    i_lo, i_hi = b0 - tc * se0, b0 + tc * se0
    r = float(np.corrcoef(x, y)[0, 1])
    terms = [
        {"term": "Slope", "estimate": _r(b1), "se": _r(se1), "ciLow": _r(s_lo), "ciHigh": _r(s_hi)},
        {"term": "Intercept", "estimate": _r(b0), "se": _r(se0), "ciLow": _r(i_lo), "ciHigh": _r(i_hi)},
        {"term": "Pearson r", "estimate": _r(r)},
    ]
    agree = (s_lo <= 1 <= s_hi) and (i_lo <= 0 <= i_hi)
    xs = np.linspace(float(x.min()), float(x.max()), 80)
    return {
        "method": "deming", "title": "Deming regression", "terms": terms,
        "glance": {"slope": _r(b1), "intercept": _r(b0), "lambda": _r(lam), "r": _r(r), "n": n},
        "curve": {"x": [round(float(v), 6) for v in xs], "y": [round(float(b0 + b1 * v), 6) for v in xs]},
        "summary": "Deming (λ = %.3g): %s (slope %g%% CI %.4g–%.4g, intercept %.4g–%.4g) — the methods %s." % (
            lam, _line(b1, b0), conf * 100, s_lo, s_hi, i_lo, i_hi, "agree (slope∋1, intercept∋0)" if agree else "differ"),
        "assumptions": [
            "Both methods measured with error; λ = ratio of Y-error to X-error variance (1 = equal, i.e. orthogonal).",
            "Errors independent + Gaussian; jackknife SEs (Linnet). Proportional error ⇒ needs weighted Deming, which this fit does not do.",
        ],
        "cite": "Deming errors-in-variables regression; jackknife SEs + %.3g%% CIs (Linnet)." % (conf * 100),
    }


def blandaltman(data):
    """Bland-Altman method-comparison analysis. For paired measurements from two methods
    A (x) and B (y), summarise the difference A−B (or the % difference, 100·(A−B)/mean)
    by the **bias** (mean difference) and the **95% limits of agreement** (bias ± k·SD of
    the differences), each with a confidence interval. Pairwise-complete."""
    np, stats = _np_sp()
    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    x, y = x[:n], y[:n]
    m = np.isfinite(x) & np.isfinite(y)
    x, y = x[m], y[m]
    n = int(x.size)
    if n < 2:
        raise StatsError("bad_request", "Bland-Altman needs ≥ 2 paired measurements")
    percent = bool(d.get("percent"))
    k = float(d.get("agreementK") or 1.96)
    conf = float(d.get("conf", 0.95))
    means = (x + y) / 2.0
    if percent:
        if np.any(means == 0):
            raise StatsError("bad_request", "percent differences need a non-zero mean for every pair")
        diffs = 100.0 * (x - y) / means
    else:
        diffs = x - y
    bias = float(np.mean(diffs))
    sd = float(np.std(diffs, ddof=1))
    loa_u, loa_l = bias + k * sd, bias - k * sd
    tcrit = float(stats.t.ppf(1 - (1 - conf) / 2, n - 1))
    se_bias = sd / float(np.sqrt(n))
    # Bland & Altman's SE of a limit of agreement: √(1/n + k²/(2(n−1)))·SD.
    se_loa = sd * float(np.sqrt(1.0 / n + k * k / (2.0 * (n - 1))))
    unit = "%" if percent else "units"
    terms = [
        {"term": "Bias (mean difference)", "estimate": _r(bias),
         "ciLow": _r(bias - tcrit * se_bias), "ciHigh": _r(bias + tcrit * se_bias)},
        {"term": "Upper limit of agreement", "estimate": _r(loa_u),
         "ciLow": _r(loa_u - tcrit * se_loa), "ciHigh": _r(loa_u + tcrit * se_loa)},
        {"term": "Lower limit of agreement", "estimate": _r(loa_l),
         "ciLow": _r(loa_l - tcrit * se_loa), "ciHigh": _r(loa_l + tcrit * se_loa)},
        {"term": "SD of differences", "estimate": _r(sd)},
    ]
    return {
        "method": "blandaltman", "title": "Bland-Altman method comparison", "terms": terms,
        "glance": {"n": n, "bias": _r(bias), "sd": _r(sd), "loa_lower": _r(loa_l), "loa_upper": _r(loa_u), "k": _r(k)},
        "extra": {"blandaltman": {"means": [_r(float(v)) for v in means], "diffs": [_r(float(v)) for v in diffs],
                                  "bias": _r(bias), "loaLower": _r(loa_l), "loaUpper": _r(loa_u),
                                  "percent": percent, "pairs": [[_r(float(a)), _r(float(b))] for a, b in zip(x, y)]}},
        "summary": "Bias %.4g %s (%.0f%% CI %.4g to %.4g); limits of agreement %.4g to %.4g over %d pairs." % (
            bias, unit, conf * 100, bias - tcrit * se_bias, bias + tcrit * se_bias, loa_l, loa_u, n),
        "assumptions": [
            "Paired measurements of the same quantity by two methods; the differences should be roughly normal with constant scatter across the range.",
            "Limits of agreement = bias ± %g·SD of the differences (≈ central %g%% of differences); %s difference scale." % (
                k, conf * 100, "percent-of-mean" if percent else "absolute"),
            "A trend of the difference vs the mean signals proportional bias — try the % difference, or Passing-Bablok / Deming regression.",
        ],
        "cite": "Bland & Altman (1986, 1999) limits of agreement; bias ± %g·SD with %g%% CIs (t, df = n−1)." % (k, conf * 100),
    }


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def _fmt_g(v):
    return "unbounded" if v is None else "%.4g" % v


def passingbablok(data):
    """Passing-Bablok (1983) regression for method comparison — a non-parametric,
    outlier-robust fit that assumes neither variable is error-free and needs no
    distributional assumption. The slope is the shifted median of all pairwise slopes
    (offset K = the number of slopes < −1); the intercept is median(y − slope·x). A
    slope CI containing 1 and an intercept CI containing 0 ⇒ the two methods agree."""
    np, stats = _np_sp()
    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    x, y = x[:n], y[:n]
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    n = int(x.size)
    if n < 3:
        raise StatsError("bad_request", "Passing-Bablok needs ≥ 3 paired points")
    conf = float(d.get("conf", 0.95))
    # Pairwise slopes with the standard Passing-Bablok tie rule: a vertical pair
    # (Δx = 0, Δy ≠ 0) counts as ±∞; identical points
    # (Δx = Δy = 0) carry no information and are dropped; a slope of exactly −1 is discarded
    # for symmetry. (Excluding the verticals instead biases the shifted median when many
    # X values are tied.)
    slopes = []
    for i in range(n):
        dx = x[i + 1:] - x[i]
        dy = y[i + 1:] - y[i]
        s = np.full(dx.size, np.nan)
        nz = dx != 0
        s[nz] = dy[nz] / dx[nz]
        s[(~nz) & (dy > 0)] = np.inf
        s[(~nz) & (dy < 0)] = -np.inf
        keep = ~(np.isnan(s) | (s == -1.0))
        slopes.extend(float(v) for v in s[keep])
    slopes = np.sort(np.asarray(slopes, dtype=float))
    N = int(slopes.size)
    if N == 0:
        raise StatsError("numerical", "Passing-Bablok undefined (no usable point pairs)")
    K = int(np.sum(slopes < -1.0))

    def shifted(offset):
        # The (shifted) median of the ordered slopes; average the two central values for even N.
        if N % 2 == 1:
            return float(slopes[_clamp((N - 1) // 2 + offset, 0, N - 1)])
        lo = slopes[_clamp(N // 2 - 1 + offset, 0, N - 1)]
        hi = slopes[_clamp(N // 2 + offset, 0, N - 1)]
        return float((lo + hi) / 2.0)

    b1 = shifted(K)
    b0 = float(np.median(y - b1 * x))
    # Rank-based CI (Passing-Bablok): C = z·SD of Kendall's S over the n data points
    # (not the N slopes); the interval is the pair of order statistics C/2 either side of
    # the (shifted) median of the N sorted slopes.
    w = float(stats.norm.ppf(1 - (1 - conf) / 2))
    C = w * float(np.sqrt(n * (n - 1) * (2 * n + 5) / 18.0))
    m1 = int(round((N - C) / 2.0))
    m2 = N - m1 + 1
    lo_raw = float(slopes[_clamp(m1 + K - 1, 0, N - 1)])
    hi_raw = float(slopes[_clamp(m2 + K - 1, 0, N - 1)])
    # A non-finite bound = an (effectively) unbounded limit → reported blank; the intercept
    # bounds correspond to the opposite slope bounds.
    b0_lo = float(np.median(y - hi_raw * x)) if np.isfinite(hi_raw) else None
    b0_hi = float(np.median(y - lo_raw * x)) if np.isfinite(lo_raw) else None
    b1_lo = lo_raw if np.isfinite(lo_raw) else None
    b1_hi = hi_raw if np.isfinite(hi_raw) else None
    r = float(np.corrcoef(x, y)[0, 1]) if n > 1 else float("nan")
    agree = (b1_lo is not None and b1_hi is not None and b1_lo <= 1 <= b1_hi
             and b0_lo is not None and b0_hi is not None and b0_lo <= 0 <= b0_hi)
    xs = np.linspace(float(x.min()), float(x.max()), 50)
    return {
        "method": "passingbablok", "title": "Passing-Bablok regression", "terms": [
            {"term": "Slope", "estimate": _r(b1), "ciLow": _r(b1_lo), "ciHigh": _r(b1_hi)},
            {"term": "Intercept", "estimate": _r(b0), "ciLow": _r(b0_lo), "ciHigh": _r(b0_hi)},
        ],
        "glance": {"slope": _r(b1), "intercept": _r(b0), "n": n, "pairs": N, "r": _r(r)},
        "curve": {"x": [round(float(v), 6) for v in xs], "y": [round(float(b0 + b1 * v), 6) for v in xs]},
        "summary": "Passing-Bablok: %s (slope %g%% CI %s to %s, intercept %s to %s) — the methods %s." % (
            _line(b1, b0), conf * 100, _fmt_g(b1_lo), _fmt_g(b1_hi), _fmt_g(b0_lo), _fmt_g(b0_hi),
            "agree (slope∋1, intercept∋0)" if agree else "differ"),
        "assumptions": [
            "Non-parametric + outlier-robust: no assumption on the error distributions; both methods may carry error.",
            "Requires a continuous, roughly linear relationship over the measured range (a curved relation invalidates it).",
            "Slope CI ∋ 1 and intercept CI ∋ 0 ⇒ no proportional / constant bias between the methods.",
        ],
        "cite": "Passing & Bablok (1983) non-parametric method-comparison regression; shifted-median slope + rank-based %g%% CI." % (conf * 100),
    }


def _pca_parallel(np, n, p, standardize, col_sd, sims, pct, seed):
    """Horn's parallel analysis: the (pct)th-percentile eigenvalue of `sims`
    random datasets shaped like the data (same n×p, same per-variable scale),
    each decomposed identically. A PC is retained only while its eigenvalue
    exceeds the matching random eigenvalue — random noise cannot beat chance.
    Seeded, so the retained count is reproducible."""
    rng = np.random.default_rng(seed)
    randeig = np.empty((sims, p))
    for s in range(sims):
        R = rng.standard_normal((n, p))
        Rc = R - R.mean(axis=0)
        if standardize:
            Z = Rc / R.std(axis=0, ddof=1)   # correlation-matrix eigenvalues
        else:
            Z = Rc * col_sd                  # match the observed variances (covariance)
        sv = np.linalg.svd(Z, compute_uv=False)
        randeig[s, :] = np.sort((sv ** 2) / (n - 1))[::-1]
    return np.percentile(randeig, pct, axis=0)


def pca(data):
    """Principal component analysis (PCA) — the orthogonal directions of
    greatest variance across the selected variables. Reports each component's
    eigenvalue, % variance explained and cumulative %, the variable loadings
    (eigenvectors), and the case scores. Variables are mean-centred and, by
    default, standardized (correlation-matrix PCA) so different units compare
    fairly. Complete-case (listwise)."""
    np, _ = _np_sp()
    d = data or {}
    cols = d.get("columns", [])
    p = len(cols)
    if p < 2:
        raise StatsError("bad_request", "PCA needs ≥ 2 variables")
    labels = d.get("labels") or ["Var %d" % (i + 1) for i in range(p)]
    standardize = d.get("standardize", True)
    # Component-selection rule (how many PCs to retain): parallel analysis (Horn's
    # Monte-Carlo, the rule most often recommended), Kaiser (eigenvalue > threshold), a fixed k,
    # a cumulative-variance threshold, or all. Kaiser (threshold 1.0) is the default when none is chosen.
    selection = str(d.get("componentSelection", "kaiser")).lower()
    kaiser_threshold = _flt(d.get("kaiserThreshold", 1.0))
    variance_threshold = _flt(d.get("varianceThreshold", 0.8))
    if variance_threshold > 1.0:  # accept a percent (80) or a fraction (0.8)
        variance_threshold /= 100.0
    fixed_k = d.get("fixedK")
    parallel_sims = max(1, int(d.get("parallelSims", 1000)))
    parallel_pct = _flt(d.get("parallelPercentile", 95.0))
    pca_seed = int(d.get("seed", 1234))
    # Row-aligned matrix (cases × variables); listwise-drop rows with any blank.
    rows = max((len(c) for c in cols), default=0)
    M = np.full((rows, p), np.nan)
    for j, c in enumerate(cols):
        for i, v in enumerate(c):
            M[i, j] = np.nan if (v is None or v == "") else _flt(v)
    mask = ~np.isnan(M).any(axis=1)
    M = M[mask, :]
    n = int(M.shape[0])
    if n < 3 or n <= p:
        raise StatsError("bad_request",
                         "PCA needs more complete cases than variables (have %d cases, %d variables)" % (n, p))
    for j in range(p):
        if float(np.std(M[:, j])) == 0:
            raise StatsError("bad_request", "variable \"%s\" is constant" % labels[j])

    # Optional per-case grouping (for grouped score plots / confidence ellipses):
    # aligned to the original rows, then carried through the same listwise mask so
    # each retained case keeps its label. Blank/missing → "Ungrouped".
    groups_in = d.get("groups")
    group_kept = None
    if groups_in:
        gl = list(groups_in)
        labeled = ["Ungrouped" if (i >= len(gl) or gl[i] is None or str(gl[i]).strip() == "")
                   else str(gl[i]) for i in range(rows)]
        group_kept = [labeled[i] for i in range(rows) if bool(mask[i])]

    means = M.mean(axis=0)
    Mc = M - means
    scale = M.std(axis=0, ddof=1) if standardize else np.ones(p)
    Z = Mc / scale
    # SVD of the (n−1)-scaled matrix → eigenvalues of the covariance/correlation.
    U, S, Vt = np.linalg.svd(Z, full_matrices=False)
    eig = (S ** 2) / (n - 1)
    total = float(np.sum(eig))
    # Deterministic sign: flip each PC so its largest-magnitude loading is positive.
    V = Vt.T
    for k in range(V.shape[1]):
        idx = int(np.argmax(np.abs(V[:, k])))
        if V[idx, k] < 0:
            V[:, k] *= -1
            U[:, k] *= -1
    scores = U * S  # case coordinates = Z @ V
    ncomp = int(eig.size)

    ratio = [float(e / total) for e in eig]
    cumr = []
    c = 0.0
    for r in ratio:
        c += r
        cumr.append(c)
    # Kaiser: eigenvalues above the threshold (1.0 = above-average for standardized PCA).
    kaiser_count = int(sum(1 for e in eig if float(e) > kaiser_threshold))

    # ── how many components to retain, per the chosen rule ──────────────────
    par_thresh = None
    if selection == "parallel":
        par_thresh = _pca_parallel(np, n, p, standardize, M.std(axis=0, ddof=1),
                                   parallel_sims, parallel_pct, pca_seed)
        retained = 0
        for k in range(ncomp):          # leading run above the random percentile
            if float(eig[k]) > float(par_thresh[k]):
                retained += 1
            else:
                break
    elif selection == "fixedk":
        try:
            retained = int(fixed_k)
        except (TypeError, ValueError):
            retained = 1
    elif selection == "variance":
        retained = ncomp
        for k in range(ncomp):
            if cumr[k] >= variance_threshold - 1e-12:
                retained = k + 1
                break
    elif selection == "all":
        retained = ncomp
    else:                                # "kaiser" (default)
        selection = "kaiser"
        retained = kaiser_count
    retained = max(0, min(int(retained), ncomp))
    retained_flags = [k < retained for k in range(ncomp)]

    terms = []
    for k in range(ncomp):
        terms.append({"term": "PC%d" % (k + 1), "estimate": _r(float(eig[k])),
                      "statistic": _r(ratio[k] * 100.0), "ciLow": _r(cumr[k] * 100.0),
                      "retained": bool(retained_flags[k])})
    # Loadings matrix (variables × PCs) + scores (cases × PCs) for the graph suite.
    loadings = [[_r(float(V[j, k])) for k in range(ncomp)] for j in range(p)]
    scoremat = [[_r(float(scores[i, k])) for k in range(ncomp)] for i in range(n)]
    pcLabels = ["PC%d" % (k + 1) for k in range(ncomp)]
    omitted = rows - n

    sel_label = {"parallel": "Parallel analysis",
                 "kaiser": "Kaiser (eigenvalue > %g)" % kaiser_threshold,
                 "fixedk": "Fixed count",
                 "variance": "Cumulative variance ≥ %g%%" % (variance_threshold * 100.0),
                 "all": "All components"}.get(selection, "Kaiser")

    extra_pca = {"varLabels": labels, "pcLabels": pcLabels,
                 "loadings": loadings, "scores": scoremat,
                 "eigenvalues": [_r(float(e)) for e in eig],
                 "explained": [_r(r) for r in ratio],
                 "retained": retained, "retainedFlags": retained_flags,
                 "selection": selection}
    if par_thresh is not None:
        extra_pca["parallelThresholds"] = [_r(float(t)) for t in par_thresh]
    if group_kept is not None:
        extra_pca["groups"] = group_kept

    return {
        "method": "pca",
        "title": "Principal component analysis",
        "terms": terms,
        "extra": {"pca": extra_pca},
        "glance": {"variables": p, "cases": n, "components": ncomp,
                   "pc1_pct": _r(ratio[0] * 100.0),
                   "pc2_pct": _r(ratio[1] * 100.0) if ncomp > 1 else None,
                   "kaiser": kaiser_count, "retained": retained, "selection": selection},
        "summary": "%d variables, %d cases%s; PC1 explains %.1f%%%s of the variance. %s retains %d component(s)." % (
            p, n, (", standardized" if standardize else ", centred"),
            ratio[0] * 100.0,
            (" and PC2 %.1f%%" % (ratio[1] * 100.0)) if ncomp > 1 else "",
            sel_label, retained),
        "assumptions": [
            "PCA is descriptive (no p-values): it re-expresses the data on orthogonal axes of decreasing variance.",
            "Standardized (correlation) PCA when variables differ in scale; centred (covariance) PCA otherwise.",
            ("Component selection: parallel analysis (%d sims, %gth percentile, seed %d) — retain PCs whose "
             "eigenvalue beats random noise." % (parallel_sims, parallel_pct, pca_seed)) if selection == "parallel"
            else "Component selection: %s retains %d of %d component(s)." % (sel_label, retained, ncomp),
            "Complete-case: %d row(s) with a missing value were dropped." % omitted if omitted else
            "Complete-case analysis (no missing values present).",
        ],
        "cite": "Principal component analysis via SVD of the %s matrix; "
                "eigenvalues, %% variance explained, loadings + scores." % (
                    "correlation" if standardize else "covariance"),
    }


def _kmeans(np, X, k, seed, max_iter=300):
    """Lloyd's k-means with a seeded k-means++ init (reproducible). Returns
    (labels, centroids, n_iter). Restarts a handful of times from different seeds
    and keeps the lowest-inertia solution (k-means is init-sensitive)."""
    n = X.shape[0]
    best = None
    for restart in range(6):
        rng = np.random.default_rng(seed + restart * 7919)
        # k-means++ seeding: first centre uniform, each next ∝ squared distance.
        centres = [int(rng.integers(n))]
        d2 = np.sum((X - X[centres[0]]) ** 2, axis=1)
        for _ in range(1, k):
            probs = d2 / (d2.sum() or 1.0)
            nxt = int(rng.choice(n, p=probs))
            centres.append(nxt)
            d2 = np.minimum(d2, np.sum((X - X[nxt]) ** 2, axis=1))
        C = X[centres].astype(float).copy()
        labels = np.zeros(n, dtype=int)
        it = 0
        for it in range(1, max_iter + 1):
            # Assign each point to the nearest centroid.
            dists = np.sum((X[:, None, :] - C[None, :, :]) ** 2, axis=2)
            new = np.argmin(dists, axis=1)
            if it > 1 and np.array_equal(new, labels):
                break
            labels = new
            for c in range(k):
                pts = X[labels == c]
                if pts.shape[0] > 0:
                    C[c] = pts.mean(axis=0)
                else:
                    # Empty cluster → reseed to the point farthest from its centroid.
                    far = int(np.argmax(np.min(dists, axis=1)))
                    C[c] = X[far]
        inertia = float(np.sum((X - C[labels]) ** 2))
        if best is None or inertia < best[0]:
            best = (inertia, labels.copy(), C.copy(), it)
    return best[1], best[2], best[3]


# UI distance-metric labels → scipy.spatial.distance names. "manhattan" is the
# common UI label for the L1 / city-block distance, which scipy only accepts as
# "cityblock"; passing "manhattan" straight to pdist raises "Unknown Distance Metric".
_METRIC_ALIASES = {"manhattan": "cityblock", "l1": "cityblock", "l2": "euclidean"}


def _scipy_metric(m):
    """Canonicalise a UI metric name to a scipy.spatial.distance metric."""
    return _METRIC_ALIASES.get(str(m).lower(), m)


def _silhouette(np, X, labels, metric="euclidean"):
    """Mean silhouette width over all points (−1…1): (b−a)/max(a,b) where a = mean
    intra-cluster distance and b = the smallest mean distance to another cluster.
    Points in singleton clusters score 0. O(n²) pairwise distances computed with the
    same `metric` that formed the clusters, so a well-separated cosine/correlation
    clustering isn't judged (and mislabelled 'barely separated') by Euclidean geometry."""
    n = X.shape[0]
    uniq = np.unique(labels)
    if uniq.size < 2:
        return float("nan")
    from scipy.spatial.distance import pdist, squareform
    # squareform(pdist(...)) with metric="euclidean" is the plain Euclidean distance
    # matrix, so the default path is ordinary Euclidean distance.
    D = squareform(pdist(X, metric=metric))
    s = np.zeros(n)
    for i in range(n):
        same = labels == labels[i]
        same[i] = False
        cnt = int(np.sum(same))
        a = float(np.mean(D[i, same])) if cnt > 0 else 0.0
        b = np.inf
        for c in uniq:
            if c == labels[i]:
                continue
            other = labels == c
            if np.any(other):
                b = min(b, float(np.mean(D[i, other])))
        s[i] = 0.0 if (cnt == 0 or max(a, b) == 0) else (b - a) / max(a, b)
    return float(np.mean(s))


def _elbow_k(np, ks, wss):
    """The 'elbow' of a within-cluster-SS-vs-k curve (kneedle): normalize both axes
    to [0,1], then pick the k whose point lies farthest below the chord joining the
    first and last points — the knee of diminishing returns."""
    x = np.asarray(ks, float)
    y = np.asarray(wss, float)
    if x.size < 3:
        return int(ks[0])
    rx = (x.max() - x.min()) or 1.0
    ry = (y.max() - y.min()) or 1.0
    xn = (x - x.min()) / rx
    yn = (y - y.min()) / ry
    x0, y0, x1, y1 = xn[0], yn[0], xn[-1], yn[-1]
    den = (np.hypot(y1 - y0, x1 - x0)) or 1.0
    dist = np.abs((y1 - y0) * xn - (x1 - x0) * yn + x1 * y0 - y1 * x0) / den
    return int(ks[int(np.argmax(dist))])


def _cluster_scan(np, X, variant, seed, metric, linkage_m, kmin, kmax):
    """Cluster X at every k in [kmin, kmax] and return (ks, withinSS, silhouette)
    per k — the raw material for elbow (within-SS) + silhouette k-selection. The
    hierarchical tree is built once and re-cut; k-means is re-run per k."""
    ks, wss_l, sil_l = [], [], []
    Z = None
    # The metric silhouette is measured with = the one that actually formed the clusters
    # (Euclidean for ward/centroid/median linkage and for k-means, else the request).
    met = "euclidean" if (variant != "hierarchical" or linkage_m in ("ward", "centroid", "median")) else metric
    if variant == "hierarchical":
        from scipy.cluster.hierarchy import linkage as _linkage, fcluster
        from scipy.spatial.distance import pdist
        Z = _linkage(pdist(X, metric=met), method=linkage_m)
    for kk in range(kmin, kmax + 1):
        if variant == "hierarchical":
            from scipy.cluster.hierarchy import fcluster
            lab = fcluster(Z, t=kk, criterion="maxclust").astype(int) - 1
            remap = {old: new for new, old in enumerate(sorted(set(int(v) for v in lab)))}
            lab = np.array([remap[int(v)] for v in lab])
            kact = len(remap)
            cents = np.array([X[lab == c].mean(axis=0) for c in range(kact)])
        else:
            lab, cents, _ = _kmeans(np, X, kk, seed)
            kact = kk
        wss_l.append(float(np.sum((X - cents[lab]) ** 2)))
        sil_l.append(_silhouette(np, X, lab, met) if X.shape[0] > kact else float("nan"))
        ks.append(kk)
    return ks, wss_l, sil_l


def cluster(data):
    """Partition observations into clusters — **k-means** (Lloyd's algorithm with a
    seeded k-means++ init, restarted for the best inertia) or **agglomerative
    hierarchical** (Ward / average / complete / single / centroid / median / weighted
    linkage; Euclidean / Manhattan / cosine / 1−correlation distance) cut into k groups. Reports
    each cluster's size, within-cluster sum of squares, and the mean silhouette
    width (how well-separated the clustering is, −1…1). Variables are z-scored by
    default so different units compare fairly. Complete-case (listwise)."""
    np, _ = _np_sp()
    d = data or {}
    cols = d.get("columns", [])
    p = len(cols)
    if p < 1:
        raise StatsError("bad_request", "Clustering needs ≥ 1 variable")
    labels_v = d.get("labels") or ["Var %d" % (i + 1) for i in range(p)]
    variant = d.get("variant", "kmeans")
    standardize = d.get("standardize", True)
    seed = int(d.get("seed", 20240704))
    metric = _scipy_metric(d.get("metric", "euclidean"))
    linkage_m = d.get("linkage", "ward")

    rows = max((len(c) for c in cols), default=0)
    M = np.full((rows, p), np.nan)
    for j, c in enumerate(cols):
        for i, v in enumerate(c):
            M[i, j] = np.nan if (v is None or v == "") else _flt(v)
    mask = ~np.isnan(M).any(axis=1)
    M = M[mask, :]
    n = int(M.shape[0])
    if n < 2:
        raise StatsError("bad_request", "Clustering needs ≥ 2 complete cases")
    k = max(2, min(int(d.get("k", 3)), n))

    if standardize:
        mu = M.mean(axis=0)
        sd = M.std(axis=0, ddof=0)
        sd[sd == 0] = 1.0
        X = (M - mu) / sd
    else:
        X = M.astype(float).copy()

    if variant == "hierarchical":
        from scipy.cluster.hierarchy import linkage as _linkage, fcluster
        from scipy.spatial.distance import pdist
        # Ward, centroid and median linkages are defined on squared-Euclidean geometry —
        # scipy requires the Euclidean metric for them; the others accept any metric.
        met = "euclidean" if linkage_m in ("ward", "centroid", "median") else metric
        Z = _linkage(pdist(X, metric=met), method=linkage_m)
        lab = fcluster(Z, t=k, criterion="maxclust").astype(int) - 1
        # Re-label clusters 0…k-1 contiguously (fcluster can skip labels).
        remap = {old: new for new, old in enumerate(sorted(set(int(v) for v in lab)))}
        lab = np.array([remap[int(v)] for v in lab])
        kk = len(remap)
        centroids = np.array([X[lab == c].mean(axis=0) for c in range(kk)])
        n_iter = None
        sil_metric = met  # the metric actually used to form the tree
    else:
        lab, centroids, n_iter = _kmeans(np, X, k, seed)
        kk = k
        sil_metric = "euclidean"  # k-means minimises squared-Euclidean inertia

    sizes = [int(np.sum(lab == c)) for c in range(kk)]
    wss = [float(np.sum((X[lab == c] - centroids[c]) ** 2)) for c in range(kk)]
    total_wss = float(sum(wss))
    sil = _silhouette(np, X, lab, sil_metric) if n > kk else float("nan")

    # Optional k-selection scan: cluster over a range of k and report within-SS
    # (the elbow) + mean silhouette per k, plus a suggested k (max silhouette) and
    # the elbow k. Guides the choice of k without changing the reported clustering.
    scan = None
    if d.get("scanK"):
        kmax = min(int(d.get("kMax", 10)), n - 1)
        if kmax >= 2:
            sks, swss, ssil = _cluster_scan(np, X, variant, seed, metric, linkage_m, 2, kmax)
            finite = [s for s in ssil if s == s]
            best_k = int(sks[int(np.nanargmax(ssil))]) if finite else None
            scan = {"ks": sks, "withinSS": [_r(w) for w in swss],
                    "silhouette": [(_r(s) if s == s else None) for s in ssil],
                    "bestKSilhouette": best_k, "elbowK": _elbow_k(np, sks, swss)}

    terms = []
    for c in range(kk):
        terms.append({"term": "Cluster %d" % (c + 1),
                      "estimate": sizes[c],
                      "statistic": _r(wss[c])})
    # Carry the per-case labels back to the original row order (blank rows → None).
    full_lab = [None] * rows
    ki = 0
    for i in range(rows):
        if bool(mask[i]):
            full_lab[i] = int(lab[ki])
            ki += 1

    scan_note = ""
    if scan and scan["bestKSilhouette"] is not None:
        scan_note = " Scanned k=2–%d: silhouette suggests k=%d (elbow k=%d)." % (
            scan["ks"][-1], scan["bestKSilhouette"], scan["elbowK"])
    biggest = int(np.argmax(sizes)) + 1
    return {
        "method": "cluster",
        "title": "Cluster analysis (%s)" % ("k-means" if variant == "kmeans" else "hierarchical, %s linkage" % linkage_m),
        "terms": terms,
        "glance": {"clusters": kk, "cases": n, "variables": p,
                   "silhouette": _r(sil), "withinSS": _r(total_wss),
                   **({"iterations": n_iter} if n_iter is not None else {}),
                   **({"suggestedK": scan["bestKSilhouette"], "elbowK": scan["elbowK"]} if scan else {})},
        "extra": {"cluster": {"variant": variant, "k": kk, "labels": full_lab,
                              "sizes": sizes, "silhouette": _r(sil),
                              "withinSS": [_r(w) for w in wss],
                              "centroids": [[_r(float(v)) for v in centroids[c]] for c in range(kk)],
                              "varLabels": labels_v, "standardized": bool(standardize),
                              **({"kScan": scan} if scan else {})}},
        "summary": "%s into %d clusters of size %s%s. Total within-cluster SS %.3g; mean silhouette %s (−1…1, higher = better separated).%s" % (
            ("k-means" if variant == "kmeans" else "Hierarchical clustering"),
            kk, "/".join(str(s) for s in sizes),
            "" if variant == "hierarchical" else (" in %d iterations" % n_iter),
            total_wss,
            ("%.3f" % sil) if sil == sil else "n/a", scan_note),
        "assumptions": [
            "Clustering is exploratory (no p-values): it groups cases by profile similarity.",
            "Variables %s before clustering." % ("z-scored (standardized)" if standardize else "used on their raw scale"),
            "k-means is init-sensitive — the seeded k-means++ start is restarted 6× and the best (lowest within-SS) kept."
            if variant == "kmeans" else
            "Hierarchical clustering is deterministic; Ward / centroid / median linkage require the Euclidean metric (forced automatically).",
            "k-selection scan: within-cluster SS (elbow) + mean silhouette across k=2–%d; silhouette suggests k=%d." % (
                scan["ks"][-1], scan["bestKSilhouette"]) if (scan and scan["bestKSilhouette"] is not None) else
            "Cluster %d is the largest (%d cases)." % (biggest, max(sizes)),
        ],
        "cite": "%s clustering of %d z-scored variable(s); silhouette after Rousseeuw (1987)." % (
            "k-means (Lloyd)" if variant == "kmeans" else "Agglomerative hierarchical",
            p),
    }


# ── Ordination: the indirect (unconstrained) half ────────────────────────────────
#
# PCA has its own section. These are the three an ecologist reaches for when PCA's
# assumptions do not hold on a species matrix (counts, many zeros, non-linear
# responses along a gradient):
#   * CA    — chi-square metric, sites and species on the same axes (see `ca`)
#   * PCoA  — an eigen-decomposition of any distance matrix (Bray-Curtis, Jaccard…)
#   * NMDS  — ranks only: it preserves the order of the dissimilarities, not their size
# The transformations they lean on are shared, and so is the distance step.


def _community_matrix(np, d, what, min_rows=3):
    """The complete-case sites × variables matrix, with the case labels and groups
    that survived the listwise drop. Shared by every ordination method so they all
    read the payload the same way (the PCA contract: `columns`, `labels`, `groups`,
    optional `caseLabels`)."""
    cols = d.get("columns", [])
    p = len(cols)
    if p < 2:
        raise StatsError("bad_request", "%s needs ≥ 2 variables" % what)
    labels = d.get("labels") or ["Var %d" % (i + 1) for i in range(p)]
    rows = max((len(c) for c in cols), default=0)
    M = np.full((rows, p), np.nan)
    for j, c in enumerate(cols):
        for i, v in enumerate(c):
            M[i, j] = np.nan if (v is None or v == "") else _flt(v)
    mask = ~np.isnan(M).any(axis=1)
    M = M[mask, :]
    n = int(M.shape[0])
    if n < min_rows:
        raise StatsError("bad_request", "%s needs ≥ %d complete cases (have %d)" % (what, min_rows, n))
    groups_in = d.get("groups")
    group_kept = None
    if groups_in:
        gl = list(groups_in)
        labeled = ["Ungrouped" if (i >= len(gl) or gl[i] is None or str(gl[i]).strip() == "")
                   else str(gl[i]) for i in range(rows)]
        group_kept = [labeled[i] for i in range(rows) if bool(mask[i])]
    case_in = d.get("caseLabels")
    if case_in:
        cl = list(case_in)
        cases = [str(cl[i]) if i < len(cl) and cl[i] is not None else "Case %d" % (i + 1) for i in range(rows)]
        cases = [cases[i] for i in range(rows) if bool(mask[i])]
    else:
        cases = ["Case %d" % (i + 1) for i in range(n)]
    return M, labels, group_kept, cases


_TRANSFORMS = {
    "none": "no transformation",
    "hellinger": "Hellinger (square root of relative abundance)",
    "chisq": "chi-square",
    "wisconsin": "Wisconsin double standardization",
    "total": "relative abundance (row totals = 1)",
    "sqrt": "square root",
    "log1p": "log(1 + x)",
}


def _transform_community(np, M, how):
    """Standardizations a species matrix usually needs before a Euclidean-geometry
    method sees it. Each is exactly its textbook definition:

      hellinger  sqrt(x / row total)      — Euclidean distance on it is the Hellinger
                                            distance, the usual fix for a PCA/RDA on counts
      chisq      x / (sqrt(row total) * sqrt(col total)) * sqrt(grand total)
                                          — Euclidean distance on it is the chi-square
                                            distance, which is what CA and CCA use
      wisconsin  column / column max, then row / row total — vegan's default for NMDS
      total      x / row total            — profiles (relative abundance)

    A zero row or column would divide by zero; those are left untouched (an all-zero
    site stays all-zero rather than becoming NaN and dropping out silently)."""
    how = str(how or "none").lower()
    if how not in _TRANSFORMS:
        raise StatsError("bad_request", "unknown transformation \"%s\"" % how)
    X = M.astype(float).copy()
    if how == "none":
        return X
    if how == "sqrt":
        if np.any(X < 0):
            raise StatsError("bad_request", "square-root transformation needs non-negative data")
        return np.sqrt(X)
    if how == "log1p":
        if np.any(X < -1):
            raise StatsError("bad_request", "log(1 + x) needs x > -1")
        return np.log1p(X)
    if np.any(X < 0):
        raise StatsError("bad_request",
                         "the %s transformation needs non-negative data (a species matrix)" % _TRANSFORMS[how])
    if how in ("hellinger", "total"):
        rt = X.sum(axis=1, keepdims=True)
        rt[rt == 0] = 1.0
        P = X / rt
        return np.sqrt(P) if how == "hellinger" else P
    if how == "chisq":
        grand = float(X.sum())
        if grand <= 0:
            raise StatsError("bad_request", "the chi-square transformation needs a non-empty matrix")
        rt = X.sum(axis=1, keepdims=True)
        ct = X.sum(axis=0, keepdims=True)
        rt[rt == 0] = 1.0
        ct[ct == 0] = 1.0
        return X / np.sqrt(rt) / np.sqrt(ct) * math.sqrt(grand)
    # wisconsin: column max first, then row total
    cm = X.max(axis=0, keepdims=True)
    cm[cm == 0] = 1.0
    X = X / cm
    rt = X.sum(axis=1, keepdims=True)
    rt[rt == 0] = 1.0
    return X / rt


# The name a reader knows for each distance, for titles, notes and citations. The computation
# keeps scipy's id (`met`); only the text shows this.
_METRIC_NAMES = {
    "braycurtis": "Bray-Curtis", "cityblock": "Manhattan", "euclidean": "Euclidean",
    "sqeuclidean": "squared Euclidean", "canberra": "Canberra", "chebyshev": "Chebyshev",
    "minkowski": "Minkowski", "hamming": "Hamming", "cosine": "cosine",
    "correlation": "correlation", "jaccard (presence/absence)": "Jaccard (presence/absence)",
}


def _line(slope, intercept):
    """ "y = 1.008·x − 0.05455": a negative intercept is written with a minus, not "+ -"."""
    if intercept is None or intercept != intercept:
        return "y = %.4g·x" % slope
    return "y = %.4g·x %s %.4g" % (slope, "−" if intercept < 0 else "+", abs(intercept))


def _metric_name(met):
    return _METRIC_NAMES.get(met, met)


def _dissimilarity(np, X, metric):
    """Square dissimilarity matrix, via scipy's pdist. `bray` is accepted because
    it is the usual name in ecology; scipy's own "braycurtis" works too."""
    from scipy.spatial.distance import pdist, squareform
    met = str(metric or "braycurtis").lower()
    met = {"bray": "braycurtis", "bray-curtis": "braycurtis", "manhattan": "cityblock",
           "l1": "cityblock", "l2": "euclidean"}.get(met, met)
    if met == "jaccard":
        # scipy's `jaccard` is the boolean one; on abundances the ecologist means the
        # quantitative form (Ruzicka), which is Bray-Curtis on presence/absence data.
        return squareform(pdist((X > 0).astype(float), metric="jaccard")), "jaccard (presence/absence)"
    try:
        D = squareform(pdist(X, metric=met))
    except ValueError as e:
        raise StatsError("bad_request", "unknown distance \"%s\" (%s)" % (metric, e))
    if not np.all(np.isfinite(D)):
        raise StatsError("bad_request",
                         "the %s distance is undefined for this data (an all-zero site?)" % _metric_name(met))
    return D, met


def _sign_fix(np, C):
    """Deterministic axis signs: flip each axis so its largest-magnitude coordinate is
    positive. An ordination axis has no inherent direction, so without this the same
    data redraws mirrored between runs."""
    for k in range(C.shape[1]):
        idx = int(np.argmax(np.abs(C[:, k])))
        if C[idx, k] < 0:
            C[:, k] *= -1
    return C


def _wascores(np, C, W):
    """Species scores by weighted averaging: each species sits at the abundance-weighted
    mean of the sites it occurs in — the standard way species are added to a PCoA/NMDS
    plot (they have no loadings of their own). Species with no abundance anywhere get
    the origin rather than a NaN."""
    out = np.zeros((W.shape[1], C.shape[1]))
    tot = W.sum(axis=0)
    for j in range(W.shape[1]):
        if tot[j] > 0:
            out[j, :] = (W[:, j] @ C) / tot[j]
    return out


def pcoa(data):
    """Principal coordinates analysis (PCoA / classical metric scaling) — the map of a
    distance matrix. Where PCA is fixed to Euclidean distance, this takes any
    dissimilarity (Bray-Curtis, Jaccard, Manhattan…), so it can be used on the count
    data with many zeros where a PCA would mislead. Double-centres the squared
    distances and decomposes them; each axis carries a share of the total variation.
    Negative eigenvalues mean the dissimilarity is not Euclidean-embeddable and are
    reported (with an optional Cailliez or Lingoes correction). Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "PCoA")
    n, p = int(M.shape[0]), int(M.shape[1])
    transform = str(d.get("transform", "none")).lower()
    X = _transform_community(np, M, transform)
    D, met = _dissimilarity(np, X, d.get("metric", "braycurtis"))
    correction = str(d.get("correction", "none")).lower()

    def _coords(Dm):
        A = -0.5 * (Dm ** 2)
        J = np.eye(n) - np.ones((n, n)) / n
        G = J @ A @ J
        G = (G + G.T) / 2.0                      # symmetrise away the float dust
        vals, vecs = np.linalg.eigh(G)
        order = np.argsort(vals)[::-1]
        return vals[order], vecs[:, order]

    vals, vecs = _coords(D)
    neg = float(-min(0.0, float(vals.min())))
    applied = "none"
    if correction in ("cailliez", "lingoes") and neg > 1e-12:
        # Both corrections add a constant to the off-diagonal dissimilarities so the
        # matrix becomes Euclidean; Lingoes adds it to the squared distances.
        if correction == "lingoes":
            c = neg
            D2 = D ** 2 + 2 * c * (1 - np.eye(n))
            Dc = np.sqrt(np.maximum(D2, 0.0))
        else:
            # Cailliez: the largest eigenvalue of the 2n x 2n companion matrix.
            A = -0.5 * (D ** 2)
            J = np.eye(n) - np.ones((n, n)) / n
            G = J @ A @ J
            G2 = J @ (-0.5 * D) @ J
            Z = np.zeros((2 * n, 2 * n))
            Z[:n, n:] = 2 * G
            Z[n:, :n] = -np.eye(n)
            Z[n:, n:] = -4 * G2
            c = float(np.max(np.real(np.linalg.eigvals(Z))))
            c = max(c, 0.0)
            Dc = D + c * (1 - np.eye(n))
        vals, vecs = _coords(Dc)
        applied = correction

    pos = vals > max(1e-9, float(np.max(np.abs(vals))) * 1e-12)
    k = int(np.sum(pos))
    if k < 1:
        raise StatsError("bad_request", "PCoA found no positive axes — the dissimilarities carry no structure")
    coords = _sign_fix(np, vecs[:, :k] * np.sqrt(vals[:k]))
    total = float(np.sum(vals[pos]))
    ratio = [float(v / total) for v in vals[:k]]
    axisLabels = ["PCoA%d" % (i + 1) for i in range(k)]
    species = _wascores(np, coords, X) if np.all(X >= 0) else None

    negcount = int(np.sum(vals < -1e-9))
    warnings = []
    if negcount and applied == "none":
        warnings.append(
            "%d negative eigenvalue(s): the %s dissimilarity cannot be represented exactly in Euclidean space. "
            "The drawn axes are still the best fit; a Cailliez or Lingoes correction removes them." % (negcount, _metric_name(met)))

    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(coords[i, a])) for a in range(k)] for i in range(n)],
             "eigenvalues": [_r(float(v)) for v in vals[:k]],
             "explained": [_r(r) for r in ratio],
             "caseLabels": cases,
             "negativeEigenvalues": negcount,
             "correction": applied,
             "metric": met, "transform": transform}
    if species is not None:
        extra["speciesScores"] = [[_r(float(species[j, a])) for a in range(k)] for j in range(p)]
    if group_kept is not None:
        extra["groups"] = group_kept

    return {
        "method": "pcoa",
        "title": "Principal coordinates analysis (PCoA)",
        "terms": [{"term": axisLabels[a], "estimate": _r(float(vals[a])),
                   "extra1": _r(ratio[a] * 100.0)} for a in range(k)],
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "axes": k,
                   "axis1_pct": _r(ratio[0] * 100.0),
                   "axis2_pct": _r(ratio[1] * 100.0) if k > 1 else None,
                   "negativeEigenvalues": negcount},
        "summary": "%d cases, %d variables, %s distance%s; PCoA1 explains %.1f%%%s of the variation." % (
            n, p, _metric_name(met), ("" if transform == "none" else " after the %s transformation" % _TRANSFORMS[transform]),
            ratio[0] * 100.0, (" and PCoA2 %.1f%%" % (ratio[1] * 100.0)) if k > 1 else ""),
        "assumptions": [
            "PCoA is descriptive (no p-values): it places the cases so their Euclidean distances match the chosen dissimilarity as closely as possible.",
            "Distance: %s%s." % (_metric_name(met), "" if transform == "none" else "; data %s first" % _TRANSFORMS[transform]),
            ("Correction applied: %s (the negative eigenvalues are removed)." % applied) if applied != "none"
            else "No correction applied.",
        ] + warnings,
        "cite": "Principal coordinates analysis (Gower 1966) of %d cases on the %s dissimilarity." % (n, _metric_name(met)),
    }


def _pava(np, y, w):
    """Pool-adjacent-violators: the least-squares fit to `y` that never decreases.
    Weighted. Written out here because it is the whole of the "non-metric" in NMDS —
    the monotone regression of the ordination distances on the dissimilarity ranks."""
    yy = [float(v) for v in y]
    ww = [float(v) for v in w]
    vals = []
    wts = []
    cnt = []
    for i in range(len(yy)):
        vals.append(yy[i])
        wts.append(ww[i])
        cnt.append(1)
        while len(vals) > 1 and vals[-2] > vals[-1]:
            v2, w2, c2 = vals.pop(), wts.pop(), cnt.pop()
            v1, w1, c1 = vals.pop(), wts.pop(), cnt.pop()
            wsum = w1 + w2
            vals.append((v1 * w1 + v2 * w2) / wsum if wsum > 0 else (v1 + v2) / 2.0)
            wts.append(wsum)
            cnt.append(c1 + c2)
    out = []
    for v, c in zip(vals, cnt):
        out.extend([v] * c)
    return np.asarray(out, dtype=float)


def _nmds_stress(np, dist, disp):
    """Kruskal's Stress-1: sqrt(sum (d - dhat)^2 / sum d^2), the number every NMDS
    figure reports."""
    den = float(np.sum(dist ** 2))
    if den <= 0:
        return 0.0
    return float(math.sqrt(float(np.sum((dist - disp) ** 2)) / den))


def nmds(data):
    """Non-metric multidimensional scaling (NMDS) — the ordination that uses only the
    order of the dissimilarities, not their size. It places the cases so that the rank
    order of the map distances matches the rank order of the dissimilarities as closely
    as possible; the mismatch is Kruskal's stress-1 (< 0.1 good, < 0.2 usable, > 0.3
    close to arbitrary). Because the fit is iterative and can settle in a local
    minimum, it is restarted from several random starts plus the PCoA solution, and the
    best (lowest stress) is kept. The result is rotated to principal axes so NMDS1 is
    the widest spread. Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "NMDS", min_rows=4)
    n, p = int(M.shape[0]), int(M.shape[1])
    transform = str(d.get("transform", "none")).lower()
    X = _transform_community(np, M, transform)
    D, met = _dissimilarity(np, X, d.get("metric", "braycurtis"))
    k = max(1, min(int(d.get("dimensions", 2)), n - 1))
    tries = max(1, min(int(d.get("tries", 20)), 200))
    maxit = max(20, min(int(d.get("maxIterations", 300)), 5000))
    tol = float(d.get("tolerance", 1e-7))
    seed = int(d.get("seed", 20240704))
    iu = np.triu_indices(n, 1)
    diss = D[iu]
    if float(np.max(diss)) <= 0:
        raise StatsError("bad_request", "every dissimilarity is zero — there is nothing to map")
    order = np.argsort(diss, kind="mergesort")   # stable: ties keep their input order

    def _fit(C0):
        """SMACOF majorization against the monotone disparities, alternating:
        monotone regression (what "non-metric" means) then a Guttman transform step."""
        C = C0.copy()
        prev = None
        stress = 1.0
        for _ in range(maxit):
            dist = np.linalg.norm(C[iu[0]] - C[iu[1]], axis=1)
            # 1) disparities: the monotone function of the dissimilarities closest to
            #    the current distances (PAVA over the dissimilarity order).
            dhat = np.empty_like(dist)
            dhat[order] = _pava(np, dist[order], np.ones(dist.size))
            stress = _nmds_stress(np, dist, dhat)
            if prev is not None and abs(prev - stress) < tol:
                break
            prev = stress
            # 2) Guttman transform: move each point toward where the disparities want it.
            safe = np.where(dist > 1e-12, dist, 1e-12)
            B = np.zeros((n, n))
            ratio = -dhat / safe
            B[iu] = ratio
            B[(iu[1], iu[0])] = ratio
            np.fill_diagonal(B, -B.sum(axis=1))
            C = (B @ C) / n
        return C, stress

    # Start from the PCoA solution (deterministic, usually the best) plus seeded random starts.
    starts = []
    A = -0.5 * (D ** 2)
    J = np.eye(n) - np.ones((n, n)) / n
    G = J @ A @ J
    vals, vecs = np.linalg.eigh((G + G.T) / 2.0)
    o = np.argsort(vals)[::-1][:k]
    starts.append(vecs[:, o] * np.sqrt(np.maximum(vals[o], 1e-9)))
    rng = np.random.default_rng(seed)
    scale = float(np.mean(diss))
    for _ in range(tries - 1):
        starts.append(rng.standard_normal((n, k)) * scale)

    best = None
    best_stress = float("inf")
    converged = 0
    for C0 in starts:
        C, s = _fit(C0)
        if s < best_stress - 1e-9:
            best, best_stress = C, s
            converged = 1
        elif abs(s - best_stress) <= 1e-4:
            converged += 1

    C = best - best.mean(axis=0)
    # Rotate to principal axes: NMDS axes are arbitrary, so the convention is that
    # axis 1 carries the widest spread (vegan does the same).
    if k > 1:
        U, S, Vt = np.linalg.svd(C, full_matrices=False)
        C = C @ Vt.T
    C = _sign_fix(np, C)

    dist = np.linalg.norm(C[iu[0]] - C[iu[1]], axis=1)
    dhat = np.empty_like(dist)
    dhat[order] = _pava(np, dist[order], np.ones(dist.size))
    stress = _nmds_stress(np, dist, dhat)
    # Shepard diagram: observed dissimilarity vs map distance, with the fitted step.
    shepard = {"dissimilarity": [_r(float(v)) for v in diss],
               "distance": [_r(float(v)) for v in dist],
               "fitted": [_r(float(v)) for v in dhat]}
    # Non-metric fit R^2 = 1 - stress^2 (the standard "fit" line under a Shepard plot).
    r2 = 1.0 - stress ** 2
    lin = float(np.corrcoef(diss, dist)[0, 1]) ** 2 if n > 2 else float("nan")

    quality = ("good" if stress < 0.1 else "usable" if stress < 0.2 else
               "poor" if stress < 0.3 else "close to arbitrary")
    axisLabels = ["NMDS%d" % (i + 1) for i in range(k)]
    species = _wascores(np, C, X) if np.all(X >= 0) else None
    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(C[i, a])) for a in range(k)] for i in range(n)],
             "caseLabels": cases,
             "stress": _r(stress), "shepard": shepard,
             "nonMetricR2": _r(r2), "linearR2": _r(lin),
             "convergedStarts": converged, "tries": tries,
             "metric": met, "transform": transform, "dimensions": k}
    if species is not None:
        extra["speciesScores"] = [[_r(float(species[j, a])) for a in range(k)] for j in range(p)]
    if group_kept is not None:
        extra["groups"] = group_kept

    return {
        "method": "nmds",
        "title": "Non-metric multidimensional scaling (NMDS)",
        "terms": [{"term": "Stress (Kruskal-1)", "estimate": _r(stress)},
                  {"term": "Non-metric fit R²", "estimate": _r(r2)},
                  {"term": "Linear fit R²", "estimate": _r(lin)}],
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "dimensions": k,
                   "stress": _r(stress), "nonMetricR2": _r(r2),
                   "convergedStarts": converged, "tries": tries},
        "summary": "%d cases in %d dimension(s) on the %s dissimilarity%s; stress = %.3f (%s), and %d of %d starts reached it." % (
            n, k, _metric_name(met), ("" if transform == "none" else " after the %s transformation" % _TRANSFORMS[transform]),
            stress, quality, converged, tries),
        "assumptions": [
            "NMDS uses only the rank order of the dissimilarities, so the axes have no units and their scale is arbitrary — only the relative positions mean anything.",
            "Stress-1 %.3f: %s (Clarke 1993 — < 0.1 good, < 0.2 usable, > 0.3 close to arbitrary)." % (stress, quality),
            "Distance: %s%s." % (_metric_name(met), "" if transform == "none" else "; data %s first" % _TRANSFORMS[transform]),
            "The fit can settle in a local minimum, so it is restarted %d times (seed %d) and the lowest-stress solution kept; %d start(s) reached it." % (tries, seed, converged),
            "The solution is centred and rotated to principal axes, so NMDS1 carries the widest spread.",
        ],
        "cite": "Non-metric multidimensional scaling (Kruskal 1964) of %d cases on the %s dissimilarity, %d random starts." % (n, _metric_name(met), tries),
    }


_CA_SCALINGS = {"symmetric", "sites", "species"}


def ca(data):
    """Correspondence analysis (CA) — the ordination for a table of counts. It decomposes
    the chi-square distances between the rows' profiles (and the columns'), so sites and
    species land in one picture: a site sits near the species it is rich in. Unlike PCA it
    assumes unimodal responses along a gradient rather than linear ones, which is what an
    abundance table usually shows. Reports the inertia (chi-square variance) each axis
    carries, plus the row and column coordinates. Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "Correspondence analysis")
    n, p = int(M.shape[0]), int(M.shape[1])
    scaling = str(d.get("scaling", "symmetric")).lower()
    if scaling not in _CA_SCALINGS:
        raise StatsError("bad_request", "unknown CA scaling \"%s\"" % scaling)
    if np.any(M < 0):
        raise StatsError("bad_request", "Correspondence analysis needs non-negative counts")
    grand = float(M.sum())
    if grand <= 0:
        raise StatsError("bad_request", "Correspondence analysis needs a non-empty table")
    P = M / grand
    r = P.sum(axis=1)          # row masses (site totals / grand total)
    c = P.sum(axis=0)          # column masses (species totals / grand total)
    if np.any(r <= 0):
        raise StatsError("bad_request", "every case must have at least one non-zero count (an empty site has no profile)")
    if np.any(c <= 0):
        raise StatsError("bad_request", "every variable must have at least one non-zero count (a species never seen has no profile)")
    # The matrix of standardized residuals: how far each cell is from independence, in
    # chi-square units. Its singular values are the axes' inertia.
    S = (P - np.outer(r, c)) / np.sqrt(np.outer(r, c))
    U, sv, Vt = np.linalg.svd(S, full_matrices=False)
    keep = sv > max(1e-12, float(sv[0]) * 1e-10) if sv.size else np.array([], dtype=bool)
    k = int(np.sum(keep))
    if k < 1:
        raise StatsError("bad_request", "Correspondence analysis found no axes — the table is exactly independent")
    sv = sv[:k]
    eig = sv ** 2                                   # inertia per axis
    total = float(np.sum(S ** 2))                   # total inertia = chi-square / grand total
    # Standard coordinates, then the chosen scaling. `sites` puts the rows in principal
    # coordinates (chi-square distances between sites are then the drawn distances);
    # `species` does the same for the columns; `symmetric` splits the difference, which is
    # what a joint plot of both usually wants.
    rowStd = U[:, :k] / np.sqrt(r)[:, None]
    colStd = Vt[:k, :].T / np.sqrt(c)[:, None]
    if scaling == "sites":
        rowC, colC = rowStd * sv, colStd
    elif scaling == "species":
        rowC, colC = rowStd, colStd * sv
    else:
        rowC, colC = rowStd * np.sqrt(sv), colStd * np.sqrt(sv)
    # Deterministic axis signs, applied to both families at once — flipping only one would
    # mirror the sites away from the species they belong with.
    for a in range(k):
        idx = int(np.argmax(np.abs(rowC[:, a])))
        if rowC[idx, a] < 0:
            rowC[:, a] *= -1
            colC[:, a] *= -1
    ratio = [float(e / total) for e in eig]
    axisLabels = ["CA%d" % (a + 1) for a in range(k)]
    chi2 = total * grand

    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(rowC[i, a])) for a in range(k)] for i in range(n)],
             "speciesScores": [[_r(float(colC[j, a])) for a in range(k)] for j in range(p)],
             "eigenvalues": [_r(float(e)) for e in eig],
             "explained": [_r(x) for x in ratio],
             "caseLabels": cases,
             "rowMasses": [_r(float(x)) for x in r],
             "colMasses": [_r(float(x)) for x in c],
             "scaling": scaling, "totalInertia": _r(total)}
    if group_kept is not None:
        extra["groups"] = group_kept

    return {
        "method": "ca",
        "title": "Correspondence analysis",
        "terms": [{"term": axisLabels[a], "estimate": _r(float(eig[a])),
                   "extra1": _r(ratio[a] * 100.0)} for a in range(k)],
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "axes": k,
                   "axis1_pct": _r(ratio[0] * 100.0),
                   "axis2_pct": _r(ratio[1] * 100.0) if k > 1 else None,
                   "inertia": _r(total), "chi2": _r(chi2)},
        "summary": "%d cases, %d variables; total inertia %.4f (chi-square %.1f). CA1 carries %.1f%%%s of it." % (
            n, p, total, chi2, ratio[0] * 100.0,
            (" and CA2 %.1f%%" % (ratio[1] * 100.0)) if k > 1 else ""),
        "assumptions": [
            "CA is descriptive (no p-values): it decomposes the chi-square distances between the row profiles, so it assumes counts (or another non-negative measure on one common scale).",
            "Sites and species share the axes: a site sits near the species it is relatively rich in — the joint plot is the point of the method.",
            "Scaling \"%s\": %s." % (scaling, {
                "sites": "rows in principal coordinates, so the distances between sites are the chi-square distances",
                "species": "columns in principal coordinates, so the distances between species are the chi-square ones",
                "symmetric": "both families scaled by the square root of the inertia — the usual choice when both are read together",
            }[scaling]),
            "A strong single gradient can produce the arch (horseshoe) effect: axis 2 is then a curved artefact of axis 1, not a second gradient.",
        ],
        "cite": "Correspondence analysis (Hill 1973) of a %d x %d table; total inertia %.4f." % (n, p, total),
    }


# ── Ordination: the direct (constrained) half ────────────────────────────────────
# Everything above is unconstrained: the axes come from the response data alone and any
# environmental meaning is read into them afterwards. A constrained ordination forces the
# axes to be linear combinations of the explanatory variables, so the picture answers "how
# much of this community is explained by these measurements, and which of them matter".


def _explanatory_matrix(np, d, n_rows, mask):
    """The explanatory block, aligned to the rows the response kept. Categorical columns are
    expanded to indicator (dummy) columns, one per level after the first, so a factor can
    constrain an ordination the way it does in a regression."""
    raw = d.get("explanatory") or []
    labels = list(d.get("explanatoryLabels") or ["X%d" % (i + 1) for i in range(len(raw))])
    if not raw:
        raise StatsError("bad_request", "a constrained ordination needs at least one explanatory variable")
    cols = []
    names = []
    terms = []          # (term name, the column indices it owns) — a factor owns several
    for j, col in enumerate(raw):
        vals = list(col) + [None] * max(0, n_rows - len(col))
        numeric = []
        ok = True
        for v in vals[:n_rows]:
            if v is None or v == "":
                numeric.append(np.nan)
                continue
            try:
                numeric.append(float(v))
            except (TypeError, ValueError):
                ok = False
                break
        start = len(cols)
        if ok:
            cols.append(np.asarray(numeric, dtype=float))
            names.append(labels[j] if j < len(labels) else "X%d" % (j + 1))
        else:
            # categorical → indicator columns for every level after the first
            levels = []
            text = [("" if (v is None) else str(v)) for v in vals[:n_rows]]
            for v in text:
                if v != "" and v not in levels:
                    levels.append(v)
            if len(levels) < 2:
                raise StatsError("bad_request", "explanatory variable \"%s\" has only one level" % labels[j])
            for lv in levels[1:]:
                cols.append(np.asarray([1.0 if t == lv else (np.nan if t == "" else 0.0) for t in text], dtype=float))
                names.append("%s: %s" % (labels[j], lv))
        terms.append((labels[j] if j < len(labels) else "X%d" % (j + 1), list(range(start, len(cols)))))
    X = np.column_stack(cols) if cols else np.zeros((n_rows, 0))
    return X, names, terms


def _rda_core(np, Y, X):
    """The decomposition itself, shared by the model test and every permutation.

    Ŷ = X (XᵀX)⁻¹ XᵀY is the part of the response the explanatory block can reach; its
    principal axes are the constrained ones. What is left over decomposes into the
    unconstrained axes. Returns the two eigenvalue spectra and the fitted matrix."""
    n = Y.shape[0]
    if X.shape[1] == 0:
        fit = np.zeros_like(Y)
    else:
        coef, *_ = np.linalg.lstsq(X, Y, rcond=None)
        fit = X @ coef
    res = Y - fit
    denom = max(1, n - 1)
    sc = np.linalg.svd(fit / math.sqrt(denom), compute_uv=False)
    su = np.linalg.svd(res / math.sqrt(denom), compute_uv=False)
    return (sc ** 2), (su ** 2), fit, res


def _permutation_p(rng, perms, n, stat_of, observed):
    """The permutation p every permutation test here reports: draw `perms` rearrangements of the n cases from `rng`,
    count those whose statistic is at least the observed one, and return (count + 1) / (perms + 1) - the observed
    arrangement counts as one of the possible ones, so the smallest reachable p is 1 / (perms + 1). A statistic that
    comes back NaN for a rearrangement is not counted. Shared by the constrained ordinations' model test and
    PERMANOVA, so they draw and count the same way."""
    ge = 0
    for _ in range(perms):
        v = stat_of(rng.permutation(n))
        if v == v and v >= observed - 1e-12:
            ge += 1
    return (ge + 1) / (perms + 1)


def _pseudo_f(np, con, unc, q, n):
    """The test statistic every constrained ordination is judged by: constrained variance per
    constrained degree of freedom, over residual variance per residual degree of freedom."""
    df_res = n - q - 1
    if df_res <= 0:
        return float("nan")
    cs = float(np.sum(con))
    us = float(np.sum(unc))
    if us <= 0 or q <= 0:
        return float("inf") if cs > 0 else 0.0
    return (cs / q) / (us / df_res)


def _constrained_fit(np, d, Y, n):
    """The whole of a constrained ordination once the response geometry is settled: the
    explanatory block, the projection, the two eigenvalue spectra, LC / WA / species / env
    coordinates in the chosen scaling, and the permutation tests of the model and of each
    term entered last.

    Shared by `rda` and `dbrda` on purpose. Distance-based RDA is redundancy analysis on
    principal coordinates — the same regression, reached through a distance matrix — so this
    is the same machinery, not a second copy of it. (`cca` does not come through here: its
    regression is weighted by the row masses, which changes the centring, the projection and
    every coordinate, so it has its own core.)

    `Y` must already be centred, in whatever geometry the caller wants decomposed.
    """
    scaling = str(d.get("scaling", "symmetric")).lower()
    if scaling not in _CA_SCALINGS:
        raise StatsError("bad_request", "unknown scaling \"%s\"" % scaling)
    Xraw, xnames, xterms = _explanatory_matrix(np, d, n, None)
    if Xraw.shape[0] != n:
        raise StatsError("bad_request", "the explanatory variables must have one value per case")
    if np.isnan(Xraw).any():
        raise StatsError("bad_request", "the explanatory variables have gaps — a constrained ordination is complete-case")
    Xc = Xraw - Xraw.mean(axis=0)
    sd = Xc.std(axis=0, ddof=1)
    sd[sd == 0] = 1.0
    X = Xc / sd
    rank = int(np.linalg.matrix_rank(X)) if X.size else 0
    if rank == 0:
        raise StatsError("bad_request", "the explanatory variables are constant — there is nothing to constrain")
    if n - rank - 1 <= 0:
        raise StatsError("bad_request",
                         "too few cases for %d explanatory column(s): a constrained ordination needs more cases than constraints" % rank)

    con, unc, fit, res = _rda_core(np, Y, X)
    total = float(np.sum(con) + np.sum(unc))
    if total <= 0:
        raise StatsError("bad_request", "the response has no variance to partition")
    keep_c = min(rank, int(np.sum(con > max(1e-12, float(con[0]) * 1e-10))) if con.size else 0)
    k = max(1, keep_c)
    conEig = con[:k]
    uncEig = unc[unc > max(1e-12, (float(unc[0]) if unc.size else 0.0) * 1e-10)]
    constrained = float(np.sum(con))
    r2 = constrained / total
    # Ezekiel's adjusted R² — the unbiased share, which is what should be reported: R² rises
    # with every variable added, adjusted R² does not.
    adj = 1.0 - (1.0 - r2) * (n - 1) / max(1, (n - rank - 1))

    # ── the coordinates ──────────────────────────────────────────────────────────
    U, sv, Vt = np.linalg.svd(fit / math.sqrt(max(1, n - 1)), full_matrices=False)
    U, sv, V = U[:, :k], sv[:k], Vt[:k, :].T
    # LC = the sites placed from the explanatory variables (the fitted values' own axes);
    # WA = the same axes, but the sites placed from what was actually observed. Which to draw
    # is a live argument in the literature, so both are returned and the graph chooses.
    lc = U * sv * math.sqrt(max(1, n - 1))
    wa = Y @ V
    species = V.copy()
    if scaling == "sites":
        pass                                   # sites already in principal coordinates
    elif scaling == "species":
        lc = U * math.sqrt(max(1, n - 1))
        wa = wa / np.where(sv > 0, sv, 1.0)
        species = V * sv
    else:
        half = np.sqrt(np.where(sv > 0, sv, 1.0))
        lc = U * half * math.sqrt(max(1, n - 1))
        wa = wa / np.where(sv > 0, sv, 1.0) * half
        species = V * half
    # Environmental biplot scores: each explanatory column's correlation with the LC axes —
    # the arrow directions of a triplot.
    env = np.zeros((X.shape[1], k))
    for j in range(X.shape[1]):
        for a in range(k):
            xa, la = X[:, j], lc[:, a]
            sx, sl = float(np.std(xa)), float(np.std(la))
            env[j, a] = 0.0 if sx == 0 or sl == 0 else float(np.corrcoef(xa, la)[0, 1])
    for a in range(k):
        idx = int(np.argmax(np.abs(lc[:, a])))
        if lc[idx, a] < 0:
            lc[:, a] *= -1
            wa[:, a] *= -1
            species[:, a] *= -1
            env[:, a] *= -1

    # ── the permutation tests ────────────────────────────────────────────────────
    perms = max(99, min(int(d.get("permutations", 999)), 9999))
    seed = int(d.get("seed", 20240704))
    rng = np.random.default_rng(seed)
    fobs = _pseudo_f(np, con, unc, rank, n)

    def _f_shuffled(idx):
        c2, u2, _fit2, _res2 = _rda_core(np, Y[idx, :], X)
        return _pseudo_f(np, c2, u2, rank, n)

    pmodel = _permutation_p(rng, perms, n, _f_shuffled, fobs)

    # Per-term marginal tests: what each variable adds when it goes in last. The variable is
    # residualised against the others before it is shuffled, so the permutation respects the
    # collinearity between them (the standard treatment).
    termRows = []
    if len(xterms) > 1 or True:
        for name, idxs in xterms:
            others = [c for c in range(X.shape[1]) if c not in idxs]
            Xo = X[:, others] if others else np.zeros((n, 0))
            conO, uncO, _fitO, _resO = _rda_core(np, Y, Xo)
            addC = float(np.sum(con)) - float(np.sum(conO))
            dfT = len(idxs)
            df_res = n - rank - 1
            fT = (addC / dfT) / (float(np.sum(unc)) / df_res) if df_res > 0 and float(np.sum(unc)) > 0 else float("nan")
            # shuffle only this term's columns, keeping the others in place
            geT = 0
            for _ in range(perms):
                perm = rng.permutation(n)
                Xp = X.copy()
                Xp[:, idxs] = X[perm][:, idxs]
                cP, uP, _fitP, _resP = _rda_core(np, Y, Xp)
                conPO, _uPO, _fitPO, _resPO = _rda_core(np, Y, Xp[:, others] if others else np.zeros((n, 0)))
                addP = float(np.sum(cP)) - float(np.sum(conPO))
                fP = (addP / dfT) / (float(np.sum(uP)) / df_res) if df_res > 0 and float(np.sum(uP)) > 0 else float("nan")
                if not math.isnan(fP) and fP >= fT - 1e-12:
                    geT += 1
            termRows.append({"term": name, "estimate": _r(addC / total), "statistic": _r(fT),
                             "p": _r((geT + 1) / (perms + 1)), "df": dfT})
    return {
        "X": X, "xnames": xnames, "rank": rank,
        "con": con, "unc": unc, "conEig": conEig, "uncEig": uncEig, "k": k,
        "total": total, "constrained": constrained, "r2": r2, "adj": adj,
        "lc": lc, "wa": wa, "species": species, "env": env,
        "fobs": fobs, "pmodel": pmodel, "perms": perms, "seed": seed,
        "termRows": termRows, "scaling": scaling,
    }


def rda(data):
    """Redundancy analysis (RDA) — a constrained ordination, the "direct gradient analysis"
    of the ecology literature. Where PCA finds the axes of the response data alone, this
    forces the axes to be linear combinations of the explanatory variables, so it answers how
    much of the response those variables explain and which of them carry it. Reports the
    constrained and unconstrained eigenvalues, the share of variance constrained (with
    Ezekiel's adjusted R²), a permutation test of the whole model and of each term, and both
    ways of placing the sites: LC (fitted, from the explanatory variables) and WA (weighted
    averages of the observed responses). Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "Redundancy analysis")
    n, p = int(M.shape[0]), int(M.shape[1])
    transform = str(d.get("transform", "none")).lower()
    Yt = _transform_community(np, M, transform)
    Y = Yt - Yt.mean(axis=0)
    if float(np.max(np.abs(Y))) == 0:
        raise StatsError("bad_request", "every response value is identical — there is nothing to explain")

    fit = _constrained_fit(np, d, Y, n)
    X, xnames, rank = fit["X"], fit["xnames"], fit["rank"]
    conEig, uncEig, k = fit["conEig"], fit["uncEig"], fit["k"]
    total, constrained, r2, adj = fit["total"], fit["constrained"], fit["r2"], fit["adj"]
    lc, wa, species, env = fit["lc"], fit["wa"], fit["species"], fit["env"]
    fobs, pmodel, perms, seed = fit["fobs"], fit["pmodel"], fit["perms"], fit["seed"]
    termRows, scaling = fit["termRows"], fit["scaling"]

    axisLabels = ["RDA%d" % (a + 1) for a in range(k)]
    ratio = [float(v / total) for v in conEig]
    conShare = [float(v / constrained) if constrained > 0 else 0.0 for v in conEig]

    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(lc[i, a])) for a in range(k)] for i in range(n)],
             "lcScores": [[_r(float(lc[i, a])) for a in range(k)] for i in range(n)],
             "waScores": [[_r(float(wa[i, a])) for a in range(k)] for i in range(n)],
             "speciesScores": [[_r(float(species[j, a])) for a in range(k)] for j in range(p)],
             "envScores": [[_r(float(env[j, a])) for a in range(k)] for j in range(X.shape[1])],
             "envLabels": xnames,
             "eigenvalues": [_r(float(v)) for v in conEig],
             "explained": [_r(x) for x in ratio],
             "constrainedShare": [_r(x) for x in conShare],
             "unconstrainedEigenvalues": [_r(float(v)) for v in uncEig[:10]],
             "caseLabels": cases,
             "constrained": _r(constrained), "totalVariance": _r(total),
             "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
             "permutations": perms, "scaling": scaling, "transform": transform,
             "siteScores": "lc"}
    if group_kept is not None:
        extra["groups"] = group_kept

    terms = [{"term": "Constrained (model)", "estimate": _r(r2), "statistic": _r(fobs), "p": _r(pmodel), "df": rank}]
    terms += termRows
    terms += [{"term": axisLabels[a], "estimate": _r(float(conEig[a])), "extra1": _r(ratio[a] * 100.0)} for a in range(k)]

    return {
        "method": "rda",
        "title": "Redundancy analysis (RDA)",
        "terms": terms,
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "explanatory": X.shape[1], "axes": k,
                   "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
                   "axis1_pct": _r(ratio[0] * 100.0),
                   "axis2_pct": _r(ratio[1] * 100.0) if k > 1 else None},
        "summary": "%d cases, %d response variables constrained by %d explanatory column(s): %.1f%% of the variance is explained (adjusted %.1f%%), pseudo-F = %.3f, p = %s (%d permutations)." % (
            n, p, X.shape[1], r2 * 100.0, adj * 100.0, fobs, ("%.4g" % pmodel), perms),
        "assumptions": [
            "RDA is a constrained ordination: the axes are linear combinations of the explanatory variables, so it measures what those variables explain — not the response's own main axes.",
            "The response is centred%s; the explanatory variables are centred and scaled, and a categorical one is expanded to indicator columns." % (
                "" if transform == "none" else " after the %s transformation" % _TRANSFORMS[transform]),
            "Significance is by permutation (%d rearrangements, seed %d): p = (r + 1) / (permutations + 1), so the smallest p reachable here is %s." % (
                perms, seed, ("%.4g" % (1.0 / (perms + 1)))),
            "Each term is tested marginally — what it adds when entered last, with the variable residualised against the others before shuffling, so collinearity is respected.",
            "Adjusted R² (Ezekiel) is the one to report: R² rises with every variable added, adjusted R² does not.",
            "Per-axis permutation tests are not offered: testing the axes one after another has more than one convention, and they give different p-values, so only the whole model and each term are tested.",
        ],
        "cite": "Redundancy analysis (Rao 1964) of %d response variables on %d explanatory column(s); %d permutations." % (p, X.shape[1], perms),
    }


def _permanova_f(np, D2, codes, a, n):
    """Anderson's (2001) pseudo-F from squared dissimilarities: SS_total = sum over pairs of d^2 / n, SS_within = sum
    over groups of (sum over pairs in the group of d^2) / n_group, SS_between = SS_total - SS_within;
    F = (SS_between / (a - 1)) / (SS_within / (n - a)). Returns (F, SS_between, SS_within, SS_total)."""
    iu = np.triu_indices(n, 1)
    ss_t = float(np.sum(D2[iu])) / n
    ss_w = 0.0
    for g in range(a):
        idx = np.flatnonzero(codes == g)
        m = idx.size
        if m > 1:
            block = D2[np.ix_(idx, idx)]
            ss_w += float(np.sum(block[np.triu_indices(m, 1)])) / m
    ss_b = ss_t - ss_w
    if ss_w > 0 and n > a:
        f = (ss_b / (a - 1)) / (ss_w / (n - a))
    else:
        f = float("inf") if ss_b > 0 else float("nan")
    return f, ss_b, ss_w, ss_t


def permanova(data):
    """PERMANOVA (Anderson 2001): do groups of cases differ in their multivariate position, judged on a chosen
    dissimilarity? Pseudo-F from the squared distances, significance by permuting the group labels. Reported with
    PERMDISP (Anderson 2006): each case's distance to its group centroid in the space the dissimilarity defines,
    compared across groups by one-way ANOVA - PERMANOVA cannot tell a difference in location from a difference in
    spread, and a significant result with unequal spread is ambiguous. Complete-case."""
    np, stats = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "PERMANOVA")
    if group_kept is None:
        raise StatsError("bad_request", "PERMANOVA compares groups - choose the column that says which group each case is in.")
    n = int(M.shape[0])
    names = sorted(set(group_kept), key=lambda g: group_kept.index(g))
    a = len(names)
    if a < 2:
        raise StatsError("bad_request", "PERMANOVA needs at least 2 groups (found %d)." % a)
    if n - a < 1:
        raise StatsError("bad_request", "PERMANOVA needs more cases than groups (%d cases, %d groups)." % (n, a))
    sizes = [group_kept.count(g) for g in names]
    codes = np.array([names.index(g) for g in group_kept])

    metric_in = str(d.get("metric", "euclidean") or "euclidean").lower()
    transform = str(d.get("transform", "none")).lower()
    W = _transform_community(np, M, transform)
    # Euclidean on z-scores by default: the same geometry as a standardised PCA's score plot, which is where the
    # groups this tests are looked at.
    standardize = bool(d.get("standardize", metric_in in ("euclidean", "l2")))
    if standardize:
        sd = W.std(axis=0, ddof=1)
        if np.any(sd == 0):
            j = int(np.flatnonzero(sd == 0)[0])
            raise StatsError("bad_request", "variable '%s' is constant, so it cannot be standardised" % labels[j])
        W = (W - W.mean(axis=0)) / sd
    D, met = _dissimilarity(np, W, metric_in)
    D2 = D ** 2

    fobs, ss_b, ss_w, ss_t = _permanova_f(np, D2, codes, a, n)
    perms = max(99, min(int(d.get("permutations", 999)), 9999))
    seed = int(d.get("seed", 20240704))
    rng = np.random.default_rng(seed)
    p = _permutation_p(rng, perms, n, lambda idx: _permanova_f(np, D2, codes[idx], a, n)[0], fobs)
    r2 = ss_b / ss_t if ss_t > 0 else float("nan")
    df_b, df_w = a - 1, n - a

    # PERMDISP: Gower-centred PCoA of the same dissimilarities, the negative axes kept as imaginary (as vegan's
    # betadisper does), each case's distance to its group centroid, one-way ANOVA on those distances.
    A = -0.5 * D2
    J = np.eye(n) - np.ones((n, n)) / n
    G = J @ A @ J
    vals, vecs = np.linalg.eigh((G + G.T) / 2.0)
    keep = np.abs(vals) > max(1e-9, float(np.max(np.abs(vals))) * 1e-10)
    vals, vecs = vals[keep], vecs[:, keep]
    X = vecs * np.sqrt(np.abs(vals))
    sign = np.where(vals > 0, 1.0, -1.0)
    z = np.zeros(n)
    spread = []
    for g in range(a):
        idx = np.flatnonzero(codes == g)
        c = X[idx].mean(axis=0)
        sq = ((X[idx] - c) ** 2) @ sign
        z[idx] = np.sqrt(np.maximum(sq, 0.0))
        spread.append(float(np.mean(z[idx])))
    disp_f = disp_p = None
    if float(np.var(z)) > 0:
        fz, pz = stats.f_oneway(*[z[codes == g] for g in range(a)])
        if fz == fz:
            disp_f, disp_p = float(fz), float(pz)

    terms = [
        {"term": "Groups", "df": df_b, "estimate": _r(r2), "statistic": _r(fobs), "p": _r(p),
         "ss": _r(ss_b), "ms": _r(ss_b / df_b)},
        {"term": "Residual", "df": df_w, "ss": _r(ss_w), "ms": _r(ss_w / df_w)},
        {"term": "Total", "df": n - 1, "ss": _r(ss_t)},
    ]
    terms += [{"term": "Spread: %s (mean distance to centroid)" % names[g], "estimate": _r(spread[g]), "n": sizes[g]}
              for g in range(a)]
    terms.append({"term": "PERMDISP (equal spread?)", "statistic": _r(disp_f), "p": _r(disp_p), "df": "%d, %d" % (df_b, df_w)})

    if p < 0.05 and disp_p is not None and disp_p < 0.05:
        reading = ("the groups differ, but so does their spread (PERMDISP p = %.4g), so the difference may be in "
                   "dispersion rather than in position" % disp_p)
    elif p < 0.05:
        reading = "the groups differ in position; their spread does not differ significantly (PERMDISP p = %s)" % (
            ("%.4g" % disp_p) if disp_p is not None else "not computable")
    else:
        reading = "no significant difference between the groups"
    summary = "PERMANOVA on %s distance, %d groups, %d cases: pseudo-F(%d, %d) = %.4g, R² = %.3g, p = %s (%d permutations) — %s." % (
        _metric_name(met), a, n, df_b, df_w, fobs, r2, "%.4g" % p, perms, reading)
    assum = [
        "Cases are exchangeable under the null hypothesis of no group difference (the group labels are permuted).",
        "PERMANOVA responds to differences in position and in spread; PERMDISP is reported so the two can be told apart.",
        "Distance: %s%s%s." % (_metric_name(met), "; variables standardised (z-scores) first" if standardize else "",
                                ("; transform: %s" % _TRANSFORMS.get(transform, transform)) if transform != "none" else ""),
    ]
    if min(sizes) < 3:
        assum.append("A group has fewer than 3 cases; the test has little power there.")
    return {
        "method": "permanova",
        "title": "PERMANOVA — %s distance" % _metric_name(met),
        "terms": terms,
        "glance": {"pseudoF": _r(fobs), "p": _r(p), "r2": _r(r2), "groups": a, "n": n, "df_groups": df_b, "df_resid": df_w,
                   "permutations": perms, "seed": seed, "disp_F": _r(disp_f), "disp_p": _r(disp_p), "metric": met},
        "summary": summary,
        "assumptions": assum,
        "cite": "PERMANOVA (Anderson 2001) with %d permutations; PERMDISP (Anderson 2006) on %s distances." % (perms, _metric_name(met)),
    }


def dbrda(data):
    """Distance-based redundancy analysis (db-RDA / capscale) — a constrained ordination on
    any dissimilarity. RDA is a regression in Euclidean space, which is the wrong space for a
    species matrix: the ecologist's Bray-Curtis is not a Euclidean distance. This runs PCoA
    first, turning the chosen dissimilarity into coordinates, and then redundancy analysis on
    those — so a Bray-Curtis (or Jaccard, or any other) community can be constrained by
    explanatory variables. Reports the same things RDA does, from the same machinery.
    Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "Distance-based RDA")
    n, p = int(M.shape[0]), int(M.shape[1])
    transform = str(d.get("transform", "none")).lower()
    W = _transform_community(np, M, transform)
    D, met = _dissimilarity(np, W, d.get("metric", "braycurtis"))

    # PCoA: the dissimilarities become coordinates whose Euclidean distances reproduce them.
    A = -0.5 * (D ** 2)
    J = np.eye(n) - np.ones((n, n)) / n
    G = J @ A @ J
    G = (G + G.T) / 2.0
    vals, vecs = np.linalg.eigh(G)
    order = np.argsort(vals)[::-1]
    vals, vecs = vals[order], vecs[:, order]
    pos = vals > max(1e-9, float(np.max(np.abs(vals))) * 1e-12)
    kpos = int(np.sum(pos))
    if kpos < 1:
        raise StatsError("bad_request", "these dissimilarities carry no structure to constrain")
    # The negative axes are dropped, not corrected. A non-Euclidean dissimilarity has them by
    # definition, and there is no valid way to regress on an imaginary coordinate; vegan's
    # capscale drops them the same way. The count is reported so nobody has to guess how much
    # was set aside.
    negcount = int(np.sum(vals < -1e-9))
    negshare = float(-np.sum(vals[vals < 0]) / np.sum(vals[pos])) if kpos else 0.0
    Y = vecs[:, :kpos] * np.sqrt(vals[:kpos])       # centred by construction (Gower centring)

    fit = _constrained_fit(np, d, Y, n)
    X, xnames, rank = fit["X"], fit["xnames"], fit["rank"]
    conEig, uncEig, k = fit["conEig"], fit["uncEig"], fit["k"]
    total, constrained, r2, adj = fit["total"], fit["constrained"], fit["r2"], fit["adj"]
    lc, wa, env = fit["lc"], fit["wa"], fit["env"]
    fobs, pmodel, perms, seed = fit["fobs"], fit["pmodel"], fit["perms"], fit["seed"]
    termRows, scaling = fit["termRows"], fit["scaling"]

    # Species are not in the model here. The response is a distance matrix, so the columns have
    # no loadings; they are placed by weighted averaging onto the drawn axes, exactly as PCoA
    # and NMDS place them — positions, never a biplot arrow (`ordinationGraphPlan` keeps the
    # loadings plot and the biplot off this method for that reason).
    species = _wascores(np, wa, W) if bool(np.all(W >= 0)) else None

    axisLabels = ["dbRDA%d" % (a + 1) for a in range(k)]
    ratio = [float(v / total) for v in conEig]
    conShare = [float(v / constrained) if constrained > 0 else 0.0 for v in conEig]

    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(wa[i, a])) for a in range(k)] for i in range(n)],
             "lcScores": [[_r(float(lc[i, a])) for a in range(k)] for i in range(n)],
             "waScores": [[_r(float(wa[i, a])) for a in range(k)] for i in range(n)],
             "envScores": [[_r(float(env[j, a])) for a in range(k)] for j in range(X.shape[1])],
             "envLabels": xnames,
             "eigenvalues": [_r(float(v)) for v in conEig],
             "explained": [_r(x) for x in ratio],
             "constrainedShare": [_r(x) for x in conShare],
             "unconstrainedEigenvalues": [_r(float(v)) for v in uncEig[:10]],
             "caseLabels": cases,
             "constrained": _r(constrained), "totalVariance": _r(total),
             "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
             "permutations": perms, "scaling": scaling, "transform": transform,
             "metric": met, "negativeEigenvalues": negcount,
             "siteScores": "wa"}
    if species is not None:
        extra["speciesScores"] = [[_r(float(species[j, a])) for a in range(k)] for j in range(p)]
    if group_kept is not None:
        extra["groups"] = group_kept

    terms = [{"term": "Constrained (model)", "estimate": _r(r2), "statistic": _r(fobs), "p": _r(pmodel), "df": rank}]
    terms += termRows
    terms += [{"term": axisLabels[a], "estimate": _r(float(conEig[a])), "extra1": _r(ratio[a] * 100.0)} for a in range(k)]

    warn = []
    if negcount:
        warn.append(
            "%d negative eigenvalue(s) (%.1f%% of the retained variation): the %s dissimilarity is not Euclidean, "
            "so those axes cannot be represented and are dropped before the regression." % (negcount, negshare * 100.0, _metric_name(met)))

    return {
        "method": "dbrda",
        "title": "Distance-based redundancy analysis (db-RDA)",
        "terms": terms,
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "explanatory": X.shape[1], "axes": k,
                   "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
                   "axis1_pct": _r(ratio[0] * 100.0),
                   "axis2_pct": _r(ratio[1] * 100.0) if k > 1 else None,
                   "negativeEigenvalues": negcount},
        "summary": "%d cases on the %s dissimilarity, constrained by %d explanatory column(s): %.1f%% of the variation is explained (adjusted %.1f%%), pseudo-F = %.3f, p = %s (%d permutations)." % (
            n, _metric_name(met), X.shape[1], r2 * 100.0, adj * 100.0, fobs, ("%.4g" % pmodel), perms),
        "assumptions": [
            "db-RDA is RDA on principal coordinates: the %s dissimilarity is turned into coordinates first, then the axes are forced to be linear combinations of the explanatory variables. Use it when the distance you care about is not Euclidean." % _metric_name(met),
            "Distance: %s%s." % (_metric_name(met), "" if transform == "none" else "; data %s first" % _TRANSFORMS[transform]),
            "Significance is by permutation (%d rearrangements, seed %d): p = (r + 1) / (permutations + 1), so the smallest p reachable here is %s." % (
                perms, seed, ("%.4g" % (1.0 / (perms + 1)))),
            "Each term is tested marginally — what it adds when entered last, with the variable residualised against the others before shuffling, so collinearity is respected.",
            "Adjusted R2 (Ezekiel) is the one to report: R2 rises with every variable added, adjusted R2 does not.",
            "The variables are placed by weighted averaging (a variable sits at the centre of the cases it is abundant in). They are positions, not loadings — a distance matrix gives the columns no direction, so this method draws no variable arrows.",
            "Per-axis permutation tests are not offered: testing the axes one after another has more than one convention, and they give different p-values, so only the whole model and each term are tested.",
        ] + warn,
        "cite": "Distance-based redundancy analysis (Legendre & Anderson 1999) on the %s dissimilarity of %d cases; %d permutations." % (_metric_name(met), n, perms),
    }


def _cca_core(np, Qbar, Xw):
    """CCA's projection, shared by the model test and every permutation.

    Not `_rda_core`. Both matrices here already carry the sqrt(row-mass) weighting, so an
    ordinary least-squares fit in this space is the weighted least-squares fit in the original
    one — that is the whole trick, and it is why the two cores cannot be merged: RDA divides by
    sqrt(n - 1) to get a variance, CCA does not (its total is the table's inertia)."""
    if Xw.shape[1] == 0:
        fit = np.zeros_like(Qbar)
    else:
        coef, *_ = np.linalg.lstsq(Xw, Qbar, rcond=None)
        fit = Xw @ coef
    res = Qbar - fit
    sc = np.linalg.svd(fit, compute_uv=False)
    su = np.linalg.svd(res, compute_uv=False)
    return (sc ** 2), (su ** 2), fit, res


def _weight_center(np, X, w):
    """Centre and scale X by the row masses `w` (which sum to 1) — the weighted analogue of
    what a constrained ordination does to its explanatory block. A constant column keeps a
    scale of 1 rather than dividing by zero."""
    mu = w @ X
    Xc = X - mu
    var = w @ (Xc ** 2)
    sd = np.sqrt(np.where(var > 0, var, 1.0))
    return Xc / sd


def cca(data):
    """Canonical correspondence analysis (CCA) — the constrained form of correspondence
    analysis, and the standard direct gradient analysis for count data. CA finds a community's
    own axes; this forces them to be linear combinations of the explanatory variables, in the
    chi-square geometry CA uses (so sites carry their row masses and unimodal responses are
    assumed). Reports the constrained and unconstrained inertia, the share explained, a
    permutation test of the model and of each term, both LC and WA site placements, and the
    species positions. Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "Canonical correspondence analysis")
    n, p = int(M.shape[0]), int(M.shape[1])
    scaling = str(d.get("scaling", "symmetric")).lower()
    if scaling not in _CA_SCALINGS:
        raise StatsError("bad_request", "unknown scaling \"%s\"" % scaling)
    if np.any(M < 0):
        raise StatsError("bad_request", "Canonical correspondence analysis needs non-negative counts")
    grand = float(M.sum())
    if grand <= 0:
        raise StatsError("bad_request", "Canonical correspondence analysis needs a non-empty table")
    P = M / grand
    r = P.sum(axis=1)
    c = P.sum(axis=0)
    if np.any(r <= 0):
        raise StatsError("bad_request", "every case must have at least one non-zero count (an empty site has no profile)")
    if np.any(c <= 0):
        raise StatsError("bad_request", "every variable must have at least one non-zero count (a species never seen has no profile)")
    # Exactly CA's matrix of standardized residuals — the chi-square geometry, entered here
    # rather than re-derived, so a CCA whose constraints span the site space is a CA.
    Qbar = (P - np.outer(r, c)) / np.sqrt(np.outer(r, c))
    total = float(np.sum(Qbar ** 2))
    if total <= 0:
        raise StatsError("bad_request", "the table is exactly independent — there is no inertia to constrain")

    Xraw, xnames, xterms = _explanatory_matrix(np, d, n, None)
    if Xraw.shape[0] != n:
        raise StatsError("bad_request", "the explanatory variables must have one value per case")
    if np.isnan(Xraw).any():
        raise StatsError("bad_request", "the explanatory variables have gaps — a constrained ordination is complete-case")
    Xs = _weight_center(np, Xraw, r)
    sw = np.sqrt(r)[:, None]
    Xw = sw * Xs
    rank = int(np.linalg.matrix_rank(Xw)) if Xw.size else 0
    if rank == 0:
        raise StatsError("bad_request", "the explanatory variables are constant — there is nothing to constrain")
    if n - rank - 1 <= 0:
        raise StatsError("bad_request",
                         "too few cases for %d explanatory column(s): a constrained ordination needs more cases than constraints" % rank)

    con, unc, cfit, _res = _cca_core(np, Qbar, Xw)
    keep_c = min(rank, int(np.sum(con > max(1e-12, float(con[0]) * 1e-10))) if con.size else 0)
    k = max(1, keep_c)
    conEig = con[:k]
    uncEig = unc[unc > max(1e-12, (float(unc[0]) if unc.size else 0.0) * 1e-10)]
    constrained = float(np.sum(con))
    r2 = constrained / total
    adj = 1.0 - (1.0 - r2) * (n - 1) / max(1, (n - rank - 1))

    U, sv, Vt = np.linalg.svd(cfit, full_matrices=False)
    U, sv, V = U[:, :k], sv[:k], Vt[:k, :].T
    inv = np.where(sv > 0, sv, 1.0)
    # Standard coordinates, in CA's own units: divide the mass weighting back out of the
    # singular vectors. LC = sites from the fitted values; WA = the same axes with the sites
    # placed from the observed table (the weighted average of the species scores).
    lcStd = U / np.sqrt(r)[:, None]
    waStd = (Qbar @ V / inv) / np.sqrt(r)[:, None]
    spStd = V / np.sqrt(c)[:, None]
    if scaling == "sites":
        lc, wa, species = lcStd * sv, waStd * sv, spStd
    elif scaling == "species":
        lc, wa, species = lcStd, waStd, spStd * sv
    else:
        half = np.sqrt(sv)
        lc, wa, species = lcStd * half, waStd * half, spStd * half
    # Environment arrows: each explanatory column's mass-weighted correlation with the LC axes.
    env = np.zeros((Xw.shape[1], k))
    for j in range(Xw.shape[1]):
        for a in range(k):
            xa = Xs[:, j]
            la = lc[:, a] - float(r @ lc[:, a])
            vx = float(r @ (xa ** 2))
            vl = float(r @ (la ** 2))
            env[j, a] = 0.0 if vx <= 0 or vl <= 0 else float((r @ (xa * la)) / math.sqrt(vx * vl))
    for a in range(k):
        idx = int(np.argmax(np.abs(lc[:, a])))
        if lc[idx, a] < 0:
            lc[:, a] *= -1
            wa[:, a] *= -1
            species[:, a] *= -1
            env[:, a] *= -1

    # ── permutation tests ────────────────────────────────────────────────────────
    # The rows of X are shuffled, not the rows of the table (which is what `rda` does). A
    # site's mass is part of its community data here, so moving the table under fixed masses
    # would break the geometry the test is about. Shuffling the explanatory block instead
    # tests exactly the same null and keeps every site's mass welded to its own counts.
    perms = max(99, min(int(d.get("permutations", 999)), 9999))
    seed = int(d.get("seed", 20240704))
    rng = np.random.default_rng(seed)
    fobs = _pseudo_f(np, con, unc, rank, n)
    ge = 0
    for _ in range(perms):
        idx = rng.permutation(n)
        c2, u2, _f2, _r2m = _cca_core(np, Qbar, sw * _weight_center(np, Xraw[idx, :], r))
        if _pseudo_f(np, c2, u2, rank, n) >= fobs - 1e-12:
            ge += 1
    pmodel = (ge + 1) / (perms + 1)

    termRows = []
    df_res = n - rank - 1
    for name, idxs in xterms:
        others = [j for j in range(Xw.shape[1]) if j not in idxs]
        Xo = Xw[:, others] if others else np.zeros((n, 0))
        conO, _uncO, _fO, _rO = _cca_core(np, Qbar, Xo)
        addC = constrained - float(np.sum(conO))
        dfT = len(idxs)
        fT = (addC / dfT) / (float(np.sum(unc)) / df_res) if df_res > 0 and float(np.sum(unc)) > 0 else float("nan")
        geT = 0
        for _ in range(perms):
            perm = rng.permutation(n)
            Xp = Xraw.copy()
            Xp[:, idxs] = Xraw[perm][:, idxs]
            Xpw = sw * _weight_center(np, Xp, r)
            cP, uP, _fP, _rP = _cca_core(np, Qbar, Xpw)
            conPO, _uPO, _fPO, _rPO = _cca_core(np, Qbar, Xpw[:, others] if others else np.zeros((n, 0)))
            addP = float(np.sum(cP)) - float(np.sum(conPO))
            fP = (addP / dfT) / (float(np.sum(uP)) / df_res) if df_res > 0 and float(np.sum(uP)) > 0 else float("nan")
            if not math.isnan(fP) and fP >= fT - 1e-12:
                geT += 1
        termRows.append({"term": name, "estimate": _r(addC / total), "statistic": _r(fT),
                         "p": _r((geT + 1) / (perms + 1)), "df": dfT})

    axisLabels = ["CCA%d" % (a + 1) for a in range(k)]
    ratio = [float(v / total) for v in conEig]
    conShare = [float(v / constrained) if constrained > 0 else 0.0 for v in conEig]

    extra = {"varLabels": labels, "pcLabels": axisLabels,
             "scores": [[_r(float(wa[i, a])) for a in range(k)] for i in range(n)],
             "lcScores": [[_r(float(lc[i, a])) for a in range(k)] for i in range(n)],
             "waScores": [[_r(float(wa[i, a])) for a in range(k)] for i in range(n)],
             "speciesScores": [[_r(float(species[j, a])) for a in range(k)] for j in range(p)],
             "envScores": [[_r(float(env[j, a])) for a in range(k)] for j in range(Xw.shape[1])],
             "envLabels": xnames,
             "eigenvalues": [_r(float(v)) for v in conEig],
             "explained": [_r(x) for x in ratio],
             "constrainedShare": [_r(x) for x in conShare],
             "unconstrainedEigenvalues": [_r(float(v)) for v in uncEig[:10]],
             "caseLabels": cases,
             "rowMasses": [_r(float(x)) for x in r],
             "colMasses": [_r(float(x)) for x in c],
             "constrained": _r(constrained), "totalVariance": _r(total), "totalInertia": _r(total),
             "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
             "permutations": perms, "scaling": scaling, "siteScores": "wa"}
    if group_kept is not None:
        extra["groups"] = group_kept

    terms = [{"term": "Constrained (model)", "estimate": _r(r2), "statistic": _r(fobs), "p": _r(pmodel), "df": rank}]
    terms += termRows
    terms += [{"term": axisLabels[a], "estimate": _r(float(conEig[a])), "extra1": _r(ratio[a] * 100.0)} for a in range(k)]

    return {
        "method": "cca",
        "title": "Canonical correspondence analysis (CCA)",
        "terms": terms,
        "extra": {"ordination": extra},
        "glance": {"cases": n, "variables": p, "explanatory": Xw.shape[1], "axes": k,
                   "r2": _r(r2), "adjR2": _r(adj), "pseudoF": _r(fobs), "p": _r(pmodel),
                   "axis1_pct": _r(ratio[0] * 100.0),
                   "axis2_pct": _r(ratio[1] * 100.0) if k > 1 else None,
                   "inertia": _r(total)},
        "summary": "%d cases, %d variables, total inertia %.4f: %d explanatory column(s) constrain %.1f%% of it (adjusted %.1f%%), pseudo-F = %.3f, p = %s (%d permutations)." % (
            n, p, total, Xw.shape[1], r2 * 100.0, adj * 100.0, fobs, ("%.4g" % pmodel), perms),
        "assumptions": [
            "CCA is correspondence analysis constrained by the explanatory variables: the axes are linear combinations of them, in the chi-square geometry — so it needs counts (or another non-negative measure on one common scale) and assumes unimodal responses along a gradient.",
            "Sites carry their row masses: a site with more counts weighs more, in the fit and in every correlation reported here. That is what makes this CCA and not an RDA on transformed data.",
            "Significance is by permutation (%d rearrangements, seed %d) — the explanatory block is shuffled, so each site keeps its own counts and its own mass: p = (r + 1) / (permutations + 1), and the smallest p reachable here is %s." % (
                perms, seed, ("%.4g" % (1.0 / (perms + 1)))),
            "Each term is tested marginally — what it adds when entered last, with the variable residualised against the others before shuffling, so collinearity is respected.",
            "Adjusted R2 (Ezekiel) is the one to report: R2 rises with every variable added, adjusted R2 does not.",
            "Scaling \"%s\": %s." % (scaling, {
                "sites": "sites in principal coordinates, so the distances between sites are the chi-square distances",
                "species": "species in principal coordinates, so the distances between species are the chi-square ones",
                "symmetric": "both families scaled by the square root of the inertia — the usual choice when both are read together",
            }[scaling]),
            "Per-axis permutation tests are not offered: testing the axes one after another has more than one convention, and they give different p-values, so only the whole model and each term are tested.",
        ],
        "cite": "Canonical correspondence analysis (ter Braak 1986) of a %d x %d table constrained by %d explanatory column(s); %d permutations." % (n, p, Xw.shape[1], perms),
    }


def _std_block(np, X):
    """Centre and unit-scale an explanatory block, leaving a constant column alone."""
    Xc = X - X.mean(axis=0)
    sd = Xc.std(axis=0, ddof=1)
    sd[sd == 0] = 1.0
    return Xc / sd


def _adj_r2(np, Y, X, n):
    """Ezekiel's adjusted R² of the redundancy analysis of `Y` on `X`.

    Adjusted, and that is the whole method. Raw R² rises with every column added, so the
    fractions built from raw R² would credit a block simply for being wide — Peres-Neto et al.
    (2006) showed the bias is large enough to reverse which block looks important. An empty
    block explains nothing, by definition."""
    if X.size == 0 or X.shape[1] == 0:
        return 0.0, 0
    rank = int(np.linalg.matrix_rank(X))
    if rank == 0:
        return 0.0, 0
    if n - rank - 1 <= 0:
        raise StatsError("bad_request",
                         "too few cases for %d explanatory column(s) taken together: variance partitioning needs more cases than constraints" % rank)
    con, unc, _fit, _res = _rda_core(np, Y, X)
    total = float(np.sum(con) + np.sum(unc))
    if total <= 0:
        raise StatsError("bad_request", "the response has no variance to partition")
    r2 = float(np.sum(con)) / total
    return 1.0 - (1.0 - r2) * (n - 1) / (n - rank - 1), rank


def _partial_test(np, Y, X, C, n, perms, rng):
    """Test one unique fraction: the RDA of Y on X with block `C` held constant (a partial
    redundancy analysis). Both the response and the tested block are residualised on `C`
    first, which is what "unique to X" means, and the residual degrees of freedom pay for the
    conditioning columns as well.

    Only the unique fractions can be tested this way. A shared fraction is not the fit of any
    model — it is a difference between two of them — so there is no statistic to permute and
    none is reported."""
    if X.shape[1] == 0:
        return float("nan"), float("nan"), 0
    qC = int(np.linalg.matrix_rank(C)) if C.size and C.shape[1] else 0
    if C.size and C.shape[1]:
        coef, *_ = np.linalg.lstsq(C, Y, rcond=None)
        Yr = Y - C @ coef
        coefX, *_ = np.linalg.lstsq(C, X, rcond=None)
        Xr = X - C @ coefX
    else:
        Yr, Xr = Y, X
    qX = int(np.linalg.matrix_rank(Xr))
    df_res = n - qX - qC - 1
    if qX == 0 or df_res <= 0:
        return float("nan"), float("nan"), qX

    def stat(Ym, Xm):
        con, unc = _rda_core(np, Ym, Xm)[:2]
        cs, us = float(np.sum(con)), float(np.sum(unc))
        if us <= 0:
            return float("inf") if cs > 0 else 0.0
        return (cs / qX) / (us / df_res)

    fobs = stat(Yr, Xr)
    ge = 0
    for _ in range(perms):
        if stat(Yr[rng.permutation(n), :], Xr) >= fobs - 1e-12:
            ge += 1
    return fobs, (ge + 1) / (perms + 1), qX


def varpart(data):
    """Variance partitioning — how much of the response each block of explanatory variables
    explains on its own, and how much they explain jointly.

    Two or three blocks (say climate, soil and space) almost always overlap: each looks
    important alone, and a single model cannot say which of them is carrying the signal. This
    runs redundancy analysis on every combination of the blocks and takes the differences, so
    the variation splits into what is unique to each block, what they share, and what nothing
    explains. Every fraction is an adjusted R² (Ezekiel), because a raw R² would reward the
    widest block. The unique fractions are tested by partial RDA; the shared ones cannot be
    tested and are reported without a p-value. Complete-case."""
    np, _ = _np_sp()
    d = data or {}
    M, labels, group_kept, cases = _community_matrix(np, d, "Variance partitioning")
    n, p = int(M.shape[0]), int(M.shape[1])
    transform = str(d.get("transform", "none")).lower()
    Yt = _transform_community(np, M, transform)
    Y = Yt - Yt.mean(axis=0)
    if float(np.max(np.abs(Y))) == 0:
        raise StatsError("bad_request", "every response value is identical — there is nothing to partition")

    # The blocks. Each arrives in the same shape a constrained ordination's single explanatory
    # block does, so `_explanatory_matrix` reads all of them — including expanding a
    # categorical column to indicator columns, which a block is entitled to contain.
    raw = []
    for key, lkey in (("explanatory", "explanatoryLabels"), ("explanatory2", "explanatoryLabels2"), ("explanatory3", "explanatoryLabels3")):
        cols = d.get(key) or []
        if cols:
            raw.append((cols, d.get(lkey) or []))
    if len(raw) < 2:
        raise StatsError("bad_request", "variance partitioning needs at least two blocks of explanatory variables — with one block there is nothing to partition")
    if len(raw) > 3:
        raise StatsError("bad_request", "variance partitioning takes at most three blocks")
    blockLabels = list(d.get("blockLabels") or [])
    while len(blockLabels) < len(raw):
        blockLabels.append("Block %s" % "ABC"[len(blockLabels)])
    blockLabels = [str(x) for x in blockLabels[:len(raw)]]

    mats, names = [], []
    for cols, labs in raw:
        X, xnames, _terms = _explanatory_matrix(np, {"explanatory": cols, "explanatoryLabels": labs}, n, None)
        if X.shape[0] != n:
            raise StatsError("bad_request", "the explanatory variables must have one value per case")
        if np.isnan(X).any():
            raise StatsError("bad_request", "the explanatory variables have gaps — variance partitioning is complete-case")
        # The rank is taken after centring, not before. A constant column is rank 1 as it
        # stands (a column of ones), so checking the raw block lets a constant one through —
        # it then contributes exactly nothing and every fraction involving it reads as a real
        # zero rather than a mistake. Centring turns it into zeros, where the rank is accurate.
        Xs = _std_block(np, X)
        if int(np.linalg.matrix_rank(Xs)) == 0:
            raise StatsError("bad_request", "block \"%s\" is constant — there is nothing to partition" % blockLabels[len(mats)])
        mats.append(Xs)
        names.append(xnames)

    k = len(mats)
    join = lambda idxs: np.column_stack([mats[i] for i in idxs]) if idxs else np.zeros((n, 0))
    adj = {}
    ranks = {}
    subsets = [(0,), (1,), (0, 1)] if k == 2 else [(0,), (1,), (2,), (0, 1), (0, 2), (1, 2), (0, 1, 2)]
    for s in subsets:
        adj[s], ranks[s] = _adj_r2(np, Y, join(list(s)), n)

    perms = max(99, min(int(d.get("permutations", 999)), 9999))
    seed = int(d.get("seed", 20240704))
    rng = np.random.default_rng(seed)

    # ── the fractions (Legendre & Legendre's algebra on the adjusted R² values) ──────────
    rows = []
    if k == 2:
        A, B, AB = adj[(0,)], adj[(1,)], adj[(0, 1)]
        frac = [
            ("[a] %s alone" % blockLabels[0], AB - B, (0,), (1,)),
            ("[b] shared", A + B - AB, None, None),
            ("[c] %s alone" % blockLabels[1], AB - A, (1,), (0,)),
        ]
        explained = AB
    else:
        A, B, C = adj[(0,)], adj[(1,)], adj[(2,)]
        AB, AC, BC, ABC = adj[(0, 1)], adj[(0, 2)], adj[(1, 2)], adj[(0, 1, 2)]
        frac = [
            ("[a] %s alone" % blockLabels[0], ABC - BC, (0,), (1, 2)),
            ("[b] %s alone" % blockLabels[1], ABC - AC, (1,), (0, 2)),
            ("[c] %s alone" % blockLabels[2], ABC - AB, (2,), (0, 1)),
            ("[d] %s ∩ %s" % (blockLabels[0], blockLabels[1]), AC + BC - C - ABC, None, None),
            ("[e] %s ∩ %s" % (blockLabels[1], blockLabels[2]), AB + AC - A - ABC, None, None),
            ("[f] %s ∩ %s" % (blockLabels[0], blockLabels[2]), AB + BC - B - ABC, None, None),
            ("[g] all three", A + B + C - AB - AC - BC + ABC, None, None),
        ]
        explained = ABC

    fractions = []
    for name, value, testX, testC in frac:
        row = {"term": name, "estimate": _r(value)}
        if testX is not None:
            f, pv, q = _partial_test(np, Y, join(list(testX)), join(list(testC)), n, perms, rng)
            if not math.isnan(pv):
                row["statistic"] = _r(f)
                row["p"] = _r(pv)
                row["df"] = q
        rows.append(row)
        f = {"label": name, "adjR2": _r(value), "testable": testX is not None}
        if "p" in row:
            f["p"] = row["p"]
        fractions.append(f)
    residual = 1.0 - explained
    rows.append({"term": "[residual] unexplained", "estimate": _r(residual)})

    # Each block's own total (its unique + everything it shares) — the number a single-block
    # model would have reported, kept beside the fractions so the overlap is visible.
    perBlock = [{"label": blockLabels[i], "adjR2": _r(adj[(i,)]), "columns": len(names[i])} for i in range(k)]
    negatives = [f["label"] for f in fractions if isinstance(f["adjR2"], float) and f["adjR2"] < 0]

    extra = {
        "blocks": perBlock,
        "blockLabels": blockLabels,
        "fractions": fractions,
        "explained": _r(explained),
        "residual": _r(residual),
        "transform": transform,
        "permutations": perms,
        "varLabels": labels,
        "caseLabels": cases,
    }
    if group_kept is not None:
        extra["groups"] = group_kept

    biggest = max(fractions, key=lambda f: (f["adjR2"] if isinstance(f["adjR2"], float) else -1.0))
    return {
        "method": "varpart",
        "title": "Variance partitioning",
        "terms": [{"term": "All blocks together", "estimate": _r(explained), "df": int(ranks[subsets[-1]])}] + rows,
        "extra": {"varpart": extra},
        "glance": {"cases": n, "variables": p, "blocks": k,
                   "explained": _r(explained), "residual": _r(residual),
                   "largest": biggest["label"], "largest_pct": _r(biggest["adjR2"] * 100.0 if isinstance(biggest["adjR2"], float) else float("nan")),
                   "negativeFractions": len(negatives)},
        "summary": "%d cases, %d response variables, %d blocks: together they explain %.1f%% of the variation (adjusted), leaving %.1f%% unexplained. The largest single fraction is %s at %.1f%%." % (
            n, p, k, explained * 100.0, residual * 100.0, biggest["label"], (biggest["adjR2"] if isinstance(biggest["adjR2"], float) else float("nan")) * 100.0),
        "assumptions": [
            "Every fraction is an adjusted R² (Ezekiel): a raw R² rises with each column added, so raw fractions would reward the widest block rather than the most informative one.",
            "The unique fractions are tested by partial redundancy analysis — that block with the other(s) held constant, %d permutations, seed %d." % (perms, seed),
            "A shared fraction has no test and is reported without one: it is a difference between two models, not the fit of any model, so there is nothing to permute.",
            "A shared fraction can come out negative. That is a real result, not an error: it means the blocks together explain less than the sum of their separate explanations, which happens when they are related to the response in opposing ways." + (
                " %d fraction(s) here are negative." % len(negatives) if negatives else ""),
            "The fractions are shares of the total variation, so they sum with the residual to 1.",
            "Linear (redundancy-analysis) geometry%s. This is not offered on correspondence analysis: the adjusted R² that makes the fractions comparable is not defined there." % (
                "" if transform == "none" else ", after the %s transformation" % _TRANSFORMS[transform]),
        ],
        "cite": "Variance partitioning (Borcard, Legendre & Drapeau 1992; adjusted R² after Peres-Neto et al. 2006) of %d response variables over %d blocks; %d permutations." % (p, k, perms),
    }


def correlation(data):
    """Pearson or Spearman correlation between two columns."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "pearson")
    # A correlation's two columns are the same rows — clean them together, or a blank
    # in one silently re-pairs every later row against the wrong partner.
    _ca, _cb = _aligned(d.get("a"), d.get("b"))
    a = np.asarray(_ca, dtype=float)
    b = np.asarray(_cb, dtype=float)
    n = min(a.size, b.size)
    if n < 3:
        raise StatsError("bad_request", "correlation needs ≥ 3 paired values")
    a, b = a[:n], b[:n]
    # Tail (two-sided / greater / less) + settable confidence level for the CI.
    tail = d.get("tail", "two-sided")
    if tail not in ("two-sided", "greater", "less"):
        tail = "two-sided"
    conf = float(d.get("conf", 0.95))
    if variant == "spearman":
        res = stats.spearmanr(a, b, alternative=tail)
        r, p = float(res.statistic), float(res.pvalue)
        terms = [{"term": "Spearman ρ", "estimate": _r(r), "p": _r(p), "df": n - 2}]
        title, assum = "Spearman correlation", ["Rank-based; monotonic (no linearity/normality assumption)."]
    else:
        res = stats.pearsonr(a, b, alternative=tail)
        r, p = float(res.statistic), float(res.pvalue)
        lo = hi = None
        try:
            ci = res.confidence_interval(confidence_level=conf)
            lo, hi = float(ci.low), float(ci.high)
            if tail == "greater":
                hi = None        # one-sided: lower confidence bound only
            elif tail == "less":
                lo = None
        except Exception:  # pragma: no cover
            pass
        terms = [{"term": "Pearson r", "estimate": _r(r), "p": _r(p), "df": n - 2, "ciLow": _r(lo), "ciHigh": _r(hi)}]
        title, assum = "Pearson correlation", ["Assumes a linear relationship + approximately normal data."]
    if tail != "two-sided":
        assum = assum + ["One-tailed (alternative: correlation is %s than 0) — only valid if the direction "
                         "was predicted in advance." % ("greater" if tail == "greater" else "less")]
    return {
        "method": "correlation", "title": title, "terms": terms,
        "glance": {"r": _r(r), "p": _r(p), "n": n, "r_sq": _r(r * r)},
        "summary": "%s = %.4g (p = %s, %s) — %s; explains %.0f%% of the variance." % (
            title.split()[0] + (" ρ" if variant == "spearman" else " r"), r, "%.4g" % p,
            _TAIL_LABEL[tail], _p_words(p), r * r * 100),
        "assumptions": assum,
        "cite": "%s coefficient, %s, at %.3g%% confidence." % (title, _TAIL_LABEL[tail], conf * 100),
    }


def _runs_test(np, stats, resid):
    """Wald-Wolfowitz runs test on the signs of the residuals — a departure from
    randomness (too few runs) signals systematic lack of fit (nonlinearity).
    Returns (runs, expected, z, p) or None if it can't be computed."""
    signs = np.sign(resid)
    nz = signs[signs != 0]
    if nz.size < 2:
        return None
    n1 = int(np.sum(nz > 0))
    n2 = int(np.sum(nz < 0))
    if n1 == 0 or n2 == 0:
        return None
    runs = 1 + int(np.sum(nz[1:] != nz[:-1]))
    nt = n1 + n2
    mu = 2.0 * n1 * n2 / nt + 1.0
    var = 2.0 * n1 * n2 * (2.0 * n1 * n2 - nt) / (nt * nt * (nt - 1.0))
    if var <= 0:
        return runs, mu, None, None
    z = (runs - mu) / var ** 0.5
    p = 2.0 * float(stats.norm.sf(abs(z)))
    return runs, mu, float(z), min(1.0, p)


def _lack_of_fit(np, stats, x, y, resid, n_params):
    """Replicates lack-of-fit F-test (Draper & Smith §2.1). With ≥2 Y values at some
    X level, split the residual SS into pure error (within-replicate scatter) + lack
    of fit (group means vs the fitted line). F = (LOF/df_lof)/(PE/df_pe); a small p
    means the line misfits beyond replicate noise. Returns None without replicates."""
    keys = np.round(np.asarray(x, float), 10)  # distinct X (rounded to kill float dust)
    uniq = np.unique(keys)
    m = int(len(uniq))
    n = int(len(x))
    df_lof = m - n_params
    df_pe = n - m
    if df_lof < 1 or df_pe < 1:
        return None  # no replicates (or too few X levels) → test undefined
    pe_ss = 0.0
    for u in uniq:
        yj = y[keys == u]
        if len(yj) > 1:
            pe_ss += float(np.sum((yj - np.mean(yj)) ** 2))
    if pe_ss <= 0:
        return None
    sse = float(np.sum(np.asarray(resid, float) ** 2))
    lof_ss = max(0.0, sse - pe_ss)
    F = (lof_ss / df_lof) / (pe_ss / df_pe)
    p = float(stats.f.sf(F, df_lof, df_pe))
    return float(F), p, int(df_lof), int(df_pe)


def regression(data):
    """Simple linear regression y ~ x, OLS or weighted (1/Y², 1/X, …), with an
    optional force-through-a-fixed-point fit (origin or an explicit (x0,y0)), a runs
    test + replicates lack-of-fit test, and a residual-normality check."""
    np, stats = _np_sp()
    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    if n < 3:
        raise StatsError("bad_request", "regression needs ≥ 3 paired values")
    x, y = x[:n], y[:n]
    # --- Weighting (WLS): reuse the nonlinear per-point sigma (weight ∝ 1/sigma²).
    #     _nl_weights returns None for "none"/unknown → unweighted OLS.
    weighting = d.get("weighting")
    sigma = _nl_weights(np, x, y, weighting)
    weighted = sigma is not None
    w = (1.0 / np.maximum(np.asarray(sigma, float), 1e-300) ** 2) if weighted else np.ones(n)
    Sw = float(np.sum(w))

    # --- Force the line through a fixed point: the origin (variant) or an explicit (x0,y0).
    origin = d.get("variant") == "origin"
    tp = d.get("throughPoint")
    if origin:
        x0, y0, through = 0.0, 0.0, True
    elif isinstance(tp, dict):
        x0, y0, through = float(tp.get("x", 0.0)), float(tp.get("y", 0.0)), True
    else:
        x0, y0, through = 0.0, 0.0, False

    if through:
        xs, ys = x - x0, y - y0
        sxx_w = float(np.sum(w * xs * xs))  # weighted Σ(x−x0)² — also the band denominator
        if sxx_w == 0:
            raise StatsError("bad_request", "force-through-point needs X values away from the point")
        slope = float(np.sum(w * xs * ys) / sxx_w)
        intercept = float(y0 - slope * x0)
        fitted = y0 + slope * xs
        resid = y - fitted
        df = n - 1
        sse = float(np.sum(w * resid * resid))  # weighted SSE
        mse = sse / df if df > 0 else 0.0
        se_slope = (mse / sxx_w) ** 0.5 if sxx_w > 0 else float("nan")
        se_int = None
        wtss = float(np.sum(w * ys * ys))  # uncentered weighted TSS about the fixed point
        r2 = 1.0 - sse / wtss if wtss > 0 else None
        xbar_w = x0
        title = "Linear regression (through origin)" if origin else "Linear regression (through a fixed point)"
    else:
        # Subtract an observed origin before averaging, so timestamps and other
        # large offsets never enter a difference of squared raw sums. Keep fitted
        # values/residuals in these local coordinates too (the intercept may be huge).
        dx, dy = x - x[0], y - y[0]
        xshift = float(np.sum(w * dx) / Sw)
        yshift = float(np.sum(w * dy) / Sw)
        xc, yc = dx - xshift, dy - yshift
        sxx_w = float(np.sum(w * xc * xc))
        if sxx_w <= 0:
            raise StatsError("bad_request", "regression needs spread in X")
        slope = float(np.sum(w * xc * yc) / sxx_w)
        xbar_w, ybar_w = float(x[0] + xshift), float(y[0] + yshift)
        intercept = float(ybar_w - slope * xbar_w)
        resid = yc - slope * xc
        fitted = y - resid
        df = n - 2
        sse = float(np.sum(w * resid * resid))  # weighted SSE
        mse = sse / df if df > 0 else 0.0
        se_slope = (mse / sxx_w) ** 0.5 if sxx_w > 0 else float("nan")
        se_int = (mse * (1.0 / Sw + xbar_w * xbar_w / sxx_w)) ** 0.5 if sxx_w > 0 else float("nan")
        wtss = float(np.sum(w * yc * yc))  # weighted TSS
        r2 = 1.0 - sse / wtss if wtss > 0 else None
        title = "Linear regression (weighted)" if weighted else "Linear regression"
    # Slope t-test p-value from the (weighted) slope + its SE.
    # A nonzero slope with zero residual error has an infinite limiting t,
    # not t=0. A constant response gives 0/0 and has no inferential P value.
    t = slope / se_slope if se_slope > 0 else (math.copysign(float("inf"), slope) if slope != 0 else None)
    pval = 2.0 * float(stats.t.sf(abs(t), df)) if t is not None and df > 0 else None

    conf = float(d.get("conf", 0.95))  # adjustable CI / band level (default 95%)
    tcrit = float(stats.t.ppf((1.0 + conf) / 2.0, df))
    slo, shi = slope - tcrit * se_slope, slope + tcrit * se_slope
    syx = (sse / df) ** 0.5 if df > 0 else 0.0  # Sy.x = SD of the residuals (RMSE)
    fstat = (slope / se_slope) ** 2 if (se_slope and se_slope > 0) else None  # F = t²(slope), DFn=1
    ilo = intercept - tcrit * se_int if se_int is not None else None
    ihi = intercept + tcrit * se_int if se_int is not None else None
    terms = [
        {"term": "Slope", "estimate": _r(slope), "se": _r(se_slope), "p": _r(pval), "df": df,
         "ciLow": _r(float(slo)), "ciHigh": _r(float(shi))},
        {"term": "Intercept", "estimate": _r(intercept), "se": _r(se_int),
         **({"ciLow": _r(float(ilo)), "ciHigh": _r(float(ihi))} if ilo is not None else {})},
        {"term": "R²", "estimate": _r(r2)},
        {"term": "Sy.x (RMSE)", "estimate": _r(syx)},
    ]
    if fstat is not None:  # ANOVA-of-regression F (equivalent to the slope t², squared)
        terms.append({"term": "F (1, %d)" % df, "estimate": _r(fstat), "p": _r(pval), "df": 1})
    # X-intercept (where y = 0) + reciprocal slope — for reading a standard line the other way.
    if not origin and slope != 0:
        terms.append({"term": "X-intercept", "estimate": _r(-intercept / slope)})
        terms.append({"term": "1/slope", "estimate": _r(1.0 / slope)})
    # Runs test for lack-of-fit (systematic residual sign pattern → nonlinearity).
    rt = _runs_test(np, stats, resid)
    if rt is not None:
        runs, expected, z, rp = rt
        terms.append({"term": "Runs test (lack of fit)", "estimate": runs, "statistic": _r(z),
                      "p": _r(rp), "ciLow": _r(expected)})
    # Replicates lack-of-fit F: only emitted when the data have replicate Y's at some X
    # (splits SSE into pure error + lack of fit). df carried as (df_lof, df_pe via ciLow).
    lof = _lack_of_fit(np, stats, x, y, resid, 1 if through else 2)
    if lof is not None:
        f_lof, p_lof, df_lof, df_pe = lof
        terms.append({"term": "Lack of fit (replicates)", "estimate": _r(f_lof), "statistic": _r(f_lof),
                      "p": _r(p_lof), "df": df_lof, "ciLow": df_pe})
    # Residual normality (Shapiro) — flags a bad model / outliers.
    if n >= 3:
        rw, rpn = stats.shapiro(resid)
        terms.append({"term": "Residual normality (Shapiro)", "statistic": _r(float(rw)), "p": _r(float(rpn))})

    # Confidence band (of the mean) + prediction band (of a new point), over an
    # x-grid spanning the data. Hyperbolic about the line; widest at the extremes.
    xmin, xmax = float(np.min(x)), float(np.max(x))
    grid = [xmin + (xmax - xmin) * k / 49.0 for k in range(50)] if xmax > xmin else [xmin]
    cx, cy, ci_lo, ci_hi, pi_lo, pi_hi = [], [], [], [], [], []
    for gx in grid:
        centered_x = gx - x0 if through else (gx - x[0]) - xshift
        gy = y0 + slope * centered_x if through else ybar_w + slope * centered_x
        # Weighted confidence band of the mean (hyperbolic about the line). Through-a-point
        # models drop the 1/Sw term (the line is pinned at (x0,y0)); xbar_w = x0, sxx_w = Σw(x−x0)².
        if through:
            var_mean = mse * centered_x ** 2 / sxx_w if sxx_w > 0 else 0.0
        else:
            var_mean = mse * (1.0 / Sw + centered_x ** 2 / sxx_w) if sxx_w > 0 else 0.0
        se_mean = var_mean ** 0.5
        se_pred = (var_mean + mse) ** 0.5  # prediction band adds a unit-weight new point's variance
        cx.append(_r(gx)); cy.append(_r(gy))
        ci_lo.append(_r(gy - tcrit * se_mean)); ci_hi.append(_r(gy + tcrit * se_mean))
        pi_lo.append(_r(gy - tcrit * se_pred)); pi_hi.append(_r(gy + tcrit * se_pred))

    # Residual arrays for the diagnostic graphs (residual-vs-predicted scatter +
    # QQ-of-residuals): predicted ŷ paired with the raw residual at each observation.
    residuals = {"x": [_r(float(v)) for v in x],
                 "fitted": [_r(float(v)) for v in fitted],
                 "resid": [_r(float(v)) for v in resid]}

    eqn = "y = %.4g·x" % slope if origin else _line(slope, intercept)
    assumptions = [
        ("Weighted least squares (%s): points are down-weighted per the scheme (fits heteroscedastic data); "
         "assumes the weight model is correct." % weighting) if weighted
        else "OLS: assumes linearity, independent observations, homoscedastic + normal residuals.",
        "Runs test: a small p means the points deviate systematically from the line (try a curve).",
    ]
    if through:
        assumptions.append("Line forced through (%.4g, %.4g): only the slope is fitted." % (x0, y0))
    if lof is not None:
        assumptions.append("Lack-of-fit F: a small p means the line misfits beyond the replicate (pure-error) scatter.")
    return {
        "method": "regression", "title": title, "terms": terms,
        "extra": {"curve": {"x": cx, "y": cy, "ciLow": ci_lo, "ciHigh": ci_hi,
                            "piLow": pi_lo, "piHigh": pi_hi},
                  "residuals": residuals},
        "glance": {"slope": _r(slope), "intercept": _r(intercept), "r_sq": _r(r2), "p": _r(pval), "n": n},
        "summary": "%s; R² = %s (slope p = %s, %s).%s" % (
            eqn, ("%.4g" % r2) if r2 is not None else "—", ("%.4g" % pval) if pval is not None else "—", _p_words(pval),
            (" Weighted (%s)." % weighting) if weighted else ""),
        "assumptions": assumptions,
        "cite": "Linear regression (OLS / weighted least squares); adjustable CI on the slope; "
                "Wald-Wolfowitz runs test + replicates lack-of-fit F.",
    }


def ancova(data):
    """Compare the regression lines of two or more groups ("Are the slopes/
    intercepts different?" / ANCOVA, Zar ch. 18). First an F-test for equal slopes
    (parallelism); if the slopes are parallel, a second F-test for equal elevations
    (intercepts) on the common-slope model. Each group also reports its own line."""
    np, stats = _np_sp()
    d = data or {}
    valid = []
    for g in d.get("groups", []):
        x, y = _aligned(g.get("x"), g.get("y"))
        n = min(len(x), len(y))
        if n >= 3 and float(np.std(x[:n])) > 0:
            valid.append({"label": g.get("label", "?"), "x": np.asarray(x[:n], float), "y": np.asarray(y[:n], float)})
    k = len(valid)
    if k < 2:
        raise StatsError("bad_request", "ANCOVA needs ≥ 2 groups, each with ≥ 3 points and varying X")
    N = sum(g["x"].size for g in valid)

    # (1) Separate regressions — every group its own slope + intercept.
    sse_sep = 0.0
    res_x, res_fit, res_resid = [], [], []  # residuals of the full (separate-line) model
    for g in valid:
        lr = stats.linregress(g["x"], g["y"])
        g["slope"], g["intercept"] = float(lr.slope), float(lr.intercept)
        gfit = lr.slope * g["x"] + lr.intercept
        sse_sep += float(np.sum((g["y"] - gfit) ** 2))
        res_x.extend(float(v) for v in g["x"])
        res_fit.extend(float(v) for v in gfit)
        res_resid.extend(float(v) for v in (g["y"] - gfit))
    df_sep = N - 2 * k

    # (2) Common-slope model — one pooled slope b_c, each group its own intercept.
    sxy = sum(float(np.sum((g["x"] - g["x"].mean()) * (g["y"] - g["y"].mean()))) for g in valid)
    sxx = sum(float(np.sum((g["x"] - g["x"].mean()) ** 2)) for g in valid)
    bc = sxy / sxx if sxx > 0 else float("nan")
    sse_common = 0.0
    for g in valid:
        ic = float(g["y"].mean() - bc * g["x"].mean())
        sse_common += float(np.sum((g["y"] - (bc * g["x"] + ic)) ** 2))
    df_common = N - (k + 1)

    # (3) Single pooled line — all data, one slope + one intercept.
    allx = np.concatenate([g["x"] for g in valid])
    ally = np.concatenate([g["y"] for g in valid])
    lr_all = stats.linregress(allx, ally)
    sse_total = float(np.sum((ally - (lr_all.slope * allx + lr_all.intercept)) ** 2))

    # Slope test: extra SS from forcing a common slope, over the separate-line error.
    f_slope = ((sse_common - sse_sep) / (k - 1)) / (sse_sep / df_sep) if df_sep > 0 and sse_sep > 0 else None
    p_slope = float(stats.f.sf(f_slope, k - 1, df_sep)) if f_slope is not None else None
    # Elevation (intercept) test on the common-slope model — meaningful when slopes are parallel.
    f_int = ((sse_total - sse_common) / (k - 1)) / (sse_common / df_common) if df_common > 0 and sse_common > 0 else None
    p_int = float(stats.f.sf(f_int, k - 1, df_common)) if f_int is not None else None

    # Two-group slope difference + CI — the pairwise detail behind the omnibus slope F.
    # The separate-line slopes are independent (different data) with a common error
    # variance s² = SSE_sep/df_sep, so Var(b₁−b₂) = s²(1/Sxx₁ + 1/Sxx₂) on df_sep;
    # this equals the group×covariate interaction coefficient of the full model.
    slope_diff_term = None
    slope_diff_glance = {}
    if k == 2 and df_sep > 0 and sse_sep > 0:
        g1, g2 = valid[0], valid[1]
        sxx1 = float(np.sum((g1["x"] - g1["x"].mean()) ** 2))
        sxx2 = float(np.sum((g2["x"] - g2["x"].mean()) ** 2))
        if sxx1 > 0 and sxx2 > 0:
            conf = float(d.get("conf", 0.95))
            s_pooled = (sse_sep / df_sep) ** 0.5
            se_diff = s_pooled * (1.0 / sxx1 + 1.0 / sxx2) ** 0.5
            delta = g1["slope"] - g2["slope"]
            t_stat = delta / se_diff if se_diff > 0 else None
            p_diff = float(2.0 * stats.t.sf(abs(t_stat), df_sep)) if t_stat is not None else None
            tcrit = float(stats.t.ppf(1.0 - (1.0 - conf) / 2.0, df_sep))
            lo, hi = delta - tcrit * se_diff, delta + tcrit * se_diff
            slope_diff_term = {"term": "Slope difference (%s − %s)" % (g1["label"], g2["label"]),
                               "estimate": _r(delta), "se": _r(se_diff), "statistic": _r(t_stat),
                               "df": df_sep, "p": _r(p_diff), "ciLow": _r(lo), "ciHigh": _r(hi)}
            slope_diff_glance = {"slope_diff": _r(delta), "slope_diff_se": _r(se_diff),
                                 "slope_diff_ci_low": _r(lo), "slope_diff_ci_high": _r(hi), "slope_diff_p": _r(p_diff)}

    terms = []
    for g in valid:
        terms.append({"term": "%s — slope" % g["label"], "estimate": _r(g["slope"])})
        terms.append({"term": "%s — intercept" % g["label"], "estimate": _r(g["intercept"])})
    terms.append({"term": "Slopes equal? (F)", "statistic": _r(f_slope), "df": k - 1, "p": _r(p_slope)})
    if slope_diff_term is not None:
        terms.append(slope_diff_term)
    if bc == bc:
        terms.append({"term": "Common slope (if parallel)", "estimate": _r(bc)})
    terms.append({"term": "Intercepts equal? (F)", "statistic": _r(f_int), "df": k - 1, "p": _r(p_int)})

    slopes_differ = p_slope is not None and p_slope < 0.05
    if p_slope is None:
        verdict = "compared %d regression lines (slope test indeterminate — near-perfect within-group fit)" % k
    elif slopes_differ:
        verdict = "the slopes differ significantly (p = %s) — the lines are not parallel, so do not interpret the intercept test" % ("%.4g" % p_slope)
    elif p_int is not None:
        verdict = "the slopes are parallel (p = %s); the intercepts %s (p = %s)" % (
            "%.4g" % p_slope, "differ" if p_int < 0.05 else "do not differ", "%.4g" % p_int)
    else:
        verdict = "the slopes are parallel (p = %s)" % ("%.4g" % p_slope)
    return {
        "method": "ancova", "title": "Compare regression lines (ANCOVA)", "terms": terms,
        "extra": {"residuals": {"x": [_r(v) for v in res_x], "fitted": [_r(v) for v in res_fit],
                                "resid": [_r(v) for v in res_resid]}},
        "glance": {"groups": k, "n": N, "F_slope": _r(f_slope), "p_slope": _r(p_slope),
                   "F_intercept": _r(f_int), "p_intercept": _r(p_int), **slope_diff_glance},
        "summary": "%d groups, N = %d: %s." % (k, N, verdict),
        "assumptions": ["Linear within each group; independent, homoscedastic, normal residuals.",
                        "The intercept (elevation) test is only valid when the slopes are parallel."],
        "cite": "ANCOVA comparison of regression lines (Zar): F-test for equal slopes, then equal elevations.",
    }


def _cell(v):
    """A contingency cell → a non-negative count; blank/None → 0."""
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _wilson_ci(np, k, n, z):
    """Wilson score confidence interval for a binomial proportion k/n (the interval
    conventionally reported for sensitivity/specificity/PPV/NPV — well-behaved near 0 and 1)."""
    if n <= 0:
        return (float("nan"), float("nan"))
    phat = k / n
    denom = 1.0 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    half = (z / denom) * float(np.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)))
    return (center - half, center + half)


def _koopman_rr_ci(np, a, b, c, d, z):
    """Koopman (1984) asymptotic-score CI for the risk ratio RR = (a/(a+b))/(c/(c+d)),
    rows = groups. Finds the RR values where the constrained-MLE score statistic equals
    z² (root-found), so it stays well-behaved with small counts. Returns (lo, hi), or
    None when it can't be bracketed (the caller then falls back to the Katz log CI)."""
    from scipy.optimize import brentq
    x1, n1, x2, n2 = float(a), float(a + b), float(c), float(c + d)
    if n1 <= 0 or n2 <= 0 or x1 == 0 or x2 == 0:
        return None
    p1h, p2h = x1 / n1, x2 / n2
    N = n1 + n2
    rr = p1h / p2h
    if not np.isfinite(rr) or rr <= 0:
        return None

    def score2(R):
        # Constrained MLE p̃2 solving  R·N·p² − [(x1+n2)+R(x2+n1)]·p + (x1+x2) = 0.
        B = (x1 + n2) + R * (x2 + n1)
        disc = B * B - 4.0 * R * N * (x1 + x2)
        p2t = (B - np.sqrt(disc if disc > 0 else 0.0)) / (2.0 * R * N)
        p2t = min(max(p2t, 1e-12), 1 - 1e-12)
        p1t = min(max(R * p2t, 1e-12), 1 - 1e-12)
        var = p1t * (1 - p1t) / n1 + R * R * p2t * (1 - p2t) / n2
        return float("inf") if var <= 0 else (p1h - R * p2h) ** 2 / var

    g = lambda R: score2(R) - z * z  # noqa: E731 — score statistic crosses z² at the bounds
    try:
        out = []
        for lo, hi in ((rr * 1e-6, rr), (rr, rr * 1e6)):
            if g(lo) * g(hi) > 0:
                return None
            out.append(float(brentq(g, lo, hi, xtol=1e-12, rtol=1e-12, maxiter=200)))
        return (out[0], out[1])
    except (ValueError, RuntimeError):
        return None


def _newcombe_diff_ci(np, a, b, c, d, z):
    """Newcombe (1998) hybrid-score ('method 10') CI for the difference of proportions
    p1 − p2 with p1 = a/(a+b), p2 = c/(c+d): square-and-add the two Wilson score
    intervals. Well-behaved near 0/1 and never leaves [−1, 1]."""
    n1, n2 = float(a + b), float(c + d)
    if n1 <= 0 or n2 <= 0:
        return None
    p1, p2 = a / n1, c / n2
    l1, u1 = _wilson_ci(np, a, n1, z)
    l2, u2 = _wilson_ci(np, c, n2, z)
    diff = p1 - p2
    lo = diff - float(np.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2))
    hi = diff + float(np.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2))
    return (lo, hi)


def _baptista_pike_or_ci(np, a, b, c, d, alpha):
    """Baptista-Pike (1977) exact conditional CI for the odds ratio: invert the
    two-sided exact test (probability ordering — sum the probabilities of every table
    at least as unlikely as the observed one) of the Fisher noncentral hypergeometric
    distribution of cell a with both margins fixed. Less conservative than the
    Cornfield/tail exact CI. Returns (lo, hi), or None when a cell sits at the support
    edge / it can't be bracketed (caller then falls back to the Woolf logit CI)."""
    from scipy.stats import nchypergeom_fisher
    from scipy.optimize import brentq
    a, b, c, d = int(a), int(b), int(c), int(d)
    if min(a, b, c, d) < 0:
        return None
    M, ncol, nrow = a + b + c + d, a + c, a + b
    klo, khi = max(0, ncol - (c + d)), min(nrow, ncol)
    if khi <= klo or a in (klo, khi):   # boundary count → one side is 0/∞: use Woolf
        return None
    ks = list(range(klo, khi + 1))

    def p2(psi):
        rv = nchypergeom_fisher(M, ncol, nrow, psi)
        pmf = {k: float(rv.pmf(k)) for k in ks}
        pa = pmf[a]
        return sum(v for v in pmf.values() if v <= pa * (1 + 1e-7))

    orhat = ((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5)) if 0 in (a, b, c, d) else (a * d) / (b * c)
    f = lambda psi: p2(psi) - alpha  # noqa: E731 — two-sided exact p crosses α at the limits
    try:
        lo = float(brentq(f, orhat * 1e-6, orhat, xtol=1e-10, rtol=1e-12))
        hi = float(brentq(f, orhat, orhat * 1e6, xtol=1e-10, rtol=1e-12))
    except (ValueError, RuntimeError):
        return None
    return (lo, hi) if (np.isfinite(lo) and np.isfinite(hi)) else None


def _clinical_2x2(np, stats, table, z, ci_method="score"):
    """Clinical/epidemiological 2×2 measures with CIs, for a table laid out as
    rows = group / test result (row 0 = exposed / test-positive) and
    columns = outcome / disease (col 0 = event / disease-present):

        · Relative risk + Koopman score or Katz log CI · Odds ratio + Baptista-Pike exact or Woolf logit CI
        · Risk difference (ARR) + CI, NNT/NNH · Sensitivity/Specificity/PPV/NPV
          (+ Wilson CIs) · Likelihood ratios LR+/LR−.

    A Haldane-Anscombe 0.5 correction is applied to the ratio estimates when any cell
    is zero (so lnRR/lnOR stay finite); the raw proportions use the observed counts."""
    a, b, c, d = (float(table[0, 0]), float(table[0, 1]), float(table[1, 0]), float(table[1, 1]))
    terms = []
    exp = np.exp
    log = np.log
    zero = min(a, b, c, d) == 0
    a2, b2, c2, d2 = (a + 0.5, b + 0.5, c + 0.5, d + 0.5) if zero else (a, b, c, d)
    # Risks in each row (event rate among exposed / unexposed).
    r1n, r0n = a + b, c + d
    risk1 = a / r1n if r1n else float("nan")
    risk0 = c / r0n if r0n else float("nan")
    # Relative risk — Koopman asymptotic-score CI (our default) or Katz log CI.
    rr = (a2 / (a2 + b2)) / (c2 / (c2 + d2))
    rr_ci = _koopman_rr_ci(np, a, b, c, d, z) if ci_method == "score" else None
    if rr_ci is None:  # log/Katz CI (also the fallback when the score can't be bracketed)
        se_lnrr = float(np.sqrt(b2 / (a2 * (a2 + b2)) + d2 / (c2 * (c2 + d2))))
        rr_ci = (float(exp(log(rr) - z * se_lnrr)), float(exp(log(rr) + z * se_lnrr)))
    terms.append({"term": "Relative risk", "estimate": _r(rr), "ciLow": _r(rr_ci[0]), "ciHigh": _r(rr_ci[1])})
    # Odds ratio — Baptista-Pike exact conditional CI (our default) or Woolf logit CI.
    orr = (a2 * d2) / (b2 * c2)
    alpha = float(2 * stats.norm.sf(z))
    or_ci = _baptista_pike_or_ci(np, a, b, c, d, alpha) if ci_method == "score" else None
    if or_ci is None:  # Woolf logit CI (also the fallback for boundary counts / no bracket)
        se_lnor = float(np.sqrt(1 / a2 + 1 / b2 + 1 / c2 + 1 / d2))
        or_ci = (float(exp(log(orr) - z * se_lnor)), float(exp(log(orr) + z * se_lnor)))
    terms.append({"term": "Odds ratio", "estimate": _r(orr), "ciLow": _r(or_ci[0]), "ciHigh": _r(or_ci[1])})
    # Risk difference — Newcombe hybrid-score CI (our default) or Wald CI, and NNT/NNH.
    rd = risk1 - risk0
    rd_ci = _newcombe_diff_ci(np, a, b, c, d, z) if ci_method == "score" else None
    if rd_ci is None:
        se_rd = float(np.sqrt(risk1 * (1 - risk1) / r1n + risk0 * (1 - risk0) / r0n)) if r1n and r0n else float("nan")
        rd_ci = (rd - z * se_rd, rd + z * se_rd)
    terms.append({"term": "Risk difference", "estimate": _r(rd), "ciLow": _r(rd_ci[0]), "ciHigh": _r(rd_ci[1])})
    if rd != 0 and np.isfinite(rd):
        terms.append({"term": "NNT (1/|risk diff|)", "estimate": _r(abs(1.0 / rd))})
    # Diagnostic accuracy (test = rows, disease = columns).
    sens, spec = (a / (a + c) if (a + c) else float("nan")), (d / (b + d) if (b + d) else float("nan"))
    ppv, npv = (a / (a + b) if (a + b) else float("nan")), (d / (c + d) if (c + d) else float("nan"))
    for label, k, tot in (("Sensitivity", a, a + c), ("Specificity", d, b + d),
                          ("PPV", a, a + b), ("NPV", d, c + d)):
        lo, hi = _wilson_ci(np, k, tot, z)
        terms.append({"term": label, "estimate": _r(k / tot if tot else float("nan")),
                      "ciLow": _r(lo), "ciHigh": _r(hi)})
    if np.isfinite(sens) and np.isfinite(spec):
        if spec < 1:
            terms.append({"term": "LR+", "estimate": _r(sens / (1 - spec))})
        if spec > 0:
            terms.append({"term": "LR−", "estimate": _r((1 - sens) / spec)})
    return terms


def _cochran_armitage(np, stats, table):
    """Cochran-Armitage test for trend in proportions across ordered categories of a
    2×k (or k×2) table, scores 0…k−1. Returns (z, two-sided p). Orient so the size-2
    dimension is the binary outcome and the ≥3 dimension is the ordered exposure."""
    t = table if table.shape[0] == 2 else table.T  # rows = outcome (2), cols = ordered dose
    a = t[0].astype(float)          # 'event' counts per dose column
    ncol = t.sum(axis=0).astype(float)
    N = float(t.sum())
    R = float(a.sum())
    p = R / N
    scores = np.arange(t.shape[1], dtype=float)
    U = float(np.sum(scores * a) - p * np.sum(scores * ncol))
    V = p * (1 - p) * float(np.sum(ncol * scores * scores) - (np.sum(ncol * scores) ** 2) / N)
    if V <= 0:
        return (float("nan"), float("nan"))
    zt = U / float(np.sqrt(V))
    return (zt, float(2 * stats.norm.sf(abs(zt))))


def _fisher_freeman_halton(table, cap=1_000_000):
    """Fisher-Freeman-Halton exact test — the r×c generalisation of Fisher's exact.
    Under independence (given the margins) each table has the multivariate-
    hypergeometric probability P = (∏Rᵢ!·∏Cⱼ!)/(N!·∏nᵢⱼ!); the exact p sums P over
    all tables with the same margins whose P ≤ P(observed). Returns (p, n_tables), or
    (None, None) if the enumeration would exceed `cap` tables (too large for exact).
    Reduces to scipy's two-sided Fisher exact on a 2×2. Pure Python (math.log only)."""
    import math
    r, c = len(table), len(table[0])
    rows = [sum(row) for row in table]
    cols = [sum(row[j] for row in table) for j in range(c)]
    N = sum(rows)
    if N <= 0 or r < 2 or c < 2:
        return None, None
    lf = [0.0] * (N + 1)  # log k!
    for k in range(2, N + 1):
        lf[k] = lf[k - 1] + math.log(k)
    log_const = sum(lf[x] for x in rows) + sum(lf[x] for x in cols) - lf[N]

    def logp(cells):
        s = 0.0
        for row in cells:
            for v in row:
                s += lf[v]
        return log_const - s

    p_obs = logp(table)
    eps = 1e-9
    cur = [[0] * c for _ in range(r)]
    acc, cnt, aborted = [0.0], [0], [False]

    def rec(i, colrem):
        if aborted[0]:
            return
        if i == r - 1:  # last row forced by the remaining column capacities
            for j in range(c):
                cur[i][j] = colrem[j]
            cnt[0] += 1
            if cnt[0] > cap:
                aborted[0] = True
                return
            lp = logp(cur)
            if lp <= p_obs + eps:
                acc[0] += math.exp(lp)
            return

        def cell(j, rowrem):  # fill row i as a composition ≤ column capacities
            if aborted[0]:
                return
            if j == c - 1:
                if 0 <= rowrem <= colrem[j]:
                    cur[i][j] = rowrem
                    rec(i + 1, [colrem[t] - cur[i][t] for t in range(c)])
                return
            for v in range(min(rowrem, colrem[j]) + 1):
                cur[i][j] = v
                cell(j + 1, rowrem - v)

        cell(0, rows[i])

    rec(0, cols[:])
    if aborted[0]:
        return None, None
    return min(1.0, acc[0]), cnt[0]


def contingency(data):
    """Contingency-table analysis. Independent (default): Pearson + Yates χ², Cramer's V,
    Fisher's exact (2×2), the clinical 2×2 toolkit (RR/OR + CI, risk difference + NNT,
    sensitivity/specificity/PPV/NPV + Wilson CI, LR±), and a Cochran-Armitage trend for
    2×k ordered tables. Paired variant (`variant="paired"`): McNemar's test (2×2).

    Tables larger than 2×2 also get the Fisher-Freeman-Halton exact test (the r×c Fisher's
    exact) whenever enumerating the tables is small enough to do."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant", "independent")
    conf = float(d.get("conf") or 0.95)
    zc = float(stats.norm.ppf(1 - (1 - conf) / 2))
    # 2×2 effect-size CI method: "score" (Koopman RR, Baptista-Pike exact OR, Newcombe
    # risk-difference — the default) or "log" (Katz RR, Woolf OR, Wald risk-difference).
    ci_method = "log" if str(d.get("ciMethod", "score")).lower() == "log" else "score"
    rows = d.get("table", [])
    if not rows or not isinstance(rows, list):
        raise StatsError("bad_request", "contingency needs a 2-D table of counts")
    width = max((len(r) for r in rows), default=0)
    table = np.asarray([[_cell(r[j] if j < len(r) else 0) for j in range(width)] for r in rows], dtype=float)
    if table.ndim != 2:
        raise StatsError("bad_request", "contingency needs a 2-D table of counts")
    if np.any(table < 0):
        raise StatsError("bad_request", "counts must be non-negative")
    # Drop all-zero rows / columns (e.g. blank grid rows) so χ² stays defined.
    table = table[table.sum(axis=1) > 0]
    if table.size:
        table = table[:, table.sum(axis=0) > 0]
    r, c = table.shape
    if r < 2 or c < 2:
        raise StatsError("bad_request", "contingency needs a table of at least 2×2 non-empty counts")
    n = float(table.sum())
    if n <= 0:
        raise StatsError("bad_request", "the table has no observations")
    # --- Paired 2×2 (McNemar) ------------------------------------------------
    if variant == "paired":
        if r != 2 or c != 2:
            raise StatsError("bad_request", "McNemar's paired test needs a 2×2 table of paired outcomes.")
        b_, c_ = float(table[0, 1]), float(table[1, 0])  # the discordant pairs
        disc = b_ + c_
        chi_cc = ((abs(b_ - c_) - 1) ** 2) / disc if disc > 0 else 0.0
        p_cc = float(stats.chi2.sf(chi_cc, 1)) if disc > 0 else 1.0
        p_exact = float(min(1.0, 2 * stats.binom.cdf(min(b_, c_), int(disc), 0.5))) if disc > 0 else 1.0
        pv = p_exact if disc < 25 else p_cc  # exact when discordant pairs are few
        return {
            "method": "contingency", "title": "McNemar's paired test (2×2)",
            "terms": [
                {"term": "McNemar χ² (Yates)", "statistic": _r(chi_cc), "df": 1, "p": _r(p_cc)},
                {"term": "Exact (binomial)", "p": _r(p_exact)},
                {"term": "Discordant pairs (b, c)", "estimate": _r(b_), "statistic": _r(c_)},
            ],
            "glance": {"mcnemar_chi_sq": _r(chi_cc), "df": 1, "p": _r(p_cc), "exact_p": _r(p_exact),
                       "b": int(b_), "c": int(c_), "n": int(n)},
            "summary": "McNemar's test: %d vs %d discordant pairs, p = %s — the paired proportions %s." % (
                int(b_), int(c_), "%.4g" % pv, "differ" if pv < 0.05 else "do not differ significantly"),
            "assumptions": ["Paired / matched binary observations; uses the exact binomial when discordant pairs < 25."],
            "cite": "McNemar's test for paired proportions (continuity-corrected χ² + exact binomial).",
        }

    # --- Independent r×c: Pearson (+ Yates 2×2) χ², Cramer's V ----------------
    chi2, p, dof, expected = stats.chi2_contingency(table, correction=False)
    chi2, p, dof = float(chi2), float(p), int(dof)
    cram = float(np.sqrt(chi2 / (n * (min(r, c) - 1)))) if min(r, c) > 1 else None
    min_exp = float(expected.min())
    terms = [
        {"term": "Pearson χ²", "statistic": _r(chi2), "df": dof, "p": _r(p)},
        {"term": "Cramer's V", "estimate": _r(cram)},
    ]
    glance = {"chi_sq": _r(chi2), "df": dof, "p": _r(p), "n": int(n),
              "cramers_v": _r(cram), "min_expected": _r(min_exp), "rows": r, "cols": c}
    if r == 2 and c == 2:
        chi_y, p_y, _dy, _ey = stats.chi2_contingency(table, correction=True)  # Yates continuity
        terms.append({"term": "Yates-corrected χ²", "statistic": _r(float(chi_y)), "df": 1, "p": _r(float(p_y))})
        orr, fp = stats.fisher_exact(table)
        terms.append({"term": "Fisher's exact (2-sided)", "estimate": _r(float(orr)), "p": _r(float(fp))})
        glance.update({"odds_ratio": _r(float(orr)), "fisher_p": _r(float(fp)),
                       "yates_chi_sq": _r(float(chi_y)), "yates_p": _r(float(p_y))})
        terms.extend(_clinical_2x2(np, stats, table, zc, ci_method))  # RR/OR+CI, risk diff, NNT, sens/spec/PPV/NPV, LR±
    # Cochran-Armitage trend for an ordered 2×k / k×2 table (k ≥ 3).
    if min(r, c) == 2 and max(r, c) >= 3:
        z_ca, p_ca = _cochran_armitage(np, stats, table)
        if np.isfinite(z_ca):
            terms.append({"term": "Cochran-Armitage trend", "statistic": _r(z_ca), "p": _r(p_ca)})
            glance.update({"trend_z": _r(z_ca), "trend_p": _r(p_ca)})
    # Fisher-Freeman-Halton exact for tables larger than 2×2 (the r×c generalisation of
    # Fisher's exact). None when the enumeration would be too large (χ² still reported).
    ffh_p = None
    if r > 2 or c > 2:
        ffh_p, _ffh_n = _fisher_freeman_halton([[int(round(float(table[i, j]))) for j in range(c)] for i in range(r)])
        if ffh_p is not None:
            terms.append({"term": "Fisher-Freeman-Halton exact (r×c)", "p": _r(ffh_p)})
            glance["ffh_p"] = _r(ffh_p)
    assum = ["Independent observations; the χ² approximation wants expected counts ≥ 5."]
    if ffh_p is not None:
        assum.append("Fisher-Freeman-Halton = the exact p summed over every table with these margins (the r×c Fisher's exact); prefer it when expected counts are small.")
    if min_exp < 5:
        assum.append("Some expected counts < 5 — prefer Fisher's exact (shown for 2×2 tables).")
    if r == 2 and c == 2:
        assum.append("Clinical measures assume rows = group/test (row 0 = exposed/positive), columns = outcome (col 0 = event/disease).")
        assum.append(
            "Relative-risk CI: Koopman asymptotic score; odds-ratio CI: Baptista-Pike exact conditional; risk-difference CI: Newcombe hybrid score (score-based intervals, well-behaved near 0 and 1)."
            if ci_method == "score" else
            "Relative-risk CI: Katz log method; odds-ratio CI: Woolf logit; risk-difference CI: Wald.")
    if min(r, c) == 2 and max(r, c) >= 3:
        assum.append("Cochran-Armitage trend uses equally-spaced ordered scores (0…k−1) for the k-level factor.")
    return {
        "method": "contingency", "title": "Chi-square (contingency table)", "terms": terms,
        "glance": glance,
        "summary": "χ²(%d, N = %d) = %.4g, p = %s — rows and columns are %s associated (Cramer's V = %s)." % (
            dof, int(n), chi2, "%.4g" % p, "significantly" if p < 0.05 else "not significantly",
            ("%.3g" % cram) if cram is not None else "—"),
        "assumptions": assum,
        "cite": "Pearson + Yates χ²; Cramer's V; Fisher's exact + clinical risk measures (2×2); Cochran-Armitage trend (2×k).",
    }


def _r2(y, yhat):
    """Coefficient of determination R²."""
    import numpy as np
    y = np.asarray(y, dtype=float)
    ss_res = float(((y - yhat) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return 1 - ss_res / ss_tot if ss_tot else None


def _resid_pack(x, yhat, y):
    """Residual arrays for the diagnostic graphs: the predictor x (so a residual-vs-X
    plot is possible), the fitted value ŷ, and the raw residual y − ŷ — rounded."""
    import numpy as np
    x = np.asarray(x, dtype=float)
    yhat = np.asarray(yhat, dtype=float)
    y = np.asarray(y, dtype=float)
    return {"x": [_r(float(v)) for v in x],
            "fitted": [_r(float(v)) for v in yhat],
            "resid": [_r(float(v)) for v in (y - yhat)]}


def _p0_decay2(np, x, y):
    """Robust initial guess for the bi-exponential decay: estimate the overall rate
    from the half-drop point, then split into a fast (≈4×) and slow (≈0.4×) phase."""
    plateau = float(y[-1])
    span = float(y[0]) - plateau
    target = plateau + span / 2.0
    idx = int(np.argmin(np.abs(np.asarray(y) - target)))
    xhalf = float(x[idx]) if float(x[idx]) > 0 else (float(x[-1]) / 2 + 1e-9)
    k = float(np.log(2) / (xhalf + 1e-9))
    return [plateau, span * 0.6, 4 * k, span * 0.4, 0.4 * k]


def _nl_models():
    """The nonlinear equation registry: name → {title, params, fn, p0, bounds,
    logx, derived, cite, family}. `fn(x, *params)` is the model (numpy-vectorised);
    `p0(np, x, y)` returns starting guesses; `bounds` is (lo, hi) per param or None;
    `logx` fits on log10(x) (dose-response); `derived(np, popt)` returns extra
    reported rows (e.g. EC50 from logEC50). Adding an equation = one entry here."""
    inf = float("inf")
    return {
        # ── Dose-response (logistic on log10 dose) ───────────────────────────
        "3pl": {
            "title": "Dose-response (3PL, fixed slope)", "family": "Dose-response",
            "params": ["Bottom", "Top", "logEC50"], "logx": True,
            "fn": lambda lx, bottom, top, logec50: bottom + (top - bottom) / (1 + 10 ** (logec50 - lx)),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx))],
            "bounds": None,
            "derived": lambda np, p: [("EC50", float(10 ** p[2]))], "ecf": "EC",
            "cite": "Three-parameter logistic (Hill slope = 1) dose-response.",
        },
        "4pl": {
            "title": "Dose-response (4PL, variable slope)", "family": "Dose-response",
            "params": ["Bottom", "Top", "logEC50", "Hill slope"], "logx": True,
            "fn": lambda lx, bottom, top, logec50, hill: bottom + (top - bottom) / (1 + 10 ** ((logec50 - lx) * hill)),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx)), 1.0],
            "bounds": None,
            "derived": lambda np, p: [("EC50", float(10 ** p[2]))], "ecf": "EC",
            "cite": "Four-parameter logistic (Hill) dose-response; EC50 from the log fit.",
        },
        "5pl": {
            "title": "Dose-response (5PL, asymmetric)", "family": "Dose-response",
            "params": ["Bottom", "Top", "logEC50", "Hill slope", "Asymmetry"], "logx": True,
            "fn": lambda lx, bottom, top, logec50, hill, s: bottom + (top - bottom) / (1 + 10 ** ((logec50 - lx) * hill)) ** s,
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx)), 1.0, 1.0],
            "bounds": ([-inf, -inf, -inf, -inf, 1e-3], [inf, inf, inf, inf, inf]),
            "derived": lambda np, p: [("EC50", float(10 ** p[2]))], "ecf": "EC",
            "cite": "Five-parameter logistic (asymmetric) dose-response.",
        },
        # ── Binding / enzyme kinetics (rectangular hyperbola) ────────────────
        "mm": {
            "title": "Michaelis-Menten", "family": "Enzyme kinetics",
            "params": ["Vmax", "KM"], "logx": False,
            "fn": lambda x, vmax, km: vmax * x / (km + x),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0], [inf, inf]),
            # (Vmax, KM) from the fitted params — drives the linearization diagnostics.
            "mm_constants": lambda p: (float(p[0]), float(p[1])),
            "cite": "Michaelis-Menten enzyme kinetics (nonlinear least squares).",
        },
        # Determine kcat (turnover number): same rectangular hyperbola as MM but
        # parameterised as Vmax = Et·kcat. Et (active-site concentration) and kcat are
        # confounded by a substrate-velocity curve alone — constrain Et to its known
        # value (Constraints panel) so kcat is identifiable (kcat = Vmax/Et).
        "kcat": {
            "title": "Michaelis-Menten (kcat)", "family": "Enzyme kinetics",
            "params": ["Et", "kcat", "KM"], "logx": False,
            "fn": lambda x, et, kcat, km: et * kcat * x / (km + x),
            "p0": lambda np, x, y: [1.0, float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([1e-12, 0.0, 0.0], [inf, inf, inf]),
            # kcat/KM is the specificity constant (catalytic efficiency) — the apparent
            # second-order rate constant for E + S at low [S], and the standard figure of
            # merit for comparing substrates. Guard KM ≤ 0 (bounds allow KM = 0).
            "derived": lambda np, p: [
                ("Vmax", float(p[0] * p[1])),
                ("kcat/KM", float(p[1] / p[2]) if p[2] > 0 else float("nan")),
            ],
            # Vmax = Et·kcat; KM is the third parameter.
            "mm_constants": lambda p: (float(p[0] * p[1]), float(p[2])),
            "cite": "Enzyme kinetics turnover number: Y = Et·kcat·X/(KM+X). Constrain Et to the known active-site concentration so kcat is identifiable (else only Vmax=Et·kcat is defined). kcat/KM is the specificity constant (catalytic efficiency).",
        },
        # Enzyme progress curve: product [P] vs time under Michaelis-Menten kinetics with
        # substrate depletion (the integrated MM equation). Closed form via Lambert-W
        # (Schnell & Mendoza 1997). S0 (initial substrate) ≈ the plateau; constrain it if
        # known. Initial velocity V0 = Vmax·S0/(KM+S0) is reported as a derived quantity.
        "enzyme_progress": {
            "title": "Enzyme progress curve (integrated MM)", "family": "Enzyme kinetics",
            "params": ["Vmax", "KM", "S0"], "logx": False,
            "fn": _mm_progress_curve,
            "p0": lambda np, x, y: [
                2.0 * float(np.max(y)) / (float(np.max(x)) + 1e-9) + 1e-9,  # Vmax ≈ 2× mean rate
                0.2 * float(np.max(y)) + 1e-9,                              # KM
                float(np.max(y)) * 1.05 + 1e-9,                            # S0 ≈ plateau (total product)
            ],
            "bounds": ([0.0, 1e-9, 0.0], [inf, inf, inf]),
            "derived": lambda np, p: [("Initial velocity", float(p[0] * p[2] / (p[1] + p[2])) if (p[1] + p[2]) > 0 else float("nan"))],
            "cite": "Integrated Michaelis-Menten progress curve (product vs time with substrate depletion); Schnell-Mendoza closed form via the Lambert-W function. Initial velocity V0 = Vmax·S0/(KM+S0).",
        },
        "onesite": {
            "title": "One-site specific binding", "family": "Binding",
            "params": ["Bmax", "Kd"], "logx": False,
            "fn": lambda x, bmax, kd: bmax * x / (kd + x),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0], [inf, inf]),
            "cite": "One-site specific binding (saturation isotherm).",
        },
        # Homologous competition (one site): the same ligand hot + cold. Bound hot ligand is
        # displaced by increasing cold competitor X (fit vs log[cold]). `Hot` (the radioligand
        # concentration) must be fixed to its known value via the Constraints panel — otherwise
        # Kd and Hot are confounded (only their sum is defined by the curve). Kd = 10^logKd.
        "homologous_competition": {
            "title": "Homologous competition (one site)", "family": "Binding",
            "params": ["Bmax", "logKd", "NS", "Hot"], "logx": True,
            "fn": lambda lx, bmax, logkd, ns, hot: bmax * hot / (hot + 10.0 ** lx + 10.0 ** logkd) + ns,
            "p0": lambda np, lx, y: [float(np.max(y)) * 2.0 + 1e-9, float(np.median(lx)), float(np.min(y)), 1.0],
            "bounds": ([0.0, -inf, -inf, 1e-12], [inf, inf, inf, inf]),
            "cite": "Homologous competitive binding, one site: cold ligand displaces the same hot ligand. Fix 'Hot' to the known radioligand concentration (else Kd/Hot are confounded); Kd = 10^logKd; NS = nonspecific offset.",
        },
        # Allosteric modulator (ternary-complex) binding titration: radioligand A binding
        # (fixed [A], known KA) is shifted by an allosteric modulator B (X = [B], fit on
        # log10) whose effect saturates via the cooperativity α. Observed affinity
        # KA,obs = KA·(1+[B]/KB)/(1+α·[B]/KB) ⇒ Y = Bmax·[A]/([A]+KA,obs). Constrain A
        # (radioligand conc) and KA (its Kd, from a saturation experiment) to their known
        # values — else Bmax/A/KA are confounded (the kcat pattern). α>1 positive, α<1 negative.
        "allosteric_binding": {
            "title": "Allosteric modulator (ternary complex)", "family": "Binding",
            "params": ["Bmax", "A", "KA", "logKB", "logAlpha"], "logx": True,
            "fn": lambda lx, bmax, a, ka, logkb, logalpha: bmax * a / (a + ka * (1 + 10.0 ** (lx - logkb)) / (1 + 10.0 ** logalpha * 10.0 ** (lx - logkb))),
            "p0": lambda np, lx, y: [float(np.max(y)) * 2.0 + 1e-9, 1.0, 1.0, float(np.median(lx)), 0.0],
            "bounds": ([0.0, 1e-12, 1e-12, -inf, -inf], [inf, inf, inf, inf, inf]),
            "derived": lambda np, p: [("KB", float(10 ** p[3])), ("Alpha", float(10 ** p[4]))],
            "cite": "Allosteric ternary-complex binding titration (Christopoulos-Kenakin): KA,obs = KA·(1+[B]/KB)/(1+α·[B]/KB). Fix A (radioligand conc) and KA (its Kd) to their known values so Bmax/KB/α are identifiable; α>1 positive / α<1 negative cooperativity; KB = 10^logKB, α = 10^logAlpha.",
        },
        # ── Exponential ──────────────────────────────────────────────────────
        "exp_decay": {
            "title": "One-phase exponential decay", "family": "Exponential",
            "params": ["Y0", "Plateau", "K"], "logx": False,
            "fn": lambda x, y0, plateau, k: plateau + (y0 - plateau) * np_exp(-k * x),
            "p0": lambda np, x, y: [float(y[0]), float(y[-1]), 1.0 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, 0.0], [inf, inf, inf]),
            "derived": lambda np, p: [("Half-life", float(np.log(2) / p[2])) if p[2] > 0 else ("Half-life", None)],
            "cite": "One-phase exponential decay to a plateau.",
        },
        "exp_assoc": {
            "title": "One-phase association", "family": "Exponential",
            "params": ["Y0", "Plateau", "K"], "logx": False,
            "fn": lambda x, y0, plateau, k: y0 + (plateau - y0) * (1 - np_exp(-k * x)),
            "p0": lambda np, x, y: [float(y[0]), float(y[-1]), 1.0 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, 0.0], [inf, inf, inf]),
            "derived": lambda np, p: [("Half-life", float(np.log(2) / p[2])) if p[2] > 0 else ("Half-life", None)],
            "cite": "One-phase exponential association to a plateau.",
        },
        "exp_growth": {
            "title": "Exponential growth", "family": "Exponential",
            "params": ["Y0", "K"], "logx": False,
            "fn": lambda x, y0, k: y0 * np_exp(k * x),
            "p0": lambda np, x, y: [float(np.min(np.abs(y))) + 1e-9, 0.1],
            "bounds": None,
            "derived": lambda np, p: [("Doubling time", float(np.log(2) / p[1])) if p[1] > 0 else ("Doubling time", None)],
            "cite": "Exponential (Malthusian) growth.",
        },
        # ── Growth ───────────────────────────────────────────────────────────
        "gompertz": {
            "title": "Gompertz growth", "family": "Growth",
            "params": ["Asymptote", "Displacement", "Rate"], "logx": False,
            "fn": lambda x, a, b, c: a * np_exp(-b * np_exp(-c * x)),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, 2.0, 1.0 / (float(np.median(x)) + 1e-9)],
            "bounds": ([0.0, 0.0, 0.0], [inf, inf, inf]),
            "cite": "Gompertz growth model.",
        },
        "logistic_growth": {
            "title": "Logistic growth", "family": "Growth",
            "params": ["Capacity", "Rate", "Midpoint"], "logx": False,
            "fn": lambda x, k, r, x0: k / (1 + np_exp(-r * (x - x0))),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, 1.0, float(np.median(x))],
            "bounds": ([0.0, 0.0, -inf], [inf, inf, inf]),
            "cite": "Logistic (sigmoidal) growth model.",
        },
        # ── Enzyme kinetics (sigmoidal / inhibition) ─────────────────────────
        "allosteric": {
            "title": "Allosteric sigmoidal", "family": "Enzyme kinetics",
            "params": ["Vmax", "Khalf", "h"], "logx": False,
            "fn": lambda x, vmax, khalf, h: vmax * x ** h / (khalf ** h + x ** h),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9, 1.5],
            "bounds": ([0.0, 1e-9, 1e-3], [inf, inf, inf]),
            "cite": "Allosteric sigmoidal enzyme kinetics (Hill form).",
        },
        "substrate_inhibition": {
            "title": "Substrate inhibition", "family": "Enzyme kinetics",
            "params": ["Vmax", "KM", "Ki"], "logx": False,
            "fn": lambda x, vmax, km, ki: vmax * x / (km + x * (1 + x / ki)),
            "p0": lambda np, x, y: [float(np.max(y)) * 2 + 1e-9, float(np.median(x)) + 1e-9, float(np.max(x)) * 5 + 1e-9],
            "bounds": ([0.0, 0.0, 1e-9], [inf, inf, inf]),
            "cite": "Substrate-inhibition enzyme kinetics.",
        },
        # ── Binding (Hill) ───────────────────────────────────────────────────
        "hill_binding": {
            "title": "Specific binding with Hill slope", "family": "Binding",
            "params": ["Bmax", "Kd", "h"], "logx": False,
            "fn": lambda x, bmax, kd, h: bmax * x ** h / (kd ** h + x ** h),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([0.0, 1e-9, 1e-3], [inf, inf, inf]),
            "cite": "Specific binding with a Hill slope.",
        },
        # ── Exponential (two-phase) ──────────────────────────────────────────
        "exp_decay2": {
            "title": "Two-phase decay", "family": "Exponential",
            "params": ["Plateau", "SpanFast", "Kfast", "SpanSlow", "Kslow"], "logx": False,
            "fn": lambda x, plateau, sf, kf, ss, ks: plateau + sf * np_exp(-kf * x) + ss * np_exp(-ks * x),
            "p0": _p0_decay2,
            "bounds": ([-inf, -inf, 0.0, -inf, 0.0], [inf, inf, inf, inf, inf]),
            "cite": "Two-phase (bi-exponential) decay; bi-exponentials are sensitive to the initial values.",
        },
        # ── Sigmoidal (linear-x Boltzmann) ───────────────────────────────────
        "boltzmann": {
            "title": "Boltzmann sigmoid", "family": "Sigmoidal",
            "params": ["Bottom", "Top", "V50", "Slope"], "logx": False,
            "fn": lambda x, bottom, top, v50, slope: bottom + (top - bottom) / (1 + np_exp((v50 - x) / slope)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)), (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9],
            "bounds": None,
            "cite": "Boltzmann sigmoidal (e.g. voltage activation).",
        },
        # ── Polynomial ───────────────────────────────────────────────────────
        "poly2": {
            "title": "Polynomial (quadratic)", "family": "Polynomial",
            "params": ["B0", "B1", "B2"], "logx": False,
            "fn": lambda x, b0, b1, b2: b0 + b1 * x + b2 * x ** 2,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x, y, 2)[::-1]],
            "bounds": None,
            "cite": "Second-order polynomial (least squares).",
        },
        "poly3": {
            "title": "Polynomial (cubic)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3"], "logx": False,
            "fn": lambda x, b0, b1, b2, b3: b0 + b1 * x + b2 * x ** 2 + b3 * x ** 3,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x, y, 3)[::-1]],
            "bounds": None,
            "cite": "Third-order polynomial (least squares).",
        },
        # ── Lines ────────────────────────────────────────────────────────────
        "line_origin": {
            "title": "Line through the origin", "family": "Lines",
            "params": ["Slope"], "logx": False,
            "fn": lambda x, slope: slope * x,
            "p0": lambda np, x, y: [float(np.sum(x * y) / (np.sum(x * x) + 1e-12))],
            "bounds": None,
            "cite": "Linear fit constrained through (0, 0).",
        },
        # ── Peak ─────────────────────────────────────────────────────────────
        "gaussian": {
            "title": "Gaussian", "family": "Peak",
            "params": ["Amplitude", "Mean", "SD"], "logx": False,
            "fn": lambda x, amp, mu, sigma: amp * np_exp(-((x - mu) ** 2) / (2 * sigma ** 2)),
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 4 + 1e-9],
            "bounds": ([-inf, -inf, 1e-9], [inf, inf, inf]),
            "cite": "Gaussian peak.",
        },
        "lorentzian": {
            "title": "Lorentzian", "family": "Peak",
            "params": ["Amplitude", "Center", "Width"], "logx": False,
            "fn": lambda x, amp, c, w: amp / (1 + ((x - c) / w) ** 2),
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 4 + 1e-9],
            "bounds": ([-inf, -inf, 1e-9], [inf, inf, inf]),
            "cite": "Lorentzian (Cauchy) peak.",
        },
        # ── Binding (multi-site / nonspecific) — curve-fit models ──────────────────────────
        "twosite": {
            "title": "Two-site specific binding", "family": "Binding",
            "params": ["Bmax1", "Kd1", "Bmax2", "Kd2"], "logx": False,
            "fn": lambda x, b1, k1, b2, k2: b1 * x / (k1 + x) + b2 * x / (k2 + x),
            "p0": lambda np, x, y: [float(np.max(y)) * 0.6 + 1e-9, float(np.median(x)) * 0.3 + 1e-9,
                                    float(np.max(y)) * 0.6 + 1e-9, float(np.median(x)) * 3 + 1e-9],
            "bounds": ([0.0, 0.0, 0.0, 0.0], [inf, inf, inf, inf]),
            "cite": "Two independent binding sites (sum of two hyperbolas).",
        },
        "onesite_ns": {
            "title": "One-site binding + nonspecific", "family": "Binding",
            "params": ["Bmax", "Kd", "NS"], "logx": False,
            "fn": lambda x, bmax, kd, ns: bmax * x / (kd + x) + ns * x,
            "p0": lambda np, x, y: [float(np.max(y)) * 0.8 + 1e-9, float(np.median(x)) + 1e-9, 1e-3],
            "bounds": ([0.0, 0.0, -inf], [inf, inf, inf]),
            "cite": "Specific (saturable) binding plus a linear nonspecific component.",
        },
        "hyperbola_offset": {
            "title": "Hyperbola with offset", "family": "Binding",
            "params": ["Background", "Bmax", "Kd"], "logx": False,
            "fn": lambda x, bg, bmax, kd: bg + bmax * x / (kd + x),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)) - float(np.min(y)) + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": None,
            "cite": "Rectangular hyperbola with a non-zero baseline.",
        },
        # ── Dose-response (X = concentration, not log) ───────────────────────
        "dr_3pl_conc": {
            "title": "Dose-response 3PL (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "EC50"], "logx": False,
            "fn": lambda x, bottom, top, ec50: bottom + (top - bottom) * x / (ec50 + x),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9],
            "bounds": None,
            "cite": "Three-parameter dose-response with concentration (not log) on X.",
        },
        "dr_4pl_conc": {
            "title": "Dose-response 4PL (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "EC50", "Hill slope"], "logx": False,
            "fn": lambda x, bottom, top, ec50, h: bottom + (top - bottom) * x ** h / (ec50 ** h + x ** h),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([-inf, -inf, 1e-12, 1e-3], [inf, inf, inf, inf]),
            "cite": "Four-parameter (Hill) dose-response with concentration on X.",
        },
        # ── Exponential (two-phase association) ──────────────────────────────
        "biexp_assoc": {
            "title": "Two-phase association", "family": "Exponential",
            "params": ["Y0", "SpanFast", "Kfast", "SpanSlow", "Kslow"], "logx": False,
            "fn": lambda x, y0, sf, kf, ss, ks: y0 + sf * (1 - np_exp(-kf * x)) + ss * (1 - np_exp(-ks * x)),
            "p0": lambda np, x, y: [float(y[0]), (float(y[-1]) - float(y[0])) * 0.6, 4.0 / (float(np.median(x)) + 1e-9),
                                    (float(y[-1]) - float(y[0])) * 0.4, 0.4 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, 0.0, -inf, 0.0], [inf, inf, inf, inf, inf]),
            "cite": "Two-phase exponential association (fast + slow).",
        },
        # ── Growth ───────────────────────────────────────────────────────────
        "richards": {
            "title": "Richards (generalized logistic) growth", "family": "Growth",
            "params": ["Asymptote", "Rate", "Midpoint", "Shape"], "logx": False,
            "fn": lambda x, a, k, xm, nu: a / (1 + nu * np_exp(-k * (x - xm))) ** (1.0 / nu),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, 1.0, float(np.median(x)), 1.0],
            "bounds": ([0.0, 0.0, -inf, 1e-3], [inf, inf, inf, inf]),
            "cite": "Richards generalized-logistic growth curve.",
        },
        "weibull_growth": {
            "title": "Weibull growth", "family": "Growth",
            "params": ["Asymptote", "Scale", "Shape"], "logx": False,
            "fn": lambda x, a, lam, k: a * (1 - np_exp(-(x / lam) ** k)),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, float(np.median(x)) + 1e-9, 1.5],
            "bounds": ([0.0, 1e-9, 1e-3], [inf, inf, inf]),
            "cite": "Weibull growth curve (x ≥ 0).",
        },
        "von_bertalanffy": {
            "title": "Von Bertalanffy growth", "family": "Growth",
            "params": ["Linf", "K", "t0"], "logx": False,
            "fn": lambda x, linf, k, t0: linf * (1 - np_exp(-k * (x - t0))),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, 0.3, float(np.min(x)) - 1.0],
            "bounds": None,
            "cite": "Von Bertalanffy growth (fisheries / biology).",
        },
        # ── Peak (baseline / asymmetric / periodic) ──────────────────────────
        "gaussian_baseline": {
            "title": "Gaussian with baseline", "family": "Peak",
            "params": ["Baseline", "Amplitude", "Mean", "SD"], "logx": False,
            "fn": lambda x, base, amp, mu, sigma: base + amp * np_exp(-((x - mu) ** 2) / (2 * sigma ** 2)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)) - float(np.min(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 4 + 1e-9],
            "bounds": ([-inf, -inf, -inf, 1e-9], [inf, inf, inf, inf]),
            "cite": "Gaussian peak on a flat baseline.",
        },
        "lognormal_peak": {
            "title": "Log-normal peak", "family": "Peak",
            "params": ["Amplitude", "Center", "Width"], "logx": False,
            "fn": lambda x, amp, c, w: amp * np_exp(-(np_log(x / c) ** 2) / (2 * w ** 2)),
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]) + 1e-9, 0.5],
            "bounds": ([-inf, 1e-9, 1e-6], [inf, inf, inf]),
            "cite": "Log-normal (asymmetric) peak; x > 0.",
        },
        "sine": {
            "title": "Sine wave", "family": "Periodic",
            "params": ["Amplitude", "Period", "Phase", "Offset"], "logx": False,
            "fn": lambda x, amp, period, phase, off: off + amp * np_sin(6.283185307179586 * x / period + phase),
            "p0": lambda np, x, y: [(float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, (float(np.max(x)) - float(np.min(x))) / 2 + 1e-9, 0.0, float(np.mean(y))],
            "bounds": None,
            "cite": "Sinusoid A·sin(2πx/period + phase) + offset.",
        },
        # ── Polynomial (higher order) ────────────────────────────────────────
        "poly4": {
            "title": "Polynomial (quartic)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4"], "logx": False,
            "fn": lambda x, b0, b1, b2, b3, b4: b0 + b1 * x + b2 * x ** 2 + b3 * x ** 3 + b4 * x ** 4,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x, y, 4)[::-1]],
            "bounds": None,
            "cite": "Fourth-order polynomial (least squares).",
        },
        "poly5": {
            "title": "Polynomial (quintic)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4", "B5"], "logx": False,
            "fn": lambda x, b0, b1, b2, b3, b4, b5: b0 + b1 * x + b2 * x ** 2 + b3 * x ** 3 + b4 * x ** 4 + b5 * x ** 5,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x, y, 5)[::-1]],
            "bounds": None,
            "cite": "Fifth-order polynomial (least squares).",
        },
        # ── Power ────────────────────────────────────────────────────────────
        "power": {
            "title": "Power law", "family": "Power",
            "params": ["A", "B"], "logx": False,
            "fn": lambda x, a, b: a * x ** b,
            "p0": lambda np, x, y: [float(np.max(np.abs(y))) / (float(np.max(x)) + 1e-9) + 1e-9, 1.0],
            "bounds": None,
            "cite": "Power law A·x^B (x > 0).",
        },
        "power_offset": {
            "title": "Power law with offset", "family": "Power",
            "params": ["A", "B", "C"], "logx": False,
            "fn": lambda x, a, b, c: a * x ** b + c,
            "p0": lambda np, x, y: [1.0, 1.0, float(np.min(y))],
            "bounds": None,
            "cite": "Power law A·x^B + C (x > 0).",
        },
        # ── curve-fit models ─────────────────────────────────────────────────
        # Exponential
        "exp_linear": {
            "title": "Exponential decay + linear drift", "family": "Exponential",
            "params": ["A", "K", "B", "C"], "logx": False,
            "fn": lambda x, a, k, b, c: a * np_exp(-k * x) + b * x + c,
            "p0": lambda np, x, y: [float(y[0]) - float(y[-1]), 1.0 / (float(np.median(x)) + 1e-9),
                                    (float(y[-1]) - float(y[0])) / (float(np.max(x)) - float(np.min(x)) + 1e-9), float(y[-1])],
            "bounds": ([-inf, 0.0, -inf, -inf], [inf, inf, inf, inf]),
            "cite": "One-phase decay superimposed on a linear drift.",
        },
        "exp_decay3": {
            "title": "Three-phase decay", "family": "Exponential",
            "params": ["Plateau", "Span1", "K1", "Span2", "K2", "Span3", "K3"], "logx": False,
            "fn": lambda x, p, s1, k1, s2, k2, s3, k3: p + s1 * np_exp(-k1 * x) + s2 * np_exp(-k2 * x) + s3 * np_exp(-k3 * x),
            "p0": lambda np, x, y: [float(y[-1]), (float(y[0]) - float(y[-1])) * 0.5, 8.0 / (float(np.median(x)) + 1e-9),
                                    (float(y[0]) - float(y[-1])) * 0.3, 1.0 / (float(np.median(x)) + 1e-9),
                                    (float(y[0]) - float(y[-1])) * 0.2, 0.15 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, 0.0, -inf, 0.0, -inf, 0.0], [inf, inf, inf, inf, inf, inf, inf]),
            "cite": "Three-phase (tri-exponential) decay; needs well-separated rates + good initial values.",
        },
        "stretched_exp": {
            "title": "Stretched exponential (Kohlrausch)", "family": "Exponential",
            "params": ["Amplitude", "Tau", "Beta"], "logx": False,
            "fn": lambda x, a, tau, beta: a * np_exp(-(x / tau) ** beta),
            "p0": lambda np, x, y: [float(y[0]) + 1e-9, float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([0.0, 1e-9, 1e-3], [inf, inf, inf]),
            "cite": "Stretched-exponential (KWW) relaxation; x ≥ 0.",
        },
        # Growth
        "logistic4_growth": {
            "title": "Logistic growth (4-parameter)", "family": "Growth",
            "params": ["Bottom", "Top", "Rate", "Midpoint"], "logx": False,
            "fn": lambda x, bottom, top, rate, mid: bottom + (top - bottom) / (1 + np_exp(-rate * (x - mid))),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), 1.0, float(np.median(x))],
            "bounds": None,
            "cite": "Four-parameter logistic growth (lower + upper asymptote).",
        },
        "gompertz4": {
            "title": "Gompertz (4-parameter)", "family": "Growth",
            "params": ["Offset", "Span", "Rate", "Inflection"], "logx": False,
            "fn": lambda x, off, span, k, xi: off + span * np_exp(-np_exp(-k * (x - xi))),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)) - float(np.min(y)), 1.0 / (float(np.median(x)) + 1e-9), float(np.median(x))],
            "bounds": ([-inf, 0.0, 0.0, -inf], [inf, inf, inf, inf]),
            "cite": "Gompertz growth with a lower offset + inflection point.",
        },
        "chapman_richards": {
            "title": "Chapman-Richards growth", "family": "Growth",
            "params": ["Asymptote", "Rate", "Shape"], "logx": False,
            "fn": lambda x, a, k, c: a * (1 - np_exp(-k * x)) ** c,
            "p0": lambda np, x, y: [float(np.max(y)) * 1.05 + 1e-9, 0.3, 1.0],
            "bounds": ([0.0, 0.0, 1e-3], [inf, inf, inf]),
            "cite": "Chapman-Richards growth (x ≥ 0).",
        },
        # Dose-response (inhibition, X = concentration)
        "ic50_4pl_conc": {
            "title": "Inhibition 4PL (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "IC50", "Hill slope"], "logx": False,
            "fn": lambda x, bottom, top, ic50, h: bottom + (top - bottom) / (1 + (x / ic50) ** h),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([-inf, -inf, 1e-12, 1e-3], [inf, inf, inf, inf]),
            "cite": "Four-parameter inhibition dose-response (decreasing), concentration on X.",
        },
        # Peak
        "gaussian2": {
            "title": "Sum of two Gaussians", "family": "Peak",
            "params": ["Amp1", "Mean1", "SD1", "Amp2", "Mean2", "SD2"], "logx": False,
            "fn": lambda x, a1, m1, s1, a2, m2, s2: a1 * np_exp(-((x - m1) ** 2) / (2 * s1 ** 2)) + a2 * np_exp(-((x - m2) ** 2) / (2 * s2 ** 2)),
            "p0": lambda np, x, y: [float(np.max(y)), float(np.min(x)) + (float(np.max(x)) - float(np.min(x))) / 3, (float(np.max(x)) - float(np.min(x))) / 8 + 1e-9,
                                    float(np.max(y)), float(np.min(x)) + 2 * (float(np.max(x)) - float(np.min(x))) / 3, (float(np.max(x)) - float(np.min(x))) / 8 + 1e-9],
            "bounds": ([-inf, -inf, 1e-9, -inf, -inf, 1e-9], [inf, inf, inf, inf, inf, inf]),
            "cite": "Two overlapping Gaussian peaks.",
        },
        "pseudo_voigt": {
            "title": "Pseudo-Voigt peak", "family": "Peak",
            "params": ["Amplitude", "Center", "Width", "Eta"], "logx": False,
            "fn": lambda x, amp, c, w, eta: eta * (amp / (1 + ((x - c) / w) ** 2)) + (1 - eta) * (amp * np_exp(-((x - c) ** 2) / (2 * w ** 2))),
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 4 + 1e-9, 0.5],
            "bounds": ([-inf, -inf, 1e-9, 0.0], [inf, inf, inf, 1.0]),
            "cite": "Pseudo-Voigt: a linear blend (Eta) of Lorentzian + Gaussian.",
        },
        # Periodic
        "damped_sine": {
            "title": "Damped sine wave", "family": "Periodic",
            "params": ["Amplitude", "Decay", "Period", "Phase", "Offset"], "logx": False,
            "fn": lambda x, amp, decay, period, phase, off: off + amp * np_exp(-decay * x) * np_sin(6.283185307179586 * x / period + phase),
            "p0": lambda np, x, y: [(float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, 0.1, (float(np.max(x)) - float(np.min(x))) / 3 + 1e-9, 0.0, float(np.mean(y))],
            "bounds": ([-inf, 0.0, 1e-9, -inf, -inf], [inf, inf, inf, inf, inf]),
            "cite": "Exponentially-damped sinusoid.",
        },
        # Simple functional forms
        "logarithmic": {
            "title": "Logarithmic", "family": "Simple",
            "params": ["A", "B"], "logx": False,
            "fn": lambda x, a, b: a + b * np_log(x),
            "p0": lambda np, x, y: [float(np.mean(y)), 1.0],
            "bounds": None,
            "cite": "Logarithmic A + B·ln(x); x > 0.",
        },
        "reciprocal": {
            "title": "Reciprocal", "family": "Simple",
            "params": ["A", "B"], "logx": False,
            "fn": lambda x, a, b: a + b / x,
            "p0": lambda np, x, y: [float(np.mean(y)), 1.0],
            "bounds": None,
            "cite": "Reciprocal A + B/x; x ≠ 0.",
        },
        "rational11": {
            "title": "Rational (1,1)", "family": "Simple",
            "params": ["A", "B", "C"], "logx": False,
            "fn": lambda x, a, b, c: (a + b * x) / (1 + c * x),
            "p0": lambda np, x, y: [float(y[0]), 1.0, 0.1],
            "bounds": None,
            "cite": "First-order rational (Padé 1/1): (A + B·x)/(1 + C·x).",
        },
        "sqrt_fit": {
            "title": "Square-root", "family": "Simple",
            "params": ["A", "B"], "logx": False,
            "fn": lambda x, a, b: a + b * x ** 0.5,
            "p0": lambda np, x, y: [float(y[0]), 1.0],
            "bounds": None,
            "cite": "Square-root A + B·√x; x ≥ 0.",
        },
        # Polynomial
        "poly6": {
            "title": "Polynomial (sextic)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4", "B5", "B6"], "logx": False,
            "fn": lambda x, b0, b1, b2, b3, b4, b5, b6: b0 + b1 * x + b2 * x ** 2 + b3 * x ** 3 + b4 * x ** 4 + b5 * x ** 5 + b6 * x ** 6,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x, y, 6)[::-1]],
            "bounds": None,
            "cite": "Sixth-order polynomial (least squares).",
        },
        # ── curve-fit models ─────────────────────────────────────────────────
        # Dose-response — normalized response (Bottom/Top fixed at 0/100)
        "dr_norm_3pl": {
            "title": "Dose-response, normalized (constant slope)", "family": "Dose-response",
            "params": ["logEC50"], "logx": True,
            "fn": lambda lx, logec50: 100.0 / (1 + 10 ** (logec50 - lx)),
            "p0": lambda np, lx, y: [float(np.median(lx))],
            "bounds": None,
            "derived": lambda np, p: [("EC50", float(10 ** p[0]))], "ecf": "EC",
            "cite": "Normalized (0–100%) dose-response with a constant Hill slope of 1.",
        },
        "dr_norm_4pl": {
            "title": "Dose-response, normalized (variable slope)", "family": "Dose-response",
            "params": ["logEC50", "Hill slope"], "logx": True,
            "fn": lambda lx, logec50, hill: 100.0 / (1 + 10 ** ((logec50 - lx) * hill)),
            "p0": lambda np, lx, y: [float(np.median(lx)), 1.0],
            "bounds": None,
            "derived": lambda np, p: [("EC50", float(10 ** p[0]))], "ecf": "EC",
            "cite": "Normalized (0–100%) variable-slope dose-response.",
        },
        "dr_norm_4pl_conc": {
            "title": "Dose-response, normalized (variable slope, X = concentration)", "family": "Dose-response",
            "params": ["EC50", "Hill slope"], "logx": False,
            "fn": lambda x, ec50, hill: 100.0 * x ** hill / (ec50 ** hill + x ** hill),
            "p0": lambda np, x, y: [float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([1e-12, 1e-3], [inf, inf]),
            "cite": "Normalized (0–100%) variable-slope dose-response, concentration on X.",
        },
        # Dose-response — normalized inhibition (Bottom/Top fixed at 0/100). The fitted
        # IC50 is then the absolute IC50 — the concentration at 50% of the defined 0–100%
        # range (the "absolute IC50"), mirroring the normalized stimulation set above.
        "ic50_norm_4pl": {
            "title": "Inhibition, normalized (variable slope)", "family": "Dose-response",
            "params": ["logIC50", "Hill slope"], "logx": True,
            "fn": lambda lx, logic50, hill: 100.0 / (1 + 10 ** ((lx - logic50) * hill)),
            "p0": lambda np, lx, y: [float(np.median(lx)), 1.0],
            "bounds": None,
            "derived": lambda np, p: [("IC50", float(10 ** p[0]))], "ecf": "IC",
            "cite": "Normalized (100→0%) variable-slope inhibition; the fitted IC50 is the absolute IC50 (50% of the 0–100% range).",
        },
        "ic50_norm_3pl": {
            "title": "Inhibition, normalized (constant slope)", "family": "Dose-response",
            "params": ["logIC50"], "logx": True,
            "fn": lambda lx, logic50: 100.0 / (1 + 10 ** (lx - logic50)),
            "p0": lambda np, lx, y: [float(np.median(lx))],
            "bounds": None,
            "derived": lambda np, p: [("IC50", float(10 ** p[0]))], "ecf": "IC",
            "cite": "Normalized (100→0%) constant-slope inhibition; the fitted IC50 is the absolute IC50 (50% of the 0–100% range).",
        },
        # Dose-response — inhibition (decreasing; reports IC50)
        "ic50_4pl_log": {
            "title": "Inhibition 4PL (log inhibitor, IC50)", "family": "Dose-response",
            "params": ["Bottom", "Top", "logIC50", "Hill slope"], "logx": True,
            "fn": lambda lx, bottom, top, logic50, hill: bottom + (top - bottom) / (1 + 10 ** ((lx - logic50) * hill)),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx)), 1.0],
            "bounds": None,
            "derived": lambda np, p: [("IC50", float(10 ** p[2]))], "ecf": "IC",
            "cite": "Four-parameter inhibition dose-response on log10(inhibitor); IC50 from the fit.",
        },
        "ic50_3pl_log": {
            "title": "Inhibition 3PL (log inhibitor, IC50)", "family": "Dose-response",
            "params": ["Bottom", "Top", "logIC50"], "logx": True,
            "fn": lambda lx, bottom, top, logic50: bottom + (top - bottom) / (1 + 10 ** (lx - logic50)),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx))],
            "bounds": None,
            "derived": lambda np, p: [("IC50", float(10 ** p[2]))], "ecf": "IC",
            "cite": "Three-parameter (constant-slope) inhibition on log10(inhibitor); IC50 from the fit.",
        },
        "ic50_3pl_conc": {
            "title": "Inhibition 3PL (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "IC50"], "logx": False,
            "fn": lambda x, bottom, top, ic50: bottom + (top - bottom) / (1 + x / ic50),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9],
            "bounds": ([-inf, -inf, 1e-12], [inf, inf, inf]),
            "cite": "Three-parameter inhibition dose-response with concentration on X.",
        },
        "dr_5pl_conc": {
            "title": "Dose-response 5PL, asymmetric (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "EC50", "Hill slope", "Asymmetry"], "logx": False,
            "fn": lambda x, bottom, top, ec50, hill, s: bottom + (top - bottom) / (1 + (ec50 / x) ** hill) ** s,
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9, 1.0, 1.0],
            "bounds": ([-inf, -inf, 1e-12, 1e-3, 1e-3], [inf, inf, inf, inf, inf]),
            "cite": "Five-parameter (asymmetric) dose-response with concentration on X.",
        },
        "biphasic_dr": {
            "title": "Biphasic dose-response", "family": "Dose-response",
            "params": ["Bottom", "Top", "Frac", "logEC50_1", "nH1", "logEC50_2", "nH2"], "logx": True,
            "fn": lambda lx, bottom, top, frac, le1, h1, le2, h2: bottom + (top - bottom) * (
                frac / (1 + 10 ** ((le1 - lx) * h1)) + (1 - frac) / (1 + 10 ** ((le2 - lx) * h2))),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), 0.5,
                                     float(np.percentile(lx, 25)), 1.0, float(np.percentile(lx, 75)), 1.0],
            "bounds": ([-inf, -inf, 0.0, -inf, 1e-3, -inf, 1e-3], [inf, inf, 1.0, inf, inf, inf, inf]),
            "derived": lambda np, p: [("EC50_1", float(10 ** p[3])), ("EC50_2", float(10 ** p[5]))],
            "cite": "Biphasic dose-response (two logistic components); needs well-separated EC50s.",
        },
        "bell_dr": {
            "title": "Bell-shaped dose-response", "family": "Dose-response",
            "params": ["Base", "Amplitude", "logEC50_up", "nH_up", "logEC50_down", "nH_down"], "logx": True,
            "fn": lambda lx, base, amp, leu, hu, led, hd: base + amp * (
                1.0 / (1 + 10 ** ((leu - lx) * hu))) * (1.0 / (1 + 10 ** ((lx - led) * hd))),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)) - float(np.min(y)),
                                     float(np.percentile(lx, 25)), 1.0, float(np.percentile(lx, 75)), 1.0],
            "bounds": ([-inf, -inf, -inf, 1e-3, -inf, 1e-3], [inf, inf, inf, inf, inf, inf]),
            "derived": lambda np, p: [("EC50_up", float(10 ** p[2])), ("EC50_down", float(10 ** p[4]))],
            "cite": "Bell-shaped dose-response (rise then fall); rising EC50 below falling EC50.",
        },
        # Binding — competition (X = log[competitor]) + total binding
        "competition_1site": {
            "title": "One-site competitive binding (log inhibitor)", "family": "Binding",
            "params": ["Bottom", "Top", "logIC50"], "logx": False,
            "fn": lambda x, bottom, top, logic50: bottom + (top - bottom) / (1 + 10 ** (x - logic50)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x))],
            "bounds": None,
            "derived": lambda np, p: [("IC50", float(10 ** p[2]))],
            "cite": "One-site competitive radioligand binding; X = log[competitor], IC50 from the fit.",
        },
        "competition_2site": {
            "title": "Two-site competitive binding (log inhibitor)", "family": "Binding",
            "params": ["Bottom", "Top", "Frac1", "logIC50_1", "logIC50_2"], "logx": False,
            "fn": lambda x, bottom, top, frac1, li1, li2: bottom + (top - bottom) * (
                frac1 / (1 + 10 ** (x - li1)) + (1 - frac1) / (1 + 10 ** (x - li2))),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), 0.5,
                                    float(np.percentile(x, 25)), float(np.percentile(x, 75))],
            "bounds": ([-inf, -inf, 0.0, -inf, -inf], [inf, inf, 1.0, inf, inf]),
            "derived": lambda np, p: [("IC50_1", float(10 ** p[3])), ("IC50_2", float(10 ** p[4]))],
            "cite": "Two-site competitive binding; X = log[competitor], two IC50s.",
        },
        "total_binding": {
            "title": "One-site total binding (specific + nonspecific)", "family": "Binding",
            "params": ["Bmax", "Kd", "NS", "Background"], "logx": False,
            "fn": lambda x, bmax, kd, ns, bg: bg + bmax * x / (kd + x) + ns * x,
            "p0": lambda np, x, y: [float(np.max(y)) * 0.7 + 1e-9, float(np.median(x)) + 1e-9, 1e-3, float(np.min(y))],
            "bounds": ([0.0, 0.0, -inf, -inf], [inf, inf, inf, inf]),
            "cite": "One-site specific binding plus a linear nonspecific term plus a background.",
        },
        # Exponential — a plateau followed by a phase (piecewise at X0)
        "plateau_then_decay": {
            "title": "Plateau then one-phase decay", "family": "Exponential",
            "params": ["X0", "Y0", "Plateau", "K"], "logx": False,
            "fn": lambda x, x0, y0, plateau, k: np_where(x < x0, y0, plateau + (y0 - plateau) * np_exp(-k * (x - x0))),
            "p0": lambda np, x, y: [float(np.min(x)) + (float(np.max(x)) - float(np.min(x))) * 0.25,
                                    float(np.max(y)), float(y[-1]), 1.0 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, -inf, 0.0], [inf, inf, inf, inf]),
            "derived": lambda np, p: [("Half-life", float(np.log(2) / p[3])) if p[3] > 0 else ("Half-life", None)],
            "cite": "A flat plateau (Y = Y0) until X0, then one-phase exponential decay.",
        },
        "plateau_then_assoc": {
            "title": "Plateau then one-phase association", "family": "Exponential",
            "params": ["X0", "Y0", "Plateau", "K"], "logx": False,
            "fn": lambda x, x0, y0, plateau, k: np_where(x < x0, y0, y0 + (plateau - y0) * (1 - np_exp(-k * (x - x0)))),
            "p0": lambda np, x, y: [float(np.min(x)) + (float(np.max(x)) - float(np.min(x))) * 0.25,
                                    float(np.min(y)), float(y[-1]), 1.0 / (float(np.median(x)) + 1e-9)],
            "bounds": ([-inf, -inf, -inf, 0.0], [inf, inf, inf, inf]),
            "cite": "A flat plateau (Y = Y0) until X0, then one-phase exponential association.",
        },
        # Binding kinetics — association then dissociation (rise then fall)
        "assoc_then_dissoc": {
            "title": "Association then dissociation", "family": "Binding",
            "params": ["Amplitude", "Kon", "Koff", "Baseline"], "logx": False,
            "fn": lambda x, amp, kon, koff, base: base + amp * (np_exp(-koff * x) - np_exp(-kon * x)),
            "p0": lambda np, x, y: [float(np.max(y)) - float(np.min(y)) + 1e-9, 1.0, 0.2, float(np.min(y))],
            "bounds": ([-inf, 1e-9, 1e-9, -inf], [inf, inf, inf, inf]),
            "cite": "Association then dissociation (rise then fall); a difference of two exponentials.",
        },
        # Lines — segmental / broken-line (piecewise at X0)
        "segmental": {
            "title": "Segmental (broken-line) regression", "family": "Lines",
            "params": ["X0", "Y0", "Slope1", "Slope2"], "logx": False,
            "fn": lambda x, x0, y0, s1, s2: np_where(x < x0, y0 + s1 * (x - x0), y0 + s2 * (x - x0)),
            "p0": lambda np, x, y: [float(np.median(x)), float(np.mean(y)),
                                    float(np.polyfit(x, y, 1)[0]), float(np.polyfit(x, y, 1)[0])],
            "bounds": None,
            "cite": "Two-segment broken-line (hockey-stick); the break is at X0.",
        },
        # Growth — Morgan-Mercer-Flodin
        "mmf_growth": {
            "title": "Morgan-Mercer-Flodin growth", "family": "Growth",
            "params": ["Y0", "Asymptote", "K", "Shape"], "logx": False,
            "fn": lambda x, y0, asy, k, shape: (y0 * k + asy * x ** shape) / (k + x ** shape),
            "p0": lambda np, x, y: [float(y[0]), float(np.max(y)) * 1.05 + 1e-9,
                                    (float(np.median(x)) + 1e-9) ** 1.5, 1.5],
            "bounds": ([-inf, -inf, 1e-9, 1e-3], [inf, inf, inf, inf]),
            "cite": "Morgan-Mercer-Flodin (MMF) growth; Y0 at X = 0 rising to an asymptote.",
        },
        # Peak — three overlapping Gaussians
        "gaussian3": {
            "title": "Sum of three Gaussians", "family": "Peak",
            "params": ["Amp1", "Mean1", "SD1", "Amp2", "Mean2", "SD2", "Amp3", "Mean3", "SD3"], "logx": False,
            "fn": lambda x, a1, m1, s1, a2, m2, s2, a3, m3, s3: (
                a1 * np_exp(-((x - m1) ** 2) / (2 * s1 ** 2))
                + a2 * np_exp(-((x - m2) ** 2) / (2 * s2 ** 2))
                + a3 * np_exp(-((x - m3) ** 2) / (2 * s3 ** 2))),
            "p0": lambda np, x, y: [
                float(np.max(y)), float(np.min(x)) + (float(np.max(x)) - float(np.min(x))) / 4, (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9,
                float(np.max(y)), float(np.min(x)) + (float(np.max(x)) - float(np.min(x))) / 2, (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9,
                float(np.max(y)), float(np.min(x)) + 3 * (float(np.max(x)) - float(np.min(x))) / 4, (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9],
            "bounds": ([-inf, -inf, 1e-9, -inf, -inf, 1e-9, -inf, -inf, 1e-9],
                       [inf, inf, inf, inf, inf, inf, inf, inf, inf]),
            "cite": "Three overlapping Gaussian peaks.",
        },
        # ── curve-fit models ─────────────────────────────────────────────────
        # Enzyme kinetics — tight-binding inhibition
        "morrison_ki": {
            "title": "Morrison tight-binding Ki", "family": "Enzyme kinetics",
            "params": ["V0", "Et", "Ki"], "logx": False,
            "fn": lambda x, v0, et, ki: v0 * (1 - ((et + x + ki) - np_where((et + x + ki) ** 2 - 4 * et * x < 0, 0.0, (et + x + ki) ** 2 - 4 * et * x) ** 0.5) / (2 * et)),
            "p0": lambda np, x, y: [float(np.max(y)), float(np.median(x)) * 0.5 + 1e-9, float(np.median(x)) * 0.5 + 1e-9],
            "bounds": ([1e-12, 1e-12, 1e-12], [inf, inf, inf]),
            "cite": "Morrison equation for tight-binding enzyme inhibition (velocity vs [inhibitor]).",
        },
        # Binding — ligand depletion (bound solves a quadratic in free ligand)
        "binding_depletion": {
            "title": "One-site binding with ligand depletion", "family": "Binding",
            "params": ["Bmax", "Kd"], "logx": False,
            "fn": lambda x, bmax, kd: 0.5 * ((x + kd + bmax) - np_where((x + kd + bmax) ** 2 - 4 * x * bmax < 0, 0.0, (x + kd + bmax) ** 2 - 4 * x * bmax) ** 0.5),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.1 + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0], [inf, inf]),
            "cite": "One-site specific binding accounting for ligand depletion (X = total added ligand).",
        },
        # Peak — Voigt / EMG / Pearson VII (spectroscopy & chromatography)
        "voigt": {
            "title": "Voigt peak", "family": "Peak",
            "params": ["Amplitude", "Center", "SigmaG", "GammaL"], "logx": False,
            "fn": lambda x, amp, c, s, g: amp * (sp_wofz(((x - c) + 1j * g) / (s * 1.4142135623730951)).real) / (sp_wofz((1j * g) / (s * 1.4142135623730951)).real),
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9, (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9],
            "bounds": ([-inf, -inf, 1e-9, 1e-9], [inf, inf, inf, inf]),
            "cite": "Voigt profile (Gaussian⊗Lorentzian) via the Faddeeva function; Amplitude = peak height.",
        },
        "emg": {
            "title": "Exponentially-modified Gaussian", "family": "Peak",
            "params": ["Amplitude", "Center", "Sigma", "Tau"], "logx": False,
            "fn": lambda x, amp, mu, s, tau: (amp / (2 * tau)) * np_exp(-((x - mu) ** 2) / (2 * s * s)) * sp_erfcx((s / tau - (x - mu) / s) / 1.4142135623730951),
            "p0": lambda np, x, y: [float(np.max(y)) * (float(np.max(x)) - float(np.min(x))) / 6 + 1e-9, float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 12 + 1e-9, (float(np.max(x)) - float(np.min(x))) / 8 + 1e-9],
            "bounds": ([-inf, -inf, 1e-3, 1e-3], [inf, inf, inf, inf]),
            "cite": "Exponentially-modified Gaussian (Gaussian convolved with an exponential) — the classic tailed chromatography peak.",
        },
        "pearson7": {
            "title": "Pearson VII peak", "family": "Peak",
            "params": ["Amplitude", "Center", "Width", "Shape"], "logx": False,
            "fn": lambda x, amp, c, w, m: amp / (1 + ((x - c) / w) ** 2 * (2 ** (1.0 / m) - 1)) ** m,
            "p0": lambda np, x, y: [float(np.max(y)), float(x[int(np.argmax(y))]), (float(np.max(x)) - float(np.min(x))) / 8 + 1e-9, 2.0],
            "bounds": ([-inf, -inf, 1e-9, 0.3], [inf, inf, inf, inf]),
            "cite": "Pearson VII peak (tunable Gaussian↔Lorentzian via the shape exponent).",
        },
        # Periodic — harmonics + drift
        "sine2": {
            "title": "Sum of two harmonics", "family": "Periodic",
            "params": ["Offset", "A1", "Period", "Phase1", "A2", "Phase2"], "logx": False,
            "fn": lambda x, off, a1, period, ph1, a2, ph2: off + a1 * np_sin(6.283185307179586 * x / period + ph1) + a2 * np_sin(12.566370614359172 * x / period + ph2),
            "p0": lambda np, x, y: [float(np.mean(y)), (float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, (float(np.max(x)) - float(np.min(x))) / 2 + 1e-9, 0.0, (float(np.max(y)) - float(np.min(y))) / 4 + 1e-9, 0.0],
            "bounds": None,
            "cite": "Fundamental + second harmonic (Fourier-style two-term sinusoid).",
        },
        "sine_drift": {
            "title": "Sine wave with linear drift", "family": "Periodic",
            "params": ["Offset", "Slope", "Amplitude", "Period", "Phase"], "logx": False,
            "fn": lambda x, off, slope, amp, period, ph: off + slope * x + amp * np_sin(6.283185307179586 * x / period + ph),
            "p0": lambda np, x, y: [float(np.mean(y)), (float(y[-1]) - float(y[0])) / (float(np.max(x)) - float(np.min(x)) + 1e-9), (float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, (float(np.max(x)) - float(np.min(x))) / 2 + 1e-9, 0.0],
            "bounds": None,
            "cite": "Sinusoid superimposed on a linear baseline drift.",
        },
        # Sigmoidal — two transitions
        "boltzmann_double": {
            "title": "Double Boltzmann (two transitions)", "family": "Sigmoidal",
            "params": ["Bottom", "Amp1", "V1", "Slope1", "Amp2", "V2", "Slope2"], "logx": False,
            "fn": lambda x, bot, a1, v1, k1, a2, v2, k2: bot + a1 / (1 + np_exp((v1 - x) / k1)) + a2 / (1 + np_exp((v2 - x) / k2)),
            "p0": lambda np, x, y: [float(np.min(y)), (float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, float(np.percentile(x, 25)), (float(np.max(x)) - float(np.min(x))) / 20 + 1e-9, (float(np.max(y)) - float(np.min(y))) / 2 + 1e-9, float(np.percentile(x, 75)), (float(np.max(x)) - float(np.min(x))) / 20 + 1e-9],
            "bounds": None,
            "cite": "Sum of two Boltzmann sigmoids (e.g. two-component voltage activation).",
        },
        # Power — with an exponential cutoff
        "power_law_cutoff": {
            "title": "Power law with exponential cutoff", "family": "Power",
            "params": ["A", "B", "C"], "logx": False,
            "fn": lambda x, a, b, c: a * x ** b * np_exp(-x / c),
            "p0": lambda np, x, y: [float(np.max(y)) + 1e-9, 1.0, float(np.max(x)) + 1e-9],
            "bounds": ([0.0, -inf, 1e-9], [inf, inf, inf]),
            "cite": "Power law A·x^B with an exponential cutoff exp(−x/C) (x > 0).",
        },
        # Dose-response — probit / Weibull / concentration biphasic·bell·normalized / Richards / hormesis
        "probit_dr": {
            "title": "Probit dose-response (cumulative normal)", "family": "Dose-response",
            "params": ["Bottom", "Top", "Mu", "Sigma"], "logx": False,
            "fn": lambda x, bot, top, mu, sigma: bot + (top - bot) * sp_ndtr((x - mu) / sigma),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)), (float(np.max(x)) - float(np.min(x))) / 6 + 1e-9],
            "bounds": ([-inf, -inf, -inf, 1e-9], [inf, inf, inf, inf]),
            "cite": "Probit (cumulative-normal) dose-response — the classic toxicology/psychophysics sigmoid.",
        },
        "weibull_sigmoid": {
            "title": "Weibull sigmoid dose-response", "family": "Dose-response",
            "params": ["Bottom", "Top", "Scale", "Shape"], "logx": False,
            "fn": lambda x, bot, top, scale, shape: bot + (top - bot) * (1 - np_exp(-(x / scale) ** shape)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)) + 1e-9, 1.5],
            "bounds": ([-inf, -inf, 1e-9, 1e-3], [inf, inf, inf, inf]),
            "cite": "Weibull (asymmetric) sigmoid dose-response (x ≥ 0).",
        },
        "biphasic_dr_conc": {
            "title": "Biphasic dose-response (X = concentration)", "family": "Dose-response",
            "params": ["Bottom", "Top", "Frac", "EC50_1", "nH1", "EC50_2", "nH2"], "logx": False,
            "fn": lambda x, bottom, top, frac, e1, h1, e2, h2: bottom + (top - bottom) * (
                frac / (1 + (e1 / x) ** h1) + (1 - frac) / (1 + (e2 / x) ** h2)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), 0.5,
                                    float(np.percentile(x, 25)) + 1e-9, 1.0, float(np.percentile(x, 75)) + 1e-9, 1.0],
            "bounds": ([-inf, -inf, 0.0, 1e-12, 1e-3, 1e-12, 1e-3], [inf, inf, 1.0, inf, inf, inf, inf]),
            "cite": "Biphasic dose-response (two components), concentration on X.",
        },
        "bell_dr_conc": {
            "title": "Bell-shaped dose-response (X = concentration)", "family": "Dose-response",
            "params": ["Base", "Amplitude", "EC50_up", "nH_up", "EC50_down", "nH_down"], "logx": False,
            "fn": lambda x, base, amp, eu, hu, ed, hd: base + amp * (1.0 / (1 + (eu / x) ** hu)) * (1.0 / (1 + (x / ed) ** hd)),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)) - float(np.min(y)),
                                    float(np.percentile(x, 25)) + 1e-9, 1.0, float(np.percentile(x, 75)) + 1e-9, 1.0],
            "bounds": ([-inf, -inf, 1e-12, 1e-3, 1e-12, 1e-3], [inf, inf, inf, inf, inf, inf]),
            "cite": "Bell-shaped dose-response (rise then fall), concentration on X.",
        },
        "dr_norm_3pl_conc": {
            "title": "Dose-response, normalized (constant slope, X = concentration)", "family": "Dose-response",
            "params": ["EC50"], "logx": False,
            "fn": lambda x, ec50: 100.0 * x / (ec50 + x),
            "p0": lambda np, x, y: [float(np.median(x)) + 1e-9],
            "bounds": ([1e-12], [inf]),
            "cite": "Normalized (0–100%) constant-slope dose-response, concentration on X.",
        },
        "richards_dr": {
            "title": "Richards (asymmetric) dose-response", "family": "Dose-response",
            "params": ["Bottom", "Top", "Midpoint", "Rate", "Shape"], "logx": False,
            "fn": lambda x, bottom, top, x0, k, nu: bottom + (top - bottom) / (1 + nu * np_exp(-k * (x - x0))) ** (1.0 / nu),
            "p0": lambda np, x, y: [float(np.min(y)), float(np.max(y)), float(np.median(x)), 1.0, 1.0],
            "bounds": ([-inf, -inf, -inf, -inf, 1e-3], [inf, inf, inf, inf, inf]),
            "cite": "Richards generalized-logistic (asymmetric) dose-response.",
        },
        "hormesis_bc": {
            "title": "Hormesis (Brain-Cousens)", "family": "Dose-response",
            "params": ["Bottom", "Top", "f", "logEC50", "Slope"], "logx": True,
            "fn": lambda lx, bottom, top, f, le, b: bottom + (top - bottom + f * 10 ** lx) / (1 + 10 ** ((le - lx) * b)),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), 0.0, float(np.median(lx)), 1.0],
            "bounds": None,
            "derived": lambda np, p: [("EC50", float(10 ** p[3]))],
            "cite": "Brain-Cousens hormesis model — a log-logistic dose-response with a low-dose stimulatory upturn.",
        },
        # ── curve-fit models — enzyme mechanism inhibition (global fit; [I] = per-dataset constant) ──
        # X = [substrate]; each curve is one inhibitor concentration [I] (a per-dataset
        # constant, not a fitted parameter); Vmax/KM/Ki(/Alpha) are shared enzyme constants.
        # Fit a single curve and KM·(1+[I]/Ki) collapses to one apparent KM — KM & Ki are
        # confounded — so these are global-fit-only (guarded out of single-curve `curvefit`).
        "competitive_inhibition": {
            "title": "Competitive inhibition", "family": "Enzyme inhibition",
            "params": ["Vmax", "KM", "Ki"], "consts": ["I"], "logx": False,
            "fn": lambda x, i, vmax, km, ki: vmax * x / (km * (1 + i / ki) + x),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.2 + 1e-9, float(np.median(x)) + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0, 1e-12], [inf, inf, inf]),
            "cite": "Competitive enzyme inhibition — [I] raises the apparent KM; Vmax unchanged.",
        },
        "noncompetitive_inhibition": {
            "title": "Noncompetitive inhibition", "family": "Enzyme inhibition",
            "params": ["Vmax", "KM", "Ki"], "consts": ["I"], "logx": False,
            "fn": lambda x, i, vmax, km, ki: vmax * x / ((km + x) * (1 + i / ki)),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.2 + 1e-9, float(np.median(x)) + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0, 1e-12], [inf, inf, inf]),
            "cite": "Pure noncompetitive inhibition — [I] lowers the apparent Vmax; KM unchanged.",
        },
        "uncompetitive_inhibition": {
            "title": "Uncompetitive inhibition", "family": "Enzyme inhibition",
            "params": ["Vmax", "KM", "Ki"], "consts": ["I"], "logx": False,
            "fn": lambda x, i, vmax, km, ki: vmax * x / (km + x * (1 + i / ki)),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.2 + 1e-9, float(np.median(x)) + 1e-9, float(np.median(x)) + 1e-9],
            "bounds": ([0.0, 0.0, 1e-12], [inf, inf, inf]),
            "cite": "Uncompetitive inhibition — [I] lowers apparent Vmax and KM by the same factor.",
        },
        "mixed_inhibition": {
            "title": "Mixed-model inhibition", "family": "Enzyme inhibition",
            "params": ["Vmax", "KM", "Ki", "Alpha"], "consts": ["I"], "logx": False,
            "fn": lambda x, i, vmax, km, ki, alpha: vmax * x / (km * (1 + i / ki) + x * (1 + i / (alpha * ki))),
            "p0": lambda np, x, y: [float(np.max(y)) * 1.2 + 1e-9, float(np.median(x)) + 1e-9, float(np.median(x)) + 1e-9, 1.0],
            "bounds": ([0.0, 0.0, 1e-12, 1e-6], [inf, inf, inf, inf]),
            "cite": "Mixed-model inhibition (α scales the uncompetitive component: α→∞ competitive, α=1 noncompetitive).",
        },
        # ── curve-fit models ─────────────────────────────────────────────────
        # Centered polynomials — fit about the mean X to cut coefficient collinearity.
        # X̄ is a data-derived fit-level constant (const_fn) threaded into fn(x, xc, *B)
        # by the driver, so the fit and the sampled overlay share the same centring.
        "poly2_centered": {
            "title": "Polynomial (quadratic, centered)", "family": "Polynomial",
            "params": ["B0", "B1", "B2"], "logx": False,
            "const_fn": lambda np, x, y: [float(np.mean(x))],
            "fn": lambda x, xc, b0, b1, b2: b0 + b1 * (x - xc) + b2 * (x - xc) ** 2,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x - np.mean(x), y, 2)[::-1]],
            "bounds": None,
            "cite": "Second-order polynomial centered on the mean X (reduces coefficient collinearity).",
        },
        "poly3_centered": {
            "title": "Polynomial (cubic, centered)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3"], "logx": False,
            "const_fn": lambda np, x, y: [float(np.mean(x))],
            "fn": lambda x, xc, b0, b1, b2, b3: b0 + b1 * (x - xc) + b2 * (x - xc) ** 2 + b3 * (x - xc) ** 3,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x - np.mean(x), y, 3)[::-1]],
            "bounds": None,
            "cite": "Third-order polynomial centered on the mean X.",
        },
        "poly4_centered": {
            "title": "Polynomial (quartic, centered)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4"], "logx": False,
            "const_fn": lambda np, x, y: [float(np.mean(x))],
            "fn": lambda x, xc, b0, b1, b2, b3, b4: b0 + b1 * (x - xc) + b2 * (x - xc) ** 2 + b3 * (x - xc) ** 3 + b4 * (x - xc) ** 4,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x - np.mean(x), y, 4)[::-1]],
            "bounds": None,
            "cite": "Fourth-order polynomial centered on the mean X.",
        },
        "poly5_centered": {
            "title": "Polynomial (quintic, centered)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4", "B5"], "logx": False,
            "const_fn": lambda np, x, y: [float(np.mean(x))],
            "fn": lambda x, xc, b0, b1, b2, b3, b4, b5: b0 + b1 * (x - xc) + b2 * (x - xc) ** 2 + b3 * (x - xc) ** 3 + b4 * (x - xc) ** 4 + b5 * (x - xc) ** 5,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x - np.mean(x), y, 5)[::-1]],
            "bounds": None,
            "cite": "Fifth-order polynomial centered on the mean X.",
        },
        "poly6_centered": {
            "title": "Polynomial (sextic, centered)", "family": "Polynomial",
            "params": ["B0", "B1", "B2", "B3", "B4", "B5", "B6"], "logx": False,
            "const_fn": lambda np, x, y: [float(np.mean(x))],
            "fn": lambda x, xc, b0, b1, b2, b3, b4, b5, b6: b0 + b1 * (x - xc) + b2 * (x - xc) ** 2 + b3 * (x - xc) ** 3 + b4 * (x - xc) ** 4 + b5 * (x - xc) ** 5 + b6 * (x - xc) ** 6,
            "p0": lambda np, x, y: [float(v) for v in np.polyfit(x - np.mean(x), y, 6)[::-1]],
            "bounds": None,
            "cite": "Sixth-order polynomial centered on the mean X.",
        },
        # Binding kinetics — association at multiple ligand concentrations (global:
        # [L] is a per-dataset constant; kon/koff are shared, the plateau is per curve).
        "assoc_kinetics": {
            "title": "Association kinetics (multiple [ligand])", "family": "Binding",
            "params": ["Plateau", "kon", "koff"], "consts": ["L"], "logx": False,
            "fn": lambda t, l, plateau, kon, koff: plateau * (1 - np_exp(-(kon * l + koff) * t)),
            "p0": lambda np, t, y: [float(np.max(y)) * 1.05 + 1e-9, 0.5, 0.1],
            "bounds": ([0.0, 1e-9, 1e-9], [inf, inf, inf]),
            "cite": "Observed association Y = Plateau·(1−e^(−kobs·t)) with kobs = kon·[L]+koff; global fit shares kon/koff across [L] curves.",
        },
        # Motulsky & Mahan (1984) kinetics of competitive binding: a radioligand [L]
        # associates to the receptor while a competitor [I] binds too — bound radioligand
        # over time follows a biexponential in the two eigenvalues KF (fast) / KS (slow).
        # A family of curves each at one [I] (with [L] the same) share every rate constant
        # + Bmax; [L] and [I] are the two per-dataset constants (enter the same [L] each).
        "motulsky_mahan": {
            "title": "Competitive binding kinetics (Motulsky-Mahan)", "family": "Binding",
            # [L] (the radioligand conc, same for every curve) is a parameter you fix via the
            # Constraints panel (it's confounded with Bmax·kon otherwise); [I] (the competitor
            # conc, one per curve) is the per-dataset constant.
            "params": ["kon_L", "koff_L", "kon_I", "koff_I", "Bmax", "L"], "consts": ["I"], "logx": False,
            "fn": lambda t, I, k1, k2, k3, k4, bmax, L: _motulsky_mahan(np_exp, t, L, I, k1, k2, k3, k4, bmax),
            "p0": lambda np, t, y: [1.0, 0.1, 1.0, 0.1, float(np.max(y)) * 1.2 + 1e-9, 1.0],
            "bounds": ([1e-12, 1e-12, 1e-12, 1e-12, 0.0, 1e-12], [inf, inf, inf, inf, inf, inf]),
            "cite": "Motulsky & Mahan (1984) kinetics of competitive binding: radioligand [L] association with competitor [I] present. Global fit shares kon_L/koff_L/kon_I/koff_I/Bmax; fix 'L' to the known radioligand concentration; each curve is one competitor [I]. Fit vs time.",
        },
        # ── curve-fit models — pharmacology: operational agonism, Gaddum/Schild,
        #    total+nonspecific binding (all global fits reusing the const machinery). ─
        # Gaddum/Schild EC50 shift: a family of agonist dose-response curves each at one
        # competitive-antagonist concentration [B] (a per-dataset constant). The antagonist
        # multiplies EC50 by the dose ratio 1+([B]/Kb)^SchildSlope, Kb = 10^−pA2. All the
        # 4PL parameters + pA2 + SchildSlope are shared; the [B]=0 curve is the reference.
        # Global-only (a single curve can't see the shift), reusing the [I]-style const path.
        "schild": {
            "title": "Gaddum/Schild EC50 shift", "family": "Dose-response (special)",
            "params": ["Bottom", "Top", "logEC50", "HillSlope", "pA2", "SchildSlope"],
            "consts": ["B"], "logx": True,
            "fn": lambda lx, b, bottom, top, logec50, hill, pa2, schild:
                bottom + (top - bottom) / (1 + ((1.0 if b == 0 else 1.0 + (b * 10.0 ** pa2) ** schild) * 10.0 ** (logec50 - lx)) ** hill),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx)), 1.0, -float(np.median(lx)), 1.0],
            "bounds": None,
            "cite": "Gaddum/Schild competitive-antagonist EC50 shift; pA2 = −log(antagonist Kb). Global fit shares every parameter across antagonist concentrations [B]; include a [B]=0 curve.",
        },
        # Allosteric EC50 shift (Christopoulos-Kenakin): an allosteric modulator [B] shifts the
        # agonist EC50 by (1+B/KB)/(1+α·B/KB) — α>1 positive cooperativity (EC50 falls), α<1
        # negative (EC50 rises). A family of agonist curves at different [B] share every param;
        # [B] is the per-dataset constant. Written as a 4PL whose midpoint is the shifted EC50
        # (pure arithmetic on positive bases → no np handle needed; B=0 gives the control EC50).
        "allosteric_ec50": {
            "title": "Allosteric EC50 shift", "family": "Dose-response (special)",
            "params": ["Bottom", "Top", "logEC50", "HillSlope", "logKB", "logAlpha"],
            "consts": ["B"], "logx": True,
            "fn": lambda lx, b, bottom, top, logec50, hill, logkb, logalpha:
                bottom + (top - bottom) / (
                    1 + ((10.0 ** logec50) * (1.0 + b / 10.0 ** logkb) / (1.0 + (10.0 ** logalpha) * b / 10.0 ** logkb) / 10.0 ** lx) ** hill),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)), float(np.median(lx)), 1.0, -float(np.median(lx)), 0.0],
            "bounds": None,
            "cite": "Allosteric EC50 shift (Christopoulos & Kenakin): modulator [B] scales EC50 by (1+B/KB)/(1+α·B/KB); α = cooperativity (10^logAlpha), KB = 10^logKB. Global fit shares all params across [B]; include a [B]=0 curve.",
        },
        # Operational model of agonism (Black & Leff 1983): fit a full agonist together with
        # partial agonist(s), sharing the system maximum Emax, basal and transducer slope n
        # while each agonist keeps its own affinity logKA and efficacy logTau (local). Global-
        # only — one curve confounds KA and τ (they set the same top/midpoint). Uses a near-
        # full agonist to pin Emax.
        "operational": {
            "title": "Operational model (partial agonist)", "family": "Dose-response (special)",
            "params": ["Basal", "Emax", "n", "logKA", "logTau"], "logx": True, "global_only": True,
            "fn": lambda lx, basal, emax, n, logka, logtau: _operational(10.0 ** lx, basal, emax, n, 10.0 ** logka, 10.0 ** logtau),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)) * 1.8 + 1e-9, 1.0, float(np.median(lx)), 0.0],
            "bounds": None,
            "cite": "Black-Leff operational model of agonism; share Emax/Basal/n across agonists, each with local affinity (logKA) and efficacy (logTau).",
        },
        # Operational model — receptor depletion (Furchgott method): the same agonist measured
        # before and after irreversible receptor inactivation. The fraction of receptors left,
        # q ∈ (0,1], is a per-dataset constant (q=1 for the untreated curve); the transducer
        # ratio scales as τ = q·τmax, so Emax/Basal/n/logKA/logTau are all shared and identifiable.
        "operational_depletion": {
            "title": "Operational model (receptor depletion)", "family": "Dose-response (special)",
            "params": ["Basal", "Emax", "n", "logKA", "logTau"], "consts": ["q"], "logx": True,
            "fn": lambda lx, q, basal, emax, n, logka, logtau: _operational(10.0 ** lx, basal, emax, n, 10.0 ** logka, q * 10.0 ** logtau),
            "p0": lambda np, lx, y: [float(np.min(y)), float(np.max(y)) * 1.3 + 1e-9, 1.0, float(np.median(lx)), 0.5],
            "bounds": None,
            "cite": "Operational model with receptor depletion (Furchgott); each curve's fractional receptor number q scales the transducer ratio τ = q·τmax.",
        },
        # One-site total and nonspecific binding (global): two curves — total binding
        # (specific + nonspecific + background) and nonspecific-only — sharing Bmax/Kd/NS/
        # Background. The per-dataset constant Spec ∈ {1,0} switches the specific term on/off.
        "total_nonspecific": {
            "title": "Total & nonspecific binding (one site)", "family": "Binding",
            "params": ["Bmax", "Kd", "NS", "Background"], "consts": ["Spec"], "logx": False,
            "fn": lambda x, spec, bmax, kd, ns, bg: spec * (bmax * x / (kd + x)) + ns * x + bg,
            "p0": lambda np, x, y: [float(np.max(y)), float(np.median(x)) + 1e-9,
                                    float((y[-1] - y[0]) / ((x[-1] - x[0]) or 1.0)), float(np.min(y))],
            "bounds": None,
            "cite": "One-site total + nonspecific binding fit globally; the total curve (Spec=1) and nonspecific curve (Spec=0) share Bmax, Kd, the nonspecific slope NS and background.",
        },
        # Two-site total and nonspecific binding (global): as above with two specific sites.
        "total_nonspecific_2site": {
            "title": "Total & nonspecific binding (two sites)", "family": "Binding",
            "params": ["Bmax1", "Kd1", "Bmax2", "Kd2", "NS", "Background"], "consts": ["Spec"], "logx": False,
            "fn": lambda x, spec, bmax1, kd1, bmax2, kd2, ns, bg:
                spec * (bmax1 * x / (kd1 + x) + bmax2 * x / (kd2 + x)) + ns * x + bg,
            "p0": lambda np, x, y: [float(np.max(y)) * 0.6, float(np.median(x)) * 0.2 + 1e-9,
                                    float(np.max(y)) * 0.4, float(np.median(x)) * 3.0 + 1e-9,
                                    float((y[-1] - y[0]) / ((x[-1] - x[0]) or 1.0)), float(np.min(y))],
            "bounds": None,
            "cite": "Two-site total + nonspecific binding fit globally; total (Spec=1) and nonspecific (Spec=0) curves share both sites' Bmax/Kd, the nonspecific slope and background.",
        },
        # ── curve-fit models — ligand depletion (free ligand ≠ added ligand) ─────────
        # One-site total binding (specific + nonspecific) with ligand depletion: a
        # single saturation curve where free ligand is solved from the conservation
        # quadratic (see `_depletion_total`). Recovers Bmax/Kd/NS from a depleted curve.
        "binding_depletion_ns": {
            "title": "Total binding with ligand depletion", "family": "Binding",
            "params": ["Bmax", "Kd", "NS"], "logx": False,
            "fn": lambda x, bmax, kd, ns: _depletion_total(x, bmax, kd, ns, 1.0),
            "p0": lambda np, x, y: [float(np.max(y)), float(np.median(x)) + 1e-9,
                                    max(0.0, float((y[-1] - y[0]) / ((x[-1] - x[0]) or 1.0)))],
            "bounds": ([0.0, 1e-12, 0.0], [inf, inf, inf]),
            "cite": "One-site total binding (specific + nonspecific) with ligand depletion; free ligand solved from the mass-conservation quadratic (Bmax/Kd/NS from a single depleted curve).",
        },
        # Global total + nonspecific binding with ligand depletion: the total curve
        # (Spec=1, specific+nonspecific deplete free ligand) and the nonspecific curve
        # (Spec=0, only NS depletes) share Bmax/Kd/NS. Free ligand solved per curve from
        # the same conservation quadratic (spec gates the specific term in both F and Y).
        "total_nonspecific_depletion": {
            "title": "Total & nonspecific binding with ligand depletion", "family": "Binding",
            "params": ["Bmax", "Kd", "NS"], "consts": ["Spec"], "logx": False,
            "fn": lambda x, spec, bmax, kd, ns: _depletion_total(x, bmax, kd, ns, spec),
            "p0": lambda np, x, y: [float(np.max(y)), float(np.median(x)) + 1e-9,
                                    max(0.0, float((y[-1] - y[0]) / ((x[-1] - x[0]) or 1.0)))],
            "bounds": None,
            "cite": "Total + nonspecific binding with ligand depletion fit globally; the total (Spec=1) and nonspecific (Spec=0) curves share Bmax/Kd/NS, free ligand solved per curve from the mass-conservation quadratic.",
        },
    }


def _depletion_total(x, bmax, kd, ns, spec):
    """Total binding with ligand depletion. When a large fraction of added ligand X
    binds, free ligand F ≠ X: F solves the conservation X = F + spec·Bmax·F/(Kd+F) +
    NS·F, i.e. the quadratic (1+NS)F² + (Kd + spec·Bmax + NS·Kd − X)F − X·Kd = 0. The
    positive root is always real (−4ac = 4(1+NS)·X·Kd ≥ 0). Y = spec·Bmax·F/(Kd+F) +
    NS·F; the per-curve constant spec∈{1,0} switches specific binding on/off (global
    total + nonspecific fits). Pure numpy arithmetic (operators vectorise over X)."""
    a = 1.0 + ns
    b = kd + spec * bmax + ns * kd - x
    c = -x * kd
    F = (-b + (b * b - 4.0 * a * c) ** 0.5) / (2.0 * a)
    return spec * bmax * F / (kd + F) + ns * F


def _operational(A, basal, emax, n, ka, tau):
    """Black-Leff operational model of agonism (response vs agonist concentration A):
    E = Basal + (Emax−Basal)·(τ·A)^n / ((KA+A)^n + (τ·A)^n). KA is the agonist-receptor
    affinity, τ the transducer ratio (efficacy), n the transducer slope. A/ka/tau are all
    positive (the registry passes 10^log-params), so every base is positive. Pure numpy
    arithmetic (no np handle needed — operators vectorise over the array A)."""
    num = (tau * A) ** n
    return basal + (emax - basal) * num / ((ka + A) ** n + num)


def _motulsky_mahan(np_exp, t, L, I, k1, k2, k3, k4, bmax):
    """Motulsky & Mahan (1984) kinetics of competitive binding — specific binding of a
    radioligand [L] over time t while a competitor [I] is present. k1/k2 = kon/koff of the
    labeled ligand, k3/k4 = kon/koff of the competitor. Biexponential in the two eigenvalues
    KF (fast) and KS (slow) of the coupled two-state binding system."""
    KA = k1 * L + k2
    KB = k3 * I + k4
    S = ((KA - KB) ** 2 + 4.0 * k1 * k3 * L * I) ** 0.5
    KF = 0.5 * (KA + KB + S)
    KS = 0.5 * (KA + KB - S)
    diff = KF - KS
    Q = bmax * k1 * L / diff
    return Q * (k4 * diff / (KF * KS)
                + (k4 - KF) / KF * np_exp(-KF * t)
                - (k4 - KS) / KS * np_exp(-KS * t))


# A module-level handle so the registry lambdas can call np.exp without importing
# numpy in each closure (set on first fit; the engine imports numpy lazily).
np_exp = None
np_log = None
np_sin = None
np_where = None
sp_wofz = None  # Faddeeva (Voigt), scipy.special
sp_erfcx = None  # scaled complementary erf (EMG, overflow-safe), scipy.special
sp_ndtr = None  # standard-normal CDF (probit), scipy.special


def _mm_progress_curve(t, vmax, km, s0):
    """Integrated Michaelis-Menten enzyme progress curve — product formed vs time with
    substrate depletion. Closed form (Schnell & Mendoza 1997):
        P(t) = S0 − KM·W((S0/KM)·e^((S0 − Vmax·t)/KM)),
    with W the principal Lambert-W branch (argument is always ≥ 0 → W is real). The
    exponent is clipped to ±700 as an overflow guard (only reached for the unphysical
    S0 ≫ 700·KM)."""
    import numpy as _np
    from scipy.special import lambertw
    km = max(float(km), 1e-12)
    arg = _np.clip((s0 - vmax * _np.asarray(t, dtype=float)) / km, -700.0, 700.0)
    return s0 - km * _np.real(lambertw((s0 / km) * _np.exp(arg)))


def _nl_weights(np, x, y, scheme, sd=None):
    """Per-point sigma for `curve_fit` implementing the standard weighting choices.
    Weight ∝ 1/sigma², so e.g. 1/Y² weighting ⇒ sigma = |Y|."""
    if scheme in (None, "none", ""):
        return None
    eps = 1e-9
    if scheme == "1/Y2":
        return np.abs(y) + eps
    if scheme == "1/Y":
        return np.sqrt(np.abs(y) + eps)
    if scheme == "1/X2":
        return np.abs(x) + eps
    if scheme == "1/X":
        return np.sqrt(np.abs(x) + eps)
    if scheme == "1/YY":
        # 1/Ŷ² (weight by the predicted value) — the fit reweights iteratively in _fit_nl;
        # here `y` is the model's predicted value (data points during the loop, grid values
        # for the confidence band), so |ŷ| is the correct variance function at each point.
        return np.abs(y) + eps
    if scheme == "poisson":
        # Count data (Poisson): variance = mean ⇒ weight ∝ 1/mean, sigma = √mean. The
        # caller passes the predicted Ŷ here (iteratively reweighted) so a zero-count
        # observation doesn't get infinite weight.
        return np.sqrt(np.abs(y) + eps)
    if scheme == "1/SD2":
        # Weight by 1/SD² using each point's entered/replicate SD (sigma = SD). Needs
        # the per-point SD (aligned to x/y); returns None at synthetic points (no SD).
        if sd is None:
            return None
        return np.maximum(np.asarray(sd, dtype=float), eps)
    return None


def _nl_fit_core(np, model, x, y, data):
    """Fit one registry model and return the raw fit pieces shared by `_fit_nl`
    and `comparefits`: the (possibly log-transformed) x/y actually fit, the
    parameters + covariance, the fitted values, k, n, and the residual sum of
    squares. Handles the log10(x) transform, initial guesses, bounds, weighting."""
    global np_exp, np_log, np_sin, np_where, sp_wofz, sp_erfcx, sp_ndtr
    np_exp, np_log, np_sin, np_where = np.exp, np.log, np.sin, np.where
    from scipy.special import wofz as _wofz, erfcx as _erfcx, ndtr as _ndtr
    sp_wofz, sp_erfcx, sp_ndtr = _wofz, _erfcx, _ndtr
    from scipy.optimize import curve_fit

    if model.get("consts") and not model.get("const_fn"):
        raise StatsError("bad_request", "%s needs a global fit with a per-dataset constant (use Global fit)." % model["title"])
    if model.get("global_only"):
        raise StatsError("bad_request", "%s must be fit with Global fit (shared parameters) across ≥ 2 datasets." % model["title"])
    logx = model.get("logx", False)
    if logx:
        pos = x > 0
        ax, yy = np.log10(x[pos]), y[pos]
    else:
        ax, yy = x, y
    k = len(model["params"])
    if ax.size < k:
        raise StatsError("bad_request", "%s needs ≥ %d points" % (model["title"], k))

    fn = model["fn"]
    if model.get("const_fn"):
        # A fit-level, data-derived constant (e.g. a centered polynomial's centring
        # point X̄) — computed once, baked into fn so both the fit and the sampled
        # overlay use the same value. fn signature is fn(x, *consts, *params).
        cvals = model["const_fn"](np, ax, yy)
        fn = (lambda base, cv: (lambda xx, *pp: base(xx, *cv, *pp)))(fn, cvals)
    p0 = model["p0"](np, ax, yy)
    # Restart hook: `_escape_local_minimum` refits from perturbed
    # starts by overriding the resolved starting vector, nothing else.
    if data.get("p0Override") is not None:
        p0 = [float(v) for v in data["p0Override"]]
    scheme = data.get("weighting")
    # Per-point SD for 1/SD² weighting, aligned to the fitted ax (filtered like x for
    # a log-x model). Fail loudly if 1/SD² is requested without any SD to weight by.
    sd_arr = data.get("sd")
    if sd_arr is not None:
        sd_arr = np.asarray(sd_arr, dtype=float)
        if logx:
            sd_arr = sd_arr[pos]
    if scheme == "1/SD2" and sd_arr is None:
        raise StatsError("bad_request",
                         "1/SD² weighting needs a per-point SD (replicate scatter, or an entered SD subcolumn).")
    sigma = _nl_weights(np, ax, yy, scheme, sd=sd_arr)
    pnames = model["params"]
    inf = float("inf")

    # User parameter constraints: fix parameters to a value (fit only the rest) and/or
    # tighten per-parameter bounds. `fixed` = {name: value}; `paramBounds` = {name:[lo,hi]}.
    fixed = data.get("fixed") or {}
    ubounds = data.get("paramBounds") or {}
    fixed_vals = [float(fixed[pn]) if pn in fixed else None for pn in pnames]
    free = [i for i, pn in enumerate(pnames) if pn not in fixed]
    if not free:
        raise StatsError("bad_request", "%s: at least one parameter must stay free (not fixed)." % model["title"])

    # `fit_fn` takes only the free parameters (fixed ones baked in); `fn` stays the
    # full-parameter evaluator used for yhat + the sampled overlay.
    if fixed:
        def fit_fn(xx, *free_p, _fn=fn, _fv=fixed_vals, _fi=free):
            full = list(_fv)
            for slot, i in enumerate(_fi):
                full[i] = free_p[slot]
            return _fn(xx, *full)
    else:
        fit_fn = fn

    # Bounds: model defaults (or ±inf), overridden by any user min/max; p0 clamped inside.
    mb = model.get("bounds")
    lo_all = list(mb[0]) if mb else [-inf] * len(pnames)
    hi_all = list(mb[1]) if mb else [inf] * len(pnames)
    for pn, rng in ubounds.items():
        if pn in pnames and isinstance(rng, (list, tuple)):
            j = pnames.index(pn)
            if len(rng) > 0 and rng[0] is not None:
                lo_all[j] = float(rng[0])
            if len(rng) > 1 and rng[1] is not None:
                hi_all[j] = float(rng[1])
    kw = {"p0": [min(max(p0[i], lo_all[i]), hi_all[i]) for i in free], "maxfev": 20000}
    if mb or ubounds:
        kw["bounds"] = ([lo_all[i] for i in free], [hi_all[i] for i in free])

    def _fit_once(sig):
        kw2 = dict(kw)
        if sig is not None:
            kw2["sigma"] = sig
            kw2["absolute_sigma"] = False
        return curve_fit(fit_fn, ax, yy, **kw2)

    def _full(pf):
        full = np.array([0.0 if fv is None else fv for fv in fixed_vals], dtype=float)
        for slot, i in enumerate(free):
            full[i] = pf[slot]
        return full

    try:
        if data.get("robust"):
            # Robust (Lorentzian/Cauchy) fit — down-weights outliers instead of letting
            # them dominate the least-squares sum. Used by ROUT to find outliers before a
            # clean least-squares refit (Motulsky & Brown 2006). `f_scale` = the residual
            # scale at which points start being down-weighted.
            kwr = {"p0": kw["p0"], "method": "trf", "loss": "cauchy",
                   "f_scale": float(data.get("f_scale") or 1.0) or 1.0, "max_nfev": 20000}
            if "bounds" in kw:
                kwr["bounds"] = kw["bounds"]
            if sigma is not None:
                kwr["sigma"] = sigma
                kwr["absolute_sigma"] = False
            popt_free, pcov_free = curve_fit(fit_fn, ax, yy, **kwr)
        elif scheme in ("poisson", "1/YY"):
            # Iteratively reweight by the current fit's predicted values until the
            # parameters stabilise (start unweighted, then refit against the model's own Ŷ):
            #   • poisson: variance = mean ⇒ σ = √Ŷ (weight 1/Ŷ) — count data;
            #   • 1/YY: 1/Ŷ² ⇒ σ = |Ŷ| (weight 1/Ŷ²) — proportional error, using the
            #     predicted value so a small/zero observation doesn't get infinite weight.
            sig_it, prev = None, None
            for _ in range(50):  # identity-link IRLS can need ~20-30 sweeps
                popt_free, pcov_free = _fit_once(sig_it)
                if prev is not None and np.allclose(popt_free, prev, rtol=1e-9, atol=1e-12):
                    break
                prev = popt_free
                yh_it = np.abs(fn(ax, *_full(popt_free))) + 1e-9
                sig_it = np.sqrt(yh_it) if scheme == "poisson" else yh_it
            sigma = sig_it  # the converged per-point sigma (for the residual scale + bands)
        else:
            popt_free, pcov_free = _fit_once(sigma)
    except Exception as exc:
        raise StatsError("numerical", "%s fit did not converge: %s" % (model["title"], exc))
    # Reassemble the full parameter vector + covariance (fixed params: their value, 0 variance).
    popt = np.array([0.0 if fv is None else fv for fv in fixed_vals], dtype=float)
    for slot, i in enumerate(free):
        popt[i] = popt_free[slot]
    pcov = np.zeros((len(pnames), len(pnames)))
    for a, ia in enumerate(free):
        for b, ib in enumerate(free):
            pcov[ia, ib] = pcov_free[a, b]
    yhat = fn(ax, *popt)
    sse = float(np.sum((yy - yhat) ** 2))
    return {"ax": ax, "yy": yy, "popt": popt, "pcov": pcov, "yhat": yhat, "fn": fn,
            "k": k, "k_free": len(free), "n": int(ax.size), "sse": sse, "logx": logx,
            "sigma": sigma, "fixed_mask": [fv is not None for fv in fixed_vals],
            "p0": [float(v) for v in p0]}


def _fit_suspect(np, core):
    """Cheap 'this fit may be a local minimum' test: a dead covariance (non-finite or
    zero-variance), or a free parameter whose dependency is ≈ 1 — the data cannot
    separate it from the others, the signature of a saturated/degenerate solution."""
    pcov = core["pcov"]
    if not np.all(np.isfinite(pcov)):
        return True
    fixed_mask = core.get("fixed_mask") or [False] * core["k"]
    free = [i for i in range(core["k"]) if not fixed_mask[i]]
    if not free:
        return False
    cf = pcov[np.ix_(free, free)]
    dvar = np.diag(cf)
    if not np.all(dvar > 0):
        return True
    try:
        cinv = np.linalg.inv(cf)
    except np.linalg.LinAlgError:
        return True
    for slot in range(len(free)):
        denom = float(dvar[slot]) * float(cinv[slot, slot])
        if denom != 0.0 and np.isfinite(denom) and 1.0 - 1.0 / denom >= 0.999:
            return True
    return False


def _escape_local_minimum(np, model, x, y, data, core):
    """A least-squares fit converges to whatever basin its starting
    values sit in; a bad start can settle at a much worse solution while still printing
    a plausible R². When the first fit looks suspect (`_fit_suspect`), refit from
    perturbed starts — each free parameter scaled ×0.01/×0.1/×10/×100 one at a time,
    from both the original start and the found solution — and keep the best error sum
    of squares. One-at-a-time matters: a saturated rate parameter needs its own scale
    moved, and scaling the whole vector tends to stay in the same basin.
    Returns (core, note): note is None when the first fit was never suspect,
    ("rescued", sse_before, sse_after) when a restart won, ("stuck", sse, None) when
    nothing better was found."""
    # A perfect fit cannot be a local minimum (and its ~0 covariance would read as
    # suspect); leave it alone.
    sse0 = float(core["sse"])
    scale = float(np.sum(np.asarray(core["yy"], dtype=float) ** 2))
    if sse0 <= 1e-12 * max(1.0, scale):
        return core, None
    if not _fit_suspect(np, core):
        return core, None
    fixed_mask = core.get("fixed_mask") or [False] * core["k"]
    free = [i for i in range(core["k"]) if not fixed_mask[i]]
    starts = []
    for base in (core.get("p0"), [float(v) for v in core["popt"]]):
        if base is None or not all(np.isfinite(v) for v in base):
            continue
        for i in free:
            for f in (0.01, 0.1, 10.0, 100.0):
                cand = [float(v) for v in base]
                cand[i] = cand[i] * f if cand[i] != 0.0 else f
                starts.append(cand)
    best, best_sse = None, sse0
    seen = set()
    for cand in starts[:32]:
        key = tuple(round(v, 12) for v in cand)
        if key in seen:
            continue
        seen.add(key)
        try:
            c2 = _nl_fit_core(np, model, x, y, dict(data or {}, p0Override=cand))
        except Exception:
            continue
        s2 = float(c2["sse"])
        if np.isfinite(s2) and s2 < best_sse * 0.999:
            best, best_sse = c2, s2
    if best is not None:
        return best, ("rescued", sse0, best_sse)
    return core, ("stuck", sse0, None)


def _ec_anything(np, model, popt, ax, pct):
    """EC at any level — the dose producing PCT % of the fitted response, for a monotonic
    log-dose model. Numerically inverts fn(logdose) = target,
    where target = plateau_low + (pct/100)·(plateau_high − plateau_low); the plateaus
    are the fitted curve far below/above the data range. Works for both stimulation
    (increasing) and inhibition (decreasing) curves — for the latter PCT is the % of
    maximal inhibition (IC90 = 90 %). Returns the dose (10^logdose), or None when the
    curve isn't usably monotonic. `pct == 50` reproduces the model's own EC50/IC50 —
    an internal consistency the cross-check battery asserts."""
    fn = model["fn"]
    lo, hi = float(np.min(ax)), float(np.max(ax))
    xlo, xhi = lo - 6.0, hi + 6.0  # ±6 log units (×10^6) → essentially the flat plateaus
    try:
        plo = float(fn(xlo, *popt))
        phi = float(fn(xhi, *popt))
    except (ValueError, ZeroDivisionError, OverflowError, FloatingPointError):
        return None
    if not (np.isfinite(plo) and np.isfinite(phi)) or abs(phi - plo) < 1e-12:
        return None  # flat / degenerate curve → no meaningful EC
    target = plo + (pct / 100.0) * (phi - plo)

    def g(xx):
        try:
            return float(fn(xx, *popt)) - target
        except (ValueError, ZeroDivisionError, OverflowError, FloatingPointError):
            return float("nan")

    a, b = xlo, xhi
    ga, gb = g(a), g(b)
    if not (np.isfinite(ga) and np.isfinite(gb)) or ga * gb > 0:
        return None  # target not bracketed ⇒ not the expected monotone sigmoid
    for _ in range(200):  # bisection: the curve is monotone between plateaus → unique root
        m = 0.5 * (a + b)
        gm = g(m)
        if not np.isfinite(gm):
            return None
        if abs(gm) < 1e-12 or (b - a) < 1e-11:
            return float(10.0 ** m)
        if (gm > 0) == (ga > 0):
            a, ga = m, gm
        else:
            b, gb = m, gm
    return float(10.0 ** (0.5 * (a + b)))


def _fit_nl(np, stats, name, model, x, y, data):
    """Generic nonlinear least-squares driver for a registry model. Handles the
    log10(x) transform, initial guesses, per-parameter bounds, weighting, SE/CI,
    R², residuals, derived quantities, and a sampled overlay curve."""
    core = _nl_fit_core(np, model, x, y, data)
    # Suspect fits get restarts from perturbed starting values; the
    # note feeds a plain-words assumption line below so an escaped (or persistent)
    # local minimum is never silent.
    core, rescue = _escape_local_minimum(np, model, x, y, data, core)
    ax, yy, popt, pcov = core["ax"], core["yy"], core["popt"], core["pcov"]
    fn, k, yhat, logx = core["fn"], core["k"], core["yhat"], core["logx"]
    fixed_mask = core.get("fixed_mask") or [False] * k

    se = [float(v) for v in np.sqrt(np.diag(pcov))]
    df = max(1, ax.size - core.get("k_free", k))  # df uses the free (fitted) parameter count
    # One t quantile drives every interval in this fit — parameter Wald CIs, the
    # profile-likelihood target SSE·(1 + tc²/df), and the confidence/prediction bands —
    # at the dialog's Confidence level, never a hardcoded 0.975.
    conf = float((data or {}).get("conf", 0.95))
    tc = float(stats.t.ppf(0.5 + conf / 2.0, df))
    r2 = _r2(yy, yhat)

    # Fit diagnostics from the parameter covariance C over the free (fitted) params:
    #   • Correlation matrix  R_ij = C_ij / √(C_ii·C_jj)  (pairwise identifiability).
    #   • Dependency_i = 1 − 1/(C_ii·(C⁻¹)_ii) ∈ [0,1]  — the fraction of parameter i's
    #     variance explained by its correlation with the other parameters (the
    #     "Dependency"; →1 ⇒ redundant/ambiguous, the fit can't separate the params).
    free = [i for i in range(k) if not fixed_mask[i]]
    dep = [None] * k
    param_corr = None
    if free and np.all(np.isfinite(pcov)):
        cf = pcov[np.ix_(free, free)]
        dvar = np.diag(cf)
        if np.all(dvar > 0):
            sd = np.sqrt(dvar)
            rmat = cf / np.outer(sd, sd)
            param_corr = {"params": [model["params"][i] for i in free],
                          "matrix": [[round(float(rmat[a, b]), 6) for b in range(len(free))]
                                     for a in range(len(free))]}
            try:
                cinv = np.linalg.inv(cf)
                for slot, i in enumerate(free):
                    denom = float(dvar[slot]) * float(cinv[slot, slot])
                    # A confounded/near-singular parameter (e.g. Et·kcat unconstrained)
                    # gives denom≈0 → dependency is undefined; leave it None, don't crash.
                    if denom != 0.0 and np.isfinite(denom):
                        d_i = 1.0 - 1.0 / denom
                        dep[i] = min(max(d_i, 0.0), 1.0)
            except np.linalg.LinAlgError:
                pass
    max_dep = max((d for d in dep if d is not None), default=None)

    # Hougaard's measure of skewness — a per-parameter number
    # flagging how far a fitted parameter's sampling distribution departs from a symmetric
    # normal (|g1|<0.1 ≈ linear; |g1|>1 markedly skewed ⇒ trust the profile CI, not the SE).
    #   g1_i = -(mse²)·Σ_abc L_ia L_ib L_ic (W_abc + W_bac + W_cba) / (mse·L_ii)^1.5,
    # where L = (JᵀWJ)⁻¹ = pcov/mse, W_abc = Σ_m w_m J_m^a H_m^bc, J/H are the model's
    # first/second derivatives (central finite differences), w_m the fit weights, mse the
    # residual scale. Uniform for weighted fits (w from the fit's per-point sigma).
    skew = [None] * k
    if free and np.all(np.isfinite(pcov)):
        sig = core.get("sigma")
        w = (1.0 / np.asarray(sig, float) ** 2) if sig is not None else np.ones(ax.size)
        mse = float(np.sum(w * (yy - yhat) ** 2)) / df
        if mse > 1e-300:
            pv = np.asarray(popt, dtype=float)
            hs = np.array([1e-4 * (abs(float(v)) + 1e-3) for v in pv])
            f0 = np.asarray(fn(ax, *pv), dtype=float)

            def _fe(pp):
                return np.asarray(fn(ax, *pp), dtype=float)

            jac = np.zeros((ax.size, k))
            hes = np.zeros((ax.size, k, k))
            for a in range(k):
                pa = pv.copy(); pa[a] += hs[a]; fpa = _fe(pa)
                pb = pv.copy(); pb[a] -= hs[a]; fmb = _fe(pb)
                jac[:, a] = (fpa - fmb) / (2.0 * hs[a])
                hes[:, a, a] = (fpa - 2.0 * f0 + fmb) / (hs[a] ** 2)
            for a in range(k):
                for b in range(a + 1, k):
                    pp = pv.copy(); pp[a] += hs[a]; pp[b] += hs[b]
                    pm = pv.copy(); pm[a] += hs[a]; pm[b] -= hs[b]
                    mp = pv.copy(); mp[a] -= hs[a]; mp[b] += hs[b]
                    mm = pv.copy(); mm[a] -= hs[a]; mm[b] -= hs[b]
                    hab = (_fe(pp) - _fe(pm) - _fe(mp) + _fe(mm)) / (4.0 * hs[a] * hs[b])
                    hes[:, a, b] = hab
                    hes[:, b, a] = hab
            try:
                wc = np.einsum("m,ma,mbc->abc", w, jac, hes)  # W_abc = Σ w·J^a·H^bc
                tc3 = wc + np.transpose(wc, (1, 0, 2)) + np.transpose(wc, (2, 1, 0))
                lmat = pcov / mse  # unscaled inverse information (fixed params ⇒ 0 rows/cols)
                for i in free:
                    li = lmat[i]
                    num = -(mse ** 2) * float(np.einsum("a,b,c,abc->", li, li, li, tc3))
                    den = (mse * float(lmat[i, i])) ** 1.5
                    if den > 0 and np.isfinite(num):
                        skew[i] = num / den
            except (np.linalg.LinAlgError, ValueError, FloatingPointError):
                pass
    max_skew = max((abs(sv) for sv in skew if sv is not None), default=None)

    # Profile-likelihood (asymmetric) confidence intervals — our default nonlinear
    # CI. For each free parameter, fix it at a trial value, refit the rest, and find
    # where the SSE rises to SSE_min·(1 + tc²/df) (the profile-t interval). This bounds
    # a parameter better than the symmetric SE-based interval when the fit is skewed.
    # Falls back to the Wald interval where the profile can't be bracketed. Skipped for
    # Poisson weighting (each refit re-runs the IRLS — too costly) and non-finite cov.
    sse_min = core["sse"]
    prof = {}
    if free and data.get("weighting") != "poisson" and np.all(np.isfinite(pcov)) and sse_min > 0:
        from scipy.optimize import brentq
        thresh = sse_min * (1.0 + tc * tc / df)

        def _profile_sse(i, v):
            if len(free) == 1:  # nothing else to refit — evaluate SSE directly at θ_i = v
                pp = np.array(popt, dtype=float)
                pp[i] = v
                return float(np.sum((yy - fn(ax, *pp)) ** 2))
            d2 = dict(data)
            d2["fixed"] = {**(data.get("fixed") or {}), model["params"][i]: v}
            try:
                return _nl_fit_core(np, model, x, y, d2)["sse"]
            except StatsError:
                return None

        def _bound(i, sgn):
            est_i, se_i = float(popt[i]), se[i]
            if not (se_i > 0 and np.isfinite(se_i)):
                return None

            def g(v):
                s = _profile_sse(i, v)
                return (thresh * 2.0 if s is None else s) - thresh  # a failed refit ⇒ 'above' the level

            if g(est_i) >= 0:  # not below the level at the optimum ⇒ can't bracket a crossing
                return None
            far = est_i + sgn * tc * se_i
            crossed = False
            for _ in range(10):  # expand outward until the SSE has risen past the level
                if g(far) > 0:
                    crossed = True
                    break
                far = est_i + (far - est_i) * 1.7
            if not crossed:
                return None
            try:
                return float(brentq(g, min(est_i, far), max(est_i, far), maxiter=50))
            except Exception:
                return None

        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # profiling probes far-from-optimum refits (noisy optimize/covariance warnings)
            for i in free:
                lo, hi = _bound(i, -1), _bound(i, +1)
                if lo is not None or hi is not None:
                    prof[i] = (lo, hi)
    have_profile = bool(prof)

    terms = []
    for i, pname in enumerate(model["params"]):
        est = float(popt[i])
        if fixed_mask[i]:  # user-fixed: report the constant, no SE/CI
            terms.append({"term": "%s (fixed)" % pname, "estimate": _r(est)})
        else:
            lo, hi = prof.get(i, (None, None))  # profile-likelihood bounds, else symmetric Wald
            ci_lo = lo if lo is not None else est - tc * se[i]
            ci_hi = hi if hi is not None else est + tc * se[i]
            row = {"term": pname, "estimate": _r(est), "se": _r(se[i]),
                   "ciLow": _r(ci_lo), "ciHigh": _r(ci_hi)}
            if dep[i] is not None:
                row["dependency"] = _r(dep[i])
            if skew[i] is not None:
                row["skewness"] = _r(skew[i])
            terms.append(row)
    derived_rows = list(model["derived"](np, [float(v) for v in popt])) if model.get("derived") else []
    for label, val in derived_rows:
        terms.append({"term": label, "estimate": _r(val)})
    # EC at any level (opt-in via `ecLevels`): report the dose at any response %, e.g. EC90 / EC10
    # (or IC90 for inhibition models). `model["ecf"]` is the label prefix ("EC" | "IC") and
    # marks the monotonic log-dose models where this is meaningful. Computed once → reused in glance.
    ec_rows = []
    ki_val = None
    if model.get("ecf"):
        pv = [float(v) for v in popt]
        if data.get("ecLevels"):
            seen = set()
            for lvl in data["ecLevels"]:
                try:
                    pct = float(lvl)
                except (TypeError, ValueError):
                    continue
                if not (0.0 < pct < 100.0) or pct == 50.0 or pct in seen:
                    continue  # 50 is already reported as EC50/IC50 by the model's `derived`
                seen.add(pct)
                ec_rows.append(("%s%g" % (model["ecf"], pct), _ec_anything(np, model, pv, ax, pct)))
        # Cheng-Prusoff: convert IC50 → Ki for a competitive inhibitor, given the ligand /
        # substrate concentration used and its Kd / KM:  Ki = IC50 / (1 + [L]/Kd)  (Cheng &
        # Prusoff 1973). Only for inhibition models (ecf == "IC") when the user supplies both.
        cp = data.get("chengProsuff")
        if model["ecf"] == "IC" and isinstance(cp, dict):
            conc = _flt(cp.get("conc"))
            kd = _flt(cp.get("kd"))
            ic50 = next((v for lbl, v in derived_rows if str(lbl).endswith("50")), None)
            if ic50 is not None and conc is not None and kd is not None and kd > 0 and conc >= 0:
                ki_val = float(ic50) / (1.0 + conc / kd)
        for label, val in ec_rows:
            terms.append({"term": label, "estimate": _r(val)})
        if ki_val is not None:
            terms.append({"term": "Ki (Cheng-Prusoff)", "estimate": _r(ki_val)})
    terms.append({"term": "R²", "estimate": _r(r2)})
    # --- Goodness-of-fit + residual diagnostics: the pack the linear `regression` reports,
    #     applied to the nonlinear fit — adjusted R², Sy.x (RMSE), SSE/DF, a runs test (a
    #     systematic residual-sign pattern ⇒ the model misfits the shape), a replicates
    #     lack-of-fit F (when some X level has ≥2 Y's), and a residual-normality battery.
    #     Each self-gates on the data, so degenerate fits simply omit the row. ---
    resid = np.asarray(yy, float) - np.asarray(yhat, float)
    n_pts = int(ax.size)
    k_free = core.get("k_free", k)
    sse_fit = float(np.sum(resid ** 2))
    df_resid = max(1, n_pts - k_free)
    syx = (sse_fit / df_resid) ** 0.5
    sst = float(np.sum((np.asarray(yy, float) - np.mean(yy)) ** 2))
    adj_r2 = (1.0 - (sse_fit / df_resid) / (sst / (n_pts - 1))) if (sst > 0 and n_pts > 1) else None
    if adj_r2 is not None:
        terms.append({"term": "Adjusted R²", "estimate": _r(adj_r2)})
    terms.append({"term": "Sy.x (RMSE)", "estimate": _r(syx)})
    terms.append({"term": "Sum of squares", "estimate": _r(sse_fit), "df": df_resid})
    rt = _runs_test(np, stats, resid)
    if rt is not None:
        runs, expected, zr, pr = rt
        terms.append({"term": "Runs test (lack of fit)", "estimate": runs, "statistic": _r(zr), "p": _r(pr), "ciLow": _r(expected)})
    lof = _lack_of_fit(np, stats, ax, yy, resid, k_free)
    if lof is not None:
        f_lof, p_lof, df_lof, df_pe = lof
        terms.append({"term": "Lack of fit (replicates)", "estimate": _r(f_lof), "statistic": _r(f_lof), "p": _r(p_lof), "df": df_lof, "ciLow": df_pe})
    # Residual normality — Shapiro-Wilk, the same single test the linear `regression` path
    # reports (kept cheap: the full 4-test battery lives in the standalone Normality
    # analysis). Skipped when the residuals are degenerate (a near-perfect fit → nothing
    # to test, and Shapiro warns on a zero-range input).
    resid_normality_p = None
    if n_pts >= 3 and float(np.ptp(resid)) > 1e-9 * (float(np.ptp(yy)) + 1e-30):
        try:
            rw, rpn = stats.shapiro(resid)
            resid_normality_p = float(rpn)
            terms.append({"term": "Residual normality (Shapiro-Wilk)", "statistic": _r(float(rw)), "p": _r(float(rpn))})
        except Exception:  # pragma: no cover - degenerate (near-constant) residuals
            pass

    # Sampled overlay curve (in linear x, even for log-x models). `grid` is the x-grid
    # in fitted space (log10 for log-x models) where fn + the covariance live.
    grid = np.linspace(float(ax.min()), float(ax.max()), 80)
    cx = 10 ** grid if logx else grid
    cy = fn(grid, *popt)
    curve = {"x": [round(float(v), 6) for v in cx], "y": [round(float(v), 6) for v in cy]}

    # Confidence + prediction bands on the fitted curve, at the chosen confidence level, by the
    # delta method. At each sampled x, g(x) = ∂f/∂θ (a finite-difference Jacobian) gives
    #   SE_mean(x) = √(gᵀ·C·g)             → confidence band of the mean response;
    #   SE_pred(x) = √(SE_mean² + φ·v(x))  → prediction band for a new observation,
    # where C is the parameter covariance (user-fixed params carry 0 covariance ⇒ they
    # drop out), φ is the (weighted) reduced-residual variance, and v(x) is the
    # weighting variance function at x (1 when unweighted ⇒ φ·v = SSE/df, the classic
    # prediction term). Skipped when the covariance is non-finite (a non-identifiable
    # fit) or a band value blows up — the overlay curve still ships, just without a band.
    if np.all(np.isfinite(pcov)):
        scheme = data.get("weighting")
        sig_pts = core.get("sigma")  # the actual per-point sigma the fit used (poisson: converged Ŷ; 1/SD²: the SDs)
        if sig_pts is None:
            phi = core["sse"] / df
            v_local = np.ones(grid.size)
        else:
            sig_pts = np.asarray(sig_pts, dtype=float)
            phi = float(np.sum(((yy - yhat) / sig_pts) ** 2)) / df
            sig_g = _nl_weights(np, grid, cy, scheme)  # variance function at synthetic x (None ⇒ unit) — 1/SD² has no grid SD
            v_local = np.asarray(sig_g, dtype=float) ** 2 if sig_g is not None else np.ones(grid.size)
        jac = np.zeros((grid.size, k))
        for i in range(k):
            if fixed_mask[i]:
                continue  # a user-fixed parameter contributes no uncertainty
            step = 1e-6 * (abs(float(popt[i])) + 1e-6)
            p2 = np.array(popt, dtype=float)
            p2[i] += step
            jac[:, i] = (fn(grid, *p2) - cy) / step
        var_mean = np.clip(np.einsum("mi,ij,mj->m", jac, pcov, jac), 0.0, None)
        se_mean = np.sqrt(var_mean)
        se_pred = np.sqrt(var_mean + phi * v_local)
        if np.all(np.isfinite(se_mean)) and np.all(np.isfinite(se_pred)):
            curve["ciLow"] = [round(float(cy[m] - tc * se_mean[m]), 6) for m in range(grid.size)]
            curve["ciHigh"] = [round(float(cy[m] + tc * se_mean[m]), 6) for m in range(grid.size)]
            curve["piLow"] = [round(float(cy[m] - tc * se_pred[m]), 6) for m in range(grid.size)]
            curve["piHigh"] = [round(float(cy[m] + tc * se_pred[m]), 6) for m in range(grid.size)]

    glance = {model["params"][i].lower().replace(" ", "_"): _r(float(popt[i])) for i in range(k)}
    glance.update({"r_sq": _r(r2), "n": int(ax.size), "syx": _r(syx), "sse": _r(sse_fit), "df": df_resid})
    if adj_r2 is not None:
        glance["adj_r_sq"] = _r(adj_r2)
    if model.get("derived"):
        for label, val in model["derived"](np, [float(v) for v in popt]):
            glance[label.replace(" ", "_").replace("-", "_").replace("/", "_")] = _r(val)
    for label, val in ec_rows:  # EC/IC at the extra levels (EC90 / IC10 …) into the machine-readable summary too
        glance[label] = _r(val)
    if ki_val is not None:  # Cheng-Prusoff Ki
        glance["ki"] = _r(ki_val)
    if max_dep is not None:
        glance["max_dependency"] = _r(max_dep)
    psummary = ", ".join("%s = %.4g" % (model["params"][i], float(popt[i])) for i in range(k))
    extra = {"residuals": _resid_pack(ax, yhat, yy)}
    if param_corr is not None:
        extra["paramCorrelation"] = param_corr
    assumptions = ["The model was fit by nonlinear least squares"
                   + (", with dose log10-transformed and non-positive doses excluded." if logx else ".")]
    # ── Michaelis-Menten linearization diagnostics ──────────────────────────────
    # The three classical straight-line readings, derived from the nonlinear fit rather
    # than re-estimated on transformed axes. That ordering is the point: the numbers stay
    # the unbiased ones, and the user still gets the familiar Lineweaver-Burk / Eadie-
    # Hofstee / Hanes-Woolf view to eyeball the data against. The transformed data points
    # and the fitted line ride along in `extra` so the view can be plotted.
    if model.get("mm_constants"):
        vmax_f, km_f = model["mm_constants"]([float(v) for v in popt])
        if vmax_f > 0 and km_f > 0:
            terms.append({"term": "Lineweaver-Burk slope (KM/Vmax)", "estimate": _r(km_f / vmax_f)})
            terms.append({"term": "Lineweaver-Burk Y-intercept (1/Vmax)", "estimate": _r(1.0 / vmax_f)})
            terms.append({"term": "Eadie-Hofstee slope (−KM)", "estimate": _r(-km_f)})
            terms.append({"term": "Hanes-Woolf slope (1/Vmax)", "estimate": _r(1.0 / vmax_f)})
            lins = {}
            for key, (ltitle, xlab, ylab, needs_pos_y, _c) in _LINEARIZATIONS.items():
                ok = ax > 0
                if needs_pos_y:
                    ok = ok & (yy != 0)
                sx, sy = ax[ok], yy[ok]
                if sx.size < 2:
                    continue
                if key == "lineweaver_burk":
                    px, py = 1.0 / sx, 1.0 / sy
                    lslope, lint = km_f / vmax_f, 1.0 / vmax_f
                elif key == "eadie_hofstee":
                    px, py = sy / sx, sy
                    lslope, lint = -km_f, vmax_f
                else:  # hanes_woolf
                    px, py = sx, sx / sy
                    lslope, lint = 1.0 / vmax_f, km_f / vmax_f
                lins[key] = {
                    "title": ltitle, "xTitle": xlab, "yTitle": ylab,
                    "x": [round(float(v), 6) for v in px],
                    "y": [round(float(v), 6) for v in py],
                    # The line is the fitted model's, not a regression on these axes.
                    "slope": _r(lslope), "intercept": _r(lint),
                    "dropped": int((~ok).sum()),
                }
            if lins:
                extra["linearizations"] = lins
                assumptions.append(
                    "Linearization rows (Lineweaver-Burk / Eadie-Hofstee / Hanes-Woolf) are read off the "
                    "nonlinear fit — a diagnostic view of these same Vmax/KM, not a separate estimate.")
    if have_profile:
        assumptions.append(
            "%g%% confidence intervals are profile-likelihood intervals (asymmetric) where the profile "
            "converged, and are standard-error-based (symmetric) otherwise." % (conf * 100))
    if data.get("weighting") not in (None, "none", ""):
        assumptions.append("Weighting: %s." % data.get("weighting"))
    if max_dep is not None and max_dep > 0.99:
        # A near-1 dependency means the parameters are so intertwined the data can't
        # separate them — the cue to fix/share a parameter or simplify the model.
        assumptions.append(
            "High parameter dependency (max %.4g): the parameters are highly correlated — "
            "the fit may be ambiguous; consider fixing or sharing a parameter." % max_dep)
    if rescue is not None and rescue[0] == "rescued":
        assumptions.append(
            "The original starting values settled at a poorer solution (a local minimum; error sum of "
            "squares %.4g). Refitting from perturbed starting values found a substantially better fit "
            "(%.4g), which is the one reported." % (rescue[1], rescue[2]))
    elif rescue is not None and rescue[0] == "stuck":
        assumptions.append(
            "This fit may be a local minimum: the parameters are barely separable from this data, and "
            "refits from perturbed starting values found nothing better. Try different starting values, "
            "more data, or a simpler model.")
    if max_skew is not None and max_skew > 1.0:
        assumptions.append(
            "Markedly skewed parameter(s) (Hougaard's |skewness| up to %.2g > 1): the symmetric SE-based "
            "interval is unreliable — prefer the profile-likelihood CI (reported) or reparameterize." % max_skew)
    if max_skew is not None:
        glance["max_skewness"] = _r(max_skew)
    if resid_normality_p is not None:
        glance["resid_normality_p"] = _r(resid_normality_p)
    return {
        "method": "curvefit", "title": model["title"], "terms": terms,
        "glance": glance,
        "summary": "%s; R² = %s." % (psummary, ("%.4g" % r2) if r2 is not None else "—"),
        "curve": curve,
        "extra": extra,
        "assumptions": assumptions,
        "cite": model.get("cite", "Nonlinear least-squares fit."),
    }


def _rout_fit(np, stats, name, model, x, y, data):
    """ROUT: fit with automatic outlier removal (Motulsky & Brown 2006). A robust
    (Lorentzian) fit — which outliers can't dominate — gives residuals whose scatter
    (RSDR) + a Benjamini-Hochberg FDR at level Q flag the outliers; those points are
    then removed and the rest fit by ordinary least squares (so the reported fit,
    with its CIs/bands/diagnostics, is a clean least-squares fit). Reports how many
    points were removed and which."""
    q = float(data.get("routQ", 0.01) or 0.01)
    core0 = _nl_fit_core(np, model, x, y, data)  # initial LS fit → a robust residual scale
    r0 = np.abs(core0["yy"] - core0["yhat"])
    s0 = float(np.percentile(r0, 68.269))
    if not (s0 > 0):
        s0 = float(np.std(core0["yy"] - core0["yhat"]))
    if not (s0 > 0):
        s0 = 1.0
    core_r = _nl_fit_core(np, model, x, y, {**data, "robust": True, "f_scale": s0})
    resid = np.abs(core_r["yy"] - core_r["yhat"])
    nfit, kfree = resid.size, core_r["k_free"]
    rsdr = float(np.percentile(resid, 68.269)) * (nfit / (nfit - kfree) if nfit > kfree else 1.0)
    out_fit = []
    if rsdr > 0 and nfit > kfree:
        df = max(1, nfit - kfree)
        tvals = resid / rsdr
        pv = [float(2.0 * stats.t.sf(float(t), df)) for t in tvals]  # two-tailed; t ≥ 0
        qv = _bh_fdr(pv)
        out_fit = [j for j in range(nfit) if qv[j] <= q]
    # Map fitted-point indices → original x/y indices (a log-x model dropped x ≤ 0).
    orig_idx = np.where(x > 0)[0] if model.get("logx", False) else np.arange(x.size)
    outliers_orig = sorted(int(orig_idx[j]) for j in out_fit)
    keep = np.array([i not in set(outliers_orig) for i in range(x.size)])
    xc, yc = (x[keep], y[keep]) if outliers_orig and int(keep.sum()) > kfree else (x, y)
    res = _fit_nl(np, stats, name, model, xc, yc, data)  # clean least-squares refit (all diagnostics)
    n_out = len(outliers_orig)
    res["title"] = "%s + ROUT" % res["title"]
    res["terms"].insert(0, {"term": "Outliers removed (ROUT, Q=%.2g%%)" % (q * 100), "estimate": n_out})
    res["glance"]["outliers_removed"] = n_out
    ex = dict(res.get("extra") or {})
    ex["routOutliers"] = outliers_orig  # original-row indices of the excluded points
    res["extra"] = ex
    res["assumptions"] = [
        "ROUT (Motulsky & Brown 2006): a robust Lorentzian fit flags outliers by FDR at Q = %.2g%%; "
        "%d point%s removed, the rest fit by least squares." % (q * 100, n_out, "" if n_out == 1 else "s")
    ] + (res.get("assumptions") or [])
    return res


def interpolate(data):
    """X-from-Y and Y-from-X interpolation from a fitted standard curve.

    Refits the standard (`linear` or any registry model) to the (x, y) standards,
    then reads each unknown off the curve. `unknownsY` → solve the curve for X
    (the classic "read concentration off an ELISA standard curve"); `unknownsX` →
    evaluate Y. The CI comes from inverting the fit's confidence band (a delta-method
    band from the parameter covariance) — the same reading you'd take off the
    plotted curve. X-from-Y needs the curve monotonic over the standard range;
    unknowns outside it are flagged rather than silently extrapolated."""
    np, stats = _np_sp()
    from scipy.optimize import brentq

    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    nmin = min(x.size, y.size)
    x, y = x[:nmin], y[:nmin]
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    if x.size < 2:
        raise StatsError("bad_request", "Interpolation needs ≥ 2 standard points.")
    order = np.argsort(x)
    x, y = x[order], y[order]

    conf = float(d.get("conf", 0.95))
    model_name = d.get("model", "linear") or "linear"
    unknownsY = [float(v) for v in _num(d.get("unknownsY", [])) if np.isfinite(v)]
    unknownsX = [float(v) for v in _num(d.get("unknownsX", [])) if np.isfinite(v)]
    if not unknownsY and not unknownsX:
        raise StatsError("bad_request", "Enter ≥ 1 unknown (blank X → read X from Y; blank Y → read Y from X).")

    # Fit → unify linear + registry models into one out(xdata, params) evaluator.
    if model_name == "linear":
        popt, pcov = np.polyfit(x, y, 1, cov=True)  # [slope, intercept]
        logx, k, title = False, 2, "the linear standard curve"

        def out(xd, p):
            return p[0] * np.asarray(xd, dtype=float) + p[1]
    else:
        models = _nl_models()
        if model_name not in models:
            raise StatsError("bad_request", "Unknown standard-curve model '%s'." % model_name)
        model = models[model_name]
        core = _nl_fit_core(np, model, x, y, d)
        popt, pcov, fn, logx, k = core["popt"], core["pcov"], core["fn"], core["logx"], core["k"]
        title = "the %s" % model["title"]

        def out(xd, p):
            xd = np.asarray(xd, dtype=float)
            return fn(np.log10(xd), *p) if logx else fn(xd, *p)

    n = int(x.size)
    dof = max(1, n - k)
    tcrit = float(stats.t.ppf((1 + conf) / 2, dof))
    yhat = np.asarray(out(x, popt), dtype=float)
    syx = float(np.sqrt(np.sum((y - yhat) ** 2) / dof))

    xdom = x[x > 0] if logx else x  # log-x models are only defined for x > 0
    xlo, xhi = float(np.min(xdom)), float(np.max(xdom))

    def se_mean(xd):
        base = float(out(xd, popt))
        grad = np.empty(k)
        for i in range(k):
            p2 = np.array(popt, dtype=float)
            step = 1e-6 * (abs(p2[i]) + 1e-6)
            p2[i] += step
            grad[i] = (float(out(xd, p2)) - base) / step
        return float(np.sqrt(max(float(grad @ pcov @ grad), 0.0)))

    def curve_at(xd, sign=0):
        v = float(out(xd, popt))
        return v if sign == 0 else v + sign * tcrit * se_mean(xd)

    def solve_x(target, sign):
        try:
            a = curve_at(xlo, sign) - target
            b = curve_at(xhi, sign) - target
        except Exception:
            return None
        if not (np.isfinite(a) and np.isfinite(b)):
            return None
        if a == 0.0:
            return xlo
        if b == 0.0:
            return xhi
        if (a > 0) == (b > 0):
            return None  # target not bracketed on the standard range → out of range
        try:
            return float(brentq(lambda xx: curve_at(xx, sign) - target, xlo, xhi, maxiter=200))
        except Exception:
            return None

    terms = []
    for yv in unknownsY:
        xp = solve_x(yv, 0)
        row = {"term": "X @ Y=%g" % yv, "input": _r(yv)}
        if xp is None:
            row["estimate"] = None
            row["note"] = "outside curve range"
        else:
            row["estimate"] = _r(xp)
            lo, hi = solve_x(yv, +1), solve_x(yv, -1)
            ci = sorted(v for v in (lo, hi) if v is not None)
            if len(ci) == 2:
                row["ciLow"], row["ciHigh"] = _r(ci[0]), _r(ci[1])
        terms.append(row)
    for xv in unknownsX:
        yp = float(out(xv, popt))
        half = tcrit * se_mean(xv)
        row = {"term": "Y @ X=%g" % xv, "input": _r(xv), "estimate": _r(yp),
               "ciLow": _r(yp - half), "ciHigh": _r(yp + half)}
        if not (xlo <= xv <= xhi):
            row["note"] = "extrapolated"
        terms.append(row)

    return {
        "method": "interpolate",
        "title": "Interpolate from %s" % title,
        "terms": terms,
        "glance": {"n": n, "conf": conf, "syx": _r(syx), "model": model_name},
        "summary": "Read %d unknown(s) off %s (%.0f%% CI)." % (len(terms), title, conf * 100),
        "assumptions": [
            "Values interpolated from the fitted standard curve; CI from inverting the fit's confidence band.",
            "X-from-Y assumes the curve is monotonic over the standard range; out-of-range unknowns are flagged.",
        ],
        "cite": "Interpolation from a standard curve (inverse prediction).",
    }


def _compile_user_equation(np, expr):
    """Safely compile a user-typed nonlinear equation into a numpy-vectorised callable
    `fn(x, *params)` + the ordered parameter names — without eval/exec. The equation is
    parsed with `ast`, then only a whitelist of node types + functions is allowed; the
    tree is walked by hand. Spreadsheet-style syntax: `^`=power, `log`=base-10, `ln`=natural,
    `sqr`/`sqrt`, and `IF(cond, a, b)`. `X` (any case) is the independent variable; every
    other name is a parameter to fit (in first-appearance order). Raises StatsError on
    anything unsafe or unparseable. (This is the user-defined-equation fit.)"""
    import ast as A
    src = (expr or "").strip()
    if "=" in src:  # drop a leading "Y =" / "y =" / "f(x) ="
        lhs, _eq, rhs = src.partition("=")
        if lhs.strip().lower().replace(" ", "") in ("y", "f(x)", "f"):
            src = rhs.strip()
    src = src.replace("^", "**")  # spreadsheet power operator → Python
    if not src:
        raise StatsError("bad_request", "Enter an equation to fit, e.g. Vmax*X/(KM+X).")
    try:
        tree = A.parse(src, mode="eval")
    except SyntaxError as exc:
        raise StatsError("bad_request", "Couldn't parse the equation (%s)." % (exc.msg or "syntax error"))

    FUNCS = {"exp", "ln", "log", "log10", "log2", "sqrt", "sqr", "abs", "sin", "cos", "tan",
             "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "sign", "floor", "ceil",
             "if", "min", "max", "mod", "pow"}
    CONSTS = {"pi", "e"}
    params = []

    def check(node):
        if isinstance(node, A.Expression):
            check(node.body); return
        if isinstance(node, A.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise StatsError("bad_request", "Only numbers are allowed as constants.")
            return
        if isinstance(node, A.BinOp):
            if not isinstance(node.op, (A.Add, A.Sub, A.Mult, A.Div, A.Pow, A.Mod)):
                raise StatsError("bad_request", "Unsupported operator in the equation.")
            check(node.left); check(node.right); return
        if isinstance(node, A.UnaryOp):
            if not isinstance(node.op, (A.UAdd, A.USub)):
                raise StatsError("bad_request", "Unsupported unary operator.")
            check(node.operand); return
        if isinstance(node, A.Name):
            low = node.id.lower()
            if low == "x" or low in CONSTS or low in FUNCS:
                return
            if node.id not in params:
                params.append(node.id)
            return
        if isinstance(node, A.Call):
            if not isinstance(node.func, A.Name) or node.func.id.lower() not in FUNCS:
                raise StatsError("bad_request", "Unknown function: %s" % getattr(node.func, "id", "?"))
            if node.keywords:
                raise StatsError("bad_request", "Functions can't take keyword arguments.")
            for a in node.args:
                check(a)
            return
        if isinstance(node, A.Compare):
            if not all(isinstance(op, (A.Lt, A.Gt, A.LtE, A.GtE, A.Eq, A.NotEq)) for op in node.ops):
                raise StatsError("bad_request", "Unsupported comparison in the equation.")
            check(node.left)
            for c in node.comparators:
                check(c)
            return
        if isinstance(node, A.BoolOp):
            for v in node.values:
                check(v)
            return
        raise StatsError("bad_request", "Unsupported element in the equation.")

    check(tree)
    if not params:
        raise StatsError("bad_request", "The equation has no parameters to fit (needs ≥ 1 unknown besides X).")
    if len(params) > 12:
        raise StatsError("bad_request", "Too many parameters to fit (max 12).")

    pidx = {p: i for i, p in enumerate(params)}
    FN = {"exp": np.exp, "ln": np.log, "log": np.log10, "log10": np.log10, "log2": np.log2,
          "sqrt": np.sqrt, "sqr": (lambda a: a * a), "abs": np.abs, "sin": np.sin, "cos": np.cos,
          "tan": np.tan, "asin": np.arcsin, "acos": np.arccos, "atan": np.arctan, "atan2": np.arctan2,
          "sinh": np.sinh, "cosh": np.cosh, "tanh": np.tanh, "sign": np.sign, "floor": np.floor,
          "ceil": np.ceil, "min": np.minimum, "max": np.maximum, "mod": np.mod, "pow": np.power}

    def ev(node, xx, pp):
        if isinstance(node, A.Constant):
            return node.value
        if isinstance(node, A.BinOp):
            a, b, op = ev(node.left, xx, pp), ev(node.right, xx, pp), node.op
            if isinstance(op, A.Add): return a + b
            if isinstance(op, A.Sub): return a - b
            if isinstance(op, A.Mult): return a * b
            if isinstance(op, A.Div): return a / b
            if isinstance(op, A.Pow): return a ** b
            return np.mod(a, b)
        if isinstance(node, A.UnaryOp):
            v = ev(node.operand, xx, pp)
            return -v if isinstance(node.op, A.USub) else +v
        if isinstance(node, A.Name):
            low = node.id.lower()
            if low == "x": return xx
            if low == "pi": return np.pi
            if low == "e": return np.e
            return pp[pidx[node.id]]
        if isinstance(node, A.Call):
            fname = node.func.id.lower()
            args = [ev(a, xx, pp) for a in node.args]
            if fname == "if":
                return np.where(args[0], args[1], args[2])
            return FN[fname](*args)
        if isinstance(node, A.Compare):
            left, op, right = ev(node.left, xx, pp), node.ops[0], ev(node.comparators[0], xx, pp)
            if isinstance(op, A.Lt): return left < right
            if isinstance(op, A.Gt): return left > right
            if isinstance(op, A.LtE): return left <= right
            if isinstance(op, A.GtE): return left >= right
            if isinstance(op, A.Eq): return left == right
            return left != right
        if isinstance(node, A.BoolOp):
            vals = [ev(v, xx, pp) for v in node.values]
            out = vals[0]
            for v in vals[1:]:
                out = np.logical_and(out, v) if isinstance(node.op, A.And) else np.logical_or(out, v)
            return out
        raise StatsError("numerical", "equation evaluation error")

    def fn(xx, *pp):
        return ev(tree.body, xx, pp)

    return fn, params


def _apply_fit_flags(res, cfg):
    """Flag a questionable nonlinear fit against the user's thresholds ("flag poor
    fits"). Reads the diagnostics the fit already put in `glance` — R², n, max
    parameter dependency, max Hougaard |skewness|, residual-normality Shapiro p, and
    (when ROUT ran) the number of outliers removed — and compares each to its
    threshold. A threshold left absent/None disables that one criterion; a diagnostic
    the fit didn't produce (e.g. dependency on a model-free fit) simply skips.

    Sets `res['flagged']` (bool) + `res['flagReasons']` (list) and mirrors `flagged`
    into `glance`, and prepends the reasons to `assumptions` so they surface with no
    display change. Pure post-process — runs on the final result (after ROUT), so the
    outlier count is available. No-op unless `cfg['enabled']`."""
    if not cfg or not cfg.get("enabled"):
        return res
    g = res.get("glance", {}) or {}
    reasons = []

    def _num(key):
        v = g.get(key)
        return v if isinstance(v, (int, float)) else None

    rsq = _num("r_sq")
    thr = cfg.get("rSqBelow")
    if thr is not None and rsq is not None and rsq < thr:
        reasons.append("R² %.4g is below %g" % (rsq, thr))
    n = _num("n")
    thr = cfg.get("nBelow")
    if thr is not None and n is not None and n < thr:
        reasons.append("only %d points (fewer than %g)" % (int(n), thr))
    dep = _num("max_dependency")
    thr = cfg.get("dependencyAbove")
    if thr is not None and dep is not None and dep > thr:
        reasons.append("parameter dependency %.4g exceeds %g (parameters barely separable)" % (dep, thr))
    skew = _num("max_skewness")
    thr = cfg.get("skewnessAbove")
    if thr is not None and skew is not None and skew > thr:
        reasons.append("Hougaard |skewness| %.2g exceeds %g (SE-based CIs unreliable)" % (skew, thr))
    rp = _num("resid_normality_p")
    thr = cfg.get("residNormalityBelow")
    if thr is not None and rp is not None and rp < thr:
        reasons.append("residuals fail the normality test (Shapiro p %.3g below %g)" % (rp, thr))
    nout = _num("outliers_removed")
    thr = cfg.get("outliersAbove")
    if thr is not None and nout is not None and nout > thr:
        reasons.append("%d outlier%s removed (more than %g)" % (int(nout), "" if nout == 1 else "s", thr))

    res["flagged"] = bool(reasons)
    res["flagReasons"] = reasons
    if reasons:
        note = "⚑ Fit flagged as questionable: " + "; ".join(reasons) + "."
        res["assumptions"] = [note] + list(res.get("assumptions", []))
    return res


def curvefit(data):
    """Curve fitting: linear · LOWESS · a registry of nonlinear
    equations (`_nl_models`: dose-response 3PL/4PL/5PL, Michaelis-Menten, binding,
    exponential, growth, Gaussian…). Returns fitted parameters (with CIs at the chosen
    confidence level for the nonlinear models), R²,
    residuals, and a sampled curve for overlay."""
    np, stats = _np_sp()
    from scipy.optimize import curve_fit

    d = data or {}
    model = d.get("model", "4pl")
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    if n < 3:
        raise StatsError("bad_request", "curve fit needs ≥ 3 points")
    x, y = x[:n], y[:n]
    order = np.argsort(x)
    x, y = x[order], y[order]
    # Keep any per-point SD (1/SD² weighting) aligned to the now-sorted x/y. The
    # analysis layer ships it dense + parallel to x/y; a size mismatch ⇒ drop it
    # (so `_fit_nl` raises the clear "needs a per-point SD" error rather than misweight).
    if d.get("sd") is not None:
        sd = np.asarray(d["sd"], dtype=float)
        d = {**d, "sd": sd[order] if sd.size == n else None}

    def sampled(xs, ys):
        return {"x": [round(float(v), 6) for v in xs], "y": [round(float(v), 6) for v in ys]}

    if model == "linear":
        lr = stats.linregress(x, y)
        yhat = lr.slope * x + lr.intercept
        xs = np.linspace(float(x.min()), float(x.max()), 80)
        terms = [
            {"term": "Slope", "estimate": _r(float(lr.slope)), "se": _r(float(lr.stderr)), "p": _r(float(lr.pvalue))},
            {"term": "Intercept", "estimate": _r(float(lr.intercept)), "se": _r(float(lr.intercept_stderr))},
        ]
        r2 = float(lr.rvalue) ** 2
        return {
            "method": "curvefit", "title": "Linear fit", "terms": terms,
            "glance": {"slope": _r(float(lr.slope)), "intercept": _r(float(lr.intercept)), "r_sq": _r(r2), "n": n},
            "summary": "%s; R² = %.4g." % (_line(lr.slope, lr.intercept), r2),
            "curve": sampled(xs, lr.slope * xs + lr.intercept),
            "extra": {"residuals": _resid_pack(x, yhat, y)},
            "cite": "Ordinary least-squares linear fit.",
        }

    if model == "lowess":
        from statsmodels.nonparametric.smoothers_lowess import lowess
        frac = float(d.get("frac", 0.5))
        sm = lowess(y, x, frac=frac, return_sorted=True)
        yhat = np.interp(x, sm[:, 0], sm[:, 1])
        return {
            "method": "curvefit", "title": "LOWESS smoother", "terms": [{"term": "Points", "estimate": n}],
            "glance": {"n": n, "frac": frac, "r_sq": _r(_r2(y, yhat))},
            "summary": "LOWESS smoothing (frac = %.2g) over %d points." % (frac, n),
            "curve": sampled(sm[:, 0], sm[:, 1]),
            "extra": {"residuals": _resid_pack(x, yhat, y)},
            "assumptions": ["Nonparametric local regression — no model assumed."],
            "cite": "Cleveland (1979) locally-weighted regression.",
        }

    if model == "spline":
        # Cubic (or order-k) smoothing spline. `frac` (0…1) controls flexibility: 0 =
        # an interpolating spline through every point; larger = smoother (fewer knots).
        # scipy's `s` is a residual-SS budget, so we scale it by the data's total SS.
        from scipy.interpolate import UnivariateSpline
        k = max(1, min(5, int(d.get("splineOrder", 3))))
        frac = float(d.get("frac", 0.5))
        # UnivariateSpline needs strictly-increasing X with no duplicates → average tied-X Y's.
        ux, inv = np.unique(x, return_inverse=True)
        if len(ux) < k + 1:
            raise StatsError("bad_request", "spline needs at least order+1 distinct X values")
        uy = np.array([float(y[inv == i].mean()) for i in range(len(ux))])
        s = frac * float(np.sum((uy - uy.mean()) ** 2))  # 0 → interpolate; ↑ → smoother
        spl = UnivariateSpline(ux, uy, k=k, s=s)
        yhat = spl(x)
        nknots = int(len(spl.get_knots()))
        xs = np.linspace(float(ux.min()), float(ux.max()), 120)
        return {
            "method": "curvefit", "title": "Smoothing spline",
            "terms": [{"term": "Spline order", "estimate": k}, {"term": "Knots", "estimate": nknots}, {"term": "Points", "estimate": n}],
            "glance": {"n": n, "order": k, "smoothing": _r(frac), "r_sq": _r(_r2(y, yhat))},
            "summary": "Order-%d smoothing spline (%d knots, smoothing = %.2g) over %d points." % (k, nknots, frac, n),
            "curve": sampled(xs, spl(xs)),
            "extra": {"residuals": _resid_pack(x, yhat, y)},
            "assumptions": ["Nonparametric smoothing spline — no model assumed; the smoothing factor trades fit for flexibility."],
            "cite": "Cubic smoothing spline (scipy UnivariateSpline, Dierckx FITPACK).",
        }

    # ROUT (automatic outlier removal) wraps the plain driver with a robust fit + FDR
    # outlier flagging + a clean least-squares refit; otherwise fit directly.
    driver = _rout_fit if d.get("rout") else _fit_nl

    # User-defined / arbitrary equation (the free-form curve-fit capability): the
    # user types `Y = f(X, params…)`; we compile it safely (no eval) into a model dict
    # and fit it through the same `_fit_nl` driver — so it inherits weighting, per-param
    # constraints (fix/bounds), CIs, R², residuals, and the overlay curve for free.
    if model == "custom" or d.get("equation"):
        fn, params = _compile_user_equation(np, d.get("equation", ""))
        init = d.get("initialValues") or {}
        p0 = [float(init.get(p, 1.0)) for p in params]
        eqtext = (d.get("equation") or "").strip()
        cmodel = {
            "title": "User-defined: %s" % (eqtext if len(eqtext) <= 60 else eqtext[:57] + "…"),
            "params": params, "fn": fn,
            "p0": (lambda np, ax, yy, _p=p0: list(_p)),
            "bounds": None, "logx": bool(d.get("logx", False)),
            "cite": "User-defined nonlinear equation, fit by least squares (scipy curve_fit).",
        }
        return _apply_fit_flags(driver(np, stats, "custom", cmodel, x, y, d), d.get("flag"))

    # Every other model comes from the nonlinear equation registry (dose-response,
    # binding, enzyme kinetics, exponential, growth, peak …) fit by one driver.
    models = _nl_models()
    if model in models:
        return _apply_fit_flags(driver(np, stats, model, models[model], x, y, d), d.get("flag"))

    raise StatsError("bad_request", "unknown curve model: %s" % model)


def globalfit(data):
    """Global (shared-parameter) nonlinear fit: fit one registry equation to
    several datasets simultaneously, where each parameter is either shared across
    all datasets, fixed to a constant, or local (fit per dataset). The classic use
    is a family of dose-response curves sharing Top/Bottom (and maybe Hill) while
    each compound keeps its own EC50 — pooling information sharpens every estimate.
    Reports each parameter (shared once, local per dataset) with CIs at the chosen level, per-curve
    + overall R², and a sampled curve per dataset for overlay."""
    np, stats = _np_sp()
    global np_exp, np_log, np_sin, np_where, sp_wofz, sp_erfcx, sp_ndtr
    np_exp, np_log, np_sin, np_where = np.exp, np.log, np.sin, np.where
    from scipy.special import wofz as _wofz, erfcx as _erfcx, ndtr as _ndtr
    sp_wofz, sp_erfcx, sp_ndtr = _wofz, _erfcx, _ndtr
    from scipy.optimize import least_squares

    d = data or {}
    if d.get("compareOneCurve"):
        return _globalfit_one_curve_test(d)
    model_name = d.get("model", "4pl")
    models = _nl_models()
    if model_name not in models:
        raise StatsError("bad_request", "unknown model: %s" % model_name)
    model = models[model_name]
    params = model["params"]
    logx = model.get("logx", False)

    model_consts = model.get("consts") or []  # per-dataset constants (e.g. [I] for inhibition)
    datasets = []
    for ds in (d.get("datasets") or []):
        ax, ay = _aligned(ds.get("x"), ds.get("y"))
        x = np.asarray(ax, dtype=float)
        y = np.asarray(ay, dtype=float)
        m = min(x.size, y.size)
        if m < 1:
            continue
        x, y = x[:m], y[:m]
        order = np.argsort(x)
        x, y = x[order], y[order]
        if logx:
            pos = x > 0
            xf, yy = np.log10(x[pos]), y[pos]
        else:
            xf, yy = x, y
        if xf.size >= 1:
            entry = {"label": ds.get("label", "Dataset %d" % (len(datasets) + 1)), "x": xf, "y": yy}
            if model_consts:
                cv = _num(ds.get("consts", []))
                if len(cv) < len(model_consts):
                    raise StatsError("bad_request", "%s needs %d constant(s) per dataset (e.g. [I]); '%s' has %d." % (
                        model["title"], len(model_consts), entry["label"], len(cv)))
                entry["consts"] = [float(v) for v in cv[:len(model_consts)]]
            elif model.get("const_fn"):
                # Data-derived per-dataset constant (e.g. each curve centred on its own X̄).
                entry["consts"] = [float(v) for v in model["const_fn"](np, xf, yy)]
            datasets.append(entry)
    nd = len(datasets)
    if nd < 2:
        raise StatsError("bad_request", "global fit needs ≥ 2 datasets")

    shared = set(d.get("shared") or [])
    fixed = d.get("fixed") or {}

    # Parameter layout: each model parameter is fixed (constant), shared (one slot),
    # or local (one slot per dataset). theta = the free parameters being fit.
    layout = []
    theta0 = []
    for pi, pname in enumerate(params):
        if pname in fixed:
            layout.append(("fixed", float(fixed[pname])))
        elif pname in shared:
            inits = [model["p0"](np, ds["x"], ds["y"])[pi] for ds in datasets]
            layout.append(("shared", len(theta0)))
            theta0.append(float(np.median(inits)))
        else:
            idxs = []
            for ds in datasets:
                idxs.append(len(theta0))
                theta0.append(float(model["p0"](np, ds["x"], ds["y"])[pi]))
            layout.append(("local", idxs))
    if not theta0:
        raise StatsError("bad_request", "no free parameters — at least one must be shared or local")

    fn = model["fn"]

    def params_for(theta, di):
        out = []
        for pi in range(len(params)):
            kind, info = layout[pi]
            out.append(info if kind == "fixed" else (theta[info] if kind == "shared" else theta[info[di]]))
        return out

    has_consts = bool(model_consts) or bool(model.get("const_fn"))

    def eval_fn(xv, ds, p):
        return fn(xv, *ds["consts"], *p) if has_consts else fn(xv, *p)

    weighting = d.get("weighting")

    def residuals(theta):
        res = []
        for di, ds in enumerate(datasets):
            yhat = eval_fn(ds["x"], ds, params_for(theta, di))
            r = yhat - ds["y"]
            sig = _nl_weights(np, ds["x"], ds["y"], weighting)
            if sig is not None:
                r = r / sig
            res.append(r)
        return np.concatenate(res)

    # Per-parameter user bounds mapped onto the theta vector (shared → its one slot;
    # local → every per-dataset slot for that parameter; fixed → no slot).
    ubounds = d.get("paramBounds") or {}
    inf = float("inf")
    lo_theta = [-inf] * len(theta0)
    hi_theta = [inf] * len(theta0)
    for pi, pname in enumerate(params):
        rng = ubounds.get(pname)
        kind, info = layout[pi]
        if not rng or kind == "fixed":
            continue
        blo = float(rng[0]) if len(rng) > 0 and rng[0] is not None else -inf
        bhi = float(rng[1]) if len(rng) > 1 and rng[1] is not None else inf
        for s in ([info] if kind == "shared" else list(info)):
            lo_theta[s], hi_theta[s] = blo, bhi
    theta0 = [min(max(theta0[s], lo_theta[s]), hi_theta[s]) for s in range(len(theta0))]
    ls_kw = {"max_nfev": 30000}
    if ubounds:
        ls_kw["bounds"] = (lo_theta, hi_theta)
    try:
        sol = least_squares(residuals, theta0, **ls_kw)
    except Exception as exc:
        raise StatsError("numerical", "global fit failed: %s" % exc)
    if sol.status <= 0:
        raise StatsError("numerical", "global fit did not converge")
    theta = sol.x

    ntot = int(sum(ds["x"].size for ds in datasets))
    dof = max(1, ntot - theta.size)
    s2 = 2.0 * float(sol.cost) / dof  # least_squares cost = ½·Σr²
    try:
        cov = np.linalg.inv(sol.jac.T @ sol.jac) * s2
        se = np.sqrt(np.clip(np.diag(cov), 0, None))
    except Exception:
        se = np.full(theta.size, float("nan"))
    # CI level from the dialog's Confidence selector.
    tc = float(stats.t.ppf(0.5 + float(d.get("conf", 0.95)) / 2.0, dof))

    def ci_term(label, idx):
        est, e = float(theta[idx]), float(se[idx])
        return {"term": label, "estimate": _r(est), "se": _r(e),
                "ciLow": _r(est - tc * e), "ciHigh": _r(est + tc * e)}

    terms = []
    for pi, pname in enumerate(params):
        kind, info = layout[pi]
        is_ec50 = logx and pname == "logEC50"
        if kind == "fixed":
            terms.append({"term": "%s (fixed)" % pname, "estimate": _r(info)})
        elif kind == "shared":
            terms.append(ci_term("%s (shared)" % pname, info))
            if is_ec50:
                terms.append({"term": "EC50 (shared)", "estimate": _r(float(10 ** theta[info]))})
        else:
            for di, ds in enumerate(datasets):
                terms.append(ci_term("%s — %s" % (pname, ds["label"]), info[di]))
                if is_ec50:
                    terms.append({"term": "EC50 — %s" % ds["label"], "estimate": _r(float(10 ** theta[info[di]]))})

    curves = []
    ss_res_tot = ss_tot_tot = 0.0
    for di, ds in enumerate(datasets):
        p = params_for(theta, di)
        yhat = eval_fn(ds["x"], ds, p)
        ss_res = float(np.sum((ds["y"] - yhat) ** 2))
        ss_tot = float(np.sum((ds["y"] - np.mean(ds["y"])) ** 2))
        ss_res_tot += ss_res
        ss_tot_tot += ss_tot
        r2 = (1 - ss_res / ss_tot) if ss_tot > 0 else None
        xs = np.linspace(float(ds["x"].min()), float(ds["x"].max()), 60)
        cy = eval_fn(xs, ds, p)
        cx = 10 ** xs if logx else xs
        curves.append({"label": ds["label"], "r2": _r(r2),
                       "x": [round(float(v), 6) for v in cx], "y": [round(float(v), 6) for v in cy]})
    r2_overall = (1 - ss_res_tot / ss_tot_tot) if ss_tot_tot > 0 else None
    terms.append({"term": "R² (overall)", "estimate": _r(r2_overall)})

    shared_list = [p for p in params if p in shared and p not in fixed]
    return {
        "method": "globalfit", "title": "Global fit — %s" % model["title"], "terms": terms,
        # `sse` is the (weighted) residual sum of squares the fit minimised and `df_resid` its degrees of freedom -
        # what the one-curve test compares.
        "glance": {"datasets": nd, "shared": len(shared_list), "free_params": int(theta.size),
                   "n": ntot, "r_sq": _r(r2_overall), "sse": _r(2.0 * float(sol.cost)), "df_resid": int(ntot - theta.size)},
        "extra": {"curves": curves},
        "summary": "Global %s over %d datasets%s; overall R² = %s." % (
            model["title"], nd,
            (" (shared: %s)" % ", ".join(shared_list)) if shared_list else "",
            ("%.4g" % r2_overall) if r2_overall is not None else "—"),
        "assumptions": [
            "One equation fit to all datasets at once; shared parameters take a single value across them.",
            "The model was fit by nonlinear least squares" + (", with dose log10-transformed." if logx else ".")
            + (" Weighting: %s." % weighting if weighting not in (None, "none", "") else ""),
        ],
        "cite": "Global (shared-parameter) nonlinear least squares (scipy least_squares).",
    }


def _globalfit_one_curve_test(d):
    """Do the datasets need their own curves, or does one curve fit them all?

    Fits the global model twice on the same points: as asked (the separate curves - every parameter not ticked
    Shared is fit per dataset) and with every free parameter shared (one curve for all). The one-curve fit is the
    constrained case of the other, so the extra-sum-of-squares F test applies; AICc is reported too, with
    K = parameters + 1 as in `comparefits`. The result is the separate-curves fit, plus the test."""
    np, stats = _np_sp()
    base = {k: v for k, v in d.items() if k != "compareOneCurve"}
    models = _nl_models()
    model_name = base.get("model", "4pl")
    if model_name not in models:
        raise StatsError("bad_request", "unknown model: %s" % model_name)
    fixed = base.get("fixed") or {}
    free = [p for p in models[model_name]["params"] if p not in fixed]
    shared = set(base.get("shared") or [])
    if all(p in shared for p in free):
        raise StatsError("bad_request", "Every parameter is already shared, so the fit is already one curve for all "
                         "datasets - untick at least one parameter to test whether the curves differ.")
    sep = globalfit(base)
    one = globalfit(dict(base, shared=free))
    ss1, df1 = float(sep["glance"]["sse"]), int(sep["glance"]["df_resid"])
    ss0, df0 = float(one["glance"]["sse"]), int(one["glance"]["df_resid"])
    n = int(sep["glance"]["n"])
    extra_df = df0 - df1
    fstat = pval = None
    if extra_df > 0 and df1 > 0 and ss1 > 0:
        fstat = ((ss0 - ss1) / extra_df) / (ss1 / df1)
        pval = float(stats.f.sf(max(fstat, 0.0), extra_df, df1))

    def aicc(sse, k):
        K = k + 1
        sse = max(sse, 1e-300)
        aic = n * np.log(sse / n) + 2 * K
        return float(aic + (2 * K * (K + 1) / (n - K - 1))) if (n - K - 1) > 0 else float("inf")

    a_sep = aicc(ss1, int(sep["glance"]["free_params"]))
    a_one = aicc(ss0, int(one["glance"]["free_params"]))
    lo = min(a_sep, a_one)
    w_sep, w_one = np.exp(-0.5 * (a_sep - lo)), np.exp(-0.5 * (a_one - lo))
    prob_one = float(w_one / (w_sep + w_one))

    out = dict(sep)
    out["title"] = sep["title"] + " — one curve for all?"
    out["glance"] = dict(sep["glance"], compare_f=_r(fstat), compare_p=_r(pval), compare_df1=extra_df, compare_df2=df1,
                         sse_one=_r(ss0), aicc_separate=_r(a_sep), aicc_one=_r(a_one), prob_one=_r(prob_one))
    out["terms"] = list(sep["terms"]) + [
        {"term": "One curve for all: SS", "estimate": _r(ss0), "df": df0},
        {"term": "Separate curves: SS", "estimate": _r(ss1), "df": df1},
        {"term": "Extra-SS F (one curve vs separate)", "statistic": _r(fstat), "df": "%d, %d" % (extra_df, df1), "p": _r(pval)},
        {"term": "AICc: one curve", "estimate": _r(a_one), "probability": _r(prob_one)},
        {"term": "AICc: separate curves", "estimate": _r(a_sep), "probability": _r(1 - prob_one)},
    ]
    if pval is None:
        verdict = "the test cannot be computed (no residual degrees of freedom left)"
    else:
        verdict = "p = %s — %s" % ("%.4g" % pval, "the datasets need separate curves" if pval < 0.05
                                     else "one curve fits all the datasets")
    out["summary"] = "%s One curve for all? Extra-SS F(%d, %d) = %s, %s." % (
        sep["summary"], extra_df, df1, ("%.4g" % fstat) if fstat is not None else "—", verdict)
    out["assumptions"] = list(sep.get("assumptions") or []) + [
        "One curve for all = every free parameter shared; the extra-sum-of-squares F test compares it with the "
        "separate curves (nested fits, same points, same weighting)."]
    return out


def _melt_models():
    """The two melt-curve equations. The flat one is the Boltzmann sigmoid, duplicated under the
    names a melting curve uses; the sloped one adds a
    straight line to each plateau for signals that drift before and after the melt. Kept out of
    the general curve-fit registry: they are reached through `meltingtemp` only."""
    def p0_flat(np, x, y):
        return [float(y[0]), float(y[-1]), _melt_mid_crossing(np, x, y), (float(np.max(x)) - float(np.min(x))) / 10 + 1e-9]

    def p0_sloped(np, x, y):
        b, t, tm, s = p0_flat(np, x, y)
        return [b, 0.0, t, 0.0, tm, s]

    return {
        "flat": {
            "title": "Melting curve (Boltzmann)", "family": "Melt",
            "params": ["Bottom", "Top", "Tm", "Slope"], "logx": False,
            "fn": lambda x, bottom, top, tm, slope: bottom + (top - bottom) / (1 + np_exp((tm - x) / slope)),
            "p0": p0_flat, "bounds": None,
            "cite": "Two-state melting curve fitted with a Boltzmann sigmoid; Tm is its midpoint.",
        },
        "sloped": {
            "title": "Melting curve (Boltzmann, sloped baselines)", "family": "Melt",
            "params": ["Bottom", "Bottom slope", "Top", "Top slope", "Tm", "Slope"], "logx": False,
            "fn": lambda x, bottom, mb, top, mt, tm, slope: (bottom + mb * x) + ((top + mt * x) - (bottom + mb * x)) / (1 + np_exp((tm - x) / slope)),
            "p0": p0_sloped, "bounds": None,
            "cite": "Two-state melting curve with linear pre- and post-transition baselines; Tm is the transition midpoint.",
        },
    }


def _melt_mid_crossing(np, x, y):
    """Starting guess for Tm: the first X where the signal crosses halfway between its first and
    last values (linear between neighbours); the middle of the X range when it never does."""
    mid = (float(y[0]) + float(y[-1])) / 2.0
    for i in range(1, len(x)):
        a, b = float(y[i - 1]) - mid, float(y[i]) - mid
        if a == 0:
            return float(x[i - 1])
        if a * b < 0:
            return float(x[i - 1]) + (float(x[i]) - float(x[i - 1])) * (-a) / (b - a)
    return (float(np.min(x)) + float(np.max(x))) / 2.0


def _melt_derivative_tm(np, x, y, window):
    """Tm by first derivative: smooth (the Smooth-a-curve transform's own Savitzky-Golay, so the
    two agree), differentiate, take the extreme of dY/dX — the maximum when the signal rises on
    melting, the minimum when it falls — and refine it with the vertex of the parabola through
    that point and its two neighbours. Returns (tm, None) or (None, reason): a peak on the first
    or last point cannot be refined and is refused with that reason."""
    sm = curvetransform({"x": list(map(float, x)), "y": list(map(float, y)), "variant": "smooth",
                         "smoothWindow": int(window or 0)})["extra"]["curve"]
    xs = np.asarray(sm["x"], dtype=float)
    ys = np.asarray(sm["y"], dtype=float)
    dy = np.gradient(ys, xs)
    rising = float(ys[-1]) >= float(ys[0])
    i = int(np.argmax(dy) if rising else np.argmin(dy))
    if i == 0 or i == xs.size - 1:
        return None, "the steepest point is at the edge of the temperature window"
    c = np.polyfit(xs[i - 1:i + 2], dy[i - 1:i + 2], 2)
    if c[0] == 0:
        return float(xs[i]), None
    v = -c[1] / (2.0 * c[0])
    return float(min(max(v, xs[i - 1]), xs[i + 1])), None


def meltingtemp(data):
    """Melting temperature (Tm) of melt curves.

    Per replicate column of every sample, inside an optional From/To temperature window:
      • Tm by sigmoid fit — the Boltzmann melt curve (flat, or sloped baselines on request),
        through the general nonlinear fitter, so its SE / CI / R² are the curve fit's own;
      • Tm by first derivative — the X of the steepest point of the smoothed curve.
    Per sample: the mean ± SD of its columns' Tm. With a control sample: ΔTm = Tm − Tm(control)
    with a CI from both SEs (a sample's SE is its fit SE for one column, SD/√n for several) and
    Welch–Satterthwaite degrees of freedom."""
    np, stats = _np_sp()
    global np_exp, np_log, np_sin, np_where
    np_exp, np_log, np_sin, np_where = np.exp, np.log, np.sin, np.where
    d = data or {}
    sloped = bool(d.get("sloped"))
    model = _melt_models()["sloped" if sloped else "flat"]
    k = len(model["params"])
    lo = d.get("from")
    hi = d.get("to")
    lo = float(lo) if lo is not None and lo != "" else None
    hi = float(hi) if hi is not None and hi != "" else None
    if lo is not None and hi is not None and lo >= hi:
        raise StatsError("bad_request", "the temperature window is empty: From must be below To")
    conf = float(d.get("conf", 0.95))
    window = d.get("smoothWindow")
    control = d.get("control") or None
    unit = (d.get("unit") or "").strip()

    samples, curves, warnings = [], [], []
    for ds in (d.get("datasets") or []):
        label = str(ds.get("label") or "")
        columns = []
        for rep in (ds.get("replicates") or []):
            ax, ay = _aligned(ds.get("x"), rep.get("y"))
            x = np.asarray(ax, dtype=float)
            y = np.asarray(ay, dtype=float)
            keep = np.ones(x.size, dtype=bool)
            if lo is not None:
                keep &= x >= lo
            if hi is not None:
                keep &= x <= hi
            x, y = x[keep], y[keep]
            order = np.argsort(x)
            x, y = x[order], y[order]
            name = "%s — %s" % (label, rep.get("label")) if rep.get("label") else label
            if x.size < k + 2:
                warnings.append("%s: only %d points in the window; the sigmoid fit needs at least %d. Skipped." % (name, x.size, k + 2))
                continue
            col = {"label": rep.get("label") or label, "n": int(x.size)}
            try:
                fit = _fit_nl(np, stats, "meltingtemp", model, x, y, dict(d, conf=conf))
                row = next((t for t in fit["terms"] if t.get("term") == "Tm"), None)
                if row and row.get("se") is not None:
                    col.update({"tm_fit": row["estimate"], "se": row["se"], "ciLow": row.get("ciLow"),
                                "ciHigh": row.get("ciHigh"), "df": int(fit["glance"]["df"]), "r_sq": fit["glance"].get("r_sq")})
                    col["_curve"] = fit.get("curve")
                else:
                    warnings.append("%s: the sigmoid fit gave no Tm uncertainty (the transition is not sampled)." % name)
            except StatsError as e:
                warnings.append("%s: the sigmoid fit failed — %s" % (name, e.args[-1] if e.args else e))
            tm_d, why = _melt_derivative_tm(np, x, y, window)
            if tm_d is None:
                warnings.append("%s: no Tm by derivative — %s." % (name, why))
            else:
                col["tm_deriv"] = _r(tm_d)
            columns.append(col)
        if not columns:
            continue
        fits = [c for c in columns if "tm_fit" in c]
        ders = [c["tm_deriv"] for c in columns if "tm_deriv" in c]
        s = {"label": label, "columns": [{kk: vv for kk, vv in c.items() if kk != "_curve"} for c in columns]}
        if fits:
            v = np.asarray([c["tm_fit"] for c in fits], dtype=float)
            s["tm_fit"] = _r(float(v.mean()))
            s["n_fit"] = len(fits)
            if len(fits) == 1:
                s["se"], s["df"] = fits[0]["se"], fits[0]["df"]
            else:
                sd = float(v.std(ddof=1))
                s["sd_fit"] = _r(sd)
                s["se"], s["df"] = _r(sd / np.sqrt(len(fits))), len(fits) - 1
        if ders:
            v = np.asarray(ders, dtype=float)
            s["tm_deriv"] = _r(float(v.mean()))
            if len(ders) > 1:
                s["sd_deriv"] = _r(float(v.std(ddof=1)))
        samples.append(s)
        c0 = next((c.get("_curve") for c in fits if c.get("_curve")), None)
        if c0:
            curves.append({"label": label, "x": c0.get("x"), "y": c0.get("y"),
                           **({"tm": s["tm_fit"]} if "tm_fit" in s else {})})

    # A sample for which neither method found a Tm is not a result — say why instead of an empty table.
    samples = [s for s in samples if "tm_fit" in s or "tm_deriv" in s]
    curves = [c for c in curves if any(s["label"] == c["label"] for s in samples)]
    if not samples:
        raise StatsError("bad_request", "no Tm could be found in any sample"
                         + (" — " + " ".join(warnings) if warnings else ""))

    ctrl = None
    if control:
        ctrl = next((s for s in samples if s["label"] == control), None)
        if ctrl is None or "tm_fit" not in ctrl:
            warnings.append("Control %s has no fitted Tm, so no ΔTm is reported." % control)
            ctrl = None
    if ctrl is not None:
        for s in samples:
            if s is ctrl or "tm_fit" not in s:
                continue
            dtm = float(s["tm_fit"]) - float(ctrl["tm_fit"])
            se1, se2 = float(s["se"]), float(ctrl["se"])
            se = float(np.sqrt(se1 ** 2 + se2 ** 2))
            den = (se1 ** 4) / s["df"] + (se2 ** 4) / ctrl["df"]
            df = (se ** 4) / den if den > 0 else float(s["df"] + ctrl["df"])
            tc = float(stats.t.ppf(0.5 + conf / 2.0, df))
            s.update({"dtm": _r(dtm), "dtm_se": _r(se), "dtm_df": _r(df), "dtm_ciLow": _r(dtm - tc * se), "dtm_ciHigh": _r(dtm + tc * se)})

    u = (" " + unit) if unit else ""
    terms = []
    for s in samples:
        if "tm_fit" in s:
            row = {"term": "Tm (fit) — %s" % s["label"], "estimate": s["tm_fit"], "se": s["se"]}
            if s.get("n_fit", 0) == 1:
                c = next(c for c in s["columns"] if "tm_fit" in c)
                row.update({"ciLow": c.get("ciLow"), "ciHigh": c.get("ciHigh")})
            terms.append(row)
            if "sd_fit" in s:
                terms.append({"term": "Tm (fit) SD — %s" % s["label"], "estimate": s["sd_fit"]})
        if "tm_deriv" in s:
            terms.append({"term": "Tm (derivative) — %s" % s["label"], "estimate": s["tm_deriv"]})
        if "dtm" in s:
            terms.append({"term": "ΔTm vs %s — %s" % (ctrl["label"], s["label"]), "estimate": s["dtm"], "se": s["dtm_se"],
                          "ciLow": s["dtm_ciLow"], "ciHigh": s["dtm_ciHigh"]})
    head = samples[0]
    summary = "; ".join(
        "%s: Tm %s%s" % (s["label"], ("%.4g" % s["tm_fit"]) if "tm_fit" in s else "—", u) for s in samples)
    return {
        "method": "meltingtemp", "title": "Melting temperature (Tm)", "terms": terms,
        "glance": {"samples": len(samples), "sloped": sloped, "window_from": lo, "window_to": hi,
                   "tm": head.get("tm_fit"), "control": ctrl["label"] if ctrl else None},
        "extra": {"samples": samples, "curves": curves, "unit": unit},
        "summary": "Melting temperature by sigmoid fit (%s baselines) and first derivative. %s." % ("sloped" if sloped else "flat", summary),
        "assumptions": [
            "One two-state transition per curve inside the temperature window.",
            ("Each plateau drifts in a straight line (sloped baselines)." if sloped else "Both plateaus are flat."),
            "Tm (fit) is the sigmoid's midpoint; Tm (derivative) is the steepest point of the smoothed curve. They agree for a symmetric transition.",
            "A sample's Tm is the mean of its replicate columns; its SE is the fit SE for one column, SD/√n for several.",
            "ΔTm's interval treats the sample and the control as independent (Welch–Satterthwaite degrees of freedom).",
        ] + warnings,
        "cite": model["cite"],
    }


# Curated nested-model pairs (simpler ⊂ more-complex): the simpler model is a
# constrained special case of the complex one, so the extra-sum-of-squares F test
# is valid. Pairs whose parameter names are a subset are detected automatically;
# this set adds the ones that are mathematically nested but renamed (MM ⊂
# allosteric with h=1; MM ⊂ substrate-inhibition with Ki→∞; 1-phase ⊂ 2-phase).
_NESTED_PAIRS = {
    ("3pl", "4pl"), ("4pl", "5pl"), ("3pl", "5pl"),
    ("poly2", "poly3"),
    ("onesite", "hill_binding"),
    ("mm", "allosteric"), ("mm", "substrate_inhibition"),
    ("exp_decay", "exp_decay2"),
}


def _is_nested(simple_name, simple_model, complex_name, complex_model):
    """Is `simple` a constrained special case of `complex` (so extra-sum-of-squares
    F applies)? True when the pair is curated OR the simpler model's parameter
    names are a strict subset of the complex one's."""
    if (simple_name, complex_name) in _NESTED_PAIRS:
        return True
    sp, cp = set(simple_model["params"]), set(complex_model["params"])
    return sp < cp


def comparefits(data):
    """Compare two nonlinear models fit to the same dataset ("Compare
    models"). For each model reports SSE, df, R², AICc and BIC; then the
    information-theoretic verdict — ΔAICc and the Akaike weights (probability each
    model is the better one) — and, when the simpler model is nested inside the
    more complex one, the extra-sum-of-squares F test. AICc uses K = (#params + 1)
    to count the fitted variance, per Motulsky & Christopoulos."""
    np, stats = _np_sp()
    d = data or {}
    models = _nl_models()
    name_a = d.get("modelA") or d.get("model_a") or "3pl"
    name_b = d.get("modelB") or d.get("model_b") or "4pl"
    for nm in (name_a, name_b):
        if nm not in models:
            raise StatsError("bad_request", "unknown model: %s" % nm)
    if name_a == name_b:
        raise StatsError("bad_request", "choose two different models to compare")

    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    if n < 4:
        raise StatsError("bad_request", "model comparison needs ≥ 4 points")
    x, y = x[:n], y[:n]
    order = np.argsort(x)
    x, y = x[order], y[order]

    fits = {}
    for key, nm in (("A", name_a), ("B", name_b)):
        core = _nl_fit_core(np, models[nm], x, y, d)
        fits[key] = {"name": nm, "model": models[nm], "title": models[nm]["title"],
                     "sse": core["sse"], "k": core["k"], "n": core["n"]}

    # Both fits must use the same points, else AICc/F are not comparable. A log-x
    # model drops non-positive doses, so a log-x vs linear-x pairing can differ.
    if fits["A"]["n"] != fits["B"]["n"]:
        raise StatsError(
            "bad_request",
            "the two models fit different numbers of points (%d vs %d) — likely a "
            "log-dose model dropping non-positive X; cannot compare." % (fits["A"]["n"], fits["B"]["n"]))
    npts = fits["A"]["n"]

    def info_crit(sse, k):
        # K counts the fitted parameters + 1 for the residual variance.
        K = k + 1
        if sse <= 0:
            sse = 1e-300
        aic = npts * np.log(sse / npts) + 2 * K
        aicc = aic + (2 * K * (K + 1) / (npts - K - 1)) if (npts - K - 1) > 0 else float("inf")
        bic = npts * np.log(sse / npts) + K * np.log(npts)
        return float(aic), float(aicc), float(bic)

    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    for f in fits.values():
        f["aic"], f["aicc"], f["bic"] = info_crit(f["sse"], f["k"])
        f["r2"] = (1 - f["sse"] / ss_tot) if ss_tot > 0 else None

    fa, fb = fits["A"], fits["B"]
    # Akaike weights from ΔAICc (probability each model is the better choice).
    aicc_min = min(fa["aicc"], fb["aicc"])
    wa = np.exp(-0.5 * (fa["aicc"] - aicc_min))
    wb = np.exp(-0.5 * (fb["aicc"] - aicc_min))
    wsum = wa + wb
    prob_a, prob_b = float(wa / wsum), float(wb / wsum)
    preferred = fa if fa["aicc"] <= fb["aicc"] else fb
    delta_aicc = abs(fa["aicc"] - fb["aicc"])

    terms = []
    for f in (fa, fb):
        terms.append({
            "term": f["title"], "aicc": _r(f["aicc"]),
            "sse": _r(f["sse"]), "df": int(f["n"] - f["k"]),
            "params": int(f["k"]), "r2": _r(f["r2"]), "bic": _r(f["bic"]),
            "probability": _r(prob_a if f is fa else prob_b),
        })
    terms.append({"term": "ΔAICc", "estimate": _r(delta_aicc)})
    terms.append({"term": "Preferred (lower AICc)", "estimate": preferred["title"],
                  "probability": _r(prob_a if preferred is fa else prob_b)})

    # Extra-sum-of-squares F test when one model is nested in the other.
    simple, complex_ = (fa, fb) if fa["k"] <= fb["k"] else (fb, fa)
    ftest = None
    if simple["k"] < complex_["k"] and _is_nested(simple["name"], simple["model"],
                                                   complex_["name"], complex_["model"]):
        df1 = complex_["k"] - simple["k"]
        df2 = complex_["n"] - complex_["k"]
        if df2 > 0 and complex_["sse"] > 0 and simple["sse"] >= complex_["sse"]:
            fstat = ((simple["sse"] - complex_["sse"]) / df1) / (complex_["sse"] / df2)
            pval = float(stats.f.sf(fstat, df1, df2))
            ftest = {"F": _r(float(fstat)), "df1": df1, "df2": df2, "p": _r(pval)}
            f_choice = complex_["title"] if pval < 0.05 else simple["title"]
            terms.append({"term": "Extra-SS F", "estimate": _r(float(fstat)),
                          "df": "%d, %d" % (df1, df2), "p": _r(pval)})
            terms.append({"term": "F-test prefers (α=0.05)", "estimate": f_choice})

    summary = "AICc prefers %s (ΔAICc = %.3g; P = %.1f%%)." % (
        preferred["title"], delta_aicc, (prob_a if preferred is fa else prob_b) * 100)
    if ftest is not None:
        summary += " Extra-SS F(%d,%d) = %.4g, P = %s." % (
            ftest["df1"], ftest["df2"], ftest["F"],
            ("%.4g" % ftest["p"]) if ftest["p"] is not None else "—")

    glance = {"n": npts, "model_a": name_a, "model_b": name_b,
              "aicc_a": _r(fa["aicc"]), "aicc_b": _r(fb["aicc"]),
              "delta_aicc": _r(delta_aicc), "prob_a": _r(prob_a), "prob_b": _r(prob_b),
              "preferred": preferred["name"]}
    if ftest is not None:
        glance.update({"f": ftest["F"], "f_p": ftest["p"], "f_df1": ftest["df1"], "f_df2": ftest["df2"]})

    assumptions = [
        "Both models fit to the same %d points by nonlinear least squares." % npts,
        "AICc (K = #params + 1) is a relative measure — it ranks the candidates, it does not test fit quality.",
    ]
    if d.get("weighting") not in (None, "none", ""):
        assumptions.append("Weighting: %s." % d.get("weighting"))
    if ftest is not None:
        assumptions.append("Extra-sum-of-squares F is valid because the simpler model is nested in the more complex one.")
    else:
        assumptions.append("No extra-sum-of-squares F: the models are not nested (use AICc to choose).")

    return {
        "method": "comparefits",
        "title": "Compare models — %s vs %s" % (fa["title"], fb["title"]),
        "terms": terms, "glance": glance, "summary": summary,
        "extra": {"ftest": ftest, "preferred": preferred["name"]},
        "assumptions": assumptions,
        "cite": "Akaike's information criterion (AICc) and the extra-sum-of-squares F test "
                "for model selection (Motulsky & Christopoulos, 2004).",
    }


def goodnessoffit(data):
    """Chi-square goodness-of-fit ("observed vs expected" / parts-of-whole): does a
    set of observed category counts match an expected distribution (default
    uniform)? Reports Pearson χ² with k−1 df, a per-category observed/expected
    breakdown, and — for exactly two categories — an exact binomial test."""
    np, stats = _np_sp()
    d = data or {}
    obs = _num(d.get("observed", []))
    k = len(obs)
    if k < 2:
        raise StatsError("bad_request", "goodness-of-fit needs ≥ 2 categories")
    if any(v < 0 for v in obs):
        raise StatsError("bad_request", "counts cannot be negative")
    total = float(sum(obs))
    if total <= 0:
        raise StatsError("bad_request", "need a positive total count")
    labels = d.get("labels") or ["Category %d" % (i + 1) for i in range(k)]
    # Read the Expected column positionally. `_num` compacts, so a single blank would make
    # the column "the wrong length" and fall through to the uniform default — silently
    # testing a different hypothesis, which can reverse the conclusion with no warning.
    exp_cells = [_num1(v) for v in (d.get("expected") or [])]
    given = [v for v in exp_cells if v is not None]
    if not given:
        exp = [total / k] * k                  # nothing entered → uniform, the documented default
    elif len(exp_cells) != k or len(given) != k:
        missing = [labels[i] if i < len(labels) else "category %d" % (i + 1)
                   for i, v in enumerate(exp_cells) if v is None][:3]
        raise StatsError(
            "bad_request",
            "the Expected column is incomplete (%s) — fill every category, or clear the column "
            "to test against a uniform distribution"
            % (", ".join(missing) if missing else "%d of %d values" % (len(given), k)))
    elif sum(given) <= 0:
        raise StatsError("bad_request", "the Expected values must add up to more than zero")
    else:
        s = float(sum(given))                  # proportions OR counts → scale to the observed total
        exp = [e / s * total for e in given]

    chi2, p = stats.chisquare(f_obs=obs, f_exp=exp)
    df = k - 1
    terms = [{"term": "Chi-square", "statistic": _r(float(chi2)), "df": df, "p": _r(float(p))}]
    for i in range(k):
        terms.append({"term": labels[i], "observed": _r(obs[i]), "expected": _r(exp[i])})
    binom_p = None
    if k == 2:
        binom_p = float(stats.binomtest(int(round(obs[0])), int(round(total)), exp[0] / total).pvalue)
        terms.append({"term": "Exact binomial test", "p": _r(binom_p)})

    return {
        "method": "goodnessoffit", "title": "Chi-square goodness-of-fit", "terms": terms,
        "glance": {"chi_sq": _r(float(chi2)), "df": df, "p": _r(float(p)), "k": k, "n": int(round(total)),
                   "binom_p": _r(binom_p)},
        "summary": "χ²(%d, N=%d) = %.4g, p = %s — the observed counts are %s the expected distribution (%s)." % (
            df, int(round(total)), float(chi2), "%.4g" % float(p),
            "inconsistent with" if p < 0.05 else "consistent with", _p_words(float(p))),
        "assumptions": [
            "Counts, not proportions; the χ² approximation wants every expected count ≥ ~5.",
            "Categories are mutually exclusive and exhaustive (each observation in exactly one).",
        ] + (["Two categories → an exact binomial test is reported alongside the χ²."] if k == 2 else []),
        "cite": "Pearson chi-square goodness-of-fit%s." % (
            "; exact binomial test for two categories" if k == 2 else ""),
    }


def nested(data):
    """Nested (hierarchical) ANOVA / nested t test: groups that contain random
    subgroups that contain replicate measurements. The group effect is tested
    against the among-subgroups variation — the correct error term — not the raw
    residual, so pseudo-replication doesn't inflate significance. Two groups also
    yield a nested t. Works for unbalanced designs (general SS formulas)."""
    np, stats = _np_sp()
    d = data or {}
    groups = []
    for g in (d.get("groups") or []):
        subs = [_num(s) for s in (g.get("subgroups") or [])]
        subs = [s for s in subs if len(s) > 0]
        if subs:
            groups.append({"label": g.get("label", "Group %d" % (len(groups) + 1)), "subs": subs})
    a = len(groups)
    if a < 2:
        raise StatsError("bad_request", "nested analysis needs ≥ 2 groups")
    all_obs = [v for g in groups for s in g["subs"] for v in s]
    N = len(all_obs)
    n_sub_total = sum(len(g["subs"]) for g in groups)
    if n_sub_total <= a:
        raise StatsError("bad_request", "need ≥ 2 subgroups within at least one group")
    if N <= n_sub_total:
        raise StatsError("bad_request", "need replicate measurements within the subgroups")
    grand = float(np.mean(all_obs))

    ss_groups = ss_subs = ss_within = 0.0
    for g in groups:
        g_obs = [v for s in g["subs"] for v in s]
        g_mean = float(np.mean(g_obs))
        ss_groups += len(g_obs) * (g_mean - grand) ** 2
        for s in g["subs"]:
            s_mean = float(np.mean(s))
            ss_subs += len(s) * (s_mean - g_mean) ** 2
            for v in s:
                ss_within += (v - s_mean) ** 2
    df_groups, df_subs, df_within = a - 1, n_sub_total - a, N - n_sub_total
    ms_groups = ss_groups / df_groups
    ms_subs = ss_subs / df_subs if df_subs > 0 else float("nan")
    ms_within = ss_within / df_within if df_within > 0 else float("nan")
    # Nested F: the group mean square is tested against the subgroup mean square
    # (subgroups are the replication unit for the group effect); subgroups vs within.
    F_groups = ms_groups / ms_subs if ms_subs and ms_subs > 0 else None
    p_groups = float(stats.f.sf(F_groups, df_groups, df_subs)) if F_groups is not None else None
    F_subs = ms_subs / ms_within if ms_within and ms_within > 0 else None
    p_subs = float(stats.f.sf(F_subs, df_subs, df_within)) if F_subs is not None else None

    terms = [
        {"term": "Groups", "estimate": _r(ss_groups), "df": df_groups,
         "statistic": _r(F_groups), "p": _r(p_groups)},
        {"term": "Subgroups within groups", "estimate": _r(ss_subs), "df": df_subs,
         "statistic": _r(F_subs), "p": _r(p_subs)},
        {"term": "Residual (within subgroups)", "estimate": _r(ss_within), "df": df_within},
    ]
    tval = None
    if a == 2 and F_groups is not None:
        tval = F_groups ** 0.5
        m0 = float(np.mean([v for s in groups[0]["subs"] for v in s]))
        m1 = float(np.mean([v for s in groups[1]["subs"] for v in s]))
        if m0 < m1:
            tval = -tval
        terms.append({"term": "Nested t", "statistic": _r(tval), "df": df_subs, "p": _r(p_groups)})

    return {
        "method": "nested", "title": "Nested ANOVA" + (" / nested t" if a == 2 else ""), "terms": terms,
        "glance": {"f_groups": _r(F_groups), "p": _r(p_groups), "df_groups": df_groups,
                   "df_subgroups": df_subs, "df_within": df_within, "groups": a,
                   "subgroups": n_sub_total, "n": N, "t": _r(tval)},
        "summary": "Nested ANOVA: F(%d, %d) = %s for the group effect (tested against among-subgroup "
                   "variation), p = %s (%s)." % (
            df_groups, df_subs, ("%.4g" % F_groups) if F_groups is not None else "—",
            ("%.4g" % p_groups) if p_groups is not None else "—",
            _p_words(p_groups) if p_groups is not None else "indeterminate"),
        "assumptions": [
            "Subgroups are a random sample within each group; the group effect uses the among-subgroup "
            "mean square as its error term (avoids pseudo-replication).",
            "Approximately normal residuals + homogeneous variances across subgroups.",
        ],
        "cite": "Nested (hierarchical) ANOVA, group effect tested against subgroups-within-groups"
                "%s." % ("; nested t for two groups" if a == 2 else ""),
    }


def twoway(data):
    """Balanced two-way ANOVA with replication: main effects A (rows) + B (columns) + interaction.

    `cells[i][j]` is the list of replicate values for row i × column j. Requires a
    balanced design (every cell the same n ≥ 2) so the sums of squares partition
    cleanly (Σ = total) without a design matrix.
    """
    np, stats = _np_sp()
    d = data or {}
    raw = d.get("cells", [])
    a = len(raw)
    b = len(raw[0]) if a else 0
    if a < 2 or b < 2:
        raise StatsError("bad_request", "two-way ANOVA needs ≥ 2 rows and ≥ 2 columns")
    cells = [[_num(raw[i][j]) for j in range(b)] for i in range(a)]
    counts = {len(cells[i][j]) for i in range(a) for j in range(b)}
    if len(counts) != 1:
        raise StatsError("bad_request", "unbalanced design — every cell needs the same number of replicates")
    n = counts.pop()
    if n < 2:
        raise StatsError("bad_request", "two-way ANOVA needs ≥ 2 replicates per cell (balanced)")
    cell = np.array([[np.asarray(cells[i][j], dtype=float) for j in range(b)] for i in range(a)], dtype=float)
    grand = float(cell.mean())
    rowm = cell.mean(axis=(1, 2))   # mean of each factor-A level
    colm = cell.mean(axis=(0, 2))   # mean of each factor-B level
    cellm = cell.mean(axis=2)       # mean of each cell
    ss_a = b * n * float(np.sum((rowm - grand) ** 2))
    ss_b = a * n * float(np.sum((colm - grand) ** 2))
    inter = cellm - rowm[:, None] - colm[None, :] + grand
    ss_ab = n * float(np.sum(inter ** 2))
    ss_w = float(np.sum((cell - cellm[:, :, None]) ** 2))
    df_a, df_b, df_ab, df_w = a - 1, b - 1, (a - 1) * (b - 1), a * b * (n - 1)
    ms_w = ss_w / df_w if df_w else float("nan")

    def fp(ss, df):
        if ms_w <= 0 or df <= 0:
            return None, None
        f = (ss / df) / ms_w
        return f, float(stats.f.sf(f, df, df_w))

    f_a, p_a = fp(ss_a, df_a)
    f_b, p_b = fp(ss_b, df_b)
    f_ab, p_ab = fp(ss_ab, df_ab)
    rl = d.get("rowLabels") or ["Row %d" % (i + 1) for i in range(a)]
    cl = d.get("colLabels") or ["Col %d" % (j + 1) for j in range(b)]
    aname = "Factor A (%s)" % (", ".join(str(x) for x in rl[:3]) + ("…" if a > 3 else ""))
    bname = "Factor B (%s)" % (", ".join(str(x) for x in cl[:3]) + ("…" if b > 3 else ""))
    terms = [
        {"term": aname, "estimate": _r(ss_a), "df": df_a, "statistic": _r(f_a), "p": _r(p_a)},
        {"term": bname, "estimate": _r(ss_b), "df": df_b, "statistic": _r(f_b), "p": _r(p_b)},
        {"term": "Interaction A×B", "estimate": _r(ss_ab), "df": df_ab, "statistic": _r(f_ab), "p": _r(p_ab)},
        {"term": "Residual", "estimate": _r(ss_w), "df": df_w},
    ]
    # ── Post-hoc multiple comparisons (opt-in via `posthoc`) ──────────────────
    # Pooled error = the two-way model's residual (MS_residual, df_residual) for all
    # comparisons (the recommended approach — more power/df than separate one-way
    # ANOVAs per strip). `compare` selects the family: factor-A row means, factor-B
    # column means, or every cell mean. Tukey uses a studentized range on MS_residual
    # (scipy's tukey_hsd would recompute a different error term); the t-based families
    # (Bonferroni/Šídák/Holm-Šídák/FDR) reuse _posthoc with mse = MS_residual.
    ph_note = None
    method = d.get("posthoc")
    if method:
        compare = d.get("compare", "rowmeans")
        scheme = d.get("scheme", "all-pairs")
        conf = float(d.get("conf", 0.95))
        selected = d.get("pairs")
        if compare == "colmeans":
            obs = [cell[:, j, :].ravel() for j in range(b)]
            phl = [str(x) for x in cl]
            fam = "column means"
        elif compare == "cellmeans":
            obs = [cell[i, j, :] for i in range(a) for j in range(b)]
            phl = ["%s · %s" % (rl[i], cl[j]) for i in range(a) for j in range(b)]
            fam = "cell means"
        else:
            obs = [cell[i, :, :].ravel() for i in range(a)]
            phl = [str(x) for x in rl]
            fam = "row means"
        kk = len(obs)
        ctrl = int(d.get("control", 0))
        ctrl = ctrl if 0 <= ctrl < kk else 0
        if method == "tukey":
            if scheme == "selected-pairs":
                raise StatsError("bad_request", "Tukey HSD compares all pairs; for selected pairs use Bonferroni, Šídák, Holm-Šídák, or FDR.")
            pairs = _comparison_pairs(kk, scheme, ctrl, selected)
            means_ph = [float(g.mean()) for g in obs]
            ns_ph = [int(g.size) for g in obs]
            terms.extend(_tukey_pooled(stats, means_ph, ns_ph, phl, ms_w, df_w, pairs, conf))
        else:
            terms.extend(_posthoc(np, stats, [np.asarray(g, dtype=float) for g in obs], phl, scheme, ctrl, method, ms_w, df_w, conf, selected))
        ph_note = "%s of %s — %s correction (pooled MS_residual, df %d)." % (
            {"vs-control": "Each-vs-control comparisons", "selected-pairs": "Selected-pair comparisons"}.get(scheme, "All-pairs comparisons"),
            fam, _POSTHOC_LABEL.get(method, method), df_w)
    # Residuals = observation − its cell mean (the within-cell deviation); fitted = cell mean.
    resid_arr = (cell - cellm[:, :, None]).ravel()
    fitted_arr = np.broadcast_to(cellm[:, :, None], cell.shape).ravel()
    return {
        "method": "twoway", "title": "Two-way ANOVA", "terms": terms,
        "extra": {"residuals": {"fitted": [_r(float(v)) for v in fitted_arr],
                                "resid": [_r(float(v)) for v in resid_arr]}},
        "glance": {"ss_a": _r(ss_a), "ss_b": _r(ss_b), "ss_ab": _r(ss_ab), "ss_resid": _r(ss_w),
                   "df_a": df_a, "df_b": df_b, "df_ab": df_ab, "df_resid": df_w,
                   "F_a": _r(f_a), "F_b": _r(f_b), "F_ab": _r(f_ab),
                   "p_a": _r(p_a), "p_b": _r(p_b), "p_ab": _r(p_ab), "n_per_cell": n},
        "summary": "Two-way ANOVA — row factor p = %s, column factor p = %s, interaction p = %s.%s" % (
            ("%.4g" % p_a) if p_a is not None else "—",
            ("%.4g" % p_b) if p_b is not None else "—",
            ("%.4g" % p_ab) if p_ab is not None else "—",
            (" " + ph_note) if ph_note else ""),
        "assumptions": ["Balanced design (equal cell n); assumes normal residuals + equal variances."]
        + (["Post-hoc comparisons use the two-way model's residual as the pooled error term, so they share MS_residual + its df across the whole family."] if ph_note else []),
        "cite": "Two-way ANOVA (type I = type III for balanced data); main effects + interaction.",
    }


def multifactor(data):
    """N-way factorial ANOVA (2–4 crossed fixed factors) via OLS + Type-II sums of
    squares (statsmodels), for balanced or unbalanced designs. Reports each main
    effect + every interaction (SS, df, F, p) + the residual, with fitted/residual
    arrays. On balanced 2-factor data this reproduces the from-scratch two-way exactly."""
    np, stats = _np_sp()  # noqa: F841 (kept for the shared import contract)
    import pandas as pd
    from statsmodels.formula.api import ols
    from statsmodels.stats.anova import anova_lm

    d = data or {}
    yraw = list(d.get("value", []))
    factors = d.get("factors", []) or []
    nf = len(factors)
    labels = d.get("factorLabels") or ["Factor %d" % (i + 1) for i in range(nf)]
    if nf < 2:
        raise StatsError("bad_request", "multifactor ANOVA needs ≥ 2 factors (use one-way ANOVA for one).")
    if nf > 4:
        raise StatsError("bad_request", "multifactor ANOVA supports up to 4 factors.")

    # Row-aligned listwise assembly: keep a row only when the value is numeric and every
    # factor level is present. Factor column names are f0/f1/… — never "C" (patsy's C()).
    fnames = ["f%d" % i for i in range(nf)]
    rows = {"y": [], **{fn: [] for fn in fnames}}
    n = len(yraw)
    for r in range(n):
        try:
            yy = float(yraw[r])
        except (TypeError, ValueError, IndexError):
            continue
        if yy != yy:  # NaN
            continue
        levels = [factors[i][r] if r < len(factors[i]) else None for i in range(nf)]
        if any(lv is None or lv == "" for lv in levels):
            continue
        rows["y"].append(yy)
        for i, fn in enumerate(fnames):
            rows[fn].append(str(levels[i]))
    if len(rows["y"]) < nf + 2:
        raise StatsError("bad_request", "too few complete rows for a %d-factor ANOVA." % nf)
    df = pd.DataFrame(rows)
    for i, fn in enumerate(fnames):
        if df[fn].nunique() < 2:
            raise StatsError("bad_request", "factor '%s' has fewer than 2 levels." % labels[i])

    formula = "y ~ " + "*".join("C(%s)" % fn for fn in fnames)  # full factorial (all interactions)
    try:
        model = ols(formula, data=df).fit()
        aov = anova_lm(model, typ=2)
    except Exception as e:  # empty factor combinations, rank deficiency, etc.
        raise StatsError("bad_request", "could not fit the factorial model (check for empty factor combinations): %s" % e)

    def pretty(name):
        if name == "Residual":
            return "Residual"
        idxs = [int(p[2:-1][1:]) for p in name.split(":")]  # "C(f0):C(f1)" → [0, 1]
        return " × ".join(labels[k] for k in idxs)

    terms = []
    for name in aov.index:
        row = aov.loc[name]
        ss, dfree = float(row["sum_sq"]), int(row["df"])
        term = {"term": pretty(name), "estimate": _r(ss), "df": dfree}
        f, p = row.get("F"), row.get("PR(>F)")
        if name != "Residual" and f == f and p == p:  # exclude NaN (Residual row)
            term["statistic"], term["p"] = _r(float(f)), _r(float(p))
        terms.append(term)
    resid = {"fitted": [_r(float(v)) for v in model.fittedvalues],
             "resid": [_r(float(v)) for v in model.resid]}
    sig = [pretty(nm) for nm in aov.index
           if nm != "Residual" and float(aov.loc[nm].get("PR(>F)", 1.0)) < 0.05]
    return {
        "method": "multifactor", "title": "%d-way ANOVA" % nf, "terms": terms,
        "extra": {"residuals": resid},
        "glance": {"n": int(len(df)), "factors": nf, "r_sq": _r(float(model.rsquared))},
        "summary": "%d-way factorial ANOVA (Type II SS) over %d observations%s." % (
            nf, len(df), ("; significant: " + ", ".join(sig)) if sig else "; nothing reached p < 0.05"),
        "assumptions": ["Fixed-effects factorial ANOVA; assumes normal residuals + homoscedastic cells.",
                        "Type II sums of squares (order-independent; equals Type I/III for a balanced design)."],
        "cite": "N-way factorial ANOVA via OLS with Type II sums of squares (statsmodels anova_lm).",
    }


def mixedmodel(data):
    """Linear mixed-effects model fit by REML (statsmodels MixedLM): fixed effects from
    the chosen factor(s) + a random intercept per group (the random grouping factor).
    Reports each fixed-effect coefficient (SE/z/p/CI), the group + residual variance
    components, the intraclass correlation (ICC), and the fit's log-likelihood. For a
    balanced one-way random-effects design the REML variance components equal the ANOVA
    method-of-moments estimates (independently cross-checked in crosscheck.py)."""
    np, stats = _np_sp()
    import pandas as pd
    import statsmodels.formula.api as smf

    d = data or {}
    yraw = list(d.get("value", []))
    group = d.get("group", []) or []       # the random grouping factor's level per observation
    fixed = d.get("fixed", []) or []       # optional fixed-factor level arrays
    glabel = d.get("groupLabel", "Group")
    reml = bool(d.get("reml", True))
    conf = float(d.get("conf", 0.95))      # fixed-effect CI level
    if not group:
        raise StatsError("bad_request", "a mixed model needs a random grouping factor.")

    # Row-aligned listwise assembly (value numeric, group + every fixed level present).
    fnames = ["f%d" % i for i in range(len(fixed))]
    rows = {"y": [], "grp": [], **{fn: [] for fn in fnames}}
    n = len(yraw)
    for r in range(n):
        try:
            yy = float(yraw[r])
        except (TypeError, ValueError, IndexError):
            continue
        if yy != yy:
            continue
        gv = group[r] if r < len(group) else None
        if gv is None or gv == "":
            continue
        levels = [fixed[i][r] if r < len(fixed[i]) else None for i in range(len(fixed))]
        if any(lv is None or lv == "" for lv in levels):
            continue
        rows["y"].append(yy)
        rows["grp"].append(str(gv))
        for i, fn in enumerate(fnames):
            rows[fn].append(str(levels[i]))
    df = pd.DataFrame(rows)
    ng = int(df["grp"].nunique())
    if ng < 2:
        raise StatsError("bad_request", "the random grouping factor needs ≥ 2 groups.")
    if len(df) < ng + 2:
        raise StatsError("bad_request", "too few observations for a mixed model.")

    formula = "y ~ " + ("*".join("C(%s)" % fn for fn in fnames) if fnames else "1")
    try:
        m = smf.mixedlm(formula, df, groups=df["grp"]).fit(reml=reml)
    except Exception as e:
        raise StatsError("bad_request", "the mixed model did not fit: %s" % e)

    sig_grp = float(m.cov_re.iloc[0, 0])   # random-intercept (between-group) variance
    sig_res = float(m.scale)               # residual (within-group) variance
    icc = sig_grp / (sig_grp + sig_res) if (sig_grp + sig_res) > 0 else None

    fe = m.fe_params
    ci = m.conf_int(alpha=1.0 - conf)
    terms = []
    for name in fe.index:
        est = float(fe[name])
        se = float(m.bse_fe[name]) if name in m.bse_fe.index else float("nan")
        z = float(m.tvalues[name]) if name in m.tvalues.index else (est / se if se and se > 0 else 0.0)
        p = float(m.pvalues[name]) if name in m.pvalues.index else 2.0 * float(stats.norm.sf(abs(z)))
        row = ci.loc[name] if name in ci.index else None
        terms.append({"term": "Fixed: %s" % name, "estimate": _r(est), "se": _r(se),
                      "statistic": _r(z), "p": _r(p),
                      **({"ciLow": _r(float(row.iloc[0])), "ciHigh": _r(float(row.iloc[1]))} if row is not None else {})})
    terms.append({"term": "%s variance (random)" % glabel, "estimate": _r(sig_grp)})
    terms.append({"term": "Residual variance", "estimate": _r(sig_res)})
    if icc is not None:
        terms.append({"term": "ICC (intraclass correlation)", "estimate": _r(icc)})

    return {
        "method": "mixedmodel", "title": "Mixed-effects model (REML)" if reml else "Mixed-effects model (ML)",
        "terms": terms,
        "glance": {"n": int(len(df)), "groups": ng, "group_var": _r(sig_grp), "resid_var": _r(sig_res),
                   "icc": _r(icc), "loglik": _r(float(m.llf)), "reml": reml},
        "summary": "Mixed model (%s): %d observations in %d '%s' groups; ICC = %s (group SD %s, residual SD %s)." % (
            "REML" if reml else "ML", len(df), ng, glabel,
            ("%.3g" % icc) if icc is not None else "—",
            "%.3g" % (sig_grp ** 0.5), "%.3g" % (sig_res ** 0.5)),
        "assumptions": ["Linear mixed model: a random intercept per group (random effects ~ Normal) + Gaussian residuals.",
                        "REML variance components are (approximately) unbiased; for a balanced one-way random design they equal the ANOVA method-of-moments estimates."],
        "cite": "Linear mixed-effects model fit by REML (statsmodels MixedLM); random intercept per group; ICC = σ²_group/(σ²_group + σ²_residual).",
    }


def _gg_epsilon(np, Y):
    """Greenhouse-Geisser sphericity ε (Box's correction), clamped to [1/(k-1), 1]."""
    n, k = Y.shape
    S = np.cov(Y.T, bias=False)
    dbar = float(np.mean(np.diag(S)))
    gbar = float(np.mean(S))
    rbar = S.mean(1)
    num = k * k * (dbar - gbar) ** 2
    den = (k - 1) * (float(np.sum(S * S)) - 2 * k * float(np.sum(rbar * rbar)) + k * k * gbar * gbar)
    if den <= 1e-12:
        return 1.0  # degenerate (perfect sphericity / additive) → no correction
    return float(min(1.0, max(1.0 / (k - 1), num / den)))


def rmanova(data):
    """One-way repeated-measures ANOVA (within-subjects) + Greenhouse-Geisser correction."""
    np, stats = _np_sp()
    d = data or {}
    variant = d.get("variant")
    rows = [_num(r) for r in d.get("data", [])]
    k = max((len(r) for r in rows), default=0)
    Y = [r for r in rows if len(r) == k]  # complete cases only (every subject in every condition)
    if k < 2 or len(Y) < 2:
        raise StatsError("bad_request", "RM ANOVA needs ≥ 2 conditions and ≥ 2 complete subjects")
    Y = np.asarray(Y, dtype=float)
    n = Y.shape[0]

    if variant == "friedman":
        # Friedman test (RM nonparametric) = the within-subjects analogue of Kruskal-Wallis.
        labels = d.get("labels") or ["Cond %d" % (j + 1) for j in range(k)]
        chi, p = stats.friedmanchisquare(*[Y[:, j] for j in range(k)])
        df = k - 1
        ranks = np.apply_along_axis(stats.rankdata, 1, Y)  # rank within each subject (block); ties → average ranks
        R = ranks.sum(0)                                   # rank sum per condition
        terms = [{"term": labels[j], "estimate": _r(float(R[j] / n))} for j in range(k)]  # mean rank
        # Dunn's post-hoc: z = (R_i − R_j)/SE, Bonferroni-adjusted over all pairs. The SE is the
        # tie-corrected variance of a rank-sum difference: Var(R_i−R_j) = Σ_blocks 2·s²_b·k/(k−1),
        # s²_b = the block's rank variance about (k+1)/2. With no ties s²_b = (k²−1)/12 and this
        # reduces exactly to n·k(k+1)/6; with ties the variance shrinks (so the omnibus χ², which
        # scipy already tie-corrects, and the post-hoc stay consistent — by the conventional method).
        sb2 = ((ranks - (k + 1) / 2.0) ** 2).mean(axis=1)  # per-block population variance of ranks
        se = float((2.0 * sb2 * k / (k - 1)).sum()) ** 0.5
        pairs = [(i, j) for i in range(k) for j in range(i + 1, k)]
        m = len(pairs)
        for (i, j) in pairs:
            z = abs(float(R[i] - R[j])) / se if se > 0 else 0.0
            p_adj = min(1.0, 2.0 * float(stats.norm.sf(z)) * m)
            terms.append({"term": "%s vs %s" % (labels[i], labels[j]),
                          "estimate": _r(float((R[i] - R[j]) / n)), "statistic": _r(z), "p": _r(p_adj)})
        return {
            "method": "rmanova", "title": "Friedman test (RM nonparametric)", "terms": terms,
            "glance": {"chi_sq": _r(float(chi)), "df": df, "p": _r(float(p)), "n_subjects": n, "k_conditions": k},
            "summary": "Friedman χ²(%d) = %.4g, p = %s — condition ranks %s." % (
                df, float(chi), "%.4g" % float(p), _p_words(float(p))),
            "assumptions": ["Distribution-free repeated measures; compares within-subject ranks across conditions.",
                            "Dunn's post-hoc (Bonferroni-adjusted, tie-corrected SE) for pairwise comparisons.",
                            "Assumes few ties; with many tied values the χ² approximation is conservative."],
            "cite": "Friedman test with Dunn's multiple comparisons.",
        }

    grand = float(Y.mean())
    col, row = Y.mean(0), Y.mean(1)
    ss_cond = n * float(np.sum((col - grand) ** 2))
    ss_subj = k * float(np.sum((row - grand) ** 2))
    ss_err = float(np.sum((Y - grand) ** 2)) - ss_cond - ss_subj
    df_c, df_e = k - 1, (n - 1) * (k - 1)
    ms_e = ss_err / df_e if df_e else float("nan")
    f = (ss_cond / df_c) / ms_e if ms_e > 0 else None
    p = float(stats.f.sf(f, df_c, df_e)) if f is not None else None
    peta = ss_cond / (ss_cond + ss_err) if (ss_cond + ss_err) > 0 else None
    eps = _gg_epsilon(np, Y)
    p_gg = float(stats.f.sf(f, df_c * eps, df_e * eps)) if f is not None else None
    labels = d.get("labels") or ["Cond %d" % (j + 1) for j in range(k)]
    cname = "Conditions (%s)" % (", ".join(str(x) for x in labels[:3]) + ("…" if k > 3 else ""))
    terms = [
        {"term": cname, "estimate": _r(ss_cond), "df": df_c, "statistic": _r(f), "p": _r(p)},
        {"term": "Subjects", "estimate": _r(ss_subj), "df": n - 1},
        {"term": "Residual", "estimate": _r(ss_err), "df": df_e},
    ]
    # Residuals of the additive (no-interaction) RM model: ŷ_ij = subjectᵢ + condⱼ − grand.
    pred = row[:, None] + col[None, :] - grand
    rm_resid = (Y - pred).ravel()
    rm_fit = pred.ravel()
    return {
        "method": "rmanova", "title": "One-way repeated-measures ANOVA", "terms": terms,
        "extra": {"residuals": {"fitted": [_r(float(v)) for v in rm_fit],
                                "resid": [_r(float(v)) for v in rm_resid]}},
        "glance": {"F": _r(f), "df_cond": df_c, "df_resid": df_e, "p": _r(p),
                   "partial_eta_sq": _r(peta), "gg_epsilon": _r(eps), "p_gg": _r(p_gg),
                   "n_subjects": n, "k_conditions": k},
        "summary": "RM ANOVA: F(%d, %d) = %.4g, p = %s (Greenhouse-Geisser p = %s, ε = %.3f); partial η² = %s." % (
            df_c, df_e, f if f is not None else float("nan"),
            ("%.4g" % p) if p is not None else "—", ("%.4g" % p_gg) if p_gg is not None else "—",
            eps, ("%.3g" % peta) if peta is not None else "—"),
        "assumptions": ["Within-subjects: each subject measured in every condition (complete cases only).",
                        "Assumes sphericity — the Greenhouse-Geisser-corrected p is reported alongside."],
        "cite": "One-way repeated-measures ANOVA; Greenhouse-Geisser sphericity correction; partial η².",
    }


def mixedanova(data):
    """Two-way repeated-measures ANOVA with one between-subjects factor (the groups) and one within-subjects factor
    (the repeated time points / conditions) - the split-plot or "mixed" design.

    `groups` = [{"label", "subjects": [[value at each time point], ...]}, ...]; `timeLabels` names the time points. A
    subject missing any time point is left out (complete cases), and the count is reported.

    Sums of squares: between subjects, group vs subjects-within-groups; within subjects, from orthonormal contrasts of
    each subject's time points. Time is the Type III test (the unweighted mean of the group means, the usual
    convention; identical to every textbook formula when the groups are the same size), group x time is the one-way
    ANOVA of the contrast scores across groups, and the residual is their pooled within-group variation. The
    Greenhouse-Geisser epsilon comes from the pooled within-group covariance of those contrasts (as the R package afex does) and
    corrects both within-subject tests.

    `compare` (optional): "groups" = the groups against each other at each time point (pooled SD at that time,
    df N - G); "times" = the time points against each other within each group (paired t, df n - 1). Sidak-adjusted
    over the whole family."""
    np, stats = _np_sp()
    d = data or {}
    raw = d.get("groups") or []
    labels, mats, dropped = [], [], 0
    k = 0
    for g in raw:
        for s in g.get("subjects") or []:
            k = max(k, len(s))
    for gi, g in enumerate(raw):
        keep = []
        for s in g.get("subjects") or []:
            vals = []
            for v in list(s) + [None] * (k - len(s)):
                try:
                    f = float(v) if v is not None and v != "" else float("nan")
                except (TypeError, ValueError):
                    f = float("nan")
                vals.append(f)
            if all(np.isfinite(vals)):
                keep.append(vals)
            elif any(np.isfinite(vals)):
                dropped += 1
        labels.append(str(g.get("label") or "Group %d" % (gi + 1)))
        mats.append(np.asarray(keep, dtype=float).reshape(-1, k) if keep else np.zeros((0, k)))
    G = len(mats)
    if G < 2:
        raise StatsError("bad_request", "a mixed (split-plot) ANOVA needs at least 2 groups - pick two or more datasets")
    if k < 2:
        raise StatsError("bad_request", "a mixed (split-plot) ANOVA needs at least 2 time points (rows)")
    small = [labels[i] for i, m in enumerate(mats) if m.shape[0] < 2]
    if small:
        raise StatsError("bad_request", "every group needs at least 2 subjects measured at every time point - too few in: %s" % ", ".join(small))
    Ns = [m.shape[0] for m in mats]
    N = sum(Ns)
    allY = np.vstack(mats)
    grand = float(allY.mean())
    # Between subjects: each subject's mean over the time points.
    subj = [m.mean(axis=1) for m in mats]
    gmean = [float(s.mean()) for s in subj]
    ss_g = k * sum(n * (x - grand) ** 2 for n, x in zip(Ns, gmean))
    ss_sg = k * sum(float(((s - x) ** 2).sum()) for s, x in zip(subj, gmean))
    # Within subjects: orthonormal contrasts (k x k-1), every column orthogonal to the constant.
    C = np.linalg.qr(np.column_stack([np.ones(k), np.eye(k)[:, : k - 1]]))[0][:, 1:]
    Z = [m @ C for m in mats]
    zbar = [z.mean(axis=0) for z in Z]
    L = np.mean(zbar, axis=0)
    ss_t = float((L ** 2).sum() / sum(1.0 / (G * G * n) for n in Ns))
    zall = np.vstack(Z).mean(axis=0)
    ss_gt = float(sum(n * float(((zb - zall) ** 2).sum()) for n, zb in zip(Ns, zbar)))
    E = sum((z - zb).T @ (z - zb) for z, zb in zip(Z, zbar))
    ss_e = float(np.trace(E))
    df_g, df_sg = G - 1, N - G
    df_t, df_gt, df_e = k - 1, (G - 1) * (k - 1), (N - G) * (k - 1)
    ms_sg = ss_sg / df_sg
    ms_e = ss_e / df_e

    def fp(ss, df, ms_err, dfe):
        if not (ms_err > 0) or df <= 0:
            return None, None
        f = (ss / df) / ms_err
        return f, float(stats.f.sf(f, df, dfe))

    f_g, p_g = fp(ss_g, df_g, ms_sg, df_sg)
    f_t, p_t = fp(ss_t, df_t, ms_e, df_e)
    f_gt, p_gt = fp(ss_gt, df_gt, ms_e, df_e)
    S = E / df_sg
    trS2 = float(np.trace(S @ S))
    eps = float(np.trace(S) ** 2 / ((k - 1) * trS2)) if trS2 > 1e-300 else 1.0
    eps = min(1.0, max(1.0 / (k - 1), eps))
    p_t_gg = float(stats.f.sf(f_t, df_t * eps, df_e * eps)) if f_t is not None else None
    p_gt_gg = float(stats.f.sf(f_gt, df_gt * eps, df_e * eps)) if f_gt is not None else None

    def peta(ss, err):
        return ss / (ss + err) if (ss + err) > 0 else None

    tl = [str(x) for x in (d.get("timeLabels") or [])][:k]
    tl += ["Time %d" % (t + 1) for t in range(len(tl), k)]
    gname = "Groups (%s)" % (", ".join(labels[:3]) + ("…" if G > 3 else ""))
    tname = "Time (%s)" % (", ".join(tl[:3]) + ("…" if k > 3 else ""))
    terms = [
        {"term": gname, "estimate": _r(ss_g), "df": df_g, "statistic": _r(f_g), "p": _r(p_g)},
        {"term": "Subjects (within groups)", "estimate": _r(ss_sg), "df": df_sg},
        {"term": tname, "estimate": _r(ss_t), "df": df_t, "statistic": _r(f_t), "p": _r(p_t)},
        {"term": "Groups × Time", "estimate": _r(ss_gt), "df": df_gt, "statistic": _r(f_gt), "p": _r(p_gt)},
        {"term": "Residual", "estimate": _r(ss_e), "df": df_e},
        {"term": "Sphericity: Greenhouse-Geisser ε", "estimate": _r(eps)},
        {"term": "Sphericity: Time, corrected p", "df": _r(df_t * eps), "statistic": _r(f_t), "p": _r(p_t_gg)},
        {"term": "Sphericity: Groups × Time, corrected p", "df": _r(df_gt * eps), "statistic": _r(f_gt), "p": _r(p_gt_gg)},
    ]
    compare = d.get("compare") or "none"
    note = None
    if compare == "groups":
        m = k * G * (G - 1) // 2
        for t in range(k):
            col = [mm[:, t] for mm in mats]
            ms_w = sum(float(((c - c.mean()) ** 2).sum()) for c in col) / df_sg
            for i in range(G):
                for j in range(i + 1, G):
                    diff = float(col[i].mean() - col[j].mean())
                    se = (ms_w * (1.0 / Ns[i] + 1.0 / Ns[j])) ** 0.5
                    tt = diff / se if se > 0 else None
                    p = float(2 * stats.t.sf(abs(tt), df_sg)) if tt is not None else None
                    terms.append({"term": "At %s: %s vs %s" % (tl[t], labels[i], labels[j]), "estimate": _r(diff),
                                  "df": df_sg, "statistic": _r(tt), "p": _r(None if p is None else 1 - (1 - p) ** m)})
        note = "Groups compared at each time point (pooled SD at that time, df %d), Šidák-adjusted over %d comparisons." % (df_sg, m)
    elif compare == "times":
        m = G * k * (k - 1) // 2
        for gi, mm in enumerate(mats):
            for a in range(k):
                for b in range(a + 1, k):
                    dlt = mm[:, a] - mm[:, b]
                    sd = float(dlt.std(ddof=1))
                    tt = float(dlt.mean()) / (sd / Ns[gi] ** 0.5) if sd > 0 else None
                    p = float(2 * stats.t.sf(abs(tt), Ns[gi] - 1)) if tt is not None else None
                    terms.append({"term": "%s: %s vs %s" % (labels[gi], tl[a], tl[b]), "estimate": _r(float(dlt.mean())),
                                  "df": Ns[gi] - 1, "statistic": _r(tt), "p": _r(None if p is None else 1 - (1 - p) ** m)})
        note = "Time points compared within each group (paired t), Šidák-adjusted over %d comparisons." % m
    # Residuals of the split-plot model: y - (subject mean + time mean in its group - group mean).
    resid, fitted = [], []
    for mm, sm in zip(mats, subj):
        tm = mm.mean(axis=0)
        pred = sm[:, None] + tm[None, :] - float(mm.mean())
        resid.extend((mm - pred).ravel().tolist())
        fitted.extend(pred.ravel().tolist())

    def fmt(p):
        return ("%.4g" % p) if p is not None else "—"

    assumptions = [
        "Each subject is measured at every time point; a subject with a missing time point is left out%s." % (
            " (%d left out)" % dropped if dropped else ""),
        "Sphericity (equal variances of the differences between time points) is assumed by the plain p; the "
        "Greenhouse-Geisser-corrected p (ε = %.3f) does not assume it." % eps,
        "Normal residuals and equal covariance across groups.",
    ]
    if len(set(Ns)) > 1:
        assumptions.append("Unequal group sizes: Type III sums of squares for Time (the unweighted mean of the group means).")
    if note:
        assumptions.append(note)
    return {
        "method": "mixedanova", "title": "Two-way repeated-measures ANOVA (one between, one within)", "terms": terms,
        "extra": {"residuals": {"fitted": [_r(float(v)) for v in fitted], "resid": [_r(float(v)) for v in resid]}},
        "glance": {"F_groups": _r(f_g), "p_groups": _r(p_g), "df_groups": df_g, "df_subjects": df_sg,
                   "F_time": _r(f_t), "p_time": _r(p_t), "df_time": df_t,
                   "F_inter": _r(f_gt), "p_inter": _r(p_gt), "df_inter": df_gt, "df_resid": df_e,
                   "gg_epsilon": _r(eps), "p_time_gg": _r(p_t_gg), "p_inter_gg": _r(p_gt_gg),
                   "peta_groups": _r(peta(ss_g, ss_sg)), "peta_time": _r(peta(ss_t, ss_e)), "peta_inter": _r(peta(ss_gt, ss_e)),
                   "n_subjects": N, "n_groups": G, "k_times": k, "n_dropped": dropped},
        "summary": "Mixed ANOVA — groups p = %s, time p = %s (Greenhouse-Geisser p = %s, ε = %.3f), groups × time p = %s (GG p = %s)." % (
            fmt(p_g), fmt(p_t), fmt(p_t_gg), eps, fmt(p_gt), fmt(p_gt_gg)),
        "assumptions": assumptions,
        "cite": "Split-plot (mixed) ANOVA: one between-subjects and one within-subjects factor; Greenhouse-Geisser (1959) "
                "sphericity correction from the pooled within-group covariance.",
    }


def _km(np, time, event, z=1.959963984540054):
    """Kaplan-Meier product-limit estimator. Returns the step points, median survival,
    a Greenwood log-log CI (lower/upper aligned with the step points, so it stays
    inside (0, 1)), and the censoring times (for the on-curve censor ticks). `z` is the
    two-sided normal quantile for the chosen confidence level (default 95%) — it drives
    both the band and the Brookmeyer-Crowley median CI, which is the band crossing 0.5."""
    o = np.argsort(time, kind="mergesort")
    t, e = time[o], event[o]
    n = t.size
    surv, at = 1.0, n
    gsum = 0.0  # cumulative Greenwood sum Σ d/(n(n−d)) = Var(log S)
    med = med_lo = med_hi = None  # median + its Brookmeyer-Crowley CI (band crossing 0.5)
    xs, ys, lo, hi = [0.0], [1.0], [1.0], [1.0]  # curve starts at (0, 1); CI degenerate there
    censor = []
    i = 0
    while i < n:
        tj = float(t[i])
        d = c = 0
        j = i
        while j < n and t[j] == t[i]:
            if e[j] == 1:
                d += 1
            else:
                c += 1
            j += 1
        if d > 0 and at > 0:
            surv *= 1 - d / at
            if at > d:
                gsum += d / (at * (at - d))
            xs.append(tj)
            ys.append(surv)
            # Greenwood complementary-log-log CI: bounds = S^exp(∓z·σ) with
            # σ = √gsum / |log S| — degenerate (→ S) at S = 0 or 1.
            if 0.0 < surv < 1.0 and gsum > 0:
                sigma = (gsum ** 0.5) / abs(np.log(surv))
                lo.append(float(surv ** np.exp(z * sigma)))
                hi.append(float(surv ** np.exp(-z * sigma)))
            else:
                lo.append(surv)
                hi.append(surv)
            if med is None and surv <= 0.5:
                med = tj
            # Median CI (Brookmeyer-Crowley): the earliest time each survival band
            # crosses 0.5 — lower band → lower median limit, upper band → upper limit.
            if med_lo is None and lo[-1] <= 0.5:
                med_lo = tj
            if med_hi is None and hi[-1] <= 0.5:
                med_hi = tj
        if c > 0:
            censor.append(tj)
        at -= d + c
        i = j
    return {"times": xs, "surv": ys, "lower": lo, "upper": hi, "censor": censor,
            "median": med, "median_lo": med_lo, "median_hi": med_hi,
            "n": n, "events": int(event.sum())}


def _logrank_core(np, groups, gehan=False):
    """Per-event-time accumulation for the (weighted) log-rank family. Returns the
    unweighted observed/expected events per group (for the hazard ratio + trend) plus
    the weighted score vector U = Σ w·(O−E) and its full covariance V. `gehan=False`
    → Mantel-Cox log-rank (w = 1); `gehan=True` → Gehan-Breslow-Wilcoxon (w = n at risk)."""
    g = len(groups)
    ev_times = np.unique(np.concatenate([gr["t"][gr["e"] == 1] for gr in groups])) if g else np.array([])
    obs = np.zeros(g)
    exp = np.zeros(g)
    U = np.zeros(g)
    V = np.zeros((g, g))
    for tj in ev_times:
        nj = np.array([float(np.sum(gr["t"] >= tj)) for gr in groups])
        dj = np.array([float(np.sum((gr["t"] == tj) & (gr["e"] == 1))) for gr in groups])
        n, dd = nj.sum(), dj.sum()
        if n <= 0:
            continue
        # O/E accumulate over every event time — including one where a single subject
        # remains in the whole study. Skipping such times would make `obs` disagree with the
        # plain per-group event counts (an event goes missing) and skew the O/E hazard
        # ratio; their O−E is exactly 0, so the score U and the χ² never change
        # (crosscheck.py's from-scratch hazard-ratio recompute checks this).
        obs += dj
        exp += dd * nj / n
        if n <= 1:
            continue  # the variance term divides by n−1; this time's U contribution is 0
        w = float(n) if gehan else 1.0
        U += w * (dj - dd * nj / n)
        f = dd * (n - dd) / ((n - 1) * n * n)
        for a in range(g):
            for b in range(g):
                V[a, b] += w * w * (f * nj[a] * (n - nj[a]) if a == b else -f * nj[a] * nj[b])
    return obs, exp, U, V


def _chi2_from_score(np, stats, U, V, g):
    """χ² (df = g−1) from a score vector U and its covariance V, using the reduced
    (drop-one-group) system so V is invertible."""
    oe = U[:-1]
    chi2 = float(oe @ np.linalg.solve(V[:-1, :-1], oe))
    df = g - 1
    return chi2, df, float(stats.chi2.sf(chi2, df))


def survival(data):
    """Kaplan-Meier survival per group + Mantel-Cox log-rank test (validated vs Gehan data)."""
    np, stats = _np_sp()
    d = data or {}
    pairwise = bool(d.get("pairwise"))
    pw_method = str(d.get("pairwiseMethod", "holm-sidak")).lower()
    parsed = []
    for g in d.get("groups", []):
        at, ae = _aligned(g.get("time"), g.get("event"))
        t = np.asarray(at, dtype=float)
        e = np.asarray(ae, dtype=float)
        n = min(t.size, e.size)
        if n == 0:
            continue
        parsed.append({"label": str(g.get("label") or ("Group %d" % (len(parsed) + 1))),
                       "t": t[:n], "e": (e[:n] != 0).astype(int)})
    if not parsed:
        raise StatsError("bad_request", "survival needs time + event/censor data")
    # One normal quantile drives every interval here (Greenwood bands, median CI, HR CI),
    # from the dialog's Confidence level, never a hardcoded 1.96.
    conf = float(d.get("conf", 0.95))
    z = float(stats.norm.ppf(0.5 + conf / 2.0))
    curves, terms = [], []
    for g in parsed:
        km = _km(np, g["t"], g["e"], z=z)
        curves.append({"label": g["label"], "times": [_r(x) for x in km["times"]], "surv": [_r(y) for y in km["surv"]],
                       "lower": [_r(y) for y in km["lower"]], "upper": [_r(y) for y in km["upper"]],
                       "censor": [_r(x) for x in km["censor"]]})
        terms.append({"term": "%s — median survival" % g["label"], "estimate": _r(km["median"]),
                      "ciLow": _r(km["median_lo"]), "ciHigh": _r(km["median_hi"]),
                      "n": km["n"], "events": km["events"]})
    g = len(parsed)
    glance = {"groups": g}
    if g >= 2:
        obs, exp, U, V = _logrank_core(np, parsed, gehan=False)
        chi2, df, p = _chi2_from_score(np, stats, U, V, g)
        terms.append({"term": "Log-rank (Mantel-Cox)", "statistic": _r(chi2), "df": df, "p": _r(p)})
        glance.update({"chi_sq": _r(chi2), "df": df, "p": _r(p)})
        # Gehan-Breslow-Wilcoxon: a log-rank weighted by the number at risk (sensitive to
        # early differences; complements the plain log-rank's equal weighting).
        _o, _e, Ug, Vg = _logrank_core(np, parsed, gehan=True)
        gchi2, gdf, gp = _chi2_from_score(np, stats, Ug, Vg, g)
        terms.append({"term": "Gehan-Breslow-Wilcoxon", "statistic": _r(gchi2), "df": gdf, "p": _r(gp)})
        glance.update({"gehan_chi_sq": _r(gchi2), "gehan_p": _r(gp)})
        # Hazard ratio (2 groups) via the log-rank O/E method (our default estimate),
        # with a log-based CI at the chosen confidence (SE(lnHR) = √(1/E₁ + 1/E₂)).
        if g == 2 and exp[0] > 0 and exp[1] > 0 and obs[0] > 0 and obs[1] > 0:
            hr = float((obs[0] / exp[0]) / (obs[1] / exp[1]))
            se = float(np.sqrt(1 / exp[0] + 1 / exp[1]))
            terms.append({"term": "Hazard ratio (%s / %s)" % (parsed[0]["label"], parsed[1]["label"]),
                          "estimate": _r(hr), "ciLow": _r(hr * float(np.exp(-z * se))), "ciHigh": _r(hr * float(np.exp(z * se)))})
            glance.update({"hazard_ratio": _r(hr)})
        # Log-rank test for trend across ordered groups (equally-spaced scores 0…g−1).
        if g >= 3:
            s = np.arange(g, dtype=float)
            den = float(s @ V @ s)
            if den > 0:
                ztr = float(s @ U) / float(np.sqrt(den))
                tchi2 = ztr * ztr
                tp = float(stats.chi2.sf(tchi2, 1))
                terms.append({"term": "Log-rank for trend", "statistic": _r(tchi2), "df": 1, "p": _r(tp)})
                glance.update({"trend_chi_sq": _r(tchi2), "trend_p": _r(tp)})
        # Pairwise multiple comparisons of the survival curves: a log-rank
        # test for each pair of curves, its p multiplicity-adjusted over the C(g,2) pairs.
        if pairwise and g >= 3:
            pairs, raw = [], []
            for i in range(g):
                for j in range(i + 1, g):
                    _oij, _eij, Uij, Vij = _logrank_core(np, [parsed[i], parsed[j]], gehan=False)
                    cij, _dfij, pij = _chi2_from_score(np, stats, Uij, Vij, 2)
                    pairs.append((i, j, cij))
                    raw.append(pij)
            adj = _pairwise_adjust(raw, pw_method)
            for (i, j, cij), pa in zip(pairs, adj):
                terms.append({"term": "%s vs %s (log-rank)" % (parsed[i]["label"], parsed[j]["label"]),
                              "statistic": _r(cij), "df": 1, "p": _r(pa)})
            glance.update({"pairwise": pw_method, "pairwise_comparisons": len(pairs)})
        summary = "Log-rank χ²(%d) = %.4g, p = %s — survival %s across the %d groups." % (
            df, chi2, "%.4g" % p, "differs significantly" if p < 0.05 else "does not differ significantly", g)
    else:
        m = terms[0]["estimate"]
        summary = "Kaplan-Meier: median survival %s (n = %d, %d events)." % (
            ("%.4g" % m) if m is not None else "not reached", parsed[0]["t"].size, int(parsed[0]["e"].sum()))
    # Number-at-risk table (the strip under a KM plot): risk-set size per group at ~6 times.
    allt = np.concatenate([gr["t"] for gr in parsed])
    tmax = float(allt.max()) if allt.size else 1.0
    risk_times = sorted({float(round(v, 4)) for v in np.linspace(0, tmax, 6)})
    atrisk = {"times": risk_times,
              "rows": [{"label": gr["label"], "atRisk": [int(np.sum(gr["t"] >= tp)) for tp in risk_times]} for gr in parsed]}
    return {
        "method": "survival", "title": "Survival (Kaplan-Meier)", "terms": terms,
        "glance": glance, "summary": summary, "extra": {"curves": curves, "atrisk": atrisk},
        "assumptions": ["Censoring is non-informative; the log-rank test + hazard ratio assume proportional hazards.",
                        "Median CI = Brookmeyer-Crowley (the Greenwood band crossing 0.5); trend uses equally-spaced group scores."]
        + (["Pairwise curve comparisons: a log-rank test per pair, %s over %d comparisons." % (
            {"holm-sidak": "Holm-Šídák adjusted", "bonferroni": "Bonferroni adjusted",
             "sidak": "Šídák adjusted", "none": "unadjusted"}.get(pw_method, "Holm-Šídák adjusted"),
            g * (g - 1) // 2)] if (pairwise and g >= 3) else []),
        "cite": "Kaplan-Meier estimator; Mantel-Cox log-rank + Gehan-Breslow-Wilcoxon; log-rank hazard ratio; log-rank test for trend.",
    }


def _delong_placements(np, scores, y):
    """DeLong structural components for one marker: the placement values V10 (one per
    positive) and V01 (one per negative), whose means both equal the AUC. ψ(x,y)=1 if
    x>y, ½ if x=y, else 0."""
    pos = scores[y == 1]
    neg = scores[y == 0]
    npos, nneg = pos.size, neg.size
    v10 = np.empty(npos)
    for i in range(npos):
        dif = pos[i] - neg
        v10[i] = (float(np.sum(dif > 0)) + 0.5 * float(np.sum(dif == 0))) / nneg
    v01 = np.empty(nneg)
    for j in range(nneg):
        dif = pos - neg[j]
        v01[j] = (float(np.sum(dif > 0)) + 0.5 * float(np.sum(dif == 0))) / npos
    return float(v10.mean()), v10, v01


def _roc_compare(np, stats, s1, s2, y, npos, nneg, d):
    """DeLong's test for two correlated ROC curves (same subjects, two markers). The
    AUC covariance = S10/npos + S01/nneg from the placement-value structural
    components; z = (AUC₁−AUC₂)/√Var(Δ)."""
    auc1, v10a, v01a = _delong_placements(np, s1, y)
    auc2, v10b, v01b = _delong_placements(np, s2, y)

    def cov(a, b, m):  # sample covariance /(m−1)
        return float(np.sum((a - a.mean()) * (b - b.mean())) / (m - 1)) if m > 1 else 0.0

    var1 = cov(v10a, v10a, npos) / npos + cov(v01a, v01a, nneg) / nneg
    var2 = cov(v10b, v10b, npos) / npos + cov(v01b, v01b, nneg) / nneg
    cov12 = cov(v10a, v10b, npos) / npos + cov(v01a, v01b, nneg) / nneg
    diff = auc1 - auc2
    se_diff = float(np.sqrt(max(0.0, var1 + var2 - 2.0 * cov12)))
    z = diff / se_diff if se_diff > 0 else None
    p = float(2.0 * stats.norm.sf(abs(z))) if z is not None else None
    conf = float(d.get("conf", 0.95))
    zc = float(stats.norm.ppf(1.0 - (1.0 - conf) / 2.0))
    lo, hi = diff - zc * se_diff, diff + zc * se_diff
    lab1 = str(d.get("label") or "Marker 1")
    lab2 = str(d.get("label2") or "Marker 2")
    return {
        "method": "roc", "title": "Compare ROC curves (DeLong)",
        "terms": [
            {"term": "AUC (%s)" % lab1, "estimate": _r(auc1), "se": _r(float(np.sqrt(max(0.0, var1))))},
            {"term": "AUC (%s)" % lab2, "estimate": _r(auc2), "se": _r(float(np.sqrt(max(0.0, var2))))},
            {"term": "AUC difference (%s − %s)" % (lab1, lab2), "estimate": _r(diff), "se": _r(se_diff),
             "ciLow": _r(lo), "ciHigh": _r(hi), "statistic": _r(z), "p": _r(p)},
        ],
        "glance": {"auc1": _r(auc1), "auc2": _r(auc2), "auc_diff": _r(diff), "se_diff": _r(se_diff),
                   "ci_diff_low": _r(lo), "ci_diff_high": _r(hi), "z": _r(z), "p": _r(p),
                   "n_pos": npos, "n_neg": nneg},
        "summary": "DeLong: AUC %.3f vs %.3f (Δ = %.3f, %g%% CI %.3f–%.3f), z = %s, p = %s — the two ROC curves %s." % (
            auc1, auc2, diff, conf * 100, lo, hi, ("%.3g" % z) if z is not None else "—",
            ("%.4g" % p) if p is not None else "—",
            "differ significantly" if (p is not None and p < 0.05) else "do not differ significantly"),
        "assumptions": ["Two markers measured on the same subjects (paired / correlated ROC); higher scores predict the positive class.",
                        "DeLong's nonparametric AUC covariance (structural components); both AUCs use identical case labels."],
        "cite": "DeLong, DeLong & Clarke-Pearson (1988): nonparametric comparison of correlated AUCs.",
    }


def roc(data):
    """ROC analysis: AUC (Mann-Whitney) + Hanley-McNeil CI at the chosen level + Youden's optimal cutoff.
    With a second marker (`scores2`) on the same subjects: DeLong's test comparing the
    two correlated AUCs."""
    np, stats = _np_sp()
    d = data or {}
    scores2_raw = d.get("scores2")
    compare = scores2_raw not in (None, [], "")
    columns = [d.get("scores"), d.get("labels")]
    if compare:
        columns.append(scores2_raw)
    aligned = _aligned(*columns)
    scores = np.asarray(aligned[0], dtype=float)
    labels = np.asarray(aligned[1], dtype=float)
    n = min(scores.size, labels.size)
    if n < 3:
        raise StatsError("bad_request", "ROC needs ≥ 3 paired (score, outcome) values")
    scores, labels = scores[:n], labels[:n]
    classes = sorted(set(labels.tolist()))
    if len(classes) != 2:
        raise StatsError("bad_request", "ROC needs exactly two outcome classes (e.g. 0 / 1)")
    pos = classes[-1]  # the larger outcome value is the positive class
    y = (labels == pos).astype(int)
    npos, nneg = int(y.sum()), n - int(y.sum())
    if npos == 0 or nneg == 0:
        raise StatsError("bad_request", "both outcome classes must be present")
    # Compare two ROC curves on the same subjects (DeLong) when a second marker is given.
    if compare:
        s2 = np.asarray(aligned[2], dtype=float)
        return _roc_compare(np, stats, scores, s2, y, npos, nneg, d)
    # AUC via the Mann-Whitney U statistic (ties contribute 0.5 through average ranks).
    ranks = stats.rankdata(scores)
    u = float(ranks[y == 1].sum() - npos * (npos + 1) / 2.0)
    auc = u / (npos * nneg)
    # Hanley & McNeil standard error + normal-approximation CI at the requested level.
    q1 = auc / (2 - auc)
    q2 = 2 * auc * auc / (1 + auc)
    var = (auc * (1 - auc) + (npos - 1) * (q1 - auc * auc) + (nneg - 1) * (q2 - auc * auc)) / (npos * nneg)
    se = float(np.sqrt(max(0.0, var)))
    conf = float(d.get("conf", 0.95))
    z = float(stats.norm.ppf(1.0 - (1.0 - conf) / 2.0))  # the requested CI level, not a fixed 95%
    lo, hi = max(0.0, auc - z * se), min(1.0, auc + z * se)
    p = float(2 * stats.norm.sf(abs((auc - 0.5) / se))) if se > 0 else None
    # Sweep every unique score as a threshold (predict positive when score ≥ t) →
    # the full sensitivity/specificity-per-cutoff table + the ROC curve points, plus
    # Youden's J optimal cutoff.
    cutoff_table = []
    curve = [{"fpr": 0.0, "tpr": 0.0}]  # (0,0): predict none positive
    best = None
    # Sort once. The suffix beginning at the first occurrence of each tied score
    # contains exactly the subjects predicted positive at that threshold.
    order = np.argsort(scores, kind="stable")
    thresholds, starts = np.unique(scores[order], return_index=True)
    positive_suffix = np.cumsum(y[order][::-1])[::-1]
    for t, start in zip(thresholds, starts):
        tp = int(positive_suffix[start])
        fp = int(n - start - tp)
        s_sens = tp / npos
        s_spec = (nneg - fp) / nneg
        j = s_sens + s_spec - 1
        # Wilson CI at the requested level for sensitivity (tp of npos positives) and specificity (tn of nneg negatives).
        sens_lo, sens_hi = _wilson_ci(np, tp, npos, z)
        spec_lo, spec_hi = _wilson_ci(np, nneg - fp, nneg, z)
        cutoff_table.append({"cutoff": _r(float(t)), "sensitivity": _r(s_sens),
                             "specificity": _r(s_spec), "fpr": _r(1 - s_spec), "youden": _r(j),
                             "sensLow": _r(sens_lo), "sensHigh": _r(sens_hi),
                             "specLow": _r(spec_lo), "specHigh": _r(spec_hi)})
        curve.append({"fpr": _r(1 - s_spec), "tpr": _r(s_sens)})
        if best is None or j > best[0]:
            best = (j, float(t), s_sens, s_spec)
    _, cut, sens, spec = best
    curve.append({"fpr": 1.0, "tpr": 1.0})  # (1,1): predict all positive
    curve = sorted({(pt["fpr"], pt["tpr"]) for pt in curve})
    curve = [{"fpr": f, "tpr": tr} for f, tr in curve]
    terms = [
        {"term": "AUC", "estimate": _r(auc), "se": _r(se), "ciLow": _r(lo), "ciHigh": _r(hi), "p": _r(p)},
        {"term": "Optimal cutoff (Youden)", "estimate": _r(cut)},
        {"term": "Sensitivity at cutoff", "estimate": _r(sens)},
        {"term": "Specificity at cutoff", "estimate": _r(spec)},
    ]
    return {
        "method": "roc", "title": "ROC curve analysis", "terms": terms,
        "glance": {"auc": _r(auc), "se": _r(se), "ci_low": _r(lo), "ci_high": _r(hi),
                   "n_pos": npos, "n_neg": nneg, "cutoff": _r(cut),
                   "sensitivity": _r(sens), "specificity": _r(spec), "p": _r(p)},
        # extra.roc drives the ROC graph (points) + the per-cutoff table view.
        "extra": {"roc": {"points": curve, "cutoffs": cutoff_table, "auc": _r(auc),
                          "label": str(d.get("label") or "ROC")}},
        "summary": "AUC = %.3f (%g%% CI %.3f–%.3f, p = %s); at the Youden cutoff %.4g — sensitivity %.0f%%, specificity %.0f%%." % (
            auc, conf * 100, lo, hi, ("%.4g" % p) if p is not None else "—", cut, sens * 100, spec * 100),
        "assumptions": ["Higher scores predict the positive class (the larger outcome value) — flip the score if AUC < 0.5."],
        "cite": "ROC AUC via the Mann-Whitney statistic; Hanley-McNeil CI at the chosen level; Youden's J optimal cutoff.",
    }


def auc(data):
    """Area under the curve: trapezoidal integration with a baseline,
    split into peaks (contiguous runs above the baseline). Reports total net area,
    total positive-peak area, and per-peak start/end X, height, and area. Baseline
    crossings are linearly interpolated so partial trapezoids are exact."""
    np, _stats = _np_sp()
    d = data or {}
    # (x, y) are the same curve's points — clean them row-wise (see `_aligned`).
    xs, ys = _aligned(d.get("x"), d.get("y"))
    n = min(len(xs), len(ys))
    if n < 2:
        raise StatsError("bad_request", "AUC needs ≥ 2 (x, y) points")
    pts = sorted(zip(xs[:n], ys[:n]), key=lambda p: p[0])
    x = [float(p[0]) for p in pts]
    y = [float(p[1]) for p in pts]
    base_mode = d.get("baseline", "zero")
    if base_mode == "min":
        base = min(y)
    elif base_mode == "mean":
        base = float(np.mean(y))
    elif isinstance(base_mode, (int, float)):
        base = float(base_mode)
    else:
        base = 0.0
    g = [yi - base for yi in y]  # height above baseline

    # Net (signed) area over the whole curve — straight trapezoidal sum.
    net = 0.0
    for i in range(n - 1):
        net += 0.5 * (g[i] + g[i + 1]) * (x[i + 1] - x[i])

    # Walk segments, accumulating positive area within above-baseline runs.
    def cross(i):
        """X where segment i→i+1 crosses the baseline (g changes sign)."""
        dx = x[i + 1] - x[i]
        return x[i] + dx * (g[i] / (g[i] - g[i + 1])) if g[i] != g[i + 1] else x[i]

    peaks = []
    cur_area = 0.0
    cur_start = None
    cur_max = None
    cur_xmax = None
    for i in range(n):
        above = g[i] > 0
        if above and cur_start is None:
            cur_start = x[i]
            cur_max = g[i]
            cur_xmax = x[i]
        if above and g[i] > (cur_max if cur_max is not None else g[i]) - 1e-15:
            if cur_max is None or g[i] > cur_max:
                cur_max = g[i]
                cur_xmax = x[i]
        # integrate the segment to the next point, clipping at baseline crossings
        if i < n - 1:
            a, b = g[i], g[i + 1]
            if a > 0 and b > 0:
                cur_area += 0.5 * (a + b) * (x[i + 1] - x[i])
            elif a > 0 and b <= 0:  # falling through baseline → close the peak
                xc = cross(i)
                cur_area += 0.5 * a * (xc - x[i])
                peaks.append((cur_start, xc, cur_max, cur_area, cur_xmax))
                cur_area, cur_start, cur_max, cur_xmax = 0.0, None, None, None
            elif a <= 0 and b > 0:  # rising through baseline → open a peak
                xc = cross(i)
                cur_start = xc
                cur_area += 0.5 * b * (x[i + 1] - xc)
                cur_max = b
                cur_xmax = x[i + 1]
        if i == n - 1 and cur_start is not None:  # curve ends still above baseline
            peaks.append((cur_start, x[i], cur_max, cur_area, cur_xmax))

    # Drop tiny peaks (< minFraction of the tallest peak's height) — the height filter.
    min_frac = float(d.get("minPeakFraction", 0.0) or 0.0)
    tallest = max((p[2] for p in peaks), default=0.0)
    kept = [p for p in peaks if tallest <= 0 or p[2] >= min_frac * tallest]
    total_peak = sum(p[3] for p in kept)

    terms = [
        {"term": "Total area (net)", "estimate": _r(net)},
        {"term": "Total peak area", "estimate": _r(total_peak)},
        {"term": "Number of peaks", "estimate": len(kept)},
        {"term": "Baseline", "estimate": _r(base)},
    ]
    for idx, (xs0, xs1, hmax, area, xmax) in enumerate(kept, 1):
        # The peak's x-extent rides in its own fields — not ciLow/ciHigh, whose meaning
        # everywhere else is "confidence interval", so exports would write an x-range under
        # a "95% CI" header.
        terms.append({"term": "Peak %d area" % idx, "estimate": _r(area),
                      "xFrom": _r(xs0), "xTo": _r(xs1)})
        terms.append({"term": "Peak %d height (at X=%.4g)" % (idx, xmax), "estimate": _r(hmax)})
    return {
        "method": "auc", "title": "Area under the curve", "terms": terms,
        "glance": {"net": _r(net), "peak_area": _r(total_peak), "peaks": len(kept), "baseline": _r(base)},
        "summary": "Net area = %.4g; total positive-peak area = %.4g across %d peak%s (baseline = %.4g)." % (
            net, total_peak, len(kept), "" if len(kept) == 1 else "s", base),
        "assumptions": ["Trapezoidal integration; baseline crossings are linearly interpolated.",
                        "Peaks are contiguous runs above the baseline; tiny peaks can be filtered by height fraction."],
        "cite": "Area under the curve by the trapezoid rule with a defined baseline.",
    }


def _grubbs_step(np, stats, a, alpha):
    """One two-sided Grubbs test on array `a`. Returns (idx, value, G, Gcrit, p,
    significant) for the most-extreme point, or None if n < 3."""
    n = len(a)
    if n < 3:
        return None
    mean = float(a.mean())
    sd = float(a.std(ddof=1))
    if sd == 0:
        return None
    dev = np.abs(a - mean)
    idx = int(np.argmax(dev))
    G = float(dev[idx] / sd)
    # Two-sided critical value at level alpha.
    tcrit = float(stats.t.ppf(1.0 - alpha / (2.0 * n), n - 2))
    gcrit = ((n - 1) / (n ** 0.5)) * (tcrit ** 2 / (n - 2 + tcrit ** 2)) ** 0.5
    # Two-sided p from the G statistic (invert the critical-value relation).
    denom = (n - 1) ** 2 - n * G * G
    if denom <= 0:
        p = 0.0
    else:
        t_stat = (n * (n - 2) * G * G / denom) ** 0.5
        p = min(1.0, 2.0 * n * float(stats.t.sf(t_stat, n - 2)))
    return idx, float(a[idx]), G, float(gcrit), float(p), G > gcrit


def _rout_outliers(np, stats, x, Q):
    """ROUT outlier detection for a column of values (Motulsky & Brown 2006). The
    'good' data are assumed Gaussian; a robust centre (median) + a robust scatter
    estimate (RSDR = the 68.27th percentile of the absolute residuals, which for a
    Gaussian equals σ) give each point a t-ratio |residual|/RSDR → a two-tailed
    t p-value (df = N−1); Benjamini-Hochberg FDR at the level Q (e.g. 1%) decides
    which points are outliers. Returns (center, rsdr, df, list-of (idx,val,t,p,q,is_outlier))."""
    a = np.asarray(x, dtype=float)
    n = a.size
    center = float(np.median(a))
    resid = np.abs(a - center)
    # RSDR = 68.27th percentile of |residuals| (for a Gaussian this equals σ),
    # corrected by N/(N−K) for the K=1 fitted parameter (the centre) — Motulsky &
    # Brown's df adjustment, which un-biases the estimate (verified: mean → σ).
    k = 1
    rsdr = float(np.percentile(resid, 68.269)) * (n / (n - k) if n > k else 1.0)
    df = max(1, n - k)
    if rsdr <= 0:
        # ≥68% of the values are identical → no meaningful scatter; flag nothing.
        rows = [(i, float(a[i]), 0.0, 1.0, 1.0, False) for i in range(n)]
        return center, rsdr, df, rows
    t = resid / rsdr
    pv = [float(2.0 * stats.t.sf(float(ti), df)) for ti in t]  # two-tailed; ti ≥ 0
    q = _bh_fdr(pv)
    rows = [(i, float(a[i]), float(t[i]), pv[i], q[i], q[i] <= Q) for i in range(n)]
    return center, rsdr, df, rows


def outliers(data):
    """Outlier detection — Grubbs' test (single most-extreme, or iterative remove +
    repeat) OR the ROUT method (Motulsky-Brown FDR-based). Two-sided. Reports each
    flagged value with its statistic + p, plus the cleaned n."""
    np, stats = _np_sp()
    d = data or {}
    x = _num(d.get("values", []))
    n0 = len(x)
    if n0 < 3:
        raise StatsError("bad_request", "Outlier tests need ≥ 3 values")

    if d.get("variant") == "rout":
        Q = float(d.get("Q", d.get("alpha", 0.01)))  # FDR (default 1%)
        center, rsdr, df, rows = _rout_outliers(np, stats, x, Q)
        flagged = [(val, t, p, q) for (_i, val, t, p, q, is_out) in rows if is_out]
        flagged.sort(key=lambda r: -abs(r[0] - center))  # most-extreme first
        removed = {i for (i, _v, _t, _p, _q, is_out) in rows if is_out}
        cleaned = sorted(float(rows[i][1]) for i in range(len(rows)) if i not in removed)
        terms = [{"term": "Outliers removed", "estimate": len(flagged)},
                 {"term": "n (input → cleaned)", "estimate": int(len(cleaned))},
                 {"term": "Centre (median)", "estimate": _r(center)},
                 {"term": "Robust SD (RSDR)", "estimate": _r(rsdr)}]
        for i, (val, t, p, q) in enumerate(flagged, 1):
            terms.append({"term": "Outlier %d" % i, "estimate": _r(val), "statistic": _r(t),
                          "p": _r(p), "qValue": _r(q)})
        return {
            "method": "outliers", "title": "Outlier detection (ROUT)",
            "terms": terms,
            "glance": {"n_in": n0, "n_clean": int(len(cleaned)), "removed": len(flagged),
                       "q_fdr": Q, "rsdr": _r(rsdr), "center": _r(center)},
            "summary": "ROUT (Q = %.3g%%): %d outlier%s removed (%d → %d values); centre %.4g, RSDR %.4g." % (
                Q * 100, len(flagged), "" if len(flagged) == 1 else "s", n0, len(cleaned), center, rsdr),
            "assumptions": ["ROUT assumes the data (minus outliers) are Gaussian.",
                            "Robust centre = median; RSDR = 68.27th percentile of |residuals|; FDR (Benjamini-Hochberg) at Q.",
                            "Statistic column = t-ratio |residual|/RSDR; q column = the Benjamini-Hochberg q-value of that value."],
            "cite": "Motulsky & Brown (2006) ROUT method (robust residuals + FDR).",
            "cleaned": cleaned,
        }

    alpha = float(d.get("alpha", 0.05))
    iterative = d.get("variant", "iterative") != "single"
    a = np.asarray(x, dtype=float)
    flagged = []
    candidate = None  # the first (possibly non-significant) most-extreme point
    while True:
        step = _grubbs_step(np, stats, a, alpha)
        if step is None:
            break
        if candidate is None:
            candidate = step
        if not step[5]:  # not significant → stop
            break
        idx, val, G, gcrit, p, _sig = step
        flagged.append((val, G, gcrit, p))
        a = np.delete(a, idx)
        if not iterative or len(a) < 3:
            break
    terms = [{"term": "Outliers removed", "estimate": len(flagged)},
             {"term": "n (input → cleaned)", "estimate": int(len(a))}]
    for i, (val, G, gcrit, p) in enumerate(flagged, 1):
        terms.append({"term": "Outlier %d" % i, "estimate": _r(val), "statistic": _r(G),
                      "p": _r(p), "gCritical": _r(gcrit)})
    if not flagged and candidate is not None:
        idx, val, G, gcrit, p, _sig = candidate
        terms.append({"term": "Most extreme value (n.s.)", "estimate": _r(val), "statistic": _r(G),
                      "p": _r(p), "gCritical": _r(gcrit)})
    cleaned = sorted(float(v) for v in a)
    return {
        "method": "outliers", "title": "Outlier detection (Grubbs)",
        "terms": terms,
        "glance": {"n_in": n0, "n_clean": int(len(a)), "removed": len(flagged), "alpha": alpha},
        "summary": "%s Grubbs at α = %.3g: %d outlier%s removed (%d → %d values)." % (
            "Iterative" if iterative else "Single", alpha, len(flagged),
            "" if len(flagged) == 1 else "s", n0, len(a)),
        "assumptions": ["Grubbs assumes the underlying data (minus outliers) are normally distributed.",
                        "Two-sided test; Statistic column = G; Critical G column = the critical value of G at α."],
        "cite": "Grubbs (1969) two-sided test; iterative removal.",
        "cleaned": cleaned,
    }


_PCORRECT_METHODS = {
    "bonferroni": ("bonferroni", "Bonferroni"),
    "holm": ("holm", "Holm (Holm-Bonferroni, step-down)"),
    "holm-sidak": ("holm-sidak", "Holm-Šídák (step-down)"),
    "sidak": ("sidak", "Šídák (single-step)"),
    "fdr_bh": ("fdr_bh", "Benjamini-Hochberg FDR"),
    "fdr_by": ("fdr_by", "Benjamini-Yekutieli FDR"),
}


def pcorrect(data):
    """Multiple-comparison correction of a stack of P values (a column the user
    selected). Adjusts by the chosen method and marks which survive at significance
    level α. No new statistics: the correction is `statsmodels.stats.multitest.
    multipletests` — the same validated library already used across this engine —
    covering Bonferroni · Holm (Holm-Bonferroni step-down) · Holm-Šídák · Šídák ·
    Benjamini-Hochberg FDR · Benjamini-Yekutieli FDR. Blank / out-of-range cells are
    dropped (a P-value stack has no gaps); input order is preserved in the output."""
    _np_sp()  # load numpy/scipy (raises a typed error if the deps are missing)
    from statsmodels.stats.multitest import multipletests
    d = data or {}
    raw = d.get("pvalues", d.get("values", []))
    # Keep finite P in [0, 1]; anything else is not a P value and is dropped.
    p = [float(v) for v in raw
         if isinstance(v, (int, float)) and float(v) == float(v) and 0.0 <= float(v) <= 1.0]
    if len(p) < 2:
        raise StatsError("bad_request", "P-value correction needs ≥ 2 P values in [0, 1]")
    key = str(d.get("method", "holm")).lower()
    sm, label = _PCORRECT_METHODS.get(key, _PCORRECT_METHODS["holm"])
    alpha = float(d.get("alpha", 0.05))
    reject, padj, _a_sidak, _a_bonf = multipletests(p, alpha=alpha, method=sm)
    n_sig = int(sum(bool(r) for r in reject))
    terms = []
    for i in range(len(p)):
        # 'Estimate' = the P value entered; 'P' = the adjusted P value; a check mark after the term marks significance.
        terms.append({"term": "P %d%s" % (i + 1, " ✓" if reject[i] else ""),
                      "estimate": _r(float(p[i])), "p": _r(float(padj[i]))})
    return {
        "method": "pcorrect",
        "title": "P-value correction — %s" % label,
        "terms": terms,
        "glance": {"n": len(p), "method": key, "alpha": _r(alpha), "n_significant": n_sig},
        "summary": "%s of %d P value%s at α = %.3g: %d remain%s significant." % (
            label, len(p), "" if len(p) == 1 else "s", alpha, n_sig, "s" if n_sig == 1 else ""),
        "assumptions": [
            "'Estimate' column = the P value you entered; 'P' column = the adjusted P value; ✓ marks those significant at α.",
            "The correction assumes the P values are a complete family of tests answering one question; a partial or hand-picked stack biases it.",
            "Bonferroni / Holm / Holm-Šídák / Šídák control the family-wise error rate; Benjamini-Hochberg / Yekutieli control the false-discovery rate (more powerful, weaker guarantee).",
        ],
        "cite": "Multiple-comparison correction via statsmodels.stats.multitest.multipletests (%s)." % sm,
    }


def _meta_studies(data, stats):
    """Shared Meta-analysis-sheet parser: (label, est, lo, hi) rows -> transformed
    (y, v) pairs + kept rows + dropped count, under the entered-CI level and the
    linear/log rule. The one filter - metaanalysis and publicationbias must agree
    on which studies exist. Returns (y, v, keep, dropped, conf, log, z)."""
    d = data or {}
    studies = d.get("studies", []) or []
    conf = float(d.get("conf", 0.95))
    log = bool(d.get("log", False))
    z = float(stats.norm.ppf((1.0 + conf) / 2.0))
    tf = math.log if log else (lambda x: x)
    y = []
    v = []
    keep = []
    dropped = 0
    for s in studies:
        try:
            est, lo, hi = float(s.get("est")), float(s.get("lo")), float(s.get("hi"))
        except (TypeError, ValueError):
            dropped += 1
            continue
        finite = est == est and lo == lo and hi == hi
        usable = finite and hi > lo and (not log or (est > 0 and lo > 0 and hi > 0))
        if not usable:
            dropped += 1
            continue
        se = (tf(hi) - tf(lo)) / (2.0 * z)
        if not se > 0:
            dropped += 1
            continue
        y.append(tf(est))
        v.append(se * se)
        keep.append({"label": str(s.get("label") or "Study %d" % (len(keep) + 1)), "est": est, "lo": lo, "hi": hi})
    return y, v, keep, dropped, conf, log, z


def _iv_pool(y, v):
    """Fixed-effect + DerSimonian-Laird pooling in transformed space - the explicit
    textbook algebra metaanalysis uses, shared with publicationbias's
    adjusted (trim-and-fill) pooling so the two can never disagree."""
    k = len(y)
    w = [1.0 / vi for vi in v]
    sw = sum(w)
    est_f = sum(wi * yi for wi, yi in zip(w, y)) / sw
    se_f = (1.0 / sw) ** 0.5
    q = sum(wi * (yi - est_f) ** 2 for wi, yi in zip(w, y))
    df = k - 1
    c = sw - sum(wi * wi for wi in w) / sw
    tau2 = max(0.0, (q - df) / c) if c > 0 else 0.0
    i2 = max(0.0, (q - df) / q * 100.0) if q > 0 else 0.0
    wr = [1.0 / (vi + tau2) for vi in v]
    swr = sum(wr)
    est_r = sum(wi * yi for wi, yi in zip(wr, y)) / swr
    se_r = (1.0 / swr) ** 0.5
    return {"w": w, "sw": sw, "est_f": est_f, "se_f": se_f, "q": q, "df": df,
            "tau2": tau2, "i2": i2, "wr": wr, "swr": swr, "est_r": est_r, "se_r": se_r}


def metaanalysis(data):
    """Inverse-variance meta-analysis of study estimates entered with their confidence
    limits (Study - Estimate - Lower - Upper, the "Meta-analysis" sheet) - the standalone
    method behind the forest/funnel drawings. Each study's SE is back-calculated from its
    CI at the level it was entered at: SE = (t(hi) - t(lo)) / (2z), t = log for ratio
    measures (OR/RR/HR pool in log space; the null is 1). Fixed-effect and
    DerSimonian-Laird random-effects pooling are reported side by side, with Cochran's Q,
    tau^2, I^2 and each study's weight under both models. Implemented as the explicit
    textbook formulas on purpose (no statsmodels): crosscheck.py verifies the numbers
    against statsmodels' combine_effects, and engine.metaanalysis.test.ts against the
    independent TypeScript implementation the drawings use - three implementations that
    share no code, one answer."""
    np, stats = _np_sp()
    y, v, keep, dropped, conf, log, z = _meta_studies(data, stats)
    tinv = math.exp if log else (lambda x: x)
    k = len(y)
    if k < 2:
        raise StatsError("bad_request", "Meta-analysis needs at least 2 studies with usable confidence limits (Lower < Upper%s)"
                         % (", all positive on the log scale" if log else ""))
    pool = _iv_pool(y, v)
    w, sw, wr, swr = pool["w"], pool["sw"], pool["wr"], pool["swr"]
    est_f, se_f, est_r, se_r = pool["est_f"], pool["se_f"], pool["est_r"], pool["se_r"]
    q, df, tau2, i2 = pool["q"], pool["df"], pool["tau2"], pool["i2"]
    p_q = float(stats.chi2.sf(q, df)) if df > 0 else None

    def pooled_row(label, est_t, se_t):
        zstat = est_t / se_t if se_t > 0 else float("nan")
        return {"term": label, "estimate": _r(tinv(est_t)), "se": _r(se_t), "statistic": _r(zstat),
                "p": _r(2.0 * float(stats.norm.sf(abs(zstat)))),
                "ciLow": _r(tinv(est_t - z * se_t)), "ciHigh": _r(tinv(est_t + z * se_t))}

    terms = []
    for s, wi, wri in zip(keep, w, wr):
        # Per-study rows report the entered numbers (data space); weights are % shares.
        terms.append({"term": s["label"], "estimate": _r(s["est"]), "ciLow": _r(s["lo"]), "ciHigh": _r(s["hi"]),
                      "weight fixed (%)": _r(100.0 * wi / sw), "weight random (%)": _r(100.0 * wri / swr)})
    terms.append(pooled_row("Pooled — fixed effect", est_f, se_f))
    terms.append(pooled_row("Pooled — random effects (DL)", est_r, se_r))
    terms.append({"term": "Heterogeneity (Cochran Q)", "statistic": _r(q), "df": df,
                  "p": _r(p_q) if p_q is not None else None})
    null_word = "1" if log else "0"
    assumptions = [
        "Lower/Upper are read at the %g%% level they were entered at; the pooled CI and the z tests (null = %s) use the same level." % (conf * 100.0, null_word),
        "Fixed-effect assumes a single true effect; random-effects (DerSimonian-Laird) lets it vary between studies - report random when I-squared is material.",
        "'weight (%)' columns are each study's inverse-variance share under the two models.",
    ]
    if log:
        assumptions.append("Ratio measures (OR/RR/HR) are pooled in log space and back-transformed for display.")
    if dropped > 0:
        assumptions.append("%d %s could not be used (missing values, Lower >= Upper%s) and %s left out."
                           % (dropped, "study" if dropped == 1 else "studies",
                              ", or non-positive on the log scale" if log else "",
                              "was" if dropped == 1 else "were"))
    return {
        "method": "metaanalysis",
        "title": "Meta-analysis (inverse variance%s)" % (", log scale" if log else ""),
        "terms": terms,
        "glance": {"k": k, "Q": _r(q), "df": df, "tau²": _r(tau2), "I² (%)": _r(i2),
                   "pooled (fixed)": _r(tinv(est_f)), "pooled (random)": _r(tinv(est_r))},
        "summary": "Pooled effect %s (fixed) / %s (random) across %d studies; I² = %.1f%% (%s heterogeneity)." % (
            _r(tinv(est_f)), _r(tinv(est_r)), k, i2,
            "low" if i2 < 25 else "moderate" if i2 < 75 else "considerable"),
        "assumptions": assumptions,
        "cite": "Inverse-variance fixed-effect and DerSimonian-Laird random-effects pooling; heterogeneity Q, tau-squared, I-squared (Higgins & Thompson).",
    }


def publicationbias(data):
    """Publication-bias assessment for a Meta-analysis sheet: Egger's regression test
    for funnel asymmetry plus Duval-Tweedie trim-and-fill (L0 estimator) - the two
    numbers papers quote next to a funnel plot. Same entry contract as metaanalysis
    (Study - Estimate - Lower - Upper; conf = the level the limits were entered at;
    ratio measures assess in log space). Egger: OLS of the standardized effect y/SE on
    precision 1/SE, two-sided t on the intercept at df = k-2. Trim-and-fill: iterate
    {trim the l most extreme same-side studies -> fixed-effect centre -> ranks of
    |deviation| over all observed (average ranks on ties) -> L0 = (4Tn - k(k+1))/(2k-1)
    -> l = round(L0)} until l repeats (cap 50, l clamped to k-2); the missing side
    follows the Egger intercept's sign; the l extremes mirror about the trimmed centre
    and the pool re-runs with them included, fixed and DL random side by side.
    Explicit textbook formulas on purpose (no statsmodels): crosscheck.py re-derives
    Egger via statsmodels OLS and trim-and-fill via an independent stdlib
    implementation, and engine.publicationbias.test.ts pins agreement with the
    TypeScript twins behind the funnel drawing's overlay."""
    np, stats = _np_sp()
    y, v, keep, dropped, conf, log, z = _meta_studies(data, stats)
    tinv = math.exp if log else (lambda x: x)
    k = len(y)
    if k < 3:
        raise StatsError("bad_request", "Publication-bias tests need at least 3 studies with usable confidence limits (Lower < Upper%s)"
                         % (", all positive on the log scale" if log else ""))
    # --- Egger's regression: standardized effect y/SE on precision 1/SE ---
    prec = [1.0 / (vi ** 0.5) for vi in v]
    zz = [yi / (vi ** 0.5) for yi, vi in zip(y, v)]
    xbar = sum(prec) / k
    zbar = sum(zz) / k
    # Relative guard (mirrors the TS twin): equal-width CIs give precisions equal to
    # float noise, and a near-singular Sxx would amplify it into a meaningless intercept.
    sxx = sum((xi - xbar) ** 2 for xi in prec)
    if not sxx > k * xbar * xbar * 1e-12:
        raise StatsError("bad_request", "Egger's test needs a precision spread - every study here has the same standard error, so the regression is singular")
    sxz = sum((xi - xbar) * (zi - zbar) for xi, zi in zip(prec, zz))
    slope = sxz / sxx
    intercept = zbar - slope * xbar
    df_e = k - 2
    rss = sum((zi - intercept - slope * xi) ** 2 for xi, zi in zip(prec, zz))
    s2 = rss / df_e
    se_a = (s2 * (1.0 / k + xbar * xbar / sxx)) ** 0.5
    se_b = (s2 / sxx) ** 0.5
    t_a = intercept / se_a if se_a > 0 else (0.0 if intercept == 0 else math.copysign(float("inf"), intercept))
    p_a = 2.0 * float(stats.t.sf(abs(t_a), df_e)) if math.isfinite(t_a) else 0.0
    tcrit = float(stats.t.ppf((1.0 + conf) / 2.0, df_e))
    # --- Trim-and-fill (L0), the missing side from the Egger intercept's sign ---
    side = "left" if intercept >= 0 else "right"
    flip = -1.0 if side == "right" else 1.0
    yw = [flip * yi for yi in y]
    order = sorted(range(k), key=lambda i: (-yw[i], i))  # most extreme first; ties by input order

    def centre_of(skip):
        sw = swy = 0.0
        for i in range(k):
            if i in skip:
                continue
            wi = 1.0 / v[i]
            sw += wi
            swy += wi * yw[i]
        return swy / sw

    l = 0
    centre = centre_of(set())
    for _step in range(50):
        centre = centre_of(set(order[:l]))
        dev = [yi - centre for yi in yw]
        by_abs = sorted(range(k), key=lambda i: abs(dev[i]))
        rank = [0.0] * k
        j = 0
        while j < k:  # average ranks on ties (1-based)
            j2 = j
            while j2 + 1 < k and abs(dev[by_abs[j2 + 1]]) == abs(dev[by_abs[j]]):
                j2 += 1
            avg = (j + j2 + 2) / 2.0
            for m in range(j, j2 + 1):
                rank[by_abs[m]] = avg
            j = j2 + 1
        tn = sum(rank[i] for i in range(k) if dev[i] > 0)
        l0 = (4.0 * tn - k * (k + 1)) / (2.0 * k - 1.0)
        nxt = min(k - 2, max(0, int(math.floor(l0 + 0.5))))
        if nxt == l:
            break
        l = nxt
    imputed = [(flip * (2.0 * centre - yw[i]), v[i]) for i in order[:l]]
    pool = _iv_pool(y + [yi for yi, _ in imputed], v + [vi for _, vi in imputed])

    def pooled_row(label, est_t, se_t):
        zstat = est_t / se_t if se_t > 0 else float("nan")
        return {"term": label, "estimate": _r(tinv(est_t)), "se": _r(se_t), "statistic": _r(zstat),
                "p": _r(2.0 * float(stats.norm.sf(abs(zstat)))),
                "ciLow": _r(tinv(est_t - z * se_t)), "ciHigh": _r(tinv(est_t + z * se_t))}

    terms = [
        {"term": "Egger intercept (bias)", "estimate": _r(intercept), "se": _r(se_a), "statistic": _r(t_a),
         "df": df_e, "p": _r(p_a), "ciLow": _r(intercept - tcrit * se_a), "ciHigh": _r(intercept + tcrit * se_a)},
        {"term": "Egger slope (underlying effect)", "estimate": _r(slope), "se": _r(se_b)},
        {"term": "Trim-and-fill: imputed studies (%s side)" % side, "statistic": l},
    ]
    for idx, (yi, vi) in enumerate(imputed):
        sei = vi ** 0.5
        terms.append({"term": "Imputed study %d" % (idx + 1), "estimate": _r(tinv(yi)),
                      "ciLow": _r(tinv(yi - z * sei)), "ciHigh": _r(tinv(yi + z * sei))})
    terms.append(pooled_row("Adjusted pooled — fixed effect", pool["est_f"], pool["se_f"]))
    terms.append(pooled_row("Adjusted pooled — random effects (DL)", pool["est_r"], pool["se_r"]))
    bias_word = "asymmetry detected" if p_a < 0.05 else "no significant asymmetry"
    tail = ("trim-and-fill imputed %d %s on the %s side — adjusted pooled %s (fixed) / %s (random)"
            % (l, "study" if l == 1 else "studies", side, _r(tinv(pool["est_f"])), _r(tinv(pool["est_r"])))
            if l > 0 else "trim-and-fill imputed no studies — the pooled effect stands")
    assumptions = [
        "Lower/Upper are read at the %g%% level they were entered at; the Egger CI and the adjusted pooled CIs report at the same level." % (conf * 100.0,),
        "Egger's intercept asks whether small (imprecise) studies report systematically different effects - a significant lean, not why it leans (bias, heterogeneity and chance all can).",
        "Trim-and-fill assumes the missing studies mirror the most extreme observed ones (L0 estimator, fixed-effect trimming) - read the adjusted estimate as a sensitivity answer, not a correction.",
    ]
    if log:
        assumptions.append("Ratio measures (OR/RR/HR) are assessed in log space; estimates back-transform for display, the Egger intercept stays a log-space asymmetry number.")
    if dropped > 0:
        assumptions.append("%d %s could not be used (missing values, Lower >= Upper%s) and %s left out."
                           % (dropped, "study" if dropped == 1 else "studies",
                              ", or non-positive on the log scale" if log else "",
                              "was" if dropped == 1 else "were"))
    return {
        "method": "publicationbias",
        "title": "Publication bias (Egger + trim-and-fill%s)" % (", log scale" if log else ""),
        "terms": terms,
        "glance": {"k": k, "Egger intercept": _r(intercept), "Egger p": _r(p_a), "k₀ (imputed)": l, "side": side,
                   "adjusted (fixed)": _r(tinv(pool["est_f"])), "adjusted (random)": _r(tinv(pool["est_r"]))},
        "summary": "Egger intercept %s (p = %s, %s); %s." % (_r(intercept), _r(p_a), bias_word, tail),
        "assumptions": assumptions,
        "cite": "Egger, Davey Smith, Schneider & Minder (1997) regression asymmetry test; Duval & Tweedie (2000) trim-and-fill (L0, fixed-effect trimming).",
    }


def _cox_not_a_maximum(np, model, beta):
    """Whether a Cox fit's coefficients are not a maximum of the partial likelihood, as when a
    covariate separates the events: the partial log-likelihood climbs towards 0 as the
    coefficients grow. At a true maximum it is below 0 and doubling the coefficients lowers it."""
    with np.errstate(all="ignore"):
        ll = float(model.loglike(beta))
        ll2 = float(model.loglike(2.0 * beta))
    if not np.isfinite(ll) or ll > -1e-6:
        return True
    return (not np.isfinite(ll2)) or ll2 - ll > 1e-9 * max(1.0, abs(ll))


def _cox_concordance(np, time, event, eta):
    """Harrell's C — the fraction of comparable subject pairs whose predicted risk
    ranks the same way as their survival (higher η ⇒ shorter survival). Ties in η
    count as ½. O(n²), fine for typical n."""
    n = time.size
    comp = conc = tiedr = 0.0
    for i in range(n):
        if event[i] != 1:
            continue
        longer = time > time[i]  # subjects who outlived i's event → comparable
        comp += float(longer.sum())
        conc += float(np.sum(longer & (eta[i] > eta)))
        tiedr += float(np.sum(longer & (eta[i] == eta)))
    return (conc + 0.5 * tiedr) / comp if comp > 0 else None


def cox(data):
    """Cox proportional-hazards regression via statsmodels' PHReg (Efron ties).
    Reports each covariate's coefficient, hazard ratio + CI, Wald z + p; the global
    likelihood-ratio χ² test; Harrell's C concordance; and the number of events.
    Assumes proportional hazards."""
    np, stats = _np_sp()
    d = data or {}
    time_in = d.get("time", []) or []
    event_in = d.get("event", []) or []
    preds = d.get("predictors", []) or []
    names = list(d.get("names", []) or [])
    conf = float(d.get("conf", 0.95))
    p = len(preds)
    if p < 1:
        raise StatsError("bad_request", "Cox regression needs a time, an event indicator, and ≥ 1 predictor.")
    n_total = len(time_in)
    # Complete-case listwise deletion; require positive event/censor times.
    T, E, rows = [], [], []
    for i in range(n_total):
        tv, ev = _num1(time_in[i]), _num1(event_in[i])
        xv = [_num1(preds[j][i]) if i < len(preds[j]) else None for j in range(p)]
        if tv is None or ev is None or any(v is None for v in xv):
            continue
        if not np.isfinite(tv) or tv <= 0:
            continue
        T.append(float(tv)); E.append(1.0 if ev != 0 else 0.0); rows.append([float(v) for v in xv])
    n = len(T)
    if n < p + 2:
        raise StatsError("bad_request", "Cox regression needs more complete rows than predictors.")
    Tt = np.asarray(T, dtype=float)
    Ee = np.asarray(E, dtype=float)
    Xx = np.asarray(rows, dtype=float).reshape(n, p)
    n_events = int(Ee.sum())
    if n_events < 1:
        raise StatsError("bad_request", "Cox regression needs at least one event (event = 1).")

    # Fit with statsmodels' PHReg (Efron ties) — the validated proportional-hazards
    # library, rather than a from-scratch partial-likelihood optimiser.
    try:
        from statsmodels.duration.hazard_regression import PHReg
    except Exception:
        raise StatsError("unavailable", "Cox regression needs statsmodels installed.")
    model = PHReg(Tt, Xx, status=Ee, ties="efron")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        res = model.fit()
    # PHReg does not raise on a failed fit — it only warns, so the warning is what is checked.
    # A covariate that orders every event perfectly makes the fit diverge: a huge β with
    # p ≈ 1 and Harrell's C = 1.0. That is the same Hauck-Donner trap as
    # the logistic case, and the same dangerous misreading — "p ≈ 1, so this covariate
    # doesn't matter" — from data it separates completely. A non-converged partial
    # likelihood has no usable coefficients, so it is refused rather than reported as a result.
    beta = np.asarray(res.params, dtype=float).reshape(p)
    # The warning is not always given: the optimiser can stop on a flat, still-rising likelihood
    # without one. So the fit is also refused when it is not a maximum — the partial
    # log-likelihood is at its ceiling of 0, or doubling the coefficients raises it further.
    if any("Convergence" in type(w.message).__name__ for w in caught) or _cox_not_a_maximum(np, model, beta):
        raise StatsError(
            "numerical",
            "the Cox fit did not converge — usually because a covariate separates the events "
            "completely, in which case the coefficients diverge and their P values are "
            "meaningless. Use a penalised (ridge/Firth) Cox fit, or combine sparse categories.")
    cov = np.asarray(res.cov_params(), dtype=float).reshape(p, p)
    ll = float(model.loglike(beta))            # partial log-likelihood at the fit
    ll0 = float(model.loglike(np.zeros(p)))    # null model (β = 0)
    converged = True                            # a non-converged fit was refused above
    se = np.sqrt(np.clip(np.diag(cov), 0, None))
    zc = float(stats.norm.ppf(1 - (1 - conf) / 2))

    if not names or len(names) < p:
        names = [names[j] if j < len(names) else "x%d" % (j + 1) for j in range(p)]
    terms = []
    for j in range(p):
        b, e = float(beta[j]), float(se[j])
        z = b / e if e > 0 else float("nan")
        pv = float(2 * stats.norm.sf(abs(z))) if e > 0 else None
        terms.append({
            "term": names[j], "estimate": _r(b), "se": _r(e),
            "statistic": _r(z), "p": _r(pv),
            "ciLow": _r(b - zc * e), "ciHigh": _r(b + zc * e),
            "hazardRatio": _r(float(np.exp(b))),
            "hrLow": _r(float(np.exp(b - zc * e))), "hrHigh": _r(float(np.exp(b + zc * e))),
        })
    lr = 2.0 * (ll - ll0)
    lr_p = float(stats.chi2.sf(lr, p))
    cindex = _cox_concordance(np, Tt, Ee, Xx @ beta)
    terms.append({"term": "LR χ² (model)", "estimate": _r(lr), "p": _r(lr_p), "df": p})
    terms.append({"term": "Concordance (Harrell C)", "estimate": _r(cindex)})
    terms.append({"term": "Events / n", "estimate": "%d / %d" % (n_events, n)})

    omitted = n_total - n
    assum = [
        "Cox proportional hazards: the hazard ratio for each covariate is constant over time (proportional hazards).",
        "Semiparametric — the baseline hazard is left unspecified; Efron's method handles tied event times.",
        "Hazard ratio exp(β) = multiplicative change in the hazard per unit predictor, holding the others fixed.",
    ]
    if omitted:
        assum.append("Complete-case: %d row(s) with a missing value (or non-positive time) were dropped." % omitted)
    if not converged:
        assum.append("⚠ The fit did not fully converge — check for separation or collinear predictors.")
    return {
        "method": "cox", "title": "Cox proportional-hazards regression", "terms": terms,
        "glance": {"n": n, "events": n_events, "lr_chi2": _r(lr), "p": _r(lr_p),
                   "concordance": _r(cindex), "loglik": _r(ll), "k": p},
        "summary": "Cox PH ~ %d predictor(s), %d events in %d subjects; LR χ²(%d) = %.4g, p = %s (%s); C = %s." % (
            p, n_events, n, p, lr, "%.4g" % lr_p, _p_words(lr_p),
            ("%.3f" % cindex) if cindex is not None else "—"),
        "assumptions": assum,
        "cite": "Cox (1972) proportional-hazards regression (statsmodels PHReg, Efron ties); %.3g%% Wald CIs." % (conf * 100),
    }


def power(data):
    """Sample-size / power calculator. Solves for the required N, the
    achieved power, OR the minimum detectable effect size — for six designs: unpaired,
    paired and one-sample t; two proportions; one-way ANOVA; and correlation. Uses
    statsmodels' noncentral-t/F power solvers for the t/proportions/ANOVA designs and
    the Fisher-z normal approximation for correlation. Returns the solved quantity plus
    a tradeoff table (required N across a range of target powers at the given effect)."""
    np, stats = _np_sp()
    from statsmodels.stats.power import TTestIndPower, TTestPower, NormalIndPower, FTestAnovaPower
    d = data or {}
    test = d.get("test", "ttest-two")
    solve = d.get("solve", "n")
    alpha = float(d.get("alpha", 0.05))
    alt = d.get("tail", "two-sided")  # 'two-sided' | 'larger' | 'smaller'
    ratio = float(d.get("ratio", 1.0))
    kg = int(d.get("kGroups", 3))
    if not (0 < alpha < 1):
        raise StatsError("bad_request", "α must be between 0 and 1")

    def num(key):
        v = d.get(key)
        return float(v) if v not in (None, "") else None
    effect, n, pw = num("effect"), num("n"), num("power")

    if test == "twoproportions" and d.get("p1") not in (None, "") and d.get("p2") not in (None, ""):
        from statsmodels.stats.proportion import proportion_effectsize
        effect = float(proportion_effectsize(float(d["p1"]), float(d["p2"])))

    es_sym = {"ttest-two": "d", "ttest-paired": "d", "ttest-onesample": "d",
              "twoproportions": "h", "anova": "f", "correlation": "r"}.get(test)
    if es_sym is None:
        raise StatsError("bad_request", "unknown power test: %s" % test)
    per_group = test in ("ttest-two", "twoproportions")
    n_label = "n per group" if per_group else "N total" if test in ("anova", "correlation") else "n"
    title = {"ttest-two": "Unpaired t", "ttest-paired": "Paired t", "ttest-onesample": "One-sample t",
             "twoproportions": "Two proportions", "anova": "One-way ANOVA", "correlation": "Correlation"}[test]

    zcrit = float(stats.norm.ppf(1 - alpha / 2 if alt == "two-sided" else 1 - alpha))

    def corr_power(r, nn):
        if nn <= 3:
            return None
        z = np.arctanh(min(abs(r), 0.999999)) * np.sqrt(nn - 3)
        return float(stats.norm.cdf(z - zcrit))

    def corr_n(r, p_target):
        zb = float(stats.norm.ppf(p_target))
        return float((zcrit + zb) ** 2 / (np.arctanh(min(abs(r), 0.999999)) ** 2) + 3)

    def corr_effect(nn, p_target):
        zb = float(stats.norm.ppf(p_target))
        return float(np.tanh((zcrit + zb) / np.sqrt(nn - 3)))

    def solve_sm(solver, want, **kw):
        kw[want] = None
        try:
            return float(solver.solve_power(**kw))
        except Exception as exc:
            raise StatsError("numerical", "power solve failed (check the inputs): %s" % exc)

    def compute(target, eff, nn, p_target):
        """Return the value of `target` ('n'|'power'|'effect') for this design."""
        if test == "ttest-two":
            s = TTestIndPower()
            if target == "n": return solve_sm(s, "nobs1", effect_size=eff, alpha=alpha, power=p_target, ratio=ratio, alternative=alt)
            if target == "power": return solve_sm(s, "power", effect_size=eff, nobs1=nn, alpha=alpha, ratio=ratio, alternative=alt)
            return solve_sm(s, "effect_size", nobs1=nn, alpha=alpha, power=p_target, ratio=ratio, alternative=alt)
        if test in ("ttest-paired", "ttest-onesample"):
            s = TTestPower()
            if target == "n": return solve_sm(s, "nobs", effect_size=eff, alpha=alpha, power=p_target, alternative=alt)
            if target == "power": return solve_sm(s, "power", effect_size=eff, nobs=nn, alpha=alpha, alternative=alt)
            return solve_sm(s, "effect_size", nobs=nn, alpha=alpha, power=p_target, alternative=alt)
        if test == "twoproportions":
            s = NormalIndPower()
            if target == "n": return solve_sm(s, "nobs1", effect_size=eff, alpha=alpha, power=p_target, ratio=ratio, alternative=alt)
            if target == "power": return solve_sm(s, "power", effect_size=eff, nobs1=nn, alpha=alpha, ratio=ratio, alternative=alt)
            return solve_sm(s, "effect_size", nobs1=nn, alpha=alpha, power=p_target, ratio=ratio, alternative=alt)
        if test == "anova":
            s = FTestAnovaPower()
            if target == "n": return solve_sm(s, "nobs", effect_size=eff, alpha=alpha, power=p_target, k_groups=kg)
            if target == "power": return solve_sm(s, "power", effect_size=eff, nobs=nn, alpha=alpha, k_groups=kg)
            return solve_sm(s, "effect_size", nobs=nn, alpha=alpha, power=p_target, k_groups=kg)
        # correlation
        if target == "n": return corr_n(eff, p_target)
        if target == "power": return corr_power(eff, nn)
        return corr_effect(nn, p_target)

    # Validate the inputs the chosen direction needs, then solve.
    if solve == "n":
        if effect is None or pw is None:
            raise StatsError("bad_request", "solving for N needs an effect size and a target power")
        solved = compute("n", effect, None, pw)
        n = solved
    elif solve == "power":
        if effect is None or n is None:
            raise StatsError("bad_request", "solving for power needs an effect size and a sample size")
        solved = compute("power", effect, n, None)
        pw = solved
    elif solve == "effect":
        if n is None or pw is None:
            raise StatsError("bad_request", "solving for the detectable effect needs a sample size and a target power")
        solved = compute("effect", None, n, pw)
        effect = solved
    else:
        raise StatsError("bad_request", "solve must be one of: n, power, effect")
    if solved is None or not np.isfinite(solved):
        raise StatsError("numerical", "the power calculation did not converge for these inputs")

    def total_of(n_per):
        return n_per * (1 + ratio) if per_group else n_per

    # Tradeoff table: required N across target powers at the fixed effect + α.
    targets = [0.70, 0.80, 0.90, 0.95, 0.99]
    tradeoff = {"power": [], "n": [], "total": []}
    for pt in targets:
        try:
            npg = compute("n", effect, None, pt)
        except StatsError:
            npg = None
        if npg is not None and np.isfinite(npg):
            npg_c = int(np.ceil(npg))
            tradeoff["power"].append(pt)
            tradeoff["n"].append(npg_c)
            tradeoff["total"].append(int(np.ceil(total_of(npg_c))) if per_group else npg_c)

    ceil_n = int(np.ceil(n)) if (n is not None and np.isfinite(n)) else None
    terms = [
        {"term": "Design", "estimate": title + (" (%d groups)" % kg if test == "anova" else "")},
        {"term": "Effect size (%s)" % es_sym, "estimate": _r(effect)},
        {"term": "α (%s)" % ("two-sided" if alt == "two-sided" else "one-sided"), "estimate": _r(alpha)},
        {"term": "Power", "estimate": _r(pw)},
        {"term": n_label, "estimate": ceil_n if solve == "n" else (int(round(n)) if n is not None else None)},
    ]
    if per_group and ceil_n is not None:
        terms.append({"term": "Total N", "estimate": int(np.ceil(total_of(ceil_n)))})

    solved_label = {"n": n_label, "power": "power", "effect": "detectable effect (%s)" % es_sym}[solve]
    if solve == "n":
        solved_txt = "%s = %d%s" % (n_label, ceil_n, (" (%d total)" % int(np.ceil(total_of(ceil_n)))) if per_group else "")
    elif solve == "power":
        solved_txt = "power = %.3f" % pw
    else:
        solved_txt = "detectable %s = %.4g" % (es_sym, effect)
    return {
        "method": "power", "title": "Sample size & power — %s" % title,
        "terms": terms,
        "glance": {"test": test, "solve": solve, "effect": _r(effect), "alpha": _r(alpha),
                   "power": _r(pw), "n": ceil_n, "n_exact": _r(n), "per_group": per_group,
                   "total": int(np.ceil(total_of(ceil_n))) if (per_group and ceil_n is not None) else ceil_n,
                   "k": kg if test == "anova" else None, "ratio": _r(ratio), "es_symbol": es_sym},
        "extra": {"tradeoff": tradeoff},
        "summary": "%s power (%s, α = %.3g): %s." % (title, alt, alpha, solved_txt),
        "assumptions": [
            "Effect size is Cohen's %s%s." % (es_sym, {"d": " (standardized mean difference)", "h": " (arcsine proportions)",
                                                       "f": " (√(η²/(1−η²)))", "r": " (correlation)"}.get(es_sym, "")),
            "t / proportions / ANOVA use the noncentral t / F distributions (statsmodels); correlation uses the Fisher-z normal approximation.",
            "N is rounded UP to whole subjects; the tradeoff table gives the required N at other target powers.",
        ],
        "cite": "Power analysis via statsmodels.stats.power (noncentral t/F) + Fisher-z for correlation; Cohen (1988) effect-size conventions.",
    }


def montecarlo(data):
    """Monte-Carlo simulation of a curve-fitting experiment: simulate the
    chosen registry model at 'true' parameter values over an X design, add random
    scatter, fit the model back, and repeat N times — reporting the distribution of
    each fitted parameter (mean, SD, median, 95% CI, bias vs true, CV%) plus the fit
    convergence rate. Answers 'with this design + noise, how precisely can I determine
    each parameter?'. Deterministic in `seed`."""
    np, stats = _np_sp()
    # The registry models call these module globals (mirrors `_nl_fit_core`'s setup),
    # so set them up before evaluating `model["fn"]` here.
    global np_exp, np_log, np_sin, np_where, sp_wofz, sp_erfcx, sp_ndtr
    np_exp, np_log, np_sin, np_where = np.exp, np.log, np.sin, np.where
    from scipy.special import wofz as _wofz, erfcx as _erfcx, ndtr as _ndtr
    sp_wofz, sp_erfcx, sp_ndtr = _wofz, _erfcx, _ndtr

    d = data or {}
    model_name = d.get("model", "4pl")
    models = _nl_models()
    if model_name not in models:
        raise StatsError("bad_request", "unknown model: %s" % model_name)
    model = models[model_name]
    if model.get("consts") or model.get("const_fn") or model.get("global_only"):
        raise StatsError("bad_request",
                         "%s uses per-dataset constants / global-only fitting — Monte-Carlo needs a single-curve model." % model["title"])
    params = model["params"]
    true_params = [float(v) for v in _num(d.get("trueParams", []))]
    if len(true_params) != len(params):
        raise StatsError("bad_request", "%s needs %d 'true' parameter value(s); got %d." % (model["title"], len(params), len(true_params)))

    # X design grid (arithmetic or geometric), each X repeated `replicates` times.
    x_start, x_end = float(d.get("xStart", 0.0)), float(d.get("xEnd", 1.0))
    x_count = max(2, int(d.get("xCount", 10)))
    x_log = bool(d.get("xLog", False))
    replicates = max(1, int(d.get("replicates", 1)))
    if x_log:
        if x_start <= 0 or x_end <= 0:
            raise StatsError("bad_request", "log-spaced X needs positive start/end.")
        xg = 10 ** np.linspace(np.log10(x_start), np.log10(x_end), x_count)
    else:
        xg = np.linspace(x_start, x_end, x_count)
    xs = np.repeat(xg, replicates)

    logx = model.get("logx", False)
    if logx and np.any(xs <= 0):
        raise StatsError("bad_request", "%s is a log-dose model — the X design must be positive." % model["title"])
    ax = np.log10(xs) if logx else xs
    true_clean = np.asarray(model["fn"](ax, *true_params), dtype=float)
    if not np.all(np.isfinite(true_clean)):
        raise StatsError("bad_request", "the model is undefined at some design points for these 'true' parameters.")

    noise = d.get("noise") or {"type": "sd", "value": 1.0}
    ntype = noise.get("type", "sd")
    nval = float(noise.get("value", 1.0))
    if nval <= 0:
        raise StatsError("bad_request", "Monte-Carlo needs a positive noise level (SD or %).")
    sd_vec = (np.abs(true_clean) * nval / 100.0) if ntype == "relative" else np.full(xs.shape, nval)

    n_iter = min(5000, max(10, int(d.get("iterations", 200))))
    seed = int(d.get("seed", 20240705))
    rng = np.random.default_rng(seed)
    fit_data = {}  # unweighted, unconstrained fits

    fits = []
    for _ in range(n_iter):
        y = true_clean + rng.normal(0.0, 1.0, size=xs.shape) * sd_vec
        try:
            core = _nl_fit_core(np, model, xs, y, fit_data)
            popt = [float(v) for v in core["popt"]]
            if all(np.isfinite(popt)):
                fits.append(popt)
        except StatsError:
            continue
        except Exception:
            continue
    n_conv = len(fits)
    if n_conv < 2:
        raise StatsError("numerical",
                         "only %d of %d fits converged — increase the points/SNR or pick better 'true' values." % (n_conv, n_iter))

    arr = np.asarray(fits, dtype=float)  # (n_conv, k)
    terms = []
    for j, pn in enumerate(params):
        col = arr[:, j]
        mean = float(np.mean(col))
        sd = float(np.std(col, ddof=1)) if col.size > 1 else 0.0
        terms.append({"term": pn, "estimate": _r(mean), "true": _r(true_params[j]),
                      "bias": _r(mean - true_params[j]), "sd": _r(sd),
                      "cv": (_r(100.0 * sd / abs(mean)) if mean != 0 else None),
                      "ciLow": _r(float(np.percentile(col, 2.5))), "ciHigh": _r(float(np.percentile(col, 97.5)))})
    conv_rate = 100.0 * n_conv / n_iter
    return {
        "method": "montecarlo", "title": "Monte-Carlo — %s" % model["title"], "terms": terms,
        "glance": {"iterations": n_iter, "converged": n_conv, "conv_rate": _r(conv_rate),
                   "points": int(xg.size), "replicates": replicates, "n": int(xs.size)},
        "extra": {"samples": {pn: [_r(float(v)) for v in arr[:, j]] for j, pn in enumerate(params)}},
        "summary": "%d Monte-Carlo fits of %s (%d converged, %.0f%%): each parameter's SD + 95%% CI show how precisely this design + noise pin it down." % (
            n_iter, model["title"], n_conv, conv_rate),
        "assumptions": [
            "Data simulated at the 'true' parameters + %s scatter, then re-fit N times; the spread of the fitted values is the parameter uncertainty for this design." % (
                "relative-%" if ntype == "relative" else "constant-SD"),
            "Unweighted least-squares fits; non-converging fits are excluded (see the convergence rate).",
        ],
        "cite": "Monte-Carlo simulation of parameter recovery (Motulsky & Christopoulos, Fitting Models to Biological Data).",
    }


def ping(data):
    """Dependency-free liveness/echo — used by the transport + crash-recovery tests."""
    return {"pong": True, "echo": (data or {}).get("echo")}


def curvetransform(data):
    """Smooth, differentiate, or integrate a curve. Returns a new curve at the same X: a
    Savitzky-Golay smooth, the derivative dY/dX (or d²Y/dX²), or the cumulative integral ∫Y·dX.
    The result spawns its own table + graph (the transformed Y has new units)."""
    np, _stats = _np_sp()
    d = data or {}
    # X and Y are paired by row — clean them together (see `_aligned`).
    _ax, _ay = _aligned(d.get("x"), d.get("y"))
    x = np.asarray(_ax, dtype=float)
    y = np.asarray(_ay, dtype=float)
    n = min(x.size, y.size)
    if n < 3:
        raise StatsError("bad_request", "smooth / differentiate / integrate needs ≥ 3 points")
    x, y = x[:n], y[:n]
    order = np.argsort(x)
    x, y = x[order], y[order]
    # Average tied-X points so the grid is strictly increasing (dx > 0 for derivatives/integral).
    ux, inv = np.unique(x, return_inverse=True)
    if ux.size < x.size:
        y = np.array([float(y[inv == i].mean()) for i in range(ux.size)])
        x = ux
    n = x.size
    if n < 3:
        raise StatsError("bad_request", "need ≥ 3 distinct X values")
    variant = d.get("variant", "smooth") or "smooth"

    if variant == "smooth":
        from scipy.signal import savgol_filter
        win = int(d.get("smoothWindow", 0) or 0)
        if win <= 0:
            win = 2 * max(1, n // 10) + 1  # default ≈ 10% of the points, odd
        win = max(3, min(win, n))
        if win % 2 == 0:
            win -= 1
        poly = max(1, min(int(d.get("polyorder", 2) or 2), win - 1))
        yt = savgol_filter(y, win, poly)
        title, ylabel = "Smoothed curve", "Smoothed Y"
        summary = "Smoothed %d points (Savitzky-Golay, window %d, order %d)." % (n, win, poly)
        cite = "Savitzky-Golay smoothing (sliding-window polynomial least squares)."
    elif variant in ("differentiate", "derivative"):
        yt = np.gradient(y, x)
        title, ylabel = "First derivative dY/dX", "dY/dX"
        summary = "Numerical first derivative dY/dX over %d points." % n
        cite = "Numerical differentiation (2nd-order central finite differences)."
    elif variant in ("differentiate2", "derivative2"):
        yt = np.gradient(np.gradient(y, x), x)
        title, ylabel = "Second derivative d²Y/dX²", "d²Y/dX²"
        summary = "Numerical second derivative d²Y/dX² over %d points." % n
        cite = "Numerical second differentiation (central finite differences)."
    elif variant == "integrate":
        yt = np.concatenate([[0.0], np.cumsum(0.5 * (y[1:] + y[:-1]) * np.diff(x))])
        title, ylabel = "Cumulative integral ∫Y·dX", "∫Y·dX"
        summary = "Cumulative area ∫Y·dX = %.6g (trapezoidal) over %d points." % (float(yt[-1]), n)
        cite = "Cumulative trapezoidal integration."
    elif variant in ("lineweaver_burk", "eadie_hofstee", "hanes_woolf"):
        return _mm_linearization(np, x, y, variant)
    else:
        raise StatsError("bad_request", "unknown curve transform: %s" % variant)

    glance = {"n": n, "variant": variant}
    terms = [{"term": "Points", "estimate": n}]
    if variant == "integrate":
        glance["area"] = _r(float(yt[-1]))
        terms.append({"term": "Total area (∫Y·dX)", "estimate": _r(float(yt[-1]))})
    return {
        "method": "curvetransform", "title": title,
        "terms": terms, "glance": glance, "summary": summary,
        "extra": {"curve": {"x": [round(float(v), 6) for v in x],
                            "y": [round(float(v), 6) for v in yt], "yTitle": ylabel}},
        "assumptions": ["Operates on the data points as given; no model is fitted.",
                        "Derivatives use central differences; the integral is the cumulative trapezoid on the sorted X grid."],
        "cite": cite,
    }


# ── Michaelis-Menten linearizations (diagnostic plots) ───────────────────────────
# The three classical straight-line rearrangements of v = Vmax·S/(KM+S):
#   Lineweaver-Burk  1/v   = (KM/Vmax)·(1/S) + 1/Vmax      slope KM/Vmax, intercept 1/Vmax
#   Eadie-Hofstee    v     = −KM·(v/S) + Vmax              slope −KM,     intercept Vmax
#   Hanes-Woolf      S/v   = (1/Vmax)·S + KM/Vmax          slope 1/Vmax,  intercept KM/Vmax
# These are for looking, not for fitting. Each reciprocal compresses the high-substrate
# points and inflates the error on the low-substrate ones, so ordinary least squares on a
# linearization is heteroscedastic and biased — Lineweaver-Burk worst of all. The Vmax/KM
# they imply are reported so the user can compare them against the nonlinear fit, and are
# labelled as what they are. Eadie-Hofstee and Hanes-Woolf additionally have v on both
# axes (or in both coordinates), so their residuals are correlated by construction.
_LINEARIZATIONS = {
    #  key:            (title, xlabel, ylabel, needs_positive_y, cite)
    "lineweaver_burk": ("Lineweaver-Burk (double reciprocal)", "1 / [S]", "1 / v", True,
                        "Lineweaver & Burk (1934) double-reciprocal plot: 1/v vs 1/[S]."),
    "eadie_hofstee":   ("Eadie-Hofstee", "v / [S]", "v", False,
                        "Eadie-Hofstee plot: v vs v/[S]."),
    "hanes_woolf":     ("Hanes-Woolf", "[S]", "[S] / v", True,
                        "Hanes-Woolf plot: [S]/v vs [S]."),
}


def _mm_linearization(np, x, y, variant):
    """One of the three classical MM straight-line transforms. Returns the transformed
    points plus the OLS line through them and the Vmax/KM it implies — explicitly as a
    diagnostic, never as a substitute for the nonlinear fit."""
    title, xlabel, ylabel, needs_pos_y, cite = _LINEARIZATIONS[variant]
    # Every transform divides by [S], and two of them divide by v, so the undefined points
    # must be dropped rather than silently producing inf/NaN. Report how many were lost.
    # Eadie-Hofstee divides only by [S] — v = 0 maps to the point (0, 0) and is kept.
    # Lineweaver-Burk (1/v) and Hanes-Woolf ([S]/v) divide by v, so v = 0 is undefined.
    ok = x > 0
    if needs_pos_y:
        ok = ok & (y != 0)
    dropped = int((~ok).sum())
    xs, ys = x[ok], y[ok]
    if xs.size < 2:
        raise StatsError(
            "bad_request",
            "%s needs ≥ 2 points with [S] > 0%s" % (title, " and v ≠ 0" if needs_pos_y else ""),
        )
    if variant == "lineweaver_burk":
        xt, yt = 1.0 / xs, 1.0 / ys
    elif variant == "eadie_hofstee":
        xt, yt = ys / xs, ys
    else:  # hanes_woolf
        xt, yt = xs, xs / ys

    # OLS line through the transformed points → the implied kinetic constants.
    vmax = km = slope = intercept = float("nan")
    if xt.size >= 2 and float(np.ptp(xt)) > 0:
        slope, intercept = [float(v) for v in np.polyfit(xt, yt, 1)]
        if variant == "lineweaver_burk":
            vmax = 1.0 / intercept if intercept != 0 else float("nan")
            km = slope * vmax if intercept != 0 else float("nan")
        elif variant == "eadie_hofstee":
            vmax, km = intercept, -slope
        else:  # hanes_woolf
            vmax = 1.0 / slope if slope != 0 else float("nan")
            km = intercept * vmax if slope != 0 else float("nan")

    n = int(xt.size)
    # A degenerate line (zero intercept/slope, or no spread in the transformed X) leaves a
    # non-finite constant. json.dumps would write a bare NaN/Infinity literal, which is not
    # valid JSON and would fail the renderer's parse — emit null instead.
    def _fin(v):
        return None if v is None or v != v or v in (float("inf"), float("-inf")) else _r(v)

    terms = [
        {"term": "Points", "estimate": n},
        {"term": "Slope", "estimate": _fin(slope)},
        {"term": "Y-intercept", "estimate": _fin(intercept)},
        {"term": "Vmax (implied by the line)", "estimate": _fin(vmax)},
        {"term": "KM (implied by the line)", "estimate": _fin(km)},
    ]
    if dropped:
        terms.append({"term": "Points dropped (undefined after transform)", "estimate": dropped})
    summary = ("%s of %d points. The line implies Vmax = %.6g and KM = %.6g — for diagnosis only: "
               "read these against a nonlinear Michaelis-Menten fit, which is the estimate to "
               "report." % (title, n, vmax, km))
    if dropped:
        summary += " %d point(s) were dropped as undefined after the transform." % dropped
    return {
        "method": "curvetransform", "title": title,
        "terms": terms,
        "glance": {"n": n, "variant": variant, "slope": _fin(slope), "intercept": _fin(intercept),
                   "vmax": _fin(vmax), "km": _fin(km), "dropped": dropped},
        "summary": summary,
        "extra": {"curve": {"x": [round(float(v), 6) for v in xt],
                            "y": [round(float(v), 6) for v in yt],
                            "xTitle": xlabel, "yTitle": ylabel}},
        "assumptions": [
            "X is substrate concentration [S] and Y is an initial velocity v.",
            "Points with [S] = 0 (and v = 0 where the transform divides by v) are undefined and are dropped.",
        ],
        "warnings": [
            "A linearization is a diagnostic view, not an estimator: the transform distorts the "
            "error structure, so least squares on these axes is biased. Report the nonlinear fit.",
        ],
        "cite": cite,
    }


METHODS = {
    "ping": ping,
    "describe": describe,
    "normality": normality,
    "ttest": ttest,
    "equivalence": equivalence,
    "permutation": permutation,
    "bayesfactor": bayesfactor,
    # The UI names one-way ANOVA "anova"; "anova1" is kept as a direct alias.
    "anova": anova1,
    "anova1": anova1,
    "correlation": correlation,
    "corrmatrix": corrmatrix,
    "regression": regression,
    "multipleregression": multipleregression,
    "logistic": logistic,
    "poisson": poisson,
    "cluster": cluster,
    "deming": deming,
    "blandaltman": blandaltman,
    "passingbablok": passingbablok,
    "pca": pca,
    "pcoa": pcoa,
    "nmds": nmds,
    "ca": ca,
    "rda": rda,
    "cca": cca,
    "dbrda": dbrda,
    "permanova": permanova,
    "varpart": varpart,
    "ancova": ancova,
    "contingency": contingency,
    "goodnessoffit": goodnessoffit,
    "nested": nested,
    "twoway": twoway,
    "multifactor": multifactor,
    "mixedmodel": mixedmodel,
    "rmanova": rmanova,
    "mixedanova": mixedanova,
    "survival": survival,
    "cox": cox,
    "roc": roc,
    "curvefit": curvefit,
    "meltingtemp": meltingtemp,
    "interpolate": interpolate,
    "globalfit": globalfit,
    "comparefits": comparefits,
    "auc": auc,
    "outliers": outliers,
    "pcorrect": pcorrect,
    "metaanalysis": metaanalysis,
    "publicationbias": publicationbias,
    "power": power,
    "montecarlo": montecarlo,
    "curvetransform": curvetransform,
}


def main():
    # Windows: force binary stdio so the framing bytes are not corrupted by
    # CR/LF translation.
    if sys.platform == "win32":
        import msvcrt

        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer

    write_frame(stdout, {
        "type": "hello",
        "engine": "mady-dev-engine",
        "version": "0.0.0",
        "contractVersion": CONTRACT_VERSION,
        # The versions of everything that actually computed the numbers, reported by
        # the interpreter that will run them rather than assumed by the app. The
        # drafted Methods paragraph cites these, so they must be the real ones — a
        # frozen build ships its own pinned wheels and will report different values
        # from a dev checkout.
        "libraries": _library_versions(),
    })

    while True:
        message = read_frame(stdin)
        if message is None:
            break
        mtype = message.get("type")
        if mtype == "cancel":
            continue  # describe is instant; nothing to cancel
        if mtype != "request":
            continue
        req_id = message.get("id")
        method = message.get("method")
        try:
            if method == "crash":
                os._exit(1)  # deliberate crash to test supervisor recovery
            handler = METHODS.get(method)
            if handler is None:
                write_frame(stdout, {
                    "type": "error", "id": req_id, "ok": False,
                    "code": "unsupported_method",
                    "message": "unknown method: %s" % method,
                })
                continue
            write_frame(stdout, {
                "type": "result", "id": req_id, "ok": True,
                "results": handler(message.get("data")),
                "diagnostics": {"engine": "mady-engine"},
            })
        except StatsError as exc:  # typed engine error
            write_frame(stdout, {
                "type": "error", "id": req_id, "ok": False,
                "code": exc.code, "message": exc.message,
            })
        except Exception as exc:  # any other failure → internal error
            write_frame(stdout, {
                "type": "error", "id": req_id, "ok": False,
                "code": "engine_internal", "message": str(exc),
            })


if __name__ == "__main__":
    main()
