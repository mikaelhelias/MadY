import { useMemo, useState } from "react";
import { simulate, GENERATORS, compileFormula } from "@mady/core";
import type { SimulateSpec, SimXYSpec, SimColumnSpec, SimGroup, SimDist, CellValue } from "@mady/core";
import { GuideHelp } from "./guideLink";

/** What the dialog returns on confirm — a ready-to-`simulateTable` payload. */
export interface SimulateResult {
  name: string;
  spec: SimulateSpec;
}

const PREVIEW_ROWS = 8;
const DISTS: SimDist[] = ["gaussian", "lognormal", "uniform", "poisson", "exponential"];

/** Sensible default parameter values per generator so the first preview looks right. */
const PARAM_DEFAULTS: Record<string, number[]> = {
  line: [2, 5],
  poly2: [1, 2, -0.3],
  exp_decay: [100, 10, 0.5],
  exp_growth: [5, 0.3],
  assoc: [0, 100, 0.4],
  mm: [100, 10],
  onesite: [100, 10],
  dr4pl: [0, 100, 1, 1],
  gaussian: [100, 5, 1.5],
};

function fmt(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  return String(v);
}

/**
 * SimulateDialog — "Simulate data": generate a new dataset from a
 * seeded RNG, either a grouped **column** sample from a distribution or an **XY**
 * dataset from a built-in equation with random scatter. Everything is driven by an
 * integer seed, so the simulation is exactly reproducible. The maths is the pure
 * `@mady/core` `simulate`; this is the parameter picker + live preview.
 */
export function SimulateDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (result: SimulateResult) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<"xy" | "column">("column");
  const [seed, setSeed] = useState(1);

  // Column state
  const [groups, setGroups] = useState<SimGroup[]>([
    { label: "Control", n: 10, mean: 100, sd: 15, dist: "gaussian" },
    { label: "Treated", n: 10, mean: 115, sd: 15, dist: "gaussian" },
  ]);

  // XY state
  const [equation, setEquation] = useState("dr4pl");
  const [params, setParams] = useState<number[]>(PARAM_DEFAULTS.dr4pl ?? [0, 100, 1, 1]);
  const [customEquation, setCustomEquation] = useState("2*X^2 + 10");
  const [xStart, setXStart] = useState(0.1);
  const [xEnd, setXEnd] = useState(1000);
  const [xCount, setXCount] = useState(12);
  const [xLog, setXLog] = useState(true);
  const [replicates, setReplicates] = useState(1);
  const [noiseType, setNoiseType] = useState<"none" | "sd" | "relative">("sd");
  const [noiseValue, setNoiseValue] = useState(5);

  const genKeys = Object.keys(GENERATORS);
  const gen = GENERATORS[equation];
  const isCustom = equation === "custom";
  // Live-validate the typed equation (reuses the formula.ts parser).
  const customError = useMemo(() => {
    if (!isCustom || !customEquation.trim()) return null;
    const c = compileFormula(customEquation);
    return c.ok ? null : c.error;
  }, [isCustom, customEquation]);

  function pickEquation(id: string): void {
    setEquation(id);
    setParams(PARAM_DEFAULTS[id] ?? (GENERATORS[id]?.params.map(() => 1) ?? []));
  }

  const spec = useMemo<SimulateSpec>(() => {
    if (kind === "column") {
      return { kind: "column", seed, groups } satisfies SimColumnSpec;
    }
    return {
      kind: "xy",
      seed,
      xStart,
      xEnd,
      xCount,
      xLog,
      equation,
      params,
      ...(isCustom ? { customEquation } : {}),
      replicates,
      noise: { type: noiseType, value: noiseValue },
    } satisfies SimXYSpec;
  }, [kind, seed, groups, equation, params, xStart, xEnd, xCount, xLog, replicates, noiseType, noiseValue, isCustom, customEquation]);

  const result = useMemo<{ columnNames: string[]; rows: CellValue[][] }>(() => simulate(spec), [spec]);
  const name = kind === "column" ? "Simulated columns" : `Simulated XY — ${isCustom ? "custom f(X)" : gen?.label ?? equation}`;
  const preview = result.rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-wide" role="dialog" aria-label="Simulate data" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Simulate data (seeded)</h3>
          <GuideHelp target={{ entry: "action:simulate" }} what="Simulate data" />
        </div>

        <div className="importopts">
          <label>
            Kind{" "}
            <select aria-label="Simulation kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="column">Column — grouped samples</option>
              <option value="xy">XY — equation + scatter</option>
            </select>
          </label>
          <label>
            Seed{" "}
            <input aria-label="Seed" type="number" value={seed} min={0} style={{ width: 80 }} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
          </label>
          <button className="btn-ghost" title="New random seed" onClick={() => setSeed(Math.floor(Math.random() * 1e9))}>🎲 New seed</button>
        </div>

        {kind === "column" && (
          <div className="importopts" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            {groups.map((g, i) => (
              <div key={i} className="importopts" style={{ gap: 6 }}>
                <input aria-label={`Group ${i + 1} label`} style={{ width: 92 }} value={g.label} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <label style={{ fontSize: 11 }}>n <input aria-label={`Group ${i + 1} n`} type="number" min={1} style={{ width: 56 }} value={g.n} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, n: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))} /></label>
                <label style={{ fontSize: 11 }}>mean <input aria-label={`Group ${i + 1} mean`} type="number" step="any" style={{ width: 64 }} value={g.mean} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, mean: Number(e.target.value) || 0 } : x)))} /></label>
                <label style={{ fontSize: 11 }}>SD <input aria-label={`Group ${i + 1} SD`} type="number" step="any" min={0} style={{ width: 56 }} value={g.sd} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, sd: Math.max(0, Number(e.target.value) || 0) } : x)))} /></label>
                <select aria-label={`Group ${i + 1} distribution`} value={g.dist ?? "gaussian"} onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, dist: e.target.value as SimDist } : x)))}>
                  {DISTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                {groups.length > 1 && <button className="btn-ghost" aria-label={`Remove group ${i + 1}`} onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}>✕</button>}
              </div>
            ))}
            <div>
              <button className="btn-ghost" onClick={() => setGroups((gs) => [...gs, { label: `Group ${String.fromCharCode(65 + gs.length)}`, n: 10, mean: 100, sd: 15, dist: "gaussian" }])}>+ Add group</button>
            </div>
          </div>
        )}

        {kind === "xy" && (
          <>
            <div className="importopts">
              <label>
                Equation{" "}
                <select aria-label="Equation" value={equation} onChange={(e) => pickEquation(e.target.value)}>
                  {genKeys.map((k) => <option key={k} value={k}>{GENERATORS[k]!.label}</option>)}
                  <option value="custom">Custom equation f(X)…</option>
                </select>
              </label>
              {isCustom ? (
                <label style={{ flex: 1, minWidth: 220 }}>
                  Y ={" "}
                  <input
                    aria-label="Custom equation"
                    type="text"
                    value={customEquation}
                    onChange={(e) => setCustomEquation(e.target.value)}
                    placeholder="e.g. 3*SIN(X) + 0.5*X"
                    style={{ width: "70%", fontFamily: "monospace" }}
                  />
                </label>
              ) : (
                (gen?.params ?? []).map((pname, i) => (
                  <label key={pname} style={{ fontSize: 11 }}>
                    {pname}{" "}
                    <input aria-label={pname} type="number" step="any" style={{ width: 68 }} value={params[i] ?? 0} onChange={(e) => setParams((ps) => ps.map((v, j) => (j === i ? Number(e.target.value) || 0 : v)))} />
                  </label>
                ))
              )}
            </div>
            {isCustom && (
              <p className="note" style={{ fontSize: 11, margin: "0 0 6px", color: customError ? "var(--danger, #d33)" : undefined }}>
                {customError ? `⚠ ${customError}` : "Use X as the variable; functions ABS/SQRT/EXP/LN/LOG/SIN/COS/TAN/… are available."}
              </p>
            )}
            <div className="importopts">
              <label style={{ fontSize: 11 }}>X from <input aria-label="X start" type="number" step="any" style={{ width: 68 }} value={xStart} onChange={(e) => setXStart(Number(e.target.value) || 0)} /></label>
              <label style={{ fontSize: 11 }}>to <input aria-label="X end" type="number" step="any" style={{ width: 68 }} value={xEnd} onChange={(e) => setXEnd(Number(e.target.value) || 0)} /></label>
              <label style={{ fontSize: 11 }}>points <input aria-label="X count" type="number" min={2} style={{ width: 56 }} value={xCount} onChange={(e) => setXCount(Math.max(2, Math.floor(Number(e.target.value) || 2)))} /></label>
              <label className="importchk"><input type="checkbox" checked={xLog} onChange={(e) => setXLog(e.target.checked)} /> log-spaced X</label>
              <label style={{ fontSize: 11 }}>replicates <input aria-label="Replicates" type="number" min={1} style={{ width: 48 }} value={replicates} onChange={(e) => setReplicates(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /></label>
            </div>
            <div className="importopts">
              <label>
                Scatter{" "}
                <select aria-label="Scatter" value={noiseType} onChange={(e) => setNoiseType(e.target.value as typeof noiseType)}>
                  <option value="none">None</option>
                  <option value="sd">Gaussian, SD =</option>
                  <option value="relative">Gaussian, % of Y =</option>
                </select>
              </label>
              {noiseType !== "none" && <input aria-label="Scatter value" type="number" step="any" min={0} style={{ width: 68 }} value={noiseValue} onChange={(e) => setNoiseValue(Math.max(0, Number(e.target.value) || 0))} />}
            </div>
          </>
        )}

        <div className="importpreview">
          <table>
            <thead>
              <tr>{result.columnNames.map((nm, i) => <th key={i}>{nm}</th>)}</tr>
            </thead>
            <tbody>
              {preview.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{fmt(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          {result.rows.length} row{result.rows.length === 1 ? "" : "s"} × {result.columnNames.length} column
          {result.columnNames.length === 1 ? "" : "s"}
          {result.rows.length > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ""} · reproducible from seed {seed}.
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={() => onConfirm({ name, spec })}>Create dataset</button>
        </div>
      </div>
    </div>
  );
}
