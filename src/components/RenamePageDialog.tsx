"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Editor, TLPageId } from "tldraw";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

/** Which page the dialog is naming. `isNew` = opened straight after
 *  "+ New page", so the secondary action reads "Skip" (keep "Page N"). */
export type RenamePageTarget = { pageId: string; isNew: boolean };

/** Signature of RoomShell's requestRenamePage, threaded to every rename
 *  entry point (header dropdown, PagesTabBar, command palette). */
export type RequestRenamePage = (
  pageId: string,
  opts?: { isNew?: boolean },
) => void;

/** Backdrop taps this soon after the dialog opens are ignored (see
 *  openedAtRef). Longer than a double-tap, shorter than a deliberate tap. */
const BACKDROP_GRACE_MS = 350;

// The single page-naming UI for every entry point. It exists because the
// old inline rename inputs saved on BLUR, and on an iPad tapping the board
// never blurs anything: tldraw preventDefaults the canvas touchend, so no
// compatibility mousedown/click is synthesised and focus never moves. The
// name was silently never saved. Here the ONLY commit is an explicit
// submit — Save, or the keyboard's Return/"Done" — and blur does nothing.
//
// Rendered by RoomShell OUTSIDE .tldraw-shell. The card is top-anchored
// (pt-[12vh]) so the iPad's on-screen keyboard can never cover it.
type RenameEditor = Pick<Editor, "getPage" | "renamePage"> &
  Partial<Pick<Editor, "markHistoryStoppingPoint">>;

export default function RenamePageDialog({
  editor,
  target,
  onClose,
}: {
  editor: RenameEditor | null;
  target: RenamePageTarget | null;
  onClose: () => void;
}) {
  if (!editor || !target) return null;
  const page = editor.getPage(target.pageId as TLPageId);
  if (!page) return null;
  // Keyed on the target so the draft resets when a different page (or the
  // same page re-opened) is being named.
  return (
    <RenamePageDialogCard
      key={`${target.pageId}:${target.isNew}`}
      editor={editor}
      pageId={target.pageId as TLPageId}
      initialName={page.name}
      isNew={target.isNew}
      onClose={onClose}
    />
  );
}

function RenamePageDialogCard({
  editor,
  pageId,
  initialName,
  isNew,
  onClose,
}: {
  editor: RenameEditor;
  pageId: TLPageId;
  initialName: string;
  isNew: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialName);
  const titleId = useId();
  const hintId = useId();
  // Guards the Return key and the Save button both landing in one gesture.
  const doneRef = useRef(false);
  // A backdrop tap only cancels if the press also STARTED on the backdrop —
  // otherwise dragging a text selection out of the input and lifting on the
  // backdrop (common with the Pencil) would throw the typed name away.
  const pressedBackdropRef = useRef(false);
  // When the card mounted (set after commit; null until then). A backdrop
  // tap in the first BACKDROP_GRACE_MS is ignored: the dialog opens INSIDE
  // the "+ New page" tap, so a double-tap's second tap lands on the fresh
  // backdrop and used to close the naming prompt at once.
  const openedAtRef = useRef<number | null>(null);
  useEffect(() => {
    openedAtRef.current = Date.now();
  }, []);
  // Only the FIRST focus selects the whole name (so typing replaces
  // "Page 3"). Selecting on every focus meant a tutor who blurred the field
  // (the iPad keyboard's hide key, a tap on the card padding) and tapped
  // back in lost her half-typed name to the next keystroke or Scribble.
  const selectedOnceRef = useRef(false);
  useEscapeToClose(true, onClose);
  // Once something has been typed, the backdrop stops cancelling: "type,
  // then tap the board to finish" is the habit behind the original bug,
  // and a tap there silently threw the name away. The dialog just stays
  // open with Save in reach; Skip/Cancel/Escape still discard explicitly.
  const dirty = draft !== initialName;

  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const next = draft.trim();
    const page = editor.getPage(pageId);
    // Skip no-op writes: an empty or unchanged name would still sync to
    // every client. A page deleted remotely meanwhile is simply dropped.
    if (page && next && next !== page.name) {
      // Its own undo step, so Undo doesn't also take back the last stroke.
      editor.markHistoryStoppingPoint?.("rename page");
      editor.renamePage(pageId, next);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center bg-[rgba(28,27,25,0.4)] pt-[12vh] px-4"
      onPointerDown={(e) => {
        pressedBackdropRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const openedAt = openedAtRef.current;
        const cancel =
          e.target === e.currentTarget &&
          pressedBackdropRef.current &&
          !dirty &&
          openedAt !== null &&
          Date.now() - openedAt >= BACKDROP_GRACE_MS;
        pressedBackdropRef.current = false;
        if (cancel) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-5 scale-pop"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <h2 id={titleId} className="text-lg font-extrabold tracking-display">
            {isNew ? "Name this page" : "Rename page"}
          </h2>
          <p id={hintId} className="text-sm text-[var(--text-muted)] mt-1">
            {isNew
              ? `Everyone in the room sees page names. Skip to keep “${initialName}”.`
              : "Everyone in the room sees the new name."}
          </p>
          <input
            // Mounts inside the tap that opened the dialog (the state update
            // is synchronous in that click), so the focus lands inside the
            // user gesture and iOS raises the keyboard.
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              if (selectedOnceRef.current) return;
              selectedOnceRef.current = true;
              e.currentTarget.select();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // Return while an IME is composing picks a candidate — it is
              // not a submit. (Safari reports that keydown as keyCode 229.)
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              // Submit here, once, and stop the browser's implicit form
              // submission so Return can't commit twice.
              e.preventDefault();
              commit();
            }}
            enterKeyHint="done"
            autoComplete="off"
            maxLength={60}
            aria-label="Page name"
            // text-base (16px): anything smaller makes iOS zoom the page
            // when the field focuses.
            className="mt-4 w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-base font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          <div className="mt-5 flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary min-h-[44px]"
            >
              {isNew ? "Skip" : "Cancel"}
            </button>
            <button type="submit" className="btn-primary min-h-[44px] text-white">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
