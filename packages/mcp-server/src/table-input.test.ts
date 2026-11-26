/**
 * What an agent can say about a new table, and what it gets back.
 *
 * - `import_csv` keeps the column types the parser detected, so a date column arrives as dates, not as the opaque day
 *   count 19737 with an axis reading "19700 … 20100".
 * - `create_table` can say which columns are labels (`x`) and which hold data (`y`) and what type each is, so the first
 *   group of a Column sheet is not taken for the row labels and dropped from every graph.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MadySession } from "./session";
import { buildTools } from "./tools";

const tool = (session: MadySession, name: string) => buildTools(session).find((t) => t.name === name)!;
const write = async (name: string, text: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mady-tableinput-"));
  const path = join(dir, name);
  await writeFile(path, text, "utf8");
  return path;
};

describe("import_csv keeps the detected column types", () => {
  it("a date column is typed date, so its cells read as dates, not day counts", async () => {
    const session = new MadySession();
    const path = await write("climate.csv", "Month,Temp\n2024-01-15,3.6\n2024-02-15,2.8\n2024-03-15,6.5\n");
    await tool(session, "import_csv").handler({ path });
    const t = session.document.toJSON().tables[0]!;
    expect(t.columns.map((c) => c.type)).toEqual(["date", undefined]);
  });

  it("the axis over a date column is labelled as dates", async () => {
    const session = new MadySession();
    const path = await write("climate2.csv", "Month,Temp\n2024-01-15,3.6\n2024-02-15,2.8\n2024-03-15,6.5\n2024-04-15,9.1\n");
    const id = ((await tool(session, "import_csv").handler({ path })) as { id: string }).id;
    const g = (await tool(session, "create_graph").handler({ name: "g", table: id, kind: "xy" })) as { value: { id: string } };
    const d = (await tool(session, "describe_graph").handler({ id: g.value.id })) as { axes: { x: { tickLabels: string[] } } };
    expect(d.axes.x.tickLabels.join(" "), "the date axis is still raw day numbers").not.toMatch(/197\d\d/);
    expect(d.axes.x.tickLabels.join(" ")).toMatch(/2024|Jan|Feb|Mar|Apr/);
  });

  it("a sheet with no dates has no types written (nothing is invented)", async () => {
    const session = new MadySession();
    const path = await write("plain.csv", "A,B\n1,2\n3,4\n");
    await tool(session, "import_csv").handler({ path });
    expect(session.document.toJSON().tables[0]!.columns.every((c) => c.type === undefined)).toBe(true);
  });
});

describe("create_table can say which columns are labels and data", () => {
  const rows = [[1, 2, 3], [2, 3, 4], [3, 4, 5]];

  it("roles y,y,y: all three columns of a Column sheet are groups", async () => {
    const session = new MadySession();
    const r = (await tool(session, "create_table").handler({ name: "T", kind: "column", columns: ["A", "B", "C"], rows, roles: ["y", "y", "y"] })) as { ok: boolean; value: { id: string } };
    expect(r.ok).toBe(true);
    const g = (await tool(session, "create_graph").handler({ name: "g", table: r.value.id, kind: "bar" })) as { value: { id: string } };
    const d = (await tool(session, "describe_graph").handler({ id: g.value.id })) as { series: { name: string }[] };
    expect(d.series.map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("without roles the first column of a Column sheet is read as the labels — and the reply says so", async () => {
    const session = new MadySession();
    const r = (await tool(session, "create_table").handler({ name: "T", kind: "column", columns: ["A", "B", "C"], rows })) as { ok: boolean; value: { id: string; notes?: string[] } };
    expect(r.ok).toBe(true);
    expect(r.value.notes?.join(" ") ?? "", "the loss of the first group was silent").toMatch(/roles/);
  });

  it("a labelled sheet asks for nothing: label text in the first column raises no note", async () => {
    const session = new MadySession();
    const r = (await tool(session, "create_table").handler({ name: "T", kind: "column", columns: ["Row", "A"], rows: [["one", 1], ["two", 2]] })) as { value: { notes?: string[] } };
    expect(r.value.notes).toBeUndefined();
  });

  it("the roles land on the columns, x first", async () => {
    const session = new MadySession();
    await tool(session, "create_table").handler({ name: "T", kind: "multivariable", columns: ["Sample", "Sand", "Silt", "Clay"], rows: [["a", 1, 2, 3]], roles: ["x", "y", "y", "y"] });
    expect(session.document.toJSON().tables[0]!.columns.map((c) => c.role)).toEqual(["x", "y", "y", "y"]);
  });

  it("columnTypes set the type of each column", async () => {
    const session = new MadySession();
    await tool(session, "create_table").handler({ name: "T", kind: "xy", columns: ["When", "V"], rows: [[19737, 1]], columnTypes: ["date", "number"] });
    expect(session.document.toJSON().tables[0]!.columns.map((c) => c.type)).toEqual(["date", "number"]);
  });

  it("a role list of the wrong length, an unknown role, an unknown type or an unknown table kind is refused in words", async () => {
    const session = new MadySession();
    const call = (extra: object) => tool(session, "create_table").handler({ name: "T", kind: "xy", columns: ["a", "b"], rows: [[1, 2]], ...extra }) as Promise<{ ok: boolean; error?: string }>;
    expect(await call({ roles: ["x"] })).toMatchObject({ ok: false, error: expect.stringMatching(/roles/) });
    expect(await call({ roles: ["x", "banana"] })).toMatchObject({ ok: false, error: expect.stringMatching(/banana/) });
    expect(await call({ columnTypes: ["number", "money"] })).toMatchObject({ ok: false, error: expect.stringMatching(/money/) });
    expect(await call({ kind: "nonsense" })).toMatchObject({ ok: false, error: expect.stringMatching(/nonsense/) });
    expect(session.document.toJSON().tables, "a refused call must create nothing").toHaveLength(0);
  });
});
