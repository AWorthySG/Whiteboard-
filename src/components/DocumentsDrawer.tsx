"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CaretRight,
  FilePdf,
  FolderSimple,
  Image as ImageIcon,
  X,
} from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { validateFileForUpload, getSafeMimeType } from "@/lib/fileValidation";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useToast } from "./Toast";
import ConfirmButton from "./ConfirmButton";
import DrawerSkeleton from "./Skeleton";
import Sticker from "@/components/Sticker";

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
        .select("id,room_id,name,url,mime_type,uploaded_by_name,uploaded_at")
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
        validateFileForUpload(file);
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
              "Content-Type": getSafeMimeType(file),
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
          if (error) {
            // The file is in Storage but the DB row that would surface
            // it in the Documents drawer didn't land — delete the file
            // so it doesn't sit forever in the bucket, then surface
            // the error to the user.
            void supabase.storage
              .from("whiteboard-assets")
              .remove([path]);
            throw new Error(`DB insert failed: ${error.message}`);
          }
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
      className="fixed inset-0 z-[10000] flex justify-end bg-[rgba(28,27,25,0.4)]"
      onClick={onClose}
    >
      {/*
        Drawer shell. Deliberately `shadow-soft-3` (ambient) rather than the
        card recipe's hard `shadow-sticker-lg`: that shadow is a straight-down
        offset, which on a full-height panel pinned to the right viewport edge
        would paint a 5px ink bar along the bottom that gets clipped by the
        viewport and reads as a rendering glitch, not a sticker. The 2px ink
        outline + rounded-l-3xl carry the sticker look; the soft shadow just
        lifts the panel off the canvas. Keep in step with HomeworkDrawer and
        RecordingsDrawer, which use the same shell.
      */}
      <div
        className="w-full max-w-md h-full bg-[var(--bg-sidebar)] border-l-2 border-ink md:border-y-2 md:rounded-l-3xl shadow-soft-3 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glass-header flex items-center justify-between px-5 py-4 border-b-2 border-dashed border-[color:var(--border)]">
          <h2 className="text-lg font-extrabold tracking-display">Documents</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={pickAndUpload}
              disabled={uploading}
              className="text-sm font-extrabold rounded-full bg-brand-600 text-white border-2 border-ink shadow-sticker-primary sticker-press hover:bg-brand-500 px-3.5 py-1.5 disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text)]"
              aria-label="Close"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {docs === null ? (
            <DrawerSkeleton />
          ) : docs.length === 0 ? (
            <div className="p-8 text-center">
              {/* Worksheet duo — a checklist page and a lightbulb — for the
                  "no documents yet" moment, in place of the old hand-drawn
                  paper-stack SVG. */}
              <Sticker name="essay" size={120} className="mx-auto" />
              <p className="text-sm font-bold mt-3">No documents yet</p>
              <p className="text-xs font-semibold text-[var(--text-dim)] mt-1">
                Click the <span className="font-extrabold text-brand-600">Upload</span> button
                above, or drag a PDF/image onto the canvas. Files appear here
                for everyone in the room.
              </p>
              <button
                onClick={pickAndUpload}
                disabled={uploading}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-600 text-white border-2 border-ink shadow-sticker-primary sticker-press hover:bg-brand-500 px-4 py-2 text-sm font-extrabold disabled:opacity-40"
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
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-[var(--hover)] text-left"
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
                      <FolderSimple
                        size={18}
                        weight="duotone"
                        className="text-[var(--text-dim)]"
                        aria-hidden
                      />
                      <span className="font-label text-[var(--text-muted)] flex-1">
                        {group.label}
                      </span>
                      <span className="text-[11px] font-bold text-[var(--text-dim)] tabular-nums">
                        {group.items.length}{" "}
                        {group.items.length === 1 ? "file" : "files"}
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="px-4 pb-3 pt-1 space-y-2">
                        {group.items.map((d) => (
                          <li
                            key={d.id}
                            className="px-3 py-2.5 flex items-center gap-3 bg-[var(--bg-elev)] border-2 border-ink rounded-xl shadow-sticker-sm card-lift"
                          >
                            <div
                              className={`w-10 h-10 shrink-0 rounded-full border-2 border-ink flex items-center justify-center ${
                                d.mime_type === "application/pdf"
                                  ? "bg-bloom-bg text-bloom-deep"
                                  : "bg-sky-bg text-sky-deep"
                              }`}
                            >
                              {d.mime_type === "application/pdf" ? (
                                <FilePdf size={20} aria-hidden />
                              ) : (
                                <ImageIcon size={20} aria-hidden />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <a
                                href={d.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-bold truncate block hover:text-brand-600"
                                title={d.name}
                              >
                                {d.name}
                              </a>
                              <div className="text-xs font-semibold text-[var(--text-dim)]">
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
