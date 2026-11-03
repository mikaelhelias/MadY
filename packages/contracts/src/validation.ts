import type { EngineMessage, ErrorCode } from "./protocol.js";
import type { AnalysisResult } from "./analysis.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const scalar = (v: unknown): boolean => v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
const strings = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === "string");
const codes: readonly ErrorCode[] = ["bad_request", "unsupported_method", "numerical", "cancelled", "engine_crash", "engine_internal", "timeout"];

/** Validate untrusted JSON before treating it as a protocol message. */
export function parseEngineMessage(value: unknown): EngineMessage {
  if (!isRecord(value)) throw new Error("Engine message must be an object.");
  if (value.type === "hello") {
    if (typeof value.engine !== "string" || typeof value.version !== "string" || !Number.isInteger(value.contractVersion)
      || (value.libraries !== undefined && (!isRecord(value.libraries) || !Object.values(value.libraries).every(v => typeof v === "string"))))
      throw new Error("Invalid engine handshake.");
  } else if (typeof value.id !== "string" || !value.id) {
    throw new Error("Engine response has no request id.");
  } else if (value.type === "result") {
    if (value.ok !== true || !isRecord(value.results)
      || (value.diagnostics !== undefined && !isRecord(value.diagnostics))
      || (value.warnings !== undefined && !strings(value.warnings))) throw new Error("Invalid engine success response.");
  } else if (value.type === "error") {
    if (value.ok !== false || typeof value.message !== "string" || !codes.some(c => c === value.code)) throw new Error("Invalid engine error response.");
  } else throw new Error("Unknown engine message type.");
  return value as unknown as EngineMessage;
}

/** Curve samples may contain null gaps, but paired arrays must remain aligned. */
export function isAnalysisCurve(value: unknown): value is {
  x: (number | null)[]; y: (number | null)[]; ciLow?: (number | null)[]; ciHigh?: (number | null)[]; piLow?: (number | null)[]; piHigh?: (number | null)[]; label?: string;
} {
  if (!isRecord(value) || !Array.isArray(value.x) || !Array.isArray(value.y) || value.x.length !== value.y.length) return false;
  const numeric = (v: unknown): boolean => v === null || (typeof v === "number" && Number.isFinite(v));
  if (!value.x.every(numeric) || !value.y.every(numeric) || (value.label !== undefined && typeof value.label !== "string")) return false;
  for (const key of ["ciLow", "ciHigh", "piLow", "piHigh"]) {
    const band = value[key];
    if (band !== undefined && (!Array.isArray(band) || band.length !== value.x.length || !band.every(numeric))) return false;
  }
  return true;
}

/** Shared result contract, checked before a result can be stored or rendered. */
export function assertAnalysisResult(value: unknown, expectedMethod?: string): asserts value is AnalysisResult {
  if (!isRecord(value) || typeof value.method !== "string" || !value.method || typeof value.title !== "string"
    || typeof value.summary !== "string" || !Array.isArray(value.terms) || !isRecord(value.glance)
    || !Object.values(value.glance).every(v => typeof v === "boolean" || scalar(v))
    || !value.terms.every(t => isRecord(t) && typeof t.term === "string" && Object.values(t).every(v => v === undefined || typeof v === "boolean" || scalar(v))
      && ["se", "statistic", "p", "ciLow", "ciHigh"].every(key => t[key] === undefined || t[key] === null || (typeof t[key] === "number" && Number.isFinite(t[key])))
      && ["estimate", "df"].every(key => t[key] === undefined || scalar(t[key]))))
    throw new Error("Invalid analysis result: expected method, title, summary, terms and glance.");
  const canonical = (method: string): string => method === "anova" ? "anova1" : method;
  if (expectedMethod && canonical(value.method) !== canonical(expectedMethod)) throw new Error("Engine result belongs to a different analysis method.");
  for (const key of ["assumptions", "warnings", "flagReasons"]) {
    if (value[key] !== undefined && !strings(value[key])) throw new Error(`Invalid analysis result: ${key} must contain text.`);
  }
  if ((value.cite !== undefined && typeof value.cite !== "string") || (value.flagged !== undefined && typeof value.flagged !== "boolean")
    || (value.extra !== undefined && !isRecord(value.extra))) throw new Error("Invalid analysis result metadata.");
  const extra = value.extra as Record<string, unknown> | undefined;
  const curve = value.method === "regression" ? extra?.curve : value.curve;
  if (curve !== undefined && !isAnalysisCurve(curve)) throw new Error("Invalid analysis curve: expected aligned numeric arrays.");
  if ((value.method === "globalfit" || value.method === "meltingtemp") && extra?.curves !== undefined
    && (!Array.isArray(extra.curves) || !extra.curves.every(isAnalysisCurve))) throw new Error(`Invalid ${value.method === "globalfit" ? "global-fit" : "melting-temperature"} curves.`);
}
