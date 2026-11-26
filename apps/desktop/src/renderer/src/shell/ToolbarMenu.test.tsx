// @vitest-environment jsdom
/** ToolbarMenu — the figure toolbar's Align ▾ / Line up ▾ / Insert ▾ / Style ▾ menus. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ToolbarMenu } from "./ToolbarMenu";

afterEach(cleanup);

const setup = (props: { closeOnPick?: boolean; disabled?: boolean } = {}) => {
  const act = vi.fn();
  const { container } = render(
    <div>
      <ToolbarMenu label="Line up" title="Line up the selected panels" {...props}>
        <button type="button" onClick={act}>Left</button>
        <button type="button" disabled>Needs 3</button>
        <label><input type="checkbox" /> Switch</label>
      </ToolbarMenu>
      <span className="outside">elsewhere</span>
    </div>,
  );
  const opener = container.querySelector("button.laymenu-btn") as HTMLButtonElement;
  const panel = () => container.querySelector(".laymenu-panel");
  const item = (t: string) => [...container.querySelectorAll(".laymenu-panel button")].find((b) => b.textContent === t) as HTMLButtonElement;
  return { container, opener, panel, item, act };
};

describe("ToolbarMenu", () => {
  it("is closed until pressed, then shows its controls; a second press closes it", () => {
    const m = setup();
    expect(m.opener.textContent).toBe("Line up ▾");
    expect(m.panel()).toBeNull();
    fireEvent.click(m.opener);
    expect(m.panel()).not.toBeNull();
    expect(m.opener.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(m.opener);
    expect(m.panel()).toBeNull();
  });

  it("closes on a press outside it and on Escape — not on its own controls", () => {
    const m = setup();
    fireEvent.click(m.opener);
    fireEvent.pointerDown(m.panel()!.querySelector("input")!);
    expect(m.panel(), "a press inside closed it").not.toBeNull();
    fireEvent.pointerDown(m.container.querySelector(".outside")!);
    expect(m.panel()).toBeNull();
    fireEvent.click(m.opener);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(m.panel()).toBeNull();
  });

  it("closeOnPick: an action closes it (and runs); a disabled one or a switch does not close it", () => {
    const m = setup({ closeOnPick: true });
    fireEvent.click(m.opener);
    fireEvent.click(m.item("Needs 3"));
    expect(m.panel()).not.toBeNull();
    fireEvent.click(m.panel()!.querySelector("input")!);
    expect(m.panel()).not.toBeNull();
    fireEvent.click(m.item("Left"));
    expect(m.act).toHaveBeenCalledTimes(1);
    expect(m.panel()).toBeNull();
  });

  it("closeOnPick spares a control marked data-keep-open — Add image… must outlive its own click (its file input is inside)", () => {
    const pick = vi.fn();
    const { container } = render(
      <ToolbarMenu label="Insert" title="Insert" closeOnPick>
        <span data-keep-open><button type="button" onClick={pick}>Image…</button></span>
      </ToolbarMenu>,
    );
    fireEvent.click(container.querySelector("button.laymenu-btn")!);
    fireEvent.click([...container.querySelectorAll(".laymenu-panel button")].find((b) => b.textContent === "Image…")!);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".laymenu-panel"), "the menu closed and took the file picker with it").not.toBeNull();
  });

  it("without closeOnPick an action leaves it open (a menu of switches)", () => {
    const m = setup();
    fireEvent.click(m.opener);
    fireEvent.click(m.item("Left"));
    expect(m.act).toHaveBeenCalledTimes(1);
    expect(m.panel()).not.toBeNull();
  });

  it("disabled: cannot open, and says why in its title", () => {
    const m = setup({ disabled: true });
    expect(m.opener.disabled).toBe(true);
    expect(m.opener.title).toBe("Line up the selected panels");
    fireEvent.click(m.opener);
    expect(m.panel()).toBeNull();
  });
});
