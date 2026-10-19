// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The startup splash is a static page in `renderer/public/` that the main process fills in
 * by id after load. Nothing else links the two, so the contract is easy to break silently:
 *   • rename `#version` in the HTML → main's injection quietly no-ops and the splash shows
 *     a blank line where the version should be (the injected script finds nothing to set);
 *   • move or rename the artwork → the splash paints its flat fallback colour;
 *   • loosen the page's CSP → a scriptless page stops being scriptless.
 * None of that would fail a build or a renderer test, and the splash is on screen for well
 * under two seconds, so a person may never register that something is missing.
 */
const PUBLIC = fileURLToPath(new URL("../renderer/public/", import.meta.url));
const MAIN = fileURLToPath(new URL("./index.ts", import.meta.url));

const html = readFileSync(`${PUBLIC}splash.html`, "utf8");
const main = readFileSync(MAIN, "utf8");

describe("splash assets", () => {
  it("ships both the page and the artwork", () => {
    expect(existsSync(`${PUBLIC}splash.html`)).toBe(true);
    expect(existsSync(`${PUBLIC}splash.jpg`)).toBe(true);
  });

  it("the artwork stays small enough not to delay the thing it is covering", () => {
    // It is decoded before the splash first paints, so it is kept as a small JPEG: a large
    // image would slow down the screen whose job is to cover the start-up wait.
    expect(statSync(`${PUBLIC}splash.jpg`).size).toBeLessThan(600_000);
  });

  it("the page references the artwork by the name that is actually shipped", () => {
    expect(html).toContain("splash.jpg");
  });

  it("every id the main process writes into exists in the page", () => {
    // Extract the ids main injects, so this cannot drift out of sync with the real code.
    const injected = [...main.matchAll(/getElementById\("([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]!);
    const splashIds = injected.filter((id) => id === "version" || id === "credit");
    expect(splashIds.length, "main injects no splash field — the ids it writes are not the ones this test expects").toBeGreaterThan(0);
    for (const id of splashIds) expect(html, `splash.html has no #${id}`).toContain(`id="${id}"`);
  });

  it("names the program and credits the author in the markup itself", () => {
    // The credit is static text, not injected — assert it is really there.
    expect(html).toContain(">MadY<");
    expect(html).toContain("Mikael Elias");
  });

  it("stays scriptless: no inline script, and a CSP that forbids one", () => {
    expect(html).toMatch(/default-src 'none'/);
    expect(html).not.toMatch(/<script/i);
  });
});
