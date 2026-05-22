// Snapshot chunking helpers. Pulled out as pure functions so the
// chunk math can be tested without standing up a Durable Object.

// 96 KiB chunks fit comfortably under Cloudflare's 128 KiB per-value
// storage cap with headroom for key + metadata overhead.
export const CHUNK_SIZE = 96 * 1024;
export const CHUNK_COUNT_KEY = "snapshot:chunkCount";
export const CHUNK_PREFIX = "snapshot:chunk:";

export function chunkKey(i: number): string {
  return `${CHUNK_PREFIX}${i}`;
}

export function splitIntoChunks(json: string): Record<string, string> {
  // Always at least one chunk, even if the JSON is the empty object —
  // mirrors what the DO storage layer expects (count >= 1 means "have
  // a snapshot," count === 0 means "no snapshot yet").
  const count = Math.max(1, Math.ceil(json.length / CHUNK_SIZE));
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    out[chunkKey(i)] = json.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
  }
  return out;
}

export function chunkCount(json: string): number {
  return Math.max(1, Math.ceil(json.length / CHUNK_SIZE));
}

export function joinChunks(
  count: number,
  read: (key: string) => string | undefined,
): string | undefined {
  if (count === 0) return undefined;
  let out = "";
  for (let i = 0; i < count; i++) {
    const part = read(chunkKey(i));
    if (typeof part !== "string") return undefined;
    out += part;
  }
  return out;
}
