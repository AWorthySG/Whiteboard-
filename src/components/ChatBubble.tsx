"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Message = {
  id: string;
  room_id: string;
  user_id: string;
  user_name: string;
  text: string;
  created_at: string;
};

const SEEN_KEY_PREFIX = "wb_chat_last_seen:";

export default function ChatBubble({
  roomId,
  userId,
  userName,
}: {
  roomId: string;
  userId: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const lastSeenRef = useRef<number>(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Load last-seen timestamp once per room.
  useEffect(() => {
    if (!roomId) return;
    const ts = Number(
      window.localStorage.getItem(`${SEEN_KEY_PREFIX}${roomId}`) ?? 0,
    );
    lastSeenRef.current = ts;
  }, [roomId]);

  // Fetch + subscribe.
  useEffect(() => {
    if (!roomId) return;
    const supabase = getSupabase();
    if (!supabase) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("room_messages")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      const list = (data as Message[]) ?? [];
      setMessages(list);
      const unseen = list.filter(
        (m) =>
          new Date(m.created_at).getTime() > lastSeenRef.current &&
          m.user_id !== userId,
      ).length;
      setUnread(unseen);
    })();

    const channel = supabase
      .channel(`chat-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => [...prev, m]);
          if (m.user_id !== userId) {
            // Increment unread unless the panel is currently open.
            setOpen((curOpen) => {
              if (!curOpen) setUnread((u) => u + 1);
              return curOpen;
            });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, userId]);

  // Auto-scroll to bottom when new messages arrive while open.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, messages.length]);

  // Mark seen when opening.
  useEffect(() => {
    if (!open || !roomId) return;
    setUnread(0);
    const now = Date.now();
    lastSeenRef.current = now;
    window.localStorage.setItem(`${SEEN_KEY_PREFIX}${roomId}`, String(now));
  }, [open, roomId, messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setDraft("");
    await supabase.from("room_messages").insert({
      room_id: roomId,
      user_id: userId,
      user_name: userName,
      text: text.slice(0, 2000),
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Hide chat" : "Open chat"}
        className="touch-target fixed bottom-4 right-4 z-[8000] rounded-full bg-brand-600 hover:bg-brand-500 text-white w-12 h-12 shadow-2xl flex items-center justify-center"
        title="Chat"
      >
        <ChatSvg />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-[10px] font-semibold px-1 flex items-center justify-center text-white border border-[var(--bg)]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-[8000] w-[min(320px,calc(100vw-2rem))] h-[min(440px,calc(100dvh-7rem))] rounded-xl bg-[var(--bg-elev)] border border-white/10 shadow-2xl flex flex-col">
          <header className="flex items-center justify-between px-3 py-2 border-b border-white/5">
            <h3 className="text-sm font-semibold">Chat</h3>
            <button
              onClick={() => setOpen(false)}
              className="text-white/60 hover:text-white text-xl leading-none"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-sm"
          >
            {messages.length === 0 ? (
              <div className="text-center text-xs text-white/40 py-6">
                No messages yet. Say hi 👋
              </div>
            ) : (
              messages.map((m) => {
                const mine = m.user_id === userId;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
                  >
                    {!mine && (
                      <span className="text-[10px] text-white/40">{m.user_name}</span>
                    )}
                    <span
                      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 break-words whitespace-pre-wrap ${
                        mine
                          ? "bg-brand-600 text-white"
                          : "bg-white/5 text-white/90"
                      }`}
                    >
                      {m.text}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="border-t border-white/5 p-2 flex gap-1.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              maxLength={2000}
              className="flex-1 rounded-md bg-[var(--bg)] border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-3 text-sm font-medium"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function ChatSvg() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
