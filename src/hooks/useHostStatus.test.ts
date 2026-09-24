import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { User } from "@supabase/supabase-js";

// A controllable fake Supabase: auth events on demand, and a `rooms`
// lookup (maybeSingle) and upsert whose results each test sets.
type Session = { user: User } | null;
type AuthListener = (evt: string, session: Session) => void;
type Lookup = { data: { host_user_id: string } | null; error: { message: string } | null };

const upsert = vi.fn();
const lookup = vi.fn<() => Promise<Lookup>>();
// What the hook chained onto each lookup (postgrest retry flag, timeout).
const retryArgs: boolean[] = [];
const signals: AbortSignal[] = [];
const authListeners = new Set<AuthListener>();
let getSession: () => Promise<{ data: { session: Session } }> = async () => ({
  data: { session: null },
});

const fake = {
  auth: {
    getSession: () => getSession(),
    onAuthStateChange: (cb: AuthListener) => {
      authListeners.add(cb);
      return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } };
    },
    // Like supabase-js: drops the session and emits SIGNED_OUT.
    signOut: async () => {
      authListeners.forEach((l) => l("SIGNED_OUT", null));
      return { error: null };
    },
  },
  from: () => ({
    upsert,
    select: () => ({
      eq: () => {
        const q = {
          retry: (enabled: boolean) => {
            retryArgs.push(enabled);
            return q;
          },
          abortSignal: (signal: AbortSignal) => {
            signals.push(signal);
            return q;
          },
          maybeSingle: () => lookup(),
        };
        return q;
      },
    }),
  }),
};
vi.mock("@/lib/supabase", () => ({ getSupabase: () => fake }));

import {
  HOSTED_ROOMS_EVENT,
  LOOKUP_RETRY_DELAYS_MS,
  LOOKUP_SLOW_RETRY_MS,
  LOOKUP_TIMEOUT_MS,
  markAsHost,
  roomEntryView,
  useHostStatus,
  useIsHost,
  type HostStatus,
} from "./useHostStatus";
import { CONFIRMED_HOST_ROOMS_KEY, signOut } from "./useAuth";

const user = { id: "u-1", email: "jeremy@a-worthy.local" } as User;
// supabase-js hands out a freshly parsed user object on every auth event.
const sameUserNewObject = () => ({ ...user }) as User;
const hosted = () =>
  JSON.parse(window.localStorage.getItem("wb_hosted_rooms") ?? "[]");
const confirmed = () =>
  JSON.parse(window.localStorage.getItem(CONFIRMED_HOST_ROOMS_KEY) ?? "{}");
const ok = (hostId: string | null): Lookup => ({
  data: hostId ? { host_user_id: hostId } : null,
  error: null,
});
const fail: Lookup = { data: null, error: { message: "TypeError: Load failed" } };

describe("markAsHost", () => {
  beforeEach(() => {
    window.localStorage.clear();
    upsert.mockReset();
  });

  it("throws when the rooms upsert is rejected, instead of reporting success", async () => {
    upsert.mockResolvedValue({ error: { message: "row-level security" } });
    await expect(markAsHost("room-a", user)).rejects.toThrow(
      "row-level security",
    );
  });

  it("keeps local host ownership even when the account write fails", async () => {
    // The landing page relies on this: a failed claim must not stop the
    // host entering the room they just created.
    upsert.mockResolvedValue({ error: { message: "network down" } });
    await markAsHost("room-b", user).catch(() => {});
    expect(hosted()).toContain("room-b");
  });

  it("resolves quietly on success", async () => {
    upsert.mockResolvedValue({ error: null });
    await expect(markAsHost("room-c", user)).resolves.toBeUndefined();
    expect(hosted()).toContain("room-c");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "room-c", host_user_id: "u-1" }),
      { onConflict: "id" },
    );
  });

  it("never touches the network for a signed-out (localStorage-only) host", async () => {
    await expect(markAsHost("room-d", null)).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
    expect(hosted()).toContain("room-d");
  });

  it(`announces the change on window as "${HOSTED_ROOMS_EVENT}"`, async () => {
    const heard = vi.fn();
    window.addEventListener(HOSTED_ROOMS_EVENT, heard);
    await markAsHost("room-e", null);
    window.removeEventListener(HOSTED_ROOMS_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

// ---- useHostStatus -------------------------------------------------------
// No testing-library in this repo: render with react-dom/client + act.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let history: HostStatus[] = [];
// Mounts of the stand-in live room (tldraw + LiveKit in RoomShell) and of
// the stand-in KnockGate, so remounts and knocks are countable.
let roomMounts = 0;
let gateMounts = 0;

function Room() {
  useEffect(() => {
    roomMounts += 1;
  }, []);
  return createElement("i", { id: "room" });
}

function Gate({ children }: { children: ReactNode }) {
  useEffect(() => {
    gateMounts += 1;
  }, []);
  return createElement("section", null, children);
}

// RoomShell's tail, through the same roomEntryView it uses: the host gets
// `room` at the top level, a guest gets it wrapped in KnockGate — so a
// host ↔ guest flip REMOUNTS the room, exactly as in the app. (A named
// guest whose name is already read: the name form never shows here.)
function Shell({ roomId }: { roomId: string }) {
  const status = useHostStatus(roomId);
  if (history.at(-1) !== status) history.push(status);
  const room = createElement(Room);
  switch (roomEntryView(status, true, true)) {
    case "room":
      return room;
    case "spinner":
      return createElement("main", { id: "spinner" });
    default:
      return createElement(Gate, null, room);
  }
}

async function render(roomId = "room-x") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(Shell, { roomId }));
  });
}

const current = () => history.at(-1);
const flush = () => act(async () => {});
const emitAuth = (evt: string, session: Session) =>
  act(async () => {
    authListeners.forEach((l) => l(evt, session));
  });
// Safari private mode / a full quota: every localStorage write throws.
// Restored explicitly — happy-dom's Storage is a Proxy that
// vi.restoreAllMocks doesn't reliably unwind.
const restores: Array<() => void> = [];
function blockStorageWrites() {
  const spy = vi
    .spyOn(window.localStorage, "setItem")
    .mockImplementation(() => {
      throw new Error("storage blocked");
    });
  restores.push(() => spy.mockRestore());
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useHostStatus", () => {
  beforeEach(() => {
    window.localStorage.clear();
    lookup.mockReset();
    upsert.mockReset();
    authListeners.clear();
    retryArgs.length = 0;
    signals.length = 0;
    history = [];
    roomMounts = 0;
    gateMounts = 0;
    getSession = async () => ({ data: { session: { user } } });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
    restores.splice(0).forEach((restore) => restore());
  });

  it("is 'checking' while auth is still loading, then resolves", async () => {
    const auth = deferred<{ data: { session: Session } }>();
    getSession = () => auth.promise;
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("checking");
    expect(lookup).not.toHaveBeenCalled();

    await act(async () => auth.resolve({ data: { session: { user } } }));
    expect(current()).toBe("host");
    expect(history).toEqual(["checking", "host"]);
  });

  it("is 'checking' while a signed-in user's first lookup is in flight", async () => {
    const answer = deferred<Lookup>();
    lookup.mockReturnValue(answer.promise);
    await render();
    expect(current()).toBe("checking");
    await act(async () => answer.resolve(ok("someone-else")));
    expect(current()).toBe("guest");
  });

  it("is 'host' straight away from wb_hosted_rooms, without waiting for auth", async () => {
    window.localStorage.setItem("wb_hosted_rooms", JSON.stringify(["room-x"]));
    getSession = () => new Promise(() => {}); // auth never resolves
    await render();
    expect(current()).toBe("host");
  });

  it("records a confirmed remote host for that account — not in wb_hosted_rooms", async () => {
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");
    expect(confirmed()).toEqual({ "room-x": "u-1" });
    expect(hosted()).toEqual([]);
  });

  it("does not record anything for a signed-in non-host", async () => {
    lookup.mockResolvedValue(ok("someone-else"));
    await render();
    expect(current()).toBe("guest");
    expect(hosted()).toEqual([]);
    expect(confirmed()).toEqual({});
  });

  it("turns off postgrest's own retries and bounds each lookup with a timeout", async () => {
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(retryArgs).toEqual([false]);
    if (typeof AbortSignal.timeout === "function") {
      expect(signals).toHaveLength(1);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
    }
  });

  it("a remote-confirmed host stays host through a SIGNED_OUT supabase emits on its own — no flicker, no remount", async () => {
    // e.g. a refresh rejected after an iOS resume, or a global sign-out on
    // another device: SIGNED_OUT without anyone pressing Sign out here.
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");

    await emitAuth("SIGNED_OUT", null);
    await flush();
    expect(history).toEqual(["checking", "host"]); // never guest in between
    expect(roomMounts).toBe(1);
    expect(gateMounts).toBe(0);
  });

  it("an explicit signOut() ends a lookup-confirmed host (shared device)", async () => {
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");

    await act(async () => {
      await signOut();
    });
    expect(current()).toBe("guest");
    expect(confirmed()).toEqual({});
    expect(history).toEqual(["checking", "host", "guest"]);

    // …and it stays that way on the next visit from this browser.
    await act(async () => root?.unmount());
    history = [];
    getSession = async () => ({ data: { session: null } });
    await render();
    expect(current()).toBe("guest");
  });

  it("signOut() leaves rooms this browser created or claimed alone", async () => {
    window.localStorage.setItem("wb_hosted_rooms", JSON.stringify(["room-x"]));
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    await act(async () => {
      await signOut();
    });
    expect(current()).toBe("host");
    expect(hosted()).toEqual(["room-x"]);
  });

  it("a lookup-confirmed record counts while signed out, but never for a different account", async () => {
    window.localStorage.setItem(
      CONFIRMED_HOST_ROOMS_KEY,
      JSON.stringify({ "room-x": "u-1" }),
    );
    getSession = async () => ({ data: { session: null } });
    await render();
    expect(current()).toBe("host");
    await act(async () => root?.unmount());

    history = [];
    lookup.mockResolvedValue(ok("u-1")); // u-2 is not the host
    getSession = async () => ({
      data: { session: { user: { id: "u-2" } as User } },
    });
    await render();
    expect(current()).toBe("guest");
  });

  it("a new user object with the same id (SIGNED_IN on resume, TOKEN_REFRESHED) neither re-queries nor flips", async () => {
    // Storage blocked: the host is carried by this mount's own memory, the
    // path an iOS private tab depends on.
    blockStorageWrites();
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");
    expect(lookup).toHaveBeenCalledTimes(1);

    await emitAuth("SIGNED_IN", { user: sameUserNewObject() });
    await emitAuth("TOKEN_REFRESHED", { user: sameUserNewObject() });
    await flush();

    expect(history).toEqual(["checking", "host"]); // no second checking, no guest
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(roomMounts).toBe(1);
    expect(gateMounts).toBe(0);
  });

  it("with storage blocked, a SIGNED_OUT supabase emits on its own doesn't flip the host", async () => {
    blockStorageWrites();
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");
    await emitAuth("SIGNED_OUT", null);
    await flush();
    expect(history).toEqual(["checking", "host"]);
    expect(roomMounts).toBe(1);
    expect(gateMounts).toBe(0);
    // …but an explicit signOut() still demotes it.
    await act(async () => {
      await signOut();
    });
    expect(current()).toBe("guest");
  });

  it("a signed-in host on a NEW device never reaches KnockGate while the lookup runs", async () => {
    // Nothing in this browser's storage: only the lookup can say "host".
    const answer = deferred<Lookup>();
    lookup.mockReturnValue(answer.promise);
    await render();
    expect(container!.querySelector("#spinner")).not.toBeNull();
    await act(async () => answer.resolve(ok("u-1")));
    expect(current()).toBe("host");
    expect(gateMounts).toBe(0); // no "pending" knock on their own room
    expect(roomMounts).toBe(1);
  });

  it("auth churn after the host is known never mounts KnockGate or remounts the room", async () => {
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    await emitAuth("SIGNED_IN", { user: sameUserNewObject() });
    await emitAuth("TOKEN_REFRESHED", { user: sameUserNewObject() });
    await emitAuth("SIGNED_OUT", null);
    await emitAuth("SIGNED_IN", { user: sameUserNewObject() });
    await flush();
    expect(history).toEqual(["checking", "host"]);
    expect(gateMounts).toBe(0);
    expect(roomMounts).toBe(1);
  });

  it("a lookup that never answers still resolves within the bound (per-attempt watchdog)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // e.g. supabase-js stuck in getSession() before the fetch: the
    // AbortSignal never gets a chance to fire.
    lookup.mockReturnValue(new Promise<Lookup>(() => {}));
    await render();
    expect(current()).toBe("checking");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_TIMEOUT_MS);
    });
    expect(lookup).toHaveBeenCalledTimes(1); // failed; retry scheduled
    const bound =
      (LOOKUP_RETRY_DELAYS_MS.length + 1) * LOOKUP_TIMEOUT_MS +
      LOOKUP_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(bound - LOOKUP_TIMEOUT_MS);
    });
    expect(lookup).toHaveBeenCalledTimes(LOOKUP_RETRY_DELAYS_MS.length + 1);
    expect(current()).toBe("guest"); // a signed-in student can still knock
  });

  it("on a lookup error keeps 'checking' and retries with backoff until it succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lookup.mockResolvedValueOnce(fail).mockResolvedValue(ok("u-1"));
    await render();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(current()).toBe("checking");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_RETRY_DELAYS_MS[0]);
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(current()).toBe("host");
    expect(history).toEqual(["checking", "host"]); // never guest in between
  });

  it("resolves to 'guest' only after every retry fails, then recovers on 'online'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lookup.mockResolvedValue(fail);
    await render();
    for (const ms of LOOKUP_RETRY_DELAYS_MS) {
      expect(current()).toBe("checking");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
    expect(lookup).toHaveBeenCalledTimes(LOOKUP_RETRY_DELAYS_MS.length + 1);
    expect(current()).toBe("guest"); // a signed-in student can still knock

    lookup.mockResolvedValue(ok("u-1"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(current()).toBe("host");
  });

  it("keeps the last answer while a re-query fails, instead of dropping back to 'checking'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lookup.mockResolvedValue(ok("someone-else"));
    await render();
    expect(current()).toBe("guest");

    lookup.mockResolvedValue(fail);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        LOOKUP_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0),
      );
    });
    expect(lookup).toHaveBeenCalledTimes(LOOKUP_RETRY_DELAYS_MS.length + 2);
    expect(history).toEqual(["checking", "guest"]);
  });

  it("a different account signing in re-evaluates without flashing the spinner", async () => {
    lookup.mockResolvedValue(ok("u-1"));
    await render();
    expect(current()).toBe("host");

    // Sticky host ends when the user id changes to a different value…
    const answer = deferred<Lookup>();
    lookup.mockReturnValue(answer.promise);
    await emitAuth("SIGNED_IN", { user: { id: "u-2" } as User });
    // …but the room is never swapped back to the spinner mid-lesson.
    expect(current()).toBe("guest");
    await act(async () => answer.resolve(ok("u-2")));
    expect(current()).toBe("host");
    expect(history).toEqual(["checking", "host", "guest", "host"]);
  });

  it("signing out gives 'guest', and a stale in-flight lookup can't make them host", async () => {
    const answer = deferred<Lookup>();
    lookup.mockReturnValue(answer.promise);
    await render();
    expect(current()).toBe("checking");

    await emitAuth("SIGNED_OUT", null);
    expect(current()).toBe("guest");

    await act(async () => answer.resolve(ok("u-1")));
    expect(current()).toBe("guest");
    expect(hosted()).toEqual([]);
    expect(confirmed()).toEqual({});
  });

  it("keeps re-querying slowly after the fast retries are spent, so the host is promoted without an app switch", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lookup.mockResolvedValue(fail);
    await render();
    for (const ms of LOOKUP_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }
    expect(current()).toBe("guest");
    const calls = lookup.mock.calls.length;

    // Still failing: one more slow attempt, still guest.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_SLOW_RETRY_MS);
    });
    expect(lookup).toHaveBeenCalledTimes(calls + 1);
    expect(current()).toBe("guest");

    // Supabase recovers (no `online` event): the next slow attempt promotes.
    lookup.mockResolvedValue(ok("u-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOOKUP_SLOW_RETRY_MS);
    });
    expect(current()).toBe("host");
  });

  it("a storage clear from another tab (storage event, key null) doesn't demote", async () => {
    window.localStorage.setItem("wb_hosted_rooms", JSON.stringify(["room-x"]));
    getSession = async () => ({ data: { session: null } });
    await render();
    expect(current()).toBe("host");

    window.localStorage.clear();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(current()).toBe("host");
    expect(history).toEqual(["checking", "host"]);
  });

  it(`"${HOSTED_ROOMS_EVENT}" after markAsHost turns guest into host without a reload`, async () => {
    lookup.mockResolvedValue(ok(null)); // legacy room: no rooms row yet
    upsert.mockResolvedValue({ error: null });
    await render();
    expect(current()).toBe("guest");

    await act(async () => {
      await markAsHost("room-x", user, "Jeremy");
    });
    expect(current()).toBe("host");
    // (The room itself does remount here, KnockGate → host tree, as in
    // RoomShell — a one-off on a deliberate claim.)
    expect(roomMounts).toBe(2);
  });

  it("picks up another tab's wb_hosted_rooms write via the storage event", async () => {
    getSession = async () => ({ data: { session: null } });
    await render();
    expect(current()).toBe("guest");

    window.localStorage.setItem("wb_hosted_rooms", JSON.stringify(["room-x"]));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "wb_hosted_rooms" }));
    });
    expect(current()).toBe("host");
  });

  it("re-queries on visibilitychange → visible while not host", async () => {
    lookup.mockResolvedValue(ok("someone-else"));
    await render();
    expect(current()).toBe("guest");
    expect(lookup).toHaveBeenCalledTimes(1);

    lookup.mockResolvedValue(ok("u-1")); // claimed from another device
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(current()).toBe("host");
  });

  it("roomEntryView: checking is a spinner, never the name form or KnockGate", () => {
    expect(roomEntryView("host", false, false)).toBe("room");
    expect(roomEntryView("checking", true, true)).toBe("spinner");
    expect(roomEntryView("checking", true, false)).toBe("spinner");
    expect(roomEntryView("guest", false, true)).toBe("spinner");
    expect(roomEntryView("guest", true, false)).toBe("name");
    expect(roomEntryView("guest", true, true)).toBe("knock");
  });

  it("useIsHost is the boolean view of the same status", async () => {
    let seen: boolean[] = [];
    function BoolProbe() {
      seen = [...seen, useIsHost("room-x")];
      return null;
    }
    lookup.mockResolvedValue(ok("u-1"));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root!.render(createElement(BoolProbe)));
    expect(seen[0]).toBe(false); // "checking" reads as not-host
    expect(seen.at(-1)).toBe(true);
  });
});
