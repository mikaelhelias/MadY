/**
 * SuggestionsPopover — the opt-in dropdown of ranked next-step suggestions, opened from the
 * toolbar "Assistant" button. Complements the single inline nudge (which shows only the top
 * high-confidence tip) by surfacing the full ranked list. Reuses the Analyze dialog's
 * recommendation card visual (`.an-rec*`) so the two surfaces read as one system.
 *
 * Content is concise by default (title + one-line rationale + a confidence chip) and expands
 * on demand (Why this / Check first / Other options). Invisible-until-helpful: an empty list
 * shows a calm "all caught up" state, never a repeated warning.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Sparkles, X } from "lucide-react";
import type { Suggestion } from "./assistant";

interface Props {
  /** The ranked, not-yet-dismissed suggestions (general + analysis). */
  suggestions: Suggestion[];
  /** Run a suggestion (open Analyze prefilled, or execute the registry action). */
  onRun: (s: Suggestion) => void;
  /** Dismiss a suggestion by id. */
  onDismiss: (id: string) => void;
  /** Close the popover (Escape / click-outside / after a Run). */
  onClose: () => void;
  /** Bring back everything the user has dismissed (optional footer link). */
  onResetDismissed?: (() => void) | undefined;
}

function section(title: string, items?: string[]): ReactNode {
  const list = (items ?? []).filter((t) => t.trim().length > 0);
  if (list.length === 0) return null;
  return (
    <div className="an-rec-section">
      <div className="an-rec-section-title">{title}</div>
      <ul className="an-rec-bullets">
        {list.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export function SuggestionsPopover({ suggestions, onRun, onDismiss, onClose, onResetDismissed }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Close on click-outside or Escape (capture phase so it beats other pointer handlers).
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="sugg-pop" role="menu" aria-label="Suggestions" ref={rootRef}>
      <div className="sugg-pop-head">
        <Sparkles size={13} className="sugg-pop-ico" aria-hidden /> Suggestions
      </div>
      {suggestions.length === 0 ? (
        <p className="sugg-empty">You’re all caught up — no suggestions right now.</p>
      ) : (
        <ul className="sugg-list">
          {suggestions.map((s) => {
            const detail = s.reasons?.[0];
            const canExpand = Boolean((s.reasons?.length ?? 0) > 1 || s.caveats?.length || s.assumptions?.length || s.alternatives?.length);
            const open = expanded === s.id;
            return (
              <li key={s.id} className={"sugg-item an-rec" + (open ? " is-open" : "")} role="menuitem">
                <div className="sugg-item-row">
                  <span className="sugg-item-main">
                    <span className="an-rec-title">{s.text}</span>
                    {detail && <span className="an-rec-text">{detail}</span>}
                  </span>
                  {s.confidence && <span className={`an-rec-confidence an-rec-${s.confidence}`}>{s.confidence}</span>}
                </div>
                <div className="sugg-item-actions">
                  <button type="button" className="btn-mini on" onClick={() => { onRun(s); onClose(); }}>
                    {s.cta}
                  </button>
                  {canExpand && (
                    <button type="button" className="sugg-why" aria-expanded={open} onClick={() => setExpanded(open ? null : s.id)}>
                      {open ? "Hide" : "Why?"}
                    </button>
                  )}
                  <span className="sugg-spacer" />
                  <button type="button" className="ast-x" title="Dismiss" aria-label="Dismiss suggestion" onClick={() => onDismiss(s.id)}>
                    <X size={13} />
                  </button>
                </div>
                {open && (
                  <div className="an-rec-details">
                    {section("Why this", s.reasons)}
                    {section("Check first", [...(s.assumptions ?? []), ...(s.caveats ?? [])])}
                    {section("Other options", s.alternatives)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {onResetDismissed && (
        <button type="button" className="sugg-reset" onClick={onResetDismissed}>
          Show dismissed suggestions
        </button>
      )}
    </div>
  );
}
