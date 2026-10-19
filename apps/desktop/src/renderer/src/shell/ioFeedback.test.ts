import { describe, expect, it } from "vitest";
import { AUTOSAVE_FAIL_THRESHOLD, exportErrorMessage, nextAutosaveFailures, readErrorMessage, saveErrorMessage } from "./ioFeedback";

describe("saveErrorMessage (a failed save must not read as success)", () => {
  it("returns null on a successful save", () => {
    expect(saveErrorMessage({ ok: true, path: "C:/x/proj.mady" })).toBeNull();
  });

  it("returns null when the user cancels the native dialog (deliberate no-op, stays silent)", () => {
    expect(saveErrorMessage({ ok: false, canceled: true })).toBeNull();
  });

  it("surfaces a real write failure with the underlying error and a clear 'not saved' warning", () => {
    const msg = saveErrorMessage({ ok: false, error: "EACCES: permission denied" });
    expect(msg).not.toBeNull();
    expect(msg).toContain("EACCES: permission denied");
    expect(msg).toContain("NOT been saved");
  });

  it("still warns when the failure carries no error string", () => {
    const msg = saveErrorMessage({ ok: false });
    expect(msg).toContain("unknown error");
    expect(msg).toContain("NOT been saved");
  });
});

describe("exportErrorMessage (a failed export must not read as success)", () => {
  it("is silent on success and on cancel", () => {
    expect(exportErrorMessage({ ok: true })).toBeNull();
    expect(exportErrorMessage({ ok: false, canceled: true })).toBeNull();
  });
  it("surfaces a real write failure with its error", () => {
    expect(exportErrorMessage({ ok: false, error: "ENOSPC: no space left" })).toContain("ENOSPC: no space left");
    expect(exportErrorMessage({ ok: false })).toContain("unknown error");
  });
});

describe("readErrorMessage (a read error must not look like Cancel)", () => {
  it("is silent on success and on cancel", () => {
    expect(readErrorMessage({ ok: true })).toBeNull();
    expect(readErrorMessage({ ok: false, canceled: true })).toBeNull();
  });
  it("surfaces a real read failure with its error", () => {
    expect(readErrorMessage({ ok: false, error: "EISDIR: is a directory" })).toContain("EISDIR: is a directory");
    expect(readErrorMessage({ ok: false })).toContain("unknown error");
  });
});

describe("nextAutosaveFailures (autosave must not fail forever in silence)", () => {
  it("counts consecutive failures and crosses the threshold, then resets on a success", () => {
    let n = 0;
    n = nextAutosaveFailures(n, false);
    n = nextAutosaveFailures(n, false);
    expect(n).toBe(2);
    expect(n >= AUTOSAVE_FAIL_THRESHOLD).toBe(false); // not yet warning
    n = nextAutosaveFailures(n, false);
    expect(n).toBe(3);
    expect(n >= AUTOSAVE_FAIL_THRESHOLD).toBe(true); // now warn
    n = nextAutosaveFailures(n, true);
    expect(n).toBe(0); // a single success clears it
  });
});
