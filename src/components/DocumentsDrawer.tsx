"use client";

import { useEffect, useMemo, useState } from "react";
import { CaretRight, X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useToast } from "./Toast";
import ConfirmButton from "./ConfirmButton";
import DrawerSkeleton from "./Skeleton";

// Group docs by local date string (yyyy-mm-dd). Returns the groups in
// reverse-chronological order, with a human-friendly label for each
// (Today / Yesterday / Mon, May 18 / full date for older).
function groupByDate(
  docs: Document[],
): Array<{ key: string; label: string; items: Document[] }> {
  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - 86400000));
  const groups = new Map<string, Document[]>();
  for (const d of docs) {
    const k = dayKey(new Date(d.uploaded_at));
    const list = groups.get(k) ?? [];
    list.push(d);
    groups.set(k, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      label:
        key === todayKey
          ? "Today"
          : key === yesterdayKey
            ? "Yesterday"
            : new Date(key).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year:
                  new Date(key).getFullYear() === now.getFullYear()
                    ? undefined
                    : "numeric",
              }),
      items,
    }));
}

function dayKey(d: Date): string {
  // Local-date key (yyyy-mm-dd). Avoids UTC drift around midnight.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  const [docs, setDocs] = useState<Document[] | null>(null);
  const [uploading, setUploading] = useState(false);
  useEscapeToClose(open, onClose);
  // Track which date sections are collapsed. Default everything *open*
  // for today and yesterday, *closed* for older — covers the common
  // case where the host just wants to see what was uploaded recently.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupByDate(docs ?? []), [docs]);

  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchDocs = async () => {
      const { data } = await supabase
        .from("room_documents")
        .select("*")
        .eq("room_id", roomId)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false });
      const rows = (data as Document[]) ?? [];
      // Collapse legacy duplicates from rooms uploaded before the
      // PDF-pipeline fix: per-page PNGs were inserted as N rows all
      // named "lesson.pdf". Keep the most recent unique (name + url)
      // and hide the per-page PNG rows that slipped through ("…-page-1.png").
      const seen = new Set<string>();
      const filtered = rows.filter((r) => {
        if (/-page-\d+\.png$/i.test(r.name)) return false;
        const key = `${r.name}::${r.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setDocs(filtered);
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
    // Soft-delete: keeps the Storage URL + row intact (so an
    // accidental removal can be undone by un-setting deleted_at) and
    // just hides it from the drawer query.
    const { error } = await supabase
      .from("room_documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(`Couldn't remove: ${error.message}`);
    } else {
      // Optimistic: drop from local state immediately so the realtime
      // event isn't strictly necessary.
      setDocs((prev) => (prev ?? []).filter((d) => d.id !== id));
      toast.success("Document removed");
    }
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
              className="text-[var(--text-muted)] hover:text-[var(--text)] inline-flex"
              aria-label="Close"
            >
              <X size={22} aria-hidden />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {docs === null ? (
            <DrawerSkeleton />
          ) : docs.length === 0 ? (
            <div className="p-8 text-center">
              <EmptyDocsIllustration />
              <p className="text-sm font-medium mt-3">No documents yet</p>
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
            <div className="divide-y divide-[color:var(--border-subtle)]">
              {groups.map((group, gIdx) => {
                // Open by default for the two most recent groups
                // (which will usually be Today + Yesterday); older
                // closed unless the user expands them.
                const isOpen =
                  collapsed[group.key] !== undefined
                    ? !collapsed[group.key]
                    : gIdx < 2;
                return (
                  <section key={group.key}>
                    <button
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [group.key]: isOpen }))
                      }
                      className="w-full flex items-center gap-2 px-4 py-2 bg-[var(--bg)] hover:bg-[var(--hover)] text-left"
                      aria-expanded={isOpen}
                    >
                      <span
                        className={`text-[var(--text-dim)] transition-transform inline-flex w-3 ${
                          isOpen ? "rotate-90" : ""
                        }`}
                        aria-hidden="true"
                      >
                        <CaretRight size={12} weight="bold" />
                      </span>
                      <span className="text-xl">📁</span>
                      <span className="text-sm font-medium flex-1">
                        {group.label}
                      </span>
                      <span className="text-xs text-[var(--text-dim)] tabular-nums">
                        {group.items.length}{" "}
                        {group.items.length === 1 ? "file" : "files"}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="divide-y divide-[color:var(--border-subtle)]">
                        {group.items.map((d) => (
                          <li
                            key={d.id}
                            className="pl-10 pr-4 py-3 flex items-center gap-3"
                          >
                            <div className="text-xl">
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
                                {new Date(d.uploaded_at).toLocaleTimeString([], {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </div>
                            </div>
                            {isHost && (
                              <ConfirmButton
                                onConfirm={() => remove(d.id)}
                                label="Remove"
                                title="Remove from list (file stays in storage)"
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Small inline illustration for the empty Documents drawer state.
// Hand-crafted SVG so there's no extra asset to ship — three offset
// document outlines suggesting "a place where things accumulate".
function EmptyDocsIllustration() {
  return (
    <svg
      width="88"
      height="72"
      viewBox="0 0 88 72"
      fill="none"
      aria-hidden="true"
      className="mx-auto"
    >
      {/* Back paper */}
      <rect
        x="22"
        y="18"
        width="40"
        height="50"
        rx="4"
        fill="var(--bg-elev-2, #eef2ff)"
        stroke="var(--border, #c7d2fe)"
        strokeWidth="1.5"
      />
      {/* Middle paper, slightly rotated */}
      <g transform="rotate(-6 30 38)">
        <rect
          x="14"
          y="14"
          width="40"
          height="50"
          rx="4"
          fill="#ffffff"
          stroke="var(--border, #c7d2fe)"
          strokeWidth="1.5"
        />
        <line x1="20" y1="26" x2="46" y2="26" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="20" y1="34" x2="46" y2="34" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="20" y1="42" x2="38" y2="42" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      {/* Front paper with corner fold */}
      <g transform="rotate(5 60 42)">
        <path
          d="M44 26 L62 26 L70 34 L70 64 L44 64 Z"
          fill="#ffffff"
          stroke="rgb(37 99 235)"
          strokeWidth="1.6"
        />
        <path
          d="M62 26 L62 34 L70 34"
          fill="rgb(219 234 254)"
          stroke="rgb(37 99 235)"
          strokeWidth="1.6"
        />
        <line x1="50" y1="44" x2="64" y2="44" stroke="rgb(37 99 235)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="50" y1="50" x2="64" y2="50" stroke="rgb(37 99 235)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="50" y1="56" x2="58" y2="56" stroke="rgb(37 99 235)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
