"use client";

import { useEffect, useState, useRef } from "react";
import type { Editor } from "tldraw";

// Touch-friendly zoom controls: works on phones, tablets, and desktop.
// tldraw's default ZoomMenu sits inside MenuPanel, which we disable in
// WhiteboardCanvas — so we render our own. Anchored to the bottom-right
// of the canvas so it doesn't collide with the PagesTabBar (bottom-center)
// or the SlimToolbar (top-center).
export default function ZoomControls({ editor }: { editor: Editor | null }) {
  const [zoomPct, setZoomPct] = useState(100);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Keep the displayed % in sync with the editor's camera.
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setZoomPct(Math.round(editor.getZoomLevel() * 100));
    };
    update();
    // The camera lives in session state; listen there so we don't churn
    // on every shape edit.
    const unsub = editor.store.listen(update, { scope: "session" });
    return () => unsub();
  }, [editor]);

  // Close preset menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  if (!editor) return null;

  const setZoomTo = (pct: number) => {
    // Anchor the new zoom on the current viewport centre, so the user
    // doesn't lose their place. Pattern: capture the page point currently
    // under the screen centre, change z, then offset the camera so the
    // same page point lines up under the screen centre again.
    const z = pct / 100;
    const screenCentre = editor.getViewportScreenCenter();
    const before = editor.screenToPage(screenCentre);
    const cam = editor.getCamera();
    editor.setCamera({ x: cam.x, y: cam.y, z });
    const after = editor.screenToPage(screenCentre);
    const next = editor.getCamera();
    editor.setCamera(
      { x: next.x + (after.x - before.x), y: next.y + (after.y - before.y), z },
      { animation: { duration: 200 } },
    );
    setMenuOpen(false);
  };

  const fitToContent = () => {
    editor.zoomToFit({ animation: { duration: 250 } });
    setMenuOpen(false);
  };

  const resetZoom = () => {
    editor.resetZoom(undefined, { animation: { duration: 200 } });
    setMenuOpen(false);
  };

  return (
    <div
      ref={menuRef}
      // `relative` keeps the preset dropdown menu (absolute bottom-full)
      // anchored to this pill rather than the canvas wrapper.
      className="relative flex items-center gap-1 rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-[0_4px_12px_rgba(60,40,20,0.08)] px-1 py-1"
    >
      <button
        onClick={() => editor.zoomOut(undefined, { animation: { duration: 150 } })}
        className="touch-target w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--hover)] text-lg leading-none"
        aria-label="Zoom out"
        title="Zoom out"
      >
        −
      </button>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="touch-target h-9 min-w-[3.5rem] px-2 flex items-center justify-center rounded-full text-xs font-medium text-[var(--text)] hover:bg-[var(--hover)] tabular-nums"
        aria-label="Zoom level menu"
        title="Zoom level"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {zoomPct}%
      </button>
      <button
        onClick={() => editor.zoomIn(undefined, { animation: { duration: 150 } })}
        className="touch-target w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--hover)] text-lg leading-none"
        aria-label="Zoom in"
        title="Zoom in"
      >
        +
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-44 rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-1"
        >
          <ZoomMenuItem label="Fit to content" hint="Shows everything" onClick={fitToContent} />
          <ZoomMenuItem label="Reset to 100%" hint="Default zoom" onClick={resetZoom} />
          <div className="my-1 border-t border-[color:var(--border-subtle)]" />
          <ZoomMenuItem label="50%" onClick={() => setZoomTo(50)} />
          <ZoomMenuItem label="75%" onClick={() => setZoomTo(75)} />
          <ZoomMenuItem label="100%" onClick={() => setZoomTo(100)} />
          <ZoomMenuItem label="150%" onClick={() => setZoomTo(150)} />
          <ZoomMenuItem label="200%" onClick={() => setZoomTo(200)} />
        </div>
      )}
    </div>
  );
}

function ZoomMenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full text-left text-sm rounded-md px-2.5 py-1.5 hover:bg-[var(--hover)] text-[var(--text)] flex items-center justify-between gap-2"
    >
      <span>{label}</span>
      {hint && <span className="text-xs text-[var(--text-dim)]">{hint}</span>}
    </button>
  );
}
