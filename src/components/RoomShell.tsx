"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSettings } from "@/hooks/useSettings";

const WhiteboardCanvas = dynamic(() => import("./WhiteboardCanvas"), { ssr: false });
const VideoPanel = dynamic(() => import("./VideoPanel"), { ssr: false });
const SettingsModal = dynamic(() => import("./SettingsModal"), { ssr: false });

export default function RoomShell({
  roomId,
  userName,
}: {
  roomId: string;
  userName: string;
}) {
  const [settings] = useSettings();
  const [name, setName] = useState(userName);
  const [videoOpen, setVideoOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const userId = useMemo(() => {
    if (typeof window === "undefined") return "";
    let id = window.localStorage.getItem("wb_user_id");
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem("wb_user_id", id);
    }
    return id;
  }, []);

  // Apply "Open video panel on entry" setting once on mount.
  useEffect(() => {
    setVideoOpen(settings.showVideoOnEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!name) {
      const saved = window.localStorage.getItem("wb_user_name");
      if (saved) setName(saved);
    } else {
      window.localStorage.setItem("wb_user_name", name);
    }
  }, [name]);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/r/${roomId}` : "";

  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="flex items-center gap-3 px-4 py-2 bg-[#11141b] border-b border-white/5 z-10">
        <Link href="/" className="font-semibold tracking-tight">
          Whiteboard
        </Link>
        <span className="text-white/30">/</span>
        <span className="text-white/80">{roomId}</span>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="rounded-md bg-[#0b0d12] border border-white/10 px-2 py-1 text-sm w-40 outline-none focus:border-brand-500"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(inviteUrl);
            }}
            className="text-sm rounded-md border border-white/10 px-3 py-1 hover:bg-white/5"
            title={inviteUrl}
          >
            Copy invite link
          </button>
          <button
            onClick={() => setVideoOpen((v) => !v)}
            className="text-sm rounded-md bg-brand-600 hover:bg-brand-500 px-3 py-1"
          >
            {videoOpen ? "Hide video" : "Show video"}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-sm rounded-md border border-white/10 w-9 h-8 flex items-center justify-center hover:bg-white/5"
            aria-label="Settings"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="relative flex-1 min-w-0">
          {userId && (
            <WhiteboardCanvas
              roomId={roomId}
              userId={userId}
              userName={name || "Guest"}
            />
          )}
        </div>
        {videoOpen && (
          <aside className="w-[360px] shrink-0 border-l border-white/5 bg-[#0e1118] flex flex-col">
            <VideoPanel roomId={roomId} userName={name || "Guest"} />
          </aside>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={roomId}
        userName={name}
        onUserNameChange={setName}
      />
    </div>
  );
}
