// @vitest-environment jsdom
/**
 * The Inspector's axis panel follows data edits while it stays open.
 *
 * A data edit (a cell, an undo, a redo) changes the datasheet object in place, so a list in the
 * axis panel memoised on that object would keep showing the data from before the edit until the
 * graph was closed and reopened. The route tested here: edit a cell on the datasheet, open the
 * graph and its axis, then press Undo with the graph still open.
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
const BAR = sample.plots.find((p) => p.name === "Treatment bar chart")!;
const DOT = sample.plots.find((p) => p.name === "Heritability dot plot")!;
const sheetOf = (plotId: string) => sample.tables.find((t) => t.id === sample.plots.find((p) => p.id === plotId)!.source)!;

function app() {
  const { container: c } = render(<AppShell />);
  const nav = within(c.querySelector(".nav") as HTMLElement);
  fireEvent.click((nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement).querySelector("button.twist") as HTMLButtonElement);
  const open = (name: string): void => {
    fireEvent.click(nav.getByText(name).closest("button") as HTMLButtonElement);
  };
  /** Type into the datasheet cell that currently reads `from`. */
  const editCell = (sheet: string, from: string, to: string): void => {
    open(sheet);
    const cell = [...c.querySelectorAll(".canvas .dgcell")].find((e) => (e.textContent ?? "").trim() === from);
    expect(cell, `no cell reads "${from}"`).toBeTruthy();
    fireEvent.doubleClick(cell!);
    const input = c.querySelector(".dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: to } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  /** Open the graph and click its vertical axis line (the value axis on a bar chart, the names on a dot plot). */
  const openAxis = (graph: string): void => {
    open(graph);
    const line = [...c.querySelectorAll(".canvas svg.gfx-figure line")].find(
      (l) => l.getAttribute("x1") === l.getAttribute("x2") && (l as SVGElement).style.cursor === "pointer",
    );
    expect(line, "no clickable vertical axis on the graph").toBeTruthy();
    fireEvent.click(line!);
  };
  const undo = (): void => {
    fireEvent.click(c.querySelector('button[title^="Undo"]') as HTMLButtonElement);
    expect(c.querySelector(".canvas svg.gfx-figure"), "the graph closed").toBeTruthy();
  };
  const insp = () => c.querySelector(".inspbody") as HTMLElement;
  const groupBy = () => [...insp().querySelectorAll("label.frow")].find((l) => l.querySelector("span")?.textContent === "Group by")?.querySelector("select") as HTMLSelectElement;
  return { c, open, editCell, openAxis, undo, insp, groupBy };
}

describe("axis panel lists follow data edits made while the graph is open", () => {
  it("the suggested axis cut disappears when the outlier is undone", () => {
    const a = app();
    a.editCell(sheetOf(BAR.id).name, "12", "100000");
    a.openAxis(BAR.name);
    const suggest = () => [...a.insp().querySelectorAll("button")].find((b) => b.textContent === "Suggest cut")!;
    expect(suggest().disabled, "fixture: the outlier must produce a suggested cut").toBe(false);
    a.undo();
    expect(suggest().disabled, `still suggests "${suggest().title}" after the outlier was undone`).toBe(true);
  });

  it("a text column becomes a Group-by choice again when the number typed into it is undone", () => {
    const a = app();
    a.editCell(sheetOf(DOT.id).name, "Cognition & SES", "5"); // a number in Domain → no longer a group column
    a.openAxis(DOT.name);
    const choices = () => [...a.groupBy().options].map((o) => o.text);
    expect(choices(), "fixture: Domain must drop out while it holds a number").not.toContain("Domain");
    a.undo();
    expect(choices(), "Domain did not come back as a Group-by choice").toContain("Domain");
  });

  it("the group colour rows follow a renamed group when the rename is undone", () => {
    const a = app();
    a.openAxis(DOT.name);
    const domain = [...a.groupBy().options].find((o) => o.text === "Domain")!;
    fireEvent.change(a.groupBy(), { target: { value: domain.value } });
    a.editCell(sheetOf(DOT.id).name, "Cognition & SES", "Renamed group");
    a.openAxis(DOT.name);
    const colourRows = () => [...a.insp().querySelectorAll("[aria-label^='Colour for group ']")].map((e) => e.getAttribute("aria-label"));
    expect(colourRows(), "fixture: the rename must show").toContain("Colour for group Renamed group");
    a.undo();
    expect(colourRows(), "the colour rows kept the undone name").toContain("Colour for group Cognition & SES");
    expect(colourRows()).not.toContain("Colour for group Renamed group");
  });

  it("the By-hand boxes follow a renamed category when the rename is undone", () => {
    const a = app();
    a.openAxis(DOT.name);
    fireEvent.change(a.groupBy(), { target: { value: [...a.groupBy().options].find((o) => o.text === "By hand")!.value } });
    a.editCell(sheetOf(DOT.id).name, "Educational attainment", "Renamed trait");
    a.openAxis(DOT.name);
    const boxes = () => [...a.insp().querySelectorAll("input[aria-label^='Group for ']")].map((e) => e.getAttribute("aria-label"));
    expect(boxes(), "fixture: the rename must show").toContain("Group for Renamed trait");
    a.undo();
    expect(boxes(), "the By-hand boxes kept the undone name").toContain("Group for Educational attainment");
    expect(boxes()).not.toContain("Group for Renamed trait");
  });
});
