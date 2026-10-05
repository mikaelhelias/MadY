/**
 * The model bar — the second typing box, on the ribbon, at its right end under the Ask box.
 *
 * Present only once a model is ready. Until the set-up button beside it has finished
 * (runtime answering, model present), this renders nothing — not a disabled box, nothing:
 * a box that cannot be typed into would be a control that does nothing.
 *
 * Enter hands the line to `compile` (main: exact parser first, the model second) and then
 * applies the commands at once through `apply` — the app's own `mutate`, one undo entry, the
 * same path every click takes. The popover under the box then lists what was done, in words,
 * with Undo beside it (immediate apply with undo; no preview click — every
 * model request already costs seconds, and undo is one press).
 *
 * The model's own caution ("written by the model — check it") is shown when it is there. A
 * refusal shows the error and hint; a dead server names the set-up button as the way back.
 */
import { useEffect, useRef, useState } from "react";
import type { AgentResult } from "@mady/core";

export interface ModelBarCompileResult {
  ok: boolean;
  commands?: Record<string, unknown>[];
  note?: string;
  error?: string;
  hint?: string;
}

type Outcome =
  | { kind: "busy" }
  | { kind: "done"; lines: { text: string; error?: string }[]; note?: string | undefined }
  | { kind: "refused"; error: string; hint?: string | undefined; serverDown: boolean };

export function ModelBar({
  ready,
  compile,
  apply,
  undo,
  describe,
  onSetup,
  placeholder = "Tell the LLM what to change…",
}: {
  /** From `model:status`. False → nothing is rendered. */
  ready: boolean;
  compile: (text: string) => Promise<ModelBarCompileResult>;
  /** Run the commands through the app's own mutate; one result per command. */
  apply: (commands: Record<string, unknown>[]) => AgentResult[];
  undo: () => void;
  describe: (command: Record<string, unknown>) => string;
  /** Open the set-up dialog (offered when the server does not answer). */
  onSetup: () => void;
  placeholder?: string;
}): React.ReactElement | null {
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const inFlight = useRef(false);

  // Close on an outside click.
  useEffect(() => {
    if (!outcome) return;
    const onDown = (e: MouseEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOutcome(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [outcome]);

  if (!ready) return null;

  const submit = async (): Promise<void> => {
    const line = text.trim();
    if (!line || inFlight.current) return;
    inFlight.current = true;
    setOutcome({ kind: "busy" });
    try {
      const r = await compile(line);
      if (!r.ok || !r.commands) {
        const error = r.error ?? "the line could not be turned into commands";
        setOutcome({ kind: "refused", error, hint: r.hint, serverDown: /could not answer|could not be asked|not answering|fetch failed|ECONNREFUSED/i.test(error) });
        return;
      }
      const results = apply(r.commands);
      const lines = r.commands.map((c, i) => {
        const res = results[i];
        return res && !res.ok ? { text: describe(c), error: res.error } : { text: describe(c) };
      });
      setOutcome({ kind: "done", lines, note: r.note });
    } catch (e) {
      setOutcome({ kind: "refused", error: e instanceof Error ? e.message : String(e), serverDown: true });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="modelbar" ref={root}>
      <input
        className="modelbar-in"
        value={text}
        placeholder={placeholder}
        aria-label="Tell the LLM what to change"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            setOutcome(null);
          }
        }}
      />
      {outcome && (
        <div className="modelbar-pop" role="region" aria-label="What the model did">
          {outcome.kind === "busy" && <div className="modelbar-busy">Asking the model…</div>}
          {outcome.kind === "done" && (
            <>
              <div className="modelbar-head">
                <span>Done</span>
                <button
                  className="btn-mini"
                  onClick={() => {
                    undo();
                    setOutcome(null);
                  }}
                >
                  Undo
                </button>
              </div>
              <ul className="modelbar-list">
                {outcome.lines.map((l, i) => (
                  <li key={i} className={l.error ? "modelbar-refused" : undefined}>
                    {l.text}
                    {l.error ? ` — refused: ${l.error}` : ""}
                  </li>
                ))}
              </ul>
              {outcome.note && <div className="modelbar-note">{outcome.note}</div>}
            </>
          )}
          {outcome.kind === "refused" && (
            <div className="modelbar-err">
              <div>{outcome.error}</div>
              {outcome.hint && <div className="modelbar-hint">{outcome.hint}</div>}
              {outcome.serverDown && (
                <button className="btn-mini" onClick={onSetup}>
                  Open the set-up
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
