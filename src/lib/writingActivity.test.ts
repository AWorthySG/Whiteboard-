import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WRITING_IDLE_MS,
  isWriting,
  resetWritingActivity,
  setPenDown,
  subscribeToWriting,
} from "./writingActivity";

beforeEach(() => {
  vi.useFakeTimers();
  resetWritingActivity();
});
afterEach(() => vi.useRealTimers());

describe("writing activity", () => {
  it("starts on pen-down and ends a moment after the last lift", () => {
    const seen: boolean[] = [];
    subscribeToWriting((w) => seen.push(w));
    setPenDown(true);
    expect(isWriting()).toBe(true);
    setPenDown(false);
    vi.advanceTimersByTime(WRITING_IDLE_MS - 1);
    expect(isWriting()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isWriting()).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("stays on across the gaps between strokes", () => {
    const seen: boolean[] = [];
    subscribeToWriting((w) => seen.push(w));
    for (let i = 0; i < 5; i++) {
      setPenDown(true);
      vi.advanceTimersByTime(300);
      setPenDown(false);
      vi.advanceTimersByTime(WRITING_IDLE_MS / 2);
    }
    expect(seen).toEqual([true]);
    vi.advanceTimersByTime(WRITING_IDLE_MS);
    expect(seen).toEqual([true, false]);
  });
});

// VideoPanel hands a paused camera back to LiveKit's adaptive stream by
// clearing the publication's private `requestedDisabled` (setEnabled(true)
// would force it on forever, streaming video into a hidden panel). Pin the
// livekit-client internals that relies on, so an upgrade that changes them
// fails here instead of silently wasting bandwidth.
describe("livekit-client internals used to resume video", () => {
  const src = readFileSync(
    `${process.cwd()}/node_modules/livekit-client/dist/livekit-client.esm.mjs`,
    "utf8",
  );
  it("isEnabled falls back to adaptive-stream visibility when not overridden", () => {
    expect(src).toContain(
      "return this.requestedDisabled !== undefined ? !this.requestedDisabled : this.isAdaptiveStream ? this.visible : true;",
    );
  });
  it("still has emitTrackUpdate on remote publications", () => {
    expect(src).toMatch(/\n  emitTrackUpdate\(\) \{/);
  });
});
