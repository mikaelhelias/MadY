// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CellPatternMenu } from "./CellPatternMenu";
import { CURATED_CELL_PATTERNS } from "./cellPatterns";

afterEach(cleanup);

const open = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('button[aria-label="Cell pattern"]') as HTMLButtonElement);
};

describe("CellPatternMenu (datasheet pattern palette)", () => {
  it("is disabled with no selection and opens no panel", () => {
    const { container } = render(<CellPatternMenu disabled onPick={vi.fn()} />);
    const btn = container.querySelector('button[aria-label="Cell pattern"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(container.querySelector(".cellpattern-panel")).toBeNull();
  });

  it("offers one swatch per curated pattern; clicking one applies {kind,color} and closes", () => {
    const onPick = vi.fn();
    const { container } = render(<CellPatternMenu disabled={false} onPick={onPick} />);
    open(container);
    const swatches = container.querySelectorAll(".cellpattern-swatch");
    expect(swatches.length).toBe(CURATED_CELL_PATTERNS.length);
    fireEvent.click(swatches[0]!);
    expect(onPick).toHaveBeenCalledWith({ kind: CURATED_CELL_PATTERNS[0], color: "#555555" });
    expect(container.querySelector(".cellpattern-panel"), "panel closes after a pick").toBeNull();
  });

  it("the colour picker changes the pattern's foreground colour", () => {
    const onPick = vi.fn();
    const { container } = render(<CellPatternMenu disabled={false} onPick={onPick} />);
    open(container);
    const color = container.querySelector('input[aria-label="Pattern colour"]') as HTMLInputElement;
    expect(color).toBeTruthy();
    fireEvent.change(color, { target: { value: "#cc0000" } });
    // the panel stays open after a colour change; pick a pattern in the new colour
    fireEvent.click(container.querySelectorAll(".cellpattern-swatch")[1]!);
    expect(onPick).toHaveBeenCalledWith({ kind: CURATED_CELL_PATTERNS[1], color: "#cc0000" });
  });

  it("'No pattern' clears (onPick null)", () => {
    const onPick = vi.fn();
    const { container } = render(<CellPatternMenu disabled={false} onPick={onPick} />);
    open(container);
    fireEvent.click(container.querySelector(".cellpattern-none") as HTMLButtonElement);
    expect(onPick).toHaveBeenCalledWith(null);
  });
});
