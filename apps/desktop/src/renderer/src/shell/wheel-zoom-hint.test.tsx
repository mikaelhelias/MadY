// @vitest-environment jsdom
/**
 * The zoom hint matches the Wheel zoom setting. The Wheel zoom box is off by default and off stops the wheel, so the
 * line under every zoomable graph must not say "Scroll to zoom" while it is off — otherwise wheel zoom looks enabled
 * by default and impossible to turn off.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createSampleDocument, MadyDocument, type DataTable, type Plot } from "@mady/core";
import { GraphPane, WHEEL_ZOOM_KEY } from "./panes";
import { galleryItems } from "./gallery";

afterEach(() => { cleanup(); globalThis.localStorage?.clear(); });

const pane = () => {
  const g = galleryItems().find((x) => x.title === "XY (points + fitted curve)")!;
  const doc = new MadyDocument({ ...createSampleDocument().toJSON(), tables: [g.table as DataTable], plots: [g.plot as Plot], analyses: [] });
  return render(<GraphPane project={doc.toJSON()} plotId={(g.plot as Plot).id} />).container;
};

describe("the hint under a zoomable graph", () => {
  it("with Wheel zoom off (the default) it does not promise the wheel zooms, and says how to turn it on", () => {
    const text = pane().textContent ?? "";
    expect(text).not.toMatch(/Scroll to zoom/);
    expect(text).toMatch(/Wheel zoom/);
    expect(text).toMatch(/drag to pan/);
  });

  it("with Wheel zoom on it says Scroll to zoom", () => {
    globalThis.localStorage?.setItem(WHEEL_ZOOM_KEY, "1");
    expect(pane().textContent ?? "").toMatch(/Scroll to zoom/);
  });
});
