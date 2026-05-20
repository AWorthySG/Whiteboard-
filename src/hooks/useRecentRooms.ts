"use client";

import { useEffect, useState } from "react";

export type RecentRoom = {
  roomId: string;
  title?: string;
  lastVisitedAt: number;
  role: "host" | "guest";
};

const KEY = "wb_recent_rooms";
const MAX = 30;
const EVENT = "wb-recent-rooms-changed";

function read(): RecentRoom[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentRoom[];
  } catch {
    return [];
  }
}

function write(rooms: RecentRoom[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rooms.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // no-op
  }
}

export function trackRoomVisit(
  roomId: string,
  title: string,
  role: "host" | "guest",
) {
  const existing = read();
  const filtered = existing.filter((r) => r.roomId !== roomId);
  filtered.unshift({
    roomId,
    title: title || roomId,
    lastVisitedAt: Date.now(),
    role,
  });
  write(filtered);
}

export function removeRoomFromRecents(roomId: string) {
  const next = read().filter((r) => r.roomId !== roomId);
  write(next);
}

export function useRecentRooms(): RecentRoom[] {
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  useEffect(() => {
    setRooms(read());
    const onChange = () => setRooms(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return rooms;
}
