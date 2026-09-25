import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  clearPrefetchedSyncTokens,
  prefetchSyncToken,
  tokenRetryDelay,
  useSyncToken,
} from "./useSyncToken";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let seen: (string | null)[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function Probe() {
  seen.push(useSyncToken("room1", "user1"));
  return null;
}

const ok = (t: string) =>
  Promise.resolve(new Response(JSON.stringify({ token: t, expiresAt: Date.now() + 15 * 60_000 }), { status: 200 }));
const refused = () => Promise.resolve(new Response("{}", { status: 403 }));

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  clearPrefetchedSyncTokens();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useSyncToken", () => {
  it("retries a refused request quickly, not after 5 s", async () => {
    fetchMock.mockImplementationOnce(refused).mockImplementationOnce(() => ok("t1"));
    await mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(tokenRetryDelay(0)); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toBe("t1");
  });

  it("backs off to 5 s after a few quick tries", () => {
    expect([0, 1, 2, 3, 9].map(tokenRetryDelay)).toEqual([300, 800, 2000, 5000, 5000]);
  });

  it("uses a prefetched token instead of fetching again", async () => {
    fetchMock.mockImplementation(() => ok("early"));
    prefetchSyncToken("room1", "user1");
    prefetchSyncToken("room1", "user1"); // deduplicated
    await mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toBe("early");
  });

  it("fetches normally when the prefetch was refused", async () => {
    fetchMock.mockImplementationOnce(refused).mockImplementationOnce(() => ok("t2"));
    prefetchSyncToken("room1", "user1");
    await flush();
    await mount();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toBe("t2");
  });
});
