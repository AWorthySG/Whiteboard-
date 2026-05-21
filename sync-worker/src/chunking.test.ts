import { describe, it, expect } from "vitest";
import {
  CHUNK_SIZE,
  chunkCount,
  chunkKey,
  joinChunks,
  splitIntoChunks,
} from "./chunking";

describe("chunking", () => {
  it("returns at least one chunk for the empty snapshot", () => {
    const chunks = splitIntoChunks("");
    expect(Object.keys(chunks)).toEqual([chunkKey(0)]);
    expect(chunks[chunkKey(0)]).toBe("");
    expect(chunkCount("")).toBe(1);
  });

  it("keeps a sub-chunk-size payload in a single chunk", () => {
    const payload = "hello".repeat(1000);
    expect(payload.length).toBeLessThan(CHUNK_SIZE);
    const chunks = splitIntoChunks(payload);
    expect(Object.keys(chunks)).toHaveLength(1);
    expect(chunks[chunkKey(0)]).toBe(payload);
  });

  it("splits a multi-chunk payload at exact boundaries", () => {
    const payload = "x".repeat(CHUNK_SIZE * 2 + 100);
    const chunks = splitIntoChunks(payload);
    expect(Object.keys(chunks)).toHaveLength(3);
    expect(chunks[chunkKey(0)].length).toBe(CHUNK_SIZE);
    expect(chunks[chunkKey(1)].length).toBe(CHUNK_SIZE);
    expect(chunks[chunkKey(2)].length).toBe(100);
    expect(chunkCount(payload)).toBe(3);
  });

  it("round-trips: split then join reproduces the input", () => {
    const payload = JSON.stringify({
      shapes: Array.from({ length: 5000 }, (_, i) => ({
        id: `shape:${i}`,
        type: "draw",
        x: i,
        y: i,
      })),
    });
    const chunks = splitIntoChunks(payload);
    const count = chunkCount(payload);
    const joined = joinChunks(count, (k) => chunks[k]);
    expect(joined).toBe(payload);
  });

  it("returns undefined when a chunk is missing during load", () => {
    const payload = "x".repeat(CHUNK_SIZE * 2);
    const chunks = splitIntoChunks(payload);
    // Simulate a torn read by dropping chunk 1.
    const joined = joinChunks(2, (k) =>
      k === chunkKey(1) ? undefined : chunks[k],
    );
    expect(joined).toBeUndefined();
  });

  it("returns undefined for count=0 (no snapshot stored)", () => {
    expect(joinChunks(0, () => undefined)).toBeUndefined();
  });
});
