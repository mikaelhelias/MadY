import type { MessageBoxOptions } from "electron";

/** What the user chose when their unsaved work was about to go. */
export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * The ONE unsaved-changes prompt: closing the window, and replacing the open project with
 * another (File ▸ Open, a recent file, a dropped file, a double-clicked `.mady`). Same
 * three buttons in the same order everywhere; only the question names what is about to
 * happen.
 */
export function unsavedPromptOptions(about: "close" | "open"): MessageBoxOptions {
  return {
    type: "warning",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: about === "close" ? "Save changes before closing?" : "Save changes before opening another project?",
    detail:
      about === "close"
        ? "Your project has unsaved changes that will be lost if you don't save."
        : "The project you have open has unsaved changes. Opening another project replaces it, and they will be lost if you don't save.",
  };
}

/** The pressed button of `unsavedPromptOptions` as a choice. Anything unexpected keeps the work. */
export function unsavedChoice(response: number): UnsavedChoice {
  if (response === 0) return "save";
  if (response === 1) return "discard";
  return "cancel";
}

/** What closing the window does once the user has answered the unsaved-changes prompt. */
export interface CloseOutcome {
  /** Close the window now. */
  close: boolean;
  /** Save first (the renderer saves, then confirms the close). */
  save: boolean;
  /** Remove the crash-recovery copy: Don't Save discards the work, so the next launch must
   *  not offer to recover it. */
  clearRecovery: boolean;
}

export function closeOutcome(choice: UnsavedChoice): CloseOutcome {
  if (choice === "discard") return { close: true, save: false, clearRecovery: true };
  if (choice === "save") return { close: false, save: true, clearRecovery: false };
  return { close: false, save: false, clearRecovery: false };
}
