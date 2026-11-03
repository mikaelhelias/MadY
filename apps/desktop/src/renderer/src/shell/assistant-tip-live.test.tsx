// @vitest-environment jsdom
/**
 * The assistant tip under the Inspector follows edits, not just tab switches.
 *
 * `doc.toJSON()` returns the same object after every edit, so a tip list keyed on it alone would
 * refresh only when the active graph/sheet changes. Here: on the dose-response graph, deleting its
 * curve fit must bring back the "dose-response fit" tip without leaving the graph.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createSampleDocument, DEMO_FOLDER } from "@mady/core";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const sample = createSampleDocument().toJSON();
const PLOT = sample.plots[0]!;
const FITS = sample.analyses.filter((a) => a.source === PLOT.source);

describe("assistant tip", () => {
  it("changes when the document changes while the graph stays open", () => {
    expect(FITS.map((a) => a.method), "fixture: the first demo graph's sheet must carry exactly one curve fit").toEqual(["curvefit"]);
    const { container: c } = render(<AppShell />);
    const nav = within(c.querySelector(".nav") as HTMLElement);
    fireEvent.click((nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement).querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav.getByText(PLOT.name).closest("button") as HTMLButtonElement);
    const tip = (): string => c.querySelector(".ast-nudge")?.textContent ?? "(no tip)";

    // With the fit present, a dose-response fit is not suggested (it already exists).
    expect(tip()).not.toMatch(/dose-response fit may be useful/);

    const fitRow = nav.getByText(FITS[0]!.name).closest(".navrow") as HTMLElement;
    fireEvent.click(fitRow.querySelector("button[title^='Delete']") as HTMLButtonElement);
    expect(c.querySelector(".canvas svg.gfx-figure"), "the graph is still open").toBeTruthy();

    expect(tip(), "the tip did not refresh after the fit was deleted").toMatch(/dose-response fit may be useful/);
  });
});
