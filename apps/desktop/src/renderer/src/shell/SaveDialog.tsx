import { useState } from "react";
import type { SavePick } from "@mady/core";
import { GuideHelp } from "./guideLink";

/** One savable object as the dialog shows it (a graph, a datasheet, a result, a figure). */
export interface SaveItem {
  kind: "table" | "plot" | "analysis" | "layout";
  id: string;
  name: string;
}
export interface SaveExperimentNode {
  id: string;
  name: string;
  members: SaveItem[];
}
export interface SaveFolderNode {
  id: string;
  name: string;
  members: SaveItem[];
  experiments: SaveExperimentNode[];
}

const KIND_WORD: Record<SaveItem["kind"], string> = {
  plot: "graph",
  table: "data",
  analysis: "result",
  layout: "figure",
};

const itemKey = (i: SaveItem): string => `${i.kind}:${i.id}`;
const expKey = (id: string): string => `exp:${id}`;
const folderKey = (id: string): string => `fld:${id}`;

/** Every checkbox key under a folder (its own objects + its experiments and theirs). */
function folderKeys(f: SaveFolderNode): string[] {
  return [
    ...f.members.map(itemKey),
    ...f.experiments.flatMap((e) => [expKey(e.id), ...e.members.map(itemKey)]),
  ];
}

type TriState = "on" | "off" | "mixed";

/** A checkbox that can also read "some of what's under me" (module scope: a component
 *  declared inside the dialog would remount on every tick and drop keyboard focus). */
function Box({ state, onChange, label }: { state: TriState; onChange: (on: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={state === "on"}
      ref={(el) => {
        if (el) el.indeterminate = state === "mixed";
      }}
      onChange={() => onChange(state !== "on")}
    />
  );
}

/**
 * SaveDialog — choose what to save before the OS save dialog: the whole project,
 * or any part of it — a project folder, one experiment, or a single graph.
 *
 * A part is written as an ordinary, self-contained `.mady`: whatever is ticked travels
 * with the data it needs (a graph carries its datasheet), so the file opens as a new
 * project. `onConfirm(null)` = everything; `onConfirm(picks)` = just those parts.
 */
export function SaveDialog({
  folders,
  loose = [],
  demoFolderId,
  onConfirm,
  onCancel,
}: {
  folders: ReadonlyArray<SaveFolderNode>;
  loose?: ReadonlyArray<SaveItem>;
  /** The built-in demo/sample project folder, if present. It starts unticked and collapsed —
   *  a user almost never means to save the demo, and expanded it buries their own work. */
  demoFolderId?: string | undefined;
  onConfirm: (picks: SavePick[] | null) => void;
  onCancel: () => void;
}) {
  const allKeys = [...folders.flatMap((f) => [folderKey(f.id), ...folderKeys(f)]), ...loose.map(itemKey)];
  const demoFolder = demoFolderId ? folders.find((f) => f.id === demoFolderId) : undefined;
  const demoKeys = new Set(demoFolder ? [folderKey(demoFolder.id), ...folderKeys(demoFolder)] : []);
  // Default: everything ticked except the demo project.
  const [checked, setChecked] = useState<Set<string>>(() => new Set(allKeys.filter((k) => !demoKeys.has(k))));
  // Default: every folder expanded except the demo project.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(demoFolder ? [demoFolder.id] : []));
  const toggleCollapse = (id: string): void =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isOn = (k: string): boolean => checked.has(k);
  /** A container is on when everything under it is on; empty ones stand on their own key. */
  const stateOf = (keys: string[], ownKey: string): TriState => {
    if (keys.length === 0) return isOn(ownKey) ? "on" : "off";
    const n = keys.filter(isOn).length;
    return n === keys.length ? "on" : n === 0 ? "off" : "mixed";
  };
  const expState = (e: SaveExperimentNode): TriState => stateOf(e.members.map(itemKey), expKey(e.id));
  const folderState = (f: SaveFolderNode): TriState => stateOf(folderKeys(f), folderKey(f.id));

  /** Tick/untick a node and everything under it. */
  const setMany = (keys: string[], on: boolean): void =>
    setChecked((s) => {
      const next = new Set(s);
      for (const k of keys) (on ? next.add(k) : next.delete(k));
      return next;
    });

  const everything = allKeys.length === 0 || allKeys.every(isOn);

  /** The minimal set of picks: a fully-ticked container is ONE pick, not N objects. */
  function picks(): SavePick[] {
    const out: SavePick[] = [];
    for (const f of folders) {
      if (folderState(f) === "on") {
        out.push({ level: "folder", id: f.id });
        continue;
      }
      for (const m of f.members) if (isOn(itemKey(m))) out.push({ level: "object", kind: m.kind, id: m.id });
      for (const e of f.experiments) {
        if (expState(e) === "on") out.push({ level: "experiment", id: e.id });
        else for (const m of e.members) if (isOn(itemKey(m))) out.push({ level: "object", kind: m.kind, id: m.id });
      }
    }
    for (const m of loose) if (isOn(itemKey(m))) out.push({ level: "object", kind: m.kind, id: m.id });
    return out;
  }

  const selection = everything ? [] : picks();
  const buttonLabel = everything
    ? "Save everything…"
    : selection.length === 1
      ? `Save this ${labelOfOne(selection[0]!, folders, loose)}…`
      : `Save ${selection.length} items…`;

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal" role="dialog" aria-label="Save project" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Save project</h3>
          <GuideHelp target={{ entry: "dialog:save-parts" }} what="Save project" />
        </div>
        {allKeys.length === 0 ? (
          <p className="note">
            Saves the whole workspace to a <code>.mady</code> file.
          </p>
        ) : (
          <>
            <p className="note" style={{ marginBottom: 8 }}>
              Save everything, or untick to save just one project folder, one experiment, or a single graph. What
              you keep is written as its own project file, carrying the data it needs.
            </p>
            <div className="savelist">
              {folders.map((f) => {
                const open = !collapsed.has(f.id);
                return (
                <div key={f.id}>
                  <div className="saverow">
                    <button
                      type="button"
                      aria-label={`${open ? "Collapse" : "Expand"} ${f.name}`}
                      aria-expanded={open}
                      title={open ? "Collapse" : "Expand"}
                      onClick={() => toggleCollapse(f.id)}
                      style={{ border: "none", background: "none", cursor: "pointer", padding: 0, marginRight: 4, width: 14, color: "var(--muted)" }}
                    >
                      {open ? "▾" : "▸"}
                    </button>
                    <Box state={folderState(f)} label={f.name} onChange={(on) => setMany([folderKey(f.id), ...folderKeys(f)], on)} />
                    <span onClick={() => setMany([folderKey(f.id), ...folderKeys(f)], folderState(f) !== "on")} style={{ cursor: "pointer" }}>{f.name}</span>
                  </div>
                  {open && f.members.map((m) => (
                    <label className="saverow" key={itemKey(m)} style={{ paddingLeft: 22 }}>
                      <Box state={isOn(itemKey(m)) ? "on" : "off"} label={m.name} onChange={(on) => setMany([itemKey(m)], on)} />
                      <span>{m.name}</span>
                      <span className="savekind">{KIND_WORD[m.kind]}</span>
                    </label>
                  ))}
                  {open && f.experiments.map((e) => (
                    <div key={e.id}>
                      <label className="saverow" style={{ paddingLeft: 22 }}>
                        <Box
                          state={expState(e)}
                          label={e.name}
                          onChange={(on) => setMany([expKey(e.id), ...e.members.map(itemKey)], on)}
                        />
                        <span>{e.name}</span>
                      </label>
                      {e.members.map((m) => (
                        <label className="saverow" key={itemKey(m)} style={{ paddingLeft: 44 }}>
                          <Box state={isOn(itemKey(m)) ? "on" : "off"} label={m.name} onChange={(on) => setMany([itemKey(m)], on)} />
                          <span>{m.name}</span>
                          <span className="savekind">{KIND_WORD[m.kind]}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                );
              })}
              {loose.map((m) => (
                <label className="saverow" key={itemKey(m)}>
                  <Box state={isOn(itemKey(m)) ? "on" : "off"} label={m.name} onChange={(on) => setMany([itemKey(m)], on)} />
                  <span>{m.name}</span>
                  <span className="savekind">{KIND_WORD[m.kind]}</span>
                </label>
              ))}
            </div>
          </>
        )}
        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            disabled={!everything && selection.length === 0}
            onClick={() => onConfirm(everything ? null : selection)}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Save this graph…" reads better than "Save 1 item…" — name what the single pick is. */
function labelOfOne(
  pick: SavePick,
  folders: ReadonlyArray<SaveFolderNode>,
  loose: ReadonlyArray<SaveItem>,
): string {
  if (pick.level === "folder") return "project folder";
  if (pick.level === "experiment") return "experiment";
  const all = [...folders.flatMap((f) => [...f.members, ...f.experiments.flatMap((e) => e.members)]), ...loose];
  const item = all.find((m) => m.kind === pick.kind && m.id === pick.id);
  return item ? KIND_WORD[item.kind] : "item";
}
