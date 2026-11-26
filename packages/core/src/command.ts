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

/**
 * State outside the commands themselves that Undo puts back: what was current before a command ran (the
 * document's "out of date" marks) is current again once the command is undone, unless something since says
 * otherwise — `restore` decides.
 */
export interface UndoWatch<S> {
  capture(): S;
  restore(before: S): void;
}

export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];
  /** What `watch` captured before each recorded command ran (a coalesced gesture keeps its first). */
  private readonly before = new WeakMap<Command, unknown>();
  private watch: UndoWatch<unknown> | undefined;

  setWatch<S>(watch: UndoWatch<S>): void {
    this.watch = watch as UndoWatch<unknown>;
  }

  /** The open group: every command recorded while it is open joins one step (see `batch`, `beginGroup`). */
  private group: string | undefined;
  /** The group each recorded step belongs to. */
  private readonly groupOf = new WeakMap<Command, string>();
  private groupSeq = 0;

  /**
   * Record every command `fn` runs as one step: one user action, one Undo. Inside an open group (a box being typed
   * in) it joins that group instead.
   */
  batch(fn: () => void): void {
    if (this.group !== undefined) { fn(); return; }
    this.group = `batch:${++this.groupSeq}`;
    try { fn(); } finally { this.group = undefined; }
  }

  /** Open a group that every command joins until `endGroup` — the edits made while one box keeps the focus. */
  beginGroup(key: string): void {
    this.group = `${key}:${++this.groupSeq}`;
  }

  endGroup(): void {
    this.group = undefined;
  }

  /** Run a command and record it; clears the redo history (new branch). */
  execute(command: Command): void {
    const before = this.watch?.capture();
    command.do();
    const top = this.undoStack[this.undoStack.length - 1];
    if (this.group !== undefined && top && this.groupOf.get(top) === this.group) {
      // Same action: the step does every command in order and undoes them in reverse.
      const joined: Command = {
        label: top.label,
        do: () => { top.do(); command.do(); },
        undo: () => { command.undo(); top.undo(); },
      };
      this.groupOf.set(joined, this.group);
      if (this.before.has(top)) this.before.set(joined, this.before.get(top));
      this.undoStack[this.undoStack.length - 1] = joined;
    } else if (command.coalesceKey && top && top.coalesceKey === command.coalesceKey) {
      // Same gesture: keep the gesture-start `undo`, replay the latest `do`.
      const merged: Command = {
        label: top.label,
        coalesceKey: command.coalesceKey,
        do: command.do.bind(command),
        undo: top.undo.bind(top),
      };
      if (this.before.has(top)) this.before.set(merged, this.before.get(top));
      this.undoStack[this.undoStack.length - 1] = merged;
    } else {
      if (this.watch) this.before.set(command, before);
      if (this.group !== undefined) this.groupOf.set(command, this.group);
      this.undoStack.push(command);
    }
    this.redoStack.length = 0;
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    if (this.watch && this.before.has(command)) this.watch.restore(this.before.get(command));
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
