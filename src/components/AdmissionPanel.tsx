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
    const { error } = await supabase
      .from("join_requests")
      .update({ status, decided_at: new Date().toISOString() })
      .eq("id", req.id);
    if (error) {
      console.error("[admission] decide failed", error);
      toast.error(`Couldn't update ${req.user_name || "guest"}`);
    }
  };

  const admitAll = async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    // One query flips every pending row for the room. The host's own
    // row is already 'admitted' so it's untouched by the status filter.
    const { error } = await supabase
      .from("join_requests")
      .update({ status: "admitted", decided_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("status", "pending");
    if (error) {
      console.error("[admission] admitAll failed", error);
      toast.error("Couldn't admit everyone");
    }
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
      className={`absolute top-16 right-4 z-[100] max-w-[calc(100vw-2rem)] rounded-lg bg-[var(--bg-elev)] shadow-2xl overflow-hidden ${
        urgent
          ? "w-80 border-2 border-brand-600"
          : "w-56 border border-[color:var(--border)]"
      }`}
    >
      {urgent && (
        <>
          <header className="px-3 py-2 border-b border-[color:var(--border-subtle)] bg-brand-100 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-brand-800">
              {pending.length} waiting to join
            </h3>
            {pending.length > 1 && (
              <button
                onClick={() => void admitAll()}
                className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-500 font-medium shrink-0"
              >
                Admit all
              </button>
            )}
          </header>
          <ul className="divide-y divide-[color:var(--border-subtle)] max-h-72 overflow-y-auto">
            {pending.map((req) => (
              <li key={req.id} className="px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">
                    {req.user_name || "Guest"}
                  </div>
                  <div className="text-xs text-[var(--text-dim)]">
                    {new Date(req.requested_at).toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={() => decide(req, "denied")}
                  className="text-xs px-2 py-1 rounded border border-[color:var(--border)] text-[var(--text-muted)] hover:bg-[var(--hover)]"
                >
                  Deny
                </button>
                <button
                  onClick={() => decide(req, "admitted")}
                  className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-500 font-medium"
                >
                  Admit
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {roster.length > 0 && (
        <div className={urgent ? "border-t border-[color:var(--border-subtle)]" : ""}>
          <button
            onClick={() => setRosterOpen((o) => !o)}
            className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-[var(--hover)]"
            aria-expanded={rosterOpen}
          >
            <span className="text-sm font-medium">
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
                      <div className="text-sm truncate">
                        {req.user_name || "Guest"}
                      </div>
                      <div
                        className={`text-[11px] ${
                          denied ? "text-danger-600" : "text-[var(--text-dim)]"
                        }`}
                      >
                        {denied ? "Removed" : "Admitted"}
                      </div>
                    </div>
                    {denied ? (
                      <button
                        onClick={() => decide(req, "admitted")}
                        className="text-xs px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-500 font-medium"
                      >
                        Re-admit
                      </button>
                    ) : (
                      <button
                        onClick={() => decide(req, "denied")}
                        className="text-xs px-2 py-1 rounded border border-[color:var(--border)] text-[var(--text-muted)] hover:bg-[var(--hover)]"
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
