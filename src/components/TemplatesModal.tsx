"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor, TLContent, TLShapeId } from "tldraw";
import {
  Check,
  FloppyDisk,
  PencilSimple,
  Stack,
  Trash,
  X,
} from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "./Toast";

// A saved board template. `content` is a tldraw TLContent blob (shapes +
// assets + bindings of one page) stored as jsonb — opaque here, cast back
// to TLContent only when handed to the editor. `thumbnail` is a small
// raster data URL captured at save time (nullable).
type Template = {
  id: string;
  name: string;
  content: unknown;
  thumbnail: string | null;
  created_at: string | null;
};

// Rasterize the given shapes to a small WebP data URL for the library
// preview. Best-effort: returns null on any failure so saving still
// succeeds without a thumbnail. We export then downscale through a canvas
// so the stored bytes are bounded by pixel size, not page complexity
// (an SVG export would inline full-resolution images and balloon).
async function makeThumbnail(
  editor: Editor,
  ids: TLShapeId[],
): Promise<string | null> {
  try {
    const { exportToBlob } = await import("tldraw");
    const blob = await exportToBlob({
      editor,
      ids,
      format: "png",
      opts: { background: true, padding: 24, scale: 0.5 },
    });
    return await downscaleToDataUrl(blob, 320);
  } catch (e) {
    console.warn("[templates] thumbnail capture failed", e);
    return null;
  }
}

function downscaleToDataUrl(blob: Blob, maxW: number): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio = img.width > maxW ? maxW / img.width : 1;
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL("image/webp", 0.7));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Host-only library of reusable board layouts. The host saves the current
// page's content under a name and can drop any saved template into the
// current page of any room later. Templates are account-scoped (owned by
// the signed-in host), so saving/loading requires being signed in — a
// localStorage-only host sees a prompt to sign in instead.
export default function TemplatesModal({
  open,
  onClose,
  editor,
}: {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
}) {
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const fetchTemplates = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase || !user) {
      setTemplates([]);
      return;
    }
    // RLS already scopes rows to the owner; we don't need an explicit
    // owner filter, but ordering newest-first keeps the list stable.
    const { data, error } = await supabase
      .from("room_templates")
      .select("id,name,content,thumbnail,created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`Couldn't load templates: ${error.message}`);
      setTemplates([]);
      return;
    }
    setTemplates((data ?? []) as Template[]);
  }, [user, toast]);

  useEffect(() => {
    if (open && user) void fetchTemplates();
    if (!open) {
      setTemplates(null);
      setName("");
    }
  }, [open, user, fetchTemplates]);

  if (!open) return null;

  const saveCurrentPage = async () => {
    // Re-entrancy guard: the button is disabled while saving, but the
    // name input's Enter handler isn't — a quick double-Enter during the
    // async thumbnail capture would otherwise insert two identical rows.
    if (saving) return;
    const trimmed = name.trim();
    if (!editor) {
      toast.error("Whiteboard isn't ready yet.");
      return;
    }
    if (!trimmed) {
      toast.error("Give the template a name.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase || !user) return;
    const ids = [...editor.getCurrentPageShapeIds()];
    if (ids.length === 0) {
      toast.error("This page is empty — nothing to save.");
      return;
    }
    const content = editor.getContentFromCurrentPage(ids);
    if (!content) {
      toast.error("Couldn't read this page.");
      return;
    }
    setSaving(true);
    const thumbnail = await makeThumbnail(editor, ids);
    const { error } = await supabase.from("room_templates").insert({
      owner_user_id: user.id,
      name: trimmed,
      content: content as unknown as Record<string, unknown>,
      thumbnail,
    });
    setSaving(false);
    if (error) {
      toast.error(`Save failed: ${error.message}`);
      return;
    }
    toast.success(`Saved “${trimmed}”`);
    setName("");
    void fetchTemplates();
  };

  const loadTemplate = (t: Template) => {
    if (!editor) {
      toast.error("Whiteboard isn't ready yet.");
      return;
    }
    try {
      // Fresh ids are generated, assets/bindings remapped, and the new
      // shapes selected so the host can immediately move them.
      editor.putContentOntoCurrentPage(t.content as TLContent, {
        select: true,
      });
      editor.zoomToSelection({ animation: { duration: 200 } });
      toast.success(`Loaded “${t.name}”`);
      onClose();
    } catch (err) {
      toast.error(`Couldn't load template: ${(err as Error).message}`);
    }
  };

  const renameTemplate = async (t: Template) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === t.name) {
      setEditingId(null);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    setBusyId(t.id);
    const { error } = await supabase
      .from("room_templates")
      .update({ name: trimmed })
      .eq("id", t.id);
    setBusyId(null);
    setEditingId(null);
    if (error) {
      toast.error(`Couldn't rename: ${error.message}`);
      return;
    }
    setTemplates((prev) =>
      prev ? prev.map((x) => (x.id === t.id ? { ...x, name: trimmed } : x)) : prev,
    );
  };

  const deleteTemplate = async (t: Template) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setBusyId(t.id);
    const { error } = await supabase
      .from("room_templates")
      .delete()
      .eq("id", t.id);
    setBusyId(null);
    if (error) {
      toast.error(`Couldn't delete: ${error.message}`);
      return;
    }
    setTemplates((prev) => (prev ? prev.filter((x) => x.id !== t.id) : prev));
  };

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-[rgba(28,27,25,0.4)] p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-[var(--bg-elev)] border-2 border-ink rounded-2xl shadow-sticker-lg scale-pop w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-dashed border-[color:var(--border)] sticky top-0 bg-[var(--bg-elev)] z-10">
          <h2 className="text-lg font-extrabold tracking-display flex items-center gap-2">
            <Stack size={18} aria-hidden />
            Board templates
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close templates"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {!authLoading && !user ? (
            <p className="text-sm text-[var(--text-muted)] leading-relaxed">
              Templates are saved to your account so you can reuse them in any
              room. Sign in (or claim this room in Settings → Account) to save
              and load board templates.
            </p>
          ) : (
            <>
              {/* Save the current page */}
              <div className="space-y-1.5">
                <label className="block font-label text-[var(--text-muted)]">
                  Save this page as a template
                </label>
                <div className="flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveCurrentPage();
                    }}
                    placeholder="e.g. Algebra warm-up"
                    maxLength={80}
                    className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                  />
                  <button
                    onClick={() => void saveCurrentPage()}
                    disabled={saving || !name.trim()}
                    className="btn-primary shrink-0"
                  >
                    <FloppyDisk size={15} aria-hidden />
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-dim)]">
                  Captures everything on the current page. Loading a template
                  adds its content to whatever page you're on.
                </p>
              </div>

              {/* Saved templates */}
              <div className="space-y-1.5">
                <div className="font-label text-[var(--text-muted)]">
                  Your templates
                </div>
                {templates === null && (
                  <p className="text-xs text-[var(--text-dim)] py-2">
                    Loading…
                  </p>
                )}
                {templates !== null && templates.length === 0 && (
                  <p className="text-xs text-[var(--text-dim)] py-2">
                    No templates yet. Save a page above to start your library.
                  </p>
                )}
                {templates !== null && templates.length > 0 && (
                  // Each template is its own sticker card; the list gaps
                  // are wide enough that one card's 4px hard shadow
                  // doesn't land on the next card's outline.
                  <ul className="space-y-3 pt-1">
                    {templates.map((t) => (
                      <li
                        key={t.id}
                        className="card-lift flex items-center gap-2 rounded-xl border-2 border-ink bg-[var(--bg-elev)] shadow-sticker px-3 py-2"
                      >
                        <span className="shrink-0 w-14 h-10 rounded-lg border-2 border-ink bg-[var(--bg-elev-2)] overflow-hidden flex items-center justify-center">
                          {t.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={t.thumbnail}
                              alt=""
                              aria-hidden
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <Stack
                              size={16}
                              aria-hidden
                              className="text-[var(--text-dim)]"
                            />
                          )}
                        </span>
                        {editingId === t.id ? (
                          <input
                            value={editingName}
                            autoFocus
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void renameTemplate(t);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => void renameTemplate(t)}
                            maxLength={80}
                            className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elev)] border-2 border-brand-600 shadow-[0_0_0_3px_var(--accent-soft)] px-2.5 py-1 text-sm font-semibold outline-none"
                          />
                        ) : (
                          <span
                            className="flex-1 min-w-0 text-sm font-bold truncate"
                            title={t.name}
                          >
                            {t.name}
                          </span>
                        )}
                        {editingId === t.id ? (
                          <button
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void renameTemplate(t)}
                            disabled={busyId === t.id}
                            className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-brand-600 disabled:opacity-40"
                            aria-label="Save name"
                            title="Save name"
                          >
                            <Check size={15} aria-hidden />
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingId(t.id);
                              setEditingName(t.name);
                            }}
                            className="shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                            aria-label={`Rename template ${t.name}`}
                            title="Rename"
                          >
                            <PencilSimple size={15} aria-hidden />
                          </button>
                        )}
                        {/* Compact primary pill — written out rather than
                            .btn-primary because that class's padding wins
                            over utilities and would make the row too tall. */}
                        <button
                          onClick={() => loadTemplate(t)}
                          className="shrink-0 text-xs rounded-full bg-brand-600 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press hover:bg-brand-700 px-3 py-1"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => void deleteTemplate(t)}
                          disabled={busyId === t.id}
                          className="shrink-0 w-8 h-8 rounded-full bg-danger-50 text-danger-700 border-2 border-ink shadow-sticker-sm sticker-press hover:bg-danger-100 disabled:opacity-40 inline-flex items-center justify-center"
                          aria-label={`Delete template ${t.name}`}
                          title="Delete template"
                        >
                          <Trash size={15} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
