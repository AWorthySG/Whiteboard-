// "Is this person writing right now?" — a tiny module-level store, like
// captionsStore, so WhiteboardCanvas can publish it from tldraw's pointer
// events and VideoPanel (a separate tree, inside LiveKitRoom) can react
// without either re-rendering the room. Writing starts on a pen or
// highlighter pointer-down and ends WRITING_IDLE_MS after the last lift,
// so the pauses between words and lines don't flicker it off and on.

export const WRITING_IDLE_MS = 2000;

type Listener = (writing: boolean) => void;

let writing = false;
let penDown = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function set(next: boolean) {
  if (next === writing) return;
  writing = next;
  for (const l of listeners) l(writing);
}

/** Pen or highlighter touched down (true) or lifted (false). */
export function setPenDown(down: boolean): void {
  penDown = down;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (down) {
    set(true);
    return;
  }
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!penDown) set(false);
  }, WRITING_IDLE_MS);
}

export function isWriting(): boolean {
  return writing;
}

export function subscribeToWriting(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only. */
export function resetWritingActivity(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  penDown = false;
  writing = false;
  listeners.clear();
}
