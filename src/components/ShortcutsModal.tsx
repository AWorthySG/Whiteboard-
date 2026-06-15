"use client";

import { X } from "@phosphor-icons/react";

type ShortcutEntry = { keys: string[]; label: string };
type Section = { title: string; items: ShortcutEntry[] };

// Only lists shortcuts that are actually active in this app.
// Geometric shape tools (R/O/A/L/T/F) are intentionally omitted —
// their kbd bindings are cleared in the tools() override.
const SECTIONS: Section[] = [
  {
    title: "Drawing tools",
    items: [
      { keys: ["D"],       label: "Pen / draw" },
      { keys: ["Q"],       label: "Highlighter" },
      { keys: ["E"],       label: "Eraser" },
      { keys: ["V"],       label: "Select" },
      { keys: ["H"],       label: "Hand / pan" },
      { keys: ["K"],       label: "Laser pointer" },
      { keys: ["N"],       label: "Sticky note" },
    ],
  },
  {
    title: "Actions",
    items: [
      { keys: ["⌘", "Z"],       label: "Undo" },
      { keys: ["⌘", "⇧", "Z"],  label: "Redo" },
      { keys: ["⌘", "D"],       label: "Duplicate selection" },
      { keys: ["⌘", "A"],       label: "Select all" },
      { keys: ["⌘", "C"],       label: "Copy" },
      { keys: ["⌘", "V"],       label: "Paste (images from clipboard too)" },
      { keys: ["⌘", "X"],       label: "Cut" },
      { keys: ["Del"],           label: "Delete selected" },
      { keys: ["Esc"],           label: "Back to select / cancel" },
    ],
  },
  {
    title: "View & navigation",
    items: [
      { keys: ["Space", "drag"], label: "Pan canvas" },
      { keys: ["Scroll"],        label: "Zoom in / out" },
      { keys: ["⌘", "="],        label: "Zoom in" },
      { keys: ["⌘", "−"],        label: "Zoom out" },
      { keys: ["⌘", "0"],        label: "Reset zoom to 100%" },
      { keys: ["⌘", "⇧", "H"],   label: "Fit all shapes on screen" },
      { keys: ["⌘", "F"],        label: "Search text on canvas" },
    ],
  },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded border border-[color:var(--border)] bg-[var(--bg-elev-2,#f1f5f9)] text-[11px] font-semibold shadow-sm leading-tight">
      {children}
    </kbd>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 && (
            <span className="text-[var(--text-dim)] text-[10px] mx-0.5">
              {k === "drag" ? "" : "+"}
            </span>
          )}
          {k === "drag" ? (
            <span className="text-xs text-[var(--text-dim)] italic">drag</span>
          ) : (
            <Key>{k}</Key>
          )}
        </span>
      ))}
    </div>
  );
}

export default function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative bg-[var(--bg-elev)] border border-[color:var(--border)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)] sticky top-0 bg-[var(--bg-elev)]">
          <h2 className="font-semibold text-sm">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close shortcuts"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] font-medium mb-2">
                {section.title}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between gap-4 py-0.5"
                  >
                    <span className="text-sm text-[var(--text-muted)]">{item.label}</span>
                    <Keys keys={item.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
