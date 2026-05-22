// Module-level store for live captions. Lives outside React so the
// interim caption stream (5-10 updates per second during active
// speech) doesn't propagate through React state cascades in
// RoomShell — only CaptionsHost subscribes and re-renders.
//
// Why useSyncExternalStore + module state: React's canonical pattern
// for external mutable state. Caption state isn't owned by any one
// component (CaptionsManager writes, CaptionsHost reads, both can be
// remounted independently), so a singleton store is the right shape.

import type { CaptionLine } from "@/components/CaptionsManager";

const MAX_LINES = 30;

let captionLines: readonly CaptionLine[] = [];
const subscribers = new Set<() => void>();

function notify() {
  for (const cb of subscribers) cb();
}

export function pushCaption(line: CaptionLine) {
  // Replace the speaker's previous still-interim line, otherwise append.
  const idx = captionLines.findIndex(
    (l) => l.identity === line.identity && !l.isFinal,
  );
  const next =
    idx >= 0
      ? captionLines.map((l, i) => (i === idx ? line : l))
      : [...captionLines, line];
  captionLines = next.slice(-MAX_LINES);
  notify();
}

export function clearCaptions() {
  if (captionLines.length === 0) return;
  captionLines = [];
  notify();
}

export function subscribeToCaptions(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getCaptionsSnapshot(): readonly CaptionLine[] {
  return captionLines;
}

export function getCaptionsServerSnapshot(): readonly CaptionLine[] {
  return [];
}
