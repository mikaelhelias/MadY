// @vitest-environment jsdom
/**
 * The Ask box — at the far right of the menu bar. One input, one "Search" button, and a
 * popover under it that carries the answer: what the manual has, and what a command did.
 *
 * A menu-bar box is always there, so there is no collapsed state and no open state to persist.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NlCommandBar, type NlRunOutcome } from "./NlCommandBar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const okOutcome = (ops: string[]): NlRunOutcome => ({
  compiled: { ok: true, commands: ops.map((op) => ({ op }) as never) },
  results: ops.map(() => ({ ok: true, value: {} })),
});

const setup = (onRun: (t: string) => NlRunOutcome, withManual = true) => {
  const onOpenManual = vi.fn();
  const u = render(withManual ? <NlCommandBar onRun={onRun} onOpenManual={onOpenManual} /> : <NlCommandBar onRun={onRun} />);
  const input = u.container.querySelector(".askbar-in") as HTMLInputElement;
  const button = u.container.querySelector(".askbar-go") as HTMLButtonElement;
  const pop = () => u.container.querySelector(".askbar-pop");
  return { ...u, input, button, pop, onOpenManual };
};

describe("NlCommandBar — the Ask box in the menu bar", () => {
  it("is an input and a button that says Search — no header, nothing collapsed", () => {
    const { input, button, container } = setup(() => okOutcome([]));
    expect(input).toBeTruthy();
    expect(button.textContent).toBe("Search");
    expect(container.querySelector(".nlbar-head"), "a collapsible header is drawn above the box").toBeNull();
  });

  it("Search submits the typed text to onRun and shows a success line in the popover", () => {
    const onRun = vi.fn((_t: string) => okOutcome(["createGraph"]));
    const { input, button, pop } = setup(onRun);
    fireEvent.change(input, { target: { value: "scatter of dose vs response" } });
    fireEvent.click(button);
    expect(onRun).toHaveBeenCalledWith("scatter of dose vs response");
    expect(pop()?.textContent).toMatch(/Done · createGraph/);
  });

  it("Enter submits too", () => {
    const onRun = vi.fn((_t: string) => okOutcome(["listGraphs"]));
    const { input } = setup(onRun);
    fireEvent.change(input, { target: { value: "list graphs" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("a line that is not a command and matches nothing in the manual shows the parse error and its hint", () => {
    const onRun = () => ({ compiled: { ok: false as const, error: "I couldn't parse that.", hint: "Try \"log the x axis\"." } });
    const { input, button, pop } = setup(onRun);
    fireEvent.change(input, { target: { value: "zzqx" } });
    fireEvent.click(button);
    expect(pop()?.textContent).toMatch(/couldn't parse that.*Try/i);
    expect(pop()?.textContent).not.toMatch(/Done/);
  });

  it("a line that is not a command but is in the manual shows the matches, not an error", () => {
    // The box is a search first: "axis break" is a question, and the answer is the manual.
    const onRun = () => ({ compiled: { ok: false as const, error: "I couldn't parse that.", hint: "Try something else." } });
    const { input, button, pop } = setup(onRun);
    fireEvent.change(input, { target: { value: "axis break" } });
    fireEvent.click(button);
    expect(pop()?.querySelectorAll(".askbar-hit").length).toBeGreaterThan(0);
    expect(pop()?.textContent).not.toMatch(/couldn't parse/i);
  });

  it("surfaces an execution failure distinctly from a parse success", () => {
    const onRun = (): NlRunOutcome => ({
      compiled: { ok: true, commands: [{ op: "setAxis" }] as never },
      results: [{ ok: false, code: "not_found", error: "no graph with id 'x'" }],
    });
    const { input, button, pop } = setup(onRun);
    fireEvent.change(input, { target: { value: "log the x axis" } });
    fireEvent.click(button);
    expect(pop()?.textContent).toMatch(/Couldn’t apply that: no graph/);
  });

  it("Search is disabled until something is typed", () => {
    const { input, button } = setup(() => okOutcome(["listGraphs"]));
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "x" } });
    expect(button.disabled).toBe(false);
  });

  it("the popover closes on Escape and comes back when you type again", () => {
    const { input, pop } = setup(() => okOutcome([]));
    fireEvent.change(input, { target: { value: "axis break" } });
    expect(pop(), "no popover for a query with manual matches").toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(pop(), "Escape did not close it").toBeNull();
    fireEvent.change(input, { target: { value: "axis breaks" } });
    expect(pop(), "typing did not reopen it").toBeTruthy();
  });

  it("writes nothing to storage — there is no state to remember", () => {
    const { input } = setup(() => okOutcome([]));
    fireEvent.change(input, { target: { value: "axis break" } });
    expect(Object.keys(localStorage)).toEqual([]);
  });
});

/**
 * The status note. The command vocabulary is small, so the note tells the user that a line
 * which misses is outside the phrasings it knows, not a fault; it also states that the box works
 * offline. Both live in the popover's foot, since there is no card header to carry a label.
 */
describe("NlCommandBar — the status note in the popover's foot", () => {
  it("the popover's foot says in development, why a line may miss, and that nothing leaves the machine", () => {
    const { input, pop } = setup(() => okOutcome([]));
    fireEvent.change(input, { target: { value: "axis break" } });
    const hint = pop()?.querySelector(".askbar-hint")?.textContent ?? "";
    expect(hint).toMatch(/in development/i);
    expect(hint).toMatch(/small set of phrasings/i);
    expect(hint).toMatch(/no model, no network/i);
  });
});
