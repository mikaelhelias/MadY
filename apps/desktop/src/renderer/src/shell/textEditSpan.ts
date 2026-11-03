/**
 * Where the inline text editor sits, and how wide it is, for the text typed so far.
 *
 * The editor opens over the text it edits, as wide as that text. It grows with the longest typed line, so a title
 * typed longer than the old one stays in view instead of wrapping inside the old width. It grows the way the text
 * itself does: a centred text both ways, a right-aligned one to the left, a left-aligned one to the right. It never
 * runs past the figure's edges.
 */
import { estimateTextWidth } from "@mady/graphics";

export interface TextEditSpanInput {
  /** The text typed so far (a multi-line text holds line breaks). */
  value: string;
  /** Left edge and width of the text the editor opened over, in px within the figure. */
  left: number;
  width: number;
  anchor: "start" | "middle" | "end";
  /** Extra width beyond the text: room for the caret, or for the resize grip of a multi-line box. */
  pad: number;
  /** The figure's width: the editor stays inside it. */
  room?: number | undefined;
  /** How wide one line reads in the editor's font. */
  lineWidth: (line: string) => number;
}

export function textEditSpan(o: TextEditSpanInput): { left: number; width: number } {
  const longest = Math.max(0, ...o.value.split("\n").map(o.lineWidth));
  const opened = o.width + o.pad;
  let width = Math.max(o.width, longest) + o.pad;
  const grow = width - opened;
  let left = o.anchor === "middle" ? o.left - grow / 2 : o.anchor === "end" ? o.left - grow : o.left;
  if (o.room !== undefined && o.room > 0) {
    width = Math.min(width, o.room);
    left = Math.min(left, o.room - width);
  }
  return { left: Math.max(0, left), width };
}

/**
 * How wide a line reads in the given font, measured by the page itself; the plain estimate where the page cannot
 * measure (no layout, as in a test without a browser).
 */
export function measureLineIn(font: { size: number; weight?: string | undefined; family?: string | undefined; style?: string | undefined }): (line: string) => number {
  return (line) => {
    if (typeof document === "undefined") return estimateTextWidth(line, font.size);
    if (!probe || !probe.isConnected) {
      probe = document.createElement("span");
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", left: "-9999px", top: "0" });
      document.body.appendChild(probe);
    }
    Object.assign(probe.style, {
      fontSize: `${font.size}px`, fontWeight: font.weight ?? "normal", fontFamily: font.family ?? "inherit", fontStyle: font.style ?? "normal",
    });
    probe.textContent = line;
    const w = probe.getBoundingClientRect().width;
    return w > 0 ? w : estimateTextWidth(line, font.size);
  };
}
/** One hidden element, shared by every editor, that the lines are measured in. */
let probe: HTMLSpanElement | null = null;
