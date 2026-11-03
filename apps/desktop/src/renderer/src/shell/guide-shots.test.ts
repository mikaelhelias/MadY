// @vitest-environment jsdom
/**
 * The manual's snapshots — the contract between `guide.ts`'s "shot" blocks and the PNGs in
 * `../assets/guide/` that `scripts/gen-guide-shots.mjs` regenerates off the running app.
 *
 * Default-deny in both directions, deliberately:
 *  • a block naming a file that is not bundled would render as silent nothing — an
 *    empty-looking panel on a correct route;
 *  • a bundled file no block names is dead weight shipping in an offline installer, and worse,
 *    it reads as "this is illustrated" in a directory listing when nothing shows it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE, stepShots, type GuideBlock } from "./guide";
import { GUIDE_MARKS, GUIDE_SHOTS } from "./GuidePane";
import { HOW_TO_SHOTS } from "./howTo";
// The capture spec is plain data — importing it is how the two lists are held to each other.
import { SHOTS as SPEC } from "../../../../../../scripts/guide-shots.spec.mjs";

type Shot = Extract<GuideBlock, { kind: "shot" }>;
/**
 * Every picture the manual shows, whichever block shows it.
 *
 * Two kinds of block put an image on the page: a `shot` block, and a `howto` block, which
 * shows the capture at the head of each run of controls (its files, alt text and captions live in
 * `howTo.ts` beside the entries that point at them). Reading only the `shot` blocks here would
 * let those captures ship with no alt text, no size check and no "is this still produced by
 * a capture run" check, while the suite still passed.
 */
const SHOTS: Shot[] = [
  ...GUIDE.flatMap((s) => s.blocks.filter((b): b is Shot => b.kind === "shot")),
  ...HOW_TO_SHOTS.map((s) => ({ kind: "shot", file: s.file, alt: s.alt, caption: s.caption }) as Shot),
  // …and the pictures hung off a numbered step. They are the whole point of the task shape —
  // a screenshot under the step it illustrates — and counting only the block-level ones would
  // let them ship with no alt text, no size check and no "is this still produced by a capture
  // run" check, while this suite still passed.
  ...stepShots().map((s) => ({ kind: "shot", ...s }) as Shot),
];

describe("manual snapshots", () => {
  it("has snapshots at all — this suite must not be vacuously green", () => {
    expect(SHOTS.length).toBeGreaterThanOrEqual(38);
  });

  it("every shot block names a bundled image", () => {
    for (const b of SHOTS) {
      expect(GUIDE_SHOTS[b.file], `"${b.file}" is referenced by the manual but not bundled — run scripts/gen-guide-shots.mjs`).toBeTruthy();
    }
  });

  it("every bundled image is referenced by a shot block", () => {
    const referenced = new Set(SHOTS.map((b) => b.file));
    for (const file of Object.keys(GUIDE_SHOTS)) {
      expect(referenced.has(file), `assets/guide/${file} ships but no manual block shows it`).toBe(true);
    }
  });

  it("every shot carries a real alt text and caption — not a stub", () => {
    for (const b of SHOTS) {
      expect(b.alt.trim().length, `${b.file}: alt text too short to describe a picture`).toBeGreaterThan(40);
      expect(b.caption.trim().length, `${b.file}: caption too short to say anything`).toBeGreaterThan(40);
      // The alt describes the image for someone who cannot see it; the caption comments for
      // someone who can. Identical strings mean one of the jobs is not being done.
      expect(b.alt.trim(), `${b.file}: alt and caption are the same string`).not.toBe(b.caption.trim());
    }
  });

  it("no two shots share a file — each picture illustrates one place", () => {
    const files = SHOTS.map((b) => b.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

/**
 * The call-outs — the numbered boxes over a snapshot, and the legend under it.
 *
 * A call-out is a promise: box 2 is around the control the legend calls 2. Three ways that
 * promise can break silently, all of them pinned here:
 *
 *   • coordinates that no longer fit the picture they belong to (a capture retaken at a
 *     different size, with a stale `.marks.json` left beside it) — the boxes would be drawn
 *     off the image, or in the wrong place, and nothing would look broken;
 *   • a `.marks.json` for a picture that no longer exists;
 *   • a mark with no label — a number in the picture and nothing in the legend to answer it.
 *
 * The coordinates themselves are measured by `scripts/gen-guide-shots.mjs` off the running app,
 * and a target that resolves to nothing fails that run. This file guards what ships.
 */
describe("call-outs on the manual's snapshots", () => {
  const marked = Object.entries(GUIDE_MARKS);

  it("some pictures are marked at all — this suite must not be vacuously green", () => {
    expect(marked.length, "no .marks.json files are bundled").toBeGreaterThanOrEqual(31);
    expect(marked.reduce((n, [, m]) => n + m.marks.length, 0)).toBeGreaterThanOrEqual(118);
  });

  it("every set of call-outs belongs to a picture the manual shows", () => {
    for (const [file] of marked) {
      expect(GUIDE_SHOTS[file], `${file}.marks.json has no image beside it`).toBeTruthy();
      expect(
        SHOTS.some((b) => b.file === file),
        `${file}.marks.json describes call-outs on a picture the manual never shows`,
      ).toBe(true);
    }
  });

  it("every call-out is inside its picture, has area, and says what it points at", () => {
    for (const [file, m] of marked) {
      expect(m.w, `${file}: the capture width is missing`).toBeGreaterThan(0);
      expect(m.h, `${file}: the capture height is missing`).toBeGreaterThan(0);
      expect(m.marks.length, `${file}.marks.json has no marks in it`).toBeGreaterThan(0);
      const seen = new Set<number>();
      for (const k of m.marks) {
        expect(seen.has(k.n), `${file}: two call-outs are both numbered ${k.n}`).toBe(false);
        seen.add(k.n);
        expect(k.w, `${file} ➜ ${k.n}: a zero-width box`).toBeGreaterThan(0);
        expect(k.h, `${file} ➜ ${k.n}: a zero-height box`).toBeGreaterThan(0);
        // Inside the picture. A box drawn past the edge is invisible, and the legend then
        // names something the reader cannot find.
        expect(k.x, `${file} ➜ ${k.n}: starts left of the picture`).toBeGreaterThanOrEqual(-2);
        expect(k.y, `${file} ➜ ${k.n}: starts above the picture`).toBeGreaterThanOrEqual(-2);
        expect(k.x + k.w, `${file} ➜ ${k.n}: runs past the right edge (${m.w} wide)`).toBeLessThanOrEqual(m.w + 2);
        expect(k.y + k.h, `${file} ➜ ${k.n}: runs past the bottom edge (${m.h} tall)`).toBeLessThanOrEqual(m.h + 2);
        expect(k.label.trim().length, `${file} ➜ ${k.n}: a numbered box with nothing in the legend`).toBeGreaterThan(2);
      }
      // 1, 2, 3 … with nothing missing: the legend is read as a sequence.
      expect([...seen].sort((a, b) => a - b), `${file}: the call-out numbers have a gap`).toEqual(
        m.marks.map((_, i) => i + 1),
      );
    }
  });

  it("no shipped picture is a blank rectangle", () => {
    // Guards against a blank white capture with its numbered call-outs drawn over nothing. Every
    // other check can pass in that case: the setup runs, the menu exists, and the marks resolve
    // to real boxes — e.g. a `position: fixed` menu that a synthetic `contextmenu` places far
    // below the viewport. An off-screen element has a valid bounding box and no pixels.
    //
    // `gen-guide-shots.mjs` decodes each capture and refuses one that is a single flat
    // colour, which is the real check. This is the guard on what ships, for the case where
    // nobody re-runs the generator — and it cannot decode a PNG (no decoder in jsdom), so it
    // uses the cheapest proxy that separates the two populations: compressed bytes per pixel.
    //
    // Measured values:
    //   a flat blank capture   0.0060 to 0.0097 bytes/px
    //   the thinnest real one  0.0243 (significance-brackets.png)
    // The floor is 0.015 — 1.5× above the densest blank, 1.6× below the thinnest real picture.
    // Caution: it is a proxy. If a legitimate capture ever fails here, the correct fix is to look
    // at the picture and then widen this gap with a number, never to delete the check.
    const FLOOR = 0.015;
    for (const file of Object.keys(GUIDE_SHOTS)) {
      const png = readFileSync(join(process.cwd(), "apps/desktop/src/renderer/src/assets/guide", file));
      const px = png.readUInt32BE(16) * png.readUInt32BE(20);
      const bpp = png.length / px;
      expect(
        bpp,
        `${file} is ${bpp.toFixed(5)} bytes/px — that is flat-colour territory, so the capture is ` +
          `probably a picture of nothing. Look at it before changing this number.`,
      ).toBeGreaterThan(FLOOR);
    }
    // 12 ms alone; up to ~5.4 s inside the full suite when the worker is starved, hence the timeout.
  }, 30_000);

  it("the marks match the picture's real size, not a previous capture's size", () => {
    // Note: the check most likely to go stale. Captures are taken at 2× device pixels, so the PNG
    // is exactly twice the CSS-pixel box the marks are in. Retake a shot at a different viewport,
    // forget to regenerate the marks, and every box moves — while the page still renders perfectly.
    for (const [file, m] of marked) {
      // Note: from the vitest root, not from `import.meta.url`: under the jsdom environment the
      // module URL does not resolve to the file on disk, and the read returns ENOENT on a
      // path with the repo root missing from it.
      const png = readFileSync(join(process.cwd(), "apps/desktop/src/renderer/src/assets/guide", file));
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      expect(w, `${file}: the image is ${w}px wide but its marks were measured on a ${m.w * 2}px one`).toBe(m.w * 2);
      expect(h, `${file}: the image is ${h}px tall but its marks were measured on a ${m.h * 2}px one`).toBe(m.h * 2);
    }
  });

});

/**
 * What the spec promises and what ships.
 *
 * `scripts/guide-shots.spec.mjs` is the list of pictures the capture run produces. It and
 * `guide.ts` are two hand-kept lists of the same set, and they drift in the way that costs a
 * reader most: a spec entry nobody shows, or a manual block whose picture no run produces.
 */
describe("the capture spec and the manual agree", () => {
  it("every picture the spec captures is shown in the manual", () => {
    const shown = new Set(SHOTS.map((b) => b.file));
    const orphans = SPEC.filter((s) => !shown.has(s.file)).map((s) => s.file);
    expect(orphans, `the capture run produces these and the manual shows none of them: ${orphans.join(", ")}`).toEqual(
      [],
    );
  });

  it("every picture the manual shows is produced by the spec", () => {
    const produced = new Set(SPEC.map((s) => s.file));
    const missing = SHOTS.filter((b) => !produced.has(b.file)).map((b) => b.file);
    expect(
      missing,
      `the manual shows these and no capture run regenerates them — they would go stale silently: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("every spec entry knows what to capture, and every mark has a target and a label", () => {
    for (const s of SPEC) {
      expect(typeof s.setup, `${s.file}: no setup`).toBe("function");
      expect(s.capture, `${s.file}: nothing says what to capture`).toBeTruthy();
      for (const [i, m] of (s.marks ?? []).entries()) {
        expect(m.target, `${s.file} call-out ${i + 1}: no target`).toBeTruthy();
        expect((m.label ?? "").trim().length, `${s.file} call-out ${i + 1}: no label`).toBeGreaterThan(2);
      }
    }
  });
});
