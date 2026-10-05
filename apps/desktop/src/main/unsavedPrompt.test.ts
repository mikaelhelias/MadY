/**
 * The unsaved-changes prompt is shared by closing the window and by opening another project.
 * The close wording is pinned exactly, so a change to what the user reads on closing is
 * deliberate.
 */
import { describe, expect, it } from "vitest";
import { closeOutcome, unsavedChoice, unsavedPromptOptions } from "./unsavedPrompt";

describe("unsavedPromptOptions", () => {
  it("closing: asks to save before closing, with Save / Don't Save / Cancel", () => {
    expect(unsavedPromptOptions("close")).toEqual({
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: "Save changes before closing?",
      detail: "Your project has unsaved changes that will be lost if you don't save.",
    });
  });

  it("opening: same buttons, Esc still cancels, and the question says a project is being replaced", () => {
    const o = unsavedPromptOptions("open");
    expect(o.buttons).toEqual(["Save", "Don't Save", "Cancel"]);
    expect(o.cancelId).toBe(2);
    expect(o.defaultId).toBe(0);
    expect(o.message).toBe("Save changes before opening another project?");
    expect(o.detail).toMatch(/replaces it/);
  });
});

describe("unsavedChoice", () => {
  it("maps the buttons in order, and anything else keeps the work", () => {
    expect(unsavedChoice(0)).toBe("save");
    expect(unsavedChoice(1)).toBe("discard");
    expect(unsavedChoice(2)).toBe("cancel");
    expect(unsavedChoice(-1)).toBe("cancel");
    expect(unsavedChoice(7)).toBe("cancel");
  });
});

describe("closeOutcome — what closing does after the prompt", () => {
  // Don't Save is the user discarding the work: the crash-recovery copy goes with it, or the
  // next launch offers to recover exactly what they chose to throw away.
  it("Don't Save closes and removes the recovery copy", () => {
    expect(closeOutcome("discard")).toEqual({ close: true, save: false, clearRecovery: true });
  });
  it("Save saves first and keeps the copy until the save succeeds", () => {
    expect(closeOutcome("save")).toEqual({ close: false, save: true, clearRecovery: false });
  });
  it("Cancel keeps the window and the copy", () => {
    expect(closeOutcome("cancel")).toEqual({ close: false, save: false, clearRecovery: false });
  });
});
