/**
 * Variable labels on the ordination cards stay readable: a label sitting on another variable's
 * arrow, or a leader line drawn in an arrow's own colour, leaves no telling which arrow a label
 * belongs to.
 *
 * So, for the three ordination cards under every built-in preset and bare: no variable label
 * intersects an arrow or another label, and a leader is drawn unlike an arrow (dashed, neutral).
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults } from "./seedStyle";

const measure = (t: string, px: number): number => t.length * px * 0.6;
type Box = { x1: number; y1: number; x2: number; y2: number };
const segHitsBox = (x1: number, y1: number, x2: number, y2: number, b: Box): boolean => {
  const steps = 60;
  for (let k = 0; k <= steps; k++) {
    const x = x1 + ((x2 - x1) * k) / steps, y = y1 + ((y2 - y1) * k) / steps;
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return true;
  }
  return false;
};
const overlaps = (a: Box, b: Box) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);

function styled(key: string, presetName: string | null): { plot: Plot; table: ReturnType<typeof galleryItems>[number]["table"] } {
  const card = galleryItems().find((c) => c.key === key)!;
  const p = JSON.parse(JSON.stringify(card.plot)) as Plot;
  if (!presetName) return { plot: p, table: card.table };
  const preset = STYLE_PRESETS.find((x) => x.name === presetName)!;
  const project: Project = { schemaVersion: 4, tables: [card.table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  applyPresetWithKindDefaults(doc, p.id, p.kind ?? "xy", preset);
  return { plot: doc.toJSON().plots[0]!, table: card.table };
}

const CARDS = ["pcascore", "pcabiplot", "triplot"];
const LOOKS = [null, ...STYLE_PRESETS.map((p) => p.name)];

describe("ordination variable labels are clear, and leaders are not arrows", () => {
  for (const key of CARDS) for (const look of LOOKS) {
    it(`${key} · ${look ?? "bare card"}`, () => {
      const { plot, table } = styled(key, look);
      const s = buildPlotScene(table, plot, { width: plot.figureWidth ?? 640, height: plot.figureHeight ?? 440, measure, ...scenePaletteOpt(plot) });
      const labels = s.annotations.filter((a) => a.id.startsWith("pca-vlabel-")).map((a) => {
        const fs = a.fontSize ?? 12, w = measure(a.label ?? "", fs);
        const x = a.labelX ?? 0, y = a.labelY ?? 0;
        const x1 = a.labelAnchor === "end" ? x - w : a.labelAnchor === "middle" ? x - w / 2 : x;
        return { id: a.id, text: a.label ?? "", color: a.color, box: { x1, y1: y - fs * 0.7, x2: x1 + w, y2: y + fs * 0.25 } as Box };
      });
      const arrows = s.annotations.filter((a) => a.kind === "arrow");
      const clashes: string[] = [];
      for (const l of labels) {
        for (const a of arrows) if (segHitsBox(a.x1!, a.y1!, a.x2!, a.y2!, l.box)) clashes.push(`"${l.text}" on ${a.id}`);
        for (const m of labels) if (m !== l && overlaps(l.box, m.box)) clashes.push(`"${l.text}" on "${m.text}"`);
      }
      expect(clashes, "a variable label on an arrow or another label").toEqual([]);
      // Leaders: present only when a label is far from its subject, and never dressed as an arrow.
      for (const lead of s.annotations.filter((a) => a.id.startsWith("pca-leader-"))) {
        const own = labels.find((l) => l.id === lead.id.replace("pca-leader-", "pca-vlabel-"));
        expect(lead.dash, `${lead.id}: a solid leader reads as an arrow`).toBeTruthy();
        expect(lead.color, `${lead.id}: a leader in the arrow's colour reads as an arrow`).not.toBe(own?.color);
      }
    });
  }
});
