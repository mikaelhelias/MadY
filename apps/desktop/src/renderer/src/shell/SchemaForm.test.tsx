// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SchemaForm, resolveField } from "./SchemaForm";
import type { Field } from "./SchemaForm";

afterEach(() => {
  cleanup();
  localStorage.clear(); // collapse state persists in localStorage — reset between tests
});

const fields: Field[] = [
  { group: "G", key: "shape", label: "Shape", kind: "select", default: "a", options: [["a", "A"], ["b", "B"]] },
  { group: "G", key: "size", label: "Size", kind: "number", default: 4, min: 1, max: 10, step: 1 },
  { group: "G", key: "on", label: "On", kind: "checkbox", default: false },
  { key: "extra", label: "Extra", kind: "number", default: 0, show: (v) => v.on === true },
  { key: "color", label: "Swatch", kind: "swatches", default: "#000000", swatches: ["#ff0000", "#00ff00"] },
];

function renderForm(value: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  const utils = render(<SchemaForm fields={fields} value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

describe("SchemaForm", () => {
  it("renders a control per field and a collapsible group header", () => {
    const f = renderForm();
    const header = f.container.querySelector(".inspsub-toggle");
    expect(header?.textContent).toContain("G"); // group name (plus the chevron glyph)
    expect(header?.getAttribute("aria-expanded")).toBe("true"); // expanded by default
    expect(f.container.querySelector("select.selin")).toBeTruthy();
    expect(f.container.querySelectorAll(".swbtn")).toHaveLength(2);
  });

  it("collapses a group on header click, hiding its controls", () => {
    const f = renderForm();
    const header = f.container.querySelector(".inspsub-toggle") as HTMLButtonElement;
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(f.container.querySelector("select.selin")).toBeNull(); // group's controls hidden
  });

  it("emits a single-key delta on select change", () => {
    const f = renderForm();
    fireEvent.change(f.container.querySelector("select.selin") as HTMLSelectElement, { target: { value: "b" } });
    expect(f.onChange).toHaveBeenCalledWith({ shape: "b" });
  });

  it("clamps a number input to its max", () => {
    const f = renderForm();
    fireEvent.change(f.container.querySelector("input.numin") as HTMLInputElement, { target: { value: "99" } });
    expect(f.onChange).toHaveBeenCalledWith({ size: 10 });
  });

  it("toggles a checkbox", () => {
    const f = renderForm();
    fireEvent.click(f.container.querySelector('input[type="checkbox"]') as HTMLInputElement);
    expect(f.onChange).toHaveBeenCalledWith({ on: true });
  });

  it("hides a field whose show() predicate is false, shows it when true", () => {
    expect(renderForm({}).container.querySelectorAll("input.numin")).toHaveLength(1); // 'extra' hidden (on=false)
    expect(renderForm({ on: true }).container.querySelectorAll("input.numin")).toHaveLength(2); // now shown
  });

  it("picks a swatch", () => {
    const f = renderForm();
    fireEvent.click(f.container.querySelector('.swbtn[title="#ff0000"]') as HTMLElement);
    expect(f.onChange).toHaveBeenCalledWith({ color: "#ff0000" });
  });

  it("an unlistedAsDefault select shows its default for a stored value it does not list", () => {
    const theme: Field = { key: "theme", label: "Theme", kind: "select", default: "a", options: [["a", "A"], ["b", "B"]], unlistedAsDefault: true };
    expect(resolveField(theme, "b")).toBe("b");
    expect(resolveField(theme, undefined)).toBe("a");
    expect(resolveField(theme, "retired")).toBe("a");
    const { container } = render(<SchemaForm fields={[theme]} value={{ theme: "retired" }} onChange={() => {}} />);
    expect((container.querySelector("select.selin") as HTMLSelectElement).value).toBe("a");
  });

  it("a plain select keeps a stored value it does not list", () => {
    // Only fields that opt in are remapped: a select whose builder does something else with an
    // unlisted value must not claim the default is drawn.
    expect(resolveField(fields[0]!, "retired")).toBe("retired");
  });
});
