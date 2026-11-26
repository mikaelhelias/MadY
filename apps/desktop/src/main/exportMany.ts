/**
 * Export files to disk — the one place a renderer export payload becomes bytes, shared by the
 * single-file `file:export` (Save dialog) and the batch `file:exportMany` (Export all → a folder the user picked).
 *
 * The PDF and Excel writers need Electron / ExcelJS, so they are passed in (`deps`): this module stays plain Node and
 * testable on a temporary folder.
 */
import { basename, join } from "node:path";
import { open } from "node:fs/promises";
import { buildPptx } from "./pptx";

/** The renderer's export payload (mirrors `preload` `ExportPayload`). */
export interface ExportPayloadLike {
  format: string;
  suggestedName?: string | undefined;
  text?: string | undefined;
  base64?: string | undefined;
  svg?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  sheet?: { name: string; columns: string[]; rows: (string | number | null)[][] } | undefined;
  pptx?: { slides: { name: string; svg: string; pngBase64: string; width: number; height: number }[] } | undefined;
}

export interface ExportDeps {
  svgToPdf: (svg: string, width: number, height: number) => Promise<Buffer>;
  workbook: (sheet: NonNullable<ExportPayloadLike["sheet"]>) => Promise<Buffer>;
}

/** A payload's file bytes — the same four branches as `file:export`, in the same order. */
export async function payloadToBuffer(payload: ExportPayloadLike, deps: ExportDeps): Promise<Buffer> {
  const ext = payload.format.toLowerCase();
  if (ext === "pdf" && payload.svg) return deps.svgToPdf(payload.svg, payload.width ?? 680, payload.height ?? 420);
  if (ext === "xlsx" && payload.sheet) return deps.workbook(payload.sheet);
  if (ext === "pptx" && payload.pptx) return buildPptx(payload.pptx.slides.map((s) => ({ name: s.name, svg: s.svg, png: Buffer.from(s.pngBase64, "base64"), width: s.width, height: s.height })));
  if (payload.base64 != null) return Buffer.from(payload.base64, "base64");
  return Buffer.from(payload.text ?? "", "utf8");
}

export type ExportManyResult = { name: string; ok: true; path: string } | { name: string; ok: false; error: string };

/**
 * Write a batch into `dir`, one result per file. Refuses a folder the user did not pick in this session (`pickedDir`)
 * — the renderer cannot name an arbitrary path. A name keeps only its last path part, so no file can land outside the
 * folder. Without `replace`, an existing file is a per-file failure ("already exists"); the rest still write.
 */
export async function writeExportBatch(
  dir: string,
  files: { name: string; payload: ExportPayloadLike }[],
  opts: { replace: boolean; pickedDir: string | null },
  deps: ExportDeps,
): Promise<ExportManyResult[]> {
  if (!opts.pickedDir || dir !== opts.pickedDir) {
    return files.map((f) => ({ name: f.name, ok: false as const, error: "that folder was not chosen in the Export all dialog" }));
  }
  const out: ExportManyResult[] = [];
  for (const f of files) {
    const name = basename(f.name.replace(/\\/g, "/"));
    if (!name || name === "." || name === "..") { out.push({ name: f.name, ok: false, error: "no file name" }); continue; }
    const path = join(dir, name);
    try {
      const bytes = await payloadToBuffer(f.payload, deps);
      const fh = await open(path, opts.replace ? "w" : "wx");
      try { await fh.writeFile(bytes); } finally { await fh.close(); }
      out.push({ name, ok: true, path });
    } catch (e) {
      const code = (e as { code?: string }).code;
      out.push({ name, ok: false, error: code === "EEXIST" ? "a file with this name already exists (tick Replace to overwrite)" : String((e as Error).message ?? e) });
    }
  }
  return out;
}
