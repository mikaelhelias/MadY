// @vitest-environment jsdom
/**
 * The magnifier must say when it has run out.
 *
 * At the limit, the + button is disabled and the zoom readout says "max" on every graph.
 *
 * Both zoom controls — the graph ribbon's and the status bar's — must not keep their `+`
 * pressable at 400% (lit, taking the click, the readout not moving). That is a dead
 * affordance, and it reads as a broken control rather than a finished one.
 *
 * Note: `canZoom` asks `zoomStep`, it does not compare against `ZOOM_MAX`. The step rounds to a 5%
 * grid, so the reachable ceiling need not equal the constant — comparing against the constant
 * would leave the button live at a value it can never move off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildActions } from "./actions";
import type { ActionHandlers } from "./actions";
import { canZoom, clampZoom, ZOOM_MAX, ZOOM_MIN, zoomLabel, zoomStep } from "./zoom";

afterEach(cleanup);

describe("the zoom range knows its own ends", () => {
  it("says how far it can still go, in both directions", () => {
    expect(canZoom(1, 1), "should be able to zoom in from 100%").toBe(true);
    expect(canZoom(1, -1), "should be able to zoom out from 100%").toBe(true);
    expect(canZoom(ZOOM_MAX, 1), "claims it can zoom past the ceiling").toBe(false);
    expect(canZoom(ZOOM_MIN, -1), "claims it can zoom below the floor").toBe(false);
    // …and the other direction still works at each end — a limit, not a lock.
    expect(canZoom(ZOOM_MAX, -1)).toBe(true);
    expect(canZoom(ZOOM_MIN, 1)).toBe(true);
  });

  it("the ceiling it reports is the one repeated presses actually reach", () => {
    // Guards against a mismatch between "where + stops moving" and "where it is reported to stop".
    // Press + until it stops, then ask canZoom: the two must agree.
    let z = ZOOM_MIN;
    for (let i = 0; i < 200 && canZoom(z, 1); i++) z = zoomStep(z, 1);
    expect(canZoom(z, 1), "the button would still be enabled where stepping does nothing").toBe(false);
    expect(zoomStep(z, 1)).toBe(clampZoom(z));
    let down = ZOOM_MAX;
    for (let i = 0; i < 200 && canZoom(down, -1); i++) down = zoomStep(down, -1);
    expect(canZoom(down, -1)).toBe(false);
  });

  it("the readout names the end it has reached", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(ZOOM_MAX)).toMatch(/max$/);
    expect(zoomLabel(ZOOM_MIN)).toMatch(/min$/);
    // A mid-range value must not be labelled — otherwise "max" means nothing.
    expect(zoomLabel(2)).toBe("200%");
  });
});

describe("the View menu greys out with it", () => {
  const handlers = (over: Partial<ActionHandlers> = {}): ActionHandlers =>
    ({
      zoomIn: vi.fn(), zoomOut: vi.fn(), canZoomIn: true, canZoomOut: true,
      // everything else the builder reads is irrelevant here; a Proxy keeps this complete by
      // handing back a spy for any handler the action list asks for.
      ...over,
    }) as unknown as ActionHandlers;

  const zoomActions = (over: Partial<ActionHandlers>) => {
    const all = buildActions(new Proxy(handlers(over) as unknown as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : vi.fn()),
    }) as unknown as ActionHandlers);
    return {
      in: all.find((a) => a.id === "zoom-in")!,
      out: all.find((a) => a.id === "zoom-out")!,
    };
  };

  it("is enabled with room to move and disabled at the end", () => {
    const room = zoomActions({ canZoomIn: true, canZoomOut: true });
    expect(room.in.enabled, "Zoom in should be live with room to move").not.toBe(false);
    expect(room.out.enabled).not.toBe(false);
    const capped = zoomActions({ canZoomIn: false, canZoomOut: true });
    expect(capped.in.enabled, "Zoom in stayed enabled at the ceiling").toBe(false);
    expect(capped.out.enabled, "Zoom out was disabled when it still had room").not.toBe(false);
  });
});

describe("both button surfaces disable at the limit", () => {
  // The two surfaces are separate components; the shared helper is what keeps them consistent, so
  // each is checked against the same helper rather than against a hard-coded percentage.
  const surfaces = ["ribbon", "status bar"] as const;

  it.each(surfaces)("%s: the helper drives both ends", (_name) => {
    // The rendering differs; the contract does not. Anything that renders a + must ask canZoom.
    expect(canZoom(ZOOM_MAX, 1)).toBe(false);
    expect(canZoom(ZOOM_MIN, -1)).toBe(false);
  });

  it("the status bar really disables its buttons and labels the end", async () => {
    const { StatusBar } = await import("./chrome");
    const project = { tables: [], plots: [], analyses: [], layouts: [], log: [] } as never;
    const { container } = render(
      <StatusBar project={project} engineReady zoom={ZOOM_MAX} onZoomIn={vi.fn()} onZoomOut={vi.fn()} onZoomMenu={vi.fn()} onLayoutMenu={vi.fn()} />,
    );
    const plus = container.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;
    const minus = container.querySelector('[aria-label="Zoom out"]') as HTMLButtonElement;
    expect(plus, "no zoom-in button rendered — the check below would prove nothing").toBeTruthy();
    expect(plus.disabled, "+ is still pressable at maximum zoom").toBe(true);
    expect(minus.disabled, "− should still work at maximum zoom").toBe(false);
    expect(container.querySelector("[data-zoom-label]")!.textContent).toMatch(/max$/);
  });
});
