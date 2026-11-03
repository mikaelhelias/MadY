// @vitest-environment jsdom
/**
 * The document area wraps whichever tab is in front in one error boundary. A pane that throws
 * must show its error in its own tab only: switching to another tab shows that tab, not the
 * first tab's crash message in its place.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

function Thrower(): never {
  throw new Error("pane failed");
}

describe("ErrorBoundary", () => {
  it("shows a crash in the tab that crashed, and the next tab's content after a switch", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(
      <ErrorBoundary label="Graph A" resetKey="plot:a"><Thrower /></ErrorBoundary>,
    );
    expect(container.textContent).toContain("Couldn't render Graph A");
    rerender(<ErrorBoundary label="Chart gallery" resetKey="gallery"><p>gallery cards</p></ErrorBoundary>);
    expect(container.textContent).toBe("gallery cards");
    vi.restoreAllMocks();
  });

  it("keeps the error while the same tab stays in front", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(
      <ErrorBoundary label="Graph A" resetKey="plot:a"><Thrower /></ErrorBoundary>,
    );
    rerender(<ErrorBoundary label="Graph A" resetKey="plot:a"><p>drawn</p></ErrorBoundary>);
    expect(container.textContent).toContain("Couldn't render Graph A");
    vi.restoreAllMocks();
  });
});
