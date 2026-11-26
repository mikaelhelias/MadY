import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { capturePlotStyle, MATCH_KEYS } from "./templates";

const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, ...over });

describe("capturePlotStyle — match must transfer defaults too", () => {
  it("by default skips undefined keys (template saving)", () => {
    const out = capturePlotStyle(plot({ palette: undefined }), MATCH_KEYS.colours);
    expect("palette" in out).toBe(false);
  });

  it("includeUndefined keeps undefined keys so matching a default reference RESETS targets", () => {
    // Reference uses the default palette (undefined). Matching "colours" must still
    // carry palette:undefined so the target's explicit palette gets cleared.
    const out = capturePlotStyle(plot({ palette: undefined }), MATCH_KEYS.colours, true);
    expect("palette" in out).toBe(true);
    expect(out.palette).toBeUndefined();
  });

  it("captures explicit values regardless", () => {
    const out = capturePlotStyle(plot({ palette: "Vibrant" }), MATCH_KEYS.colours, true);
    expect(out.palette).toBe("Vibrant");
  });
});
