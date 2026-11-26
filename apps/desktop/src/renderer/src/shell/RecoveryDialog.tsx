import type { AutosaveSnapshot } from "../../../preload";
import { formatAge } from "./autosave";
import { GuideHelp } from "./guideLink";

/**
 * RecoveryDialog — shown at startup when the previous session left an autosave
 * slot behind (i.e. it crashed). Recovering loads the snapshot into memory
 * only; it never overwrites a file on disk. The backdrop
 * is intentionally non-dismissable so a stray click can't discard the work.
 */
export function RecoveryDialog({
  snapshot,
  ageMs,
  onRecover,
  onDiscard,
}: {
  snapshot: AutosaveSnapshot;
  ageMs: number;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="modalov">
      <div
        className="modal"
        role="dialog"
        aria-label="Recover unsaved work"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalh-row">
          <h3 className="modalh">Recover unsaved work?</h3>
          <GuideHelp target={{ entry: "dialog:recovery" }} what="Recover unsaved work" />
        </div>
        <p className="note">
          MadY closed unexpectedly. An autosaved copy of <strong>{snapshot.name}</strong> from{" "}
          {formatAge(ageMs)} was found.
        </p>
        <p className="note" style={{ marginTop: 8, opacity: 0.75 }}>
          Recovering won&rsquo;t overwrite any file on disk — you&rsquo;ll still choose where to save.
        </p>
        <div className="modalbtns">
          <button className="btn-ghost" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn" onClick={onRecover}>
            Recover
          </button>
        </div>
      </div>
    </div>
  );
}
