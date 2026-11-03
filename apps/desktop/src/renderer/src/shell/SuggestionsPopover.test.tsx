// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { SuggestionsPopover } from "./SuggestionsPopover";
import type { Suggestion } from "./assistant";

afterEach(cleanup);

const analysisTip: Suggestion = {
  id: "analysis:t:ttest:mann-whitney",
  text: "This graph is better compared with a rank-based test.",
  cta: "Configure Mann-Whitney",
  actionId: "analyze",
  kind: "analysis",
  confidence: "high",
  method: "ttest",
  variant: "mann-whitney",
  reasons: ["Outliers were detected in a group.", "Mann-Whitney avoids the normality assumption."],
  caveats: ["Rank tests have low power at small n."],
  alternatives: ["Welch's t test if the data are approximately normal."],
};
const generalTip: Suggestion = { id: "graph:t", text: '"Data" has no graph yet.', cta: "New graph of this data", actionId: "new-graph", kind: "general" };

function setup(over: Partial<Parameters<typeof SuggestionsPopover>[0]> = {}) {
  const props = { suggestions: [analysisTip, generalTip], onRun: vi.fn(), onDismiss: vi.fn(), onClose: vi.fn(), onResetDismissed: vi.fn(), ...over };
  return { ...render(<SuggestionsPopover {...props} />), ...props };
}

describe("SuggestionsPopover", () => {
  it("lists each suggestion with its CTA and a confidence chip for analysis tips", () => {
    const { container } = setup();
    expect(container.textContent).toContain(analysisTip.text);
    expect(container.textContent).toContain(generalTip.text);
    expect([...container.querySelectorAll("button")].map((b) => b.textContent)).toEqual(expect.arrayContaining(["Configure Mann-Whitney", "New graph of this data"]));
    // confidence chip present for the analysis tip, absent for the general one (only 1 chip)
    expect(container.querySelectorAll(".an-rec-confidence")).toHaveLength(1);
    expect(container.querySelector(".an-rec-confidence")?.textContent).toBe("high");
  });

  it("running a suggestion fires onRun and closes", () => {
    const d = setup();
    fireEvent.click(within(d.container).getByText("Configure Mann-Whitney"));
    expect(d.onRun).toHaveBeenCalledWith(analysisTip);
    expect(d.onClose).toHaveBeenCalled();
  });

  it("dismissing a suggestion fires onDismiss with its id", () => {
    const d = setup();
    fireEvent.click(within(d.container).getAllByLabelText("Dismiss suggestion")[0]!);
    expect(d.onDismiss).toHaveBeenCalledWith(analysisTip.id);
  });

  it("the Why? toggle reveals the reasons / caveats / alternatives (concise by default)", () => {
    const d = setup();
    expect(d.container.textContent).not.toContain("avoids the normality assumption"); // collapsed
    // only the analysis tip (with reasons/caveats) exposes a Why? toggle; the general tip does not
    expect(within(d.container).queryAllByText("Why?")).toHaveLength(1);
    fireEvent.click(within(d.container).getByText("Why?"));
    expect(d.container.textContent).toContain("avoids the normality assumption");
    expect(d.container.textContent).toContain("low power at small n");
    expect(d.container.textContent).toContain("approximately normal");
  });

  it("shows a calm empty state when there are no suggestions", () => {
    const { container } = setup({ suggestions: [] });
    expect(container.textContent).toMatch(/all caught up/i);
    expect(container.querySelectorAll(".sugg-item")).toHaveLength(0);
  });

  it("Escape and the footer link fire onClose / onResetDismissed", () => {
    const d = setup();
    fireEvent.click(within(d.container).getByText(/show dismissed/i));
    expect(d.onResetDismissed).toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(d.onClose).toHaveBeenCalled();
  });
});
