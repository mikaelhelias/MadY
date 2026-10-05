// @vitest-environment jsdom
/**
 * The model bar — present only once the set-up has made a model ready; Enter compiles the
 * line and applies it at once; the popover lists what was done with an Undo beside it.
 * (Immediate apply with undo, no preview click.)
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelBar } from "./ModelBar";

afterEach(cleanup);

const okResult = (commands: Record<string, unknown>[], note?: string) => ({ ok: true as const, commands, ...(note ? { note } : {}) });

function setup(over: Partial<Parameters<typeof ModelBar>[0]> = {}) {
  const compile = vi.fn(async () => okResult([{ op: "setGraphKind", id: "p1", kind: "violin" }], "Written by the on-device model — check it."));
  const apply = vi.fn(() => [{ ok: true as const, value: null }]);
  const undo = vi.fn();
  const describe = vi.fn((c: Record<string, unknown>) => `described ${String(c.op)}`);
  const onSetup = vi.fn();
  const props = { ready: true, compile, apply, undo, describe, onSetup, ...over };
  const u = render(<ModelBar {...props} />);
  const input = () => u.container.querySelector<HTMLInputElement>(".modelbar-in");
  const pop = () => u.container.querySelector(".modelbar-pop");
  const type = (text: string) => fireEvent.change(input()!, { target: { value: text } });
  const enter = () => fireEvent.keyDown(input()!, { key: "Enter" });
  return { ...u, compile, apply, undo, describe, onSetup, input, pop, type, enter };
}

describe("ModelBar — presence", () => {
  it("renders nothing until a model is ready — not a disabled box, nothing", () => {
    const u = setup({ ready: false });
    expect(u.container.innerHTML).toBe("");
  });

  it("ready → one input, no buttons (Enter is the only trigger)", () => {
    const u = setup();
    expect(u.input()).not.toBeNull();
    expect(u.container.querySelectorAll("button").length).toBe(0);
  });
});

describe("ModelBar — Enter compiles and applies, then shows what was done with Undo", () => {
  it("an empty or whitespace line does nothing", () => {
    const u = setup();
    u.type("   ");
    u.enter();
    expect(u.compile).not.toHaveBeenCalled();
  });

  it("compile → apply at once → popover lists each command in words, the model's note, and Undo", async () => {
    const u = setup();
    u.type("make it a violin");
    u.enter();
    expect(u.compile).toHaveBeenCalledWith("make it a violin");
    await waitFor(() => expect(u.apply).toHaveBeenCalledOnce());
    expect(u.apply).toHaveBeenCalledWith([{ op: "setGraphKind", id: "p1", kind: "violin" }]);
    await waitFor(() => expect(u.pop()).not.toBeNull());
    const text = u.pop()!.textContent ?? "";
    expect(text).toContain("described setGraphKind");
    expect(text).toContain("check it");
    const undoBtn = [...u.pop()!.querySelectorAll("button")].find((b) => /undo/i.test(b.textContent ?? ""));
    expect(undoBtn).toBeDefined();
    fireEvent.click(undoBtn!);
    expect(u.undo).toHaveBeenCalledOnce();
    // Undo closes the popover — the thing it described is no longer true.
    expect(u.pop()).toBeNull();
    // The line is kept in the box so it can be rephrased.
    expect(u.input()!.value).toBe("make it a violin");
  });

  it("while the model is thinking the popover says so, and a second Enter is ignored", async () => {
    let resolve!: (v: ReturnType<typeof okResult>) => void;
    const compile = vi.fn(() => new Promise<ReturnType<typeof okResult>>((r) => { resolve = r; }));
    const u = setup({ compile });
    u.type("something");
    u.enter();
    u.enter();
    expect(compile).toHaveBeenCalledOnce();
    await waitFor(() => expect(u.pop()?.textContent ?? "").toMatch(/asking|thinking|working/i));
    resolve(okResult([{ op: "listGraphs" }]));
    await waitFor(() => expect(u.apply).toHaveBeenCalledOnce());
  });

  it("a refusal shows the error and hint, applies nothing, and offers no Undo", async () => {
    const compile = vi.fn(async () => ({ ok: false as const, error: "neither the built-in command reader nor the local model could turn that into commands", hint: "Try a shorter sentence." }));
    const u = setup({ compile });
    u.type("gibberish");
    u.enter();
    await waitFor(() => expect(u.pop()).not.toBeNull());
    expect(u.apply).not.toHaveBeenCalled();
    expect(u.pop()!.textContent).toContain("neither the built-in command reader");
    expect(u.pop()!.textContent).toContain("Try a shorter sentence.");
    expect([...u.pop()!.querySelectorAll("button")].some((b) => /undo/i.test(b.textContent ?? ""))).toBe(false);
  });

  it("a command the document refused is listed as refused, beside the ones that ran", async () => {
    const compile = vi.fn(async () => okResult([{ op: "setGraphKind", id: "p1", kind: "violin" }, { op: "setAxis", id: "p9", axis: "x", patch: {} }]));
    const apply = vi.fn(() => [{ ok: true as const, value: null }, { ok: false as const, code: "not_found" as const, error: "no graph p9" }]);
    const u = setup({ compile, apply });
    u.type("two things");
    u.enter();
    await waitFor(() => expect(u.pop()).not.toBeNull());
    const items = [...u.pop()!.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(items.some((t) => t.includes("described setGraphKind") && !/refused|failed/i.test(t))).toBe(true);
    expect(items.some((t) => t.includes("no graph p9"))).toBe(true);
  });

  it("a dead server names the set-up button as the way back", async () => {
    const compile = vi.fn(async () => ({ ok: false as const, error: "the local model could not answer: fetch failed" }));
    const u = setup({ compile });
    u.type("anything");
    u.enter();
    await waitFor(() => expect(u.pop()).not.toBeNull());
    const setupBtn = [...u.pop()!.querySelectorAll("button")].find((b) => /set.?up|configure/i.test(b.textContent ?? ""));
    expect(setupBtn).toBeDefined();
    fireEvent.click(setupBtn!);
    expect(u.onSetup).toHaveBeenCalledOnce();
  });

  it("Escape closes the popover; typing again reopens nothing until the next Enter", async () => {
    const u = setup();
    u.type("make it a violin");
    u.enter();
    await waitFor(() => expect(u.pop()).not.toBeNull());
    fireEvent.keyDown(u.input()!, { key: "Escape" });
    expect(u.pop()).toBeNull();
    u.type("make it a violin plot");
    expect(u.pop()).toBeNull();
  });
});
