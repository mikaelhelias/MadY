// @vitest-environment jsdom
/**
 * The gradient editor — build a colour ramp by hand, or generate one and then fix it by hand.
 *
 * What has to be true, and is asserted here:
 *  • a built-in can be opened and edited, and doing so never touches the built-in;
 *  • a stop can be added, moved, recoloured and removed, and the last two cannot be removed;
 *  • a generated hue sweep can be frozen to stops without changing a single colour;
 *  • a pasted list of hex codes becomes the ramp;
 *  • nothing reaches the document until Done — Cancel really does discard;
 *  • Delete is refused, with the reason, while a graph still paints with it;
 *  • the advice warns about a rainbow ramp and says nothing about viridis.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Gradient } from "@mady/core";
import { makeRamp, resolveBuiltinRamp, resolveGradient } from "@mady/graphics";
import { GradientEditor } from "./GradientEditor";
import { gradientToEdit } from "./Inspector";

afterEach(cleanup);

const stopsOf = (g: Gradient): Gradient => g;
const sample = (g: Gradient, t: number): string =>
  makeRamp(resolveGradient(g), "#2266cc", "#1a1a1a", false)(t).color;

const open = (g: Gradient, over: Partial<Parameters<typeof GradientEditor>[0]> = {}) => {
  const h = {
    onDone: vi.fn(), onCancel: vi.fn(), onSaveToLibrary: vi.fn(),
    usedBy: [] as string[], inLibrary: false,
  };
  render(<GradientEditor gradient={g} {...h} {...over} />);
  return h;
};

const mine: Gradient = {
  id: "g1", name: "Mine", mode: "stops",
  stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }],
};

describe("opening a built-in", () => {
  it("hands back a copy with the built-in's real stops — the built-in itself is untouched", () => {
    const g = gradientToEdit("rainbow", [], "new1");
    expect(g.id).toBe("new1");
    expect(g.name).toBe("Rainbow (custom)");
    expect(g.stops.length).toBeGreaterThanOrEqual(7);
    // Its ends are the rainbow's ends, and its middle is the rainbow's middle.
    const builtin = makeRamp(resolveBuiltinRamp("rainbow"), "#2266cc", "#1a1a1a", false);
    expect(g.stops[0]!.color).toBe(builtin(0).color);
    expect(g.stops[g.stops.length - 1]!.color).toBe(builtin(1).color);
    expect(sample(g, 0.5)).toBe(builtin(0.5).color);
  });

  it("an existing custom gradient is opened as itself, not copied", () => {
    expect(gradientToEdit("custom:g1", [mine], "unused")).toBe(mine);
  });
});

describe("editing stops by hand", () => {
  it("a stop can be recoloured, and Done carries it out", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Stop colour"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByText("Done"));
    expect(h.onDone).toHaveBeenCalledTimes(1);
    expect(h.onDone.mock.calls[0]![0].stops[0]).toMatchObject({ color: "#ff0000" });
  });

  it("a stop can be moved by typing its position, and the stops stay sorted", () => {
    const three: Gradient = { ...mine, stops: [
      { pos: 0, color: "#000000" }, { pos: 0.5, color: "#888888" }, { pos: 1, color: "#ffffff" },
    ] };
    const h = open(three);
    // select the middle handle, then send it past the last one
    fireEvent.pointerDown(screen.getByLabelText("Stop 2"));
    fireEvent.change(screen.getByLabelText("Stop position"), { target: { value: "0.9" } });
    fireEvent.click(screen.getByText("Done"));
    const out = h.onDone.mock.calls[0]![0] as Gradient;
    expect(out.stops.map((s) => s.pos)).toEqual([0, 0.9, 1]);
  });

  it("clicking the bar adds a stop, taking the colour already there", () => {
    const h = open(mine);
    const bar = screen.getByLabelText("Gradient bar");
    // jsdom gives every element a zero-size box, so the click lands at position 0 — which is
    // enough to prove a stop was added (the count is the assertion, not the position).
    fireEvent.pointerDown(bar, { clientX: 0 });
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).stops.length).toBe(3);
  });

  it("the last two stops cannot be removed — a gradient needs two ends", () => {
    open(mine);
    const remove = screen.getByLabelText("Delete this stop") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.title).toMatch(/at least two/i);
  });

  it("with three stops, Remove takes one out", () => {
    const three: Gradient = { ...mine, stops: [
      { pos: 0, color: "#000000" }, { pos: 0.5, color: "#888888" }, { pos: 1, color: "#ffffff" },
    ] };
    const h = open(three);
    fireEvent.click(screen.getByLabelText("Delete this stop"));
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).stops.length).toBe(2);
  });
});

describe("the generated hue sweep", () => {
  const sweep: Gradient = {
    id: "s1", name: "Sweep", mode: "sweep", stops: [],
    sweep: { hueFrom: 0, hueTo: 240, sweepStops: 9 },
  };

  it("its parameters are editable and reach the gradient", () => {
    const h = open(sweep);
    fireEvent.change(screen.getByLabelText("Hue direction"), { target: { value: "ccw" } });
    fireEvent.change(screen.getByLabelText("Sweep lightness"), { target: { value: "0.3" } });
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).sweep).toMatchObject({ hueDirection: "ccw", lightness: 0.3 });
  });

  it("'Convert to stops' changes the mode and not a single colour", () => {
    const h = open(sweep);
    fireEvent.click(screen.getByText("Convert to stops"));
    fireEvent.click(screen.getByText("Done"));
    const frozen = h.onDone.mock.calls[0]![0] as Gradient;
    expect(frozen.mode).toBe("stops");
    expect(frozen.stops).toHaveLength(9);
    for (let i = 0; i <= 10; i++) expect(sample(frozen, i / 10)).toBe(sample(sweep, i / 10));
  });

  it("a hand-built gradient shows no sweep parameters, and vice versa", () => {
    open(mine);
    expect(screen.queryByLabelText("Hue from")).toBeNull();
    cleanup();
    open(sweep);
    expect(screen.queryByLabelText("Stop colour")).toBeNull();
    expect(screen.getByLabelText("Hue from")).toBeTruthy();
  });
});

describe("pasting a list of colours", () => {
  it("turns hex codes into evenly spaced stops", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Paste colours"), {
      target: { value: "#ff0000, #00ff00\n#0000ff" },
    });
    fireEvent.click(screen.getByText("Use these"));
    fireEvent.click(screen.getByText("Done"));
    const out = h.onDone.mock.calls[0]![0] as Gradient;
    expect(out.stops).toEqual([
      { pos: 0, color: "#ff0000" }, { pos: 0.5, color: "#00ff00" }, { pos: 1, color: "#0000ff" },
    ]);
  });

  it("refuses a paste with fewer than two colours, and says so", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Paste colours"), { target: { value: "just #ff0000" } });
    fireEvent.click(screen.getByText("Use these"));
    expect(screen.getByText(/at least two colours/i)).toBeTruthy();
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).stops).toEqual(stopsOf(mine).stops);
  });
});

describe("what leaves the dialog", () => {
  it("Cancel discards every edit", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Stop colour"), { target: { value: "#ff0000" } });
    fireEvent.click(screen.getByText("Cancel"));
    expect(h.onCancel).toHaveBeenCalled();
    expect(h.onDone).not.toHaveBeenCalled();
  });

  it("Save to my library sends the current state, not the one it opened with", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Gradient name"), { target: { value: "Lab rainbow" } });
    fireEvent.click(screen.getByText("Save to my library"));
    expect(h.onSaveToLibrary.mock.calls[0]![0].name).toBe("Lab rainbow");
  });

  it("Delete is refused, with the graph names, while a graph still uses it", () => {
    open(mine, { usedBy: ["Fig 3 heatmap", "Fig 4"], onDelete: vi.fn() });
    const del = screen.getByText("Delete") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toMatch(/Fig 3 heatmap, Fig 4/);
  });

  it("…and allowed when nothing uses it", () => {
    const onDelete = vi.fn();
    open(mine, { usedBy: [], onDelete });
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("how it will be read", () => {
  it("shows the ramp as drawn plus three colour-vision previews", () => {
    open(mine);
    for (const l of ["As drawn preview", "Deuteranopia preview", "Protanopia preview", "Greyscale preview"]) {
      expect(screen.getByLabelText(l), `${l} missing`).toBeTruthy();
    }
  });

  it("warns about a rainbow — and never withholds it", () => {
    open(gradientToEdit("rainbow", [], "r1"));
    expect(screen.getByText(/lighter and then darker/i)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy(); // still perfectly usable
  });

  it("says nothing about viridis", () => {
    open(gradientToEdit("viridis", [], "v1"));
    expect(screen.queryByText(/lighter and then darker/i)).toBeNull();
  });
});

describe("class rules and out-of-range colours", () => {
  const stepped: Gradient = { ...mine, steps: 4 };

  it("the class-edge rule is offered only once the ramp has classes", () => {
    open(mine);
    expect(screen.queryByLabelText("How the classes are cut")).toBeNull();
    cleanup();
    open(stepped);
    expect(screen.getByLabelText("How the classes are cut")).toBeTruthy();
  });

  it("choosing equal counts writes stepMode", () => {
    const h = open(stepped);
    fireEvent.change(screen.getByLabelText("How the classes are cut"), { target: { value: "quantile" } });
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).stepMode).toBe("quantile");
  });

  it("'my own values' reveals the cut box, and parses a comma list", () => {
    const h = open({ ...stepped, stepMode: "breaks" });
    const box = screen.getByLabelText("Class break values");
    expect(box.getAttribute("placeholder")).toBe("3 values"); // 4 classes need 3 cuts
    fireEvent.change(box, { target: { value: "10, 20, 30" } });
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).breaks).toEqual([10, 20, 30]);
  });

  it("the cut box is hidden unless the rule asks for it", () => {
    open(stepped);
    expect(screen.queryByLabelText("Class break values")).toBeNull();
  });

  it("under / over colours are set and cleared", () => {
    const h = open(mine);
    fireEvent.change(screen.getByLabelText("Under colour"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByText("Done"));
    expect((h.onDone.mock.calls[0]![0] as Gradient).underColor).toBe("#00ff00");
    cleanup();

    const h2 = open({ ...mine, underColor: "#00ff00", overColor: "#ffff00" });
    fireEvent.click(screen.getByLabelText("Clear the below-scale colour"));
    fireEvent.click(screen.getByText("Done"));
    const out = h2.onDone.mock.calls[0]![0] as Gradient;
    expect(out.underColor, "clearing under must not touch over").toBeUndefined();
    expect(out.overColor).toBe("#ffff00");
  });
});
