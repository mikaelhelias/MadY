// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { MethodSpec } from "@mady/core";
import { MethodsMenu } from "./panes";

afterEach(cleanup);

const METHODS: MethodSpec[] = [
  { id: "m1", name: "Welch t-test", method: "ttest", columns: [0, 1], params: { variant: "welch" } },
  { id: "m2", name: "4PL fit", method: "curvefit", columns: [0, 1], params: { variant: "4pl" } },
];

function setup(methods = METHODS) {
  const onApply = vi.fn(), onDelete = vi.fn(), onExport = vi.fn(), onImport = vi.fn();
  const u = render(<MethodsMenu methods={methods} onApply={onApply} onDelete={onDelete} onExport={onExport} onImport={onImport} />);
  const open = () => fireEvent.click(u.getByLabelText("Saved methods"));
  return { ...u, onApply, onDelete, onExport, onImport, open };
}

describe("MethodsMenu", () => {
  it("the button shows the method count and toggles the dropdown", () => {
    const d = setup();
    expect(d.getByLabelText("Saved methods").textContent).toContain("(2)");
    expect(d.queryByText("Welch t-test")).toBeNull(); // closed initially
    d.open();
    expect(d.getByText("Welch t-test")).toBeTruthy();
    expect(d.getByText("4PL fit")).toBeTruthy();
  });

  it("clicking a method name applies it (and closes the menu)", () => {
    const d = setup();
    d.open();
    fireEvent.click(d.getByText("4PL fit"));
    expect(d.onApply).toHaveBeenCalledWith("m2");
    expect(d.queryByText("Welch t-test")).toBeNull(); // closed after apply
  });

  it("the × deletes and ⤓ exports the right method", () => {
    const d = setup();
    d.open();
    fireEvent.click(d.getByLabelText("Delete method Welch t-test"));
    expect(d.onDelete).toHaveBeenCalledWith("m1");
    fireEvent.click(d.getByLabelText("Export method 4PL fit"));
    expect(d.onExport).toHaveBeenCalledWith("m2");
  });

  it("empty state still offers Import + a hint", () => {
    const d = setup([]);
    expect(d.getByLabelText("Saved methods").textContent).not.toContain("(");
    d.open();
    expect(d.container.textContent).toContain("Save as Method");
    fireEvent.click(d.getByText("Import method…"));
    expect(d.onImport).toHaveBeenCalled();
  });
});
