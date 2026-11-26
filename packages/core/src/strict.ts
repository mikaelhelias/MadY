/**
 * Strict mutations — make silent no-ops illegal.
 *
 * Why this file exists: a direct-manipulation control can look live (real cursor, real
 * handler, real Inspector field) while the document layer quietly does nothing — because the
 * id it was handed matches no object, so a `if (!target) return;` swallows the edit. Nothing
 * throws, nothing logs, and every test stays green, because the tests assert what the code
 * does and the code "correctly" does nothing.
 *
 * The rule this enforces is narrow on purpose:
 *
 *   "You asked me to change a specific object and I could not find it" is always a bug.
 *
 * It is not the same as the legitimate no-ops that share the same `return;` shape:
 *   • the value already equals what was asked for  (`if (previous === kind) return;`)
 *   • the input is empty                           (`if (ids.size === 0) return;`)
 *   • a deliberate refusal                         (→ call `deliberateNoop`, which is silent)
 * Those are fine and stay untouched. Only an unresolved target is a defect.
 *
 * Under test this throws, so the defect fails loudly at the moment it's written. In the real
 * app it warns instead — a user must never lose their document to an assertion.
 */

/** Strict by default under a test runner; opt-in anywhere else. Guarded for the browser
 *  bundle, where `process` may not exist at all. */
function detectTestEnv(): boolean {
  try {
    return typeof process !== "undefined" && (process.env?.NODE_ENV === "test" || process.env?.VITEST === "true");
  } catch {
    return false;
  }
}

let strict = detectTestEnv();

/** Turn strict mutations on/off (tests that deliberately exercise a miss can scope this). */
export function setStrictMutations(on: boolean): void {
  strict = on;
}

/** Is strict-mutation mode active? */
export function strictMutations(): boolean {
  return strict;
}

/** Collected warnings when not strict (the real app) — lets a diagnostics view surface them
 *  instead of losing them to the console. Capped so a pathological loop can't grow it. */
const warnings: string[] = [];
const WARN_CAP = 200;

/** Every unresolved-target warning recorded this session (newest last). */
export function mutationWarnings(): readonly string[] {
  return warnings;
}

/** Clear the recorded warnings (tests / a diagnostics "reset"). */
export function clearMutationWarnings(): void {
  warnings.length = 0;
}

/**
 * A mutation could not resolve the thing it was asked to change.
 *
 * @param op     the mutation, e.g. "updateAnnotation"
 * @param detail what couldn't be resolved, e.g. `annotation "pca-arrow-0" on plot plt_7`
 * @param hint   optional: what the fix usually is (shown to whoever trips the assertion)
 *
 * Throws under test; warns in the app. Never call this for a no-change or empty-input guard.
 */
export function unresolvedTarget(op: string, detail: string, hint?: string): void {
  const msg =
    `[mady] ${op}: could not resolve ${detail} — the edit was dropped.` +
    (hint ? ` ${hint}` : "") +
    ` (A mutation that silently does nothing leaves a control that looks live but drops the` +
    ` edit. If this no-op is intended, say so with deliberateNoop().)`;
  if (strict) throw new Error(msg);
  if (warnings.length < WARN_CAP) warnings.push(msg);
  console.warn(msg);
}

/** Deliberate refusals recorded since the last reset (see `deliberateNoop`). */
const refusals: { op: string; reason: string }[] = [];

/**
 * A mutation that intentionally does nothing: its target is one the document deliberately
 * refuses to edit, so the no-op is the correct result rather than a missed target.
 *
 * Not a lint escape hatch — it is the record of a decision, and the `reason` is the point.
 * Grep for it to see every place the app deliberately refuses an edit; if a reason no longer
 * holds, delete the call and the strict check turns it back into a failing test.
 *
 * It also records the refusal, because "the document deliberately refuses X" is only correct
 * if the UI never offers X. A refusal the user can actually trigger is a dead affordance — a
 * silent no-op wearing a justification. The annotation census reads these back to catch that
 * contradiction: when it drives a delete the renderer offers and the document refuses it, a
 * silent `deliberateNoop` would let the census call it a pass while the control keeps looking
 * clickable.
 */
export function deliberateNoop(op: string, reason: string): void {
  if (refusals.length < WARN_CAP) refusals.push({ op, reason });
}

/** Deliberate refusals recorded since `clearRefusals` (tests inspect this). */
export function refusedMutations(): readonly { op: string; reason: string }[] {
  return refusals;
}

/** Reset the recorded refusals (call before driving an interaction you want to check). */
export function clearRefusals(): void {
  refusals.length = 0;
}
