// @vitest-environment jsdom
/**
 * The Melting temperature card: every control reaches the
 * spec AND the engine payload, one sample is enough to run, and an empty window refuses out loud.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { buildAnalysisData } from "@mady/core";
import { AnalyzeDialog } from "./AnalyzeDialog";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const table = {
  id: "t", kind: "xy", name: "Melt",
  columns: [
    { id: "x", name: "Temperature (°C)", role: "x" },
    { id: "a", name: "Apo", role: "y" },
    { id: "b", name: "Ligand", role: "y" },
  ],
  rows: [40, 50, 60, 70].map((x, i) => ({ id: `r${i}`, cells: { x, a: i, b: i + 1 } })),
} as unknown as DataTable;

const byAria = <T extends HTMLElement>(c: HTMLElement, aria: string): T => {
  const el = c.querySelector<T>(`[aria-label="${aria}"]`);
  if (!el) throw new Error(`no control labelled "${aria}"`);
  return el;
};
const sampleBox = (c: HTMLElement, name: string) =>
  [...c.querySelectorAll("label.angroup")].find((l) => (l.textContent ?? "").trim() === name)!.querySelector("input") as HTMLInputElement;
const runBtn = (c: HTMLElement) => c.querySelector(".btn") as HTMLButtonElement;

describe("Analyze ▸ Melting temperature", () => {
  it("the Common analyses door opens straight on its settings, with its own title and banner", () => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="meltingtemp" focusKind="melting-temperature" />);
    const c = u.container;
    expect(c.textContent).toContain("Melting temperature — Tm and ΔTm");
    expect(c.textContent).toContain("control sample");
    expect(c.querySelector('[aria-label="Sloped baselines"]'), "the Tm settings are not open").not.toBeNull();
  });

  it("every setting reaches the spec and the engine payload", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="meltingtemp" />);
    const c = u.container;
    for (const name of ["Apo", "Ligand"]) if (!sampleBox(c, name).checked) fireEvent.click(sampleBox(c, name));
    fireEvent.click(byAria(c, "Sloped baselines"));
    fireEvent.change(byAria(c, "Temperature from"), { target: { value: "42" } });
    fireEvent.change(byAria(c, "Temperature to"), { target: { value: "68" } });
    fireEvent.change(byAria(c, "Derivative smoothing window"), { target: { value: "7" } });
    fireEvent.change(byAria<HTMLSelectElement>(c, "Control sample"), { target: { value: "a" } });
    fireEvent.click(runBtn(c));
    const spec = onRun.mock.calls.at(-1)![0];
    expect(spec).toMatchObject({ method: "meltingtemp", sloped: true, rangeFrom: 42, rangeTo: 68, smoothWindow: 7 });
    expect(spec.columns[spec.control]).toBe("a");
    expect(buildAnalysisData("meltingtemp", spec, table)).toMatchObject({ sloped: true, from: 42, to: 68, smoothWindow: 7, control: "Apo", unit: "°C" });
  });

  it("runs on ONE sample, and 'None' sends no control", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="meltingtemp" />);
    const c = u.container;
    if (sampleBox(c, "Ligand").checked) fireEvent.click(sampleBox(c, "Ligand"));
    if (!sampleBox(c, "Apo").checked) fireEvent.click(sampleBox(c, "Apo"));
    expect(runBtn(c).disabled).toBe(false);
    fireEvent.click(runBtn(c));
    const spec = onRun.mock.calls.at(-1)![0];
    expect(spec.columns).toEqual(["a"]);
    expect(spec).not.toHaveProperty("control");
    expect(spec).not.toHaveProperty("sloped");
  });

  it("an empty temperature window disables Run and says why; no sample says so too", () => {
    const u = render(<AnalyzeDialog table={table} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="meltingtemp" />);
    const c = u.container;
    if (!sampleBox(c, "Apo").checked) fireEvent.click(sampleBox(c, "Apo"));
    fireEvent.change(byAria(c, "Temperature from"), { target: { value: "70" } });
    fireEvent.change(byAria(c, "Temperature to"), { target: { value: "40" } });
    expect(runBtn(c).disabled).toBe(true);
    expect(c.textContent).toContain("The temperature window is empty");
    fireEvent.change(byAria(c, "Temperature to"), { target: { value: "" } });
    expect(runBtn(c).disabled).toBe(false);
    for (const name of ["Apo", "Ligand"]) if (sampleBox(c, name).checked) fireEvent.click(sampleBox(c, name));
    expect(runBtn(c).disabled).toBe(true);
    expect(c.textContent).toContain("Pick at least one sample.");
  });
});

/**
 * Every sample starts ticked: each sample gets its own Tm, so the two-group tests' "first two"
 * default would leave the third and later samples out of a run made without looking. The two-sample
 * fixture above cannot show that, hence three samples here.
 */
describe("Analyze ▸ Melting temperature — every sample starts ticked", () => {
  const three = {
    ...table,
    columns: [...table.columns, { id: "c", name: "Ligand B", role: "y" }],
    rows: [40, 50, 60, 70].map((x, i) => ({ id: `r${i}`, cells: { x, a: i, b: i + 1, c: i + 2 } })),
  } as unknown as DataTable;
  const ticked = (c: HTMLElement) => ["Apo", "Ligand", "Ligand B"].filter((n) => sampleBox(c, n).checked);

  it("opened on Melting temperature: all three samples are ticked and all three are sent", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={three} onRun={onRun} onCancel={vi.fn()} initialMethod="meltingtemp" focusKind="melting-temperature" />);
    const c = u.container;
    expect(ticked(c)).toEqual(["Apo", "Ligand", "Ligand B"]);
    fireEvent.click(runBtn(c));
    expect(onRun.mock.calls.at(-1)![0].columns).toEqual(["a", "b", "c"]);
  });

  it("switched to Melting temperature inside the dialog: all three samples are ticked", () => {
    const u = render(<AnalyzeDialog table={three} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="curvefit" />);
    const c = u.container;
    fireEvent.change(byAria<HTMLSelectElement>(c, "Test"), { target: { value: "meltingtemp" } });
    expect(ticked(c)).toEqual(["Apo", "Ligand", "Ligand B"]);
  });

  it("chosen from the 'what you want to do' tiles: all three samples are ticked", () => {
    const u = render(<AnalyzeDialog table={three} onRun={vi.fn()} onCancel={vi.fn()} />);
    const c = u.container;
    const tile = [...c.querySelectorAll(".an-goals .an-card")].find((t) => (t.textContent ?? "").includes("Melting temperature"));
    expect(tile, "no Melting temperature tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(ticked(c)).toEqual(["Apo", "Ligand", "Ligand B"]);
  });
});
