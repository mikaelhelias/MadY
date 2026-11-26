/**
 * Stats-engine wire protocol — types only.
 *
 * Consumers import these with `import type`, so the module erases at runtime and
 * needs no cross-package runtime resolution. The byte framing is implemented per
 * runtime (Node `Buffer` in the supervisor; `struct` in engine.py): a length-
 * prefixed frame = 4-byte big-endian length + UTF-8 JSON body, over the sidecar's
 * stdio. Every message carries a `type`; requests and responses correlate by `id`.
 *
 * Protocol version: 1.
 */

export type ErrorCode =
  | "bad_request"
  | "unsupported_method"
  | "numerical"
  | "cancelled"
  | "engine_crash"
  | "engine_internal"
  | "timeout";

/** Engine → host, sent once on spawn so the host can refuse a mismatched engine. */
export interface HelloMessage {
  type: "hello";
  engine: string;
  version: string;
  contractVersion: number;
  /**
   * Versions of the interpreter and numeric libraries that will actually compute the
   * results (python / numpy / scipy / statsmodels). Reported by the engine rather
   * than assumed by the app, so a drafted Methods paragraph cites what really ran —
   * a frozen build ships pinned wheels and reports different values from a dev
   * checkout. Optional: an older engine simply omits it.
   */
  libraries?: Record<string, string>;
}

/** Host → engine. */
export interface RequestMessage {
  type: "request";
  id: string;
  method: string;
  params?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** Host → engine: request cooperative cancellation of an in-flight id. */
export interface CancelMessage {
  type: "cancel";
  id: string;
}

/** Engine → host: terminal success for a request id. */
export interface ResultMessage {
  type: "result";
  id: string;
  ok: true;
  results: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  warnings?: string[];
}

/** Engine → host: terminal failure for a request id. */
export interface ErrorMessage {
  type: "error";
  id: string;
  ok: false;
  code: ErrorCode;
  message: string;
}

export type EngineMessage = HelloMessage | ResultMessage | ErrorMessage;
export type HostMessage = RequestMessage | CancelMessage;
