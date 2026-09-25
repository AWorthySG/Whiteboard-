"use client";

import { useState } from "react";
import { useValue, type Editor } from "tldraw";
import { Broom, FilePlus, X } from "@phosphor-icons/react";
import { HEAVY_PAGE_SHAPES } from "@/lib/tidyPage";

/** After "×", stay quiet until the page grows by this many more items. */
const SNOOZE_SHAPES = 2000;

/**
 * Host-only nudge in the canvas's top-right column once the current page
 * holds HEAVY_PAGE_SHAPES items (every pen stroke is one). A page slows
 * down as they pile up, so it offers the two fixes: a fresh page, or
 * "Tidy" (merge the old handwriting into pictures).
 */
export default function HeavyPageNotice({
  editor,
  onNewPage,
  onTidy,
}: {
  editor: Editor;
  onNewPage: () => void;
  onTidy: () => void;
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
  if (count < threshold) return null;

  return (
    <div
      className="rounded-2xl pl-3 pr-1 py-1.5 text-[11px] font-extrabold border-2 border-ink bg-[var(--sun-bg)] text-[var(--text)] shadow-sticker max-w-[17rem]"
      role="status"
    >
      <div className="flex items-start gap-1">
        <span className="flex-1 leading-snug pt-0.5">
          This page is getting full ({count.toLocaleString()} items), which can
          slow the board down.
        </span>
        <button
          onClick={() => setSnoozed((s) => ({ ...s, [pageId]: count }))}
          className="touch-target rounded-full p-1 text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center shrink-0"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X size={12} aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pr-2">
        <button
          onClick={onNewPage}
          className="touch-target rounded-full px-2.5 py-1 border-2 border-ink bg-[var(--bg-elev)] hover:bg-[var(--hover)] sticker-press inline-flex items-center gap-1"
        >
          <FilePlus size={12} aria-hidden />
          New page
        </button>
        <button
          onClick={onTidy}
          className="touch-target rounded-full px-2.5 py-1 border-2 border-ink bg-[var(--bg-elev)] hover:bg-[var(--hover)] sticker-press inline-flex items-center gap-1"
          title="Merge the old handwriting on this page into pictures"
        >
          <Broom size={12} aria-hidden />
          Tidy page
        </button>
      </div>
    </div>
  );
}
