"use client";

import { useConfirmAction } from "@/hooks/useConfirmAction";

// Drop-in replacement for any delete button that used confirm().
// First tap shows 'Confirm?' for 4s; second tap within that window
// runs onConfirm. Works on phone (window.confirm is unreliable on
// iOS/Android WebViews), accessibility, and screen readers.
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
    ? "text-red-700 font-medium"
    : "text-[var(--text-dim)] hover:text-red-600";
  return (
    <button
      onClick={trigger}
      className={`${armedCls} ${className ?? "text-xs"}`}
      title={armed ? `Tap again to confirm` : (title ?? label)}
      aria-pressed={armed}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
