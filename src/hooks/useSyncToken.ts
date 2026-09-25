"use client";

import { useEffect, useState } from "react";

// Fetches the HS256 token the sync worker needs, and refreshes it ~2 min
// before its 15-min TTL.
//
// The token route only answers once this user has an ADMITTED join_requests
// row. Two things make the first token fast:
//  - prefetchSyncToken() starts the request as soon as admission is known
//    (the host's self-admit resolving; a guest's room tree mounting), not
//    when the lazily loaded WhiteboardCanvas finally mounts. The hook then
//    picks up that in-flight request instead of starting its own.
//  - A refused request (403 because a new room's self-admit hasn't landed
//    yet, or a network blip) retries after 0.3 / 0.8 / 2 s before settling
//    at 5 s. It used to wait a flat 5 s, which on a brand-new room — every
//    new lesson — often left the board offline for 5 s at the start.

const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000;
export const TOKEN_RETRY_DELAYS_MS = [300, 800, 2000];
const TOKEN_RETRY_SLOW_MS = 5_000;

type Token = { token: string; expiresAt: number };

export function tokenRetryDelay(attempt: number): number {
  return TOKEN_RETRY_DELAYS_MS[attempt] ?? TOKEN_RETRY_SLOW_MS;
}

async function requestToken(
  roomId: string,
  userId: string,
  signal?: AbortSignal,
): Promise<Token> {
  const res = await fetch("/api/sync-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, userId }),
    signal,
  });
  if (!res.ok) throw new Error(`sync-token ${res.status}`);
  return (await res.json()) as Token;
}

// One prefetched request per room+user, handed to the hook when it mounts.
const prefetched = new Map<string, Promise<Token>>();
const keyOf = (roomId: string, userId: string) => `${roomId}\n${userId}`;

/** Starts fetching the sync token now, for useSyncToken to pick up. Call
 *  once admission is known. A failed prefetch is simply dropped — the hook
 *  then fetches (and retries) on its own. */
export function prefetchSyncToken(roomId: string, userId: string): void {
  if (!roomId || !userId || typeof window === "undefined") return;
  const key = keyOf(roomId, userId);
  if (prefetched.has(key)) return;
  const p = requestToken(roomId, userId);
  prefetched.set(key, p);
  p.catch(() => {
    if (prefetched.get(key) === p) prefetched.delete(key);
  });
}

/** Tests only. */
export function clearPrefetchedSyncTokens(): void {
  prefetched.clear();
}

export function useSyncToken(
  roomId: string,
  userId: string,
): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();

    const apply = (data: Token) => {
      if (cancelled) return;
      attempt = 0;
      setToken(data.token);
      const refreshAt = Math.max(
        5_000,
        data.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS,
      );
      refreshTimer = window.setTimeout(fetchOnce, refreshAt);
    };

    const fetchOnce = async () => {
      try {
        apply(await requestToken(roomId, userId, controller.signal));
      } catch (e) {
        // AbortError on unmount/room change: nothing to do, the effect is
        // going away. Anything else (403 before admission lands, network):
        // retry, quickly at first.
        if (cancelled) return;
        if ((e as { name?: string })?.name === "AbortError") return;
        refreshTimer = window.setTimeout(fetchOnce, tokenRetryDelay(attempt++));
      }
    };

    const key = keyOf(roomId, userId);
    const early = prefetched.get(key);
    if (early) {
      prefetched.delete(key);
      early.then(
        (data) => {
          // Still comfortably valid? Use it; otherwise fetch a fresh one.
          if (data.expiresAt - Date.now() > REFRESH_BEFORE_EXPIRY_MS) apply(data);
          else if (!cancelled) void fetchOnce();
        },
        () => {
          if (!cancelled) void fetchOnce();
        },
      );
    } else {
      void fetchOnce();
    }
    return () => {
      cancelled = true;
      controller.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [roomId, userId]);

  return token;
}
