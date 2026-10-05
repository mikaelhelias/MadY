import { useMemo, useState } from "react";
import type { AppAction } from "./actions";
import type { GuideTarget } from "./GuidePane";
import { manualHits } from "./guideSearch";

/**
 * CommandPalette (Ctrl-K) — fuzzy-filter every app command and run it. Renders
 * from the shared action registry (`actions.ts`), so it always mirrors the menus.
 */
export function CommandPalette({
  actions,
  onClose,
  onOpenGuide,
}: {
  actions: AppAction[];
  onClose: () => void;
  onOpenGuide: (target: GuideTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    // Every whitespace-separated term must appear somewhere, in any order. Matching
    // on the whole query as one substring would break whenever a label is
    // shortened: a row "Contingency table" under a "New table" parent never contains
    // "new contingency" as one piece of text.
    // `keywords` carries the jargon a short label dropped ("EC50", "histogram") and
    // is never displayed.
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const usable = actions.filter((a) => a.enabled !== false);
    if (terms.length === 0) return usable;
    return usable.filter((a) => {
      const hay = `${a.menu} ${a.submenu ?? ""} ${a.label} ${a.keywords ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [actions, query]);

  /**
   * …and, below the actions, what the manual can answer.
   *
   * Ctrl+K is where people already look for things by name, and half of what they type is a
   * question rather than a command — "log scale", "transparent background", "dpi". Those have
   * no action to run; they have a control somewhere and a chapter that explains it. The same
   * `manualHits` the Ask bar shows (and `searchGuide` under it, which the Documentation tab
   * uses), so the palette cannot rank things differently from the manual it opens.
   *
   * Never above the actions, and never more than five. The palette's job is to run things;
   * an answer that pushes the command you were reaching for off the top has made it worse.
   * An entry for a command the palette is already offering is dropped (`exclude`): the row
   * above runs it, and a second row pointing at its documentation is noise.
   */
  const guideHits = useMemo(
    () => manualHits(query, { exclude: new Set(matches.map((a) => a.id)), limit: 5 }),
    [query, matches],
  );

  /** One index over both lists, so the arrow keys walk straight from the last action into the
   *  manual's answers instead of stopping at a boundary the reader cannot see. */
  const total = matches.length + guideHits.length;

  const run = (a: AppAction | undefined): void => {
    if (!a) return;
    onClose();
    a.run();
  };

  const openGuideHit = (i: number): void => {
    const hit = guideHits[i];
    if (!hit) return;
    onClose();
    onOpenGuide(hit.target);
  };

  /** Activate whatever `active` is pointing at, in either list. */
  const activate = (i: number): void => {
    if (i < matches.length) run(matches[i]);
    else openGuideHit(i - matches.length);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(active);
    }
  };

  return (
    <div className="modalov palette-ov" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette-input"
          autoFocus
          placeholder="Search actions…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className="palette-list">
          {matches.length === 0 && guideHits.length === 0 && <li className="palette-empty">No matching actions</li>}
          {matches.map((a, i) => (
            <li
              key={a.id}
              className={`palette-item${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(a)}
            >
              <span className="palette-menu">{a.menu}</span>
              <span className="palette-label">{a.label}</span>
              {a.shortcut && <span className="kbd">{a.shortcut}</span>}
            </li>
          ))}
          {guideHits.length > 0 && (
            <li className="palette-group" aria-hidden="true">
              In the manual
            </li>
          )}
          {guideHits.map((h, i) => (
            <li
              key={h.id}
              className={`palette-item palette-guide${matches.length + i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(matches.length + i)}
              onClick={() => openGuideHit(i)}
            >
              <span className="palette-menu">Manual</span>
              <span className="palette-label">{h.name}</span>
              <span className="palette-what">{h.where}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
