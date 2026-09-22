"use client";

import { useEffect, useRef, useState } from "react";
import { ChatCircle, PaperPlaneRight, X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import Sticker from "@/components/Sticker";

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
        .select("id,room_id,user_id,user_name,text,created_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      const list = (data as Message[]) ?? [];
      // Merge rather than replace: a realtime INSERT can land between this
      // fetch starting and resolving, and a plain setMessages(list) would
      // drop that just-arrived message. Keep any messages already in state
      // that the snapshot didn't include.
      setMessages((prev) => {
        const seen = new Set(list.map((m) => m.id));
        const extra = prev.filter((m) => !seen.has(m.id));
        return [...list, ...extra];
      });
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
          // Dedupe: the initial fetch's merge may already include this id.
          setMessages((prev) =>
            prev.some((x) => x.id === m.id) ? prev : [...prev, m],
          );
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
    const { error } = await supabase.from("room_messages").insert({
      room_id: roomId,
      user_id: userId,
      user_name: userName,
      text: text.slice(0, 2000),
    });
    if (error) setDraft(text);
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={
          open
            ? "Hide chat"
            : unread > 0
              ? `Open chat — ${unread} unread message${unread === 1 ? "" : "s"}`
              : "Open chat"
        }
        className="touch-target fixed bottom-4 right-4 z-[8000] w-11 h-11 rounded-full bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)] border-2 border-ink shadow-sticker sticker-press text-[var(--text)] flex items-center justify-center"
        title="Chat"
      >
        <ChatCircle size={22} aria-hidden />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 rounded-full bg-brand-600 text-[10px] font-extrabold px-1 flex items-center justify-center text-white border-2 border-ink"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 right-4 z-[8000] w-[min(320px,calc(100vw-2rem))] h-[min(440px,calc(100dvh-7rem))] rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg overflow-hidden scale-pop flex flex-col">
          <header className="flex items-center justify-between px-3.5 py-2 border-b-2 border-dashed border-[color:var(--border)]">
            <h3 className="text-sm font-extrabold tracking-display">Chat</h3>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-full bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)] border-2 border-ink shadow-sticker-sm sticker-press text-[var(--text)] inline-flex items-center justify-center"
              aria-label="Close chat"
            >
              <X size={14} aria-hidden />
            </button>
          </header>

          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-sm"
          >
            {messages.length === 0 ? (
              <div className="text-center text-xs font-semibold text-[var(--text-dim)] py-6">
                {/* The chat panel is the room's "someone's looking after
                    you" surface, which is what this sticker depicts. Kept
                    small — the popover is only 320px wide. */}
                <Sticker name="feeding" size={92} className="mx-auto mb-1" />
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
                      <span className="text-[10px] font-bold text-[var(--text-muted)] ml-1">{m.user_name}</span>
                    )}
                    {/* Speech-bubble stickers: 2px ink outline on both so a red
                        "mine" bubble reads as a primary pill, not a flat block. */}
                    <span
                      className={`max-w-[85%] px-3 py-1.5 border-2 border-ink font-semibold break-words whitespace-pre-wrap ${
                        mine
                          ? "bg-brand-600 text-white rounded-2xl rounded-br-md"
                          : "bg-[var(--bg-elev-2)] text-[var(--text)] rounded-2xl rounded-bl-md"
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
            className="border-t-2 border-dashed border-[color:var(--border)] p-2 flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a message…"
              maxLength={2000}
              className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              title="Send"
              className="h-10 px-3.5 shrink-0 rounded-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-extrabold border-2 border-ink shadow-sticker-primary sticker-press disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              <PaperPlaneRight size={16} aria-hidden />
              <span>Send</span>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
