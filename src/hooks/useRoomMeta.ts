"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

export type RoomMeta = {
  title: string;
  leaderMode: boolean;
  leaderUserId: string | null;
  // When non-null the host has granted drawing privilege to this
  // user — they keep the draw tool as default and aren't forced
  // to 'hand' on canvas mount. Persists across reloads (lives in
  // room_metadata) so the student keeps drawing even on a refresh.
  drawGrantUserId: string | null;
};

const DEFAULT: RoomMeta = {
  title: "",
  leaderMode: false,
  leaderUserId: null,
  drawGrantUserId: null,
};

type Row = {
  title: string | null;
  leader_mode: boolean | null;
  leader_user_id: string | null;
  draw_grant_user_id: string | null;
};

export function useRoomMeta(roomId: string): {
  meta: RoomMeta;
  setTitle: (title: string) => Promise<void>;
  setLeaderMode: (on: boolean, leaderUserId: string | null) => Promise<void>;
  setDrawGrant: (userId: string | null) => Promise<void>;
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
        .select("title, leader_mode, leader_user_id, draw_grant_user_id")
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      const row = (data ?? null) as Row | null;
      setMeta({
        title: row?.title ?? "",
        leaderMode: row?.leader_mode ?? false,
        leaderUserId: row?.leader_user_id ?? null,
        drawGrantUserId: row?.draw_grant_user_id ?? null,
      });
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

  const setLeaderMode = useCallback(
    async (on: boolean, leaderUserId: string | null) => {
      setMeta((m) => ({ ...m, leaderMode: on, leaderUserId }));
      const supabase = getSupabase();
      if (!supabase) return;
      await supabase.from("room_metadata").upsert(
        {
          room_id: roomId,
          leader_mode: on,
          leader_user_id: on ? leaderUserId : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );
    },
    [roomId],
  );

  const setDrawGrant = useCallback(
    async (userId: string | null) => {
      setMeta((m) => ({ ...m, drawGrantUserId: userId }));
      const supabase = getSupabase();
      if (!supabase) return;
      await supabase.from("room_metadata").upsert(
        {
          room_id: roomId,
          draw_grant_user_id: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "room_id" },
      );
    },
    [roomId],
  );

  return { meta, setTitle, setLeaderMode, setDrawGrant };
}
