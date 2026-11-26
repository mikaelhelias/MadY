// @vitest-environment jsdom
/** useCtrlWheelZoom — Ctrl+wheel is the view zoom, on the document area and the figure page alike. */
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useCtrlWheelZoom } from "./ctrlWheelZoom";

afterEach(cleanup);

function Area({ onZoomWheel }: { onZoomWheel?: (d: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(ref, onZoomWheel);
  return <div ref={ref} className="area" />;
}
const wheel = (el: Element, ctrlKey: boolean, deltaY: number): WheelEvent => {
  const e = new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

describe("useCtrlWheelZoom", () => {
  it("Ctrl+wheel zooms (and stops the browser's own page zoom); a plain wheel is left alone", () => {
    const zoom = vi.fn();
    const { container } = render(<Area onZoomWheel={zoom} />);
    const area = container.querySelector(".area")!;
    const plain = wheel(area, false, -120);
    expect(zoom).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
    const ctrl = wheel(area, true, -120);
    expect(zoom).toHaveBeenCalledWith(-120);
    expect(ctrl.defaultPrevented).toBe(true);
  });

  it("does nothing without a handler", () => {
    const { container } = render(<Area />);
    expect(wheel(container.querySelector(".area")!, true, 120).defaultPrevented).toBe(false);
  });
});
