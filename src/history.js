// Undo history. Each entry is a snapshot of the settings, recorded when an edit is
// committed (a gesture ends, a slider is released), so one drag is one step.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class History {
  #undo = [];
  #redo = [];
  #current;
  #limit;

  constructor(snapshot = null, { limit = 200 } = {}) {
    this.#current = snapshot;
    this.#limit = limit;
  }

  /** Start over from `snapshot`, forgetting every step. */
  reset(snapshot) {
    this.#undo = [];
    this.#redo = [];
    this.#current = snapshot;
  }

  /** Record `snapshot` as a new step. Returns false when nothing changed. */
  commit(snapshot) {
    if (same(snapshot, this.#current)) return false;
    this.#undo.push(this.#current);
    if (this.#undo.length > this.#limit) this.#undo.shift();
    this.#redo = [];
    this.#current = snapshot;
    return true;
  }

  /** The snapshot one step back, or null at the start. */
  undo() {
    if (!this.#undo.length) return null;
    this.#redo.push(this.#current);
    this.#current = this.#undo.pop();
    return this.#current;
  }

  /** The snapshot one step forward again, or null when nothing was undone. */
  redo() {
    if (!this.#redo.length) return null;
    this.#undo.push(this.#current);
    this.#current = this.#redo.pop();
    return this.#current;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }
}
