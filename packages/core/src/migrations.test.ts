import { describe, expect, it } from "vitest";
import { migrate, NewerSchemaError } from "./migrations";
import { CURRENT_SCHEMA_VERSION, emptyWorkspace } from "./model";

describe("migrations", () => {
  it("upgrades a v0 document to the current schema (adds the empty workspace)", () => {
    const migrated = migrate({ schemaVersion: 0, tables: [], plots: [] });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.tables).toEqual([]);
    expect(migrated.plots).toEqual([]);
    expect(migrated.analyses).toEqual([]); // v2→v3 adds the statistics store
    expect(migrated.log).toEqual([]); // v3→v4 adds the analysis log
    expect(migrated.workspace).toEqual(emptyWorkspace());
  });

  it("treats a document with no schemaVersion as v0 and upgrades it", () => {
    const migrated = migrate({ tables: [], plots: [] });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.workspace).toEqual(emptyWorkspace());
  });

  it("returns an already-current document unchanged", () => {
    const current = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tables: [],
      plots: [],
      analyses: [],
      log: [],
      workspace: emptyWorkspace(),
    };
    const migrated = migrate(current);
    expect(migrated).toEqual(current);
  });

  it("refuses a FUTURE-version file instead of silently downgrading it", () => {
    const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 1, tables: [], plots: [] };
    expect(() => migrate(future)).toThrow(NewerSchemaError);
    try {
      migrate(future);
    } catch (e) {
      expect((e as NewerSchemaError).fileVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
      expect((e as Error).message).toContain("newer version");
    }
  });

  it("v4→v5 re-tags the demo PCA sheet that pre-dated the `pca` table kind", () => {
    const migrated = migrate({
      schemaVersion: 4,
      tables: [
        { id: "t1", kind: "multivariable", name: "Cell profiling (PCA demo)", columns: [], rows: [] },
        // A user's OWN Multiple-variables sheet must be left exactly as it is.
        { id: "t2", kind: "multivariable", name: "My proteomics panel", columns: [], rows: [] },
      ],
      plots: [], analyses: [], log: [], workspace: emptyWorkspace(),
    });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.tables[0]!.kind, "the demo PCA sheet was not re-tagged").toBe("pca");
    expect(migrated.tables[1]!.kind, "a user's multivariable sheet was hijacked").toBe("multivariable");
  });

  it("v1→v2 files existing flat tables/plots into a default project → experiment", () => {
    const migrated = migrate({
      schemaVersion: 1,
      tables: [{ id: "tbl_1", kind: "xy", name: "T", columns: [], rows: [] }],
      plots: [{ id: "plt_1", name: "P", source: "tbl_1", status: "ok", styleOverrides: {} }],
    });
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.workspace.loose).toEqual([]);
    expect(migrated.workspace.folders).toHaveLength(1);
    const experiment = migrated.workspace.folders[0]!.experiments[0]!;
    expect(experiment.members).toEqual([
      { kind: "table", id: "tbl_1" },
      { kind: "plot", id: "plt_1" },
    ]);
  });
});
