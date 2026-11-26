// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DocumentArea is a pass-through: it declares a direct-manipulation handler for every
 * draggable/editable element and hands each one down to the pane that renders it. A handler
 * that is declared and received but never forwarded produces a silently dead affordance —
 * the element still looks draggable, the drag still runs, and the document never changes.
 *
 * Browser tests cannot catch this for every handler: they can only drive what the sample
 * project shows, and no sample graph carries a fit, so a dropped `onMoveFitLabel` (dragging
 * a fit's potency label) would go unseen there.
 *
 * This guard is structural rather than behavioural: it reads the source and checks that
 * every `onMove*` / `onEdit*` prop DocumentArea declares is actually spent. It cannot tell
 * you a handler does the right thing — only that it is not thrown away.
 */
const SRC = readFileSync(join(__dirname, "DocumentArea.tsx"), "utf8");

/** Handler props DocumentArea declares in its own props type. */
function declaredHandlers(): string[] {
  return [...SRC.matchAll(/^\s{2}(on(?:Move|Edit|Create|Delete|Reorder|Duplicate)\w*)\??:/gm)].map((m) => m[1]!);
}

describe("DocumentArea forwards every handler it declares", () => {
  it("declares a meaningful number of handlers (the scrape still works)", () => {
    // if a refactor changes the props style, this test must fail loudly rather than pass vacuously
    const names = declaredHandlers();
    expect(names.length).toBeGreaterThan(8);
    expect(names).toContain("onMoveFitLabel");
    expect(names).toContain("onMoveFitParams");
  });

  it.each(declaredHandlers())("%s is passed down, not dropped", (name) => {
    // it must appear somewhere as a value being handed to a child, e.g. `foo={props.foo}`
    const used = new RegExp(`\\bprops\\.${name}\\b`).test(SRC);
    expect(used, `${name} is declared on DocumentArea but never forwarded — a dead affordance`).toBe(true);
  });
});
