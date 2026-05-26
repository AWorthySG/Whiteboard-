"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";

const LINE_PRESETS = [3, 5, 8, 10, 15, 20];
const WIDTH_OPTIONS = [
  { label: "Narrow", value: 480 },
  { label: "Standard", value: 720 },
  { label: "Wide", value: 960 },
];

export default function AnswerSpaceModal({
  open,
  onClose,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (lines: number, width: number) => void;
}) {
  const [lines, setLines] = useState(8);
  const [width, setWidth] = useState(720);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-[var(--bg-elev)] border border-[color:var(--border)] rounded-xl shadow-2xl p-5 w-[min(360px,92vw)] flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text)]">Insert answer lines</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)]"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        {/* Line count */}
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-2">Number of lines</p>
          <div className="flex gap-1.5 flex-wrap">
            {LINE_PRESETS.map((n) => (
              <button
                key={n}
                onClick={() => setLines(n)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  lines === n
                    ? "bg-[color:var(--accent)] text-white"
                    : "bg-[var(--hover)] text-[var(--text)] hover:bg-[var(--border)]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Width */}
        <div>
          <p className="text-xs text-[var(--text-muted)] mb-2">Width</p>
          <div className="flex gap-1.5">
            {WIDTH_OPTIONS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWidth(w.value)}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  width === w.value
                    ? "bg-[color:var(--accent)] text-white"
                    : "bg-[var(--hover)] text-[var(--text)] hover:bg-[var(--border)]"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div
          className="rounded-lg border border-[color:var(--border)] bg-white overflow-hidden"
          style={{ height: 88 }}
          aria-hidden
        >
          <div className="flex flex-col justify-around h-full px-3 py-2">
            {Array.from({ length: Math.min(lines, 4) }).map((_, i) => (
              <div key={i} className="border-b border-[#c8d0db]" />
            ))}
          </div>
          {lines > 4 && (
            <p className="text-[10px] text-center text-[var(--text-dim)] -mt-1 pb-1">
              +{lines - 4} more lines on canvas
            </p>
          )}
        </div>

        <button
          onClick={() => { onInsert(lines, width); onClose(); }}
          className="bg-brand-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 transition-colors"
        >
          Insert onto canvas
        </button>
      </div>
    </div>
  );
}
