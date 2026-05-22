"use client";

import { useEffect, useState } from "react";

// localStorage-backed set of pinned roomIds. Pinned rooms float to
// the top of the home-page list so the user's current-term recurring
// classes are always one tap away regardless of last-visited.

const KEY = "wb_pinned_rooms";
const EVENT = "wb-pinned-rooms-changed";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // no-op (quota / private-mode)
  }
}

export function pinRoom(roomId: string) {
  const cur = read();
  if (cur.includes(roomId)) return;
  write([roomId, ...cur]);
}

export function unpinRoom(roomId: string) {
  const cur = read();
  const next = cur.filter((id) => id !== roomId);
  if (next.length === cur.length) return;
  write(next);
}

export function isPinned(roomId: string): boolean {
  return read().includes(roomId);
}

export function usePinnedRooms(): Set<string> {
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(read()));
  useEffect(() => {
    const refresh = () => setPinned(new Set(read()));
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return pinned;
}
