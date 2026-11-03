export interface TidyTerm {
  term: string;
  // estimate + df may carry a string label rather than a number: e.g. model-
  // comparison rows where the "estimate" is the preferred model's name, or an
  // F-test df reported as "1, 7".
  estimate?: number | string | null;
  se?: number | null;
  statistic?: number | null;
  df?: number | string | null;
  p?: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
  [extra: string]: number | string | boolean | null | undefined;
}

export interface AnalysisResult {
  /** Engine method id (e.g. "ttest"). */
  method: string;
  /** Human title (e.g. "Unpaired t test (Welch)"). */
  title: string;
  /** The tidy results table. */
  terms: TidyTerm[];
  /** Scalar at-a-glance summary (p, statistic, df, n, effect size, …). */
  glance: Record<string, number | string | boolean | null>;
  /** Plain-language interpretation ("explain this result"). */
  summary: string;
  /** Assumption / checklist notes (e.g. normality caveats). */
  assumptions?: string[];
  /** How to cite / method note. */
  cite?: string;
  warnings?: string[];
  /** Nonlinear "flag poor fits": true when the fit breached a user threshold. The
   *  reasons are also prepended to `assumptions`; `flagReasons` keeps them structured. */
  flagged?: boolean | undefined;
  flagReasons?: string[] | undefined;
  /** Method-specific structured payload that doesn't fit the scalar `glance`
   *  (e.g. survival → `{ curves: SurvivalCurve[] }` for plotting). */
  extra?: Record<string, unknown> | undefined;
}
