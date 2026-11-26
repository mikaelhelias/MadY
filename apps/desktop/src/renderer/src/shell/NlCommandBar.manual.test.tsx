// @vitest-environment jsdom
/**
 * The Ask bar answers from the manual while the user types: two characters in, the matching controls
 * and chapters are listed under the box, and clicking one opens the manual at that place.
 * Enter still runs the command — the matches are an answer beside it, never instead of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NlCommandBar, type NlRunOutcome } from "./NlCommandBar";

afterEach(() => cleanup());

const okOutcome = (): NlRunOutcome => ({ compiled: { ok: true, commands: [] }, results: [] });

const setup = () => {
  const onRun = vi.fn(() => okOutcome());
  const onOpenManual = vi.fn();
  const u = render(<NlCommandBar onRun={onRun} onOpenManual={onOpenManual} />);
  const input = u.container.querySelector(".askbar-in") as HTMLInputElement;
  const hits = (): HTMLElement[] => [...u.container.querySelectorAll<HTMLElement>(".askbar-hit")];
  return { ...u, onRun, onOpenManual, input, hits };
};

describe("NlCommandBar — what the manual can answer", () => {
  it("lists nothing until two characters are typed", () => {
    const { input, hits } = setup();
    expect(hits()).toEqual([]);
    fireEvent.change(input, { target: { value: "a" } });
    expect(hits()).toEqual([]);
  });

  it("lists manual matches under the box as you type, five at most", () => {
    const { input, hits, container } = setup();
    fireEvent.change(input, { target: { value: "axis break" } });
    expect(hits().length).toBeGreaterThan(0);
    expect(hits().length).toBeLessThanOrEqual(5);
    expect(container.textContent).toContain("In the manual");
  });

  /**
   * The typed words are marked in the rows (the searched term is highlighted in
   * purple). Every word of the query that occurs in a row's name or
   * description is wrapped in a <mark>, word-prefix matching like the search itself, case
   * apart; text that is not the term is left alone.
   */
  it("marks the typed words in every row, and nothing else", () => {
    const { input, hits } = setup();
    fireEvent.change(input, { target: { value: "Axis break" } });
    const marks = hits().flatMap((h) => [...h.querySelectorAll("mark")]);
    expect(marks.length, "no word of the query is marked in any row").toBeGreaterThan(0);
    for (const m of marks) {
      expect(m.className).toBe("askbar-mark");
      expect((m.textContent ?? "").toLowerCase(), `"${m.textContent}" is marked but is not a query word`).toMatch(/^(axis|break)/);
    }
    // The first row is "Breaks (cuts)": its name must carry the mark, and "(cuts)" must not.
    const name = hits()[0]!.querySelector(".askbar-hit-name")!;
    expect(name.querySelector("mark")?.textContent).toBe("Break");
    expect(name.textContent).toBe("Breaks (cuts)");
  });

  it("clicking a match opens the manual at that place — and runs nothing", () => {
    const { input, hits, onOpenManual, onRun } = setup();
    fireEvent.change(input, { target: { value: "axis break" } });
    fireEvent.click(hits()[0]!);
    expect(onOpenManual).toHaveBeenCalledTimes(1);
    const target = onOpenManual.mock.calls[0]![0] as { entry?: string; section?: string };
    expect(target.entry ?? target.section).toBeTruthy();
    expect(onRun).not.toHaveBeenCalled();
  });

  it("Enter still runs the command, whatever the manual has to say", () => {
    const { input, onRun } = setup();
    fireEvent.change(input, { target: { value: "log the x axis" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRun).toHaveBeenCalledWith("log the x axis");
  });

  it("without an onOpenManual wiring there is no list — a row that could go nowhere is never drawn", () => {
    const u = render(<NlCommandBar onRun={() => okOutcome()} />);
    fireEvent.change(u.container.querySelector(".askbar-in") as HTMLInputElement, { target: { value: "axis break" } });
    expect(u.container.querySelectorAll(".askbar-hit").length).toBe(0);
  });
});
