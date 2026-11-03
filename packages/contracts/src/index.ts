/**
 * @mady/contracts — shared, dependency-free, DOM-free type contracts.
 *
 * Home for the stats wire protocol and the Electron IPC
 * channel types. Imported by both `apps/desktop/main` (Node side) and the
 * renderer-side packages, so neither side duplicates the types.
 *
 * Runtime validators check the same contracts at engine boundaries.
 */
export const CONTRACT_VERSION = 1 as const;

export type * from "./protocol";
export type * from "./analysis.js";
export { assertAnalysisResult, isAnalysisCurve, isRecord, parseEngineMessage } from "./validation.js";
