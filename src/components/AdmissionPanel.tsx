"use client";

import { useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";

type JoinRequest = {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  status: "pending" | "admitted" | "denied";
  requested_at: string;
};

// Shown when an admission write is silently filtered by RLS: only the
// room's signed-in owner may admit / deny / remove / re-admit.
const SIGN_IN_TO_ADMIT =
  "Sign in (Settings → Account) and claim this room to admit students";

export default function AdmissionPanel({
  roomId,
  hostUserId,
}: {
  roomId: string;
  hostUserId: string;
}) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [rosterOpen, setRosterOpen] = useState(false);
  const toast = useToast();
  // Track which requests we've already announced so we don't re-toast
  // on every fetch.
  const announcedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchRequests = async () => {
      // Fetch every request for the room (not just pending) so the
      // roster can show admitted + denied students for one-tap
      // re-admit / removal.
      const { data, error } = await supabase
        .from("join_requests")
        .select("id,room_id,user_id,user_name,status,requested_at")
        .eq("room_id", roomId)
        .order("requested_at", { ascending: true });
      if (error) {
        console.error("[admission] fetchRequests failed", error);
        return;
      }
      const list = (data as JoinRequest[]) ?? [];
      // Announce any new pending requests we haven't seen before — so
      // the host gets a toast even if they're not looking at the
      // top-right corner of the canvas. Also fires a browser-level
      // Notification when the host has another tab focused, since
      // toasts only show on the active tab.
      for (const req of list) {
        if (req.status !== "pending") continue;
        if (!announcedRef.current.has(req.id)) {
          announcedRef.current.add(req.id);
          toast.info(`${req.user_name || "A guest"} is asking to join`);
          maybeNotify(req.user_name || "A guest");
        }
      }
      setRequests(list);
    };

    void fetchRequests();

    const channel = supabase
      .channel(`admission-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void fetchRequests();
        },
      )
      .subscribe();

    // Make sure the host themselves doesn't get stuck in the waiting room.
    // Upsert a self-admitted record for the host's userId.
    void supabase
      .from("join_requests")
      .upsert(
        {
          room_id: roomId,
          user_id: hostUserId,
          user_name: "Host",
          status: "admitted",
          decided_at: new Date().toISOString(),
        },
        { onConflict: "room_id,user_id" },
      )
      .then(({ error }) => {
        if (error) console.error("[admission] host self-admit failed", error);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, hostUserId]);

  const decide = async (req: JoinRequest, status: "admitted" | "denied") => {
    const supabase = getSupabase();
    if (!supabase) return;
    // `.select()` so an RLS-filtered no-op (zero rows, error null) can be
    // told apart from a real success. Admission writes are restricted to
    // the room's signed-in owner (migration 20260924120000), so a host who
    // isn't signed in — or whose session lapsed — matches zero rows; say
    // so instead of leaving the student stuck in the lobby.
    const { data, error } = await supabase
      .from("join_requests")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", req.id)
      .select("id");
    if (error) {
      console.error("[admission] decide failed", error);
      toast.error(`Couldn't update ${req.user_name || "guest"}`);
      return;
    }
    if (!data || data.length === 0) toast.error(SIGN_IN_TO_ADMIT);
  };

  const admitAll = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    // One query flips every pending row for the room. The host's own
    // row is already 'admitted' so it's untouched by the status filter.
    const expected = requests.filter((r) => r.status === "pending").length;
    const { data, error } = await supabase
      .from("join_requests")
      .update({ status: "admitted", decided_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("status", "pending")
      .select("id");
    if (error) {
      console.error("[admission] admitAll failed", error);
      toast.error("Couldn't admit everyone");
      return;
    }
    // Zero rows flipped while some were pending → RLS filtered the write
    // (caller isn't the room's signed-in owner), not "nothing to do".
    if (expected > 0 && (!data || data.length === 0)) toast.error(SIGN_IN_TO_ADMIT);
  };

  const pending = requests.filter((r) => r.status === "pending");
  // Roster = everyone the host has already decided on, minus the host's
  // own self-admit row. Denied first so re-admittable students surface.
  const roster = requests
    .filter((r) => r.user_id !== hostUserId && r.status !== "pending")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "denied" ? -1 : 1));

  if (pending.length === 0 && roster.length === 0) return null;

  const urgent = pending.length > 0;

  return (
    <div
      // Sticker card while knocks are pending or the roster is open; the
      // idle "Class roster (n)" state is a sticker PILL, so it goes fully
      // round only while nothing is listed beneath it — and hugs its label,
      // so it takes no more of the canvas's top-right corner than the
      // status pills below it.
      // Not positioned: it is the first item of WhiteboardCanvas's
      // top-right CanvasFloatingPanel column (RoomShell passes it in as
      // `admissionPanel`), so the pills stack under it and can't overlap.
      // md:mt-12 drops it below the centred LessonTimer row: on md+ the
      // column starts at top-3, level with the clock, and on a narrow
      // canvas (iPad portrait, or 1024 beside the video column) a w-80
      // knock card reached across the "Timer" button. Phones already start
      // the column below that row (top-14).
      className={`md:mt-12 max-w-[calc(100vw-2rem)] bg-[var(--bg-elev)] border-2 border-ink overflow-hidden ${
        urgent
          ? "w-80 rounded-xl shadow-sticker-lg"
          : `shadow-sticker ${rosterOpen ? "w-56 rounded-xl" : "rounded-full"}`
      }`}
    >
      {urgent && (
        <>
          <header className="px-3 py-2.5 border-b-2 border-dashed border-[color:var(--border)] flex items-center justify-between gap-2">
            <h3 className="rounded-full text-[11.5px] font-extrabold tracking-[.2px] px-3 py-1 border-[1.5px] border-ink-faint bg-brand-50 text-brand-700 truncate">
              {pending.length} waiting to join
            </h3>
            {pending.length > 1 && (
              <button
                onClick={() => void admitAll()}
                className="text-xs px-3 py-1 rounded-full bg-brand-600 text-white hover:bg-brand-700 border-2 border-ink font-extrabold shadow-sticker-primary sticker-press shrink-0"
              >
                Admit all
              </button>
            )}
          </header>
          <ul className="divide-y divide-[color:var(--border-subtle)] max-h-72 overflow-y-auto">
            {pending.map((req) => (
              <li key={req.id} className="px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold truncate">
                    {req.user_name || "Guest"}
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-dim)]">
                    {new Date(req.requested_at).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={() => decide(req, "denied")}
                  className="text-xs px-3 py-1 rounded-full bg-danger-50 text-danger-700 border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-danger-100"
                >
                  Deny
                </button>
                <button
                  onClick={() => decide(req, "admitted")}
                  className="text-xs px-3 py-1 rounded-full bg-brand-600 text-white hover:bg-brand-700 border-2 border-ink font-extrabold shadow-sticker-primary sticker-press"
                >
                  Admit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {roster.length > 0 && (
        <div className={urgent ? "border-t-2 border-dashed border-[color:var(--border)]" : ""}>
          <button
            onClick={() => setRosterOpen((o) => !o)}
            className="w-full px-3.5 py-2 flex items-center justify-between gap-2 hover:bg-[var(--bg-elev-2)]"
            aria-expanded={rosterOpen}
          >
            <span className="text-sm font-extrabold">
              {urgent ? "In this room" : "Class roster"} ({roster.length})
            </span>
            <CaretDown
              size={14}
              aria-hidden
              className={`transition-transform ${rosterOpen ? "rotate-180" : ""}`}
            />
          </button>
          {rosterOpen && (
            <ul className="divide-y divide-[color:var(--border-subtle)] max-h-72 overflow-y-auto border-t border-[color:var(--border-subtle)]">
              {roster.map((req) => {
                const denied = req.status === "denied";
                return (
                  <li key={req.id} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">
                        {req.user_name || "Guest"}
                      </div>
                      <div
                        className={`text-[11px] font-semibold ${
                          denied ? "text-danger-700" : "text-[var(--text-dim)]"
                        }`}
                      >
                        {denied ? "Removed" : "Admitted"}
                      </div>
                    </div>
                    {denied ? (
                      <button
                        onClick={() => decide(req, "admitted")}
                        className="text-xs px-3 py-1 rounded-full bg-[var(--bg-elev)] text-[var(--text)] hover:bg-[var(--bg-elev-2)] border-2 border-ink font-extrabold shadow-sticker-sm sticker-press"
                      >
                        Re-admit
                      </button>
                    ) : (
                      <button
                        onClick={() => decide(req, "denied")}
                        className="text-xs px-3 py-1 rounded-full bg-danger-50 text-danger-700 border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-danger-100"
                      >
                        Remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Fires a desktop Notification when the host's tab is in the
// background so they don't miss a knock. Permission is requested
// lazily the first time a knock arrives — the user gets a
// browser-native prompt; if they decline we silently skip the
// notification on future knocks (still get the in-app toast).
function maybeNotify(name: string) {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined") return;
  // Only notify when the page is hidden — if the host is already
  // looking at the room, the toast is enough.
  if (document.visibilityState === "visible") return;
  const fire = () => {
    try {
      new Notification("Someone wants to join", {
        body: `${name} is waiting in the lobby — open the tab to admit.`,
        tag: "wb-knock",
        icon: "/icon.png",
        silent: false,
      });
    } catch {
      // Some browsers (older Safari, embedded WebViews) throw on
      // direct construction; we don't have a service worker to
      // delegate to. Falling back to the toast that already fired.
    }
  };
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then((res) => {
      if (res === "granted") fire();
    });
  }
}
