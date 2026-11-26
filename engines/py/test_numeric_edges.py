"""Numerical edge cases, checked against independent centred/threshold recomputations."""
import math
import statistics
import unittest
from unittest.mock import patch
import numpy as np
import engine


class NumericEdgeCases(unittest.TestCase):
    def test_cox_separated_fit_is_refused_without_a_library_warning(self):
        # statsmodels may finish a separated fit without warning (it does on some systems); the
        # refusal must not depend on that warning.
        from statsmodels.duration.hazard_regression import PHReg
        quiet_fit = PHReg.fit
        def fit_without_warnings(self, *args, **kwargs):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                return quiet_fit(self, *args, **kwargs)
        separated = {"time": [1, 2, 3, 4, 50, 60, 70, 80], "event": [1] * 8,
                     "predictors": [[1, 2, 3, 4, 10, 11, 12, 13]], "labels": ["x"]}
        ordinary = {"time": [5, 8, 12, 15, 20, 25, 30, 40], "event": [1, 1, 0, 1, 1, 0, 1, 1],
                    "predictors": [[1, 3, 2, 5, 4, 7, 6, 9]], "labels": ["x"]}
        with patch.object(PHReg, "fit", fit_without_warnings):
            with self.assertRaisesRegex(engine.StatsError, "did not converge"):
                engine.cox(separated)
            self.assertTrue(math.isfinite(engine.cox(ordinary)["terms"][0]["estimate"]))

    def test_regression_translation_preserves_fit_and_inference(self):
        y = [2, 4.1, 5.9, 8.2, 9.8, 12.1]
        for weighting in ["none", "1/Y2"]:
            base = engine.regression({"x": list(range(1, 7)), "y": y, "weighting": weighting})
            for offset in [1e8, 1e9, 1e12]:
                with self.subTest(weighting=weighting, offset=offset):
                    got = engine.regression({"x": [offset+i for i in range(1, 7)], "y": y, "weighting": weighting})
                    for key in ["slope", "r_sq", "p"]:
                        self.assertAlmostEqual(got["glance"][key], base["glance"][key], places=6)
                    self.assertEqual(got["extra"]["residuals"]["resid"], base["extra"]["residuals"]["resid"])
                    if weighting == "none":
                        self.assertAlmostEqual(got["glance"]["slope"], statistics.linear_regression(range(1, 7), y).slope, places=6)

    def test_perfect_nonzero_slope_is_not_a_null_finding(self):
        for variant in ["ols", "origin"]:
            got = engine.regression({"x": [1,2,3,4,5], "y": [2,4,6,8,10], "variant": variant})
            self.assertEqual(got["glance"]["p"], 0)
            self.assertNotIn("not statistically significant", got["summary"])

    def test_constant_response_has_no_slope_inference(self):
        got = engine.regression({"x": [1,2,3,4,5], "y": [3,3,3,3,3]})
        self.assertIsNone(got["glance"]["p"])
        self.assertIn("not determinable", got["summary"])

    def test_roc_complete_cases_include_all_markers(self):
        for marker2 in [False, True]:
            data = {"scores": [1,None,2,3,4,5], "labels": [0,1,0,1,1,1]}
            if marker2:
                data["scores2"] = [1,2,3,None,2,4]
            keys = list(data)
            rows = [r for r in zip(*(data[k] for k in keys)) if all(v is not None for v in r)]
            clean = {k: [r[i] for r in rows] for i,k in enumerate(keys)}
            self.assertEqual(engine.roc(data), engine.roc(clean))

    def test_survival_keeps_time_and_event_together(self):
        a = {"groups": [{"label": "A", "time": [1,None,2,3,4], "event": [1,0,0,1,1]}]}
        b = {"groups": [{"label": "A", "time": [1,2,3,4], "event": [1,0,1,1]}]}
        self.assertEqual(engine.survival(a), engine.survival(b))

    def test_ancova_and_global_fit_keep_pairs(self):
        groups = [
            {"label": "A", "x": [1,None,2,3,4,5], "y": [2,99,4.1,5.9,8.1,10]},
            {"label": "B", "x": [1,2,3,4,5], "y": [4,6.1,8,9.9,12.1]},
        ]
        clean = [dict(g, x=[x for x,y in zip(g["x"],g["y"]) if x is not None],
                     y=[y for x,y in zip(g["x"],g["y"]) if x is not None]) for g in groups]
        self.assertEqual(engine.ancova({"groups": groups}), engine.ancova({"groups": clean}))
        self.assertEqual(engine.globalfit({"model": "line_origin", "datasets": groups}),
                         engine.globalfit({"model": "line_origin", "datasets": clean}))

    def test_roc_thresholds_match_independent_enumeration_with_ties(self):
        scores = [1,1,2,3,3,4,4,5]
        labels = [0,1,0,1,0,1,0,1]
        got = engine.roc({"scores": scores, "labels": labels})
        expected = []
        for cutoff in sorted(set(scores)):
            tp = sum(s >= cutoff and y == 1 for s,y in zip(scores, labels))
            tn = sum(s < cutoff and y == 0 for s,y in zip(scores, labels))
            expected.append((cutoff, tp/4, tn/4))
        self.assertEqual([(r["cutoff"], r["sensitivity"], r["specificity"]) for r in got["extra"]["roc"]["cutoffs"]], expected)
        best = max(expected, key=lambda row: row[1]+row[2]-1)
        self.assertEqual(got["glance"]["cutoff"], best[0])

    def test_roc_does_not_reduce_a_full_array_for_each_threshold(self):
        # Count work, not elapsed time: summing two n-element arrays for each distinct
        # cutoff is quadratic; cumulative counts avoid those scans.
        n = 1000
        original = np.sum
        work = []
        def counted(a, *args, **kwargs):
            work.append(np.size(a))
            return original(a, *args, **kwargs)
        with patch.object(np, "sum", side_effect=counted):
            engine.roc({"scores": list(range(n)), "labels": [i % 2 for i in range(n)]})
        self.assertLess(sum(work), n * 10)


if __name__ == "__main__":
    unittest.main()
