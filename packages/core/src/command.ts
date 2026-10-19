/**
 * Command stack — undo/redo for every document mutation.
 * Every change to the document goes through a Command so it
 * is reversible.
 */

export interface Command {
  readonly label: string;
  do(): void;
  undo(): void;
  /**
   * Coalesce key for continuous gestures (e.g. a mouse-drag resize). When set,
   * consecutive commands with the same key collapse into one undo entry: the
   * latest value is applied (redo replays it) while undo restores the value from
   * before the gesture began. Omit for normal one-shot commands.
   */
  readonly coalesceKey?: string;
}

export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  /** Run a command and record it; clears the redo history (new branch). */
  execute(command: Command): void {
    command.do();
    const top = this.undoStack[this.undoStack.length - 1];
    if (command.coalesceKey && top && top.coalesceKey === command.coalesceKey) {
      // Same gesture: keep the gesture-start `undo`, replay the latest `do`.
      this.undoStack[this.undoStack.length - 1] = {
        label: top.label,
        coalesceKey: command.coalesceKey,
        do: command.do.bind(command),
        undo: top.undo.bind(top),
      };
    } else {
      this.undoStack.push(command);
    }
    this.redoStack.length = 0;
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.do();
    this.undoStack.push(command);
  }

  /** Drop all history — e.g. after loading a document, so its construction
   *  isn't user-undoable (you can't "undo opening the file"). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
