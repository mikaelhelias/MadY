import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { percentText } from "./percent";

describe("percentText", () => {
  it("a share that is there but rounds to nothing reads \"<1\", never \"0\"; one short of the whole reads \">99\"", () => {
    expect(percentText(0.004)).toBe("<1");
    expect(percentText(0.0004, 1)).toBe("<0.1");
    expect(percentText(0.996)).toBe(">99");
    expect(percentText(0)).toBe("0");
    expect(percentText(1)).toBe("100");
  });

  it("an exact half goes up, whatever binary dust the fraction carries", () => {
    expect(percentText(0.31499999999999995)).toBe("32"); // 31.5 / 100.00000000000001
    expect(percentText(0.315)).toBe("32");
    expect(percentText(0.085)).toBe("9");
    expect(percentText(0.005)).toBe("1");
  });
  it("a value that is really below the half stays below", () => {
    expect(percentText(0.3149)).toBe("31");
    expect(percentText(0.31499)).toBe("31");
    expect(percentText(0.3149999)).toBe("31");
  });
  it("plain values, the ends and a requested number of decimals", () => {
    expect(percentText(0)).toBe("0");
    expect(percentText(1)).toBe("100");
    expect(percentText(0.3333333333)).toBe("33");
    expect(percentText(0.31499999999999995, 1)).toBe("31.5");
    expect(percentText(0.12345, 1)).toBe("12.3");
  });
  it("not a number gives no text", () => {
    expect(percentText(NaN)).toBe("");
    expect(percentText(Infinity)).toBe("");
  });
});

describe("a pie's percent labels", () => {
  const shares = [31.5, 14.2, 13.1, 8.4, 7.9, 4.4, 12.0, 8.5];
  const table = {
    id: "t", kind: "partsofwhole", name: "t",
    columns: [{ id: "x", name: "Item", role: "x" }, { id: "v", name: "Share", role: "y" }],
    rows: shares.map((v, i) => ({ id: `r${i}`, cells: { x: `Item ${i + 1}`, v } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "pie" } as unknown as Plot;

  it("31.5 % and 8.5 % both read as halves rounded up: 32 % and 9 %", () => {
    const s = buildPlotScene(table, plot, { width: 560, height: 480 });
    const labels = s.pie!.slices.map((x) => x.labelText);
    // The fixture carries binary dust: the shares add up to a hair over 100, so 31.5 % comes out just under 31.5.
    expect(s.pie!.slices[0]!.fraction * 100, "no binary dust — the fixture proves nothing").toBeLessThan(31.5);
    expect(labels[0]).toBe("32%");
    expect(labels[7]).toBe("9%");
    expect(labels).toEqual(["32%", "14%", "13%", "8%", "8%", "4%", "12%", "9%"]);
  });
});
