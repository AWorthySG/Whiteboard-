"use client";

import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import type { Editor, TLShape } from "tldraw";

// Extract the user-visible text from any tldraw shape.
// text shapes, geo shapes and sticky notes store text in props.text;
// frame shapes store a label in props.name.
function getShapeText(shape: TLShape): string {
  const p = shape.props as Record<string, unknown>;
  const t = typeof p.text === "string" ? p.text : typeof p.name === "string" ? p.name : "";
  return t.trim();
}

export default function CanvasSearch({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<TLShape[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSelected(0); return; }
    const q = query.toLowerCase();
    const found = editor
      .getCurrentPageShapes()
      .filter((s) => getShapeText(s).toLowerCase().includes(q));
    setResults(found);
    setSelected(0);
  }, [query, editor]);

  const jumpTo = (shape: TLShape) => {
    editor.setSelectedShapes([shape.id]);
    const bounds = editor.getShapePageBounds(shape);
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
        className="w-full max-w-sm rounded-xl shadow-2xl border border-[color:var(--border)] bg-[var(--bg-elev)] overflow-hidden"
        style={{ pointerEvents: "auto" }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[color:var(--border-subtle)]">
          <MagnifyingGlass size={15} className="text-[var(--text-muted)] shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search text on canvas…"
            className="flex-1 bg-transparent text-sm outline-none placeholder-[var(--text-dim)]"
          />
          {query.trim() && (
            <span className="text-[11px] text-[var(--text-dim)] shrink-0">
              {results.length} {results.length === 1 ? "match" : "matches"}
            </span>
          )}
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] ml-1 shrink-0"
            aria-label="Close search"
          >
            <X size={13} weight="bold" aria-hidden />
          </button>
        </div>

        {query.trim() && (
          <ul className="max-h-56 overflow-y-auto">
            {results.length === 0 ? (
              <li className="px-4 py-3 text-xs text-[var(--text-dim)]">
                No text matches &ldquo;{query}&rdquo;
              </li>
            ) : (
              results.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(s)}
                    onMouseEnter={() => setSelected(i)}
                    className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 transition-colors ${
                      i === selected ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-dim)] shrink-0 w-10">
                      {s.type}
                    </span>
                    <span className="flex-1 truncate">{getShapeText(s)}</span>
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
