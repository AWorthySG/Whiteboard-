"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type PresenceMeta = { user_id: string; name: string; page_id?: string };

// Live presence using Supabase Realtime's built-in presence channel.
// Each tab tracks {user_id, name, current_page} and the badge reads
// the channel's sync state to show total count + how many people are
// looking at the *current* page (the host's "read the room" view).
export default function PresenceBadge({
  roomId,
  userId,
  userName,
  currentPageId,
}: {
  roomId: string;
  userId: string;
  userName: string;
  currentPageId?: string | null;
}) {
  const [counts, setCounts] = useState<{ total: number; here: number }>(
    { total: 0, here: 0 },
  );

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !roomId || !userId) return;

    const channel = supabase.channel(`presence-${roomId}`, {
      config: { presence: { key: userId } },
    });

    const syncCounts = () => {
      const state = channel.presenceState() as Record<string, PresenceMeta[]>;
      const total = Object.keys(state).length;
      let here = 0;
      for (const entries of Object.values(state)) {
        const meta = entries[0];
        if (meta?.page_id && meta.page_id === currentPageId) here += 1;
      }
      setCounts({ total, here });
    };

    channel
      .on("presence", { event: "sync" }, syncCounts)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: userId,
            name: userName,
            page_id: currentPageId ?? null,
          });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, userName, currentPageId]);

  if (counts.total === 0) return null;

  // Show "5 online" plus a smaller secondary count "3 here" when at
  // least one other person is on the current page.
  const peopleLabel = counts.total === 1 ? "person" : "people";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-600/40"
      title={`${counts.total} ${peopleLabel} in this room${
        currentPageId ? ` · ${counts.here} on this page` : ""
      }`}
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
    </span>
  );
}
