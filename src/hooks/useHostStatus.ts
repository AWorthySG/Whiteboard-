"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  CONFIRMED_HOST_ROOMS_CLEARED_EVENT,
  CONFIRMED_HOST_ROOMS_KEY,
  useAuth,
} from "./useAuth";

// Rooms this browser created or claimed (markAsHost). Unconditional: they
// survive sign-out, like any pre-auth localStorage host.
const KEY = "wb_hosted_rooms";

// Fired on `window` when this tab adds a room to wb_hosted_rooms (markAsHost).
// Every useHostStatus instance listens and re-reads, so Settings → Claim
// takes effect in the open room without a reload. Other tabs hear the
// write through the native `storage` event instead.
export const HOSTED_ROOMS_EVENT = "wb-hosted-rooms-changed";

// Backoff between retries of a failed `rooms` lookup. A failure right after
// an iOS resume ("TypeError: Load failed") is common and usually transient.
export const LOOKUP_RETRY_DELAYS_MS = [1000, 3000, 9000] as const;
// Each lookup attempt is abandoned after this long. postgrest-js's own
// retries are switched off (`.retry(false)`) — they added ~7 s of hidden
// retrying per attempt on top of the backoff above — so a stalled lookup
// costs at most 4 × this + 13 s (~33 s) of "checking". The bound is the
// hook's own per-attempt watchdog, not just the fetch's AbortSignal: before
// the fetch, supabase-js awaits auth.getSession() (possibly a token
// refresh) with no timeout of its own, and pre-16 Safari has no
// AbortSignal.timeout. (While useAuth itself is still loading the status
// is "checking" too; that wait is bounded only by supabase-js's own auth
// initialisation.)
export const LOOKUP_TIMEOUT_MS = 5000;
// After the fast retries are spent, keep re-querying this often while the
// lookup still fails, so a Supabase blip that recovers without an `online`
// event still promotes the real host out of their own KnockGate.
export const LOOKUP_SLOW_RETRY_MS = 30_000;

// "checking" = not known yet. RoomShell shows its spinner for it rather than
// the guest flow, so a signed-in host never knocks on their own room.
export type HostStatus = "checking" | "host" | "guest";

function readHosted(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeHosted(rooms: Set<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...rooms]));
  } catch {
    // no-op
  }
}

// Rooms a `rooms` lookup confirmed, tagged with the account that owns them:
// `{ [roomId]: userId }` under CONFIRMED_HOST_ROOMS_KEY. Kept apart from
// wb_hosted_rooms because it must NOT outlive an explicit sign-out (see
// signOut in useAuth) or carry over to a different account.
function readConfirmed(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CONFIRMED_HOST_ROOMS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

// Best-effort: a no-op when writes are blocked (e.g. Safari private mode);
// the mounted hook keeps its in-memory copy either way.
function writeConfirmed(roomId: string, userId: string) {
  try {
    const all = readConfirmed();
    if (all[roomId] === userId) return;
    all[roomId] = userId;
    window.localStorage.setItem(CONFIRMED_HOST_ROOMS_KEY, JSON.stringify(all));
  } catch {
    // no-op
  }
}

// An AbortSignal that fires after LOOKUP_TIMEOUT_MS, where supported
// (AbortSignal.timeout is Safari 16+); undefined means "no timeout".
function lookupTimeoutSignal(): AbortSignal | undefined {
  try {
    return typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
      : undefined;
  } catch {
    return undefined;
  }
}

// Mark this browser as the host for a room. If a signed-in user is
// provided, also writes an authoritative row into the rooms table so the
// same person can host from any other signed-in device.
export async function markAsHost(
  roomId: string,
  user?: User | null,
  displayName?: string,
) {
  const rooms = readHosted();
  rooms.add(roomId);
  writeHosted(rooms);
  // Local ownership is live from here, so tell any mounted useHostStatus
  // now — before the network — rather than leaving it to the next reload.
  window.dispatchEvent(new Event(HOSTED_ROOMS_EVENT));

  if (user) {
    const supabase = getSupabase();
    if (supabase) {
      // The email column on `rooms` is kept for back-compat — it now
      // stores the synthetic username@a-worthy.local string, but nobody
      // reads it for display. Display uses the username portion only.
      const username = user.email
        ? user.email.slice(0, user.email.lastIndexOf("@") || undefined)
        : null;
      // Supabase never throws on a failed write — it RETURNS `{ error }`.
      // This used to be a bare `await`, so an RLS rejection (the row is
      // owned by another account) or a dropped connection was swallowed
      // and Settings' "Claim this room" reported success regardless.
      // The localStorage write above has already happened, so the host
      // keeps local ownership either way; this throw only reports that
      // the cross-device (account) half didn't stick.
      const { error } = await supabase.from("rooms").upsert(
        {
          id: roomId,
          host_user_id: user.id,
          host_email: user.email ?? null,
          host_name: displayName?.trim() || username || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) throw new Error(error.message);
    }
  }
}

// What this browser's storage says about `roomId`: created/claimed here
// (`explicit`), and/or confirmed by a lookup for account `confirmedBy`.
type LocalAnswer = {
  roomId: string;
  explicit: boolean;
  confirmedBy: string | null;
};
// `host: null` = no successful lookup yet for this key. `gaveUp` = every
// retry failed, so stop reporting "checking" (a signed-in student must still
// be able to knock) while online / visibilitychange keep retrying.
type RemoteAnswer = { key: string; host: boolean | null; gaveUp: boolean };

const remoteKey = (roomId: string, userId: string | null) =>
  `${roomId}\n${userId ?? ""}`;

// Whether the current browser owns the room. Owning means either:
//   - this browser's wb_hosted_rooms lists the room (it created or claimed
//     it), OR
//   - an earlier lookup on this browser confirmed it for the account that
//     is signed in now — or for the last account, while nobody is signed in
//     (see below), OR
//   - we're signed in and our user id matches rooms.host_user_id.
//
// Hardened against the flips that used to demote the tutor mid-lesson and
// remount the whole room into KnockGate:
//   - The lookup is keyed on `user?.id`, not the `user` object. supabase-js
//     emits SIGNED_IN with a freshly parsed user on every hidden→visible
//     switch and TOKEN_REFRESHED hourly; neither is a new user.
//   - Sticky: once "host", the answer holds until the room or the signed-in
//     user id changes. A later lookup that errors (or disagrees) can't demote.
//   - A failed lookup keeps the last answer and retries with backoff, then
//     slowly (LOOKUP_SLOW_RETRY_MS) for as long as it keeps failing, and
//     again on `online` and on visibilitychange → visible.
//   - A confirmed remote host is recorded in wb_confirmed_host_rooms, tagged
//     with the account, and promoted into the local tier at once. A fresh
//     storage context (the iOS home-screen PWA, a room opened from a link)
//     then stays host through later network blips and through a SIGNED_OUT
//     that supabase-js emits on its own (a rejected refresh after an iOS
//     resume) — with no host → guest → host flicker, which remounted the
//     room twice. It does NOT count for a different signed-in account, and
//     an explicit signOut() clears it, so a shared device stops hosting.
//   - "checking" is reported only until the first answer for a room. After
//     that, a newly signed-in user reads as "guest" until their lookup
//     confirms, instead of flashing the spinner and remounting the room.
export function useHostStatus(roomId: string): HostStatus {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const key = remoteKey(roomId, userId);

  const [local, setLocal] = useState<LocalAnswer | null>(null);
  const [remote, setRemote] = useState<RemoteAnswer | null>(null);
  // Bumped to re-run the lookup effect (online / visible / hosted-rooms change).
  const [refreshNonce, setRefreshNonce] = useState(0);
  // The room whose status has resolved at least once in this mount.
  const [settledRoom, setSettledRoom] = useState<string | null>(null);
  const statusRef = useRef<HostStatus>("checking");

  // Local tier, plus the triggers that re-read it and re-run the lookup.
  // (Read in an effect, never during render — see the RoomShell note on
  // client-only rendering.)
  useEffect(() => {
    const read = () => {
      const explicit = readHosted().has(roomId);
      const confirmedBy = readConfirmed()[roomId] ?? null;
      // Storage only grows (between explicit sign-outs, which go through
      // `forget` below), so never demote on a re-read: a blocked or cleared
      // storage read mid-lesson must not flip the host.
      setLocal((prev) => {
        if (prev?.roomId !== roomId) return { roomId, explicit, confirmedBy };
        const nextExplicit = prev.explicit || explicit;
        const nextConfirmedBy = confirmedBy ?? prev.confirmedBy;
        return nextExplicit === prev.explicit &&
          nextConfirmedBy === prev.confirmedBy
          ? prev
          : { roomId, explicit: nextExplicit, confirmedBy: nextConfirmedBy };
      });
    };
    // signOut() cleared the lookup-confirmed record (this tab, or another
    // one via the storage event): drop the host it gave.
    const forget = () => {
      setLocal((prev) =>
        prev && prev.confirmedBy !== null ? { ...prev, confirmedBy: null } : prev,
      );
    };
    read();
    const refresh = () => {
      read();
      // Only a signed-in non-host has a lookup worth re-running; skipping
      // the bump otherwise spares RoomShell a re-render on every app switch.
      if (userId && statusRef.current !== "host") setRefreshNonce((n) => n + 1);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONFIRMED_HOST_ROOMS_KEY && e.newValue === null) forget();
      if (e.key === KEY || e.key === CONFIRMED_HOST_ROOMS_KEY || e.key === null) {
        refresh();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(HOSTED_ROOMS_EVENT, refresh);
    window.addEventListener(CONFIRMED_HOST_ROOMS_CLEARED_EVENT, forget);
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener(HOSTED_ROOMS_EVENT, refresh);
      window.removeEventListener(CONFIRMED_HOST_ROOMS_CLEARED_EVENT, forget);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [roomId, userId]);

  // Remote tier: rooms.host_user_id for the signed-in user.
  useEffect(() => {
    if (loading || !userId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const k = remoteKey(roomId, userId);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const fail = (attempt: number) => {
      if (cancelled) return;
      if (attempt < LOOKUP_RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => run(attempt + 1), LOOKUP_RETRY_DELAYS_MS[attempt]);
        return;
      }
      // Out of fast retries. Keep whatever answer we had; just stop
      // "checking" (a signed-in student must still be able to knock)…
      setRemote((prev) =>
        prev?.key === k
          ? prev.gaveUp
            ? prev
            : { ...prev, gaveUp: true }
          : { key: k, host: null, gaveUp: true },
      );
      // …and keep trying slowly until it answers (see LOOKUP_SLOW_RETRY_MS).
      timer = setTimeout(() => run(attempt), LOOKUP_SLOW_RETRY_MS);
    };

    const run = (attempt: number) => {
      // Each attempt settles exactly once: by its answer, or by the
      // watchdog after LOOKUP_TIMEOUT_MS — whichever is first. A late
      // answer from an attempt the watchdog already failed is ignored (the
      // retry it scheduled owns the outcome now).
      let settled = false;
      const settle = () => {
        if (settled || cancelled) return false;
        settled = true;
        clearTimeout(watchdog);
        return true;
      };
      watchdog = setTimeout(() => {
        if (settle()) fail(attempt);
      }, LOOKUP_TIMEOUT_MS);
      // No postgrest-level retries (this hook has its own backoff) and a
      // per-attempt timeout, so "checking" can't hang on a stalled fetch.
      let query = supabase
        .from("rooms")
        .select("host_user_id")
        .eq("id", roomId)
        .retry(false);
      const signal = lookupTimeoutSignal();
      if (signal) query = query.abortSignal(signal);
      // Supabase returns `{ error }` rather than throwing (a timeout comes
      // back as an error too); the rejection handler is only a backstop for
      // anything below it that does throw.
      query.maybeSingle().then(
        ({ data, error }) => {
          if (!settle()) return;
          if (error) {
            fail(attempt);
            return;
          }
          const host = data?.host_user_id === userId;
          // Record it for this account (see the hook comment) and promote
          // the local tier NOW, not on its next re-read — otherwise a
          // sign-out straight after rendered host → guest → host.
          // Promoted in memory even when storage is blocked (Safari private
          // mode, a full quota) and the write fails: this mount then still
          // survives a SIGNED_OUT that supabase-js emits on its own. An
          // explicit signOut() still demotes it — that goes through the
          // CONFIRMED_HOST_ROOMS_CLEARED_EVENT (`forget`), which is
          // dispatched whether or not storage works.
          if (host) {
            writeConfirmed(roomId, userId);
            setLocal((prev) =>
              prev?.roomId === roomId
                ? prev.confirmedBy === userId
                  ? prev
                  : { ...prev, confirmedBy: userId }
                : {
                    roomId,
                    explicit: readHosted().has(roomId),
                    confirmedBy: userId,
                  },
            );
          }
          setRemote((prev) => {
            if (prev?.key === k && prev.host === true) return prev; // sticky
            if (prev?.key === k && prev.host === host && !prev.gaveUp) return prev;
            return { key: k, host, gaveUp: false };
          });
        },
        () => {
          if (settle()) fail(attempt);
        },
      );
    };

    run(0);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (watchdog !== undefined) clearTimeout(watchdog);
    };
  }, [roomId, userId, loading, refreshNonce]);

  const localHere = local?.roomId === roomId ? local : null;
  // A lookup-confirmed room counts for the account it was confirmed for, and
  // also while nobody is signed in (auth still loading, or a SIGNED_OUT that
  // didn't come from signOut(), which would have cleared it) — never for a
  // different signed-in account.
  const localHost =
    localHere === null
      ? null
      : localHere.explicit ||
        (localHere.confirmedBy !== null &&
          (userId === null || userId === localHere.confirmedBy));
  const remoteHere = remote?.key === key ? remote : null;

  let raw: HostStatus;
  if (localHost === true || remoteHere?.host === true) raw = "host";
  else if (localHost === null || loading) raw = "checking";
  else if (!userId) raw = "guest";
  else if (remoteHere && (remoteHere.host === false || remoteHere.gaveUp)) raw = "guest";
  else raw = "checking"; // signed in, first lookup (or its retries) in flight

  // Once this room has resolved, never go back to "checking": that would
  // swap the live room for a spinner (remounting tldraw and LiveKit).
  const status: HostStatus =
    raw === "checking" && settledRoom === roomId ? "guest" : raw;

  useEffect(() => {
    statusRef.current = status;
    if (raw !== "checking" && settledRoom !== roomId) setSettledRoom(roomId);
  }, [status, raw, roomId, settledRoom]);

  return status;
}

// What RoomShell renders for a host status. A pure function so the gate is
// unit-tested (RoomShell itself can't mount headless):
//   "room"    — the host goes straight in.
//   "spinner" — the status is still "checking", or the remembered guest name
//               hasn't been read yet. Load-bearing for "checking": a
//               signed-in host whose ownership is still being looked up must
//               not reach KnockGate, which inserts a "pending" knock for
//               their own room (and toasts their other device).
//   "name"    — a guest with no name yet: GuestNameEntry.
//   "knock"   — a named guest: KnockGate.
export type RoomEntryView = "room" | "spinner" | "name" | "knock";
export function roomEntryView(
  status: HostStatus,
  nameBootstrapped: boolean,
  hasName: boolean,
): RoomEntryView {
  if (status === "host") return "room";
  if (status === "checking" || !nameBootstrapped) return "spinner";
  return hasName ? "knock" : "name";
}

// Boolean view of useHostStatus for callers that don't care about
// "checking" (it reads as not-host).
export function useIsHost(roomId: string): boolean {
  return useHostStatus(roomId) === "host";
}
