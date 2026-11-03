import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A toolbar button that opens a panel of controls under it — the figure toolbar's Align ▾ / Line up ▾ / Insert ▾ /
 * Style ▾.
 *
 * The datasheet toolbar's menu (`antb-menuwrap` / `antb-menupanel`: CellFillMenu, MethodsMenu), with two differences the
 * figure's menus need:
 *  • it closes on a press outside it or on Escape — never on mouse-leave, because Style ▾ holds <select>s whose native
 *    option lists open outside the panel, and leaving the panel to pick one would close it under the pointer;
 *  • `closeOnPick` closes it after an action (an enabled button inside), while a menu of switches (Align ▾) stays open
 *    so several can be ticked in a row. A button inside `[data-keep-open]` never closes it (Add image… — see below).
 * A `disabled` menu has nothing to offer right now: it cannot open, and its `title` says why.
 */
export function ToolbarMenu({
  label,
  title,
  disabled = false,
  closeOnPick = false,
  children,
}: {
  label: string;
  title: string;
  disabled?: boolean | undefined;
  closeOnPick?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const shown = open && !disabled;
  return (
    <span className="antb-menuwrap laymenu" ref={ref}>
      <button
        type="button"
        className={`laychip laymenu-btn${shown ? " on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={shown}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label}&nbsp;▾
      </button>
      {shown && (
        <div
          className="antb-menupanel laymenu-panel"
          role="menu"
          aria-label={label}
          onClick={closeOnPick ? (e) => {
            const b = e.target instanceof Element ? e.target.closest("button") : null;
            // …except inside [data-keep-open]: Add image…'s file input lives in its own component, and closing the menu
            // on its click would unmount the input before the chosen file arrives.
            if (b && !b.disabled && !b.closest("[data-keep-open]")) setOpen(false);
          } : undefined}
        >
          {children}
        </div>
      )}
    </span>
  );
}
