// @vitest-environment jsdom
/** The notice on a small graph's Inspector: where it comes from, what can change on it, and the
 *  two ways out — each button doing what it says. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SmallGraphNoticeBox } from "./Inspector";

afterEach(cleanup);

describe("small graph notice", () => {
  it("names the series and the original, says only positions and sizes change, and both buttons work", () => {
    const onOpenOriginal = vi.fn();
    const onDetach = vi.fn();
    const { getByRole, getByText } = render(
      <SmallGraphNoticeBox originalName="Growth" seriesName="Treated" onOpenOriginal={onOpenOriginal} onDetach={onDetach} />,
    );
    const note = getByRole("note");
    expect(note.textContent).toContain("Treated");
    expect(note.textContent).toContain("Growth");
    expect(note.textContent).toMatch(/only positions and sizes/);
    fireEvent.click(getByText("Open original"));
    fireEvent.click(getByText("Detach"));
    expect(onOpenOriginal).toHaveBeenCalledTimes(1);
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("with the original deleted: says so, and offers only Detach", () => {
    const { getByRole, queryByText } = render(
      <SmallGraphNoticeBox originalName={null} seriesName="Treated" onOpenOriginal={() => {}} onDetach={() => {}} />,
    );
    expect(getByRole("note").textContent).toMatch(/original graph was deleted/);
    expect(queryByText("Open original")).toBeNull();
    expect(queryByText("Detach")).not.toBeNull();
  });
});
