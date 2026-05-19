"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Homework = {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
};

export default function HomeworkDrawer({
  open,
  onClose,
  roomId,
  userId,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  userId: string;
  isHost: boolean;
}) {
  const [items, setItems] = useState<Homework[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchItems = async () => {
      const { data } = await supabase
        .from("room_homework")
        .select("*")
        .eq("room_id", roomId)
        .order("created_at", { ascending: false });
      setItems((data as Homework[]) ?? []);
    };

    void fetchItems();

    const channel = supabase
      .channel(`homework-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_homework",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchItems(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, roomId]);

  const add = async () => {
    if (!title.trim()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setSaving(true);
    await supabase.from("room_homework").insert({
      room_id: roomId,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      created_by_user_id: userId,
    });
    setTitle("");
    setDescription("");
    setDueDate("");
    setSaving(false);
  };

  const remove = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("room_homework").delete().eq("id", id);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[#11141b] border-l border-white/10 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Homework</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-4xl mb-2">📝</div>
              {isHost ? (
                <>
                  <p className="text-sm font-medium">No homework yet</p>
                  <p className="text-xs text-white/40 mt-1">
                    Add an assignment below — students see it as soon as you save.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No homework yet</p>
                  <p className="text-xs text-white/40 mt-1">
                    Your teacher hasn't assigned anything for this lesson.
                  </p>
                </>
              )}
            </div>
          )}
          <ul className="divide-y divide-white/5">
            {items.map((h) => (
              <li key={h.id} className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{h.title}</div>
                    {h.description && (
                      <div className="text-sm text-white/70 mt-1 whitespace-pre-wrap">
                        {h.description}
                      </div>
                    )}
                    {h.due_date && (
                      <div className="text-xs text-amber-300 mt-1">
                        Due {new Date(h.due_date).toLocaleDateString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>
                    )}
                  </div>
                  {isHost && (
                    <button
                      onClick={() => remove(h.id)}
                      className="text-xs text-white/40 hover:text-red-400 shrink-0"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {isHost && (
          <div className="border-t border-white/5 p-4 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Homework title"
              className="w-full rounded-md bg-[#0b0d12] border border-white/10 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="w-full rounded-md bg-[#0b0d12] border border-white/10 px-3 py-2 text-sm outline-none focus:border-brand-500 resize-none"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex-1 rounded-md bg-[#0b0d12] border border-white/10 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                onClick={add}
                disabled={!title.trim() || saving}
                className="rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
              >
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
