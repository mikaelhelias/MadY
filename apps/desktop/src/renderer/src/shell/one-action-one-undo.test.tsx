// @vitest-environment jsdom
/**
 * One user action is one Undo step, in the running app.
 *
 * A box that saves on each key made a step per key ("Zq check" took eight Ctrl+Z), and one press of a style preset
 * ran several commands, each its own step. The graph must look exactly as before after ONE Undo.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createSampleDocument, DEMO_FOLDER } from "@mady/core";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const BAR = createSampleDocument().toJSON().plots.find((p) => p.name === "Treatment bar chart")!;

function app() {
  const { container: c } = render(<AppShell />);
  const nav = within(c.querySelector(".nav") as HTMLElement);
  fireEvent.click((nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement).querySelector("button.twist") as HTMLButtonElement);
  fireEvent.click(nav.getByText(BAR.name).closest("button") as HTMLButtonElement);
  const figure = () => (c.querySelector(".canvas svg.gfx-figure") as SVGElement).outerHTML;
  const tab = (name: string) => fireEvent.click([...c.querySelectorAll("button.inspcat")].find((b) => b.textContent?.replace(/\*$/, "").trim() === name) as HTMLElement);
  const undo = () => fireEvent.click(c.querySelector('button[title^="Undo"]') as HTMLButtonElement);
  return { c, figure, tab, undo };
}

describe("one action, one Undo", () => {
  it("text typed key by key into one box", () => {
    const a = app();
    fireEvent.click(a.c.querySelector(".canvas svg.gfx-figure") as Element); // the graph itself → its panel
    a.tab("Text");
    const row = [...a.c.querySelectorAll(".inspbody label.frow")].find((l) => l.querySelector(":scope > span")?.textContent === "Title");
    const box = row?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(box, "fixture: no Title box on the Text tab").toBeTruthy();
    const before = a.figure();
    box.focus();
    for (const ch of " Zq") fireEvent.change(box, { target: { value: box.value + ch } });
    expect(a.figure(), "fixture: typing did not reach the graph").not.toBe(before);
    box.blur();
    a.undo();
    expect(a.figure()).toBe(before);
  });

  it("one press of a style preset", () => {
    const a = app();
    fireEvent.click(a.c.querySelector(".canvas svg.gfx-figure") as Element);
    a.tab("Style");
    const preset = [...a.c.querySelectorAll(".inspbody button")].find((b) => /Data-journalism/.test(b.getAttribute("title") ?? b.textContent ?? "")) as HTMLButtonElement;
    expect(preset, "fixture: no Data-journalism preset").toBeTruthy();
    const before = a.figure();
    fireEvent.click(preset);
    expect(a.figure(), "fixture: the preset changed nothing").not.toBe(before);
    a.undo();
    expect(a.figure()).toBe(before);
  });
});
