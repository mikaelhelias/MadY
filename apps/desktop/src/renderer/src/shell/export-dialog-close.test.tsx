// @vitest-environment jsdom
/**
 * Export dialog closes: the popup has a close button, and Escape closes it too, in addition to a
 * click outside. (Whether the Format list stays inside the dialog's right edge is a layout fact jsdom
 * cannot measure; it is checked in the browser.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ExportDialog } from "./ExportDialog";

afterEach(cleanup);

describe("the Export dialog closes", () => {
  const open = () => {
    const onCancel = vi.fn();
    const r = render(<ExportDialog kind="plot" source="figure" suggestedName="fig" onExport={() => Promise.resolve()} onCancel={onCancel} />);
    return { ...r, onCancel };
  };

  it("from its close button", () => {
    const { container, onCancel } = open();
    const x = container.querySelector('[role="dialog"] button[aria-label="Close"]');
    expect(x, "no close ✕ on the dialog").not.toBeNull();
    fireEvent.click(x!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("from Escape", () => {
    const { onCancel } = open();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
