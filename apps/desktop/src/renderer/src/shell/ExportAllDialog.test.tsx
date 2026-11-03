// @vitest-environment jsdom
// File ▸ Export all graphs & figures…: the dialog's choices reach the run, and every unwritten file is shown.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ExportAllDialog, type ExportAllOptions } from "./ExportAllDialog";
import type { BatchResult } from "./batchExport";

afterEach(cleanup);

const graphs = [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }];
const figures = [{ id: "f", name: "Figure 1" }];
const mount = (onRun = vi.fn(async (_o: ExportAllOptions, _p: (done: number, total: number) => void): Promise<BatchResult> => ({ written: ["Alpha.png"], failed: [] }))) => {
  const r = render(<ExportAllDialog graphs={graphs} figures={figures} onRun={onRun} onClose={() => {}} />);
  const runBtn = () => [...r.container.querySelectorAll("button")].find((b) => /^Export \d+ file/.test(b.textContent ?? ""))!;
  const box = (label: RegExp) => [...r.container.querySelectorAll("label")].find((l) => label.test(l.textContent ?? ""))!.querySelector("input")!;
  return { ...r, onRun, runBtn, box };
};

describe("ExportAllDialog", () => {
  it("shows the counts and how many files a run makes", () => {
    const { container, runBtn } = mount();
    expect(container.textContent).toMatch(/Graphs \(2\)/);
    expect(container.textContent).toMatch(/Figures \(1\)/);
    expect(runBtn().textContent).toMatch(/Export 3 files/);
  });
  it("nothing ticked → the run is disabled", () => {
    const { runBtn, box } = mount();
    fireEvent.click(box(/Graphs/));
    fireEvent.click(box(/Figures/));
    expect(runBtn().disabled).toBe(true);
  });
  it("previews the first file names from the pattern", () => {
    const { container } = mount();
    fireEvent.change(container.querySelector('input[aria-label="File name pattern"]')!, { target: { value: "{n}-{name}" } });
    expect(container.querySelector("[data-name-preview]")!.textContent).toBe("1-Alpha.png, 2-Beta.png, 3-Figure_1.png");
  });
  it("Transparent is offered only for formats that can hold it", () => {
    const { container, box } = mount();
    expect(box(/Transparent/).disabled).toBe(false); // PNG
    fireEvent.change(container.querySelector('select[aria-label="Format"]')!, { target: { value: "jpg" } });
    expect(box(/Transparent/).disabled).toBe(true);
  });
  it("the choices reach the run, and every file that was not written is listed", async () => {
    const onRun = vi.fn(async (_o: ExportAllOptions, _p: (done: number, total: number) => void): Promise<BatchResult> => ({ written: ["Alpha.svg"], failed: [{ name: "Beta.svg", error: "already exists" }] }));
    const { container, runBtn, box } = mount(onRun);
    fireEvent.change(container.querySelector('select[aria-label="Format"]')!, { target: { value: "svg" } });
    fireEvent.click(box(/Replace files/));
    fireEvent.click(runBtn());
    await waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(onRun.mock.calls[0]![0]).toMatchObject({ graphs: true, figures: true, format: "svg", replace: true, pattern: "{name}" });
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/1 of 2 files was not written:\s*Beta\.svg — already exists/);
  });
  it("all written → says so", async () => {
    const { container, runBtn } = mount();
    fireEvent.click(runBtn());
    await waitFor(() => expect(container.querySelector('[role="status"]')?.textContent).toBe("The file was written."));
  });
});
