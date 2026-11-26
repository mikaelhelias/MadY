// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DataIcon } from "./dataIcons";
import { SchemaForm } from "./SchemaForm";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("renders the multivariable icon without missing React keys", () => {
  const error = vi.spyOn(console, "error");
  const { container } = render(<DataIcon kind="multivariable" />);
  expect(container.querySelectorAll("circle")).toHaveLength(9);
  expect(error).not.toHaveBeenCalled();
});
it("renders repeated schema group names with distinct keys", () => {
  const error = vi.spyOn(console, "error");
  const { container } = render(<SchemaForm fields={[
    { group: "Whiskers", key: "width", label: "Width", kind: "number", default: 1 },
    { group: "Other", key: "size", label: "Size", kind: "number", default: 1 },
    { group: "Whiskers", key: "length", label: "Length", kind: "number", default: 1 },
  ]} value={{}} onChange={() => {}} />);
  expect(container.querySelectorAll(".inspgroup")).toHaveLength(3);
  expect(error).not.toHaveBeenCalled();
});
