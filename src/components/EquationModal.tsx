"use client";

import { useEffect, useState } from "react";
import { useToast } from "./Toast";

type Props = {
  open: boolean;
  onClose: () => void;
  onInsert: (dataUrl: string, width: number, height: number) => Promise<void> | void;
};

const SAMPLES: { label: string; latex: string }[] = [
  { label: "Fraction", latex: "\\frac{a}{b}" },
  { label: "Exponent", latex: "x^{2}+y^{2}=z^{2}" },
  { label: "Square root", latex: "\\sqrt{x^{2}+y^{2}}" },
  { label: "Sum", latex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}" },
  { label: "Integral", latex: "\\int_{a}^{b} f(x)\\,dx" },
  { label: "Limit", latex: "\\lim_{x\\to 0}\\frac{\\sin x}{x}=1" },
  { label: "Matrix", latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
  { label: "Quadratic", latex: "x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}" },
];

export default function EquationModal({ open, onClose, onInsert }: Props) {
  const toast = useToast();
  const [latex, setLatex] = useState("x = \\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}");
  const [displayMode, setDisplayMode] = useState(true);
  const [previewSvg, setPreviewSvg] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Debounced preview render via the server.
  useEffect(() => {
    if (!open || !latex.trim()) {
      setPreviewSvg(null);
      setPreviewErr(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/math", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latex, displayMode }),
        });
        const data = (await res.json()) as {
          dataUrl?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.dataUrl) {
          setPreviewErr(data.error || "Failed to render");
          setPreviewSvg(null);
        } else {
          setPreviewErr(null);
          setPreviewSvg(data.dataUrl);
        }
      } catch (e) {
        if (!cancelled) setPreviewErr((e as Error).message);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, latex, displayMode]);

  const handleInsert = async () => {
    if (!latex.trim()) return;
    setInserting(true);
    try {
      const res = await fetch("/api/math", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex, displayMode }),
      });
      const data = (await res.json()) as {
        dataUrl?: string;
        width?: number;
        height?: number;
        error?: string;
      };
      if (!res.ok || !data.dataUrl) throw new Error(data.error || "Render failed");
      await onInsert(data.dataUrl, data.width ?? 480, data.height ?? 96);
      toast.success("Equation inserted");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setInserting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Insert equation</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--text-muted)]">LaTeX</label>
            <textarea
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              rows={3}
              spellCheck={false}
              className="mt-1 w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm font-mono outline-none focus:border-brand-500 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={displayMode}
              onChange={(e) => setDisplayMode(e.target.checked)}
            />
            <span>Display mode (large, centred)</span>
          </label>

          <div>
            <label className="text-xs text-[var(--text-muted)]">Preview</label>
            <div className="mt-1 rounded-md bg-white border border-[color:var(--border)] p-4 min-h-[80px] flex items-center justify-center">
              {previewErr ? (
                <span className="text-red-500 text-sm">{previewErr}</span>
              ) : previewSvg ? (
                <img
                  src={previewSvg}
                  alt="Equation preview"
                  className="max-h-32 max-w-full"
                />
              ) : (
                <span className="text-[var(--text-muted)] text-sm">Type LaTeX above…</span>
              )}
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-muted)]">Quick samples</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  onClick={() => setLatex(s.latex)}
                  className="text-xs rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-2 py-1"
                  title={s.latex}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="text-sm rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              onClick={handleInsert}
              disabled={inserting || !latex.trim() || !!previewErr}
              className="text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 px-3 py-1.5 font-medium"
            >
              {inserting ? "Inserting…" : "Insert"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
