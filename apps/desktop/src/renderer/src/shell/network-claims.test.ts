/**
 * The "no network" claim must name its one exception.
 *
 * MadY's promise — no network calls — is why unpublished data can live in it, and it is the
 * line users and reviewers quote. In a run with the language model enabled the program can
 * download: the ribbon's "Activate, install & configure LLM" button fetches Ollama and a
 * Gemma 4 model, once, on the user's press. The README covers every way to run MadY, so it makes
 * no absolute no-network promise at all: it says the data stays on the computer. The manual, which
 * documents the installed program only, makes the promise about the installed program.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SETUP_BUTTON_LABEL } from "./ModelSetup";

// shell → renderer/src → renderer → desktop/src → desktop → apps → the repo root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");

describe("the no-network promise names its one exception, by the button's exact label", () => {
  it("README: no absolute no-network promise, since a development run can download the language model", () => {
    expect(readme).not.toMatch(/no network (request|access|call|connection)s? (at all|whatsoever|of any kind)/i);
    expect(readme).not.toMatch(/never (connects|goes online|uses the network)/i);
    const local = readme.split("\n").find((l) => l.includes("Local and offline by design")) ?? "";
    expect(local).toMatch(/stay on your computer/);
  });

  it("the manual: the language model has its own section, labelled in development, which names the button and holds the only network promise", () => {
    // String concatenations in guide.ts are joined, so a sentence split across lines reads whole.
    const guide = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "guide.ts"), "utf8").replace(/"\s*\+\s*"/g, "");
    expect(guide).not.toMatch(/no network access at all/);
    const at = guide.indexOf('text: "A language model for the Ask bar (in development)"');
    expect(at, "the manual has no language-model section labelled in development").toBeGreaterThan(-1);
    const section = guide.slice(at, guide.indexOf("\n  },", at));
    expect(section).toMatch(/In development: this does not work well yet/);
    expect(section).toContain(SETUP_BUTTON_LABEL);
    expect(section).toMatch(/MADY_LLM=1/);
    // The promise is made about the installed program, in this section and nowhere else in the manual.
    expect(section).toMatch(/the installed program makes no network request at all/);
    expect(guide.match(/makes no network request at all/g) ?? []).toHaveLength(1);
  });

  it("the label is exactly the specified text", () => {
    expect(SETUP_BUTTON_LABEL).toBe("Activate, install & configure LLM");
  });
});
