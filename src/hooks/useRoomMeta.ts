"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type RoomMeta = {
  title: string;
};

const DEFAULT: RoomMeta = { title: "" };

export function useRoomMeta(roomId: string): {
  meta: RoomMeta;
  setTitle: (title: string) => Promise<void>;
} {
  const [meta, setMeta] = useState<RoomMeta>(DEFAULT);

  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    let cancelled = false;

    const fetchMeta = async () => {
      const { data } = await supabase
        .from("room_metadata")
        .select("*")
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      setMeta({ title: (data?.title as string) ?? "" });
    };
    void fetchMeta();

    const channel = supabase
      .channel(`meta-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_metadata",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchMeta(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const setTitle = useCallback(
    async (title: string) => {
      // Optimistic local update.
      setMeta((m) => ({ ...m, title }));
      const supabase = getSupabase();
      if (!supabase) return;
      await supabase.from("room_metadata").upsert(
        { room_id: roomId, title, updated_at: new Date().toISOString() },
        { onConflict: "room_id" },
      );
    },
    [roomId],
  );

  return { meta, setTitle };
}
