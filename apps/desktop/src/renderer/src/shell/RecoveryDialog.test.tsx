// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { RecoveryDialog } from "./RecoveryDialog";
import type { AutosaveSnapshot } from "../../../preload";

afterEach(cleanup);

const snapshot: AutosaveSnapshot = {
  v: 1,
  savedAt: 1_700_000_000_000,
  name: "Dose-response study",
  json: "{}",
};

function setup(ageMs = 5 * 60_000) {
  const onRecover = vi.fn();
  const onDiscard = vi.fn();
  const utils = render(
    <RecoveryDialog snapshot={snapshot} ageMs={ageMs} onRecover={onRecover} onDiscard={onDiscard} />,
  );
  return { ...utils, onRecover, onDiscard };
}

describe("RecoveryDialog", () => {
  it("names the snapshot and shows its age", () => {
    const d = setup(5 * 60_000);
    expect(d.getByText("Dose-response study")).toBeTruthy();
    expect(d.container.textContent).toContain("5 minutes ago");
  });

  it("wires Recover and Discard to their callbacks", () => {
    const d = setup();
    fireEvent.click(d.getByText("Recover"));
    expect(d.onRecover).toHaveBeenCalledTimes(1);
    expect(d.onDiscard).not.toHaveBeenCalled();
    fireEvent.click(d.getByText("Discard"));
    expect(d.onDiscard).toHaveBeenCalledTimes(1);
  });
});
