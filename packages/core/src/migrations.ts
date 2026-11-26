import { CURRENT_SCHEMA_VERSION } from "./model";
import type { Project } from "./model";

/**
 * Schema migrations: each step upgrades a saved document by one schema version, so a `.mady`
 * file written by any earlier version opens in the current one.
 */

/** Upgrades a raw document from version `key` to `key + 1`. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

interface IdLike {
  id?: unknown;
}

/** Keyed by source version. */
export const migrations: Record<number, Migration> = {
  // 0→1 is a no-op that just stamps the version.
  0: (raw) => ({ ...raw, schemaVersion: 1 }),
  // 1→2 adds the organizational workspace tree. Existing flat tables/plots
  // are filed into a default Project 1 → Experiment 1 so loaded docs get a tree.
  1: (raw) => {
    const tables = Array.isArray(raw["tables"]) ? (raw["tables"] as IdLike[]) : [];
    const plots = Array.isArray(raw["plots"]) ? (raw["plots"] as IdLike[]) : [];
    const members = [
      ...tables.map((t) => ({ kind: "table" as const, id: String(t.id) })),
      ...plots.map((p) => ({ kind: "plot" as const, id: String(p.id) })),
    ];
    const workspace =
      members.length === 0
        ? { folders: [], loose: [] }
        : {
            folders: [
              {
                id: "fld_1",
                name: "Project 1",
                members: [],
                experiments: [{ id: "exp_1", name: "Experiment 1", members }],
                documentation: "",
              },
            ],
            loose: [],
          };
    return { ...raw, schemaVersion: 2, workspace };
  },
  // 2→3 adds the statistics layer: a flat `analyses` store.
  2: (raw) => ({ ...raw, schemaVersion: 3, analyses: Array.isArray(raw["analyses"]) ? raw["analyses"] : [] }),
  // 3→4 adds the reproducible analysis log.
  3: (raw) => ({ ...raw, schemaVersion: 4, log: Array.isArray(raw["log"]) ? raw["log"] : [] }),
  // 4→5 re-tags the demo's PCA sheet. Projects saved before schema version 5 have no `pca`
  // table kind and carry it as a "multivariable" table, so "New graph of this data"
  // would offer the general Multiple-variables graphs (or, on the oldest builds, a bare XY)
  // instead of going straight to the PCA score plot. Matched by the demo's exact name so it
  // can never touch a user's own Multiple-variables sheet — those are legitimately used for
  // parallel coordinates / correlation matrix / regression, and re-tagging them would hijack
  // their New-graph suggestions.
  4: (raw) => {
    const tables = Array.isArray(raw["tables"]) ? (raw["tables"] as Record<string, unknown>[]) : [];
    const retagged = tables.map((t) =>
      t["kind"] === "multivariable" && t["name"] === "Cell profiling (PCA demo)" ? { ...t, kind: "pca" } : t,
    );
    return { ...raw, schemaVersion: 5, tables: retagged };
  },
};

function readVersion(doc: Record<string, unknown>, fallback: number): number {
  const v = doc["schemaVersion"];
  return typeof v === "number" ? v : fallback;
}

/** Raised when a project file was written by a newer MadY (a higher schema version than
 *  this build knows). Distinct so the caller can show a "newer version" message instead of
 *  the generic "not a valid project". */
export class NewerSchemaError extends Error {
  constructor(public readonly fileVersion: number, public readonly appVersion: number) {
    super(`This project was created by a newer version of MadY (schema v${fileVersion}); this version supports up to v${appVersion}.`);
    this.name = "NewerSchemaError";
  }
}

/** Migrate a raw (possibly older) document up to the current schema version. */
export function migrate(raw: Record<string, unknown>): Project {
  let doc = raw;
  let version = readVersion(doc, 0);
  // A file from a newer version must not load silently downgraded — refuse it.
  if (version > CURRENT_SCHEMA_VERSION) throw new NewerSchemaError(version, CURRENT_SCHEMA_VERSION);
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema v${version}`);
    doc = step(doc);
    const next = readVersion(doc, version);
    if (next <= version) {
      throw new Error(`Migration from v${version} did not advance the schema version`);
    }
    version = next;
  }
  return doc as unknown as Project;
}
