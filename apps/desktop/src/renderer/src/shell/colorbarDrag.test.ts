import { describe, expect, it } from "vitest";
import { colorbarDragPatch } from "./colorbarDrag";

describe("colorbarDragPatch — which setting a key's drag writes", () => {
  it("no target: the heatmap bar / size legend / table offset", () => {
    expect(colorbarDragPatch({}, 3, 4)).toEqual({ colorbarOffset: { dx: 3, dy: 4 } });
  });
  it("the colour bar of a graph coloured by a column keeps its own offset", () => {
    expect(colorbarDragPatch({}, -5, 6, "colorByBar")).toEqual({ colorByBarOffset: { dx: -5, dy: 6 } });
  });
  it("the zone key keeps its own offset", () => {
    expect(colorbarDragPatch({}, 7, -8, "zoneKey")).toEqual({ zoneLegendOffset: { dx: 7, dy: -8 } });
  });
  it("a strip key is stored under its strip's column, beside the other strips' keys and the rest of the tracks settings", () => {
    const plot = { tracks: { trackGap: 6, keyOffsets: { shan: { dx: 1, dy: 2 } } } };
    expect(colorbarDragPatch(plot, 10, 20, "trackKey:bac")).toEqual({
      tracks: { trackGap: 6, keyOffsets: { shan: { dx: 1, dy: 2 }, bac: { dx: 10, dy: 20 } } },
    });
  });
  it("a scale bar's offset is stored on the axis it measures, beside the rest of that axis and of its scale bar", () => {
    const plot = { xAxis: { hidden: true, scaleBar: { length: 5, label: "5 µm" } }, yAxis: { hidden: true, scaleBar: { length: 2 } } };
    expect(colorbarDragPatch(plot, 4, 9, "scaleBar:x")).toEqual({ xAxis: { hidden: true, scaleBar: { length: 5, label: "5 µm", offset: { dx: 4, dy: 9 } } } });
    expect(colorbarDragPatch(plot, 4, 9, "scaleBar:y")).toEqual({ yAxis: { hidden: true, scaleBar: { length: 2, offset: { dx: 4, dy: 9 } } } });
  });
  it("a scale bar that no longer exists is not invented by a stray drag", () => {
    expect(colorbarDragPatch({}, 4, 9, "scaleBar:x")).toEqual({});
  });
  it("a strip key on a plot with no tracks settings yet creates them", () => {
    expect(colorbarDragPatch({}, 1, 1, "trackKey:x")).toEqual({ tracks: { keyOffsets: { x: { dx: 1, dy: 1 } } } });
  });
});
