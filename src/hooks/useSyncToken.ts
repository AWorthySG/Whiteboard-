"use client";

import { useEffect, useState } from "react";

// Refresh the sync token 2 minutes before it expires so the live
// WebSocket connection never carries an expired credential.
const REFRESH_BEFORE_EXPIRY_MS = 2 * 60 * 1000;

// Fetches an HMAC-signed token from /api/sync-token that authorises
// the caller to connect to the Cloudflare sync worker for `roomId`.
// Returns null until the first token arrives.
export function useSyncToken(
  roomId: string,
  userId: string,
): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !userId) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    // Abort an in-flight token fetch when the hook tears down (room
    // change, unmount). The `cancelled` flag already guards against
    // resolved-after-unmount setState, but without the abort the
    // network request still completes and its response is decoded
    // before the guard catches it — wasted work, and on a slow
    // /api/sync-token the request can outlive the route.
    const controller = new AbortController();

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/sync-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, userId }),
          signal: controller.signal,
        });
        if (!res.ok) {
          // 403 = not admitted yet. KnockGate is the gate; this hook
          // just rides whatever signal it produces. Retry after a
          // short backoff so the token is in hand by the time the
          // user is admitted.
          if (!cancelled) {
            refreshTimer = window.setTimeout(fetchOnce, 5_000);
          }
          return;
        }
        const data = (await res.json()) as {
          token: string;
          expiresAt: number;
        };
        if (cancelled) return;
        setToken(data.token);
        const refreshAt = Math.max(
          5_000,
          data.expiresAt - Date.now() - REFRESH_BEFORE_EXPIRY_MS,
        );
        refreshTimer = window.setTimeout(fetchOnce, refreshAt);
      } catch (e) {
        // AbortError on unmount/room change: nothing to do, the
        // effect is going away. Anything else: backoff and retry.
        if (cancelled) return;
        if ((e as { name?: string })?.name === "AbortError") return;
        refreshTimer = window.setTimeout(fetchOnce, 5_000);
      }
    };

    void fetchOnce();
    return () => {
      cancelled = true;
      controller.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [roomId, userId]);

  return token;
}
