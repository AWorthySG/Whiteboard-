"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type AuthState = {
  user: User | null;
  loading: boolean;
};

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setState({ user: null, loading: false });
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setState({ user: data.session?.user ?? null, loading: false });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setState({ user: session?.user ?? null, loading: false });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

// Rooms a `rooms` lookup confirmed the signed-in account hosts, recorded by
// useHostStatus as `{ [roomId]: userId }`. Declared here rather than there so
// signOut() can clear it without an import cycle (useHostStatus imports
// useAuth).
export const CONFIRMED_HOST_ROOMS_KEY = "wb_confirmed_host_rooms";
// Fired on `window` when signOut() clears that record, so a mounted
// useHostStatus drops the host it got from it straight away.
export const CONFIRMED_HOST_ROOMS_CLEARED_EVENT = "wb-confirmed-host-rooms-cleared";

export async function signOut() {
  // An EXPLICIT sign-out ends host status this device only had because a
  // lookup confirmed the account — so a tutor who signs in on a student's
  // laptop or a shared iPad and signs out again doesn't leave that browser
  // hosting the room. (A SIGNED_OUT supabase-js emits on its own, e.g. a
  // rejected token refresh after an iOS resume, doesn't come through here,
  // so it can't demote the tutor mid-lesson.) Rooms this browser created or
  // claimed (wb_hosted_rooms) are untouched.
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(CONFIRMED_HOST_ROOMS_KEY);
    } catch {
      // Storage blocked: nothing was stored to clear.
    }
    window.dispatchEvent(new Event(CONFIRMED_HOST_ROOMS_CLEARED_EVENT));
  }
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Auth uses synthetic emails like `<username>@a-worthy.local`. Strip
// that suffix for display so the UI shows the bare username.
// Fallback chain handles corrupt records and edge cases:
//   1. Strip everything after @ if there's a valid local-part.
//   2. If the email is malformed (no @, empty local-part), use it raw.
//   3. If there's no email at all, return null so callers can default
//      to "Host" / "Guest" / whatever fits the context.
export function displayUsername(
  user: { email?: string | null } | null,
): string | null {
  const e = user?.email?.trim();
  if (!e) return null;
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  if (at === 0) return e.slice(1) || null; // "@x" → "x"; "@" → null
  return e.slice(0, at);
}
