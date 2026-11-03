import { useEffect, useMemo, useState } from "react";
import { GuideHelp } from "./guideLink";

/**
 * MonteCarloDialog — Monte-Carlo simulation of a curve-fit. A standalone,
 * data-free tool: pick a model + its "true" parameters + an X design + noise, and it
 * repeatedly simulates a dataset and fits the model back (engine `montecarlo`),
 * reporting the distribution of each fitted parameter (mean, SD, 95% CI, bias, CV%)
 * plus the fit convergence rate — i.e. how precisely this design + noise can determine
 * each parameter. Reads no table, so it opens directly rather than through the Analyze
 * dialog. Deterministic in the seed.
 */

interface MCModel {
  id: string;
  label: string;
  /** Parameter names, in the engine's order (trueParams is positional). */
  params: string[];
  trueDefaults: number[];
  x: { start: number; end: number; count: number; log: boolean };
  noise: number;
}

/**
 * Curated simulation presets — one per engine model family, param names/order matching
 * engine `_nl_models` (trueParams is positional, so the order is load-bearing) with
 * sensible "true" values, an X design, and a noise level as editable starting points.
 * The engine can fit any model in `_nl_models`; this list spans the families a user is most likely
 * to power-analyse, and every field is editable once a model is picked.
 */
const MC_MODELS: MCModel[] = [
  // Dose-response
  { id: "3pl", label: "Dose-response (3PL, log dose)", params: ["Bottom", "Top", "logEC50"], trueDefaults: [0, 100, 1], x: { start: 0.1, end: 1000, count: 8, log: true }, noise: 5 },
  { id: "4pl", label: "Dose-response (4PL, log dose)", params: ["Bottom", "Top", "logEC50", "Hill slope"], trueDefaults: [0, 100, 1, 1], x: { start: 0.1, end: 1000, count: 8, log: true }, noise: 5 },
  { id: "5pl", label: "Dose-response (5PL, asymmetric)", params: ["Bottom", "Top", "logEC50", "Hill slope", "Asymmetry"], trueDefaults: [0, 100, 1, 1, 1], x: { start: 0.1, end: 1000, count: 10, log: true }, noise: 4 },
  { id: "dr_4pl_conc", label: "Dose-response (4PL, X = concentration)", params: ["Bottom", "Top", "EC50", "Hill slope"], trueDefaults: [0, 100, 10, 1], x: { start: 1, end: 100, count: 8, log: false }, noise: 5 },
  // Enzyme kinetics
  { id: "mm", label: "Michaelis-Menten", params: ["Vmax", "KM"], trueDefaults: [100, 10], x: { start: 1, end: 100, count: 10, log: false }, noise: 5 },
  { id: "allosteric", label: "Allosteric sigmoidal", params: ["Vmax", "Khalf", "h"], trueDefaults: [100, 10, 2], x: { start: 1, end: 100, count: 10, log: false }, noise: 5 },
  { id: "substrate_inhibition", label: "Substrate inhibition", params: ["Vmax", "KM", "Ki"], trueDefaults: [100, 10, 60], x: { start: 1, end: 200, count: 12, log: false }, noise: 5 },
  // Binding
  { id: "onesite", label: "One-site binding", params: ["Bmax", "Kd"], trueDefaults: [100, 10], x: { start: 1, end: 100, count: 10, log: false }, noise: 5 },
  { id: "hill_binding", label: "Specific binding (Hill slope)", params: ["Bmax", "Kd", "h"], trueDefaults: [100, 10, 1.5], x: { start: 1, end: 100, count: 10, log: false }, noise: 5 },
  { id: "twosite", label: "Two-site binding", params: ["Bmax1", "Kd1", "Bmax2", "Kd2"], trueDefaults: [60, 2, 60, 50], x: { start: 0.5, end: 200, count: 14, log: true }, noise: 3 },
  // Exponential
  { id: "exp_decay", label: "One-phase decay", params: ["Y0", "Plateau", "K"], trueDefaults: [100, 10, 0.3], x: { start: 0, end: 20, count: 10, log: false }, noise: 5 },
  { id: "exp_assoc", label: "One-phase association", params: ["Y0", "Plateau", "K"], trueDefaults: [0, 100, 0.3], x: { start: 0, end: 20, count: 10, log: false }, noise: 5 },
  { id: "exp_growth", label: "Exponential growth", params: ["Y0", "K"], trueDefaults: [5, 0.2], x: { start: 0, end: 10, count: 10, log: false }, noise: 2 },
  // Growth
  { id: "gompertz", label: "Gompertz growth", params: ["Asymptote", "Displacement", "Rate"], trueDefaults: [100, 3, 0.5], x: { start: 0, end: 20, count: 12, log: false }, noise: 3 },
  { id: "logistic_growth", label: "Logistic growth", params: ["Capacity", "Rate", "Midpoint"], trueDefaults: [100, 1, 10], x: { start: 0, end: 20, count: 12, log: false }, noise: 3 },
  // Sigmoidal
  { id: "boltzmann", label: "Boltzmann sigmoid", params: ["Bottom", "Top", "V50", "Slope"], trueDefaults: [0, 100, 10, 3], x: { start: -10, end: 30, count: 12, log: false }, noise: 3 },
  // Peak
  { id: "gaussian", label: "Gaussian peak", params: ["Amplitude", "Mean", "SD"], trueDefaults: [100, 10, 2], x: { start: 0, end: 20, count: 15, log: false }, noise: 3 },
  { id: "lorentzian", label: "Lorentzian peak", params: ["Amplitude", "Center", "Width"], trueDefaults: [100, 10, 2], x: { start: 0, end: 20, count: 15, log: false }, noise: 3 },
  // Polynomial / Lines
  { id: "poly2", label: "Polynomial (quadratic)", params: ["B0", "B1", "B2"], trueDefaults: [1, 2, 0.5], x: { start: -5, end: 5, count: 11, log: false }, noise: 2 },
  { id: "line_origin", label: "Line through origin", params: ["Slope"], trueDefaults: [2], x: { start: 0, end: 10, count: 10, log: false }, noise: 1 },
];

interface MCResult {
  glance: Record<string, number | string | null>;
  summary: string;
  terms: Array<Record<string, number | string | null>>;
}

const fmt = (v: number | string | null | undefined): string => {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : Number(v.toPrecision(5)).toString();
  return String(v);
};

export function MonteCarloDialog({ onCancel }: { onCancel: () => void }) {
  const [modelId, setModelId] = useState("mm"); // Michaelis-Menten is a familiar default
  const model = MC_MODELS.find((m) => m.id === modelId) ?? MC_MODELS[0]!;
  const [trueParams, setTrueParams] = useState<number[]>(model.trueDefaults); // init from the resolved model, not MC_MODELS[0]
  const [xStart, setXStart] = useState(model.x.start);
  const [xEnd, setXEnd] = useState(model.x.end);
  const [xCount, setXCount] = useState(model.x.count);
  const [xLog, setXLog] = useState(model.x.log);
  const [replicates, setReplicates] = useState(1);
  const [noiseType, setNoiseType] = useState<"sd" | "relative">("sd");
  const [noiseValue, setNoiseValue] = useState(model.noise);
  const [iterations, setIterations] = useState(300);
  const [seed, setSeed] = useState(20240705);

  function pickModel(id: string): void {
    const m = MC_MODELS.find((x) => x.id === id);
    if (!m) return;
    setModelId(id);
    setTrueParams(m.trueDefaults);
    setXStart(m.x.start);
    setXEnd(m.x.end);
    setXCount(m.x.count);
    setXLog(m.x.log);
    setNoiseValue(m.noise);
  }

  const payload = useMemo<Record<string, unknown>>(
    () => ({ model: modelId, trueParams, xStart, xEnd, xCount, xLog, replicates, noise: { type: noiseType, value: noiseValue }, iterations, seed }),
    [modelId, trueParams, xStart, xEnd, xCount, xLog, replicates, noiseType, noiseValue, iterations, seed],
  );

  const [res, setRes] = useState<MCResult | null>(null);
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
        const r = await window.mady.runAnalysis("montecarlo", payload);
        if (!live) return;
        if (r.ok) {
          setRes(r.results as unknown as MCResult);
          setErr(null);
        } else {
          setErr(r.message ?? "Simulation failed.");
        }
      } catch (e) {
        if (live) setErr(String(e));
      } finally {
        if (live) setBusy(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [payload]);

  const numField = (label: string, value: number, set: (v: number) => void, step = "any", width = 74) => (
    <label style={{ fontSize: 11 }}>
      {label}{" "}
      <input aria-label={label} type="number" step={step} value={value} style={{ width }} onChange={(e) => set(Number(e.target.value) || 0)} />
    </label>
  );

  const convRate = res ? Number(res.glance.conv_rate) : null;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Monte-Carlo simulation" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Monte-Carlo simulation</h3>
          <GuideHelp target={{ entry: "action:montecarlo" }} what="Monte-Carlo simulation" />
        </div>

        <div className="importopts">
          <label>
            Model{" "}
            <select aria-label="Model" value={modelId} onChange={(e) => pickModel(e.target.value)}>
              {MC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {model.params.map((pname, i) =>
            numField(`${pname} (true)`, trueParams[i] ?? 0, (v) => setTrueParams((ps) => ps.map((x, j) => (j === i ? v : x))), "any", 70),
          )}
        </div>

        <div className="importopts">
          {numField("X from", xStart, setXStart)}
          {numField("to", xEnd, setXEnd)}
          {numField("points", xCount, (v) => setXCount(Math.max(2, Math.floor(v))), "1", 56)}
          <label className="importchk">
            <input type="checkbox" checked={xLog} onChange={(e) => setXLog(e.target.checked)} /> log-spaced X
          </label>
          {numField("replicates", replicates, (v) => setReplicates(Math.max(1, Math.floor(v))), "1", 48)}
        </div>

        <div className="importopts">
          <label>
            Scatter{" "}
            <select aria-label="Scatter" value={noiseType} onChange={(e) => setNoiseType(e.target.value as "sd" | "relative")}>
              <option value="sd">Gaussian, SD =</option>
              <option value="relative">Gaussian, % of Y =</option>
            </select>
          </label>
          {numField("", noiseValue, (v) => setNoiseValue(Math.max(0, v)), "any", 68)}
          {numField("iterations", iterations, (v) => setIterations(Math.max(10, Math.floor(v))), "1", 68)}
          {numField("seed", seed, (v) => setSeed(Math.trunc(v)), "1", 100)}
        </div>

        {err ? (
          <p className="note" style={{ color: "var(--danger, #c0392b)" }}>
            {err}
          </p>
        ) : (
          <>
            <div style={{ margin: "8px 0", fontSize: 12 }} aria-label="Monte-Carlo summary">
              {busy && !res ? "Simulating…" : res ? res.summary : "…"}
            </div>
            {res && res.terms.length > 0 && (
              <div className="importpreview">
                <table>
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>True</th>
                      <th>Mean fit</th>
                      <th>Bias</th>
                      <th>SD</th>
                      <th>CV %</th>
                      <th>95% CI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.terms.map((t, i) => (
                      <tr key={i}>
                        <td>{fmt(t.term)}</td>
                        <td>{fmt(t.true)}</td>
                        <td>{fmt(t.estimate)}</td>
                        <td>{fmt(t.bias)}</td>
                        <td>{fmt(t.sd)}</td>
                        <td>{fmt(t.cv)}</td>
                        <td>{t.ciLow != null ? `${fmt(t.ciLow)} … ${fmt(t.ciHigh)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {convRate != null && (
              <p className="note" style={{ fontSize: 11 }}>
                {res!.glance.converged as number} of {res!.glance.iterations as number} fits converged ({fmt(convRate)}%). The SD +
                95% CI of each parameter are its uncertainty for this design + noise — widen the design or lower the noise to sharpen them.
              </p>
            )}
          </>
        )}

        <div className="modalbtns">
          <button className="btn" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
