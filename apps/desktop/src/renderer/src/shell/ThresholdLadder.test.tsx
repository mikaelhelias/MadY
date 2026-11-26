// @vitest-environment jsdom
/**
 * The threshold-ladder editor — the two things about it that are easy to get wrong.
 *
 * 1. `hideNs` defaults to true, so unticking "hide" has to store an explicit `false`.
 *    Emitting `undefined` there would read as "follow the default", i.e. keep hiding — the
 *    control would look live and do nothing. A check that only asks whether the field is
 *    written by a control and read by the drawing cannot see this, since both hold.
 * 2. The preview strip must not promise a label the figure will never draw.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThresholdLadder } from "./ThresholdLadder";

afterEach(cleanup);

const noop = (): void => {};

/** The ladder with the given hideNs state; returns the container + the spy on hideNs. */
function ladder(hideNs: boolean | undefined) {
  const onChangeHideNs = vi.fn();
  const r = render(
    <ThresholdLadder
      value={undefined}
      display="stars"
      nsSymbol={undefined}
      hideNs={hideNs}
      scope="graph"
      onChange={noop}
      onChangeNs={noop}
      onChangeHideNs={onChangeHideNs}
    />,
  );
  const box = r.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  return { ...r, box, onChangeHideNs };
}

describe("ThresholdLadder — the hide-ns default", () => {
  it("shows 'hide' as ON when nothing is stored (undefined = follow the default = hide)", () => {
    expect(ladder(undefined).box.checked).toBe(true);
    expect(ladder(false).box.checked).toBe(false);
    expect(ladder(true).box.checked).toBe(true);
  });

  it("unticking stores an explicit false — `undefined` would silently keep hiding", () => {
    const { box, onChangeHideNs } = ladder(undefined);
    fireEvent.click(box); // untick
    expect(onChangeHideNs).toHaveBeenCalledWith(false);
  });

  it("re-ticking clears the override rather than freezing today's default into the document", () => {
    const { box, onChangeHideNs } = ladder(false);
    fireEvent.click(box); // tick
    expect(onChangeHideNs).toHaveBeenCalledWith(undefined);
  });

  it("the preview says 'not drawn' for a p that clears no rung while hide is on", () => {
    // p = 0.5 clears nothing. With hide on the figure draws no label at all, so a preview that
    // printed "ns" would be advertising a label that never appears.
    const on = ladder(undefined);
    expect(on.container.textContent).toContain("not drawn");
    expect(on.container.textContent).not.toContain("0.5 → ns");
    cleanup();
    const off = ladder(false);
    expect(off.container.textContent).not.toContain("not drawn");
    expect(off.container.textContent).toContain("ns");
  });
});
