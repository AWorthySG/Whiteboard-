"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Lightweight presence using Supabase Realtime's built-in presence
// channel. Each tab subscribes once and the channel's 'sync' event
// gives us the live participant count. Cheap, no extra schema needed.
export default function PresenceBadge({
  roomId,
  userId,
  userName,
}: {
  roomId: string;
  userId: string;
  userName: string;
}) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !roomId || !userId) return;

    const channel = supabase.channel(`presence-${roomId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, unknown[]>;
        setCount(Object.keys(state).length);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId, name: userName });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, userName]);

  if (count === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
      title={`${count} ${count === 1 ? "person" : "people"} in this room`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      {count}
    </span>
  );
}
