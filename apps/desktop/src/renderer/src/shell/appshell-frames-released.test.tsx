// @vitest-environment jsdom
/**
 * Closing the app leaves no frame pending. The window-fit measurement requests an animation frame holding the document
 * column and must cancel it on unmount. In the app the frame fires within 16 ms; in a test run frames seldom get a turn
 * between tests, so an uncancelled frame would keep every unmounted app — ~90 MB with the gallery open — alive (held by
 * `mapOfAnimationFrameCallbacks`), and `AppShell.test.tsx` would run out of memory.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppShell } from "./AppShell";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("every animation frame the app asks for is run or cancelled by the time it is unmounted", () => {
  const pending = new Set<number>();
  const realReq = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    const id = realReq((t) => { pending.delete(id); cb(t); });
    pending.add(id);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); realCancel(id); });
  const { unmount } = render(<AppShell />);
  expect(pending.size, "the app asked for no frame — the fixture proves nothing").toBeGreaterThan(0);
  unmount();
  expect(pending.size, "a frame is still pending after the app closed — it keeps the whole app in memory").toBe(0);
});
