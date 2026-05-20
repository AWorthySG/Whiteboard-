"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Status = "checking" | "pending" | "admitted" | "denied" | "error";

export default function KnockGate({
  roomId,
  userId,
  userName,
  children,
}: {
  roomId: string;
  userId: string;
  userName: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setStatus("error");
      setError("Supabase not configured");
      return;
    }

    let cancelled = false;
    let requestId: string | null = null;

    (async () => {
      // 1. Upsert our join request.
      const { data, error: upErr } = await supabase
        .from("join_requests")
        .upsert(
          {
            room_id: roomId,
            user_id: userId,
            user_name: userName,
            status: "pending",
          },
          { onConflict: "room_id,user_id" },
        )
        .select()
        .single();

      if (cancelled) return;
      if (upErr || !data) {
        setStatus("error");
        setError(upErr?.message ?? "Could not request to join");
        return;
      }
      requestId = data.id;
      setStatus(data.status as Status);

      // 2. Subscribe to changes on our specific request.
      const channel = supabase
        .channel(`join-${requestId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "join_requests",
            filter: `id=eq.${requestId}`,
          },
          (payload) => {
            const next = (payload.new as { status?: Status })?.status;
            if (next) setStatus(next);
          },
        )
        .subscribe();

      // Cleanup
      return () => {
        supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, userId, userName]);

  if (status === "admitted") return <>{children}</>;

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] p-8 text-center">
        {status === "checking" && (
          <>
            <Spinner />
            <p className="mt-4 text-[var(--text-muted)]">Connecting…</p>
          </>
        )}
        {status === "pending" && (
          <>
            <Spinner />
            <h2 className="mt-4 text-lg font-semibold">Waiting to be let in</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              The host has been notified you're here. They'll admit you shortly.
            </p>
            <p className="mt-4 text-xs text-[var(--text-dim)]">
              Joining as <span className="text-[var(--text-muted)]">{userName}</span>
            </p>
          </>
        )}
        {status === "denied" && (
          <>
            <div className="text-3xl">🚫</div>
            <h2 className="mt-4 text-lg font-semibold">Not admitted</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              The host declined your request. Refresh to try again or contact them.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <h2 className="text-lg font-semibold text-red-300">
              Couldn't request to join
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="inline-block w-8 h-8 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
  );
}
