"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  renderPlaintextFromRichText,
  type Editor,
  type TLRichText,
  type TLShape,
  type TLShapeId,
} from "tldraw";

// Result of one match: the shape, its page, and the matched plaintext.
// We carry page info because results can span every page in the room
// — clicking jumps to the page first, then to the shape.
interface SearchHit {
  shape: TLShape;
  pageId: TLShapeId;
  pageName: string;
  pageIndex: number;
  text: string;
}

// Extract the user-visible plaintext from any tldraw shape.
//
// History: tldraw 3.x moved text/note/geo labels from `props.text`
// (string) to `props.richText` (a ProseMirror JSON doc). The previous
// implementation read `props.text` and so found nothing on text,
// note, and geo shapes — the three shape types that actually carry
// user text. That made ⌘F silently dead. `renderPlaintextFromRichText`
// is tldraw's public helper for this; it caches per-richText doc.
//
// `props.name` is still a plain string on frame shapes, so we keep
// it as a fallback so frame labels are still searchable.
function getShapeText(editor: Editor, shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  if (p.richText && typeof p.richText === "object") {
    try {
      return renderPlaintextFromRichText(editor, p.richText as TLRichText).trim();
    } catch {
      // Be defensive: if a malformed richText slipped past sync, don't
      // wedge the whole search — fall through to the name fallback.
    }
  }
  if (typeof p.name === "string") return p.name.trim();
  return "";
}

export default function CanvasSearch({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Snapshot the page list so we can render "Page 3 of 12" badges
  // even after the user jumps to a result and the current page
  // changes. The list is small and changes only on rename/add/delete,
  // not during typical search.
  const pages = useMemo(() => editor.getPages(), [editor]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSelected(0); return; }
    const q = query.toLowerCase();
    const found: SearchHit[] = [];
    // Iterate every page so worksheets spread across many tldraw
    // pages are fully searchable — not just the one the user
    // happens to be on. Each page's shape ids are read from the
    // editor's cached index; lookups are O(1).
    pages.forEach((page, pageIndex) => {
      const ids = editor.getPageShapeIds(page.id);
      for (const id of ids) {
        const shape = editor.getShape(id);
        if (!shape) continue;
        const text = getShapeText(editor, shape);
        if (text && text.toLowerCase().includes(q)) {
          found.push({
            shape,
            pageId: page.id as unknown as TLShapeId,
            pageName: page.name,
            pageIndex,
            text,
          });
        }
      }
    });
    setResults(found);
    setSelected(0);
  }, [query, editor, pages]);

  const jumpTo = (hit: SearchHit) => {
    // If the result is on a different page, switch there first.
    // setSelectedShapes + zoomToBounds both target the current
    // page state, so switching first is required for cross-page
    // hits to actually frame the shape.
    if (editor.getCurrentPageId() !== (hit.pageId as unknown as string)) {
      editor.setCurrentPage(hit.pageId as never);
    }
    editor.setSelectedShapes([hit.shape.id]);
    const bounds = editor.getShapePageBounds(hit.shape);
    if (bounds) {
      editor.zoomToBounds(bounds, { inset: 80, animation: { duration: 200 } });
    }
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((n) => Math.min(n + 1, results.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((n) => Math.max(n - 1, 0));
    }
    if (e.key === "Enter" && results[selected]) {
      jumpTo(results[selected]);
    }
  };

  return (
    <div
      className="absolute top-0 inset-x-0 flex justify-center pt-3 z-[9998] px-3"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-sticker-lg border-2 border-ink bg-[var(--bg-elev)] overflow-hidden scale-pop"
        style={{ pointerEvents: "auto" }}
      >
        <div className="flex items-center gap-2 p-2.5">
          <div className="flex-1 min-w-0 flex items-center gap-2 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3 py-2 focus-within:border-brand-600 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
            <MagnifyingGlass size={15} className="text-[var(--text-muted)] shrink-0" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search text on canvas…"
              className="flex-1 min-w-0 bg-transparent text-sm font-semibold outline-none placeholder-[var(--text-dim)]"
            />
            {query.trim() && (
              <span className="text-[11px] font-bold text-[var(--text-dim)] shrink-0">
                {results.length} {results.length === 1 ? "match" : "matches"}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label="Close search"
          >
            <X size={13} weight="bold" aria-hidden />
          </button>
        </div>

        {query.trim() && (
          <ul className="max-h-56 overflow-y-auto border-t-2 border-dashed border-[color:var(--border)]">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-xs font-semibold text-[var(--text-dim)]">
                No text matches &ldquo;{query}&rdquo;
              </li>
            ) : (
              results.map((hit, i) => (
                <li key={hit.shape.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(hit)}
                    onMouseEnter={() => setSelected(i)}
                    className={`w-full text-left px-4 py-2 text-sm font-semibold flex items-center gap-2 transition-colors ${
                      i === selected ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
                    }`}
                  >
                    <span
                      className="font-label text-[var(--text-dim)] shrink-0 w-10"
                      title={`${hit.shape.type} on ${hit.pageName}`}
                    >
                      {hit.shape.type}
                    </span>
                    <span className="flex-1 truncate">{hit.text}</span>
                    {pages.length > 1 && (
                      <span className="text-[10px] font-semibold text-[var(--text-dim)] shrink-0 max-w-[6rem] truncate">
                        {hit.pageName}
                      </span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
