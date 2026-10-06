import { useEffect } from "react";
import { GuidePane, type GuideTarget } from "./GuidePane";

/**
 * The manual in a popup card — what a click on an Ask-bar match opens.
 *
 * It hosts the SAME `GuidePane` the Documentation tab shows (same search, same pictures, same
 * scroll-and-flash landing), so there is one manual, not a second abridged one. The card is
 * for the reader who wants the answer without leaving what they were doing; the "Open in
 * Documentation tab" button is for the reader who wants to stay and read on.
 *
 * Dismiss: Escape, a click on the backdrop, or the ⨯. A click INSIDE the card never closes it —
 * reading, scrolling and using the manual's own search must not throw the reader out.
 */
export function ManualPopup({
  target,
  version,
  onClose,
  onOpenTab,
}: {
  target: GuideTarget;
  version?: string | undefined;
  onClose: () => void;
  /** Hand the same place to the full Documentation tab. */
  onOpenTab: (target: GuideTarget) => void;
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modalov manualpop-ov" onClick={onClose}>
      <div className="modal manualpop" role="dialog" aria-label="Manual" onClick={(e) => e.stopPropagation()}>
        <div className="manualpop-head">
          <span className="manualpop-title">Manual</span>
          <button type="button" className="manualpop-tab" onClick={() => onOpenTab(target)}>
            Open in Documentation tab
          </button>
          <button type="button" className="manualpop-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="manualpop-scroll">
          <GuidePane version={version} target={target} />
        </div>
      </div>
    </div>
  );
}
