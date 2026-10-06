/**
 * Export all — every graph and figure of the project into one folder, in one format.
 *
 * Pure orchestration: the caller mounts each item where it can be drawn (the off-screen stage) and writes the files
 * (main `file:exportMany`). Each file is built by the same code as the Export dialog (`payloadForFormat`) at the size
 * the dialog would start with (`defaultExportSize`: the graph's own print width, else its shown size). One item that
 * cannot be drawn is reported and the rest still export.
 */
import type { ExportPayload } from "../../../preload";
import { defaultExportSize } from "./exportSize";
import { payloadForFormat } from "./exportPayload";
import type { ExportBackground, ExportFormat, SerializedSvg } from "./exporters";

export interface BatchItem {
  id: string;
  kind: "graph" | "figure";
  name: string;
  /** The item's own print width (a graph's Print size, a figure's page width), mm. */
  printWidthMm?: number | undefined;
  /** A graph's shown scale (graphDisplay.ts); the default pixel size is the size it is shown at. */
  displayScale?: number | undefined;
}

/** One item drawn and ready to read. */
export interface MountedItem {
  serialize: (bg: ExportBackground) => SerializedSvg | null;
}

/** A file name made safe the way the single-file Save dialog makes it (`main/index.ts`): anything but letters, digits,
 *  `.`, `-`, `_` becomes `_`. */
export function safeFileStem(s: string): string {
  return s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}

/**
 * The file names for a batch: `pattern` with `{name}`, `{kind}` (graph / figure) and `{n}` (1, 2, …) filled in, made
 * safe, and never twice the same (case-insensitive, as on Windows): a repeat gets `-2`, `-3`, … before the extension.
 */
export function batchFileNames(items: ReadonlyArray<Pick<BatchItem, "name" | "kind">>, pattern: string, ext: string): string[] {
  const used = new Set<string>();
  return items.map((it, i) => {
    const stem = safeFileStem((pattern || "{name}").replace(/\{name\}/g, it.name).replace(/\{kind\}/g, it.kind).replace(/\{n\}/g, String(i + 1)));
    let name = `${stem}.${ext}`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${stem}-${k}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export interface BatchResult {
  written: string[];
  failed: { name: string; error: string }[];
}

export async function runBatchExport(o: {
  items: BatchItem[];
  format: ExportFormat;
  dpi: number;
  background: ExportBackground;
  pattern: string;
  mount: (item: BatchItem) => Promise<MountedItem | null>;
  write: (files: { name: string; payload: ExportPayload }[]) => Promise<{ name: string; ok: boolean; error?: string | undefined }[]>;
  onProgress?: ((done: number, total: number) => void) | undefined;
  /** Files sent to disk per call (a raster batch is large). */
  chunk?: number | undefined;
}): Promise<BatchResult> {
  const names = batchFileNames(o.items, o.pattern, o.format);
  const out: BatchResult = { written: [], failed: [] };
  let pending: { name: string; payload: ExportPayload }[] = [];
  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    const res = await o.write(pending);
    for (const r of res) {
      if (r.ok) out.written.push(r.name);
      else out.failed.push({ name: r.name, error: r.error ?? "not written" });
    }
    pending = [];
  };
  for (let i = 0; i < o.items.length; i++) {
    const item = o.items[i]!;
    const name = names[i]!;
    try {
      const m = await o.mount(item);
      if (!m) throw new Error(item.kind === "figure" ? "this figure has no panels to export" : "this graph could not be drawn");
      const probe = m.serialize("white");
      if (!probe) throw new Error("nothing was drawn");
      const size = defaultExportSize({ w: probe.width, h: probe.height, displayScale: item.displayScale, printWidthMm: item.printWidthMm, dpi: o.dpi });
      const payload = await payloadForFormat({
        format: o.format,
        suggestedName: name.replace(/\.[^.]+$/, ""),
        serialize: m.serialize,
        background: o.background,
        width: size.width,
        height: size.height,
        dpi: o.dpi,
        noun: item.kind,
      });
      if (!payload) throw new Error("this format cannot hold a graph");
      pending.push({ name, payload });
    } catch (e) {
      out.failed.push({ name, error: e instanceof Error ? e.message : String(e) });
    }
    o.onProgress?.(i + 1, o.items.length);
    if (pending.length >= (o.chunk ?? 8)) await flush();
  }
  await flush();
  return out;
}
