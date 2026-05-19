"use client";

import { useEffect, useState } from "react";

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

export function markAsHost(roomId: string) {
  const rooms = readHosted();
  rooms.add(roomId);
  writeHosted(rooms);
}

export function useIsHost(roomId: string): boolean {
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    setIsHost(readHosted().has(roomId));
  }, [roomId]);

  return isHost;
}
