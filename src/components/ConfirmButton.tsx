"use client";

import { useConfirmAction } from "@/hooks/useConfirmAction";

// Drop-in replacement for any delete button that used confirm().
// First tap shows 'Confirm?' for 4s; second tap within that window
// runs onConfirm. Works on phone (window.confirm is unreliable on
// iOS/Android WebViews), accessibility, and screen readers.
//
// Shape: a small secondary sticker pill at rest; once armed it flips to
// the pale-red destructive variant (never a solid red — that reads as
// a primary action) so "tap again to confirm" is visibly different.
export default function ConfirmButton({
  onConfirm,
  label = "Remove",
  confirmLabel = "Confirm?",
  title,
  className,
}: {
  onConfirm: () => void | Promise<void>;
  label?: string;
  confirmLabel?: string;
  title?: string;
  className?: string;
}) {
  const { armed, trigger } = useConfirmAction(onConfirm);
  const armedCls = armed
    ? "bg-danger-50 text-danger-700"
    : "bg-[var(--bg-elev)] text-[var(--text-muted)] hover:bg-[var(--bg-elev-2)] hover:text-danger-700";
  return (
    <button
      onClick={trigger}
      className={`inline-flex items-center justify-center rounded-full border-2 border-ink font-extrabold shadow-sticker-sm sticker-press px-3 py-1 ${armedCls} ${className ?? "text-xs"}`}
      title={armed ? `Tap again to confirm` : (title ?? label)}
      aria-pressed={armed}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
