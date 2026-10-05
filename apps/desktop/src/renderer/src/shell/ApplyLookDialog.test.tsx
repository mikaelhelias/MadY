// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { ApplyLookDialog } from "./ApplyLookDialog";
import { MATCH_KEYS } from "./templates";

afterEach(cleanup);

const plot = (id: string, name: string, source: string): Plot => ({ id, name, source }) as unknown as Plot;

const source = plot("p1", "Dose curve", "t1");
const plots = [
  source,
  plot("p2", "Dose bars", "t1"), // sibling (same data t1)
  plot("p3", "Gene heatmap", "t2"), // other data
  plot("p4", "Quarterly lollipop", "t3"),
];
const tableName = (id: string): string => ({ t1: "Dose data", t2: "Genes", t3: "Quarters" })[id] ?? "—";

function setup(over: Partial<{ plots: Plot[] }> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const u = render(
    <ApplyLookDialog source={source} plots={over.plots ?? plots} tableName={tableName} onApply={onApply} onCancel={onCancel} />,
  );
  const check = (name: string) => u.container.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;
  const applyBtn = () => u.container.querySelector(".btn") as HTMLButtonElement;
  const mini = (label: string) => [...u.container.querySelectorAll(".btn-mini")].find((b) => b.textContent === label) as HTMLButtonElement;
  const aspect = (label: string) => [...u.container.querySelectorAll(".al-aspect .ng-segbtn")].find((b) => b.textContent === label) as HTMLButtonElement;
  return { ...u, onApply, onCancel, check, applyBtn, mini, aspect };
}

describe("ApplyLookDialog", () => {
  it("lists every OTHER graph and pre-checks the same-data siblings", () => {
    const d = setup();
    expect(d.container.querySelectorAll(".al-row")).toHaveLength(3); // p2/p3/p4, not the source
    expect(d.check("Dose bars").checked).toBe(true); // sibling → pre-checked
    expect(d.check("Gene heatmap").checked).toBe(false); // other data → not
    expect(d.check("Quarterly lollipop").checked).toBe(false);
    expect(d.applyBtn().textContent).toBe("Apply to 1 graph");
  });

  it("applies the chosen ASPECT's keys to exactly the checked graphs (one call)", () => {
    const d = setup();
    fireEvent.click(d.check("Gene heatmap")); // add a cross-data target
    fireEvent.click(d.aspect("Colours")); // switch aspect
    fireEvent.click(d.applyBtn());
    expect(d.onApply).toHaveBeenCalledTimes(1);
    const [ids, keys, label] = d.onApply.mock.calls[0]!;
    expect(new Set(ids)).toEqual(new Set(["p2", "p3"]));
    expect(keys).toEqual(MATCH_KEYS.colours);
    expect(label).toBe("Colours");
  });

  it("Select all / None drive the whole target set + gate the Apply button", () => {
    const d = setup();
    fireEvent.click(d.mini("None"));
    expect(d.applyBtn().disabled).toBe(true);
    expect(d.applyBtn().textContent).toBe("Apply");
    fireEvent.click(d.mini("Select all"));
    expect(d.applyBtn().disabled).toBe(false);
    expect(d.applyBtn().textContent).toBe("Apply to 3 graphs");
  });

  it("shows an empty state when there are no other graphs", () => {
    const d = setup({ plots: [source] });
    expect(d.container.textContent).toContain("no other graphs");
    expect(d.container.querySelectorAll(".al-row")).toHaveLength(0);
  });
});
