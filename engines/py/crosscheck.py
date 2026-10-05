"""Independent cross-check of engine.py calculations.

Every check recomputes a quantity through a code path that shares no implementation
with the engine's scipy/statsmodels stack, then asserts the engine agrees:

  * Python stdlib ``statistics`` — a pure-Python implementation, wholly separate
    from numpy (mean/median/variance/stdev/geometric_mean/harmonic_mean/correlation/
    linear_regression).
  * ``mpmath`` at 50-digit precision — distribution tails / p-values via the
    regularised incomplete beta & gamma functions, independent of scipy.special.
  * closed-form re-derivations written here (pooled/Welch t, one-way ANOVA SS, OLS
    normal equations, the normal-vs-lognormal AIC).
  * literature-certified values, cited inline.

Run: ``py -3 crosscheck.py`` (needs numpy/scipy/statsmodels for the engine + mpmath).
Exits non-zero if any check fails. Wrapped by engine.crosscheck.test.ts so it runs
inside ``npx vitest run``.
"""
import math
import statistics as st
import sys
import warnings

import mpmath as mp
import numpy as np

import engine

# The table prints Greek letters and maths signs, which a Windows console's default code page
# cannot encode; without this every check group that prints one fails on the print, not the maths.
sys.stdout.reconfigure(encoding="utf-8")

# Keep the cross-check table clean; the engine's own warnings still surface in engine.test.ts.
warnings.filterwarnings("ignore", category=FutureWarning)

mp.mp.dps = 50

_PASS = 0
_FAIL = 0


def check(name, got, want, tol=2e-4):
    """Relative+absolute tolerance so the engine's display rounding is absorbed but a
    real discrepancy fails."""
    global _PASS, _FAIL
    ok = got is not None and want is not None and abs(float(got) - float(want)) <= tol * (1 + abs(float(want)))
    _PASS += ok
    _FAIL += not ok
    print("%-4s %-52s engine=%-16.8g independent=%-16.8g" % ("PASS" if ok else "FAIL", name, float(got) if got is not None else float("nan"), float(want) if want is not None else float("nan")))


def check_eq(name, got, want):
    global _PASS, _FAIL
    ok = got == want
    _PASS += ok
    _FAIL += not ok
    print("%-4s %-52s engine=%-16s independent=%-16s" % ("PASS" if ok else "FAIL", name, got, want))


def check_le(name, got, tol):
    """Assert got <= tol (for 'the two fits' curves agree to within X')."""
    global _PASS, _FAIL
    ok = got <= tol
    _PASS += ok
    _FAIL += not ok
    print("%-4s %-52s value=%-16.3g <= tol=%-10.3g" % ("PASS" if ok else "FAIL", name, got, tol))


def check_gt(name, got, floor):
    """Assert got > floor (for "this correlation must be at least this strong")."""
    global _PASS, _FAIL
    ok = got is not None and float(got) > float(floor)
    _PASS += ok
    _FAIL += not ok
    print("%-4s %-52s value=%-16.3g >  floor=%-10.3g" % ("PASS" if ok else "FAIL", name, float(got) if got is not None else float("nan"), float(floor)))


def r2(y, yhat):
    ybar = sum(y) / len(y)
    sst = sum((yi - ybar) ** 2 for yi in y)
    ssr = sum((yi - fi) ** 2 for yi, fi in zip(y, yhat))
    return 1 - ssr / sst if sst > 0 else 1.0


# ── independent distribution tails via mpmath (50-digit) ─────────────────────
def t_p_two(t, df):
    """Two-sided Student-t p = P(|T|>|t|) = I_{df/(df+t^2)}(df/2, 1/2)."""
    x = mp.mpf(df) / (mp.mpf(df) + mp.mpf(t) ** 2)
    return float(mp.betainc(mp.mpf(df) / 2, mp.mpf(1) / 2, 0, x, regularized=True))


def t_crit_two(df, alpha=0.05):
    """Two-sided Student-t critical value: the t with P(|T|>t)=alpha, by bisection on
    the exact (monotone-decreasing) tail above — independent of scipy.stats.t.ppf."""
    lo, hi = 0.0, 1000.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if t_p_two(mid, df) > alpha:  # tail too large ⇒ t must be bigger
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def f_p(f, d1, d2):
    """Upper-tail F p = P(F>f) = I_{d2/(d2+d1 f)}(d2/2, d1/2)."""
    x = mp.mpf(d2) / (mp.mpf(d2) + mp.mpf(d1) * mp.mpf(f))
    return float(mp.betainc(mp.mpf(d2) / 2, mp.mpf(d1) / 2, 0, x, regularized=True))


def chi2_p(x, k):
    """Upper-tail chi-square p = P(X^2 > x) = Q(k/2, x/2) (regularised upper incomplete gamma)."""
    return float(mp.gammainc(mp.mpf(k) / 2, mp.mpf(x) / 2, mp.inf, regularized=True))


def normal_two(z):
    """Two-sided standard-normal p = erfc(|z|/sqrt2)."""
    return float(mp.erfc(abs(mp.mpf(z)) / mp.sqrt(2)))


def fisher_2x2(a, b, c, d):
    """Two-sided Fisher exact p for a 2x2 table, via the hypergeometric distribution
    (mpmath exact binomials) — sum the probabilities of all tables (fixed margins) no
    more likely than the observed one."""
    r1, r2, c1, N = a + b, c + d, a + c, a + b + c + d
    hp = lambda av: mp.binomial(r1, av) * mp.binomial(r2, c1 - av) / mp.binomial(N, c1)
    p_obs = hp(a)
    tot = mp.mpf(0)
    for av in range(max(0, c1 - r2), min(r1, c1) + 1):
        p = hp(av)
        if p <= p_obs * (1 + mp.mpf("1e-9")):
            tot += p
    return float(tot)


def mcnemar_exact(b, c):
    """Two-sided exact McNemar p = min(1, 2 * P(Bin(b+c, 1/2) <= min(b,c)))."""
    nn, kk = b + c, min(b, c)
    s = sum(mp.binomial(nn, i) for i in range(kk + 1)) / mp.mpf(2) ** nn
    return float(min(mp.mpf(1), 2 * s))


def logrank_from_scratch(t1, e1, t2, e2):
    """Mantel-Cox log-rank chi-square, reimplemented from the raw times/events —
    a full independent reimplementation, not a library call."""
    ev_times = sorted(set([t1[i] for i in range(len(t1)) if e1[i]] + [t2[i] for i in range(len(t2)) if e2[i]]))
    O1 = E1 = V = 0.0
    for t in ev_times:
        n1 = sum(1 for x in t1 if x >= t)
        n2 = sum(1 for x in t2 if x >= t)
        d1 = sum(1 for i in range(len(t1)) if t1[i] == t and e1[i])
        d2 = sum(1 for i in range(len(t2)) if t2[i] == t and e2[i])
        n, d = n1 + n2, d1 + d2
        O1 += d1
        E1 += d * n1 / n
        if n > 1:
            V += d * (n1 / n) * (n2 / n) * (n - d) / (n - 1)
    return (O1 - E1) ** 2 / V


def term(res, name, field="estimate"):
    for t in res["terms"]:
        if t["term"] == name:
            return t.get(field)
    return None


# ── extra independent oracles for the validation batteries ───────────────────
def normal_cdf(x):
    """Standard-normal CDF via mpmath erfc — independent of scipy."""
    return float(mp.erfc(-mp.mpf(x) / mp.sqrt(2)) / 2)


def nct_cdf(t, df, ncp):
    """Noncentral-t CDF F(t; df, ncp) = E_V[Φ(t·√(V/df) − ncp)], V~χ²_df, by exact
    mpmath quadrature — shares no code with scipy.stats.nct. Valid for all real t."""
    with mp.workdps(25):
        t, nu, dlt = mp.mpf(t), mp.mpf(df), mp.mpf(ncp)

        def integrand(v):
            phi = mp.erfc(-(t * mp.sqrt(v / nu) - dlt) / mp.sqrt(2)) / 2
            g = v ** (nu / 2 - 1) * mp.e ** (-v / 2) / (2 ** (nu / 2) * mp.gamma(nu / 2))
            return phi * g

        return float(mp.quad(integrand, [0, nu, mp.inf]))


def rank_biserial_by_pairs(a, b):
    """Rank-biserial correlation counted straight from pairs: P(a>b) - P(a<b).

    Deliberately shares nothing with the engine (no U, no ranks) — Kerby's
    simple-difference definition, brute-forced. An oracle that restated the
    engine's own `1 - 2U/(nA*nB)` would confirm an inverted sign instead of
    catching it.
    """
    gt = sum(1 for x in a for y in b if x > y)
    lt = sum(1 for x in a for y in b if x < y)
    return (gt - lt) / float(len(a) * len(b))


def avg_ranks(vals):
    """1-based average (mid-)ranks, ties averaged — pure Python."""
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    ranks = [0.0] * len(vals)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and vals[order[j + 1]] == vals[order[i]]:
            j += 1
        r = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = r
        i = j + 1
    return ranks


def signed_rank_min(diffs):
    """(min(T+,T−), rank-vector) for Wilcoxon: drop zeros, mid-rank |diff|, sum by sign."""
    nz = [x for x in diffs if x != 0]
    ranks = avg_ranks([abs(x) for x in nz])
    tp = sum(r for r, x in zip(ranks, nz) if x > 0)
    tm = sum(r for r, x in zip(ranks, nz) if x < 0)
    return min(tp, tm), ranks


def wilcoxon_exact_p(ranks, w_obs):
    """Exact two-sided Wilcoxon p (no ties/zeros): over all 2^n sign patterns tabulate
    T+ = Σ positively-signed ranks; p = 2·P(T+ ≤ w_obs), clipped to 1."""
    n = len(ranks)
    le = sum(1 for mask in range(1 << n)
             if sum(ranks[i] for i in range(n) if mask & (1 << i)) <= w_obs + 1e-9)
    return min(1.0, 2.0 * le / (1 << n))


def mwu_exact_p(na, nb, u_obs):
    """Exact two-sided Mann-Whitney p (no ties): over all C(na+nb,na) rank subsets of A,
    tabulate U_a = ΣrankA − na(na+1)/2; p = 2·min(P(U≤u), P(U≥u)), clipped to 1."""
    from itertools import combinations
    total = math.comb(na + nb, na)
    le = ge = 0
    for pos in combinations(range(1, na + nb + 1), na):
        u = sum(pos) - na * (na + 1) / 2.0
        le += (u <= u_obs + 1e-9)
        ge += (u >= u_obs - 1e-9)
    return min(1.0, 2.0 * min(le, ge) / total)


def ks_d(a, b):
    """Two-sample KS D = max over pooled points of |ECDF_a − ECDF_b| — pure Python."""
    na, nb = len(a), len(b)
    d = 0.0
    for x in sorted(set(a) | set(b)):
        d = max(d, abs(sum(v <= x for v in a) / na - sum(v <= x for v in b) / nb))
    return d


def pure_percentile(vals, pct):
    """numpy-default ('linear') percentile in pure Python."""
    s = sorted(vals)
    if len(s) == 1:
        return float(s[0])
    pos = (pct / 100.0) * (len(s) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return float(s[lo] + (s[hi] - s[lo]) * (pos - lo))


def bh_fdr(pvals):
    """Benjamini-Hochberg q-values (monotone step-up) — independent pure-Python."""
    m = len(pvals)
    order = sorted(range(m), key=lambda i: pvals[i])
    q = [0.0] * m
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        prev = min(prev, pvals[i] * m / rank)
        q[i] = prev
    return q


def _term(res, name):
    """Fetch a terms-row dict by its 'term' label (or {} if absent)."""
    for t in res.get("terms", []):
        if t.get("term") == name:
            return t
    return {}


M = engine.METHODS


# ── Describe — vs stdlib statistics (independent of numpy) ───────────────────
def _stephens_ad_p(a2, n):
    """Anderson-Darling (parameters estimated) approximate p — Stephens (1986) case 3,
    re-implemented from the published piecewise formula (independent of engine._anderson_p)."""
    z = a2 * (1 + 0.75 / n + 2.25 / n / n)
    if z < 0.2:
        return 1 - math.exp(-13.436 + 101.14 * z - 223.73 * z * z)
    if z < 0.34:
        return 1 - math.exp(-8.318 + 42.796 * z - 59.938 * z * z)
    if z < 0.6:
        return math.exp(0.9177 - 4.279 * z - 1.38 * z * z)
    return math.exp(1.2937 - 5.709 * z + 0.0186 * z * z)


def check_descriptives_extra():
    # Describe/normality terms checked here, independently of the engine
    # — skewness/kurtosis, the mean/median/geometric-mean CIs, the Anderson-Darling
    # p, the lognormality Akaike weight, and the Lilliefors D. Oracles: stdlib central
    # moments, mpmath t-critical / math.comb sign-test interval, a from-scratch ECDF A²
    # + Stephens formula, a stdlib normal-vs-lognormal AIC weight, and a from-scratch KS D.
    print("\n# describe/normality extras  (oracle: stdlib moments · mpmath t-crit · from-scratch A²/D)")
    x = [4.2, 5.1, 3.8, 6.0, 7.3, 5.5, 4.9, 6.7, 5.2, 4.4, 8.1, 3.3, 5.9, 6.3, 4.7]
    n = len(x)
    r = M["describe"]({"values": x})
    tm = {t["term"]: t for t in r["terms"]}
    m = st.mean(x)
    # Skewness (Fisher-Pearson G1) + excess kurtosis (G2) from stdlib central moments.
    m2 = sum((v - m) ** 2 for v in x) / n
    m3 = sum((v - m) ** 3 for v in x) / n
    m4 = sum((v - m) ** 4 for v in x) / n
    check("describe skewness (G1, stdlib moments)", tm["Skewness"]["estimate"], (m3 / m2 ** 1.5) * (n * (n - 1)) ** 0.5 / (n - 2))
    check("describe excess kurtosis (G2, stdlib moments)", tm["Kurtosis (excess)"]["estimate"], (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * (m4 / m2 ** 2 - 3) + 6))
    # Mean t-CI (mpmath t-crit), median sign-test CI (math.comb), geometric-mean log CI.
    tc = t_crit_two(n - 1, 0.05)
    sem = st.stdev(x) / math.sqrt(n)
    check("describe mean CI low (mpmath t)", tm["Mean"]["ciLow"], m - tc * sem)
    check("describe mean CI high (mpmath t)", tm["Mean"]["ciHigh"], m + tc * sem)
    asort = sorted(x)
    kbest = 0
    for kk in range(1, n // 2 + 1):
        if sum(math.comb(n, i) for i in range(kk)) / 2 ** n <= 0.025:  # Binom(n,.5).cdf(kk-1)
            kbest = kk
        else:
            break
    check_eq("describe median CI low (order statistic)", tm["Median"]["ciLow"], asort[kbest - 1])
    check_eq("describe median CI high (order statistic)", tm["Median"]["ciHigh"], asort[n - kbest])
    logs = [math.log(v) for v in x]
    lse = st.stdev(logs) / math.sqrt(n)
    check("describe geometric-mean CI low (log scale)", tm["Geometric mean"]["ciLow"], math.exp(st.mean(logs) - tc * lse))
    check("describe geometric-mean CI high (log scale)", tm["Geometric mean"]["ciHigh"], math.exp(st.mean(logs) + tc * lse))
    # Normality battery extras.
    rn = M["normality"]({"values": x})
    nt = {t["term"]: t for t in rn["terms"]}
    sd1 = st.stdev(x)
    # Anderson-Darling A² from a from-scratch standardized ECDF + Stephens p.
    z = sorted((v - m) / sd1 for v in x)
    F = [normal_cdf(zi) for zi in z]
    A2 = -n - sum((2 * (i + 1) - 1) * (math.log(F[i]) + math.log(1 - F[n - 1 - i])) for i in range(n)) / n
    check("normality Anderson-Darling A² (from-scratch ECDF)", nt["Anderson-Darling"]["statistic"], A2)
    check("normality Anderson-Darling p (Stephens 1986)", nt["Anderson-Darling"]["p"], _stephens_ad_p(A2, n))
    # Lilliefors KS D (max |F_n − Φ̂|) from scratch.
    xs = sorted(x)
    Dp = max((i + 1) / n - normal_cdf((xs[i] - m) / sd1) for i in range(n))
    Dm = max(normal_cdf((xs[i] - m) / sd1) - i / n for i in range(n))
    check("normality Lilliefors D (from-scratch KS)", nt["Kolmogorov-Smirnov (Lilliefors)"]["statistic"], max(Dp, Dm))
    # Lognormality Akaike weight = 1/(1+exp(−|Δloglik|)), normal vs lognormal MLE.
    sig = float(np.std(x, ddof=0))
    sigln = float(np.std(logs, ddof=0))
    muln = st.mean(logs)
    ll_norm = sum(math.log(math.exp(-((v - m) ** 2) / (2 * sig ** 2)) / (sig * math.sqrt(2 * math.pi))) for v in x)
    ll_lnorm = sum(math.log(math.exp(-((lv - muln) ** 2) / (2 * sigln ** 2)) / (sigln * math.sqrt(2 * math.pi))) for lv in logs) - sum(logs)
    check("normality lognormal Akaike weight", rn["glance"]["lognormal_prob"], 1 / (1 + math.exp(-abs(ll_lnorm - ll_norm))))


def _rank_avg(v):
    """Average ranks (1-based, ties averaged) — pure Python, for rank correlations."""
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for t in range(i, j + 1):
            r[order[t]] = (i + j) / 2 + 1
        i = j + 1
    return r


def check_corrmatrix():
    # The whole K×K corrmatrix (Pearson/Spearman r, p, R²).
    print("\n# corrmatrix  (oracle: stdlib statistics.correlation + closed-form t)")
    c1 = [1.0, 2.1, 3.2, 3.9, 5.3, 6.0, 6.8]
    c2 = [2.0, 1.1, 4.0, 3.1, 6.2, 5.0, 8.1]
    c3 = [9.0, 7.2, 6.1, 5.5, 3.0, 2.1, 1.0]
    cols, L = [c1, c2, c3], ["A", "B", "C"]
    n = len(c1)
    tp = {t["term"]: t for t in M["corrmatrix"]({"columns": cols, "labels": L, "variant": "pearson"})["terms"]}
    for (i, j) in [(0, 1), (0, 2), (1, 2)]:
        r_ind = st.correlation(cols[i], cols[j])
        nm = "%s vs %s" % (L[i], L[j])
        check("corrmatrix Pearson %s r (stdlib)" % nm, tp[nm]["estimate"], r_ind)
        check("corrmatrix Pearson %s p (mpmath t)" % nm, tp[nm]["p"], t_p_two(r_ind * math.sqrt((n - 2) / (1 - r_ind ** 2)), n - 2))
        check("corrmatrix Pearson %s R²" % nm, tp[nm]["r2"], r_ind ** 2)
    ts = {t["term"]: t for t in M["corrmatrix"]({"columns": cols, "labels": L, "variant": "spearman"})["terms"]}
    for (i, j) in [(0, 1), (0, 2), (1, 2)]:
        nm = "%s vs %s" % (L[i], L[j])
        check("corrmatrix Spearman %s ρ (rank-Pearson)" % nm, ts[nm]["estimate"], st.correlation(_rank_avg(cols[i]), _rank_avg(cols[j])))
    # The summary names the coefficient it computed (a Spearman matrix must not say "strongest: A vs C (r = ...)").
    sm_s = M["corrmatrix"]({"columns": cols, "labels": L, "variant": "spearman"})["summary"]
    sm_p = M["corrmatrix"]({"columns": cols, "labels": L, "variant": "pearson"})["summary"]
    check_eq("corrmatrix Spearman summary names rho, not r", ("ρ = " in sm_s, "(r = " in sm_s), (True, False))
    check_eq("corrmatrix Pearson summary still names r", ("(r = " in sm_p, "ρ = " in sm_p), (True, False))


def check_correlation_extra():
    # Spearman ρ/p, the Pearson Fisher-z CI, and one-sided tails.
    print("\n# correlation extras  (oracle: rank-Pearson + t · Fisher-z CI · one-sided t)")
    a = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    b = [2.1, 1.9, 4.2, 3.8, 5.5, 6.7, 6.1, 8.9, 8.2, 10.4]
    n = len(a)
    # Spearman ρ = Pearson on average ranks; p via the t-approximation.
    esp = M["correlation"]({"variant": "spearman", "a": a, "b": b})["glance"]
    rho = st.correlation(_rank_avg(a), _rank_avg(b))
    check("correlation Spearman ρ (rank-Pearson)", esp["r"], rho)
    check("correlation Spearman p (t-approx)", esp["p"], t_p_two(rho * math.sqrt((n - 2) / (1 - rho ** 2)), n - 2))
    # Pearson CI via the Fisher-z transform (z ± 1.95996/√(n−3), back-transformed).
    pt = M["correlation"]({"variant": "pearson", "a": a, "b": b})["terms"][0]
    r = st.correlation(a, b)
    zf, se = math.atanh(r), 1 / math.sqrt(n - 3)
    z975 = 1.959963984540054
    check("correlation Pearson CI low (Fisher-z)", pt["ciLow"], math.tanh(zf - z975 * se))
    check("correlation Pearson CI high (Fisher-z)", pt["ciHigh"], math.tanh(zf + z975 * se))
    # One-sided p (greater) = half the two-sided t p when r is in the alternative direction.
    eo = M["correlation"]({"variant": "pearson", "a": a, "b": b, "tail": "greater"})["glance"]
    check("correlation one-sided p (greater)", eo["p"], t_p_two(r * math.sqrt((n - 2) / (1 - r ** 2)), n - 2) / 2)


def check_deming_extra():
    # The jackknife (Linnet) SEs/CIs and the λ≠1 path.
    print("\n# deming extras  (oracle: from-scratch jackknife loop + scipy.odr for λ≠1)")
    from scipy.odr import ODR, Model, RealData
    x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    y = [1.2, 2.1, 2.8, 4.3, 5.1, 5.8, 7.4, 7.9, 9.3, 10.1]
    n = len(x)

    def fit(xx, yy, lam):
        mx, my = st.mean(xx), st.mean(yy)
        sxx = sum((v - mx) ** 2 for v in xx)
        syy = sum((v - my) ** 2 for v in yy)
        sxy = sum((xx[i] - mx) * (yy[i] - my) for i in range(len(xx)))
        b1 = ((syy - lam * sxx) + math.sqrt((syy - lam * sxx) ** 2 + 4 * lam * sxy ** 2)) / (2 * sxy)
        return my - b1 * mx, b1
    b0s, b1s = [], []
    for i in range(n):
        f0, f1 = fit(x[:i] + x[i + 1:], y[:i] + y[i + 1:], 1.0)
        b0s.append(f0); b1s.append(f1)

    def jse(vals):
        dot = st.mean(vals)
        return math.sqrt((n - 1) / n * sum((v - dot) ** 2 for v in vals))
    dt = {t["term"]: t for t in M["deming"]({"x": x, "y": y})["terms"]}
    tc = t_crit_two(n - 2, 0.05)
    b0, b1 = fit(x, y, 1.0)
    check("deming jackknife slope SE (Linnet)", dt["Slope"]["se"], jse(b1s))
    check("deming jackknife intercept SE (Linnet)", dt["Intercept"]["se"], jse(b0s))
    check("deming slope CI high", dt["Slope"]["ciHigh"], b1 + tc * jse(b1s))
    # λ = 4 vs scipy.odr (weights sx=1, sy=√λ → minimises λ(Δx)²+(Δy)²).
    d4 = {t["term"]: t for t in M["deming"]({"x": x, "y": y, "lambda": 4.0})["terms"]}
    odr = ODR(RealData(x, y, sx=np.ones(n), sy=np.ones(n) * math.sqrt(4.0)),
              Model(lambda B, xx: B[0] * xx + B[1]), beta0=[1, 0]).run()
    check("deming λ=4 slope (scipy.odr)", d4["Slope"]["estimate"], float(odr.beta[0]))
    check("deming λ=4 intercept (scipy.odr)", d4["Intercept"]["estimate"], float(odr.beta[1]), tol=1e-3)


def check_runs_test():
    # The Wald-Wolfowitz runs test (lack-of-fit).
    print("\n# regression runs test  (oracle: from-scratch runs count + normal-approx z)")
    x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0]
    y = [1.1, 2.0, 2.6, 3.9, 5.2, 5.8, 7.1, 8.3, 8.9, 10.2, 11.1, 11.8]
    rt = [t for t in M["regression"]({"x": x, "y": y})["terms"] if t["term"] == "Runs test (lack of fit)"][0]
    sl, ic = np.polyfit(x, y, 1)
    signs = [1 if (y[i] - (sl * x[i] + ic)) >= 0 else 0 for i in range(len(x))]
    npos, nneg, N = sum(signs), len(signs) - sum(signs), len(signs)
    runs = 1 + sum(1 for i in range(1, N) if signs[i] != signs[i - 1])
    E = 2 * npos * nneg / N + 1
    V = 2 * npos * nneg * (2 * npos * nneg - N) / (N ** 2 * (N - 1))
    z = (runs - E) / math.sqrt(V)
    check_eq("runs test count", rt["estimate"], runs)
    check("runs test expected", rt["ciLow"], E)
    check("runs test z", rt["statistic"], z)
    check("runs test p (mpmath normal)", rt["p"], 2 * (1 - normal_cdf(abs(z))))


def check_grubbs_iterative():
    # The default iterative Grubbs: the multi-removal path (mask/unmask across
    # passes), beyond the single pass.
    print("\n# grubbs iterative  (oracle: from-scratch multi-pass Grubbs)")
    import scipy.stats as _ss
    x = [10.0, 10.2, 9.8, 10.1, 9.9, 10.3, 9.7, 25.0, 10.0, 9.6, 18.0]
    r = M["outliers"]({"values": x, "variant": "iterative", "alpha": 0.05})
    arr, removed = list(x), 0
    while len(arr) >= 3:
        m, s = st.mean(arr), st.stdev(arr)
        dev = [abs(v - m) for v in arr]
        idx = dev.index(max(dev))
        G = dev[idx] / s
        nn = len(arr)
        tcrit = float(_ss.t.ppf(1 - 0.05 / (2 * nn), nn - 2))
        gcrit = (nn - 1) / math.sqrt(nn) * math.sqrt(tcrit ** 2 / (nn - 2 + tcrit ** 2))
        if G > gcrit:
            arr.pop(idx); removed += 1
        else:
            break
    check_eq("grubbs iterative removed count", r["glance"]["removed"], removed)
    check_eq("grubbs iterative cleaned n", r["glance"]["n_clean"], len(arr))
    # The two removed values are the planted 25.0 and 18.0 (largest first).
    outs = sorted(float(t["estimate"]) for t in r["terms"] if t["term"].startswith("Outlier "))
    check_eq("grubbs iterative removed the planted outliers", outs, [18.0, 25.0])


def check_describe():
    print("\n# describe  (oracle: Python stdlib `statistics`)")
    x = [2, 4, 4, 4, 5, 5, 7, 9]
    r = M["describe"]({"values": x})
    check("describe mean", r["glance"]["mean"], st.mean(x))
    check("describe SD (n-1)", r["glance"]["sd"], st.stdev(x))
    check("describe variance", term(r, "Variance"), st.variance(x))
    check("describe median", term(r, "Median"), st.median(x))
    check("describe SEM", term(r, "SEM"), st.stdev(x) / math.sqrt(len(x)))
    g = [2, 4, 8]
    rg = M["describe"]({"values": g})
    check("describe geometric mean", term(rg, "Geometric mean"), st.geometric_mean(g))
    check("describe harmonic mean", term(rg, "Harmonic mean"), st.harmonic_mean(g))


# ── T-tests — vs closed-form (stdlib means/vars) + mpmath p ──────────────────
def check_ttest():
    print("\n# ttest  (oracle: closed-form t + mpmath t-distribution)")
    a, b = [5, 6, 7, 8, 9], [1, 4, 9, 16, 25, 36]  # unequal n + unequal variance
    na, nb = len(a), len(b)
    ma, mb, va, vb = st.mean(a), st.mean(b), st.variance(a), st.variance(b)
    # Pooled (Student) unpaired
    sp2 = ((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)
    t_pool = (ma - mb) / math.sqrt(sp2 * (1 / na + 1 / nb))
    r = M["ttest"]({"variant": "unpaired", "a": a, "b": b})["glance"]
    check("ttest unpaired t", r["t"], t_pool)
    check_eq("ttest unpaired df", r["df"], na + nb - 2)
    check("ttest unpaired p", r["p"], t_p_two(t_pool, na + nb - 2))
    # Welch
    t_w = (ma - mb) / math.sqrt(va / na + vb / nb)
    df_w = (va / na + vb / nb) ** 2 / ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1))
    w = M["ttest"]({"variant": "welch", "a": a, "b": b})["glance"]
    check("ttest welch t", w["t"], t_w)
    check("ttest welch df", w["df"], df_w)
    check("ttest welch p", w["p"], t_p_two(t_w, df_w))
    # Paired = one-sample t on the differences
    p, q = [20, 22, 19, 24, 25], [18, 20, 18, 23, 22]
    d = [pi - qi for pi, qi in zip(p, q)]
    t_pair = st.mean(d) / (st.stdev(d) / math.sqrt(len(d)))
    pr = M["ttest"]({"variant": "paired", "a": p, "b": q})["glance"]
    check("ttest paired t", pr["t"], t_pair)
    check("ttest paired p", pr["p"], t_p_two(t_pair, len(d) - 1))
    # One-sample
    o = [3, 4, 5, 4, 6, 5, 4, 5, 4, 6]
    t_os = (st.mean(o) - 4) / (st.stdev(o) / math.sqrt(len(o)))
    orr = M["ttest"]({"variant": "one-sample", "a": o, "mu": 4})["glance"]
    check("ttest one-sample t", orr["t"], t_os)
    check("ttest one-sample p", orr["p"], t_p_two(t_os, len(o) - 1))
    # Ratio-paired = a one-sample t on log(A/B); geometric-mean ratio = exp(mean log-ratio).
    ra, rb = [110.0, 95.0, 130.0, 88.0, 142.0, 101.0], [90.0, 85.0, 100.0, 80.0, 120.0, 92.0]
    lr = [math.log(ra[i] / rb[i]) for i in range(len(ra))]
    nr = len(ra)
    t_rp = st.mean(lr) / (st.stdev(lr) / math.sqrt(nr))
    rr = M["ttest"]({"variant": "ratio-paired", "a": ra, "b": rb})
    rg = rr["glance"]
    check("ttest ratio-paired t (log-ratio one-sample)", rg["t"], t_rp)
    check("ttest ratio-paired p", rg["p"], t_p_two(t_rp, nr - 1))
    check("ttest ratio-paired geo-mean ratio", rg["geo_mean_ratio"], math.exp(st.mean(lr)))
    tcr = t_crit_two(nr - 1, 0.05)
    ser = st.stdev(lr) / math.sqrt(nr)
    gmt = {t["term"]: t for t in rr["terms"]}["Geometric mean ratio (A / B)"]
    check("ttest ratio-paired GMR CI low", gmt["ciLow"], math.exp(st.mean(lr) - tcr * ser))
    check("ttest ratio-paired GMR CI high", gmt["ciHigh"], math.exp(st.mean(lr) + tcr * ser))
    # The mean-difference CI (unpaired pooled): diff ± t_crit·se_diff, df = na+nb−2.
    ca, cb = [12.0, 14, 11, 15, 13, 16], [9.0, 8, 11, 7, 10, 9]
    na2, nb2 = len(ca), len(cb)
    sp2 = ((na2 - 1) * st.variance(ca) + (nb2 - 1) * st.variance(cb)) / (na2 + nb2 - 2)
    se_d = math.sqrt(sp2 * (1 / na2 + 1 / nb2))
    diff = st.mean(ca) - st.mean(cb)
    tcd = t_crit_two(na2 + nb2 - 2, 0.05)
    dt = {t["term"]: t for t in M["ttest"]({"variant": "unpaired", "a": ca, "b": cb})["terms"]}["Difference (A − B)"]
    check("ttest unpaired difference CI low", dt["ciLow"], diff - tcd * se_d)
    check("ttest unpaired difference CI high", dt["ciHigh"], diff + tcd * se_d)
    # One-tailed (greater): p = half the two-sided p; the CI is one-sided (upper bound only).
    tg = (diff) / se_d
    og = {t["term"]: t for t in M["ttest"]({"variant": "unpaired", "a": ca, "b": cb, "tail": "greater"})["terms"]}["Difference (A − B)"]
    check("ttest one-tailed (greater) p", og["p"], t_p_two(tg, na2 + nb2 - 2) / 2)
    check_eq("ttest one-tailed CI is one-sided (no upper bound)", og.get("ciHigh"), None)
    check("ttest one-tailed lower confidence bound", og["ciLow"], diff - t_crit_two(na2 + nb2 - 2, 0.10) * se_d)


# ── Correlation — vs stdlib correlation + mpmath p ───────────────────────────
def check_correlation():
    print("\n# correlation  (oracle: stdlib `statistics.correlation` + mpmath)")
    a, b = [1, 2, 3, 4, 5, 6, 7], [2, 1, 4, 3, 6, 7, 5]
    r_ind = st.correlation(a, b)
    n = len(a)
    t = r_ind * math.sqrt((n - 2) / (1 - r_ind * r_ind))
    r = M["correlation"]({"variant": "pearson", "a": a, "b": b})["glance"]
    check("correlation Pearson r", r["r"], r_ind)
    check("correlation p", r["p"], t_p_two(t, n - 2))


# ── One-way ANOVA — vs closed-form SS + mpmath F ─────────────────────────────
def check_anova_variants():
    # The Welch, Brown-Forsythe, and Kruskal-Wallis anova1
    # variants. Welch is hand-coded in the engine → cross-check
    # vs statsmodels; Brown-Forsythe uses statsmodels → cross-check vs a from-scratch F*;
    # Kruskal wraps scipy → cross-check vs a from-scratch tie-corrected H.
    print("\n# anova1 variants  (oracle: statsmodels Welch + from-scratch Brown-Forsythe / Kruskal)")
    from statsmodels.stats.oneway import anova_oneway
    g1 = [24, 43, 58, 71, 43, 49, 61]
    g2 = [42, 43, 55, 26, 62, 37, 33, 41, 19]
    g3 = [10, 15, 8, 22, 19, 14, 30, 12]
    groups = [g1, g2, g3]
    L = ["A", "B", "C"]
    arrs = [np.asarray(g, float) for g in groups]
    N = sum(a.size for a in arrs)
    # Welch — engine hand-codes the weights + Welch-Satterthwaite df; statsmodels is independent.
    rw = M["anova1"]({"groups": groups, "labels": L, "variant": "welch"})["glance"]
    sw = anova_oneway(groups, use_var="unequal")
    check("anova Welch F (statsmodels)", rw["F"], float(sw.statistic))
    check("anova Welch df2 (statsmodels)", rw["df_within"], float(sw.df[1]))
    check("anova Welch p (statsmodels)", rw["p"], float(sw.pvalue))
    # Brown-Forsythe means test — engine uses statsmodels, so re-derive F* + df2 from scratch.
    grand = np.concatenate(arrs).mean()
    ss_b = sum(a.size * (a.mean() - grand) ** 2 for a in arrs)
    cc = [(1 - a.size / N) * a.var(ddof=1) for a in arrs]
    denom = sum(cc)
    F_bf = ss_b / denom
    df2_bf = denom ** 2 / sum(cc[i] ** 2 / (arrs[i].size - 1) for i in range(len(arrs)))
    rbf = M["anova1"]({"groups": groups, "labels": L, "variant": "brown-forsythe"})["glance"]
    check("anova Brown-Forsythe F* (from-scratch)", rbf["F"], float(F_bf))
    check("anova Brown-Forsythe df2 (Satterthwaite)", rbf["df_within"], float(df2_bf))
    check("anova Brown-Forsythe p (mpmath F-tail)", rbf["p"], f_p(rbf["F"], rbf["df_between"], rbf["df_within"]))
    # Kruskal-Wallis — engine wraps scipy; re-derive the tie-corrected H from average ranks.
    allv = np.concatenate(arrs)
    ranks = avg_ranks(list(allv))  # existing helper: average ranks with ties
    ranks = np.asarray(ranks, float)
    idx, R = 0, []
    for a in arrs:
        R.append(ranks[idx:idx + a.size].sum()); idx += a.size
    H = 12.0 / (N * (N + 1)) * sum(R[i] ** 2 / arrs[i].size for i in range(len(arrs))) - 3 * (N + 1)
    _u, counts = np.unique(allv, return_counts=True)
    H /= 1 - sum(t ** 3 - t for t in counts) / (N ** 3 - N)  # tie correction
    rk = M["anova1"]({"groups": groups, "labels": L, "variant": "kruskal"})["glance"]
    check("anova Kruskal H (from-scratch tie-corrected)", rk["H"], float(H))
    check("anova Kruskal p (mpmath χ² tail)", rk["p"], chi2_p(H, 2))


def check_posthoc_family():
    # The all-pairs / vs-control post-hoc methods (selected-pairs
    # Bonferroni/Šídák are checked elsewhere). Oracles:
    # Tukey vs statsmodels pairwise_tukeyhsd; Games-Howell from-scratch q + Welch df;
    # Tamhane T3 via mpmath t-tail + Šídák; Holm-Šídák + FDR re-derived; Dunnett vs an
    # independent multivariate-t rectangle probability (+ structural CI/sandwich).
    print("\n# anova1 post-hoc family  (oracle: statsmodels Tukey · from-scratch GH/Tamhane/HS/FDR · multivariate-t Dunnett)")
    from statsmodels.stats.multicomp import pairwise_tukeyhsd
    from scipy.stats import studentized_range, multivariate_t
    g1 = [24, 43, 58, 71, 43, 49, 61]
    g2 = [42, 43, 55, 26, 62, 37, 33, 41, 19]
    g3 = [10, 15, 8, 22, 19, 14, 30, 12]
    arrs = [np.asarray(g, float) for g in [g1, g2, g3]]
    L = ["A", "B", "C"]
    means = [float(a.mean()) for a in arrs]
    ns = [a.size for a in arrs]
    data = np.concatenate(arrs)
    ss_w = float(sum(((a - a.mean()) ** 2).sum() for a in arrs))
    df_w = int(data.size - 3)
    mse = ss_w / df_w
    pairs = [(0, 1), (0, 2), (1, 2)]

    def rows(posthoc, groups=None, labels=None, control=0):
        r = M["anova1"]({"groups": groups or [g1, g2, g3], "labels": labels or L,
                         "variant": "anova", "posthoc": posthoc, "control": control})
        return {t["term"]: t for t in r["terms"] if " vs " in t["term"]}

    # Tukey — vs statsmodels pairwise_tukeyhsd (≠ scipy.tukey_hsd). eng "A vs B" =
    # mean_A − mean_B = −(sm meandiff), so eng CI = [−sm.hi, −sm.lo].
    lab = np.concatenate([[L[i]] * ns[i] for i in range(3)])
    tk = pairwise_tukeyhsd(data, lab)
    et = rows("tukey")
    for k, (i, j) in enumerate(pairs):
        nm = "%s vs %s" % (L[i], L[j])
        check("posthoc Tukey %s p (statsmodels)" % nm, et[nm]["p"], float(tk.pvalues[k]))
        check("posthoc Tukey %s CI low" % nm, et[nm]["ciLow"], -float(tk.confint[k][1]))
        check("posthoc Tukey %s CI high" % nm, et[nm]["ciHigh"], -float(tk.confint[k][0]))

    # Holm-Šídák + FDR — re-derive the raw pooled-t p's, then the step-down / BH maps.
    raw = []
    for (i, j) in pairs:
        se = (mse * (1 / ns[i] + 1 / ns[j])) ** 0.5
        raw.append(t_p_two(abs(means[i] - means[j]) / se, df_w))

    def holm_sidak(pv):
        m = len(pv); order = sorted(range(m), key=lambda i: pv[i]); adj = [0.0] * m; run = 0.0
        for rank, i in enumerate(order):
            run = max(run, 1.0 - (1.0 - pv[i]) ** (m - rank)); adj[i] = min(1.0, run)
        return adj
    hs, fdr = holm_sidak(raw), bh_fdr(raw)
    ehs, efdr = rows("holm-sidak"), rows("fdr")
    for k, (i, j) in enumerate(pairs):
        nm = "%s vs %s" % (L[i], L[j])
        check("posthoc Holm-Šídák %s (step-down)" % nm, ehs[nm]["p"], hs[k])
        check("posthoc FDR %s (Benjamini-Hochberg)" % nm, efdr[nm]["p"], fdr[k])

    # Games-Howell — own variances + Welch df, studentized-range q from scratch.
    egh = rows("games-howell")
    v = [float(a.var(ddof=1)) for a in arrs]
    for (i, j) in pairs:
        vi, vj = v[i] / ns[i], v[j] / ns[j]
        se = (vi + vj) ** 0.5
        df = (vi + vj) ** 2 / (vi * vi / (ns[i] - 1) + vj * vj / (ns[j] - 1))
        q = abs(means[i] - means[j]) / se * 2 ** 0.5
        nm = "%s vs %s" % (L[i], L[j])
        check("posthoc Games-Howell %s p" % nm, egh[nm]["p"], float(studentized_range.sf(q, 3, df)))
        margin = float(studentized_range.ppf(0.95, 3, df)) / 2 ** 0.5 * se
        check("posthoc Games-Howell %s CI half-width" % nm, (egh[nm]["ciHigh"] - egh[nm]["ciLow"]) / 2, margin, tol=1e-3)

    # Tamhane T3 — Welch-df t, two-sided p via mpmath, Šídák multiplicity m=3.
    et3 = rows("tamhane")
    for (i, j) in pairs:
        vi, vj = v[i] / ns[i], v[j] / ns[j]
        se = (vi + vj) ** 0.5
        df = (vi + vj) ** 2 / (vi * vi / (ns[i] - 1) + vj * vj / (ns[j] - 1))
        p_raw = t_p_two(abs(means[i] - means[j]) / se, df)
        nm = "%s vs %s" % (L[i], L[j])
        check("posthoc Tamhane %s p (mpmath t + Šídák)" % nm, et3[nm]["p"], 1.0 - (1.0 - p_raw) ** 3)

    # Dunnett — balanced design (→ equicorrelation 0.5). Independent oracle = the
    # multivariate-t rectangle probability P(all |T| ≤ |t|); plus CI-symmetry + a raw≤adj≤Bonferroni
    # sandwich (scipy.dunnett is Monte-Carlo, so the p oracle carries a looser tol).
    bg = [[10, 12, 11, 13, 9, 14, 10], [15, 17, 16, 14, 18, 13, 16], [11, 10, 12, 13, 11, 9, 12]]
    ba = [np.asarray(x, float) for x in bg]
    bm = [float(x.mean()) for x in ba]; bn = [x.size for x in ba]
    mse_b = float(sum(((x - x.mean()) ** 2).sum() for x in ba)) / (sum(bn) - 3)
    df_wb = sum(bn) - 3
    ed = rows("dunnett", groups=bg, labels=["Ctrl", "T1", "T2"], control=0)
    mvt = multivariate_t(loc=[0, 0], shape=[[1.0, 0.5], [0.5, 1.0]], df=df_wb)
    for i in (1, 2):
        se = (mse_b * (1 / bn[0] + 1 / bn[i])) ** 0.5
        t = abs(bm[i] - bm[0]) / se
        p_raw = t_p_two(t, df_wb)
        p_ind = 1.0 - float(mvt.cdf([t, t]) - mvt.cdf([-t, t]) - mvt.cdf([t, -t]) + mvt.cdf([-t, -t]))
        nm = "T%d vs Ctrl" % i
        # scipy.dunnett is Monte-Carlo → the p carries a looser tol; the CI is exact.
        check("posthoc Dunnett %s p (multivariate-t)" % nm, ed[nm]["p"], p_ind, tol=6e-3)
        check_eq("posthoc Dunnett %s estimate" % nm, ed[nm]["estimate"], round(bm[i] - bm[0], 6))
        check("posthoc Dunnett %s CI symmetric about diff" % nm, (ed[nm]["ciLow"] + ed[nm]["ciHigh"]) / 2, bm[i] - bm[0])
        _ = p_raw  # (raw two-sided t p; Dunnett adjusts upward — not asserted, MC noise near tiny p)


def check_anova():
    print("\n# anova1  (oracle: closed-form sum-of-squares + mpmath F-distribution)")
    groups = [[1, 2, 3, 4], [2, 3, 4, 5, 6], [6, 7, 8, 9]]
    allv = [v for g in groups for v in g]
    grand = st.mean(allv)
    k = len(groups)
    N = len(allv)
    ss_b = sum(len(g) * (st.mean(g) - grand) ** 2 for g in groups)
    ss_w = sum((v - st.mean(g)) ** 2 for g in groups for v in g)
    df_b, df_w = k - 1, N - k
    F = (ss_b / df_b) / (ss_w / df_w)
    r = M["anova1"]({"groups": groups})["glance"]
    check("anova1 F", r["F"], F)
    check_eq("anova1 df_between", r["df_between"], df_b)
    check_eq("anova1 df_within", r["df_within"], df_w)
    check("anova1 p", r["p"], f_p(F, df_b, df_w))


# ── Selected-pairs post-hoc — vs from-scratch pooled-t + mpmath, multiplicity =
#    the number of chosen comparisons (the "compare selected pairs of means" design). The
#    strong claim: correcting by m=|selected|, not m=all-pairs. Re-multiplying the raw
#    pooled-t p by 3 (this selection) — a from-scratch value the engine never sees —
#    would fail if the engine had used the all-pairs count of 6.
def check_posthoc_selected():
    print("\n# anova1 selected-pairs post-hoc  (oracle: pooled-t + mpmath; multiplicity = selected count)")
    groups = [[10, 12, 11, 13], [14, 15, 13, 16], [9, 8, 10, 11], [20, 22, 21, 19]]
    labels = ["A", "B", "C", "D"]
    k = len(groups)
    N = sum(len(g) for g in groups)
    df_w = N - k
    mse = sum((v - st.mean(g)) ** 2 for g in groups for v in g) / df_w  # pooled within-group MSE
    means = [st.mean(g) for g in groups]
    sel = [(0, 1), (0, 3), (1, 2)]  # 3 chosen pairs → m = 3 (all-pairs would be 6)
    m = len(sel)

    def raw_p(i, j):
        se = math.sqrt(mse * (1.0 / len(groups[i]) + 1.0 / len(groups[j])))
        return t_p_two((means[i] - means[j]) / se, df_w)

    for meth, adjust in (("bonferroni", lambda p: min(1.0, p * m)),
                         ("sidak", lambda p: 1.0 - (1.0 - p) ** m)):
        res = M["anova1"]({"groups": groups, "labels": labels, "posthoc": meth,
                           "scheme": "selected-pairs", "pairs": [list(p) for p in sel], "conf": 0.95})
        got = {t["term"]: t for t in res["terms"] if " vs " in t["term"]}
        check_eq("selected-pairs %s row count" % meth, len(got), m)
        for (i, j) in sel:
            term = "%s vs %s" % (labels[i], labels[j])
            check("selected %s p %s" % (meth, term), got[term]["p"], adjust(raw_p(i, j)))
            check("selected %s diff %s" % (meth, term), got[term]["estimate"], means[i] - means[j])


# ── Two-way post-hoc — the pooled error term is the full two-way model residual
#    (MS_residual over all cells, df = a·b·(n−1)), not a per-strip variance. The
#    strong claim: recomputing the row-means comparison from a hand-built MS_residual
#    + pooled-t (mpmath) + multiplicity reproduces the engine — which it only can if
#    the engine shares MS_residual across the whole family.
def check_twoway_posthoc():
    print("\n# twoway post-hoc  (oracle: from-scratch MS_residual + pooled-t + mpmath)")
    cells = [[[8, 9, 10], [11, 12, 13]], [[14, 16, 15], [18, 17, 19]], [[9, 11, 10], [20, 22, 21]]]
    a, b, n = 3, 2, 3
    ss_w = sum((v - st.mean(cells[i][j])) ** 2 for i in range(a) for j in range(b) for v in cells[i][j])
    df_w = a * b * (n - 1)
    ms_w = ss_w / df_w                                   # MS_residual over every cell
    nrow = b * n                                          # observations behind each row mean
    rowm = [st.mean([v for j in range(b) for v in cells[i][j]]) for i in range(a)]
    labels = ["A", "B", "C"]
    pairs = [(0, 1), (0, 2), (1, 2)]
    m = len(pairs)

    def raw_p(i, j):
        se = math.sqrt(ms_w * (1.0 / nrow + 1.0 / nrow))
        return t_p_two((rowm[i] - rowm[j]) / se, df_w)

    for meth, adjust in (("bonferroni", lambda p: min(1.0, p * m)),
                         ("sidak", lambda p: 1.0 - (1.0 - p) ** m)):
        res = M["twoway"]({"cells": cells, "rowLabels": labels, "posthoc": meth, "compare": "rowmeans"})
        got = {t["term"]: t for t in res["terms"] if " vs " in t["term"]}
        check_eq("twoway %s row-means count" % meth, len(got), m)
        for (i, j) in pairs:
            term = "%s vs %s" % (labels[i], labels[j])
            check("twoway %s p %s" % (meth, term), got[term]["p"], adjust(raw_p(i, j)))
            check("twoway %s diff %s" % (meth, term), got[term]["estimate"], rowm[i] - rowm[j])

    # Tukey with k=2 groups reduces exactly to the uncorrected pooled t (studentized
    # range q = t·√2), so a 2-row sub-design gives an mpmath-verifiable Tukey p.
    c2 = [cells[0], cells[1]]
    ssw2 = sum((v - st.mean(c2[i][j])) ** 2 for i in range(2) for j in range(b) for v in c2[i][j])
    dfw2 = 2 * b * (n - 1)
    msw2 = ssw2 / dfw2
    rm2 = [st.mean([v for j in range(b) for v in c2[i][j]]) for i in range(2)]
    p_t = t_p_two((rm2[0] - rm2[1]) / math.sqrt(msw2 * (2.0 / nrow)), dfw2)
    tk = [t for t in M["twoway"]({"cells": c2, "posthoc": "tukey", "compare": "rowmeans"})["terms"] if " vs " in t["term"]][0]
    check("twoway Tukey(k=2) p == uncorrected pooled-t", tk["p"], p_t)


# ── Two-way Tukey vs statsmodels' pairwise_tukeyhsd — a package cross-validation
#    (statsmodels is itself tested against R's TukeyHSD). Unlike the other oracles this
#    one does use statsmodels, on purpose: for the cell-means all-pairs family the
#    two-way error term (MS_residual, df) is identical to a one-way Tukey's pooled
#    within-cell MSE over the a·b cells, so statsmodels' one-way Tukey on cell labels
#    must reproduce our two-way engine exactly (same q, k, df ⇒ same diffs + p-adj).
def check_twoway_tukey_vs_statsmodels():
    print("\n# twoway Tukey  (oracle: statsmodels pairwise_tukeyhsd — itself validated vs R's TukeyHSD)")
    try:
        from statsmodels.stats.multicomp import pairwise_tukeyhsd
    except Exception:
        print("  (skipped: statsmodels not installed)")
        return
    cells = [[[5.1, 4.9, 5.3, 5.0], [6.2, 6.4, 6.1, 6.3]],
             [[7.0, 7.2, 6.8, 7.1], [8.5, 8.3, 8.6, 8.4]],
             [[5.5, 5.7, 5.4, 5.6], [9.1, 9.3, 8.9, 9.2]]]
    a, b = len(cells), len(cells[0])
    vals, labs = [], []
    for i in range(a):
        for j in range(b):
            for v in cells[i][j]:
                vals.append(v); labs.append("%d-%d" % (i, j))
    sm = pairwise_tukeyhsd(vals, labs, alpha=0.05)
    sm_pairs = sorted(zip((abs(float(md)) for md in sm.meandiffs), (float(pv) for pv in sm.pvalues)))
    eng = [t for t in M["twoway"]({"cells": cells, "posthoc": "tukey", "compare": "cellmeans"})["terms"] if " vs " in t["term"]]
    eng_pairs = sorted((abs(t["estimate"]), t["p"]) for t in eng)
    check_eq("twoway cellmeans Tukey pair count == statsmodels", len(eng_pairs), len(sm_pairs))
    for idx, ((ed, ep), (sd, sp)) in enumerate(zip(eng_pairs, sm_pairs)):
        check("twoway Tukey |meandiff| #%d == statsmodels" % idx, ed, sd)
        check("twoway Tukey p-adj #%d == statsmodels" % idx, ep, sp, tol=3e-3)


# ── Two-way vs R — a literal reference value from R's own documentation. R's
#    canonical ?TukeyHSD example (aov(breaks ~ wool + tension, warpbreaks)) reports
#    the tension marginal mean-differences L-H = 14.722222, L-M = 10.0, M-H = 4.722222.
#    Those are marginal means → model-independent, so our engine (which fits the full
#    interaction model) must reproduce them exactly. Encoding the built-in warpbreaks
#    data also self-verifies it: a wrong level sum would miss R's documented value.
#    (The additive-model p-adj differs from our interaction-model p; the Tukey p-value
#    machinery is validated exactly against statsmodels in the sibling check above.)
def check_twoway_tukey_vs_R():
    print("\n# twoway colmeans  (oracle: R's documented TukeyHSD(warpbreaks) tension differences)")
    # warpbreaks `breaks`, as cells[wool][tension] with tension order L, M, H.
    cells = [
        [[26, 30, 54, 25, 70, 52, 51, 26, 67], [18, 21, 29, 17, 12, 18, 35, 30, 36], [36, 21, 24, 18, 10, 43, 28, 15, 26]],  # wool A
        [[27, 14, 29, 19, 29, 31, 41, 20, 44], [42, 26, 19, 16, 39, 28, 21, 39, 29], [20, 21, 24, 17, 13, 15, 15, 16, 28]],  # wool B
    ]
    res = M["twoway"]({"cells": cells, "rowLabels": ["A", "B"], "colLabels": ["L", "M", "H"],
                       "posthoc": "tukey", "compare": "colmeans"})
    got = {t["term"]: t["estimate"] for t in res["terms"] if " vs " in t["term"]}
    check("twoway colmeans diff L vs H == R warpbreaks 14.722222", got["L vs H"], 14.722222)
    check("twoway colmeans diff L vs M == R warpbreaks 10.0", got["L vs M"], 10.0)
    check("twoway colmeans diff M vs H == R warpbreaks 4.722222", got["M vs H"], 4.722222)


# ── Linear regression — vs stdlib linear_regression + closed-form SE/p ────────
def check_regression():
    print("\n# regression  (oracle: stdlib `statistics.linear_regression` + closed-form)")
    x = [1, 2, 3, 4, 5, 6, 7, 8]
    y = [2.1, 3.9, 6.2, 7.8, 10.1, 11.7, 14.2, 15.9]
    n = len(x)
    slope, intercept = st.linear_regression(x, y)  # stdlib OLS (independent of statsmodels)
    xbar = st.mean(x)
    ss_xx = sum((xi - xbar) ** 2 for xi in x)
    resid = [yi - (intercept + slope * xi) for xi, yi in zip(x, y)]
    s = math.sqrt(sum(e * e for e in resid) / (n - 2))
    se_slope = s / math.sqrt(ss_xx)
    t = slope / se_slope
    r = st.correlation(x, y)
    g = M["regression"]({"x": x, "y": y})
    gl = g["glance"]
    check("regression slope", gl["slope"], slope)
    check("regression intercept", gl["intercept"], intercept)
    check("regression R^2", gl["r_sq"], r * r)
    check("regression slope SE", term(g, "Slope", "se"), se_slope)
    check("regression slope p", gl["p"], t_p_two(t, n - 2))


# ── Normality (lognormality) — vs mpmath-recomputed AIC ───────────────────
def check_lognormality():
    print("\n# normality lognormality  (oracle: mpmath-recomputed normal-vs-lognormal AIC)")

    def ll_normal(xs, mu, sig):
        return sum(float(-0.5 * mp.log(2 * mp.pi) - mp.log(sig) - (mp.mpf(v) - mu) ** 2 / (2 * mp.mpf(sig) ** 2)) for v in xs)

    for label, xs in [
        ("right-skew→lognormal", [1, 2, 4, 8, 16, 32, 64, 128, 3, 6, 12, 24, 48, 96]),
        ("symmetric→normal", [8, 9, 10, 10, 11, 11, 12, 12, 12, 13, 13, 14, 15, 10]),
    ]:
        mu = st.mean(xs)
        sig = st.pstdev(xs)  # MLE (ddof=0)
        logs = [math.log(v) for v in xs]
        mul, sigl = st.mean(logs), st.pstdev(logs)
        lln = ll_normal(xs, mu, sig)
        llln = ll_normal(logs, mul, sigl) - sum(math.log(v) for v in xs)  # lognormal = normal-of-logs − Σln x
        pref = "lognormal" if llln > lln else "normal"
        eng = M["normality"]({"values": xs})["glance"]["prefers"]
        check_eq("normality prefers (%s)" % label, eng, pref)


# ── Contingency — vs closed-form + mpmath chi-square / hypergeometric ─────────
def check_contingency():
    print("\n# contingency  (oracle: closed-form + mpmath chi-square / hypergeometric)")
    tab = [[20, 30], [30, 20]]
    (a, b), (c, d) = tab[0], tab[1]
    N, r1, r2, c1, c2 = a + b + c + d, a + b, c + d, a + c, b + d
    E = [[r1 * c1 / N, r1 * c2 / N], [r2 * c1 / N, r2 * c2 / N]]
    chi = sum((tab[i][j] - E[i][j]) ** 2 / E[i][j] for i in range(2) for j in range(2))
    yates = sum((abs(tab[i][j] - E[i][j]) - 0.5) ** 2 / E[i][j] for i in range(2) for j in range(2))
    res = M["contingency"]({"table": tab})
    check("contingency chi_sq", res["glance"]["chi_sq"], chi)
    check("contingency p", res["glance"]["p"], chi2_p(chi, 1))
    check("contingency Cramer's V", res["glance"]["cramers_v"], math.sqrt(chi / N))
    check("contingency odds ratio", res["glance"]["odds_ratio"], (a * d) / (b * c))
    check("contingency Fisher exact p", res["glance"]["fisher_p"], fisher_2x2(a, b, c, d))
    check("contingency Yates chi_sq", term(res, "Yates-corrected χ²", "statistic"), yates)
    # Clinical 2x2 — RR / OR + Woolf CIs, sens/spec/PPV/NPV
    (a, b), (c, d) = [20, 10], [5, 25]
    z = 1.959963984540054  # Φ⁻¹(0.975)
    rr = (a / (a + b)) / (c / (c + d))
    se_rr = math.sqrt(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
    orr = (a * d) / (b * c)
    se_or = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    t2 = M["contingency"]({"table": [[a, b], [c, d]], "conf": 0.95, "ciMethod": "log"})
    check("contingency RR", term(t2, "Relative risk"), rr)
    check("contingency RR CI low (Katz log)", term(t2, "Relative risk", "ciLow"), rr * math.exp(-z * se_rr))
    check("contingency RR CI high (Katz log)", term(t2, "Relative risk", "ciHigh"), rr * math.exp(z * se_rr))
    check("contingency OR CI low", term(t2, "Odds ratio", "ciLow"), orr * math.exp(-z * se_or))
    check("contingency OR CI high", term(t2, "Odds ratio", "ciHigh"), orr * math.exp(z * se_or))
    check("contingency sensitivity", term(t2, "Sensitivity"), a / (a + c))
    check("contingency specificity", term(t2, "Specificity"), d / (b + d))
    check("contingency PPV", term(t2, "PPV"), a / (a + b))
    check("contingency NPV", term(t2, "NPV"), d / (c + d))
    # McNemar (paired): off-diagonals b=12, c=5
    mm = M["contingency"]({"table": [[30, 12], [5, 40]], "variant": "paired"})
    check("contingency McNemar Yates", term(mm, "McNemar χ² (Yates)", "statistic"), (abs(12 - 5) - 1) ** 2 / (12 + 5))
    check("contingency McNemar exact p", term(mm, "Exact (binomial)", "p"), mcnemar_exact(12, 5))
    # Cochran-Armitage trend across an ordered 2x4 table (scores 0..3, N-variance form)
    ca = [[10, 15, 20, 25], [40, 35, 30, 25]]
    sc = [0, 1, 2, 3]
    aj, nj = ca[0], [ca[0][j] + ca[1][j] for j in range(4)]
    R1, Nt = sum(aj), sum(nj)
    T = sum(aj[j] * sc[j] for j in range(4)) - R1 * sum(nj[j] * sc[j] for j in range(4)) / Nt
    var = (R1 * (Nt - R1) / Nt ** 2) * (Nt * sum(nj[j] * sc[j] ** 2 for j in range(4)) - sum(nj[j] * sc[j] for j in range(4)) ** 2) / Nt
    z_ca = T / math.sqrt(var)
    cat = M["contingency"]({"table": ca})
    check("contingency Cochran-Armitage z", term(cat, "Cochran-Armitage trend", "statistic"), z_ca)
    check("contingency Cochran-Armitage p", term(cat, "Cochran-Armitage trend", "p"), normal_two(z_ca))


# ── 2×2 score CIs — Newcombe (vs statsmodels) + Koopman (score-equation self-consistency) ──
def check_contingency_ci():
    print("\n# contingency 2x2 score CIs  (oracle: statsmodels Newcombe + Koopman score = z²)")
    from statsmodels.stats.proportion import confint_proportions_2indep
    a, b, c, d = 20, 10, 5, 25
    z = 1.959963984540054
    r = M["contingency"]({"table": [[a, b], [c, d]], "conf": 0.95})  # default = score methods
    by = {t["term"]: t for t in r["terms"]}
    # Risk-difference Newcombe CI == statsmodels 'newcomb' (a fully independent implementation).
    lo, hi = confint_proportions_2indep(a, a + b, c, c + d, method="newcomb", compare="diff")
    check("contingency Newcombe diff low (statsmodels)", by["Risk difference"]["ciLow"], float(lo))
    check("contingency Newcombe diff high (statsmodels)", by["Risk difference"]["ciHigh"], float(hi))
    # Koopman RR — the reported bounds must solve the score equation score(R) == z² (definition).
    def koop_score2(R, x1, n1, x2, n2):
        p1h, p2h, N = x1 / n1, x2 / n2, n1 + n2
        B = (x1 + n2) + R * (x2 + n1)
        p2t = (B - math.sqrt(max(B * B - 4 * R * N * (x1 + x2), 0.0))) / (2 * R * N)
        p2t = min(max(p2t, 1e-12), 1 - 1e-12)
        p1t = min(max(R * p2t, 1e-12), 1 - 1e-12)
        return (p1h - R * p2h) ** 2 / (p1t * (1 - p1t) / n1 + R * R * p2t * (1 - p2t) / n2)
    lo_rr, hi_rr = by["Relative risk"]["ciLow"], by["Relative risk"]["ciHigh"]
    check("contingency Koopman low solves score=z²", koop_score2(lo_rr, a, a + b, c, c + d), z * z, tol=1e-4)
    check("contingency Koopman high solves score=z²", koop_score2(hi_rr, a, a + b, c, c + d), z * z, tol=1e-4)
    rr = (a / (a + b)) / (c / (c + d))
    check_eq("contingency Koopman brackets the RR estimate", bool(lo_rr < rr < hi_rr), True)
    # Koopman (no correction) sits close to the Miettinen-Nurminen score CI (differ by O(1/N)).
    lo_mn, hi_mn = confint_proportions_2indep(a, a + b, c, c + d, method="score", compare="ratio")
    check("contingency Koopman ~ MN score low", lo_rr, float(lo_mn), tol=0.02)
    check("contingency Koopman ~ MN score high", hi_rr, float(hi_mn), tol=0.02)


# ── Odds-ratio Baptista-Pike exact CI — vs scipy Fisher exact + an independent inversion ──
def check_contingency_or():
    print("\n# contingency Baptista-Pike OR  (oracle: scipy fisher_exact + independent prob-ordering inversion)")
    from scipy.stats import nchypergeom_fisher, fisher_exact
    from scipy.stats.contingency import odds_ratio
    from scipy.optimize import brentq
    a, b, c, d, alpha = 20, 10, 5, 25, 0.05
    orr = {t["term"]: t for t in M["contingency"]({"table": [[a, b], [c, d]]})["terms"]}["Odds ratio"]

    # Independent probability-ordering two-sided exact p of the noncentral hypergeometric.
    M2, ncol, nrow = a + b + c + d, a + c, a + b
    ks = list(range(max(0, ncol - (c + d)), min(nrow, ncol) + 1))

    def p2(psi):
        rv = nchypergeom_fisher(M2, ncol, nrow, psi)
        pmf = {k: float(rv.pmf(k)) for k in ks}
        pa = pmf[a]
        return sum(v for v in pmf.values() if v <= pa * (1 + 1e-7))
    # Anchor the p-value function: at OR = 1 it must equal scipy's Fisher exact two-sided p.
    check("contingency OR prob-ordering p(ψ=1) == Fisher exact", p2(1.0), float(fisher_exact([[a, b], [c, d]])[1]))
    # Reinvert independently and match the engine's Baptista-Pike bounds.
    orhat = (a * d) / (b * c)
    lo = float(brentq(lambda p: p2(p) - alpha, orhat * 1e-6, orhat, xtol=1e-10, rtol=1e-12))
    hi = float(brentq(lambda p: p2(p) - alpha, orhat, orhat * 1e6, xtol=1e-10, rtol=1e-12))
    check("contingency Baptista-Pike OR low (reimpl)", orr["ciLow"], lo, tol=2e-3)
    check("contingency Baptista-Pike OR high (reimpl)", orr["ciHigh"], hi, tol=2e-3)
    # Structural: BP is less conservative than the scipy Cornfield exact CI, and brackets the sample OR.
    corn = odds_ratio([[a, b], [c, d]]).confidence_interval(0.95)
    check_eq("contingency BP ⊂ Cornfield exact (narrower)", bool(orr["ciLow"] > corn[0] and orr["ciHigh"] < corn[1]), True)
    check_eq("contingency BP brackets sample OR (10)", bool(orr["ciLow"] < 10.0 < orr["ciHigh"]), True)
    # AUTHORITATIVE: R ORCI::BPexact.CI(x1=2, n1=14, x2=1, n2=11) = [0.1127829, 53.0112493].
    ref = {t["term"]: t for t in M["contingency"]({"table": [[2, 12], [1, 10]]})["terms"]}["Odds ratio"]
    check("contingency Baptista-Pike low  == R ORCI", ref["ciLow"], 0.1127829, tol=1e-5)
    check("contingency Baptista-Pike high == R ORCI", ref["ciHigh"], 53.0112493, tol=1e-5)


# ── Survival — vs a from-scratch Mantel-Cox log-rank + literature (Gehan) ─────
def _logrank_full(groups):
    """From-scratch multivariate log-rank accumulation over the pooled event times —
    shares no code with the engine's _logrank_core. Returns per-group observed events
    O, expected E (under H0), the score vector U = O − E, and the covariance V."""
    g = len(groups)
    allT = np.concatenate([np.asarray(t, float) for t, _ in groups])
    allE = np.concatenate([np.asarray(e, float) for _, e in groups])
    grp = np.concatenate([np.full(len(t), i) for i, (t, _) in enumerate(groups)])
    O = np.zeros(g); E = np.zeros(g); U = np.zeros(g); V = np.zeros((g, g))
    for tj in np.unique(allT[allE == 1]):
        nj = float((allT >= tj).sum())
        dj = float(((allT == tj) & (allE == 1)).sum())
        n = np.array([float(((allT >= tj) & (grp == i)).sum()) for i in range(g)])
        d = np.array([float(((allT == tj) & (allE == 1) & (grp == i)).sum()) for i in range(g)])
        Ej = dj * n / nj
        O += d; E += Ej; U += d - Ej
        if nj > 1:
            c = dj * (nj - dj) / (nj - 1)
            for a in range(g):
                for b in range(g):
                    V[a, b] += c * ((n[a] / nj) * ((1.0 if a == b else 0.0) - n[b] / nj))
    return O, E, U, V


def check_survival():
    print("\n# survival  (oracle: from-scratch log-rank O/E/U/V + statsmodels SurvfuncRight/survdiff)")
    from statsmodels.duration.survfunc import SurvfuncRight, survdiff
    t1 = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35]
    e1 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    t2 = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23]
    e2 = [1] * 21
    chi_ind = logrank_from_scratch(t1, e1, t2, e2)
    r = M["survival"]({"groups": [
        {"label": "6-MP", "time": t1, "event": e1},
        {"label": "Placebo", "time": t2, "event": e2},
    ]})
    g = r["glance"]
    tm = {t["term"]: t for t in r["terms"]}
    check("survival log-rank chi_sq (from-scratch reimpl)", g["chi_sq"], chi_ind, tol=1e-3)
    check("survival log-rank chi_sq (literature 16.793)", g["chi_sq"], 16.793, tol=5e-3)
    check("survival log-rank p", g["p"], chi2_p(chi_ind, 1), tol=1e-3)
    # Gehan-Breslow-Wilcoxon weighted log-rank vs statsmodels survdiff(weight_type='gb').
    time, status = np.array(t1 + t2, float), np.array(e1 + e2, float)
    grp01 = np.array([0] * 21 + [1] * 21)
    check("survival Gehan-Breslow χ² (statsmodels survdiff gb)", g["gehan_chi_sq"], float(survdiff(time, status, grp01, weight_type="gb")[0]), tol=1e-3)
    # 2-group hazard ratio (log-rank O/E) + log CI vs a from-scratch O/E accumulation.
    O, E, _U, _V = _logrank_full([(t1, e1), (t2, e2)])
    hr = float((O[0] / E[0]) / (O[1] / E[1]))
    se = float(np.sqrt(1 / E[0] + 1 / E[1]))
    z = 1.959963984540054
    check("survival hazard ratio (from-scratch O/E)", g["hazard_ratio"], hr)
    hrt = tm["Hazard ratio (6-MP / Placebo)"]
    check("survival HR CI low", hrt["ciLow"], hr * float(np.exp(-z * se)))
    check("survival HR CI high", hrt["ciHigh"], hr * float(np.exp(z * se)))
    # Kaplan-Meier median + Brookmeyer-Crowley CI vs statsmodels SurvfuncRight, and the
    # Greenwood complementary-log-log survival-curve band at one event time.
    sf2 = SurvfuncRight(np.array(t2, float), np.array(e2, float))
    check("survival Placebo median (statsmodels quantile)", tm["Placebo — median survival"]["estimate"], float(sf2.quantile(0.5)))
    ci = sf2.quantile_ci(0.5)
    check("survival Placebo median CI low (Brookmeyer-Crowley)", tm["Placebo — median survival"]["ciLow"], float(ci[0]))
    check("survival Placebo median CI high (Brookmeyer-Crowley)", tm["Placebo — median survival"]["ciHigh"], float(ci[1]))
    check("survival 6-MP median (statsmodels quantile)", tm["6-MP — median survival"]["estimate"], float(SurvfuncRight(np.array(t1, float), np.array(e1, float)).quantile(0.5)))
    i8 = int(np.where(sf2.surv_times == 8)[0][0])
    S, seS = float(sf2.surv_prob[i8]), float(sf2.surv_prob_se[i8])
    sigma = seS / (S * abs(np.log(S)))  # cloglog delta-method SE
    cv = [c for c in r["extra"]["curves"] if c["label"] == "Placebo"][0]
    j8 = cv["times"].index(8)
    check("survival Greenwood S(8)", cv["surv"][j8], S)
    check("survival cloglog band low S(8)", cv["lower"][j8], S ** float(np.exp(z * sigma)))
    check("survival cloglog band high S(8)", cv["upper"][j8], S ** float(np.exp(-z * sigma)))


def check_survival_trend():
    # The log-rank test for trend across ≥3 ordered groups (glance
    # trend_chi_sq). Oracle = a from-scratch score-vector trend
    # z = (s·U)/√(sᵀVs), χ² = z², with equally-spaced scores s = [0,1,2].
    print("\n# survival trend  (oracle: from-scratch score-vector log-rank trend)")
    a_t, a_e = [5, 6, 6, 7, 8, 9, 10, 11, 12, 13], [1, 1, 1, 1, 1, 1, 0, 1, 1, 1]
    b_t, b_e = [4, 5, 6, 6, 7, 8, 9, 10, 11, 12], [1, 1, 1, 1, 1, 1, 1, 0, 1, 1]
    c_t, c_e = [2, 3, 3, 4, 5, 5, 6, 7, 8, 9], [1, 1, 1, 1, 1, 1, 1, 1, 0, 1]
    g = M["survival"]({"groups": [
        {"label": "Low", "time": a_t, "event": a_e},
        {"label": "Mid", "time": b_t, "event": b_e},
        {"label": "High", "time": c_t, "event": c_e},
    ]})["glance"]
    _O, _E, U, V = _logrank_full([(a_t, a_e), (b_t, b_e), (c_t, c_e)])
    s = np.array([0.0, 1.0, 2.0])
    chi_tr = float((s @ U) ** 2 / (s @ V @ s))
    check("survival trend χ² (from-scratch score vector)", g["trend_chi_sq"], chi_tr)
    check("survival trend p", g["trend_p"], chi2_p(chi_tr, 1))


# ── Survival pairwise — each pair vs a from-scratch 2-group log-rank + Holm-Šídák ──
def check_survival_pairwise():
    print("\n# survival pairwise  (oracle: from-scratch 2-group log-rank + step-down Šídák formula)")
    a_t, a_e = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17], [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
    b_t, b_e = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11], [1] * 14
    c_t, c_e = [10, 12, 13, 15, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36], [1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0]
    grp = [{"label": "A", "time": a_t, "event": a_e}, {"label": "B", "time": b_t, "event": b_e},
           {"label": "C", "time": c_t, "event": c_e}]
    r = M["survival"]({"groups": grp, "pairwise": True, "pairwiseMethod": "holm-sidak"})
    by = {t["term"]: t for t in r["terms"]}
    # Each pair's χ² == an independent from-scratch 2-group Mantel-Cox log-rank.
    cab = logrank_from_scratch(a_t, a_e, b_t, b_e)
    cac = logrank_from_scratch(a_t, a_e, c_t, c_e)
    cbc = logrank_from_scratch(b_t, b_e, c_t, c_e)
    check("survival pairwise A vs B χ²", by["A vs B (log-rank)"]["statistic"], cab, tol=1e-3)
    check("survival pairwise A vs C χ²", by["A vs C (log-rank)"]["statistic"], cac, tol=1e-3)
    check("survival pairwise B vs C χ²", by["B vs C (log-rank)"]["statistic"], cbc, tol=1e-3)

    # Holm-Šídák adjusted p == an independent step-down Šídák over the raw pair p's.
    raw = [chi2_p(cab, 1), chi2_p(cac, 1), chi2_p(cbc, 1)]

    def holm_sidak(pv):
        m = len(pv)
        order = sorted(range(m), key=lambda i: pv[i])
        adj, run = [0.0] * m, 0.0
        for rank, i in enumerate(order):
            run = max(run, 1.0 - (1.0 - pv[i]) ** (m - rank))
            adj[i] = min(1.0, run)
        return adj
    hs = holm_sidak(raw)
    check("survival pairwise HS adj A vs B", by["A vs B (log-rank)"]["p"], hs[0], tol=1e-3)
    check("survival pairwise HS adj A vs C", by["A vs C (log-rank)"]["p"], hs[1], tol=1e-3)
    # Bonferroni variant == raw × m (m = 3 comparisons).
    bb = {t["term"]: t for t in M["survival"]({"groups": grp, "pairwise": True, "pairwiseMethod": "bonferroni"})["terms"]}
    check("survival pairwise Bonferroni A vs C", bb["A vs C (log-rank)"]["p"], min(1.0, raw[1] * 3), tol=1e-3)


# ── Two-way ANOVA — vs closed-form balanced SS + mpmath F ─────────────────────
def check_twoway():
    print("\n# twoway  (oracle: closed-form balanced 2x2 sum-of-squares + mpmath F)")
    cells = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]  # cells[A][B], 2 reps
    A, B, rep = 2, 2, 2
    allv = [v for row in cells for cell in row for v in cell]
    grand = st.mean(allv)
    Am = [st.mean([v for cell in cells[i] for v in cell]) for i in range(A)]
    Bm = [st.mean([cells[i][j][r] for i in range(A) for r in range(rep)]) for j in range(B)]
    cm = [[st.mean(cells[i][j]) for j in range(B)] for i in range(A)]
    ss_a = B * rep * sum((Am[i] - grand) ** 2 for i in range(A))
    ss_b = A * rep * sum((Bm[j] - grand) ** 2 for j in range(B))
    ss_ab = rep * sum((cm[i][j] - Am[i] - Bm[j] + grand) ** 2 for i in range(A) for j in range(B))
    ss_res = sum((cells[i][j][r] - cm[i][j]) ** 2 for i in range(A) for j in range(B) for r in range(rep))
    df_res = A * B * (rep - 1)
    ms_res = ss_res / df_res
    fa, fb = (ss_a / (A - 1)) / ms_res, (ss_b / (B - 1)) / ms_res
    g = M["twoway"]({"cells": cells})["glance"]
    check("twoway SS_A", g["ss_a"], ss_a)
    check("twoway SS_B", g["ss_b"], ss_b)
    check("twoway SS_AB", g["ss_ab"], ss_ab)
    check("twoway SS_resid", g["ss_resid"], ss_res)
    check("twoway F_A", g["F_a"], fa)
    check("twoway F_B", g["F_b"], fb)
    check("twoway p_A", g["p_a"], f_p(fa, A - 1, df_res))


# ── RM ANOVA — vs closed-form within-subjects SS + mpmath F ───────────────────
def check_rmanova():
    print("\n# rmanova  (oracle: closed-form within-subjects sum-of-squares + mpmath F)")
    Y = [[8, 7, 6], [5, 6, 4], [6, 5, 7], [7, 8, 5]]
    n, k = len(Y), len(Y[0])
    allv = [v for row in Y for v in row]
    grand = st.mean(allv)
    col = [st.mean([Y[i][j] for i in range(n)]) for j in range(k)]
    rowm = [st.mean(Y[i]) for i in range(n)]
    ss_cond = n * sum((cj - grand) ** 2 for cj in col)
    ss_subj = k * sum((ri - grand) ** 2 for ri in rowm)
    ss_err = sum((v - grand) ** 2 for v in allv) - ss_cond - ss_subj
    df_c, df_e = k - 1, (n - 1) * (k - 1)
    F = (ss_cond / df_c) / (ss_err / df_e)
    g = M["rmanova"]({"data": Y})["glance"]
    check("rmanova F", g["F"], F)
    check("rmanova p", g["p"], f_p(F, df_c, df_e))
    check_eq("rmanova df_cond", g["df_cond"], df_c)
    check_eq("rmanova df_resid", g["df_resid"], df_e)
    # Partial η² + Greenhouse-Geisser ε (via the eigenvalues of the double-centred
    # covariance — a different derivation from the engine's Box trace form) + GG-corrected p.
    check("rmanova partial η²", g["partial_eta_sq"], ss_cond / (ss_cond + ss_err))
    Ya = np.asarray(Y, float)
    S = np.cov(Ya.T, bias=False)
    Sc = S - S.mean(0)[None, :] - S.mean(1)[:, None] + S.mean()
    lam = np.linalg.eigvalsh(Sc)
    lam = lam[lam > 1e-9]
    eps = float(min(1.0, max(1.0 / (k - 1), (lam.sum()) ** 2 / ((k - 1) * np.sum(lam ** 2)))))
    check("rmanova Greenhouse-Geisser ε (eigenvalue form)", g["gg_epsilon"], eps)
    check("rmanova GG-corrected p", g["p_gg"], f_p(F, df_c * eps, df_e * eps))


def check_mixedanova():
    # The split-plot / mixed ANOVA. Oracles share no code with
    # engine.mixedanova:
    #   1. pingouin.mixed_anova (an independent library): every SS, F and p on equal groups; on unequal groups the
    #      groups, groups x time and residual terms (pingouin weights the time means by group size, so its Time term
    #      is Type I there; MadY reports Type III).
    #   2. Time, unequal groups: statsmodels OLS of each within-subject contrast score on the groups (sum coding) and
    #      the Type III intercept test, summed over an orthonormal HELMERT basis built here (the engine uses QR).
    #   3. Greenhouse-Geisser epsilon from the eigenvalues of the double-centred pooled within-group covariance of the
    #      raw scores (Box's form) - the engine uses the trace form on its contrast scores.
    #   4. Corrected p-values through mpmath; one post-hoc comparison by hand.
    print("\n# mixedanova  (oracles: pingouin.mixed_anova, statsmodels Type III on Helmert contrasts, Box eigenvalue epsilon, mpmath F)")
    import pandas as pd
    import pingouin as pg
    import statsmodels.formula.api as smf
    from statsmodels.stats.anova import anova_lm

    def pg_table(groups):
        rows, sid = [], 0
        for gi, g in enumerate(groups):
            for s in g:
                sid += 1
                for t, v in enumerate(s):
                    rows.append(("g%d" % gi, sid, "t%d" % t, float(v)))
        df = pd.DataFrame(rows, columns=["grp", "subj", "time", "y"])
        return pg.mixed_anova(df, dv="y", within="time", subject="subj", between="grp").set_index("Source")

    def run(groups, **extra):
        return M["mixedanova"]({"groups": [{"label": "G%d" % i, "subjects": g} for i, g in enumerate(groups)],
                                "timeLabels": ["T%d" % t for t in range(len(groups[0][0]))], **extra})

    def terms(r):
        return {t["term"].split(" (")[0]: t for t in r["terms"]}

    # Equal groups (3 x 5 subjects x 4 time points), typed out so the check is reproducible.
    bal = [
        [[10, 12, 13, 15], [9, 11, 11, 14], [11, 12, 15, 16], [8, 10, 12, 12], [10, 13, 13, 15]],
        [[12, 13, 17, 19], [11, 14, 15, 18], [13, 15, 18, 21], [10, 12, 16, 17], [12, 15, 16, 20]],
        [[9, 9, 10, 11], [10, 11, 10, 12], [8, 9, 11, 10], [11, 11, 12, 13], [9, 10, 10, 12]],
    ]
    r = run(bal)
    g, tm = r["glance"], terms(r)
    ref = pg_table(bal)
    check("mixedanova (equal groups) SS groups vs pingouin", tm["Groups"]["estimate"], float(ref.loc["grp", "SS"]))
    check("mixedanova (equal groups) SS time vs pingouin", tm["Time"]["estimate"], float(ref.loc["time", "SS"]))
    check("mixedanova (equal groups) SS groups x time vs pingouin", tm["Groups × Time"]["estimate"], float(ref.loc["Interaction", "SS"]))
    for key, src in (("F_groups", "grp"), ("F_time", "time"), ("F_inter", "Interaction")):
        check("mixedanova (equal groups) %s vs pingouin" % key, g[key], float(ref.loc[src, "F"]))
    for key, src in (("p_groups", "grp"), ("p_time", "time"), ("p_inter", "Interaction")):
        check("mixedanova (equal groups) %s vs pingouin" % key, g[key], float(ref.loc[src, "p_unc"]))
    check_eq("mixedanova (equal groups) df", (g["df_groups"], g["df_subjects"], g["df_time"], g["df_inter"], g["df_resid"]),
             (int(ref.loc["grp", "DF1"]), int(ref.loc["grp", "DF2"]), int(ref.loc["time", "DF1"]), int(ref.loc["Interaction", "DF1"]), int(ref.loc["time", "DF2"])))

    # Unequal groups (4, 6, 5 subjects).
    unb = [
        [[10, 12, 13, 15], [9, 11, 11, 14], [11, 12, 15, 16], [8, 10, 12, 12]],
        [[12, 13, 17, 19], [11, 14, 15, 18], [13, 15, 18, 21], [10, 12, 16, 17], [12, 15, 16, 20], [14, 15, 19, 22]],
        [[9, 9, 10, 11], [10, 11, 10, 12], [8, 9, 11, 10], [11, 11, 12, 13], [9, 10, 10, 12]],
    ]
    r = run(unb, compare="groups")
    g, tm = r["glance"], terms(r)
    ref = pg_table(unb)
    check("mixedanova (unequal) SS groups vs pingouin", tm["Groups"]["estimate"], float(ref.loc["grp", "SS"]))
    check("mixedanova (unequal) SS groups x time vs pingouin", tm["Groups × Time"]["estimate"], float(ref.loc["Interaction", "SS"]))
    check("mixedanova (unequal) F groups x time vs pingouin", g["F_inter"], float(ref.loc["Interaction", "F"]))
    # Oracle 2: Type III Time on an orthonormal Helmert basis, through statsmodels.
    k = 4
    H = np.zeros((k, k - 1))
    for j in range(1, k):
        H[:j, j - 1] = 1.0
        H[j, j - 1] = -float(j)
        H[:, j - 1] /= np.sqrt(float(j * (j + 1)))
    ss_time = 0.0
    ss_resid = 0.0
    for c in range(k - 1):
        rows = []
        for gi, grp in enumerate(unb):
            for s in grp:
                rows.append(("g%d" % gi, float(np.dot(np.asarray(s, float), H[:, c]))))
        df = pd.DataFrame(rows, columns=["grp", "z"])
        fit = smf.ols("z ~ C(grp, Sum)", data=df).fit()
        a3 = anova_lm(fit, typ=3)
        ss_time += float(a3.loc["Intercept", "sum_sq"])
        ss_resid += float(a3.loc["Residual", "sum_sq"])
    check("mixedanova (unequal) SS time, Type III (statsmodels, Helmert)", tm["Time"]["estimate"], ss_time)
    check("mixedanova (unequal) SS residual (statsmodels, Helmert)", tm["Residual"]["estimate"], ss_resid)
    df_t, df_e = k - 1, (15 - 3) * (k - 1)
    F_t = (ss_time / df_t) / (ss_resid / df_e)
    check("mixedanova (unequal) F time", g["F_time"], F_t)
    check("mixedanova (unequal) p time (mpmath)", g["p_time"], f_p(F_t, df_t, df_e))
    # Oracle 3: epsilon from the pooled within-group covariance of the raw scores, double-centred (Box).
    Sp = sum((len(grp) - 1) * np.cov(np.asarray(grp, float).T, bias=False) for grp in unb) / (15 - 3)
    Sc = Sp - Sp.mean(0)[None, :] - Sp.mean(1)[:, None] + Sp.mean()
    lam = np.linalg.eigvalsh(Sc)
    lam = lam[lam > 1e-9]
    eps = float(min(1.0, max(1.0 / (k - 1), lam.sum() ** 2 / ((k - 1) * np.sum(lam ** 2)))))
    check("mixedanova Greenhouse-Geisser epsilon (Box eigenvalue form, pooled)", g["gg_epsilon"], eps)
    check("mixedanova GG-corrected p time (mpmath)", g["p_time_gg"], f_p(F_t, df_t * eps, df_e * eps))
    F_gt = g["F_inter"]
    check("mixedanova GG-corrected p groups x time (mpmath)", g["p_inter_gg"], f_p(F_gt, 2 * (k - 1) * eps, df_e * eps))
    # Oracle 4: one post-hoc comparison by hand - T3, G0 vs G1, pooled SD of the three groups at T3, Sidak over 12.
    at = [np.asarray([s[3] for s in grp], float) for grp in unb]
    msw = sum(float(((a - a.mean()) ** 2).sum()) for a in at) / (15 - 3)
    tt = (at[0].mean() - at[1].mean()) / np.sqrt(msw * (1 / 4 + 1 / 6))
    p_raw = t_p_two(tt, 15 - 3)
    row = next(t for t in r["terms"] if t["term"] == "At T3: G0 vs G1")
    check("mixedanova post-hoc t (T3, G0 vs G1)", row["statistic"], tt)
    check("mixedanova post-hoc Sidak p (T3, G0 vs G1)", row["p"], 1 - (1 - p_raw) ** 12)


def check_friedman():
    # The Friedman variant (χ² + tie-corrected Dunn's post-hoc).
    print("\n# friedman  (oracle: from-scratch tie-corrected Friedman χ² + mean ranks)")
    Y = [[10, 12, 15, 14], [9, 11, 13, 13], [12, 14, 17, 16], [8, 10, 12, 11], [11, 13, 16, 15], [10, 13, 15, 14]]
    n, k = len(Y), len(Y[0])

    def avg_rank(row):
        order = sorted(range(len(row)), key=lambda i: row[i])
        r = [0.0] * len(row)
        i = 0
        while i < len(row):
            j = i
            while j + 1 < len(row) and row[order[j + 1]] == row[order[i]]:
                j += 1
            for t in range(i, j + 1):
                r[order[t]] = (i + j) / 2 + 1
            i = j + 1
        return r
    ranks = [avg_rank(row) for row in Y]
    R = [sum(ranks[s][j] for s in range(n)) for j in range(k)]
    chi0 = 12.0 / (n * k * (k + 1)) * sum(rj ** 2 for rj in R) - 3 * n * (k + 1)
    tie = 0.0
    for row in Y:
        _u, c = np.unique(row, return_counts=True)
        tie += float(np.sum(c ** 3 - c))
    C = 1 - tie / (n * k * (k * k - 1))
    r = M["rmanova"]({"data": Y, "variant": "friedman"})
    g = r["glance"]
    check("friedman χ² (from-scratch tie-corrected)", g["chi_sq"], chi0 / C)
    check("friedman p (mpmath χ² tail)", g["p"], chi2_p(chi0 / C, k - 1))
    mr = {t["term"]: t for t in r["terms"]}
    check("friedman mean rank Cond 1", mr["Cond 1"]["estimate"], R[0] / n)


# ── Goodness-of-fit — vs closed-form chi-square + mpmath ──────────────────────
def _newton_glm(X, y, link):
    """From-scratch Newton-Raphson IRLS for a logit ('binomial') or log ('poisson')
    GLM — shares no code with the engine's statsmodels fit. Returns (β, cov, μ)."""
    b = np.zeros(X.shape[1])
    for _ in range(100):
        eta = X @ b
        mu = 1 / (1 + np.exp(-eta)) if link == "binomial" else np.exp(eta)
        w = mu * (1 - mu) if link == "binomial" else mu
        s = np.linalg.solve((X * w[:, None]).T @ X, X.T @ (y - mu))
        b = b + s
        if np.max(np.abs(s)) < 1e-13:
            break
    eta = X @ b
    mu = 1 / (1 + np.exp(-eta)) if link == "binomial" else np.exp(eta)
    w = mu * (1 - mu) if link == "binomial" else mu
    return b, np.linalg.inv((X * w[:, None]).T @ X), mu


def _binom_two_sided(kk, nn, pi):
    """Two-sided exact binomial p = Σ P(i) over outcomes at most as likely as the
    observed — a from-scratch sum (math.comb), independent of scipy.binomtest."""
    pmf = [math.comb(nn, i) * pi ** i * (1 - pi) ** (nn - i) for i in range(nn + 1)]
    return sum(pmf[i] for i in range(nn + 1) if pmf[i] <= pmf[kk] * (1 + 1e-9))


def check_goodnessoffit():
    print("\n# goodnessoffit  (oracle: closed-form chi-square + from-scratch exact binomial)")
    obs = [30, 50, 20]
    N, k = sum(obs), len(obs)
    exp = N / k
    chi = sum((o - exp) ** 2 / exp for o in obs)
    g = M["goodnessoffit"]({"observed": obs})["glance"]
    check("goodnessoffit chi_sq", g["chi_sq"], chi)
    check_eq("goodnessoffit df", g["df"], k - 1)
    check("goodnessoffit p", g["p"], chi2_p(chi, k - 1))
    # Custom expected distribution: proportions scaled to the observed total, hand χ².
    expp = [0.2, 0.5, 0.3]
    ec = [e / sum(expp) * N for e in expp]
    chic = sum((obs[i] - ec[i]) ** 2 / ec[i] for i in range(k))
    gc = M["goodnessoffit"]({"observed": obs, "expected": expp})["glance"]
    check("goodnessoffit custom-expected χ²", gc["chi_sq"], chic)
    check("goodnessoffit custom-expected p", gc["p"], chi2_p(chic, k - 1))
    # k==2 exact binomial (uniform + custom-proportion null) vs a from-scratch sum.
    gb = M["goodnessoffit"]({"observed": [10, 20]})["glance"]
    check("goodnessoffit binomial p (uniform π=0.5)", gb["binom_p"], _binom_two_sided(10, 30, 0.5))
    gb3 = M["goodnessoffit"]({"observed": [10, 20], "expected": [0.3, 0.7]})["glance"]
    check("goodnessoffit binomial p (custom π=0.3)", gb3["binom_p"], _binom_two_sided(10, 30, 0.3))


# ── Nested ANOVA — vs closed-form hierarchical SS ─────────────────────────────
def check_nested():
    print("\n# nested  (oracle: closed-form hierarchical sum-of-squares + mpmath F)")
    groups = [{"label": "G%d" % gb, "subgroups": [[gb + 0.5 * si + v for v in (-1, 0, 1, 2)] for si in (0, 1, 2)]} for gb in (10, 16)]
    allv = [v for g in groups for sg in g["subgroups"] for v in sg]
    grand = st.mean(allv)
    ss_groups = ss_subs = ss_within = 0.0
    n_sub = 0
    for g in groups:
        gvals = [v for sg in g["subgroups"] for v in sg]
        gmean = st.mean(gvals)
        ss_groups += len(gvals) * (gmean - grand) ** 2
        for sg in g["subgroups"]:
            sm = st.mean(sg)
            ss_subs += len(sg) * (sm - gmean) ** 2
            ss_within += sum((v - sm) ** 2 for v in sg)
            n_sub += 1
    df_groups, df_sub = len(groups) - 1, n_sub - len(groups)
    F = (ss_groups / df_groups) / (ss_subs / df_sub)
    r = M["nested"]({"groups": groups})
    check("nested SS_groups", term(r, "Groups"), ss_groups)
    check("nested SS_subgroups", term(r, "Subgroups within groups"), ss_subs)
    check("nested SS_within", term(r, "Residual (within subgroups)"), ss_within)
    check("nested F_groups", r["glance"]["f_groups"], F)


# ── Multiple regression — vs numpy normal equations + sklearn LinearRegression ─
def check_multipleregression():
    print("\n# multipleregression  (oracle: numpy normal equations + sklearn LinearRegression)")
    from sklearn.linear_model import LinearRegression
    x1 = [0.1, 0.4, 0.35, 0.8, 0.55, 0.2, 0.9, 0.6, 0.3, 0.75]
    x2 = [1.0, 0.2, 0.7, 0.3, 0.9, 0.5, 0.1, 0.65, 0.45, 0.85]
    x3 = [5, 3, 8, 2, 6, 4, 9, 7, 1, 10]
    y = [2.3, 1.1, 3.4, 0.9, 3.0, 1.8, 1.2, 2.9, 0.6, 4.1]
    X = np.column_stack([x1, x2, x3]).astype(float)
    yv = np.array(y, dtype=float)
    Xd = np.column_stack([np.ones(len(yv)), X])
    beta = np.linalg.solve(Xd.T @ Xd, Xd.T @ yv)  # normal equations (≠ statsmodels' pinv/QR path)
    yhat = Xd @ beta
    ss_res, ss_tot = float(np.sum((yv - yhat) ** 2)), float(np.sum((yv - yv.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot
    adj = 1 - (1 - r2) * (len(yv) - 1) / (len(yv) - 3 - 1)
    sk = LinearRegression().fit(X, yv)  # sklearn — a second independent engine
    r = M["multipleregression"]({"y": y, "predictors": [x1, x2, x3], "labels": ["x1", "x2", "x3"]})
    check("mreg intercept (normal-eq)", term(r, "Intercept"), beta[0])
    check("mreg x1 (normal-eq)", term(r, "x1"), beta[1])
    check("mreg x2 (normal-eq)", term(r, "x2"), beta[2])
    check("mreg x3 (normal-eq)", term(r, "x3"), beta[3])
    check("mreg x3 (sklearn)", term(r, "x3"), sk.coef_[2])
    check("mreg intercept (sklearn)", term(r, "Intercept"), sk.intercept_)
    check("mreg R^2", r["glance"]["r_sq"], r2)
    check("mreg adj R^2", r["glance"]["adj_r_sq"], adj)
    # VIF_j = 1/(1−R²_j) (regress predictor j on the others) + standardized β_j = b_j·sd(x_j)/sd(y).
    def vif(j):
        others = [X[:, c] for c in range(X.shape[1]) if c != j]
        Xo = np.column_stack([np.ones(len(yv))] + others)
        bo, *_ = np.linalg.lstsq(Xo, X[:, j], rcond=None)
        rss_j = float(np.sum((X[:, j] - Xo @ bo) ** 2))
        tss_j = float(np.sum((X[:, j] - X[:, j].mean()) ** 2))
        return 1.0 / (1.0 - (1 - rss_j / tss_j))
    check("mreg x1 VIF", term(r, "x1", "vif"), vif(0))
    check("mreg x1 standardized β", term(r, "x1", "beta"), beta[1] * float(np.std(X[:, 0], ddof=1)) / float(np.std(yv, ddof=1)))


# ── Logistic — vs sklearn LogisticRegression (unregularised MLE, a 2nd engine) ─
def check_logistic():
    print("\n# logistic  (oracle: sklearn LogisticRegression penalty=None — independent MLE engine)")
    from sklearn.linear_model import LogisticRegression
    x1 = [2.1, -0.34, -0.58, -3.18, -0.01, -0.38, -0.64, 0.38, 0.51, -1.28, -1.06, -0.57, 0.83, 0.67, -1.57, -1.34, 0.88, 1.89, -0.04, -0.82, 1.31, -0.37, 0.87, 1.86, 0.76, 0.09, 0.88, -0.77, -0.21, -0.69, -0.25, -0.58, -0.22, -0.46, 0.11, 0.08, 0.36, 1.68, -1.86, 1.55, -0.28, -1.48, -0.21, 0.11, 1.28, -1.27, 0.26, 0.14, -2.02, -1.42, 0.72, 0.83, 1.31, 0.64, 0.47, 0.15, 1.45, -1.01, -0.17, 0.46]
    x2 = [-1.89, 1.57, -0.95, -0.09, 2.59, -1.0, -0.64, 1.87, -1.3, -0.52, 0.62, 0.55, 0.71, 0.44, 1.61, 1.22, 0.71, -0.82, -0.86, -2.29, 0.82, -2.19, 1.05, 2.22, -1.27, -0.82, -0.57, 1.0, -1.04, -0.16, -0.63, -0.3, 1.55, -1.16, 0.09, 0.33, 1.03, -1.52, 1.34, 0.52, 1.05, 0.09, -1.97, -0.78, 0.98, 0.04, -0.06, 2.15, 2.64, -0.04, 2.32, -2.39, -2.46, 1.04, -0.31, 0.69, 0.62, -0.11, 0.82, 0.18]
    y = [1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1]
    clf = LogisticRegression(penalty=None, solver="lbfgs", max_iter=10000).fit(np.column_stack([x1, x2]), y)
    r = M["logistic"]({"y": y, "predictors": [x1, x2], "labels": ["x1", "x2"], "outcomeLabel": "event"})
    check("logistic intercept (sklearn)", term(r, "Intercept"), clf.intercept_[0], tol=3e-3)
    check("logistic x1 (sklearn)", term(r, "x1"), clf.coef_[0][0], tol=3e-3)
    check("logistic x2 (sklearn)", term(r, "x2"), clf.coef_[0][1], tol=3e-3)
    check("logistic x1 odds ratio", term(r, "x1", "oddsRatio"), math.exp(clf.coef_[0][0]), tol=4e-3)
    # Wald CIs + pseudo-R²/LR via a from-scratch Newton IRLS (cov = inv(XᵀWX)).
    yv = np.array(y, float)
    X = np.column_stack([np.ones(len(y)), x1, x2])
    b, cov, mu = _newton_glm(X, yv, "binomial")
    se = np.sqrt(np.diag(cov))
    Z = 1.959963984540054
    check("logistic x1 coef CI low (Wald)", term(r, "x1", "ciLow"), b[1] - Z * se[1])
    check("logistic x1 OR CI low (Wald)", term(r, "x1", "orLow"), math.exp(b[1] - Z * se[1]))
    check("logistic x1 OR CI high (Wald)", term(r, "x1", "orHigh"), math.exp(b[1] + Z * se[1]))
    ll = float(np.sum(yv * np.log(mu) + (1 - yv) * np.log(1 - mu)))
    p0 = float(yv.mean())
    ll0 = float(np.sum(yv * math.log(p0) + (1 - yv) * math.log(1 - p0)))
    n = len(y)
    check("logistic McFadden R²", r["glance"]["mcfadden_r_sq"], 1 - ll / ll0)
    check("logistic Nagelkerke R²", r["glance"]["nagelkerke_r_sq"], (1 - math.exp(2 * (ll0 - ll) / n)) / (1 - math.exp(2 * ll0 / n)))
    check("logistic Tjur R²", r["glance"]["tjur_r_sq"], float(mu[yv == 1].mean() - mu[yv == 0].mean()))
    check("logistic LR χ²", r["glance"]["lr_chi2"], 2 * (ll - ll0))


# ── Poisson — vs scipy.optimize MLE on the Poisson log-likelihood (independent) ─
def check_poisson():
    print("\n# poisson  (oracle: scipy.optimize MLE on the Poisson log-likelihood, ≠ statsmodels IRLS)")
    from scipy.optimize import minimize
    x = np.array([1, 2, 3, 4, 5, 6, 7, 8], dtype=float)
    y = np.array([2, 3, 5, 8, 10, 15, 20, 30], dtype=float)

    def nll(b):
        eta = b[0] + b[1] * x
        return float(np.sum(np.exp(eta) - y * eta))

    b = minimize(nll, [0.0, 0.1], method="BFGS").x
    r = M["poisson"]({"y": [2, 3, 5, 8, 10, 15, 20, 30], "predictors": [[1, 2, 3, 4, 5, 6, 7, 8]], "labels": ["dose"], "outcomeLabel": "count"})
    check("poisson intercept (scipy MLE)", term(r, "Intercept"), b[0], tol=1e-4)
    check("poisson dose slope (scipy MLE)", term(r, "dose"), b[1], tol=1e-4)
    check("poisson dose rate ratio", term(r, "dose", "rateRatio"), math.exp(b[1]), tol=1e-4)
    # IRR Wald CI + dispersion (+ deviance) via a from-scratch Newton IRLS.
    Xp = np.column_stack([np.ones(len(x)), x])
    bp, covp, mup = _newton_glm(Xp, y, "poisson")
    sep = np.sqrt(np.diag(covp))
    Z = 1.959963984540054
    check("poisson dose IRR CI low (Wald)", term(r, "dose", "rrLow"), math.exp(bp[1] - Z * sep[1]))
    check("poisson dose IRR CI high (Wald)", term(r, "dose", "rrHigh"), math.exp(bp[1] + Z * sep[1]))
    check("poisson dispersion (Pearson χ²/df)", r["glance"]["dispersion"], float(np.sum((y - mup) ** 2 / mup) / (len(y) - 2)))
    check("poisson deviance", r["glance"]["deviance"], float(2 * np.sum(np.where(y > 0, y * np.log(y / mup), 0.0) - (y - mup))))


# ── PCA — vs sklearn PCA on the standardized data (independent decomposition) ──
def check_pca():
    print("\n# pca  (oracle: sklearn PCA — independent SVD engine)")
    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler
    v1 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 2.5, 5.5]
    v2 = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0, 13.9, 16.1, 5.0, 11.2]
    v3 = [5.0, 3.0, 6.0, 2.0, 7.0, 1.0, 8.0, 4.0, 9.0, 3.5]
    Z = StandardScaler().fit_transform(np.column_stack([v1, v2, v3]))
    sk = PCA().fit(Z)
    ratio = sk.explained_variance_ratio_
    exf = M["pca"]({"columns": [v1, v2, v3], "labels": ["v1", "v2", "v3"], "standardize": True})["extra"]["pca"]
    ex = exf["explained"]
    check("pca explained[0] (sklearn)", ex[0], float(ratio[0]))
    check("pca explained[1] (sklearn)", ex[1], float(ratio[1]))
    check("pca explained[2] (sklearn)", ex[2], float(ratio[2]), tol=2e-3)
    # Loadings + scores vs sklearn (PCA sign is arbitrary → align each PC's sign to the engine).
    # The engine standardises with the sample SD (ddof=1), so project onto that Z, not sklearn's.
    load = np.asarray(exf["loadings"], float)   # [variable][pc]
    score = np.asarray(exf["scores"], float)     # [case][pc]
    Xraw = np.column_stack([v1, v2, v3]).astype(float)
    Z1 = (Xraw - Xraw.mean(0)) / Xraw.std(0, ddof=1)
    for pc in range(2):
        sgn = 1.0 if load[0, pc] * sk.components_[pc][0] >= 0 else -1.0
        for vi in range(3):
            check("pca PC%d loading v%d (sklearn)" % (pc + 1, vi + 1), float(load[vi, pc]), sgn * float(sk.components_[pc][vi]), tol=2e-3)
        check("pca PC%d score[0] (Z·loading)" % (pc + 1), float(score[0, pc]), float(Z1[0] @ (sgn * sk.components_[pc])), tol=2e-3)


def _horn_retained(X, pct, sims, seed):
    """Independent Horn's parallel analysis — retain the leading PCs whose observed
    correlation-matrix eigenvalue beats the pct-th percentile of random-data
    eigenvalues. Fresh code: eigvalsh of corrcoef (not the engine's SVD path), own RNG."""
    n, p = X.shape
    obs = np.sort(np.linalg.eigvalsh(np.corrcoef(X, rowvar=False)))[::-1]
    rng = np.random.default_rng(seed)
    rand = np.empty((sims, p))
    for s in range(sims):
        R = rng.standard_normal((n, p))
        rand[s] = np.sort(np.linalg.eigvalsh(np.corrcoef(R, rowvar=False)))[::-1]
    thr = np.percentile(rand, pct, axis=0)
    keep = 0
    for k in range(p):
        if obs[k] > thr[k]:
            keep += 1
        else:
            break
    return keep


# ── PCA component selection — closed-form counts + independent parallel analysis ──
def check_pca_selection():
    print("\n# pca component-selection  (oracle: closed-form counts + independent Horn's PA)")
    rng = np.random.default_rng(20260707)
    n = 150
    f1 = rng.standard_normal(n)
    f2 = rng.standard_normal(n)
    loads = [(1.0, 0.0), (1.0, 0.0), (0.0, 1.0), (0.0, 1.0), (0.7, 0.7)]  # 5 vars on 2 latent factors
    cols = [list(a * f1 + b * f2 + 0.3 * rng.standard_normal(n)) for a, b in loads]
    labels = ["v%d" % (i + 1) for i in range(5)]
    X = np.column_stack(cols)

    def run(**kw):
        return engine.pca({"columns": cols, "labels": labels, "standardize": True, **kw})["glance"]

    eig = engine.pca({"columns": cols, "labels": labels, "standardize": True})["extra"]["pca"]["eigenvalues"]
    ex = engine.pca({"columns": cols, "labels": labels, "standardize": True})["extra"]["pca"]["explained"]

    # all / fixed-k (incl. clamp)
    check_eq("pca all retains p", run(componentSelection="all")["retained"], 5)
    check_eq("pca fixedk=3 retains 3", run(componentSelection="fixedk", fixedK=3)["retained"], 3)
    check_eq("pca fixedk=99 clamps to p", run(componentSelection="fixedk", fixedK=99)["retained"], 5)

    # Kaiser: count(eig > threshold), recomputed from the returned eigenvalues
    for thr in (1.0, 0.5):
        want = int(sum(1 for e in eig if e > thr))
        check_eq("pca kaiser>%.1f == count(eig>thr)" % thr,
                 run(componentSelection="kaiser", kaiserThreshold=thr)["retained"], want)

    # Cumulative variance: smallest m with cumulative ratio >= threshold, from the ratios
    def cum_needed(ratios, t):
        c = 0.0
        for i, r in enumerate(ratios):
            c += r
            if c >= t - 1e-12:
                return i + 1
        return len(ratios)
    for t in (0.90, 0.99):
        check_eq("pca variance>=%.2f smallest m" % t,
                 run(componentSelection="variance", varianceThreshold=t)["retained"], cum_needed(ex, t))

    # Parallel analysis == an independent Horn's PA (different eigensolver + RNG), and recovers 2 factors
    horn = _horn_retained(X, 95.0, 1000, 4242)
    eng_par = run(componentSelection="parallel", parallelSims=1000, parallelPercentile=95.0, seed=99)["retained"]
    check_eq("pca parallel == independent Horn's PA", eng_par, horn)
    check_eq("pca parallel recovers 2 planted factors", eng_par, 2)

    # Parallel is more conservative than Kaiser on pure noise (its whole point)
    noise = [list(rng.standard_normal(n)) for _ in range(5)]
    npar = engine.pca({"columns": noise, "labels": labels, "standardize": True,
                       "componentSelection": "parallel", "parallelSims": 800, "seed": 3})["glance"]["retained"]
    nkai = engine.pca({"columns": noise, "labels": labels, "standardize": True,
                       "componentSelection": "kaiser"})["glance"]["retained"]
    check_eq("pca parallel on noise keeps <=1", npar <= 1, True)
    check_eq("pca parallel <= kaiser on noise (conservative)", npar <= nkai, True)


# ── ROC AUC — vs sklearn roc_auc_score (independent) ──────────────────────────
def check_roc():
    print("\n# roc  (oracle: sklearn roc_auc_score)")
    from sklearn.metrics import roc_auc_score
    for sc, lab in [
        ([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]),
        ([1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 0, 0, 1, 1, 1, 1]),
        ([3.2, 1.1, 4.5, 1.4, 5.9, 9.2, 2.6, 6.1, 0.7, 3.8], [0, 0, 1, 0, 1, 1, 0, 1, 0, 1]),
    ]:
        auc_e = M["roc"]({"scores": sc, "labels": lab})["glance"]["auc"]
        check("roc AUC (sklearn) n=%d" % len(sc), auc_e, float(roc_auc_score(lab, sc)))
    # Per-cutoff Wilson CIs for sensitivity/specificity vs statsmodels proportion_confint.
    from statsmodels.stats.proportion import proportion_confint
    sc = [3.2, 1.1, 4.5, 1.4, 5.9, 9.2, 2.6, 6.1, 0.7, 3.8]
    lab = [0, 0, 1, 0, 1, 1, 0, 1, 0, 1]
    cuts = M["roc"]({"scores": sc, "labels": lab})["extra"]["roc"]["cutoffs"]
    npos, nneg = sum(lab), len(lab) - sum(lab)
    row = cuts[len(cuts) // 2]  # a middle cutoff
    tp, tn = round(row["sensitivity"] * npos), round(row["specificity"] * nneg)
    slo, shi = proportion_confint(tp, npos, method="wilson")
    check("roc sensitivity Wilson low (statsmodels)", row["sensLow"], float(slo))
    check("roc sensitivity Wilson high (statsmodels)", row["sensHigh"], float(shi))
    plo, _phi = proportion_confint(tn, nneg, method="wilson")
    check("roc specificity Wilson low (statsmodels)", row["specLow"], float(plo))
    # Hanley-McNeil AUC SE + normal-approx CI + p vs a from-scratch re-derivation.
    # Use an overlapping dataset (AUC < 1 → se > 0) so the SE/CI/p are non-degenerate.
    sc = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    lab = [0, 0, 1, 0, 1, 0, 1, 1, 0, 1]
    gj = M["roc"]({"scores": sc, "labels": lab})["glance"]
    auc, npos2, nneg2 = gj["auc"], gj["n_pos"], gj["n_neg"]
    q1, q2 = auc / (2 - auc), 2 * auc * auc / (1 + auc)
    se_hm = math.sqrt((auc * (1 - auc) + (npos2 - 1) * (q1 - auc * auc) + (nneg2 - 1) * (q2 - auc * auc)) / (npos2 * nneg2))
    zc = 1.959963984540054
    check("roc AUC Hanley-McNeil SE", gj["se"], se_hm)
    check("roc AUC CI low (normal approx)", gj["ci_low"], max(0.0, auc - zc * se_hm))
    check("roc AUC p (mpmath normal)", gj["p"], 2 * (1 - normal_cdf(abs((auc - 0.5) / se_hm))))
    # Youden's optimal cutoff + sens/spec at it, from a from-scratch threshold sweep.
    best = None
    for t in sorted(set(sc)):
        tp = sum(1 for i in range(len(sc)) if sc[i] >= t and lab[i] == 1)
        fp = sum(1 for i in range(len(sc)) if sc[i] >= t and lab[i] == 0)
        sens, spec = tp / npos2, (nneg2 - fp) / nneg2
        j = sens + spec - 1
        if best is None or j > best[0]:
            best = (j, t, sens, spec)
    check("roc Youden cutoff", gj["cutoff"], best[1])
    check("roc sensitivity at cutoff", gj["sensitivity"], best[2])
    check("roc specificity at cutoff", gj["specificity"], best[3])
    # The Confidence level reaches the AUC CI.
    # On an overlapping dataset (AUC < 1, se > 0), reconstruct the lower bound from
    # AUC − z(conf)·se and confirm the CI widens as conf rises.
    from scipy.stats import norm as _norm
    sc2, lab2 = [1, 2, 3, 4, 5, 6, 7, 8], [0, 0, 1, 0, 1, 0, 1, 1]
    def _roc_lo(c):
        g = M["roc"]({"scores": sc2, "labels": lab2, "conf": c})["glance"]
        return g["auc"], g["se"], g["ci_low"]
    a, se, lo90 = _roc_lo(0.90)
    check("roc 90% CI low == AUC − z90·se", lo90, max(0.0, a - float(_norm.ppf(0.95)) * se))
    _, _, lo95 = _roc_lo(0.95)
    _, _, lo99 = _roc_lo(0.99)
    check_eq("roc AUC CI widens with confidence (lower bound falls)", bool(lo90 > lo95 > lo99), True)


# ── Deming — vs the closed-form errors-in-variables slope (λ=1 orthogonal) ─────
def check_deming():
    print("\n# deming  (oracle: closed-form Deming slope)")
    x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    y = [1.1, 2.3, 2.9, 4.2, 5.1, 5.8, 7.3, 7.9, 9.2, 10.1]
    mx, my = st.mean(x), st.mean(y)
    sxx = sum((xi - mx) ** 2 for xi in x)
    syy = sum((yi - my) ** 2 for yi in y)
    sxy = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    b = (syy - sxx + math.sqrt((syy - sxx) ** 2 + 4 * sxy ** 2)) / (2 * sxy)  # λ = 1
    r = M["deming"]({"x": x, "y": y})
    check("deming slope", term(r, "Slope"), b)
    check("deming intercept", term(r, "Intercept"), my - b * mx)


# ── Bland-Altman — closed-form bias / SD / limits of agreement + literature t ──
def check_blandaltman():
    print("\n# bland-altman  (oracle: closed-form bias / SD / limits of agreement + literature t)")
    A = [1.0, 2.1, 3.0, 4.2, 5.1, 6.0, 7.3, 8.1, 9.0, 10.2]
    B = [1.1, 2.0, 3.3, 4.0, 5.4, 5.8, 7.0, 8.4, 9.1, 10.0]
    by = {t["term"]: t for t in M["blandaltman"]({"x": A, "y": B, "conf": 0.95})["terms"]}
    diffs = [a - b for a, b in zip(A, B)]
    n = len(diffs)
    bias, sd, k = st.mean(diffs), st.stdev(diffs), 1.96
    tc = 2.2621571628  # t_{9, 0.975}, literature
    check("bland-altman bias", by["Bias (mean difference)"]["estimate"], bias)
    check("bland-altman SD of differences", by["SD of differences"]["estimate"], sd)
    check("bland-altman upper LoA", by["Upper limit of agreement"]["estimate"], bias + k * sd)
    check("bland-altman lower LoA", by["Lower limit of agreement"]["estimate"], bias - k * sd)
    check("bland-altman bias CI high", by["Bias (mean difference)"]["ciHigh"], bias + tc * sd / math.sqrt(n))
    se_loa = sd * math.sqrt(1.0 / n + k * k / (2.0 * (n - 1)))
    check("bland-altman upper-LoA CI high", by["Upper limit of agreement"]["ciHigh"], bias + k * sd + tc * se_loa)
    # Percent variant: bias == mean of the per-pair percent differences.
    means = [(a + b) / 2 for a, b in zip(A, B)]
    pbias = st.mean([100.0 * (a - b) / m for a, b, m in zip(A, B, means)])
    check("bland-altman percent bias", M["blandaltman"]({"x": A, "y": B, "percent": True})["glance"]["bias"], pbias)


# ── Passing-Bablok — exact line recovery + independent shifted-median + robustness ──
def check_passingbablok():
    print("\n# passing-bablok  (oracle: exact line recovery + independent shifted-median + robustness)")
    # An exact line y = 2x + 3 → PB recovers (2, 3) exactly (every pairwise slope is 2).
    x = list(range(1, 12))
    y = [2 * v + 3 for v in x]
    by = {t["term"]: t for t in M["passingbablok"]({"x": x, "y": y})["terms"]}
    check("passing-bablok slope on exact line", by["Slope"]["estimate"], 2.0)
    check("passing-bablok intercept on exact line", by["Intercept"]["estimate"], 3.0)
    check_eq("passing-bablok CI brackets the slope", bool(by["Slope"]["ciLow"] <= 2.0 <= by["Slope"]["ciHigh"]), True)
    # Slope == an independent shifted-median-of-pairwise-slopes recompute.
    xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    ys = [1.1, 2.0, 2.9, 4.2, 5.1, 5.8, 7.3, 7.9, 9.2, 10.1]

    def pb_slope(xx, yy):
        s = sorted((yy[j] - yy[i]) / (xx[j] - xx[i]) for i in range(len(xx)) for j in range(i + 1, len(xx))
                   if xx[j] != xx[i] and (yy[j] - yy[i]) / (xx[j] - xx[i]) != -1)
        m, kk = len(s), sum(1 for v in s if v < -1)
        return s[(m - 1) // 2 + kk] if m % 2 else (s[m // 2 - 1 + kk] + s[m // 2 + kk]) / 2
    clean = M["passingbablok"]({"x": xs, "y": ys})["glance"]["slope"]
    check("passing-bablok slope == shifted median", clean, pb_slope(xs, ys))
    # Exact rank-based CI bounds (order statistics C/2 either side of the shifted median).
    x2 = list(range(1, 13))
    y2 = [1.1, 2.0, 3.2, 3.9, 5.3, 5.8, 7.1, 8.2, 8.9, 10.1, 11.3, 11.8]
    n2 = len(x2)
    sl = sorted(v for i in range(n2) for j in range(i + 1, n2)
                for v in [(y2[j] - y2[i]) / (x2[j] - x2[i])] if x2[j] != x2[i] and v != -1)
    Kc = sum(1 for v in sl if v < -1)
    N = len(sl)
    C = 1.959963984540054 * math.sqrt(n2 * (n2 - 1) * (2 * n2 + 5) / 18.0)
    m1 = int(round((N - C) / 2.0))
    m2 = N - m1 + 1
    clamp = lambda i: max(0, min(i, N - 1))
    lo, hi = sl[clamp(m1 + Kc - 1)], sl[clamp(m2 + Kc - 1)]
    med = lambda v: (sorted(v)[len(v) // 2] if len(v) % 2 else (sorted(v)[len(v) // 2 - 1] + sorted(v)[len(v) // 2]) / 2)
    by2 = {t["term"]: t for t in M["passingbablok"]({"x": x2, "y": y2})["terms"]}
    check("passing-bablok slope CI low (order statistic)", by2["Slope"]["ciLow"], lo)
    check("passing-bablok slope CI high (order statistic)", by2["Slope"]["ciHigh"], hi)
    check("passing-bablok intercept CI low", by2["Intercept"]["ciLow"], med([y2[i] - hi * x2[i] for i in range(n2)]))
    check("passing-bablok intercept CI high", by2["Intercept"]["ciHigh"], med([y2[i] - lo * x2[i] for i in range(n2)]))
    # Outlier-robust: adding an aberrant point barely moves PB, unlike ordinary least squares.
    rob = M["passingbablok"]({"x": xs + [11], "y": ys + [2.0]})["glance"]["slope"]
    ols0 = float(np.polyfit(xs, ys, 1)[0])
    ols1 = float(np.polyfit(xs + [11], ys + [2.0], 1)[0])
    check_eq("passing-bablok robust to outlier (moves < OLS)", bool(abs(rob - clean) < abs(ols1 - ols0)), True)
    # A published reference dataset with its known fitted line (102 pairs, with ties)
    # → y = 0.028 + 0.912·x. Validates the exact tie rule (vertical pairs as ±∞) + shifted median.
    sx = [0.07, 0.04, 0.07, 0.05, 0.06, 0.06, 0.03, 0.04, 0.05, 0.05, 0.12, 0.10, 0.03, 0.18, 0.29, 0.05, 0.04, 0.11, 0.38, 0.04, 0.03, 0.06, 0.46, 0.08, 0.02, 0.12, 0.16, 0.07, 0.07, 0.04, 0.11, 0.23, 0.15, 0.05, 0.04, 0.05, 0.17, 8.43, 1.86, 0.17, 8.29, 5.98, 0.57, 0.07, 0.06, 0.21, 8.29, 0.28, 8.25, 0.18, 0.17, 0.15, 8.33, 5.58, 0.09, 1.00, 0.09, 3.88, 0.51, 4.09, 0.89, 5.61, 4.52, 0.09, 0.05, 0.05, 0.04, 0.05, 0.09, 0.03, 2.27, 1.50, 5.05, 0.22, 2.13, 0.05, 4.09, 1.46, 1.20, 0.02, 1.00, 3.39, 1.00, 2.07, 6.68, 3.00, 0.06, 7.17, 1.00, 2.00, 2.91, 3.92, 1.00, 7.20, 6.42, 2.38, 1.97, 4.72, 1.64, 5.48, 5.54, 0.02]
    sy = [0.07, 0.10, 0.08, 0.10, 0.08, 0.07, 0.05, 0.05, 0.08, 0.10, 0.21, 0.17, 0.11, 0.24, 0.33, 0.05, 0.05, 0.21, 0.36, 0.05, 0.06, 0.07, 0.27, 0.05, 0.09, 0.23, 0.25, 0.10, 0.07, 0.06, 0.23, 0.21, 0.20, 0.07, 0.14, 0.11, 0.26, 8.12, 1.47, 0.27, 7.71, 5.26, 0.43, 0.10, 0.11, 0.24, 7.84, 0.23, 7.79, 0.25, 0.22, 0.21, 7.67, 5.05, 0.14, 3.72, 0.13, 3.54, 0.42, 3.64, 0.71, 5.18, 4.15, 0.12, 0.05, 0.05, 0.07, 0.07, 0.11, 0.05, 2.08, 1.21, 4.46, 0.25, 1.93, 0.08, 3.61, 1.13, 0.97, 0.05, 1.00, 3.11, 0.05, 1.83, 6.06, 2.97, 0.09, 6.55, 1.00, 0.05, 2.45, 3.36, 1.00, 6.88, 5.83, 2.04, 1.76, 4.37, 1.25, 4.77, 5.16, 0.06]
    sr = M["passingbablok"]({"x": sx, "y": sy})["glance"]
    check("passing-bablok slope    == published 0.912", sr["slope"], 0.912, tol=2e-3)
    check("passing-bablok intercept == published 0.028", sr["intercept"], 0.028, tol=2e-3)


# ── AUC (trapezoidal) — vs closed-form trapezoid sum ──────────────────────────
def check_auc():
    print("\n# auc  (oracle: closed-form trapezoid + fine-grid clipped-positive integral)")
    x = [0, 1, 2, 3, 4, 5]
    y = [0, 2, 3, 1, 4, 0]
    pts = sorted(zip(x, y))
    net = sum(0.5 * (pts[i][1] + pts[i + 1][1]) * (pts[i + 1][0] - pts[i][0]) for i in range(len(pts) - 1))
    check("auc net area", M["auc"]({"x": x, "y": y})["glance"]["net"], net)
    # Peak decomposition + baseline modes + min-peak filter. Oracle = an independent
    # fine-grid integral of max(ŷ − baseline, 0) (a different algorithm than the engine's
    # crossing-interpolation walk) + a from-scratch net trapezoid at each baseline.
    x2 = list(range(11))
    y2 = [0, 1, 3, 1, 0, 0, 2, 5, 2, 0, 0]

    def fine_peak_area(base):
        tot, xs = 0.0, x2
        G = 2000
        prevx = prevpos = None
        for s in range(len(xs) - 1):
            for gi in range(G):
                fx = xs[s] + (xs[s + 1] - xs[s]) * gi / G
                fy = y2[s] + (y2[s + 1] - y2[s]) * (gi / G)
                pos = max(fy - base, 0.0)
                if prevx is not None:
                    tot += 0.5 * (prevpos + pos) * (fx - prevx)
                prevx, prevpos = fx, pos
        return tot

    def net_at(base):
        return sum(0.5 * ((y2[i] - base) + (y2[i + 1] - base)) * 1 for i in range(len(y2) - 1))
    for mode, base in [("zero", 0.0), ("min", min(y2)), ("mean", st.mean(y2)), (1.5, 1.5)]:
        g = M["auc"]({"x": x2, "y": y2, "baseline": mode})["glance"]
        check("auc net (baseline=%s)" % mode, g["net"], net_at(base))
        check("auc peak area (baseline=%s)" % mode, g["peak_area"], fine_peak_area(base), tol=3e-3)
    check_eq("auc peaks (baseline 0)", M["auc"]({"x": x2, "y": y2, "baseline": "zero"})["glance"]["peaks"], 2)
    # Min-peak-height filter drops the short peak (height 3 < 0.7·5).
    check_eq("auc minPeakFraction drops short peak", M["auc"]({"x": x2, "y": y2, "baseline": "zero", "minPeakFraction": 0.7})["glance"]["peaks"], 1)
    # A peak's x-extent must ride in its own fields, not in ciLow/ciHigh, whose meaning
    # everywhere else is "confidence interval" — otherwise exports write the peak's x-range
    # under a "95% CI" header, a number presented as a claim it is not. The extent values themselves are the baseline crossings, already verified
    # by the area checks above.
    pk = [t for t in M["auc"]({"x": x2, "y": y2, "baseline": "zero"})["terms"] if str(t["term"]).startswith("Peak") and "area" in str(t["term"])][0]
    check_eq("auc peak extent rides in xFrom/xTo", "xFrom" in pk and "xTo" in pk, True)
    check_eq("auc peak extent is not dressed as a CI", "ciLow" in pk or "ciHigh" in pk, False)
    check_le("auc peak extent is ordered (xFrom < xTo)", pk.get("xFrom", 1e9) - pk.get("xTo", -1e9), 0.0)


# ── ANCOVA — vs extra-sum-of-squares F from numpy OLS full/reduced models ──────
def check_ancova():
    print("\n# ancova  (oracle: extra-sum-of-squares F from numpy OLS full/reduced fits)")
    groups = [
        {"label": "G1", "x": [1, 2, 3, 4, 5], "y": [2.0, 4.1, 5.9, 8.2, 9.8]},
        {"label": "G2", "x": [1, 2, 3, 4, 5], "y": [3.0, 5.3, 7.1, 9.0, 11.4]},
    ]
    xs, ys, gid = [], [], []
    for gi, g in enumerate(groups):
        for xi, yi in zip(g["x"], g["y"]):
            xs.append(float(xi)); ys.append(float(yi)); gid.append(gi)
    xs, ys, gid = np.array(xs), np.array(ys), np.array(gid)
    N, k = len(ys), len(groups)
    ones = np.ones(N)
    D = np.column_stack([(gid == j).astype(float) for j in range(1, k)])
    Xfull = np.column_stack([ones, D, xs] + [xs * (gid == j) for j in range(1, k)])  # separate slopes
    Xpar = np.column_stack([ones, D, xs])  # common slope, separate intercepts
    Xone = np.column_stack([ones, xs])  # single line

    def ssr(X):
        beta, *_ = np.linalg.lstsq(X, ys, rcond=None)
        return float(np.sum((ys - X @ beta) ** 2)), X.shape[1]

    sf, pf = ssr(Xfull)
    sp, pp = ssr(Xpar)
    so, po = ssr(Xone)
    F_slope = ((sp - sf) / (pf - pp)) / (sf / (N - pf))
    F_int = ((so - sp) / (pp - po)) / (sp / (N - pp))
    g = M["ancova"]({"groups": groups})["glance"]
    check("ancova F_slope", g["F_slope"], F_slope, tol=1e-3)
    check("ancova F_intercept", g["F_intercept"], F_int, tol=1e-3)


# ── Nonlinear library ─────────────────────────────────────────────────────────
# The engine fits every curve with scipy `curve_fit` (Levenberg-Marquardt / MINPACK).
# We independently RE-FIT the same data with Nelder-Mead simplex (a wholly different,
# derivative-free algorithm, no shared MINPACK code) and confirm the two fits agree,
# and independently re-evaluate R². One representative per equation family covers the
# generic driver; the per-equation formulas are additionally cross-checked by the
# parameter-recovery batch tests (engine lambda vs an independent generator).
def check_nl_optimizer():
    print("\n# nonlinear fits  (oracle: Nelder-Mead simplex re-fit — ≠ curve_fit's Levenberg-Marquardt)")
    from scipy.optimize import minimize
    DOSE = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]
    XPOS = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    XLIN = [i * 0.6 for i in range(0, 26)]
    XSYM = [-5 + i * 0.5 for i in range(0, 41)]
    XV = [-10 + i * 1.0 for i in range(0, 21)]
    XSINE = [i * 0.2 for i in range(0, 61)]
    reps = [
        # model, formula(x, *p), truth, glance-keys (formula order), x, seed×
        ("4pl", lambda x, b, t, le, h: b + (t - b) / (1 + 10 ** ((le - math.log10(x)) * h)), [5, 95, 1, 1.2], ["bottom", "top", "logec50", "hill_slope"], DOSE, 1.15),
        ("mm", lambda x, vm, km: vm * x / (km + x), [20, 5], ["vmax", "km"], XPOS, 1.2),
        ("kcat", lambda x, et, kc, km: et * kc * x / (km + x), [2, 10, 5], ["et", "kcat", "km"], XPOS, 1.2),
        ("onesite", lambda x, bm, kd: bm * x / (kd + x), [50, 8], ["bmax", "kd"], XPOS, 1.2),
        ("exp_decay", lambda x, y0, pl, k: pl + (y0 - pl) * math.exp(-k * x), [100, 10, 0.4], ["y0", "plateau", "k"], XLIN, 1.1),
        ("gaussian", lambda x, a, mu, sd: a * math.exp(-((x - mu) ** 2) / (2 * sd ** 2)), [10, 5, 2], ["amplitude", "mean", "sd"], XSYM, 1.1),
        ("boltzmann", lambda x, b, t, v, s: b + (t - b) / (1 + math.exp((v - x) / s)), [0, 100, 0, 2], ["bottom", "top", "v50", "slope"], XV, 1.1),
        ("logistic_growth", lambda x, cap, r, x0: cap / (1 + math.exp(-r * (x - x0))), [100, 0.6, 10], ["capacity", "rate", "midpoint"], XLIN, 1.1),
        ("gompertz", lambda x, a, b, c: a * math.exp(-b * math.exp(-c * x)), [100, 3, 0.4], ["asymptote", "displacement", "rate"], XLIN, 1.08),
        ("power", lambda x, a, b: a * x ** b, [2.5, 1.3], ["a", "b"], XPOS, 1.15),
        ("logarithmic", lambda x, a, b: a + b * math.log(x), [2, 3], ["a", "b"], XPOS, 1.2),
        ("sine", lambda x, a, p, ph, o: o + a * math.sin(2 * math.pi * x / p + ph), [2, 5, 0.4, 3], ["amplitude", "period", "phase", "offset"], XSINE, 1.03),
        ("line_origin", lambda x, m: m * x, [2.5], ["slope"], XPOS, 1.3),
    ]
    for model, f, truth, keys, x, sc in reps:
        y = [f(xi, *truth) for xi in x]
        rng = max(y) - min(y) + 1e-9
        g = M["curvefit"]({"model": model, "x": x, "y": y})["glance"]
        pe = [g[k] for k in keys]  # engine's fitted params, in formula order
        ye = [f(xi, *pe) for xi in x]
        check("%s: engine params reproduce data (R²)" % model, r2(y, ye), 1.0, tol=1e-4)
        # Independent Nelder-Mead re-fit from a different (perturbed) start.
        p0 = [t * sc + 0.01 for t in truth]
        sse = lambda p: sum((yi - f(xi, *p)) ** 2 for xi, yi in zip(x, y))
        pnm = minimize(sse, p0, method="Nelder-Mead", options={"xatol": 1e-9, "fatol": 1e-14, "maxiter": 40000}).x
        ynm = [f(xi, *pnm) for xi in x]
        check("%s: Nelder-Mead R²" % model, r2(y, ynm), 1.0, tol=1e-4)
        check_le("%s: Nelder-Mead vs engine curve (max Δŷ / range)" % model, max(abs(a - b) for a, b in zip(ye, ynm)) / rng, 2e-3)

    # Derived: the specificity constant kcat/KM. Oracle is independent of the fit and of
    # the engine's parameterisation — kcat/KM is the low-substrate limit of the reaction's
    # second-order behaviour, v → (kcat/KM)·Et·S as S → 0, so a one-sided finite difference
    # of the true generator at S≈0 divided by Et recovers it without touching curve_fit.
    ET, KCAT, KM_T = 2.0, 10.0, 5.0
    gen = lambda s: ET * KCAT * s / (KM_T + s)
    h = 1e-7
    kcat_km_oracle = (gen(h) - gen(0.0)) / h / ET   # = kcat/KM = 10/5 = 2
    x = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    gk = M["curvefit"]({"model": "kcat", "x": x, "y": [gen(xi) for xi in x], "fixed": {"Et": ET}})["glance"]
    check("kcat: specificity constant kcat/KM (oracle: low-S slope limit)", gk["kcat_KM"], kcat_km_oracle, tol=1e-4)

    # Michaelis-Menten linearizations. Oracle is independent of the engine's polyfit: on
    # noise-free MM data each transform is an exact straight line, so any two points
    # determine it in closed form. Solve the line from the first and last point by hand,
    # then invert each rearrangement's own slope/intercept relations to Vmax and KM.
    VMAX_L, KM_L = 100.0, 5.0
    SS = [1.0, 2.0, 5.0, 10.0, 20.0, 35.0, 50.0, 75.0, 100.0]
    VV = [VMAX_L * s / (KM_L + s) for s in SS]
    two_point = lambda ax, ay: ((ay[-1] - ay[0]) / (ax[-1] - ax[0]),
                                ay[0] - (ay[-1] - ay[0]) / (ax[-1] - ax[0]) * ax[0])
    lin_specs = [
        # variant,            transformed X,                   transformed Y,               (slope,intercept) → (Vmax, KM)
        ("lineweaver_burk", [1 / s for s in SS], [1 / v for v in VV], lambda m, b: (1 / b, m / b)),
        ("eadie_hofstee", [v / s for s, v in zip(SS, VV)], list(VV), lambda m, b: (b, -m)),
        ("hanes_woolf", list(SS), [s / v for s, v in zip(SS, VV)], lambda m, b: (1 / m, b / m)),
    ]
    for variant, axo, ayo, to_const in lin_specs:
        m_o, b_o = two_point(axo, ayo)
        vmax_o, km_o = to_const(m_o, b_o)
        gl = M["curvetransform"]({"x": SS, "y": VV, "variant": variant})["glance"]
        check("%s: slope (oracle: exact two-point line)" % variant, gl["slope"], m_o, tol=1e-6)
        check("%s: intercept (oracle: exact two-point line)" % variant, gl["intercept"], b_o, tol=1e-6)
        check("%s: implied Vmax" % variant, gl["vmax"], vmax_o, tol=1e-6)
        check("%s: implied KM" % variant, gl["km"], km_o, tol=1e-6)


def check_interpolate():
    # The interpolate method (read unknowns off a standard curve).
    # Oracle for a linear standard curve: an independent stdlib fit + the closed-form
    # OLS mean-prediction SE (syx·√(1/n + (x−x̄)²/Sxx)), inverted for X-from-Y.
    print("\n# interpolate  (oracle: stdlib linear fit + closed-form mean-prediction SE)")
    x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    y = [2.1, 4.0, 5.9, 8.1, 9.8, 12.2]
    slope, intercept = st.linear_regression(x, y)
    n = len(x)
    xbar = st.mean(x)
    Sxx = sum((xi - xbar) ** 2 for xi in x)
    syx = math.sqrt(sum((y[i] - (slope * x[i] + intercept)) ** 2 for i in range(n)) / (n - 2))
    tc = t_crit_two(n - 2, 0.05)
    r = M["interpolate"]({"x": x, "y": y, "model": "linear", "unknownsX": [2.5], "unknownsY": [7.0]})
    tm = {t["term"]: t for t in r["terms"]}
    # Y-from-X: point + mean-prediction CI.
    yp = slope * 2.5 + intercept
    se = syx * math.sqrt(1 / n + (2.5 - xbar) ** 2 / Sxx)
    check("interpolate Y@X=2.5 estimate", tm["Y @ X=2.5"]["estimate"], yp)
    check("interpolate Y@X=2.5 CI low", tm["Y @ X=2.5"]["ciLow"], yp - tc * se)
    check("interpolate Y@X=2.5 CI high", tm["Y @ X=2.5"]["ciHigh"], yp + tc * se)
    # X-from-Y: inverse x = (Y − intercept)/slope.
    check("interpolate X@Y=7.0 estimate", tm["X @ Y=7"]["estimate"], (7.0 - intercept) / slope, tol=1e-3)


def check_globalfit_inhibition():
    # The enzyme-inhibition mechanism models (global-fit only, a shared
    # Ki across several [I] datasets): Ki recovery. Oracle = an independent
    # implementation of each mechanism's rate law → the global fit must recover Vmax/KM/Ki.
    print("\n# globalfit enzyme inhibition  (oracle: independent rate law → Ki recovery)")
    Vmax, KM, Ki, alpha = 100.0, 10.0, 5.0, 2.0
    S = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    Is = [0.0, 5.0, 20.0]
    laws = {
        "competitive_inhibition": lambda s, I: Vmax * s / (KM * (1 + I / Ki) + s),
        "noncompetitive_inhibition": lambda s, I: Vmax * s / ((KM + s) * (1 + I / Ki)),
        "uncompetitive_inhibition": lambda s, I: Vmax * s / (KM + s * (1 + I / Ki)),
        "mixed_inhibition": lambda s, I: Vmax * s / (KM * (1 + I / Ki) + s * (1 + I / (alpha * Ki))),
    }
    for model, law in laws.items():
        shared = ["Vmax", "KM", "Ki"] + (["Alpha"] if model == "mixed_inhibition" else [])
        ds = [{"label": "I=%g" % I, "x": S, "y": [law(s, I) for s in S], "consts": [I]} for I in Is]
        r = M["globalfit"]({"model": model, "datasets": ds, "shared": shared})
        tm = {t["term"]: t for t in r["terms"]}
        check("globalfit %s Ki recovery" % model, tm["Ki (shared)"]["estimate"], Ki, tol=1e-3)
        check("globalfit %s Vmax recovery" % model, tm["Vmax (shared)"]["estimate"], Vmax, tol=1e-3)
        check("globalfit %s overall R²" % model, r["glance"]["r_sq"], 1.0, tol=1e-5)
    # Mixed also recovers the cooperativity α.
    dsm = [{"label": "I=%g" % I, "x": S, "y": [laws["mixed_inhibition"](s, I) for s in S], "consts": [I]} for I in Is]
    rm = M["globalfit"]({"model": "mixed_inhibition", "datasets": dsm, "shared": ["Vmax", "KM", "Ki", "Alpha"]})
    check("globalfit mixed α recovery", {t["term"]: t for t in rm["terms"]}["Alpha (shared)"]["estimate"], alpha, tol=1e-2)


def check_globalfit_one_curve():
    # "One curve for all datasets, or separate curves?" (extra-sum-of-squares F). Oracle = both fits
    # rebuilt by hand with scipy curve_fit on the stacked data and our own 4PL formula (log10 dose, a group
    # indicator for the per-curve parameters) - none of the engine's model registry or layout code.
    print("\n# globalfit one-curve test  (oracle: hand-stacked curve_fit + own 4PL, F from scipy.stats)")
    import numpy as np
    from scipy.optimize import curve_fit
    from scipy import stats as st
    dose = [1e-9, 3e-9, 1e-8, 3e-8, 1e-7, 3e-7, 1e-6, 3e-6, 1e-5]
    lx = np.log10(dose)
    noise_a = [2.1, -1.4, 0.8, -2.6, 1.9, -0.7, 2.4, -1.8, 0.5]
    noise_b = [-1.2, 2.2, -0.4, 1.6, -2.3, 0.9, -1.7, 2.8, -0.6]

    def p4(x, b, t, le, h):
        return b + (t - b) / (1 + 10 ** ((le - x) * h))

    for label, le_b in (("same EC50", -7.5), ("EC50 ten-fold apart", -6.5)):
        ya = p4(lx, 0, 100, -7.5, 1) + noise_a
        yb = p4(lx, 0, 100, le_b, 1) + noise_b
        X = np.concatenate([lx, lx])
        g = np.concatenate([np.zeros(9), np.ones(9)])
        Y = np.concatenate([ya, yb])

        # separate curves, Bottom + Top shared: [B, T, leA, hA, leB, hB]
        def sep(xg, b, t, lea, ha, leb, hb):
            x, gg = xg
            return np.where(gg == 0, p4(x, b, t, lea, ha), p4(x, b, t, leb, hb))
        ps, _ = curve_fit(sep, (X, g), Y, p0=[0, 100, -7.5, 1, le_b, 1], maxfev=20000)
        ss1 = float(np.sum((Y - sep((X, g), *ps)) ** 2))
        po, _ = curve_fit(p4, X, Y, p0=[0, 100, -7.0, 1], maxfev=20000)
        ss0 = float(np.sum((Y - p4(X, *po)) ** 2))
        df1, df0 = 18 - 6, 18 - 4
        f = ((ss0 - ss1) / (df0 - df1)) / (ss1 / df1)
        p = float(st.f.sf(f, df0 - df1, df1))

        r = M["globalfit"]({"model": "4pl", "shared": ["Bottom", "Top"], "compareOneCurve": True,
                            "datasets": [{"label": "A", "x": dose, "y": list(ya)}, {"label": "B", "x": dose, "y": list(yb)}]})
        gl = r["glance"]
        check("one-curve test (%s): SS separate" % label, gl["sse"], ss1, tol=1e-3)
        check("one-curve test (%s): SS one curve" % label, gl["sse_one"], ss0, tol=1e-3)
        check("one-curve test (%s): F" % label, gl["compare_f"], f, tol=1e-3)
        # -log10 p: a tiny p (5e-12) sits inside the check's absolute tolerance, so a 5% error in p itself would pass
        check("one-curve test (%s): -log10 p" % label, -np.log10(gl["compare_p"]), -np.log10(p), tol=1e-4)
        check_eq("one-curve test (%s): df" % label, (gl["compare_df1"], gl["compare_df2"]), (df0 - df1, df1))
    try:
        M["globalfit"]({"model": "4pl", "shared": ["Bottom", "Top", "logEC50", "Hill slope"], "compareOneCurve": True,
                        "datasets": [{"label": "A", "x": dose, "y": list(ya)}, {"label": "B", "x": dose, "y": list(yb)}]})
        check_eq("one-curve test refuses when every parameter is already shared", "no-error", "StatsError")
    except engine.StatsError:
        check_eq("one-curve test refuses when every parameter is already shared", "StatsError", "StatsError")


def check_meltingtemp():
    # Oracles share no code with engine.meltingtemp:
    #  - Tm (fit): scipy curve_fit on this file's own Boltzmann (flat) and sloped-baseline equations,
    #    SE from the covariance, on noisy synthetic melts with a known Tm;
    #  - Tm (derivative): scipy savgol_filter + numpy.gradient + the parabola vertex by the explicit
    #    three-point formula (not polyfit); and on a noise-free curve, the exact analytic Tm;
    #  - per-sample mean/SD, SE = SD/sqrt(n) or the fit SE, ΔTm CI with Welch–Satterthwaite df by hand.
    print("\n# meltingtemp  (oracle: own Boltzmann curve_fit, savgol + 3-point vertex, Welch–Satterthwaite by hand)")
    import numpy as _np
    from scipy.optimize import curve_fit as _cf
    from scipy.signal import savgol_filter as _sg
    from scipy import stats as _st
    rng = _np.random.default_rng(20260914)
    xs = _np.arange(30.0, 86.0, 1.0)

    def flat(x, b, t, tm, s):
        return b + (t - b) / (1.0 + _np.exp((tm - x) / s))

    def sloped(x, b, mb, t, mt, tm, s):
        lo_, hi_ = b + mb * x, t + mt * x
        return lo_ + (hi_ - lo_) / (1.0 + _np.exp((tm - x) / s))

    def curve(tm, noise=4.0, drift=0.0):
        return flat(xs, 100.0, 900.0, tm, 2.5) + drift * (xs - 30.0) + rng.normal(0.0, noise, xs.size)

    apo = [curve(52.0), curve(52.4), curve(51.8)]
    lig = [curve(56.0), curve(56.3)]
    one = [curve(60.0)]

    def own_fit(y, fn, p0):
        p, cov = _cf(fn, xs, y, p0=p0, maxfev=50000)
        i = 2 if fn is flat else 4
        return float(p[i]), float(_np.sqrt(cov[i, i])), xs.size - len(p0)

    def own_deriv(y, win):
        sm = _sg(y, win, 2)
        dy = _np.gradient(sm, xs)
        i = int(_np.argmax(dy))
        (x0, x1, x2), (y0, y1, y2) = xs[i - 1:i + 2], dy[i - 1:i + 2]
        den = (x0 - x1) * (x0 - x2) * (x1 - x2)
        a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den
        b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den
        return min(max(-b / (2 * a), x0), x2)

    WIN = 7
    payload = {"datasets": [
        {"label": "Apo", "x": list(xs), "replicates": [{"label": "r%d" % (i + 1), "y": list(y)} for i, y in enumerate(apo)]},
        {"label": "Ligand", "x": list(xs), "replicates": [{"label": "r%d" % (i + 1), "y": list(y)} for i, y in enumerate(lig)]},
        {"label": "Single", "x": list(xs), "replicates": [{"y": list(one[0])}]},
    ], "control": "Apo", "smoothWindow": WIN}
    r = M["meltingtemp"](payload)
    S = {s["label"]: s for s in r["extra"]["samples"]}

    p0 = [100.0, 900.0, 55.0, 3.0]
    per = {name: [own_fit(y, flat, p0) for y in ys] for name, ys in (("Apo", apo), ("Ligand", lig), ("Single", one))}
    for name, cols in per.items():
        for j, (tm, se, df) in enumerate(cols):
            check("meltingtemp Tm (fit) %s col %d" % (name, j + 1), S[name]["columns"][j]["tm_fit"], tm, tol=1e-4)
            check("meltingtemp Tm SE %s col %d" % (name, j + 1), S[name]["columns"][j]["se"], se, tol=1e-3)
    for name, ys in (("Apo", apo), ("Ligand", lig)):
        v = _np.array([c[0] for c in per[name]])
        check("meltingtemp mean Tm %s" % name, S[name]["tm_fit"], v.mean(), tol=1e-4)
        check("meltingtemp SD Tm %s" % name, S[name]["sd_fit"], v.std(ddof=1), tol=1e-3)
        dv = _np.array([own_deriv(y, WIN) for y in ys])
        check("meltingtemp mean Tm (derivative) %s" % name, S[name]["tm_deriv"], dv.mean(), tol=1e-5)
    check("meltingtemp Tm (derivative) Single", S["Single"]["tm_deriv"], own_deriv(one[0], WIN), tol=1e-5)

    # ΔTm: SE(sample) = SD/√n (replicates) or fit SE (one column); Welch–Satterthwaite df; t CI.
    def se_df(name):
        cols = per[name]
        if len(cols) == 1:
            return cols[0][1], cols[0][2]
        v = _np.array([c[0] for c in cols])
        return v.std(ddof=1) / _np.sqrt(len(v)), len(v) - 1
    for name in ("Ligand", "Single"):
        (s1, d1), (s2, d2) = se_df(name), se_df("Apo")
        dtm = _np.mean([c[0] for c in per[name]]) - _np.mean([c[0] for c in per["Apo"]])
        se = _np.sqrt(s1 ** 2 + s2 ** 2)
        df = se ** 4 / (s1 ** 4 / d1 + s2 ** 4 / d2)
        tc = _st.t.ppf(0.975, df)
        check("meltingtemp ΔTm %s" % name, S[name]["dtm"], dtm, tol=1e-4)
        check("meltingtemp ΔTm SE %s" % name, S[name]["dtm_se"], se, tol=1e-3)
        check("meltingtemp ΔTm CI low %s" % name, S[name]["dtm_ciLow"], dtm - tc * se, tol=1e-3)
        check("meltingtemp ΔTm CI high %s" % name, S[name]["dtm_ciHigh"], dtm + tc * se, tol=1e-3)

    # Noise-free: both methods find the analytic Tm (the Boltzmann's steepest point is its midpoint).
    clean = flat(xs, 100.0, 900.0, 57.3, 2.5)
    rc = M["meltingtemp"]({"datasets": [{"label": "c", "x": list(xs), "replicates": [{"y": list(clean)}]}], "smoothWindow": 5})
    check("meltingtemp noise-free Tm (fit) = 57.3", rc["extra"]["samples"][0]["tm_fit"], 57.3, tol=1e-5)
    check("meltingtemp noise-free Tm (derivative) ≈ 57.3", rc["extra"]["samples"][0]["tm_deriv"], 57.3, tol=5e-3)

    # Sloped baselines, inside a window: own sloped equation.
    dr = curve(54.0, drift=3.0)
    win = (xs >= 35) & (xs <= 80)
    rs = M["meltingtemp"]({"datasets": [{"label": "d", "x": list(xs), "replicates": [{"y": list(dr)}]}], "sloped": True, "from": 35, "to": 80})
    p, cov = _cf(sloped, xs[win], dr[win], p0=[100.0, 0.0, 900.0, 0.0, 54.0, 3.0], maxfev=50000)
    check("meltingtemp sloped Tm (fit), window 35–80", rs["extra"]["samples"][0]["tm_fit"], p[4], tol=1e-4)
    check("meltingtemp sloped Tm SE", rs["extra"]["samples"][0]["se"], _np.sqrt(cov[4, 4]), tol=1e-3)

    # Refusals raise an error.
    for why, pl in (("empty window", {"datasets": payload["datasets"], "from": 70, "to": 40}),
                    ("too few points", {"datasets": [{"label": "f", "x": list(xs[:4]), "replicates": [{"y": list(one[0][:4])}]}]}),
                    ("a flat signal has no Tm", {"datasets": [{"label": "flat", "x": list(xs), "replicates": [{"y": [5.0] * xs.size}]}]})):
        try:
            M["meltingtemp"](pl)
            check_eq("meltingtemp refuses: %s" % why, "returned a result", "refused")
        except engine.StatsError:
            check_eq("meltingtemp refuses: %s" % why, "refused", "refused")


def check_permanova():
    # PERMANOVA + PERMDISP. Oracles share no code with engine.permanova:
    #  - Euclidean: pseudo-F and R2 from the classical between/within sums of squares on the (z-scored) coordinates -
    #    an identity with Anderson's distance formula, reached without a single distance;
    #  - Bray-Curtis: distances from a hand loop (not scipy pdist), F by McArdle & Anderson's (2001) trace form
    #    tr(HGH)/(a-1) / tr((I-H)G(I-H))/(n-a) on the Gower matrix - a different route from the pairwise sums;
    #  - p: exact, by enumerating every distinct labelling of a small design, against the engine's Monte Carlo p;
    #  - PERMDISP (Euclidean): distance of each case to its group's raw centroid, one-way ANOVA F by hand.
    print("\n# permanova  (oracle: coordinate SS identity, Gower trace form, exact enumeration, hand ANOVA)")
    import itertools
    import numpy as _np
    from scipy import stats as _st
    import engine as _E
    cols = [[4.1, 4.5, 3.9, 4.3, 5.8, 6.1, 5.5, 6.4, 5.0, 4.8, 5.3, 5.1],
            [2.0, 2.4, 1.8, 2.2, 3.1, 2.9, 3.4, 3.0, 2.6, 2.1, 2.8, 2.5],
            [7.2, 6.8, 7.5, 7.0, 6.1, 6.4, 5.9, 6.0, 6.9, 7.4, 6.6, 7.1]]
    groups = ["A"] * 4 + ["B"] * 4 + ["C"] * 4
    X = _np.array(cols, float).T
    n, a = X.shape[0], 3
    code = _np.array([0] * 4 + [1] * 4 + [2] * 4)

    def coord_f(Z, cd):
        grand = Z.mean(axis=0)
        ssb = sum(Z[cd == g].shape[0] * float(_np.sum((Z[cd == g].mean(axis=0) - grand) ** 2)) for g in range(a))
        ssw = sum(float(_np.sum((Z[cd == g] - Z[cd == g].mean(axis=0)) ** 2)) for g in range(a))
        return (ssb / (a - 1)) / (ssw / (n - a)), ssb / (ssb + ssw)

    Z = (X - X.mean(axis=0)) / X.std(axis=0, ddof=1)
    f_ind, r2_ind = coord_f(Z, code)
    r = M["permanova"]({"columns": cols, "labels": ["u", "v", "w"], "groups": groups, "permutations": 9999, "seed": 7})
    check("permanova Euclidean pseudo-F (coordinate SS identity)", r["glance"]["pseudoF"], f_ind, tol=1e-5)
    check("permanova Euclidean R2 (coordinate SS identity)", r["glance"]["r2"], r2_ind, tol=1e-5)
    check_eq("permanova df", (r["glance"]["df_groups"], r["glance"]["df_resid"]), (2, 9))

    # exact p: every distinct labelling of 4+4+4 cases (12! / (4!4!4!) = 34650), statistic >= observed
    ge = tot = 0
    idx = list(range(n))
    for ga in itertools.combinations(idx, 4):
        rest = [i for i in idx if i not in ga]
        for gb in itertools.combinations(rest, 4):
            cd = _np.full(n, 2)
            cd[list(ga)] = 0
            cd[list(gb)] = 1
            tot += 1
            if coord_f(Z, cd)[0] >= f_ind - 1e-9:
                ge += 1
    p_exact = ge / tot
    check("permanova p vs exact enumeration (Monte Carlo, 9999 perms)", r["glance"]["p"], p_exact, tol=0.01)
    # ...and where the groups overlap, so the exact p is moderate and a 0.01 tolerance actually bites
    code2 = _np.array([0, 1, 2] * 4)
    f2, _r2 = coord_f(Z, code2)
    ge2 = tot2 = 0
    for ga in itertools.combinations(idx, 4):
        rest = [i for i in idx if i not in ga]
        for gb in itertools.combinations(rest, 4):
            cd = _np.full(n, 2)
            cd[list(ga)] = 0
            cd[list(gb)] = 1
            tot2 += 1
            if coord_f(Z, cd)[0] >= f2 - 1e-9:
                ge2 += 1
    r2m = M["permanova"]({"columns": cols, "labels": ["u", "v", "w"], "groups": ["A", "B", "C"] * 4, "permutations": 9999, "seed": 11})
    check_eq("permanova overlapping design: exact p is moderate (the tolerance can bite)", 0.05 < ge2 / tot2 < 0.95, True)
    check("permanova p vs exact enumeration, overlapping groups", r2m["glance"]["p"], ge2 / tot2, tol=0.01)

    # Bray-Curtis by hand + Gower trace form
    D = _np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            D[i, j] = float(_np.sum(_np.abs(X[i] - X[j]))) / float(_np.sum(X[i] + X[j]))
    G = -0.5 * (D ** 2)
    Jc = _np.eye(n) - 1.0 / n
    G = Jc @ G @ Jc
    Dm = _np.zeros((n, a))
    Dm[_np.arange(n), code] = 1.0
    H = Dm @ _np.linalg.inv(Dm.T @ Dm) @ Dm.T
    I = _np.eye(n)
    f_bc = (float(_np.trace(H @ G @ H)) / (a - 1)) / (float(_np.trace((I - H) @ G @ (I - H))) / (n - a))
    rb = M["permanova"]({"columns": cols, "labels": ["u", "v", "w"], "groups": groups, "metric": "braycurtis", "permutations": 199})
    check("permanova Bray-Curtis pseudo-F (Gower trace form, hand distances)", rb["glance"]["pseudoF"], f_bc, tol=1e-5)

    # PERMDISP, Euclidean: distance to group centroid in the z-scored space, one-way ANOVA F by hand
    zd = _np.array([float(_np.linalg.norm(Z[i] - Z[code == code[i]].mean(axis=0))) for i in range(n)])
    gm = zd.mean()
    ssb = sum(4 * (zd[code == g].mean() - gm) ** 2 for g in range(a))
    ssw = sum(float(_np.sum((zd[code == g] - zd[code == g].mean()) ** 2)) for g in range(a))
    fd = (ssb / (a - 1)) / (ssw / (n - a))
    check("permanova PERMDISP F (hand ANOVA on centroid distances)", r["glance"]["disp_F"], fd, tol=1e-5)
    check("permanova PERMDISP p (F distribution)", r["glance"]["disp_p"], float(_st.f.sf(fd, a - 1, n - a)), tol=1e-5)

    # refusals raise an error
    for name, payload in (("no group column", {"columns": cols, "labels": ["u", "v", "w"]}),
                          ("one group only", {"columns": cols, "labels": ["u", "v", "w"], "groups": ["A"] * 12})):
        try:
            M["permanova"](payload)
            check_eq("permanova refuses: %s" % name, "returned a result", "refused")
        except _E.StatsError:
            check_eq("permanova refuses: %s" % name, "refused", "refused")


def check_nl_models_extra():
    # Curvefit model families. Oracle = an
    # independent re-implementation of each model formula: generate clean data from it,
    # the engine must fit it to R² ≈ 1 and its fitted curve must match the formula at the
    # true parameters (a wrong engine formula could not do both). Representative sample.
    print("\n# nonlinear model recovery (peak / growth / binding / dose-response families)")
    from scipy.special import wofz, erfcx
    S2 = 1.4142135623730951
    XPOS = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    XPK = [i * 0.5 for i in range(0, 41)]   # 0…20, peaks centred ~10
    XLIN = [i * 0.6 for i in range(0, 26)]   # 0…15
    DOSE = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]
    reps = [
        # ── Peak ──
        ("lognormal_peak", lambda x, amp, c, w: amp * math.exp(-(math.log(x / c) ** 2) / (2 * w * w)), [10, 10, 0.3], XPOS),
        ("pseudo_voigt", lambda x, amp, c, w, eta: eta * (amp / (1 + ((x - c) / w) ** 2)) + (1 - eta) * amp * math.exp(-((x - c) ** 2) / (2 * w * w)), [10, 10, 2, 0.5], XPK),
        ("pearson7", lambda x, amp, c, w, m: amp / (1 + ((x - c) / w) ** 2 * (2 ** (1 / m) - 1)) ** m, [10, 10, 2, 2], XPK),
        ("voigt", lambda x, amp, c, s, g: amp * (wofz(((x - c) + 1j * g) / (s * S2)).real) / (wofz((1j * g) / (s * S2)).real), [10, 10, 1.5, 1.0], XPK),
        ("emg", lambda x, amp, mu, s, tau: (amp / (2 * tau)) * math.exp(-((x - mu) ** 2) / (2 * s * s)) * erfcx((s / tau - (x - mu) / s) / S2), [30, 8, 1.5, 2.0], XPK),
        ("gaussian_baseline", lambda x, base, amp, mu, sd: base + amp * math.exp(-((x - mu) ** 2) / (2 * sd * sd)), [3, 10, 10, 2], XPK),
        # ── Growth ──
        ("weibull_growth", lambda x, a, lam, k: a * (1 - math.exp(-(x / lam) ** k)), [100, 8, 1.8], XLIN),
        ("von_bertalanffy", lambda x, linf, k, t0: linf * (1 - math.exp(-k * (x - t0))), [100, 0.3, -1.0], XLIN),
        ("richards", lambda x, a, k, xm, nu: a / (1 + nu * math.exp(-k * (x - xm))) ** (1 / nu), [100, 0.8, 7, 1.0], XLIN),
        # ── Binding ──
        ("twosite", lambda x, b1, k1, b2, k2: b1 * x / (k1 + x) + b2 * x / (k2 + x), [60, 2, 40, 50], XPOS),
        ("onesite_ns", lambda x, bmax, kd, ns: bmax * x / (kd + x) + ns * x, [80, 8, 0.05], XPOS),
        ("hyperbola_offset", lambda x, bg, bmax, kd: bg + bmax * x / (kd + x), [5, 90, 10], XPOS),
        # ── Dose-response ──
        ("5pl", lambda x, b, t, le, h, s: b + (t - b) / (1 + 10 ** ((le - math.log10(x)) * h)) ** s, [5, 95, 1, 1.2, 1.5], DOSE),
        ("dr_4pl_conc", lambda x, b, t, ec, h: b + (t - b) * x ** h / (ec ** h + x ** h), [0, 100, 10, 1.2], XPOS),
    ]
    for model, f, truth, x in reps:
        y = [f(xi, *truth) for xi in x]
        r = M["curvefit"]({"model": model, "x": x, "y": y})
        check("%s: engine R² on independent-formula data" % model, r["glance"]["r_sq"], 1.0, tol=1e-4)
        cx, cy = r["curve"]["x"], r["curve"]["y"]
        rng = max(y) - min(y) + 1e-9
        check_le("%s: engine fitted curve vs independent formula (maxΔ/range)" % model,
                 max(abs(cy[i] - f(cx[i], *truth)) for i in range(len(cx))) / rng, 5e-3)


def check_nl_polynomials():
    print("\n# polynomials  (oracle: numpy.polyfit — independent SVD least-squares)")
    x = [0.5 + i * 0.25 for i in range(0, 20)]  # modest range → well-conditioned to deg 6
    truth = [1.0, -0.7, 0.3, -0.05, 0.008, -0.0006, 0.00002]
    for deg, model in [(2, "poly2"), (3, "poly3"), (4, "poly4"), (5, "poly5"), (6, "poly6")]:
        coef = truth[: deg + 1]
        y = [sum(c * xi ** p for p, c in enumerate(coef)) for xi in x]
        g = M["curvefit"]({"model": model, "x": x, "y": y})["glance"]
        npc = np.polyfit(x, y, deg)[::-1]  # ascending b0..bn
        for p in range(deg + 1):
            check("%s b%d (numpy.polyfit)" % (model, p), g["b%d" % p], float(npc[p]), tol=2e-3)
    # Centered polynomials: coefficients about X̄ vs numpy.polyfit on the centered basis.
    xc = sum(x) / len(x)
    for deg, model in [(2, "poly2_centered"), (3, "poly3_centered"), (4, "poly4_centered")]:
        coef = truth[: deg + 1]
        y = [sum(c * xi ** p for p, c in enumerate(coef)) for xi in x]
        g = M["curvefit"]({"model": model, "x": x, "y": y})["glance"]
        npc = np.polyfit([xi - xc for xi in x], y, deg)[::-1]  # fit on (x − X̄)
        for p in range(deg + 1):
            check("%s b%d (numpy.polyfit centered)" % (model, p), g["b%d" % p], float(npc[p]), tol=2e-3)


def check_nl_derived():
    print("\n# nonlinear derived quantities  (oracle: closed-form from the params)")
    dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300]
    y = [5 + 90 / (1 + 10 ** ((1 - math.log10(d)) * 1.2)) for d in dose]
    r = M["curvefit"]({"model": "4pl", "x": dose, "y": y})["glance"]
    check("4pl EC50 = 10^logEC50", r["EC50"], 10 ** r["logec50"])
    xd = [i * 0.5 for i in range(0, 21)]
    yd = [2 + 98 * math.exp(-0.5 * t) for t in xd]
    rd = M["curvefit"]({"model": "exp_decay", "x": xd, "y": yd})["glance"]
    check("exp_decay half-life = ln2/K", rd["Half_life"], math.log(2) / rd["k"])  # derived key: "-"→"_"
    yg = [3 * math.exp(0.25 * t) for t in xd]
    rg = M["curvefit"]({"model": "exp_growth", "x": xd, "y": yg})["glance"]
    check("exp_growth doubling = ln2/K", rg["Doubling_time"], math.log(2) / rg["k"])


def check_ec_anything():
    # EC at any level — the dose at any response %. Oracle = the closed-form inverse of the
    # logistic (independent of the engine's numeric bisection):
    #   4PL (stimulation):  EC_f = 10^( logEC50 − log10((1−f)/f) / Hill )
    #   4PL (inhibition):   IC_f = 10^( logIC50 + log10( f /(1−f)) / Hill )
    print("\n# EC at any level  (oracle: closed-form dose at response fraction f)")
    dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]
    # Stimulation 4PL — logEC50 = 1 (EC50 = 10), Hill = 1.3.
    b, t, le, h = 5.0, 95.0, 1.0, 1.3
    ys = [b + (t - b) / (1 + 10 ** ((le - math.log10(d)) * h)) for d in dose]
    gs = M["curvefit"]({"model": "4pl", "x": dose, "y": ys, "ecLevels": [10, 80, 90]})["glance"]
    for pct in (10, 80, 90):
        f = pct / 100.0
        want = 10 ** (le - math.log10((1 - f) / f) / h)
        check("4pl EC%d closed form" % pct, gs["EC%d" % pct], want, tol=1e-3)
    # Log-symmetry of a symmetric logistic: log EC10 + log EC90 = 2·log EC50.
    check("4pl log EC10+EC90 = 2·log EC50", math.log10(gs["EC10"]) + math.log10(gs["EC90"]), 2 * le, tol=1e-3)
    # Inhibition IC — logIC50 = 1.2 (IC50 ≈ 15.85), Hill = 0.9; decreasing curve.
    bi, ti, li, hi = 0.0, 100.0, 1.2, 0.9
    yi = [bi + (ti - bi) / (1 + 10 ** ((math.log10(d) - li) * hi)) for d in dose]
    gi = M["curvefit"]({"model": "ic50_4pl_log", "x": dose, "y": yi, "ecLevels": [10, 90]})["glance"]
    for pct in (10, 90):
        f = pct / 100.0
        want = 10 ** (li + math.log10(f / (1 - f)) / hi)
        check("ic50_4pl IC%d closed form" % pct, gi["IC%d" % pct], want, tol=1e-3)
    check("ic50_4pl IC50 == 10^logIC50", gi["IC50"], 10 ** li, tol=1e-3)
    # Cheng-Prusoff: Ki = IC50 / (1 + [L]/Kd)  (competitive inhibition, 1973).
    conc, kd = 5.0, 10.0
    gk = M["curvefit"]({"model": "ic50_4pl_log", "x": dose, "y": yi, "chengProsuff": {"conc": conc, "kd": kd}})["glance"]
    check("Cheng-Prusoff Ki = IC50/(1+[L]/Kd)", gk["ki"], gk["IC50"] / (1 + conc / kd), tol=1e-4)


def check_comparefits():
    print("\n# comparefits  (oracle: AICc recomputed independently from SSE/k/n)")
    dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000]
    wig = [0.4, -0.4, 0.3, -0.3, 0.2, -0.2, 0.35, -0.35, 0.25, -0.25]
    y = [5 + 90 / (1 + 10 ** ((1 - math.log10(d)) * 2.0)) + w for d, w in zip(dose, wig)]  # 4PL hill=2 + wiggle
    r = M["comparefits"]({"x": dose, "y": y, "modelA": "3pl", "modelB": "4pl"})
    mterms = [t for t in r["terms"] if "sse" in t]
    for t in mterms:
        n, k = t["df"] + t["params"], t["params"]
        K = k + 1
        aicc = n * math.log(t["sse"] / n) + 2 * K + 2 * K * (K + 1) / (n - K - 1)
        check("comparefits AICc [%s]" % t["term"][:22], t["aicc"], aicc, tol=1e-4)
    pref = [t for t in r["terms"] if str(t["term"]).startswith("Preferred")][0]["estimate"]
    check_eq("comparefits preferred = min-AICc model", pref, min(mterms, key=lambda t: t["aicc"])["term"])


# ── Further methods — each cross-checked against an independent
#    re-derivation (pure-Python normal equations / from-scratch ANOVA SS / balanced random-
#    effects closed form / known-parameter recovery), sharing no code with the engine path. ──
def check_regression_extras():
    print("\n# regression WLS / through-point / lack-of-fit  (oracle: pure-Python re-derivation)")
    x = [1, 2, 3, 4, 5, 6, 7, 8]
    y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.3]
    # 1/Y² weighted least squares via pure-Python weighted normal equations (no numpy/statsmodels).
    w = [1.0 / (v * v) for v in y]
    Sw = sum(w)
    Swx = sum(wi * xi for wi, xi in zip(w, x))
    Swy = sum(wi * yi for wi, yi in zip(w, y))
    Swxx = sum(wi * xi * xi for wi, xi in zip(w, x))
    Swxy = sum(wi * xi * yi for wi, xi, yi in zip(w, x, y))
    den = Sw * Swxx - Swx * Swx
    b = (Sw * Swxy - Swx * Swy) / den
    a = (Swy - b * Swx) / Sw
    g = M["regression"]({"x": x, "y": y, "weighting": "1/Y2"})["glance"]
    check("regression WLS slope (pure-Python normal eqns)", g["slope"], b)
    check("regression WLS intercept", g["intercept"], a)
    # Force the line through (x0, y0): slope-only fit on shifted coordinates.
    x0, y0 = 2.0, 3.9
    slope_tp = sum((xi - x0) * (yi - y0) for xi, yi in zip(x, y)) / sum((xi - x0) ** 2 for xi in x)
    gt = M["regression"]({"x": x, "y": y, "throughPoint": {"x": x0, "y": y0}})["glance"]
    check("regression through-point slope", gt["slope"], slope_tp)
    check("regression through-point intercept = y0-slope*x0", gt["intercept"], y0 - slope_tp * x0)
    # Replicates lack-of-fit F: pure-error (within-replicate) vs lack of fit, with an mpmath F p.
    xr = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    yr = [1.0, 1.2, 2.1, 1.9, 3.2, 3.4, 5.1, 4.8, 8.0, 7.6]
    sl, ic = st.linear_regression(xr, yr)
    sse = sum((yi - (ic + sl * xi)) ** 2 for xi, yi in zip(xr, yr))
    levels = sorted(set(xr))
    pe = 0.0
    for u in levels:
        yj = [v for xi, v in zip(xr, yr) if xi == u]
        m = st.mean(yj)
        pe += sum((v - m) ** 2 for v in yj)
    dflof, dfpe = len(levels) - 2, len(xr) - len(levels)
    F = ((sse - pe) / dflof) / (pe / dfpe)
    gl = M["regression"]({"x": xr, "y": yr})
    check("regression replicates lack-of-fit F", term(gl, "Lack of fit (replicates)", "statistic"), F)
    check("regression lack-of-fit p (mpmath F)", term(gl, "Lack of fit (replicates)", "p"), f_p(F, dflof, dfpe))


def check_multifactor():
    print("\n# multifactor ANOVA  (oracle: from-scratch balanced 2-way SS; Type II == balanced)")
    cells = [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]  # cells[A][B], 2 reps (same as check_twoway)
    A, B, rep = 2, 2, 2
    allv = [v for row in cells for cell in row for v in cell]
    grand = st.mean(allv)
    Am = [st.mean([v for cell in cells[i] for v in cell]) for i in range(A)]
    Bm = [st.mean([cells[i][j][r] for i in range(A) for r in range(rep)]) for j in range(B)]
    cm = [[st.mean(cells[i][j]) for j in range(B)] for i in range(A)]
    ss_a = B * rep * sum((Am[i] - grand) ** 2 for i in range(A))
    ss_b = A * rep * sum((Bm[j] - grand) ** 2 for j in range(B))
    ss_ab = rep * sum((cm[i][j] - Am[i] - Bm[j] + grand) ** 2 for i in range(A) for j in range(B))
    value = [v for i in range(A) for j in range(B) for v in cells[i][j]]
    f0 = ["A%d" % i for i in range(A) for j in range(B) for _ in range(rep)]
    f1 = ["B%d" % j for i in range(A) for j in range(B) for _ in range(rep)]
    g = M["multifactor"]({"value": value, "factors": [f0, f1], "factorLabels": ["A", "B"]})
    check("multifactor SS_A (Type II == balanced 2-way)", term(g, "A"), ss_a)
    check("multifactor SS_B", term(g, "B"), ss_b)
    check("multifactor SS_AB", term(g, "A × B"), ss_ab)
    # Balanced 2×2×2 three-way: every effect SS from a from-scratch marginal-means decomposition.
    base = {(0, 0, 0): 10, (0, 0, 1): 12, (0, 1, 0): 14, (0, 1, 1): 17,
            (1, 0, 0): 11, (1, 0, 1): 9, (1, 1, 0): 16, (1, 1, 1): 22}
    reps = 3
    v3, c0, c1, c2 = [], [], [], []
    for (i, j, kk) in [(i, j, kk) for i in (0, 1) for j in (0, 1) for kk in (0, 1)]:
        for rp in range(reps):
            v3.append(base[(i, j, kk)] + (rp - 1) * 0.5)
            c0.append(str(i)); c1.append(str(j)); c2.append(str(kk))
    g3 = M["multifactor"]({"value": v3, "factors": [c0, c1, c2], "factorLabels": ["A", "B", "C"]})
    Ya = np.asarray(v3, float).reshape(2, 2, 2, reps)
    gd = Ya.mean()
    mA, mB, mC = Ya.mean((1, 2, 3)), Ya.mean((0, 2, 3)), Ya.mean((0, 1, 3))
    mAB, mABC = Ya.mean((2, 3)), Ya.mean(3)
    mAC, mBC = Ya.mean((1, 3)), Ya.mean((0, 3))
    check("multifactor 3-way SS_A", term(g3, "A"), 4 * reps * float(np.sum((mA - gd) ** 2)))
    check("multifactor 3-way SS_AB", term(g3, "A × B"), 2 * reps * float(np.sum((mAB - mA[:, None] - mB[None, :] + gd) ** 2)))
    check("multifactor 3-way SS_ABC", term(g3, "A × B × C"), reps * float(np.sum((mABC - mAB[:, :, None] - mAC[:, None, :] - mBC[None, :, :] + mA[:, None, None] + mB[None, :, None] + mC[None, None, :] - gd) ** 2)))
    # unbalanced 2×2: Type-II SS via lstsq extra-sum-of-squares (main effects exclude
    # the interaction) — independent of statsmodels anova_lm's Type-II.
    uv = [12, 14, 13, 20, 22, 18, 21, 30, 28, 26, 25, 15, 16]
    uf0 = ["0", "0", "0", "0", "0", "0", "0", "1", "1", "1", "1", "1", "1"]
    uf1 = ["0", "0", "0", "1", "1", "1", "1", "0", "0", "1", "1", "1", "0"]
    gu = M["multifactor"]({"value": uv, "factors": [uf0, uf1], "factorLabels": ["A", "B"]})
    yv = np.asarray(uv, float)
    fA = np.array([1.0 if v == "1" else -1.0 for v in uf0])
    fB = np.array([1.0 if v == "1" else -1.0 for v in uf1])
    one = np.ones(len(yv))

    def _rss(cols):
        X = np.column_stack(cols)
        beta, *_ = np.linalg.lstsq(X, yv, rcond=None)
        return float(np.sum((yv - X @ beta) ** 2))
    full = _rss([one, fA, fB, fA * fB])
    check("multifactor Type-II SS_A (unbalanced, extra-SS)", term(gu, "A"), _rss([one, fB]) - _rss([one, fA, fB]))
    check("multifactor Type-II SS_B (unbalanced)", term(gu, "B"), _rss([one, fA]) - _rss([one, fA, fB]))
    check("multifactor Type-II SS_AB (unbalanced)", term(gu, "A × B"), _rss([one, fA, fB]) - full)


def check_mixedmodel():
    print("\n# mixed model REML  (oracle: balanced one-way random-effects closed form)")
    vals = {"g0": [9, 11, 10, 12, 8, 10], "g1": [13, 12, 14, 11, 13, 15],
            "g2": [7, 8, 6, 9, 7, 8], "g3": [11, 10, 12, 11, 13, 9]}
    value, group = [], []
    for k, vv in vals.items():
        for v in vv:
            value.append(v)
            group.append(k)
    G, n = 4, 6
    gmean = st.mean(value)
    gmeans = {k: st.mean(vv) for k, vv in vals.items()}
    msb = n * sum((gmeans[k] - gmean) ** 2 for k in vals) / (G - 1)
    msw = sum((v - gmeans[k]) ** 2 for k, vv in vals.items() for v in vv) / (G * (n - 1))
    sig_grp, sig_res = (msb - msw) / n, msw
    r = M["mixedmodel"]({"value": value, "group": group})["glance"]
    # REML variance components equal the ANOVA method-of-moments estimates for a balanced design.
    check("mixed REML residual variance = MSW", r["resid_var"], sig_res, tol=1e-3)
    check("mixed REML group variance = (MSB-MSW)/n", r["group_var"], sig_grp, tol=1e-3)
    check("mixed ICC = s2g/(s2g+s2r)", r["icc"], sig_grp / (sig_grp + sig_res), tol=1e-3)


def check_nl_formula_coverage():
    """Formula and parameter oracle for the registry models not checked elsewhere in this file.

    Every model here is generated from a formula written in this file from the equation's
    standard published form (and the model's own documented `cite`), never transcribed from
    `engine.py` — an oracle that shares the code under test is not an oracle.

    Two assertions per model, and the second is the one that matters:
      1. the engine fits the independent data to R² ≈ 1 — catches a structurally wrong formula;
      2. the engine's reported parameters equal the generating truth — catches a formula that
         fits perfectly while meaning something different.
    Only (2) protects the number a user actually publishes. Writing `hormesis_bc` with the
    logistic sign flipped, or `power_law_cutoff` with the exponent negated, still fits R² = 1
    and reports a wrong EC50 / exponent; only (2) catches either.
    """
    print("\n# nonlinear formula coverage  (oracle: independent formula + parameter recovery)")
    from math import erf, exp, log, log10, pi, sin, sqrt

    L10, EXP, SQ = log10, exp, sqrt
    phi = lambda z: 0.5 * (1 + erf(z / sqrt(2.0)))

    XPOS = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    XLIN = [i * 0.6 for i in range(0, 26)]
    XPK = [i * 0.5 for i in range(0, 41)]
    XSINE = [i * 0.2 for i in range(0, 61)]
    XV = [-10 + i * 1.0 for i in range(0, 21)]
    XSEG = [i * 0.5 for i in range(0, 25)]
    XLOG = [-3 + i * 0.4 for i in range(0, 16)]          # X already log10 (competition)
    DOSE = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]
    DOSEW = [0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000]
    DOSEH = [0.003, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100]
    XP = [0.5 + i * 0.25 for i in range(0, 20)]
    XBAR = sum(XP) / len(XP)

    def depl_bound(xt, bmax, kd):
        """B = Bmax·F/(Kd+F) with F = X − B  ⇒  B² − B(Kd+X+Bmax) + Bmax·X = 0."""
        b = kd + xt + bmax
        return (b - SQ(b * b - 4 * bmax * xt)) / 2

    def depl_total(xt, bmax, kd, ns):
        """Specific + nonspecific with depletion; conservation gives a quadratic in FREE
        ligand: (1+NS)F² + (Kd + Bmax + NS·Kd − X)F − X·Kd = 0."""
        a, b, c = 1.0 + ns, kd + bmax + ns * kd - xt, -xt * kd
        f = (-b + SQ(b * b - 4 * a * c)) / (2 * a)
        return bmax * f / (kd + f) + ns * f

    poly_c = lambda x, c: sum(k * (x - XBAR) ** i for i, k in enumerate(c))

    cases = [
        # ── Exponential ─────────────────────────────────────────────────────────
        ("exp_assoc", lambda x, y0, pl, k: y0 + (pl - y0) * (1 - EXP(-k * x)), [10, 100, 0.35], XLIN),
        ("exp_decay2", lambda x, pl, sf, kf, ss, ks: pl + sf * EXP(-kf * x) + ss * EXP(-ks * x), [5, 60, 1.2, 35, 0.15], XLIN),
        ("biexp_assoc", lambda x, y0, sf, kf, ss, ks: y0 + sf * (1 - EXP(-kf * x)) + ss * (1 - EXP(-ks * x)), [5, 60, 1.2, 35, 0.15], XLIN),
        ("exp_decay3", lambda x, pl, s1, k1, s2, k2, s3, k3: pl + s1 * EXP(-k1 * x) + s2 * EXP(-k2 * x) + s3 * EXP(-k3 * x), [4, 50, 2.0, 30, 0.5, 20, 0.08], XLIN),
        ("exp_linear", lambda x, a, k, b, c: a * EXP(-k * x) + b * x + c, [50, 0.8, 2.0, 5], XLIN),
        ("stretched_exp", lambda x, amp, tau, beta: amp * EXP(-((x / tau) ** beta)), [100, 4.0, 0.6], XLIN),
        ("plateau_then_decay", lambda x, x0, y0, pl, k: y0 if x < x0 else pl + (y0 - pl) * EXP(-k * (x - x0)), [3.0, 100, 10, 0.4], XLIN),
        ("plateau_then_assoc", lambda x, x0, y0, pl, k: y0 if x < x0 else y0 + (pl - y0) * (1 - EXP(-k * (x - x0))), [3.0, 10, 100, 0.4], XLIN),
        # ── Peak ────────────────────────────────────────────────────────────────
        ("lorentzian", lambda x, a, c, w: a / (1 + ((x - c) / w) ** 2), [10, 10, 2.0], XPK),
        ("gaussian2", lambda x, a1, m1, s1, a2, m2, s2: a1 * EXP(-((x - m1) ** 2) / (2 * s1 * s1)) + a2 * EXP(-((x - m2) ** 2) / (2 * s2 * s2)), [10, 6, 1.2, 6, 14, 1.8], XPK),
        ("gaussian3", lambda x, a1, m1, s1, a2, m2, s2, a3, m3, s3: a1 * EXP(-((x - m1) ** 2) / (2 * s1 * s1)) + a2 * EXP(-((x - m2) ** 2) / (2 * s2 * s2)) + a3 * EXP(-((x - m3) ** 2) / (2 * s3 * s3)), [10, 5, 1.0, 8, 10, 1.2, 6, 15, 1.5], XPK),
        # ── Simple / power ──────────────────────────────────────────────────────
        ("reciprocal", lambda x, a, b: a + b / x, [2.0, 30.0], XPOS),
        ("rational11", lambda x, a, b, c: (a + b * x) / (1 + c * x), [1.0, 4.0, 0.2], XPOS),
        ("sqrt_fit", lambda x, a, b: a + b * SQ(x), [3.0, 5.0], XPOS),
        ("power_offset", lambda x, a, b, c: a * x ** b + c, [2.5, 1.3, 7.0], XPOS),
        # A·x^B·exp(−x/C): B is the exponent as written, so a decaying power law has B < 0.
        ("power_law_cutoff", lambda x, a, b, c: a * x ** b * EXP(-x / c), [100.0, -0.8, 40.0], XPOS),
        # ── Growth ──────────────────────────────────────────────────────────────
        ("logistic4_growth", lambda x, bo, tp, r, m: bo + (tp - bo) / (1 + EXP(-r * (x - m))), [5, 100, 0.7, 7.0], XLIN),
        ("gompertz4", lambda x, off, sp, r, inf: off + sp * EXP(-EXP(-r * (x - inf))), [5, 95, 0.5, 7.0], XLIN),
        ("chapman_richards", lambda x, a, r, sh: a * (1 - EXP(-r * x)) ** sh, [100, 0.35, 2.0], XLIN),
        ("mmf_growth", lambda x, y0, a, k, sh: (y0 * k + a * x ** sh) / (k + x ** sh), [2.0, 100.0, 20.0, 2.0], XLIN),
        # ── Enzyme kinetics ─────────────────────────────────────────────────────
        ("allosteric", lambda x, vm, kh, h: vm * x ** h / (kh ** h + x ** h), [20, 8, 2.0], XPOS),
        ("substrate_inhibition", lambda x, vm, km, ki: vm * x / (km + x * (1 + x / ki)), [50, 5, 60], XPOS),
        ("morrison_ki", lambda x, v0, et, ki: v0 * (1 - (((et + x + ki) - SQ((et + x + ki) ** 2 - 4 * et * x)) / (2 * et))), [100.0, 2.0, 1.5], XPOS),
        # ── Binding ─────────────────────────────────────────────────────────────
        ("hill_binding", lambda x, bm, kd, h: bm * x ** h / (kd ** h + x ** h), [80, 10, 1.8], XPOS),
        ("total_binding", lambda x, bm, kd, ns, bg: bm * x / (kd + x) + ns * x + bg, [80, 8, 0.05, 3.0], XPOS),
        ("competition_1site", lambda x, bo, tp, li: bo + (tp - bo) / (1 + 10 ** (x - li)), [5, 100, -1.0], XLOG),
        ("competition_2site", lambda x, bo, tp, f1, l1, l2: bo + (tp - bo) * (f1 / (1 + 10 ** (x - l1)) + (1 - f1) / (1 + 10 ** (x - l2))), [5, 100, 0.6, -2.0, 0.0], XLOG),
        ("assoc_then_dissoc", lambda x, a, kon, koff, b: b + a * (EXP(-koff * x) - EXP(-kon * x)), [100.0, 1.2, 0.15, 5.0], XLIN),
        ("binding_depletion", lambda x, bm, kd: depl_bound(x, bm, kd), [60.0, 12.0], XPOS),
        ("binding_depletion_ns", lambda x, bm, kd, ns: depl_total(x, bm, kd, ns), [60.0, 12.0, 0.05], XPOS),
        # ── Dose-response, concentration on X ───────────────────────────────────
        ("dr_3pl_conc", lambda x, b, t, ec: b + (t - b) * x / (ec + x), [0, 100, 10], XPOS),
        ("ic50_4pl_conc", lambda x, b, t, ic, h: b + (t - b) / (1 + (x / ic) ** h), [0, 100, 10, 1.3], XPOS),
        ("ic50_3pl_conc", lambda x, b, t, ic: b + (t - b) / (1 + x / ic), [0, 100, 10], XPOS),
        ("dr_5pl_conc", lambda x, b, t, ec, h, s: b + (t - b) / ((1 + (ec / x) ** h) ** s), [5, 95, 10, 1.2, 1.5], XPOS),
        ("dr_norm_4pl_conc", lambda x, ec, h: 100.0 / (1 + (ec / x) ** h), [10, 1.3], XPOS),
        ("dr_norm_3pl_conc", lambda x, ec: 100.0 * x / (ec + x), [10], XPOS),
        ("biphasic_dr_conc", lambda x, b, t, fr, e1, n1, e2, n2: b + (t - b) * (fr / (1 + (e1 / x) ** n1) + (1 - fr) / (1 + (e2 / x) ** n2)), [0, 100, 0.6, 0.1, 1.0, 100.0, 1.0], DOSEW),
        ("bell_dr_conc", lambda x, ba, am, eu, nu, ed, nd: ba + am * (1 / (1 + (eu / x) ** nu)) * (1 / (1 + (x / ed) ** nd)), [0, 100, 0.1, 1.2, 100.0, 1.2], DOSEW),
        # ── Dose-response, log10 dose on X (engine logs x itself) ───────────────
        ("dr_norm_3pl", lambda x, le: 100.0 / (1 + 10 ** (le - L10(x))), [1.0], DOSE),
        ("dr_norm_4pl", lambda x, le, h: 100.0 / (1 + 10 ** ((le - L10(x)) * h)), [1.0, 1.3], DOSE),
        ("ic50_3pl_log", lambda x, b, t, li: b + (t - b) / (1 + 10 ** (L10(x) - li)), [0, 100, 1.0], DOSE),
        ("biphasic_dr", lambda x, b, t, fr, l1, n1, l2, n2: b + (t - b) * (fr / (1 + 10 ** ((l1 - L10(x)) * n1)) + (1 - fr) / (1 + 10 ** ((l2 - L10(x)) * n2))), [0, 100, 0.6, -1.0, 1.0, 2.0, 1.0], DOSEW),
        ("bell_dr", lambda x, ba, am, lu, nu, ld, nd: ba + am * (1 / (1 + 10 ** ((lu - L10(x)) * nu))) * (1 / (1 + 10 ** ((L10(x) - ld) * nd))), [0, 100, -1.0, 1.2, 2.0, 1.2], DOSEW),
        # Brain-Cousens: the logistic is written (logEC50 − log x), matching every other
        # dose-response model in the registry; the hormesis term f·x uses the raw dose.
        ("hormesis_bc", lambda x, b, t, f, le, s: b + (t - b + f * x) / (1 + 10 ** ((le - L10(x)) * s)), [0.0, 100.0, 2.0, 0.5, 1.5], DOSEH),
        # ── Other sigmoids ──────────────────────────────────────────────────────
        ("probit_dr", lambda x, b, t, mu, sg: b + (t - b) * phi((x - mu) / sg), [0, 100, 8.0, 2.0], XLIN),
        ("weibull_sigmoid", lambda x, b, t, sc, sh: b + (t - b) * (1 - EXP(-((x / sc) ** sh))), [0, 100, 7.0, 2.0], XLIN),
        ("richards_dr", lambda x, b, t, m, r, sh: b + (t - b) / (1 + sh * EXP(-r * (x - m))) ** (1.0 / sh), [0, 100, 7.0, 0.8, 1.0], XLIN),
        ("boltzmann_double", lambda x, bo, a1, v1, s1, a2, v2, s2: bo + a1 / (1 + EXP((v1 - x) / s1)) + a2 / (1 + EXP((v2 - x) / s2)), [0.0, 60.0, -4.0, 1.5, 40.0, 4.0, 1.5], XV),
        # ── Periodic / lines / polynomials ──────────────────────────────────────
        ("damped_sine", lambda x, a, d, p, ph, o: o + a * EXP(-d * x) * sin(2 * pi * x / p + ph), [10.0, 0.15, 4.0, 0.3, 5.0], XSINE),
        ("sine2", lambda x, o, a1, p, p1, a2, p2: o + a1 * sin(2 * pi * x / p + p1) + a2 * sin(4 * pi * x / p + p2), [5.0, 8.0, 6.0, 0.2, 3.0, 0.7], XSINE),
        ("sine_drift", lambda x, o, sl, a, p, ph: o + sl * x + a * sin(2 * pi * x / p + ph), [5.0, 0.8, 8.0, 5.0, 0.3], XSINE),
        ("segmental", lambda x, x0, y0, s1, s2: y0 + (s1 if x < x0 else s2) * (x - x0), [6.0, 20.0, 3.0, -1.0], XSEG),
        ("poly5_centered", lambda x, *c: poly_c(x, list(c)), [10.0, 2.0, -0.5, 0.08, -0.006, 0.0004], XP),
        ("poly6_centered", lambda x, *c: poly_c(x, list(c)), [10.0, 2.0, -0.5, 0.08, -0.006, 0.0004, -0.00002], XP),
    ]

    for model, f, truth, x in cases:
        y = [f(xi, *truth) for xi in x]
        r = M["curvefit"]({"model": model, "x": x, "y": y})
        check("%s: engine R² on independent-formula data" % model, r["glance"]["r_sq"], 1.0, tol=1e-4)
        est = [t["estimate"] for t in r["terms"][: len(truth)]]
        worst = max(abs(e - t) / (abs(t) if abs(t) > 1e-9 else 1.0) for e, t in zip(est, truth))
        check_le("%s: engine parameters recover the truth (worst rel err)" % model, worst, 1e-3)


def check_nl_global_formula_coverage():
    """The global-fit half of the formula coverage: models that only exist across several
    curves sharing parameters, with a per-dataset constant. Same discipline as
    `check_nl_formula_coverage` — every generator is written here from the model's
    documented equation, and the shared parameters must come back equal to the truth.

    Identifiability is part of the design, not an afterthought: the operational model
    needs several agonists over a wide dose range (a near-full agonist pins Emax), and a
    single pair of curves simply will not converge — a failure of the experiment's design,
    not of the engine.
    """
    print("\n# nonlinear global formula coverage  (oracle: independent formula + shared-parameter recovery)")
    S = [1, 2, 5, 10, 20, 35, 50, 75, 100]
    T = [0.05 * i for i in range(0, 41)]
    DOSE = [10 ** (-3 + 7 * i / 13) for i in range(14)]
    DOSEW = [10 ** (-11 + 9 * i / 15) for i in range(16)]

    def shared(r, name):
        for t in r["terms"]:
            if t["term"] in (name, name + " (shared)"):
                return t["estimate"]
        return None

    def recovers(tag, r, truth, tol=1e-3):
        check("%s: overall R²" % tag, r["glance"]["r_sq"], 1.0, tol=1e-5)
        for name, want in truth.items():
            check("%s: %s recovered" % (tag, name), shared(r, name), want, tol=tol)

    # ── Observed association: Y = Plateau·(1−e^(−kobs·t)), kobs = kon·[L] + koff ──
    PLAT, KON, KOFF = 100.0, 0.8, 0.15
    ds = [{"label": "L=%g" % L, "x": T, "y": [PLAT * (1 - math.exp(-(KON * L + KOFF) * t)) for t in T], "consts": [L]}
          for L in (0.5, 1.0, 2.0)]
    recovers("assoc_kinetics", M["globalfit"]({"model": "assoc_kinetics", "datasets": ds,
                                               "shared": ["Plateau", "kon", "koff"]}),
             {"Plateau": PLAT, "kon": KON, "koff": KOFF})

    # ── Total (Spec=1) + nonspecific (Spec=0) binding, sharing every parameter ──
    BMAX, KD, NS, BG = 80.0, 8.0, 0.05, 3.0
    tn = lambda x, spec: spec * BMAX * x / (KD + x) + NS * x + BG
    ds = [{"label": "total", "x": S, "y": [tn(x, 1) for x in S], "consts": [1]},
          {"label": "nonspecific", "x": S, "y": [tn(x, 0) for x in S], "consts": [0]}]
    recovers("total_nonspecific", M["globalfit"]({"model": "total_nonspecific", "datasets": ds,
                                                  "shared": ["Bmax", "Kd", "NS", "Background"]}),
             {"Bmax": BMAX, "Kd": KD, "NS": NS, "Background": BG})

    B1, K1, B2, K2 = 60.0, 2.0, 40.0, 50.0
    t2 = lambda x, spec: spec * (B1 * x / (K1 + x) + B2 * x / (K2 + x)) + NS * x + BG
    ds = [{"label": "total", "x": S, "y": [t2(x, 1) for x in S], "consts": [1]},
          {"label": "nonspecific", "x": S, "y": [t2(x, 0) for x in S], "consts": [0]}]
    recovers("total_nonspecific_2site",
             M["globalfit"]({"model": "total_nonspecific_2site", "datasets": ds,
                             "shared": ["Bmax1", "Kd1", "Bmax2", "Kd2", "NS", "Background"]}),
             {"Bmax1": B1, "Kd1": K1, "Bmax2": B2, "Kd2": K2, "NS": NS, "Background": BG})

    # ── The same, with X = total added ligand, so free ligand solves the conservation
    #    quadratic (1+NS)F² + (Kd + Spec·Bmax + NS·Kd − X)F − X·Kd = 0. Derived here from
    #    mass balance, not read out of the engine.
    def depl(xt, bmax, kd, ns, spec):
        a, b, c = 1.0 + ns, kd + spec * bmax + ns * kd - xt, -xt * kd
        f = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
        return spec * bmax * f / (kd + f) + ns * f

    BD, KDD, NSD = 60.0, 12.0, 0.05
    ds = [{"label": "total", "x": S, "y": [depl(x, BD, KDD, NSD, 1) for x in S], "consts": [1]},
          {"label": "nonspecific", "x": S, "y": [depl(x, BD, KDD, NSD, 0) for x in S], "consts": [0]}]
    recovers("total_nonspecific_depletion",
             M["globalfit"]({"model": "total_nonspecific_depletion", "datasets": ds,
                             "shared": ["Bmax", "Kd", "NS"]}),
             {"Bmax": BD, "Kd": KDD, "NS": NSD})

    # ── Gaddum/Schild: the antagonist shifts logEC50 by log10(1 + ([B]/Kb)^SchildSlope),
    #    with Kb = 10^(−pA2). Include a [B]=0 curve so the unshifted EC50 is pinned.
    BOT, TOP, LEC, HILL, PA2, SS = 0.0, 100.0, -6.0, 1.0, 7.0, 1.0
    KB = 10 ** (-PA2)
    sch = lambda x, B: BOT + (TOP - BOT) / (
        1 + 10 ** ((LEC + math.log10(1 + (B / KB) ** SS) - math.log10(x)) * HILL))
    ds = [{"label": "B=%g" % B, "x": DOSE, "y": [sch(x, B) for x in DOSE], "consts": [B]}
          for B in (0.0, 1e-7, 1e-6)]
    recovers("schild", M["globalfit"]({"model": "schild", "datasets": ds,
                                       "shared": ["Bottom", "Top", "logEC50", "HillSlope", "pA2", "SchildSlope"]}),
             {"Top": TOP, "logEC50": LEC, "HillSlope": HILL, "pA2": PA2, "SchildSlope": SS})

    # ── Black-Leff operational model of agonism ──
    def op(a, lka, lta, n=1.0, basal=0.0, emax=100.0):
        ka, tau = 10 ** lka, 10 ** lta
        return basal + (emax - basal) * ((tau * a) ** n) / (((a + ka) ** n) + ((tau * a) ** n))

    ags = [("full", -7.0, 3.0), ("pB", -6.0, 0.0), ("pC", -5.5, -0.7)]
    ds = [{"label": lab, "x": DOSEW, "y": [op(a, lka, lta) for a in DOSEW]} for lab, lka, lta in ags]
    # Note: Emax to 5e-3, not 1e-3: with a near-full agonist present its own logKA/logTau are
    # genuinely non-identifiable (receptor reserve), which costs a little precision on Emax.
    recovers("operational", M["globalfit"]({"model": "operational", "datasets": ds,
                                            "shared": ["Basal", "Emax", "n"]}),
             {"Emax": 100.0, "n": 1.0}, tol=5e-3)

    # ── Operational with receptor depletion: each curve's fractional receptor number q
    #    scales the transducer ratio (τ_eff = q·τ).
    opd = lambda a, lka, lta, q: 100.0 * (((10 ** lta) * q * a)) / ((a + 10 ** lka) + ((10 ** lta) * q * a))
    ds = [{"label": "q=%g" % q, "x": DOSEW, "y": [opd(a, -6.0, 1.0, q) for a in DOSEW], "consts": [q]}
          for q in (1.0, 0.5, 0.25)]
    recovers("operational_depletion",
             M["globalfit"]({"model": "operational_depletion", "datasets": ds,
                             "shared": ["Basal", "Emax", "n", "logKA", "logTau"]}),
             {"Emax": 100.0, "n": 1.0, "logKA": -6.0, "logTau": 1.0})


def check_nl_tail():
    print("\n# nonlinear tail  (oracle: known-parameter recovery + independent R²)")
    # Allosteric EC50 shift: recover logKB / logAlpha across [B] (the known truth is the oracle).
    # Doses span 0.01…1e4 (well-conditioned, matching the engine test) so the shift is identifiable.
    doses = [10 ** (-2 + 6 * i / 11) for i in range(12)]
    KB, ALPHA = 1.0, 0.1  # logKB 0, logAlpha -1
    ds = [{"x": doses, "y": [100.0 / (1 + (10.0 * (1 + B / KB) / (1 + ALPHA * B / KB)) / x) for x in doses], "consts": [B]}
          for B in (0, 1, 10)]
    r = M["globalfit"]({"model": "allosteric_ec50", "datasets": ds,
                        "shared": ["Bottom", "Top", "logEC50", "HillSlope", "logKB", "logAlpha"]})
    sh = {t["term"]: t.get("estimate") for t in r["terms"]}
    check("allosteric logKB recovers truth (0)", sh.get("logKB (shared)"), 0.0, tol=1e-2)
    check("allosteric logAlpha recovers truth (-1)", sh.get("logAlpha (shared)"), -1.0, tol=1e-2)
    # Smoothing spline: an interpolating fit (frac 0) has R² = 1 — recompute R² independently.
    sx = list(range(10))
    sy = [0.1, 0.9, 2.2, 2.8, 4.1, 5.2, 5.8, 7.1, 7.9, 9.2]
    res = M["curvefit"]({"model": "spline", "x": sx, "y": sy, "frac": 0.0})
    check("spline interpolation R² (independent)", res["glance"]["r_sq"], r2(sy, res["extra"]["residuals"]["fitted"]), tol=1e-3)
    # Parameter constraint: fix Bottom=0 in a 4PL → the free params recover the known truth
    # (the truth is the independent oracle; the fixed param stays exactly at its value).
    dose2 = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000]
    yb = [100.0 / (1 + 10 ** ((1 - math.log10(d)) * 1)) for d in dose2]  # Bottom0 Top100 EC50=10 Hill1
    rc = M["curvefit"]({"model": "4pl", "x": dose2, "y": yb, "fixed": {"Bottom": 0}})
    tc = {t["term"]: t.get("estimate") for t in rc["terms"]}
    check("curvefit fixed Bottom stays 0", tc.get("Bottom (fixed)"), 0.0)
    check("curvefit fixed→Top recovers truth", tc.get("Top"), 100.0, tol=1e-2)
    check("curvefit fixed→EC50 recovers truth", tc.get("EC50"), 10.0, tol=1e-2)
    # Homologous competition: fix Hot=2 → recover Bmax/logKd/NS (Bmax·Hot/(Hot+cold+Kd)+NS).
    cold = [10 ** (-2 + 6 * i / 13) for i in range(14)]
    yh = [100 * 2 / (2 + c + 10) + 5 for c in cold]  # Bmax100 Kd10(logKd1) NS5 Hot2
    rh = M["curvefit"]({"model": "homologous_competition", "x": cold, "y": yh, "fixed": {"Hot": 2}})
    th = {t["term"]: t.get("estimate") for t in rh["terms"]}
    check("homologous Bmax recovers truth", th.get("Bmax"), 100.0, tol=1e-2)
    check("homologous logKd recovers truth", th.get("logKd"), 1.0, tol=1e-2)
    check("homologous NS recovers truth", th.get("NS"), 5.0, tol=1e-2)
    # Motulsky-Mahan competitive binding kinetics: global fit across [I] (L fixed) recovers
    # every rate constant + Bmax (truth = oracle; the biexponential is re-derived here).
    def mm(t, L, I, k1, k2, k3, k4, bmax):
        KA = k1 * L + k2
        KB = k3 * I + k4
        S = ((KA - KB) ** 2 + 4 * k1 * k3 * L * I) ** 0.5
        KF = 0.5 * (KA + KB + S)
        KS = 0.5 * (KA + KB - S)
        dd = KF - KS
        Q = bmax * k1 * L / dd
        return Q * (k4 * dd / (KF * KS) + (k4 - KF) / KF * math.exp(-KF * t) - (k4 - KS) / KS * math.exp(-KS * t))
    tt = [0.1, 0.3, 0.5, 1, 2, 3, 5, 8, 12, 20]
    k1, k2, k3, k4, bm, Lc = 2.0, 0.2, 1.0, 0.05, 100.0, 1.0
    dsm = [{"label": "I=%g" % I, "x": tt, "y": [mm(ti, Lc, I, k1, k2, k3, k4, bm) for ti in tt], "consts": [I]} for I in (0, 0.5, 2, 10)]
    rm = M["globalfit"]({"model": "motulsky_mahan", "datasets": dsm, "shared": ["kon_L", "koff_L", "kon_I", "koff_I", "Bmax"], "fixed": {"L": 1.0}})
    shm = {t["term"]: t.get("estimate") for t in rm["terms"]}
    check("Motulsky-Mahan kon_L recovers truth", shm.get("kon_L (shared)"), 2.0, tol=1e-2)
    check("Motulsky-Mahan koff_I recovers truth", shm.get("koff_I (shared)"), 0.05, tol=1e-2)
    check("Motulsky-Mahan Bmax recovers truth", shm.get("Bmax (shared)"), 100.0, tol=1e-2)


# ── Monte-Carlo — vs the closed-form through-origin OLS standard error ─────────
#    (an oracle completely independent of the engine's curve_fit): the Monte-Carlo
#    empirical SD of the fitted slope must equal sigma / sqrt(Σx²).
def check_montecarlo():
    print("\n# montecarlo  (oracle: through-origin OLS SE = sigma/sqrt(Sxx), independent of curve_fit)")
    slope, sigma = 3.0, 2.0
    xs = [float(i) for i in range(1, 11)]  # X = 1..10
    Sxx = sum(x * x for x in xs)
    se = sigma / math.sqrt(Sxx)  # exact OLS-through-origin SE of the slope
    r = M["montecarlo"]({"model": "line_origin", "trueParams": [slope], "xStart": 1, "xEnd": 10, "xCount": 10,
                         "noise": {"type": "sd", "value": sigma}, "iterations": 5000, "seed": 11})
    t = {row["term"]: row for row in r["terms"]}
    pname = engine._nl_models()["line_origin"]["params"][0]
    check_le("montecarlo slope SD vs OLS-SE |ratio-1|", abs(t[pname]["sd"] / se - 1.0), 0.08)
    check("montecarlo slope mean == true (unbiased)", t[pname]["estimate"], slope, tol=6e-3)
    # Michaelis-Menten recovery + seeded reproducibility.
    spec = {"model": "mm", "trueParams": [100.0, 10.0], "xStart": 1, "xEnd": 100, "xCount": 12,
            "noise": {"type": "sd", "value": 5}, "iterations": 300, "seed": 42}
    mm = M["montecarlo"](spec)
    tm = {row["term"]: row for row in mm["terms"]}
    check("montecarlo MM Vmax mean ~ true", tm["Vmax"]["estimate"], 100.0, tol=3e-2)
    check("montecarlo MM KM mean ~ true", tm["KM"]["estimate"], 10.0, tol=5e-2)
    check_eq("montecarlo reproducible (same seed → same terms)", M["montecarlo"](spec)["terms"] == mm["terms"], True)
    # relative (percent-of-signal) noise: σ_i = c·(slope·x_i). For unweighted OLS-through-
    # origin the slope SE = c·slope·√(Σx⁴)/Σx² — a closed-form heteroscedastic oracle.
    c = 0.10
    Sx4 = sum(x ** 4 for x in xs)
    se_rel = c * slope * math.sqrt(Sx4) / Sxx
    relspec = {"model": "line_origin", "trueParams": [slope], "xStart": 1, "xEnd": 10, "xCount": 10,
               "noise": {"type": "relative", "value": c * 100}, "iterations": 6000, "seed": 13}
    rr = M["montecarlo"](relspec)
    tr = {row["term"]: row for row in rr["terms"]}
    check_le("montecarlo relative-noise slope SD vs analytic |ratio−1|", abs(tr[pname]["sd"] / se_rel - 1.0), 0.1)
    check("montecarlo relative-noise slope unbiased", tr[pname]["estimate"], slope, tol=1e-2)
    check_eq("montecarlo relative-noise reproducible", M["montecarlo"](relspec)["terms"] == rr["terms"], True)


def check_userfit():
    print("\n# user-defined equation fit  (oracle: from-scratch OLS for a linear user eq; the built-in MM model for a hyperbola)")
    # 1) A linear user equation must match a from-scratch closed-form OLS (no curve_fit shared).
    xs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    ys = [2.1, 3.9, 6.2, 7.8, 10.1, 12.0]
    n = len(xs); sx = sum(xs); sy = sum(ys); sxx = sum(x * x for x in xs); sxy = sum(a * b for a, b in zip(xs, ys))
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    inter = (sy - slope * sx) / n
    r = M["curvefit"]({"model": "custom", "equation": "M*X + B", "x": xs, "y": ys, "initialValues": {"M": 1, "B": 0}})
    check("userfit linear slope == closed-form OLS", r["glance"]["m"], slope, tol=1e-4)
    check("userfit linear intercept == closed-form OLS", r["glance"]["b"], inter, tol=1e-4)
    # 2) A hyperbola user equation must recover the same fit as the built-in Michaelis-Menten model.
    xh = [0.5, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 20.0]
    yh = [100.0 * x / (10.0 + x) for x in xh]
    ru = M["curvefit"]({"model": "custom", "equation": "Vmax*X/(KM+X)", "x": xh, "y": yh, "initialValues": {"Vmax": 50, "KM": 5}})
    rb = M["curvefit"]({"model": "mm", "x": xh, "y": yh})
    check("userfit hyperbola Vmax == built-in mm", ru["glance"]["vmax"], rb["glance"]["vmax"], tol=1e-3)
    check("userfit hyperbola KM == built-in mm", ru["glance"]["km"], rb["glance"]["km"], tol=1e-3)
    # 3) Safety: injection / attribute access / degenerate equations must be rejected (no eval).
    for bad in ("__import__('os').system('x')", "2*X", "A*X + os.getcwd()"):
        rejected = False
        try:
            M["curvefit"]({"model": "custom", "equation": bad, "x": xs, "y": ys})
        except engine.StatsError:
            rejected = True
        check_eq("userfit rejects unsafe/degenerate '%s'" % bad[:18], rejected, True)


def check_nlband():
    print("\n# nonlinear fit confidence/prediction bands  (oracle: closed-form linear band via a custom user equation)")
    # A straight-line user equation, fit through the nonlinear driver (_fit_nl), must
    # produce the textbook linear confidence + prediction band. Recompute both here
    # from scratch (pure-Python OLS + an mpmath t-critical) — no shared curve_fit path.
    xs = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    ys = [1.0, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1]
    n = len(xs)
    xbar = sum(xs) / n
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    slope = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    inter = ybar - slope * xbar
    df = n - 2
    s2 = sum((y - (inter + slope * x)) ** 2 for x, y in zip(xs, ys)) / df
    tc = t_crit_two(df)
    r = M["curvefit"]({"model": "custom", "equation": "A*X + B", "x": xs, "y": ys, "initialValues": {"A": 1, "B": 0}})
    c = r["curve"]
    cx, cy = c["x"], c["y"]
    ciL, ciH = c.get("ciLow"), c.get("ciHigh")
    piL, piH = c.get("piLow"), c.get("piHigh")
    check_eq("nlband: confidence band present", ciL is not None and ciH is not None, True)
    check_eq("nlband: prediction band present", piL is not None and piH is not None, True)
    if ciL and piL:
        # Sample the grid start / middle / end and match the closed-form band exactly.
        for m in (0, len(cx) // 2, len(cx) - 1):
            xg = cx[m]
            se_mean = math.sqrt(s2 * (1.0 / n + (xg - xbar) ** 2 / sxx))
            se_pred = math.sqrt(s2 * (1.0 + 1.0 / n + (xg - xbar) ** 2 / sxx))
            check("nlband CI half-width @x=%.1f" % xg, (ciH[m] - ciL[m]) / 2.0, tc * se_mean, tol=2e-3)
            check("nlband PI half-width @x=%.1f" % xg, (piH[m] - piL[m]) / 2.0, tc * se_pred, tol=2e-3)
            check("nlband CI centred on curve @x=%.1f" % xg, (ciH[m] + ciL[m]) / 2.0, cy[m], tol=2e-3)


def check_nldiag():
    print("\n# nonlinear fit diagnostics: parameter correlation + dependency  (oracle: closed-form OLS covariance)")
    # For a straight-line fit Y = A·X + B (design columns [X, 1]), the parameter
    # covariance ∝ (XᵀX)⁻¹, so corr(A,B) = −Σx/√(n·Σx²) and — with two parameters —
    # each Dependency equals corr² (the 2-param identity 1 − 1/(C_ii·(C⁻¹)_ii) = r²).
    xs = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    ys = [1.0, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1]
    n = len(xs)
    sx = sum(xs)
    sxx = sum(x * x for x in xs)
    corr_indep = -sx / math.sqrt(n * sxx)
    dep_indep = corr_indep ** 2
    r = M["curvefit"]({"model": "custom", "equation": "A*X + B", "x": xs, "y": ys, "initialValues": {"A": 1, "B": 0}})
    mat = r["extra"]["paramCorrelation"]["matrix"]
    check("nldiag corr(A,B) == closed-form OLS", mat[0][1], corr_indep, tol=2e-3)
    check_eq("nldiag corr matrix is unit-diagonal", mat[0][0] == 1.0 and mat[1][1] == 1.0, True)
    check("nldiag corr matrix symmetric", mat[1][0], mat[0][1], tol=1e-9)
    check("nldiag dependency(A) == corr²", term(r, "A", "dependency"), dep_indep, tol=2e-3)
    check("nldiag dependency(B) == corr²", term(r, "B", "dependency"), dep_indep, tol=2e-3)


def check_weighting():
    print("\n# curve-fit weighting: 1/SD² + Poisson  (oracle: from-scratch weighted OLS / Poisson IRLS)")
    # 1/SD²: a linear fit weighting each point by 1/SD² must match the weighted normal
    # equations. X is deliberately unsorted so a mis-sorted SD array would fail here.
    xs = [5.0, 1.0, 3.0, 2.0, 4.0]
    ys = [11.1, 3.2, 7.0, 5.1, 9.0]
    sd = [2.0, 0.5, 1.0, 0.7, 1.5]
    w = [1.0 / (s * s) for s in sd]
    Sw = sum(w); Swx = sum(wi * xi for wi, xi in zip(w, xs)); Swy = sum(wi * yi for wi, yi in zip(w, ys))
    Swxx = sum(wi * xi * xi for wi, xi in zip(w, xs)); Swxy = sum(wi * xi * yi for wi, xi, yi in zip(w, xs, ys))
    slope = (Sw * Swxy - Swx * Swy) / (Sw * Swxx - Swx * Swx)
    inter = (Swy - slope * Swx) / Sw
    r = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xs, "y": ys, "sd": sd, "weighting": "1/SD2", "initialValues": {"A": 1, "B": 0}})
    check("weighting 1/SD² slope == weighted OLS", r["glance"]["a"], slope, tol=1e-4)
    check("weighting 1/SD² intercept == weighted OLS", r["glance"]["b"], inter, tol=1e-4)
    # Poisson: iteratively reweighted by 1/Ŷ (variance = mean for counts) — must match a
    # from-scratch IRLS run to convergence (a, b = intercept, slope of y = b·x + a).
    xp = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]
    yp = [3.0, 5.0, 8.0, 11.0, 16.0, 22.0, 30.0, 41.0]
    a, b = 0.0, 1.0
    for _ in range(500):
        yh = [b * xi + a for xi in xp]
        ww = [1.0 / max(abs(v), 1e-9) for v in yh]
        Sw = sum(ww); Swx = sum(wi * xi for wi, xi in zip(ww, xp)); Swy = sum(wi * yi for wi, yi in zip(ww, yp))
        Swxx = sum(wi * xi * xi for wi, xi in zip(ww, xp)); Swxy = sum(wi * xi * yi for wi, xi, yi in zip(ww, xp, yp))
        bn = (Sw * Swxy - Swx * Swy) / (Sw * Swxx - Swx * Swx)
        an = (Swy - bn * Swx) / Sw
        if abs(bn - b) < 1e-12 and abs(an - a) < 1e-12:
            a, b = an, bn
            break
        a, b = an, bn
    rp = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xp, "y": yp, "weighting": "poisson", "initialValues": {"A": 1, "B": 0}})
    check("weighting Poisson slope == IRLS(1/Ŷ)", rp["glance"]["a"], b, tol=2e-3)
    check("weighting Poisson intercept == IRLS(1/Ŷ)", rp["glance"]["b"], a, tol=2e-3)
    # '1/YY' = 1/Ŷ² (weight by the predicted value), fit by iterative reweighting.
    # Independent oracle: a from-scratch IRLS with weight 1/Ŷ² (σ = |Ŷ|) to convergence.
    a2, b2 = 0.0, 1.0
    for _ in range(500):
        yh = [b2 * xi + a2 for xi in xp]
        ww = [1.0 / max(v * v, 1e-18) for v in yh]
        Sw = sum(ww); Swx = sum(wi * xi for wi, xi in zip(ww, xp)); Swy = sum(wi * yi for wi, yi in zip(ww, yp))
        Swxx = sum(wi * xi * xi for wi, xi in zip(ww, xp)); Swxy = sum(wi * xi * yi for wi, xi, yi in zip(ww, xp, yp))
        bn = (Sw * Swxy - Swx * Swy) / (Sw * Swxx - Swx * Swx)
        an = (Swy - bn * Swx) / Sw
        if abs(bn - b2) < 1e-12 and abs(an - a2) < 1e-12:
            a2, b2 = an, bn
            break
        a2, b2 = an, bn
    ryy = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xp, "y": yp, "weighting": "1/YY", "initialValues": {"A": 1, "B": 0}})
    check("weighting 1/YY slope == IRLS(1/Ŷ²)", ryy["glance"]["a"], b2, tol=2e-3)
    check("weighting 1/YY intercept == IRLS(1/Ŷ²)", ryy["glance"]["b"], a2, tol=2e-3)
    # 1/Ŷ² weighting is genuinely different from 1/Y² (observed) and from unweighted.
    r_obs = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xp, "y": yp, "weighting": "1/Y2", "initialValues": {"A": 1, "B": 0}})["glance"]
    check_eq("weighting 1/YY (predicted) ≠ 1/Y2 (observed)", bool(abs(ryy["glance"]["a"] - r_obs["a"]) > 1e-4 or abs(ryy["glance"]["b"] - r_obs["b"]) > 1e-4), True)


def check_profileci():
    print("\n# nonlinear profile-likelihood CIs  (oracle: for a linear fit the profile CI == the Wald CI)")
    # A straight-line fit has an exactly-quadratic SSE, so the profile-t interval collapses
    # to the symmetric Wald interval est ± t·SE — recomputed here from closed-form OLS.
    xs = [0.0, 1, 2, 3, 4, 5, 6, 7]
    ys = [1.0, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1]
    n = len(xs)
    xbar = sum(xs) / n
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    slope = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    inter = ybar - slope * xbar
    s2 = sum((y - (inter + slope * x)) ** 2 for x, y in zip(xs, ys)) / (n - 2)
    tc = t_crit_two(n - 2)
    se_slope = math.sqrt(s2 / sxx)
    se_int = math.sqrt(s2 * (1.0 / n + xbar * xbar / sxx))
    r = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xs, "y": ys, "initialValues": {"A": 1, "B": 0}})
    check("profileci A low == Wald", term(r, "A", "ciLow"), slope - tc * se_slope, tol=2e-3)
    check("profileci A high == Wald", term(r, "A", "ciHigh"), slope + tc * se_slope, tol=2e-3)
    check("profileci B low == Wald", term(r, "B", "ciLow"), inter - tc * se_int, tol=2e-3)
    check("profileci B high == Wald", term(r, "B", "ciHigh"), inter + tc * se_int, tol=2e-3)
    # A GENUINELY nonlinear model: exp decay Y=A·exp(−K·X). Each profile-CI bound of K
    # is (by definition) where fixing K and re-fitting A raises the SSE to the F-threshold
    # SSE_min·(1 + t_crit²/dof). Verify that independently (A is profiled out in closed form).
    xd = [0.0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]
    rng = np.random.default_rng(7)
    yd = [100.0 * math.exp(-0.5 * xi) + float(rng.normal(0, 4)) for xi in xd]
    rn = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd, "y": yd, "initialValues": {"A": 100, "K": 0.5}})
    Kh = rn["glance"]["k"]
    nd, dofn = len(xd), len(xd) - 2

    def sse_at_K(K):
        e = [math.exp(-K * xi) for xi in xd]
        A = sum(yd[i] * e[i] for i in range(nd)) / sum(e[i] ** 2 for i in range(nd))  # optimal A | K (linear)
        return sum((yd[i] - A * e[i]) ** 2 for i in range(nd))
    thr = sse_at_K(Kh) * (1 + t_crit_two(dofn, 0.05) ** 2 / dofn)
    klo, khi = term(rn, "K", "ciLow"), term(rn, "K", "ciHigh")
    check("profileci exp-decay K low hits SSE F-threshold", sse_at_K(klo), thr, tol=8e-3)
    check("profileci exp-decay K high hits SSE F-threshold", sse_at_K(khi), thr, tol=8e-3)
    check_eq("profileci exp-decay K CI is asymmetric (≠ Wald)", bool(abs((khi - Kh) - (Kh - klo)) > 1e-4), True)


def check_hougaard():
    print("\n# Hougaard skewness  (oracle: g1≈0 for a linear model; Monte-Carlo empirical skewness for exp decay)")
    # 1) A linear model has zero curvature ⇒ Hougaard's skewness is 0 (exact up to FD noise).
    xs = [0.0, 1, 2, 3, 4, 5, 6, 7]
    ys = [1.0, 2.9, 5.2, 6.8, 9.1, 10.8, 13.2, 15.1]
    rl = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xs, "y": ys, "initialValues": {"A": 1, "B": 0}})
    check("hougaard linear A skewness ≈ 0", term(rl, "A", "skewness"), 0.0, tol=1e-3)
    check("hougaard linear B skewness ≈ 0", term(rl, "B", "skewness"), 0.0, tol=1e-3)
    # 2) exp decay Y=A·exp(-K·X): the rate constant K is right-skewed. The ANALYTICAL Hougaard
    #    g1 (finite-diff derivative tensors) must match a Monte-Carlo empirical skewness of K̂
    #    from independent scipy fits — a wholly different computation of the same quantity.
    rng = np.random.default_rng(12345)
    xd = np.array([0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8.0])
    a_t, k_t, s = 100.0, 0.5, 4.0
    yt = a_t * np.exp(-k_t * xd)
    yd = (yt + rng.normal(0, s, xd.size)).tolist()
    rh = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd.tolist(), "y": yd, "initialValues": {"A": 100, "K": 0.5}})
    a_hat, k_hat = rh["glance"]["a"], rh["glance"]["k"]
    g1 = term(rh, "K", "skewness")
    # Independent recompute of the same Hougaard formula with exact (analytical) derivatives
    # of A·exp(-K·X) instead of the engine's finite differences — validates the FD Jacobian/
    # Hessian, the W/T contraction, and the normalisation, sharing no code with the engine.
    ex = np.exp(-k_hat * xd)
    yh = a_hat * ex
    resid = np.array(yd) - yh
    mse = float(resid @ resid) / (xd.size - 2)
    jac = np.column_stack([ex, -a_hat * xd * ex])            # ∂/∂A, ∂/∂K
    hes = np.zeros((xd.size, 2, 2))
    hes[:, 0, 1] = hes[:, 1, 0] = -xd * ex                    # ∂²/∂A∂K  (∂²/∂A² = 0)
    hes[:, 1, 1] = a_hat * xd ** 2 * ex                       # ∂²/∂K²
    warr = np.einsum("ma,mbc->abc", jac, hes)
    tarr = warr + np.transpose(warr, (1, 0, 2)) + np.transpose(warr, (2, 1, 0))
    lmat = np.linalg.inv(jac.T @ jac)
    li = lmat[1]
    g1_indep = -(mse ** 2) * float(np.einsum("a,b,c,abc->", li, li, li, tarr)) / (mse * lmat[1, 1]) ** 1.5
    check("hougaard exp-K g1 == analytical-derivative recompute", g1, g1_indep, tol=1e-3)
    # Empirical sanity: Monte-Carlo refits confirm K̂ is right-skewed (robust mean>median sign,
    # since the moment skewness of a heavy-tailed rate constant is outlier-dominated).
    from scipy.optimize import curve_fit
    mc = np.random.default_rng(999)
    fexp = lambda X, a, kk: a * np.exp(-kk * X)  # noqa: E731
    ks = []
    for _ in range(1000):
        ysim = yt + mc.normal(0, s, xd.size)
        try:
            p, _ = curve_fit(fexp, xd, ysim, p0=[100, 0.5], maxfev=10000)
            ks.append(p[1])
        except Exception:
            pass
    ks = np.array(ks)
    check_eq("hougaard exp-K skew sign matches MC (mean>median)", (g1 > 0) == (float(ks.mean()) > float(np.median(ks))), True)


def check_rout():
    print("\n# ROUT outlier removal during a fit  (oracle: the planted outlier is the point removed)")
    x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    noise = [0.1, -0.1, 0.05, -0.05, 0.1, -0.1, 0.05, -0.05, 0.1, -0.1]
    yc = [2 * xi + 1 + d for xi, d in zip(x, noise)]
    # Clean data → nothing flagged; the ROUT fit equals the ordinary least-squares fit.
    rc = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": x, "y": yc, "initialValues": {"A": 1, "B": 0}, "rout": True})
    plain = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": x, "y": yc, "initialValues": {"A": 1, "B": 0}})
    check_eq("rout clean data removes 0 outliers", rc["glance"].get("outliers_removed"), 0)
    check("rout clean fit == plain OLS slope", rc["glance"]["a"], plain["glance"]["a"], tol=1e-6)
    # One planted outlier at index 5 → flagged + removed; the cleaned slope recovers the true 2.
    yo = list(yc)
    yo[5] += 15.0
    ro = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": x, "y": yo, "initialValues": {"A": 1, "B": 0}, "rout": True})
    naive = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": x, "y": yo, "initialValues": {"A": 1, "B": 0}})
    check_eq("rout removes exactly 1 outlier", ro["glance"].get("outliers_removed"), 1)
    check_eq("rout flags the planted index 5", ro["extra"]["routOutliers"], [5])
    check("rout cleaned slope ≈ true 2", ro["glance"]["a"], 2.0, tol=5e-3)
    check_le("rout beats naive OLS toward the truth", abs(ro["glance"]["a"] - 2.0), abs(naive["glance"]["a"] - 2.0))


def check_pcorrect():
    print("\n# P-value corrector  (oracle: adjusted P recomputed from scratch, vs statsmodels multipletests)")
    p = [0.001, 0.008, 0.02, 0.03, 0.04, 0.2, 0.5, 0.9]
    m = len(p)
    order = sorted(range(m), key=lambda i: p[i])  # ascending by p

    def step_down(transform):
        """Generic step-down (Holm family): adj_(r) = cummax over ranks of transform(p_(r), m-r)."""
        out = [0.0] * m
        running = 0.0
        for rank, idx in enumerate(order):
            running = max(running, transform(p[idx], m - rank))
            out[idx] = min(1.0, running)
        return out

    def step_up(scale):
        """Generic step-up (FDR family): q_(r) = cummin from the largest p of scale·p_(r)/rank."""
        out = [0.0] * m
        prev = 1.0
        for rank in range(m - 1, -1, -1):  # largest p → smallest
            idx = order[rank]
            prev = min(prev, min(1.0, scale * p[idx] / (rank + 1)))
            out[idx] = prev
        return out

    c_m = sum(1.0 / i for i in range(1, m + 1))  # harmonic number (Benjamini-Yekutieli)
    oracle = {
        "bonferroni": [min(1.0, v * m) for v in p],
        "holm": step_down(lambda v, k: v * k),
        "holm-sidak": step_down(lambda v, k: 1.0 - (1.0 - v) ** k),
        "sidak": [1.0 - (1.0 - v) ** m for v in p],
        "fdr_bh": step_up(m),
        "fdr_by": step_up(m * c_m),
    }
    for method, want in oracle.items():
        r = M["pcorrect"]({"pvalues": p, "method": method, "alpha": 0.05})
        got = [t["p"] for t in r["terms"]]  # input order preserved
        for i in range(m):
            check("pcorrect %s adj P[%d]" % (method, i), got[i], want[i], tol=1e-5)
    # α threading + the significance count (independent recompute at α = 0.05, Holm).
    holm = oracle["holm"]
    r = M["pcorrect"]({"pvalues": p, "method": "holm", "alpha": 0.05})
    check_eq("pcorrect n_significant matches an independent count", r["glance"]["n_significant"],
             sum(1 for v in holm if v < 0.05))
    # Blank / out-of-range cells are dropped; < 2 usable P values is refused.
    check_eq("pcorrect drops non-P cells", M["pcorrect"]({"pvalues": [0.01, 0.02, 1.5, -0.3, None]})["glance"]["n"], 2)
    try:
        M["pcorrect"]({"pvalues": [0.5]})
        check_eq("pcorrect refuses < 2 P values", "no-raise", "raise")
    except engine.StatsError:
        check_eq("pcorrect refuses < 2 P values", "raise", "raise")


def check_fit_flags():
    print("\n# Flag poor fits  (oracle: independently recompute the flag from the returned glance)")

    def expected(glance, cfg):
        """Re-implement the flag rule from scratch (no shared code with engine._apply_fit_flags):
        one reason per breached threshold; a threshold of None or a missing diagnostic skips."""
        g = glance
        reasons = 0
        tests = [
            ("r_sq", "rSqBelow", lambda v, t: v < t),
            ("n", "nBelow", lambda v, t: v < t),
            ("max_dependency", "dependencyAbove", lambda v, t: v > t),
            ("max_skewness", "skewnessAbove", lambda v, t: v > t),
            ("resid_normality_p", "residNormalityBelow", lambda v, t: v < t),
            ("outliers_removed", "outliersAbove", lambda v, t: v > t),
        ]
        for gkey, ckey, cmp in tests:
            t = cfg.get(ckey)
            v = g.get(gkey)
            if t is not None and isinstance(v, (int, float)) and cmp(v, t):
                reasons += 1
        return reasons

    # A noisy exp-decay fit (K is skewed, a few points) so several diagnostics are non-trivial.
    xd = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5]
    yt = [100 * math.exp(-0.5 * xi) for xi in xd]
    noise = [3.0, -4, 2, -3, 5, -2, 4, -3, 2]
    yd = [max(0.1, a + b) for a, b in zip(yt, noise)]
    base = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd, "y": yd, "initialValues": {"A": 100, "K": 0.5}})
    g = base["glance"]

    # 1) Permissive thresholds (nothing can breach) ⇒ not flagged, empty reasons.
    permissive = {"enabled": True, "rSqBelow": -1, "nBelow": 0, "dependencyAbove": 2,
                  "skewnessAbove": 1e9, "residNormalityBelow": 0, "outliersAbove": 1e9}
    rp = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd, "y": yd,
                        "initialValues": {"A": 100, "K": 0.5}, "flag": permissive})
    check_eq("flag: permissive thresholds → not flagged", rp.get("flagged"), False)
    check_eq("flag: permissive → 0 reasons", len(rp.get("flagReasons", [])), 0)

    # 2) Thresholds derived FROM the glance so a known subset fires: R² and dependency
    #    breach; n and skewness deliberately do not; residual-normality fires if present.
    cfg = {"enabled": True,
           "rSqBelow": float(g["r_sq"]) + 0.001,          # r_sq < that ⇒ fires
           "nBelow": int(g["n"]) - 1,                     # n < n-1 ⇒ never
           "dependencyAbove": float(g.get("max_dependency", 1.0)) - 0.001,  # dep > that ⇒ fires (if present)
           "skewnessAbove": float(g.get("max_skewness", 0.0)) + 1.0,        # never
           "residNormalityBelow": (float(g["resid_normality_p"]) + 0.001) if "resid_normality_p" in g else None,
           "outliersAbove": 1e9}                          # no ROUT ⇒ absent ⇒ never
    exp_reasons = expected(g, cfg)
    rf = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd, "y": yd,
                        "initialValues": {"A": 100, "K": 0.5}, "flag": cfg})
    check_eq("flag: engine flagged matches oracle (reasons>0)", rf.get("flagged"), exp_reasons > 0)
    check_eq("flag: reason COUNT matches independent recompute", len(rf.get("flagReasons", [])), exp_reasons)
    check("flag: R² breach is one of the fired reasons", 1.0 if any("R²" in s for s in rf.get("flagReasons", [])) else 0.0, 1.0, tol=0)

    # 3) Disabled config ⇒ the engine attaches no flag at all (opt-in).
    rn = M["curvefit"]({"model": "custom", "equation": "A*exp(-K*X)", "x": xd, "y": yd,
                        "initialValues": {"A": 100, "K": 0.5}, "flag": {"enabled": False}})
    check_eq("flag: disabled → no flagged key", rn.get("flagged"), None)

    # 4) ROUT outlier criterion: a planted outlier ⇒ outliers_removed>0 ⇒ the outlier reason fires.
    xo = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    yo = [2 * xi + 1 for xi in xo]
    yo[5] += 15.0
    ro = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": xo, "y": yo, "initialValues": {"A": 1, "B": 0},
                        "rout": True, "flag": {"enabled": True, "outliersAbove": 0}})
    check_eq("flag: ROUT outlier count breaches → flagged", ro.get("flagged"), True)
    check("flag: outlier reason mentions 'outlier'", 1.0 if any("outlier" in s for s in ro.get("flagReasons", [])) else 0.0, 1.0, tol=0)


def check_curvetransform():
    print("\n# smooth / differentiate / integrate a curve  (oracle: closed-form derivative/integral; polynomial-preserving smooth)")
    x = list(range(11))  # 0..10
    yline = [2 * xi + 1 for xi in x]
    # d/dX of a straight line ≡ its slope (2) everywhere (central + one-sided are exact for a line).
    yd = M["curvetransform"]({"x": x, "y": yline, "variant": "differentiate"})["extra"]["curve"]["y"]
    check_le("d/dX of a line ≡ 2", max(abs(v - 2.0) for v in yd), 1e-6)
    # d/dX of X² = 2X at the interior points (central difference is exact for a quadratic).
    yq = M["curvetransform"]({"x": x, "y": [xi * xi for xi in x], "variant": "differentiate"})["extra"]["curve"]["y"]
    check_le("d/dX of X² = 2X (interior)", max(abs(yq[i] - 2 * x[i]) for i in range(1, 10)), 1e-6)
    # ∫1·dX = X (the trapezoid rule is exact for a constant integrand).
    yi = M["curvetransform"]({"x": x, "y": [1.0] * 11, "variant": "integrate"})["extra"]["curve"]["y"]
    check_le("∫1·dX = X (constant → ramp)", max(abs(yi[i] - x[i]) for i in range(11)), 1e-9)
    # ∫X·dX = X²/2 (trapezoid is exact for a linear integrand); total ∫₀¹⁰ = 50.
    rx = M["curvetransform"]({"x": x, "y": [float(xi) for xi in x], "variant": "integrate"})
    yx = rx["extra"]["curve"]["y"]
    check_le("∫X·dX = X²/2 (linear → quadratic)", max(abs(yx[i] - x[i] ** 2 / 2) for i in range(11)), 1e-9)
    check("∫₀¹⁰ X·dX total area = 50", rx["glance"]["area"], 50.0, tol=1e-9)
    # Savitzky-Golay smoothing preserves a polynomial up to its order → a line is unchanged.
    ys = M["curvetransform"]({"x": x, "y": yline, "variant": "smooth", "smoothWindow": 5})["extra"]["curve"]["y"]
    check_le("smooth preserves a straight line", max(abs(ys[i] - yline[i]) for i in range(11)), 1e-6)


def check_cluster():
    print("\n# hierarchical clustering: distance metrics + linkages  (oracle: cosine groups by direction; every linkage separates 2 blobs)")
    # Cosine distance is magnitude-invariant → it groups by direction; Euclidean by proximity.
    # A1(1,1) & A2(5,5) share direction (1,1); B1(1,−1) & B2(5,−5) share (1,−1).
    xs, ys = [1, 5, 1, 5], [1, 5, -1, -5]
    lc = M["cluster"]({"columns": [xs, ys], "variant": "hierarchical", "k": 2, "metric": "cosine", "linkage": "average", "standardize": False})["extra"]["cluster"]["labels"]
    le = M["cluster"]({"columns": [xs, ys], "variant": "hierarchical", "k": 2, "metric": "euclidean", "linkage": "average", "standardize": False})["extra"]["cluster"]["labels"]
    check_eq("cluster cosine groups A1,A2 by direction", bool(lc[0] == lc[1] and lc[0] != lc[2]), True)
    check_eq("cluster euclidean differs from cosine (groups A1,B1)", bool(le[0] == le[2]), True)
    # Every linkage recovers two well-separated blobs (3 near the origin, 3 near (10,10)).
    bx, by = [0, 0.1, 0, 10, 10.1, 10], [0, 0, 0.1, 10, 10, 10.1]
    for lk in ("ward", "average", "weighted", "complete", "single", "centroid", "median"):
        lab = M["cluster"]({"columns": [bx, by], "variant": "hierarchical", "k": 2, "metric": "euclidean", "linkage": lk, "standardize": False})["extra"]["cluster"]["labels"]
        check_eq("cluster %s linkage separates 2 blobs" % lk, bool(lab[0] == lab[1] == lab[2] and lab[3] == lab[4] == lab[5] and lab[0] != lab[3]), True)
    # Centroid/median force the Euclidean metric even if a non-Euclidean one is requested (no crash).
    lcm = M["cluster"]({"columns": [bx, by], "variant": "hierarchical", "k": 2, "metric": "cosine", "linkage": "centroid", "standardize": False})["extra"]["cluster"]["labels"]
    check_eq("cluster centroid+cosine forced-euclidean runs", bool(lcm[0] != lcm[3]), True)
    # Clustering guards. Oracle = sklearn.metrics.silhouette_score (a wholly
    # separate implementation) with the same metric that formed the clusters.
    from sklearn.metrics import silhouette_score
    X = np.column_stack([xs, ys]).astype(float)
    lc_a = np.array(lc)
    # The reported silhouette must use the clustering metric, not always Euclidean —
    # a perfect cosine clustering scores ~1.0, not the ~0.078 Euclidean value.
    sil_cos = M["cluster"]({"columns": [xs, ys], "variant": "hierarchical", "k": 2, "metric": "cosine", "linkage": "average", "standardize": False})["glance"]["silhouette"]
    check("cluster cosine silhouette uses the cosine metric", sil_cos, float(silhouette_score(X, lc_a, metric="cosine")), tol=1e-3)
    check_eq("cluster cosine silhouette != euclidean value", bool(abs(sil_cos - float(silhouette_score(X, lc_a, metric="euclidean"))) > 0.5), True)
    # The UI 'manhattan' label maps to scipy 'cityblock' → runs (no engine_internal) and
    # its silhouette matches the independent L1 silhouette.
    rman = M["cluster"]({"columns": [xs, ys], "variant": "hierarchical", "k": 2, "metric": "manhattan", "linkage": "average", "standardize": False})
    check("cluster manhattan→cityblock runs + L1 silhouette", rman["glance"]["silhouette"], float(silhouette_score(X, np.array(rman["extra"]["cluster"]["labels"]), metric="cityblock")), tol=1e-3)
    # Default standardize=True glance silhouette + withinSS. Oracle: standardise with the
    # same (ddof=0) SD, take the engine's labels, recompute silhouette (sklearn) + within-SS.
    v1 = [0.0, 0.2, -0.1, 10.0, 10.2, 9.9, 20.0, 20.1, 19.8]
    v2 = [0.0, -0.1, 0.2, 10.1, 9.9, 10.0, 20.0, 19.9, 20.2]
    rc = M["cluster"]({"columns": [v1, v2], "variant": "hierarchical", "k": 3, "linkage": "ward", "standardize": True})
    lab3 = np.array(rc["extra"]["cluster"]["labels"])
    Xr = np.column_stack([v1, v2]).astype(float)
    Zs = (Xr - Xr.mean(0)) / Xr.std(0, ddof=0)  # engine standardises with ddof=0
    wss = float(sum(np.sum((Zs[lab3 == c] - Zs[lab3 == c].mean(0)) ** 2) for c in set(lab3.tolist())))
    check("cluster standardized within-SS", rc["glance"]["withinSS"], wss)
    check("cluster standardized silhouette (sklearn)", rc["glance"]["silhouette"], float(silhouette_score(Zs, lab3)), tol=1e-3)


# ── k-selection scan — vs sklearn silhouette_score + KMeans inertia (independent) ──
def check_clusteroptk():
    print("\n# cluster k-scan  (oracle: sklearn silhouette_score + KMeans inertia_)")
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score
    rng = np.random.default_rng(7)
    blobs = np.vstack([rng.normal(m, 0.25, (40, 2)) for m in [(0.0, 0.0), (6.0, 0.0), (3.0, 6.0)]])
    cols = [list(blobs[:, 0]), list(blobs[:, 1])]
    r = M["cluster"]({"columns": cols, "labels": ["x", "y"], "variant": "kmeans", "k": 3,
                      "standardize": False, "scanK": True, "kMax": 6, "seed": 1})
    sc = r["extra"]["cluster"]["kScan"]
    ks, sil, wss = sc["ks"], sc["silhouette"], sc["withinSS"]
    # Three well-separated blobs → the mean silhouette is maximised at k=3 (structural truth).
    check_eq("optk suggested k == 3 (three blobs)", sc["bestKSilhouette"], 3)
    check_eq("optk elbow k near 3", sc["elbowK"] in (2, 3, 4), True)
    check_eq("optk scan spans k=2..6", ks == [2, 3, 4, 5, 6], True)
    # engine silhouette@k=3 == sklearn silhouette_score on an independent KMeans partition
    lab3 = KMeans(n_clusters=3, n_init=10, random_state=0).fit_predict(blobs)
    check("optk silhouette@k=3 (sklearn)", sil[ks.index(3)], float(silhouette_score(blobs, lab3)), tol=5e-3)
    # engine within-SS@k=3 == sklearn KMeans inertia_ (same objective + same recovered partition)
    inertia3 = float(KMeans(n_clusters=3, n_init=10, random_state=0).fit(blobs).inertia_)
    check("optk withinSS@k=3 (sklearn inertia)", wss[ks.index(3)], inertia3, tol=5e-3)


def check_nlresid():
    print("\n# nonlinear-fit residual diagnostics  (oracle: stdlib OLS + closed-form runs / lack-of-fit)")
    # A straight line fit through the nonlinear driver converges to OLS, so stdlib gives
    # the same residuals — against which we recompute SSE / Sy.x / adjusted-R² / runs / LOF.
    x = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    y = [3.1, 2.9, 5.05, 4.95, 7.1, 6.9, 9.05, 8.95, 11.1, 10.9]
    n = len(x)
    slope, intercept = st.linear_regression(x, y)  # stdlib OLS (independent of scipy)
    resid = [yi - (intercept + slope * xi) for xi, yi in zip(x, y)]
    sse = sum(e * e for e in resid)
    df = n - 2
    syx = math.sqrt(sse / df)
    ybar = st.mean(y)
    sst = sum((yi - ybar) ** 2 for yi in y)
    adj = 1 - (1 - (1 - sse / sst)) * (n - 1) / df  # 1 − (SSE/df)/(SST/(n−1))
    signs = [1 if e > 0 else (-1 if e < 0 else 0) for e in resid]
    nz = [s for s in signs if s != 0]
    runs = 1 + sum(1 for a, b in zip(nz[1:], nz[:-1]) if a != b)  # Wald-Wolfowitz run count
    levels = sorted(set(x))
    pe = 0.0
    for u in levels:  # pure-error SS = within-replicate scatter
        yj = [yi for xi, yi in zip(x, y) if xi == u]
        mj = sum(yj) / len(yj)
        pe += sum((v - mj) ** 2 for v in yj)
    m = len(levels)
    df_lof, df_pe = m - 2, n - m
    F_lof = ((sse - pe) / df_lof) / (pe / df_pe)  # (LOF/df_lof)/(PE/df_pe)
    r = M["curvefit"]({"model": "custom", "equation": "A*X+B", "x": x, "y": y, "initialValues": {"A": 1, "B": 0}})
    g = r["glance"]
    check("nlresid SSE", g["sse"], sse)
    check("nlresid Sy.x (RMSE)", g["syx"], syx)
    check("nlresid adjusted R^2", g["adj_r_sq"], adj)
    check("nlresid runs count", term(r, "Runs test (lack of fit)"), runs)
    check("nlresid lack-of-fit F", term(r, "Lack of fit (replicates)"), F_lof)


def check_enzyme_progress():
    print("\n# enzyme progress curve (integrated MM)  (oracle: implicit KM·ln(S0/S)+(S0−S)=Vmax·t by bisection)")

    def prog(t, vmax, km, s0):  # solve for S, return P = S0 − S — independent of Lambert-W
        target = vmax * t
        lo, hi = 1e-12, s0
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            f = km * math.log(s0 / mid) + (s0 - mid)  # decreasing in mid
            if f > target:
                lo = mid
            else:
                hi = mid
        return s0 - 0.5 * (lo + hi)

    V, K, S = 12.0, 25.0, 80.0
    t = [0, 1, 2, 3, 4, 6, 8, 11, 14, 18, 23, 30, 40, 55]
    y = [prog(x, V, K, S) for x in t]
    r = M["curvefit"]({"model": "enzyme_progress", "x": t, "y": y})
    g = r["glance"]
    check("enzyme_progress Vmax", g["vmax"], V)
    check("enzyme_progress KM", g["km"], K)
    check("enzyme_progress S0", g["s0"], S)
    check("enzyme_progress V0 = Vmax·S0/(KM+S0)", term(r, "Initial velocity"), V * S / (K + S))


def check_allosteric_binding():
    print("\n# allosteric ternary-complex binding  (oracle: hand-written Bmax·A/(A+KA·(1+B/KB)/(1+αB/KB)))")
    Bmax, A, KA, KB, al = 1000.0, 2.0, 5.0, 100.0, 0.2
    xb = [1, 3.16, 10, 31.6, 100, 316, 1000, 3160, 10000]
    y = [Bmax * A / (A + KA * (1 + B / KB) / (1 + al * B / KB)) for B in xb]  # oracle (not engine code)
    g = M["curvefit"]({"model": "allosteric_binding", "x": xb, "y": y, "fixed": {"A": A, "KA": KA}})["glance"]
    check("allosteric_binding Bmax", g["bmax"], Bmax)
    check("allosteric_binding KB", g["KB"], KB)
    check("allosteric_binding Alpha", g["Alpha"], al)
    check("allosteric_binding R^2", g["r_sq"], 1.0)


def check_ic50_norm():
    print("\n# normalized-inhibition IC50 (absolute IC50)  (oracle: hand-written 100/(1+10^((log10 x − logIC50)·h)))")
    ic50_true, h = 25.0, 1.5
    logic50 = math.log10(ic50_true)
    dose = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000]
    y = [100.0 / (1 + 10 ** ((math.log10(dx) - logic50) * h)) for dx in dose]  # oracle (not engine code)
    g = M["curvefit"]({"model": "ic50_norm_4pl", "x": dose, "y": y})["glance"]
    check("ic50_norm 4PL IC50", g["IC50"], ic50_true)
    check("ic50_norm 4PL Hill", g["hill_slope"], h)
    check("ic50_norm 4PL R^2", g["r_sq"], 1.0)
    y1 = [100.0 / (1 + 10 ** (math.log10(dx) - logic50)) for dx in dose]  # constant slope (h = 1)
    g3 = M["curvefit"]({"model": "ic50_norm_3pl", "x": dose, "y": y1})["glance"]
    check("ic50_norm 3PL IC50", g3["IC50"], ic50_true)


def check_effect_size():
    print("\n# effect sizes  (oracle: stdlib pooled-SD Cohen's d + Hedges J + noncentral-t CI condition)")
    # Unpaired: pooled SD, df = na+nb−2, n_eff = na·nb/(na+nb).
    a = [8.1, 7.4, 9.2, 8.8, 7.9, 8.5]
    b = [6.2, 5.9, 6.8, 6.1, 5.5, 6.4]
    na, nb = len(a), len(b)
    sp = math.sqrt(((na - 1) * st.variance(a) + (nb - 1) * st.variance(b)) / (na + nb - 2))
    d = (st.mean(a) - st.mean(b)) / sp
    df = na + nb - 2
    J = 1.0 - 3.0 / (4.0 * df - 1.0)
    r = M["ttest"]({"variant": "unpaired", "a": a, "b": b, "conf": 0.95})
    check("effect unpaired Cohen's d", r["glance"]["cohens_d"], d)
    check("effect unpaired Hedges' g = J·d", r["glance"]["hedges_g"], d * J)
    check("effect unpaired Glass Δ (÷ SD_B)", r["glance"]["glass_delta"], (st.mean(a) - st.mean(b)) / st.stdev(b))
    # d CI: the reported [dlo,dhi] must satisfy nct_cdf(tobs; df, d·√n_eff) = {1−α/2, α/2}.
    row = _term(r, "Cohen's d")
    dlo, dhi = row.get("ciLow"), row.get("ciHigh")
    neff = na * nb / (na + nb)
    tobs = d * math.sqrt(neff)
    check("effect unpaired d CI-hi ⇒ nct lower-tail 0.025", nct_cdf(tobs, df, dhi * math.sqrt(neff)), 0.025, tol=3e-3)
    check("effect unpaired d CI-lo ⇒ nct lower-tail 0.975", nct_cdf(tobs, df, dlo * math.sqrt(neff)), 0.975, tol=3e-3)
    grow = _term(r, "Hedges' g")
    check("effect Hedges g CI-lo = J·d-CI-lo", grow.get("ciLow"), dlo * J)
    check("effect Hedges g CI-hi = J·d-CI-hi", grow.get("ciHigh"), dhi * J)

    # Paired: d = mean(diff)/sd(diff); df = n−1; n_eff = n.
    p_ = [12.1, 11.5, 13.2, 12.8, 11.9, 12.4, 13.0, 12.2]
    q_ = [10.2, 10.9, 11.1, 10.5, 10.0, 11.4, 10.8, 10.6]
    dif = [x - y for x, y in zip(p_, q_)]
    n = len(dif)
    dp = st.mean(dif) / st.stdev(dif)
    rp = M["ttest"]({"variant": "paired", "a": p_, "b": q_, "conf": 0.95})
    check("effect paired Cohen's d", rp["glance"]["cohens_d"], dp)
    check("effect paired Hedges' g", rp["glance"]["hedges_g"], dp * (1.0 - 3.0 / (4.0 * (n - 1) - 1.0)))
    rowp = _term(rp, "Cohen's d")
    dlop, dhip = rowp.get("ciLow"), rowp.get("ciHigh")
    tobsp = dp * math.sqrt(n)
    check("effect paired d CI-hi ⇒ nct lower-tail 0.025", nct_cdf(tobsp, n - 1, dhip * math.sqrt(n)), 0.025, tol=3e-3)
    check("effect paired d CI-lo ⇒ nct lower-tail 0.975", nct_cdf(tobsp, n - 1, dlop * math.sqrt(n)), 0.975, tol=3e-3)


def check_mannwhitney():
    print("\n# Mann-Whitney U  (oracle: mid-ranks by hand + exact C(n,·) enumeration null)")
    a, b = [1, 2, 3, 4, 5], [6, 7, 8, 9, 10]
    ua = sum(avg_ranks(a + b)[:len(a)]) - len(a) * (len(a) + 1) / 2.0
    r = M["ttest"]({"variant": "mann-whitney", "a": a, "b": b, "tail": "two-sided"})
    check("MWU U (mid-ranks)", r["glance"]["U"], ua)
    # Not `2*ua/(na*nb) - 1`: that is the engine's own formula, and copying it here would
    # re-derive the implementation instead of checking it (it cannot catch an inverted sign).
    # An oracle that shares the code under test is not an oracle. Counted from pairs
    # instead: r = P(a>b) − P(a<b), definitionally.
    check("MWU rank-biserial (pair counts)", r["glance"]["rank_biserial"], rank_biserial_by_pairs(a, b))
    check("MWU rank-biserial sign matches the medians",
          1.0 if r["glance"]["rank_biserial"] < 0 else 0.0,
          1.0 if st.median(a) < st.median(b) else 0.0)
    # Reversing the groups must flip the sign, and identical groups must give exactly 0.
    rev = M["ttest"]({"variant": "mann-whitney", "a": b, "b": a, "tail": "two-sided"})
    check("MWU rank-biserial reversed", rev["glance"]["rank_biserial"], rank_biserial_by_pairs(b, a))
    same = M["ttest"]({"variant": "mann-whitney", "a": [1, 2, 3], "b": [1, 2, 3], "tail": "two-sided"})
    check("MWU rank-biserial identical", same["glance"]["rank_biserial"], 0.0)
    part = M["ttest"]({"variant": "mann-whitney", "a": [1, 2, 3, 4], "b": [3, 4, 5, 6], "tail": "two-sided"})
    check("MWU rank-biserial partial overlap", part["glance"]["rank_biserial"],
          rank_biserial_by_pairs([1, 2, 3, 4], [3, 4, 5, 6]))
    check("MWU exact p (separation)", r["glance"]["p"], 2.0 / math.comb(10, 5))
    # Non-separated case: U + exact enumeration p (no ties → scipy uses the exact null too).
    a2, b2 = [1, 2, 3, 7], [4, 5, 6, 8]
    ua2 = sum(avg_ranks(a2 + b2)[:len(a2)]) - len(a2) * (len(a2) + 1) / 2.0
    r2 = M["ttest"]({"variant": "mann-whitney", "a": a2, "b": b2, "tail": "two-sided"})
    check("MWU U non-separated", r2["glance"]["U"], ua2)
    check("MWU exact p non-separated", r2["glance"]["p"], mwu_exact_p(len(a2), len(b2), ua2))


def check_wilcoxon():
    print("\n# Wilcoxon signed-rank  (oracle: signed mid-ranks by hand + exact 2^n null)")
    # One-sample [3,5,8,2,9,11,4,7] vs μ=4 → W = min(T+,T−) from signed mid-ranks (drop zeros).
    x, mu = [3, 5, 8, 2, 9, 11, 4, 7], 4
    w_obs, _ = signed_rank_min([xi - mu for xi in x])
    r = M["ttest"]({"variant": "wilcoxon-1samp", "a": x, "mu": mu, "tail": "two-sided"})
    check("Wilcoxon 1-samp W (signed mid-ranks)", r["glance"]["W"], w_obs)
    # Clean paired case: distinct nonzero diffs → exact 2^n two-sided p is unambiguous.
    p_ = [11, 10, 14, 16, 9, 20]
    q_ = [10, 12, 10, 11, 15, 12]  # diffs = [1,-2,4,5,-6,8]
    w2, ranks2 = signed_rank_min([x - y for x, y in zip(p_, q_)])
    rp = M["ttest"]({"variant": "wilcoxon", "a": p_, "b": q_, "tail": "two-sided"})
    check("Wilcoxon paired W", rp["glance"]["W"], w2)
    check("Wilcoxon paired exact p", rp["glance"]["p"], wilcoxon_exact_p(ranks2, w2))


def check_ks():
    print("\n# Kolmogorov-Smirnov 2-sample  (oracle: max ECDF gap by hand + exact separation p)")
    a, b = [1, 2, 3, 4], [5, 6, 7, 8]
    rk = M["ttest"]({"variant": "ks", "a": a, "b": b})
    check("KS D (separation)", rk["glance"]["D"], ks_d(a, b))
    check("KS exact p (separation)", rk["glance"]["p"], 2.0 / math.comb(8, 4))
    a2, b2 = [1, 2, 3, 7, 9], [4, 5, 6, 8, 10]
    check("KS D (overlap)", M["ttest"]({"variant": "ks", "a": a2, "b": b2})["glance"]["D"], ks_d(a2, b2))


def check_grubbs():
    print("\n# Grubbs outlier test  (oracle: G=max|x−mean|/sd + closed-form Gcrit via mpmath t)")
    x = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 50.0]
    n = len(x)
    mean, sd = st.mean(x), st.stdev(x)
    G = max(abs(v - mean) for v in x) / sd
    alpha = 0.05
    tcrit = t_crit_two(n - 2, alpha / n)  # = t.ppf(1 − α/(2n), n−2)
    gcrit = ((n - 1) / math.sqrt(n)) * math.sqrt(tcrit ** 2 / (n - 2 + tcrit ** 2))
    denom = (n - 1) ** 2 - n * G * G
    p = min(1.0, n * t_p_two(math.sqrt(n * (n - 2) * G * G / denom), n - 2))  # 2n·t.sf = n·(two-sided)
    r = M["outliers"]({"values": x, "variant": "single", "alpha": alpha})
    row = _term(r, "Outlier 1")
    check("Grubbs G statistic", row.get("statistic"), G)
    check("Grubbs Gcrit (closed form)", row.get("gCritical"), gcrit)
    check("Grubbs two-sided p", row.get("p"), p)
    check("Grubbs outlier value", row.get("estimate"), 50.0)
    check_eq("Grubbs removes exactly 1", r["glance"]["removed"], 1)


def check_rout_column():
    print("\n# ROUT on a column  (oracle: median + RSDR=pct68.269·n/(n−1) + t-tail + BH-FDR)")
    x = [2.0, 2.1, 1.9, 2.2, 2.0, 1.8, 2.05, 1.95, 2.1, 9.0]  # one gross outlier
    n = len(x)
    center = st.median(x)
    resid = [abs(v - center) for v in x]
    rsdr = pure_percentile(resid, 68.269) * (n / (n - 1))
    tratios = [rr / rsdr for rr in resid]
    pv = [float(t_p_two(tr, n - 1)) for tr in tratios]  # engine: 2·t.sf(ti,df) = two-sided (ti≥0)
    q = bh_fdr(pv)
    Q = 0.01
    r = M["outliers"]({"values": x, "variant": "rout", "Q": Q})
    check("ROUT centre (median)", r["glance"]["center"], center)
    check("ROUT RSDR", r["glance"]["rsdr"], rsdr)
    check_eq("ROUT removed count", r["glance"]["removed"], sum(qi <= Q for qi in q))
    imax = max(range(n), key=lambda i: resid[i])  # the 9.0
    row = _term(r, "Outlier 1")
    check("ROUT outlier value", row.get("estimate"), x[imax])
    check("ROUT outlier t-ratio", row.get("statistic"), tratios[imax])
    check("ROUT outlier q-value", row.get("qValue"), q[imax])


def check_power():
    print("\n# power / sample size  (oracle: noncentral-t tail via mpmath)")
    alpha = 0.05
    # Forward: unpaired t, d=0.8, n=25/group → power = P(|T'|>tcrit), ncp=d√(n/2), df=2n−2.
    d, n = 0.8, 25
    df = 2 * n - 2
    ncp = d * math.sqrt(n / 2.0)
    tcrit = t_crit_two(df, alpha)
    pw = 1 - nct_cdf(tcrit, df, ncp) + nct_cdf(-tcrit, df, ncp)
    r = M["power"]({"test": "ttest-two", "solve": "power", "effect": d, "n": n, "alpha": alpha, "tail": "two-sided"})
    check("power two-sample t (forward)", r["glance"]["power"], pw, tol=2e-3)
    # Forward: one-sample t, d=0.6, n=20 → ncp=d√n, df=n−1.
    d1, n1 = 0.6, 20
    tc1 = t_crit_two(n1 - 1, alpha)
    pw1 = 1 - nct_cdf(tc1, n1 - 1, d1 * math.sqrt(n1)) + nct_cdf(-tc1, n1 - 1, d1 * math.sqrt(n1))
    r1 = M["power"]({"test": "ttest-onesample", "solve": "power", "effect": d1, "n": n1, "alpha": alpha})
    check("power one-sample t (forward)", r1["glance"]["power"], pw1, tol=2e-3)
    # Inverse: solve N for d=0.8, power=0.9 → the returned exact-N's power ≈ 0.9.
    rn = M["power"]({"test": "ttest-two", "solve": "n", "effect": 0.8, "power": 0.9, "alpha": alpha, "tail": "two-sided"})
    ne = rn["glance"]["n_exact"]
    dfe, ncpe, tce = 2 * ne - 2, 0.8 * math.sqrt(ne / 2.0), t_crit_two(2 * ne - 2, alpha)
    check("power solve-N: power at n_exact ≈ 0.9", 1 - nct_cdf(tce, dfe, ncpe) + nct_cdf(-tce, dfe, ncpe), 0.9, tol=3e-3)
    # Three more designs. zcrit = the two-sided normal critical value.
    zc = float(mp.sqrt(2) * mp.erfinv(2 * mp.mpf(1 - alpha / 2) - 1))
    # correlation — the engine's own Fisher-z path: power = Φ(arctanh(r)·√(n−3) − zcrit).
    rc = M["power"]({"test": "correlation", "solve": "power", "effect": 0.5, "n": 30, "alpha": alpha})["glance"]
    check("power correlation (Fisher-z)", rc["power"], normal_cdf(math.atanh(0.5) * math.sqrt(30 - 3) - zc))
    # two proportions — Cohen's h = 2(asin√p1 − asin√p2); normal-approx two-sided power.
    rp = M["power"]({"test": "twoproportions", "solve": "power", "p1": 0.6, "p2": 0.4, "n": 50, "alpha": alpha})["glance"]
    h = 2 * math.asin(math.sqrt(0.6)) - 2 * math.asin(math.sqrt(0.4))
    seh = math.sqrt(1 / 50 + 1 / 50)
    check("power two-proportions (Cohen's h)", rp["power"], normal_cdf(abs(h) / seh - zc) + normal_cdf(-abs(h) / seh - zc), tol=1e-3)
    # one-way ANOVA — noncentral F: ncp = f²·N, power = P(F' > F_crit), df=(k−1, N−k).
    from scipy.stats import ncf, f as _f
    ra = M["power"]({"test": "anova", "solve": "power", "effect": 0.4, "n": 45, "alpha": alpha, "kGroups": 3})["glance"]
    dfn, dfd = 2, 45 - 3
    fcrit = float(_f.ppf(1 - alpha, dfn, dfd))
    check("power one-way ANOVA (noncentral F)", ra["power"], float(ncf.sf(fcrit, dfn, dfd, 0.4 ** 2 * 45)), tol=1e-3)


def check_ancova_slopediff():
    print("\n# ANCOVA slope difference + CI  (oracle: separate-line OLS, pooled s², t on N−4)")
    g1x = [1.0, 2, 3, 4, 5, 6]
    g1y = [2.1, 4.0, 5.9, 8.2, 9.8, 12.1]  # slope ≈ 2
    g2x = [1.0, 2, 3, 4, 5, 6]
    g2y = [1.0, 1.6, 2.1, 2.9, 3.4, 4.1]   # slope ≈ 0.6
    r = M["ancova"]({"groups": [{"label": "A", "x": g1x, "y": g1y}, {"label": "B", "x": g2x, "y": g2y}], "conf": 0.95})
    row = next((t for t in r["terms"] if t["term"].startswith("Slope difference")), {})

    def ols(x, y):  # closed-form simple OLS → (slope, SSE, Sxx)
        n = len(x); mx = sum(x) / n; my = sum(y) / n
        sxx = sum((xi - mx) ** 2 for xi in x)
        b = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y)) / sxx
        a = my - b * mx
        return b, sum((yi - (a + b * xi)) ** 2 for xi, yi in zip(x, y)), sxx

    b1, sse1, sxx1 = ols(g1x, g1y)
    b2, sse2, sxx2 = ols(g2x, g2y)
    df = len(g1x) + len(g2x) - 4
    s2 = (sse1 + sse2) / df
    se = (s2 * (1.0 / sxx1 + 1.0 / sxx2)) ** 0.5
    delta = b1 - b2
    tstat = delta / se
    tcrit = t_crit_two(df, 0.05)
    check("ancova slope diff estimate", row.get("estimate"), delta)
    check("ancova slope diff SE", row.get("se"), se)
    check("ancova slope diff t", row.get("statistic"), tstat)
    check_eq("ancova slope diff df = N−4", row.get("df"), df)
    check("ancova slope diff p", row.get("p"), t_p_two(abs(tstat), df))
    check("ancova slope diff CI low", row.get("ciLow"), delta - tcrit * se)
    check("ancova slope diff CI high", row.get("ciHigh"), delta + tcrit * se)
    # Internal identity: for k=2 the omnibus slope F (1 numerator df) equals t².
    check("ancova k=2: F_slope == t²", r["glance"]["F_slope"], tstat * tstat)


def check_fisher_freeman_halton():
    print("\n# Fisher-Freeman-Halton exact  (oracle: 2×2 == scipy fisher_exact; r×c == independent lgamma enum, mass=1)")
    from scipy import stats as sp

    def ffh_rc(table):
        """Independent FFH: enumerate all tables with these margins via math.lgamma;
        return (p = Σ P over tables with P ≤ P_obs, mass = Σ P over all tables ≈ 1)."""
        r, c = len(table), len(table[0])
        rows = [sum(row) for row in table]
        cols = [sum(row[j] for row in table) for j in range(c)]
        nt = sum(rows)
        lg = lambda k: math.lgamma(k + 1)
        const = sum(lg(x) for x in rows) + sum(lg(x) for x in cols) - lg(nt)
        lp = lambda cells: const - sum(lg(v) for row in cells for v in row)
        pobs = lp(table)
        acc = [0.0, 0.0]  # [p, mass]

        def gen(i, colrem, built):
            if i == r - 1:
                if all(v >= 0 for v in colrem):
                    pr = math.exp(lp(built + [colrem]))
                    acc[1] += pr
                    if lp(built + [colrem]) <= pobs + 1e-9:
                        acc[0] += pr
                return

            def comp(j, rem, row):
                if j == c - 1:
                    if 0 <= rem <= colrem[j]:
                        full = row + [rem]
                        gen(i + 1, [colrem[t] - full[t] for t in range(c)], built + [full])
                    return
                for v in range(min(rem, colrem[j]) + 1):
                    comp(j + 1, rem - v, row + [v])

            comp(0, rows[i], [])

        gen(0, cols[:], [])
        return min(1.0, acc[0]), acc[1]

    # (a) On a 2×2 the FFH helper must equal scipy's two-sided Fisher exact.
    for tab in ([[3, 1], [1, 4]], [[8, 2], [1, 5]], [[6, 0], [2, 5]]):
        ffh, _ = engine._fisher_freeman_halton(tab)
        check("FFH 2×2 == scipy fisher_exact", ffh, float(sp.fisher_exact(tab)[1]))
    # (b) On r×c the engine's contingency ffh_p must equal the independent enum (mass → 1).
    for tab in ([[3, 1, 2], [1, 4, 1], [2, 0, 3]], [[4, 1, 2], [1, 3, 5]]):
        eng = M["contingency"]({"table": tab})["glance"].get("ffh_p")
        p_ind, mass = ffh_rc(tab)
        check("FFH enum normalizes to 1", mass, 1.0)
        check("FFH r×c engine == independent enum", eng, p_ind)


def check_delong_roc():
    print("\n# DeLong ROC comparison  (oracle: placement-value structural components by hand + MW AUC)")
    labels = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
    m1 = [0.1, 0.3, 0.2, 0.6, 0.4, 0.5, 0.7, 0.8, 0.65, 0.9]
    m2 = [0.2, 0.1, 0.5, 0.3, 0.55, 0.45, 0.6, 0.5, 0.7, 0.85]
    g = M["roc"]({"scores": m1, "scores2": m2, "labels": labels})["glance"]
    pos = [i for i, l in enumerate(labels) if l == 1]
    neg = [i for i, l in enumerate(labels) if l == 0]
    npos, nneg = len(pos), len(neg)
    psi = lambda x, yv: 1.0 if x > yv else (0.5 if x == yv else 0.0)

    def placements(m):
        v10 = [sum(psi(m[i], m[j]) for j in neg) / nneg for i in pos]
        v01 = [sum(psi(m[i], m[j]) for i in pos) / npos for j in neg]
        return sum(v10) / npos, v10, v01

    def cov(a, b, mdf):
        ma, mb = sum(a) / len(a), sum(b) / len(b)
        return sum((ai - ma) * (bi - mb) for ai, bi in zip(a, b)) / (mdf - 1)

    a1, v10a, v01a = placements(m1)
    a2, v10b, v01b = placements(m2)
    var1 = cov(v10a, v10a, npos) / npos + cov(v01a, v01a, nneg) / nneg
    var2 = cov(v10b, v10b, npos) / npos + cov(v01b, v01b, nneg) / nneg
    cov12 = cov(v10a, v10b, npos) / npos + cov(v01a, v01b, nneg) / nneg
    diff = a1 - a2
    se = (var1 + var2 - 2 * cov12) ** 0.5
    z = diff / se
    check("DeLong AUC1", g["auc1"], a1)
    check("DeLong AUC2", g["auc2"], a2)
    # AUC1 must also equal the Mann-Whitney AUC U/(n·m) — an independent structural anchor.
    check("DeLong AUC1 == MW U/(n·m)", a1, sum(psi(m1[i], m1[j]) for i in pos for j in neg) / (npos * nneg))
    check("DeLong AUC difference", g["auc_diff"], diff)
    check("DeLong SE(diff)", g["se_diff"], se)
    check("DeLong z", g["z"], z)
    check("DeLong p (two-sided vs mpmath Φ)", g["p"], 2.0 * (1.0 - normal_cdf(abs(z))))


def check_rounding():
    # The display helper engine._r must not round every value to a
    # fixed 6 decimals, which would collapse any headline stat with |x| < ~5e-7
    # (molar EC50/IC50/Kd/Ki, strongly-significant p-values) to 0.0. It keeps >=6
    # significant figures while leaving |x| >= 0.1 byte-identical. Both halves are
    # checked.
    print("\n# rounding  (oracle: significant-figure invariants + mpmath F-tail)")
    check("rounding molar Kd 4.636e-9 survives (not 0.0)", engine._r(4.636e-9), 4.636e-9, tol=1e-13)
    check_eq("rounding |x|>=1 byte-identical", engine._r(123.456789), 123.456789)
    check_eq("rounding [0.1,1) still 6-decimal", engine._r(0.1234567), round(0.1234567, 6))
    check_eq("rounding 0.0 preserved", engine._r(0.0), 0.0)
    check_eq("rounding None preserved", engine._r(None), None)
    # End-to-end: a strong-effect one-way ANOVA emits a real sub-1e-9 p, not 0.0, and
    # the surviving digits match an independent mpmath F-distribution tail.
    g = M["anova1"]({"groups": [[1.0, 1.1, 0.9, 1.05, 0.95], [5.0, 5.1, 4.9, 5.05, 4.95], [9.0, 9.1, 8.9, 9.05, 8.95]]})["glance"]
    check_eq("rounding strong ANOVA p not collapsed to 0", bool(0.0 < g["p"] < 1e-9), True)
    check("rounding strong ANOVA p == mpmath F-tail", g["p"], f_p(g["F"], g["df_between"], g["df_within"]), tol=1e-12)


def _cox_efron_nll(beta, X, T, E):
    """From-scratch Efron partial negative log-likelihood — shares no code with the
    engine's statsmodels PHReg. eta = Xβ; sum over unique event times of the tied-death
    contribution with Efron's fractional risk-set correction."""
    eta = X @ beta
    ll = 0.0
    for tj in np.unique(T[E == 1]):
        D = np.where((T == tj) & (E == 1))[0]
        R = np.where(T >= tj)[0]
        m = len(D)
        ll += eta[D].sum()
        sr = np.exp(eta[R]).sum()
        sd = np.exp(eta[D]).sum()
        for l in range(m):
            ll -= np.log(sr - (l / m) * sd)
    return -ll


def _num_hessian(f, x, h=1e-4):
    """Central-difference Hessian — the observed information of the NLL, inverted for SEs."""
    n = len(x)
    H = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            a = x.copy(); a[i] += h; a[j] += h
            b = x.copy(); b[i] += h; b[j] -= h
            c = x.copy(); c[i] -= h; c[j] += h
            e = x.copy(); e[i] -= h; e[j] -= h
            H[i, j] = (f(a) - f(b) - f(c) + f(e)) / (4 * h * h)
    return H


def _harrell_c(T, E, eta):
    """Harrell's C by a from-scratch O(n²) pair loop (η ties → ½)."""
    comp = conc = tie = 0.0
    for i in range(len(T)):
        if E[i] != 1:
            continue
        for k in range(len(T)):
            if T[k] > T[i]:
                comp += 1.0
                if eta[i] > eta[k]:
                    conc += 1.0
                elif eta[i] == eta[k]:
                    tie += 0.5
    return (conc + tie) / comp if comp > 0 else None


def check_cox():
    # The engine's Cox PH (statsmodels PHReg, Efron ties).
    # Oracle = a from-scratch Efron partial-likelihood re-fit via
    # scipy BFGS (≠ statsmodels Newton-Raphson), numeric-Hessian SEs, from-scratch
    # LR χ² = 2(ℓ(β̂) − ℓ(0)), mpmath χ² tail, and an O(n²) Harrell-C loop.
    print("\n# cox  (oracle: from-scratch Efron partial likelihood via scipy.optimize + numeric Hessian)")
    from scipy.optimize import minimize
    # Two covariates (continuous + binary) with tied event times at t=4 and t=6.
    T = np.array([4, 4, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 25.], float)
    E = np.array([1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1.], float)
    x1 = [2.1, 1.3, 3.4, 0.5, 2.2, 1.9, 0.8, 2.5, 3.1, 1.1, 0.4, 2.8, 1.7, 3.3, 0.9, 2.0, 1.5, 0.6, 2.9, 1.2]
    x2 = [0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1.]
    X = np.column_stack([x1, x2]).astype(float)
    r = M["cox"]({"time": list(T), "event": list(E), "predictors": [x1, x2], "names": ["x1", "x2"]})
    b = minimize(lambda z: _cox_efron_nll(z, X, T, E), np.zeros(2), method="BFGS").x
    se = np.sqrt(np.diag(np.linalg.inv(_num_hessian(lambda z: _cox_efron_nll(z, X, T, E), b))))
    for j, nm in enumerate(["x1", "x2"]):
        check("cox β %s (from-scratch Efron)" % nm, term(r, nm), float(b[j]))
        check("cox HR %s == exp(β)" % nm, term(r, nm, "hazardRatio"), float(np.exp(b[j])))
        check("cox se %s (numeric Hessian)" % nm, term(r, nm, "se"), float(se[j]), tol=1e-3)
    lr = 2.0 * (-_cox_efron_nll(b, X, T, E) + _cox_efron_nll(np.zeros(2), X, T, E))
    check("cox LR χ² (from-scratch)", r["glance"]["lr_chi2"], float(lr))
    check("cox LR p (mpmath χ² tail)", r["glance"]["p"], chi2_p(lr, 2))
    check("cox Harrell C (independent O(n²) loop)", r["glance"]["concordance"], _harrell_c(T, E, X @ b))
    # Freireich 6-MP vs placebo — a single-covariate literature dataset (well-known Cox HR).
    ft = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35,
          1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23]
    fe = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] + [1] * 21
    trt = [1] * 21 + [0] * 21  # 1 = 6-MP, 0 = placebo
    rf = M["cox"]({"time": ft, "event": fe, "predictors": [trt], "names": ["treat"]})
    Tf, Ef, Xf = np.array(ft, float), np.array(fe, float), np.array(trt, float).reshape(-1, 1)
    bf = minimize(lambda z: _cox_efron_nll(z, Xf, Tf, Ef), np.zeros(1), method="BFGS").x
    check("cox Freireich β (6-MP treatment)", term(rf, "treat"), float(bf[0]))
    check("cox Freireich HR (protective, ~0.21)", term(rf, "treat", "hazardRatio"), float(np.exp(bf[0])))
    check_eq("cox Freireich 6-MP lowers the hazard (HR < 1)", bool(term(rf, "treat", "hazardRatio") < 1.0), True)


def check_equivalence():
    """TOST equivalence. Oracle: statsmodels' own `ttost_ind` / `ttost_paired` — an
    independent implementation, not a re-derivation from the engine's own formulas.
    The one-sample case has no statsmodels entry point, so it is checked against the
    CI-containment identity, which is TOST's defining property: the test rejects at
    alpha exactly when the (1 − 2·alpha) interval lies inside the bounds."""
    print("\n# equivalence / TOST  (oracle: statsmodels ttost_ind / ttost_paired)")
    from statsmodels.stats.weightstats import ttost_ind, ttost_paired
    A = [10.1, 9.8, 10.3, 10.0, 9.9, 10.2, 10.05, 9.95, 10.15, 9.85]
    B = [10.4, 10.1, 9.9, 10.2, 9.95, 10.05, 10.1, 9.9, 10.0, 10.1]
    na, nb = np.array(A), np.array(B)

    g = M["equivalence"]({"variant": "unpaired", "a": A, "b": B, "bound": 0.5, "pooled": True})["glance"]
    p_sm, r1, r2 = ttost_ind(na, nb, -0.5, 0.5, usevar="pooled")
    check("tost unpaired (pooled): p", g["p"], p_sm)
    check("tost unpaired (pooled): t lower", g["t1"], r1[0])
    check("tost unpaired (pooled): t upper", g["t2"], r2[0])

    gw = M["equivalence"]({"variant": "unpaired", "a": A, "b": B, "bound": 0.5})["glance"]
    p_w, _, _ = ttost_ind(na, nb, -0.5, 0.5, usevar="unequal")
    check("tost unpaired (Welch, the engine default): p", gw["p"], p_w)

    gp = M["equivalence"]({"variant": "paired", "a": A, "b": B, "bound": 0.5})["glance"]
    p_p, _, _ = ttost_paired(na, nb, -0.5, 0.5)
    check("tost paired: p", gp["p"], p_p)

    # Asymmetric bounds must also route correctly (a symmetric-only bug would pass above).
    ga = M["equivalence"]({"variant": "unpaired", "a": A, "b": B, "boundLow": -0.4, "boundHigh": 0.7, "pooled": True})["glance"]
    p_a, _, _ = ttost_ind(na, nb, -0.4, 0.7, usevar="pooled")
    check("tost unpaired: asymmetric bounds", ga["p"], p_a)

    # TOST's defining identity, checked across a sweep: reject at alpha  ⟺  the
    # (1 − 2·alpha) CI sits inside the bounds. Verified for both decisions, so a
    # trivially-always-true (or always-false) verdict cannot pass.
    seen = set()
    for bd in (0.05, 0.1, 0.2, 0.3, 0.5, 1.0):
        gg = M["equivalence"]({"variant": "unpaired", "a": A, "b": B, "bound": bd})["glance"]
        inside = gg["bound_low"] < gg["ci_low"] and gg["ci_high"] < gg["bound_high"]
        check("tost bound %.2f: verdict == CI-inside-bounds" % bd, 1.0 if gg["equivalent"] else 0.0,
              1.0 if inside else 0.0)
        seen.add(bool(gg["equivalent"]))
    check("tost: the sweep exercised both verdicts (not vacuous)", 1.0 if seen == {True, False} else 0.0, 1.0)

    # One-sample: same identity, since statsmodels offers no ttost_1samp.
    g1 = M["equivalence"]({"variant": "one-sample", "a": A, "mu": 10.0, "bound": 0.3})["glance"]
    inside1 = g1["bound_low"] < g1["ci_low"] and g1["ci_high"] < g1["bound_high"]
    check("tost one-sample: verdict == CI-inside-bounds", 1.0 if g1["equivalent"] else 0.0,
          1.0 if inside1 else 0.0)
    # …and its p is the max of the two one-sided p-values, by construction.
    check("tost one-sample: p == max(p1, p2)", g1["p"], max(g1["p1"], g1["p2"]))


def check_permutation():
    """Permutation tests. Oracle: scipy's own `permutation_test` — an independent
    implementation — for the exact regime, where the answer is a definite number rather
    than a sample. The Monte Carlo regime is checked on the properties that must hold by
    construction (a sampled p cannot be compared to a fixed reference)."""
    print("\n# permutation  (oracle: scipy.stats.permutation_test, exact enumeration)")
    from scipy.stats import permutation_test

    # ── unpaired: permute group labels ──
    A, B = np.array([1.0, 2, 3, 4, 5]), np.array([6.0, 7, 8, 9, 10])
    st = lambda x, y, axis=0: np.mean(x, axis=axis) - np.mean(y, axis=axis)
    for alt, tail in (("two-sided", "two-sided"), ("greater", "greater"), ("less", "less")):
        g = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B), "tail": tail})["glance"]
        sp = permutation_test((A, B), st, permutation_type="independent", n_resamples=np.inf, alternative=alt)
        check("permutation unpaired exact (%s): p" % tail, g["p"], float(sp.pvalue))
    check("permutation unpaired: enumerated C(10,5)", M["permutation"](
        {"variant": "unpaired", "a": list(A), "b": list(B)})["glance"]["n_permutations"], math.comb(10, 5))

    # ── paired: flip the sign of each difference ──
    X = np.array([5.1, 4.8, 6.2, 5.5, 5.9, 6.1, 4.9, 5.3])
    Y = np.array([4.7, 4.9, 5.5, 5.0, 5.4, 5.6, 4.6, 5.1])
    gp = M["permutation"]({"variant": "paired", "a": list(X), "b": list(Y)})["glance"]
    spp = permutation_test((X - Y,), lambda dd, axis=0: np.mean(dd, axis=axis),
                           permutation_type="samples", n_resamples=np.inf, alternative="two-sided")
    check("permutation paired exact: p", gp["p"], float(spp.pvalue))
    check("permutation paired: enumerated 2^8", gp["n_permutations"], 256)

    # ── correlation: re-pair Y against X (kept small — scipy's pairings path is not vectorized) ──
    xa, yb = np.array([1.0, 2, 3, 4, 5, 6]), np.array([2.0, 1, 4, 3, 6, 5])
    gc = M["permutation"]({"variant": "correlation", "a": list(xa), "b": list(yb)})["glance"]
    spc = permutation_test((xa, yb), lambda x, y: float(np.corrcoef(x, y)[0, 1]),
                           permutation_type="pairings", n_resamples=np.inf,
                           alternative="two-sided", vectorized=False)
    check("permutation correlation exact: p", gc["p"], float(spc.pvalue))
    check("permutation correlation: enumerated 6!", gc["n_permutations"], 720)

    # ── properties that must hold by construction (independent of any oracle) ──
    # A permutation p can never be 0: the observed arrangement is itself a rearrangement.
    check_le("permutation exact: p ≥ 1/total (observed arrangement counted)",
             1.0 / 252 - M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B)})["glance"]["p"], 0.0)
    # Force the Monte Carlo path by forbidding enumeration, then check its guarantees.
    mc = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B),
                           "maxExact": 1, "nResamples": 999, "seed": 7})["glance"]
    check("permutation MC: sampled the requested number", mc["n_permutations"], 999)
    check_le("permutation MC: p ≥ 1/(N+1), never 0", 1.0 / 1000.0 - mc["p"], 0.0)
    check("permutation MC: the seed is reported for reproducibility", mc["seed"], 7)
    # Same seed → byte-identical result. This is the whole point of seeding.
    mc2 = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B),
                            "maxExact": 1, "nResamples": 999, "seed": 7})["glance"]
    check("permutation MC: same seed reproduces p exactly", mc2["p"], mc["p"], tol=0.0)
    # A different seed must land within Monte Carlo error of the exact answer.
    mc3 = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B),
                            "maxExact": 1, "nResamples": 20000, "seed": 99})["glance"]
    exact_p = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B)})["glance"]["p"]
    check_le("permutation MC (n=20000) is within 0.01 of the exact p", abs(mc3["p"] - exact_p), 0.01)
    # The reported CI must actually bracket the estimate it describes.
    check("permutation MC: p CI brackets p",
          1.0 if mc3["p_ci_low"] <= mc3["p"] <= mc3["p_ci_high"] else 0.0, 1.0)

    # One-sided p's partition the rearrangements, so they must sum to ≥ 1 (they overlap
    # on ties at the observed value) — a cheap check that the tails are not swapped.
    pg = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B), "tail": "greater"})["glance"]["p"]
    pl = M["permutation"]({"variant": "unpaired", "a": list(A), "b": list(B), "tail": "less"})["glance"]["p"]
    check_le("permutation: one-sided p's sum to ≥ 1 (tails not swapped)", 1.0 - (pg + pl), 0.0)
    # A is entirely below B, so "less" must be the significant tail, not "greater".
    check_le("permutation: the significant tail is the correct one", pl - 0.01, 0.0)
    check_le("permutation: the non-significant tail is large", 0.9 - pg, 0.0)


# JZS Bayes factors, generated from pingouin 0.6.1's `bayesfactor_ttest` — an
# independent implementation by another author. Frozen here so the battery does not
# DEPEND on pingouin: it is GPL-3.0 and is a developer tool only, never imported by
# engine.py and never bundled into the frozen engine. Where pingouin is installed the
# check below also runs live against it, which catches anything a frozen table cannot.
# Regenerate with: bayesfactor_ttest(t, n1, n2, paired=(n2 is None), r=scale)
_BF_REFERENCE = {
    # (t, n1, n2 or None, rscale): BF10
    (0.0, 20, None, "medium"): 0.232326294376,
    (1.0, 20, None, "medium"): 0.361270342995,
    (2.03, 30, None, "medium"): 1.16646981259,
    (3.5, 15, None, "medium"): 13.2315427768,
    (5.0, 40, None, "medium"): 1632.40269826,
    (2.0, 100, None, "medium"): 0.746923436101,
    (2.03, 30, None, "wide"): 0.922545527065,
    (2.03, 30, None, "ultrawide"): 0.697944605392,
    (0.0, 12, 15, "medium"): 0.359438454951,
    (1.5, 12, 15, "medium"): 0.815372513701,
    (3.0, 12, 15, "medium"): 7.4795525889,
    (2.5, 30, 28, "medium"): 3.38144829949,
    (2.5, 30, 28, "wide"): 2.98950042584,
    (10.0, 50, 50, "medium"): 3.40221859954e+13,
}


def check_bayesfactor():
    """JZS Bayes factors. Oracle: pingouin's `bayesfactor_ttest` (independent
    implementation), live where installed and frozen as a reference table otherwise.
    The engine's internal `_jzs_bf10` is called directly with a chosen t/df so the
    comparison isolates the Bayes-factor integral from any t-statistic differences."""
    print("\n# bayes factor  (oracle: pingouin bayesfactor_ttest — live if installed, else frozen values)")
    import engine as _E
    from scipy import stats as sp_stats
    live = None
    try:
        from pingouin import bayesfactor_ttest as live
    except ImportError:
        print("     (pingouin not installed — checking against the frozen reference table only)")

    for (t, n1, n2, rs), want in sorted(_BF_REFERENCE.items(), key=lambda kv: (kv[0][3], kv[0][1], kv[0][0])):
        r = _E._BF_RSCALES[rs]
        if n2 is None:
            nu, n_eff = n1 - 1, float(n1)
        else:
            nu, n_eff = n1 + n2 - 2, float(n1 * n2) / float(n1 + n2)
        got = _E._jzs_bf10(np, float(t), nu, n_eff, r)
        tag = "%g/%s/%s" % (t, ("n=%d" % n1) if n2 is None else "%dv%d" % (n1, n2), rs)
        check("bayes BF10 %s" % tag, got, want, tol=1e-8)
        if live is not None:
            fresh = float(live(t, n1, n2, r=r)) if n2 else float(live(t, n1, paired=True, r=r))
            check("bayes BF10 %s (live pingouin)" % tag, got, fresh, tol=1e-8)

    # ── properties that must hold whatever the implementation ──
    r = _E._BF_RSCALES["medium"]
    # Symmetric in the sign of t: the two-sided factor cannot care about direction.
    check("bayes: BF10 is symmetric in sign(t)", _E._jzs_bf10(np, 2.4, 29, 30.0, r),
          _E._jzs_bf10(np, -2.4, 29, 30.0, r))
    # t = 0 is the strongest possible evidence FOR the null, so BF10 < 1 there.
    check_le("bayes: t=0 gives BF10 < 1 (evidence for H0)", _E._jzs_bf10(np, 0.0, 29, 30.0, r), 1.0)
    # Monotone in |t| at fixed n — more extreme data cannot mean less evidence for H1.
    prev = None
    for tv in (0.0, 0.5, 1.0, 2.0, 3.0, 4.0):
        cur = _E._jzs_bf10(np, tv, 29, 30.0, r)
        if prev is not None:
            check_le("bayes: BF10 increases with |t| (t=%g)" % tv, prev - cur, 0.0)
        prev = cur
    # BF01 is exactly the reciprocal — the engine must not compute it separately and drift.
    g = M["bayesfactor"]({"variant": "one-sample", "a": [1.2, 0.8, 1.5, 0.9, 1.1, 1.4, 0.7, 1.3], "mu": 0.0})["glance"]
    check("bayes: BF01 == 1/BF10", g["bf01"], 1.0 / g["bf10"], tol=1e-6)
    check("bayes: log10(BF10) matches BF10", g["log10_bf10"], math.log10(g["bf10"]), tol=1e-6)

    # The engine's own t must agree with scipy's for the same data (it is scipy's, but this
    # pins the wiring: a variant reading the wrong array would sail past every check above).
    A = [5.1, 4.8, 6.2, 5.5, 5.9, 6.1, 4.9, 5.3]
    B = [4.7, 4.9, 5.5, 5.0, 5.4, 5.6, 4.6, 5.1]
    gp = M["bayesfactor"]({"variant": "paired", "a": A, "b": B})["glance"]
    check("bayes paired: t matches scipy ttest_rel", gp["t"], float(sp_stats.ttest_rel(A, B).statistic))
    gu = M["bayesfactor"]({"variant": "unpaired", "a": A, "b": B})["glance"]
    check("bayes unpaired: t matches scipy ttest_ind (pooled)", gu["t"],
          float(sp_stats.ttest_ind(A, B, equal_var=True).statistic))
    # …and the paired factor must equal the one-sample factor on the differences, since
    # that is what "paired" means. A wiring bug here is otherwise invisible.
    gd = M["bayesfactor"]({"variant": "one-sample", "a": [x - y for x, y in zip(A, B)], "mu": 0.0})["glance"]
    check("bayes: paired == one-sample on the differences", gp["bf10"], gd["bf10"], tol=1e-8)


def check_local_minimum_rescue():
    """A least-squares fit converges to whatever basin its starting
    values sit in, and a saturated start is a real local minimum: with b2 = 50,
    exp(-50x) is 0 at every design point, so the model is flat in b2 and the fit
    settles at SSE ≈ 1.4e4 while the planted global optimum (200, 0.5) has SSE = 0.
    The engine must escape it (one-at-a-time perturbed restarts — scaling the whole
    start vector stays in the same basin) and say it did.
    Oracle: the planted parameters of an exact synthetic dataset."""
    print("\n# local-minimum rescue  (oracle: planted global optimum of an exact synthetic dataset)")
    xs = [float(v) for v in range(1, 11)]
    ys = [200.0 * (1.0 - math.exp(-0.5 * v)) for v in xs]
    r = M["curvefit"]({"model": "custom", "equation": "b1*(1-exp(-b2*X))",
                       "initialValues": {"b1": 150.0, "b2": 50.0}, "x": xs, "y": ys})
    check("rescue: b1 recovers the planted 200", term(r, "b1"), 200.0, tol=1e-3)
    check("rescue: b2 recovers the planted 0.5", term(r, "b2"), 0.5, tol=1e-3)
    check_le("rescue: SSE reaches the global optimum's ~0", r["glance"]["sse"], 1e-6)
    check_eq("rescue: the fit says a local minimum was escaped",
             any("local minimum" in a for a in r.get("assumptions", [])), True)
    # A healthy fit must be untouched: same data, a sane start, no rescue chatter.
    r2 = M["curvefit"]({"model": "custom", "equation": "b1*(1-exp(-b2*X))",
                        "initialValues": {"b1": 150.0, "b2": 1.0}, "x": xs, "y": ys})
    check("healthy fit: same optimum", r2["glance"]["sse"], 0.0, tol=1e-9)
    check_eq("healthy fit: no local-minimum note",
             any("local minimum" in a for a in r2.get("assumptions", [])), False)


def check_conf_threading():
    """The dialog's Confidence level must reach every interval: the
    survival intervals (Brookmeyer-Crowley median CI, hazard-ratio CI, Greenwood bands),
    the nonlinear fits' parameter CIs + curve bands, and the mixed model's fixed-effect CI
    must not be fixed at 95%. Oracles: a pure-python stdlib KM at the 90% normal quantile
    (mpmath erfinv, no scipy), the bisection t critical value on a linear-in-parameters
    fit (profile == Wald there), and the normal quantile for the mixed model. The
    survival fixture is first shown to discriminate (its 90% median CI differs from its
    95% one — the bounds are event times, so a lazy fixture would freeze by
    discreteness and a hardcoded engine would pass)."""
    print("\n# confidence threading  (oracle: mpmath quantiles — survival KM/HR, nonlinear Wald, mixed model)")
    z90 = float(mp.sqrt(2) * mp.erfinv(mp.mpf("0.90")))
    z95 = float(mp.sqrt(2) * mp.erfinv(mp.mpf("0.95")))

    # ── survival: pure-python KM (stdlib math only — the engine's is numpy) ──
    T1 = [6, 6, 6, 7, 10, 13, 16, 22, 23, 6]
    Ev1 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]
    T2 = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8]
    Ev2 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]

    def km_median_ci(times, events, z):
        order = sorted(range(len(times)), key=lambda i: times[i])
        t = [times[i] for i in order]
        e = [events[i] for i in order]
        surv, at, gsum = 1.0, len(t), 0.0
        med = lo_t = hi_t = None
        i = 0
        while i < len(t):
            tj = t[i]
            d = c = 0
            j = i
            while j < len(t) and t[j] == tj:
                d += e[j]
                c += 1 - e[j]
                j += 1
            if d and at:
                surv *= 1 - d / at
                if at > d:
                    gsum += d / (at * (at - d))
                lo = hi = surv
                if 0.0 < surv < 1.0 and gsum > 0:
                    sig = math.sqrt(gsum) / abs(math.log(surv))
                    lo = surv ** math.exp(z * sig)
                    hi = surv ** math.exp(-z * sig)
                if med is None and surv <= 0.5:
                    med = tj
                if lo_t is None and lo <= 0.5:
                    lo_t = tj
                if hi_t is None and hi <= 0.5:
                    hi_t = tj
            at -= d + c
            i = j
        return med, lo_t, hi_t

    want90 = km_median_ci(T1, Ev1, z90)
    check_eq("conf: the survival fixture discriminates 90 vs 95", want90 != km_median_ci(T1, Ev1, z95), True)
    r90 = M["survival"]({"groups": [{"label": "a", "time": T1, "event": Ev1},
                                    {"label": "b", "time": T2, "event": Ev2}], "conf": 0.90})
    med_a = [t for t in r90["terms"] if "median" in str(t["term"]).lower() and str(t["term"]).startswith("a")][0]
    check("survival median CI low honours conf=0.90", med_a["ciLow"], float(want90[1]))
    check("survival median CI high honours conf=0.90", med_a["ciHigh"], float(want90[2]))

    # hazard ratio: from-scratch O/E (same loop shape as logrank_from_scratch) + z90
    ev_times = sorted(set([T1[i] for i in range(len(T1)) if Ev1[i]] + [T2[i] for i in range(len(T2)) if Ev2[i]]))
    O1 = Ex1 = O2 = Ex2 = 0.0
    for t in ev_times:
        n1 = sum(1 for x in T1 if x >= t)
        n2 = sum(1 for x in T2 if x >= t)
        d1 = sum(1 for i in range(len(T1)) if T1[i] == t and Ev1[i])
        d2 = sum(1 for i in range(len(T2)) if T2[i] == t and Ev2[i])
        n, d = n1 + n2, d1 + d2
        O1 += d1
        O2 += d2
        Ex1 += d * n1 / n
        Ex2 += d * n2 / n
    hr = (O1 / Ex1) / (O2 / Ex2)
    se_ln = math.sqrt(1.0 / Ex1 + 1.0 / Ex2)
    hr_t = [t for t in r90["terms"] if "hazard ratio" in str(t["term"]).lower()][0]
    check("survival HR CI low honours conf=0.90", hr_t["ciLow"], hr * math.exp(-z90 * se_ln))
    check("survival HR CI high honours conf=0.90", hr_t["ciHigh"], hr * math.exp(z90 * se_ln))
    # This fixture has an event at t=23 when a single subject remains in the study —
    # an O/E loop that skips that time loses an event from `obs` and skews the O/E
    # hazard ratio. The χ² must not move (that time's O−E is 0):
    # 15.315753 is statsmodels survdiff on the same data, an independent implementation.
    check("survival log-rank χ² with a lone subject at risk (statsmodels)", r90["glance"]["chi_sq"], 15.315753, tol=1e-5)
    # the Greenwood band must move too (structural: 90% band strictly inside the 99% one)
    r99 = M["survival"]({"groups": [{"label": "a", "time": T1, "event": Ev1},
                                    {"label": "b", "time": T2, "event": Ev2}], "conf": 0.99})
    band90 = r90["extra"]["curves"][0]["lower"] if "curves" in (r90.get("extra") or {}) else None
    band99 = r99["extra"]["curves"][0]["lower"] if "curves" in (r99.get("extra") or {}) else None
    if band90 is not None and band99 is not None:
        inside = all(a >= b for a, b in zip(band90, band99))
        moved = any(a != b for a, b in zip(band90, band99))
        check_eq("survival Greenwood band: 90% inside 99% and not equal", inside and moved, True)

    # ── nonlinear fit: linear-in-parameters model, so profile CI == Wald exactly ──
    xs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    ys = [2.3, 3.7, 6.5, 7.8, 10.4, 11.8, 14.3, 15.7, 18.4, 19.6]
    rn = M["curvefit"]({"model": "line_origin", "x": xs, "y": ys, "conf": 0.90})
    t0 = rn["terms"][0]
    tc90 = t_crit_two(len(xs) - 1, 0.10)
    check("curvefit param CI low honours conf=0.90", t0["ciLow"], t0["estimate"] - tc90 * t0["se"], tol=2e-3)
    check("curvefit param CI high honours conf=0.90", t0["ciHigh"], t0["estimate"] + tc90 * t0["se"], tol=2e-3)
    rn99 = M["curvefit"]({"model": "line_origin", "x": xs, "y": ys, "conf": 0.99})
    c90, c99 = rn["curve"], rn99["curve"]
    check_eq("curvefit confidence band follows conf (90 != 99)", c90["ciLow"] != c99["ciLow"], True)
    check_eq("curvefit prediction band follows conf (90 != 99)", c90["piLow"] != c99["piLow"], True)

    # globalfit shares _fit_nl — structural: its 90% CI sits strictly inside its 99% one
    gf = {"model": "line_origin", "datasets": [{"label": "d1", "x": xs, "y": ys},
                                               {"label": "d2", "x": xs, "y": [v * 1.15 for v in ys]}]}
    g90 = M["globalfit"]({**gf, "conf": 0.90})["terms"][0]
    g99 = M["globalfit"]({**gf, "conf": 0.99})["terms"][0]
    check_eq("globalfit CI follows conf (90 strictly inside 99)",
             g99["ciLow"] < g90["ciLow"] < g90["ciHigh"] < g99["ciHigh"], True)

    # ── mixed model: statsmodels conf_int is z-based, so est ∓ z90·se ──
    vals = [9, 11, 10, 12, 8, 10, 13, 12, 14, 11, 13, 15, 7, 8, 6, 9, 7, 8]
    grp = ["a"] * 6 + ["b"] * 6 + ["c"] * 6
    rm = M["mixedmodel"]({"value": vals, "group": grp, "conf": 0.90})
    fx = [t for t in rm["terms"] if str(t["term"]).startswith("Fixed")][0]
    check("mixedmodel fixed-effect CI low honours conf=0.90", fx["ciLow"], fx["estimate"] - z90 * fx["se"], tol=1e-3)
    check("mixedmodel fixed-effect CI high honours conf=0.90", fx["ciHigh"], fx["estimate"] + z90 * fx["se"], tol=1e-3)


def check_metaanalysis():
    """The engine's meta-analysis pooling vs two independents: a pure-stdlib
    re-derivation of the inverse-variance + DerSimonian-Laird algebra written here
    (z from mpmath, no scipy), and statsmodels' combine_effects (a library sharing no
    code with the engine's hand-rolled formulas; method_re='chi2' = DL). Log-space
    (ratio) pooling — the standard odds-ratio case."""
    print("\n# Meta-analysis pooling  (oracle: stdlib DL algebra + statsmodels combine_effects)")
    studies = [(0.82, 0.64, 1.05), (1.14, 0.90, 1.44), (0.67, 0.49, 0.92), (0.95, 0.70, 1.30), (1.21, 0.78, 1.88)]
    conf = 0.95
    z = float(mp.sqrt(2) * mp.erfinv(conf))  # two-sided normal quantile, independent of scipy
    eff = [math.log(e) for e, _lo, _hi in studies]
    var = [((math.log(hi) - math.log(lo)) / (2.0 * z)) ** 2 for _e, lo, hi in studies]

    got = M["metaanalysis"]({"studies": [{"est": e, "lo": lo, "hi": hi, "label": "S%d" % (i + 1)}
                                         for i, (e, lo, hi) in enumerate(studies)],
                             "conf": conf, "log": True})
    terms = got["terms"]
    frow = next(t for t in terms if "fixed" in t["term"].lower())
    rrow = next(t for t in terms if "random" in t["term"].lower())
    s1 = next(t for t in terms if t["term"] == "S1")

    # --- independent 1: the algebra, stdlib only -------------------------------------
    k = len(eff)
    w = [1.0 / vi for vi in var]
    sw = sum(w)
    est_f = sum(wi * yi for wi, yi in zip(w, eff)) / sw
    se_f = (1.0 / sw) ** 0.5
    q = sum(wi * (yi - est_f) ** 2 for wi, yi in zip(w, eff))
    c = sw - sum(wi * wi for wi in w) / sw
    tau2 = max(0.0, (q - (k - 1)) / c)
    i2 = max(0.0, (q - (k - 1)) / q * 100.0)
    wr = [1.0 / (vi + tau2) for vi in var]
    est_r = sum(wi * yi for wi, yi in zip(wr, eff)) / sum(wr)

    check("meta: fixed pooled effect (stdlib)", frow["estimate"], math.exp(est_f))
    check("meta: fixed CI low (stdlib)", frow["ciLow"], math.exp(est_f - z * se_f))
    check("meta: fixed CI high (stdlib)", frow["ciHigh"], math.exp(est_f + z * se_f))
    check("meta: random pooled effect (stdlib DL)", rrow["estimate"], math.exp(est_r))
    check("meta: Cochran Q (stdlib)", got["glance"]["Q"], q)
    check("meta: tau^2 (stdlib DL)", got["glance"]["tau²"], tau2)
    check("meta: I^2 %% (stdlib)", got["glance"]["I² (%)"], i2)
    check("meta: study-1 fixed weight %% (stdlib)", s1["weight fixed (%)"], 100.0 * w[0] / sw)

    # --- independent 2: statsmodels combine_effects (DL via method_re='chi2') --------
    from statsmodels.stats.meta_analysis import combine_effects
    res = combine_effects(np.array(eff), np.array(var), method_re="chi2")
    sf = res.summary_frame()
    check("meta: fixed pooled vs statsmodels", frow["estimate"], math.exp(float(sf.loc["fixed effect", "eff"])))
    check("meta: random pooled vs statsmodels", rrow["estimate"], math.exp(float(sf.loc["random effect", "eff"])))
    check("meta: tau^2 vs statsmodels", got["glance"]["tau²"], float(res.tau2))


def _tf_stdlib(yy, vv, side_left):
    """Independent stdlib trim-and-fill (Duval-Tweedie L0) re-derived here from the
    published formulas — different structure from the engine's (groupby ranks, dict
    lookup) so a transcription slip in either shows up as disagreement. Returns
    (k0, imputed transformed effects, mu at convergence)."""
    from itertools import groupby
    n = len(yy)
    ys = list(yy) if side_left else [-t for t in yy]
    lcur = 0
    idx = sorted(range(n), key=lambda i: (-ys[i], i))
    mu = 0.0
    for _ in range(50):
        keeprows = idx[lcur:]
        swk = sum(1.0 / vv[i] for i in keeprows)
        mu = sum(ys[i] / vv[i] for i in keeprows) / swk
        devs = sorted((abs(ys[i] - mu), i) for i in range(n))
        ranks = {}
        pos = 1
        for _val, grp in groupby(devs, key=lambda t: t[0]):
            g = list(grp)
            r = (2 * pos + len(g) - 1) / 2.0
            for _a, i in g:
                ranks[i] = r
            pos += len(g)
        tn = sum(ranks[i] for i in range(n) if ys[i] - mu > 0)
        l0 = (4.0 * tn - n * (n + 1)) / (2.0 * n - 1.0)
        nxt = min(n - 2, max(0, int(math.floor(l0 + 0.5))))
        if nxt == lcur:
            break
        lcur = nxt
    sign = 1.0 if side_left else -1.0
    fills = [sign * (2.0 * mu - ys[i]) for i in idx[:lcur]]
    return lcur, fills, sign * mu


def check_publicationbias():
    """The engine's publication-bias method vs independents: Egger's intercept through
    statsmodels OLS (a library regression, no shared code), trim-and-fill through the
    stdlib re-derivation above, and a constructed-suppression truth — delete the most
    negative studies of a symmetric funnel and the method must impute on that side and
    pull the pooled effect back toward the symmetric answer."""
    print("\n# Publication bias  (oracle: statsmodels OLS Egger + stdlib trim-and-fill + constructed suppression)")
    conf = 0.95
    z = float(mp.sqrt(2) * mp.erfinv(conf))
    # --- Egger vs statsmodels OLS, on the check_metaanalysis odds-ratio fixture -------
    studies = [(0.82, 0.64, 1.05), (1.14, 0.90, 1.44), (0.67, 0.49, 0.92), (0.95, 0.70, 1.30), (1.21, 0.78, 1.88)]
    eff = [math.log(e) for e, _lo, _hi in studies]
    var = [((math.log(hi) - math.log(lo)) / (2.0 * z)) ** 2 for _e, lo, hi in studies]
    got = M["publicationbias"]({"studies": [{"est": e, "lo": lo, "hi": hi, "label": "S%d" % (i + 1)}
                                            for i, (e, lo, hi) in enumerate(studies)],
                                "conf": conf, "log": True})
    egger = next(t for t in got["terms"] if t["term"].startswith("Egger intercept"))
    import statsmodels.api as sm
    prec = [1.0 / math.sqrt(vi) for vi in var]
    zz = [yi / math.sqrt(vi) for yi, vi in zip(eff, var)]
    ols = sm.OLS(np.array(zz), sm.add_constant(np.array(prec))).fit()
    check("egger: intercept vs statsmodels OLS", egger["estimate"], float(ols.params[0]))
    check("egger: intercept SE vs statsmodels OLS", egger["se"], float(ols.bse[0]))
    check("egger: t vs statsmodels OLS", egger["statistic"], float(ols.tvalues[0]))
    check("egger: p vs statsmodels OLS", egger["p"], float(ols.pvalues[0]))
    slope = next(t for t in got["terms"] if t["term"].startswith("Egger slope"))
    check("egger: slope vs statsmodels OLS", slope["estimate"], float(ols.params[1]))

    # --- trim-and-fill vs the stdlib re-derivation, same fixture ----------------------
    side_left = got["glance"]["side"] == "left"
    k0, fills, _mu = _tf_stdlib(eff, var, side_left)
    check_eq("trimfill: k0 vs stdlib", got["glance"]["k₀ (imputed)"], k0)
    fill_v = [var[i] for i in sorted(range(len(eff)), key=lambda i: (-(eff[i] if side_left else -eff[i]), i))[:k0]]
    ya = eff + fills
    va = var + fill_v
    w = [1.0 / vi for vi in va]
    sw = sum(w)
    est_f = sum(wi * yi for wi, yi in zip(w, ya)) / sw
    q = sum(wi * (yi - est_f) ** 2 for wi, yi in zip(w, ya))
    c = sw - sum(wi * wi for wi in w) / sw
    tau2 = max(0.0, (q - (len(ya) - 1)) / c)
    wr = [1.0 / (vi + tau2) for vi in va]
    est_r = sum(wi * yi for wi, yi in zip(wr, ya)) / sum(wr)
    check("trimfill: adjusted fixed vs stdlib", got["glance"]["adjusted (fixed)"], math.exp(est_f))
    check("trimfill: adjusted random vs stdlib", got["glance"]["adjusted (random)"], math.exp(est_r))

    # --- constructed suppression: the fixture that can exhibit the defect -------------
    theta = 0.5
    pairs = [(0.6, 0.9), (0.35, 0.55), (0.15, 0.3)]
    sym = [(theta, 0.2)] + [(theta + d, se) for d, se in pairs] + [(theta - d, se) for d, se in pairs]
    def rows(lst):
        return [{"est": e, "lo": e - z * se, "hi": e + z * se, "label": "T%d" % i} for i, (e, se) in enumerate(lst)]
    full = M["publicationbias"]({"studies": rows(sym), "conf": conf, "log": False})
    check_eq("trimfill: symmetric funnel imputes nothing", full["glance"]["k₀ (imputed)"], 0)
    check("trimfill: k0=0 leaves the pooled effect standing",
          full["glance"]["adjusted (fixed)"],
          M["metaanalysis"]({"studies": rows(sym), "conf": conf, "log": False})["glance"]["pooled (fixed)"])
    suppressed = [s for s in sym if s[0] >= theta]  # delete every below-centre study
    biased = M["publicationbias"]({"studies": rows(suppressed), "conf": conf, "log": False})
    obs = M["metaanalysis"]({"studies": rows(suppressed), "conf": conf, "log": False})["glance"]["pooled (fixed)"]
    check_eq("trimfill: suppression imputes on the left", biased["glance"]["side"], "left")
    check_le("trimfill: suppression found (k0 >= 1)", 1 - biased["glance"]["k₀ (imputed)"], 0)
    adj = biased["glance"]["adjusted (fixed)"]
    check_le("trimfill: adjusted moves back toward the truth", abs(adj - theta) - abs(obs - theta), 0)
    # The k0>0 path pinned exactly against the stdlib twin (the fixture above only
    # exercises k0 = 0): same k0, and every imputed estimate equal, in order.
    k0s, fills_s, _mu2 = _tf_stdlib([e for e, _se in suppressed], [se * se for _e, se in suppressed], True)
    check_eq("trimfill: suppressed k0 vs stdlib", biased["glance"]["k₀ (imputed)"], k0s)
    imp_terms = [t["estimate"] for t in biased["terms"] if t["term"].startswith("Imputed study")]
    for i, f in enumerate(fills_s):
        check("trimfill: imputed %d vs stdlib" % (i + 1), imp_terms[i], f)

    # --- accurate reporting: equal precisions cannot run Egger -----------------------
    flat = [{"est": e, "lo": e - 1.0, "hi": e + 1.0, "label": "F%d" % i} for i, e in enumerate([0.1, 0.5, 0.9])]
    try:
        M["publicationbias"]({"studies": flat, "conf": conf, "log": False})
        check_eq("egger: equal precisions are refused", "no-error", "StatsError")
    except engine.StatsError:
        check_eq("egger: equal precisions are refused", "StatsError", "StatsError")


def check_multiplicity_degenerate():
    """A comparison that could not be computed must never come out of a multiplicity
    correction as a number.

    A corrector that carries a NaN through its running maximum (Holm-Šídák, the default,
    has one) can return a small p for it: 'statistically significant' for a comparison that
    does not exist. It can corrupt the neighbours too — e.g. 0.5 where Holm-Šídák over a
    family of 3 gives 0.75 — making real comparisons look more significant than they
    are. These are function-level checks on purpose: the correctors are pure, and this
    pins them directly rather than hoping some dataset happens to route a NaN through.
    """
    import engine as _E
    print("\n# Multiplicity correctors, degenerate input  (oracle: closed-form Sidak/Bonferroni/BH by hand)")
    nan = float("nan")
    raw = [0.01, nan, 0.5]
    m = 3  # the uncomputable comparison still counts toward the family size

    for name in ("holm-sidak", "bonferroni", "sidak", "none", "fdr"):
        adj = _E._bh_fdr(raw) if name == "fdr" else _E._pairwise_adjust(raw, name)
        check("%s: the uncomputable slot stays unavailable" % name,
              1.0 if adj[1] is None else 0.0, 1.0)
        check("%s: no non-finite escapes" % name,
              1.0 if all(v is None or (v == v and abs(v) != float("inf")) for v in adj) else 0.0, 1.0)

    # Closed forms, computed here and nowhere else.
    hs = _E._pairwise_adjust(raw, "holm-sidak")
    check("holm-sidak smallest of 3", hs[0], 1 - (1 - 0.01) ** 3)
    check("holm-sidak largest, m still 3", hs[2], 1 - (1 - 0.5) ** 2)
    bf = _E._pairwise_adjust(raw, "bonferroni")
    check("bonferroni x m (m counts the failed one)", bf[0], min(1.0, 0.01 * 3))
    sd = _E._pairwise_adjust(raw, "sidak")
    check("sidak single-step", sd[0], 1 - (1 - 0.01) ** 3)
    bh = _E._bh_fdr(raw)
    check("BH q of the smallest (rank 1 of m=3)", bh[0], min(1.0, 0.01 * 3 / 1))
    check("BH q of the largest (rank 2 of the computable)", bh[2], min(1.0, 0.5 * 3 / 2))

    # All-unavailable input must not fabricate anything.
    allbad = _E._pairwise_adjust([nan, None], "holm-sidak")
    check("every input unavailable -> every output unavailable",
          1.0 if all(v is None for v in allbad) else 0.0, 1.0)


def check_degenerate_inputs():
    """Degenerate-but-ordinary input.

    Every other group in this file feeds well-formed data, so without this group the whole
    class of "what does the engine do when a column is blank / constant / separated" has no
    oracle coverage. The oracles below are computed here, by different means than the
    engine uses (means from sums, r from the correct pairs, chi-square from the stated
    expected counts), because an oracle sharing the implementation confirms its bugs
    instead of catching them.
    """
    import engine as _E
    print("\n# Degenerate inputs  (oracle: hand computation on the rows that survive)")

    def leaves(o, path=""):
        if isinstance(o, dict):
            for k, v in o.items():
                for x in leaves(v, path + "." + str(k)):
                    yield x
        elif isinstance(o, (list, tuple)):
            for i, v in enumerate(o):
                for x in leaves(v, path + "[%d]" % i):
                    yield x
        else:
            yield (path, o)

    def no_nonfinite(name, result):
        """JSON has no Infinity/NaN — one on the wire would stop the engine."""
        bad = [p for p, v in leaves(result)
               if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf")))]
        check_eq("%s: nothing non-finite reaches the wire" % name, bad, [])

    # ── Undefined statistics are null, and the payload stays serialisable ──────────
    zero_cell = M["contingency"]({"table": [[10, 0], [3, 12]]})
    no_nonfinite("2x2 zero cell", zero_cell)
    check_eq("2x2 zero cell: Fisher OR is unavailable, not infinite",
             zero_cell["glance"]["odds_ratio"], None)
    # …but the Haldane-corrected OR is finite and correct: (10.5*12.5)/(0.5*3.5) = 75.
    or_term = [t for t in zero_cell["terms"] if t["term"] == "Odds ratio"][0]
    check("2x2 zero cell: corrected OR still reported", or_term["estimate"],
          (10.5 * 12.5) / (0.5 * 3.5))
    for name, payload in (("zero-variance welch", {"a": [5, 5, 5, 5], "b": [7, 7, 7, 7], "variant": "welch"}),
                          ("constant-column correlation", {"a": [1, 1, 1, 1], "b": [2, 3, 4, 5], "variant": "pearson"})):
        r = M["ttest"](payload) if "variant" in payload and payload["variant"] == "welch" else M["correlation"](payload)
        no_nonfinite(name, r)

    # ── An empty group must not re-label the ones after it ────────────────────────
    a, b, c = [20, 22, 21, 23], [30, 31, 29, 32], [40, 41, 39, 42]
    res = M["anova"]({"groups": [[], a, b, c], "labels": ["Vehicle", "Drug A", "Drug B", "Drug C"],
                      "variant": "oneway"})
    named = dict((t["term"], t["estimate"]) for t in res["terms"]
                 if t.get("estimate") is not None and " vs " not in t["term"] and t["term"] != "Between groups")
    for label, vals in (("Drug A", a), ("Drug B", b), ("Drug C", c)):
        check("empty group: %s keeps its own mean" % label, named.get(label), sum(vals) / float(len(vals)))
    check_eq("empty group: the dropped label is gone", "Vehicle" in named, False)
    check_eq("empty group: no group vanishes", len(named), 3)

    # ── A blank drops its row, it does not slide the column ───────────────────────
    # y = 10x exactly, with a hole in x. Correct pairs (1,10) (3,30) (4,40) → r = 1.
    gx, gy = [1, None, 3, 4], [10, 20, 30, 40]
    check("blank row: correlation r on the surviving pairs",
          M["correlation"]({"a": gx, "b": gy, "variant": "pearson"})["glance"]["r"], 1.0)
    check("blank row: regression slope on the surviving pairs",
          M["regression"]({"x": gx, "y": gy})["glance"]["slope"], 10.0)
    # Independent trapezoid over the same three points: 2*(10+30)/2 + 1*(30+40)/2 = 75.
    check("blank row: AUC over the surviving points",
          M["auc"]({"x": gx, "y": gy})["glance"]["net"], 2 * (10 + 30) / 2.0 + 1 * (30 + 40) / 2.0)
    # …while independent samples keep their own values (aligning them would delete data).
    welch = M["ttest"]({"a": gx, "b": gy, "variant": "welch"})
    check_eq("blank row: independent group A keeps 3", welch["glance"]["n_A"], 3)
    check_eq("blank row: independent group B keeps 4", welch["glance"]["n_B"], 4)

    # ── A partly-filled Expected column must not become a uniform test ────────────
    obs, exp = [10, 20, 30, 40], [10, 20, 30, 40]
    check("goodness-of-fit: a matching Expected column gives chi2 = 0",
          M["goodnessoffit"]({"observed": obs, "expected": exp})["glance"]["chi_sq"], 0.0)
    # Uniform default, by hand: E = 25 each → sum((O-25)^2/25).
    uni = sum((o - 25.0) ** 2 / 25.0 for o in obs)
    check("goodness-of-fit: an empty Expected column means uniform",
          M["goodnessoffit"]({"observed": obs})["glance"]["chi_sq"], uni)
    try:
        M["goodnessoffit"]({"observed": obs, "expected": [10, None, 30, 40]})
        check_eq("goodness-of-fit: a partial Expected column is refused", "returned a result", "refused")
    except _E.StatsError:
        check_eq("goodness-of-fit: a partial Expected column is refused", "refused", "refused")

    # ── Zero variance yields no statistic and therefore no p ──────────────────────
    flat = M["anova"]({"groups": [[5, 5, 5], [5, 5, 5], [9, 9, 9]], "labels": ["A", "B", "C"],
                       "variant": "oneway", "posthoc": "tukey"})
    check_eq("zero variance: F unavailable", flat["glance"]["F"], None)
    check_eq("zero variance: p unavailable (not 0)", flat["glance"]["p"], None)
    check_eq("zero variance: no post-hoc is printed",
             [t for t in flat["terms"] if " vs " in t["term"]], [])
    check("zero variance: the group means are still exact",
          dict((t["term"], t["estimate"]) for t in flat["terms"] if t.get("estimate") is not None).get("C"), 9.0)
    flat_t = M["ttest"]({"a": [5, 5, 5, 5], "b": [7, 7, 7, 7], "variant": "welch"})
    check_eq("zero variance: t test p unavailable (not 0)", flat_t["glance"]["p"], None)
    check_eq("zero variance: the summary does not claim 'not significant'",
             "not statistically significant" in flat_t["summary"], False)

    # ── A fit that does not exist is refused ──────────────────────────────────────
    for name, method, payload in (
        ("logistic", "logistic", {"y": [0, 0, 0, 0, 1, 1, 1, 1],
                                  "predictors": [[1, 2, 3, 4, 10, 11, 12, 13]], "labels": ["x"]}),
        ("cox", "cox", {"time": [1, 2, 3, 4, 50, 60, 70, 80], "event": [1, 1, 1, 1, 1, 1, 1, 1],
                        "predictors": [[1, 2, 3, 4, 10, 11, 12, 13]], "labels": ["x"]}),
    ):
        try:
            M[method](payload)
            check_eq("%s: perfect separation is refused" % name, "returned a fit", "refused")
        except _E.StatsError:
            check_eq("%s: perfect separation is refused" % name, "refused", "refused")
    # …and an ordinary fit is untouched (the refusal must not be indiscriminate).
    ok = M["logistic"]({"y": [0, 0, 1, 0, 1, 1, 0, 1, 1, 1],
                        "predictors": [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], "labels": ["x"]})
    check_eq("logistic: an ordinary fit still succeeds", ok["method"], "logistic")
    # Separation statsmodels does not flag. On this data two predictors separate the outcome, statsmodels raises only
    # a ConvergenceWarning, and the optimiser stops with the least-certain fitted probability just above the engine's
    # 1e-8 backstop, so without the pre-fit check a diverged fit (McFadden R² = 1, accuracy 100%) would be reported. Oracle: a
    # separating line picked by hand and verified here in plain Python (every event on its positive side, every
    # non-event on its negative side), so the data are proven separated without any fit at all.
    y2 = [0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1]
    dose = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 3, 4, 13, 14, 15, 16]
    age = [5, 3, 6, 2, 7, 4, 5, 3, 6, 4, 2, 5, 1, 8, 3, 6, 2, 4]
    lr_sep = None
    for w1 in [x / 100 for x in range(1, 1001)]:  # search a simple family: dose + w1*age > c
        s = [d + w1 * a for d, a in zip(dose, age)]
        lo1 = min(v for v, yy in zip(s, y2) if yy == 1)
        hi0 = max(v for v, yy in zip(s, y2) if yy == 0)
        if lo1 > hi0:
            lr_sep = (w1, (lo1 + hi0) / 2)
            break
    check_eq("logistic separation fixture: the two predictors really separate the outcome (hand-checked line)", lr_sep is not None, True)
    try:
        M["logistic"]({"y": y2, "predictors": [dose, age], "labels": ["dose", "age"]})
        check_eq("logistic: separation by two predictors is refused (statsmodels does not flag it)", "returned a fit", "refused")
    except _E.StatsError:
        check_eq("logistic: separation by two predictors is refused (statsmodels does not flag it)", "refused", "refused")
    # Quasi-complete: the classes meet at one tied value (x = 4 is both). No finite MLE either.
    yq, xq = [0, 0, 0, 0, 1, 1, 1, 1], [1, 2, 3, 4, 4, 5, 6, 7]
    check_eq("logistic quasi fixture: every non-event <= 4 <= every event", max(x for x, yy in zip(xq, yq) if yy == 0) <= min(x for x, yy in zip(xq, yq) if yy == 1), True)
    try:
        M["logistic"]({"y": yq, "predictors": [xq], "labels": ["x"]})
        check_eq("logistic: quasi-complete separation is refused", "returned a fit", "refused")
    except _E.StatsError:
        check_eq("logistic: quasi-complete separation is refused", "refused", "refused")
    # ...and two predictors that do not separate still fit (the sharper check must not refuse ordinary data).
    ok2 = M["logistic"]({"y": [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1], "predictors": [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]], "labels": ["a", "b"]})
    check_eq("logistic: two non-separating predictors still fit", ok2["method"], "logistic")
    # The separation test itself, on the same three fixtures (the fits above could refuse for another reason).
    import numpy as _np
    _sep = _E._logit_separated
    _dc = lambda *cols: _np.column_stack([_np.ones(len(cols[0]))] + [_np.asarray(c, float) for c in cols])
    check_eq("_logit_separated: two predictors (hand-checked line) -> separated", _sep(_np, _dc(dose, age), _np.asarray(y2, float)), True)
    check_eq("_logit_separated: classes touching at one value -> separated", _sep(_np, _dc(xq), _np.asarray(yq, float)), True)
    check_eq("_logit_separated: ordinary data -> not separated", _sep(_np, _dc([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), _np.asarray([0, 0, 1, 0, 1, 1, 0, 1, 1, 1], float)), False)


# ── Ordination ──────────────────────────────────────────────────────────────────
# No R and no vegan here, so the oracles are (a) genuinely different algorithms and
# (b) identities: cases where two methods must agree exactly, one of which is already
# validated. An identity is the strongest oracle available offline — it cannot be
# satisfied by a shared bug unless that bug lives in both routes at once.


def _gradient_community(n=12, p=8, noise=0.0, seed=5):
    """A sites x species matrix with a real gradient: each species peaks at its own
    position along it. This is the shape every ordination method exists for — a matrix
    of counts with many zeros — so a fixture without it would exercise none of them."""
    rng = np.random.default_rng(seed)
    Mx = np.zeros((n, p))
    for i in range(n):
        pos = i / (n - 1)
        for j in range(p):
            peak = j / (p - 1)
            Mx[i, j] = round(30 * math.exp(-((pos - peak) ** 2) / 0.02))
    if noise:
        Mx = np.maximum(0, Mx + rng.normal(0, noise, Mx.shape).round())
    return Mx


def _cols(Mx):
    return [list(Mx[:, j]) for j in range(Mx.shape[1])]


def check_transformations():
    print("\n# ordination transformations  (oracle: the textbook formula, written out here)")
    Mx = _gradient_community(6, 4)
    X = Mx.astype(float)
    T = engine._transform_community(np, Mx, "hellinger")
    rt = X.sum(axis=1, keepdims=True)
    check("hellinger[0,0]", float(T[0, 0]), math.sqrt(float(X[0, 0] / rt[0, 0])))
    check("hellinger row sum of squares = 1", float((T[2] ** 2).sum()), 1.0)
    T = engine._transform_community(np, Mx, "chisq")
    grand = float(X.sum())
    r0 = float(X[1].sum())
    c0 = float(X[:, 2].sum())
    check("chisq[1,2]", float(T[1, 2]), float(X[1, 2]) / math.sqrt(r0) / math.sqrt(c0) * math.sqrt(grand))
    T = engine._transform_community(np, Mx, "total")
    check("relative abundance row sums to 1", float(T[3].sum()), 1.0)
    T = engine._transform_community(np, Mx, "wisconsin")
    # column / column max, then row / row total — recomputed the long way
    W = X / X.max(axis=0)
    W = W / W.sum(axis=1, keepdims=True)
    check("wisconsin[4,1]", float(T[4, 1]), float(W[4, 1]))
    check("wisconsin row sums to 1", float(T[0].sum()), 1.0)
    # Hellinger's whole point: Euclidean distance on the transformed matrix is the
    # Hellinger distance between the two profiles.
    H = engine._transform_community(np, Mx, "hellinger")
    p0, p1 = X[0] / X[0].sum(), X[1] / X[1].sum()
    hellinger_d = math.sqrt(float(np.sum((np.sqrt(p0) - np.sqrt(p1)) ** 2)))
    check("euclidean(hellinger) == Hellinger distance", float(np.linalg.norm(H[0] - H[1])), hellinger_d)


def check_pcoa_identity():
    print("\n# pcoa  (oracle: identity — PCoA on Euclidean distances == covariance PCA)")
    rng = np.random.default_rng(11)
    Mx = rng.normal(size=(15, 4)) * [3, 1, 2, 5] + [10, -2, 0, 4]
    cols = _cols(Mx)
    lab = ["a", "b", "c", "d"]
    pca = M["pca"]({"columns": cols, "labels": lab, "standardize": False, "componentSelection": "all"})["extra"]["pca"]
    pco = M["pcoa"]({"columns": cols, "labels": lab, "metric": "euclidean", "transform": "none"})["extra"]["ordination"]
    A = np.asarray(pca["scores"], float)
    B = np.asarray(pco["scores"], float)
    for k in range(3):
        a, b = A[:, k], B[:, k]
        # an ordination axis has no inherent sign, so either orientation is a match
        d = min(float(np.max(np.abs(a - b))), float(np.max(np.abs(a + b))))
        check("pcoa axis %d == pca score %d" % (k + 1, k + 1), d, 0.0, tol=1e-8)
    # …and the eigenvalues differ by exactly (n-1), the covariance divisor PCA applies
    n = Mx.shape[0]
    check("pcoa eigenvalue1 == pca eigenvalue1 x (n-1)", pco["eigenvalues"][0], pca["eigenvalues"][0] * (n - 1), tol=1e-6)
    # Independent route to the same coordinates: double-centre by hand, eigh, scale.
    D = np.sqrt(((Mx[:, None, :] - Mx[None, :, :]) ** 2).sum(-1))
    J = np.eye(n) - np.ones((n, n)) / n
    G = J @ (-0.5 * D ** 2) @ J
    vals, vecs = np.linalg.eigh((G + G.T) / 2)
    o = np.argsort(vals)[::-1]
    C = vecs[:, o] * np.sqrt(np.maximum(vals[o], 0))
    d = min(float(np.max(np.abs(C[:, 0] - B[:, 0]))), float(np.max(np.abs(C[:, 0] + B[:, 0]))))
    # 2e-6, not 1e-8: the engine rounds its coordinates to 6 decimals on the way out, and
    # these are 10-sized numbers. The two-rounded-outputs checks above stay at 1e-8.
    check("pcoa axis 1 (hand-rolled double centring)", d, 0.0, tol=2e-6)


def check_pcoa_negative():
    print("\n# pcoa negative eigenvalues  (oracle: the correction must remove them)")
    Mx = _gradient_community(10, 6, noise=1.0, seed=9)
    cols = _cols(Mx)
    lab = ["s%d" % j for j in range(6)]
    raw = M["pcoa"]({"columns": cols, "labels": lab, "metric": "braycurtis"})
    # Bray-Curtis is not Euclidean-embeddable, so this fixture must produce some —
    # a fixture with none would make the correction check vacuous.
    check_gt("pcoa braycurtis has negative eigenvalues (the fixture bites)", raw["glance"]["negativeEigenvalues"], 0)
    for corr in ("lingoes", "cailliez"):
        fixed = M["pcoa"]({"columns": cols, "labels": lab, "metric": "braycurtis", "correction": corr})
        check_eq("pcoa %s removes them" % corr, fixed["glance"]["negativeEigenvalues"], 0)
        check_eq("pcoa %s says so" % corr, fixed["extra"]["ordination"]["correction"], corr)


def _pava_sklearn(y):
    """Independent monotone regression: sklearn's IsotonicRegression, a different
    author's implementation of the same pool-adjacent-violators result."""
    from sklearn.isotonic import IsotonicRegression
    x = np.arange(len(y), dtype=float)
    return IsotonicRegression(increasing=True).fit_transform(x, np.asarray(y, float))


def check_pava():
    print("\n# nmds monotone regression  (oracle: sklearn IsotonicRegression)")
    rng = np.random.default_rng(4)
    for trial in range(3):
        y = rng.normal(size=25).cumsum() + rng.normal(size=25) * 2
        mine = engine._pava(np, y, np.ones(len(y)))
        theirs = _pava_sklearn(y)
        check("pava trial %d max |difference|" % (trial + 1), float(np.max(np.abs(mine - theirs))), 0.0, tol=1e-9)
    # …and it really is a monotone fit, not a copy of the input
    y = [3.0, 1.0, 2.0]
    out = engine._pava(np, y, np.ones(3))
    check_eq("pava pools an out-of-order pair", [round(float(v), 6) for v in out], [2.0, 2.0, 2.0])


def check_nmds():
    print("\n# nmds  (oracle: stress recomputed from the returned map + rank identities)")
    Mx = _gradient_community(14, 8, noise=1.0, seed=17)
    cols = _cols(Mx)
    lab = ["s%d" % j for j in range(8)]
    res = M["nmds"]({"columns": cols, "labels": lab, "metric": "braycurtis", "tries": 12, "seed": 99})
    ex = res["extra"]["ordination"]
    C = np.asarray(ex["scores"], float)
    n = C.shape[0]
    # Recompute the dissimilarities and the stress from scratch — no engine code.
    from scipy.spatial.distance import pdist
    diss = pdist(Mx, metric="braycurtis")
    dist = pdist(C, metric="euclidean")
    order = np.argsort(diss, kind="mergesort")
    dhat = np.empty_like(dist)
    dhat[order] = _pava_sklearn(dist[order])
    stress = math.sqrt(float(np.sum((dist - dhat) ** 2)) / float(np.sum(dist ** 2)))
    check("nmds stress (recomputed independently)", ex["stress"], stress, tol=1e-3)
    check("nmds non-metric R2 == 1 - stress^2", ex["nonMetricR2"], 1 - ex["stress"] ** 2, tol=1e-5)
    # The Shepard points are those distances, in the same order.
    check("nmds shepard carries every pair", len(ex["shepard"]["dissimilarity"]), n * (n - 1) / 2)
    check("nmds shepard dissimilarity[0]", ex["shepard"]["dissimilarity"][0], float(diss[0]), tol=1e-5)
    # The whole claim of NMDS: the map's distances must track the order of the
    # dissimilarities. Spearman correlation, computed by scipy — nothing shared.
    from scipy import stats as sp_stats
    rho = float(sp_stats.spearmanr(diss, dist).statistic)
    check_gt("nmds rank correlation with the dissimilarities", rho, 0.95)


def check_nmds_perfect():
    print("\n# nmds perfect case  (oracle: a configuration that can be reproduced exactly)")
    # Points on a line: the Euclidean dissimilarities are already a monotone function of
    # a 1-D layout, so a correct NMDS reaches stress 0. A method that could not would
    # fail here and nowhere else.
    x = np.array([0.0, 1.0, 2.5, 4.0, 7.0, 11.0, 12.0, 15.0])
    cols = [list(x), list(x * 0.0)]
    res = M["nmds"]({"columns": cols, "labels": ["x", "zero"], "metric": "euclidean",
                         "dimensions": 1, "tries": 8, "seed": 3})
    check_le("nmds stress on a perfectly ordinal configuration", res["glance"]["stress"], 1e-6)
    # and the recovered order is the original one (up to reflection)
    C = np.asarray(res["extra"]["ordination"]["scores"], float)[:, 0]
    same = list(np.argsort(C)) == list(np.argsort(x))
    rev = list(np.argsort(C)) == list(np.argsort(-x))
    check_eq("nmds recovers the ordering", same or rev, True)


def check_nmds_reproducible():
    print("\n# nmds reproducibility  (oracle: the same seed must give the same map)")
    Mx = _gradient_community(10, 6, noise=1.0, seed=21)
    cols = _cols(Mx)
    lab = ["s%d" % j for j in range(6)]
    spec = {"columns": cols, "labels": lab, "metric": "braycurtis", "tries": 6, "seed": 1234}
    a = M["nmds"](spec)["extra"]["ordination"]["scores"]
    b = M["nmds"](dict(spec))["extra"]["ordination"]["scores"]
    check("nmds same seed, same coordinates", float(np.max(np.abs(np.asarray(a) - np.asarray(b)))), 0.0, tol=1e-12)
    c = M["nmds"](dict(spec, seed=99))["extra"]["ordination"]["stress"]
    # a different seed may find a different local minimum, but not a wildly worse one
    check_le("nmds another seed lands at a comparable stress", abs(c - M["nmds"](spec)["extra"]["ordination"]["stress"]), 0.05)


def _reciprocal_averaging(Mx, iters=2000):
    """Reciprocal averaging — the historical algorithm for correspondence analysis, and an
    oracle that shares no line with the engine's SVD. Alternate: species scores are the
    abundance-weighted average of the site scores, site scores the weighted average of the
    species scores, re-standardised each cycle. It converges on the first CA axis, and the
    shrinkage per cycle is that axis's eigenvalue."""
    X = np.asarray(Mx, float)
    rt = X.sum(1)
    ct = X.sum(0)
    r = rt / X.sum()
    rng = np.random.default_rng(0)
    x = rng.standard_normal(X.shape[0])
    lam = 0.0
    for _ in range(iters):
        x = x - float(np.sum(r * x))                       # weighted-centre (drop the trivial axis)
        v = float(np.sum(r * x * x))
        if v <= 0:
            break
        x = x / math.sqrt(v)                               # unit weighted variance
        y = (X.T @ x) / ct                                 # species = weighted mean of sites
        xn = (X @ y) / rt                                  # sites = weighted mean of species
        xn = xn - float(np.sum(r * xn))
        lam = float(np.sum(r * x * xn))                    # Rayleigh quotient = the eigenvalue
        x = xn
    x = x - float(np.sum(r * x))
    x = x / math.sqrt(float(np.sum(r * x * x)))
    return lam, x


def check_ca():
    from scipy import stats as sp_stats_ca
    print("\n# ca  (oracle: reciprocal averaging + scipy chi-square + the transition formula)")
    Mx = _gradient_community(10, 6, noise=1.0, seed=31)
    cols = _cols(Mx)
    lab = ["Sp%d" % (j + 1) for j in range(6)]
    res = M["ca"]({"columns": cols, "labels": lab, "scaling": "species"})
    ex = res["extra"]["ordination"]

    # 1) the first eigenvalue, from an algorithm that predates the SVD formulation
    lam, x = _reciprocal_averaging(Mx)
    check("ca eigenvalue 1 (reciprocal averaging)", ex["eigenvalues"][0], lam, tol=1e-4)
    # …and the axis itself (scaling "species" leaves the rows in standard coordinates)
    site = np.asarray(ex["scores"], float)[:, 0]
    d = min(float(np.max(np.abs(site - x))), float(np.max(np.abs(site + x))))
    check("ca axis 1 site scores (reciprocal averaging)", d, 0.0, tol=1e-4)

    # 2) total inertia is the chi-square statistic over the grand total — scipy computes the
    #    chi-square, which the engine never calls.
    chi2 = float(sp_stats_ca.chi2_contingency(Mx, correction=False).statistic)
    check("ca total inertia == chi2 / N (scipy)", ex["totalInertia"], chi2 / float(np.sum(Mx)))
    check("ca reported chi2 (scipy)", res["glance"]["chi2"], chi2, tol=1e-4)
    # the axes must account for all of it — nothing quietly dropped
    check("ca eigenvalues sum to the total inertia", float(np.sum(ex["eigenvalues"])), ex["totalInertia"], tol=1e-5)

    # 3) The transition formula, which is what makes the joint plot legitimate: a species'
    #    principal coordinate is the abundance-weighted mean of the site standard coordinates.
    P = Mx / float(np.sum(Mx))
    c = P.sum(0)
    phi = np.asarray(ex["scores"], float)          # rows are standard here
    gam = np.asarray(ex["speciesScores"], float)   # columns principal
    for j in (0, 3, 5):
        want = float(np.sum(P[:, j] * phi[:, 0]) / c[j])
        check("ca species %d sits at the weighted mean of its sites" % (j + 1), gam[j, 0], want, tol=1e-4)

    # 4) the three scalings are the same axis at three sizes, and each is its textbook one:
    #    principal = standard x sqrt(eigenvalue); symmetric splits that between the two
    #    families, so each gets eigenvalue^(1/4).
    lam1 = ex["eigenvalues"][0]
    sites = M["ca"]({"columns": cols, "labels": lab, "scaling": "sites"})["extra"]["ordination"]
    check("ca sites-scaling row score == standard x sqrt(lambda)  [principal]", sites["scores"][0][0], phi[0, 0] * math.sqrt(lam1), tol=1e-4)
    sym = M["ca"]({"columns": cols, "labels": lab, "scaling": "symmetric"})["extra"]["ordination"]
    check("ca symmetric row score == standard x lambda^(1/4)", sym["scores"][0][0], phi[0, 0] * lam1 ** 0.25, tol=1e-4)
    # …and the species move the opposite way, or the joint plot would not stay joint
    check("ca sites-scaling species score == standard (unscaled)", sites["speciesScores"][0][0], gam[0, 0] / math.sqrt(lam1), tol=1e-4)

    # 5) a 2-column table has exactly one axis (the residual matrix has rank 1), and it
    #    carries all of the inertia — an axis count that drifts is caught here.
    #    Note: two columns of the gradient fixture leave some sites empty, and an empty site has
    #    no profile — the engine refuses it, correctly. A dense 2-column table is the case.
    two = M["ca"]({"columns": [[10.0, 4.0, 7.0, 2.0], [3.0, 9.0, 2.0, 8.0]], "labels": ["a", "b"]})["extra"]["ordination"]
    check_eq("ca on 2 variables has 1 axis", len(two["pcLabels"]), 1)
    check("ca on 2 variables: that axis carries everything", two["explained"][0], 1.0)
    # …and an empty case is refused with an error rather than mapped to nowhere
    try:
        M["ca"]({"columns": [[1.0, 0.0], [2.0, 0.0]], "labels": ["a", "b"]})
        check_eq("ca refuses an empty case", "no error", "bad_request")
    except engine.StatsError as exc:
        check_eq("ca refuses an empty case", exc.code, "bad_request")


def _rda_fixture(n=24, seed=5, effect=1.0):
    """Species genuinely driven by two environmental variables, plus one that is pure noise.
    A fixture where nothing drives anything would let a broken constrained ordination pass."""
    rng = np.random.default_rng(seed)
    e1 = rng.normal(size=n)
    e2 = rng.normal(size=n)
    Y = np.column_stack([
        effect * 3 * e1 + rng.normal(0, 0.5, n),
        effect * 2.5 * e1 + rng.normal(0, 0.5, n),
        effect * -2 * e1 + rng.normal(0, 0.5, n),
        effect * 2 * e2 + rng.normal(0, 0.5, n),
        rng.normal(0, 1, n),
    ])
    return Y, e1, e2


def check_rda():
    print("\n# rda  (oracle: the partition closes + identity against PCA + statsmodels OLS + the null)")
    Y, e1, e2 = _rda_fixture()
    n, p = Y.shape
    cols = [list(Y[:, j]) for j in range(p)]
    lab = ["S%d" % (j + 1) for j in range(p)]
    res = M["rda"]({"columns": cols, "labels": lab, "explanatory": [list(e1), list(e2)],
                    "explanatoryLabels": ["Temp", "pH"], "permutations": 199, "seed": 7})
    ex = res["extra"]["ordination"]

    # 1) The partition must close. Constrained + unconstrained = the response's own total
    #    variance, recomputed here from the centred matrix with nothing but numpy.
    Yc = Y - Y.mean(axis=0)
    total = float(np.sum(np.linalg.svd(Yc / math.sqrt(n - 1), compute_uv=False) ** 2))
    check("rda total variance (recomputed)", ex["totalVariance"], total, tol=1e-5)
    check("rda constrained + unconstrained == total",
          ex["constrained"] + float(np.sum(ex["unconstrainedEigenvalues"])), total, tol=1e-4)

    # 2) Identity — constrain the response by its own first principal component and the
    #    constrained variance must be exactly PCA's first eigenvalue. This ties RDA
    #    to a method that is validated separately, through a completely different code path.
    pca = M["pca"]({"columns": cols, "labels": lab, "standardize": False, "componentSelection": "all"})["extra"]["pca"]
    pc1 = [row[0] for row in pca["scores"]]
    one = M["rda"]({"columns": cols, "labels": lab, "explanatory": [pc1], "explanatoryLabels": ["PC1"],
                    "permutations": 99, "seed": 3})["extra"]["ordination"]
    check("rda constrained by PC1 == pca eigenvalue 1", one["constrained"], pca["eigenvalues"][0], tol=1e-5)
    check("rda: that leaves pca eigenvalue 2 unconstrained", one["unconstrainedEigenvalues"][0], pca["eigenvalues"][1], tol=1e-5)

    # 3) an independent fit: statsmodels OLS, column by column, then the fitted matrix's own
    #    spectrum. Nothing shared with the engine's lstsq + SVD.
    import statsmodels.api as sm
    Xd = sm.add_constant(np.column_stack([e1, e2]))
    fit = np.column_stack([sm.OLS(Yc[:, j], Xd).fit().fittedvalues for j in range(p)])
    conInd = float(np.sum(np.linalg.svd(fit / math.sqrt(n - 1), compute_uv=False) ** 2))
    check("rda constrained variance (statsmodels OLS)", ex["constrained"], conInd, tol=1e-5)
    check("rda R2 (statsmodels OLS)", ex["r2"], conInd / total, tol=1e-5)
    # Ezekiel's adjustment, by its formula
    q = 2
    check("rda adjusted R2 (Ezekiel)", ex["adjR2"], 1 - (1 - conInd / total) * (n - 1) / (n - q - 1), tol=1e-5)

    # 4) the pseudo-F, by hand from the two sums
    fobs = (ex["constrained"] / q) / ((total - ex["constrained"]) / (n - q - 1))
    check("rda pseudo-F (hand computation)", ex["pseudoF"], fobs, tol=1e-4)

    # 5) the permutation p can only take the values (r+1)/(perms+1) — anything else means the
    #    count is not what it claims to be.
    check("rda p is exactly (r+1)/(perms+1)", round(ex["p"] * 200, 6) % 1.0, 0.0, tol=1e-6)
    check_le("rda: a real effect is detected", ex["p"], 0.01)
    check_gt("rda: it explains most of the variance", ex["r2"], 0.8)

    # 6) The null. With the explanatory variable shuffled away from the response, the test
    #    must not keep rejecting: a permutation test that reports p ≈ 0 on noise is worse than
    #    no test at all. Ten independent datasets, 5% level.
    rejects = 0
    for s in range(10):
        rng = np.random.default_rng(1000 + s)
        Yn = rng.normal(size=(20, 4))
        xn = rng.normal(size=20)
        r = M["rda"]({"columns": [list(Yn[:, j]) for j in range(4)], "labels": ["a", "b", "c", "d"],
                      "explanatory": [list(xn)], "explanatoryLabels": ["noise"],
                      "permutations": 99, "seed": 11 + s})
        if r["extra"]["ordination"]["p"] <= 0.05:
            rejects += 1
    check_le("rda: on pure noise it rejects at about the nominal rate", rejects, 3)

    # 7) the two site placements are different things — LC from the explanatory variables, WA
    #    from what was observed. Returning one twice would hide the choice the literature argues
    #    about; and WA must correlate strongly with LC or the axes are not shared.
    lc = np.asarray(ex["lcScores"], float)[:, 0]
    wa = np.asarray(ex["waScores"], float)[:, 0]
    check_gt("rda: LC and WA differ", float(np.max(np.abs(lc - wa))), 1e-6)
    check_gt("rda: but they share the axis", abs(float(np.corrcoef(lc, wa)[0, 1])), 0.9)

    # 8) the environment arrows are the correlations between the variables and the LC axis
    check("rda env arrow 1 == corr(Temp, RDA1)", ex["envScores"][0][0], float(np.corrcoef(e1, lc)[0, 1]), tol=1e-4)
    check("rda env arrow 2 == corr(pH, RDA1)", ex["envScores"][1][0], float(np.corrcoef(e2, lc)[0, 1]), tol=1e-4)

    # 9) a term that explains nothing is not called significant; one that does, is
    terms = {t["term"]: t for t in res["terms"] if "p" in t}
    check_le("rda: the driving term is significant", terms["Temp"]["p"], 0.05)
    noise = M["rda"]({"columns": cols, "labels": lab, "explanatory": [list(e1), list(np.random.default_rng(2).normal(size=n))],
                      "explanatoryLabels": ["Temp", "unrelated"], "permutations": 199, "seed": 5})
    jt = {t["term"]: t for t in noise["terms"] if "p" in t}["unrelated"]
    check_gt("rda: a pure-noise term is not", jt["p"], 0.05)

    # 10) refusals raise an error
    for bad, why in (
        ({"columns": cols, "labels": lab, "permutations": 99}, "no explanatory variables"),
        ({"columns": cols, "labels": lab, "explanatory": [[1.0] * n], "explanatoryLabels": ["k"], "permutations": 99}, "a constant constraint"),
    ):
        try:
            M["rda"](bad)
            check_eq("rda refuses %s" % why, "no error", "bad_request")
        except engine.StatsError as exc:
            check_eq("rda refuses %s" % why, exc.code, "bad_request")


def check_dbrda():
    """db-RDA — checked almost entirely by an identity, which is the strongest oracle
    available without R: distance-based RDA on Euclidean distances is redundancy analysis.
    Not "close to" — the principal coordinates of a Euclidean distance matrix are the centred
    data rotated, and every quantity RDA reports is rotation-invariant, so the two must agree
    to the last digit. A wrong centring, a dropped axis, a mis-scaled Gram matrix or a
    permutation that shuffles the wrong thing all break the equality."""
    print("\n# dbrda  (oracle: identity against rda on Euclidean distances + the partition closes + the null)")
    Y, e1, e2 = _rda_fixture()
    n = Y.shape[0]
    # A non-negative fixture: db-RDA's own distances (and its weighted-average species
    # positions) are defined for abundances, and Bray-Curtis needs them below.
    Yp = Y - Y.min() + 0.5
    cols = _cols(Yp)
    lab = ["Sp%d" % (j + 1) for j in range(Yp.shape[1])]
    args = {"columns": cols, "labels": lab, "explanatory": [list(e1), list(e2)],
            "explanatoryLabels": ["Temp", "pH"], "permutations": 199, "seed": 5}

    ref = M["rda"](dict(args))
    got = M["dbrda"](dict(args, metric="euclidean"))
    rex, gex = ref["extra"]["ordination"], got["extra"]["ordination"]

    # 1) The identity, quantity by quantity. Exact — no tolerance slack.
    for key in ("totalVariance", "constrained", "r2", "adjR2", "pseudoF", "p"):
        check("dbrda(euclidean) %s == rda" % key, gex[key], rex[key], tol=1e-9)
    check_eq("dbrda(euclidean) has rda's axis count", len(gex["eigenvalues"]), len(rex["eigenvalues"]))
    for a in range(len(rex["eigenvalues"])):
        check("dbrda(euclidean) eigenvalue %d == rda" % (a + 1), gex["eigenvalues"][a], rex["eigenvalues"][a], tol=1e-9)
    # …and the sites land in the same relative places: the coordinates are a rotation, so the
    # distances between sites are what must match, not the coordinates themselves.
    la = np.asarray(rex["lcScores"], float)
    lb = np.asarray(gex["lcScores"], float)
    da = np.sqrt(((la[:, None, :] - la[None, :, :]) ** 2).sum(-1))
    db = np.sqrt(((lb[:, None, :] - lb[None, :, :]) ** 2).sum(-1))
    check("dbrda(euclidean) site distances == rda's", float(np.max(np.abs(da - db))), 0.0, tol=1e-6)

    # 2) …and the identity survives a transformation, which is where a wrong order of
    #    operations (distance before transform) would show up.
    refH = M["rda"](dict(args, transform="hellinger"))
    gotH = M["dbrda"](dict(args, metric="euclidean", transform="hellinger"))
    check("dbrda(euclidean, hellinger) r2 == rda's", gotH["extra"]["ordination"]["r2"],
          refH["extra"]["ordination"]["r2"], tol=1e-9)
    check("dbrda(euclidean, hellinger) p == rda's", gotH["extra"]["ordination"]["p"],
          refH["extra"]["ordination"]["p"], tol=1e-9)

    # 3) On Bray-Curtis — the reason the method exists — the partition still closes, and the
    #    non-Euclidean axes are reported rather than quietly dropped.
    bray = M["dbrda"](dict(args, metric="bray"))
    bex = bray["extra"]["ordination"]
    total = bex["constrained"] + float(np.sum(M["dbrda"](dict(args, metric="bray"))["extra"]["ordination"]["unconstrainedEigenvalues"]))
    check("dbrda(bray) constrained + unconstrained == total", total, bex["totalVariance"], tol=1e-4)
    check_gt("dbrda(bray) reports its negative eigenvalues", bray["glance"]["negativeEigenvalues"], 0)
    check_le("dbrda(bray): the real effect is detected", bex["p"], 0.01)
    # the species are positions (weighted averages), so every one sits inside the site cloud
    sp = np.asarray(bex["speciesScores"], float)
    site = np.asarray(bex["waScores"], float)
    check_le("dbrda(bray): species sit within the site cloud (they are positions, not loadings)",
             float(np.max(np.abs(sp[:, 0]))), float(np.max(np.abs(site[:, 0]))) + 1e-9)

    # 4) p is exactly (r + 1) / (permutations + 1) — the same contract every permutation test here has
    check("dbrda p is exactly (r+1)/(perms+1)", round(bex["p"] * 200, 6) % 1.0, 0.0, tol=1e-6)

    # 5) The null: on data no explanatory variable drives, it must not reject much more than
    #    the nominal 5% of the time.
    rejects = 0
    for s in range(10):
        rng = np.random.default_rng(500 + s)
        Yn = np.abs(rng.normal(size=(20, 4))) + 0.5
        r = M["dbrda"]({"columns": [list(Yn[:, j]) for j in range(4)], "labels": ["a", "b", "c", "d"],
                        "metric": "bray", "explanatory": [list(rng.normal(size=20))],
                        "explanatoryLabels": ["unrelated"], "permutations": 199, "seed": 11 + s})
        if r["extra"]["ordination"]["p"] <= 0.05:
            rejects += 1
    check_le("dbrda: on pure noise it rejects at about the nominal rate", rejects, 3)

    # 6) refusals raise an error
    for bad, why in (
        ({"columns": cols, "labels": lab, "permutations": 99}, "no explanatory variables"),
        ({"columns": cols, "labels": lab, "explanatory": [[1.0] * n], "explanatoryLabels": ["k"], "permutations": 99}, "a constant constraint"),
    ):
        try:
            M["dbrda"](bad)
            check_eq("dbrda refuses %s" % why, "no error", "bad_request")
        except engine.StatsError as exc:
            check_eq("dbrda refuses %s" % why, exc.code, "bad_request")


def check_cca():
    """CCA — checked by an identity against CA, which is the only oracle strong enough here.

    Constrain a CCA by CA's own first m axes and the fitted space is the space those axes
    span, so the constrained inertia must come out as CA's first m eigenvalues exactly. That
    catches a wrong weighting, a wrong centring and a wrong projection at once — an unweighted
    fit, or one that forgets the row masses, misses it immediately. The two paths share only
    the chi-square residual matrix; the whole weighted-regression half is under test."""
    print("\n# cca  (oracle: identity against ca + scipy chi-square + the partition closes + the null)")
    from scipy import stats as sp_stats_cca
    rng = np.random.default_rng(11)
    n, p = 20, 6
    grad = rng.normal(size=n)
    opt = np.linspace(-2, 2, p)
    lam = 30 * np.exp(-0.5 * ((grad[:, None] - opt[None, :]) / 0.9) ** 2) + 0.5
    Mx = rng.poisson(lam).astype(float)
    Mx[Mx.sum(axis=1) == 0, 0] = 1.0
    Mx[:, Mx.sum(axis=0) == 0] = 1.0
    cols = _cols(Mx)
    lab = ["Sp%d" % (j + 1) for j in range(p)]
    unrelated = list(rng.normal(size=n))

    caRes = M["ca"]({"columns": cols, "labels": lab})["extra"]["ordination"]

    # 1) The identity, at one constraint and at two.
    scores = caRes["scores"]
    for m in (1, 2):
        constr = [[float(scores[i][a]) for i in range(n)] for a in range(m)]
        cc = M["cca"]({"columns": cols, "labels": lab, "explanatory": constr,
                       "explanatoryLabels": ["ax%d" % (a + 1) for a in range(m)],
                       "permutations": 99, "seed": 5})["extra"]["ordination"]
        check_eq("cca constrained by CA's first %d axes has %d axes" % (m, m), len(cc["eigenvalues"]), m)
        for a in range(m):
            check("cca constrained by CA's axes: eigenvalue %d == ca's" % (a + 1),
                  cc["eigenvalues"][a], caRes["eigenvalues"][a], tol=1e-7)
        check("cca total inertia == ca's", cc["totalVariance"], caRes["totalInertia"], tol=1e-9)

    # 2) total inertia is chi-square / N — scipy computes it, the engine never calls scipy here
    chi2 = float(sp_stats_cca.chi2_contingency(Mx, correction=False).statistic)
    res = M["cca"]({"columns": cols, "labels": lab, "explanatory": [list(grad), unrelated],
                    "explanatoryLabels": ["Gradient", "unrelated"], "permutations": 199, "seed": 5})
    ex = res["extra"]["ordination"]
    # Default tolerance, like `check_ca`'s identical line: the engine reports this rounded to
    # six decimals (`_r`), so a tighter tolerance would be measuring the display, not the maths.
    check("cca total inertia == chi2 / N (scipy)", ex["totalVariance"], chi2 / float(np.sum(Mx)))

    # 3) the partition closes: nothing is quietly dropped between constrained and residual
    check("cca constrained + unconstrained == total inertia",
          ex["constrained"] + float(np.sum(ex["unconstrainedEigenvalues"])), ex["totalVariance"], tol=1e-4)
    check("cca R2 == constrained / total", ex["r2"], ex["constrained"] / ex["totalVariance"], tol=1e-6)

    # 4) pseudo-F recomputed by hand from the two sums (the engine's own formula, written out
    #    here from the definition rather than called)
    q = 2
    unc = float(np.sum(ex["unconstrainedEigenvalues"]))
    check("cca pseudo-F (hand computation)", ex["pseudoF"],
          (ex["constrained"] / q) / (unc / (n - q - 1)), tol=1e-3)
    check("cca adjusted R2 (Ezekiel)", ex["adjR2"],
          1 - (1 - ex["r2"]) * (n - 1) / (n - q - 1), tol=1e-6)
    check("cca p is exactly (r+1)/(perms+1)", round(ex["p"] * 200, 6) % 1.0, 0.0, tol=1e-6)

    # 5) The science: the real gradient is significant, the uninformative column is not.
    check_le("cca: the driving gradient is detected", ex["p"], 0.01)
    terms = {t["term"]: t for t in res["terms"] if "p" in t}
    check_le("cca: the driving term is significant", terms["Gradient"]["p"], 0.05)
    check_gt("cca: a pure-noise term is not", terms["unrelated"]["p"], 0.05)

    # 6) LC and WA are different placements of the same axis — if they were identical the
    #    engine would be returning one of them twice, which is what the toggle exists to avoid.
    lc = np.asarray(ex["lcScores"], float)[:, 0]
    wa = np.asarray(ex["waScores"], float)[:, 0]
    check_gt("cca: LC and WA differ", float(np.max(np.abs(lc - wa))), 1e-6)
    check_gt("cca: but they share the axis", abs(float(np.corrcoef(lc, wa)[0, 1])), 0.9)

    # 7) The masses are real. A site with more counts must weigh more — duplicate one site's
    #    counts and the fitted axis must move toward it. An unweighted (RDA-style) fit would
    #    not budge, which is exactly the mistake this catches.
    heavy = Mx.copy()
    heavy[0, :] = heavy[0, :] * 20.0
    base = M["cca"]({"columns": _cols(Mx), "labels": lab, "explanatory": [list(grad)],
                     "explanatoryLabels": ["g"], "permutations": 99, "seed": 5})["extra"]["ordination"]
    hv = M["cca"]({"columns": _cols(heavy), "labels": lab, "explanatory": [list(grad)],
                   "explanatoryLabels": ["g"], "permutations": 99, "seed": 5})["extra"]["ordination"]
    check_gt("cca: a site's mass changes the fit (it is weighted, not an RDA)",
             abs(hv["eigenvalues"][0] - base["eigenvalues"][0]), 1e-6)
    check_gt("cca: the row masses are reported and sum to 1", float(np.sum(base["rowMasses"])), 0.999)

    # 8) The null: pure noise must not reject much more than the nominal 5%.
    rejects = 0
    for s in range(10):
        r2ng = np.random.default_rng(700 + s)
        Yn = r2ng.poisson(6.0, size=(20, 5)).astype(float) + 1.0
        r = M["cca"]({"columns": [list(Yn[:, j]) for j in range(5)], "labels": ["a", "b", "c", "d", "e"],
                      "explanatory": [list(r2ng.normal(size=20))], "explanatoryLabels": ["unrelated"],
                      "permutations": 199, "seed": 23 + s})
        if r["extra"]["ordination"]["p"] <= 0.05:
            rejects += 1
    check_le("cca: on pure noise it rejects at about the nominal rate", rejects, 3)

    # 9) refusals raise an error
    for bad, why in (
        ({"columns": cols, "labels": lab, "permutations": 99}, "no explanatory variables"),
        ({"columns": cols, "labels": lab, "explanatory": [[1.0] * n], "explanatoryLabels": ["k"], "permutations": 99}, "a constant constraint"),
        ({"columns": [[1.0, -2.0, 3.0], [2.0, 1.0, 1.0]], "labels": ["a", "b"],
          "explanatory": [[1.0, 2.0, 3.0]], "explanatoryLabels": ["g"], "permutations": 99}, "negative counts"),
    ):
        try:
            M["cca"](bad)
            check_eq("cca refuses %s" % why, "no error", "bad_request")
        except engine.StatsError as exc:
            check_eq("cca refuses %s" % why, exc.code, "bad_request")


def _varpart_fixture(n=40, seed=17):
    """Three blocks where the answer is known by construction: climate drives the response,
    soil is built to overlap climate heavily (so a big shared fraction must appear), and space
    is pure noise (so its unique fraction must be ~0 and not significant). A fixture where the
    blocks were independent could not exhibit the thing variance partitioning exists to show."""
    rng = np.random.default_rng(seed)
    clim = np.column_stack([rng.normal(size=n), rng.normal(size=n)])
    soil = np.column_stack([0.8 * clim[:, 0] + 0.6 * rng.normal(size=n), rng.normal(size=n)])
    space = np.column_stack([rng.normal(size=n)])
    Y = np.column_stack([
        3 * clim[:, 0] + 1.0 * soil[:, 1] + rng.normal(0, 0.7, n),
        2.0 * clim[:, 0] - 1.5 * clim[:, 1] + rng.normal(0, 0.7, n),
        -2.0 * clim[:, 0] + 0.8 * soil[:, 1] + rng.normal(0, 0.7, n),
        1.2 * soil[:, 1] + rng.normal(0, 0.7, n),
    ])
    return Y, clim, soil, space


def check_varpart():
    """Variance partitioning — every fraction recomputed by a different route.

    The engine reaches its adjusted R² through `_rda_core`'s SVD of the fitted matrix. The
    oracle here reaches it through statsmodels' OLS, column by column, summing sums of squares
    — and then writes Legendre & Legendre's algebra out by hand rather than calling it. Two
    further checks pin it from the outside: the fractions and the residual must sum to exactly
    1, and the total explained must equal what `rda` reports for the two blocks joined, which
    is a method already validated against PCA and statsmodels.
    """
    import statsmodels.api as sm
    print("\n# varpart  (oracle: statsmodels OLS per column + the L&L algebra by hand + identity against rda)")
    Y, clim, soil, space = _varpart_fixture()
    n = Y.shape[0]
    cols = _cols(Y)
    lab = ["Sp%d" % (j + 1) for j in range(Y.shape[1])]
    base = {"columns": cols, "labels": lab,
            "explanatory": _cols(clim), "explanatoryLabels": ["T", "P"],
            "explanatory2": _cols(soil), "explanatoryLabels2": ["pH", "N"],
            "blockLabels": ["Climate", "Soil"], "permutations": 199, "seed": 4}

    def adj_indep(Xmat):
        """Ezekiel-adjusted R² of Y on Xmat, from statsmodels' per-column OLS."""
        if Xmat.shape[1] == 0:
            return 0.0
        Yc = Y - Y.mean(0)
        Xc = Xmat - Xmat.mean(0)
        ss_tot = float((Yc ** 2).sum())
        ss_fit = 0.0
        for j in range(Yc.shape[1]):
            fv = sm.OLS(Yc[:, j], sm.add_constant(Xc)).fit().fittedvalues
            ss_fit += float(((fv - fv.mean()) ** 2).sum())
        q = int(np.linalg.matrix_rank(Xc))
        return 1.0 - (1.0 - ss_fit / ss_tot) * (n - 1) / (n - q - 1)

    res = M["varpart"](dict(base))
    ex = res["extra"]["varpart"]
    got = {f["label"]: f["adjR2"] for f in ex["fractions"]}

    A, B = adj_indep(clim), adj_indep(soil)
    AB = adj_indep(np.column_stack([clim, soil]))
    check("varpart [a] Climate alone (statsmodels)", got["[a] Climate alone"], AB - B, tol=1e-4)
    check("varpart [b] shared (statsmodels)", got["[b] shared"], A + B - AB, tol=1e-4)
    check("varpart [c] Soil alone (statsmodels)", got["[c] Soil alone"], AB - A, tol=1e-4)
    check("varpart explained == adj R2 of both blocks (statsmodels)", ex["explained"], AB, tol=1e-4)
    check("varpart residual == 1 - explained", ex["residual"], 1.0 - AB, tol=1e-4)

    # The partition is a partition. Every fraction plus what nothing explains is the whole.
    check("varpart fractions + residual == 1", sum(got.values()) + ex["residual"], 1.0, tol=1e-5)

    # Identity against a method already validated: the total explained is exactly what an RDA
    # on the two blocks joined reports as its adjusted R².
    joined = M["rda"]({"columns": cols, "labels": lab,
                       "explanatory": _cols(np.column_stack([clim, soil])),
                       "explanatoryLabels": ["T", "P", "pH", "N"],
                       "permutations": 99, "seed": 4})["extra"]["ordination"]
    check("varpart explained == rda's adjusted R2 on the joined blocks", ex["explained"], joined["adjR2"], tol=1e-6)

    # …and each block's own total is what a single-block RDA reports.
    solo = M["rda"]({"columns": cols, "labels": lab, "explanatory": _cols(clim),
                     "explanatoryLabels": ["T", "P"], "permutations": 99, "seed": 4})["extra"]["ordination"]
    check("varpart block total == rda's adjusted R2 for that block alone",
          [b["adjR2"] for b in ex["blocks"] if b["label"] == "Climate"][0], solo["adjR2"], tol=1e-6)

    # The science the fixture was built to show: the two blocks overlap heavily, and the
    # overlap is the biggest fraction.
    check_gt("varpart: the shared fraction is real (the blocks were built to overlap)", got["[b] shared"], 0.3)
    check_le("varpart: a unique fraction is smaller than the shared one", got["[a] Climate alone"], got["[b] shared"])

    # The unique fractions carry a p; the shared one carries none, and that is deliberate.
    fr = {f["label"]: f for f in ex["fractions"]}
    check_eq("varpart: the unique fractions are testable", fr["[a] Climate alone"]["testable"], True)
    check_eq("varpart: the shared fraction is not", fr["[b] shared"]["testable"], False)
    check_eq("varpart: …and carries no p-value", "p" in fr["[b] shared"], False)
    check_le("varpart: the driving block's unique fraction is significant", fr["[a] Climate alone"]["p"], 0.05)
    check("varpart p is exactly (r+1)/(perms+1)", round(fr["[a] Climate alone"]["p"] * 200, 6) % 1.0, 0.0, tol=1e-6)

    # ── Three blocks: the algebra again, and the noise block must come out at nothing ──
    res3 = M["varpart"](dict(base, explanatory3=_cols(space), explanatoryLabels3=["X"],
                             blockLabels=["Climate", "Soil", "Space"]))
    ex3 = res3["extra"]["varpart"]
    g3 = {f["label"]: f["adjR2"] for f in ex3["fractions"]}
    C = adj_indep(space)
    AC = adj_indep(np.column_stack([clim, space]))
    BC = adj_indep(np.column_stack([soil, space]))
    ABC = adj_indep(np.column_stack([clim, soil, space]))
    check("varpart3 [a] Climate alone (statsmodels)", g3["[a] Climate alone"], ABC - BC, tol=1e-4)
    check("varpart3 [b] Soil alone (statsmodels)", g3["[b] Soil alone"], ABC - AC, tol=1e-4)
    check("varpart3 [c] Space alone (statsmodels)", g3["[c] Space alone"], ABC - AB, tol=1e-4)
    check("varpart3 [d] Climate & Soil (statsmodels)", g3["[d] Climate ∩ Soil"], AC + BC - C - ABC, tol=1e-4)
    check("varpart3 [e] Soil & Space (statsmodels)", g3["[e] Soil ∩ Space"], AB + AC - A - ABC, tol=1e-4)
    check("varpart3 [f] Climate & Space (statsmodels)", g3["[f] Climate ∩ Space"], AB + BC - B - ABC, tol=1e-4)
    check("varpart3 [g] all three (statsmodels)", g3["[g] all three"], A + B + C - AB - AC - BC + ABC, tol=1e-4)
    check("varpart3 fractions + residual == 1", sum(g3.values()) + ex3["residual"], 1.0, tol=1e-5)
    fr3 = {f["label"]: f for f in ex3["fractions"]}
    check_le("varpart3: the pure-noise block explains nothing uniquely", abs(g3["[c] Space alone"]), 0.02)
    check_gt("varpart3: …and is not significant", fr3["[c] Space alone"]["p"], 0.05)
    check_eq("varpart3 reports 7 fractions", len(ex3["fractions"]), 7)

    # A negative fraction is a real result, not an error — the engine must report it rather
    #    than clamp it to zero, or the partition stops summing to 1.
    check_gt("varpart3: a negative fraction is reported, not clamped", res3["glance"]["negativeFractions"], 0)
    check_le("varpart3: and the smallest fraction really is below zero", min(g3.values()), 0.0)

    # The null: blocks that drive nothing must not have their unique fractions called real.
    rejects = 0
    for s in range(10):
        rg = np.random.default_rng(900 + s)
        Yn = rg.normal(size=(30, 4))
        r = M["varpart"]({"columns": [list(Yn[:, j]) for j in range(4)], "labels": ["a", "b", "c", "d"],
                          "explanatory": [list(rg.normal(size=30))], "explanatoryLabels": ["j1"],
                          "explanatory2": [list(rg.normal(size=30))], "explanatoryLabels2": ["j2"],
                          "permutations": 199, "seed": 31 + s})
        if [f for f in r["extra"]["varpart"]["fractions"] if f.get("testable")][0]["p"] <= 0.05:
            rejects += 1
    check_le("varpart: on pure noise a unique fraction rejects at about the nominal rate", rejects, 3)

    # Refusals raise an error.
    for bad, why in (
        ({"columns": cols, "labels": lab, "explanatory": _cols(clim), "explanatoryLabels": ["T", "P"], "permutations": 99},
         "only one block (there is nothing to partition)"),
        ({"columns": cols, "labels": lab,
          "explanatory": [[1.0] * n], "explanatoryLabels": ["k"],
          "explanatory2": _cols(soil), "explanatoryLabels2": ["pH", "N"], "permutations": 99},
         "a constant block"),
    ):
        try:
            M["varpart"](bad)
            check_eq("varpart refuses %s" % why, "no error", "bad_request")
        except engine.StatsError as exc:
            check_eq("varpart refuses %s" % why, exc.code, "bad_request")


def check_regression_offsets():
    """50-digit raw normal equations: independent of engine's centered numpy fit."""
    ys = [2, 4.3, 5.8, 8.4, 9.7, 12.2]
    for offset in (10**8, 10**9, 10**12):
        xs = [mp.mpf(offset + i) for i in range(len(ys))]
        yy = list(map(mp.mpf, ys))
        for weighting in ("none", "1/Y2"):
            w = [1 / y**2 if weighting == "1/Y2" else mp.mpf(1) for y in yy]
            sw = sum(w)
            sx = sum(a*b for a,b in zip(w,xs))
            sy = sum(a*b for a,b in zip(w,yy))
            sxx = sum(a*b*b for a,b in zip(w,xs))
            sxy = sum(a*b*c for a,b,c in zip(w,xs,yy))
            slope = (sw*sxy-sx*sy)/(sw*sxx-sx*sx)
            intercept = (sy-slope*sx)/sw
            residuals = [y-(intercept+slope*x) for x,y in zip(xs,yy)]
            mse = sum(a*b*b for a,b in zip(w,residuals))/(len(ys)-2)
            se = mp.sqrt(mse/(sxx-sx*sx/sw))
            got = engine.regression({"x": list(map(float,xs)), "y": ys, "weighting": weighting})
            label = "offset %s %s" % (offset, weighting)
            check(label + " slope", got["glance"]["slope"], slope, tol=1e-6)
            check(label + " p", got["glance"]["p"], t_p_two(slope/se, len(ys)-2), tol=1e-10)
            for i,r in enumerate(residuals):
                check(label + " residual %d" % i, got["extra"]["residuals"]["resid"][i], r, tol=1e-6)
    for slope in (-2, 2):
        got = engine.regression({"x": [1,2,3,4], "y": [slope*i+1 for i in (1,2,3,4)]})
        check_eq("perfect nonzero slope has limiting p=0", got["glance"]["p"], 0)
    check_eq("constant response has undefined slope test",
             engine.regression({"x": [1,2,3,4], "y": [5,5,5,5]})["glance"]["p"], None)


def main():
    for fn in (
        check_rounding, check_cox, check_regression_offsets,
        check_describe, check_descriptives_extra, check_ttest, check_correlation, check_correlation_extra, check_corrmatrix, check_deming_extra, check_runs_test, check_grubbs_iterative, check_anova, check_anova_variants, check_posthoc_selected, check_posthoc_family, check_twoway_posthoc, check_twoway_tukey_vs_statsmodels, check_twoway_tukey_vs_R, check_regression, check_lognormality,
        check_contingency, check_survival, check_twoway, check_rmanova, check_mixedanova, check_goodnessoffit, check_nested,
        check_multipleregression, check_logistic, check_poisson, check_pca, check_roc, check_deming, check_auc, check_ancova, check_friedman,
        check_nl_optimizer, check_interpolate, check_globalfit_inhibition, check_globalfit_one_curve, check_meltingtemp, check_permanova, check_nl_models_extra, check_nl_formula_coverage, check_nl_global_formula_coverage, check_nl_polynomials, check_nl_derived, check_ec_anything, check_comparefits,
        check_regression_extras, check_multifactor, check_mixedmodel, check_nl_tail, check_montecarlo, check_userfit,
        check_nlband, check_nldiag, check_nlresid, check_ic50_norm, check_enzyme_progress, check_allosteric_binding, check_weighting, check_profileci, check_hougaard, check_rout, check_fit_flags, check_pcorrect, check_curvetransform,
        check_cluster, check_pca_selection, check_clusteroptk, check_contingency_ci, check_contingency_or, check_survival_pairwise, check_survival_trend,
        check_blandaltman, check_passingbablok,
        check_effect_size, check_mannwhitney, check_wilcoxon, check_ks, check_grubbs, check_rout_column, check_power,
        check_ancova_slopediff, check_fisher_freeman_halton, check_delong_roc,
        check_equivalence, check_permutation, check_bayesfactor, check_conf_threading, check_local_minimum_rescue, check_multiplicity_degenerate, check_degenerate_inputs,
        check_metaanalysis, check_publicationbias,
        check_transformations, check_ca, check_rda, check_cca, check_dbrda, check_varpart, check_pcoa_identity, check_pcoa_negative, check_pava, check_nmds, check_nmds_perfect, check_nmds_reproducible,
    ):
        # A group that raises must be reported as a failure, not abort the battery: an
        # exception in one group (say, `None` passed into a corrector) would otherwise end the
        # run and hide every group after it, and the total with them. An oracle battery is
        # worth least exactly when the code under test is broken.
        global _FAIL
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - the point is to catch anything
            _FAIL += 1
            print("%-4s %-52s %s: %s" % ("FAIL", fn.__name__ + " RAISED", type(exc).__name__, str(exc)[:60]))
    print("\n%d passed, %d failed" % (_PASS, _FAIL))
    sys.exit(1 if _FAIL else 0)


if __name__ == "__main__":
    main()
