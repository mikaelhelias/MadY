// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AssistantNudge } from "./AssistantNudge";

afterEach(cleanup);

const sug = { id: "graph:t1", text: "“Dose” has no graph yet.", cta: "New graph of this data", actionId: "new-graph" };

describe("AssistantNudge", () => {
  it("renders nothing when there is no suggestion", () => {
    const { container } = render(<AssistantNudge suggestion={null} onRun={() => {}} onDismiss={() => {}} />);
    expect(container.querySelector(".ast-nudge")).toBeNull();
  });

  it("shows the prompt, runs its action, and dismisses it", () => {
    const onRun = vi.fn();
    const onDismiss = vi.fn();
    const { container, getByText, getByLabelText } = render(
      <AssistantNudge suggestion={sug} onRun={onRun} onDismiss={onDismiss} />,
    );
    expect(container.textContent).toContain("has no graph yet");
    fireEvent.click(getByText("New graph of this data"));
    expect(onRun).toHaveBeenCalledWith(sug);
    fireEvent.click(getByLabelText("Dismiss suggestion"));
    expect(onDismiss).toHaveBeenCalledWith("graph:t1");
  });
});

it("shows a compact reason for analysis suggestions", () => {
  const analysis = { ...sug, id: "analysis:t:ttest", kind: "analysis" as const, method: "ttest", reasons: ["Two usable numeric groups were detected."] };
  const { container } = render(<AssistantNudge suggestion={analysis} onRun={() => {}} onDismiss={() => {}} />);
  expect(container.textContent).toContain("Two usable numeric groups");
});
