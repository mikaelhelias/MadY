/**
 * AssistantNudge - the dismissible, context-aware "next step" nudge.
 * Renders nothing when there is no suggestion. Shows one
 * suggestion at a time: a prompt, a call-to-action that runs an existing app action
 * or opens Analyze with a prefilled recommendation, and a dismiss button.
 */
import { Sparkles, X } from "lucide-react";
import type { Suggestion } from "./assistant";

interface Props {
  /** The top non-dismissed suggestion, or null when nothing applies. */
  suggestion: Suggestion | null;
  /** Run the suggestion. Generic suggestions use actionId; analysis suggestions carry richer metadata. */
  onRun: (suggestion: Suggestion) => void;
  /** Dismiss this suggestion (by id); the app keeps dismissed ids across reloads. */
  onDismiss: (id: string) => void;
}

export function AssistantNudge({ suggestion, onRun, onDismiss }: Props) {
  if (!suggestion) return null;
  const detail = suggestion.kind === "analysis" ? suggestion.reasons?.[0] ?? suggestion.caveats?.[0] : undefined;
  return (
    <div className="ast-nudge" role="note" aria-label="Suggestion">
      <Sparkles size={13} className="ast-ico" aria-hidden />
      <span className="ast-text">
        <span className="ast-summary">
          {suggestion.confidence && <span className={`an-rec-confidence an-rec-${suggestion.confidence} ast-conf`}>{suggestion.confidence}</span>}
          {suggestion.text}
        </span>
        {detail && <span className="ast-detail">{detail}</span>}
      </span>
      <button type="button" className="ast-cta" onClick={() => onRun(suggestion)}>
        {suggestion.cta}
      </button>
      <button type="button" className="ast-x" title="Dismiss" aria-label="Dismiss suggestion" onClick={() => onDismiss(suggestion.id)}>
        <X size={13} />
      </button>
    </div>
  );
}
