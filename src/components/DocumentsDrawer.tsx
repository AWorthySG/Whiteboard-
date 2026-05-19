"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Document = {
  id: string;
  room_id: string;
  name: string;
  url: string;
  mime_type: string | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
};

export default function DocumentsDrawer({
  open,
  onClose,
  roomId,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  isHost: boolean;
}) {
  const [docs, setDocs] = useState<Document[]>([]);

  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchDocs = async () => {
      const { data } = await supabase
        .from("room_documents")
        .select("*")
        .eq("room_id", roomId)
        .order("uploaded_at", { ascending: false });
      setDocs((data as Document[]) ?? []);
    };

    void fetchDocs();

    const channel = supabase
      .channel(`docs-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_documents",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchDocs(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, roomId]);

  const remove = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("room_documents").delete().eq("id", id);
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
          <h2 className="text-lg font-semibold">Documents</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {docs.length === 0 ? (
            <div className="p-6 text-center text-sm text-white/40">
              No documents yet. Upload one with the "Upload document" button on the canvas.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {docs.map((d) => (
                <li key={d.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="text-2xl">
                    {d.mime_type === "application/pdf" ? "📄" : "🖼️"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium truncate block hover:text-brand-500"
                      title={d.name}
                    >
                      {d.name}
                    </a>
                    <div className="text-xs text-white/40">
                      {d.uploaded_by_name || "Someone"} ·{" "}
                      {new Date(d.uploaded_at).toLocaleString()}
                    </div>
                  </div>
                  {isHost && (
                    <button
                      onClick={() => remove(d.id)}
                      className="text-xs text-white/40 hover:text-red-400"
                      title="Remove from list (file stays in storage)"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
