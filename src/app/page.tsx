"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAsHost } from "@/hooks/useHostStatus";

function generateRoomId() {
  const adj = ["bright", "swift", "quiet", "warm", "bold", "calm", "lucky", "neat"];
  const noun = ["otter", "comet", "river", "ember", "cloud", "harbor", "willow", "ridge"];
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return `${pick(adj)}-${pick(noun)}-${n}`;
}

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");

  const start = (id: string, isNew: boolean) => {
    if (isNew) markAsHost(id);
    const params = new URLSearchParams();
    if (name.trim()) params.set("name", name.trim());
    router.push(`/r/${encodeURIComponent(id)}?${params.toString()}`);
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl rounded-2xl bg-[#11141b] border border-white/5 shadow-xl p-6 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          A Worthy Whiteboard
        </h1>
        <p className="text-white/60 mt-1 text-sm sm:text-base">
          Real-time collaborative whiteboard with video, audio, and document upload.
        </p>

        <div className="mt-6 sm:mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-white/70">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="mt-1 w-full rounded-lg bg-[#0b0d12] border border-white/10 px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Room code (optional)"
              className="flex-1 rounded-lg bg-[#0b0d12] border border-white/10 px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
            <button
              onClick={() => {
                const trimmed = room.trim();
                const id = trimmed || generateRoomId();
                start(id, !trimmed);
              }}
              className="rounded-lg bg-brand-600 hover:bg-brand-500 px-4 py-2.5 font-medium"
            >
              {room.trim() ? "Join" : "Create"}
            </button>
          </div>

          <p className="text-xs text-white/40">
            Tip: share the URL after you join — anyone with the link is in the same room.
          </p>
        </div>
      </div>
    </main>
  );
}
