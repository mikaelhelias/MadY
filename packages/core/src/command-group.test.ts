/**
 * One user action is one Undo step. Typing "96" into a size box saves after each key, and one press of "Apply
 * preset" runs three commands; Ctrl+Z must take back the whole action, not one key or one third of a preset.
 */
import { describe, expect, it } from "vitest";
import { CommandStack } from "./command";

/** A command that appends `v` to `log` and removes it on undo. */
const push = (log: string[], v: string) => ({ label: v, do: () => { log.push(v); }, undo: () => { log.splice(log.lastIndexOf(v), 1); } });

describe("CommandStack groups", () => {
  it("every command run inside one batch is one step, undone and redone whole", () => {
    const s = new CommandStack(); const log: string[] = [];
    s.execute(push(log, "before"));
    s.batch(() => { s.execute(push(log, "a")); s.execute(push(log, "b")); s.execute(push(log, "c")); });
    expect(log).toEqual(["before", "a", "b", "c"]);
    s.undo();
    expect(log).toEqual(["before"]);
    s.redo();
    expect(log).toEqual(["before", "a", "b", "c"]);
    s.undo(); s.undo();
    expect(log).toEqual([]);
  });

  it("an open group (a box being typed in) collects every command until it is closed", () => {
    const s = new CommandStack(); const log: string[] = [];
    s.beginGroup("box 1");
    for (const k of ["9", "96"]) s.batch(() => s.execute(push(log, k)));
    s.endGroup();
    s.beginGroup("box 2");
    s.execute(push(log, "x"));
    s.endGroup();
    s.undo();
    expect(log).toEqual(["9", "96"]);
    s.undo();
    expect(log).toEqual([]);
  });

  it("a gesture's own merging still keeps the latest value only", () => {
    const s = new CommandStack(); let v = 0;
    const set = (n: number, from: number) => ({ label: "drag", coalesceKey: "drag", do: () => { v = n; }, undo: () => { v = from; } });
    s.execute(set(1, 0)); s.execute(set(2, 1)); s.execute(set(3, 2));
    s.undo();
    expect(v).toBe(0);
  });
});
