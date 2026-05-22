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

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/sync-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, userId }),
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
      } catch {
        if (!cancelled) {
          refreshTimer = window.setTimeout(fetchOnce, 5_000);
        }
      }
    };

    void fetchOnce();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [roomId, userId]);

  return token;
}
