"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";

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
  userId,
  userName,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}) {
  const toast = useToast();
  const [docs, setDocs] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);

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
    const { error } = await supabase.from("room_documents").delete().eq("id", id);
    if (error) toast.error(`Couldn't remove: ${error.message}`);
  };

  const pickAndUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*";
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) return;
      try {
        setUploading(true);
        // Upload straight from the browser to Supabase Storage — bypasses
        // the Next.js /api/uploads proxy, saves a hop, and stops Vercel
        // from billing function invocation time on every upload.
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error("Supabase env vars missing");
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
        const upRes = await fetch(
          `${url}/storage/v1/object/whiteboard-assets/${path}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              apikey: key,
              "Content-Type": file.type || "application/octet-stream",
              "x-upsert": "false",
            },
            body: file,
          },
        );
        if (!upRes.ok) {
          const body = await upRes.text();
          throw new Error(`Storage upload failed: ${body || upRes.status}`);
        }
        const publicUrl = `${url}/storage/v1/object/public/whiteboard-assets/${path}`;
        const supabase = getSupabase();
        if (supabase) {
          const { error } = await supabase.from("room_documents").insert({
            room_id: roomId,
            name: file.name,
            url: publicUrl,
            mime_type: file.type || null,
            uploaded_by_user_id: userId,
            uploaded_by_name: userName,
          });
          if (error) throw new Error(`DB insert failed: ${error.message}`);
        }
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        console.error("[documents] upload failed", e);
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[var(--bg-elev)] border-l border-[color:var(--border)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Documents</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={pickAndUpload}
              disabled={uploading}
              className="text-sm rounded-md bg-brand-600 text-white hover:bg-brand-500 px-3 py-1.5 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {docs.length === 0 ? (
            <div className="p-8 text-center">
              <div className="text-4xl mb-2">📄</div>
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-xs text-[var(--text-dim)] mt-1">
                Click the <span className="text-brand-700">Upload</span> button
                above, or drag a PDF/image onto the canvas. Files appear here
                for everyone in the room.
              </p>
              <button
                onClick={pickAndUpload}
                disabled={uploading}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-brand-600 text-white hover:bg-brand-500 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Upload a document"}
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
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
                      className="text-sm font-medium truncate block hover:text-brand-700"
                      title={d.name}
                    >
                      {d.name}
                    </a>
                    <div className="text-xs text-[var(--text-dim)]">
                      {d.uploaded_by_name || "Someone"} ·{" "}
                      {new Date(d.uploaded_at).toLocaleString()}
                    </div>
                  </div>
                  {isHost && (
                    <button
                      onClick={() => remove(d.id)}
                      className="text-xs text-[var(--text-dim)] hover:text-red-600"
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
