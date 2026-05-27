"use client";

import { useState } from "react";
import type { Editor } from "tldraw";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";
import { getSupabase } from "@/lib/supabase";
import { exportLessonPdf } from "@/lib/exportLessonPdf";

type Stage =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "done"; url: string; name: string };

import { useEscapeToClose } from "@/hooks/useEscapeToClose";

export default function EndLessonModal({
  open,
  onClose,
  editor,
  roomId,
  roomTitle,
  hostName,
  hostUserId,
}: {
  open: boolean;
  onClose: () => void;
  editor: Editor | null;
  roomId: string;
  roomTitle: string | null;
  hostName: string;
  hostUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  // Esc only closes the modal when we're idle — don't yank it
  // mid-export.
  useEscapeToClose(open && stage.kind === "idle", onClose);

  if (!open) return null;

  const saveAndLeave = async () => {
    // Re-entrancy guard: a second click while we're working would
    // launch a parallel export + duplicate the upload.
    if (stage.kind !== "idle") return;
    if (!editor) {
      toast.error("Canvas not ready");
      return;
    }
    setStage({ kind: "working", label: "Preparing recap…" });
    try {
      // Gather recap data (homework + recordings) up front so it can go
      // both on the PDF cover page and in the chat recap message.
      const supabase = getSupabase();
      let homework: { title: string; dueDate: string | null }[] = [];
      let recordings: { title: string; url: string }[] = [];
      if (supabase) {
        const [{ data: hwData }, { data: recData }] = await Promise.all([
          supabase
            .from("room_homework")
            .select("title,due_date,created_at")
            .eq("room_id", roomId)
            .order("created_at", { ascending: true }),
          supabase
            .from("room_recordings")
            .select("title,file_url,recorded_at")
            .eq("room_id", roomId)
            .order("recorded_at", { ascending: true }),
        ]);
        homework = ((hwData as { title: string; due_date: string | null }[]) ?? []).map(
          (h) => ({ title: h.title, dueDate: h.due_date }),
        );
        recordings = ((recData as { title: string | null; file_url: string }[]) ?? []).map(
          (r) => ({ title: r.title ?? "Recording", url: r.file_url }),
        );
      }

      const { url, name } = await exportLessonPdf({
        editor,
        roomId,
        roomTitle,
        hostName,
        hostUserId,
        summary: {
          homework,
          recordings: recordings.map((r) => ({ title: r.title })),
        },
        onProgress: (p) => {
          const label =
            p.stage === "rendering"
              ? `Rendering page ${p.current} of ${p.total}…`
              : p.stage === "stitching"
                ? "Building PDF…"
                : p.stage === "uploading"
                  ? "Uploading…"
                  : "Done";
          setStage({ kind: "working", label });
        },
      });

      // Post a recap to the room chat so guests can grab everything before
      // they leave: the PDF link, recording links, and the homework list.
      // ChatBubble renders with whitespace-pre-wrap, so newlines survive.
      // Surface failure as a non-blocking warning — the PDF still exists in
      // the Documents drawer so the lesson material isn't lost.
      if (supabase) {
        const titleStr = roomTitle?.trim() || roomId;
        const parts = [`📄 Lesson recap — ${titleStr}`, "", `Whiteboard PDF: ${url}`];
        if (recordings.length > 0) {
          parts.push("", "Recordings:");
          for (const r of recordings) parts.push(`• ${r.title}: ${r.url}`);
        }
        if (homework.length > 0) {
          parts.push("", "Homework:");
          for (const h of homework) {
            parts.push(`• ${h.title}${h.dueDate ? ` (due ${h.dueDate})` : ""}`);
          }
        }
        const { error: chatErr } = await supabase
          .from("room_messages")
          .insert({
            room_id: roomId,
            user_id: hostUserId,
            user_name: hostName,
            text: parts.join("\n"),
          });
        if (chatErr) {
          console.warn("[end-lesson] chat insert failed", chatErr);
          toast.error(
            "Recap PDF saved (in Documents drawer), but the chat post failed — share manually.",
          );
        }
      }

      // Trigger a download for the host so they have a local copy.
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.target = "_blank";
      a.rel = "noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStage({ kind: "done", url, name });
      toast.success("Lesson recap saved and shared in chat");
    } catch (e) {
      console.error("[end-lesson] pdf failed", e);
      toast.error(`Couldn't save PDF: ${(e as Error).message}`);
      setStage({ kind: "idle" });
    }
  };

  const leaveNow = () => {
    router.push("/");
  };

  const working = stage.kind === "working";
  const done = stage.kind === "done";

  return (
    <div
      className="fixed inset-0 z-[14000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={working ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">End lesson?</h2>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          {done
            ? "Done — the recap (PDF link, recordings, and homework) is posted in the room chat and a copy has been downloaded. The PDF is also in the Documents drawer so guests can grab it before they leave."
            : "Builds a recap PDF of the whole whiteboard (with a homework + recordings summary), posts the recap to the room chat so guests can grab it, and downloads a copy for you. Then you leave the room."}
        </p>

        {working && (
          <div className="mt-4 text-xs text-[var(--text-muted)] flex items-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
            {stage.label}
          </div>
        )}

        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          {done ? (
            <button
              onClick={leaveNow}
              className="touch-target rounded-md bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 text-sm font-medium"
            >
              Leave room
            </button>
          ) : (
            <>
              <button
                onClick={leaveNow}
                disabled={working}
                className="touch-target rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-4 py-2 text-sm disabled:opacity-50"
              >
                Just leave (no PDF)
              </button>
              <button
                onClick={saveAndLeave}
                disabled={working}
                className="touch-target rounded-md bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {working ? stage.label : "Save PDF and leave"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
