import { useEffect, type RefObject } from "react";

/**
 * Ctrl+wheel over `ref` → the view zoom (`onZoomWheel(deltaY)`); a plain wheel falls through untouched (it scrolls, or
 * zooms a graph's axes). Attached non-passive so `preventDefault` really stops the browser's own page zoom — React's
 * onWheel is passive. Shared by the document area and the figure page: the status bar says "Ctrl+scroll" zooms, and
 * the figure page replaces the document area, so it needs its own listener.
 */
export function useCtrlWheelZoom(ref: RefObject<HTMLElement | null>, onZoomWheel: ((deltaY: number) => void) | undefined): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !onZoomWheel) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      onZoomWheel(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, onZoomWheel]);
}
