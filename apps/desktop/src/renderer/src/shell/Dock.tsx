import { useRef } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import type { SideDockId } from "./layout";
import { clampWidth, DOCK_TITLE } from "./layout";

/**
 * ResizeDivider — a draggable border between two columns that resizes the side
 * dock it controls. `sign` is +1 when dragging right widens the controlled dock
 * (dock is left of the divider), −1 when it's to the right.
 */
export function ResizeDivider({
  width,
  sign,
  onResize,
  onCommit,
  onDoubleClick,
}: {
  width: number;
  sign: 1 | -1;
  onResize: (px: number) => void;
  onCommit: () => void;
  onDoubleClick: () => void;
}) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div
      className="dockdivider"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to collapse"
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: width };
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onResize(clampWidth(start.current.w + sign * (e.clientX - start.current.x)));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        start.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onCommit();
      }}
    />
  );
}

/**
 * Dock — frame around a movable side panel (Navigator / Inspector). Provides the
 * slim header (drag handle → rearrange, title, collapse chevron) and, when
 * collapsed, a thin rail with an expand button. The center document column has no
 * Dock chrome.
 */
export function Dock({
  id,
  side,
  collapsed,
  onToggle,
  onDragStart,
  children,
}: {
  id: SideDockId;
  /** Which edge the collapse/expand chevron points toward. */
  side: "left" | "right";
  collapsed: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
  children: ReactNode;
}) {
  const title = DOCK_TITLE[id];

  if (collapsed) {
    return (
      <div className={`dockrail dockrail-${side}`}>
        <button className="dockexpand" title={`Expand ${title}`} onClick={onToggle}>
          {side === "left" ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <span className="dockraillabel">{title}</span>
      </div>
    );
  }

  return (
    <div className={`dock dock-${side}`}>
      <div className="dockhead" draggable onDragStart={onDragStart} title="Drag to rearrange">
        <GripVertical size={13} className="dockgrip" />
        <span className="docktitle">{title}</span>
        <button className="dockcollapse" title={`Collapse ${title}`} onClick={onToggle}>
          {side === "left" ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      <div className="dockbody">{children}</div>
    </div>
  );
}
