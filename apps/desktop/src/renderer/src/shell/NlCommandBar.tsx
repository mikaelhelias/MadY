import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentResult, NLResult } from "@mady/core";
import type { GuideTarget } from "./GuidePane";
import { manualHits, markSegments } from "./guideSearch";

/** A row's text with the typed words marked — the reader sees why the row matched. */
function Marked({ text, query }: { text: string; query: string }): React.ReactElement {
  return (
    <>
      {markSegments(text, query).map((s, i) =>
        s.hit ? (
          <mark key={i} className="askbar-mark">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** What `onRun` returns: what the text parsed to, and (if it parsed) how executing went. */
export interface NlRunOutcome {
  compiled: NLResult;
  results?: AgentResult[];
}

/**
 * The Ask box — at the far right of the menu bar, where it is always visible. One input, one
 * "Search" button, and a popover under the box that carries the answer.
 *
 * Two things happen to a line, and the popover shows both:
 *  • The manual. Two characters in, the matching controls and chapters are listed (the same
 *    `manualHits` Ctrl+K shows); clicking one opens the manual at that place via
 *    `onOpenManual`. Without that wiring no list is drawn — a row that could go nowhere would
 *    be a button that does nothing.
 *  • A command. Search / Enter hands the line to `onRun` — the offline parser plus the command
 *    executor (`executeAgentBatch`) on the live document, deterministic and local, no model, no network. A line that
 *    parses runs and says so; one that does not parse shows the parser's own error and hint
 *    only when the manual has nothing either — "axis break" is a question, not a failed
 *    command, and the manual's answer is the answer.
 *
 * Nothing is stored: there is no open state to remember.
 */
export function NlCommandBar({
  onRun,
  onOpenManual,
}: {
  onRun: (text: string) => NlRunOutcome;
  /** Open the manual (in a popup) at a matched control or chapter. */
  onOpenManual?: ((target: GuideTarget) => void) | undefined;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<NlRunOutcome | null>(null);
  /** Closed by Escape, an outside click or a chosen match; reopened by typing. */
  const [dismissed, setDismissed] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  const hits = useMemo(() => (onOpenManual ? manualHits(text, { limit: 5 }) : []), [text, onOpenManual]);
  const open = !dismissed && (hits.length > 0 || outcome !== null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setDismissed(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    setOutcome(onRun(t));
    setDismissed(false);
  };

  // A parse failure is only worth showing when the manual has nothing either.
  const showOutcome = outcome && (outcome.compiled.ok || hits.length === 0);

  return (
    <div className="askbar" ref={root}>
      <input
        className="askbar-in"
        value={text}
        placeholder="Ask, or search the manual…"
        aria-label="Ask MadY, or search the manual"
        title="Type what you want — a command in plain words, or a question the manual can answer"
        onChange={(e) => {
          setText(e.target.value);
          setOutcome(null);
          setDismissed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") setDismissed(true);
        }}
      />
      <button className="askbar-go" onClick={submit} disabled={!text.trim()}>
        Search
      </button>
      {open && (
        <div className="askbar-pop" role="region" aria-label="Ask results">
          {showOutcome && <NlFeedback outcome={outcome} />}
          {hits.length > 0 && onOpenManual && (
            <div className="askbar-manual" aria-label="In the manual">
              <div className="askbar-manual-h">In the manual</div>
              {hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  className="askbar-hit"
                  title="Open the manual here"
                  onClick={() => {
                    setDismissed(true);
                    onOpenManual(h.target);
                  }}
                >
                  <span className="askbar-hit-name"><Marked text={h.name} query={text} /></span>
                  <span className="askbar-hit-what"><Marked text={h.where} query={text} /></span>
                </button>
              ))}
            </div>
          )}
          {/* A statement of scope, not decoration. The parser's vocabulary is small (chart
              words, analysis phrasings, axis edits, list), so the hint says so and a line
              that misses reads as unfinished rather than broken. */}
          <div className="askbar-hint">
            In development — it understands a small set of phrasings so far, so stay close to the
            examples. Offline: no model, no network. Try “scatter of dose vs response”, “run a
            t-test on A and B”, “log the x axis”, or “list graphs”.
          </div>
        </div>
      )}
    </div>
  );
}

/** One-line result: the parse error (with its hint), an execution failure, or success. */
function NlFeedback({ outcome }: { outcome: NlRunOutcome }): React.ReactElement {
  const { compiled, results } = outcome;
  if (!compiled.ok) {
    return <div className="askbar-fb askbar-err">{compiled.error}{compiled.hint ? ` — ${compiled.hint}` : ""}</div>;
  }
  const failed = results?.find((r) => !r.ok);
  if (failed && !failed.ok) return <div className="askbar-fb askbar-err">Couldn’t apply that: {failed.error}</div>;
  const ops = compiled.commands.map((c) => c.op).join(", ");
  return <div className="askbar-fb askbar-ok">Done · {ops}{compiled.note ? ` — ${compiled.note}` : ""}</div>;
}
