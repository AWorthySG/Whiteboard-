"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "./useAuth";

const KEY = "wb_hosted_rooms";

function readHosted(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeHosted(rooms: Set<string>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...rooms]));
  } catch {
    // no-op
  }
}

// Mark this browser as the host for a room. If a signed-in user is
// provided, also writes an authoritative row into the rooms table so the
// same person can host from any other signed-in device.
export async function markAsHost(
  roomId: string,
  user?: User | null,
  displayName?: string,
) {
  const rooms = readHosted();
  rooms.add(roomId);
  writeHosted(rooms);

  if (user) {
    const supabase = getSupabase();
    if (supabase) {
      // The email column on `rooms` is kept for back-compat — it now
      // stores the synthetic username@a-worthy.local string, but nobody
      // reads it for display. Display uses the username portion only.
      const username = user.email
        ? user.email.slice(0, user.email.lastIndexOf("@") || undefined)
        : null;
      await supabase.from("rooms").upsert(
        {
          id: roomId,
          host_user_id: user.id,
          host_email: user.email ?? null,
          host_name: displayName?.trim() || username || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    }
  }
}

// True if the current browser owns the room. Owning means either:
//   - we're signed in and our user id matches rooms.host_user_id, OR
//   - this browser created the room before sign-in (localStorage fallback).
export function useIsHost(roomId: string): boolean {
  const { user, loading } = useAuth();
  const [localHost, setLocalHost] = useState(false);
  const [remoteHost, setRemoteHost] = useState(false);

  useEffect(() => {
    setLocalHost(readHosted().has(roomId));
  }, [roomId]);

  useEffect(() => {
    // Clear any prior room's result up front so a client-side room switch
    // (roomId changes without a full remount) can't briefly report the
    // previous room's ownership while the new query is in flight.
    setRemoteHost(false);
    if (loading) return;
    if (!user) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("rooms")
      .select("host_user_id")
      .eq("id", roomId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setRemoteHost(data?.host_user_id === user.id);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, user, loading]);

  return localHost || remoteHost;
}
