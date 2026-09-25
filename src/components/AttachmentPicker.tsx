"use client";

import { useEffect, useRef, useState } from "react";
import {
  Books,
  Camera,
  File as FileIcon,
  Paperclip,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { validateFileForUpload, getSafeMimeType } from "@/lib/fileValidation";
import { shrinkImageForUpload } from "@/lib/imageCompression";

/** Photos of homework are shrunk to this longest side before upload: a
 *  phone photo is often 4000 px / 3-5 MB, slow on mobile data, and 2560 px
 *  keeps handwriting on a full page easy to read. */
const HOMEWORK_PHOTO_MAX = 2560;
import { useToast } from "./Toast";

export type Attachment = {
  url: string;
  name: string;
  // Set only for fresh uploads — callers can use this to roll back
  // the storage object if a downstream DB insert fails. Picking an
  // existing document leaves this undefined.
  freshUploadPath?: string;
};

type RoomDocument = {
  id: string;
  name: string;
  url: string;
  uploaded_at: string | null;
  uploaded_by_name: string | null;
};

// Reusable picker for "attach a file". Two modes:
//  - Upload a fresh file (browser → Supabase Storage)
//  - Pick an existing document from the room's Documents drawer
//
// Used by homework assignments (host attaches a worksheet) and
// homework submissions (student attaches their completed work).
// Stores the result as a flat { url, name } so the consumer
// doesn't need to know which mode produced it.
export default function AttachmentPicker({
  roomId,
  value,
  onChange,
  accept = "application/pdf,image/*",
  label = "Attach a file",
  allowCapture = false,
  shrinkPhotos = false,
}: {
  roomId: string;
  value: Attachment | null;
  onChange: (next: Attachment | null) => void;
  accept?: string;
  label?: string;
  // When true, a "Take photo" button is shown on touch devices that
  // opens the rear camera directly (capture="environment") — for
  // students snapping a photo of handwritten work without digging
  // through the OS file picker. Ignored on non-touch devices.
  allowCapture?: boolean;
  // When true, photos are scaled down and re-encoded before upload (see
  // HOMEWORK_PHOTO_MAX). Student submissions; not worksheets the host
  // attaches, which stay as the original file.
  shrinkPhotos?: boolean;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"idle" | "picker">("idle");
  const [docs, setDocs] = useState<RoomDocument[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  // Touch capability is only known client-side, so detect after mount
  // (avoids an SSR/CSR mismatch). Phones + tablets (incl. iPad) report
  // maxTouchPoints > 0; most desktops report 0, where a "Take photo"
  // button would just reopen the file dialog and read as redundant.
  const [canCapture, setCanCapture] = useState(false);
  useEffect(() => {
    setCanCapture(
      typeof navigator !== "undefined" &&
        (navigator.maxTouchPoints > 0 || "ontouchstart" in window),
    );
  }, []);

  // Lazy-load docs only when the picker opens — most users will
  // never hit this code path.
  useEffect(() => {
    if (mode !== "picker" || docs !== null) return;
    const supabase = getSupabase();
    if (!supabase) {
      setDocs([]);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("room_documents")
        .select("id, name, url, uploaded_at, uploaded_by_name")
        .eq("room_id", roomId)
        .is("deleted_at", null)
        .order("uploaded_at", { ascending: false });
      if (error) {
        toast.error(`Couldn't load documents: ${error.message}`);
        setDocs([]);
        return;
      }
      setDocs((data ?? []) as RoomDocument[]);
    })();
  }, [mode, docs, roomId, toast]);

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!picked) return;
    try {
      validateFileForUpload(picked);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }
    setUploading(true);
    try {
      const file = shrinkPhotos
        ? await shrinkImageForUpload(picked, HOMEWORK_PHOTO_MAX)
        : picked;
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        throw new Error("Supabase env vars missing");
      }
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const res = await fetch(
        `${supabaseUrl}/storage/v1/object/whiteboard-assets/${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            apikey: supabaseKey,
            "Content-Type": getSafeMimeType(file),
            "x-upsert": "false",
          },
          body: file,
        },
      );
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const url = `${supabaseUrl}/storage/v1/object/public/whiteboard-assets/${path}`;
      onChange({ url, name: file.name, freshUploadPath: path });
    } catch (err) {
      toast.error(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  // If we already have an attachment, show a compact 'selected' chip
  // with a remove button instead of the picker UI.
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-ink bg-[var(--bg-elev)] shadow-sticker-sm px-2.5 py-1.5">
        <Paperclip aria-hidden className="shrink-0 text-[var(--text-muted)]" />
        <span className="flex-1 text-sm font-bold truncate" title={value.name}>
          {value.name}
        </span>
        <a
          href={value.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-bold text-[var(--text-muted)] hover:text-brand-600"
          title="Open in a new tab"
        >
          Preview
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="w-8 h-8 shrink-0 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text-muted)] hover:text-danger-700"
          aria-label="Remove attachment"
          title="Remove attachment"
        >
          <X aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Dashed ink outline = the LMS "drop zone" sticker; the choices
          inside are secondary pills so the primary action of the
          surrounding form (Submit / Add) stays the only red. */}
      <div className="flex flex-wrap gap-2 rounded-xl border-2 border-dashed border-ink bg-[var(--bg-elev)] p-2.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
className="text-xs font-extrabold rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] disabled:opacity-40 px-3 py-1.5 inline-flex items-center gap-1.5"
        >
          <UploadSimple aria-hidden size={14} />
          {uploading ? "Uploading…" : "Upload a file"}
        </button>
        {allowCapture && canCapture && (
          <button
            type="button"
            onClick={() => captureInputRef.current?.click()}
            disabled={uploading}
    className="text-xs font-extrabold rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] disabled:opacity-40 px-3 py-1.5 inline-flex items-center gap-1.5"
          >
            <Camera aria-hidden size={14} />
            Take photo
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode((m) => (m === "picker" ? "idle" : "picker"))}
className="text-xs font-extrabold rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] disabled:opacity-40 px-3 py-1.5 inline-flex items-center gap-1.5"
          aria-expanded={mode === "picker"}
        >
          <Books aria-hidden size={14} />
          From Documents
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label={label}
          onChange={handleUploadChange}
        />
        {allowCapture && canCapture && (
          <input
            ref={captureInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Take a photo of your work"
            onChange={handleUploadChange}
          />
        )}
      </div>

      {mode === "picker" && (
        <div className="rounded-xl border-2 border-ink bg-[var(--bg-elev)] shadow-sticker-sm max-h-48 overflow-y-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents…"
            className="w-full px-3 py-2 text-xs font-semibold bg-[var(--bg-elev)] border-b-2 border-dashed border-[color:var(--border)] outline-none focus:border-brand-600 sticky top-0"
          />
          {docs === null && (
            <div className="px-3 py-4 text-xs font-semibold text-[var(--text-dim)]">
              Loading documents…
            </div>
          )}
          {docs !== null && docs.length === 0 && (
            <div className="px-3 py-4 text-xs font-semibold text-[var(--text-dim)]">
              No documents in this room yet — upload one from the Documents
              drawer, or use the "Upload a file" button above.
            </div>
          )}
          {docs !== null && docs.length > 0 && (
            <ul>
              {docs
                .filter((d) =>
                  search
                    ? d.name.toLowerCase().includes(search.toLowerCase())
                    : true,
                )
                .map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ url: d.url, name: d.name });
                        setMode("idle");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[var(--hover)] text-xs font-bold flex items-center gap-2 border-b border-[color:var(--border-subtle)] last:border-b-0"
                    >
                      <FileIcon aria-hidden size={14} className="shrink-0 text-[var(--text-muted)]" />
                      <span className="flex-1 truncate">{d.name}</span>
                      {d.uploaded_by_name && (
                        <span className="font-semibold text-[var(--text-dim)] truncate max-w-[40%]">
                          {d.uploaded_by_name}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
