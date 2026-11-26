// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CellFillMenu, CELL_FILL_PRESETS } from "./CellFillMenu";

afterEach(cleanup);

const open = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('button[aria-label="Fill colour"]') as HTMLButtonElement);
};

describe("CellFillMenu (datasheet fill palette)", () => {
  it("is disabled with no selection and opens no panel", () => {
    const { container } = render(<CellFillMenu disabled onPick={vi.fn()} />);
    const btn = container.querySelector('button[aria-label="Fill colour"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(container.querySelector(".cellfill-panel")).toBeNull();
  });

  it("offers a grid of preset swatches; clicking one applies that colour and closes", () => {
    const onPick = vi.fn();
    const { container } = render(<CellFillMenu disabled={false} onPick={onPick} />);
    open(container);
    const swatches = container.querySelectorAll(".cellfill-swatch");
    expect(swatches.length).toBe(CELL_FILL_PRESETS.length); // presets, not one precise picker
    fireEvent.click(swatches[0]!);
    expect(onPick).toHaveBeenCalledWith(CELL_FILL_PRESETS[0]);
    expect(container.querySelector(".cellfill-panel"), "panel stays open after a pick").toBeNull();
  });

  it("'No fill' clears (onPick null)", () => {
    const onPick = vi.fn();
    const { container } = render(<CellFillMenu disabled={false} onPick={onPick} />);
    open(container);
    fireEvent.click(container.querySelector(".cellfill-none") as HTMLButtonElement);
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("the custom picker allows any colour beyond the swatches", () => {
    const onPick = vi.fn();
    const { container } = render(<CellFillMenu disabled={false} onPick={onPick} />);
    open(container);
    const custom = container.querySelector('input[aria-label="Custom fill colour"]') as HTMLInputElement;
    expect(custom).toBeTruthy();
    fireEvent.change(custom, { target: { value: "#123456" } });
    expect(onPick).toHaveBeenCalledWith("#123456");
  });
});
