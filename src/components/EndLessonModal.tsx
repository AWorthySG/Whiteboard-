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
    setStage({ kind: "working", label: "Rendering pages…" });
    try {
      const { url, name } = await exportLessonPdf({
        editor,
        roomId,
        roomTitle,
        hostName,
        hostUserId,
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

      // Post the link to the room chat so guests can grab it before
      // they leave. Surface failure as a non-blocking warning — the
      // PDF still exists in the Documents drawer so the lesson
      // material isn't lost; the host can paste the link manually.
      const supabase = getSupabase();
      if (supabase) {
        const { error: chatErr } = await supabase
          .from("room_messages")
          .insert({
            room_id: roomId,
            user_id: hostUserId,
            user_name: hostName,
            text: `📄 Lesson PDF is ready: ${url}`,
          });
        if (chatErr) {
          console.warn("[end-lesson] chat insert failed", chatErr);
          toast.error(
            "PDF saved (in Documents drawer), but the chat link couldn't be posted — share manually.",
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
      toast.success("Lesson PDF saved and shared in chat");
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
            ? "Done — the PDF link is in the room chat and a copy has been downloaded to this device. The file is also in the Documents drawer so guests can grab it before they leave."
            : "Saves the whole whiteboard as a PDF, posts the link to the room chat (so guests can grab it), and downloads a copy for you. Then you leave the room."}
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
