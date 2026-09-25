"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { LockSimpleOpen, TrashSimple, X } from "@phosphor-icons/react";
import {
  deleteUploadedItem,
  findUploadedItemAt,
  isUserUploadedFile,
  unlockUploadedItem,
} from "@/lib/uploadedItems";

// Screen pixels a press may drift and still count as a tap (not a pan).
const TAP_SLOP_PX = 6;

/**
 * Host-only pill for a file on the board: "Uploaded file · Delete · Unlock".
 * It appears (1) straight after the host pastes or uploads a photo / PDF,
 * and (2) whenever the host taps an uploaded item with the Select or Hand
 * tool. Uploads are locked so students can't disturb them, which also made
 * them impossible for the host to select — this is how they come back off
 * the board. Rendered inside CanvasFloatingPanel.
 */
export default function UploadedItemControls({
  editor,
}: {
  editor: Editor | null;
}) {
  const [target, setTarget] = useState<TLShapeId | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  // (1) Announce a file the host just placed.
  useEffect(() => {
    if (!editor) return;
    return editor.store.listen(
      ({ changes }) => {
        let latest: TLShapeId | null = null;
        for (const rec of Object.values(changes.added)) {
          if (rec.typeName !== "shape") continue;
          if (isUserUploadedFile(editor, rec)) latest = rec.id;
        }
        if (latest) setTarget(latest);
      },
      { source: "user", scope: "document" },
    );
  }, [editor]);

  // (2) A tap on an uploaded item with Select or Hand. Any other press
  // (drawing, erasing) dismisses the pill.
  useEffect(() => {
    if (!editor) return;
    const onEvent = (info: {
      type: string;
      name?: string;
      point?: { x: number; y: number };
    }) => {
      if (info.type !== "pointer" || !info.point) return;
      const tool = editor.getCurrentToolId();
      const tapTool = tool === "select" || tool === "hand";
      if (info.name === "pointer_down") {
        downRef.current = tapTool ? { ...info.point } : null;
        if (!tapTool) setTarget(null);
        return;
      }
      if (info.name !== "pointer_up" || !downRef.current) return;
      const d = downRef.current;
      downRef.current = null;
      if (Math.hypot(info.point.x - d.x, info.point.y - d.y) > TAP_SLOP_PX) return;
      const pagePoint = editor.screenToPage(info.point);
      // Let tldraw finish its own handling of the tap first: tapping ink
      // or a post-it on top of a worksheet selects THAT, and then the pill
      // shouldn't claim the worksheet underneath.
      editor.timers.setTimeout(() => {
        if (editor.getSelectedShapeIds().length > 0) {
          setTarget(null);
          return;
        }
        setTarget(findUploadedItemAt(editor, pagePoint)?.id ?? null);
      }, 0);
    };
    editor.on("event", onEvent as never);
    return () => {
      editor.off("event", onEvent as never);
    };
  }, [editor]);

  // Outline the item the pill refers to; drop the pill if the item goes
  // away (deleted here, undone, or removed by another client).
  useEffect(() => {
    if (!editor || !target) return;
    editor.setHintingShapes([target]);
    const unsub = editor.store.listen(() => {
      if (!editor.getShape(target)) setTarget(null);
    }, { scope: "document" });
    return () => {
      unsub();
      editor.setHintingShapes([]);
    };
  }, [editor, target]);

  if (!editor || !target || !editor.getShape(target)) return null;

  return (
    <div
      className="rounded-full pl-3 pr-1 py-1 text-[11px] font-extrabold border-2 border-ink bg-[var(--bg-elev)] text-[var(--text)] shadow-sticker flex items-center gap-1.5"
      role="group"
      aria-label="Uploaded file"
    >
      <span className="text-[var(--text-muted)]">Uploaded file</span>
      <button
        onClick={() => {
          if (deleteUploadedItem(editor, target)) setTarget(null);
        }}
        className="touch-target rounded-full px-2.5 py-1 border-2 border-ink bg-danger-50 text-danger-700 hover:bg-danger-100 sticker-press inline-flex items-center gap-1"
        aria-label="Delete this uploaded file from the board"
        title="Delete from the board (Undo brings it back)"
      >
        <TrashSimple size={12} aria-hidden />
        Delete
      </button>
      <button
        onClick={() => {
          if (unlockUploadedItem(editor, target)) setTarget(null);
        }}
        className="touch-target rounded-full px-2.5 py-1 border-2 border-ink bg-[var(--bg-elev)] hover:bg-[var(--hover)] sticker-press inline-flex items-center gap-1"
        aria-label="Unlock this file to move or resize it"
        title="Unlock to move or resize"
      >
        <LockSimpleOpen size={12} aria-hidden />
        Unlock
      </button>
      <button
        onClick={() => setTarget(null)}
        className="touch-target rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
