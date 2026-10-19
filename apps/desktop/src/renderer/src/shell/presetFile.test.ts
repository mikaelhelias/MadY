// @vitest-environment jsdom
/**
 * A preset as a file: what is refused, what is dropped, and what is never trusted (the id).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWN_SHAPES, exportPresetFile, freeName, importPresetFiles, importSummary, parsePresetFile, serialisePreset } from "./presetFile";
import { listUserPresets, saveUserPreset } from "./userPresets";
import type { UserPreset } from "./userPresets";

const HERE = dirname(fileURLToPath(import.meta.url));

const rec: UserPreset = {
  id: "up_theirs",
  name: "Lab",
  style: { frame: "box", fonts: { title: { size: 28 } } },
  palette: ["#112233", "#abc"],
  shapes: ["square", "triangle"],
  kinds: { bar: { barWidth: 0.9 }, heatmap: { heatmap: { colormap: "reds" } } },
  createdAt: 1,
};

describe("serialise → parse round-trips a preset, with a fresh id and the name kept free", () => {
  it("keeps look, palette, shapes and sections; never the id", () => {
    const out = parsePresetFile(serialisePreset(rec), [], 1000, () => "rnd");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preset.id).toBe("up_rs_rnd"); // 1000 in base 36 is "rs" — built here, not read from the file
    expect(out.preset.id).not.toBe("up_theirs");
    expect(out.preset.name).toBe("Lab");
    expect(out.preset.style).toEqual(rec.style);
    expect(out.preset.palette).toEqual(rec.palette);
    expect(out.preset.shapes).toEqual(rec.shapes);
    expect(out.preset.kinds).toEqual(rec.kinds);
    expect(out.preset.createdAt).toBe(1000);
    expect(out.dropped).toEqual([]);
  });

  it("a file carrying an id in its preset block is still given a fresh one", () => {
    const text = JSON.stringify({ format: "mady-preset", v: 1, savedAt: 1, preset: { id: "up_evil", name: "X", style: {}, palette: [] } });
    const out = parsePresetFile(text, [], 5, () => "r");
    expect(out.ok && out.preset.id).toBe("up_5_r");
  });

  it("a name clash gets ' (2)', then ' (3)'", () => {
    expect(freeName("Lab", ["Lab"])).toBe("Lab (2)");
    expect(freeName("Lab", ["Lab", "Lab (2)"])).toBe("Lab (3)");
    expect(freeName("Lab", ["Other"])).toBe("Lab");
    const out = parsePresetFile(serialisePreset(rec), ["Lab"]);
    expect(out.ok && out.preset.name).toBe("Lab (2)");
  });
});

describe("what is refused, in a sentence", () => {
  it("not JSON, not an object, not this format, another version, no preset, no name", () => {
    expect(parsePresetFile("nope", [])).toEqual({ ok: false, error: expect.stringMatching(/not JSON/) });
    expect(parsePresetFile("[1,2]", [])).toEqual({ ok: false, error: expect.stringMatching(/not a preset file/) });
    expect(parsePresetFile(JSON.stringify({ format: "other", v: 1 }), [])).toEqual({ ok: false, error: expect.stringMatching(/not a MadY preset file/) });
    expect(parsePresetFile(JSON.stringify({ format: "mady-preset", v: 2, preset: {} }), [])).toEqual({ ok: false, error: expect.stringMatching(/version 2/) });
    expect(parsePresetFile(JSON.stringify({ format: "mady-preset", v: 1 }), [])).toEqual({ ok: false, error: expect.stringMatching(/no preset/) });
    expect(parsePresetFile(JSON.stringify({ format: "mady-preset", v: 1, preset: { name: "  " } }), [])).toEqual({ ok: false, error: expect.stringMatching(/no name/) });
  });

  it("a whole style library is refused and pointed at the right button", () => {
    const out = parsePresetFile(JSON.stringify({ v: 1, savedAt: 1, data: { "mady.userPresets.v1": "[]" } }), []);
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/whole style library.*Back up & transfer/) });
  });
});

describe("what is dropped, and reported", () => {
  it("unknown shared keys, bad colours, unknown shapes, unknown types, keys a type does not own, sheet references", () => {
    const text = JSON.stringify({
      format: "mady-preset", v: 1, savedAt: 1,
      preset: {
        name: "Odd",
        style: { frame: "box", title: "their title", seriesStyles: { c1: {} }, barWidth: 0.5, xAxis: { lineWidth: 2, categoryGroups: { column: "c9" } } },
        palette: ["#123456", "red", 7],
        shapes: ["square", "blob"],
        kinds: {
          bar: { barWidth: 0.9, pieDonut: 0.4 },
          pie: { pieDonut: 0.4 },
          image: { barWidth: 1 },
          heatmap: { heatmap: { colormap: "reds", rowTracks: [{ column: "c1" }] } },
          martian: { x: 1 },
        },
      },
    });
    const out = parsePresetFile(text, []);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preset.style).toEqual({ frame: "box", xAxis: { lineWidth: 2 } });
    expect(out.preset.palette).toEqual(["#123456"]);
    expect(out.preset.shapes).toEqual(["square"]);
    expect(out.preset.kinds).toEqual({ bar: { barWidth: 0.9 }, pie: { pieDonut: 0.4 }, heatmap: { heatmap: { colormap: "reds" } } });
    // Not the whole object: the preset's `id` is generated at parse time and random, so it can contain "c1" or
    // "c9" by chance (e.g. `up_mtxmq1pm_0gc9b`) and fail this check spuriously. Blanking the id keeps every
    // field that could actually carry a sheet reference under the same scan.
    expect(JSON.stringify({ ...out.preset, id: "" })).not.toMatch(/c1|c9/);
    expect(out.dropped.sort()).toEqual(
      ["style.title", "style.seriesStyles", "style.barWidth", "palette: red", "palette: 7", "shapes: blob", "kinds.bar.pieDonut", "kinds.image", "kinds.martian"].sort(),
    );
  });

  it("a section left empty after dropping is not written", () => {
    const text = JSON.stringify({ format: "mady-preset", v: 1, savedAt: 1, preset: { name: "E", style: {}, palette: [], kinds: { bar: { pieDonut: 1 } } } });
    const out = parsePresetFile(text, []);
    expect(out.ok && "kinds" in out.preset).toBe(false);
  });

  it("KNOWN_SHAPES is the model's SymbolShape union, exactly", () => {
    const model = readFileSync(join(HERE, "../../../../../../packages/core/src/model.ts"), "utf8").replace(/\r\n/g, "\n");
    const from = model.indexOf("export type SymbolShape =");
    const body = model.slice(from, model.indexOf(";", from)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const union = [...body.matchAll(/"([\w-]+)"/g)].map((m) => m[1]!).sort();
    expect(union.length).toBeGreaterThan(5);
    expect([...KNOWN_SHAPES].sort()).toEqual(union);
  });
});

describe("the bridge calls", () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as { mady?: unknown }).mady;
  });

  it("without the desktop app both say so instead of doing nothing", async () => {
    expect(await exportPresetFile(rec)).toEqual({ ok: false, error: "Export needs the desktop app." });
    expect(await importPresetFiles()).toEqual({ ok: false, error: "Import needs the desktop app." });
  });

  it("export hands the file text and a name to the generic exporter", async () => {
    const exportFile = vi.fn(async (_payload: { format: string; suggestedName?: string; text?: string }) => ({ ok: true as const, path: "C:/x/Lab.mady-preset.json" }));
    (window as unknown as { mady: unknown }).mady = { exportFile };
    expect(await exportPresetFile(rec)).toEqual({ ok: true, path: "C:/x/Lab.mady-preset.json" });
    const payload = exportFile.mock.calls[0]![0];
    expect(payload.format).toBe("json");
    expect(payload.suggestedName).toBe("Lab.mady-preset");
    expect(JSON.parse(payload.text ?? "").preset.kinds.bar.barWidth).toBe(0.9);
  });

  it("import adds each good file with a free name, skips the bad ones by name, and never evicts", async () => {
    saveUserPreset("Lab", { frame: "box" }, []);
    const files = [
      { name: "lab.json", text: serialisePreset(rec) },
      { name: "notes.json", text: "{}" },
      { name: "huge.json", error: "larger than 2 MB" },
    ];
    (window as unknown as { mady: unknown }).mady = { presetImport: vi.fn(async () => ({ ok: true, files })) };
    const r = await importPresetFiles();
    expect(r).toEqual({ ok: true, added: ["Lab (2)"], skipped: [{ file: "notes.json", reason: "not a MadY preset file" }, { file: "huge.json", reason: "larger than 2 MB" }], dropped: [] });
    expect(listUserPresets().map((p) => p.name).sort()).toEqual(["Lab", "Lab (2)"]);
    expect(importSummary(r)).toBe('Imported "Lab (2)". Skipped notes.json: not a MadY preset file. Skipped huge.json: larger than 2 MB.');
    // Two of the same file in one pick: both land, numbered — not one overwriting the other.
    (window as unknown as { mady: unknown }).mady = { presetImport: vi.fn(async () => ({ ok: true, files: [files[0], files[0]] })) };
    const r2 = await importPresetFiles();
    expect(r2.ok && r2.added).toEqual(["Lab (3)", "Lab (4)"]);
  });

  it("a cancelled pick is quiet", async () => {
    (window as unknown as { mady: unknown }).mady = { presetImport: vi.fn(async () => ({ ok: false, canceled: true })) };
    const r = await importPresetFiles();
    expect(r).toEqual({ ok: false, canceled: true });
    expect(importSummary(r)).toBe("");
  });
});
