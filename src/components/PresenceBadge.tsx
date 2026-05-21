"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type PresenceMeta = { user_id: string; name: string; page_id?: string | null };
type Person = { userId: string; name: string; pageId: string | null };

// Live presence using Supabase Realtime's built-in presence channel.
// Each tab tracks {user_id, name, current_page} and the badge reads
// the channel's sync state to show total count + how many people are
// looking at the *current* page (the host's "read the room" view).
// Clicking the badge opens a popover with everyone's name + which
// page they're on.
export default function PresenceBadge({
  roomId,
  userId,
  userName,
  currentPageId,
  isHost,
  drawGrantUserId,
  onSetDrawGrant,
}: {
  roomId: string;
  userId: string;
  userName: string;
  currentPageId?: string | null;
  // Host-only: shows a 'Promote to draw' button per non-host
  // participant in the popover. When set, the named user keeps
  // the draw tool as default and can solve problems on the shared
  // canvas instead of being forced to 'hand'. NULL means no one
  // is currently granted.
  isHost?: boolean;
  drawGrantUserId?: string | null;
  onSetDrawGrant?: (userId: string | null) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Track the *latest* desired meta in a ref so the throttle can read
  // it without re-triggering the effect on every page change.
  const desiredMetaRef = useRef<PresenceMeta>({
    user_id: userId,
    name: userName,
    page_id: currentPageId ?? null,
  });
  useEffect(() => {
    desiredMetaRef.current = {
      user_id: userId,
      name: userName,
      page_id: currentPageId ?? null,
    };
  }, [userId, userName, currentPageId]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !roomId || !userId) return;

    const channel = supabase.channel(`presence-${roomId}`, {
      config: { presence: { key: userId } },
    });

    const sync = () => {
      const state = channel.presenceState() as Record<string, PresenceMeta[]>;
      const next: Person[] = [];
      for (const [key, entries] of Object.entries(state)) {
        const meta = entries[0];
        next.push({
          userId: key,
          name: meta?.name || "Guest",
          pageId: meta?.page_id ?? null,
        });
      }
      // Sort: yourself first, then by name.
      next.sort((a, b) => {
        if (a.userId === userId) return -1;
        if (b.userId === userId) return 1;
        return a.name.localeCompare(b.name);
      });
      setPeople(next);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track(desiredMetaRef.current);
        }
      });

    // Throttle track() updates: changes to currentPageId or userName
    // shouldn't fire a track call more than once every 2s. Supabase's
    // presence is robust to this, but it's still a needless write per
    // page switch — and page-thumbnail re-renders can trigger several
    // currentPageId effects in quick succession.
    let lastTrackedAt = 0;
    let pendingTimer: number | null = null;
    const pushTrack = async () => {
      const now = Date.now();
      const since = now - lastTrackedAt;
      if (since >= 2000) {
        lastTrackedAt = now;
        await channel.track(desiredMetaRef.current);
      } else if (pendingTimer === null) {
        pendingTimer = window.setTimeout(async () => {
          pendingTimer = null;
          lastTrackedAt = Date.now();
          await channel.track(desiredMetaRef.current);
        }, 2000 - since);
      }
    };
    // Fire on changes.
    void pushTrack();

    return () => {
      if (pendingTimer !== null) window.clearTimeout(pendingTimer);
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, userName, currentPageId]);

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const counts = useMemo(() => {
    const total = people.length;
    let here = 0;
    for (const p of people) if (p.pageId && p.pageId === currentPageId) here += 1;
    return { total, here };
  }, [people, currentPageId]);

  if (counts.total === 0) return null;

  const peopleLabel = counts.total === 1 ? "person" : "people";
  return (
    <div ref={popoverRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-600/40 hover:bg-emerald-200 transition-colors"
        title={`${counts.total} ${peopleLabel} in this room${
          currentPageId ? ` · ${counts.here} on this page` : ""
        }`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
        <span className="font-medium tabular-nums">{counts.total}</span>
        <span className="hidden sm:inline">online</span>
        {currentPageId && counts.total > 1 && (
          <>
            <span className="text-emerald-700/50">·</span>
            <span className="tabular-nums">{counts.here}</span>
            <span className="hidden sm:inline">here</span>
          </>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="People in this room"
          className="absolute top-full left-0 sm:left-auto sm:right-0 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-2 z-50"
        >
          <div className="px-1.5 pb-2 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
            {counts.total} in this room
          </div>
          <ul className="max-h-72 overflow-y-auto space-y-0.5">
            {people.map((p) => {
              const isYou = p.userId === userId;
              const onCurrent = p.pageId && p.pageId === currentPageId;
              return (
                <li
                  key={p.userId}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1.5"
                >
                  <span
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                    style={{ background: colorForId(p.userId) }}
                    aria-hidden
                  >
                    {p.name
                      .split(" ")
                      .map((w) => w[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() || "?"}
                  </span>
                  <span className="text-sm truncate flex-1">
                    {p.name}
                    {isYou && (
                      <span className="text-[var(--text-dim)] ml-1">(you)</span>
                    )}
                  </span>
                  {onCurrent ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                      title="On the same page as you"
                    >
                      here
                    </span>
                  ) : p.pageId ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--text-muted)]"
                      title="Viewing a different page"
                    >
                      elsewhere
                    </span>
                  ) : null}
                  {/* Host-only 'Promote to draw' control. Shown for
                      everyone except yourself; the active draw-grant
                      shows a contrasting 'Drawing' chip with a click
                      to revoke. */}
                  {isHost && onSetDrawGrant && !isYou && (
                    drawGrantUserId === p.userId ? (
                      <button
                        onClick={() => onSetDrawGrant(null)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600"
                        title="Currently drawing — tap to revoke"
                      >
                        Drawing
                      </button>
                    ) : (
                      <button
                        onClick={() => onSetDrawGrant(p.userId)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--text-muted)] hover:bg-brand-100 hover:text-brand-800"
                        title="Grant this student drawing privilege (they default to the draw tool)"
                      >
                        Let draw
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Deterministic colour per user-id. Same id always gets the same hue,
// so a user's avatar circle stays consistent across renders and tabs.
function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
