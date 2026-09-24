"use client";

import { useEffect, useState } from "react";
import { Prohibit, WarningCircle } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import Sticker from "@/components/Sticker";

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
    // Hoisted so the outer cleanup can reach them — the IIFE's own
    // `return () => {}` goes to the Promise, not to React's cleanup.
    let heartbeat: number | undefined;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    // Tracked so React's cleanup can cancel a pending reconnect timer.
    let reconnectTimer: number | undefined;

    (async () => {
      // 0. If the URL carries an `?invite=` token, redeem it first.
      // The redeem endpoint admits a new or waiting device straight in
      // and leaves an admitted one untouched — but it will NOT re-admit a
      // student the host removed (their row stays 'denied', so the steps
      // below show "Not admitted" until the host taps Re-admit).
      const params = new URLSearchParams(window.location.search);
      const inviteToken = params.get("invite");
      if (inviteToken) {
        try {
          await fetch("/api/invite/redeem", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: inviteToken,
              roomId,
              userId,
              userName,
            }),
          });
        } catch {
          // Network blip — fall through to the regular knock flow.
          // An invalid / expired invite also falls through; better to
          // make the guest knock than to dead-end them on a typo.
        }
      }

      // 1. Find or create our join request.
      // First, check if a row already exists for this (room, user).
      // Admission is meant to be persistent — once a host admits a
      // student, the student should be able to return without
      // re-knocking. An older revision of this code unconditionally
      // upserted 'pending', which clobbered admitted rows on every
      // visit; we now read-then-conditionally-insert.
      const { data: existing } = await supabase
        .from("join_requests")
        .select("id, status")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .maybeSingle();

      let initial: { id: string; status: Status };
      if (existing) {
        initial = {
          id: existing.id as string,
          status: existing.status as Status,
        };
      } else {
        const { data: created, error: insertErr } = await supabase
          .from("join_requests")
          .insert({
            room_id: roomId,
            user_id: userId,
            user_name: userName,
            status: "pending",
          })
          .select()
          .single();
        if (cancelled) return;
        if (insertErr || !created) {
          setStatus("error");
          setError(insertErr?.message ?? "Could not request to join");
          return;
        }
        initial = { id: created.id as string, status: "pending" };
      }

      if (cancelled) return;
      requestId = initial.id;
      setStatus(initial.status);

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
      activeChannel = channel;
      let reconnectAttempts = 0;
      // Guard so multiple CHANNEL_ERROR callbacks can't each queue their
      // own reconnect — that would spawn (and orphan) a fresh channel per
      // error on a flaky network, leaking Supabase channels.
      let reconnectPending = false;
      const subscribeWithRetry = () => {
        channel.subscribe((channelStatus) => {
          if (
            channelStatus === "CHANNEL_ERROR" ||
            channelStatus === "TIMED_OUT"
          ) {
            if (reconnectPending) return;
            reconnectPending = true;
            // Exponential backoff capped at 30s.
            const delay = Math.min(30_000, 1_000 * 2 ** reconnectAttempts);
            reconnectAttempts += 1;
            reconnectTimer = window.setTimeout(() => {
              reconnectPending = false;
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
              activeChannel = channel;
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
      heartbeat = window.setInterval(async () => {
        if (cancelled || !requestId) return;
        const { data: row } = await supabase
          .from("join_requests")
          .select("status")
          .eq("id", requestId)
          .maybeSingle();
        const next = (row as { status?: Status } | null)?.status;
        if (next) setStatus(next);
      }, 8000);
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
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (activeChannel) void supabase.removeChannel(activeChannel);
    };
  }, [roomId, userId, userName]);

  if (status === "admitted") return <>{children}</>;

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-8 text-center scale-pop">
        {status === "checking" && (
          <>
            <Spinner />
            <p className="mt-4 font-semibold text-[var(--text-muted)]">Connecting…</p>
          </>
        )}
        {status === "pending" && (
          <>
            {/* A student can sit on this screen for a while before the host
                notices the knock, so it's worth more than a bare spinner. */}
            <Sticker
              name="encourage"
              size={132}
              className="mx-auto mb-1"
              priority
            />
            <Spinner />
            <h2 className="mt-4 text-lg font-extrabold tracking-display">Waiting to be let in</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              The host has been notified you're here. They'll admit you shortly.
            </p>
            <p className="mt-4 text-xs font-semibold text-[var(--text-dim)]">
              Joining as <span className="font-bold text-[var(--text-muted)]">{userName}</span>
            </p>
            {longWait && (
              /* Warning sticker: pale sun tint inside the same 2px ink outline
                 so it reads as "heads up" without competing with the red
                 accent (which would say "error" here — it isn't one). */
              <div className="mt-5 rounded-lg border-2 border-ink shadow-sticker-sm bg-warning-bg p-3 text-left">
                <p className="font-label text-warning">
                  Still waiting…
                </p>
                <p className="text-xs font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
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
            <div className="mx-auto w-14 h-14 rounded-full border-2 border-ink bg-danger-50 flex items-center justify-center">
              <Prohibit size={28} className="text-danger-700" aria-hidden />
            </div>
            <h2 className="mt-4 text-lg font-extrabold tracking-display">Not admitted</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              The host hasn&apos;t let you in. Ask them to admit you — you&apos;ll join automatically when they do.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <div className="mx-auto w-14 h-14 rounded-full border-2 border-ink bg-danger-50 flex items-center justify-center">
              <WarningCircle size={28} className="text-danger-700" aria-hidden />
            </div>
            <h2 className="mt-4 text-lg font-extrabold tracking-display text-danger-700">
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
    <div className="inline-block w-8 h-8 border-[3px] border-ink border-t-brand-600 rounded-full animate-spin" />
  );
}
