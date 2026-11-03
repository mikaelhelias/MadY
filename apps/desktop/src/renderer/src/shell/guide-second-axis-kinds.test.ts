// @vitest-environment jsdom
/**
 * The manual's list of which charts have a second value axis must match the app's list.
 *
 * Four places tell the reader which kinds carry Y2/Y3 — the Axis chapter, its "if it goes wrong"
 * list, and two how-to entries — and all four go stale whenever a kind gains or loses a right-hand
 * value axis. A manual that says a control is not there is worse than one that omits it: the
 * reader stops looking.
 *
 * So the prose is held to `rightValueAxes`, the function the Axis tab itself asks.
 */
import { describe, expect, it } from "vitest";
import { GUIDE } from "./guide";
import { HOW_TO } from "./howTo";
import { rightValueAxes } from "./Inspector";
import type { PlotKind } from "@mady/core";

/** The kinds a reader would look for, and the words the manual calls them by. */
const NAMED: Array<[PlotKind, string]> = [
  ["xy", "XY"], ["area", "area"], ["bubble", "bubble"], ["volcano", "volcano"], ["histogram", "histogram"],
  ["bar", "bar"], ["box", "box"], ["violin", "violin"], ["scatter", "column scatter"],
  ["lollipop", "lollipop"], ["raincloud", "raincloud"], ["floatingbar", "floating-bar"],
];

/** Every sentence in the manual that lists the kinds carrying a second value axis. */
function claims(): string[] {
  const texts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(GUIDE);
  walk(HOW_TO);
  return texts.filter((t) => /second value axis|support a second axis|Y2 appears/.test(t));
}

describe("the manual's second-axis lists match the app", () => {
  it("there are sentences to check — if these move, this guard must follow them", () => {
    expect(claims().length, "no sentence in the manual lists the second-axis kinds any more").toBeGreaterThanOrEqual(3);
  });

  it("every kind that has a second value axis is named in each list", () => {
    const withY2 = NAMED.filter(([k]) => rightValueAxes({ kind: k }).includes("y2"));
    expect(withY2.length, "no kind carries Y2 — the fixture is wrong, not the manual").toBeGreaterThan(8);
    const missing: string[] = [];
    for (const sentence of claims()) {
      for (const [, name] of withY2) {
        if (!sentence.toLowerCase().includes(name.toLowerCase())) missing.push(`"${name}" missing from: ${sentence.slice(0, 80)}…`);
      }
    }
    expect(missing, "the manual tells the reader these charts have no second axis, and they do").toEqual([]);
  });

  it("no kind is promised a Y3 it does not have", () => {
    const y3 = NAMED.filter(([k]) => rightValueAxes({ kind: k }).includes("y3")).map(([, n]) => n);
    const noY3 = NAMED.filter(([k]) => !rightValueAxes({ kind: k }).includes("y3")).map(([, n]) => n);
    expect(y3.length, "nothing carries Y3 — the fixture is wrong").toBeGreaterThan(0);
    const wrong: string[] = [];
    for (const sentence of claims()) {
      const m = /Y3 appears only on ([^.]+)\./.exec(sentence);
      if (!m) continue;
      for (const name of noY3) {
        // Note: "bar" is inside "floating-bar", and "scatter" inside "column scatter" — match the
        // whole word, or a correct sentence reads as a false alarm.
        if (new RegExp(`(^|[^-\\w])${name}([^-\\w]|$)`, "i").test(m[1]!)) wrong.push(`"${name}" is promised a Y3 in: ${m[0]}`);
      }
      for (const name of y3) expect(m[1]!.toLowerCase(), `"${name}" carries Y3 but the sentence omits it`).toContain(name.toLowerCase());
    }
    expect(wrong, "the manual promises a third axis the Axis tab does not offer").toEqual([]);
  });
});
