/** @mady/graphics — owned SVG scene-graph renderer + D3 math. */

export type {
  ScaleType,
  AxisTick,
  AxisScene,
  MarkScene,
  SeriesScene,
  LegendEntry,
  AxisLabels,
  PlotScene,
  FillSpec,
  ResolvedFont,
  SceneFonts,
  LegendLayout,
  AnnotationScene,
  PieScene,
  PieSlice,
  HeatmapScene,
  HeatCell,
  HeatSplitScene,
  HeatTrackScene,
} from "./scene.js";
export { buildBackdrop, gradientVector, WAVE_OPACITY_CAP, MAX_WAVES } from "./backdrop.js";
export type { BackdropScene } from "./backdrop.js";
export { axisTitleFontSpec, buildPlotScene, DATA_DRIVEN_KINDS, ddColorMode, parallelColoursByValue, HIGHLIGHT_DEFAULT, highlightColumnOf, isNameColumn, XY_FAMILY_KINDS, xyFamilyDatasets, mergeFontSpec, resolveFigureAnnotations, WAFFLE_ICON_CYCLE, WAFFLE_OTHER_COLOR, WAFFLE_OTHER_ID, ZONE_KEY_PAD, ZONE_KEY_GAP, ZONE_KEY_INSET, ZONE_KEY_ROW } from "./buildScene.js";
export type { BuildPlotSceneOptions } from "./buildScene.js";
export { categoryTicks, tickCategoryName } from "./categoryTicks.js";
export { legendBoxWidth, legendLabelText, wrapLegendLabel } from "./legendBox.js";
export { defaultTitleAngle, normalizeAngle } from "./axisTitleTurn.js";
export { xTickLabelPlacement, yTickLabelPlacement } from "./xTickLabel.js";
export { swarmDotRadius } from "./markGeometry.js";
export { snapRegionBox } from "./snapRegion.js";
export type { SnapBox } from "./snapRegion.js";
export { suggestScale } from "./scale.js";
export { OKABE_ITO, TOL_VIBRANT, WARM, GRAYSCALE, PALETTES, seriesColor, seriesColors } from "./palette.js";
export { scenePaletteOpt } from "./scenePalette.js";
export { describeScene } from "./describeScene.js";
export type { SceneDescription, AxisDescription, SeriesDescription } from "./describeScene.js";
export {
  COLORMAPS, colorDistance, gradientAdvice, gradientStops, hslToHex, labToHex, makeRamp,
  makeRampResolver, midpointOutOfRangeWarning, missingGradientWarning, mix, mixIn, rampColor,
  resolveBuiltinRamp, resolveGradient, resolveRamp, rgbToHsl, rgbToLab, simulateVision, visionMatrixValues,
} from "./color.js";
export type { ColorVision, RampPaint, RampResolver, RampShape, ResolvedRamp } from "./color.js";
export { sceneHasInk } from "./ink.js";
export { legendRowMetrics, wrapLegendRows, topLegendBand, LEGEND_ITEM_GAP } from "./legendTop.js";
export type { LegendRowMetrics } from "./legendTop.js";
export { splitPins } from "./splitPins.js";
