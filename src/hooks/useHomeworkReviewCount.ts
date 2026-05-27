"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

// Counts homework submissions in the room that the host hasn't given
// feedback on yet (feedback IS NULL), so a "needs review" badge can show
// on the Homework nav without opening the drawer. Live via Realtime on
// homework_submissions (already in the publication). Returns 0 when
// disabled (e.g. for non-hosts, who don't review).
export function useHomeworkReviewCount(
  roomId: string,
  enabled: boolean,
): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;

    let cancelled = false;
    const recompute = async () => {
      const { count: c, error } = await supabase
        .from("homework_submissions")
        .select("id", { count: "exact", head: true })
        .eq("room_id", roomId)
        .is("feedback", null);
      if (!cancelled && !error) setCount(c ?? 0);
    };

    void recompute();

    const channel = supabase
      .channel(`hw-review-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "homework_submissions",
          filter: `room_id=eq.${roomId}`,
        },
        () => void recompute(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, enabled]);

  return enabled ? count : 0;
}
