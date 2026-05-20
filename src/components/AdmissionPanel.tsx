"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

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
  const [pending, setPending] = useState<JoinRequest[]>([]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchPending = async () => {
      const { data, error } = await supabase
        .from("join_requests")
        .select("*")
        .eq("room_id", roomId)
        .eq("status", "pending")
        .order("requested_at", { ascending: true });
      if (error) {
        console.error("[admission] fetchPending failed", error);
        return;
      }
      setPending((data as JoinRequest[]) ?? []);
    };

    void fetchPending();

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
          void fetchPending();
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
    }
  };

  if (pending.length === 0) return null;

  return (
    <div className="absolute top-16 right-4 z-[100] w-80 rounded-lg bg-[var(--bg-elev)] border-2 border-brand-600 shadow-2xl overflow-hidden">
      <header className="px-3 py-2 border-b border-[color:var(--border-subtle)] bg-brand-100">
        <h3 className="text-sm font-semibold text-brand-800">
          {pending.length} waiting to join
        </h3>
      </header>
      <ul className="divide-y divide-[color:var(--border-subtle)] max-h-80 overflow-y-auto">
        {pending.map((req) => (
          <li
            key={req.id}
            className="px-3 py-2 flex items-center gap-2"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate">{req.user_name || "Guest"}</div>
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
    </div>
  );
}
