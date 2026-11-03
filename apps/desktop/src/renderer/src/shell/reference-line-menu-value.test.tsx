// @vitest-environment jsdom
/**
 * A reference line added from the Design menu opens in the Inspector with the cursor in its Value box.
 *
 * The menu adds the line without a value, and a reference line is placed by its value alone, so the next thing to
 * do is type that value. The route tested is the whole app: open a graph, pick the menu item, type a number.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createSampleDocument, DEMO_FOLDER } from "@mady/core";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
});

const GRAPH = createSampleDocument().toJSON().plots.find((p) => p.name === "Treatment bar chart")!.name;

function app() {
  const { container: c } = render(<AppShell />);
  const nav = within(c.querySelector(".nav") as HTMLElement);
  fireEvent.click((nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement).querySelector("button.twist") as HTMLButtonElement);
  fireEvent.click(nav.getByText(GRAPH).closest("button") as HTMLButtonElement);
  expect(c.querySelector(".canvas svg.gfx-figure"), "the graph did not open").toBeTruthy();
  const design = (item: string): void => {
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Design"));
    fireEvent.click(within(c).getByText(item));
  };
  const valueBox = (): HTMLInputElement | undefined =>
    [...c.querySelectorAll(".inspbody label.frow")].find((l) => l.querySelector("span")?.textContent === "Value")?.querySelector("input") ?? undefined;
  return { c, design, valueBox };
}

describe("a reference line added from the Design menu opens at its value", () => {
  for (const [item, heading] of [["Horizontal reference line", "Horizontal line (Y)"], ["Vertical reference line", "Vertical line (X)"]] as const) {
    it(`${item}: the Inspector shows the new line, the cursor is in Value with the value selected, and a typed number reaches the line`, () => {
      const { c, design, valueBox } = app();
      // A number box's selection cannot be read back (selectionStart is null on type=number), so the call is watched.
      const selected: Element[] = [];
      const realSelect = HTMLInputElement.prototype.select;
      HTMLInputElement.prototype.select = function (this: HTMLInputElement) { selected.push(this); realSelect.call(this); };
      try {
        design(item);
      } finally {
        HTMLInputElement.prototype.select = realSelect;
      }
      expect(c.querySelector(".inspbody")?.textContent, "the Inspector does not show the new line").toContain(heading);
      const box = valueBox();
      expect(box, "no Value box in the Inspector").toBeTruthy();
      expect(document.activeElement, "the cursor is not in the Value box").toBe(box);
      expect(selected, "the value is not selected, so a typed number is added to it").toContain(box);
      fireEvent.change(box!, { target: { value: "5" } });
      expect(valueBox()!.value, "the typed value did not reach the line").toBe("5");
    });
  }

  it("a text box from the same menu does not take the cursor to a Value box", () => {
    const { design, valueBox } = app();
    design("Text box");
    const box = valueBox();
    expect(box === undefined || document.activeElement !== box).toBe(true);
  });
});
