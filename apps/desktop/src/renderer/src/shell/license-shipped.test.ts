/**
 * The licence ships with the program.
 *
 * GPL-3 §0 requires the program to tell the user how to view the licence, and §4 requires a
 * copy to travel with every conveyed copy. Both fail quietly: the About card can link to
 * `COPYING.txt` forever while nothing puts that file in the build, and `LICENSE` can drift to
 * a different licence than the one the app claims. Neither shows up as a broken feature.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../../..");
const PUBLIC = join(HERE, "../../public");

/** Section headings every complete copy of the GPL-3 terms carries. */
const MARKERS = [
  "GNU GENERAL PUBLIC LICENSE",
  "Version 3, 29 June 2007",
  "  15. Disclaimer of Warranty.",
  "  16. Limitation of Liability.",
  "END OF TERMS AND CONDITIONS",
];

describe("the GPL-3 text ships, and matches what the app says", () => {
  it("the repository LICENSE is the complete GPL-3 terms", () => {
    const p = join(REPO, "LICENSE");
    expect(existsSync(p), "no LICENSE at the repo root").toBe(true);
    const text = readFileSync(p, "utf8");
    for (const m of MARKERS) expect(text, `LICENSE is missing "${m}"`).toContain(m);
    // All 18 sections (0–17), so a truncated copy cannot pass.
    for (let n = 0; n <= 17; n++) expect(text, `LICENSE is missing section ${n}`).toMatch(new RegExp(`^ {2}${n}\\. `, "m"));
  });

  it("a copy is bundled with the renderer, so the About card's link resolves offline", () => {
    // `renderer/public/` is copied verbatim into the build — the same route the splash
    // artwork takes. Without this the link 404s in the packaged app, where there is no
    // network to fall back on.
    const p = join(PUBLIC, "COPYING.txt");
    expect(existsSync(p), "no COPYING.txt in renderer/public — the in-app licence link is dead").toBe(true);
    expect(readFileSync(p, "utf8")).toBe(readFileSync(join(REPO, "LICENSE"), "utf8"));
  });

  it("every package declares the same licence the app displays", () => {
    for (const f of ["package.json", "apps/desktop/package.json", "packages/core/package.json", "packages/graphics/package.json"]) {
      const j = JSON.parse(readFileSync(join(REPO, f), "utf8")) as { license?: string };
      expect(j.license, `${f} does not declare a licence`).toBe("GPL-3.0-or-later");
    }
  });
});
