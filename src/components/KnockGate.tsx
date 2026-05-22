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
  // True once we've been waiting 30s without admission — at that point
  // we surface a soft '404-ish' warning that the room may not have a
  // host. Rooms are URL-addressable (created on demand), so we can't
  // do a hard 404, but the long-wait heuristic catches the common
  // case of a typo'd or shared-too-early invite link.
  const [longWait, setLongWait] = useState(false);

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

      // 2. Subscribe to changes on our specific request. We pass a
      // status callback so a CHANNEL_ERROR / TIMED_OUT triggers a
      // re-subscribe — without this the channel would stay dead and
      // we'd rely entirely on the 8s heartbeat below for admission
      // signal, doubling perceived admit latency on flaky networks.
      let channel = supabase
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
        );
      let reconnectAttempts = 0;
      const subscribeWithRetry = () => {
        channel.subscribe((channelStatus) => {
          if (
            channelStatus === "CHANNEL_ERROR" ||
            channelStatus === "TIMED_OUT"
          ) {
            // Exponential backoff capped at 30s.
            const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
            reconnectAttempts += 1;
            window.setTimeout(() => {
              if (cancelled) return;
              supabase.removeChannel(channel);
              channel = supabase.channel(`join-${requestId}`).on(
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
              );
              subscribeWithRetry();
            }, delay);
          } else if (channelStatus === "SUBSCRIBED") {
            reconnectAttempts = 0;
          }
        });
      };
      subscribeWithRetry();

      // Heartbeat fallback — if Supabase Realtime drops (poor network,
      // service blip), we'd otherwise sit on 'pending' forever even
      // after the host has admitted us. Poll every 8s as a safety net
      // and reconcile from the row directly.
      const heartbeat = window.setInterval(async () => {
        if (cancelled || !requestId) return;
        const { data: row } = await supabase
          .from("join_requests")
          .select("status")
          .eq("id", requestId)
          .maybeSingle();
        const next = (row as { status?: Status } | null)?.status;
        if (next) setStatus(next);
      }, 8000);

      // Cleanup
      return () => {
        window.clearInterval(heartbeat);
        supabase.removeChannel(channel);
      };
    })();

    // Long-wait timer — 30s on 'pending' means either the host is
    // away or the room URL is wrong. We show a softer 'this room
    // might not exist' message; we don't force-redirect.
    const longWaitTimer = window.setTimeout(() => {
      if (!cancelled) setLongWait(true);
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearTimeout(longWaitTimer);
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
            {longWait && (
              <div className="mt-5 rounded-md border border-amber-600/50 bg-amber-50 p-3 text-left">
                <p className="text-xs font-medium text-amber-900">
                  Still waiting…
                </p>
                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                  If this is taking a while, the host may be away — or
                  the room link might be wrong. Check that the invite
                  URL matches what your tutor sent.
                </p>
              </div>
            )}
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
            <h2 className="text-lg font-semibold text-danger-700">
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
