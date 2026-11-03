// @vitest-environment jsdom
// The off-screen stage Export all draws on: it draws the graph or figure it is given, hidden but laid out,
// and says when it is ready to read.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ExportStage } from "./ExportStage";
import { proj } from "./layoutPaneFixture";

afterEach(cleanup);

describe("ExportStage", () => {
  it("draws a graph, hidden (not display:none), and hands back the stage once laid out", async () => {
    const onReady = vi.fn();
    const { container } = render(<ExportStage project={proj()} item={{ id: "A", kind: "graph", name: "Alpha" }} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const root = onReady.mock.calls[0]![0] as HTMLElement;
    expect(root.querySelector("svg.gfx-figure")).not.toBeNull();
    expect(root.style.visibility).toBe("hidden");
    expect(root.style.display).not.toBe("none");
    expect(container.contains(root)).toBe(true);
  });
  it("draws a figure through the read-only assembler", async () => {
    const onReady = vi.fn();
    render(<ExportStage project={proj({ panels: ["A", "B"] })} item={{ id: "L", kind: "figure", name: "Figure 1" }} onReady={onReady} />);
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const root = onReady.mock.calls[0]![0] as HTMLElement;
    expect(root.querySelectorAll(".laypanel")).toHaveLength(2);
  });
  it("no item → nothing drawn, never ready", async () => {
    const onReady = vi.fn();
    const { container } = render(<ExportStage project={proj()} item={null} onReady={onReady} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(onReady).not.toHaveBeenCalled();
    expect(container.querySelector("svg.gfx-figure")).toBeNull();
  });
});
