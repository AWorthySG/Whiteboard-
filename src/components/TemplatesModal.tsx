"use client";

import { useCallback, useEffect, useState } from "react";
import type { Editor, TLContent } from "tldraw";
import { FloppyDisk, Stack, Trash, X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "./Toast";

// A saved board template. `content` is a tldraw TLContent blob (shapes +
// assets + bindings of one page) stored as jsonb — opaque here, cast back
// to TLContent only when handed to the editor.
type Template = {
  id: string;
  name: string;
  content: unknown;
  created_at: string | null;
};

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
      .select("id,name,content,created_at")
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
    const { error } = await supabase.from("room_templates").insert({
      owner_user_id: user.id,
      name: trimmed,
      content: content as unknown as Record<string, unknown>,
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
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-[var(--bg-elev)] border border-[color:var(--border)] rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)] sticky top-0 bg-[var(--bg-elev)] z-10">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Stack size={16} aria-hidden />
            Board templates
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close templates"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="p-5 space-y-4">
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
                <label className="block text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-medium">
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
                    className="flex-1 rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-2.5 py-1.5 text-sm outline-none focus:border-brand-500"
                  />
                  <button
                    onClick={() => void saveCurrentPage()}
                    disabled={saving || !name.trim()}
                    className="shrink-0 text-sm rounded-md bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50 px-3 py-1.5 font-medium inline-flex items-center gap-1.5"
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
                <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-medium">
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
                  <ul className="space-y-1">
                    {templates.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-2 rounded-md border border-[color:var(--border)] bg-[var(--bg)] px-2.5 py-1.5"
                      >
                        <span
                          className="flex-1 text-sm truncate"
                          title={t.name}
                        >
                          {t.name}
                        </span>
                        <button
                          onClick={() => loadTemplate(t)}
                          className="shrink-0 text-xs rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-2.5 py-1 font-medium"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => void deleteTemplate(t)}
                          disabled={busyId === t.id}
                          className="shrink-0 text-[var(--text-dim)] hover:text-[color:var(--destructive)] disabled:opacity-50 p-1"
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
