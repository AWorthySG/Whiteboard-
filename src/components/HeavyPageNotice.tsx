"use client";

import { useEffect, useState } from "react";
import { useValue, type Editor } from "tldraw";
import { ArrowCounterClockwise, Broom, FilePlus, X } from "@phosphor-icons/react";
import { HEAVY_PAGE_SHAPES } from "@/lib/tidyPage";
import { isHeavyRoom, roomSize } from "@/lib/startFresh";

/** After "×", stay quiet until the page grows by this many more items. */
const SNOOZE_SHAPES = 2000;
/** How often the whole-room size is re-counted (it walks every record). */
const ROOM_CHECK_MS = 20_000;

const pill =
  "touch-target rounded-full px-2.5 py-1 border-2 border-ink bg-[var(--bg-elev)] hover:bg-[var(--hover)] sticker-press inline-flex items-center gap-1";

/**
 * Host-only nudges in the canvas's top-right column:
 * - the CURRENT PAGE holds HEAVY_PAGE_SHAPES items (every pen stroke is
 *   one): a page slows down as they pile up, so offer a fresh page or
 *   "Tidy" (merge the old handwriting into pictures);
 * - otherwise, the WHOLE ROOM is heavy (isHeavyRoom): everyone who joins
 *   downloads every page, so offer "Save & start fresh".
 */
export default function HeavyPageNotice({
  editor,
  onNewPage,
  onTidy,
  onStartFresh,
}: {
  editor: Editor;
  onNewPage: () => void;
  onTidy: () => void;
  onStartFresh?: () => void;
}) {
  const pageId = useValue("pageId", () => editor.getCurrentPageId(), [editor]);
  const count = useValue(
    "pageShapeCount",
    () => editor.getCurrentPageShapeIds().size,
    [editor],
  );
  // Per page: the count at which it was dismissed.
  const [snoozed, setSnoozed] = useState<Record<string, number>>({});
  const threshold = Math.max(
    HEAVY_PAGE_SHAPES,
    (snoozed[pageId] ?? -Infinity) + SNOOZE_SHAPES,
  );

  // Whole-room size, re-counted now and then rather than per change.
  const [room, setRoom] = useState(() => roomSize(editor));
  const [roomDismissed, setRoomDismissed] = useState(false);
  useEffect(() => {
    if (!onStartFresh) return;
    const id = window.setInterval(() => setRoom(roomSize(editor)), ROOM_CHECK_MS);
    return () => window.clearInterval(id);
  }, [editor, onStartFresh]);

  if (count >= threshold) {
    return (
      <Card onDismiss={() => setSnoozed((s) => ({ ...s, [pageId]: count }))}>
        <span>
          This page is getting full ({count.toLocaleString()} items), which can
          slow the board down.
        </span>
        <div className="flex items-center gap-1.5 mt-1.5 pr-2">
          <button onClick={onNewPage} className={pill}>
            <FilePlus size={12} aria-hidden />
            New page
          </button>
          <button
            onClick={onTidy}
            className={pill}
            title="Merge the old handwriting on this page into pictures"
          >
            <Broom size={12} aria-hidden />
            Tidy page
          </button>
        </div>
      </Card>
    );
  }

  if (onStartFresh && !roomDismissed && isHeavyRoom(room)) {
    return (
      <Card onDismiss={() => setRoomDismissed(true)}>
        <span>
          This room holds {room.shapes.toLocaleString()} items across{" "}
          {room.pages} pages. Everyone who joins downloads all of it, so it
          opens more slowly.
        </span>
        <div className="flex items-center gap-1.5 mt-1.5 pr-2">
          <button
            onClick={onStartFresh}
            className={pill}
            title="Save every page as a PDF in Documents, then clear the board"
          >
            <ArrowCounterClockwise size={12} aria-hidden />
            Save &amp; start fresh
          </button>
        </div>
      </Card>
    );
  }

  return null;
}

function Card({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      className="rounded-2xl pl-3 pr-1 py-1.5 text-[11px] font-extrabold border-2 border-ink bg-[var(--sun-bg)] text-[var(--text)] shadow-sticker max-w-[17rem]"
      role="status"
    >
      <div className="flex items-start gap-1">
        <div className="flex-1 leading-snug pt-0.5">{children}</div>
        <button
          onClick={onDismiss}
          className="touch-target rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center shrink-0"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X size={12} aria-hidden />
        </button>
      </div>
    </div>
  );
}
