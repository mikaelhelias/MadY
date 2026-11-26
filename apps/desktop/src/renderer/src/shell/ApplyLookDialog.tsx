/**
 * ApplyLookDialog — apply one graph's look to others. Copies the active graph's
 * look (house style — size / fonts / axes / colours / background, kind-agnostic) onto
 * an explicitly chosen set of other graphs, in one undoable step. Any graph can be a
 * target, not only those drawn from the same data: pick which graphs, pick which
 * aspect, apply.
 *
 * The dialog only picks (target ids + the MATCH_KEYS aspect); AppShell captures the
 * style (`capturePlotStyle`) and applies it (`applyPlotTemplateMany`).
 */
import { useState } from "react";
import type { NodeId, Plot } from "@mady/core";
import { MATCH_KEYS } from "./templates";
import { GuideHelp } from "./guideLink";

type Aspect = keyof typeof MATCH_KEYS; // "all" | "size" | "fonts" | "axes" | "colours"

const ASPECTS: { id: Aspect; label: string; hint: string }[] = [
  { id: "all", label: "Everything", hint: "Size, fonts, axes, colours & background" },
  { id: "colours", label: "Colours", hint: "The colour palette" },
  { id: "fonts", label: "Fonts", hint: "All text" },
  { id: "axes", label: "Axes & frame", hint: "Axis look, gridlines, frame, ticks" },
  { id: "size", label: "Size", hint: "Figure & plot dimensions" },
];

interface Props {
  source: Plot;
  plots: Plot[];
  /** Resolve a source-table id → its name (for the per-graph subtitle). */
  tableName: (id: NodeId) => string;
  /** Apply the chosen aspect's keys to the chosen target graphs (one undo). */
  onApply: (targetIds: NodeId[], keys: (keyof Plot)[], aspectLabel: string) => void;
  onCancel: () => void;
}

export function ApplyLookDialog({ source, plots, tableName, onApply, onCancel }: Props) {
  const targets = plots.filter((p) => p.id !== source.id);
  const siblingIds = new Set(targets.filter((p) => p.source === source.source).map((p) => p.id));
  // Pre-check the graphs drawn from the same data, but every graph is selectable.
  const [selected, setSelected] = useState<Set<NodeId>>(() => new Set(siblingIds));
  const [aspect, setAspect] = useState<Aspect>("all");

  const toggle = (id: NodeId): void =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const apply = (): void => {
    if (!selected.size) return;
    const a = ASPECTS.find((x) => x.id === aspect)!;
    onApply([...selected], MATCH_KEYS[aspect], a.label);
  };

  return (
    <div className="modalov" onClick={onCancel}>
      <div className="modal modal-applylook" role="dialog" aria-label="Apply this look" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Apply “{source.name}” look to…</h3>
          <GuideHelp target={{ entry: "action:apply-look" }} what="Apply this look to other graphs" />
        </div>

        {targets.length === 0 ? (
          <p className="note">There are no other graphs to apply this look to yet.</p>
        ) : (
          <>
            <div className="an-group-h">What to copy</div>
            <div className="al-aspect" role="group" aria-label="What to copy">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`ng-segbtn${aspect === a.id ? " is-active" : ""}`}
                  aria-pressed={aspect === a.id}
                  title={a.hint}
                  onClick={() => setAspect(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>

            <div className="al-tools">
              <div className="an-group-h" style={{ margin: 0 }}>Graphs</div>
              <span className="al-count">{selected.size} selected</span>
              <button type="button" className="btn-mini" onClick={() => setSelected(new Set(targets.map((p) => p.id)))}>Select all</button>
              <button type="button" className="btn-mini" onClick={() => setSelected(new Set())}>None</button>
            </div>
            <div className="al-list" role="group" aria-label="Target graphs">
              {targets.map((p) => (
                <label key={p.id} className="al-row">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={p.name} />
                  <span className="al-name">{p.name}</span>
                  <span className="al-src">{tableName(p.source)}{siblingIds.has(p.id) ? " · same data" : ""}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="modalbtns">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" onClick={apply} disabled={selected.size === 0}>
            {selected.size ? `Apply to ${selected.size} graph${selected.size === 1 ? "" : "s"}` : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
