"use client";

import { useEffect, useState } from "react";
import { Play, X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";
import ConfirmButton from "./ConfirmButton";

type Recording = {
  id: string;
  room_id: string;
  title: string | null;
  file_url: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  host_name: string | null;
  recorded_at: string;
  frames_url: string | null;
};

export default function RecordingsDrawer({
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
  const toast = useToast();
  const [items, setItems] = useState<Recording[]>([]);
  const [playing, setPlaying] = useState<Recording | null>(null);

  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    if (!supabase) return;
    const fetchItems = async () => {
      const { data } = await supabase
        .from("room_recordings")
        .select("*")
        .eq("room_id", roomId)
        .order("recorded_at", { ascending: false });
      setItems((data as Recording[]) ?? []);
    };
    void fetchItems();
    const channel = supabase
      .channel(`recordings-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_recordings",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchItems(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, roomId]);

  const remove = async (r: Recording) => {
    // Confirmation is handled by <ConfirmButton/> in the row UI now.
    const supabase = getSupabase();
    if (!supabase) return;
    // Best-effort delete from storage, then delete the row regardless.
    await supabase.storage.from("whiteboard-recordings").remove([r.file_path]);
    const { error } = await supabase.from("room_recordings").delete().eq("id", r.id);
    if (error) toast.error(`Couldn't delete: ${error.message}`);
    else toast.success("Recording deleted");
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[10000] flex justify-end bg-black/40"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md h-full bg-[var(--bg-elev)] border-l border-[color:var(--border)] shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
            <h2 className="text-lg font-semibold">Recordings</h2>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text)] inline-flex"
              aria-label="Close"
            >
              <X size={22} aria-hidden />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-2">🎬</div>
                <p className="text-sm font-medium">No recordings yet</p>
                <p className="text-xs text-[var(--text-dim)] mt-1">
                  {isHost
                    ? "Click Record in the header to capture this lesson. It will appear here once the upload finishes."
                    : "The teacher hasn't recorded this lesson yet."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[color:var(--border-subtle)]">
                {items.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => setPlaying(r)}
                        className="shrink-0 w-12 h-12 rounded-md bg-brand-600 hover:bg-brand-500 flex items-center justify-center text-white"
                        aria-label={`Play ${r.title ?? "recording"}`}
                      >
                        <Play weight="fill" size={22} aria-hidden />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" title={r.title ?? ""}>
                          {r.title ?? "Recording"}
                        </div>
                        <div className="text-xs text-[var(--text-dim)] mt-0.5">
                          {r.host_name ? `${r.host_name} · ` : ""}
                          {new Date(r.recorded_at).toLocaleString()}
                        </div>
                        <div className="text-xs text-[var(--text-dim)] mt-0.5 flex gap-3">
                          {r.duration_sec !== null && <span>{formatDuration(r.duration_sec)}</span>}
                          {r.size_bytes !== null && <span>{formatBytes(r.size_bytes)}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {r.frames_url && (
                          <a
                            href={`/playback/${r.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-brand-700 hover:text-brand-800 font-medium inline-flex items-center gap-1"
                            title="Open synchronised whiteboard + video playback in a new tab"
                          >
                            <Play weight="fill" size={12} aria-hidden />
                            Play with whiteboard
                          </a>
                        )}
                        <a
                          href={r.file_url}
                          download
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                          title="Download"
                        >
                          Download
                        </a>
                        {isHost && (
                          <ConfirmButton
                            onConfirm={() => remove(r)}
                            label="Delete"
                            title="Delete recording"
                          />
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {playing && <PlayerModal recording={playing} onClose={() => setPlaying(null)} />}
    </>
  );
}

function PlayerModal({
  recording,
  onClose,
}: {
  recording: Recording;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-black rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-elev)] text-[var(--text)]">
          <div className="text-sm font-medium truncate">
            {recording.title ?? "Recording"}
          </div>
          <button
            onClick={onClose}
            aria-label="Close player"
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <video
          src={recording.file_url}
          controls
          autoPlay
          className="w-full max-h-[80vh] bg-black"
        />
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
