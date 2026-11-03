import { useEffect, useMemo, useState } from "react";
import { GuideHelp } from "./guideLink";

/**
 * PowerDialog — the "Sample size & power" calculator. A standalone,
 * data-free calculator: pick a design + what to solve for, enter the knowns, and it
 * live-calls the engine `power` method (noncentral t/F via statsmodels, Fisher-z for
 * correlation) to return the required N / achieved power / detectable effect, plus a
 * tradeoff table of required N across target powers. Unlike the other analyses this
 * reads no table, so it opens directly rather than through the Analyze dialog.
 */

type Test = "ttest-two" | "ttest-paired" | "ttest-onesample" | "twoproportions" | "anova" | "correlation";
type Solve = "n" | "power" | "effect";

const TESTS: Array<{ id: Test; label: string }> = [
  { id: "ttest-two", label: "Unpaired t (two groups)" },
  { id: "ttest-paired", label: "Paired t" },
  { id: "ttest-onesample", label: "One-sample t" },
  { id: "twoproportions", label: "Two proportions" },
  { id: "anova", label: "One-way ANOVA" },
  { id: "correlation", label: "Correlation" },
];

const ES_SYMBOL: Record<Test, string> = {
  "ttest-two": "d",
  "ttest-paired": "d",
  "ttest-onesample": "d",
  twoproportions: "h",
  anova: "f",
  correlation: "r",
};

interface PowerResult {
  glance: Record<string, number | string | null>;
  extra: { tradeoff: { power: number[]; n: number[]; total: number[] } };
  summary: string;
  terms: Array<Record<string, number | string | null>>;
}

const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

export function PowerDialog({ onCancel }: { onCancel: () => void }) {
  const [test, setTest] = useState<Test>("ttest-two");
  const [solve, setSolve] = useState<Solve>("n");
  const [effect, setEffect] = useState("0.5");
  const [alpha, setAlpha] = useState("0.05");
  const [powerIn, setPowerIn] = useState("0.8");
  const [nIn, setNIn] = useState("64");
  const [p1, setP1] = useState("0.6");
  const [p2, setP2] = useState("0.4");
  const [kGroups, setKGroups] = useState("3");
  const [ratio, setRatio] = useState("1");
  const [tail, setTail] = useState("two-sided");

  const isProp = test === "twoproportions";
  const isAnova = test === "anova";
  const perGroup = test === "ttest-two" || test === "twoproportions";
  const nLabel = perGroup ? "n per group" : isAnova || test === "correlation" ? "N total" : "n";
  const showTail = test !== "anova"; // the ANOVA F-test has no sidedness

  const payload = useMemo<Record<string, unknown>>(() => {
    const d: Record<string, unknown> = { test, solve, alpha: num(alpha) ?? 0.05, tail };
    if (isAnova) d.kGroups = num(kGroups) ?? 3;
    if (perGroup) d.ratio = num(ratio) ?? 1;
    if (solve !== "effect") {
      if (isProp) {
        d.p1 = num(p1);
        d.p2 = num(p2);
      } else d.effect = num(effect);
    }
    if (solve !== "power") d.power = num(powerIn);
    if (solve !== "n") d.n = num(nIn);
    return d;
  }, [test, solve, effect, alpha, powerIn, nIn, p1, p2, kGroups, ratio, tail, isAnova, isProp, perGroup]);

  const [res, setRes] = useState<PowerResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      if (!window.mady?.runAnalysis) {
        setErr("Stats engine unavailable (run the desktop app).");
        return;
      }
      setBusy(true);
      try {
        const r = await window.mady.runAnalysis("power", payload);
        if (!live) return;
        if (r.ok) {
          setRes(r.results as unknown as PowerResult);
          setErr(null);
        } else {
          setErr(r.message ?? "Calculation failed.");
        }
      } catch (e) {
        if (live) setErr(String(e));
      } finally {
        if (live) setBusy(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [payload]);

  const solvedText = (): string => {
    if (!res) return "—";
    const gl = res.glance;
    if (solve === "n") return `${gl.n} ${nLabel}${perGroup ? ` · ${gl.total} total` : ""}`;
    if (solve === "power") return `${gl.power}`;
    return `${ES_SYMBOL[test]} = ${gl.effect}`;
  };
  const solvedLabel = solve === "n" ? "Required sample size" : solve === "power" ? "Achieved power" : `Detectable effect (${ES_SYMBOL[test]})`;

  const numField = (label: string, value: string, set: (v: string) => void, step = "any", width = 80) => (
    <label>
      {label}{" "}
      <input aria-label={label} type="number" step={step} value={value} style={{ width }} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Sample size and power" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Sample size &amp; power</h3>
          <GuideHelp target={{ entry: "action:power" }} what="Sample size & power" />
        </div>

        <div className="importopts">
          <label>
            Design{" "}
            <select aria-label="Design" value={test} onChange={(e) => setTest(e.target.value as Test)}>
              {TESTS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Solve for{" "}
            <select aria-label="Solve for" value={solve} onChange={(e) => setSolve(e.target.value as Solve)}>
              <option value="n">Required sample size</option>
              <option value="power">Power (given N)</option>
              <option value="effect">Detectable effect (given N)</option>
            </select>
          </label>
        </div>

        <div className="importopts">
          {/* Effect size — an input unless we're solving for it. */}
          {solve !== "effect" &&
            (isProp ? (
              <>
                {numField("Proportion 1", p1, setP1)}
                {numField("Proportion 2", p2, setP2)}
              </>
            ) : (
              numField(`Effect size (${ES_SYMBOL[test]})`, effect, setEffect)
            ))}
          {numField("α", alpha, setAlpha)}
          {solve !== "power" && numField("Power", powerIn, setPowerIn)}
          {solve !== "n" && numField(nLabel, nIn, setNIn)}
          {isAnova && numField("Groups (k)", kGroups, setKGroups, "1", 60)}
          {perGroup && numField("Group ratio", ratio, setRatio)}
          {showTail && (
            <label>
              Sides{" "}
              <select aria-label="Sides" value={tail} onChange={(e) => setTail(e.target.value)}>
                <option value="two-sided">Two-sided</option>
                <option value="larger">One-sided</option>
              </select>
            </label>
          )}
        </div>

        {err ? (
          <p className="note" style={{ color: "var(--danger, #c0392b)" }}>
            {err}
          </p>
        ) : (
          <>
            <div className="powerresult" style={{ margin: "10px 0", padding: "10px 12px", background: "var(--panel, #f4f4f6)", borderRadius: 6 }}>
              <div style={{ fontSize: 11, opacity: 0.7 }}>{solvedLabel}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }} aria-label="Solved value">
                {busy && !res ? "…" : solvedText()}
              </div>
              {res && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>{res.summary}</div>}
            </div>

            {res && res.extra?.tradeoff?.power?.length > 0 && (
              <div className="importpreview">
                <table>
                  <thead>
                    <tr>
                      <th>Power</th>
                      <th>{perGroup ? "n / group" : "N"}</th>
                      {perGroup && <th>Total N</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {res.extra.tradeoff.power.map((p, i) => (
                      <tr key={i}>
                        <td>{p.toFixed(2)}</td>
                        <td>{res.extra.tradeoff.n[i]}</td>
                        {perGroup && <td>{res.extra.tradeoff.total[i]}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <p className="note">
          Effect size uses Cohen&apos;s conventions ({ES_SYMBOL[test]}); N is rounded up to whole subjects. The tradeoff
          table lists the sample size needed at other target powers for the same effect and α.
        </p>

        <div className="modalbtns">
          <button className="btn" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
