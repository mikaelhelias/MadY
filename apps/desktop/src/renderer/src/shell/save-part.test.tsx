// @vitest-environment jsdom
/**
 * Save a part — the whole renderer chain for "save one experiment / one graph", from the
 * toolbar button to the JSON handed to the file bridge and back into a document.
 *
 * What it proves that the unit tests cannot: the Save button opens the picker, the picker's
 * picks reach `extractPicks` with the live project, and what the bridge is handed is a file
 * that reopens as an ordinary project with its data in it. The only leg not covered here is
 * Electron's own dialog + disk write (shared with the whole-project save, and exercised for
 * real in `e2e/save-part.spec.ts`).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { MadyDocument, migrate } from "@mady/core";
import type { Project, WorkspaceRef } from "@mady/core";
import { AppShell } from "./AppShell";

let saved: { json: string; name: string } | null = null;

beforeEach(() => {
  saved = null;
  (window as unknown as { mady: unknown }).mady = {
    saveProject: (json: string, name: string) => {
      saved = { json, name };
      return Promise.resolve({ ok: true, path: `C:\\${name}.mady` });
    },
  };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { mady?: unknown }).mady;
  globalThis.localStorage?.clear();
});

/** The file the bridge was handed, put back through the real load path. */
function savedProject(): Project {
  if (!saved) throw new Error("nothing was handed to the save bridge");
  return migrate(JSON.parse(saved.json) as Record<string, unknown>);
}

const treeRefs = (p: Project): string[] =>
  [
    ...p.workspace.loose,
    ...p.workspace.folders.flatMap((f) => [...f.members, ...f.experiments.flatMap((e) => e.members)]),
  ].map((r: WorkspaceRef) => `${r.kind}:${r.id}`);

/** Open the Save picker and expand the demo folder so its graphs are reachable. The demo
 *  starts unticked + collapsed (a user rarely saves it), so this is already "nothing selected"
 *  — expanding just reveals its graphs to pick one. */
function openPickerOnDemo() {
  const app = render(<AppShell />);
  fireEvent.click(app.getByTitle(/^Save → \.mady/));
  const dialog = within(app.getByRole("dialog", { name: "Save project" }));
  fireEvent.click(dialog.getByLabelText("Expand Demo Project")); // demo starts collapsed → reveal its graphs
  return { app, dialog };
}

describe("saving a part of the project", () => {
  it("saves a single graph as a project file that carries its datasheet", () => {
    const { dialog } = openPickerOnDemo();
    fireEvent.click(dialog.getByLabelText("Treatment bar chart"));

    const btn = dialog.getByRole("button", { name: /^Save/ });
    expect(btn.textContent).toBe("Save this graph…");
    fireEvent.click(btn);

    expect(saved!.name).toBe("Treatment bar chart"); // suggested file name = the graph's name
    const file = savedProject();
    expect(file.plots.map((p) => p.name)).toEqual(["Treatment bar chart"]);
    expect(file.tables.map((t) => t.name)).toEqual(["Treatment means"]); // its data came along
    expect(file.tables[0]!.rows.length).toBeGreaterThan(0); // …with the numbers in it

    // it opens as an ordinary project, and both objects are visible in its tree
    const reopened = new MadyDocument(file).toJSON();
    expect(reopened.plots).toHaveLength(1);
    expect(treeRefs(reopened).sort()).toEqual([`plot:${file.plots[0]!.id}`, `table:${file.tables[0]!.id}`].sort());
  });

  it("saves one experiment, with its own name suggested and its siblings left out", () => {
    const { dialog } = openPickerOnDemo();
    fireEvent.click(dialog.getByLabelText("Experiment 2"));

    const btn = dialog.getByRole("button", { name: /^Save/ });
    expect(btn.textContent).toBe("Save this experiment…");
    fireEvent.click(btn);

    expect(saved!.name).toBe("Experiment 2");
    const file = savedProject();
    expect(file.plots.map((p) => p.name)).toEqual(["Treatment bar chart"]);
    expect(file.tables.map((t) => t.name)).toEqual(["Treatment means"]);
    expect(file.workspace.folders.map((f) => f.name)).toEqual(["Demo Project"]); // the context is kept
    expect(file.workspace.folders[0]!.experiments.map((e) => e.name)).toEqual(["Experiment 2"]); // 1 and 3-8 dropped
  });

  it("the demo starts unticked; ticking it saves the whole project — every graph, every table", () => {
    const app = render(<AppShell />);
    fireEvent.click(app.getByTitle(/^Save → \.mady/));
    const dialog = within(app.getByRole("dialog", { name: "Save project" }));
    // By default the demo project is off (a user rarely means to save it).
    expect((dialog.getByLabelText("Demo Project") as HTMLInputElement).checked).toBe(false);
    // Ticking it restores the whole-project save.
    fireEvent.click(dialog.getByLabelText("Demo Project"));
    const btn = dialog.getByRole("button", { name: /^Save/ });
    expect(btn.textContent).toBe("Save everything…");
    fireEvent.click(btn);

    const file = savedProject();
    expect(file.plots.length).toBeGreaterThan(5);
    expect(file.tables.length).toBeGreaterThan(5);
    expect(saved!.name).toBe("project");
  });

  it("a graph made after launch is in the picker, and saving it alone carries its new datasheet", () => {
    // Guards against a graph made with another dataset after launch missing from the save
    // picker. Memoising the picker's list on `doc.toJSON()`, which is the same object after
    // every edit, would keep the list as it was at startup.
    const app = render(<AppShell />);
    const c = app.container;
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Graph"));
    fireEvent.click(within(c).getByText("New graph…"));
    const wiz = c.querySelector('[role="dialog"][aria-label="New graph"]')!;
    fireEvent.click(wiz.querySelector('[data-kind="column"]') as HTMLButtonElement);
    fireEvent.click(wiz.querySelector('[data-genre="bar"]') as HTMLButtonElement);
    fireEvent.click([...wiz.querySelectorAll("button.btn")].find((b) => /Create/.test(b.textContent ?? "")) as HTMLButtonElement);

    fireEvent.click(app.getByTitle(/^Save (→ \.mady|— you have unsaved changes)/));
    const dialog = within(app.getByRole("dialog", { name: "Save project" }));
    const rows = [...c.querySelectorAll('[role="dialog"][aria-label="Save project"] .saverow')];
    const graphRows = rows.filter((r) => r.querySelector(".savekind")?.textContent === "graph");
    const dataRows = rows.filter((r) => r.querySelector(".savekind")?.textContent === "data");
    expect(graphRows, "the new graph is not in the Save picker").toHaveLength(1);
    expect(dataRows, "the new datasheet is not in the Save picker").toHaveLength(1);

    // It starts ticked, the demo does not — so the button saves exactly the new work.
    const btn = dialog.getByRole("button", { name: /^Save/ });
    expect(btn.textContent).toBe("Save 2 items…");
    fireEvent.click(btn);
    const file = savedProject();
    expect(file.plots).toHaveLength(1);
    expect(file.tables).toHaveLength(1);
    expect(file.plots[0]!.source).toBe(file.tables[0]!.id);
  });

  it("every kind of new work is in the picker, in the saved file, and reopens: project, experiment, datasheet, graph, result, figure", async () => {
    // Every kind of new work can be saved: a project, a datasheet, an analysis, and so on —
    // each made after launch, with the buttons a user presses.
    window.confirm = () => true;
    const app = render(<AppShell />);
    const c = app.container;
    const nav = () => within(c.querySelector(".nav") as HTMLElement);
    const menu = (m: string) => fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText(m));
    const clickBtn = (root: Element, re: RegExp) =>
      fireEvent.click([...root.querySelectorAll("button.btn")].find((b) => re.test(b.textContent ?? "")) as HTMLButtonElement);

    fireEvent.click(nav().getByTitle("New project folder")); // "Project 2" + "Experiment 1"
    fireEvent.click(nav().getAllByTitle("Add dataset").at(-1)!);
    fireEvent.click(nav().getAllByTitle("Add graph of this experiment's data").at(-1)!);
    const wiz = c.querySelector('[role="dialog"][aria-label="New graph"]')!;
    clickBtn(wiz, /Create/);
    fireEvent.click(nav().getAllByTitle("New panel figure for this experiment").at(-1)!);
    fireEvent.click(nav().getAllByTitle("Add experiment").at(-1)!); // an empty "Experiment 2"

    // A result, through Analyze on a new sheet with data (the wizard's sample), filed in the new project.
    menu("Graph");
    fireEvent.click(within(c).getByText("New graph…"));
    const wiz2 = c.querySelector('[role="dialog"][aria-label="New graph"]')!;
    fireEvent.click(wiz2.querySelector('[data-kind="column"]') as HTMLButtonElement);
    fireEvent.click(wiz2.querySelector('[data-genre="bar"]') as HTMLButtonElement);
    const addTo = wiz2.querySelector('select[aria-label="Add to project"]') as HTMLSelectElement;
    fireEvent.change(addTo, { target: { value: [...addTo.options].find((o) => o.text === "Project 2")!.value } });
    clickBtn(wiz2, /Create/);
    menu("Analyze");
    fireEvent.click(within(c).getByText("Analyze…"));
    const analyze = c.querySelector('[role="dialog"][aria-label="Analyze"]')!;
    fireEvent.click([...analyze.querySelectorAll("button")].find((b) => b.textContent === "Browse all analyses")!);
    fireEvent.click(analyze.querySelector('[data-method="ttest"]')!);
    clickBtn(analyze, /^Run$/);

    fireEvent.click(app.getByTitle(/^Save (→ \.mady|— you have unsaved changes)/));
    const dialog = c.querySelector('[role="dialog"][aria-label="Save project"]')!;
    const rows = [...dialog.querySelectorAll(".saverow")];
    const kinds = rows.map((r) => r.querySelector(".savekind")?.textContent).filter(Boolean).sort();
    expect(kinds, "rows in the picker, by kind").toEqual(["data", "data", "figure", "graph", "graph", "result"]);
    expect(within(dialog as HTMLElement).getByLabelText("Project 2")).toBeTruthy();
    expect(within(dialog as HTMLElement).getByLabelText("Experiment 2")).toBeTruthy(); // even empty

    // Everything new is ticked (only the demo is not) → one pick: the new project folder.
    const btn = within(dialog as HTMLElement).getByRole("button", { name: /^Save/ });
    expect(btn.textContent).toBe("Save this project folder…");
    fireEvent.click(btn);
    const file = savedProject();
    expect(file.workspace.folders.map((f) => f.name)).toEqual(["Project 2"]);
    expect(file.workspace.folders[0]!.experiments.map((e) => e.name)).toEqual(["Experiment 1", "Experiment 2"]);
    expect(file.tables).toHaveLength(2);
    expect(file.plots).toHaveLength(2);
    expect(file.analyses).toHaveLength(1);
    expect(file.layouts ?? []).toHaveLength(1);
    // Every saved object is reachable in the saved file's tree.
    expect(treeRefs(file).sort()).toEqual(
      [...file.tables.map((t) => `table:${t.id}`), ...file.plots.map((p) => `plot:${p.id}`), ...file.analyses.map((a) => `analysis:${a.id}`), ...(file.layouts ?? []).map((l) => `layout:${l.id}`)].sort(),
    );

    // --- Reopen: a fresh app opens that file through Open (the same load the desktop build runs)
    app.unmount();
    const json = saved!.json;
    (window as unknown as { mady: Record<string, unknown> }).mady.openFile = () =>
      Promise.resolve({ ok: true, kind: "project", path: "C:\\Project 2.mady", json });
    const again = render(<AppShell />);
    const c2 = again.container;
    await act(async () => { fireEvent.click(within(c2).getByTitle(/^Open a project/)); });
    const nav2 = c2.querySelector(".nav") as HTMLElement;
    for (let pass = 0; pass < 6; pass++) {
      const shut = [...nav2.querySelectorAll("button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
      if (shut.length === 0) break;
      shut.forEach((t) => fireEvent.click(t));
    }
    const labels = [...nav2.querySelectorAll(".navrow")].map((r) => (r.textContent ?? "").trim());
    for (const name of ["Project 2", "Experiment 1", "Experiment 2"]) expect(labels, `"${name}" is not in the reopened tree`).toContain(name);
    expect(labels.some((l) => l.includes("Demo Project")), "the reopened file carries the demo it was not asked to").toBe(false);
    // Open each object from its own tree row (row kind = its "Delete <kind>" button): the wizard
    // names a new datasheet and its graph alike, so a name alone can land on the wrong one.
    const rowsOf = (kind: string): HTMLElement[] =>
      [...nav2.querySelectorAll<HTMLElement>(".navrow")].filter((r) => r.querySelector(`button[title="Delete ${kind}"]`));
    const openRow = (row: HTMLElement): void => {
      fireEvent.click(row.querySelector("button.navlabelbtn") as HTMLButtonElement);
    };
    const canvas = () => c2.querySelector(".canvas") as HTMLElement;
    expect(rowsOf("table").length, "datasheets in the reopened tree").toBe(file.tables.length);
    expect(rowsOf("plot").length, "graphs in the reopened tree").toBe(file.plots.length);
    expect(rowsOf("analysis").length, "results in the reopened tree").toBe(file.analyses.length);
    expect(rowsOf("layout").length, "figures in the reopened tree").toBe((file.layouts ?? []).length);
    rowsOf("table").forEach((row, i) => {
      openRow(row);
      expect(canvas().querySelector(".dg"), `datasheet #${i + 1} did not open`).toBeTruthy();
    });
    rowsOf("plot").forEach((row, i) => {
      openRow(row);
      expect(canvas().querySelector("svg.gfx-figure"), `graph #${i + 1} did not draw: ${canvas().textContent?.slice(0, 200)}`).toBeTruthy();
    });
    rowsOf("analysis").forEach((row) => {
      openRow(row);
      expect(canvas().querySelector(".anhead-title")?.textContent, "the result did not open").toBe(file.analyses[0]!.name);
    });
    rowsOf("layout").forEach((row) => {
      openRow(row);
      expect(c2.querySelector(".layoutview-title")?.textContent, "the figure did not open").toContain(file.layouts![0]!.name);
    });
    // Two full app renders + a save + a reopen: ~2.5 s alone, over the 5 s default under the full suite's load.
  }, 20000);

  it("saving a part leaves the live document alone (it is not the file you are working in)", () => {
    const { app, dialog } = openPickerOnDemo();
    fireEvent.click(dialog.getByLabelText("Treatment bar chart"));
    fireEvent.click(dialog.getByRole("button", { name: /^Save/ }));
    // reopen the picker: the live document still holds everything — expand the demo and all 8
    // experiments are still there.
    fireEvent.click(app.getByTitle(/^Save → \.mady/));
    const again = within(app.getByRole("dialog", { name: "Save project" }));
    fireEvent.click(again.getByLabelText("Expand Demo Project"));
    expect(again.getByLabelText("Experiment 8")).toBeTruthy();
  });
});
