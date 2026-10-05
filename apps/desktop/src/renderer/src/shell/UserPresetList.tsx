/**
 * The user's saved presets, as one list used in two places — the Inspector's Style tab (a graph
 * is open: click a card to apply it, "+ type" adds the open graph's type-specific settings) and
 * the Settings dialog (no graph: rename, default star, export, delete). One component, one store,
 * one set of functions, so the two surfaces cannot disagree about what a preset is or holds.
 *
 * Presets are managed primarily in the Inspector side panel, with the same list repeated in
 * Settings.
 *
 * A card is two rows whatever it holds. The types line shows the open graph's type (saved, with
 * a check mark, or "+ type" to add it) and one chip counting the rest; the chip unfolds the full
 * list, one type per row with its remove button. The secondary actions — Rename, Duplicate,
 * Types…, Export…, Delete — sit behind one ⋯ menu, so the action row never wraps. Every action
 * calls the same store function from both surfaces; a surface without the callback draws no
 * control for it.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { PlotKind } from "@mady/core";
import { NEW_GRAPH_GENRES } from "./newGraph";
import type { ProfileDefault } from "./profile";
import { presetKinds } from "./userPresets";
import type { UserPreset } from "./userPresets";

/** A graph type's human name, as the New-graph dialog shows it; the id when it has none. */
export function kindLabel(kind: PlotKind): string {
  return NEW_GRAPH_GENRES.find((g) => g.plotKind === kind)?.label ?? kind;
}

/** The first eight colours of a palette as small dots. */
export function PaletteSwatches({ palette }: { palette: string[] }): ReactNode {
  if (palette.length === 0) return null;
  return (
    <span className="pc-swatches" aria-hidden>
      {palette.slice(0, 8).map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

/** "bar, pie" — the types a preset carries a section for, in words a reader knows. */
export function presetKindsText(p: Pick<UserPreset, "kinds">): string {
  return presetKinds(p).map(kindLabel).join(", ");
}

/** The chip's words: the count of types not already named on the line beside it. */
export function typesChipText(count: number, activeShown: boolean): string {
  if (count === 0) return "shared look only";
  const n = activeShown ? count - 1 : count;
  if (n === 0) return "no other type";
  return activeShown ? `${n} more type${n === 1 ? "" : "s"}` : `${n} type${n === 1 ? "" : "s"}`;
}

/** Move `id` so that it sits where `beforeId` was (before it); the rest keep their order. */
export function movedBefore(ids: readonly string[], id: string, beforeId: string): string[] {
  if (id === beforeId) return [...ids];
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(beforeId);
  if (at < 0) return [...ids];
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Move `id` one step up (−1) or down (+1); at the end it stays. */
export function movedBy(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const out = [...ids];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/** One ⋯ menu: opens under its button, closes on a choice, Escape, or focus leaving it. */
function MoreMenu({ name, items, open, onOpen, onClose }: {
  name: string;
  items: { label: string; danger?: boolean; onPick: () => void }[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}): ReactNode {
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);
  return (
    <span className="pc-more-wrap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onClose(); }}>
      <button
        type="button"
        className="swbtn pc-more"
        title="Rename, duplicate, the types it holds, export, delete"
        aria-label={`More actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? onClose() : onOpen())}
      >
        ⋯
      </button>
      {open && (
        <div className="pc-menu" role="menu" aria-label={`Actions for ${name}`} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
          {items.map((it, i) => (
            <button
              key={it.label}
              ref={i === 0 ? first : undefined}
              type="button"
              role="menuitem"
              className={it.danger ? "pc-menu-item danger" : "pc-menu-item"}
              aria-label={`${it.label.replace(/…$/, "")} ${name}`}
              onClick={() => { onClose(); it.onPick(); }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function UserPresetList({
  variant,
  presets,
  profileDefault,
  activeKind,
  canAddKind = true,
  onApply,
  onAddKind,
  onRename,
  onDuplicate,
  onRemoveKind,
  onReorder,
  onDelete,
  onSetProfileDefault,
  onExport,
  manage = true,
}: {
  /** "inspector": cards that apply on click, with "+ type". "settings": rows with a rename box. */
  variant: "inspector" | "settings";
  presets: UserPreset[];
  profileDefault: ProfileDefault;
  /** The open graph's type — only with a graph, so only the Inspector passes it. */
  activeKind?: PlotKind | undefined;
  /** False when the open graph has no type-specific setting to add (the button says so). */
  canAddKind?: boolean | undefined;
  onApply?: ((preset: UserPreset) => void) | undefined;
  onAddKind?: ((id: string) => void) | undefined;
  /** Rename: a box on the Settings row; "Rename" in the ⋯ menu turns the card's name into a box. */
  onRename?: ((id: string, name: string) => void) | undefined;
  /** Duplicate: a copy beside the original. Absent = no menu item. */
  onDuplicate?: ((id: string) => void) | undefined;
  /** Drop one graph type's section from a preset (the remove button in the unfolded type list). Absent = no remove button. */
  onRemoveKind?: ((id: string, kind: PlotKind) => void) | undefined;
  /** The list in its new order (every id, first to last). Absent = no drag handle. */
  onReorder?: ((ids: string[]) => void) | undefined;
  onDelete: (id: string) => void;
  onSetProfileDefault: (d: ProfileDefault) => void;
  /** Export this one preset to a file; absent = no menu item. */
  onExport?: ((preset: UserPreset) => void) | undefined;
  /**
   * The Inspector's simple view: false hides the action row, the type list
   * and the menu, leaving the card itself (apply on click) and its default star. The panel's "Manage…"
   * button turns it on. Settings is the management page and ignores it.
   */
  manage?: boolean | undefined;
}): ReactNode {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set());
  const ids = presets.map((p) => p.id);
  const isDefault = (id: string): boolean => profileDefault?.kind === "user" && profileDefault.id === id;
  const toggleUnfold = (id: string, to?: boolean): void =>
    setUnfolded((s) => { const n = new Set(s); const want = to ?? !n.has(id); if (want) n.add(id); else n.delete(id); return n; });

  const commitRename = (): void => {
    if (!editing) return;
    const name = editing.name.trim();
    const cur = presets.find((p) => p.id === editing.id);
    if (onRename && name && cur && name !== cur.name) onRename(editing.id, name);
    setEditing(null);
  };
  const renameKeys = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") { e.preventDefault(); commitRename(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
  };

  const star = (p: UserPreset, floating: boolean): ReactNode => (
    <button
      type="button"
      className={floating ? "swbtn pc-star" : "swbtn"}
      title={isDefault(p.id) ? "Default for new graphs (click to clear)" : `Set "${p.name}" as the default for new graphs`}
      aria-pressed={isDefault(p.id)}
      onClick={() => onSetProfileDefault(isDefault(p.id) ? null : { kind: "user", id: p.id })}
      style={floating ? undefined : { color: isDefault(p.id) ? "var(--accent)" : undefined }}
    >
      {isDefault(p.id) ? "★" : "☆"}
    </button>
  );

  /**
   * The types line — two rows at most, whatever the preset holds: the open graph's type as a
   * state (saved, or the "+ type" button), then one chip for the rest that unfolds the list.
   */
  const typesLine = (p: UserPreset): ReactNode => {
    const kinds = presetKinds(p);
    const hasActive = activeKind !== undefined && kinds.includes(activeKind);
    const activeShown = activeKind !== undefined && (hasActive || !!onAddKind);
    const open = unfolded.has(p.id);
    return (
        <span className="pc-types">
          {activeKind !== undefined && hasActive && (
            <span className="pc-kind active" title={`This preset carries ${kindLabel(activeKind)} settings — they apply to the open graph`}>
              {kindLabel(activeKind)} ✓
            </span>
          )}
          {activeKind !== undefined && !hasActive && onAddKind && (
            <button
              type="button"
              className="btn-mini pc-add"
              disabled={!canAddKind}
              title={
                canAddKind
                  ? `Add this graph's type-specific settings (${kindLabel(activeKind)}) to this preset. Its shared look stays as it is.`
                  : `This graph has no ${kindLabel(activeKind)}-specific setting to add`
              }
              aria-label={`Add ${kindLabel(activeKind)} settings to ${p.name}`}
              onClick={(e) => { e.stopPropagation(); onAddKind(p.id); }}
            >
              + {kindLabel(activeKind)}
            </button>
          )}
          <button
            type="button"
            className={kinds.length ? "pc-chip" : "pc-chip none"}
            title={kinds.length ? `Holds settings for: ${kinds.map(kindLabel).join(", ")} — click to list them` : "Only the shared look: fonts, axes, grid, legend, colours"}
            aria-label={`Show the types in ${p.name}`}
            aria-expanded={open}
            disabled={kinds.length === 0}
            onClick={(e) => { e.stopPropagation(); toggleUnfold(p.id); }}
          >
            {typesChipText(kinds.length, hasActive && activeShown)}
          </button>
        </span>
    );
  };
  /** The unfolded list, one type per row with its remove button — drawn under the row/card. */
  const typeList = (p: UserPreset): ReactNode => {
    const kinds = presetKinds(p);
    if (!unfolded.has(p.id) || kinds.length === 0) return null;
    return (
          <ul className="pc-typelist" aria-label={`Types in ${p.name}`}>
            {kinds.map((k) => (
              <li key={k}>
                <span>{kindLabel(k)}</span>
                {onRemoveKind && (
                  <button
                    type="button"
                    className="pc-kind-del"
                    title={`Drop the ${kindLabel(k)} settings from this preset — its shared look and other types stay`}
                    aria-label={`Remove ${kindLabel(k)} settings from ${p.name}`}
                    onClick={(e) => { e.stopPropagation(); onRemoveKind(p.id, k); }}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
    );
  };

  const menu = (p: UserPreset): ReactNode => {
    const items: { label: string; danger?: boolean; onPick: () => void }[] = [];
    if (onRename && variant === "inspector") items.push({ label: "Rename", onPick: () => setEditing({ id: p.id, name: p.name }) });
    if (onDuplicate) items.push({ label: "Duplicate", onPick: () => onDuplicate(p.id) });
    if (presetKinds(p).length) items.push({ label: "Types…", onPick: () => toggleUnfold(p.id, true) });
    if (onExport) items.push({ label: "Export…", onPick: () => onExport(p) });
    items.push({ label: "Delete", danger: true, onPick: () => onDelete(p.id) });
    return <MoreMenu name={p.name} items={items} open={menuFor === p.id} onOpen={() => setMenuFor(p.id)} onClose={() => setMenuFor((m) => (m === p.id ? null : m))} />;
  };

  // Ordering: the handle drags (HTML drag and drop) and answers ↑/↓; a drop lands the dragged
  // preset where the target sat. The parent gets the whole new order and persists it.
  const handle = (p: UserPreset): ReactNode =>
    onReorder ? (
      <button
        type="button"
        className="swbtn pc-handle"
        draggable
        title="Drag to reorder — or press ↑ / ↓"
        aria-label={`Move ${p.name}`}
        onDragStart={(e) => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
        onDragEnd={() => setDragId(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const next = movedBy(ids, p.id, e.key === "ArrowUp" ? -1 : 1);
          if (next.some((id, i) => id !== ids[i])) onReorder(next);
        }}
      >
        ⠿
      </button>
    ) : null;
  const dropProps = (p: UserPreset) =>
    onReorder
      ? {
          onDragOver: (e: React.DragEvent) => { if (dragId && dragId !== p.id) e.preventDefault(); },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const from = dragId ?? e.dataTransfer.getData("text/plain");
            setDragId(null);
            if (!from || from === p.id) return;
            onReorder(movedBefore(ids, from, p.id));
          },
        }
      : {};

  if (variant === "settings") {
    return (
      <div className="set-presets">
        {presets.map((p) => (
          <div className={dragId === p.id ? "set-preset pc-dragging" : "set-preset"} key={p.id} {...dropProps(p)}>
            <div className="frow">
              {handle(p)}
              <input
                type="text"
                className="numin"
                style={{ width: 160 }}
                aria-label={`Rename ${p.name}`}
                defaultValue={p.name}
                onBlur={(e) => { if (onRename && e.target.value.trim() && e.target.value !== p.name) onRename(p.id, e.target.value); }}
              />
              <span className="pc-types-cell">{typesLine(p)}</span>
              <span style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
                {star(p, false)}
                {menu(p)}
              </span>
            </div>
            {typeList(p)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {presets.map((p) => (
        <div key={p.id} className={dragId === p.id ? "pc-row pc-dragging" : "pc-row"} {...dropProps(p)}>
          {editing?.id === p.id ? (
            <div className="presetcard pc-editing">
              <input
                type="text"
                className="numin"
                autoFocus
                aria-label={`New name for ${p.name}`}
                value={editing.name}
                onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                onKeyDown={renameKeys}
                onBlur={commitRename}
              />
              <PaletteSwatches palette={p.palette} />
            </div>
          ) : (
            <button type="button" className="btn-mini presetcard" title="Apply this saved preset (style + colours)" onClick={() => onApply?.(p)}>
              <span className="pc-name">
                {p.name} <span className="pc-yours">yours</span>
              </span>
              <PaletteSwatches palette={p.palette} />
              <span className="pc-desc">Fonts, axes, frame &amp; colours</span>
            </button>
          )}
          {star(p, true)}
          {manage && (
            <div className="pc-actions">
              {handle(p)}
              {typesLine(p)}
              <span className="pc-actions-end">{menu(p)}</span>
            </div>
          )}
          {manage && typeList(p)}
        </div>
      ))}
    </>
  );
}
