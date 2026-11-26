/**
 * What a melting-temperature analysis puts on the graph:
 * each sample's fitted melt curve with a crosshair at its Tm labelled in X's unit; a single sample also
 * gets the line-by-line results block (keys without the "— sample" suffix), several do not.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { applyAnalysisFit } from "./analysisFits";
import { meltMarker } from "./analysisExport";
import { buildPlotScene } from "@mady/graphics";

const sig = (tm: number) => Array.from({ length: 41 }, (_, i) => 30 + i).map((x) => 100 + 800 / (1 + Math.exp((tm - x) / 2.5)));
const xs = Array.from({ length: 41 }, (_, i) => 30 + i);

describe("meltMarker", () => {
  it("sits at Tm, on the curve, labelled with the unit", () => {
    const m = meltMarker({ x: xs, y: sig(52) }, 52, "°C")!;
    expect(m.x).toBe(52);
    expect(m.y).toBeCloseTo(500, 6);
    expect(m.label).toBe("Tm = 52.0 °C"); // one decimal, always
    expect(m.dropOnly).toBe(true);
    expect(meltMarker({ x: xs, y: sig(52) }, 52.06, "")!.label).toBe("Tm = 52.1");
  });
  it("is null with no Tm or a Tm off the curve", () => {
    expect(meltMarker({ x: xs, y: sig(52) }, undefined, "°C")).toBeNull();
    expect(meltMarker({ x: xs, y: sig(52) }, 90, "°C")).toBeNull();
  });
});

function setup(labels: string[]) {
  const doc = new MadyDocument();
  const t = doc.importTable("Melt", "xy", ["Temperature (°C)", ...labels], xs.map((x, i) => [x, ...labels.map((_, k) => sig(52 + 4 * k)[i]!)]));
  const p = doc.addPlot("Melt", t.id);
  const a = doc.addAnalysis("Tm", "meltingtemp", t.id, { columns: t.columns.slice(1).map((c) => c.id) });
  return { doc, t, p, a };
}

describe("applyAnalysisFit — meltingtemp", () => {
  it("one sample: a single fit with its Tm crosshair and a results block keyed by statistic", () => {
    const { doc, p, a } = setup(["Apo"]);
    doc.setAnalysisResult(a.id, {
      method: "meltingtemp", title: "Tm", summary: "", glance: {},
      terms: [
        { term: "Tm (fit) — Apo", estimate: 52, se: 0.1, ciLow: 51.8, ciHigh: 52.2 },
        { term: "Tm (derivative) — Apo", estimate: 52.1 },
      ],
      extra: { unit: "°C", curves: [{ label: "Apo", x: xs, y: sig(52), tm: 52 }] },
    } as never);
    expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
    expect(p.fits).toBeUndefined();
    expect(p.fit?.marker?.label).toBe("Tm = 52.0 °C");
    expect(p.fit?.paramKeys).toEqual(["Tm (fit)", "Tm (derivative)"]);
    expect(p.fit?.params?.[0]).toBe("Tm (fit) = 52 ± 0.1");
    // …and it reaches the drawing: crosshair label and both lines.
    const scene = buildPlotScene(doc.toJSON().tables[0]!, doc.toJSON().plots[0]!, { width: 600, height: 400 });
    expect(scene.fit?.marker?.label).toBe("Tm = 52.0 °C");
    // Drop-line only: no line from the Y axis (with several Tm markers, lines from the axis would merge into one
    // shared dashed line at half-height).
    expect(scene.fit?.marker?.leftX).toBe(scene.fit?.marker?.vx);
    expect(scene.fit?.params?.items?.map((i) => i.key)).toEqual(["Tm (fit)", "Tm (derivative)"]);
  });

  it("several samples: one curve each, in its series colour, each with its own Tm crosshair, no block", () => {
    const { doc, p, a, t } = setup(["Apo", "Ligand"]);
    doc.setSeriesStyle(p.id, t.columns[2]!.id, { color: "#aa0000" });
    doc.setAnalysisResult(a.id, {
      method: "meltingtemp", title: "Tm", summary: "", glance: {},
      terms: [{ term: "Tm (fit) — Apo", estimate: 52 }, { term: "Tm (fit) — Ligand", estimate: 56 }],
      extra: { unit: "°C", curves: [{ label: "Apo", x: xs, y: sig(52), tm: 52 }, { label: "Ligand", x: xs, y: sig(56), tm: 56 }] },
    } as never);
    expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
    expect(p.fit).toBeUndefined();
    expect(p.fits?.map((f) => f.marker?.label)).toEqual(["Tm = 52.0 °C", "Tm = 56.0 °C"]);
    expect(p.fits?.[1]?.color).toBe("#aa0000");
    expect(p.fits?.every((f) => !f.params)).toBe(true);
  });
});
