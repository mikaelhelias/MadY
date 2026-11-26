import { useState } from "react";
import { X } from "lucide-react";
import type { LayoutPreset } from "./layout";

/**
 * LayoutMenu — a small popover to apply / save / delete named workspace layouts
 * (built-in + user presets). Opened from the status-bar Layout control and the
 * View → Layouts… action.
 */
export function LayoutMenu({
  builtins,
  user,
  onApply,
  onSave,
  onDelete,
  onClose,
}: {
  builtins: LayoutPreset[];
  user: LayoutPreset[];
  onApply: (preset: LayoutPreset) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  const apply = (p: LayoutPreset): void => {
    onApply(p);
    onClose();
  };
  const save = (): void => {
    if (name.trim()) {
      onSave(name.trim());
      setName("");
    }
  };

  return (
    <div className="modalov layout-ov" onClick={onClose}>
      <div className="layoutmenu" role="dialog" aria-label="Layouts" onClick={(e) => e.stopPropagation()}>
        <div className="drophead">Layouts</div>
        {builtins.map((p) => (
          <button key={p.name} className="layoutitem" onClick={() => apply(p)}>
            {p.name}
          </button>
        ))}
        {user.length > 0 && <div className="dropsep" />}
        {user.map((p) => (
          <div className="layoutrow" key={p.name}>
            <button className="layoutitem" onClick={() => apply(p)}>
              {p.name}
            </button>
            <button className="layoutdel" title={`Delete "${p.name}"`} onClick={() => onDelete(p.name)}>
              <X size={13} />
            </button>
          </div>
        ))}
        <div className="dropsep" />
        <div className="layoutsave">
          <input
            className="layoutname"
            placeholder="Save current as…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
          <button className="btn" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
